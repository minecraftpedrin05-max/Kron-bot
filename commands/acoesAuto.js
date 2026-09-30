/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Ações Automáticas (Painel)
 *  Reescrita fiel do AcoesAutomaticas.py (NX7 VENDAS / Ease Pro)
 *
 *  Acionado por: botão 'painel_sorteios' NO PAINEL (temporário)
 *  ou botão dedicado 'painel_acoes_auto'
 *
 *  Seções:
 *   • Repostagem      — repostar vitrine automaticamente
 *   • Limpeza         — limpar canais automaticamente
 *   • Mensagens       — enviar mensagens automáticas
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db = require('../database/db');
const { aplicarSistema, getAcoes } = require('../handlers/scheduler');

// ── Helpers ──────────────────────────────────────────────────────

function fmtSistema(ativo) {
  return ativo ? '<:positivo:1528401238197276702> `Habilitado`' : '<:negativo:1528400986744295475> `Desabilitado`';
}

function fmtDelay(delay) {
  return delay ? `<:positivo:1528401238197276702> \`${delay} minutos\`` : '<:negativo:1528400986744295475> `Não definido`';
}

function fmtCanais(guild, canais) {
  if (!canais || canais.length === 0) return '<:negativo:1528400986744295475> `Não definido`';
  return canais.map(id => {
    const c = guild.channels.cache.get(id);
    return c ? `<#${id}>` : '<:negativo:1528400986744295475> `Canal não encontrado`';
  }).join('\n');
}

function fmtContent(content) {
  return content ? `\`\`\`${content.slice(0, 200)}\`\`\`` : '<:negativo:1528400986744295475> `Não definido`';
}

function saveAcoes(guildId, acoes) {
  db.updateGuild(guildId, 'loja.acoesAuto', acoes);
}

// ── PAINEL INICIAL ───────────────────────────────────────────────

async function abrirAcoesAuto(interaction) {
  const nome = interaction.user.displayName || interaction.user.username;
  return interaction.reply({
    content: `**${nome}**, escolha uma ação para configurar:`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('AcessarRepostagemAcoesAuto').setLabel('Repostagem') .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('AcessarLimpezaAcoesAuto')   .setLabel('Limpeza')    .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('AcessarMensagensAcoesAuto') .setLabel('Mensagens')  .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('AcoesAutoVoltar').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: 64,
  });
}

// ── PAINEL REPOSTAGEM ────────────────────────────────────────────

function buildRepostagemEmbed(interaction, acoes) {
  const cfg  = acoes.repostagem || { sistema: false, delay: 180 };
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Repostagem | Ações Automáticas')
    .setDescription(
      'Seu bot vai repostar sua vitrine periodicamente, apagando a mensagem antiga e ' +
      'enviando-a novamente, para evitar que ela fique soterrada no canal.'
    )
    .addFields(
      { name: 'Sistema', value: fmtSistema(cfg.sistema), inline: true  },
      { name: 'Delay',   value: fmtDelay(cfg.delay),     inline: true  },
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildRepostagemComponents(ativo) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('AtivarDesativarSistemaAcoesAuto_repostagem')
        .setLabel(ativo ? 'Desabilitar' : 'Habilitar')
        .setStyle(ativo ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ConfigurarSistemaRepostagem')
        .setLabel('Configurar')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('GerenciarAcoesAutomaticas')
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── PAINEL LIMPEZA ───────────────────────────────────────────────

function buildLimpezaEmbed(interaction, acoes) {
  const cfg  = acoes.limpeza || { sistema: false, canais: [], delay: 60 };
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Limpeza | Ações Automáticas')
    .setDescription('Seu bot realizará a limpeza automática das mensagens nos canais selecionados, conforme o delay estabelecido.')
    .addFields(
      { name: 'Sistema', value: fmtSistema(cfg.sistema),                         inline: true  },
      { name: 'Delay',   value: fmtDelay(cfg.delay),                             inline: true  },
      { name: 'Canais',  value: fmtCanais(interaction.guild, cfg.canais || []),  inline: false },
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildLimpezaComponents(ativo) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('AtivarDesativarSistemaAcoesAuto_limpeza')
        .setLabel(ativo ? 'Desabilitar' : 'Habilitar')
        .setStyle(ativo ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ConfigurarSistemaLimpeza')
        .setLabel('Configurar')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('GerenciarAcoesAutomaticas')
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── PAINEL MENSAGENS ─────────────────────────────────────────────

function buildMensagensEmbed(interaction, acoes) {
  const cfg  = acoes.mensagens || { sistema: false, canais: [], delay: 30, content: '' };
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Mensagens | Ações Automáticas')
    .setDescription('Seu bot enviará mensagens automaticamente nos intervalos e nos canais que você pré-definir.')
    .addFields(
      { name: 'Sistema',   value: fmtSistema(cfg.sistema),                         inline: true  },
      { name: 'Delay',     value: fmtDelay(cfg.delay),                             inline: true  },
      { name: 'Canais',    value: fmtCanais(interaction.guild, cfg.canais || []),  inline: false },
      { name: 'Conteúdo',  value: fmtContent(cfg.content),                        inline: false },
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildMensagensComponents(ativo) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('AtivarDesativarSistemaAcoesAuto_mensagens')
        .setLabel(ativo ? 'Desabilitar' : 'Habilitar')
        .setStyle(ativo ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ConfigurarSistemaMensagens')
        .setLabel('Configurar')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('GerenciarAcoesAutomaticas')
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── MODAIS ───────────────────────────────────────────────────────

function buildModalRepostagem(acoes) {
  const cfg = acoes.repostagem || { delay: 180 };
  const modal = new ModalBuilder().setCustomId('AcoesModal_Repostagem').setTitle('Configurar Repostagem');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('delay')
        .setLabel('Delay da repostagem (em minutos)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 180')
        .setValue(String(cfg.delay || '180'))
        .setRequired(true)
    ),
  );
  return modal;
}

function buildModalLimpeza(acoes) {
  const cfg = acoes.limpeza || { canais: [], delay: 60 };
  const modal = new ModalBuilder().setCustomId('AcoesModal_Limpeza').setTitle('Configurar Limpeza');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('idscanais')
        .setLabel('IDs dos canais para limpar (1 por linha)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Deixe em branco para desativar')
        .setValue((cfg.canais || []).join('\n'))
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('delay')
        .setLabel('Delay da limpeza (em minutos)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 60')
        .setValue(String(cfg.delay || '60'))
        .setRequired(false)
    ),
  );
  return modal;
}

function buildModalMensagens(acoes) {
  const cfg = acoes.mensagens || { canais: [], delay: 30, content: '' };
  const modal = new ModalBuilder().setCustomId('AcoesModal_Mensagens').setTitle('Configurar Mensagens Automáticas');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('idscanais')
        .setLabel('IDs dos canais (1 por linha)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Deixe em branco para desativar')
        .setValue((cfg.canais || []).join('\n'))
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('delay')
        .setLabel('Delay das mensagens (em minutos)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 30')
        .setValue(String(cfg.delay || '30'))
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Conteúdo da mensagem automática')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Texto que será enviado automaticamente')
        .setValue(cfg.content || '')
        .setRequired(false)
    ),
  );
  return modal;
}

// ── HANDLER DE BOTÕES ─────────────────────────────────────────────

async function handleButton(interaction) {
  const id    = interaction.customId;
  const guildId = interaction.guildId;

  // Voltar ao /painel
  if (id === 'AcoesAutoVoltar') {
    // BUGFIX: a mensagem atual NAO e Components V2 (e a ephemeral aberta por
    // este modulo, com content/embed). Editar direto pro /painel (V2) sem
    // limpar content/embeds da erro 50035. voltarParaPainel() limpa os campos
    // antigos e, se falhar, abre o /painel numa mensagem nova.
    const { voltarParaPainel } = require('../commands/painel');
    return voltarParaPainel(interaction);
  }

  // Voltar ao painel de ações automáticas
  if (id === 'GerenciarAcoesAutomaticas') {
    return interaction.update({
      content: 'Escolha uma ação para configurar:',
      embeds: [],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('AcessarRepostagemAcoesAuto').setLabel('Repostagem').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('AcessarLimpezaAcoesAuto')   .setLabel('Limpeza')   .setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('AcessarMensagensAcoesAuto') .setLabel('Mensagens') .setStyle(ButtonStyle.Primary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('AcoesAutoVoltar').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  // Abrir painel de cada sistema
  if (id === 'AcessarRepostagemAcoesAuto') {
    const acoes = getAcoes(guildId);
    return interaction.update({ content: null, embeds: [buildRepostagemEmbed(interaction, acoes)], components: buildRepostagemComponents(acoes.repostagem?.sistema) });
  }
  if (id === 'AcessarLimpezaAcoesAuto') {
    const acoes = getAcoes(guildId);
    return interaction.update({ content: null, embeds: [buildLimpezaEmbed(interaction, acoes)], components: buildLimpezaComponents(acoes.limpeza?.sistema) });
  }
  if (id === 'AcessarMensagensAcoesAuto') {
    const acoes = getAcoes(guildId);
    return interaction.update({ content: null, embeds: [buildMensagensEmbed(interaction, acoes)], components: buildMensagensComponents(acoes.mensagens?.sistema) });
  }

  // Abrir modais de configuração
  if (id === 'ConfigurarSistemaRepostagem') return interaction.showModal(buildModalRepostagem(getAcoes(guildId)));
  if (id === 'ConfigurarSistemaLimpeza')    return interaction.showModal(buildModalLimpeza(getAcoes(guildId)));
  if (id === 'ConfigurarSistemaMensagens')  return interaction.showModal(buildModalMensagens(getAcoes(guildId)));

  // Habilitar / Desabilitar sistema
  if (id.startsWith('AtivarDesativarSistemaAcoesAuto_')) {
    const sistema = id.replace('AtivarDesativarSistemaAcoesAuto_', '');
    const acoes   = getAcoes(guildId);
    if (!acoes[sistema]) acoes[sistema] = {};
    acoes[sistema].sistema = !acoes[sistema].sistema;
    saveAcoes(guildId, acoes);

    // Aplica/para o timer no scheduler
    aplicarSistema(interaction.client, guildId, sistema);

    if (sistema === 'repostagem') return interaction.update({ embeds: [buildRepostagemEmbed(interaction, acoes)], components: buildRepostagemComponents(acoes.repostagem.sistema) });
    if (sistema === 'limpeza')    return interaction.update({ embeds: [buildLimpezaEmbed(interaction, acoes)],    components: buildLimpezaComponents(acoes.limpeza.sistema)       });
    if (sistema === 'mensagens')  return interaction.update({ embeds: [buildMensagensEmbed(interaction, acoes)],  components: buildMensagensComponents(acoes.mensagens.sistema)   });
  }
}

// ── HANDLER DE MODAIS ─────────────────────────────────────────────

async function handleModal(interaction) {
  const id      = interaction.customId;
  const guildId = interaction.guildId;

  // Modal Repostagem
  if (id === 'AcoesModal_Repostagem') {
    const delayStr = interaction.fields.getTextInputValue('delay').trim();
    const delay    = parseInt(delayStr, 10);

    if (isNaN(delay) || delay < 1) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Delay inválido. Digite um número de minutos maior que 0.', flags: 64 });
    }

    const acoes = getAcoes(guildId);
    if (!acoes.repostagem) acoes.repostagem = { sistema: false };
    acoes.repostagem.delay = delay;
    saveAcoes(guildId, acoes);

    // Reinicia o timer com o novo delay se estiver ativo
    if (acoes.repostagem.sistema) aplicarSistema(interaction.client, guildId, 'repostagem');

    return interaction.reply({ content: `<:positivo:1528401238197276702> Repostagem configurada: a cada **${delay} minutos**.`, flags: 64 });
  }

  // Modal Limpeza
  if (id === 'AcoesModal_Limpeza') {
    const canaisStr = interaction.fields.getTextInputValue('idscanais').trim();
    const delayStr  = interaction.fields.getTextInputValue('delay').trim();

    const delay = delayStr ? parseInt(delayStr, 10) : null;
    if (delayStr && (isNaN(delay) || delay < 1)) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Delay inválido. Digite um número de minutos.', flags: 64 });
    }

    const canais = canaisStr
      ? canaisStr.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    const acoes = getAcoes(guildId);
    if (!acoes.limpeza) acoes.limpeza = { sistema: false };
    acoes.limpeza.canais = canais;
    if (delay) acoes.limpeza.delay = delay;
    saveAcoes(guildId, acoes);

    if (acoes.limpeza.sistema) aplicarSistema(interaction.client, guildId, 'limpeza');

    return interaction.reply({ content: `<:positivo:1528401238197276702> Limpeza configurada: ${canais.length} canal(is)${delay ? `, a cada ${delay} minutos` : ''}.`, flags: 64 });
  }

  // Modal Mensagens
  if (id === 'AcoesModal_Mensagens') {
    const canaisStr = interaction.fields.getTextInputValue('idscanais').trim();
    const delayStr  = interaction.fields.getTextInputValue('delay').trim();
    const content   = interaction.fields.getTextInputValue('content').trim();

    const delay = delayStr ? parseInt(delayStr, 10) : null;
    if (delayStr && (isNaN(delay) || delay < 1)) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Delay inválido. Digite um número de minutos.', flags: 64 });
    }

    const canais = canaisStr
      ? canaisStr.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    const acoes = getAcoes(guildId);
    if (!acoes.mensagens) acoes.mensagens = { sistema: false };
    acoes.mensagens.canais  = canais;
    acoes.mensagens.content = content;
    if (delay) acoes.mensagens.delay = delay;
    saveAcoes(guildId, acoes);

    if (acoes.mensagens.sistema) aplicarSistema(interaction.client, guildId, 'mensagens');

    return interaction.reply({ content: `<:positivo:1528401238197276702> Mensagens automáticas configuradas: ${canais.length} canal(is)${delay ? `, a cada ${delay} minutos` : ''}.`, flags: 64 });
  }
}

// ─────────────────────────────────────────────────────────────────
module.exports = { abrirAcoesAuto, handleButton, handleModal };
