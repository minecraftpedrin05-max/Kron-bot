// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/lock.js — KAEL SERVER TEMPLATES
//
//  Trava em memória por servidor. Garante que só UMA operação de template
//  (aplicar OU desfazer) rode por vez em cada guild.
//
//  Escopo: processo do bot (não é distribuído entre shards/processos —
//  este bot roda como processo único, então isso é suficiente).
//
//  Por ser só memória, a trava nunca "fica presa": se o processo cair
//  (crash) ou for reiniciado, o `Set` é recriado vazio junto com o
//  módulo — não existe estado de lock para limpar depois. Quem usa este
//  módulo só precisa garantir `destravar()` em um `finally`, para o caso
//  comum de erro tratado dentro do próprio processo (sem crash).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const travados = new Set();

/** Tenta travar a guild. Retorna true se conseguiu (e já travou), false se já estava travada. */
function tentarTravar(guildId) {
  if (travados.has(guildId)) return false;
  travados.add(guildId);
  return true;
}

/** Libera a trava. Seguro chamar mesmo se não estava travada (idempotente). */
function destravar(guildId) {
  travados.delete(guildId);
}

function estaTravado(guildId) {
  return travados.has(guildId);
}

/** Só para testes/diagnóstico. */
function _reset() {
  travados.clear();
}

module.exports = { tentarTravar, destravar, estaTravado, _reset };
