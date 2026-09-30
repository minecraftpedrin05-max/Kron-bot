// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/dsl.js — KAEL SERVER TEMPLATES
//
//  DSL compacta para escrever templates oficiais. Um arquivo em library/ exporta
//  uma LISTA de definições; cada uma vira um template canônico (schema.js).
//
//    {
//      slug: 'loja-digital', nome: 'Loja Digital', cat: 'lojas', estilo: 'minimalista',
//      tags: ['vendas', 'pix'], desc: 'Descrição curta', data: '2026-09-10',
//      dest: true,            // destaque
//      prem: false,           // premium
//      cargos: [
//        ['👑 Dono', '#F1C40F', 'owner'],                       // [nome, cor, tipo, opções?]
//        ['🛒 Vendedor', '#2ECC71', 'seller', { key: 'vend', mention: true }],
//      ],
//      cats: [
//        ['📌 INFORMAÇÕES', 'leitura', [                        // [nome, preset, canais, opções?]
//          '📜・regras|Leia antes de comprar',                    // canal de texto
//          'a:📢・avisos',                                         // a: anúncios · v: voz · s: palco · f: fórum
//          '💬・chat|Converse à vontade|lento5',                  // |lentoN = modo lento · |limN = limite de voz
//          'v:🔊 Sala Geral|lim10|voz',                           // token que é nome de preset define a permissão
//        ]],
//      ],
//    }
//
//  Tipos de cargo e presets: veja perms.js. Nada aqui precisa ser alterado para
//  adicionar novos templates — basta criar/editar arquivos em library/.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const perms = require('./perms');
const schema = require('./schema');

const TIPO_PREFIXO = { v: 'voz', a: 'anuncios', s: 'palco', f: 'forum' };

function corInt(c) {
  if (Number.isInteger(c)) return c;
  const n = parseInt(String(c || '0').replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0;
}

function canal(spec) {
  if (spec && typeof spec === 'object') {
    return {
      nome: spec.nome, tipo: spec.tipo || 'texto', topico: spec.topico || '', preset: spec.preset || null,
      overwrites: spec.overwrites || [], nsfw: false, slowmode: spec.slowmode || 0, limite: spec.limite || 0,
    };
  }
  let s = String(spec);
  let tipo = 'texto';
  const m = s.match(/^([vasf]):/);
  if (m) { tipo = TIPO_PREFIXO[m[1]]; s = s.slice(2); }
  const partes = s.split('|');
  const nome = partes.shift().trim();
  const out = { nome, tipo, topico: '', preset: null, overwrites: [], nsfw: false, slowmode: 0, limite: 0 };
  for (const p of partes) {
    const t = p.trim();
    if (!t) continue;
    if (perms.presetValido(t)) out.preset = t;
    else if (/^lento\d+$/.test(t)) out.slowmode = Math.min(21600, parseInt(t.slice(5), 10));
    else if (/^lim\d+$/.test(t)) out.limite = Math.min(99, parseInt(t.slice(3), 10));
    else out.topico = t;
  }
  return out;
}

function categoria(tupla) {
  const [nome, preset, canais, opts] = tupla;
  return {
    nome, preset: preset || null, overwrites: (opts && opts.ov) || [],
    canais: (canais || []).map(canal),
  };
}

function cargos(lista) {
  const usados = new Set();
  return lista.map(([nome, cor, tipo, opts], i) => {
    const o = opts || {};
    let key = o.key || tipo;
    let n = 2;
    while (usados.has(key)) key = (o.key || tipo) + n++;
    usados.add(key);
    return {
      key, nome, cor: corInt(cor), tipo,
      hoist: o.hoist !== undefined ? !!o.hoist : perms.HOIST_PADRAO.includes(tipo),
      mentionable: !!o.mention,
      extra: o.extra || [],
      permissoes: o.perms || undefined,
    };
  });
}

/** Converte uma definição do DSL em template canônico. Lança erro se o resultado for inválido. */
function tpl(def) {
  const data = def.data || '2026-09-01';
  const t = {
    id: `kron:${def.slug}`,
    slug: def.slug,
    nome: def.nome,
    descricao: def.desc || '',
    secao: def.cat,
    estilo: def.estilo || 'clean',
    tags: def.tags || [],
    autor: def.autor || 'Kael Apps',
    origem: { tipo: 'kron', licenca: 'Kael Apps — template oficial', url: null },
    versao: def.ver || '1.0.0',
    criadoEm: data,
    atualizadoEm: def.atualizado || data,
    status: 'publicado',
    oficial: true,
    premium: !!def.prem,
    destaque: !!def.dest,
    cargos: cargos(def.cargos || []),
    categorias: (def.cats || []).map(categoria),
  };
  const v = schema.validar(t);
  if (!v.ok) throw new Error(`Template "${def.slug}" inválido: ${v.erros.slice(0, 4).join(' | ')}`);
  return t;
}

module.exports = { tpl, canal, categoria, cargos };
