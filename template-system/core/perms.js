// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/perms.js — KAEL SERVER TEMPLATES
//
//  Tudo sobre permissões num só lugar:
//    • lista de permissões suportadas (só nomes REAIS do discord.js v14);
//    • permissões padrão de cada "tipo" de cargo (owner, admin, mod, ...);
//    • presets de permissão de canal/categoria (publico, leitura, staff, vip...);
//    • resolução de alvos (@everyone, #grupo, tipo de cargo) para IDs reais.
//
//  Regra de ouro: "Administrator" só existe no tipo `owner` e SÓ é aplicado se
//  o administrador que está aplicando o template ligar essa opção de forma
//  explícita na tela de confirmação. Sem isso, o cargo owner recebe o preset
//  ADMIN_LITE (gestão completa, sem Administrator).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { PermissionFlagsBits } = require('discord.js');

const NOMES_VALIDOS = [
  'ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'AttachFiles', 'EmbedLinks',
  'UseExternalEmojis', 'UseExternalStickers', 'ManageMessages', 'ManageChannels', 'ManageRoles',
  'ManageWebhooks', 'ManageThreads', 'ManageNicknames', 'ChangeNickname', 'MentionEveryone',
  'Connect', 'Speak', 'Stream', 'UseVAD', 'MoveMembers', 'MuteMembers', 'DeafenMembers',
  'PrioritySpeaker', 'CreateInstantInvite', 'KickMembers', 'BanMembers', 'ModerateMembers',
  'ViewAuditLog', 'CreatePublicThreads', 'SendMessagesInThreads', 'Administrator',
  'RequestToSpeak', 'UseApplicationCommands', 'ManageEvents',
];

// Permissões que merecem alerta no preview / na revisão da comunidade.
const PERMS_SENSIVEIS = ['Administrator', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'MentionEveryone', 'ManageWebhooks'];

function nomeValido(n) {
  return typeof n === 'string' && NOMES_VALIDOS.includes(n) && PermissionFlagsBits[n] !== undefined;
}

function bits(lista) {
  let b = 0n;
  for (const n of lista || []) if (nomeValido(n)) b |= PermissionFlagsBits[n];
  return b;
}

// ── Permissões por tipo de cargo ─────────────────────────────────────────
const BASE_VIP = ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'ChangeNickname', 'CreatePublicThreads'];
const ADMIN_LITE = [
  'ManageChannels', 'ManageRoles', 'ManageMessages', 'ManageThreads', 'ManageWebhooks', 'ManageNicknames',
  'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog', 'MentionEveryone', 'MoveMembers',
  'MuteMembers', 'DeafenMembers', 'CreateInstantInvite', 'AttachFiles', 'EmbedLinks', 'UseExternalEmojis',
];

const PERMS_TIPO = {
  owner: ['Administrator'],
  admin: ADMIN_LITE,
  mod: ['ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'ModerateMembers', 'MoveMembers', 'MuteMembers', 'DeafenMembers', 'ViewAuditLog', 'AttachFiles', 'EmbedLinks'],
  helper: ['ManageMessages', 'ManageThreads', 'ModerateMembers', 'MuteMembers', 'AttachFiles', 'EmbedLinks'],
  support: ['ManageMessages', 'ManageThreads', 'MoveMembers', 'AttachFiles', 'EmbedLinks', 'UseExternalEmojis'],
  staff: ['ManageMessages', 'ManageThreads', 'ModerateMembers', 'AttachFiles', 'EmbedLinks'],
  seller: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'CreatePublicThreads'],
  dev: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'CreatePublicThreads', 'ManageThreads'],
  partner: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis'],
  vip: BASE_VIP,
  premium: [...BASE_VIP, 'Stream'],
  booster: BASE_VIP,
  creator: [...BASE_VIP, 'Stream'],
  member: [],
  cosmetic: [],
  bot: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'UseExternalEmojis', 'AddReactions'],
};
const TIPOS_CARGO = Object.keys(PERMS_TIPO);

// Tipos que aparecem sempre no topo da hierarquia visual (hoist) por padrão.
const HOIST_PADRAO = ['owner', 'admin', 'mod', 'helper', 'support', 'staff', 'seller', 'partner', 'vip', 'premium', 'dev', 'creator', 'booster'];

// ── Grupos de tipos (usados nos alvos "#grupo" dos presets) ──────────────
const GRUPOS = {
  staff: ['owner', 'admin', 'mod', 'helper', 'support', 'staff'],
  gestao: ['owner', 'admin'],
  vendas: ['owner', 'admin', 'seller'],
  vip: ['owner', 'admin', 'mod', 'vip', 'premium', 'booster'],
  parceiros: ['owner', 'admin', 'mod', 'partner'],
  dev: ['owner', 'admin', 'dev'],
  membros: ['owner', 'admin', 'mod', 'helper', 'support', 'staff', 'seller', 'partner', 'vip', 'premium', 'booster', 'member', 'dev', 'creator'],
  creator: ['owner', 'admin', 'mod', 'creator'],
};

// ── Presets de canal / categoria ─────────────────────────────────────────
const ACESSO = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'Connect', 'Speak'];
const restrito = (grupo) => [
  { alvo: '@everyone', deny: ['ViewChannel'] },
  { alvo: '#' + grupo, allow: ACESSO },
];

const PRESETS = {
  publico:   { desc: 'Todos veem e participam', ov: [] },
  leitura:   { desc: 'Todos leem; só a equipe escreve', ov: [{ alvo: '@everyone', deny: ['SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads'] }, { alvo: '#staff', allow: ['SendMessages'] }] },
  vitrine:   { desc: 'Todos leem; só vendedores/gestão escrevem', ov: [{ alvo: '@everyone', deny: ['SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads'] }, { alvo: '#vendas', allow: ['SendMessages'] }] },
  criadores: { desc: 'Todos leem; só criadores/gestão escrevem', ov: [{ alvo: '@everyone', deny: ['SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads'] }, { alvo: '#creator', allow: ['SendMessages'] }] },
  staff:     { desc: 'Somente a equipe', ov: restrito('staff') },
  gestao:    { desc: 'Somente Owner/Admin', ov: restrito('gestao') },
  vendas:    { desc: 'Somente vendedores e gestão', ov: restrito('vendas') },
  vip:       { desc: 'Somente VIP/Premium e equipe', ov: restrito('vip') },
  parceiros: { desc: 'Somente parceiros e equipe', ov: restrito('parceiros') },
  dev:       { desc: 'Somente desenvolvedores e gestão', ov: restrito('dev') },
  membros:   { desc: 'Somente quem tem cargo de membro (ou superior)', ov: restrito('membros') },
  palco:     { desc: 'Voz: todos ouvem, só a equipe fala', ov: [{ alvo: '@everyone', deny: ['Speak'] }, { alvo: '#staff', allow: ['Speak', 'PrioritySpeaker'] }] },
  mudo:      { desc: 'Voz/texto sem anexos e links', ov: [{ alvo: '@everyone', deny: ['AttachFiles', 'EmbedLinks'] }, { alvo: '#staff', allow: ['AttachFiles', 'EmbedLinks'] }] },
};
const NOMES_PRESET = Object.keys(PRESETS);

function presetValido(n) { return typeof n === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, n); }

/** Tipos de cargo exigidos por um preset (para validar que o template tem os cargos necessários). */
function tiposExigidos(presetNome) {
  const p = PRESETS[presetNome];
  if (!p) return [];
  const out = [];
  for (const o of p.ov) if (o.alvo.startsWith('#') && o.alvo !== '#staff') out.push(o.alvo.slice(1));
  return out;
}

/**
 * Resolve um alvo em IDs.
 *  '@everyone' → [guildId]; '#grupo' → todos os cargos do grupo; 'tipo' → cargos daquele tipo; 'key' → cargo com aquela chave.
 * @param roleInfo lista [{key, tipo, id}] (id real ou de cargo existente reaproveitado)
 */
function resolverAlvo(alvo, guildId, roleInfo) {
  if (alvo === '@everyone') return [guildId];
  if (alvo.startsWith('#')) {
    const tipos = GRUPOS[alvo.slice(1)] || [];
    return roleInfo.filter(r => tipos.includes(r.tipo) && r.id).map(r => r.id);
  }
  return roleInfo.filter(r => (r.key === alvo || r.tipo === alvo) && r.id).map(r => r.id);
}

/** Une listas de overwrites por alvo. Canal sobrepõe categoria (allow do canal vence deny da categoria). */
function mesclar(base, extra) {
  const mapa = new Map();
  const add = (o, sobrepor) => {
    const k = o.id;
    const atual = mapa.get(k) || { id: k, allow: 0n, deny: 0n, type: o.type };
    let allow = atual.allow, deny = atual.deny;
    if (sobrepor) {
      allow = (allow | o.allow) & ~o.deny;
      deny = (deny & ~o.allow) | o.deny;
    } else { allow |= o.allow; deny |= o.deny; }
    mapa.set(k, { id: k, allow, deny, type: o.type });
  };
  for (const o of base || []) add(o, false);
  for (const o of extra || []) add(o, true);
  return [...mapa.values()];
}

module.exports = {
  NOMES_VALIDOS, PERMS_SENSIVEIS, PERMS_TIPO, TIPOS_CARGO, HOIST_PADRAO, GRUPOS, PRESETS, NOMES_PRESET, ADMIN_LITE,
  nomeValido, bits, presetValido, tiposExigidos, resolverAlvo, mesclar,
};
