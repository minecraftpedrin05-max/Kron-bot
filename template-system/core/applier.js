// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/applier.js — KAEL SERVER TEMPLATES
//
//  Executa o plano do preflight, SEQUENCIALMENTE e com intervalo entre as
//  requisições (nunca dezenas de chamadas simultâneas; o discord.js ainda
//  aplica a fila de rate limit por cima disso):
//
//     1. Cargos  2. Categorias  3. Canais (permissões já nascem junto)  4. Ordem dos cargos
//
//  Só cria. Nunca apaga nem edita nada que já existia. Guarda exatamente o que
//  ESTA operação criou, para permitir o rollback (desfazer) sem tocar no resto.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const perms = require('./perms');

const INTERVALO_MS = 300;
const MAX_ERROS_SEGUIDOS = 3;
const CODIGOS_LIMITE = [30005, 30013]; // limite de cargos / canais atingido
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function msgErro(e) {
  if (!e) return 'erro desconhecido';
  if (e.code === 50013) return 'sem permissão (Missing Permissions)';
  if (e.code === 30005) return 'limite de cargos do Discord atingido';
  if (e.code === 30013) return 'limite de canais do Discord atingido';
  if (e.code === 50001) return 'sem acesso (Missing Access)';
  return String(e.message || e).slice(0, 140);
}

/** Converte overwrites simbólicos em overwrites com IDs reais (tipo cargo). */
function resolverOverwrites(lista, roleInfo, guildId) {
  const out = [];
  for (const o of lista || []) {
    for (const id of perms.resolverAlvo(o.alvo, guildId, roleInfo)) {
      out.push({ id, type: 0, allow: perms.bits(o.allow || []), deny: perms.bits(o.deny || []) });
    }
  }
  return out;
}

async function aplicar({ guild, plano, template, executorId, onProgress, deveParar, onEstagio, onRecurso }) {
  const reason = `Kael Templates — ${template.nome} (solicitado por ${executorId})`.slice(0, 480);
  const res = { criados: { cargos: [], categorias: [], canais: [] }, erros: [], parou: false, abortou: null };
  const totais = {
    cargos: plano.cargos.filter(c => c.acao === 'criar').length,
    categorias: plano.categorias.filter(c => c.acao === 'criar').length,
    canais: plano.categorias.reduce((a, c) => a + c.canais.filter(x => x.acao === 'criar').length, 0),
  };
  const feitos = { cargos: 0, categorias: 0, canais: 0 };
  let seguidos = 0;
  let me = guild.members.me || await guild.members.fetchMe().catch(() => null);

  const emitir = (estagio) => {
    if (!onProgress) return;
    const total = totais.cargos + totais.categorias + totais.canais;
    const feito = feitos.cargos + feitos.categorias + feitos.canais;
    onProgress({ estagio, totais, feitos: { ...feitos }, pct: total ? Math.floor((feito / total) * 100) : 100, erros: res.erros.length });
  };
  const falhou = (e, o) => {
    res.erros.push(`${o}: ${msgErro(e)}`);
    seguidos++;
    if (CODIGOS_LIMITE.includes(e && e.code)) res.abortou = `${msgErro(e)}. O restante não foi criado.`;
    else if (seguidos >= MAX_ERROS_SEGUIDOS) res.abortou = `${MAX_ERROS_SEGUIDOS} falhas seguidas (${msgErro(e)}). Interrompi para não criar o servidor pela metade.`;
  };
  const parar = () => { if (res.abortou) return true; if (deveParar && deveParar()) { res.parou = true; return true; } return false; };

  // Marca o estágio atual (persistido por quem chamou, ex.: para recovery após restart).
  // Nunca deixa um erro de persistência derrubar a aplicação em si.
  const estagio = (nome) => { try { if (onEstagio) onEstagio(nome); } catch (e) { console.error('[Kael Templates] onEstagio falhou:', e.message); } };
  // Avisa IMEDIATAMENTE que um recurso foi criado (antes de seguir pro próximo),
  // para quem persiste isso conseguir saber com certeza o que já existe mesmo
  // se o processo cair logo em seguida.
  const criou = (tipo, item) => { try { if (onRecurso) onRecurso(tipo, item); } catch (e) { console.error('[Kael Templates] onRecurso falhou:', e.message); } };

  const roleInfo = [];

  // ── 1. cargos ──
  estagio('CREATING_ROLES');
  emitir('Criando cargos...');
  const rolesCriadas = [];
  for (const c of plano.cargos) {
    if (c.acao === 'reutilizar') { roleInfo.push({ key: c.ref.key, tipo: c.ref.tipo, id: c.existenteId }); continue; }
    if (parar()) break;
    try {
      const r = await guild.roles.create({ name: c.nome, color: c.cor || undefined, hoist: c.hoist, mentionable: c.mentionable, permissions: c.bits, reason });
      roleInfo.push({ key: c.ref.key, tipo: c.ref.tipo, id: r.id });
      rolesCriadas.push(r);
      res.criados.cargos.push({ id: r.id, nome: r.name });
      criou('cargos', { id: r.id, nome: r.name });
      feitos.cargos++;
      seguidos = 0;
    } catch (e) { falhou(e, `Cargo "${c.nome}"`); }
    emitir('Criando cargos...');
    await sleep(INTERVALO_MS);
  }

  // ── 4 (feito logo após os cargos). Ordem relativa: só permuta entre as posições que os nossos cargos já ocupam ──
  if (rolesCriadas.length >= 2 && !res.parou && !res.abortou) {
    try {
      await guild.roles.fetch();
      const objs = rolesCriadas.map(r => guild.roles.cache.get(r.id)).filter(Boolean);
      const pos = objs.map(r => r.position);
      const ordenadoDesc = pos.every((p, i) => i === 0 || pos[i - 1] > p);
      if (!ordenadoDesc && objs.length === rolesCriadas.length) {
        const slots = [...pos].sort((a, b) => b - a);
        await guild.roles.setPositions(objs.map((r, i) => ({ role: r.id, position: slots[i] })));
      }
    } catch (e) { res.erros.push(`Ordem dos cargos: ${msgErro(e)} (os cargos foram criados, ajuste a ordem manualmente se necessário)`); }
  }

  // ── 2 e 3. categorias e canais ──
  estagio('CREATING_CATEGORIES');
  emitir('Criando categorias e canais...');
  let canaisEstagioEmitido = false;
  for (const cat of plano.categorias) {
    if (parar()) break;
    let catId = cat.existenteId;
    const ovCatSimb = cat.overwrites;
    if (cat.acao === 'criar') {
      try {
        const ov = resolverOverwrites(ovCatSimb, roleInfo, guild.id);
        const c = await guild.channels.create({ name: cat.nome, type: ChannelType.GuildCategory, permissionOverwrites: comBot(ov, me), reason });
        catId = c.id;
        res.criados.categorias.push({ id: c.id, nome: c.name });
        criou('categorias', { id: c.id, nome: c.name });
        feitos.categorias++;
        seguidos = 0;
      } catch (e) { falhou(e, `Categoria "${cat.nome}"`); }
      emitir('Criando categorias e canais...');
      await sleep(INTERVALO_MS);
    }
    const ovCat = resolverOverwrites(ovCatSimb, roleInfo, guild.id);

    for (const ch of cat.canais) {
      if (ch.acao === 'pular') continue;
      if (parar()) break;
      if (!catId) { res.erros.push(`Canal "${ch.nome}": a categoria "${cat.nome}" não foi criada`); continue; }
      if (!canaisEstagioEmitido) { estagio('CREATING_CHANNELS'); canaisEstagioEmitido = true; }
      try {
        const ov = perms.mesclar(ovCat, resolverOverwrites(ch.overwrites, roleInfo, guild.id));
        const opcoes = { name: ch.nome, type: ch.tipoDiscord, parent: catId, permissionOverwrites: comBot(ov, me), reason };
        const texto = ch.tipoDiscord === ChannelType.GuildText || ch.tipoDiscord === ChannelType.GuildForum;
        if (ch.topico && (texto || ch.tipoDiscord === ChannelType.GuildAnnouncement)) opcoes.topic = ch.topico;
        if (texto && ch.slowmode) opcoes.rateLimitPerUser = ch.slowmode;
        if (ch.tipoDiscord === ChannelType.GuildVoice && ch.limite) opcoes.userLimit = ch.limite;
        const c = await guild.channels.create(opcoes);
        res.criados.canais.push({ id: c.id, nome: c.name });
        criou('canais', { id: c.id, nome: c.name });
        feitos.canais++;
        seguidos = 0;
      } catch (e) { falhou(e, `Canal "${ch.nome}"`); }
      emitir('Criando canais...');
      await sleep(INTERVALO_MS);
    }
  }
  // As permissões já nascem junto com cada categoria/canal (overwrites na própria
  // chamada de criação) — não existe um "passo" à parte no Discord para isso.
  // Emitimos o estágio aqui só para expor o mesmo vocabulário pedido (STARTED →
  // ... → APPLYING_PERMISSIONS → COMPLETED/FAILED) a quem persiste o progresso.
  if (!res.abortou && !res.parou) estagio('APPLYING_PERMISSIONS');
  emitir(res.abortou ? 'Interrompido' : res.parou ? 'Interrompido pelo usuário' : 'Finalizando...');
  return res;
}

/** Garante que o bot continue enxergando canais privados que ele mesmo criou (necessário para gerenciá-los/removê-los). */
function comBot(ov, me) {
  if (!me) return ov;
  const privado = ov.some(o => (o.deny & PermissionFlagsBits.ViewChannel) !== 0n);
  if (!privado) return ov;
  return [...ov, { id: me.id, type: 1, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.Connect, deny: 0n }];
}

/**
 * ROLLBACK: remove SOMENTE o que a aplicação registrada criou (por ID).
 *  • canais primeiro, depois categorias (só se estiverem vazias), depois cargos;
 *  • categoria com canais que não são do template é preservada;
 *  • nunca apaga por nome, nunca varre o servidor.
 */
async function desfazer({ guild, criados, executorId, onProgress }) {
  const reason = `Kael Templates — desfazer aplicação (solicitado por ${executorId})`;
  const out = { removidos: { canais: 0, categorias: 0, cargos: 0 }, jaNaoExistiam: 0, preservados: [], erros: [] };
  const total = (criados.canais || []).length + (criados.categorias || []).length + (criados.cargos || []).length;
  let feitos = 0;
  const tick = (msg) => { if (onProgress) onProgress({ msg, pct: total ? Math.floor((feitos / total) * 100) : 100 }); };

  for (const id of criados.canais || []) {
    tick('Removendo canais...');
    try {
      const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
      if (!ch) out.jaNaoExistiam++; else { await ch.delete(reason); out.removidos.canais++; }
    } catch (e) { out.erros.push(`Canal ${id}: ${msgErro(e)}`); }
    feitos++;
    await sleep(INTERVALO_MS);
  }
  for (const id of criados.categorias || []) {
    tick('Removendo categorias...');
    try {
      const cat = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
      if (!cat) out.jaNaoExistiam++;
      else {
        const filhos = [...guild.channels.cache.values()].filter(c => c.parentId === id).length;
        if (filhos > 0) out.preservados.push(`Categoria "${cat.name}" preservada: contém ${filhos} canal(is) que não foram criados por este template`);
        else { await cat.delete(reason); out.removidos.categorias++; }
      }
    } catch (e) { out.erros.push(`Categoria ${id}: ${msgErro(e)}`); }
    feitos++;
    await sleep(INTERVALO_MS);
  }
  for (const id of criados.cargos || []) {
    tick('Removendo cargos...');
    try {
      const r = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
      if (!r) out.jaNaoExistiam++;
      else if (r.managed) out.preservados.push(`Cargo "${r.name}" é gerenciado por integração e foi preservado`);
      else { await r.delete(reason); out.removidos.cargos++; }
    } catch (e) { out.erros.push(`Cargo ${id}: ${msgErro(e)}`); }
    feitos++;
    await sleep(INTERVALO_MS);
  }
  tick('Concluído');
  return out;
}

module.exports = { aplicar, desfazer, resolverOverwrites, INTERVALO_MS };
