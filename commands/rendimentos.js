/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Rendimentos
 *  Reescrita fiel do Rendimentos.py (NX7 VENDAS / Ease Pro)
 *  + botão Voltar ao painel
 *
 *  Acionado por: botão 'painel_rendimentos' no /painel
 * ─────────────────────────────────────────────────────────────────
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db = require('../database/db');

// ── Mapas de período ─────────────────────────────────────────────

const PERIODO_TITULOS = {
  hoje:           'Painel de Rendimento Geral - **Hoje**',
  ultimos_7_dias: 'Painel de Rendimento Geral - **Últimos 7 Dias**',
  ultimo_mes:     'Painel de Rendimento Geral - **Último Mês**',
  total:          'Painel de Rendimento Geral - **Total**',
};

const PERIODO_MAP = {
  VisualizarRendimentoHoje:        'hoje',
  VisualizarRendimentoUltimos7Dias:'ultimos_7_dias',
  VisualizarRendimentoUltimoMes:   'ultimo_mes',
  VisualizarRendimentoTotal:       'total',
};

// ── Calcular rendimentos ─────────────────────────────────────────

function calcularRendimentos(historico, periodo = 'total') {
  let totalVendas            = 0;
  let totalGanho             = 0.0;
  let totalProdutosEntregues = 0;

  const agora = new Date();
  let dataInicial = null;

  if (periodo === 'hoje') {
    dataInicial = new Date(agora);
    dataInicial.setHours(0, 0, 0, 0);
  } else if (periodo === 'ultimos_7_dias') {
    dataInicial = new Date(agora);
    dataInicial.setDate(dataInicial.getDate() - 7);
  } else if (periodo === 'ultimo_mes') {
    const primeiroDiaMesAtual  = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const ultimoDiaMesAnterior = new Date(primeiroDiaMesAtual - 1);
    dataInicial = new Date(ultimoDiaMesAnterior.getFullYear(), ultimoDiaMesAnterior.getMonth(), 1);
  }

  for (const r of historico) {
    if (!r || !r.dataISO) continue;
    try {
      const horarioVenda = new Date(r.dataISO);
      if (isNaN(horarioVenda.getTime())) continue;
      if (dataInicial && horarioVenda < dataInicial) continue;

      const quantidade = r.quantidade || 0;
      const valorLimpo = String(r.valor || '0').replace(/[^\d,\.]/g, '').replace(',', '.');
      const valor      = parseFloat(valorLimpo) || 0.0;

      totalVendas            += 1;
      totalGanho             += quantidade * valor;
      totalProdutosEntregues += quantidade;
    } catch (e) {
      console.error(`[Rendimentos] Erro ao processar registro: ${e.message}`);
    }
  }

  return { totalVendas, totalGanho, totalProdutosEntregues };
}

// ── Gerar embed ──────────────────────────────────────────────────

function gerarEmbedRendimentos(periodo, resultados) {
  const { totalVendas, totalGanho, totalProdutosEntregues } = resultados;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setDescription(PERIODO_TITULOS[periodo] || periodo)
    .addFields(
      { name: 'Total de Vendas',              value: `\`${totalVendas}\``,                        inline: true  },
      { name: 'Valor Total Ganho',            value: `\`R$${totalGanho.toFixed(2)}\``,            inline: true  },
      { name: 'Total de Produtos Entregues',  value: `\`${totalProdutosEntregues}\``,             inline: false },
    )
    .setFooter({ text: 'Configuração do BOT' })
    .setTimestamp();
}

// ── Gerar componentes (botões de filtro + Voltar) ────────────────

function gerarComponentesRendimentos() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('VisualizarRendimentoHoje')        .setLabel('Hoje')           .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('VisualizarRendimentoUltimos7Dias').setLabel('Últimos 7 Dias') .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('VisualizarRendimentoUltimoMes')   .setLabel('Último Mês')     .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('VisualizarRendimentoTotal')        .setLabel('Total')          .setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('RendimentosVoltar').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Abrir rendimentos ────────────────────────────────────────────

async function abrirRendimentos(interaction) {
  const nome = interaction.user.displayName || interaction.user.username;
  return interaction.reply({
    content: `Senhor(a) **${nome}**, selecione algum filtro abaixo.`,
    components: gerarComponentesRendimentos(),
    flags: 64,
  });
}

// ── Handler de botões ────────────────────────────────────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  // Voltar ao /painel
  if (id === 'RendimentosVoltar') {
    // BUGFIX: a mensagem atual NAO e Components V2 (e a ephemeral aberta por
    // este modulo, com content/embed). Editar direto pro /painel (V2) sem
    // limpar content/embeds da erro 50035. voltarParaPainel() limpa os campos
    // antigos e, se falhar, abre o /painel numa mensagem nova.
    const { voltarParaPainel } = require('../commands/painel');
    return voltarParaPainel(interaction);
  }

  if (!PERIODO_MAP[id]) return;

  const periodo    = PERIODO_MAP[id];
  const loja       = db.getGuild(interaction.guildId).loja || {};
  const historico  = loja.historicoCompras || [];
  const resultados = calcularRendimentos(historico, periodo);
  const embed      = gerarEmbedRendimentos(periodo, resultados);
  const components = gerarComponentesRendimentos();

  return interaction.update({ content: '', embeds: [embed], components });
}

// ─────────────────────────────────────────────────────────────────
module.exports = { abrirRendimentos, handleButton };
