// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/registry.js — KAEL SERVER TEMPLATES
//
//  Biblioteca em memória. Descobre sozinha:
//    • templates oficiais  → todo .js dentro de template-system/library/ (recursivo);
//    • templates da comunidade já APROVADOS → store.js.
//  Cada arquivo exporta uma lista de definições (DSL) ou de templates canônicos.
//  Um template inválido é ignorado e registrado em erros() — nunca derruba o resto.
//  Adicionar template = criar/editar um arquivo em library/. Nada no núcleo muda.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema');
const dsl = require('./dsl');
const store = require('./store');

const LIB_DIR = path.join(__dirname, '..', 'library');
const DIA = 24 * 60 * 60 * 1000;
const JANELA_NOVOS_DIAS = 45;

let cache = null;
let errosCarga = [];

function arquivos(dir) {
  let out = [];
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) out = out.concat(arquivos(p));
    else if (it.isFile() && it.name.endsWith('.js') && !it.name.startsWith('_')) out.push(p);
  }
  return out.sort();
}

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function carregar() {
  if (cache) return cache;
  const mapa = new Map();
  errosCarga = [];

  for (const arq of arquivos(LIB_DIR)) {
    let defs;
    try {
      delete require.cache[require.resolve(arq)];
      const mod = require(arq);
      defs = Array.isArray(mod) ? mod : [mod];
    } catch (e) { errosCarga.push(`${path.basename(arq)}: ${e.message}`); continue; }
    for (const def of defs) {
      try {
        const t = def && def.secao ? def : dsl.tpl(def);
        if (def.secao) { const v = schema.validar(t); if (!v.ok) throw new Error(v.erros[0]); }
        if (mapa.has(t.slug)) throw new Error(`slug duplicado "${t.slug}"`);
        mapa.set(t.slug, t);
      } catch (e) { errosCarga.push(`${path.basename(arq)}: ${e.message}`); }
    }
  }

  try {
    for (const t of store.comunidade()) {
      if (mapa.has(t.slug)) continue;
      const v = schema.validar(t);
      if (v.ok) mapa.set(t.slug, t); else errosCarga.push(`comunidade/${t.slug}: ${v.erros[0]}`);
    }
  } catch (e) { errosCarga.push(`comunidade: ${e.message}`); }

  const lista = [...mapa.values()].map(t => ({ ...t, _c: schema.contar(t), _busca: norm([t.nome, t.slug, t.descricao, (t.tags || []).join(' '), t.estilo, (schema.SECOES[t.secao] || {}).nome].join(' ')) }));
  cache = { mapa: new Map(lista.map(t => [t.slug, t])), lista };
  return cache;
}

function recarregar() { cache = null; return carregar(); }
function erros() { carregar(); return errosCarga; }
function obter(slug) { return carregar().mapa.get(slug) || null; }
function todos() { return carregar().lista; }

function ehNovo(t, limite) {
  return Date.now() - Date.parse(t.criadoEm) <= (limite || JANELA_NOVOS_DIAS) * DIA;
}

function pontuar(t, termos) {
  let total = 0;
  const nome = norm(t.nome), slug = norm(t.slug), tags = norm((t.tags || []).join(' ')), estilo = norm(t.estilo), secao = norm((schema.SECOES[t.secao] || {}).nome), desc = norm(t.descricao);
  for (const termo of termos) {
    let s = 0;
    if (nome.includes(termo)) s += 5;
    if (slug.includes(termo)) s += 4;
    if (tags.includes(termo)) s += 3;
    if (estilo.includes(termo)) s += 2;
    if (secao.includes(termo)) s += 2;
    if (desc.includes(termo)) s += 1;
    if (s === 0) return 0; // todos os termos precisam casar
    total += s;
  }
  return total;
}

/**
 * @param {object} f  { secao, q, estilo, origem: 'todos'|'oficial'|'comunidade'|'premium', ordem,
 *                      minCanais, minCargos, especial: 'destaque'|'novos'|'favoritos', favoritos: [] }
 */
function listar(f) {
  f = f || {};
  const uso = store.usoTodos();
  let lista = todos();

  if (f.especial === 'destaque') {
    const marcados = lista.filter(t => t.destaque);
    const populares = lista.filter(t => !t.destaque && (uso[t.slug] || 0) > 0).sort((a, b) => (uso[b.slug] || 0) - (uso[a.slug] || 0));
    lista = [...marcados, ...populares].slice(0, 24);
  } else if (f.especial === 'novos') {
    const ordenados = [...lista].sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm));
    const recentes = ordenados.filter(t => ehNovo(t));
    lista = recentes.length >= 6 ? recentes : ordenados.slice(0, 10);
  } else if (f.especial === 'favoritos') {
    const fav = new Set(f.favoritos || []);
    lista = lista.filter(t => fav.has(t.slug));
  }

  if (f.secao) lista = lista.filter(t => t.secao === f.secao);
  if (f.estilo) lista = lista.filter(t => norm(t.estilo) === norm(f.estilo));
  if (f.origem === 'oficial') lista = lista.filter(t => t.oficial);
  else if (f.origem === 'comunidade') lista = lista.filter(t => !t.oficial);
  else if (f.origem === 'premium') lista = lista.filter(t => t.premium);
  if (f.minCanais) lista = lista.filter(t => t._c.canais >= f.minCanais);
  if (f.minCargos) lista = lista.filter(t => t._c.cargos >= f.minCargos);

  let pontos = null;
  if (f.q && norm(f.q).trim()) {
    const termos = norm(f.q).split(/\s+/).filter(Boolean);
    pontos = new Map();
    lista = lista.filter(t => { const p = pontuar(t, termos); if (p > 0) pontos.set(t.slug, p); return p > 0; });
  }

  const ordem = f.ordem || (pontos ? 'relevancia' : (f.especial ? 'padrao' : 'recentes'));
  const cmp = {
    relevancia: (a, b) => (pontos.get(b.slug) || 0) - (pontos.get(a.slug) || 0) || a.nome.localeCompare(b.nome),
    recentes: (a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm) || a.nome.localeCompare(b.nome),
    usados: (a, b) => (uso[b.slug] || 0) - (uso[a.slug] || 0) || a.nome.localeCompare(b.nome),
    az: (a, b) => a.nome.localeCompare(b.nome),
    canais: (a, b) => b._c.canais - a._c.canais || a.nome.localeCompare(b.nome),
    cargos: (a, b) => b._c.cargos - a._c.cargos || a.nome.localeCompare(b.nome),
  }[ordem];
  if (cmp) lista = [...lista].sort(cmp);
  return lista;
}

function estilos() {
  return [...new Set(todos().map(t => t.estilo))].sort((a, b) => a.localeCompare(b)).slice(0, 25);
}

function contagemPorSecao() {
  const out = {};
  for (const t of todos()) out[t.secao] = (out[t.secao] || 0) + 1;
  return out;
}

module.exports = { carregar, recarregar, erros, obter, todos, listar, estilos, contagemPorSecao, ehNovo, norm };
