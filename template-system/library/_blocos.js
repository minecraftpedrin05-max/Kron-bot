// Blocos reutilizáveis para escrever templates mais rápido (arquivos que começam com "_" não são templates).
'use strict';

/** Categoria de staff padrão. `sep` é o separador visual usado no nome dos canais. */
function staff(sep, nome, extras) {
  return [nome || '🔒 STAFF', 'staff', [
    `🔐${sep}staff|Canal privado da equipe`,
    `📋${sep}logs|Registros automáticos do servidor`,
    `🛡️${sep}moderacao|Casos e ações de moderação`,
    ...(extras || []),
    'v:🔊 Reunião Staff',
  ]];
}

/** Categoria de informações padrão (somente leitura). */
function info(sep, nome, extras) {
  return [nome || '📌 INFORMAÇÕES', 'leitura', [
    `📜${sep}regras|Leia antes de participar`,
    `a:📢${sep}anuncios|Novidades e avisos oficiais`,
    ...(extras || []),
  ]];
}

/** Lista de canais de voz públicos. */
function vozes(nomes) {
  return nomes.map(n => `v:${n}`);
}

module.exports = { staff, info, vozes };
