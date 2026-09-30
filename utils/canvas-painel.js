const { createCanvas, loadImage } = require("@napi-rs/canvas");

const LOGO_URL = require("path").join(__dirname, "..", "assets", "kael-avatar.png");

const OURO = "#FFD700";
const BRANCO = "#FFFFFF";
const CINZA = "#1A1A1A";
const CINZA_CLARO = "#cfcfcf";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Gera o banner do painel no estilo dashboard premium (referência Zecastx Pro).
 * @param {object} dados
 * @param {string} dados.nome     - nome a saudar (ex: getNome(guild))
 * @param {string} dados.versao
 * @returns {Promise<Buffer>} PNG buffer
 */
async function gerarPainelCanvas(dados) {
  const W = 1100;
  const H = 580;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Fundo geral (100% preto, sem bordas/cantos transparentes) ──
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  // ════════════════════════════════════════
  // BANNER TOPO (fundo gradiente + logo)
  // ════════════════════════════════════════
  const bannerH = 280;

  ctx.save();

  const grad = ctx.createLinearGradient(0, 0, W, bannerH);
  grad.addColorStop(0, "#000000");
  grad.addColorStop(0.5, "#161616");
  grad.addColorStop(1, "#000000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, bannerH);

  const glow = ctx.createRadialGradient(W - 150, bannerH / 2, 20, W - 150, bannerH / 2, 320);
  glow.addColorStop(0, "rgba(255,215,0,0.25)");
  glow.addColorStop(1, "rgba(255,215,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, bannerH);

  ctx.strokeStyle = "rgba(255,215,0,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 30 + i * 45);
    ctx.lineTo(W, 30 + i * 45 - 60);
    ctx.stroke();
  }

  try {
    const logo = await loadImage(LOGO_URL);
    const logoSize = 160;
    const logoX = (W - logoSize) / 2;
    const logoY = (bannerH - logoSize) / 2 - 10;

    const logoGlow = ctx.createRadialGradient(
      logoX + logoSize / 2, logoY + logoSize / 2, 10,
      logoX + logoSize / 2, logoY + logoSize / 2, logoSize
    );
    logoGlow.addColorStop(0, "rgba(255,215,0,0.45)");
    logoGlow.addColorStop(1, "rgba(255,215,0,0)");
    ctx.fillStyle = logoGlow;
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    roundRect(ctx, logoX, logoY, logoSize, logoSize, 24);
    ctx.clip();
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();

    ctx.strokeStyle = OURO;
    ctx.lineWidth = 2;
    roundRect(ctx, logoX, logoY, logoSize, logoSize, 24);
    ctx.stroke();
  } catch (e) {
    // segue sem logo se falhar
  }

  ctx.restore();

  // ── Título grande sobre o banner ──
  ctx.textAlign = "center";
  ctx.fillStyle = OURO;
  ctx.font = "bold 54px sans-serif";
  ctx.fillText("KAEL", W / 2, bannerH - 75);

  ctx.fillStyle = CINZA_CLARO;
  ctx.font = "20px sans-serif";
  ctx.fillText(
    "Sistema profissional para gerenciamento de filas, vendas, pagamentos e partidas.",
    W / 2,
    bannerH - 40
  );
  ctx.textAlign = "left";

  // ════════════════════════════════════════
  // FAIXA "VORTEX SYSTEM" - fundo branco, estilo Zecastx
  // ════════════════════════════════════════
  const tagY = bannerH + 25;
  const tagH = 55;

  ctx.fillStyle = BRANCO;
  ctx.fillRect(0, tagY, W, tagH);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(">>  VORTEX SYSTEM  <<", W / 2, tagY + tagH / 2 + 9);
  ctx.textAlign = "left";

  // ════════════════════════════════════════
  // SAUDAÇÃO
  // ════════════════════════════════════════
  let y = tagY + tagH + 45;

  ctx.fillStyle = BRANCO;
  ctx.font = "22px sans-serif";
  ctx.fillText(`Olá senhor(a) `, 60, y);
  const w1 = ctx.measureText("Olá senhor(a) ").width;
  ctx.fillStyle = OURO;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(dados.nome, 60 + w1, y);
  const w2 = ctx.measureText(dados.nome).width;
  ctx.fillStyle = BRANCO;
  ctx.font = "22px sans-serif";
  ctx.fillText(`, ${dados.saudacao}!`, 60 + w1 + w2, y);

  y += 40;
  ctx.fillStyle = CINZA_CLARO;
  ctx.font = "19px sans-serif";
  ctx.fillText("Aqui você pode configurar e personalizar as funcionalidades do seu sistema", 60, y);
  y += 28;
  ctx.fillStyle = OURO;
  ctx.font = "bold 19px sans-serif";
  ctx.fillText("Vortex System", 60, y);

  // ════════════════════════════════════════
  // LINHA DE VERSÃO / UPDATE (estilo Zecastx, texto simples)
  // ════════════════════════════════════════
  y += 45;

  ctx.font = "20px sans-serif";
  ctx.fillStyle = BRANCO;
  ctx.fillText("Versão", 60, y);

  ctx.fillStyle = OURO;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(dados.versao, 145, y);

  ctx.fillStyle = BRANCO;
  ctx.font = "20px sans-serif";
  ctx.fillText("|  Update:", 250, y);

  ctx.fillStyle = OURO;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Agora", 380, y);

  // ════════════════════════════════════════
  // FAIXA FINAL "KAEL SYSTEM" - fundo branco
  // ════════════════════════════════════════
  const barH = 50;
  const barY = H - barH;

  ctx.fillStyle = BRANCO;
  ctx.fillRect(0, barY, W, barH);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(">>  KAEL SYSTEM  <<", W / 2, barY + barH / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

const FAIXA_BG_URL = null;

/**
 * Gera a segunda imagem (faixa branca separada) com "KAEL SYSTEM".
 * @returns {Promise<Buffer>} PNG buffer
 */
async function gerarFaixaKron() {
  const W = 1100;
  const H = 60;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  try {
    const bg = await loadImage(FAIXA_BG_URL);
    ctx.drawImage(bg, 0, 0, W, H);
  } catch (e) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
  }

  ctx.fillStyle = "#000000";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(">>  KAEL SYSTEM  <<", W / 2, H / 2);

  return canvas.toBuffer("image/png");
}

module.exports = { gerarPainelCanvas, gerarFaixaKron };
