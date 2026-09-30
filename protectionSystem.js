/**
 * ═══════════════════════════════════════════════════════════════════
 *  KAEL — SISTEMA DE PROTEÇÃO (ARQUIVO ÚNICO CONSOLIDADO)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Este arquivo junta em um só lugar tudo que originalmente estava
 *  separado em:
 *    - database/protectionDb.js       (camada SQLite)
 *    - protection-system/protectionManager.js  (painel Components V2)
 *    - protection-system/detectors/antiRaidDetector.js
 *    - protection-system/detectors/antiMessageDetector.js
 *    - protection-system/detectors/antiServerDetector.js
 *    - handlers/protectionScheduler.js
 *
 *  Motivo: facilitar upload único pelo Replit. Cada seção abaixo é
 *  exposta como um sub-objeto do module.exports (ex: PDB, Manager,
 *  RaidDetector, MessageDetector, ServerDetector, Scheduler), para
 *  que o index.js e o buttonHandler.js consigam importar exatamente
 *  as mesmas funções que usariam dos arquivos separados.
 *
 *  Onde colocar este arquivo: raiz do projeto, como
 *  "protectionSystem.js" (ao lado de index.js).
 *
 *  Como importar nos outros arquivos (troque os requires antigos):
 *    const { PDB, Manager, RaidDetector, MessageDetector,
 *            ServerDetector, Scheduler } = require('./protectionSystem');
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const {
  AuditLogEvent, PermissionFlagsBits,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder,
  ChannelType, MessageFlags,
} = require('discord.js');


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 1/6 — PDB (antes: database/protectionDb.js)
// Camada de acesso ao SQLite do Sistema de Proteção.
// ═══════════════════════════════════════════════════════════════════
const PDB = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Sistema de Proteção — Camada de Banco (SQLite)
 *
 *  Único ponto de acesso ao banco SQLite do Sistema de Proteção.
 *  Nenhum outro arquivo do projeto deve importar `better-sqlite3`
 *  diretamente nem escrever SQL fora daqui — isso é o que garante
 *  que qualquer mudança de schema ou de driver fique concentrada
 *  em um só lugar.
 *
 *  Por que um banco separado do resto do bot (database/db.js)?
 *  O restante do KAEL (loja, sorteios, tickets) usa JSON e
 *  continua usando JSON — isso NÃO foi alterado. O Sistema de
 *  Proteção foi pedido explicitamente em SQLite (better-sqlite3),
 *  então ele vive em seu próprio arquivo .sqlite, sem interferir
 *  em nada do que já funciona.
 *
 *  Arquivo do banco: database/protection.sqlite (criado automaticamente
 *  na primeira execução, com todas as tabelas).
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';


const DB_PATH = path.join(require('./database/dataDir').DATA_DIR, 'protection.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // melhor concorrência leitura/escrita, recomendado p/ bots
db.pragma('foreign_keys = ON');

// ═══════════════════════════════════════════════════════════════════
// SCHEMA — criado uma única vez, idempotente (CREATE TABLE IF NOT EXISTS)
// ═══════════════════════════════════════════════════════════════════

db.exec(`
CREATE TABLE IF NOT EXISTS protection_config (
  guild_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  log_channel_id  TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT
);

CREATE TABLE IF NOT EXISTS protection_modules (
  guild_id        TEXT NOT NULL,
  module_key      TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 0,
  settings_json   TEXT NOT NULL DEFAULT '{}',
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  PRIMARY KEY (guild_id, module_key)
);

CREATE TABLE IF NOT EXISTS protection_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  module_key   TEXT NOT NULL,
  executor_id  TEXT,
  target_id    TEXT,
  channel_id   TEXT,
  reason       TEXT,
  action       TEXT,
  result       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protection_logs_guild ON protection_logs (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS protection_whitelist (
  guild_id    TEXT NOT NULL,
  module_key  TEXT NOT NULL, -- 'global' aplica a todos os módulos
  entry_type  TEXT NOT NULL, -- 'user' | 'role' | 'channel'
  entry_id    TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  added_by    TEXT,
  PRIMARY KEY (guild_id, module_key, entry_type, entry_id)
);

CREATE TABLE IF NOT EXISTS protection_blacklist (
  guild_id    TEXT NOT NULL,
  entry_type  TEXT NOT NULL, -- 'user' | 'role'
  entry_id    TEXT NOT NULL,
  reason      TEXT,
  added_at    TEXT NOT NULL,
  added_by    TEXT,
  PRIMARY KEY (guild_id, entry_type, entry_id)
);

CREATE TABLE IF NOT EXISTS protection_quarantine_config (
  guild_id           TEXT PRIMARY KEY,
  role_id            TEXT,
  allowed_channel_id TEXT,
  duration_ms        INTEGER,      -- null = permanece até liberação manual
  message_template   TEXT,
  auto_release       INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protection_quarantine_active (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  reason        TEXT,
  applied_by    TEXT,
  applied_at    TEXT NOT NULL,
  release_at    TEXT, -- null = sem liberação automática agendada
  roles_backup  TEXT, -- JSON com os cargos que o usuário tinha antes (p/ restaurar)
  PRIMARY KEY (guild_id, user_id)
);
`);

// ═══════════════════════════════════════════════════════════════════
// STATEMENTS PREPARADOS (reaproveitados — melhor performance)
// ═══════════════════════════════════════════════════════════════════

const stmts = {
  getConfig: db.prepare('SELECT * FROM protection_config WHERE guild_id = ?'),
  upsertConfig: db.prepare(`
    INSERT INTO protection_config (guild_id, enabled, log_channel_id, updated_at, updated_by)
    VALUES (@guild_id, @enabled, @log_channel_id, @updated_at, @updated_by)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = excluded.enabled,
      log_channel_id = excluded.log_channel_id,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `),

  getModule: db.prepare('SELECT * FROM protection_modules WHERE guild_id = ? AND module_key = ?'),
  getModulesByGuild: db.prepare('SELECT * FROM protection_modules WHERE guild_id = ?'),
  upsertModule: db.prepare(`
    INSERT INTO protection_modules (guild_id, module_key, enabled, settings_json, updated_at, updated_by)
    VALUES (@guild_id, @module_key, @enabled, @settings_json, @updated_at, @updated_by)
    ON CONFLICT(guild_id, module_key) DO UPDATE SET
      enabled = excluded.enabled,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `),

  insertLog: db.prepare(`
    INSERT INTO protection_logs (guild_id, module_key, executor_id, target_id, channel_id, reason, action, result, created_at)
    VALUES (@guild_id, @module_key, @executor_id, @target_id, @channel_id, @reason, @action, @result, @created_at)
  `),
  getLogsByGuild: db.prepare('SELECT * FROM protection_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?'),
  countLogsByGuild: db.prepare('SELECT COUNT(*) as total FROM protection_logs WHERE guild_id = ?'),

  addWhitelist: db.prepare(`
    INSERT OR IGNORE INTO protection_whitelist (guild_id, module_key, entry_type, entry_id, added_at, added_by)
    VALUES (@guild_id, @module_key, @entry_type, @entry_id, @added_at, @added_by)
  `),
  removeWhitelist: db.prepare('DELETE FROM protection_whitelist WHERE guild_id = ? AND module_key = ? AND entry_type = ? AND entry_id = ?'),
  getWhitelist: db.prepare('SELECT * FROM protection_whitelist WHERE guild_id = ? AND (module_key = ? OR module_key = \'global\')'),

  addBlacklist: db.prepare(`
    INSERT OR REPLACE INTO protection_blacklist (guild_id, entry_type, entry_id, reason, added_at, added_by)
    VALUES (@guild_id, @entry_type, @entry_id, @reason, @added_at, @added_by)
  `),
  removeBlacklist: db.prepare('DELETE FROM protection_blacklist WHERE guild_id = ? AND entry_type = ? AND entry_id = ?'),
  getBlacklist: db.prepare('SELECT * FROM protection_blacklist WHERE guild_id = ?'),
  isBlacklisted: db.prepare('SELECT 1 FROM protection_blacklist WHERE guild_id = ? AND entry_type = ? AND entry_id = ?'),

  getQuarantineConfig: db.prepare('SELECT * FROM protection_quarantine_config WHERE guild_id = ?'),
  upsertQuarantineConfig: db.prepare(`
    INSERT INTO protection_quarantine_config (guild_id, role_id, allowed_channel_id, duration_ms, message_template, auto_release, updated_at)
    VALUES (@guild_id, @role_id, @allowed_channel_id, @duration_ms, @message_template, @auto_release, @updated_at)
    ON CONFLICT(guild_id) DO UPDATE SET
      role_id = excluded.role_id,
      allowed_channel_id = excluded.allowed_channel_id,
      duration_ms = excluded.duration_ms,
      message_template = excluded.message_template,
      auto_release = excluded.auto_release,
      updated_at = excluded.updated_at
  `),

  addQuarantine: db.prepare(`
    INSERT OR REPLACE INTO protection_quarantine_active (guild_id, user_id, reason, applied_by, applied_at, release_at, roles_backup)
    VALUES (@guild_id, @user_id, @reason, @applied_by, @applied_at, @release_at, @roles_backup)
  `),
  removeQuarantine: db.prepare('DELETE FROM protection_quarantine_active WHERE guild_id = ? AND user_id = ?'),
  getQuarantine: db.prepare('SELECT * FROM protection_quarantine_active WHERE guild_id = ? AND user_id = ?'),
  getAllQuarantined: db.prepare('SELECT * FROM protection_quarantine_active WHERE guild_id = ?'),
  getAllQuarantinedGlobal: db.prepare('SELECT * FROM protection_quarantine_active'),
};

// ═══════════════════════════════════════════════════════════════════
// LISTA DE MÓDULOS SUPORTADOS — fonte única da verdade (usada pelo
// painel para renderizar botões e pelo detector de eventos para saber
// quais módulos existem). Adicionar um módulo novo = adicionar aqui.
// ═══════════════════════════════════════════════════════════════════

const MODULOS = {
  anti_raid:              { label: 'Anti Raid',              emoji: '<:safety:1528841000548569239>' },
  anti_spam:               { label: 'Anti Spam',               emoji: '🚫' },
  anti_flood:              { label: 'Anti Flood',              emoji: '🌊' },
  anti_link:               { label: 'Anti Link',               emoji: '<:link:1533251823778005082>' },
  anti_convite:            { label: 'Anti Convite',            emoji: '<:text:1533089802856038461>' },
  anti_scam:               { label: 'Anti Scam',               emoji: '⚠️' },
  anti_bot:                { label: 'Anti Bot',                emoji: '<:bot:1524207085850591273>' },
  anti_fake_account:       { label: 'Anti Fake Account',       emoji: '<:user:1532137085081878558>' },
  anti_mass_join:          { label: 'Anti Mass Join',          emoji: '👥' },
  anti_mention:            { label: 'Anti Mention',            emoji: '<:canal:1524207214791884890>' },
  anti_ghost_ping:         { label: 'Anti Ghost Ping',         emoji: '👻' },
  anti_webhook:            { label: 'Anti Webhook',            emoji: '🪝' },
  anti_channel_delete:     { label: 'Anti Channel Delete',     emoji: '<:apagar:1524206738885050388>' },
  anti_channel_create:     { label: 'Anti Channel Create',     emoji: '<:mais2:1528400709018583100>' },
  anti_channel_update:     { label: 'Anti Channel Update',     emoji: '<:editar:1528400388137549864>' },
  anti_role_delete:        { label: 'Anti Role Delete',        emoji: '<:apagar:1524206738885050388>' },
  anti_role_create:        { label: 'Anti Role Create',        emoji: '<:mais2:1528400709018583100>' },
  anti_role_update:        { label: 'Anti Role Update',        emoji: '<:editar:1528400388137549864>' },
  anti_emoji_delete:       { label: 'Anti Emoji Delete',       emoji: '<:apagar:1524206738885050388>' },
  anti_emoji_create:       { label: 'Anti Emoji Create',       emoji: '<:mais2:1528400709018583100>' },
  anti_emoji_update:       { label: 'Anti Emoji Update',       emoji: '<:editar:1528400388137549864>' },
  anti_permission_abuse:   { label: 'Anti Permission Abuse',   emoji: '🔐' },
};

// Configurações padrão por módulo — usadas quando o módulo ainda não
// tem settings_json salvo no banco (primeira vez que é acessado).
const DEFAULT_SETTINGS = {
  anti_raid:            { maxEntradasPorMinuto: 10, maxCanaisPorMinuto: 3, maxCargosPorMinuto: 3, maxWebhooksPorMinuto: 3, acao: 'quarentena' },
  anti_spam:             { maxMensagens: 5, intervaloMs: 5000, acao: 'timeout', timeoutMs: 600000 },
  anti_flood:            { maxMensagensIguais: 3, intervaloMs: 10000, acao: 'timeout', timeoutMs: 300000 },
  anti_link:             { acao: 'apagar', permitirDiscordGg: false },
  anti_convite:          { acao: 'apagar' },
  anti_scam:             { acao: 'ban' },
  anti_bot:              { acao: 'kick' },
  anti_fake_account:     { minimoDiasConta: 7, acao: 'kick' },
  anti_mass_join:        { maxEntradasPorIntervalo: 5, intervaloMs: 10000, acao: 'modo_emergencia' },
  anti_mention:          { maxMencoesPormensagem: 5, acao: 'timeout', timeoutMs: 300000 },
  anti_ghost_ping:       { acao: 'registrar' },
  anti_webhook:          { acao: 'remover' },
  anti_channel_delete:   { maxPorMinuto: 3, acao: 'remover_cargos' },
  anti_channel_create:   { maxPorMinuto: 3, acao: 'remover_cargos' },
  anti_channel_update:   { maxPorMinuto: 5, acao: 'registrar' },
  anti_role_delete:      { maxPorMinuto: 3, acao: 'remover_cargos' },
  anti_role_create:      { maxPorMinuto: 3, acao: 'remover_cargos' },
  anti_role_update:      { maxPorMinuto: 5, acao: 'registrar' },
  anti_emoji_delete:     { maxPorMinuto: 5, acao: 'registrar' },
  anti_emoji_create:     { maxPorMinuto: 5, acao: 'registrar' },
  anti_emoji_update:     { maxPorMinuto: 5, acao: 'registrar' },
  anti_permission_abuse: { acao: 'remover_cargos' },
};

// ═══════════════════════════════════════════════════════════════════
// FUNÇÕES PÚBLICAS — único jeito de outros arquivos tocarem no banco
// ═══════════════════════════════════════════════════════════════════

function nowISO() { return new Date().toISOString(); }

// ── Config geral da proteção (guild) ──
function getProtectionConfig(guildId) {
  const row = stmts.getConfig.get(guildId);
  if (!row) {
    return { guild_id: guildId, enabled: false, log_channel_id: null, updated_at: null, updated_by: null };
  }
  return { ...row, enabled: !!row.enabled };
}

function setProtectionConfig(guildId, patch, updatedBy) {
  const atual = getProtectionConfig(guildId);
  stmts.upsertConfig.run({
    guild_id: guildId,
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (atual.enabled ? 1 : 0),
    log_channel_id: patch.log_channel_id !== undefined ? patch.log_channel_id : atual.log_channel_id,
    updated_at: nowISO(),
    updated_by: updatedBy || null,
  });
  return getProtectionConfig(guildId);
}

// ── Módulos individuais ──
function getModuleState(guildId, moduleKey) {
  const row = stmts.getModule.get(guildId, moduleKey);
  const defaults = DEFAULT_SETTINGS[moduleKey] || {};
  if (!row) {
    return { guild_id: guildId, module_key: moduleKey, enabled: false, settings: { ...defaults }, updated_at: null, updated_by: null };
  }
  let settings;
  try { settings = { ...defaults, ...JSON.parse(row.settings_json) }; }
  catch { settings = { ...defaults }; }
  return { guild_id: guildId, module_key: moduleKey, enabled: !!row.enabled, settings, updated_at: row.updated_at, updated_by: row.updated_by };
}

function getAllModulesState(guildId) {
  const rows = stmts.getModulesByGuild.all(guildId);
  const porChave = new Map(rows.map(r => [r.module_key, r]));
  return Object.keys(MODULOS).map(key => {
    const row = porChave.get(key);
    const defaults = DEFAULT_SETTINGS[key] || {};
    if (!row) return { module_key: key, enabled: false, settings: { ...defaults }, updated_at: null, updated_by: null };
    let settings;
    try { settings = { ...defaults, ...JSON.parse(row.settings_json) }; }
    catch { settings = { ...defaults }; }
    return { module_key: key, enabled: !!row.enabled, settings, updated_at: row.updated_at, updated_by: row.updated_by };
  });
}

function setModuleEnabled(guildId, moduleKey, enabled, updatedBy) {
  const atual = getModuleState(guildId, moduleKey);
  stmts.upsertModule.run({
    guild_id: guildId,
    module_key: moduleKey,
    enabled: enabled ? 1 : 0,
    settings_json: JSON.stringify(atual.settings),
    updated_at: nowISO(),
    updated_by: updatedBy || null,
  });
  return getModuleState(guildId, moduleKey);
}

function setModuleSettings(guildId, moduleKey, patchSettings, updatedBy) {
  const atual = getModuleState(guildId, moduleKey);
  const novasSettings = { ...atual.settings, ...patchSettings };
  stmts.upsertModule.run({
    guild_id: guildId,
    module_key: moduleKey,
    enabled: atual.enabled ? 1 : 0,
    settings_json: JSON.stringify(novasSettings),
    updated_at: nowISO(),
    updated_by: updatedBy || null,
  });
  return getModuleState(guildId, moduleKey);
}

function countModulosAtivos(guildId) {
  return getAllModulesState(guildId).filter(m => m.enabled).length;
}

// ── Logs ──
function registrarLog(guildId, { moduleKey, executorId, targetId, channelId, reason, action, result }) {
  stmts.insertLog.run({
    guild_id: guildId,
    module_key: moduleKey || null,
    executor_id: executorId || null,
    target_id: targetId || null,
    channel_id: channelId || null,
    reason: reason || null,
    action: action || null,
    result: result || null,
    created_at: nowISO(),
  });
}

function getLogs(guildId, limite = 10) {
  return stmts.getLogsByGuild.all(guildId, limite);
}

function countLogs(guildId) {
  return stmts.countLogsByGuild.get(guildId).total;
}

// ── Whitelist / Blacklist ──
function addWhitelist(guildId, moduleKey, entryType, entryId, addedBy) {
  stmts.addWhitelist.run({ guild_id: guildId, module_key: moduleKey || 'global', entry_type: entryType, entry_id: entryId, added_at: nowISO(), added_by: addedBy || null });
}
function removeWhitelist(guildId, moduleKey, entryType, entryId) {
  stmts.removeWhitelist.run(guildId, moduleKey || 'global', entryType, entryId);
}
function getWhitelist(guildId, moduleKey) {
  return stmts.getWhitelist.all(guildId, moduleKey || 'global');
}
function isWhitelisted(guildId, moduleKey, entryType, entryId) {
  return getWhitelist(guildId, moduleKey).some(w => w.entry_type === entryType && w.entry_id === entryId);
}

function addBlacklist(guildId, entryType, entryId, reason, addedBy) {
  stmts.addBlacklist.run({ guild_id: guildId, entry_type: entryType, entry_id: entryId, reason: reason || null, added_at: nowISO(), added_by: addedBy || null });
}
function removeBlacklist(guildId, entryType, entryId) {
  stmts.removeBlacklist.run(guildId, entryType, entryId);
}
function getBlacklist(guildId) {
  return stmts.getBlacklist.all(guildId);
}
function isBlacklisted(guildId, entryType, entryId) {
  return !!stmts.isBlacklisted.get(guildId, entryType, entryId);
}

// ── Quarentena ──
function getQuarantineConfig(guildId) {
  const row = stmts.getQuarantineConfig.get(guildId);
  if (!row) {
    return { guild_id: guildId, role_id: null, allowed_channel_id: null, duration_ms: null, message_template: null, auto_release: false, updated_at: null };
  }
  return { ...row, auto_release: !!row.auto_release };
}

function setQuarantineConfig(guildId, patch) {
  const atual = getQuarantineConfig(guildId);
  stmts.upsertQuarantineConfig.run({
    guild_id: guildId,
    role_id: patch.role_id !== undefined ? patch.role_id : atual.role_id,
    allowed_channel_id: patch.allowed_channel_id !== undefined ? patch.allowed_channel_id : atual.allowed_channel_id,
    duration_ms: patch.duration_ms !== undefined ? patch.duration_ms : atual.duration_ms,
    message_template: patch.message_template !== undefined ? patch.message_template : atual.message_template,
    auto_release: patch.auto_release !== undefined ? (patch.auto_release ? 1 : 0) : (atual.auto_release ? 1 : 0),
    updated_at: nowISO(),
  });
  return getQuarantineConfig(guildId);
}

function addQuarantineActive(guildId, userId, { reason, appliedBy, releaseAt, rolesBackup }) {
  stmts.addQuarantine.run({
    guild_id: guildId,
    user_id: userId,
    reason: reason || null,
    applied_by: appliedBy || null,
    applied_at: nowISO(),
    release_at: releaseAt || null,
    roles_backup: JSON.stringify(rolesBackup || []),
  });
}

function removeQuarantineActive(guildId, userId) {
  stmts.removeQuarantine.run(guildId, userId);
}

function getQuarantineActive(guildId, userId) {
  const row = stmts.getQuarantine.get(guildId, userId);
  if (!row) return null;
  let rolesBackup = [];
  try { rolesBackup = JSON.parse(row.roles_backup || '[]'); } catch {}
  return { ...row, roles_backup: rolesBackup };
}

function getAllQuarantinedByGuild(guildId) {
  return stmts.getAllQuarantined.all(guildId).map(row => {
    let rolesBackup = [];
    try { rolesBackup = JSON.parse(row.roles_backup || '[]'); } catch {}
    return { ...row, roles_backup: rolesBackup };
  });
}

function getAllQuarantinedGlobal() {
  return stmts.getAllQuarantinedGlobal.all().map(row => {
    let rolesBackup = [];
    try { rolesBackup = JSON.parse(row.roles_backup || '[]'); } catch {}
    return { ...row, roles_backup: rolesBackup };
  });
}



  return {
  MODULOS,
  DEFAULT_SETTINGS,
  getProtectionConfig, setProtectionConfig,
  getModuleState, getAllModulesState, setModuleEnabled, setModuleSettings, countModulosAtivos,
  db, // exposto pro sistema de backup (database/backupSqlite.js) conseguir fazer .backup() nele
  registrarLog, getLogs, countLogs,
  addWhitelist, removeWhitelist, getWhitelist, isWhitelisted,
  addBlacklist, removeBlacklist, getBlacklist, isBlacklisted,
  getQuarantineConfig, setQuarantineConfig,
  addQuarantineActive, removeQuarantineActive, getQuarantineActive, getAllQuarantinedByGuild, getAllQuarantinedGlobal,
};
})();


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 2/6 — Manager (antes: protection-system/protectionManager.js)
// Painel principal do Sistema de Proteção (Components V2).
// ═══════════════════════════════════════════════════════════════════
const Manager = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Sistema de Proteção
 *
 *  Painel acionado pelo botão "<:safety:1528841000548569239> Sistema de Proteção" do /painel.
 *  100% em Components V2, seguindo o mesmo padrão visual de
 *  commands/painel.js e sorteio-system/sorteioManager.js.
 *
 *  Toda leitura/escrita passa por database/protectionDb.js (SQLite,
 *  better-sqlite3) — nunca lê/escreve o banco diretamente aqui.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';



const COR_PADRAO = 0x000000;

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatarData(iso) {
  if (!iso) return '`Nunca`';
  const d = new Date(iso);
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

const ACOES_DISPONIVEIS = [
  { value: 'registrar', label: 'Apenas registrar', emoji: '📝' },
  { value: 'avisar', label: 'Avisar', emoji: '⚠️' },
  { value: 'timeout', label: 'Timeout', emoji: '⏳' },
  { value: 'kick', label: 'Expulsar (Kick)', emoji: '👢' },
  { value: 'ban', label: 'Banir', emoji: '<:tools1:1533222180408791080>' },
  { value: 'remover_cargos', label: 'Remover cargos', emoji: '<:user:1532137085081878558>' },
  { value: 'quarentena', label: 'Colocar em quarentena', emoji: '<:CadLock:1533221942256078968>' },
];

function labelAcao(acao) {
  const found = ACOES_DISPONIVEIS.find(a => a.value === acao);
  return found ? `${found.emoji} ${found.label}` : `\`${acao}\``;
}

async function aplicarPunicao(guild, userId, acao, motivo, moduleKey, extras = {}) {
  const membro = await guild.members.fetch(userId).catch(() => null);
  let resultado = 'falhou';
  try {
    switch (acao) {
      case 'registrar':
        resultado = 'registrado';
        break;
      case 'avisar':
        if (membro) await membro.send(`⚠️ Você recebeu um aviso em **${guild.name}**: ${motivo}`).catch(() => {});
        resultado = 'avisado';
        break;
      case 'timeout':
        if (membro) await membro.timeout(extras.timeoutMs || 600000, motivo).catch(() => {});
        resultado = 'timeout aplicado';
        break;
      case 'kick':
        if (membro) await membro.kick(motivo).catch(() => {});
        resultado = 'expulso';
        break;
      case 'ban':
        if (membro) await membro.ban({ reason: motivo }).catch(() => {});
        else await guild.bans.create(userId, { reason: motivo }).catch(() => {});
        resultado = 'banido';
        break;
      case 'remover_cargos':
        if (membro) {
          const cargosRemover = membro.roles.cache.filter(r => r.id !== guild.id);
          await membro.roles.remove(cargosRemover, motivo).catch(() => {});
        }
        resultado = 'cargos removidos';
        break;
      case 'quarentena':
        if (membro) await colocarEmQuarentena(guild, membro, motivo);
        resultado = 'quarentena aplicada';
        break;
      default:
        resultado = 'ação desconhecida';
    }
  } catch (e) {
    console.error(`[Proteção] Erro ao aplicar punição "${acao}":`, e.message);
    resultado = `erro: ${e.message}`;
  }

  PDB.registrarLog(guild.id, {
    moduleKey, executorId: 'sistema', targetId: userId,
    reason: motivo, action: acao, result: resultado,
  });

  return resultado;
}

async function colocarEmQuarentena(guild, membro, motivo) {
  const cfg = PDB.getQuarantineConfig(guild.id);
  if (!cfg.role_id) {
    console.warn(`[Quarentena] Cargo de quarentena não configurado em "${guild.name}".`);
    return;
  }
  const rolesBackup = membro.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
  await membro.roles.set([cfg.role_id], motivo).catch(() => {});

  const releaseAt = cfg.duration_ms ? new Date(Date.now() + cfg.duration_ms).toISOString() : null;
  PDB.addQuarantineActive(guild.id, membro.id, { reason: motivo, appliedBy: 'sistema', releaseAt, rolesBackup });

  if (cfg.message_template) {
    await membro.send(cfg.message_template.replace('{motivo}', motivo || 'não especificado').replace('{servidor}', guild.name)).catch(() => {});
  }

  if (cfg.duration_ms && cfg.auto_release) {
    const { agendarLiberacaoQuarentena } = Scheduler;
    agendarLiberacaoQuarentena(guild.client, guild.id, membro.id, cfg.duration_ms);
  }
}

async function liberarDaQuarentena(guild, userId) {
  const registro = PDB.getQuarantineActive(guild.id, userId);
  if (!registro) return false;
  const membro = await guild.members.fetch(userId).catch(() => null);
  if (membro) {
    const cargosValidos = registro.roles_backup.filter(id => guild.roles.cache.has(id));
    await membro.roles.set(cargosValidos, 'Liberação da quarentena').catch(() => {});
  }
  PDB.removeQuarantineActive(guild.id, userId);
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// PAINEL PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

function buildPainelProtecaoContainer(guild) {
  const cfg = PDB.getProtectionConfig(guild.id);
  const totalModulos = Object.keys(PDB.MODULOS).length;
  const ativos = PDB.countModulosAtivos(guild.id);
  const totalLogs = PDB.countLogs(guild.id);

  const statusTexto = cfg.enabled ? '<:online:1533081467918221565> Ativa' : '<:npertubar:1533081528966316083> Desativada';

  return new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# <:safety:1528841000548569239> Sistema de Proteção\n` +
        `-# Proteção completa contra raids, spam e abusos administrativos.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Status da proteção:** ${statusTexto}\n` +
        `**Módulos ativos:** \`${ativos}/${totalModulos}\`\n` +
        `**Canal de logs:** ${cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : '`Não configurado`'}\n` +
        `**Última alteração:** ${formatarData(cfg.updated_at)}\n` +
        `**Registros no histórico:** \`${totalLogs}\``
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_toggle_geral').setLabel(cfg.enabled ? 'Desativar Proteção' : 'Ativar Proteção').setEmoji(cfg.enabled ? '<:npertubar:1533081528966316083>' : '<:online:1533081467918221565>').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('prot_modulos').setLabel('Módulos').setEmoji('<:config2:1524208021071462533>').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_quarentena').setLabel('Quarentena').setEmoji('<:CadLock:1533221942256078968>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('prot_listas').setLabel('Whitelist / Blacklist').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_logs').setLabel('Logs').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('prot_canal_logs').setLabel('Canal de Logs').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_voltar_painel').setLabel('Voltar ao Painel').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );
}

function painelProtecaoPayload(guild) {
  return { components: [buildPainelProtecaoContainer(guild)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

async function abrirPainelProtecao(interaction) {
  const payload = painelProtecaoPayload(interaction.guild);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(payload);
  return interaction.reply(payload);
}

async function toggleProtecaoGeral(interaction) {
  const cfg = PDB.getProtectionConfig(interaction.guildId);
  PDB.setProtectionConfig(interaction.guildId, { enabled: !cfg.enabled }, interaction.user.id);
  return abrirPainelProtecao(interaction);
}

// ═══════════════════════════════════════════════════════════════════
// LISTA DE MÓDULOS (paginada — 21 módulos, ~7 por página em botões)
// ═══════════════════════════════════════════════════════════════════

const MODULOS_POR_PAGINA = 8;

function buildModulosContainer(guild, pagina = 0) {
  const chaves = Object.keys(PDB.MODULOS);
  const totalPaginas = Math.ceil(chaves.length / MODULOS_POR_PAGINA);
  const inicio = pagina * MODULOS_POR_PAGINA;
  const chavesPagina = chaves.slice(inicio, inicio + MODULOS_POR_PAGINA);

  const container = new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:config2:1524208021071462533> Módulos de Proteção\n-# Página ${pagina + 1}/${totalPaginas}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const linhas = chavesPagina.map(key => {
    const info = PDB.MODULOS[key];
    const estado = PDB.getModuleState(guild.id, key);
    const statusIcon = estado.enabled ? '<:online:1533081467918221565>' : '<:npertubar:1533081528966316083>';
    return `${statusIcon} ${info.emoji} **${info.label}**\n` +
      `-# Última alteração: ${formatarData(estado.updated_at)}${estado.updated_by ? ` por <@${estado.updated_by}>` : ''}`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhas.join('\n\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

  const options = chavesPagina.map(key => ({
    label: PDB.MODULOS[key].label,
    value: key,
    emoji: PDB.MODULOS[key].emoji,
    description: PDB.getModuleState(guild.id, key).enabled ? 'Ativo — clique para configurar' : 'Inativo — clique para configurar',
  }));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`prot_sel_modulo_${pagina}`).setPlaceholder('<:config2:1524208021071462533> Selecione um módulo para configurar...').addOptions(options)
    )
  );

  const rowNav = new ActionRowBuilder();
  if (pagina > 0) rowNav.addComponents(new ButtonBuilder().setCustomId(`prot_modulos_pag_${pagina - 1}`).setLabel('Anterior').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary));
  if (pagina < totalPaginas - 1) rowNav.addComponents(new ButtonBuilder().setCustomId(`prot_modulos_pag_${pagina + 1}`).setLabel('Próxima').setEmoji('<:arrow:1524206792626933831>').setStyle(ButtonStyle.Secondary));
  rowNav.addComponents(new ButtonBuilder().setCustomId('prot_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary));
  container.addActionRowComponents(rowNav);

  return container;
}

async function abrirModulos(interaction, pagina = 0) {
  const container = buildModulosContainer(interaction.guild, pagina);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE UM MÓDULO ESPECÍFICO
// ═══════════════════════════════════════════════════════════════════

function buildModuloConfigContainer(guild, moduleKey) {
  const info = PDB.MODULOS[moduleKey];
  const estado = PDB.getModuleState(guild.id, moduleKey);

  const settingsTexto = Object.entries(estado.settings)
    .map(([k, v]) => {
      if (k === 'acao') return `<:config3:1524208114327617588> **Ação:** ${labelAcao(v)}`;
      return `🔧 **${k}:** \`${v}\``;
    }).join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(estado.enabled ? 0x00C851 : 0x555555)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${info.emoji} ${info.label}\n` +
        `**Status:** ${estado.enabled ? '<:online:1533081467918221565> Ativo' : '<:npertubar:1533081528966316083> Inativo'}\n` +
        `**Última alteração:** ${formatarData(estado.updated_at)}${estado.updated_by ? ` por <@${estado.updated_by}>` : ''}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(settingsTexto || '_Sem configurações específicas._'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`prot_mod_toggle_${moduleKey}`).setLabel(estado.enabled ? 'Desativar' : 'Ativar').setEmoji(estado.enabled ? '<:npertubar:1533081528966316083>' : '<:online:1533081467918221565>').setStyle(estado.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`prot_mod_config_${moduleKey}`).setLabel('Editar Configurações').setEmoji('<:config3:1524208114327617588>').setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`prot_mod_acao_${moduleKey}`).setLabel('Definir Ação/Punição').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('prot_modulos').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );

  return container;
}

async function abrirModuloConfig(interaction, moduleKey) {
  if (!PDB.MODULOS[moduleKey]) return interaction.reply({ content: '<:negativo:1528400986744295475> Módulo inválido.', flags: 64 });
  const container = buildModuloConfigContainer(interaction.guild, moduleKey);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function toggleModulo(interaction, moduleKey) {
  const estado = PDB.getModuleState(interaction.guildId, moduleKey);
  PDB.setModuleEnabled(interaction.guildId, moduleKey, !estado.enabled, interaction.user.id);
  return abrirModuloConfig(interaction, moduleKey);
}

function buildModalConfigModulo(guild, moduleKey) {
  const estado = PDB.getModuleState(guild.id, moduleKey);
  const info = PDB.MODULOS[moduleKey];
  const modal = new ModalBuilder().setCustomId(`prot_modal_config_${moduleKey}`).setTitle(`<:config3:1524208114327617588> ${info.label}`.slice(0, 45));

  // Gera até 5 campos a partir das settings existentes (exceto 'acao', que
  // tem fluxo próprio via select menu em prot_mod_acao_).
  const campos = Object.entries(estado.settings).filter(([k]) => k !== 'acao').slice(0, 5);
  for (const [chave, valor] of campos) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`campo_${chave}`)
          .setLabel(chave.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setValue(String(valor))
          .setRequired(false)
      )
    );
  }
  return modal;
}

async function abrirModalConfigModulo(interaction, moduleKey) {
  // Correção: módulos cuja única configuração é "acao" (Anti Convite,
  // Anti Scam, Anti Bot, Anti Ghost Ping, Anti Webhook, Anti Permission
  // Abuse) geram um modal sem nenhum campo — o Discord rejeita modal
  // vazio e a interação quebrava com "erro interno". Agora avisamos o
  // admin em vez de tentar abrir um modal impossível.
  const estado = PDB.getModuleState(interaction.guild.id, moduleKey);
  const campos = Object.entries(estado.settings).filter(([k]) => k !== 'acao');
  if (!campos.length) {
    return interaction.reply({
      content: `ℹ️ **${PDB.MODULOS[moduleKey].label}** não tem configurações extras além da ação/punição. Use o botão **Definir Ação/Punição** para isso.`,
      flags: 64,
    });
  }
  return interaction.showModal(buildModalConfigModulo(interaction.guild, moduleKey));
}

async function processarModalConfigModulo(interaction, moduleKey) {
  const estado = PDB.getModuleState(interaction.guildId, moduleKey);
  const patch = {};
  for (const campo of Object.keys(estado.settings)) {
    if (campo === 'acao') continue;
    try {
      const valorBruto = interaction.fields.getTextInputValue(`campo_${campo}`);
      if (valorBruto === '') continue;
      const valorOriginal = estado.settings[campo];
      // Preserva o tipo original (number vs string vs boolean)
      if (typeof valorOriginal === 'number') {
        const n = Number(valorBruto);
        if (!isNaN(n)) patch[campo] = n;
      } else if (typeof valorOriginal === 'boolean') {
        patch[campo] = valorBruto.toLowerCase() === 'true' || valorBruto === '1';
      } else {
        patch[campo] = valorBruto;
      }
    } catch { /* campo não existia no modal (>5 settings) — ignora */ }
  }
  PDB.setModuleSettings(interaction.guildId, moduleKey, patch, interaction.user.id);
  return interaction.reply({ content: `<:positivo:1528401238197276702> Configurações de **${PDB.MODULOS[moduleKey].label}** atualizadas.`, flags: 64 });
}

async function abrirSelectAcaoModulo(interaction, moduleKey) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`prot_sel_acao_${moduleKey}`)
    .setPlaceholder('🎯 Escolha a punição para este módulo...')
    .addOptions(ACOES_DISPONIVEIS.map(a => ({ label: a.label, value: a.value, emoji: a.emoji })));
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// QUARENTENA
// ═══════════════════════════════════════════════════════════════════

function buildQuarentenaContainer(guild) {
  const cfg = PDB.getQuarantineConfig(guild.id);
  const ativos = PDB.getAllQuarantinedByGuild(guild.id);

  return new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:CadLock:1533221942256078968> Sistema de Quarentena'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Cargo de quarentena:** ${cfg.role_id ? `<@&${cfg.role_id}>` : '`Não configurado`'}\n` +
        `**Canal permitido:** ${cfg.allowed_channel_id ? `<#${cfg.allowed_channel_id}>` : '`Nenhum`'}\n` +
        `**Duração:** ${cfg.duration_ms ? `\`${Math.round(cfg.duration_ms / 60000)} minuto(s)\`` : '`Permanente (liberação manual)`'}\n` +
        `**Liberação automática:** ${cfg.auto_release ? '<:positivo:1528401238197276702> Sim' : '<:negativo:1528400986744295475> Não'}\n` +
        `**Usuários em quarentena agora:** \`${ativos.length}\``
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_quar_cargo').setLabel('Definir Cargo').setEmoji('<:user:1532137085081878558>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('prot_quar_canal').setLabel('Canal Permitido').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_quar_config').setLabel('Duração e Mensagem').setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('prot_quar_liberar').setLabel('Liberar Usuário').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );
}

async function abrirQuarentena(interaction) {
  const container = buildQuarentenaContainer(interaction.guild);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function pedirCargoQuarentena(interaction) {
  const select = new RoleSelectMenuBuilder().setCustomId('prot_sel_quar_cargo').setPlaceholder('<:user:1532137085081878558> Selecione o cargo de quarentena...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function pedirCanalQuarentena(interaction) {
  const select = new ChannelSelectMenuBuilder().setCustomId('prot_sel_quar_canal').setPlaceholder('<:canal:1524207214791884890> Selecione o canal permitido...').setChannelTypes(ChannelType.GuildText);
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

function buildModalQuarentenaConfig(guild) {
  const cfg = PDB.getQuarantineConfig(guild.id);
  const modal = new ModalBuilder().setCustomId('prot_modal_quar_config').setTitle('<:CadLock:1533221942256078968> Configurar Quarentena');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('duracao_min').setLabel('Duração em minutos (vazio = permanente)').setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.duration_ms ? String(Math.round(cfg.duration_ms / 60000)) : '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('auto_release').setLabel('Liberação automática? (true/false)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.auto_release))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('mensagem').setLabel('Mensagem enviada ao usuário').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(cfg.message_template || '').setPlaceholder('Use {motivo} e {servidor} como variáveis.')
    ),
  );
  return modal;
}

async function abrirModalQuarentenaConfig(interaction) {
  return interaction.showModal(buildModalQuarentenaConfig(interaction.guild));
}

async function processarModalQuarentenaConfig(interaction) {
  const duracaoStr = interaction.fields.getTextInputValue('duracao_min').trim();
  const autoReleaseStr = interaction.fields.getTextInputValue('auto_release').trim();
  const mensagem = interaction.fields.getTextInputValue('mensagem').trim();

  const patch = {};
  if (duracaoStr) {
    const n = parseInt(duracaoStr, 10);
    if (!isNaN(n) && n > 0) patch.duration_ms = n * 60000;
  } else {
    patch.duration_ms = null;
  }
  if (autoReleaseStr) patch.auto_release = autoReleaseStr.toLowerCase() === 'true';
  if (mensagem) patch.message_template = mensagem;

  PDB.setQuarantineConfig(interaction.guildId, patch);
  return interaction.reply({ content: '<:positivo:1528401238197276702> Configurações de quarentena salvas.', flags: 64 });
}

async function pedirUsuarioLiberar(interaction) {
  const select = new UserSelectMenuBuilder().setCustomId('prot_sel_quar_liberar').setPlaceholder('🔓 Selecione o usuário para liberar...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// WHITELIST / BLACKLIST
// ═══════════════════════════════════════════════════════════════════

function buildListasContainer(guild) {
  const whitelist = PDB.getWhitelist(guild.id, 'global');
  const blacklist = PDB.getBlacklist(guild.id);

  const wlTexto = whitelist.length > 0
    ? whitelist.slice(0, 10).map(w => `${w.entry_type === 'user' ? '<:user:1532137085081878558>' : w.entry_type === 'role' ? '<:user:1532137085081878558>' : '<:canal:1524207214791884890>'} <@${w.entry_type === 'role' ? '&' : ''}${w.entry_id}>`).join('\n')
    : '_Nenhum item na whitelist global._';

  const blTexto = blacklist.length > 0
    ? blacklist.slice(0, 10).map(b => `${b.entry_type === 'user' ? '<:user:1532137085081878558>' : '<:user:1532137085081878558>'} <@${b.entry_type === 'role' ? '&' : ''}${b.entry_id}> — ${b.reason || 'sem motivo'}`).join('\n')
    : '_Nenhum item na blacklist._';

  return new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:embed:1528400492982571111> Whitelist e Blacklist'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:positivo:1528401238197276702> **Whitelist Global**\n${wlTexto}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`⛔ **Blacklist**\n${blTexto}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_wl_add').setLabel('Adicionar à Whitelist').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('prot_bl_add').setLabel('Adicionar à Blacklist').setEmoji('⛔').setStyle(ButtonStyle.Danger),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prot_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );
}

async function abrirListas(interaction) {
  const container = buildListasContainer(interaction.guild);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function pedirUsuarioWhitelist(interaction) {
  const select = new UserSelectMenuBuilder().setCustomId('prot_sel_wl_add').setPlaceholder('<:positivo:1528401238197276702> Selecione o usuário para adicionar à whitelist...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function pedirUsuarioBlacklist(interaction) {
  const select = new UserSelectMenuBuilder().setCustomId('prot_sel_bl_add').setPlaceholder('⛔ Selecione o usuário para adicionar à blacklist...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════

function buildLogsContainer(guild) {
  const logs = PDB.getLogs(guild.id, 10);
  const total = PDB.countLogs(guild.id);

  const container = new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🧾 Logs de Proteção\n-# Mostrando os ${logs.length} mais recentes de \`${total}\` registros.`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (logs.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Nenhum registro ainda._'));
  } else {
    const linhas = logs.map(l => {
      const info = PDB.MODULOS[l.module_key];
      const emoji = info?.emoji || '<:safety:1528841000548569239>';
      const label = info?.label || l.module_key || 'Sistema';
      return `${emoji} **${label}** — ${labelAcao(l.action)}\n` +
        `<:user:1532137085081878558> Alvo: ${l.target_id ? `<@${l.target_id}>` : '`N/A`'} • 📝 ${l.reason || 'sem motivo'}\n` +
        `-# ${formatarData(l.created_at)} • Resultado: \`${l.result || 'N/A'}\``;
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhas.join('\n\n')));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prot_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
    )
  );

  return container;
}

async function abrirLogs(interaction) {
  const container = buildLogsContainer(interaction.guild);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function pedirCanalLogs(interaction) {
  const select = new ChannelSelectMenuBuilder().setCustomId('prot_sel_canal_logs').setPlaceholder('<:canal:1524207214791884890> Selecione o canal de logs de proteção...').setChannelTypes(ChannelType.GuildText);
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// HANDLERS DE ROTA
// ═══════════════════════════════════════════════════════════════════

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'painel_protecao' || id === 'prot_voltar_menu') return abrirPainelProtecao(interaction);
  if (id === 'prot_voltar_painel') {
    const { painelPayload } = require('./commands/painel');
    return interaction.update(painelPayload(interaction.user));
  }

  if (id === 'prot_toggle_geral') return toggleProtecaoGeral(interaction);
  if (id === 'prot_modulos') return abrirModulos(interaction, 0);
  if (id.startsWith('prot_modulos_pag_')) return abrirModulos(interaction, parseInt(id.replace('prot_modulos_pag_', ''), 10));

  if (id.startsWith('prot_mod_toggle_')) return toggleModulo(interaction, id.replace('prot_mod_toggle_', ''));
  if (id.startsWith('prot_mod_config_')) return abrirModalConfigModulo(interaction, id.replace('prot_mod_config_', ''));
  if (id.startsWith('prot_mod_acao_')) return abrirSelectAcaoModulo(interaction, id.replace('prot_mod_acao_', ''));

  if (id === 'prot_quarentena') return abrirQuarentena(interaction);
  if (id === 'prot_quar_cargo') return pedirCargoQuarentena(interaction);
  if (id === 'prot_quar_canal') return pedirCanalQuarentena(interaction);
  if (id === 'prot_quar_config') return abrirModalQuarentenaConfig(interaction);
  if (id === 'prot_quar_liberar') return pedirUsuarioLiberar(interaction);

  if (id === 'prot_listas') return abrirListas(interaction);
  if (id === 'prot_wl_add') return pedirUsuarioWhitelist(interaction);
  if (id === 'prot_bl_add') return pedirUsuarioBlacklist(interaction);

  if (id === 'prot_logs') return abrirLogs(interaction);
  if (id === 'prot_canal_logs') return pedirCanalLogs(interaction);
}

async function handleSelectMenu(interaction) {
  const id = interaction.customId;

  if (id.startsWith('prot_sel_modulo_')) return abrirModuloConfig(interaction, interaction.values[0]);
  if (id.startsWith('prot_sel_acao_')) {
    const moduleKey = id.replace('prot_sel_acao_', '');
    PDB.setModuleSettings(interaction.guildId, moduleKey, { acao: interaction.values[0] }, interaction.user.id);
    return interaction.reply({ content: `<:positivo:1528401238197276702> Ação de **${PDB.MODULOS[moduleKey].label}** definida para ${labelAcao(interaction.values[0])}.`, flags: 64 });
  }

  if (id === 'prot_sel_canal_logs') {
    PDB.setProtectionConfig(interaction.guildId, { log_channel_id: interaction.values[0] }, interaction.user.id);
    return interaction.reply({ content: `<:positivo:1528401238197276702> Canal de logs definido para <#${interaction.values[0]}>.`, flags: 64 });
  }

  if (id === 'prot_sel_quar_cargo') {
    PDB.setQuarantineConfig(interaction.guildId, { role_id: interaction.values[0] });
    return interaction.reply({ content: `<:positivo:1528401238197276702> Cargo de quarentena definido para <@&${interaction.values[0]}>.`, flags: 64 });
  }
  if (id === 'prot_sel_quar_canal') {
    PDB.setQuarantineConfig(interaction.guildId, { allowed_channel_id: interaction.values[0] });
    return interaction.reply({ content: `<:positivo:1528401238197276702> Canal permitido durante quarentena: <#${interaction.values[0]}>.`, flags: 64 });
  }
  if (id === 'prot_sel_quar_liberar') {
    const userId = interaction.values[0];
    const liberou = await liberarDaQuarentena(interaction.guild, userId);
    return interaction.reply({ content: liberou ? `<:positivo:1528401238197276702> <@${userId}> foi liberado da quarentena.` : `<:negativo:1528400986744295475> Este usuário não está em quarentena.`, flags: 64 });
  }

  if (id === 'prot_sel_wl_add') {
    PDB.addWhitelist(interaction.guildId, 'global', 'user', interaction.values[0], interaction.user.id);
    return interaction.reply({ content: `<:positivo:1528401238197276702> <@${interaction.values[0]}> adicionado à whitelist global.`, flags: 64 });
  }
  if (id === 'prot_sel_bl_add') {
    PDB.addBlacklist(interaction.guildId, 'user', interaction.values[0], 'Adicionado via painel', interaction.user.id);
    return interaction.reply({ content: `<:positivo:1528401238197276702> <@${interaction.values[0]}> adicionado à blacklist.`, flags: 64 });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (id.startsWith('prot_modal_config_')) return processarModalConfigModulo(interaction, id.replace('prot_modal_config_', ''));
  if (id === 'prot_modal_quar_config') return processarModalQuarentenaConfig(interaction);
}



  return {
  abrirPainelProtecao,
  painelProtecaoPayload,
  handleButton,
  handleSelectMenu,
  handleModal,
  aplicarPunicao,
  colocarEmQuarentena,
  liberarDaQuarentena,
};
})();


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 3/6 — RaidDetector (antes: protection-system/detectors/antiRaidDetector.js)
// ═══════════════════════════════════════════════════════════════════
const RaidDetector = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Proteção: guildMemberAdd (Anti Raid / Mass Join / Bot / Fake)
 *
 *  Detecta em memória (janela deslizante por guild) entradas em massa,
 *  contas novas e bots entrando — sem usar variáveis para CONFIGURAÇÃO
 *  (isso vem sempre de protectionDb.js). Apenas o estado transitório de
 *  "quantos entraram nos últimos N segundos" fica em memória, pois isso
 *  é inerentemente efêmero e não faz sentido persistir.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';


// guildId -> array de timestamps (ms) das últimas entradas
const janelaEntradas = new Map();

function registrarEntrada(guildId) {
  const agora = Date.now();
  const lista = janelaEntradas.get(guildId) || [];
  lista.push(agora);
  janelaEntradas.set(guildId, lista);
  return lista;
}

function contarEntradasNaJanela(guildId, intervaloMs) {
  const agora = Date.now();
  const lista = (janelaEntradas.get(guildId) || []).filter(t => agora - t <= intervaloMs);
  janelaEntradas.set(guildId, lista);
  return lista.length;
}

function idadeContaEmDias(userId) {
  const DISCORD_EPOCH = 1420070400000n;
  const timestamp = (BigInt(userId) >> 22n) + DISCORD_EPOCH;
  return (Date.now() - Number(timestamp)) / 86_400_000;
}

async function logarEEnviar(guild, moduleKey, texto) {
  const cfg = PDB.getProtectionConfig(guild.id);
  if (!cfg.log_channel_id) return;
  const canal = guild.channels.cache.get(cfg.log_channel_id) || await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  if (!canal) return;
  await canal.send({ content: texto }).catch(() => {});
}

async function handleGuildMemberAdd(member) {
  const { guild, user } = member;
  const cfgGeral = PDB.getProtectionConfig(guild.id);
  if (!cfgGeral.enabled) return;

  // Ignora quem está na whitelist global
  if (PDB.isWhitelisted(guild.id, 'global', 'user', user.id)) return;

  // Blacklist: barra a entrada de cara, independente de outros módulos
  if (PDB.isBlacklisted(guild.id, 'user', user.id)) {
    await member.kick('Usuário na blacklist de proteção').catch(() => {});
    PDB.registrarLog(guild.id, { moduleKey: 'blacklist', targetId: user.id, action: 'kick', result: 'expulso (blacklist)', reason: 'Usuário na blacklist' });
    await logarEEnviar(guild, 'blacklist', `⛔ **Blacklist** — <@${user.id}> tentou entrar e foi expulso automaticamente.`);
    return;
  }

  // ── Anti Bot ──
  const antiBot = PDB.getModuleState(guild.id, 'anti_bot');
  if (antiBot.enabled && user.bot) {
    const resultado = await aplicarEDelegar(guild, user.id, antiBot.settings.acao, 'Bot não autorizado entrou no servidor', 'anti_bot');
    await logarEEnviar(guild, 'anti_bot', `<:bot:1524207085850591273> **Anti Bot** — <@${user.id}> (bot) → ${resultado}`);
    if (['kick', 'ban'].includes(antiBot.settings.acao)) return; // já removido, não processa mais nada
  }

  // ── Anti Fake Account ──
  const antiFake = PDB.getModuleState(guild.id, 'anti_fake_account');
  if (antiFake.enabled && !user.bot) {
    const dias = idadeContaEmDias(user.id);
    if (dias < antiFake.settings.minimoDiasConta) {
      const resultado = await aplicarEDelegar(guild, user.id, antiFake.settings.acao, `Conta muito nova (${Math.floor(dias)} dia(s), mínimo ${antiFake.settings.minimoDiasConta})`, 'anti_fake_account');
      await logarEEnviar(guild, 'anti_fake_account', `<:user:1532137085081878558> **Anti Fake Account** — <@${user.id}> (conta com ${Math.floor(dias)} dia(s)) → ${resultado}`);
      if (['kick', 'ban', 'quarentena'].includes(antiFake.settings.acao)) return;
    }
  }

  // ── Anti Mass Join ──
  const antiMassJoin = PDB.getModuleState(guild.id, 'anti_mass_join');
  if (antiMassJoin.enabled) {
    registrarEntrada(guild.id);
    const qtd = contarEntradasNaJanela(guild.id, antiMassJoin.settings.intervaloMs);
    if (qtd >= antiMassJoin.settings.maxEntradasPorIntervalo) {
      await logarEEnviar(guild, 'anti_mass_join',
        `🚨 **MODO DE EMERGÊNCIA** — \`${qtd}\` entradas detectadas em ${Math.round(antiMassJoin.settings.intervaloMs / 1000)}s. Possível raid em andamento.`
      );
      PDB.registrarLog(guild.id, { moduleKey: 'anti_mass_join', action: antiMassJoin.settings.acao, result: `raid detectado (${qtd} entradas)`, reason: 'Limite de entradas por intervalo excedido' });

      if (antiMassJoin.settings.acao === 'quarentena') {
        await colocarEmQuarentenaSeguro(guild, member, 'Entrada durante possível raid (anti mass join)');
      }
    }
  }

  // ── Anti Raid (agregado — reforça a análise de mass join com o registro
  // de outros vetores de raid, como criação de canais/cargos/webhooks) ──
  const antiRaid = PDB.getModuleState(guild.id, 'anti_raid');
  if (antiRaid.enabled) {
    registrarEntrada(guild.id);
    const qtd = contarEntradasNaJanela(guild.id, 60000);
    if (qtd >= antiRaid.settings.maxEntradasPorMinuto) {
      const resultado = await aplicarEDelegar(guild, user.id, antiRaid.settings.acao, `Raid detectado: ${qtd} entradas no último minuto`, 'anti_raid');
      await logarEEnviar(guild, 'anti_raid', `<:safety:1528841000548569239> **Anti Raid** — Possível raid (\`${qtd}\` entradas/min). <@${user.id}> → ${resultado}`);
    }
  }
}

// Helper compartilhado: aplica a punição configurada delegando ao
// protectionManager (evita duplicar a lógica de kick/ban/timeout/etc. aqui).
async function aplicarEDelegar(guild, userId, acao, motivo, moduleKey) {
  const { aplicarPunicao } = Manager;
  return aplicarPunicao(guild, userId, acao, motivo, moduleKey);
}

async function colocarEmQuarentenaSeguro(guild, member, motivo) {
  const { colocarEmQuarentena } = Manager;
  await colocarEmQuarentena(guild, member, motivo).catch(e => console.error('[AntiRaid] Erro ao colocar em quarentena:', e.message));
}



  return { handleGuildMemberAdd };
})();


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 4/6 — MessageDetector (antes: protection-system/detectors/antiMessageDetector.js)
// ═══════════════════════════════════════════════════════════════════
const MessageDetector = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Proteção: messageCreate / messageDelete
 *  (Anti Spam, Anti Flood, Anti Link, Anti Convite, Anti Scam,
 *   Anti Mention, Anti Ghost Ping)
 *
 *  Configurações sempre lidas de protectionDb.js. Só o histórico
 *  recente de mensagens por usuário (janela deslizante) fica em
 *  memória — é estado transitório, não configuração.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';


// `${guildId}:${userId}` -> array de { timestamp, conteudo }
const historicoMensagens = new Map();

// Cache curto de mensagens recém-enviadas para detectar Ghost Ping
// (mensagem com menção apagada rapidamente). guildId:messageId -> { conteudo, mencoes, autorId, timestamp }
const cacheMensagensRecentes = new Map();
const GHOST_PING_JANELA_MS = 15000;

function chaveUsuario(guildId, userId) { return `${guildId}:${userId}`; }

function registrarMensagem(guildId, userId, conteudo) {
  const k = chaveUsuario(guildId, userId);
  const lista = historicoMensagens.get(k) || [];
  lista.push({ timestamp: Date.now(), conteudo });
  // mantém só os últimos 20 registros por usuário — suficiente pra
  // qualquer janela configurada sem crescer sem limite
  if (lista.length > 20) lista.shift();
  historicoMensagens.set(k, lista);
  return lista;
}

function contarNaJanela(lista, intervaloMs) {
  const agora = Date.now();
  return lista.filter(m => agora - m.timestamp <= intervaloMs).length;
}

function contarIguaisNaJanela(lista, conteudo, intervaloMs) {
  const agora = Date.now();
  return lista.filter(m => agora - m.timestamp <= intervaloMs && m.conteudo === conteudo).length;
}

const REGEX_LINK = /https?:\/\/[^\s]+/i;
const REGEX_CONVITE = /(discord\.gg|discord(app)?\.com\/invite)\/[a-z0-9-]+/i;
// Padrões comuns de scam (nitro grátis, steam, esteem, etc.) — lista
// enxuta e ajustável; não pretende ser exaustiva.
const REGEX_SCAM = /(free\s*nitro|nitro\s*grátis|steamcommunity\.[a-z]{2,}\.[a-z]{2,}|discocd|dlscord)/i;

async function logarEEnviar(guild, moduleKey, texto) {
  const cfg = PDB.getProtectionConfig(guild.id);
  if (!cfg.log_channel_id) return;
  const canal = guild.channels.cache.get(cfg.log_channel_id) || await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  if (!canal) return;
  await canal.send({ content: texto }).catch(() => {});
}

async function aplicarEDelegar(guild, userId, acao, motivo, moduleKey, extras) {
  const { aplicarPunicao } = Manager;
  return aplicarPunicao(guild, userId, acao, motivo, moduleKey, extras);
}

function usuarioIsentoDoModulo(guild, member, moduleKey) {
  if (!member) return false;
  if (member.permissions?.has?.('Administrator')) return true;
  if (PDB.isWhitelisted(guild.id, 'global', 'user', member.id)) return true;
  if (PDB.isWhitelisted(guild.id, moduleKey, 'user', member.id)) return true;
  const cargoIsento = member.roles?.cache?.some(r => PDB.isWhitelisted(guild.id, moduleKey, 'role', r.id) || PDB.isWhitelisted(guild.id, 'global', 'role', r.id));
  return !!cargoIsento;
}

async function handleMessageCreate(message) {
  if (message.author.bot || !message.guild) return;
  const { guild, author, member, channel } = message;

  const cfgGeral = PDB.getProtectionConfig(guild.id);
  if (!cfgGeral.enabled) return;

  const canalIsento = (moduleKey) => PDB.isWhitelisted(guild.id, moduleKey, 'channel', channel.id) || PDB.isWhitelisted(guild.id, 'global', 'channel', channel.id);

  // Cache pra detecção de ghost ping (guarda antes de qualquer verificação)
  const antiGhost = PDB.getModuleState(guild.id, 'anti_ghost_ping');
  if (antiGhost.enabled && message.mentions.users.size > 0) {
    cacheMensagensRecentes.set(`${guild.id}:${message.id}`, {
      conteudo: message.content,
      mencoesIds: [...message.mentions.users.keys()],
      autorId: author.id,
      channelId: channel.id,
      timestamp: Date.now(),
    });
    // limpeza preguiçosa: remove entradas velhas de vez em quando
    if (cacheMensagensRecentes.size > 500) {
      const agora = Date.now();
      for (const [k, v] of cacheMensagensRecentes) {
        if (agora - v.timestamp > GHOST_PING_JANELA_MS) cacheMensagensRecentes.delete(k);
      }
    }
  }

  const historico = registrarMensagem(guild.id, author.id, message.content);

  // ── Anti Spam (muitas mensagens em pouco tempo, conteúdo variado) ──
  const antiSpam = PDB.getModuleState(guild.id, 'anti_spam');
  if (antiSpam.enabled && !canalIsento('anti_spam') && !usuarioIsentoDoModulo(guild, member, 'anti_spam')) {
    const qtd = contarNaJanela(historico, antiSpam.settings.intervaloMs);
    if (qtd >= antiSpam.settings.maxMensagens) {
      const resultado = await aplicarEDelegar(guild, author.id, antiSpam.settings.acao, `Spam detectado (${qtd} mensagens em ${Math.round(antiSpam.settings.intervaloMs / 1000)}s)`, 'anti_spam', { timeoutMs: antiSpam.settings.timeoutMs });
      await logarEEnviar(guild, 'anti_spam', `🚫 **Anti Spam** — <@${author.id}> em <#${channel.id}> → ${resultado}`);
      historicoMensagens.set(chaveUsuario(guild.id, author.id), []); // evita reacionar em cascata
      return;
    }
  }

  // ── Anti Flood (mesma mensagem repetida) ──
  const antiFlood = PDB.getModuleState(guild.id, 'anti_flood');
  if (antiFlood.enabled && !canalIsento('anti_flood') && !usuarioIsentoDoModulo(guild, member, 'anti_flood')) {
    const qtdIguais = contarIguaisNaJanela(historico, message.content, antiFlood.settings.intervaloMs);
    if (qtdIguais >= antiFlood.settings.maxMensagensIguais) {
      const resultado = await aplicarEDelegar(guild, author.id, antiFlood.settings.acao, `Flood detectado (${qtdIguais}x a mesma mensagem)`, 'anti_flood', { timeoutMs: antiFlood.settings.timeoutMs });
      await logarEEnviar(guild, 'anti_flood', `🌊 **Anti Flood** — <@${author.id}> em <#${channel.id}> → ${resultado}`);
      historicoMensagens.set(chaveUsuario(guild.id, author.id), []);
      return;
    }
  }

  // ── Anti Scam ──
  const antiScam = PDB.getModuleState(guild.id, 'anti_scam');
  if (antiScam.enabled && !canalIsento('anti_scam') && !usuarioIsentoDoModulo(guild, member, 'anti_scam') && REGEX_SCAM.test(message.content)) {
    await message.delete().catch(() => {});
    const resultado = await aplicarEDelegar(guild, author.id, antiScam.settings.acao, 'Mensagem com padrão de scam/phishing', 'anti_scam');
    await logarEEnviar(guild, 'anti_scam', `⚠️ **Anti Scam** — <@${author.id}> em <#${channel.id}> → mensagem apagada, ${resultado}`);
    return;
  }

  // ── Anti Convite ──
  const antiConvite = PDB.getModuleState(guild.id, 'anti_convite');
  if (antiConvite.enabled && !canalIsento('anti_convite') && !usuarioIsentoDoModulo(guild, member, 'anti_convite') && REGEX_CONVITE.test(message.content)) {
    await message.delete().catch(() => {});
    const resultado = await aplicarEDelegar(guild, author.id, antiConvite.settings.acao, 'Convite de outro servidor', 'anti_convite');
    await logarEEnviar(guild, 'anti_convite', `<:text:1533089802856038461> **Anti Convite** — <@${author.id}> em <#${channel.id}> → mensagem apagada, ${resultado}`);
    return;
  }

  // ── Anti Link (genérico — qualquer URL, exceto convite já tratado acima) ──
  const antiLink = PDB.getModuleState(guild.id, 'anti_link');
  if (antiLink.enabled && !canalIsento('anti_link') && !usuarioIsentoDoModulo(guild, member, 'anti_link') && REGEX_LINK.test(message.content)) {
    const ehDiscordGg = REGEX_CONVITE.test(message.content);
    if (!(ehDiscordGg && antiLink.settings.permitirDiscordGg)) {
      await message.delete().catch(() => {});
      const resultado = await aplicarEDelegar(guild, author.id, antiLink.settings.acao, 'Link não permitido', 'anti_link');
      await logarEEnviar(guild, 'anti_link', `<:link:1533251823778005082> **Anti Link** — <@${author.id}> em <#${channel.id}> → mensagem apagada, ${resultado}`);
      return;
    }
  }

  // ── Anti Mention (menções em massa numa única mensagem) ──
  const antiMention = PDB.getModuleState(guild.id, 'anti_mention');
  if (antiMention.enabled && !canalIsento('anti_mention') && !usuarioIsentoDoModulo(guild, member, 'anti_mention')) {
    const totalMencoes = message.mentions.users.size + message.mentions.roles.size;
    if (totalMencoes >= antiMention.settings.maxMencoesPormensagem) {
      await message.delete().catch(() => {});
      const resultado = await aplicarEDelegar(guild, author.id, antiMention.settings.acao, `Menções em massa (${totalMencoes} menções)`, 'anti_mention', { timeoutMs: antiMention.settings.timeoutMs });
      await logarEEnviar(guild, 'anti_mention', `<:canal:1524207214791884890> **Anti Mention** — <@${author.id}> em <#${channel.id}> → mensagem apagada, ${resultado}`);
      return;
    }
  }
}

// Ghost Ping: mensagem com menção apagada rapidamente após ser enviada
async function handleMessageDelete(message) {
  if (!message.guild || !message.id) return;
  const guild = message.guild;
  const antiGhost = PDB.getModuleState(guild.id, 'anti_ghost_ping');
  if (!antiGhost.enabled) return;

  const k = `${guild.id}:${message.id}`;
  const registro = cacheMensagensRecentes.get(k);
  if (!registro) return; // não tinha menção, ou já expirou do cache
  cacheMensagensRecentes.delete(k);

  const decorrido = Date.now() - registro.timestamp;
  if (decorrido > GHOST_PING_JANELA_MS) return; // apagou "normalmente", não é ghost ping suspeito

  PDB.registrarLog(guild.id, {
    moduleKey: 'anti_ghost_ping', executorId: registro.autorId, targetId: registro.mencoesIds[0],
    channelId: registro.channelId, reason: 'Menção apagada rapidamente', action: antiGhost.settings.acao, result: 'registrado',
  });

  await logarEEnviar(guild, 'anti_ghost_ping',
    `👻 **Ghost Ping detectado** — <@${registro.autorId}> mencionou ${registro.mencoesIds.map(id => `<@${id}>`).join(', ')} em <#${registro.channelId}> e apagou em ${Math.round(decorrido / 1000)}s.`
  );
}



  return { handleMessageCreate, handleMessageDelete };
})();


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 5/6 — ServerDetector (antes: protection-system/detectors/antiServerDetector.js)
// ═══════════════════════════════════════════════════════════════════
const ServerDetector = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Proteção: eventos de servidor
 *  (Anti Channel/Role/Emoji Create/Update/Delete, Anti Webhook,
 *   Anti Permission Abuse)
 *
 *  Todos seguem o mesmo padrão: janela deslizante de "N ações por
 *  minuto" por executor (via audit log), configurável por módulo.
 *  Configurações sempre em protectionDb.js; só a janela de contagem
 *  fica em memória (estado transitório).
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';


// `${guildId}:${moduleKey}:${executorId}` -> array de timestamps
const janelasPorExecutor = new Map();

function registrarAcao(guildId, moduleKey, executorId) {
  const k = `${guildId}:${moduleKey}:${executorId}`;
  const agora = Date.now();
  const lista = janelasPorExecutor.get(k) || [];
  lista.push(agora);
  janelasPorExecutor.set(k, lista);
  return lista;
}

function contarNoUltimoMinuto(guildId, moduleKey, executorId) {
  const k = `${guildId}:${moduleKey}:${executorId}`;
  const agora = Date.now();
  const lista = (janelasPorExecutor.get(k) || []).filter(t => agora - t <= 60000);
  janelasPorExecutor.set(k, lista);
  return lista.length;
}

async function logarEEnviar(guild, texto) {
  const cfg = PDB.getProtectionConfig(guild.id);
  if (!cfg.log_channel_id) return;
  const canal = guild.channels.cache.get(cfg.log_channel_id) || await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  if (!canal) return;
  await canal.send({ content: texto }).catch(() => {});
}

async function aplicarEDelegar(guild, userId, acao, motivo, moduleKey) {
  const { aplicarPunicao } = Manager;
  return aplicarPunicao(guild, userId, acao, motivo, moduleKey);
}

// Busca no audit log quem executou a ação mais recente do tipo informado.
// Retorna null se não encontrar (ex.: permissões insuficientes para ver
// audit log, ou ação feita pelo próprio bot).
async function buscarExecutorNoAuditLog(guild, auditLogEvent, alvoId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 5 });
    const entry = logs.entries.find(e => !alvoId || e.target?.id === alvoId || e.targetId === alvoId) || logs.entries.first();
    if (!entry) return null;
    // Ignora entradas muito antigas (>10s) — evita atribuir a ação errada
    if (Date.now() - entry.createdTimestamp > 10000) return null;
    return entry.executor;
  } catch (e) {
    return null;
  }
}

function usuarioIsento(guild, executorId, moduleKey) {
  if (PDB.isWhitelisted(guild.id, 'global', 'user', executorId)) return true;
  if (PDB.isWhitelisted(guild.id, moduleKey, 'user', executorId)) return true;
  if (executorId === guild.client.user.id) return true; // nunca pune o próprio bot
  return false;
}

// Fluxo genérico reaproveitado por todos os módulos "N por minuto":
// registra a ação do executor, verifica limite, aplica punição se
// excedido. `context` inclui { guild, executor, moduleKey, texto }.
async function processarLimitePorMinuto({ guild, executor, moduleKey, textoEvento }) {
  if (!executor || usuarioIsento(guild, executor.id, moduleKey)) return;
  const estado = PDB.getModuleState(guild.id, moduleKey);
  if (!estado.enabled) return;

  registrarAcao(guild.id, moduleKey, executor.id);
  const qtd = contarNoUltimoMinuto(guild.id, moduleKey, executor.id);
  const limite = estado.settings.maxPorMinuto;

  if (limite != null && qtd >= limite) {
    const resultado = await aplicarEDelegar(guild, executor.id, estado.settings.acao, `${textoEvento}: ${qtd} ação(ões) em 1 minuto`, moduleKey);
    await logarEEnviar(guild, `${PDB.MODULOS[moduleKey].emoji} **${PDB.MODULOS[moduleKey].label}** — <@${executor.id}> excedeu o limite (${qtd}/${limite} por minuto) → ${resultado}`);
  } else if (estado.settings.acao === 'registrar') {
    PDB.registrarLog(guild.id, { moduleKey, executorId: executor.id, action: 'registrar', result: 'monitorado', reason: textoEvento });
  }
}

// ── Canais ──
async function handleChannelDelete(channel) {
  if (!channel.guild) return;
  const executor = await buscarExecutorNoAuditLog(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await processarLimitePorMinuto({ guild: channel.guild, executor, moduleKey: 'anti_channel_delete', textoEvento: `Canal "${channel.name}" deletado` });
}
async function handleChannelCreate(channel) {
  if (!channel.guild) return;
  const executor = await buscarExecutorNoAuditLog(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await processarLimitePorMinuto({ guild: channel.guild, executor, moduleKey: 'anti_channel_create', textoEvento: `Canal "${channel.name}" criado` });
}
async function handleChannelUpdate(oldChannel, newChannel) {
  if (!newChannel.guild) return;
  const executor = await buscarExecutorNoAuditLog(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  await processarLimitePorMinuto({ guild: newChannel.guild, executor, moduleKey: 'anti_channel_update', textoEvento: `Canal "${newChannel.name}" atualizado` });
}

// ── Cargos ──
async function handleRoleDelete(role) {
  const executor = await buscarExecutorNoAuditLog(role.guild, AuditLogEvent.RoleDelete, role.id);
  await processarLimitePorMinuto({ guild: role.guild, executor, moduleKey: 'anti_role_delete', textoEvento: `Cargo "${role.name}" deletado` });
}
async function handleRoleCreate(role) {
  const executor = await buscarExecutorNoAuditLog(role.guild, AuditLogEvent.RoleCreate, role.id);
  await processarLimitePorMinuto({ guild: role.guild, executor, moduleKey: 'anti_role_create', textoEvento: `Cargo "${role.name}" criado` });
}
async function handleRoleUpdate(oldRole, newRole) {
  const executor = await buscarExecutorNoAuditLog(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

  // Anti Permission Abuse: dispara quando um cargo ganha permissões
  // administrativas perigosas que não tinha antes.
  const permsAntigas = oldRole.permissions.bitfield;
  const permsNovas = newRole.permissions.bitfield;
  const ganhouAdmin = !(permsAntigas & PermissionFlagsBits.Administrator) && (permsNovas & PermissionFlagsBits.Administrator);
  if (ganhouAdmin) {
    const estado = PDB.getModuleState(newRole.guild.id, 'anti_permission_abuse');
    if (estado.enabled && executor && !usuarioIsento(newRole.guild, executor.id, 'anti_permission_abuse')) {
      const resultado = await aplicarEDelegar(newRole.guild, executor.id, estado.settings.acao, `Concedeu permissão de Administrador ao cargo "${newRole.name}"`, 'anti_permission_abuse');
      await logarEEnviar(newRole.guild, `🔐 **Anti Permission Abuse** — <@${executor.id}> concedeu Administrador ao cargo **${newRole.name}** → ${resultado}`);
    }
  }

  await processarLimitePorMinuto({ guild: newRole.guild, executor, moduleKey: 'anti_role_update', textoEvento: `Cargo "${newRole.name}" atualizado` });
}

// ── Emojis ──
async function handleEmojiDelete(emoji) {
  const executor = await buscarExecutorNoAuditLog(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
  await processarLimitePorMinuto({ guild: emoji.guild, executor, moduleKey: 'anti_emoji_delete', textoEvento: `Emoji "${emoji.name}" deletado` });
}
async function handleEmojiCreate(emoji) {
  const executor = await buscarExecutorNoAuditLog(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
  await processarLimitePorMinuto({ guild: emoji.guild, executor, moduleKey: 'anti_emoji_create', textoEvento: `Emoji "${emoji.name}" criado` });
}
async function handleEmojiUpdate(oldEmoji, newEmoji) {
  const executor = await buscarExecutorNoAuditLog(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
  await processarLimitePorMinuto({ guild: newEmoji.guild, executor, moduleKey: 'anti_emoji_update', textoEvento: `Emoji "${newEmoji.name}" atualizado` });
}

// ── Webhooks (evento agregado — Discord não tem webhookCreate/Delete
// nativo no client; usamos webhooksUpdate, disparado em qualquer
// mudança de webhook no canal, e comparamos via audit log) ──
async function handleWebhooksUpdate(channel) {
  if (!channel.guild) return;
  const estado = PDB.getModuleState(channel.guild.id, 'anti_webhook');
  if (!estado.enabled) return;

  const executor = await buscarExecutorNoAuditLog(channel.guild, AuditLogEvent.WebhookCreate, null);
  if (!executor || usuarioIsento(channel.guild, executor.id, 'anti_webhook')) return;

  if (estado.settings.acao === 'remover') {
    try {
      const webhooks = await channel.fetchWebhooks();
      const criadosPeloExecutor = webhooks.filter(w => w.owner?.id === executor.id);
      for (const wh of criadosPeloExecutor.values()) {
        await wh.delete('Anti Webhook — criação não autorizada').catch(() => {});
      }
    } catch (e) { /* sem permissão de gerenciar webhooks — só loga */ }
  }

  const resultado = await aplicarEDelegar(channel.guild, executor.id, estado.settings.acao === 'remover' ? 'registrar' : estado.settings.acao, 'Webhook criado/modificado', 'anti_webhook');
  await logarEEnviar(channel.guild, `🪝 **Anti Webhook** — <@${executor.id}> em <#${channel.id}> → webhook removido, ${resultado}`);
}



  return {
  handleChannelDelete, handleChannelCreate, handleChannelUpdate,
  handleRoleDelete, handleRoleCreate, handleRoleUpdate,
  handleEmojiDelete, handleEmojiCreate, handleEmojiUpdate,
  handleWebhooksUpdate,
};
})();


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 6/6 — Scheduler (antes: handlers/protectionScheduler.js)
// Liberação automática de quarentena.
// ═══════════════════════════════════════════════════════════════════
const Scheduler = (function() {
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Scheduler de Liberação de Quarentena
 *
 *  Mesmo padrão de handlers/scheduler.js e handlers/sorteioScheduler.js:
 *  timers em memória (Map), resistente a restart (reagenda tudo na
 *  inicialização lendo protection.sqlite via protectionDb.js).
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';


const timersAtivos = new Map(); // key: `${guildId}:${userId}` -> TimeoutID

function chave(guildId, userId) { return `${guildId}:${userId}`; }

function agendarLiberacaoQuarentena(client, guildId, userId, delayMs) {
  const k = chave(guildId, userId);
  if (timersAtivos.has(k)) clearTimeout(timersAtivos.get(k));

  const t = setTimeout(async () => {
    timersAtivos.delete(k);
    try {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;
      const { liberarDaQuarentena } = Manager;
      await liberarDaQuarentena(guild, userId);
      PDB.registrarLog(guildId, {
        moduleKey: 'quarentena', executorId: 'sistema', targetId: userId,
        reason: 'Liberação automática (tempo expirado)', action: 'liberar', result: 'liberado',
      });
    } catch (e) {
      console.error(`[QuarentenaScheduler] Erro ao liberar ${userId} em ${guildId}:`, e.message);
    }
  }, Math.max(0, delayMs));

  timersAtivos.set(k, t);
}

function cancelarLiberacaoQuarentena(guildId, userId) {
  const k = chave(guildId, userId);
  if (timersAtivos.has(k)) {
    clearTimeout(timersAtivos.get(k));
    timersAtivos.delete(k);
  }
}

// Reagenda todas as quarentenas com liberação automática pendente.
// Quarentenas cujo prazo já passou durante o downtime são liberadas na hora.
function iniciarProtectionScheduler(client) {
  console.log('[ProtectionScheduler] Reagendando liberações de quarentena...');
  const todos = PDB.getAllQuarantinedGlobal();
  let reagendados = 0;
  let liberadosNaHora = 0;

  for (const registro of todos) {
    if (!registro.release_at) continue; // sem liberação automática configurada
    const restante = new Date(registro.release_at).getTime() - Date.now();
    if (restante <= 0) {
      liberadosNaHora++;
      (async () => {
        const guild = client.guilds.cache.get(registro.guild_id) || await client.guilds.fetch(registro.guild_id).catch(() => null);
        if (!guild) return;
        const { liberarDaQuarentena } = Manager;
        await liberarDaQuarentena(guild, registro.user_id);
      })().catch(e => console.error('[ProtectionScheduler] Erro ao liberar vencido:', e.message));
    } else {
      agendarLiberacaoQuarentena(client, registro.guild_id, registro.user_id, restante);
      reagendados++;
    }
  }

  console.log(`[ProtectionScheduler] <:positivo:1528401238197276702> Pronto — ${reagendados} reagendado(s), ${liberadosNaHora} liberado(s) por atraso.`);
}



  return {
  iniciarProtectionScheduler,
  agendarLiberacaoQuarentena,
  cancelarLiberacaoQuarentena,
};
})();

module.exports = { db: PDB.db, PDB, Manager, RaidDetector, MessageDetector, ServerDetector, Scheduler }; // db exposto pro sistema de backup (database/backupSqlite.js)
