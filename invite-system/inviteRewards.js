// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteRewards.js
//
// KAEL INVITE SYSTEM — fundação do sistema de recompensas (Parte 1).
//
// Suporta, por enquanto, apenas o tipo "cargo". Campanhas e outros tipos
// de recompensa entram na Parte 2, reaproveitando esta mesma base.
// ═══════════════════════════════════════════════════════════════════════

const inviteDb = require('../database/inviteDb');
const { sendRewardNotification } = require('./inviteNotify');

/**
 * Verifica as recompensas de uma guild contra o total de convites válidos
 * de um usuário e concede (adiciona cargo) as que ele desbloqueou e ainda
 * não recebeu.
 */
async function checkAndGrantRewards(guild, userId) {
  const config = inviteDb.getGuildConfig(guild.id);
  const stats = inviteDb.getInviterStats(guild.id, userId, config);
  const rewards = inviteDb.listRewards(guild.id, true);

  const unlocked = rewards.filter(r => stats.validos >= r.required_invites);
  const granted = [];

  for (const reward of unlocked) {
    if (reward.one_time && inviteDb.hasClaimedReward(guild.id, reward.reward_id, userId)) continue;

    if (reward.type === 'cargo' && reward.role_id) {
      const ok = await grantRoleReward(guild, userId, reward.role_id);
      if (!ok) continue; // não foi possível conceder (hierarquia/permissão) — não marca como reivindicado
    }

    const claimed = inviteDb.claimReward(guild.id, reward.reward_id, userId);
    if (claimed) {
      granted.push(reward);
      inviteDb.logHistory({ guildId: guild.id, userId, action: 'recompensa_concedida', meta: { rewardId: reward.reward_id } });
      sendRewardNotification(guild, { userId, reward }).catch(e => console.error('[InviteSystem] Erro ao notificar recompensa:', e.message));
    }
  }

  return granted;
}

/**
 * Concede um cargo respeitando hierarquia e permissões do bot.
 * Nunca tenta adicionar um cargo que o bot não consegue gerenciar.
 */
async function grantRoleReward(guild, userId, roleId) {
  try {
    const me = guild.members.me || await guild.members.fetchMe();
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) return false;
    if (!me.permissions.has('ManageRoles')) return false;
    if (role.position >= me.roles.highest.position) return false; // hierarquia
    if (role.managed) return false; // cargo gerenciado por integração externa

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    if (member.roles.cache.has(roleId)) return true; // já tem

    await member.roles.add(roleId, 'Kael Invite System — recompensa de convites');
    return true;
  } catch (e) {
    console.error('[InviteSystem] Erro ao conceder cargo de recompensa:', e.message);
    return false;
  }
}

/**
 * Retorna a próxima recompensa não desbloqueada e o progresso até ela.
 */
function getNextReward(guild, userId) {
  const config = inviteDb.getGuildConfig(guild.id);
  const stats = inviteDb.getInviterStats(guild.id, userId, config);
  const rewards = inviteDb.listRewards(guild.id, true).sort((a, b) => a.required_invites - b.required_invites);
  const next = rewards.find(r => stats.validos < r.required_invites);
  if (!next) return { next: null, stats };
  return {
    next,
    progresso: stats.validos,
    faltam: Math.max(0, next.required_invites - stats.validos),
    stats,
  };
}

module.exports = { checkAndGrantRewards, grantRoleReward, getNextReward };
