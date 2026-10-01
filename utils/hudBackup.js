'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KAEL HUD — backup e restauração da estrutura do servidor
//
// Salva cargos, categorias, canais e permissões (e, opcionalmente, quais
// cargos cada membro tinha) em arquivos JSON no mesmo disco do banco de dados.
// A restauração NUNCA apaga nada que existe: só recria o que falta e, no modo
// "tudo", também corrige nome, permissões e ordem do que já existe.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../database/dataDir');
const { tentarTravar, destravar } = require('../template-system/core/lock');

const BASE = path.join(DATA_DIR, 'hud-backups');
const ARQ_AUTO = path.join(BASE, '_auto.json');
const MAX_MANUAIS = 10;
const MAX_AUTO = 5;
const RAZAO = 'Kael HUD: restauração da estrutura';

const TIPOS_OK = new Set([0, 2, 4, 5, 13, 15, 16]);
const TEXTUAIS = new Set([0, 5, 15, 16]);
const VOZ = new Set([2, 13]);
const CATEGORIA = 4;
const ID_BACKUP = /^\d{10,16}-(manual|auto)$/;

let agendado = false;

function msgErro(e) {
  return String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 140);
}

function pastaDe(guildId) {
  const p = path.join(BASE, String(guildId));
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// ─── Captura ────────────────────────────────────────────────────────────────

async function capturar(guild, opcoes = {}) {
  const incluirMembros = opcoes.membros !== false;
  await guild.roles.fetch();
  await guild.channels.fetch();

  const cargos = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id && !r.managed)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color || 0,
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
    }));
  const idsCargos = new Set(cargos.map(c => c.id));

  const canais = [...guild.channels.cache.values()]
    .filter(c => TIPOS_OK.has(c.type))
    .map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId || null,
      position: c.rawPosition ?? c.position ?? 0,
      topic: c.topic ?? null,
      nsfw: !!c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser || 0,
      bitrate: c.bitrate ?? null,
      userLimit: c.userLimit ?? 0,
      overwrites: [...((c.permissionOverwrites && c.permissionOverwrites.cache) ? c.permissionOverwrites.cache.values() : [])]
        .map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow.bitfield.toString(),
          deny: o.deny.bitfield.toString(),
        })),
    }));

  const membros = {};
  let membrosIncluidos = false;
  if (incluirMembros) {
    try {
      await guild.members.fetch();
      for (const m of guild.members.cache.values()) {
        const ids = [...m.roles.cache.keys()].filter(id => idsCargos.has(id));
        if (ids.length) membros[m.id] = ids;
      }
      membrosIncluidos = true;
    } catch (_) { /* segue sem os cargos dos membros */ }
  }

  return {
    v: 1,
    criadoEm: Date.now(),
    guildId: guild.id,
    nome: guild.name,
    everyone: guild.roles.everyone.permissions.bitfield.toString(),
    cargos,
    canais,
    membros,
    membrosIncluidos,
  };
}

// ─── Armazenamento ──────────────────────────────────────────────────────────

function resumo(id, snap) {
  return {
    id,
    criadoEm: snap.criadoEm,
    tipo: snap.tipo || 'manual',
    nome: snap.nome,
    cargos: (snap.cargos || []).length,
    canais: (snap.canais || []).filter(c => c.type !== CATEGORIA).length,
    categorias: (snap.canais || []).filter(c => c.type === CATEGORIA).length,
    membros: Object.keys(snap.membros || {}).length,
    membrosIncluidos: !!snap.membrosIncluidos,
  };
}

function listar(guildId) {
  const dir = pastaDe(guildId);
  const saida = [];
  for (const arq of fs.readdirSync(dir)) {
    if (!arq.endsWith('.json')) continue;
    const id = arq.slice(0, -5);
    if (!ID_BACKUP.test(id)) continue;
    try {
      const snap = JSON.parse(fs.readFileSync(path.join(dir, arq), 'utf8'));
      saida.push(resumo(id, snap));
    } catch (_) { /* arquivo corrompido: ignora */ }
  }
  return saida.sort((a, b) => b.criadoEm - a.criadoEm);
}

function carregar(guildId, id) {
  if (!ID_BACKUP.test(String(id))) throw new Error('Backup inválido.');
  return JSON.parse(fs.readFileSync(path.join(pastaDe(guildId), id + '.json'), 'utf8'));
}

function remover(guildId, id) {
  if (!ID_BACKUP.test(String(id))) return false;
  try { fs.unlinkSync(path.join(pastaDe(guildId), id + '.json')); return true; } catch (_) { return false; }
}

function podar(guildId) {
  const lista = listar(guildId);
  lista.filter(b => b.tipo === 'auto').slice(MAX_AUTO).forEach(b => remover(guildId, b.id));
  lista.filter(b => b.tipo !== 'auto').slice(MAX_MANUAIS).forEach(b => remover(guildId, b.id));
}

function salvar(guildId, snap, tipo = 'manual') {
  snap.tipo = tipo;
  const id = `${snap.criadoEm}-${tipo}`;
  fs.writeFileSync(path.join(pastaDe(guildId), id + '.json'), JSON.stringify(snap));
  podar(guildId);
  return id;
}

/** True quando o servidor tem muito menos canais que o último backup (possível ataque). */
function parecendoDestruido(snap, ultimo) {
  if (!ultimo) return false;
  const atuais = snap.canais.filter(c => c.type !== CATEGORIA).length;
  return ultimo.canais >= 8 && atuais < ultimo.canais * 0.4;
}

// ─── Backup automático ──────────────────────────────────────────────────────

function lerAuto() {
  try { return JSON.parse(fs.readFileSync(ARQ_AUTO, 'utf8')); } catch (_) { return {}; }
}

function gravarAuto(cfg) {
  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(ARQ_AUTO, JSON.stringify(cfg, null, 1));
}

function getAuto(guildId) {
  const c = lerAuto()[guildId] || {};
  return { ativo: !!c.ativo, horas: c.horas || 24, ultimo: c.ultimo || 0 };
}

function setAuto(guildId, patch) {
  const cfg = lerAuto();
  cfg[guildId] = { ...getAuto(guildId), ...patch };
  gravarAuto(cfg);
  return cfg[guildId];
}

function agendar(client) {
  if (agendado) return;
  agendado = true;

  const tick = async () => {
    const cfg = lerAuto();
    for (const [gid, c] of Object.entries(cfg)) {
      if (!c || !c.ativo) continue;
      const guild = client.guilds.cache.get(gid);
      if (!guild) continue;
      if (Date.now() - (c.ultimo || 0) < (c.horas || 24) * 3600 * 1000) continue;
      if (!tentarTravar(gid)) continue;
      try {
        const snap = await capturar(guild);
        const ultimo = listar(gid)[0];
        if (parecendoDestruido(snap, ultimo)) {
          console.warn(`[HUD] Backup automático pulado em ${gid}: o servidor tem bem menos canais que o último backup.`);
        } else {
          salvar(gid, snap, 'auto');
        }
        setAuto(gid, { ultimo: Date.now() });
      } catch (e) {
        console.error('[HUD] Falha no backup automático:', msgErro(e));
      } finally {
        destravar(gid);
      }
    }
  };

  setTimeout(() => { tick().catch(() => {}); }, 2 * 60 * 1000);
  setInterval(() => { tick().catch(() => {}); }, 60 * 60 * 1000);
}

// ─── Restauração ────────────────────────────────────────────────────────────

/** Liga cada cargo salvo a um cargo que existe hoje (pelo ID, senão pelo nome). */
function mapearCargos(guild, snap) {
  const mapa = new Map([[guild.id, guild.id]]);
  const usados = new Set();
  const existentes = [...guild.roles.cache.values()].filter(r => r.id !== guild.id && !r.managed);
  for (const c of snap.cargos || []) {
    let r = guild.roles.cache.get(c.id);
    if (r && (r.managed || usados.has(r.id))) r = null;
    if (!r) r = existentes.find(x => x.name === c.name && !usados.has(x.id));
    if (r) { mapa.set(c.id, r.id); usados.add(r.id); }
  }
  return mapa;
}

function sobrescritas(guild, lista, mapaCargo) {
  const out = [];
  for (const o of lista || []) {
    let id = null;
    if (o.type === 0) id = mapaCargo.get(o.id) || (guild.roles.cache.has(o.id) ? o.id : null);
    else if (o.type === 1) id = guild.members.cache.has(o.id) ? o.id : null;
    if (!id) continue;
    out.push({ id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) });
  }
  return out;
}

function tiposCompat(t) {
  if (t === 5 || t === 15 || t === 16) return [t, 0];
  if (t === 13) return [13, 2];
  return [t];
}

async function criarCanal(guild, c, parentId, overwrites) {
  const base = { name: c.name, type: c.type, reason: RAZAO };
  if (c.type !== CATEGORIA && parentId) base.parent = parentId;
  if (overwrites.length) base.permissionOverwrites = overwrites;
  if (TEXTUAIS.has(c.type)) {
    if (c.topic) base.topic = c.topic;
    base.nsfw = !!c.nsfw;
    if (c.rateLimitPerUser) base.rateLimitPerUser = c.rateLimitPerUser;
  }
  if (VOZ.has(c.type)) {
    if (c.bitrate) base.bitrate = Math.min(c.bitrate, guild.maximumBitrate || c.bitrate);
    if (c.type === 2 && c.userLimit) base.userLimit = c.userLimit;
  }
  try {
    return await guild.channels.create(base);
  } catch (e) {
    const alt = c.type === 13 ? 2 : (c.type === 5 || c.type === 15 || c.type === 16) ? 0 : null;
    if (alt === null) throw e;
    delete base.userLimit;
    return await guild.channels.create({ ...base, type: alt });
  }
}

/**
 * Restaura a estrutura salva.
 * modo "faltando": só recria o que não existe.
 * modo "tudo": também corrige nome, permissões e ordem do que já existe.
 */
async function restaurar(guild, snap, opcoes = {}) {
  const modo = opcoes.modo === 'tudo' ? 'tudo' : 'faltando';
  const onProgress = opcoes.onProgress || (() => {});
  const rel = {
    modo, cargosCriados: 0, cargosExistentes: 0, canaisCriados: 0, canaisExistentes: 0,
    ajustados: 0, erros: [],
  };
  const err = (onde, e) => { rel.erros.push(`${onde}: ${msgErro(e)}`); };

  await guild.roles.fetch();
  await guild.channels.fetch();
  try { await guild.members.fetch(); } catch (_) { /* sem membros: ignora overwrites de membros */ }

  const total = (snap.cargos || []).length + (snap.canais || []).length;
  let feitos = 0;
  const avancar = async (txt) => {
    feitos++;
    await onProgress(`${txt}\n${feitos}/${total} itens`);
  };

  if (modo === 'tudo') {
    try {
      if (snap.nome && snap.nome !== guild.name) await guild.setName(snap.nome, RAZAO);
      await guild.roles.everyone.setPermissions(BigInt(snap.everyone), RAZAO);
      rel.ajustados++;
    } catch (e) { err('nome/permissões do @everyone', e); }
  }

  // Cargos
  const mapaCargo = mapearCargos(guild, snap);
  const cargosOrd = [...(snap.cargos || [])].sort((a, b) => a.position - b.position);
  for (const c of cargosOrd) {
    const atualId = mapaCargo.get(c.id);
    const atual = atualId ? guild.roles.cache.get(atualId) : null;
    try {
      if (atual) {
        rel.cargosExistentes++;
        if (modo === 'tudo' && atual.editable) {
          await atual.edit({
            name: c.name, color: c.color, hoist: c.hoist, mentionable: c.mentionable,
            permissions: BigInt(c.permissions), reason: RAZAO,
          });
          rel.ajustados++;
        }
      } else {
        const novo = await guild.roles.create({
          name: c.name, color: c.color, hoist: c.hoist, mentionable: c.mentionable,
          permissions: BigInt(c.permissions), reason: RAZAO,
        });
        mapaCargo.set(c.id, novo.id);
        rel.cargosCriados++;
      }
    } catch (e) { err(`cargo "${c.name}"`, e); }
    await avancar(`Cargos… ${c.name}`);
  }

  try {
    const topo = guild.members.me.roles.highest.position;
    const posicoes = [];
    for (const c of cargosOrd) {
      const id = mapaCargo.get(c.id);
      const r = id ? guild.roles.cache.get(id) : null;
      if (r && r.editable) posicoes.push({ role: r.id, position: Math.max(1, Math.min(c.position, topo - 1)) });
    }
    if (posicoes.length) await guild.roles.setPositions(posicoes);
  } catch (e) { err('ordem dos cargos', e); }

  // Canais: categorias primeiro, depois o resto
  const canaisOrd = [...(snap.canais || [])].sort((a, b) => {
    if ((a.type === CATEGORIA) !== (b.type === CATEGORIA)) return a.type === CATEGORIA ? -1 : 1;
    return a.position - b.position;
  });
  const usadosCanal = new Set();
  const mapaCanal = new Map();

  const acharCanal = (c, parentNovo) => {
    const porId = guild.channels.cache.get(c.id);
    if (porId && tiposCompat(c.type).includes(porId.type) && !usadosCanal.has(porId.id)) return porId;
    return [...guild.channels.cache.values()].find(y =>
      !usadosCanal.has(y.id) && tiposCompat(c.type).includes(y.type) && y.name === c.name &&
      (c.type === CATEGORIA || (y.parentId || null) === (parentNovo || null)));
  };

  for (const c of canaisOrd) {
    const parentNovo = c.parentId ? (mapaCanal.get(c.parentId) || (guild.channels.cache.has(c.parentId) ? c.parentId : null)) : null;
    const ovs = sobrescritas(guild, c.overwrites, mapaCargo);
    try {
      const atual = acharCanal(c, parentNovo);
      if (atual) {
        usadosCanal.add(atual.id);
        mapaCanal.set(c.id, atual.id);
        rel.canaisExistentes++;
        if (modo === 'tudo') {
          const patch = { name: c.name, permissionOverwrites: ovs, reason: RAZAO };
          if (c.type !== CATEGORIA) patch.parent = parentNovo || null;
          if (TEXTUAIS.has(atual.type)) {
            patch.topic = c.topic || null;
            patch.nsfw = !!c.nsfw;
            patch.rateLimitPerUser = c.rateLimitPerUser || 0;
          }
          await atual.edit(patch);
          rel.ajustados++;
        }
      } else {
        const novo = await criarCanal(guild, c, parentNovo, ovs);
        usadosCanal.add(novo.id);
        mapaCanal.set(c.id, novo.id);
        rel.canaisCriados++;
      }
    } catch (e) { err(`canal "${c.name}"`, e); }
    await avancar(`Canais… ${c.name}`);
  }

  // Ordem dos canais (por pasta)
  const grupos = new Map();
  for (const c of canaisOrd) {
    const novo = mapaCanal.get(c.id);
    if (!novo) continue;
    const chave = c.type === CATEGORIA ? 'raiz' : (mapaCanal.get(c.parentId) || 'raiz');
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push({ id: novo, pos: c.position });
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => a.pos - b.pos);
    try {
      await guild.channels.setPositions(lista.map((x, i) => ({ channel: x.id, position: i })));
    } catch (e) { err('ordem dos canais', e); }
  }

  await onProgress('Concluído.');
  return rel;
}

/** Devolve aos membros os cargos que eles tinham no backup. */
async function restaurarCargosMembros(guild, snap, opcoes = {}) {
  const onProgress = opcoes.onProgress || (() => {});
  const rel = { membros: 0, cargosDados: 0, ausentes: 0, erros: [] };
  await guild.roles.fetch();
  await guild.members.fetch();
  const mapa = mapearCargos(guild, snap);
  const topo = guild.members.me.roles.highest.position;
  const entradas = Object.entries(snap.membros || {});
  let i = 0;
  for (const [userId, ids] of entradas) {
    i++;
    const membro = guild.members.cache.get(userId);
    if (!membro) { rel.ausentes++; continue; }
    const quer = ids
      .map(id => mapa.get(id))
      .filter(id => id && !membro.roles.cache.has(id) && guild.roles.cache.get(id) && guild.roles.cache.get(id).position < topo);
    if (!quer.length) continue;
    try {
      await membro.roles.add(quer, RAZAO);
      rel.membros++;
      rel.cargosDados += quer.length;
    } catch (e) {
      if (rel.erros.length < 20) rel.erros.push(`${membro.user ? membro.user.username : userId}: ${msgErro(e)}`);
    }
    if (i % 5 === 0) await onProgress(`Cargos dos membros…\n${i}/${entradas.length} membros`);
  }
  await onProgress('Concluído.');
  return rel;
}

module.exports = {
  capturar, salvar, listar, carregar, remover, parecendoDestruido,
  getAuto, setAuto, agendar, restaurar, restaurarCargosMembros, mapearCargos,
  tentarTravar, destravar,
};
