/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /ranking (v2, layout horizontal em linha + paginação real)
 *
 *  O que mudou da versão anterior:
 *   - Layout LITERALMENTE HORIZONTAL: cada posição vira um trecho curto
 *     de texto ("🥇 @user — R$X"), e várias posições ficam juntas na
 *     MESMA linha, separadas por "|" — tudo dentro da description,
 *     sem usar campos separados (caixinhas) lado a lado.
 *   - Corrigido o bug visual dos campos fantasmas (\u200b) que criavam
 *     um buraco enorme na embed quando tinha menos de 3 compradores.
 *     Agora só aparecem posições com dados reais — sem preenchimento.
 *   - Paginação de verdade (⏮️ ⬅️ <:arrow:1524206792626933831> ⏭️), 12 posições por página (4
 *     linhas de 3), navegando por TODO o ranking — antes ficava
 *     travado só no Top 10, sem like ver além disso.
 *   - Collector com timeout (2 min), trava de segurança pra só quem
 *     rodou o comando poder navegar, e desabilita os botões sozinho
 *     quando expira (evita ficar um coletor vivo pra sempre na memória).
 *
 *  Fonte de dados: loja.historicoCompras — mesma de sempre, mesma
 *  usada por /meuspedidos e pelo botão "Ver Entrega". Nenhuma
 *  estrutura nova de banco, e nada no fluxo de vendas foi tocado.
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');
const { precoParaFloat, floatParaPreco } = require('../sales-system/salesManager');

const COR = { primary: 0xDC143C, gold: 0xFFD700, success: 0x00FF7F, danger: 0xFF4444 };
const ITENS_POR_LINHA = 3; // quantas posições ficam juntas, lado a lado, na mesma linha de texto
const LINHAS_POR_PAGINA = 4; // 4 linhas de 3 = 12 posições por página
const POR_PAGINA = ITENS_POR_LINHA * LINHAS_POR_PAGINA;
const COLLECTOR_TIME = 2 * 60 * 1000; // 2 minutos
const MEDALHAS = ['🥇', '🥈', '🥉'];

// ─── Agregação (idêntica à versão anterior, sem mudanças na lógica) ───
function getRankingCompradores(guildId, tipo = 'valor') {
  const historico = db.getGuild(guildId).loja?.historicoCompras || [];
  const porCliente = new Map();

  for (const registro of historico) {
    if (!registro?.clienteId) continue;
    const atual = porCliente.get(registro.clienteId) || { totalGasto: 0, totalItens: 0, totalPedidos: 0 };
    atual.totalGasto += precoParaFloat(registro.valor);
    atual.totalItens += (registro.quantidade || 1);
    atual.totalPedidos += 1;
    porCliente.set(registro.clienteId, atual);
  }

  const lista = Array.from(porCliente.entries()).map(([clienteId, dados]) => ({ clienteId, ...dados }));
  return tipo === 'quantidade'
    ? lista.sort((a, b) => b.totalItens - a.totalItens)
    : lista.sort((a, b) => b.totalGasto - a.totalGasto);
}

function getTopProdutos(guildId) {
  const historico = db.getGuild(guildId).loja?.historicoCompras || [];
  const porProduto = new Map();

  for (const registro of historico) {
    const nome = registro.produtoNome || 'Produto';
    const atual = porProduto.get(nome) || { receita: 0, vendas: 0 };
    atual.receita += precoParaFloat(registro.valor);
    atual.vendas += 1;
    porProduto.set(nome, atual);
  }

  return Array.from(porProduto.entries())
    .map(([nome, dados]) => ({ nome, ...dados }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 3);
}

function getStatsGerais(ranking) {
  return {
    totalClientes: ranking.length,
    totalGasto: ranking.reduce((s, r) => s + r.totalGasto, 0),
    totalItens: ranking.reduce((s, r) => s + r.totalItens, 0),
  };
}

// ─── Monta UMA página da embed, em grade horizontal (3 colunas) ───
function montarPagina({ guild, rankingCompleto, autorId, tipo, page }) {
  const ehQtd = tipo === 'quantidade';
  const totalPaginas = Math.max(1, Math.ceil(rankingCompleto.length / POR_PAGINA));
  const inicio = page * POR_PAGINA;
  const itensDaPagina = rankingCompleto.slice(inicio, inicio + POR_PAGINA);

  const embed = new EmbedBuilder()
    .setColor(COR.gold)
    .setAuthor({ name: `${guild.name} • Ranking de Compradores`, iconURL: guild.iconURL({ dynamic: true }) || undefined })
    .setTitle(ehQtd ? '<a:trofeu:1532499321008951538> Top Compradores — Por Quantidade' : '<a:trofeu:1532499321008951538> Top Compradores — Por Valor');

  // Layout literalmente horizontal: cada posição vira um trecho curto de
  // texto, e várias posições ficam juntas na MESMA linha, separadas por
  // "|" — em vez de campos separados (caixinhas) lado a lado.
  const trechos = itensDaPagina.map((r, i) => {
    const posicaoGlobal = inicio + i + 1;
    const selo = posicaoGlobal <= 3 ? MEDALHAS[posicaoGlobal - 1] : `#${posicaoGlobal}`;
    const valorPrincipal = ehQtd ? `${r.totalItens} item${r.totalItens === 1 ? '' : 's'}` : floatParaPreco(r.totalGasto);
    return `${selo} <@${r.clienteId}> — **${valorPrincipal}**`;
  });

  const linhas = [];
  for (let i = 0; i < trechos.length; i += ITENS_POR_LINHA) {
    linhas.push(trechos.slice(i, i + ITENS_POR_LINHA).join('  **|**  '));
  }

  let descricao = (ehQtd
    ? '> Os clientes que mais compraram itens neste servidor.\n\n'
    : '> Os clientes que mais compraram neste servidor, por valor total gasto.\n\n')
    + linhas.join('\n');

  embed.setDescription(descricao);

  // Produtos mais vendidos: só na primeira página, pra não repetir em todas.
  if (page === 0) {
    const topProdutos = getTopProdutos(guild.id);
    if (topProdutos.length > 0) {
      const listaProdutos = topProdutos.map((p, i) =>
        `${MEDALHAS[i] || `#${i + 1}`} **${p.nome}** — \`${floatParaPreco(p.receita)}\` _(${p.vendas} venda${p.vendas === 1 ? '' : 's'})_`
      ).join('\n');
      embed.addFields({ name: '⭐ Produtos Mais Vendidos', value: listaProdutos, inline: false });
    }
  }

  const minhaPosicaoIdx = rankingCompleto.findIndex(r => r.clienteId === autorId);
  const stats = getStatsGerais(rankingCompleto);
  let rodape = `${stats.totalClientes} cliente${stats.totalClientes === 1 ? '' : 's'} • ${floatParaPreco(stats.totalGasto)} • ${stats.totalItens} item${stats.totalItens === 1 ? '' : 's'} • Página ${page + 1}/${totalPaginas}`;
  rodape += minhaPosicaoIdx === -1 ? ' — Você não aparece no ranking' : ` — Sua posição: #${minhaPosicaoIdx + 1}`;
  embed.setFooter({ text: rodape }).setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rank_primeira').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('rank_voltar').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('rank_proximo').setEmoji('<:arrow:1524206792626933831>').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPaginas - 1),
    new ButtonBuilder().setCustomId('rank_ultima').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPaginas - 1),
    new ButtonBuilder().setCustomId('rank_seu_perfil').setEmoji('<:user:1532137085081878558>').setLabel('Seu Perfil').setStyle(ButtonStyle.Secondary),
  );

  return { embed, row, totalPaginas };
}

function montarEmbedVazio() {
  return new EmbedBuilder().setColor(COR.gold).setTitle('<a:trofeu:1532499321008951538> Ranking de Compradores')
    .setDescription('> Ainda não há compras registradas neste servidor.');
}

function montarEmbedPerfil(interaction, ranking) {
  const idx = ranking.findIndex(r => r.clienteId === interaction.user.id);
  if (idx === -1) {
    return new EmbedBuilder().setColor(COR.danger).setTitle('<:user:1532137085081878558> Seu Perfil')
      .setDescription('> Você ainda não fez nenhuma compra registrada neste servidor.');
  }
  const dados = ranking[idx];
  return new EmbedBuilder()
    .setColor(COR.gold)
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('<:user:1532137085081878558> Seu Perfil de Compras')
    .addFields(
      { name: '💰 Total Gasto', value: `\`${floatParaPreco(dados.totalGasto)}\``, inline: true },
      { name: '📦 Itens Comprados', value: `\`${dados.totalItens}\``, inline: true },
      { name: '🛒 Pedidos', value: `\`${dados.totalPedidos}\``, inline: true },
      { name: '<a:trofeu:1532499321008951538> Posição', value: `\`#${idx + 1} de ${ranking.length}\``, inline: true },
    )
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Veja o ranking de compradores deste servidor')
    .addStringOption(o => o
      .setName('tipo')
      .setDescription('Ordenar por valor gasto ou por quantidade de itens')
      .addChoices(
        { name: 'Valor gasto', value: 'valor' },
        { name: 'Quantidade de itens', value: 'quantidade' },
      )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Use este comando dentro de um servidor.')],
        flags: 64,
      });
    }

    if (!require('../utils/helpers').temPlanoMinimo(interaction.guild.id, 'PRO')) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Você não tem permissão para usar este comando').setDescription('> Adquira o plano **PRO**, ou superior para usar o comando.')],
        flags: 64,
      });
    }

    const tipo = interaction.options?.getString?.('tipo') || 'valor';
    const rankingCompleto = getRankingCompradores(interaction.guild.id, tipo);

    if (rankingCompleto.length === 0) {
      return interaction.reply({ embeds: [montarEmbedVazio()] });
    }

    let page = 0;
    const { embed, row } = montarPagina({ guild: interaction.guild, rankingCompleto, autorId: interaction.user.id, tipo, page });

    const respostaInicial = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    const collector = respostaInicial.createMessageComponentCollector({ time: COLLECTOR_TIME });

    collector.on('collect', async (i) => {
      // Só quem rodou o comando pode navegar/ver o próprio perfil por aqui.
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: '<:negativo:1528400986744295475> Só quem executou o comando pode interagir com este ranking.', flags: 64 });
      }

      if (i.customId === 'rank_seu_perfil') {
        return i.reply({ embeds: [montarEmbedPerfil(i, rankingCompleto)], flags: 64 });
      }

      const totalPaginas = Math.max(1, Math.ceil(rankingCompleto.length / POR_PAGINA));
      if (i.customId === 'rank_proximo') page = Math.min(page + 1, totalPaginas - 1);
      else if (i.customId === 'rank_voltar') page = Math.max(page - 1, 0);
      else if (i.customId === 'rank_ultima') page = totalPaginas - 1;
      else if (i.customId === 'rank_primeira') page = 0;
      else return;

      const { embed, row } = montarPagina({ guild: interaction.guild, rankingCompleto, autorId: interaction.user.id, tipo, page });
      await i.update({ embeds: [embed], components: [row] });
    });

    collector.on('end', () => {
      const { row } = montarPagina({ guild: interaction.guild, rankingCompleto, autorId: interaction.user.id, tipo, page });
      row.components.forEach(botao => botao.setDisabled(true));
      interaction.editReply({ components: [row] }).catch(() => {});
    });
  },

  getRankingCompradores,
  getTopProdutos,
};
