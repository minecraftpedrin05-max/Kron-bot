// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/submit.js — KAEL SERVER TEMPLATES
//
//  Templates da comunidade:
//    • baixarEValidar(): lê o JSON enviado pelo usuário (anexo do Discord), higieniza
//      TUDO e valida. Nada é publicado aqui — o envio só entra na FILA de análise.
//    • exportarServidor(): gera o JSON da estrutura do PRÓPRIO servidor (só nomes,
//      cores, permissões e canais — sem membros, mensagens, convites ou IDs).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const schema = require('./schema');
const perms = require('./perms');

const TIMEOUT_MS = 10000;

/** Valida um objeto JSON de template enviado por usuário. Não grava nada. */
function prepararEnvio(json) {
  const t = schema.sanitizarEnvio(json);
  const erros = [];
  if (!t.declaracao) erros.push('Falta a declaração `"declaracao": true` — você precisa confirmar que tem o direito de compartilhar este template.');
  if (t.origem.tipo === 'externa' && (!t.origem.licenca || !t.origem.url)) erros.push('Templates de outras fontes precisam informar `origem.licenca` e `origem.url` (só aceitamos fontes públicas e autorizadas).');
  if (!t.slug && t.nome) t.slug = t.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const v = schema.validar({ ...t, slug: t.slug });
  if (!v.ok) erros.push(...v.erros.slice(0, 6));
  if (erros.length) return { ok: false, erros, avisos: [] };
  return { ok: true, template: t, avisos: [...v.avisos, ...schema.lint(t)].slice(0, 10) };
}

async function baixarEValidar(anexo) {
  if (!anexo) return { ok: false, erros: ['Nenhum arquivo enviado.'] };
  if (!/\.json$/i.test(anexo.name || '')) return { ok: false, erros: ['Envie um arquivo `.json`.'] };
  if (anexo.size > schema.LIMITES.jsonBytes) return { ok: false, erros: [`O arquivo é grande demais (máx. ${Math.floor(schema.LIMITES.jsonBytes / 1024)} KB).`] };
  let texto;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(anexo.url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, erros: ['Não consegui baixar o arquivo enviado.'] };
    texto = await res.text();
  } catch { return { ok: false, erros: ['Não consegui baixar o arquivo enviado.'] }; }
  if (texto.length > schema.LIMITES.jsonBytes) return { ok: false, erros: ['O arquivo é grande demais.'] };
  let json;
  try { json = JSON.parse(texto); } catch { return { ok: false, erros: ['O arquivo não é um JSON válido.'] }; }
  return prepararEnvio(json);
}

function nomesDePermissoes(bitfield) {
  return perms.NOMES_VALIDOS.filter(n => (bitfield & PermissionFlagsBits[n]) !== 0n);
}

const TIPO_EXPORT = {
  [ChannelType.GuildText]: 'texto', [ChannelType.GuildVoice]: 'voz', [ChannelType.GuildAnnouncement]: 'anuncios',
  [ChannelType.GuildStageVoice]: 'palco', [ChannelType.GuildForum]: 'forum',
};

/** Estrutura do servidor no formato de envio. `declaracao` sai `false` de propósito: o dono precisa confirmar. */
function exportarServidor(guild) {
  const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position).slice(0, schema.LIMITES.cargos);
  const chaves = new Map();
  const cargos = roles.map((r, i) => {
    const key = `cargo${i + 1}`;
    chaves.set(r.id, key);
    return { key, nome: r.name, cor: r.color, tipo: 'cosmetic', hoist: r.hoist, mentionable: r.mentionable, permissoes: nomesDePermissoes(r.permissions.bitfield) };
  });

  const ov = (canal) => {
    if (!canal.permissionOverwrites || !canal.permissionOverwrites.cache) return [];
    const out = [];
    for (const o of canal.permissionOverwrites.cache.values()) {
      if (o.type !== 0) continue;
      const alvo = o.id === guild.id ? '@everyone' : chaves.get(o.id);
      if (!alvo) continue;
      const allow = nomesDePermissoes(o.allow.bitfield), deny = nomesDePermissoes(o.deny.bitfield);
      if (allow.length || deny.length) out.push({ alvo, allow, deny });
    }
    return out;
  };

  const todos = [...guild.channels.cache.values()].filter(c => !(c.isThread && c.isThread()));
  const cats = todos.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const canaisDe = (parentId) => todos.filter(c => c.parentId === parentId && TIPO_EXPORT[c.type]).sort((a, b) => a.position - b.position);
  const mapCanal = (c) => ({
    nome: c.name, tipo: TIPO_EXPORT[c.type], topico: ('topic' in c && c.topic) ? c.topic : '',
    slowmode: c.rateLimitPerUser || 0, limite: c.userLimit || 0, overwrites: ov(c),
  });
  const categorias = cats.map(c => ({ nome: c.name, overwrites: ov(c), canais: canaisDe(c.id).map(mapCanal) })).filter(c => c.canais.length);
  const soltos = canaisDe(null);
  if (soltos.length) categorias.unshift({ nome: 'GERAL', overwrites: [], canais: soltos.map(mapCanal) });

  const nome = guild.name.slice(0, 60);
  return {
    nome: `Template de ${nome}`,
    slug: nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meu-template',
    descricao: 'Descreva o objetivo do seu template.',
    secao: 'outros', estilo: 'comunidade', tags: [], autor: 'Seu nome',
    origem: { tipo: 'comunidade' },
    declaracao: false,
    versao: '1.0.0',
    cargos, categorias,
  };
}

module.exports = { prepararEnvio, baixarEValidar, exportarServidor };
