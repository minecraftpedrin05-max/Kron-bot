// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteSetupUI.js
//
// KAEL INVITE SYSTEM — Parte 2: painel administrativo (/invite setup).
//
// Seções deste arquivo (núcleo): Aparência, Botões, Convites, Anti-Fraude,
// Notificações. Recompensas e Campanhas são adicionadas pelo bloco 3
// (invite-system/inviteAdminCRUD.js), que se registra chamando
// registerSectionRenderer() — este arquivo nunca precisa ser reescrito
// para isso.
//
// Todo botão/seleção/modal daqui é checado quanto a permissão de
// Administrator antes de qualquer alteração, mesmo a mensagem sendo
// ephemeral.
// ═══════════════════════════════════════════════════════════════════════

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { CORES } = require('../config/constants');
const invitePanel = require('./invitePanel');

const SECOES = [
  { value: 'aparencia', label: 'Aparência', emoji: '🎨', descricao: 'Título, descrição, cor, imagens e textos do painel' },
  { value: 'publicar', label: 'Publicar', emoji: '📤', descricao: 'Selecionar canal, pré-visualizar e publicar/atualizar o painel público' },
  { value: 'botoes', label: 'Botões', emoji: '🔘', descricao: 'Ativar/desativar, renomear e trocar emoji' },
  { value: 'convites', label: 'Convites', emoji: '🔗', descricao: 'Regras de contagem do sistema' },
  { value: 'recompensas', label: 'Recompensas', emoji: '🎁', descricao: 'Criar, editar, excluir recompensas' },
  { value: 'ranking', label: 'Ranking', emoji: '🏆', descricao: 'Pré-visualização do ranking atual' },
  { value: 'campanhas', label: 'Campanhas', emoji: '🗓️', descricao: 'Criar, ativar e encerrar campanhas' },
  { value: 'antifraude', label: 'Anti-Fraude', emoji: '🛡️', descricao: 'Regras de detecção de contas suspeitas' },
  { value: 'notificacoes', label: 'Notificações', emoji: '📢', descricao: 'Canal e mensagens automáticas' },
];

// Seções cujo render fica em outro arquivo (registrado em runtime). Evita
// que este arquivo precise ser reescrito quando o bloco 3 for aplicado.
const renderersExternos = {};
const modalHandlersExternos = [];
const buttonHandlersExternos = [];
const selectHandlersExternos = [];
function registerSectionRenderer(secao, fn) { renderersExternos[secao] = fn; }
function registerModalHandler(prefixoCustomId, fn) { modalHandlersExternos.push({ prefixo: prefixoCustomId, fn }); }
function registerButtonHandler(prefixoCustomId, fn) { buttonHandlersExternos.push({ prefixo: prefixoCustomId, fn }); }
function registerSelectHandler(customId, fn) { selectHandlersExternos.push({ id: customId, fn }); }

function checarAdmin(interaction) {
  return !!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function on(bool) { return bool ? '✅ Ativado' : '❌ Desativado'; }

// ─────────────────────────────────────────────────────────────────────
// MENU PRINCIPAL
// ─────────────────────────────────────────────────────────────────────
function buildMainMenuEmbed(guild) {
  return new EmbedBuilder()
    .setColor(CORES.PRIMARIA)
    .setTitle('⚙️ Kael Invite System — Painel Administrativo')
    .setDescription('Selecione uma seção abaixo para configurar.\n\nNenhuma alteração aqui afeta o histórico já registrado.')
    .setImage(require('../utils/assets').assetUrl('kael-banner.png'))
    .setFooter({ text: guild.name });
}

function buildMainMenuRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('invite_setup_menu')
    .setPlaceholder('Selecione uma seção...')
    .addOptions(SECOES.map(s => new StringSelectMenuOptionBuilder().setLabel(s.label).setValue(s.value).setEmoji(s.emoji).setDescription(s.descricao)));
  return [new ActionRowBuilder().addComponents(select)];
}

function buildBackRow(extra = []) {
  const voltar = new ButtonBuilder().setCustomId('invite_setup_back').setLabel('Voltar ao menu').setEmoji('◀️').setStyle(ButtonStyle.Secondary);
  return [...extra, new ActionRowBuilder().addComponents(voltar)];
}

// ─────────────────────────────────────────────────────────────────────
// APARÊNCIA
// ─────────────────────────────────────────────────────────────────────
function renderAparencia(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const ec = config.embedConfig || {};
  const embed = new EmbedBuilder()
    .setColor(typeof ec.color === 'number' ? ec.color : CORES.INFO)
    .setTitle('🎨 Aparência do painel')
    .setDescription(
      `**Título:** ${ec.title || '_padrão_'}\n` +
      `**Descrição:** ${ec.description ? '_personalizada_' : '_padrão (com lista de recompensas dinâmica)_'}\n` +
      `**Cor:** ${typeof ec.color === 'number' ? '#' + ec.color.toString(16).padStart(6, '0') : '_padrão_'}\n` +
      `**Imagem:** ${ec.image ? '_definida_' : '_nenhuma_'}\n` +
      `**Thumbnail:** ${ec.thumbnail ? '_definida_' : '_nenhuma_'}\n` +
      `**Autor:** ${ec.author || '_nenhum_'}\n` +
      `**Footer:** ${ec.footer || '_nome do servidor_'}`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_setup_aparencia_texto').setLabel('Editar textos').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('invite_setup_aparencia_visual').setLabel('Editar cor/imagens').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('invite_setup_aparencia_reset').setLabel('Restaurar padrão').setEmoji('♻️').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: buildBackRow([row]) };
}

function modalAparenciaTexto(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const ec = config.embedConfig || {};
  const modal = new ModalBuilder().setCustomId('invite_modal_aparencia_texto').setTitle('Aparência — Textos');
  const titulo = new TextInputBuilder().setCustomId('titulo').setLabel('Título do painel').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue((ec.title || '').slice(0, 256));
  const desc = new TextInputBuilder().setCustomId('descricao').setLabel('Descrição (use {nextReward} {progress} etc.)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3500).setValue((ec.description || '').slice(0, 3500));
  const footer = new TextInputBuilder().setCustomId('footer').setLabel('Footer').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue((ec.footer || '').slice(0, 256));
  modal.addComponents(
    new ActionRowBuilder().addComponents(titulo),
    new ActionRowBuilder().addComponents(desc),
    new ActionRowBuilder().addComponents(footer),
  );
  return modal;
}

function modalAparenciaVisual(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const ec = config.embedConfig || {};
  const modal = new ModalBuilder().setCustomId('invite_modal_aparencia_visual').setTitle('Aparência — Cor e imagens');
  const cor = new TextInputBuilder().setCustomId('cor').setLabel('Cor (hex, ex: #5865F2)').setStyle(TextInputStyle.Short).setRequired(false)
    .setValue(typeof ec.color === 'number' ? '#' + ec.color.toString(16).padStart(6, '0') : '');
  const imagem = new TextInputBuilder().setCustomId('imagem').setLabel('URL da imagem/banner').setStyle(TextInputStyle.Short).setRequired(false).setValue(ec.image || '');
  const thumb = new TextInputBuilder().setCustomId('thumbnail').setLabel('URL da thumbnail').setStyle(TextInputStyle.Short).setRequired(false).setValue(ec.thumbnail || '');
  const autor = new TextInputBuilder().setCustomId('autor').setLabel('Nome do autor do embed').setStyle(TextInputStyle.Short).setRequired(false).setValue(ec.author || '');
  const autorIcon = new TextInputBuilder().setCustomId('autor_icon').setLabel('URL do ícone do autor').setStyle(TextInputStyle.Short).setRequired(false).setValue(ec.authorIcon || '');
  modal.addComponents(
    new ActionRowBuilder().addComponents(cor),
    new ActionRowBuilder().addComponents(imagem),
    new ActionRowBuilder().addComponents(thumb),
    new ActionRowBuilder().addComponents(autor),
    new ActionRowBuilder().addComponents(autorIcon),
  );
  return modal;
}

function validarUrl(v) {
  if (!v) return null;
  try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') ? v : null; } catch { return null; }
}

async function onSubmitAparenciaTexto(interaction) {
  const ec = inviteDb.getGuildConfig(interaction.guild.id).embedConfig || {};
  const titulo = interaction.fields.getTextInputValue('titulo').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim();
  const novo = { ...ec };
  if (titulo) novo.title = titulo; else delete novo.title;
  if (descricao) novo.description = descricao; else delete novo.description;
  if (footer) novo.footer = footer; else delete novo.footer;
  inviteDb.updateGuildConfig(interaction.guild.id, { embedConfig: novo });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderAparencia(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSubmitAparenciaVisual(interaction) {
  const ec = inviteDb.getGuildConfig(interaction.guild.id).embedConfig || {};
  const corTexto = interaction.fields.getTextInputValue('cor').trim().replace('#', '');
  const imagem = validarUrl(interaction.fields.getTextInputValue('imagem').trim());
  const thumb = validarUrl(interaction.fields.getTextInputValue('thumbnail').trim());
  const autor = interaction.fields.getTextInputValue('autor').trim();
  const autorIcon = validarUrl(interaction.fields.getTextInputValue('autor_icon').trim());

  const novo = { ...ec };
  if (corTexto) {
    const num = parseInt(corTexto, 16);
    if (!Number.isNaN(num)) novo.color = num;
  } else delete novo.color;
  if (imagem) novo.image = imagem; else delete novo.image;
  if (thumb) novo.thumbnail = thumb; else delete novo.thumbnail;
  if (autor) novo.author = autor; else delete novo.author;
  if (autorIcon) novo.authorIcon = autorIcon; else delete novo.authorIcon;

  inviteDb.updateGuildConfig(interaction.guild.id, { embedConfig: novo });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderAparencia(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// PUBLICAR (seleção de canal + pré-visualização + publicar/atualizar)
// ─────────────────────────────────────────────────────────────────────
function renderPublicar(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const canalAtual = (config.panelChannelId && config.panelMessageId) ? `<#${config.panelChannelId}>` : null;
  const canalSelecionado = config.publishChannelId ? `<#${config.publishChannelId}>` : null;
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('📤 Publicar painel público')
    .setDescription(
      `**Status atual:** ${canalAtual ? `publicado em ${canalAtual}` : '_ainda não publicado_'}\n` +
      `**Canal selecionado para publicar:** ${canalSelecionado || '_nenhum — escolha abaixo_'}\n\n` +
      'Escolha o canal, clique em **Visualizar** para conferir como vai ficar (só você vê) e depois em **Publicar/Atualizar** para enviar de verdade.'
    );
  const canalSelect = new ChannelSelectMenuBuilder().setCustomId('invite_setup_publicar_canal').setPlaceholder('Selecionar canal de publicação').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const row1 = new ActionRowBuilder().addComponents(canalSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_setup_publicar_preview').setLabel('Visualizar').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_setup_publicar_confirmar').setLabel(canalAtual ? 'Atualizar painel' : 'Publicar painel').setEmoji('📤').setStyle(ButtonStyle.Success).setDisabled(!canalSelecionado && !canalAtual),
  );
  return { embeds: [embed], components: buildBackRow([row1, row2]) };
}

async function onSelectPublicarCanal(interaction) {
  const canalId = interaction.values[0];
  inviteDb.updateGuildConfig(interaction.guild.id, { publishChannelId: canalId });
  const { embeds, components } = renderPublicar(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onPreviewPublicar(interaction) {
  const embedPreview = invitePanel.buildPanelEmbed(interaction.guild);
  const rowOriginal = invitePanel.buildPanelRow(interaction.guild.id);
  const rowDesativada = new ActionRowBuilder().addComponents(
    rowOriginal.components.map(c => ButtonBuilder.from(c).setDisabled(true))
  );
  return interaction.reply({
    content: '👁️ **Pré-visualização** — só você está vendo isso. Os botões abaixo estão desativados nesta prévia.',
    embeds: [embedPreview],
    components: [rowDesativada],
    ephemeral: true,
  });
}

async function onConfirmarPublicar(interaction) {
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  const canalId = config.publishChannelId || config.panelChannelId;
  if (!canalId) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Selecione um canal antes de publicar.', ephemeral: true });
  }
  const canal = await interaction.guild.channels.fetch(canalId).catch(() => null);
  if (!canal || !canal.isTextBased?.()) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Não encontrei esse canal ou ele não é um canal de texto.', ephemeral: true });
  }
  try {
    const { created } = await invitePanel.deployOrUpdatePanel(interaction.guild, canal);
    const { embeds, components } = renderPublicar(interaction.guild);
    await interaction.update({ embeds, components });
    return interaction.followUp({
      content: created ? `<:positivo:1528401238197276702> Painel publicado em ${canal}.` : `<:positivo:1528401238197276702> Painel atualizado em ${canal}.`,
      ephemeral: true,
    });
  } catch (e) {
    console.error('[InviteSystem] Erro ao publicar painel (setup):', e);
    return interaction.reply({ content: '<:negativo:1528400986744295475> Não consegui publicar/atualizar o painel. Verifique minhas permissões nesse canal.', ephemeral: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// BOTÕES
// ─────────────────────────────────────────────────────────────────────
function renderBotoes(guild) {
  const cfg = invitePanel.getButtonsConfig(guild.id);
  const linhas = Object.entries(cfg).map(([chave, b]) => `${on(b.enabled)} — ${b.emoji || ''} **${b.label}** \`(${chave})\``);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🔘 Botões do painel público')
    .setDescription(linhas.join('\n'));

  const linhasComponentes = [];
  for (const chave of Object.keys(cfg)) {
    linhasComponentes.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`invite_setup_botao_toggle_${chave}`).setLabel(cfg[chave].enabled ? 'Desativar' : 'Ativar').setStyle(cfg[chave].enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`invite_setup_botao_editar_${chave}`).setLabel(`Editar "${cfg[chave].label}"`).setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [embed], components: buildBackRow(linhasComponentes) };
}

function modalEditarBotao(guild, chave) {
  const cfg = invitePanel.getButtonsConfig(guild.id)[chave];
  const modal = new ModalBuilder().setCustomId(`invite_modal_botao_${chave}`).setTitle(`Botão — ${invitePanel.BOTOES_PADRAO[chave]?.label || chave}`);
  const label = new TextInputBuilder().setCustomId('label').setLabel('Nome do botão').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(cfg.label || '');
  const emoji = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setValue(cfg.emoji || '');
  modal.addComponents(new ActionRowBuilder().addComponents(label), new ActionRowBuilder().addComponents(emoji));
  return modal;
}

async function onToggleBotao(interaction, chave) {
  if (!invitePanel.BOTOES_PADRAO[chave]) return interaction.deferUpdate();
  const atual = invitePanel.getButtonsConfig(interaction.guild.id);
  atual[chave].enabled = !atual[chave].enabled;
  inviteDb.updateGuildConfig(interaction.guild.id, { buttonsConfig: atual });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderBotoes(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSubmitEditarBotao(interaction, chave) {
  if (!invitePanel.BOTOES_PADRAO[chave]) return;
  const atual = invitePanel.getButtonsConfig(interaction.guild.id);
  const label = interaction.fields.getTextInputValue('label').trim();
  const emoji = interaction.fields.getTextInputValue('emoji').trim();
  atual[chave].label = label || invitePanel.BOTOES_PADRAO[chave].label;
  atual[chave].emoji = emoji || invitePanel.BOTOES_PADRAO[chave].emoji;
  inviteDb.updateGuildConfig(interaction.guild.id, { buttonsConfig: atual });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderBotoes(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// CONVITES
// ─────────────────────────────────────────────────────────────────────
function renderConvites(guild) {
  const c = inviteDb.getGuildConfig(guild.id);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🔗 Configuração de convites')
    .setDescription(
      `**Sistema ativo:** ${on(c.enabled)}\n` +
      `**Contar convites de bots:** ${on(c.countBots)}\n` +
      `**Contar convites após saída:** ${on(c.countAfterLeave)}\n` +
      `**Contar reentradas:** ${on(c.countRejoins)}`
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_setup_convites_toggle_enabled').setLabel(c.enabled ? 'Desativar sistema' : 'Ativar sistema').setStyle(c.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('invite_setup_convites_toggle_bots').setLabel('Bots').setStyle(c.countBots ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_setup_convites_toggle_leave').setLabel('Após saída').setStyle(c.countAfterLeave ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_setup_convites_toggle_rejoin').setLabel('Reentradas').setStyle(c.countRejoins ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: buildBackRow([row1]) };
}

async function onToggleConvites(interaction, campo) {
  const mapa = { enabled: 'enabled', bots: 'countBots', leave: 'countAfterLeave', rejoin: 'countRejoins' };
  const chave = mapa[campo];
  if (!chave) return interaction.deferUpdate();
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  inviteDb.updateGuildConfig(interaction.guild.id, { [chave]: !config[chave] });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderConvites(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// RANKING (pré-visualização)
// ─────────────────────────────────────────────────────────────────────
function renderRanking(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const top = inviteDb.getRanking(guild.id, config, 10);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🏆 Pré-visualização do ranking')
    .setDescription(top.length ? top.map(e => `**#${e.position}** — <@${e.userId}> — \`${e.count}\``).join('\n') : '_Ainda não há convites registrados._')
    .setFooter({ text: 'A paginação completa (◀️ ▶️) aparece no botão Ranking do painel público.' });
  return { embeds: [embed], components: buildBackRow([]) };
}

// ─────────────────────────────────────────────────────────────────────
// ANTI-FRAUDE
// ─────────────────────────────────────────────────────────────────────
function renderAntifraude(guild) {
  const c = inviteDb.getGuildConfig(guild.id);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🛡️ Anti-Fraude')
    .setDescription(
      `**Detecção ativa:** ${on(c.antiFraudEnabled)}\n` +
      `**Idade mínima de conta:** \`${c.antifraudMinAccountHours}h\`\n` +
      `**Limite de rajada (mesmo convite):** \`${c.antifraudBurstLimit}\` entradas/minuto\n` +
      `**Limite de reentradas suspeitas:** \`${c.antifraudRejoinLimit}\`\n\n` +
      `_O sistema nunca bane ou expulsa automaticamente — apenas marca como suspeito para revisão manual._`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_setup_af_toggle').setLabel(c.antiFraudEnabled ? 'Desativar detecção' : 'Ativar detecção').setStyle(c.antiFraudEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('invite_setup_af_limites').setLabel('Editar limites').setEmoji('✏️').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: buildBackRow([row]) };
}

function modalAfLimites(guild) {
  const c = inviteDb.getGuildConfig(guild.id);
  const modal = new ModalBuilder().setCustomId('invite_modal_af_limites').setTitle('Anti-Fraude — Limites');
  const horas = new TextInputBuilder().setCustomId('horas').setLabel('Idade mínima da conta (em horas)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(c.antifraudMinAccountHours));
  const rajada = new TextInputBuilder().setCustomId('rajada').setLabel('Limite de entradas/minuto (mesmo convite)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(c.antifraudBurstLimit));
  const reentradas = new TextInputBuilder().setCustomId('reentradas').setLabel('Limite de reentradas suspeitas').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(c.antifraudRejoinLimit));
  modal.addComponents(new ActionRowBuilder().addComponents(horas), new ActionRowBuilder().addComponents(rajada), new ActionRowBuilder().addComponents(reentradas));
  return modal;
}

function paraInteiro(v, min, max, padrao) {
  const n = parseInt(String(v).replace(/\D/g, ''), 10);
  if (Number.isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

async function onToggleAntifraude(interaction) {
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  inviteDb.updateGuildConfig(interaction.guild.id, { antiFraudEnabled: !config.antiFraudEnabled });
  const { embeds, components } = renderAntifraude(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSubmitAfLimites(interaction) {
  const horas = paraInteiro(interaction.fields.getTextInputValue('horas'), 0, 720, 72);
  const rajada = paraInteiro(interaction.fields.getTextInputValue('rajada'), 1, 100, 5);
  const reentradas = paraInteiro(interaction.fields.getTextInputValue('reentradas'), 1, 50, 2);
  inviteDb.updateGuildConfig(interaction.guild.id, {
    antifraudMinAccountHours: horas, antifraudBurstLimit: rajada, antifraudRejoinLimit: reentradas,
  });
  const { embeds, components } = renderAntifraude(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// NOTIFICAÇÕES
// ─────────────────────────────────────────────────────────────────────
function renderNotificacoes(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const nc = config.notificationsConfig || {};
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('📢 Notificações')
    .setDescription(
      `**Canal:** ${config.notificationChannelId ? `<#${config.notificationChannelId}>` : '_nenhum (desativado)_'}\n` +
      `**Novo convidado:** ${on(nc.joinEnabled !== false)}\n` +
      `**Recompensa desbloqueada:** ${on(nc.rewardEnabled !== false)}`
    );
  const canalSelect = new ChannelSelectMenuBuilder().setCustomId('invite_setup_notif_canal').setPlaceholder('Selecionar canal de notificações').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const row1 = new ActionRowBuilder().addComponents(canalSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_setup_notif_desativar_canal').setLabel('Remover canal').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('invite_setup_notif_toggle_join').setLabel('Novo convidado').setStyle(nc.joinEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_setup_notif_toggle_reward').setLabel('Recompensa').setStyle(nc.rewardEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_setup_notif_editar').setLabel('Editar textos').setEmoji('✏️').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: buildBackRow([row1, row2]) };
}

function modalNotifTextos(guild) {
  const { getNotifyConfig } = require('./inviteNotify');
  const nc = getNotifyConfig(guild.id);
  const modal = new ModalBuilder().setCustomId('invite_modal_notif_editar').setTitle('Notificações — Textos');
  const joinTitulo = new TextInputBuilder().setCustomId('join_titulo').setLabel('Título — novo convidado').setStyle(TextInputStyle.Short).setRequired(false).setValue(nc.joinTitle);
  const joinMsg = new TextInputBuilder().setCustomId('join_msg').setLabel('Mensagem — {inviter} {user} {invites}').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(nc.joinMessage);
  const rewardTitulo = new TextInputBuilder().setCustomId('reward_titulo').setLabel('Título — recompensa').setStyle(TextInputStyle.Short).setRequired(false).setValue(nc.rewardTitle);
  const rewardMsg = new TextInputBuilder().setCustomId('reward_msg').setLabel('Mensagem — {user} {requiredInvites} {reward}').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(nc.rewardMessage);
  modal.addComponents(
    new ActionRowBuilder().addComponents(joinTitulo),
    new ActionRowBuilder().addComponents(joinMsg),
    new ActionRowBuilder().addComponents(rewardTitulo),
    new ActionRowBuilder().addComponents(rewardMsg),
  );
  return modal;
}

async function onSelectCanalNotif(interaction) {
  const canalId = interaction.values[0];
  inviteDb.updateGuildConfig(interaction.guild.id, { notificationChannelId: canalId });
  const { embeds, components } = renderNotificacoes(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onDesativarCanalNotif(interaction) {
  inviteDb.updateGuildConfig(interaction.guild.id, { notificationChannelId: null });
  const { embeds, components } = renderNotificacoes(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onToggleNotif(interaction, tipo) {
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  const nc = { ...(config.notificationsConfig || {}) };
  const chave = tipo === 'join' ? 'joinEnabled' : 'rewardEnabled';
  nc[chave] = !(nc[chave] !== false);
  inviteDb.updateGuildConfig(interaction.guild.id, { notificationsConfig: nc });
  const { embeds, components } = renderNotificacoes(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSubmitNotifTextos(interaction) {
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  const nc = { ...(config.notificationsConfig || {}) };
  const jt = interaction.fields.getTextInputValue('join_titulo').trim();
  const jm = interaction.fields.getTextInputValue('join_msg').trim();
  const rt = interaction.fields.getTextInputValue('reward_titulo').trim();
  const rm = interaction.fields.getTextInputValue('reward_msg').trim();
  if (jt) nc.joinTitle = jt;
  if (jm) nc.joinMessage = jm;
  if (rt) nc.rewardTitle = rt;
  if (rm) nc.rewardMessage = rm;
  inviteDb.updateGuildConfig(interaction.guild.id, { notificationsConfig: nc });
  const { embeds, components } = renderNotificacoes(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// ROTEADOR PRINCIPAL — chamado pelo events/buttonHandler.js
// ─────────────────────────────────────────────────────────────────────
function renderSecao(secao, guild) {
  switch (secao) {
    case 'aparencia': return renderAparencia(guild);
    case 'publicar': return renderPublicar(guild);
    case 'botoes': return renderBotoes(guild);
    case 'convites': return renderConvites(guild);
    case 'ranking': return renderRanking(guild);
    case 'antifraude': return renderAntifraude(guild);
    case 'notificacoes': return renderNotificacoes(guild);
    default:
      if (renderersExternos[secao]) return renderersExternos[secao](guild);
      return { embeds: [new EmbedBuilder().setColor(CORES.AVISO).setTitle('Em breve').setDescription('Esta seção ainda não está disponível.')], components: buildBackRow([]) };
  }
}

async function handleInteraction(interaction) {
  if (!interaction.guild) return;
  if (!checarAdmin(interaction)) {
    const msg = { content: '<:negativo:1528400986744295475> Você precisa ser Administrator para usar o Invite System.', ephemeral: true };
    if (interaction.isRepliable()) return interaction.reply(msg).catch(() => {});
    return;
  }

  const customId = interaction.customId;

  try {
    // Menu principal
    if (customId === 'invite_setup_menu' && interaction.isStringSelectMenu()) {
      const secao = interaction.values[0];
      const { embeds, components } = renderSecao(secao, interaction.guild);
      return interaction.update({ embeds, components });
    }
    if (customId === 'invite_setup_back' && interaction.isButton()) {
      return interaction.update({ embeds: [buildMainMenuEmbed(interaction.guild)], components: buildMainMenuRow() });
    }

    // Aparência
    if (customId === 'invite_setup_aparencia_texto') return interaction.showModal(modalAparenciaTexto(interaction.guild));
    if (customId === 'invite_setup_aparencia_visual') return interaction.showModal(modalAparenciaVisual(interaction.guild));
    if (customId === 'invite_setup_aparencia_reset') {
      inviteDb.updateGuildConfig(interaction.guild.id, { embedConfig: {} });
      await invitePanel.refreshPanel(interaction.guild);
      const { embeds, components } = renderAparencia(interaction.guild);
      return interaction.update({ embeds, components });
    }
    if (customId === 'invite_modal_aparencia_texto') return onSubmitAparenciaTexto(interaction);
    if (customId === 'invite_modal_aparencia_visual') return onSubmitAparenciaVisual(interaction);

    // Botões
    if (customId.startsWith('invite_setup_botao_toggle_')) return onToggleBotao(interaction, customId.replace('invite_setup_botao_toggle_', ''));
    if (customId.startsWith('invite_setup_botao_editar_')) {
      const chave = customId.replace('invite_setup_botao_editar_', '');
      return interaction.showModal(modalEditarBotao(interaction.guild, chave));
    }
    if (customId.startsWith('invite_modal_botao_')) return onSubmitEditarBotao(interaction, customId.replace('invite_modal_botao_', ''));

    // Convites
    if (customId.startsWith('invite_setup_convites_toggle_')) return onToggleConvites(interaction, customId.replace('invite_setup_convites_toggle_', ''));

    // Anti-Fraude
    if (customId === 'invite_setup_af_toggle') return onToggleAntifraude(interaction);
    if (customId === 'invite_setup_af_limites') return interaction.showModal(modalAfLimites(interaction.guild));
    if (customId === 'invite_modal_af_limites') return onSubmitAfLimites(interaction);

    // Publicar
    if (customId === 'invite_setup_publicar_canal' && interaction.isChannelSelectMenu()) return onSelectPublicarCanal(interaction);
    if (customId === 'invite_setup_publicar_preview' && interaction.isButton()) return onPreviewPublicar(interaction);
    if (customId === 'invite_setup_publicar_confirmar' && interaction.isButton()) return onConfirmarPublicar(interaction);

    // Notificações
    if (customId === 'invite_setup_notif_canal' && interaction.isChannelSelectMenu()) return onSelectCanalNotif(interaction);
    if (customId === 'invite_setup_notif_desativar_canal') return onDesativarCanalNotif(interaction);
    if (customId === 'invite_setup_notif_toggle_join') return onToggleNotif(interaction, 'join');
    if (customId === 'invite_setup_notif_toggle_reward') return onToggleNotif(interaction, 'reward');
    if (customId === 'invite_setup_notif_editar') return interaction.showModal(modalNotifTextos(interaction.guild));
    if (customId === 'invite_modal_notif_editar') return onSubmitNotifTextos(interaction);

    // Handlers registrados externamente (recompensas/campanhas — bloco 3)
    for (const { prefixo, fn } of buttonHandlersExternos) {
      if (customId.startsWith(prefixo) && (interaction.isButton())) return fn(interaction);
    }
    for (const { prefixo, fn } of modalHandlersExternos) {
      if (customId.startsWith(prefixo) && interaction.isModalSubmit()) return fn(interaction);
    }
    for (const { id, fn } of selectHandlersExternos) {
      if (customId === id && interaction.isAnySelectMenu()) return fn(interaction);
    }
  } catch (e) {
    console.error('[InviteSystem] Erro no painel administrativo:', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '<:negativo:1528400986744295475> Ocorreu um erro ao processar essa ação do setup.', ephemeral: true }).catch(() => {});
    }
  }
}

module.exports = {
  SECOES, buildMainMenuEmbed, buildMainMenuRow, buildBackRow, renderSecao,
  handleInteraction, registerSectionRenderer, registerModalHandler, registerButtonHandler, registerSelectHandler,
};

// Carrega o bloco 3 (recompensas/campanhas) para que ele se registre nas
// seções acima. require() no fim do arquivo evita ciclo de dependência
// (inviteAdminCRUD.js precisa de module.exports já existindo).
try { require('./inviteAdminCRUD'); } catch (e) { console.error('[InviteSystem] Erro ao carregar inviteAdminCRUD:', e.message); }
