// ═══════════════════════════════════════════════════════════════════════
// OPENPIX/WOOVI — Integração oficial via API (Subcontas + Cobrança PIX)
// ═══════════════════════════════════════════════════════════════════════
// Módulo novo e isolado, espelhando a mesma interface pública de
// mercadoPago.js/efiBank.js/c6Bank.js (criarPagamentoPix, consultarPagamento,
// getConfigX) — para o checkout (produto.js) trocar de gateway sem duplicar
// lógica — e implementa o payment-system/PaymentProvider.js (TAREFA 1/3).
//
// Todo endpoint, payload, header e evento abaixo foi confirmado na
// documentação oficial atual (consultada nesta implementação):
//   https://developers.openpix.com.br/en/docs/category/subconta
//   https://developers.openpix.com.br/en/docs/charge/how-to-create-charge-using-api
//   https://developers.openpix.com.br/en/docs/charge/how-to-create-charge-using-api (subaccount field)
//   https://developers.openpix.com.br/en/docs/webhook/seguranca/webhook-signature-validation
//   https://developers.openpix.com.br/en/docs/webhook/webhook-events-type
//   https://developers.openpix.com.br/en/docs/subaccount/how-to-withdraw-from-subaccount-using-api
// Nada aqui foi inventado — o que não pôde ser confirmado NÃO foi
// implementado (ver PENDÊNCIAS no relatório final).
//
// Particularidades confirmadas (diferentes dos outros 3 providers):
//   • Autenticação: header `Authorization: <appID>`, SEM prefixo "Bearer".
//   • Valores: cobrança/subconta trabalham em CENTAVOS (inteiro), não em
//     reais decimais como Mercado Pago/Efi/C6 — conversão feita aqui.
//   • Sandbox: host próprio (api.woovi-sandbox.com), não um flag na mesma URL.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const HOSTS = {
  producao: 'https://api.openpix.com.br',
  sandbox: 'https://api.woovi-sandbox.com',
};

// Chave pública fixa da OpenPix/Woovi usada para validar a assinatura
// `x-webhook-signature` (RSA-SHA256) de TODO webhook, em todas as contas —
// documentada em:
// https://developers.openpix.com.br/en/docs/webhook/seguranca/webhook-signature-validation
const WEBHOOK_PUBLIC_KEY_BASE64 =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlHZk1BMEdDU3FHU0liM0RRRUJBUVVBQTRHTkFEQ0JpUUtCZ1FDLytOdElranpldnZxRCtJM01NdjNiTFhEdApwdnhCalk0QnNSclNkY2EzcnRBd01jUllZdnhTbmQ3amFnVkxwY3RNaU94UU84aWVVQ0tMU1dIcHNNQWpPL3paCldNS2Jxb0c4TU5waS91M2ZwNnp6MG1jSENPU3FZc1BVVUcxOWJ1VzhiaXM1WloySVpnQk9iV1NwVHZKMGNuajYKSEtCQUE4MkpsbitsR3dTMU13SURBUUFCCi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=';

function baseUrl(sandbox) {
  return HOSTS[sandbox ? 'sandbox' : 'producao'];
}

async function requestJson({ sandbox, appId, path, method, body }) {
  if (!appId) throw new Error('AppID da OpenPix não configurado.');

  let resposta;
  try {
    resposta = await fetch(`${baseUrl(sandbox)}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: appId, // confirmado: sem "Bearer" (ver cabeçalho do arquivo)
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Falha de conexão com a OpenPix: ${e.message}`);
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const motivo = dados?.error || dados?.message || dados?.errors?.[0]?.message || `HTTP ${resposta.status}`;
    const erro = new Error(`OpenPix recusou a requisição (${path}): ${motivo}`);
    erro.status = resposta.status;
    erro.body = dados;
    throw erro;
  }

  return dados;
}

// ── Valores: reais (usados no resto do projeto) <-> centavos (API) ─────
function reaisParaCentavos(valor) {
  return Math.round(Number(valor) * 100);
}
function centavosParaReais(centavos) {
  return Number(centavos) / 100;
}

// ═══════════════════════════════════════════════════════════════════════
// SUBCONTAS (TAREFA 2) — vínculo guildId ↔ subaccount/recipient
// https://developers.openpix.com.br/en/docs/subaccount/how-to-list-subaccounts-of-a-company-using-api
// ═══════════════════════════════════════════════════════════════════════

/**
 * Busca uma subconta existente pela chave PIX. Retorna null se não existir
 * (404) — usado para checar duplicidade antes de criar (TAREFA 2, passo 2).
 */
async function obterSubconta({ appId, sandbox, pixKey }) {
  try {
    const dados = await requestJson({
      appId, sandbox, method: 'GET',
      path: `/api/v1/subaccount/${encodeURIComponent(pixKey)}`,
    });
    return dados?.subAccount || dados?.SubAccount || null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * Cria a subconta na OpenPix para o servidor (POST /api/v1/subaccount).
 * A OpenPix exige que a funcionalidade "Subconta" esteja habilitada na
 * conta principal — se não estiver, a API retorna erro e isso é repassado
 * tal como veio (nunca contornado — ver REGRA ABSOLUTA).
 */
async function criarSubconta({ appId, sandbox, pixKey, name }) {
  if (!pixKey) throw new Error('Chave PIX obrigatória para criar a subconta.');
  const dados = await requestJson({
    appId, sandbox, method: 'POST', path: '/api/v1/subaccount',
    body: { pixKey, name: (name || 'Loja Kael').slice(0, 100) },
  });
  return dados?.subAccount || dados?.SubAccount || dados;
}

/** Saldo/detalhes atuais da subconta (fonte de verdade financeira — TAREFA 5). */
async function saldoSubconta({ appId, sandbox, pixKey }) {
  const sub = await obterSubconta({ appId, sandbox, pixKey });
  if (!sub) return null;
  return { pixKey: sub.pixKey, name: sub.name, balance: centavosParaReais(sub.balance || 0) };
}

/**
 * Saque integral da subconta (TAREFA 6).
 * https://developers.openpix.com.br/en/docs/subaccount/how-to-withdraw-from-subaccount-using-api
 * A OpenPix só documenta saque INTEGRAL (não há campo de valor parcial no
 * endpoint) — por isso "Sacar Tudo" mapeia 1:1 para esta chamada.
 */
async function sacarSubconta({ appId, sandbox, pixKey }) {
  const dados = await requestJson({
    appId, sandbox, method: 'POST',
    path: `/api/v1/subaccount/${encodeURIComponent(pixKey)}/withdraw`,
  });
  const tx = dados?.transaction || {};
  return {
    status: tx.status || 'PROCESSING', // CREATED (documentado) → tratado como PROCESSING
    valor: tx.value != null ? centavosParaReais(tx.value) : null,
    correlationID: tx.correlationID || null,
    destinationAlias: tx.destinationAlias || pixKey,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// COBRANÇA (TAREFA 3) — mesma interface de criarPagamentoPix/consultarPagamento
// https://developers.openpix.com.br/en/docs/charge/how-to-create-charge-using-api
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cria uma cobrança PIX vinculada à subconta do servidor (campo
 * `subaccount`, documentado como "Pix key of the subaccount to receive
 * the charge" — o valor integral vai para a subconta, sem split/comissão
 * da conta principal Kael; ver PENDÊNCIA no relatório se split for desejado).
 * @returns {Promise<{id: string, status: string, copiaECola: string, qrCodeBase64: string|null}>}
 */
async function criarPagamentoPix({ appId, sandbox, subaccountPixKey, valor, descricao, clienteId, guildId }) {
  if (!appId) throw new Error('OpenPix não está totalmente configurado (AppID).');
  if (!subaccountPixKey) throw new Error('OpenPix: nenhuma subconta vinculada a este servidor.');

  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) throw new Error('Valor inválido para gerar o pagamento PIX (OpenPix).');

  // correlationID: identificador único da cobrança (idempotência —
  // TAREFA 8). Reenviar o mesmo correlationID nunca cria cobrança duplicada.
  const correlationID = `kron-${guildId}-${clienteId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const dados = await requestJson({
    appId, sandbox, method: 'POST', path: '/api/v1/charge',
    body: {
      correlationID,
      value: reaisParaCentavos(valorNum),
      comment: (descricao || 'Compra via Discord').slice(0, 140),
      subaccount: subaccountPixKey,
    },
  });

  const charge = dados?.charge;
  if (!charge?.brCode) throw new Error('OpenPix não retornou o código PIX (brCode) da cobrança.');

  return {
    id: correlationID, // correlationID é o identificador usado em todo o resto do fluxo (consulta/webhook)
    status: mapStatus(charge.status),
    copiaECola: charge.brCode,
    qrCodeBase64: null, // OpenPix não retorna QR embutido em base64 — só brCode (payload) e qrCodeImage (URL); o projeto já gera o QR a partir do copiaECola via gerarQrCodeComLogo, igual aos outros providers
  };
}

/**
 * Consulta o status oficial de uma cobrança (GET /api/v1/charge/{correlationID}).
 * NUNCA deve ser substituído por sinal indireto do Discord/frontend.
 */
async function consultarPagamento(correlationID, cfg) {
  const dados = await requestJson({
    appId: cfg.appId, sandbox: cfg.sandbox, method: 'GET',
    path: `/api/v1/charge/${encodeURIComponent(correlationID)}`,
  });
  const charge = dados?.charge;
  return { id: correlationID, status: mapStatus(charge?.status), status_detail: charge?.status };
}

/** Vocabulário OpenPix (ACTIVE/COMPLETED/EXPIRED) → vocabulário interno do Kael. */
function mapStatus(status) {
  const mapa = {
    COMPLETED: 'approved',
    ACTIVE: 'pending',
    EXPIRED: 'cancelled',
  };
  return mapa[status] || 'pending';
}

/**
 * Único ponto de leitura da configuração da OpenPix salva pelo /openpix.
 * Usado no checkout (produto.js), no webhook e na carteira.
 */
function getConfigOpenPix(guildId) {
  const db = require('../database/db');
  const cfg = db.getGuild(guildId)?.loja?.openpix || null;
  const habilitado = !!(cfg && cfg.habilitado && cfg.appId && cfg.subaccountPixKey);
  return {
    habilitado,
    appId: cfg?.appId || null,
    sandbox: !!cfg?.sandbox,
    subaccountPixKey: cfg?.subaccountPixKey || null,
    subaccountName: cfg?.subaccountName || null,
  };
}

// ── Validação de autenticidade do webhook (TAREFA 4 — obrigatório) ─────
// https://developers.openpix.com.br/en/docs/webhook/seguranca/webhook-signature-validation
function verificarAssinaturaWebhook(payloadCru, signatureBase64) {
  if (!signatureBase64) return false;
  try {
    const publicKey = Buffer.from(WEBHOOK_PUBLIC_KEY_BASE64, 'base64').toString('ascii');
    const verify = crypto.createVerify('sha256');
    verify.write(Buffer.from(payloadCru));
    verify.end();
    return verify.verify(publicKey, signatureBase64, 'base64');
  } catch (e) {
    console.error('[OpenPix] Erro ao validar assinatura do webhook:', e.message);
    return false;
  }
}

// ── Confirmação: webhook é o mecanismo primário (TAREFA 4). O `pendentes`
// abaixo espelha exatamente o padrão de efiBank.js/c6Bank.js e serve só
// como rede de segurança (reconciliação após restart / se o webhook
// falhar em chegar) — nunca aprova pagamento sozinho sem consultar a API.
const pendentes = new Map(); // correlationID -> dados do pedido (mesmo shape do MP/Efi/C6)

function registrarPendente(correlationID, dados) { pendentes.set(correlationID, dados); }
function removerPendente(correlationID) { pendentes.delete(correlationID); }
function obterPendente(correlationID) { return pendentes.get(correlationID); }

let pollerAtivo = false;
function iniciarPollerOpenPix(client) {
  if (pollerAtivo) return;
  pollerAtivo = true;

  // Recuperação após restart (TAREFA 4/8): repopula `pendentes` a partir
  // das transações ainda PENDING no SQLite (fonte de verdade — ver
  // transacaoManager.js), já que o Map acima é só em memória.
  try {
    const { listarPendentes } = require('./transacaoManager');
    for (const t of listarPendentes()) {
      if (t.openpix_correlation_id) {
        registrarPendente(t.openpix_correlation_id, {
          guildId: t.guild_id, clienteId: t.cliente_id, varianteKey: null,
          canalId: t.canal_id, numeroPedido: t.numero_pedido, produtoId: t.produto_id,
          openpixCorrelationId: t.openpix_correlation_id,
        });
      }
    }
  } catch (e) {
    console.error('[OpenPix] Erro ao recuperar pendentes após restart:', e.message);
  }

  console.log('[OpenPix] Poller de reconciliação iniciado (a cada 30s — o webhook é o mecanismo primário).');
  setInterval(async () => {
    for (const [correlationID, dados] of pendentes.entries()) {
      try {
        const cfg = getConfigOpenPix(dados.guildId);
        if (!cfg.habilitado) continue;
        const pagamento = await consultarPagamento(correlationID, cfg);
        if (pagamento.status === 'approved') {
          removerPendente(correlationID);
          const { entregarAutomatico } = require('./salesManager');
          await entregarAutomatico({ client, ...dados });
        } else if (pagamento.status === 'cancelled') {
          removerPendente(correlationID);
        }
      } catch (e) {
        console.error(`[OpenPix] Erro ao consultar correlationID ${correlationID}:`, e.message);
      }
    }
  }, 30000);
}

module.exports = {
  // Provider (checkout)
  criarPagamentoPix, consultarPagamento, getConfigOpenPix,
  registrarPendente, removerPendente, obterPendente, iniciarPollerOpenPix,
  // Subcontas
  criarSubconta, obterSubconta, saldoSubconta, sacarSubconta,
  // Webhook
  verificarAssinaturaWebhook,
  // Utils
  reaisParaCentavos, centavosParaReais, mapStatus,
};

