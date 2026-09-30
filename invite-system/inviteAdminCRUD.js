// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteAdminCRUD.js
//
// KAEL INVITE SYSTEM — Parte 2 (bloco 3): CRUD de Recompensas e Campanhas
// dentro do /invite setup. Se registra em inviteSetupUI.js via
// registerSectionRenderer/registerButtonHandler/registerModalHandler —
// nenhum arquivo do bloco 2 precisa ser tocado para isso funcionar.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { CORES } = require('../config/constants');
const setupUI = require('./inviteSetupUI');
const invitePanel = require('./invitePanel');

function idCurto(prefixo) {
  return `${prefixo}_${crypto.randomBytes(4).toString('hex')}`;
}

// ─────────────────────────────────────────────────────────────────────
// RECOMPENSAS
// ─────────────────────────────────────────────────────────────────────
function renderRecompensas(guild) {
  const lista = inviteDb.listRewards(guild.id, false).sort((a, b) => a.required_invites - b.required_invites);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🎁 Recompensas')
    .setDescription(
      lista.length
        ? lista.map(r => `${r.enabled ? '✅' : '❌'} \`${r.required_invites} convites\` → **${r.name}**${r.role_id ? ` (<@&${r.role_id}>)` : ''}${r.one_time ? '' : ' — repetível'}`).join('\n')
        : '_Nenhuma recompensa criada ainda._'
    );

  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_reward_criar').setLabel('Criar recompensa').setEmoji('➕').setStyle(ButtonStyle.Success),
  )];

  if (lista.length) {
    const select = new StringSelectMenuBuilder().setCustomId('invite_reward_selecionar').setPlaceholder('Selecionar recompensa para editar/excluir')
      .addOptions(lista.slice(0, 25).map(r => new StringSelectMenuOptionBuilder()
        .setLabel(`${r.name} — ${r.required_invites} convites`.slice(0, 100))
        .setValue(r.reward_id)
        .setDescription((r.description || (r.enabled ? 'Ativa' : 'Inativa')).slice(0, 100))));
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  return { embeds: [embed], components: setupUI.buildBackRow(rows) };
}

function modalCriarRecompensa() {
  const modal = new ModalBuilder().setCustomId('invite_modal_reward_criar').setTitle('Nova recompensa');
  const nome = new TextInputBuilder().setCustomId('nome').setLabel('Nome da recompensa').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  const qtd = new TextInputBuilder().setCustomId('qtd').setLabel('Convites necessários').setStyle(TextInputStyle.Short).setRequired(true);
  const cargo = new TextInputBuilder().setCustomId('cargo').setLabel('ID do cargo a conceder (opcional)').setStyle(TextInputStyle.Short).setRequired(false);
  const desc = new TextInputBuilder().setCustomId('descricao').setLabel('Descrição (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
  const unica = new TextInputBuilder().setCustomId('unica').setLabel('Única? (sim/nao)').setStyle(TextInputStyle.Short).setRequired(false).setValue('sim');
  modal.addComponents(
    new ActionRowBuilder().addComponents(nome),
    new ActionRowBuilder().addComponents(qtd),
    new ActionRowBuilder().addComponents(cargo),
    new ActionRowBuilder().addComponents(desc),
    new ActionRowBuilder().addComponents(unica),
  );
  return modal;
}

async function onSubmitCriarRecompensa(interaction) {
  const nome = interaction.fields.getTextInputValue('nome').trim();
  const qtdTexto = interaction.fields.getTextInputValue('qtd').trim();
  const cargoId = interaction.fields.getTextInputValue('cargo').trim().replace(/\D/g, '');
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  const unicaTexto = interaction.fields.getTextInputValue('unica').trim().toLowerCase();

  const qtd = parseInt(qtdTexto, 10);
  if (!nome || Number.isNaN(qtd) || qtd <= 0) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Preencha um nome e uma quantidade de convites válida (número maior que zero).', ephemeral: true });
  }
  if (cargoId) {
    const cargo = await interaction.guild.roles.fetch(cargoId).catch(() => null);
    if (!cargo) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> O cargo informado não existe mais neste servidor.', ephemeral: true });
    }
    const me = interaction.guild.members.me;
    if (cargo.position >= me.roles.highest.position) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Não consigo atribuir este cargo porque ele está acima da minha posição.', ephemeral: true });
    }
  }

  inviteDb.createReward({
    guildId: interaction.guild.id,
    rewardId: idCurto('r'),
    requiredInvites: qtd,
    type: cargoId ? 'cargo' : 'info',
    roleId: cargoId || null,
    name: nome,
    description: descricao || null,
    oneTime: unicaTexto !== 'nao' && unicaTexto !== 'não',
  });

  const { embeds, components } = renderRecompensas(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSelecionarRecompensa(interaction) {
  const rewardId = interaction.values[0];
  const reward = inviteDb.getReward(interaction.guild.id, rewardId);
  if (!reward) {
    const { embeds, components } = renderRecompensas(interaction.guild);
    return interaction.update({ embeds, components });
  }
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle(`🎁 ${reward.name}`)
    .setDescription(
      `**Convites necessários:** \`${reward.required_invites}\`\n` +
      `**Cargo:** ${reward.role_id ? `<@&${reward.role_id}>` : '_nenhum_'}\n` +
      `**Status:** ${reward.enabled ? '✅ Ativa' : '❌ Inativa'}\n` +
      `**Tipo:** ${reward.one_time ? 'Única' : 'Repetível'}\n` +
      `**Descrição:** ${reward.description || '_nenhuma_'}`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`invite_reward_toggle_${reward.reward_id}`).setLabel(reward.enabled ? 'Desativar' : 'Ativar').setStyle(reward.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`invite_reward_excluir_${reward.reward_id}`).setLabel('Excluir').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('invite_reward_voltar').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
  );
  return interaction.update({ embeds: [embed], components: setupUI.buildBackRow([row]) });
}

async function onToggleRecompensa(interaction, rewardId) {
  const reward = inviteDb.getReward(interaction.guild.id, rewardId);
  if (reward) inviteDb.setRewardEnabled(interaction.guild.id, rewardId, !reward.enabled);
  const { embeds, components } = renderRecompensas(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onExcluirRecompensa(interaction, rewardId) {
  inviteDb.deleteReward(interaction.guild.id, rewardId);
  const { embeds, components } = renderRecompensas(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// CAMPANHAS
// ─────────────────────────────────────────────────────────────────────
function statusCampanha(c) {
  if (!c.enabled) return '❌ Desativada';
  const agora = Date.now();
  if (c.start_date && new Date(c.start_date).getTime() > agora) return '⏳ Agendada';
  if (c.end_date && new Date(c.end_date).getTime() < agora) return '🏁 Encerrada';
  return '🟢 Ativa';
}

function renderCampanhas(guild) {
  const lista = inviteDb.listCampaigns(guild.id);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle('🗓️ Campanhas')
    .setDescription(
      lista.length
        ? lista.map(c => `${statusCampanha(c)} — **${c.name}**${c.end_date ? ` (até <t:${Math.floor(new Date(c.end_date).getTime() / 1000)}:d>)` : ' (permanente)'}`).join('\n')
        : '_Nenhuma campanha criada ainda. Sem campanha ativa, as recompensas globais valem para todo mundo._'
    );

  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_campaign_criar').setLabel('Criar campanha').setEmoji('➕').setStyle(ButtonStyle.Success),
  )];

  if (lista.length) {
    const select = new StringSelectMenuBuilder().setCustomId('invite_campaign_selecionar').setPlaceholder('Selecionar campanha')
      .addOptions(lista.slice(0, 25).map(c => new StringSelectMenuOptionBuilder()
        .setLabel(c.name.slice(0, 100))
        .setValue(c.campaign_id)
        .setDescription(statusCampanha(c))));
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  return { embeds: [embed], components: setupUI.buildBackRow(rows) };
}

function modalCriarCampanha() {
  const modal = new ModalBuilder().setCustomId('invite_modal_campaign_criar').setTitle('Nova campanha');
  const nome = new TextInputBuilder().setCustomId('nome').setLabel('Nome da campanha').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  const desc = new TextInputBuilder().setCustomId('descricao').setLabel('Descrição (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
  const inicio = new TextInputBuilder().setCustomId('inicio').setLabel('Início (AAAA-MM-DD, opcional = já vale)').setStyle(TextInputStyle.Short).setRequired(false);
  const fim = new TextInputBuilder().setCustomId('fim').setLabel('Fim (AAAA-MM-DD, opcional = permanente)').setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(
    new ActionRowBuilder().addComponents(nome),
    new ActionRowBuilder().addComponents(desc),
    new ActionRowBuilder().addComponents(inicio),
    new ActionRowBuilder().addComponents(fim),
  );
  return modal;
}

function validarData(v) {
  if (!v) return null;
  const d = new Date(v + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function onSubmitCriarCampanha(interaction) {
  const nome = interaction.fields.getTextInputValue('nome').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  const inicioTexto = interaction.fields.getTextInputValue('inicio').trim();
  const fimTexto = interaction.fields.getTextInputValue('fim').trim();

  if (!nome) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Informe um nome para a campanha.', ephemeral: true });
  }
  const inicio = validarData(inicioTexto);
  const fim = validarData(fimTexto);
  if (inicio === undefined || fim === undefined) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Use o formato AAAA-MM-DD para as datas (ex: 2026-12-31).', ephemeral: true });
  }

  inviteDb.upsertCampaign({
    guildId: interaction.guild.id, campaignId: idCurto('c'), name: nome, description: descricao || null,
    startDate: inicio, endDate: fim, enabled: true, rewards: [],
  });

  const { embeds, components } = renderCampanhas(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onSelecionarCampanha(interaction) {
  const campaignId = interaction.values[0];
  const campanha = inviteDb.getCampaign(interaction.guild.id, campaignId);
  if (!campanha) {
    const { embeds, components } = renderCampanhas(interaction.guild);
    return interaction.update({ embeds, components });
  }
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle(`🗓️ ${campanha.name}`)
    .setDescription(
      `**Status:** ${statusCampanha(campanha)}\n` +
      `**Período:** ${campanha.start_date ? `<t:${Math.floor(new Date(campanha.start_date).getTime() / 1000)}:d>` : 'sem início definido'} até ${campanha.end_date ? `<t:${Math.floor(new Date(campanha.end_date).getTime() / 1000)}:d>` : 'permanente'}\n` +
      `**Campanha em destaque no painel:** ${config.campaignId === campanha.campaign_id ? '✅ Sim' : '❌ Não'}\n` +
      `**Descrição:** ${campanha.description || '_nenhuma_'}`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`invite_campaign_toggle_${campanha.campaign_id}`).setLabel(campanha.enabled ? 'Desativar' : 'Ativar').setStyle(campanha.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`invite_campaign_destacar_${campanha.campaign_id}`).setLabel('Destacar no painel').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`invite_campaign_excluir_${campanha.campaign_id}`).setLabel('Excluir').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return interaction.update({ embeds: [embed], components: setupUI.buildBackRow([row]) });
}

async function onToggleCampanha(interaction, campaignId) {
  const campanha = inviteDb.getCampaign(interaction.guild.id, campaignId);
  if (campanha) inviteDb.setCampaignEnabled(interaction.guild.id, campaignId, !campanha.enabled);
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderCampanhas(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onDestacarCampanha(interaction, campaignId) {
  inviteDb.updateGuildConfig(interaction.guild.id, { campaignId });
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderCampanhas(interaction.guild);
  return interaction.update({ embeds, components });
}

async function onExcluirCampanha(interaction, campaignId) {
  // Nunca apaga o invite_history — só a campanha em si (o histórico
  // continua consultável por /invite historico mesmo depois de excluída).
  const config = inviteDb.getGuildConfig(interaction.guild.id);
  if (config.campaignId === campaignId) inviteDb.updateGuildConfig(interaction.guild.id, { campaignId: null });
  inviteDb.deleteCampaign(interaction.guild.id, campaignId);
  await invitePanel.refreshPanel(interaction.guild);
  const { embeds, components } = renderCampanhas(interaction.guild);
  return interaction.update({ embeds, components });
}

// ─────────────────────────────────────────────────────────────────────
// REGISTRO NO PAINEL PRINCIPAL
// ─────────────────────────────────────────────────────────────────────
setupUI.registerSectionRenderer('recompensas', renderRecompensas);
setupUI.registerSectionRenderer('campanhas', renderCampanhas);

setupUI.registerButtonHandler('invite_reward_criar', (i) => i.showModal(modalCriarRecompensa()));
setupUI.registerButtonHandler('invite_reward_voltar', (i) => { const { embeds, components } = renderRecompensas(i.guild); return i.update({ embeds, components }); });
setupUI.registerButtonHandler('invite_reward_toggle_', (i) => onToggleRecompensa(i, i.customId.replace('invite_reward_toggle_', '')));
setupUI.registerButtonHandler('invite_reward_excluir_', (i) => onExcluirRecompensa(i, i.customId.replace('invite_reward_excluir_', '')));

setupUI.registerButtonHandler('invite_campaign_criar', (i) => i.showModal(modalCriarCampanha()));
setupUI.registerButtonHandler('invite_campaign_toggle_', (i) => onToggleCampanha(i, i.customId.replace('invite_campaign_toggle_', '')));
setupUI.registerButtonHandler('invite_campaign_destacar_', (i) => onDestacarCampanha(i, i.customId.replace('invite_campaign_destacar_', '')));
setupUI.registerButtonHandler('invite_campaign_excluir_', (i) => onExcluirCampanha(i, i.customId.replace('invite_campaign_excluir_', '')));

setupUI.registerModalHandler('invite_modal_reward_criar', onSubmitCriarRecompensa);
setupUI.registerModalHandler('invite_modal_campaign_criar', onSubmitCriarCampanha);

setupUI.registerSelectHandler('invite_reward_selecionar', onSelecionarRecompensa);
setupUI.registerSelectHandler('invite_campaign_selecionar', onSelecionarCampanha);

module.exports = { renderRecompensas, renderCampanhas };
