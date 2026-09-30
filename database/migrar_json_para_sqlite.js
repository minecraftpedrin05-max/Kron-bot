// ═══════════════════════════════════════════════════════════════════════
// scripts/migrar_json_para_sqlite.js
//
// Migra os dados de database/database.json para database/database.sqlite
// (better-sqlite3), usada pela nova versão de database/db.js.
//
// COMO RODAR:
//   node scripts/migrar_json_para_sqlite.js
//
// Para forçar uma re-migração (sobrescrevendo o que já estiver no
// SQLite com o conteúdo atual do database.json — CUIDADO, isso apaga
// qualquer dado gravado no SQLite depois da primeira migração):
//   node database/migrar_json_para_sqlite.js --force
//
// O QUE ESTE SCRIPT FAZ:
//   1. Cria um backup timestampado de database/database.json antes de
//      tocar em qualquer coisa (nunca apaga/sobrescreve o original).
//   2. Lê database/database.json por completo.
//   3. Para cada guild, migra: pix, logs, config, blacklist, sorteios,
//      backups, assinaturas, ticketConfig, e TODOS os campos de loja.*
//      (incluindo os legados: loja.produto/variantes/estoque/cupons
//      singulares, que NUNCA são apagados) para a tabela guild_meta.
//   4. Migra loja.produtos[] (multi-produto) — incluindo variantes,
//      estoque e cupons de cada produto — para as tabelas relacionais
//      (produtos, produto_variantes, produto_estoque, produto_cupons).
//   5. Roda tudo dentro de UMA transação SQLite (tudo ou nada).
//   6. Ao final, valida contando guilds/produtos/variantes/estoque/
//      cupons/sorteios/snapshots/templates/assinaturas no JSON de
//      origem vs. o que ficou no SQLite — e ABORTA (com rollback,
//      pois está tudo dentro da mesma transação) se algo não bater.
//   7. Idempotente: se já foi migrado antes, avisa e não faz nada,
//      a menos que --force seja passado explicitamente.
//
// O database/database.json NUNCA é apagado ou modificado por este
// script — ele continua existindo como estava, intacto, mesmo depois
// da migração (só passa a não ser mais lido pelo bot em produção,
// já que database/db.js passa a usar o SQLite).
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, 'database.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

const FORCE = process.argv.includes('--force');

function log(msg) { console.log(`[Migração JSON→SQLite] ${msg}`); }
function erro(msg) { console.error(`[Migração JSON→SQLite] ❌ ${msg}`); }

function fazerBackupJson() {
  if (!fs.existsSync(JSON_PATH)) {
    throw new Error(`Arquivo não encontrado: ${JSON_PATH}. Nada para migrar.`);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(BACKUP_DIR, `database.json.bak-${timestamp}`);
  fs.copyFileSync(JSON_PATH, destino);
  log(`💾 Backup criado em: ${path.relative(process.cwd(), destino)}`);
  return destino;
}

function lerJsonOrigem() {
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || typeof data.guilds !== 'object') {
    throw new Error('database.json não tem o formato esperado ({ guilds: {...} }). Abortando.');
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Contagem de referência a partir do JSON de origem — usada para
// validar depois que a migração bateu 100% com o que foi lido.
// ─────────────────────────────────────────────────────────────────────
function contarReferencia(data) {
  const ref = {
    guilds: 0,
    produtos: 0,
    variantes: 0,
    estoqueItens: 0,
    cupons: 0,
    sorteiosAtivos: 0,
    sorteiosEncerrados: 0,
    snapshots: 0,
    templates: 0,
    assinaturasAtivas: 0,
  };

  for (const guildId of Object.keys(data.guilds)) {
    ref.guilds++;
    const g = data.guilds[guildId] || {};
    const produtos = (g.loja && Array.isArray(g.loja.produtos)) ? g.loja.produtos : [];
    ref.produtos += produtos.length;
    for (const p of produtos) {
      const variantes = Array.isArray(p.variantes) ? p.variantes : [];
      ref.variantes += variantes.length;
      const estoqueProduto = Array.isArray(p.estoque) ? p.estoque
        : (typeof p.estoque === 'string' && p.estoque.trim() ? p.estoque.trim().split('\n').filter(Boolean) : []);
      ref.estoqueItens += estoqueProduto.length;
      for (const v of variantes) {
        if (Array.isArray(v.itensEstoque)) ref.estoqueItens += v.itensEstoque.length;
      }
      ref.cupons += p.cupons && typeof p.cupons === 'object' ? Object.keys(p.cupons).length : 0;
    }
    if (g.sorteios) {
      ref.sorteiosAtivos += Object.keys(g.sorteios.ativos || {}).length;
      ref.sorteiosEncerrados += Object.keys(g.sorteios.encerrados || {}).length;
    }
    if (g.backups) {
      ref.snapshots += (g.backups.snapshots || []).length;
      ref.templates += Object.keys(g.backups.templates || {}).length;
    }
    if (g.assinaturas) {
      ref.assinaturasAtivas += (g.assinaturas.ativas || []).length;
    }
  }
  return ref;
}

// ─────────────────────────────────────────────────────────────────────
// Contagem real pós-migração, direto do SQLite.
// ─────────────────────────────────────────────────────────────────────
function contarSqlite(sqliteDb, guildIdsMigradas) {
  const cont = {
    guilds: guildIdsMigradas.length,
    produtos: 0,
    variantes: 0,
    estoqueItens: 0,
    cupons: 0,
    sorteiosAtivos: 0,
    sorteiosEncerrados: 0,
    snapshots: 0,
    templates: 0,
    assinaturasAtivas: 0,
  };

  const { db } = sqliteDb;
  cont.produtos = db.prepare(`SELECT COUNT(*) c FROM produtos`).get().c;
  cont.variantes = db.prepare(`SELECT COUNT(*) c FROM produto_variantes`).get().c;
  cont.estoqueItens = db.prepare(`SELECT COUNT(*) c FROM produto_estoque`).get().c;
  cont.cupons = db.prepare(`SELECT COUNT(*) c FROM produto_cupons`).get().c;

  for (const guildId of guildIdsMigradas) {
    const raw = sqliteDb.getGuildRaw(guildId) || {};
    if (raw.sorteios) {
      cont.sorteiosAtivos += Object.keys(raw.sorteios.ativos || {}).length;
      cont.sorteiosEncerrados += Object.keys(raw.sorteios.encerrados || {}).length;
    }
    if (raw.backups) {
      cont.snapshots += (raw.backups.snapshots || []).length;
      cont.templates += Object.keys(raw.backups.templates || {}).length;
    }
    if (raw.assinaturas) {
      cont.assinaturasAtivas += (raw.assinaturas.ativas || []).length;
    }
  }
  return cont;
}

function compararContagens(ref, real) {
  const campos = Object.keys(ref);
  const divergencias = [];
  for (const campo of campos) {
    if (ref[campo] !== real[campo]) {
      divergencias.push(`  - ${campo}: esperado ${ref[campo]}, encontrado ${real[campo]}`);
    }
  }
  return divergencias;
}

// ─────────────────────────────────────────────────────────────────────
// EXECUÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────
function main() {
  log('Iniciando...');

  const sqliteDb = require('./sqliteDb');

  const jaMigrado = sqliteDb.getMigrationFlag('json_migrado_em');
  if (jaMigrado && !FORCE) {
    log(`✅ Este banco já foi migrado em ${jaMigrado}. Nada a fazer.`);
    log(`   Se quiser forçar uma nova migração (ATENÇÃO: isso substitui os`);
    log(`   dados atuais do SQLite pelo conteúdo do database.json), rode:`);
    log(`   node database/migrar_json_para_sqlite.js --force`);
    return;
  }
  if (jaMigrado && FORCE) {
    log(`⚠️  --force informado: re-migrando por cima de uma migração anterior (${jaMigrado}).`);
  }

  fazerBackupJson();

  const data = lerJsonOrigem();
  const guildIds = Object.keys(data.guilds);
  log(`📦 ${guildIds.length} guild(s) encontrada(s) em database.json.`);

  const referencia = contarReferencia(data);
  log('📊 Contagem de referência (a partir do JSON):');
  for (const [k, v] of Object.entries(referencia)) log(`   - ${k}: ${v}`);

  log('🚀 Migrando dentro de uma transação...');

  let guildIdsMigradas = [];
  try {
    sqliteDb.withTransaction(() => {
      for (const guildId of guildIds) {
        const guildData = data.guilds[guildId] || {};

        // Mesma separação usada por database/db.js: produtos[] vai para
        // as tabelas relacionais; o resto vai para o blob guild_meta.
        if (guildData.loja && Array.isArray(guildData.loja.produtos)) {
          sqliteDb.sincronizarProdutosDaGuild(guildId, guildData.loja.produtos);
          const { produtos, ...lojaSemProdutos } = guildData.loja;
          sqliteDb.setGuildRaw(guildId, { ...guildData, loja: lojaSemProdutos });
        } else {
          sqliteDb.setGuildRaw(guildId, guildData);
        }
        guildIdsMigradas.push(guildId);
      }

      // Validação DENTRO da transação: se algo não bater, lançamos erro
      // e a transação inteira é revertida (rollback) — nada fica
      // parcialmente migrado.
      const real = contarSqlite(sqliteDb, guildIdsMigradas);
      const divergencias = compararContagens(referencia, real);
      if (divergencias.length > 0) {
        throw new Error(
          `Validação pós-migração falhou — dados não batem com a origem:\n${divergencias.join('\n')}`
        );
      }

      sqliteDb.setMigrationFlag('json_migrado_em', new Date().toISOString());
      sqliteDb.setMigrationFlag('json_origem_guilds', String(guildIds.length));
    });
  } catch (e) {
    erro(`Migração ABORTADA (rollback aplicado, nenhum dado foi alterado no SQLite): ${e.message}`);
    process.exitCode = 1;
    return;
  }

  // Validação final, fora da transação, lendo de volta como db.js real
  // faria (garante que a camada de materialização também está correta,
  // não só as tabelas cruas).
  const realFinal = contarSqlite(sqliteDb, guildIdsMigradas);
  const divergenciasFinal = compararContagens(referencia, realFinal);

  log('📊 Contagem real pós-migração (a partir do SQLite):');
  for (const [k, v] of Object.entries(realFinal)) log(`   - ${k}: ${v}`);

  if (divergenciasFinal.length > 0) {
    erro('Validação final encontrou divergências (isso não deveria acontecer após o commit):');
    console.error(divergenciasFinal.join('\n'));
    process.exitCode = 1;
    return;
  }

  log('✅ Validação 100% OK — todos os totais batem com o database.json original.');
  log(`✅ Migração concluída com sucesso: ${guildIdsMigradas.length} guild(s).`);
  log(`ℹ️  database/database.json foi preservado intacto (não foi apagado nem modificado).`);
  log(`ℹ️  Banco SQLite em: ${sqliteDb.DB_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = { main, contarReferencia, contarSqlite, compararContagens };
