#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg) { console.log('[gate-planos] ' + msg); }
function fail(msg) { console.error('[gate-planos] ERRO: ' + msg); process.exit(1); }

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
  const direct = path.resolve(process.cwd(), 'events', filename);
  if (fs.existsSync(direct)) return direct;
  const found = searchRecursive(process.cwd(), filename);
  if (found) return found;
  fail(filename + ' nao encontrado a partir de ' + process.cwd());
}

function main() {
  const filePath = findFile('buttonHandler.js');
  log('arquivo: ' + filePath);

  let src = fs.readFileSync(filePath, 'utf8');
  const original = src;
  let aplicados = 0;
  let jaAplicados = 0;

  const patches = [
    {
      nome: 'gate Boas-Vindas (BASICO)',
      marker: 'bloqueadoPorPlano("BASICO", "Sistema de Boas-Vindas")',
      old: "    if (customId === 'painel_boasvindas') {\n      return boasVindas.abrirBoasVindas(interaction);\n    }",
      novo: "    if (customId === 'painel_boasvindas') {\n      if (await bloqueadoPorPlano(\"BASICO\", \"Sistema de Boas-Vindas\")) return;\n      return boasVindas.abrirBoasVindas(interaction);\n    }",
    },
    {
      nome: 'gate Personalizacao (PREMIUM)',
      marker: 'bloqueadoPorPlano("PREMIUM", "Personalização")',
      old: "    if (customId === 'painel_personalizacao') {\n      return personalizacaoBot.abrirPersonalizacao(interaction);\n    }",
      novo: "    if (customId === 'painel_personalizacao') {\n      if (await bloqueadoPorPlano(\"PREMIUM\", \"Personalização\")) return;\n      return personalizacaoBot.abrirPersonalizacao(interaction);\n    }",
    },
  ];

  for (const p of patches) {
    if (src.indexOf(p.marker) !== -1) { jaAplicados++; log(p.nome + ': ja aplicado antes — pulado'); continue; }
    if (src.indexOf(p.old) === -1) fail('ancora nao encontrada para "' + p.nome + '" — arquivo pode ter sido alterado, aplique manualmente');
    const count = src.split(p.old).length - 1;
    if (count > 1) fail('ancora ambigua (' + count + 'x) para "' + p.nome + '"');
    src = src.replace(p.old, p.novo);
    aplicados++;
    log(p.nome + ': aplicado');
  }

  if (aplicados === 0) {
    log('nada a fazer, os ' + jaAplicados + ' patch(es) ja estavam aplicados');
    return;
  }

  const backupPath = filePath + '.bak-' + Date.now();
  fs.writeFileSync(backupPath, original, 'utf8');
  log('backup: ' + backupPath);
  fs.writeFileSync(filePath, src, 'utf8');

  try {
    execSync('node --check "' + filePath + '"', { stdio: 'pipe' });
    log('sintaxe ok');
  } catch (e) {
    fs.writeFileSync(filePath, original, 'utf8');
    console.error(e.stderr ? e.stderr.toString() : e.message);
    fail('sintaxe invalida apos patch, arquivo restaurado');
  }

  log('concluido. Reinicie o bot.');
}

main();
