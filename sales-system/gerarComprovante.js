let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch {}

// BUGFIX (causa raiz do "texto invisível/imagem preta"): antes o canvas
// usava só 'sans-serif' — se o container (Railway, Docker, etc.) não
// tiver NENHUMA fonte de sistema registrada, o texto simplesmente não
// desenha (sem erro, sem aviso). Agora:
//  1. Carrega as fontes de sistema explicitamente uma única vez, se a
//     API existir nesta versão do @napi-rs/canvas.
//  2. Usa uma cadeia de fontes (várias opções, o canvas tenta cada uma
//     em ordem) em vez de depender só do genérico 'sans-serif'.
let fontesCarregadas = false;
function garantirFontes() {
  if (fontesCarregadas || !canvasLib) return;
  fontesCarregadas = true;
  try {
    if (typeof canvasLib.GlobalFonts?.loadSystemFonts === 'function') {
      canvasLib.GlobalFonts.loadSystemFonts();
    }
  } catch (e) {
    console.error('[Comprovante] Não foi possível carregar fontes de sistema:', e.message);
  }
}
const FONTE = '"DejaVu Sans", "Liberation Sans", "Noto Sans", "Arial", sans-serif';

/** Desenha um retângulo com cantos arredondados (estilo cartão). */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Quebra o texto em múltiplas linhas caso ultrapasse a largura máxima
 * (necessário pra nomes de produto longos não vazarem do cartão). */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, curY);
      line = words[i] + ' ';
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, curY);
  return curY; // devolve a última posição Y usada, pra ajustar o resto do layout
}

// Remove emojis customizados do Discord (<:nome:id> e <a:nome:id>)
// que não renderizam no canvas — só Unicode funciona
function limparEmoji(str) {
  if (!str) return '';
  return str.replace(/<a?:[^:]+:\d+>/g, '').trim();
}

async function gerarComprovante({ username, avatarURL, produtoNome, produto, produtoEmoji, emoji, preco, footerText, storeName, guildIconURL, guildName, siteURL, produtoImagemURL }) {
  if (!canvasLib) return null;
  garantirFontes();
  const { createCanvas, loadImage } = canvasLib;

  const nome      = produtoNome || produto || 'Produto';
  const emojiRaw  = produtoEmoji || emoji || '';
  const emojiIcon = limparEmoji(emojiRaw);
  // Rodapé agora é dividido em duas partes: nome do servidor (esquerda,
  // com o ícone dele) e o "site" da marca (direita) — igual à referência
  // ("TSUO · SCRIPTS..." à esquerda, "easebot.app" à direita).
  const nomeServidor = guildName || footerText || storeName || 'KAEL';
  const site = siteURL || 'Kael';

  let precoFmt = preco ? String(preco).trim() : '??';
  if (precoFmt !== '??' && !precoFmt.toUpperCase().startsWith('R')) {
    precoFmt = 'R$ ' + precoFmt;
  }

  const productLabel = '1x ' + nome + ' — ' + precoFmt;

  const width = 700, height = 380;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const pad = 32;

  // ---- Cartão arredondado (fundo do cartão em si, sem fundo externo —
  // fica transparente por fora, igual à referência) ----
  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 0, 0, width, height, 22);
  ctx.fillStyle = '#0a0a0b';
  ctx.fill();

  // ---- Avatar (círculo) ----
  const avatarSize = 46;
  const avatarX = pad, avatarY = pad;
  try {
    const avatar = await loadImage(avatarURL.split('?')[0] + '?size=128');
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {
    ctx.fillStyle = '#DC143C';
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Nome do comprador ----
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 20px ${FONTE}`;
  ctx.textBaseline = 'top';
  ctx.fillText(username.slice(0, 24), avatarX + avatarSize + 16, avatarY + 1);

  ctx.fillStyle = '#9aa0a6';
  ctx.font = `15px ${FONTE}`;
  ctx.fillText(`@${username.toLowerCase().slice(0, 24)}`, avatarX + avatarSize + 16, avatarY + 25);

  // ---- Data/hora (canto superior direito) ----
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ctx.fillStyle = '#9aa0a6';
  ctx.font = `15px ${FONTE}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${dateStr} • ${timeStr}`, width - pad, avatarY + 6);
  ctx.textAlign = 'left';

  // ---- Checkmark + título ----
  const titleY = 108;
  ctx.fillStyle = '#3ba55d';
  ctx.beginPath();
  ctx.arc(pad + 14, titleY + 16, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pad + 7, titleY + 16);
  ctx.lineTo(pad + 12, titleY + 21);
  ctx.lineTo(pad + 21, titleY + 10);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 26px ${FONTE}`;
  ctx.fillText('Compra Realizada', pad + 40, titleY);

  // ---- Carrinho (ícone do produto + nome, com quebra de linha automática) ----
  const cartLabelY = titleY + 66;
  ctx.fillStyle = '#9aa0a6';
  ctx.font = `15px ${FONTE}`;
  ctx.fillText('Carrinho', pad, cartLabelY);

  const cartTextY = cartLabelY + 28;
  let cartTextX = pad;
  const iconSize = 22;

  // Ícone real do produto (thumbnail ou banner cadastrado) — substitui a
  // tentativa antiga de desenhar emoji customizado do Discord (que nunca
  // renderiza no canvas e aparecia como quadradinho quebrado ▢).
  if (produtoImagemURL) {
    try {
      const imgProduto = await loadImage(produtoImagemURL);
      roundRect(ctx, cartTextX, cartTextY - 2, iconSize, iconSize, 5);
      ctx.save();
      ctx.clip();
      ctx.drawImage(imgProduto, cartTextX, cartTextY - 2, iconSize, iconSize);
      ctx.restore();
      cartTextX += iconSize + 10;
    } catch {
      // Sem imagem válida — segue sem ícone, só o texto.
    }
  } else if (emojiIcon) {
    // Fallback: emoji Unicode padrão (não customizado) ainda pode desenhar.
    ctx.fillStyle = '#ffffff';
    ctx.font = `19px ${FONTE}`;
    ctx.fillText(emojiIcon, cartTextX, cartTextY);
    cartTextX += 26;
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 19px ${FONTE}`;
  const ultimaLinhaY = wrapText(ctx, productLabel, cartTextX, cartTextY, width - pad - cartTextX, 26);

  // ---- Linha divisória (ajustada dinamicamente pro caso do produto
  // ter quebrado em 2+ linhas) ----
  const dividerY = ultimaLinhaY + 30;
  ctx.strokeStyle = '#3a3b3e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, dividerY);
  ctx.lineTo(width - pad, dividerY);
  ctx.stroke();

  // ---- Valor pago ----
  const valorY = dividerY + 30;
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 19px ${FONTE}`;
  ctx.fillText('Valor pago', pad, valorY);

  ctx.fillStyle = '#3ba55d';
  ctx.font = `bold 26px ${FONTE}`;
  ctx.textAlign = 'right';
  ctx.fillText(precoFmt, width - pad, valorY - 4);
  ctx.textAlign = 'left';

  // ---- Rodapé ----
  const footerY = height - 44;
  ctx.strokeStyle = '#3a3b3e';
  ctx.beginPath();
  ctx.moveTo(pad, footerY - 14);
  ctx.lineTo(width - pad, footerY - 14);
  ctx.stroke();

  let footerTextX = pad;
  const footerIconSize = 20;
  if (guildIconURL) {
    try {
      const iconServidor = await loadImage(guildIconURL);
      ctx.save();
      ctx.beginPath();
      ctx.arc(pad + footerIconSize / 2, footerY - 6, footerIconSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(iconServidor, pad, footerY - 16, footerIconSize, footerIconSize);
      ctx.restore();
      footerTextX = pad + footerIconSize + 8;
    } catch {
      // Sem ícone válido — segue só com o texto.
    }
  }

  ctx.fillStyle = '#9aa0a6';
  ctx.font = `13px ${FONTE}`;
  ctx.fillText(nomeServidor, footerTextX, footerY);

  ctx.textAlign = 'right';
  ctx.fillText(site, width - pad, footerY);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { gerarComprovante };
