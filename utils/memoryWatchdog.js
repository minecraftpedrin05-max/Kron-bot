'use strict';

const v8 = require('v8');
const path = require('path');
const fs = require('fs');

const INTERVALO_LOG_MS = 3 * 60 * 1000;
const LIMIAR_AVISO = 0.75;
const LIMIAR_CRITICO = 0.90;

let jaAvisouNesteCiclo = false;

function statusMemoria() {
  const stats = v8.getHeapStatistics();
  const usadoMB = stats.used_heap_size / 1024 / 1024;
  const limiteMB = stats.heap_size_limit / 1024 / 1024;
  const fracao = stats.used_heap_size / stats.heap_size_limit;
  return { usadoMB, limiteMB, fracao };
}

function diagnosticoBanco() {
  try {
    const sqliteDb = require('../database/sqliteDb');
    const dbPath = sqliteDb.DB_PATH;
    const tamanhoArquivoMB = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024 / 1024) : null;

    const Database = require('better-sqlite3');
    const dbDireto = new Database(dbPath, { readonly: true });
    const tabelas = dbDireto.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const contagens = {};
    for (const t of tabelas) {
      try {
        contagens[t] = dbDireto.prepare(`SELECT COUNT(*) as n FROM "${t}"`).get().n;
      } catch (e) {
        contagens[t] = `erro: ${e.message}`;
      }
    }
    dbDireto.close();

    return { tamanhoArquivoMB, contagens };
  } catch (e) {
    return { erro: e.message };
  }
}

function iniciarMemoryWatchdog() {
  setInterval(() => {
    const { usadoMB, limiteMB, fracao } = statusMemoria();
    console.log(`[MemoryWatchdog] Heap: ${usadoMB.toFixed(0)}MB / ${limiteMB.toFixed(0)}MB (${(fracao * 100).toFixed(0)}%)`);

    if (fracao >= LIMIAR_AVISO && !jaAvisouNesteCiclo) {
      jaAvisouNesteCiclo = true;
      console.error(`[MemoryWatchdog][AVISO] Uso de memória acima de ${(LIMIAR_AVISO * 100).toFixed(0)}%. Rodando diagnóstico do banco...`);
      const diag = diagnosticoBanco();
      console.error('[MemoryWatchdog][DIAGNOSTICO]', JSON.stringify(diag, null, 2));
    } else if (fracao < LIMIAR_AVISO) {
      jaAvisouNesteCiclo = false;
    }

    if (fracao >= LIMIAR_CRITICO) {
      console.error(`[MemoryWatchdog][CRITICO] Uso de memória acima de ${(LIMIAR_CRITICO * 100).toFixed(0)}% (${usadoMB.toFixed(0)}MB / ${limiteMB.toFixed(0)}MB).`);
      console.error('[MemoryWatchdog][CRITICO] Encerrando de forma controlada para evitar crash abrupto do V8. O processo vai reiniciar automaticamente.');
      const diag = diagnosticoBanco();
      console.error('[MemoryWatchdog][DIAGNOSTICO-FINAL]', JSON.stringify(diag, null, 2));
      setTimeout(() => process.exit(1), 500);
    }
  }, INTERVALO_LOG_MS);

  console.log('[MemoryWatchdog] Ativo — monitorando uso de memória a cada 3 min.');
}

module.exports = { iniciarMemoryWatchdog, statusMemoria, diagnosticoBanco };
