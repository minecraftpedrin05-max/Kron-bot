#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg) { console.log('[ajustes-planos-2] ' + msg); }
function fail(msg) { console.error('[ajustes-planos-2] ERRO: ' + msg); process.exit(1); }

function searchRecursive(dir, filename, requiredSeg, depth) {
  depth = depth || 0;
  if (depth > 10) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  let fallback = null;
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git') || entry.name.indexOf('backup') !== -1) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      if (!requiredSeg || full.split(path.sep).indexOf(requiredSeg) !== -1) return full;
      fallback = full;
    } else if (entry.isDirectory()) {
      const res = searchRecursive(full, filename, requiredSeg, depth + 1);
      if (res) return res;
    }
  }
  return fallback;
}

function findFile(filename, requiredSeg) {
  const direct = requiredSeg ? path.resolve(process.cwd(), requiredSeg, filename) : path.resolve(process.cwd(), filename);
  if (fs.existsSync(direct)) return direct;
  const found = searchRecursive(process.cwd(), filename, requiredSeg);
  if (found) return found;
  fail(filename + ' nao encontrado a partir de ' + process.cwd());
}

function checarSintaxe(filePath, original) {
  try {
    execSync('node --check "' + filePath + '"', { stdio: 'pipe' });
    log(path.basename(filePath) + ': sintaxe ok');
  } catch (e) {
    fs.writeFileSync(filePath, original, 'utf8');
    console.error(e.stderr ? e.stderr.toString() : e.message);
    fail('sintaxe invalida em ' + filePath + ', restaurado');
  }
}

function patch(filePath, replacements) {
  let src = fs.readFileSync(filePath, 'utf8');
  const original = src;
  let aplicados = 0;
  let jaAplicados = 0;

  for (const r of replacements) {
    if (src.indexOf(r.marker) !== -1) { jaAplicados++; continue; }
    if (src.indexOf(r.old) === -1) fail('ancora nao encontrada em ' + filePath + ' para "' + r.nome + '"');
    const count = src.split(r.old).length - 1;
    if (count > 1) fail('ancora ambigua (' + count + 'x) em ' + filePath + ' para "' + r.nome + '"');
    src = src.replace(r.old, r.novo);
    aplicados++;
    log(r.nome + ': aplicado');
  }

  if (aplicados === 0) {
    log(path.basename(filePath) + ': nada a fazer (' + jaAplicados + ' ja existia(m))');
    return;
  }

  const backupPath = filePath + '.bak-' + Date.now();
  fs.writeFileSync(backupPath, original, 'utf8');
  log('backup: ' + backupPath);
  fs.writeFileSync(filePath, src, 'utf8');
  checarSintaxe(filePath, original);
}

function gateCompacto(nivel, nomeExibicao) {
  return `    if(!require("../utils/helpers").temPlanoMinimo(interaction.guild?.id, "${nivel}")) { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Adquira o plano ${nomeExibicao} para usar este comando.")], ephemeral:true }); return; }\n`;
}

const MINHASCOMPRAS_CONTEUDO = "const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');\nconst db = require('../database/db');\n\nconst COR = { primary: 0xDC143C, gold: 0xFFD700, success: 0x00FF7F, danger: 0xFF4444 };\nconst MAX_EXIBIDOS = 10;\n\n// Comando do cliente para visualizar compras anteriores — agora acessível\n// só por prefixo (!minhascompras), não mais como slash command.\n// O botão \"<:embed:1528400492982571111> Ver Entrega\" reaproveita o MESMO\n// histórico (loja.historicoCompras) e a mesma checagem de propriedade\n// (clienteId) já usada no botão Copiar Entrega da DM\n// (sales-system/salesManager.js -> copiarEntrega), sem duplicar a lógica\n// de segurança em dois lugares diferentes.\nfunction getHistoricoDoUsuario(guildId, userId) {\n  const historico = db.getGuild(guildId).loja?.historicoCompras || [];\n  return historico.filter(r => r.clienteId === userId).sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));\n}\n\n// Chamado por events/messageHandler.js quando a mensagem é \"!minhascompras\".\n// Recebe o Message do Discord (não uma Interaction).\nasync function enviarHistoricoCompras(message) {\n  if (!message.guild) {\n    return message.reply({\n      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Use este comando dentro de um servidor.')],\n    });\n  }\n\n  const minhasCompras = getHistoricoDoUsuario(message.guild.id, message.author.id);\n\n  if (minhasCompras.length === 0) {\n    return message.reply({\n      embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('🛍️ Minhas Compras')\n        .setDescription('> Você ainda não realizou nenhuma compra neste servidor.')],\n    });\n  }\n\n  const exibidos = minhasCompras.slice(0, MAX_EXIBIDOS);\n\n  const embed = new EmbedBuilder()\n    .setColor(COR.primary)\n    .setAuthor({ name: `Histórico de ${message.author.username}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })\n    .setTitle('🛍️ Minhas Compras')\n    .setDescription(\n      exibidos.map((r) => {\n        const dataFormatada = new Date(r.dataISO).toLocaleDateString('pt-BR');\n        const emojiTxt = r.varianteEmoji ? `${r.varianteEmoji} ` : '';\n        return `**Pedido #${r.id.split('-')[1]}**\\n${emojiTxt}Produto: ${r.produtoNome}\\nVariante: ${r.varianteNome}\\nData: ${dataFormatada}`;\n      }).join('\\n\\n')\n    )\n    .setFooter({ text: minhasCompras.length > MAX_EXIBIDOS ? `Mostrando ${MAX_EXIBIDOS} de ${minhasCompras.length} compras` : `${minhasCompras.length} compra(s) no total` })\n    .setTimestamp();\n\n  // Botões \"Ver Entrega\" — até 5 por linha, limite de 25 componentes por\n  // mensagem do Discord. Com MAX_EXIBIDOS=10, cabem em 2 linhas de botões.\n  const rows = [];\n  for (let i = 0; i < exibidos.length; i += 5) {\n    const lote = exibidos.slice(i, i + 5);\n    rows.push(new ActionRowBuilder().addComponents(\n      lote.map((r) =>\n        new ButtonBuilder()\n          .setCustomId(`loja_copiar_entrega_${r.id}`)\n          .setLabel(`Ver Entrega #${r.id.split('-')[1]}`.slice(0, 80))\n          .setEmoji('<:embed:1528400492982571111>')\n          .setStyle(ButtonStyle.Secondary)\n      )\n    ));\n  }\n\n  return message.reply({ embeds: [embed], components: rows });\n}\n\nmodule.exports = { enviarHistoricoCompras };\n";

function main() {
  // 1) Gates BASICO em lock / unlock / limpar
  for (const nome of ['lock.js', 'unlock.js', 'limpar.js']) {
    const p = findFile(nome, 'commands');
    log(nome + ': ' + p);
    patch(p, [{
      nome: 'gate BASICO em ' + nome,
      marker: 'temPlanoMinimo(interaction.guild?.id, "BASICO")',
      old: '  async execute(interaction) {\n    if (!interaction.guild) {',
      novo: '  async execute(interaction) {\n' + gateCompacto('BASICO', 'Básico') + '    if (!interaction.guild) {',
    }]);
  }

  // 2) Gate PRO em /insights
  const insightsPath = findFile('insights.js', 'commands');
  log('insights.js: ' + insightsPath);
  patch(insightsPath, [{
    nome: 'gate PRO em insights.js',
    marker: 'temPlanoMinimo(interaction.guild?.id, "PRO")',
    old: "  async execute(interaction) {\n    const guildId = interaction.guildId;",
    novo: "  async execute(interaction) {\n" + gateCompacto('PRO', 'Pro') + "    const guildId = interaction.guildId;",
  }]);

  // 3) minhascompras.js: remove slash, exporta funcao de prefixo
  const minhasPath = findFile('minhascompras.js', 'commands');
  log('minhascompras.js: ' + minhasPath);
  const conteudoAtual = fs.readFileSync(minhasPath, 'utf8');
  if (conteudoAtual.indexOf('function enviarHistoricoCompras') !== -1) {
    log('minhascompras.js: ja convertido para prefixo — pulado');
  } else {
    const bak = minhasPath + '.bak-' + Date.now();
    fs.writeFileSync(bak, conteudoAtual, 'utf8');
    log('backup: ' + bak);
    fs.writeFileSync(minhasPath, MINHASCOMPRAS_CONTEUDO, 'utf8');
    checarSintaxe(minhasPath, conteudoAtual);
  }

  // 4) messageHandler.js: adiciona !minhascompras + atualiza texto do !ajuda
  const msgHandlerPath = findFile('messageHandler.js', 'events');
  log('messageHandler.js: ' + msgHandlerPath);
  patch(msgHandlerPath, [
    {
      nome: 'handler !minhascompras',
      marker: '"!minhascompras"',
      old: '  if(message.content.trim() === "!ajuda"){',
      novo:
        '  if(message.content.trim() === "!minhascompras"){\n' +
        '    return require("../commands/minhascompras").enviarHistoricoCompras(message);\n' +
        '  }\n\n' +
        '  if(message.content.trim() === "!ajuda"){',
    },
    {
      nome: 'atualizar texto do !ajuda (meuspedidos -> !minhascompras)',
      marker: '`!minhascompras` — Seu histórico de compras',
      old: '"`/meuspedidos` — Seu histórico de compras\\n" +',
      novo: '"`!minhascompras` — Seu histórico de compras (comando por prefixo)\\n" +',
    },
  ]);

  log('concluido. Reinicie o bot.');
}

main();
