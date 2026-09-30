// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteEmbed.js
//
// KAEL INVITE SYSTEM — Parte 2: constrói o embed do painel público a
// partir do embedConfig salvo no banco (cor, título, descrição, imagens,
// autor, footer, campos) + a seção dinâmica "CONVIDE E GANHE" baseada
// nas recompensas da campanha ativa. Nunca lança exceção: qualquer campo
// ausente cai num padrão seguro.
// ═══════════════════════════════════════════════════════════════════════

const { EmbedBuilder } = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { CORES } = require('../config/constants');
const { applyPlaceholders } = require('./inviteText');

/**
 * Gera o texto dinâmico "CONVIDE E GANHE!" a partir das recompensas
 * ativas (da campanha ativa, se houver `rewards` definidos nela, senão
 * das recompensas globais da guild).
 */
function buildRewardsList(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const campanha = inviteDb.getActiveCampaign(guild.id);
  let rewards = inviteDb.listRewards(guild.id, true);

  if (campanha && Array.isArray(campanha.rewards) && campanha.rewards.length) {
    const idsCampanha = new Set(campanha.rewards);
    const filtradas = rewards.filter(r => idsCampanha.has(r.reward_id));
    if (filtradas.length) rewards = filtradas;
  }

  if (!rewards.length) return null;
  return rewards
    .sort((a, b) => a.required_invites - b.required_invites)
    .map(r => `\`${r.required_invites} INVITES\` → **${r.name}**`)
    .join('\n');
}

/**
 * Constrói o embed completo do painel público, respeitando toda a
 * personalização salva (embedConfig) e injetando a lista dinâmica de
 * recompensas quando o admin não sobrescreveu a descrição manualmente.
 */
function buildCustomPanelEmbed(guild) {
  const config = inviteDb.getGuildConfig(guild.id);
  const ec = config.embedConfig || {};
  const campanha = inviteDb.getActiveCampaign(guild.id);

  const placeholderData = {
    guild: guild.name,
    nextReward: '',
  };

  const embed = new EmbedBuilder().setColor(typeof ec.color === 'number' ? ec.color : CORES.INFO);

  embed.setTitle(applyPlaceholders(ec.title || 'KAEL INVITE SYSTEM', placeholderData));

  const introPadrao =
    'Convide novos membros, acompanhe seu progresso e conquiste recompensas.\n\n' +
    '> ✅ **Confirmar** — confirma sua participação na campanha atual.\n' +
    '> 🔗 **Copiar Convite** — pega seu link de convite pessoal.\n' +
    '> 📊 **Meus Convites** — veja suas estatísticas.\n' +
    '> 🏆 **Ranking** — veja o top de convidadores do servidor.';

  let descricao = applyPlaceholders(ec.description || introPadrao, placeholderData);

  const rewardsList = buildRewardsList(guild);
  if (rewardsList && !ec.description) {
    descricao += `\n\n**CONVIDE E GANHE!**\n${rewardsList}`;
  }
  embed.setDescription(descricao);

  if (ec.image) embed.setImage(ec.image);
  if (ec.thumbnail) embed.setThumbnail(ec.thumbnail);
  if (ec.author) {
    embed.setAuthor({ name: applyPlaceholders(ec.author, placeholderData), iconURL: ec.authorIcon || undefined });
  }
  if (Array.isArray(ec.fields) && ec.fields.length) {
    embed.addFields(ec.fields.slice(0, 25).map(f => ({
      name: applyPlaceholders(f.name || '\u200b', placeholderData),
      value: applyPlaceholders(f.value || '\u200b', placeholderData),
      inline: !!f.inline,
    })));
  }
  embed.setFooter({ text: applyPlaceholders(ec.footer || guild.name, placeholderData) });
  if (ec.timestamp !== false) embed.setTimestamp();

  if (campanha) {
    embed.addFields({ name: '🗓️ Campanha ativa', value: campanha.name, inline: false });
  }

  return embed;
}

module.exports = { buildCustomPanelEmbed, buildRewardsList };
