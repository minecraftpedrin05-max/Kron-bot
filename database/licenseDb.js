/**
 * ═══════════════════════════════════════════════════════════════════
 *  KAEL — SISTEMA DE LICENÇAS (camada Better-SQLite3)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Único ponto de acesso ao banco SQLite do sistema de licenças.
 *  Nenhum outro arquivo deve importar `better-sqlite3` nem escrever
 *  SQL fora daqui — qualquer mudança de schema fica concentrada
 *  neste módulo (mesmo padrão adotado em protectionSystem.js/PDB).
 *
 *  Arquivo do banco: database/licenses.sqlite (criado automaticamente
 *  na primeira execução, com todas as tabelas).
 *
 *  Tabelas:
 *   - license_keys        → chaves cadastradas (usáveis 1x por servidor)
 *   - licenses             → licença atualmente vinculada a um guild_id
 *   - activation_requests  → histórico/estado das solicitações de /ativar
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR = require('./dataDir').DATA_DIR;
const DB_PATH = path.join(DB_DIR, 'licenses.sqlite');
const LEGACY_JSON_PATH = path.join(__dirname, 'database.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ═══════════════════════════════════════════════════════════════════
// SCHEMA — criado uma única vez, idempotente (CREATE TABLE IF NOT EXISTS)
// ═══════════════════════════════════════════════════════════════════
db.exec(`
CREATE TABLE IF NOT EXISTS license_keys (
  chave       TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL,
  dias        INTEGER NOT NULL DEFAULT 0,
  usada       INTEGER NOT NULL DEFAULT 0,
  guild_id    TEXT,
  criada_em   TEXT NOT NULL,
  criada_por  TEXT,
  usada_em    TEXT
);

CREATE TABLE IF NOT EXISTS licenses (
  guild_id     TEXT PRIMARY KEY,
  chave        TEXT,
  tipo         TEXT NOT NULL,
  ativado_por  TEXT,
  ativado_em   TEXT,
  expiry       TEXT,
  dias         TEXT
);

CREATE TABLE IF NOT EXISTS activation_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  guild_name     TEXT,
  chave          TEXT NOT NULL,
  solicitante_id TEXT NOT NULL,
  canal_id       TEXT,
  mensagem_id    TEXT,
  status         TEXT NOT NULL DEFAULT 'pendente',
  criada_em      TEXT NOT NULL,
  resolvida_em   TEXT,
  resolvida_por  TEXT,
  motivo_recusa  TEXT
);
`);

// ═══════════════════════════════════════════════════════════════════
// MIGRAÇÃO ÚNICA — coluna `revogada` (painel /licenses). Idempotente:
// só adiciona a coluna se ela ainda não existir. Nenhuma tabela é
// recriada, nenhuma licença existente é afetada.
// ═══════════════════════════════════════════════════════════════════
(function migrarColunaRevogada() {
  const colunas = db.prepare("PRAGMA table_info(license_keys)").all().map(c => c.name);
  if (!colunas.includes('revogada')) {
    db.exec("ALTER TABLE license_keys ADD COLUMN revogada INTEGER NOT NULL DEFAULT 0");
  }
})();

// ═══════════════════════════════════════════════════════════════════
// MIGRAÇÃO ÚNICA — licenças que já existiam no database.json (JSON)
// são importadas para o SQLite na primeira vez que este módulo roda,
// preservando o que já estava ativado em produção. Idempotente.
// ═══════════════════════════════════════════════════════════════════
(function migrarLicencasLegadoJSON() {
  try {
    if (!fs.existsSync(LEGACY_JSON_PATH)) return;
    const legado = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
    const licencasAntigas = legado?.licenses || {};
    const jaExiste = db.prepare('SELECT 1 FROM licenses WHERE guild_id = ?');
    const inserir = db.prepare(`
      INSERT INTO licenses (guild_id, chave, tipo, ativado_por, ativado_em, expiry, dias)
      VALUES (@guild_id, NULL, @tipo, @ativado_por, @ativado_em, @expiry, @dias)
    `);
    for (const [guildId, lic] of Object.entries(licencasAntigas)) {
      if (!lic) continue;
      if (jaExiste.get(guildId)) continue;
      inserir.run({
        guild_id: guildId,
        tipo: lic.tipo || 'FREE',
        ativado_por: lic.ativadoPor || null,
        ativado_em: lic.ativadoEm || null,
        expiry: lic.expiry || null,
        dias: String(lic.dias ?? (lic.expiry ? '' : 'permanente')),
      });
    }
  } catch (e) {
    console.error('[licenseDb] Falha ao migrar licenças legadas do database.json:', e.message);
  }
})();

// ═══════════════════════════════════════════════════════════════════
// PREPARED STATEMENTS
// ═══════════════════════════════════════════════════════════════════
const stmts = {
  insertKey: db.prepare(`
    INSERT INTO license_keys (chave, tipo, dias, usada, guild_id, criada_em, criada_por, usada_em)
    VALUES (@chave, @tipo, @dias, 0, NULL, @criada_em, @criada_por, NULL)
  `),
  getKey: db.prepare('SELECT * FROM license_keys WHERE chave = ?'),
  listKeys: db.prepare('SELECT * FROM license_keys ORDER BY criada_em DESC'),
  // BUGFIX (auditoria licenças): antes não tinha "AND usada = 0" nem
  // checagem de linhas afetadas — duas ativações da mesma chave em
  // paralelo podiam, em tese, ambas "ter sucesso". Agora é uma
  // operação atômica: só marca (e só retorna sucesso) se a chave AINDA
  // estava livre no exato momento do UPDATE.
  markKeyUsed: db.prepare(`
    UPDATE license_keys SET usada = 1, guild_id = @guild_id, usada_em = @usada_em WHERE chave = @chave AND usada = 0
  `),
  freeKey: db.prepare(`
    UPDATE license_keys SET usada = 0, guild_id = NULL, usada_em = NULL WHERE chave = ?
  `),
  deleteKey: db.prepare('DELETE FROM license_keys WHERE chave = ?'),
  revokeKey: db.prepare('UPDATE license_keys SET revogada = 1 WHERE chave = ?'),
  // Painel /licenses precisa saber, por chave, se a licença vinculada
  // (tabela `licenses`) ainda está válida — junta as duas tabelas numa
  // única query em vez de fazer N+1 consultas ao montar lista/estatísticas.
  listKeysComLicenca: db.prepare(`
    SELECT k.*, l.expiry AS licenca_expiry, l.ativado_por AS licenca_ativado_por, l.ativado_em AS licenca_ativado_em
    FROM license_keys k
    LEFT JOIN licenses l ON l.chave = k.chave
    ORDER BY k.criada_em DESC
  `),
  deleteLicenseByChave: db.prepare('DELETE FROM licenses WHERE chave = ?'),

  getLicense: db.prepare('SELECT * FROM licenses WHERE guild_id = ?'),
  upsertLicense: db.prepare(`
    INSERT INTO licenses (guild_id, chave, tipo, ativado_por, ativado_em, expiry, dias)
    VALUES (@guild_id, @chave, @tipo, @ativado_por, @ativado_em, @expiry, @dias)
    ON CONFLICT(guild_id) DO UPDATE SET
      chave = excluded.chave,
      tipo = excluded.tipo,
      ativado_por = excluded.ativado_por,
      ativado_em = excluded.ativado_em,
      expiry = excluded.expiry,
      dias = excluded.dias
  `),
  deleteLicense: db.prepare('DELETE FROM licenses WHERE guild_id = ?'),

  insertRequest: db.prepare(`
    INSERT INTO activation_requests (guild_id, guild_name, chave, solicitante_id, canal_id, mensagem_id, status, criada_em)
    VALUES (@guild_id, @guild_name, @chave, @solicitante_id, @canal_id, @mensagem_id, 'pendente', @criada_em)
  `),
  getRequest: db.prepare('SELECT * FROM activation_requests WHERE id = ?'),
  getPendingRequestForGuild: db.prepare(`
    SELECT * FROM activation_requests WHERE guild_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 1
  `),
  setRequestMessageId: db.prepare('UPDATE activation_requests SET mensagem_id = @mensagem_id WHERE id = @id'),
  resolveRequest: db.prepare(`
    UPDATE activation_requests SET status = @status, resolvida_em = @resolvida_em, resolvida_por = @resolvida_por, motivo_recusa = @motivo_recusa
    WHERE id = @id
  `),
};

function nowISO() { return new Date().toISOString(); }

function gerarChave() {
  const bloco = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KAEL-${bloco()}-${bloco()}-${bloco()}`;
}

// ═══════════════════════════════════════════════════════════════════
// CHAVES
// ═══════════════════════════════════════════════════════════════════

/** Cadastra uma nova chave de licença (gera automaticamente se `chave` não for informada). */
function addKey({ chave, tipo, dias = 0, criadaPor }) {
  let valor = (chave || '').trim().toUpperCase();
  if (!valor) {
    do { valor = gerarChave(); } while (stmts.getKey.get(valor));
  } else if (stmts.getKey.get(valor)) {
    throw new Error('Já existe uma chave cadastrada com esse valor.');
  }
  stmts.insertKey.run({
    chave: valor,
    tipo,
    dias: dias || 0,
    criada_em: nowISO(),
    criada_por: criadaPor || null,
  });
  return stmts.getKey.get(valor);
}

function getKey(chave) {
  if (!chave) return null;
  return stmts.getKey.get(chave.trim().toUpperCase()) || null;
}

function listKeys() { return stmts.listKeys.all(); }

/**
 * Marca uma chave como usada e vincula ao servidor — operação atômica.
 * Retorna `true` se ESTA chamada conseguiu reivindicar a chave (ela
 * estava livre), ou `false` se a chave já tinha sido usada/revogada
 * antes (por ex. outra ativação concorrente venceu a corrida). Quem
 * chama deve tratar `false` como "não ative a licença".
 */
function markKeyUsed(chave, guildId) {
  const info = stmts.markKeyUsed.run({ chave: chave.trim().toUpperCase(), guild_id: guildId, usada_em: nowISO() });
  return info.changes > 0;
}

/** Libera a chave para reutilização (usada por /license remove). */
function freeKey(chave) {
  if (!chave) return;
  stmts.freeKey.run(chave.trim().toUpperCase());
}

function deleteKey(chave) {
  if (!chave) return;
  const valor = chave.trim().toUpperCase();
  stmts.deleteLicenseByChave.run(valor); // evita registro orfao em `licenses` apontando pra uma chave apagada
  stmts.deleteKey.run(valor);
}

/** Revoga uma licença: marca `revogada` e corta na hora qualquer acesso ativo vinculado a ela. */
function revokeKey(chave) {
  if (!chave) return null;
  const valor = chave.trim().toUpperCase();
  const registro = stmts.getKey.get(valor);
  if (!registro) return null;
  stmts.revokeKey.run(valor);
  stmts.deleteLicenseByChave.run(valor); // remove o vínculo com o servidor imediatamente (hasLicense() passa a retornar false)
  return stmts.getKey.get(valor);
}

/** Status calculado de uma licença (painel /licenses). Não é persistido — é sempre derivado dos dados reais. */
function statusDaChave(row) {
  if (row.revogada) return 'revogada';
  if (!row.usada) return 'nao_utilizada';
  if (row.licenca_expiry && new Date(row.licenca_expiry) < new Date()) return 'expirada';
  return 'em_uso';
}

/** Todas as licenças + status calculado + dados de expiração, numa única query (sem N+1). */
function listKeysComStatus() {
  return stmts.listKeysComLicenca.all().map(row => ({ ...row, status: statusDaChave(row) }));
}

/** Estatísticas agregadas para o painel /licenses. */
function getKeyStats() {
  const rows = listKeysComStatus();
  const stats = { total: rows.length, naoUtilizadas: 0, emUso: 0, expiradas: 0, revogadas: 0 };
  for (const r of rows) {
    if (r.status === 'nao_utilizada') stats.naoUtilizadas++;
    else if (r.status === 'em_uso') stats.emUso++;
    else if (r.status === 'expirada') stats.expiradas++;
    else if (r.status === 'revogada') stats.revogadas++;
  }
  return stats;
}

// ═══════════════════════════════════════════════════════════════════
// LICENÇAS (vínculo licença ↔ servidor)
// ═══════════════════════════════════════════════════════════════════

function rowParaLicenca(row) {
  if (!row) return null;
  return {
    tipo: row.tipo,
    chave: row.chave || null,
    ativadoPor: row.ativado_por,
    ativadoEm: row.ativado_em,
    expiry: row.expiry,
    dias: row.dias,
  };
}

function getLicense(guildId) {
  return rowParaLicenca(stmts.getLicense.get(guildId));
}

/** Mantido para compatibilidade com o restante do sistema (db.setLicense). */
function setLicense(guildId, data) {
  stmts.upsertLicense.run({
    guild_id: guildId,
    chave: data.chave || null,
    tipo: data.tipo,
    ativado_por: data.ativadoPor || null,
    ativado_em: data.ativadoEm || nowISO(),
    expiry: data.expiry || null,
    dias: String(data.dias ?? ''),
  });
}

/** Remove a licença do servidor, libera a chave vinculada (se houver) e limpa o vínculo com guild_id. */
function removeLicense(guildId) {
  const atual = stmts.getLicense.get(guildId);
  if (atual?.chave) freeKey(atual.chave);
  stmts.deleteLicense.run(guildId);
  return !!atual;
}

function hasLicense(guildId) {
  const l = getLicense(guildId);
  if (!l) return false;
  if (l.expiry && new Date(l.expiry) < new Date()) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// SOLICITAÇÕES DE ATIVAÇÃO (/ativar → botões Ativar / Recusar)
// ═══════════════════════════════════════════════════════════════════

function createActivationRequest({ guildId, guildName, chave, solicitanteId, canalId }) {
  const info = stmts.insertRequest.run({
    guild_id: guildId,
    guild_name: guildName || null,
    chave: chave.trim().toUpperCase(),
    solicitante_id: solicitanteId,
    canal_id: canalId || null,
    mensagem_id: null,
    criada_em: nowISO(),
  });
  return stmts.getRequest.get(info.lastInsertRowid);
}

function getActivationRequest(id) {
  return stmts.getRequest.get(id) || null;
}

function getPendingRequestForGuild(guildId) {
  return stmts.getPendingRequestForGuild.get(guildId) || null;
}

function setRequestMessageId(id, mensagemId) {
  stmts.setRequestMessageId.run({ id, mensagem_id: mensagemId });
}

function resolveActivationRequest(id, { status, resolvidaPor, motivo }) {
  stmts.resolveRequest.run({
    id,
    status,
    resolvida_em: nowISO(),
    resolvida_por: resolvidaPor || null,
    motivo_recusa: motivo || null,
  });
  return stmts.getRequest.get(id);
}

module.exports = {
  db, // exposto pro sistema de backup (database/backupSqlite.js) conseguir fazer .backup() nele
  // chaves
  addKey, getKey, listKeys, markKeyUsed, freeKey, deleteKey, revokeKey,
  listKeysComStatus, getKeyStats,
  // licenças
  getLicense, setLicense, removeLicense, hasLicense,
  // solicitações de ativação
  createActivationRequest, getActivationRequest, getPendingRequestForGuild,
  setRequestMessageId, resolveActivationRequest,
};
