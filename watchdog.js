#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg) { console.log('[memory-watchdog] ' + msg); }
function fail(msg) { console.error('[memory-watchdog] ERRO: ' + msg); process.exit(1); }

function searchRecursive(dir, filename, depth) {
  depth = depth || 0;
  if (depth > 10) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git') || entry.name.indexOf('backup') !== -1) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return full;
    if (entry.isDirectory()) {
      const res = searchRecursive(full, filename, depth + 1);
      if (res) return res;
    }
  }
  return null;
}

function findFile(filename) {
  const direct = path.resolve(process.cwd(), filename);
  if (fs.existsSync(direct)) return direct;
  const found = searchRecursive(process.cwd(), filename);
  if (found) return found;
  fail(filename + ' nao encontrado a partir de ' + process.cwd());
}

const WATCHDOG_CONTEUDO = "'use strict';\n\nconst v8 = require('v8');\nconst path = require('path');\nconst fs = require('fs');\n\nconst INTERVALO_LOG_MS = 3 * 60 * 1000;\nconst LIMIAR_AVISO = 0.75;\nconst LIMIAR_CRITICO = 0.90;\n\nlet jaAvisouNesteCiclo = false;\n\nfunction statusMemoria() {\n  const stats = v8.getHeapStatistics();\n  const usadoMB = stats.used_heap_size / 1024 / 1024;\n  const limiteMB = stats.heap_size_limit / 1024 / 1024;\n  const fracao = stats.used_heap_size / stats.heap_size_limit;\n  return { usadoMB, limiteMB, fracao };\n}\n\nfunction diagnosticoBanco() {\n  try {\n    const sqliteDb = require('../database/sqliteDb');\n    const dbPath = sqliteDb.DB_PATH;\n    const tamanhoArquivoMB = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024 / 1024) : null;\n\n    const Database = require('better-sqlite3');\n    const dbDireto = new Database(dbPath, { readonly: true });\n    const tabelas = dbDireto.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r => r.name);\n    const contagens = {};\n    for (const t of tabelas) {\n      try {\n        contagens[t] = dbDireto.prepare(`SELECT COUNT(*) as n FROM \"${t}\"`).get().n;\n      } catch (e) {\n        contagens[t] = `erro: ${e.message}`;\n      }\n    }\n    dbDireto.close();\n\n    return { tamanhoArquivoMB, contagens };\n  } catch (e) {\n    return { erro: e.message };\n  }\n}\n\nfunction iniciarMemoryWatchdog() {\n  setInterval(() => {\n    const { usadoMB, limiteMB, fracao } = statusMemoria();\n    console.log(`[MemoryWatchdog] Heap: ${usadoMB.toFixed(0)}MB / ${limiteMB.toFixed(0)}MB (${(fracao * 100).toFixed(0)}%)`);\n\n    if (fracao >= LIMIAR_AVISO && !jaAvisouNesteCiclo) {\n      jaAvisouNesteCiclo = true;\n      console.error(`[MemoryWatchdog][AVISO] Uso de memória acima de ${(LIMIAR_AVISO * 100).toFixed(0)}%. Rodando diagnóstico do banco...`);\n      const diag = diagnosticoBanco();\n      console.error('[MemoryWatchdog][DIAGNOSTICO]', JSON.stringify(diag, null, 2));\n    } else if (fracao < LIMIAR_AVISO) {\n      jaAvisouNesteCiclo = false;\n    }\n\n    if (fracao >= LIMIAR_CRITICO) {\n      console.error(`[MemoryWatchdog][CRITICO] Uso de memória acima de ${(LIMIAR_CRITICO * 100).toFixed(0)}% (${usadoMB.toFixed(0)}MB / ${limiteMB.toFixed(0)}MB).`);\n      console.error('[MemoryWatchdog][CRITICO] Encerrando de forma controlada para evitar crash abrupto do V8. O processo vai reiniciar automaticamente.');\n      const diag = diagnosticoBanco();\n      console.error('[MemoryWatchdog][DIAGNOSTICO-FINAL]', JSON.stringify(diag, null, 2));\n      setTimeout(() => process.exit(1), 500);\n    }\n  }, INTERVALO_LOG_MS);\n\n  console.log('[MemoryWatchdog] Ativo — monitorando uso de memória a cada 3 min.');\n}\n\nmodule.exports = { iniciarMemoryWatchdog, statusMemoria, diagnosticoBanco };\n";

function main() {
  const indexPath = findFile('index.js');
  log('index.js: ' + indexPath);

  const watchdogPath = path.join(path.dirname(indexPath), 'utils', 'memoryWatchdog.js');
  fs.mkdirSync(path.dirname(watchdogPath), { recursive: true });
  let originalWatchdog = fs.existsSync(watchdogPath) ? fs.readFileSync(watchdogPath, 'utf8') : null;
  if (originalWatchdog) {
    const bak = watchdogPath + '.bak-' + Date.now();
    fs.writeFileSync(bak, originalWatchdog, 'utf8');
    log('backup: ' + bak);
  }
  fs.writeFileSync(watchdogPath, WATCHDOG_CONTEUDO, 'utf8');
  log('escrito: ' + watchdogPath);
  try {
    execSync('node --check "' + watchdogPath + '"', { stdio: 'pipe' });
    log('sintaxe ok: memoryWatchdog.js');
  } catch (e) {
    fs.writeFileSync(watchdogPath, originalWatchdog || '', 'utf8');
    console.error(e.stderr ? e.stderr.toString() : e.message);
    fail('sintaxe invalida em memoryWatchdog.js, restaurado');
  }

  let src = fs.readFileSync(indexPath, 'utf8');
  const original = src;

  const marker = "require(\"./utils/memoryWatchdog\")";
  if (src.indexOf(marker) !== -1) {
    log('index.js: ja tinha o watchdog ligado, nada a fazer');
    return;
  }

  const old = "process.on('uncaughtException', (error, origin) => {\n  console.error(`[CRASH-GUARD] uncaughtException (origin: ${origin}):`, error);\n});";
  if (src.indexOf(old) === -1) {
    fail('ancora nao encontrada em index.js — arquivo pode ter sido alterado, aplique manualmente');
  }
  const novo = old +
    "\n\nconst { iniciarMemoryWatchdog } = require(\"./utils/memoryWatchdog\");\niniciarMemoryWatchdog();";

  src = src.replace(old, novo);

  const backupPath = indexPath + '.bak-' + Date.now();
  fs.writeFileSync(backupPath, original, 'utf8');
  log('backup: ' + backupPath);
  fs.writeFileSync(indexPath, src, 'utf8');
  log('index.js: watchdog ligado');

  try {
    execSync('node --check "' + indexPath + '"', { stdio: 'pipe' });
    log('sintaxe ok: index.js');
  } catch (e) {
    fs.writeFileSync(indexPath, original, 'utf8');
    console.error(e.stderr ? e.stderr.toString() : e.message);
    fail('sintaxe invalida em index.js apos patch, restaurado');
  }

  log('concluido. Reinicie o bot. Os logs vao mostrar [MemoryWatchdog] a cada 3 min.');
}

main();
