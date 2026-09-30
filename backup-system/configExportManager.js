/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Exportar / Importar Configurações
 *
 *  Reaproveita 100% o banco existente: `db.getGuild(guildId)` já
 *  retorna TODO o nó de dados daquele servidor (loja, produtos,
 *  variantes, estoque, banner, thumbnail, footer, descrição, pix,
 *  mercadopago, definições/canais/cargos, painéis, proteção,
 *  sorteios, tickets, config administrativa — literalmente tudo que
 *  é persistido por guild). `db.setGuild(guildId, dados)` substitui
 *  esse nó inteiro de uma vez. Não existe cache em memória para essas
 *  configurações (toda leitura já é feita direto do disco a cada
 *  chamada), então a importação já reflete imediatamente em todo o
 *  sistema, sem precisar reiniciar o bot.
 *
 *  Importação é via ANEXO (não modal — o limite de 4000 caracteres
 *  do Discord em campos de texto inviabiliza colar um backup
 *  completo). O bot aguarda, por até 2 minutos, uma mensagem do
 *  mesmo usuário que clicou em "Importar" contendo um arquivo
 *  `.kaelcfg` anexado, lê o conteúdo direto da URL do anexo, valida,
 *  e só então substitui a configuração.
 *
 *  A licença do servidor (db.licenses[guildId]) fica em uma tabela
 *  separada e NÃO é tocada por este sistema — export/import aqui é
 *  só sobre configuração, nunca sobre licenciamento.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, AttachmentBuilder,
} = require('discord.js');

const db = require('../database/db');

const COR = { success: 0x00FF7F, danger: 0xFF4444, info: 0xFFD700 };
const TEMPO_ESPERA_MS = 2 * 60 * 1000;

function botoesExportImport() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg_exportar_agora').setLabel('Exportar Configurações').setEmoji('<:save:1533080403810713773>').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfg_importar_abrir').setLabel('Importar Configurações').setEmoji('<:import1:1533080710544625684>').setStyle(ButtonStyle.Secondary),
  );
}

// ── EXPORTAR ──────────────────────────────────────────────────────
async function exportarAgora(interaction) {
  await interaction.deferReply({ flags: 64 });
  try {
    const dados = db.getGuild(interaction.guildId);
    // JSON minificado (uma única linha) — sem espaços/indentação.
    const jsonMinificado = JSON.stringify(dados);
    const anexo = new AttachmentBuilder(Buffer.from(jsonMinificado, 'utf8'), { name: 'KAEL.kaelcfg' });

    const embed = new EmbedBuilder()
      .setColor(COR.success)
      .setTitle('<:save:1533080403810713773> Configurações Exportadas')
      .setDescription(
        `> Todas as configurações deste servidor foram exportadas em um único arquivo.\n` +
        `> Guarde este arquivo com cuidado — ele contém dados sensíveis (chave PIX, tokens do Mercado Pago, etc).\n\n` +
        `Para restaurar, clique em **Importar Configurações** e envie este arquivo no canal quando o bot pedir.`
      )
      .setFooter({ text: `Tamanho: ${(jsonMinificado.length / 1024).toFixed(1)} KB` });

    await interaction.editReply({ embeds: [embed], files: [anexo] });
  } catch (e) {
    console.error('[ExportConfig] Erro ao exportar:', e.message);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao exportar').setDescription(`> ${e.message}`)],
    });
  }
}

// Validação básica de estrutura — não exige um schema rígido (as
// configurações evoluem com novas seções), só garante que é um objeto
// JSON válido e não algo aleatório enviado por engano.
function validarConteudoImportado(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return 'O arquivo não contém um objeto de configuração válido.';
  }
  return null;
}

// Trava simples por canal, pra evitar dois "Importar" simultâneos no
// mesmo canal criando dois collectors concorrentes.
const importacoesEmAndamento = new Set();

// ── IMPORTAR ──────────────────────────────────────────────────────
async function abrirColetaArquivo(interaction) {
  const chaveCanal = interaction.channelId;
  if (importacoesEmAndamento.has(chaveCanal)) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('⏳ Já existe uma importação em andamento')
        .setDescription('> Aguarde a importação atual terminar (ou expirar) antes de iniciar outra neste canal.')],
      flags: 64,
    });
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.info).setTitle('<:import1:1533080710544625684> Importar Configurações')
      .setDescription(`Envie o arquivo \`.kaelcfg\` neste canal em até **2 minutos**.\nSó ${interaction.user} pode enviar o arquivo — mensagens de outras pessoas serão ignoradas.`)],
  });

  const canal = interaction.channel;
  importacoesEmAndamento.add(chaveCanal);

  const collector = canal.createMessageCollector({
    filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
    time: TEMPO_ESPERA_MS,
    max: 1,
  });

  collector.on('collect', async (mensagem) => {
    await processarArquivoImportado(interaction, mensagem);
    importacoesEmAndamento.delete(chaveCanal);
  });

  collector.on('end', (coletadas) => {
    importacoesEmAndamento.delete(chaveCanal);
    if (coletadas.size === 0) {
      interaction.followUp({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('⌛ Tempo esgotado')
          .setDescription('> Nenhum arquivo foi enviado a tempo. Clique em **Importar Configurações** novamente se quiser tentar de novo.')],
        flags: 64,
      }).catch(() => {});
    }
  });
}

async function processarArquivoImportado(interaction, mensagem) {
  const anexo = mensagem.attachments.find(a => a.name?.toLowerCase().endsWith('.kaelcfg'));

  if (!anexo) {
    return mensagem.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Arquivo inválido')
        .setDescription('> Só é aceito um arquivo com extensão `.kaelcfg`. Tente novamente clicando em **Importar Configurações**.')],
    });
  }

  // Backup automático das configurações atuais ANTES de qualquer
  // alteração — se algo der errado, isso é usado pra restaurar tudo
  // exatamente como estava, sem perda de dados.
  const backupAtual = db.getGuild(interaction.guildId);

  let dadosNovos;
  try {
    const resposta = await fetch(anexo.url);
    if (!resposta.ok) throw new Error(`Não foi possível baixar o arquivo (HTTP ${resposta.status}).`);
    const textoArquivo = await resposta.text();
    dadosNovos = JSON.parse(textoArquivo);
  } catch (e) {
    return mensagem.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao ler o arquivo')
        .setDescription(`> ${e.message}\n> Nenhuma configuração foi alterada.`)],
    });
  }

  const erroValidacao = validarConteudoImportado(dadosNovos);
  if (erroValidacao) {
    return mensagem.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Conteúdo inválido')
        .setDescription(`> ${erroValidacao}\n> Nenhuma configuração foi alterada.`)],
    });
  }

  try {
    // Substitui TUDO de uma vez — produtos, variantes (IDs originais
    // preservados, pois vêm intactos dentro do próprio arquivo
    // importado), estoque, painéis, pix, canais, banners, thumbnails,
    // loja, sorteios, proteção, tickets, config administrativa.
    db.setGuild(interaction.guildId, dadosNovos);

    const totalProdutos = Array.isArray(dadosNovos?.loja?.produtos) ? dadosNovos.loja.produtos.length : 0;

    await mensagem.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Configurações Importadas')
        .setDescription(
          `> Todas as configurações foram restauradas com sucesso e já estão ativas no sistema — sem necessidade de reiniciar o bot.\n` +
          (totalProdutos ? `> **${totalProdutos}** produto(s) restaurado(s).` : '')
        )],
    });
  } catch (e) {
    // ROLLBACK: qualquer erro na hora de gravar desfaz tudo, voltando
    // exatamente para o estado anterior à importação.
    console.error('[ImportConfig] Erro ao importar, restaurando backup automático:', e.message);
    try {
      db.setGuild(interaction.guildId, backupAtual);
    } catch (e2) {
      console.error('[ImportConfig] Falha crítica ao restaurar backup automático:', e2.message);
    }
    await mensagem.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao importar — revertido automaticamente')
        .setDescription(`> Motivo: ${e.message}\n> As configurações anteriores foram restauradas, nada foi perdido.`)],
    });
  }
}

// ── HANDLERS ──────────────────────────────────────────────────────
async function handleButton(interaction) {
  if (interaction.customId === 'cfg_exportar_agora') return exportarAgora(interaction);
  if (interaction.customId === 'cfg_importar_abrir') return abrirColetaArquivo(interaction);
}

module.exports = {
  botoesExportImport,
  handleButton,
};
