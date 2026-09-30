'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets');

function baseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
}

function assetPath(nome) {
  return path.join(DIR, nome);
}

function assetUrl(nome) {
  const base = baseUrl();
  return base ? `${base}/assets/${nome}` : null;
}

function servirAsset(req, res) {
  try {
    const nome = decodeURIComponent(String(req.url || '').split('?')[0].replace(/^\/assets\//, ''));
    if (!/^[a-z0-9._-]+\.png$/i.test(nome)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const arquivo = assetPath(nome);
    if (!fs.existsSync(arquivo)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const buf = fs.readFileSync(arquivo);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
    });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    return res.end('Erro interno.');
  }
}

module.exports = { assetPath, assetUrl, servirAsset };
