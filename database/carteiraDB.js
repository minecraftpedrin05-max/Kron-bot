// ============================================================
//  carteiraDB.js — Banco de dados da carteira (multi-servidor)
//  Cada guildId possui seu próprio registro isolado.
// ============================================================

const fs   = require('fs');
const path = require('path');

// Caminho do arquivo JSON de persistência
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'carteiras.json');

// ── Helpers internos ─────────────────────────────────────────

/** Carrega todo o banco do disco. */
function _load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, '{}', 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Salva todo o banco no disco. */
function _save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Retorna a carteira de um servidor.
 * Se não existir, cria um registro zerado.
 */
function _getGuild(db, guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      guildId,
      saldo:        0,       // R$ disponível para saque
      totalVendas:  0,       // quantidade de vendas
      faturamento:  0,       // soma de tudo que entrou
      totalSacado:  0,       // soma de tudo que saiu
      ultimaVenda:  null,    // ISO string da última venda
      pixKey:       null,    // chave PIX cadastrada
      pixType:      null,    // CPF | EMAIL | TELEFONE | ALEATORIA
      historico:    [],      // array de registros financeiros
    };
  }
  return db[guildId];
}

// ── API pública ──────────────────────────────────────────────

/**
 * Lê a carteira de um servidor.
 * @returns {object|null} carteira ou null se não existir
 */
function lerCarteira(guildId) {
  const db = _load();
  return db[guildId] || null;
}

/**
 * Adiciona saldo à carteira do servidor (chamado após venda aprovada).
 * @param {string} guildId
 * @param {number} valor        — valor em reais (ex.: 20.00)
 * @param {object} detalhes     — { produto, comprador, vendaId }
 */
function adicionarSaldo(guildId, valor, detalhes = {}) {
  const db    = _load();
  const cart  = _getGuild(db, guildId);
  const agora = new Date().toISOString();

  cart.saldo       += valor;
  cart.faturamento += valor;
  cart.totalVendas += 1;
  cart.ultimaVenda  = agora;

  // CORREÇÃO (Carteira — Parte 1): campos adicionais (provider/
  // providerTransactionId) são puramente aditivos — entradas antigas do
  // histórico continuam válidas mesmo sem eles (ficam como `null`).
  // Preparam o terreno para a Parte 2 (OpenPix), sem inventar nenhum
  // comportamento de provider ainda.
  cart.historico.unshift({
    tipo:                  'VENDA',
    produto:               detalhes.produto    || 'Produto',
    valor,
    comprador:             detalhes.comprador  || 'Desconhecido',
    vendaId:               detalhes.vendaId    || null,
    provider:              detalhes.provider   || null,
    providerTransactionId: detalhes.providerTransactionId || null,
    data:                  agora,
  });

  // Manter histórico máximo de 200 registros
  if (cart.historico.length > 200) cart.historico.length = 200;

  _save(db);
  return cart;
}

/**
 * Registra um saque e zera o saldo disponível.
 * @returns {object} { sucesso, valor, pixKey, pixType, data }
 */
function registrarSaque(guildId, detalhes = {}) {
  const db   = _load();
  const cart = _getGuild(db, guildId);

  if (cart.saldo <= 0) {
    return { sucesso: false, motivo: 'Saldo insuficiente.' };
  }
  if (!cart.pixKey) {
    return { sucesso: false, motivo: 'Nenhuma chave PIX cadastrada.' };
  }

  const valor = cart.saldo;
  const agora = new Date().toISOString();

  cart.totalSacado += valor;
  cart.saldo        = 0;

  cart.historico.unshift({
    tipo:    'SAQUE',
    valor,
    pixKey:  cart.pixKey,
    pixType: cart.pixType,
    origem:  detalhes.origem || 'MANUAL',
    data:    agora,
  });

  if (cart.historico.length > 200) cart.historico.length = 200;

  _save(db);
  return { sucesso: true, valor, pixKey: cart.pixKey, pixType: cart.pixType, data: agora };
}

/**
 * Salva / atualiza a chave PIX do servidor.
 * @param {string} pixType  — CPF | EMAIL | TELEFONE | ALEATORIA
 * @param {string} pixKey   — valor da chave
 */
function salvarPix(guildId, pixType, pixKey) {
  const db   = _load();
  const cart = _getGuild(db, guildId);

  cart.pixType = pixType;
  cart.pixKey  = pixKey;

  _save(db);
  return cart;
}

/**
 * Retorna os N registros mais recentes do histórico.
 */
function obterHistorico(guildId, limite = 10) {
  const db   = _load();
  const cart = db[guildId];
  if (!cart) return [];
  return cart.historico.slice(0, limite);
}

/**
 * Retorna apenas vendas (sem saques) para "Últimas Vendas".
 */
function obterUltimasVendas(guildId, limite = 5) {
  const db   = _load();
  const cart = db[guildId];
  if (!cart) return [];
  return cart.historico.filter(r => r.tipo === 'VENDA').slice(0, limite);
}

module.exports = {
  lerCarteira,
  adicionarSaldo,
  registrarSaque,
  salvarPix,
  obterHistorico,
  obterUltimasVendas,
};
