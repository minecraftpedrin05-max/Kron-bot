// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/schema.js — KAEL SERVER TEMPLATES
//
//  Formato CANÔNICO de um template + contagem, validação e sanitização.
//  Tudo que entra na biblioteca (templates oficiais escritos com o DSL e
//  templates da comunidade em JSON) passa por aqui antes de existir.
//
//  {
//    id, slug, nome, descricao, secao, estilo, tags[], autor,
//    origem: { tipo: 'kron' | 'comunidade' | 'externa', licenca?, url? },
//    versao, criadoEm, atualizadoEm, status: 'publicado',
//    oficial, premium, destaque,
//    cargos:     [{ key, nome, cor, tipo, hoist, mentionable, extra[], permissoes? }],
//    categorias: [{ nome, preset, overwrites[], canais: [{ nome, tipo, topico, preset,
//                   overwrites[], nsfw, slowmode, limite }] }],
//  }
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const perms = require('./perms');

const SECOES = {
  lojas:        { nome: 'Lojas e Vendas' },
  gaming:       { nome: 'Gaming' },
  comunidades:  { nome: 'Comunidades' },
  profissional: { nome: 'Profissional' },
  suporte:      { nome: 'Suporte' },
  seguranca:    { nome: 'Segurança e Staff' },
  creator:      { nome: 'Creator' },
  educacao:     { nome: 'Educação' },
  outros:       { nome: 'Outros' },
};

const TIPOS_CANAL = ['texto', 'voz', 'anuncios', 'palco', 'forum'];

const LIMITES = {
  cargos: 60, categorias: 40, canais: 250, canaisPorCategoria: 50,
  nome: 100, topico: 1024, descricao: 300, tags: 8, jsonBytes: 200 * 1024,
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;

function limpo(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/[@`]/g, '')
    .trim()
    .slice(0, max);
}

function contar(t) {
  let texto = 0, voz = 0, outros = 0;
  for (const c of t.categorias) {
    for (const ch of c.canais) {
      if (ch.tipo === 'voz' || ch.tipo === 'palco') voz++;
      else if (ch.tipo === 'texto') texto++;
      else outros++;
    }
  }
  return { cargos: t.cargos.length, categorias: t.categorias.length, canais: texto + voz + outros, texto, voz, outros };
}

/** Permissões efetivas de um cargo. Sem `permitirAdmin`, Administrator é trocado por ADMIN_LITE. */
function permsDoCargo(cargo, permitirAdmin) {
  let lista = Array.isArray(cargo.permissoes) ? [...cargo.permissoes] : [...(perms.PERMS_TIPO[cargo.tipo] || [])];
  for (const e of cargo.extra || []) if (!lista.includes(e)) lista.push(e);
  if (lista.includes('Administrator') && !permitirAdmin) {
    lista = lista.filter(p => p !== 'Administrator');
    for (const p of perms.ADMIN_LITE) if (!lista.includes(p)) lista.push(p);
  }
  return lista.filter(perms.nomeValido);
}

function temAdmin(t) {
  return t.cargos.filter(c => permsDoCargo({ ...c }, true).includes('Administrator')).map(c => c.nome);
}

// ── validação ────────────────────────────────────────────────────────────
function validarOverwrites(lista, ctx, onde, erros) {
  for (const o of lista || []) {
    const alvoOk = o && typeof o.alvo === 'string' && (
      o.alvo === '@everyone' ||
      (o.alvo.startsWith('#') && perms.GRUPOS[o.alvo.slice(1)]) ||
      ctx.keys.has(o.alvo) || perms.TIPOS_CARGO.includes(o.alvo));
    if (!alvoOk) { erros.push(`${onde}: alvo de permissão inválido "${o && o.alvo}"`); continue; }
    for (const p of [...(o.allow || []), ...(o.deny || [])]) {
      if (!perms.nomeValido(p)) erros.push(`${onde}: permissão inexistente "${p}"`);
    }
  }
}

function validar(t) {
  const erros = [];
  const avisos = [];
  if (!t || typeof t !== 'object') return { ok: false, erros: ['Template inválido'], avisos };
  if (!SLUG_RE.test(t.slug || '')) erros.push('slug inválido (use letras minúsculas, números e hífen)');
  if (!t.nome || t.nome.length > LIMITES.nome) erros.push('nome ausente ou longo demais');
  if (!SECOES[t.secao]) erros.push(`seção desconhecida "${t.secao}"`);
  if (!Array.isArray(t.cargos) || !Array.isArray(t.categorias)) return { ok: false, erros: [...erros, 'cargos/categorias ausentes'], avisos };
  if (t.cargos.length > LIMITES.cargos) erros.push(`cargos acima do limite (${LIMITES.cargos})`);
  if (t.categorias.length > LIMITES.categorias) erros.push(`categorias acima do limite (${LIMITES.categorias})`);

  const keys = new Set();
  const tipos = new Set();
  for (const c of t.cargos) {
    if (!c.nome || c.nome.length > LIMITES.nome) erros.push(`cargo com nome inválido (${c.nome})`);
    if (!c.key || keys.has(c.key)) erros.push(`chave de cargo repetida/ausente (${c.key})`);
    keys.add(c.key);
    tipos.add(c.tipo);
    if (!perms.TIPOS_CARGO.includes(c.tipo)) erros.push(`cargo "${c.nome}": tipo desconhecido "${c.tipo}"`);
    if (!Number.isInteger(c.cor) || c.cor < 0 || c.cor > 0xFFFFFF) erros.push(`cargo "${c.nome}": cor inválida`);
    for (const p of [...(c.extra || []), ...(c.permissoes || [])]) if (!perms.nomeValido(p)) erros.push(`cargo "${c.nome}": permissão inexistente "${p}"`);
  }
  const ctx = { keys };
  const exige = (preset, onde) => {
    if (preset == null) return;
    if (!perms.presetValido(preset)) { erros.push(`${onde}: preset desconhecido "${preset}"`); return; }
    for (const tipo of perms.tiposExigidos(preset)) {
      const grupo = perms.GRUPOS[tipo] || [tipo];
      if (!grupo.some(g => tipos.has(g))) erros.push(`${onde}: o preset "${preset}" exige ao menos um cargo do grupo "${tipo}"`);
    }
  };
  let totalCanais = 0;
  const nomesCat = new Set();
  for (const cat of t.categorias) {
    const onde = `categoria "${cat.nome}"`;
    if (!cat.nome || cat.nome.length > LIMITES.nome) erros.push(`${onde}: nome inválido`);
    if (nomesCat.has(cat.nome)) avisos.push(`${onde}: nome repetido`);
    nomesCat.add(cat.nome);
    exige(cat.preset, onde);
    validarOverwrites(cat.overwrites, ctx, onde, erros);
    if (!Array.isArray(cat.canais) || !cat.canais.length) erros.push(`${onde}: sem canais`);
    else if (cat.canais.length > LIMITES.canaisPorCategoria) erros.push(`${onde}: mais de ${LIMITES.canaisPorCategoria} canais`);
    for (const ch of cat.canais || []) {
      totalCanais++;
      const o2 = `${onde} › canal "${ch.nome}"`;
      if (!ch.nome || ch.nome.length > LIMITES.nome) erros.push(`${o2}: nome inválido`);
      if (!TIPOS_CANAL.includes(ch.tipo)) erros.push(`${o2}: tipo inválido "${ch.tipo}"`);
      if (ch.topico && ch.topico.length > LIMITES.topico) erros.push(`${o2}: tópico longo demais`);
      exige(ch.preset, o2);
      validarOverwrites(ch.overwrites, ctx, o2, erros);
    }
  }
  if (totalCanais === 0) erros.push('o template precisa ter ao menos um canal');
  if (totalCanais > LIMITES.canais) erros.push(`canais acima do limite (${LIMITES.canais})`);
  if (totalCanais + t.categorias.length > 500) erros.push('o template excede o limite de 500 canais do Discord');
  if (t.cargos.length > 250) erros.push('o template excede o limite de 250 cargos do Discord');
  const admins = temAdmin(t);
  if (admins.length) avisos.push(`Cargos com Administrator: ${admins.join(', ')}`);
  return { ok: erros.length === 0, erros, avisos };
}

/** Pontos de atenção para quem revisa templates da comunidade. */
function lint(t) {
  const out = [];
  for (const c of t.cargos) {
    const p = permsDoCargo({ ...c }, true).filter(x => perms.PERMS_SENSIVEIS.includes(x));
    if (p.length) out.push(`Cargo "${c.nome}" com permissões sensíveis: ${p.join(', ')}`);
  }
  for (const cat of t.categorias) {
    for (const o of [...(cat.overwrites || []), ...cat.canais.flatMap(ch => ch.overwrites || [])]) {
      if (o.alvo === '@everyone' && (o.allow || []).some(p => perms.PERMS_SENSIVEIS.includes(p))) out.push(`@everyone recebe permissão sensível em "${cat.nome}"`);
    }
  }
  return out;
}

// ── sanitização de JSON vindo de usuários (comunidade) ───────────────────
function sanOverwrites(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 12).map(o => ({
    alvo: limpo(o && o.alvo, 40),
    allow: Array.isArray(o && o.allow) ? o.allow.filter(p => typeof p === 'string').slice(0, 40) : [],
    deny: Array.isArray(o && o.deny) ? o.deny.filter(p => typeof p === 'string').slice(0, 40) : [],
  }));
}

/**
 * Converte um JSON enviado por usuário em template canônico (campos fora da lista são descartados).
 * Não confia em nada: tipos, tamanhos e listas são forçados. O resultado ainda passa por validar().
 */
function sanitizarEnvio(json) {
  const j = json && typeof json === 'object' ? json : {};
  const origemTipo = ['comunidade', 'externa'].includes(j.origem && j.origem.tipo) ? j.origem.tipo : 'comunidade';
  const t = {
    slug: limpo(j.slug, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''),
    nome: limpo(j.nome, LIMITES.nome),
    descricao: limpo(j.descricao, LIMITES.descricao),
    secao: SECOES[j.secao] ? j.secao : 'outros',
    estilo: limpo(j.estilo || 'comunidade', 20).toLowerCase(),
    tags: (Array.isArray(j.tags) ? j.tags : []).slice(0, LIMITES.tags).map(x => limpo(x, 24).toLowerCase()).filter(Boolean),
    autor: limpo(j.autor, 60) || 'Comunidade',
    origem: {
      tipo: origemTipo,
      licenca: limpo(j.origem && j.origem.licenca, 80) || null,
      url: limpo(j.origem && j.origem.url, 200) || null,
    },
    declaracao: j.declaracao === true || j.origem?.autorizado === true,
    versao: limpo(j.versao || '1.0.0', 16),
    cargos: (Array.isArray(j.cargos) ? j.cargos : []).slice(0, LIMITES.cargos + 1).map((c, i) => ({
      key: limpo(c && c.key, 30).toLowerCase().replace(/[^a-z0-9_-]+/g, '') || `cargo${i + 1}`,
      nome: limpo(c && c.nome, LIMITES.nome),
      cor: Number.isInteger(c && c.cor) ? c.cor : parseInt(String((c && c.cor) || '0').replace('#', ''), 16) || 0,
      tipo: perms.TIPOS_CARGO.includes(c && c.tipo) ? c.tipo : 'cosmetic',
      hoist: !!(c && c.hoist),
      mentionable: !!(c && c.mentionable),
      extra: Array.isArray(c && c.extra) ? c.extra.filter(p => typeof p === 'string').slice(0, 40) : [],
      permissoes: Array.isArray(c && c.permissoes) ? c.permissoes.filter(p => typeof p === 'string').slice(0, 40) : undefined,
    })),
    categorias: (Array.isArray(j.categorias) ? j.categorias : []).slice(0, LIMITES.categorias + 1).map(cat => ({
      nome: limpo(cat && cat.nome, LIMITES.nome),
      preset: perms.presetValido(cat && cat.preset) ? cat.preset : null,
      overwrites: sanOverwrites(cat && cat.overwrites),
      canais: (Array.isArray(cat && cat.canais) ? cat.canais : []).slice(0, LIMITES.canaisPorCategoria + 1).map(ch => ({
        nome: limpo(ch && ch.nome, LIMITES.nome),
        tipo: TIPOS_CANAL.includes(ch && ch.tipo) ? ch.tipo : 'texto',
        topico: limpo(ch && ch.topico, LIMITES.topico),
        preset: perms.presetValido(ch && ch.preset) ? ch.preset : null,
        overwrites: sanOverwrites(ch && ch.overwrites),
        nsfw: false,
        slowmode: Math.min(21600, Math.max(0, parseInt(ch && ch.slowmode, 10) || 0)),
        limite: Math.min(99, Math.max(0, parseInt(ch && ch.limite, 10) || 0)),
      })),
    })),
  };
  // cargos com chave repetida ganham sufixo (evita erro bobo em JSON manual)
  const vistos = new Set();
  for (const c of t.cargos) { let k = c.key, n = 2; while (vistos.has(k)) k = c.key + n++; c.key = k; vistos.add(k); }
  return t;
}

module.exports = { SECOES, TIPOS_CANAL, LIMITES, SLUG_RE, limpo, contar, permsDoCargo, temAdmin, validar, lint, sanitizarEnvio };
