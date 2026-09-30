const { createCanvas } = require('@napi-rs/canvas');

async function gerarBannerLoja(nomeServidor = 'Kael') {
  const W = 800, H = 200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 5, H);

  const nome = nomeServidor.toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nome, W / 2, H / 2);

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const textWidth = ctx.measureText(nome).width;
  ctx.moveTo(W / 2 - textWidth / 2, H / 2 + 42);
  ctx.lineTo(W / 2 + textWidth / 2, H / 2 + 42);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { gerarBannerLoja };
