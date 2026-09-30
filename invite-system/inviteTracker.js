// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteTracker.js
//
// KAEL INVITE SYSTEM — rastreamento real (Parte 1).
//
// Mantém um cache em memória (Map<guildId, Map<code, uses>>) dos convites
// de cada servidor, populado uma única vez por servidor (guildCreate /
// ready) e depois mantido atualizado via os próprios eventos do
// discord.js (inviteCreate, inviteDelete, guildMemberAdd) — nunca
// refazendo `guild.invites.fetch()` a cada entrada de membro.
// ═══════════════════════════════════════════════════════════════════════

const inviteDb = require('../database/inviteDb');
const { checkAndGrantRewards } = require('./inviteRewards');
const { evaluateJoin } = require('./inviteFraud');
const { sendJoinNotification } = require('./inviteNotify');

// guildId -> Map<inviteCode, uses>
const cache = new Map();

function snapshotToCache(guildId, invites) {
  const map = new Map();
  for (const inv of invites.values()) {
    map.set(inv.code, inv.uses ?? 0);
    inviteDb.upsertInvite(guildId, inv.code, inv.inviterId || inv.inviter?.id || null, inv.uses ?? 0,
      inv.expiresTimestamp ? new Date(inv.expiresTimestamp).toISOString() : null);
  }
  cache.set(guildId, map);
  return map;
}

/**
 * Popula/atualiza o cache de um servidor. Chamado no boot (ready) para
 * cada guild e sempre que precisarmos garantir que o cache existe.
 */
async function primeGuildCache(guild) {
  try {
    const config = inviteDb.getGuildConfig(guild.id);
    if (!config.enabled) return;
    if (!guild.members.me?.permissions.has('ManageGuild')) return; // sem permissão, não há como ler convites
    const invites = await guild.invites.fetch();
    snapshotToCache(guild.id, invites);
  } catch (e) {
    console.error(`[InviteSystem] Erro ao inicializar cache de convites da guild ${guild.id}:`, e.message);
  }
}

async function primeAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    await primeGuildCache(guild);
  }
}

function getCachedMap(guildId) {
  if (!cache.has(guildId)) cache.set(guildId, new Map());
  return cache.get(guildId);
}

// ─────────────────────────────────────────────────────────────────────
// EVENTOS DE CONVITE (inviteCreate / inviteDelete)
// ─────────────────────────────────────────────────────────────────────
function handleInviteCreate(invite) {
  try {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    const map = getCachedMap(guildId);
    map.set(invite.code, invite.uses ?? 0);
    inviteDb.upsertInvite(guildId, invite.code, invite.inviterId || invite.inviter?.id || null, invite.uses ?? 0,
      invite.expiresTimestamp ? new Date(invite.expiresTimestamp).toISOString() : null);
    inviteDb.logHistory({ guildId, userId: invite.inviterId || invite.inviter?.id || null, inviteCode: invite.code, action: 'convite_criado' });
  } catch (e) {
    console.error('[InviteSystem] Erro em inviteCreate:', e.message);
  }
}

function handleInviteDelete(invite) {
  try {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    const map = getCachedMap(guildId);
    map.delete(invite.code);
    inviteDb.deleteInvite(guildId, invite.code);
    inviteDb.logHistory({ guildId, inviteCode: invite.code, action: 'convite_removido' });
  } catch (e) {
    console.error('[InviteSystem] Erro em inviteDelete:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ENTRADA DE MEMBRO — detecta qual convite foi usado comparando o
// snapshot em cache com o estado atual (sem re-fetch desnecessário: só
// buscamos de novo se algum contador estiver dessincronizado).
// ─────────────────────────────────────────────────────────────────────
async function resolveUsedInvite(guild) {
  const before = getCachedMap(guild.id);
  let after;
  try {
    after = await guild.invites.fetch();
  } catch (e) {
    console.error(`[InviteSystem] Não foi possível buscar convites da guild ${guild.id} (permissão?):`, e.message);
    return null;
  }

  let used = null;
  for (const inv of after.values()) {
    const prevUses = before.get(inv.code) ?? 0;
    if ((inv.uses ?? 0) > prevUses) {
      used = inv;
      break;
    }
  }
  // Convite de uso único que já foi consumido e sumiu da lista: comparamos códigos ausentes.
  if (!used) {
    for (const [code, uses] of before.entries()) {
      if (!after.has(code) && uses >= 0) {
        // não temos certeza — não assumimos, apenas seguimos sem inviter conhecido
      }
    }
  }

  snapshotToCache(guild.id, after);
  return used; // pode ser null (ex: convite de instante único / vanity / desconhecido)
}

async function handleGuildMemberAdd(member) {
  try {
    const guild = member.guild;
    const config = inviteDb.getGuildConfig(guild.id);
    if (!config.enabled) return;
    if (member.user.bot && !config.countBots) return;

    const usedInvite = await resolveUsedInvite(guild).catch(() => null);
    const inviterId = usedInvite?.inviterId || usedInvite?.inviter?.id || null;
    const inviteCode = usedInvite?.code || null;

    const existing = inviteDb.getMember(guild.id, member.id);
    let record;
    let action;
    if (existing) {
      // reentrada — reaproveita relacionamento anterior, sem duplicar
      record = inviteDb.markMemberRejoined(guild.id, member.id, { inviterId, inviteCode });
      action = 'reentrada';
      if (!config.countRejoins) {
        inviteDb.setMemberValidity(guild.id, member.id, false);
      } else {
        inviteDb.setMemberValidity(guild.id, member.id, true);
      }
    } else {
      record = inviteDb.createMember({ guildId: guild.id, inviterId, invitedUserId: member.id, inviteCode, campaignId: config.campaignId });
      action = 'entrada';
    }

    inviteDb.logHistory({
      guildId: guild.id, userId: inviterId, invitedUserId: member.id,
      inviteCode, action, campaignId: config.campaignId,
    });

    if (config.antiFraudEnabled) {
      const verdict = evaluateJoin({ guild, member, config, record });
      if (verdict.suspicious) {
        inviteDb.markSuspicious(guild.id, member.id, verdict.reason);
        inviteDb.logHistory({ guildId: guild.id, userId: inviterId, invitedUserId: member.id, inviteCode, action: 'marcado_suspeito', meta: { reason: verdict.reason } });
      }
    }

    if (inviterId) {
      sendJoinNotification(guild, { inviterId, invitedUserId: member.id, validInvites: inviteDb.getInviterStats(guild.id, inviterId, config).validos }).catch(e => console.error('[InviteSystem] Erro ao notificar novo convidado:', e.message));
      await checkAndGrantRewards(guild, inviterId).catch(e => console.error('[InviteSystem] Erro ao checar recompensas:', e.message));
    }
  } catch (e) {
    console.error('[InviteSystem] Erro em guildMemberAdd:', e);
  }
}

async function handleGuildMemberRemove(member) {
  try {
    const guild = member.guild;
    const config = inviteDb.getGuildConfig(guild.id);
    if (!config.enabled) return;

    const record = inviteDb.markMemberLeft(guild.id, member.id);
    if (!record) return; // membro nunca foi rastreado (entrou antes do sistema existir, etc.)

    if (!config.countAfterLeave) {
      inviteDb.setMemberValidity(guild.id, member.id, false);
    }

    inviteDb.logHistory({
      guildId: guild.id, userId: record.inviter_id, invitedUserId: member.id,
      inviteCode: record.invite_code, action: 'saida',
    });
  } catch (e) {
    console.error('[InviteSystem] Erro em guildMemberRemove:', e);
  }
}

module.exports = {
  primeGuildCache,
  primeAllGuilds,
  handleInviteCreate,
  handleInviteDelete,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
};
