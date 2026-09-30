// instalar.js — roda na raiz do projeto: node instalar.js
const fs = require('fs');
const path = require('path');

// ── 1. Copia ticketconfig.js pra commands/ ──────────────
const src1 = path.join(__dirname, 'ticket-system/ticketconfig.js');
const dst1 = path.join(__dirname, 'commands/ticketconfig.js');
fs.copyFileSync(src1, dst1);
console.log('<:positivo:1528401238197276702> commands/ticketconfig.js criado!');

// ── 2. Adiciona ticket handler no buttonHandler.js ───────
let handler = fs.readFileSync('events/buttonHandler.js', 'utf8');

if(handler.includes('ticket_select')){
  console.log('⚠️  Ticket handler já existe no buttonHandler.js, pulando...');
} else {
  const addon = fs.readFileSync(path.join(__dirname, 'ticket-system/ticket-handler-addon.js'), 'utf8');
  // Remove comentários de cabeçalho do addon
  const code = addon.replace(/\/\/ ═.*\n.*\n.*\n.*\n/,'').trim();
  handler = handler.replace('if(customId.startsWith("emu3_"))', code + '\n\n  if(customId.startsWith("emu3_"))');
  fs.writeFileSync('events/buttonHandler.js', handler);
  console.log('<:positivo:1528401238197276702> Ticket handler adicionado no buttonHandler.js!');
}

// ── 3. Adiciona require e allCommands no index.js ────────
let index = fs.readFileSync('index.js', 'utf8');

if(index.includes('ticketconfigCmd')){
  console.log('⚠️  ticketconfigCmd já existe no index.js, pulando...');
} else {
  index = index.replace(
    'const suporteCmd      = require("./commands/suporte");',
    'const suporteCmd      = require("./commands/suporte");\nconst ticketconfigCmd = require("./commands/ticketconfig");'
  );
  index = index.replace(
    'suporteCmd, ...adminCmds',
    'suporteCmd, ticketconfigCmd, ...adminCmds'
  );
  fs.writeFileSync('index.js', index);
  console.log('<:positivo:1528401238197276702> ticketconfigCmd adicionado no index.js!');
}

console.log('\n<:canal:1524207214791884890> Instalação concluída!');
console.log('Agora rode: node deploy-commands.js');
