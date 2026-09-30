/**
 * ─────────────────────────────────────────────────────────────────────
 *  KAEL — Máquina de estados da transação de pagamento
 *
 *  Cada carrinho que chega na etapa de QR Code/Pagamento Pendente ganha
 *  UMA linha na tabela `transacoes_pagamento` (database/sqliteDb.js),
 *  com um dos estados:
 *
 *    PENDING   → aguardando pagamento (recém-criada)
 *    PAID      → pagamento confirmado (admin ou gateway)
 *    CANCELLED → cancelada pelo cliente (com ou sem motivo)
 *    EXPIRED   → passou dos 10 minutos sem pagamento
 *    REFUSED   → pagamento recusado por um admin
 *
 *  Uma transação encerrada (qualquer estado que não seja PENDING) NUNCA
 *  volta para PENDING — todas as transições abaixo são feitas com um
 *  único UPDATE ... WHERE status = 'PENDING', que só tem efeito se a
 *  transação ainda estiver aberta. Isso resolve sozinho as corridas
 *  citadas no pedido (cancelar x aprovar x expirar x confirmar
 *  simultâneos): quem chegar primeiro "vence", e os demais recebem
 *  `false` (transação já encerrada) sem duplicar nada.
 *
 *  Esta é a ÚNICA fonte de verdade sobre o status da transação. Não
 *  duplica pedidosAtivos/metadadosPedido (em memória, usados só pro
 *  carrinho em si — quantidade, cupom etc.) nem carrinho_eventos
 *  (histórico/analytics do Kael Intelligence).
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../database/db');

// Regra fixa do Kael: pagamento pendente por 10 minutos → expiração
// automática. NÃO existe (e não deve existir) configuração de servidor
// ou botão de cliente para alterar este valor.
const DURACAO_EXPIRACAO_MS = 10 * 60 * 1000;

function gerarTransacaoId() {
  const parteTempo = Date.now().toString(36).toUpperCase();
  const parteAleatoria = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${parteTempo}-${parteAleatoria}`;
}

/**
 * Cria a transação PENDING deste carrinho (ou reaproveita a que já existe,
 * se o cliente reabrir a tela de pagamento sem que os 10 minutos tenham
 * passado) — nunca reinicia o cronômetro de uma transação já em andamento.
 */
function obterOuCriarTransacaoPendente({
  canalId, guildId, clienteId, produtoId, numeroPedido,
  itemNome, varianteNome, valor, mpPaymentId, efiTxid, c6Txid, openpixCorrelationID,
}) {
  const existente = getPorCanal(canalId);
  if (existente && existente.status === 'PENDING') {
    return {
      transacaoId: existente.transacao_id,
      expiraEm: new Date(existente.expira_em),
      reaproveitada: true,
    };
  }

  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + DURACAO_EXPIRACAO_MS);
  const transacaoId = gerarTransacaoId();

  db.criarOuReaproveitarTransacaoPendente({
    canalId, transacaoId, guildId, clienteId, produtoId,
    numeroPedido, itemNome, varianteNome, valor, mpPaymentId, efiTxid, c6Txid, openpixCorrelationID,
    criadoEm: agora.toISOString(),
    expiraEm: expiraEm.toISOString(),
    atualizadoEm: agora.toISOString(),
  });

  return { transacaoId, expiraEm, reaproveitada: false };
}

function getPorCanal(canalId) {
  return db.getTransacaoPagamentoPorCanal(canalId);
}

function getPorId(transacaoId) {
  return db.getTransacaoPagamentoPorId(transacaoId);
}

/** PENDING -> PAID. Retorna true só se esta chamada venceu a corrida. */
function marcarPaga(canalId) {
  return db.marcarTransacaoPaga(canalId, new Date().toISOString()) === 1;
}

/** PENDING -> CANCELLED. `motivo` pode ser null (cancelamento sem motivo). */
function marcarCancelada(canalId, { motivo, canceladoPor }) {
  return db.marcarTransacaoCancelada(canalId, motivo || null, canceladoPor || null, new Date().toISOString()) === 1;
}

/** PENDING -> EXPIRED (usado pelo scheduler de expiração automática). */
function marcarExpirada(canalId) {
  return db.marcarTransacaoExpirada(canalId, new Date().toISOString()) === 1;
}

/** PENDING -> REFUSED (admin recusou o pagamento). */
function marcarRecusada(canalId, recusadoPor) {
  return db.marcarTransacaoRecusada(canalId, recusadoPor || null, new Date().toISOString()) === 1;
}

/** Todas as transações ainda abertas — usado no boot pra recalcular timers. */
function listarPendentes() {
  return db.listarTransacoesPendentes();
}

module.exports = {
  DURACAO_EXPIRACAO_MS,
  gerarTransacaoId,
  obterOuCriarTransacaoPendente,
  getPorCanal,
  getPorId,
  marcarPaga,
  marcarCancelada,
  marcarExpirada,
  marcarRecusada,
  listarPendentes,
};
