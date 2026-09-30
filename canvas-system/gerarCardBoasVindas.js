/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Card de Boas-Vindas / Saída
 *  Gera a imagem que acompanha a mensagem de entrada/saída: fundo
 *  (pronto, gerado aleatoriamente ou uma URL customizada) + avatar
 *  circular + nome do usuário na cor escolhida pelo servidor.
 *
 *  IMPORTANTE: a "cor do nome" muda só NESTA IMAGEM — nunca o
 *  apelido de verdade do usuário no servidor. É só visual, aparece
 *  apenas no momento da entrada/saída.
 * ─────────────────────────────────────────────────────────────────
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');

const W = 900;
const H = 300;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── FUNDOS PRONTOS ──────────────────────────────────────────────
// Cada um é uma função que desenha direto no canvas, recebendo a
// paleta de cores (2-3 hex). O mesmo desenho serve tanto pros fundos
// "prontos" (paleta fixa) quanto pro botão "Gerar Fundo" (paleta
// sorteada em cima do mesmo estilo).

function desenharGradiente(ctx, cores) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  cores.forEach((cor, i) => grad.addColorStop(i / (cores.length - 1 || 1), cor));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // brilho suave num canto, pra dar profundidade
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.2, 10, W * 0.8, H * 0.2, 420);
  glow.addColorStop(0, 'rgba(255,255,255,0.18)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function desenharBokeh(ctx, cores) {
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(hashCores(cores));
  for (let i = 0; i < 22; i++) {
    const cor = cores[i % cores.length];
    const x = rand() * W;
    const y = rand() * H;
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexParaRgba(cor, 0.35));
    g.addColorStop(1, hexParaRgba(cor, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function desenharOndas(ctx, cores) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, cores[0]);
  grad.addColorStop(1, '#050507');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const camadas = [
    { cor: hexParaRgba(cores[1] || cores[0], 0.55), amp: 26, freq: 0.012, baseY: H * 0.6, vel: 1 },
    { cor: hexParaRgba(cores[2] || cores[0], 0.45), amp: 34, freq: 0.017, baseY: H * 0.75, vel: -1.4 },
    { cor: hexParaRgba('#ffffff', 0.06), amp: 18, freq: 0.02, baseY: H * 0.9, vel: 2 },
  ];
  for (const c of camadas) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = c.baseY + Math.sin(x * c.freq * c.vel) * c.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = c.cor;
    ctx.fill();
  }
}

function desenharGeometrico(ctx, cores) {
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(hashCores(cores));
  for (let i = 0; i < 14; i++) {
    const cor = cores[i % cores.length];
    const cx = rand() * W;
    const cy = rand() * H;
    const tam = 40 + rand() * 140;
    const rot = rand() * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = hexParaRgba(cor, 0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(-tam / 2, -tam / 2, tam, tam);
    ctx.restore();
  }
}

function desenharGradeNeon(ctx, cores) {
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, W, H);
  const corLinha = cores[0];
  ctx.strokeStyle = hexParaRgba(corLinha, 0.35);
  ctx.lineWidth = 1;
  const horizonte = H * 0.62;
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 60, horizonte);
    ctx.lineTo(W / 2 + i * 260, H);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = horizonte + (H - horizonte) * (i / 6) * (i / 6);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const sky = ctx.createLinearGradient(0, 0, 0, horizonte);
  sky.addColorStop(0, hexParaRgba(cores[1] || corLinha, 0.5));
  sky.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizonte);
}

function desenharAurora(ctx, cores) {
  ctx.fillStyle = '#04040a';
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(hashCores(cores));
  for (let i = 0; i < cores.length + 2; i++) {
    const cor = cores[i % cores.length];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const x1 = rand() * W, y1 = rand() * H * 0.5;
    const x2 = x1 + (rand() - 0.5) * 500;
    const y2 = y1 + 150 + rand() * 150;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, hexParaRgba(cor, 0.5));
    grad.addColorStop(1, hexParaRgba(cor, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 60 + rand() * 60;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, y1 - 80, x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}

const PRESETS = {
  aurora:     { nome: 'Aurora',           desenhar: desenharAurora,     coresPadrao: ['#7F5AF0', '#2CB67D', '#FF6B6B'] },
  bokeh:      { nome: 'Bokeh',            desenhar: desenharBokeh,      coresPadrao: ['#00C2FF', '#7F5AF0', '#FF61D8'] },
  ondas:      { nome: 'Ondas',            desenhar: desenharOndas,      coresPadrao: ['#0F2027', '#2C5364', '#00C9A7'] },
  geometrico: { nome: 'Geométrico',       desenhar: desenharGeometrico, coresPadrao: ['#FFD700', '#FF4E50', '#00C2FF'] },
  neon:       { nome: 'Grade Neon',       desenhar: desenharGradeNeon,  coresPadrao: ['#FF00E5', '#00F0FF'] },
  gradiente:  { nome: 'Gradiente Suave',  desenhar: desenharGradiente,  coresPadrao: ['#1E3C72', '#2A5298', '#8E2DE2'] },
};

const IDS_PRESETS = Object.keys(PRESETS);

// ── Helpers ─────────────────────────────────────────────────────

function hexParaRgba(hex, alpha) {
  const h = (hex || '#ffffff').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function hashCores(cores) {
  const str = (cores || []).join('');
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
  return h || 1;
}

// PRNG determinístico (mesma seed => mesmo desenho sempre) — importante
// pra um fundo "gerado" ficar IGUAL toda vez que alguém entra, em vez
// de mudar a cada entrada.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETA_BASE = ['#7F5AF0', '#2CB67D', '#FF6B6B', '#00C2FF', '#FFD700', '#FF61D8', '#FF4E50', '#8E2DE2', '#00F0FF', '#FF00E5'];

// Sorteia um estilo + paleta novos. Usado pelo botão "Gerar Fundo".
// O resultado (estiloId + cores) é pra ser SALVO, não regerado a cada
// entrada — geramos de novo aqui só quando o admin pede outro.
function sortearFundo() {
  const estiloId = IDS_PRESETS[Math.floor(Math.random() * IDS_PRESETS.length)];
  const qtdCores = 2 + Math.floor(Math.random() * 2);
  const cores = [];
  const pool = [...PALETA_BASE];
  for (let i = 0; i < qtdCores; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    cores.push(pool.splice(idx, 1)[0]);
  }
  return { estiloId, cores };
}

async function desenharFundo(ctx, config) {
  const tipo = config?.tipoFundo || 'preset';

  if (tipo === 'custom' && config?.fundoUrl) {
    try {
      const img = await loadImage(config.fundoUrl);
      // "cover": preenche o card inteiro cortando o excesso, sem esticar
      const escala = Math.max(W / img.width, H / img.height);
      const w = img.width * escala, h = img.height * escala;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      return;
    } catch (e) {
      // se a URL falhar, cai pro fundo padrão em vez de deixar preto
    }
  }

  const estiloId = (tipo === 'gerado' && config?.fundoId) ? config.fundoId : (config?.fundoId || 'aurora');
  const preset = PRESETS[estiloId] || PRESETS.aurora;
  const cores = (tipo === 'gerado' && Array.isArray(config?.coresGeradas) && config.coresGeradas.length)
    ? config.coresGeradas
    : preset.coresPadrao;
  preset.desenhar(ctx, cores);
}

function ajustarFonteParaCaber(ctx, texto, larguraMax, tamanhoInicial) {
  let tamanho = tamanhoInicial;
  ctx.font = `bold ${tamanho}px sans-serif`;
  while (ctx.measureText(texto).width > larguraMax && tamanho > 20) {
    tamanho -= 2;
    ctx.font = `bold ${tamanho}px sans-serif`;
  }
  return tamanho;
}

/**
 * Gera o card de entrada ou saída.
 * @param {object} opts
 * @param {'entrada'|'saida'} opts.tipo
 * @param {import('discord.js').GuildMember} opts.member
 * @param {object} opts.config - imagemEntrada ou imagemSaida (ver boasVindas.js)
 * @param {number} [opts.contagemMembros]
 * @returns {Promise<Buffer>} PNG buffer
 */
async function gerarCard({ tipo, member, config, contagemMembros }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  await desenharFundo(ctx, config);

  // Overlay escuro na parte de baixo, pra texto ficar legível em
  // qualquer fundo (pronto, gerado ou uma foto qualquer via URL).
  const overlay = ctx.createLinearGradient(0, H * 0.35, 0, H);
  overlay.addColorStop(0, 'rgba(0,0,0,0)');
  overlay.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, W, H);

  const corNome = config?.corNome || '#57F287'; // verde padrão do Discord

  // Avatar circular com brilho na cor escolhida
  const avatarR = 68;
  const avatarX = W / 2;
  const avatarY = 108;

  try {
    const avatarUrl = member.user?.displayAvatarURL
      ? member.user.displayAvatarURL({ extension: 'png', size: 256 })
      : member.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarUrl);

    const glow = ctx.createRadialGradient(avatarX, avatarY, avatarR * 0.6, avatarX, avatarY, avatarR * 1.6);
    glow.addColorStop(0, hexParaRgba(corNome, 0.55));
    glow.addColorStop(1, hexParaRgba(corNome, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR * 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
    ctx.restore();

    ctx.strokeStyle = corNome;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.stroke();
  } catch (e) {
    // segue sem avatar se falhar (ex: usuário sem avatar/URL inválida)
  }

  // Texto kicker (pequeno, acima do nome)
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 20px sans-serif';
  ctx.fillText(tipo === 'entrada' ? 'BEM-VINDO(A)' : 'ATÉ MAIS', W / 2, 208);

  // Nome do usuário — na cor configurada, SÓ nesta imagem
  const nome = (member.user?.username || member.displayName || 'usuário').toUpperCase();
  const tamanhoFonte = ajustarFonteParaCaber(ctx, nome, W - 120, 46);
  ctx.font = `bold ${tamanhoFonte}px sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(nome, W / 2 + 2, 244 + 2);
  ctx.fillStyle = corNome;
  ctx.fillText(nome, W / 2, 244);

  // Subtexto (servidor / contagem)
  ctx.font = '18px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const nomeServidor = member.guild?.name || '';
  const subtexto = tipo === 'entrada'
    ? (contagemMembros ? `Membro #${contagemMembros} de ${nomeServidor}` : `Bem-vindo(a) a ${nomeServidor}`)
    : `Saiu de ${nomeServidor}`;
  ctx.fillText(subtexto, W / 2, 272);

  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}

module.exports = {
  gerarCard,
  sortearFundo,
  PRESETS,
  IDS_PRESETS,
};
