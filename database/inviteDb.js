// ═══════════════════════════════════════════════════════════════════════
// database/inviteDb.js
//
// KAEL INVITE SYSTEM — camada de persistência (Parte 1).
//
// Usa better-sqlite3, exatamente como o resto do projeto (database/
// sqliteDb.js), mas em arquivo próprio (invites.sqlite) para não misturar
// schema com loja/tickets/sorteios/licenças. Nenhuma tabela ou handler
// existente é tocado por este arquivo.
//
// Responsabilidade: SOMENTE schema + CRUD de baixo nível. Regras de
// negócio (anti-fraude, contagem final respeitando config, recompensas,
// ranking formatado) vivem em invite-system/*.
// ═══════════════════════════════════════════════════════════════════════

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'invites.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ─────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS guild_invite_config (
  guild_id              TEXT PRIMARY KEY,
  enabled               INTEGER NOT NULL DEFAULT 1,
  panel_channel_id      TEXT,
  notification_channel_id TEXT,
  panel_message_id      TEXT,
  campaign_id           TEXT,
  tracking_mode         TEXT NOT NULL DEFAULT 'padrao',
  count_bots            INTEGER NOT NULL DEFAULT 0,
  count_after_leave     INTEGER NOT NULL DEFAULT 0,
  count_rejoins         INTEGER NOT NULL DEFAULT 1,
  anti_fraud_enabled    INTEGER NOT NULL DEFAULT 1,
  embed_config          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_data (
  guild_id    TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  inviter_id  TEXT,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  PRIMARY KEY (guild_id, invite_code)
);
CREATE INDEX IF NOT EXISTS idx_invite_data_inviter ON invite_data(guild_id, inviter_id);

CREATE TABLE IF NOT EXISTS invite_members (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  inviter_id        TEXT,
  invited_user_id   TEXT NOT NULL,
  invite_code       TEXT,
  joined_at         TEXT NOT NULL,
  left_at           TEXT,
  status            TEXT NOT NULL DEFAULT 'ativo',   -- ativo | saiu
  valid             INTEGER NOT NULL DEFAULT 1,
  suspicious        INTEGER NOT NULL DEFAULT 0,
  suspicious_reason TEXT,
  rejoin_count      INTEGER NOT NULL DEFAULT 0,
  campaign_id       TEXT,
  UNIQUE(guild_id, invited_user_id)
);
CREATE INDEX IF NOT EXISTS idx_invite_members_inviter ON invite_members(guild_id, inviter_id);
CREATE INDEX IF NOT EXISTS idx_invite_members_status  ON invite_members(guild_id, status);

CREATE TABLE IF NOT EXISTS invite_rewards (
  guild_id        TEXT NOT NULL,
  reward_id       TEXT NOT NULL,
  required_invites INTEGER NOT NULL,
  type            TEXT NOT NULL DEFAULT 'cargo',
  role_id         TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  one_time        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (guild_id, reward_id)
);

CREATE TABLE IF NOT EXISTS reward_claims (
  guild_id   TEXT NOT NULL,
  reward_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, reward_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_campaigns (
  guild_id    TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  start_date  TEXT,
  end_date    TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  rewards     TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (guild_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS invite_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT,
  invited_user_id TEXT,
  invite_code     TEXT,
  action          TEXT NOT NULL,
  timestamp       TEXT NOT NULL,
  campaign_id     TEXT,
  meta            TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_history_guild ON invite_history(guild_id, timestamp);

CREATE TABLE IF NOT EXISTS invite_confirmations (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  campaign_id  TEXT NOT NULL DEFAULT '_none_',
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, campaign_id)
);
`);

const now = () => new Date().toISOString();


// ─────────────────────────────────────────────────────────────────────
// PARTE 2 — colunas novas em guild_invite_config (ALTER TABLE seguro:
// só roda se a coluna ainda não existir, nunca quebra bancos já criados
// pela Parte 1).
// ─────────────────────────────────────────────────────────────────────
(function migrarColunasParte2() {
  const colunas = db.prepare(`PRAGMA table_info(guild_invite_config)`).all().map(c => c.name);
  const novas = [
    ['buttons_config', `TEXT`],
    ['notifications_config', `TEXT`],
    ['antifraud_min_account_hours', `INTEGER NOT NULL DEFAULT 72`],
    ['antifraud_burst_limit', `INTEGER NOT NULL DEFAULT 5`],
    ['antifraud_rejoin_limit', `INTEGER NOT NULL DEFAULT 2`],
    ['stats_channel_id', `TEXT`],
    ['publish_channel_id', `TEXT`],
  ];
  for (const [coluna, tipo] of novas) {
    if (!colunas.includes(coluna)) {
      db.exec(`ALTER TABLE guild_invite_config ADD COLUMN ${coluna} ${tipo}`);
    }
  }
})();


// ─────────────────────────────────────────────────────────────────────
// GUILD CONFIG
// ─────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enabled: 1, panelChannelId: null, notificationChannelId: null, panelMessageId: null,
  campaignId: null, trackingMode: 'padrao', countBots: 0, countAfterLeave: 0,
  countRejoins: 1, antiFraudEnabled: 1, embedConfig: null,
};

function rowToConfig(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: !!row.enabled,
    panelChannelId: row.panel_channel_id,
    notificationChannelId: row.notification_channel_id,
    panelMessageId: row.panel_message_id,
    campaignId: row.campaign_id,
    trackingMode: row.tracking_mode,
    countBots: !!row.count_bots,
    countAfterLeave: !!row.count_after_leave,
    countRejoins: !!row.count_rejoins,
    antiFraudEnabled: !!row.anti_fraud_enabled,
    embedConfig: row.embed_config ? JSON.parse(row.embed_config) : null,
    buttonsConfig: row.buttons_config ? JSON.parse(row.buttons_config) : null,
    notificationsConfig: row.notifications_config ? JSON.parse(row.notifications_config) : null,
    antifraudMinAccountHours: row.antifraud_min_account_hours ?? 72,
    antifraudBurstLimit: row.antifraud_burst_limit ?? 5,
    antifraudRejoinLimit: row.antifraud_rejoin_limit ?? 2,
    statsChannelId: row.stats_channel_id || null,
    publishChannelId: row.publish_channel_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getGuildConfig(guildId) {
  const row = db.prepare(`SELECT * FROM guild_invite_config WHERE guild_id = ?`).get(guildId);
  if (row) return rowToConfig(row);
  const ts = now();
  db.prepare(`
    INSERT INTO guild_invite_config
      (guild_id, enabled, tracking_mode, count_bots, count_after_leave, count_rejoins, anti_fraud_enabled, created_at, updated_at)
    VALUES (?, 1, 'padrao', 0, 0, 1, 1, ?, ?)
  `).run(guildId, ts, ts);
  return rowToConfig(db.prepare(`SELECT * FROM guild_invite_config WHERE guild_id = ?`).get(guildId));
}

function updateGuildConfig(guildId, partial) {
  getGuildConfig(guildId); // garante que a linha existe
  const fieldMap = {
    enabled: 'enabled', panelChannelId: 'panel_channel_id', notificationChannelId: 'notification_channel_id',
    panelMessageId: 'panel_message_id', campaignId: 'campaign_id', trackingMode: 'tracking_mode',
    countBots: 'count_bots', countAfterLeave: 'count_after_leave', countRejoins: 'count_rejoins',
    antiFraudEnabled: 'anti_fraud_enabled', embedConfig: 'embed_config',
    buttonsConfig: 'buttons_config', notificationsConfig: 'notifications_config',
    antifraudMinAccountHours: 'antifraud_min_account_hours', antifraudBurstLimit: 'antifraud_burst_limit',
    antifraudRejoinLimit: 'antifraud_rejoin_limit', statsChannelId: 'stats_channel_id',
    publishChannelId: 'publish_channel_id',
  };
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(fieldMap)) {
    if (!(key in partial)) continue;
    let v = partial[key];
    if (['enabled', 'countBots', 'countAfterLeave', 'countRejoins', 'antiFraudEnabled'].includes(key)) v = v ? 1 : 0;
    if ((key === 'embedConfig' || key === 'buttonsConfig' || key === 'notificationsConfig') && v && typeof v === 'object') v = JSON.stringify(v);
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (!sets.length) return getGuildConfig(guildId);
  sets.push('updated_at = ?');
  vals.push(now());
  vals.push(guildId);
  db.prepare(`UPDATE guild_invite_config SET ${sets.join(', ')} WHERE guild_id = ?`).run(...vals);
  return getGuildConfig(guildId);
}

// ─────────────────────────────────────────────────────────────────────
// INVITE DATA (cache persistido dos convites do servidor)
// ─────────────────────────────────────────────────────────────────────
function upsertInvite(guildId, inviteCode, inviterId, uses, expiresAt) {
  const existing = db.prepare(`SELECT * FROM invite_data WHERE guild_id = ? AND invite_code = ?`).get(guildId, inviteCode);
  if (existing) {
    db.prepare(`UPDATE invite_data SET uses = ?, inviter_id = COALESCE(?, inviter_id), expires_at = ? WHERE guild_id = ? AND invite_code = ?`)
      .run(uses, inviterId, expiresAt, guildId, inviteCode);
  } else {
    db.prepare(`INSERT INTO invite_data (guild_id, invite_code, inviter_id, uses, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(guildId, inviteCode, inviterId, uses, now(), expiresAt);
  }
}

function deleteInvite(guildId, inviteCode) {
  db.prepare(`DELETE FROM invite_data WHERE guild_id = ? AND invite_code = ?`).run(guildId, inviteCode);
}

function getInvite(guildId, inviteCode) {
  return db.prepare(`SELECT * FROM invite_data WHERE guild_id = ? AND invite_code = ?`).get(guildId, inviteCode);
}

function getGuildInvites(guildId) {
  return db.prepare(`SELECT * FROM invite_data WHERE guild_id = ?`).all(guildId);
}

function getUserInvite(guildId, inviterId) {
  // convite "individual" reutilizável: o mais recente ainda não excluído
  return db.prepare(`SELECT * FROM invite_data WHERE guild_id = ? AND inviter_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(guildId, inviterId);
}

// ─────────────────────────────────────────────────────────────────────
// INVITE MEMBERS (relação convidador <-> convidado)
// ─────────────────────────────────────────────────────────────────────
function getMember(guildId, invitedUserId) {
  return db.prepare(`SELECT * FROM invite_members WHERE guild_id = ? AND invited_user_id = ?`).get(guildId, invitedUserId);
}

function createMember(data) {
  const { guildId, inviterId, invitedUserId, inviteCode, campaignId } = data;
  const existing = getMember(guildId, invitedUserId);
  if (existing) return existing; // proteção contra registro duplicado
  db.prepare(`
    INSERT INTO invite_members (guild_id, inviter_id, invited_user_id, invite_code, joined_at, status, valid, suspicious, rejoin_count, campaign_id)
    VALUES (?, ?, ?, ?, ?, 'ativo', 1, 0, 0, ?)
  `).run(guildId, inviterId || null, invitedUserId, inviteCode || null, now(), campaignId || null);
  return getMember(guildId, invitedUserId);
}

function markMemberRejoined(guildId, invitedUserId, { inviterId, inviteCode } = {}) {
  const existing = getMember(guildId, invitedUserId);
  if (!existing) return createMember({ guildId, inviterId, invitedUserId, inviteCode });
  db.prepare(`
    UPDATE invite_members
    SET status = 'ativo', left_at = NULL, rejoin_count = rejoin_count + 1,
        inviter_id = COALESCE(?, inviter_id), invite_code = COALESCE(?, invite_code)
    WHERE guild_id = ? AND invited_user_id = ?
  `).run(inviterId || null, inviteCode || null, guildId, invitedUserId);
  return getMember(guildId, invitedUserId);
}

function markMemberLeft(guildId, invitedUserId) {
  const existing = getMember(guildId, invitedUserId);
  if (!existing) return null;
  db.prepare(`UPDATE invite_members SET status = 'saiu', left_at = ? WHERE guild_id = ? AND invited_user_id = ?`)
    .run(now(), guildId, invitedUserId);
  return getMember(guildId, invitedUserId);
}

function setMemberValidity(guildId, invitedUserId, valid) {
  db.prepare(`UPDATE invite_members SET valid = ? WHERE guild_id = ? AND invited_user_id = ?`)
    .run(valid ? 1 : 0, guildId, invitedUserId);
}

function markSuspicious(guildId, invitedUserId, reason) {
  db.prepare(`UPDATE invite_members SET suspicious = 1, suspicious_reason = ? WHERE guild_id = ? AND invited_user_id = ?`)
    .run(reason || null, guildId, invitedUserId);
}

function getMembersByInviter(guildId, inviterId) {
  return db.prepare(`SELECT * FROM invite_members WHERE guild_id = ? AND inviter_id = ?`).all(guildId, inviterId);
}

/**
 * Estatísticas agregadas de um convidador, já respeitando countAfterLeave.
 */
function getInviterStats(guildId, inviterId, config) {
  const rows = getMembersByInviter(guildId, inviterId);
  let total = 0, validos = 0, atuais = 0, sairam = 0, suspeitos = 0;
  for (const r of rows) {
    total++;
    if (r.suspicious) suspeitos++;
    if (r.status === 'saiu') sairam++;
    else atuais++;
    const contaComoValido = r.valid && !r.suspicious && (r.status === 'ativo' || config.countAfterLeave);
    if (contaComoValido) validos++;
  }
  return { total, validos, atuais, sairam, suspeitos };
}

/**
 * Ranking por convites válidos (respeitando countAfterLeave da guild).
 */
function getRanking(guildId, config, limit = 10) {
  const rows = db.prepare(`SELECT * FROM invite_members WHERE guild_id = ?`).all(guildId);
  const byInviter = new Map();
  for (const r of rows) {
    if (!r.inviter_id) continue;
    if (r.suspicious || !r.valid) continue;
    if (r.status === 'saiu' && !config.countAfterLeave) continue;
    byInviter.set(r.inviter_id, (byInviter.get(r.inviter_id) || 0) + 1);
  }
  const sorted = [...byInviter.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, limit).map(([userId, count], i) => ({ position: i + 1, userId, count }));
}

function getUserPosition(guildId, inviterId, config) {
  const full = getRanking(guildId, config, Number.MAX_SAFE_INTEGER);
  const entry = full.find(e => e.userId === inviterId);
  return entry ? entry.position : null;
}

// ─────────────────────────────────────────────────────────────────────
// REWARDS
// ─────────────────────────────────────────────────────────────────────
function createReward(data) {
  const { guildId, rewardId, requiredInvites, type, roleId, name, description, oneTime } = data;
  db.prepare(`
    INSERT INTO invite_rewards (guild_id, reward_id, required_invites, type, role_id, name, description, enabled, one_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(guild_id, reward_id) DO UPDATE SET
      required_invites = excluded.required_invites, type = excluded.type, role_id = excluded.role_id,
      name = excluded.name, description = excluded.description, one_time = excluded.one_time
  `).run(guildId, rewardId, requiredInvites, type || 'cargo', roleId || null, name, description || null, oneTime === false ? 0 : 1, now());
  return getReward(guildId, rewardId);
}

function getReward(guildId, rewardId) {
  return db.prepare(`SELECT * FROM invite_rewards WHERE guild_id = ? AND reward_id = ?`).get(guildId, rewardId);
}

function listRewards(guildId, onlyEnabled = true) {
  if (onlyEnabled) return db.prepare(`SELECT * FROM invite_rewards WHERE guild_id = ? AND enabled = 1 ORDER BY required_invites ASC`).all(guildId);
  return db.prepare(`SELECT * FROM invite_rewards WHERE guild_id = ? ORDER BY required_invites ASC`).all(guildId);
}

function setRewardEnabled(guildId, rewardId, enabled) {
  db.prepare(`UPDATE invite_rewards SET enabled = ? WHERE guild_id = ? AND reward_id = ?`).run(enabled ? 1 : 0, guildId, rewardId);
}

function hasClaimedReward(guildId, rewardId, userId) {
  return !!db.prepare(`SELECT 1 FROM reward_claims WHERE guild_id = ? AND reward_id = ? AND user_id = ?`).get(guildId, rewardId, userId);
}

function claimReward(guildId, rewardId, userId) {
  if (hasClaimedReward(guildId, rewardId, userId)) return false; // impede duplicação
  db.prepare(`INSERT INTO reward_claims (guild_id, reward_id, user_id, claimed_at) VALUES (?, ?, ?, ?)`)
    .run(guildId, rewardId, userId, now());
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────────────────────────────
function upsertCampaign(data) {
  const { guildId, campaignId, name, description, startDate, endDate, enabled, rewards } = data;
  db.prepare(`
    INSERT INTO invite_campaigns (guild_id, campaign_id, name, description, start_date, end_date, enabled, rewards, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, campaign_id) DO UPDATE SET
      name = excluded.name, description = excluded.description, start_date = excluded.start_date,
      end_date = excluded.end_date, enabled = excluded.enabled, rewards = excluded.rewards
  `).run(guildId, campaignId, name, description || null, startDate || null, endDate || null,
         enabled === false ? 0 : 1, rewards ? JSON.stringify(rewards) : null, now());
  return getCampaign(guildId, campaignId);
}

function getCampaign(guildId, campaignId) {
  const row = db.prepare(`SELECT * FROM invite_campaigns WHERE guild_id = ? AND campaign_id = ?`).get(guildId, campaignId);
  if (!row) return null;
  return { ...row, rewards: row.rewards ? JSON.parse(row.rewards) : [] };
}

function listCampaigns(guildId) {
  return db.prepare(`SELECT * FROM invite_campaigns WHERE guild_id = ?`).all(guildId);
}

// ─────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────
function logHistory({ guildId, userId, invitedUserId, inviteCode, action, campaignId, meta }) {
  db.prepare(`
    INSERT INTO invite_history (guild_id, user_id, invited_user_id, invite_code, action, timestamp, campaign_id, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId || null, invitedUserId || null, inviteCode || null, action, now(), campaignId || null,
         meta ? JSON.stringify(meta) : null);
}

function getHistory(guildId, { userId, limit = 50 } = {}) {
  if (userId) {
    return db.prepare(`SELECT * FROM invite_history WHERE guild_id = ? AND (user_id = ? OR invited_user_id = ?) ORDER BY timestamp DESC LIMIT ?`)
      .all(guildId, userId, userId, limit);
  }
  return db.prepare(`SELECT * FROM invite_history WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?`).all(guildId, limit);
}

// ─────────────────────────────────────────────────────────────────────
// CONFIRMAÇÃO (botão "Confirmar")
// ─────────────────────────────────────────────────────────────────────
function hasConfirmed(guildId, userId, campaignId) {
  const cid = campaignId || '_none_';
  return !!db.prepare(`SELECT 1 FROM invite_confirmations WHERE guild_id = ? AND user_id = ? AND campaign_id = ?`).get(guildId, userId, cid);
}

function confirmParticipation(guildId, userId, campaignId) {
  const cid = campaignId || '_none_';
  if (hasConfirmed(guildId, userId, cid)) return false;
  db.prepare(`INSERT INTO invite_confirmations (guild_id, user_id, campaign_id, confirmed_at) VALUES (?, ?, ?, ?)`)
    .run(guildId, userId, cid, now());
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// PARTE 2 — CRUD adicional (recompensas/campanhas/estatísticas)
// ─────────────────────────────────────────────────────────────────────
function deleteReward(guildId, rewardId) {
  db.prepare(`DELETE FROM invite_rewards WHERE guild_id = ? AND reward_id = ?`).run(guildId, rewardId);
  db.prepare(`DELETE FROM reward_claims WHERE guild_id = ? AND reward_id = ?`).run(guildId, rewardId);
}

function deleteCampaign(guildId, campaignId) {
  // Nunca apaga o histórico (invite_history) associado à campanha — só a campanha em si.
  db.prepare(`DELETE FROM invite_campaigns WHERE guild_id = ? AND campaign_id = ?`).run(guildId, campaignId);
}

function setCampaignEnabled(guildId, campaignId, enabled) {
  db.prepare(`UPDATE invite_campaigns SET enabled = ? WHERE guild_id = ? AND campaign_id = ?`)
    .run(enabled ? 1 : 0, guildId, campaignId);
}

/**
 * Campanha ativa no momento (habilitada e dentro do período, se houver).
 * Campanha sem start/end é considerada permanente.
 */
function getActiveCampaign(guildId) {
  const config = getGuildConfig(guildId);
  if (config.campaignId) {
    const c = getCampaign(guildId, config.campaignId);
    if (c && c.enabled) return c;
  }
  const all = listCampaigns(guildId).filter(c => c.enabled);
  const agora = Date.now();
  for (const c of all) {
    const inicioOk = !c.start_date || new Date(c.start_date).getTime() <= agora;
    const fimOk = !c.end_date || new Date(c.end_date).getTime() >= agora;
    if (inicioOk && fimOk) return { ...c, rewards: c.rewards ? JSON.parse(c.rewards) : [] };
  }
  return null;
}

/**
 * Estatísticas gerais da guild (para o painel /invite estatisticas).
 */
function getGuildStats(guildId) {
  const membros = db.prepare(`SELECT * FROM invite_members WHERE guild_id = ?`).all(guildId);
  let total = 0, validos = 0, atuais = 0, sairam = 0, suspeitos = 0;
  const porInviter = new Map();
  for (const r of membros) {
    total++;
    if (r.status === 'saiu') sairam++; else atuais++;
    if (r.suspicious) suspeitos++;
    if (r.valid && !r.suspicious) {
      validos++;
      if (r.inviter_id) porInviter.set(r.inviter_id, (porInviter.get(r.inviter_id) || 0) + 1);
    }
  }
  const recompensasEntregues = db.prepare(`SELECT COUNT(*) AS n FROM reward_claims WHERE guild_id = ?`).get(guildId).n;
  const maior = [...porInviter.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const campanhaAtiva = getActiveCampaign(guildId);
  return {
    total, validos, atuais, sairam, suspeitos,
    recompensasEntregues,
    maiorConvidador: maior ? { userId: maior[0], count: maior[1] } : null,
    campanhaAtiva,
  };
}

module.exports = {
  db,
  getGuildConfig, updateGuildConfig,
  upsertInvite, deleteInvite, getInvite, getGuildInvites, getUserInvite,
  getMember, createMember, markMemberRejoined, markMemberLeft, setMemberValidity, markSuspicious,
  getMembersByInviter, getInviterStats, getRanking, getUserPosition,
  createReward, getReward, listRewards, setRewardEnabled, hasClaimedReward, claimReward, deleteReward,
  upsertCampaign, getCampaign, listCampaigns, deleteCampaign, setCampaignEnabled, getActiveCampaign,
  logHistory, getHistory,
  hasConfirmed, confirmParticipation,
  getGuildStats,
};
