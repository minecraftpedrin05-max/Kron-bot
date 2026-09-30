// ═══════════════════════════════════════════════════════════════════════
// database/dataDir.js
//
// Diretório ÚNICO onde TODOS os bancos SQLite (database.sqlite,
// licenses.sqlite, protection.sqlite) e o sistema de backup gravam/leem.
//
// Se a Railway tiver um Volume anexado a este serviço, ela injeta
// automaticamente a variável de ambiente RAILWAY_VOLUME_MOUNT_PATH com o
// caminho do disco persistente (ex: "/data") — usamos esse caminho.
//
// Se essa variável não existir (rodando no Replit, localmente, ou na
// Railway sem Volume configurado ainda), cai no comportamento de sempre
// (__dirname, ou seja, database/) — nada quebra, só continua sem
// persistência real de disco entre deploys (o backup via Discord segue
// sendo a rede de segurança nesse caso).
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = { DATA_DIR };
