// ═══════════════════════════════════════════════════════════════════════
// MERCADO PAGO — Integração oficial via API (Pagamentos PIX)
// ═══════════════════════════════════════════════════════════════════════
// Módulo novo e isolado: não altera nenhuma função existente de catálogo,
// variantes, estoque ou entregas. Fornece apenas as operações que
// faltavam para o Mercado Pago funcionar de ponta a ponta:
//   - criarPagamentoPix   → cria a cobrança PIX (POST /v1/payments)
//   - consultarPagamento  → consulta o status (GET /v1/payments/{id})
//   - getConfigMercadoPago → único ponto de leitura da configuração,
//                            usado tanto no checkout (produto.js) quanto
//                            no webhook (webhook.js), para nunca mais
//                            existir duas checagens divergentes.
// ═══════════════════════════════════════════════════════════════════════

const MP_BASE_URL = 'https://api.mercadopago.com';

/**
 * Cria uma cobrança PIX via API oficial do Mercado Pago.
 * @returns {Promise<{id: string, status: string, copiaECola: string, qrCodeBase64: string|null}>}
 */
async function criarPagamentoPix({ accessToken, valor, descricao, clienteId, guildId }) {
  if (!accessToken) throw new Error('Access Token do Mercado Pago não configurado.');

  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    throw new Error('Valor inválido para gerar o pagamento PIX.');
  }

  // A API do Mercado Pago exige payer.email para criar pagamentos PIX,
  // mas a compra é feita 100% dentro do Discord (sem coletar e-mail do
  // cliente). Usamos um e-mail sintético baseado no ID do Discord apenas
  // para satisfazer a validação da API — não é usado para envio real.
  const payerEmail = `discord.${clienteId}@kron-checkout.com`;
  const idempotencyKey = `kron-${guildId}-${clienteId}-${Date.now()}`;

  let resposta;
  try {
    resposta = await fetch(`${MP_BASE_URL}/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: Number(valorNum.toFixed(2)),
        description: (descricao || 'Compra via Discord').slice(0, 250),
        payment_method_id: 'pix',
        payer: { email: payerEmail },
        external_reference: `${guildId}:${clienteId}:${Date.now()}`,
      }),
    });
  } catch (e) {
    throw new Error(`Falha de conexão com o Mercado Pago: ${e.message}`);
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok || !dados) {
    const motivo = dados?.message || dados?.cause?.[0]?.description || `HTTP ${resposta.status}`;
    throw new Error(`Mercado Pago recusou a criação do pagamento: ${motivo}`);
  }

  const transacao = dados.point_of_interaction?.transaction_data;
  if (!transacao?.qr_code) {
    throw new Error('Mercado Pago não retornou o código PIX (verifique se o PIX está habilitado na conta).');
  }

  return {
    id: String(dados.id),
    status: dados.status, // normalmente 'pending' logo após a criação
    copiaECola: transacao.qr_code,
    qrCodeBase64: transacao.qr_code_base64 || null,
  };
}

/**
 * Consulta o status atual de um pagamento no Mercado Pago.
 * @returns {Promise<{id: string, status: string, status_detail: string}>}
 */
async function consultarPagamento(paymentId, accessToken) {
  if (!accessToken) throw new Error('Access Token do Mercado Pago não configurado.');

  let resposta;
  try {
    resposta = await fetch(`${MP_BASE_URL}/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(`Falha de conexão ao consultar pagamento ${paymentId}: ${e.message}`);
  }

  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados) {
    throw new Error(`Falha ao consultar pagamento ${paymentId} no Mercado Pago (HTTP ${resposta.status}).`);
  }

  return { id: String(dados.id), status: dados.status, status_detail: dados.status_detail };
}

/**
 * Único ponto de leitura da configuração do Mercado Pago salva pelo
 * /definicoes. Usado no checkout (produto.js) e no webhook (webhook.js)
 * para que ambos concordem exatamente sobre quando o MP está disponível.
 * @returns {{habilitado: boolean, accessToken: string|null}}
 */
function getConfigMercadoPago(guildId) {
  const db = require('../database/db');
  const mp = db.getGuild(guildId)?.loja?.mercadopago || null;
  const habilitado = !!(mp && mp.habilitado && mp.accessKey);
  return { habilitado, accessToken: habilitado ? mp.accessKey : null };
}

module.exports = { criarPagamentoPix, consultarPagamento, getConfigMercadoPago };
