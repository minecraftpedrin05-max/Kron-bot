// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/preflight.js — KAEL SERVER TEMPLATES
//
//  Antes de qualquer criação: valida o template, verifica permissões/hierarquia/
//  limites do bot, detecta recursos que já existem e monta o PLANO de execução
//  (o que será criado, o que será reaproveitado e por quê). Nada é alterado aqui.
//
//  Se algo impede a aplicação, o motivo exato vem em `erros` — o sistema nunca
//  finge que vai funcionar.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const schema = require('./schema');
const perms = require('./perms');

const ROTULO = { ManageChannels: 'Gerenciar Canais', ManageRoles: 'Gerenciar Cargos', ViewChannel: 'Ver Canais' };
const MAX_CANAIS_GUILD = 500;
const MAX_CARGOS_GUILD = 250;

const nomeIgual = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function comunidadeAtiva(guild) {
  return Array.isArray(guild.features) && guild.features.includes('COMMUNITY');
}

/** Tipo REAL de canal do Discord. Anúncio/palco/fórum exigem servidor Comunidade; sem isso há substituição honesta. */
function tipoCanal(guild, tipo) {
  const com = comunidadeAtiva(guild);
  switch (tipo) {
    case 'voz': return { discord: ChannelType.GuildVoice, usado: 'voz', subst: null };
    case 'anuncios': return com ? { discord: ChannelType.GuildAnnouncement, usado: 'anuncios', subst: null } : { discord: ChannelType.GuildText, usado: 'texto', subst: 'anúncios → texto' };
    case 'palco': return com ? { discord: ChannelType.GuildStageVoice, usado: 'palco', subst: null } : { discord: ChannelType.GuildVoice, usado: 'voz', subst: 'palco → voz' };
    case 'forum': return com ? { discord: ChannelType.GuildForum, usado: 'forum', subst: null } : { discord: ChannelType.GuildText, usado: 'texto', subst: 'fórum → texto' };
    default: return { discord: ChannelType.GuildText, usado: 'texto', subst: null };
  }
}

function nomeCanal(nome, tipoUsado) {
  if (tipoUsado === 'voz' || tipoUsado === 'palco') return nome.slice(0, 100);
  return nome.toLowerCase().replace(/\s+/g, '-').replace(/-{2,}/g, '-').slice(0, 100);
}

function expandir(preset, overwrites) {
  const base = preset && perms.PRESETS[preset] ? perms.PRESETS[preset].ov : [];
  return [...base, ...(overwrites || [])];
}

/**
 * @param {object} guild
 * @param {object} template  canônico
 * @param {{permitirAdmin:boolean, duplicar:boolean}} opcoes
 */
async function verificar(guild, template, opcoes) {
  opcoes = { permitirAdmin: false, duplicar: false, ...(opcoes || {}) };
  const erros = [];
  const avisos = [];
  const checks = [];

  const v = schema.validar(template);
  if (!v.ok) return { ok: false, erros: ['Template inválido: ' + v.erros.slice(0, 3).join(' | ')], avisos, checks, plano: null };
  checks.push('Template validado');

  let me = guild.members.me;
  if (!me) me = await guild.members.fetchMe().catch(() => null);
  if (!me) return { ok: false, erros: ['Não consegui localizar o bot neste servidor.'], avisos, checks, plano: null };
  checks.push('Bot presente no servidor');

  const botAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  const botBits = me.permissions.bitfield;

  // ── plano: cargos ──
  const cargosCache = [...guild.roles.cache.values()].filter(r => r.id !== guild.id);
  const omitidas = new Set();
  const cargos = template.cargos.map(c => {
    const lista = schema.permsDoCargo(c, opcoes.permitirAdmin);
    const ok = [];
    for (const p of lista) {
      if (botAdmin || (botBits & perms.bits([p])) !== 0n) ok.push(p); else omitidas.add(p);
    }
    const existente = opcoes.duplicar ? null : cargosCache.find(r => nomeIgual(r.name, c.nome));
    return { ref: c, nome: c.nome, cor: c.cor, hoist: !!c.hoist, mentionable: !!c.mentionable, perms: ok, bits: perms.bits(ok), acao: existente ? 'reutilizar' : 'criar', existenteId: existente ? existente.id : null, existenteAcimaDoBot: existente ? existente.position >= me.roles.highest.position : false };
  });

  // ── plano: categorias e canais ──
  const canaisCache = [...guild.channels.cache.values()].filter(c => !(c.isThread && c.isThread()));
  const substs = new Set();
  const categorias = template.categorias.map(cat => {
    const existente = opcoes.duplicar ? null : canaisCache.find(c => c.type === ChannelType.GuildCategory && nomeIgual(c.name, cat.nome));
    const catOv = expandir(cat.preset, cat.overwrites);
    const canais = cat.canais.map(ch => {
      const t = tipoCanal(guild, ch.tipo);
      if (t.subst) substs.add(t.subst);
      const nome = nomeCanal(ch.nome, t.usado);
      let ex = null;
      if (!opcoes.duplicar && existente) {
        const familia = (x) => (x === ChannelType.GuildVoice || x === ChannelType.GuildStageVoice) ? 'v' : 't';
        ex = canaisCache.find(c => c.parentId === existente.id && familia(c.type) === familia(t.discord) && nomeIgual(c.name, nome));
      }
      return { ref: ch, nome, tipoDiscord: t.discord, tipoUsado: t.usado, subst: t.subst, topico: ch.topico || '', slowmode: ch.slowmode || 0, limite: ch.limite || 0, overwrites: expandir(ch.preset, ch.overwrites), acao: ex ? 'pular' : 'criar', existenteId: ex ? ex.id : null };
    });
    return { ref: cat, nome: cat.nome, overwrites: catOv, acao: existente ? 'reutilizar' : 'criar', existenteId: existente ? existente.id : null, canais };
  });

  const cargosCriar = cargos.filter(c => c.acao === 'criar').length;
  const categoriasCriar = categorias.filter(c => c.acao === 'criar').length;
  const canaisCriar = categorias.reduce((a, c) => a + c.canais.filter(x => x.acao === 'criar').length, 0);
  const canaisPular = categorias.reduce((a, c) => a + c.canais.filter(x => x.acao === 'pular').length, 0);

  // ── permissões do bot ──
  if (cargosCriar > 0) {
    if (me.permissions.has(PermissionFlagsBits.ManageRoles)) checks.push('Permissão Gerenciar Cargos');
    else erros.push(`O bot não tem a permissão **${ROTULO.ManageRoles}**. Conceda-a ao cargo do bot em Configurações do servidor → Cargos.`);
  }
  if (categoriasCriar + canaisCriar > 0) {
    if (me.permissions.has(PermissionFlagsBits.ManageChannels)) checks.push('Permissão Gerenciar Canais');
    else erros.push(`O bot não tem a permissão **${ROTULO.ManageChannels}**. Conceda-a ao cargo do bot em Configurações do servidor → Cargos.`);
  }

  // ── hierarquia ──
  if (me.roles.highest.id === guild.id) {
    erros.push('O bot não possui nenhum cargo próprio, então não consegue gerenciar os cargos criados. Verifique o cargo do bot.');
  } else {
    checks.push('Hierarquia de cargos do bot');
  }
  const acima = cargos.filter(c => c.existenteAcimaDoBot).map(c => c.nome);
  if (acima.length) avisos.push(`Estes cargos já existem e estão acima do cargo do bot; as permissões deles em canais podem falhar: ${acima.slice(0, 4).join(', ')}${acima.length > 4 ? '…' : ''}.`);

  // ── limites da API ──
  const cargosAtuais = cargosCache.length;
  const canaisAtuais = canaisCache.length;
  if (cargosAtuais + cargosCriar > MAX_CARGOS_GUILD) erros.push(`Limite de cargos do Discord: o servidor tem ${cargosAtuais} e o template criaria mais ${cargosCriar} (máximo ${MAX_CARGOS_GUILD}).`);
  if (canaisAtuais + categoriasCriar + canaisCriar > MAX_CANAIS_GUILD) erros.push(`Limite de canais do Discord: o servidor tem ${canaisAtuais} e o template criaria mais ${categoriasCriar + canaisCriar} (máximo ${MAX_CANAIS_GUILD}).`);
  if (!erros.some(e => e.includes('Limite'))) checks.push('Limites do Discord respeitados');

  // ── avisos ──
  if (omitidas.size) avisos.push(`O bot não possui estas permissões, então elas **não serão concedidas** aos cargos: ${[...omitidas].join(', ')}.`);
  if (substs.size) avisos.push(`Este servidor não tem o modo Comunidade ativo. Substituições: ${[...substs].join(', ')}.`);
  const reus = cargos.filter(c => c.acao === 'reutilizar').length + categorias.filter(c => c.acao === 'reutilizar').length;
  if (reus + canaisPular > 0) avisos.push(`Já existem no servidor: ${cargos.filter(c => c.acao === 'reutilizar').length} cargo(s), ${categorias.filter(c => c.acao === 'reutilizar').length} categoria(s) e ${canaisPular} canal(is) do template. Eles serão **reaproveitados/pulados** — nada existente é alterado nem apagado.`);
  const admins = schema.temAdmin(template);
  if (admins.length) {
    avisos.push(opcoes.permitirAdmin
      ? `Cargo(s) com **Administrator** serão criados: ${admins.join(', ')}.`
      : `Cargo(s) que o template define com Administrator (${admins.join(', ')}) serão criados **sem** Administrator, com permissões de gestão. Você pode habilitar isso na confirmação.`);
  }

  const plano = {
    cargos, categorias, botAdmin,
    totais: { cargosCriar, cargosReusar: cargos.length - cargosCriar, categoriasCriar, categoriasReusar: categorias.length - categoriasCriar, canaisCriar, canaisPular },
  };
  return { ok: erros.length === 0, erros, avisos, checks, plano };
}

module.exports = { verificar, tipoCanal, nomeCanal, comunidadeAtiva, expandir };
