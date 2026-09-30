'use strict';

const LEGADO = require('../config/emojis-legado.json');

const LIMITE_BYTES = 256 * 1024;
let MAPA = new Map();

function limparLogs() {
  if (console.__kaelLimpo) return;
  const rx = /<a?:\w+:\d{17,20}>\s?/g;
  for (const metodo of ['log', 'info', 'warn', 'error']) {
    const original = console[metodo].bind(console);
    console[metodo] = (...args) =>
      original(...args.map(a => (typeof a === 'string' ? a.replace(rx, '') : a)));
  }
  console.__kaelLimpo = true;
}

function objetoSimples(v) {
  if (Array.isArray(v)) return true;
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function aplicarMapa(texto) {
  let saida = texto;
  for (const [velho, novo] of MAPA) {
    if (velho !== novo && saida.includes(velho)) saida = saida.split(velho).join(novo);
  }
  return saida;
}

function instalarRemap(client) {
  limparLogs();
  const rest = client && client.rest;
  if (!rest || typeof rest.request !== 'function' || rest.__kaelEmojiRemap) return;
  const original = rest.request.bind(rest);
  rest.request = function (options) {
    try {
      if (MAPA.size && options && objetoSimples(options.body)) {
        const json = JSON.stringify(options.body);
        const novo = aplicarMapa(json);
        if (novo !== json) options = { ...options, body: JSON.parse(novo) };
      }
    } catch (_) {}
    return original(options);
  };
  rest.__kaelEmojiRemap = true;
}

async function baixarImagem(item) {
  const ext = item.animated ? 'gif' : 'png';
  for (const tamanho of [128, 64]) {
    const url = `https://cdn.discordapp.com/emojis/${item.id}.${ext}?size=${tamanho}&quality=lossless`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= LIMITE_BYTES) return buf;
  }
  throw new Error('imagem maior que 256 KB');
}

async function sincronizar(client) {
  instalarRemap(client);
  try {
    const existentes = await client.application.emojis.fetch();
    const porNome = new Map();
    for (const e of existentes.values()) porNome.set(e.name, e);

    const novoMapa = new Map();
    const usados = new Set();
    let criados = 0, prontos = 0, falhas = 0;

    for (const item of LEGADO) {
      if (existentes.has(item.id)) { novoMapa.set(item.id, item.id); prontos++; continue; }

      let nome = item.name;
      let n = 2;
      while (usados.has(nome)) nome = `${item.name}_${n++}`.slice(0, 32);
      usados.add(nome);

      let emoji = porNome.get(nome);
      if (emoji) { prontos++; }
      else {
        try {
          const imagem = await baixarImagem(item);
          emoji = await client.application.emojis.create({ attachment: imagem, name: nome });
          porNome.set(nome, emoji);
          criados++;
          await new Promise(r => setTimeout(r, 400));
        } catch (err) {
          falhas++;
          console.error(`[Emojis] não consegui criar "${nome}":`, err && err.message ? err.message : err);
          continue;
        }
      }
      novoMapa.set(item.id, emoji.id);
    }

    MAPA = novoMapa;
    console.log(`[Emojis] prontos: ${prontos} | criados agora: ${criados} | falhas: ${falhas}`);
  } catch (err) {
    console.error('[Emojis] sincronização falhou:', err && err.message ? err.message : err);
  }
}

function _definirMapaParaTeste(mapa) { MAPA = new Map(Object.entries(mapa)); }

module.exports = { instalarRemap, sincronizar, limparLogs, _definirMapaParaTeste };
