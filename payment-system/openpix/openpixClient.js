// ═══════════════════════════════════════════════════════════════════════
//  payment-system/openpix/openpixClient.js
//  Cliente HTTP OpenPix/Woovi — TAREFA 1 (Parte 2)
//
//  REGRA CRÍTICA: cada função aqui corresponde a um endpoint CONFIRMADO
//  na documentação oficial em developers.openpix.com.br /
//  developers.woovi.com (consultada nesta implementação). Nenhum
//  endpoint, payload ou header foi inventado. Referências por função:
//
//   - criarCobranca            → POST /api/v1/charge
//       https://developers.openpix.com.br/docs/charge/how-to-create-charge-using-api
//       (splits/SPLIT_SUB_ACCOUNT: how-to-create-charge-with-split-to-subbaccount-using-api)
//   - obterCobranca            → GET  /api/v1/charge/{correlationID}
//       https://developers.openpix.com.br/en/docs/charge/how-to-create-charge-using-api
//   - reembolsarCobranca       → POST /api/v1/charge/{correlationID}/refund
//       https://developers.openpix.com.br/docs/integrations/n8n-without-plugin
//   - criarSubconta            → POST /api/v1/subaccount
//       https://developers.woovi.com/docs/subaccount/how-to-create-a-subbaccount
//   - listarSubcontas          → GET  /api/v1/subaccount
//       https://developers.openpix.com.br/en/docs/subaccount/how-to-list-subaccounts-of-a-company-using-api
//   - obterSubconta            → GET  /api/v1/subaccount/{pixKey}
//       https://developers.woovi.com/en/docs/subaccount/how-to-get-balance-and-details-of-subaccount-using-api
//   - sacarSubconta            → POST /api/v1/subaccount/{pixKey}/withdraw  (saque INTEGRAL — a
//       documentação não expõe valor parcial neste endpoint)
//       https://developers.woovi.com/docs/subaccount/how-to-withdraw-from-subaccount-using-api
//   - criarWebhook             → POST /api/v1/webhook
//       https://developers.woovi.com/docs/partnerships/how-to-create-a-webhook-to-affiliated-company
//       (endpoint/campos válidos também para a conta principal, não apenas afiliadas)
//
//  Autenticação: header "Authorization: <appID>" (sem prefixo "Bearer"),
//  exatamente como em todos os exemplos de charge/subaccount da
//  documentação. O appID é da CONTA PRINCIPAL da Kael (não por
//  servidor) — ver payment-system/openpix/openpixManager.js.
// ═══════════════════════════════════════════════════════════════════════

const OPENPIX_BASE_URL = process.env.OPENPIX_BASE_URL || 'https://api.openpix.com.br';

function getAppId() {
  const appId = process.env.OPENPIX_APP_ID;
  if (!appId) throw new Error('OPENPIX_APP_ID não configurado (variável de ambiente).');
  return appId;
}

async function _request(path, { method = 'GET', body } = {}) {
  const resposta = await fetch(`${OPENPIX_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAppId(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const texto = await resposta.text();
  let dados;
  try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { raw: texto }; }

  if (!resposta.ok) {
    const msg = dados?.error || dados?.message || `HTTP ${resposta.status}`;
    const err = new Error(`[OpenPix] ${method} ${path} falhou: ${msg}`);
    err.status = resposta.status;
    err.body = dados;
    throw err;
  }
  return dados;
}

// ── Cobranças (charges) ───────────────────────────────────────────────

/**
 * Cria uma cobrança PIX, opcionalmente com split de 100% do valor para
 * a subconta do servidor (splitType: 'SPLIT_SUB_ACCOUNT') — é assim que
 * "cada servidor tem seu próprio saldo" dentro de uma única conta
 * OpenPix da Kael (TAREFA 1).
 * @param {{ correlationID: string, valorCentavos: number, comentario?: string, subaccountPixKey?: string }} args
 */
async function criarCobranca({ correlationID, valorCentavos, comentario, subaccountPixKey }) {
  const body = {
    correlationID,
    value: valorCentavos,
    comment: comentario || undefined,
  };
  if (subaccountPixKey) {
    body.splits = [{ pixKey: subaccountPixKey, value: valorCentavos, splitType: 'SPLIT_SUB_ACCOUNT' }];
  }
  const dados = await _request('/api/v1/charge', { method: 'POST', body });
  return dados.charge;
}

/** Consulta uma cobrança pelo correlationID. */
async function obterCobranca(correlationID) {
  const dados = await _request(`/api/v1/charge/${encodeURIComponent(correlationID)}`);
  return dados.charge;
}

/** Reembolsa uma cobrança (exige a funcionalidade Subconta na conta). */
async function reembolsarCobranca(correlationID) {
  return _request(`/api/v1/charge/${encodeURIComponent(correlationID)}/refund`, {
    method: 'POST',
    body: { correlationID },
  });
}

// ── Subcontas ──────────────────────────────────────────────────────────

/** Cria a subconta de um servidor. A chave PIX é validada pela OpenPix antes de criar. */
async function criarSubconta({ name, pixKey }) {
  const dados = await _request('/api/v1/subaccount', { method: 'POST', body: { name, pixKey } });
  return dados.subAccount || dados.SubAccount || dados;
}

/** Lista todas as subcontas da conta principal (identificada pelo appID). */
async function listarSubcontas() {
  const dados = await _request('/api/v1/subaccount');
  return dados.subAccounts || dados.SubAccounts || [];
}

/** Saldo e detalhes de uma subconta (balance em centavos). */
async function obterSubconta(pixKey) {
  const dados = await _request(`/api/v1/subaccount/${encodeURIComponent(pixKey)}`);
  return dados.subAccount || dados.SubAccount || dados;
}

/**
 * Saque INTEGRAL do saldo de uma subconta para a própria chave PIX
 * cadastrada nela. A documentação não expõe um parâmetro de valor
 * parcial neste endpoint — por isso "Sacar Tudo" é o único modo
 * suportado oficialmente (mapeia 1:1 com o botão existente).
 */
async function sacarSubconta(pixKey) {
  return _request(`/api/v1/subaccount/${encodeURIComponent(pixKey)}/withdraw`, { method: 'POST' });
}

// ── Webhook (registro via API) ──────────────────────────────────────────

/**
 * Registra um webhook na conta principal. Eventos confirmados na
 * documentação: OPENPIX:CHARGE_CREATED, OPENPIX:CHARGE_COMPLETED,
 * OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER, OPENPIX:CHARGE_EXPIRED,
 * OPENPIX:TRANSACTION_RECEIVED, OPENPIX:TRANSACTION_REFUND_RECEIVED.
 */
async function criarWebhook({ name, event, url, isActive = true }) {
  return _request('/api/v1/webhook', {
    method: 'POST',
    body: { webhook: { name, event, url, isActive } },
  });
}

module.exports = {
  criarCobranca, obterCobranca, reembolsarCobranca,
  criarSubconta, listarSubcontas, obterSubconta, sacarSubconta,
  criarWebhook,
};
