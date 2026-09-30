// ============================================================
//  carteiraIntegration.js — Ponte entre pagamento aprovado e carteira
//
//  INSTRUÇÃO DE USO:
//  No arquivo onde você trata pagamento aprovado (webhook/evento),
//  adicione apenas estas duas linhas:
//
//    const { onVendaAprovada } = require('./utils/carteiraIntegration');
//    await onVendaAprovada(guildId, valor, { produto, comprador, vendaId });
//
//  Isso NÃO altera nenhuma outra lógica existente.
// ============================================================

const { adicionarSaldo } = require('../database/carteiraDB');

/**
 * Chamado sempre que uma venda for aprovada.
 *
 * @param {string} guildId    — ID do servidor Discord
 * @param {number} valor      — Valor em reais (ex.: 29.90)
 * @param {object} detalhes
 * @param {string} detalhes.produto    — Nome do produto vendido
 * @param {string} detalhes.comprador  — Nome/tag do comprador
 * @param {string} [detalhes.vendaId]  — ID único da venda (opcional)
 */
async function onVendaAprovada(guildId, valor, detalhes = {}) {
  try {
    if (!guildId) {
      console.warn('[Carteira] guildId não fornecido — venda não registrada na carteira.');
      return;
    }
    if (!valor || valor <= 0) {
      console.warn('[Carteira] Valor inválido — venda não registrada na carteira.');
      return;
    }

    adicionarSaldo(guildId, valor, detalhes);
    console.log(`[Carteira] +${valor} adicionado ao servidor ${guildId} | Produto: ${detalhes.produto || '?'}`);
  } catch (err) {
    // Nunca deixar erro da carteira quebrar o fluxo de compra principal
    console.error('[Carteira] Erro ao registrar venda:', err);
  }
}

module.exports = { onVendaAprovada };
