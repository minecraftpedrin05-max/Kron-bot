// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteNotify.js
//
// KAEL INVITE SYSTEM — Parte 2: notificações automáticas de novo convite
// e recompensa desbloqueada, 100% personalizáveis via notificationsConfig.
// Nunca lança exceção para fora: falha de canal/permissão só é logada.
// ═══════════════════════════════════════════════════════════════════════

const { EmbedBuilder } = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { CORES } = require('../config/constants');
const { applyPlaceholders } = require('./inviteText');

const PADRAO = {
  joinEnabled: true,
  joinTitle: '🎉 Novo convite confirmado!',
  joinMessage: '{inviter} convidou {user}.\nConvites válidos: **{invites}**',
  rewardEnabled: true,
  rewardTitle: '🎁 Recompensa desbloqueada!',
  rewardMessage: '{user} atingiu {requiredInvites} convites.\nRecompensa: **{reward}**',
};

function getNotifyConfig(guildId) {
  const config = inviteDb.getGuildConfig(guildId);
  return { ...PADRAO, ...(config.notificationsConfig || {}) };
}

async function getNotifyChannel(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  if (!config.notificationChannelId) return null;
  const canal = await guild.channels.fetch(config.notificationChannelId).catch(() => null);
  if (!canal || !canal.isTextBased?.()) return null;
  const me = guild.members.me;
  if (!canal.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) return null;
  return canal;
}

async function sendJoinNotification(guild, { inviterId, invitedUserId, validInvites }) {
  try {
    const cfg = getNotifyConfig(guild.id);
    if (!cfg.joinEnabled) return;
    const canal = await getNotifyChannel(guild);
    if (!canal) return;

    const data = {
      inviter: inviterId ? `<@${inviterId}>` : 'Alguém',
      user: `<@${invitedUserId}>`,
      invites: String(validInvites ?? 0),
      guild: guild.name,
    };
    const embed = new EmbedBuilder()
      .setColor(CORES.SUCESSO)
      .setTitle(applyPlaceholders(cfg.joinTitle, data))
      .setDescription(applyPlaceholders(cfg.joinMessage, data))
      .setTimestamp();
    await canal.send({ embeds: [embed] });
  } catch (e) {
    console.error('[InviteSystem] Erro ao enviar notificação de novo convite:', e.message);
  }
}

async function sendRewardNotification(guild, { userId, reward }) {
  try {
    const cfg = getNotifyConfig(guild.id);
    if (!cfg.rewardEnabled) return;
    const canal = await getNotifyChannel(guild);
    if (!canal) return;

    const data = {
      user: `<@${userId}>`,
      requiredInvites: String(reward.required_invites ?? reward.requiredInvites ?? ''),
      reward: reward.name,
      guild: guild.name,
    };
    const embed = new EmbedBuilder()
      .setColor(CORES.INFO)
      .setTitle(applyPlaceholders(cfg.rewardTitle, data))
      .setDescription(applyPlaceholders(cfg.rewardMessage, data))
      .setTimestamp();
    await canal.send({ embeds: [embed] });
  } catch (e) {
    console.error('[InviteSystem] Erro ao enviar notificação de recompensa:', e.message);
  }
}

module.exports = { getNotifyConfig, getNotifyChannel, sendJoinNotification, sendRewardNotification };
