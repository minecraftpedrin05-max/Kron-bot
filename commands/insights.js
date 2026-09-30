// ═══════════════════════════════════════════════════════════════════════════
//  commands/insights.js — KAEL INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════
//
//  Painel único (Components V2, mesma arquitetura do ticket-system/painel.js)
//  com navegação por select-menu (escalável) e um collector próprio na
//  mensagem — self-contido, sem depender do buttonHandler global.
//
//  Tudo é configurável direto pelo painel (página Configurações): não é
//  preciso nenhum outro comando pra ativar recuperação de carrinho, alertas
//  automáticos, canal de alertas ou meta de faturamento.
//
//  Reaproveita 100% dos dados reais via insights-system/insightsEngine.js.
//  Isolado por guildId em toda consulta.
// ═══════════════════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ChannelType, MessageFlags,
} = require('discord.js');

const db = require('../database/db');
const { floatParaPreco } = require('../sales-system/salesManager');
const { CORES } = require('../config/constants');
const engine = require('../insights-system/insightsEngine');

const COLLECTOR_TIME = 5 * 60 * 1000;
const MODAL_TIME = 2 * 60 * 1000;
const ICONE_ERRO = '<:negativo:1528400986744295475>';

const PAGINAS = [
  { id: 'geral',     label: 'Geral',          emoji: '📊', descricao: 'Faturamento, pedidos, conversão' },
  { id: 'vendas',    label: 'Vendas',         emoji: '💰', descricao: 'Ranking e tendência de produtos' },
  { id: 'carrinhos', label: 'Carrinhos',      emoji: '🛒', descricao: 'Funil de conversão do carrinho' },
  { id: 'produtos',  label: 'Produtos',       emoji: '📦', descricao: 'Estoque baixo e cupons' },
  { id: 'metas',     label: 'Metas',          emoji: '🎯', descricao: 'Progresso da meta de faturamento' },
  { id: 'insights',  label: 'Insights',       emoji: '🧠', descricao: 'Recomendações e próximas ações' },
  { id: 'config',    label: 'Configurações',  emoji: '⚙️', descricao: 'Recuperação, alertas e meta' },
];

const PERIODOS = [
  { id: 'hoje', label: 'Últimas 24h', dias: 1 },
  { id: '7d',   label: '7 dias',      dias: 7 },
  { id: '30d',  label: '30 dias',     dias: 30 },
];

function linhaVazia(msg) {
  return `-# ${msg}`;
}

function barraProgresso(percentual, tamanho) {
  tamanho = tamanho || 12;
  const preenchido = Math.round((Math.min(100, Math.max(0, percentual)) / 100) * tamanho);
  return '█'.repeat(preenchido) + '░'.repeat(tamanho - preenchido);
}

function montarNav(paginaAtual, periodoAtual) {
  const paginaSelecionada = PAGINAS.find(p => p.id === paginaAtual);
  const selectPagina = new StringSelectMenuBuilder()
    .setCustomId('insights_pagina')
    .setPlaceholder((paginaSelecionada?.emoji || '📊') + ' ' + (paginaSelecionada?.label || 'Geral'))
    .addOptions(PAGINAS.map(p => ({
      label: p.label, value: p.id, emoji: p.emoji, description: p.descricao, default: p.id === paginaAtual,
    })));
  const linhas = [new ActionRowBuilder().addComponents(selectPagina)];

  if (paginaAtual !== 'config') {
    const selectPeriodo = new StringSelectMenuBuilder()
      .setCustomId('insights_periodo')
      .setPlaceholder('Período: ' + (PERIODOS.find(p => p.id === periodoAtual)?.label || '30 dias'))
      .addOptions(PERIODOS.map(p => ({ label: p.label, value: p.id, default: p.id === periodoAtual })));
    linhas.push(new ActionRowBuilder().addComponents(selectPeriodo));
  }

  return linhas;
}

function montarNavConfig(config) {
  const linha1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('insights_cfg_recuperacao_toggle')
      .setLabel('Recuperação: ' + (config.recuperacaoAtiva ? 'Ativa' : 'Desativada'))
      .setStyle(config.recuperacaoAtiva ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('insights_cfg_alertas_toggle')
      .setLabel('Alertas: ' + (config.alertasAtivo ? 'Ativos' : 'Desativados'))
      .setStyle(config.alertasAtivo ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const linha2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('insights_cfg_canal_btn').setLabel('Canal de alertas').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('insights_cfg_recuperacao_modal').setLabel('Ajustar recuperação').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('insights_cfg_meta_modal').setLabel('Definir meta').setStyle(ButtonStyle.Secondary),
  );
  return [linha1, linha2];
}

function montarSelectCanal() {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('insights_cfg_canal_select')
    .setPlaceholder('Selecione o canal para os alertas')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  return [new ActionRowBuilder().addComponents(select)];
}

function separador(divider) {
  return new SeparatorBuilder().setDivider(!!divider).setSpacing(SeparatorSpacingSize.Small);
}

function construirGeral(guildId, dias) {
  const resumo = engine.resumoGeral(guildId, dias);
  const container = new ContainerBuilder().setAccentColor(CORES.PRIMARIA);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Visão Geral'));
  container.addSeparatorComponents(separador(true));

  if (resumo.pedidosPagos === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      linhaVazia('Ainda não há vendas registradas no período selecionado.')
    ));
    return container;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Faturamento**\n${resumo.faturamentoStr}\n\n` +
    `**Pedidos pagos**\n${resumo.pedidosPagos}\n\n` +
    `**Clientes únicos**\n${resumo.clientesUnicos}\n\n` +
    `**Ticket médio**\n${resumo.ticketMedioStr}`
  ));
  container.addSeparatorComponents(separador(false));

  if (resumo.conversao) {
    const c = resumo.conversao;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Conversão**\n${c.pagos}/${c.iniciados} carrinhos viraram venda (${c.taxaConversao.toFixed(0)}%)`
    ));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      linhaVazia('Sem carrinhos suficientes no período pra calcular conversão.')
    ));
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Carrinhos abandonados agora**\n${resumo.carrinhosAbandonadosAgora}`
  ));

  return container;
}

function construirVendas(guildId, dias) {
  const { maisVendidos, menosVendidos } = engine.produtosRanking(guildId, dias, 5);
  const crescimento = engine.crescimentoProdutos(guildId, 15);
  const container = new ContainerBuilder().setAccentColor(CORES.SUCESSO);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Vendas'));
  container.addSeparatorComponents(separador(true));

  if (maisVendidos.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhaVazia('Sem vendas no período selecionado.')));
    return container;
  }

  const txtMais = maisVendidos.map((p, i) => `${i + 1}. **${p.produtoNome}** — ${p.quantidade}x (${floatParaPreco(p.faturamento)})`).join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Mais vendidos**\n${txtMais}`));

  if (menosVendidos.length > 0) {
    container.addSeparatorComponents(separador(false));
    const txtMenos = menosVendidos.map((p, i) => `${i + 1}. **${p.produtoNome}** — ${p.quantidade}x`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Menos vendidos**\n${txtMenos}`));
  }

  const emQueda = crescimento.filter(c => c.tendencia === 'queda').slice(0, 3);
  const emAlta = crescimento.filter(c => c.tendencia === 'crescimento').slice(0, 3);
  if (emAlta.length > 0 || emQueda.length > 0) {
    container.addSeparatorComponents(separador(false));
    let txt = '**Tendência** (15 dias vs 15 dias anteriores)\n';
    for (const c of emAlta) txt += `\n▲ ${c.produtoNome}: ${c.qtdAnterior} → ${c.qtdAtual}`;
    for (const c of emQueda) txt += `\n▼ ${c.produtoNome}: ${c.qtdAnterior} → ${c.qtdAtual}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(txt));
  }

  return container;
}

function construirCarrinhos(guildId, dias) {
  const conversao = engine.calcularConversao(guildId, dias);
  const demanda = engine.calcularDemandaPorProduto(guildId, dias).sort((a, b) => b.carrinhos - a.carrinhos).slice(0, 5);
  const container = new ContainerBuilder().setAccentColor(CORES.AVISO);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Carrinhos'));
  container.addSeparatorComponents(separador(true));

  if (!conversao) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhaVazia('Nenhum carrinho iniciado no período selecionado.')));
    return container;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Iniciados:** ${conversao.iniciados}\n` +
    `**PIX gerado:** ${conversao.pixGerados}\n` +
    `**Pagos:** ${conversao.pagos}\n` +
    `**Cancelados:** ${conversao.cancelados}\n` +
    `**Em aberto:** ${conversao.emAberto}\n` +
    `**Taxa de conversão:** ${conversao.taxaConversao.toFixed(0)}%`
  ));

  if (demanda.length > 0) {
    container.addSeparatorComponents(separador(false));
    const txt = demanda.map(d => `**${d.produtoNome}** — ${d.carrinhos} carrinho(s), ${d.pagos} pago(s) (${d.taxaConversao.toFixed(0)}%)`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Por produto**\n${txt}`));
  }

  return container;
}

function construirProdutos(guildId) {
  const estoqueBaixo = engine.estoqueBaixo(guildId, 3);
  const cupons = engine.cuponsResumo(guildId);
  const container = new ContainerBuilder().setAccentColor(CORES.PRIMARIA);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Produtos'));
  container.addSeparatorComponents(separador(true));

  if (estoqueBaixo.length > 0) {
    const txt = estoqueBaixo.map(e => `**${e.produtoNome}**${e.varianteNome ? ` (${e.varianteNome})` : ''} — ${e.quantidade} unidade(s)`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Estoque baixo**\n${txt}`));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhaVazia('Nenhum produto com estoque baixo no momento.')));
  }

  container.addSeparatorComponents(separador(false));

  if (cupons.length > 0) {
    const txt = cupons.map(c => `\`${c.codigo}\` (${c.produtoNome}) — ${c.usos} uso(s)${c.usosMaximos ? `/${c.usosMaximos}` : ''}`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Cupons**\n${txt}`));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhaVazia('Nenhum cupom cadastrado.')));
  }

  return container;
}

function construirMetas(guildId) {
  const progresso = engine.calcularProgressoMeta(guildId);
  const container = new ContainerBuilder().setAccentColor(CORES.PIX);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Meta de Faturamento'));
  container.addSeparatorComponents(separador(true));

  if (!progresso) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      linhaVazia('Nenhuma meta configurada. Vá em Configurações → Definir meta.')
    ));
    return container;
  }

  const barra = barraProgresso(progresso.percentual);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**${progresso.valorStr}**\n\n\`${barra}\` ${progresso.percentualReal.toFixed(0)}%\n\n${progresso.alcancadoStr} / ${progresso.valorStr}`
  ));
  container.addSeparatorComponents(separador(false));

  if (progresso.atingida) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Meta atingida.**'));
  } else if (progresso.expirada) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Período encerrado**\nFaltou ${progresso.restanteStr} pra atingir.`
    ));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Faltam** ${progresso.restanteStr}\n**Dias restantes:** ${progresso.diasRestantes}\n**Média necessária/dia:** ${progresso.mediaDiariaStr}`
    ));
  }

  return container;
}

function construirInsights(guildId, dias, config) {
  const vendas = engine.filtrarPorPeriodo(engine.carregarVendas(guildId), dias);
  const produtos = db.getProdutos(guildId);
  const recs = engine.gerarRecomendacoes({ guildId, minutosAbandono: config.minutosAbandono, vendas, produtos });
  const proximas = engine.proximasAcoes(recs, 3);

  const container = new ContainerBuilder().setAccentColor(CORES.ERRO);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Insights'));
  container.addSeparatorComponents(separador(true));

  const txtAcoes = proximas.map(r => `${r.prioridade} **${r.titulo}**`).join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**O que fazer agora**\n${txtAcoes}`));
  container.addSeparatorComponents(separador(false));

  const txtRecs = recs.map(r => `${r.prioridade} **${r.titulo}**\n${r.texto}`).join('\n\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(txtRecs.slice(0, 3900)));

  return container;
}

function construirConfig(config) {
  const container = new ContainerBuilder().setAccentColor(CORES.CINZA);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Configurações'));
  container.addSeparatorComponents(separador(true));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Recuperação de carrinho:** ${config.recuperacaoAtiva ? 'Ativa' : 'Desativada'}\n` +
    `**Tempo até abandono:** ${config.minutosAbandono} min\n` +
    `**Alertas automáticos:** ${config.alertasAtivo ? 'Ativos' : 'Desativados'}\n` +
    `**Canal de alertas:** ${config.canalRelatorioId ? `<#${config.canalRelatorioId}>` : 'Não configurado'}\n` +
    `**Meta:** ${config.meta ? `${floatParaPreco(config.meta.valor)} em ${config.meta.dias} dia(s)` : 'Nenhuma'}`
  ));
  container.addSeparatorComponents(separador(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    linhaVazia('Use os botões abaixo pra ajustar. As mudanças valem só pra este servidor.')
  ));

  return container;
}

function construirPagina(paginaId, guildId, dias, config) {
  if (paginaId === 'vendas') return construirVendas(guildId, dias);
  if (paginaId === 'carrinhos') return construirCarrinhos(guildId, dias);
  if (paginaId === 'produtos') return construirProdutos(guildId);
  if (paginaId === 'metas') return construirMetas(guildId);
  if (paginaId === 'insights') return construirInsights(guildId, dias, config);
  if (paginaId === 'config') return construirConfig(config);
  return construirGeral(guildId, dias);
}

function montarComponentes(pagina, guildId, dias, config, modoCanal) {
  const container = construirPagina(pagina, guildId, dias, config);
  if (pagina === 'config' && modoCanal) return [container, ...montarSelectCanal()];
  if (pagina === 'config') return [container, ...montarNavConfig(config), ...montarNav(pagina, null)];
  return [container, ...montarNav(pagina, PERIODOS.find(p => p.dias === dias)?.id || '30d')];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('insights')
    .setDescription('Kael Intelligence — painel de análise da loja')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if(!require("../utils/helpers").temPlanoMinimo(interaction.guild?.id, "PRO")) { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Adquira o plano Pro para usar este comando.")], ephemeral:true }); return; }
    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let pagina = 'geral';
    let periodo = '30d';
    let modoCanal = false;

    function diasAtual() {
      return PERIODOS.find(p => p.id === periodo)?.dias || 30;
    }

    let ultimoComponentes;
    try {
      const config = engine.getConfigIntelligence(guildId);
      ultimoComponentes = montarComponentes(pagina, guildId, diasAtual(), config, modoCanal);
    } catch (e) {
      console.error('[Insights][DIAGNOSTICO] Erro ao montar painel inicial:', e.stack || e);
      return interaction.editReply({ content: `${ICONE_ERRO} Não foi possível carregar os insights agora. Tente novamente em instantes.` });
    }

    const resposta = await interaction.editReply({
      components: ultimoComponentes,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });

    const collector = resposta.createMessageComponentCollector({ time: COLLECTOR_TIME });

    async function refrescar(i) {
      const config = engine.getConfigIntelligence(guildId);
      ultimoComponentes = montarComponentes(pagina, guildId, diasAtual(), config, modoCanal);
      await i.update({ components: ultimoComponentes });
    }

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: `${ICONE_ERRO} Só quem executou o comando pode interagir com este painel.`, flags: MessageFlags.Ephemeral });
      }

      try {
        if (i.customId === 'insights_pagina') {
          pagina = i.values[0];
          modoCanal = false;
          return await refrescar(i);
        }
        if (i.customId === 'insights_periodo') {
          periodo = i.values[0];
          return await refrescar(i);
        }
        if (i.customId === 'insights_cfg_recuperacao_toggle') {
          const config = engine.getConfigIntelligence(guildId);
          db.updateGuild(guildId, 'loja.intelligence', { ...config, recuperacaoAtiva: !config.recuperacaoAtiva });
          return await refrescar(i);
        }
        if (i.customId === 'insights_cfg_alertas_toggle') {
          const config = engine.getConfigIntelligence(guildId);
          db.updateGuild(guildId, 'loja.intelligence', { ...config, alertasAtivo: !config.alertasAtivo });
          return await refrescar(i);
        }
        if (i.customId === 'insights_cfg_canal_btn') {
          modoCanal = true;
          return await refrescar(i);
        }
        if (i.customId === 'insights_cfg_canal_select') {
          const config = engine.getConfigIntelligence(guildId);
          db.updateGuild(guildId, 'loja.intelligence', { ...config, canalRelatorioId: i.values[0] });
          modoCanal = false;
          return await refrescar(i);
        }

        if (i.customId === 'insights_cfg_recuperacao_modal') {
          const config = engine.getConfigIntelligence(guildId);
          const modal = new ModalBuilder().setCustomId('insights_modal_recuperacao').setTitle('Recuperação de carrinho');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('minutos').setLabel('Minutos até considerar abandonado (mín. 5)')
                .setStyle(TextInputStyle.Short).setValue(String(config.minutosAbandono)).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('mensagem').setLabel('Mensagem de recuperação (DM ao cliente)')
                .setStyle(TextInputStyle.Paragraph).setValue(config.mensagemRecuperacao.slice(0, 1000)).setRequired(true).setMaxLength(1000)
            ),
          );
          await i.showModal(modal);
          const submitted = await i.awaitModalSubmit({ time: MODAL_TIME, filter: (mi) => mi.user.id === interaction.user.id }).catch(() => null);
          if (!submitted) return;

          const minutos = parseInt(submitted.fields.getTextInputValue('minutos'), 10);
          if (isNaN(minutos) || minutos < 5) {
            return submitted.reply({ content: `${ICONE_ERRO} Minutos inválido — mínimo 5.`, flags: MessageFlags.Ephemeral });
          }
          const mensagem = submitted.fields.getTextInputValue('mensagem').slice(0, 1000);
          const configAtual = engine.getConfigIntelligence(guildId);
          db.updateGuild(guildId, 'loja.intelligence', { ...configAtual, minutosAbandono: minutos, mensagemRecuperacao: mensagem });

          const novaConfig = engine.getConfigIntelligence(guildId);
          ultimoComponentes = montarComponentes(pagina, guildId, diasAtual(), novaConfig, modoCanal);
          return await submitted.update({ components: ultimoComponentes });
        }

        if (i.customId === 'insights_cfg_meta_modal') {
          const modal = new ModalBuilder().setCustomId('insights_modal_meta').setTitle('Meta de faturamento');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('valor').setLabel('Valor da meta (ex: 500.00)')
                .setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('dias').setLabel('Duração em dias (ex: 30)')
                .setStyle(TextInputStyle.Short).setRequired(true)
            ),
          );
          await i.showModal(modal);
          const submitted = await i.awaitModalSubmit({ time: MODAL_TIME, filter: (mi) => mi.user.id === interaction.user.id }).catch(() => null);
          if (!submitted) return;

          const valor = parseFloat(submitted.fields.getTextInputValue('valor').replace(',', '.'));
          const dias = parseInt(submitted.fields.getTextInputValue('dias'), 10);
          if (isNaN(valor) || valor <= 0 || isNaN(dias) || dias < 1) {
            return submitted.reply({ content: `${ICONE_ERRO} Valor ou dias inválido.`, flags: MessageFlags.Ephemeral });
          }
          const configAtual = engine.getConfigIntelligence(guildId);
          db.updateGuild(guildId, 'loja.intelligence', { ...configAtual, meta: { valor, dias, criadaEm: new Date().toISOString() } });

          const novaConfig = engine.getConfigIntelligence(guildId);
          ultimoComponentes = montarComponentes(pagina, guildId, diasAtual(), novaConfig, modoCanal);
          return await submitted.update({ components: ultimoComponentes });
        }
      } catch (e) {
        console.error('[Insights][DIAGNOSTICO] Erro ao processar interação do painel:', e.stack || e);
        await i.reply({ content: `${ICONE_ERRO} Erro ao processar essa ação. Tente novamente.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });

    collector.on('end', () => {
      const selectDesativado = new StringSelectMenuBuilder()
        .setCustomId('insights_pagina_fim')
        .setPlaceholder('Painel expirado — rode /insights de novo')
        .setDisabled(true)
        .addOptions([{ label: 'Painel expirado', value: 'expirado' }]);
      const linha = new ActionRowBuilder().addComponents(selectDesativado);
      interaction.editReply({ components: [ultimoComponentes[0], linha] }).catch(() => {});
    });
  },
};
