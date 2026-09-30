const http = require('http');
const crypto = require('crypto');
const { consultarPagamento, getConfigMercadoPago } = require('./mercadoPago');


const pagamentosAtivos = new Map();

// CORREÇÃO (auditoria — Bug 2: webhook do Mercado Pago processado em
// duplicidade): o Mercado Pago reenvia notificações do mesmo pagamento
// (comportamento normal, não é caso raro). Duas notificações chegando
// quase juntas passavam ambas pela checagem de `pagamentosAtivos.get`
// antes de qualquer uma remover a entrada, porque a remoção só
// acontecia DEPOIS do `await consultarPagamento(...)`. Esta trava em
// memória impede que uma segunda notificação para o MESMO paymentId
// seja processada enquanto a primeira ainda está em andamento.
const _processandoPagamento = new Set();

function registrarPagamento(paymentId, dados) {
  pagamentosAtivos.set(String(paymentId), dados);
}

function removerPagamento(paymentId) {
  pagamentosAtivos.delete(String(paymentId));
}

// ─────────────────────────────────────────────────────────────────────
// KAEL — OPENPIX (Parte 2, TAREFA 4): mesmo padrão do Map acima
// (pagamentosAtivos), só que indexado por correlationID da cobrança
// OpenPix. Guarda os dados do pedido (guildId, clienteId, canalId...)
// para o webhook conseguir chamar entregarAutomatico quando a OpenPix
// confirmar o pagamento — nunca antes disso.
// ─────────────────────────────────────────────────────────────────────
const pagamentosOpenPixAtivos = new Map();
const _processandoOpenPix = new Set(); // idempotência de webhook duplicado (mesmo padrão do MP abaixo)

function registrarPagamentoOpenPix(correlationID, dados) {
  pagamentosOpenPixAtivos.set(String(correlationID), dados);
}

function removerPagamentoOpenPix(correlationID) {
  pagamentosOpenPixAtivos.delete(String(correlationID));
}

/**
 * TAREFA 4 — valida a assinatura HMAC-SHA1 do webhook OpenPix.
 * Header 'X-OpenPix-Signature' = base64(HMAC-SHA1(rawBody, secretKey)).
 * Documentação: developers.openpix.com.br/docs/webhook/seguranca/webhook-hmac
 * O secret é o configurado NA CRIAÇÃO do webhook (plataforma ou API),
 * nunca inventado — vem de OPENPIX_WEBHOOK_SECRET.
 */
function validarAssinaturaOpenPix(rawBody, signatureHeader) {
  const secret = process.env.OPENPIX_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Webhook OpenPix] OPENPIX_WEBHOOK_SECRET não configurado — recusando webhook (nunca aceitar sem validar assinatura).');
    return false;
  }
  if (!signatureHeader) return false;
  const hmac = crypto.createHmac('sha1', secret).update(rawBody).digest('base64');
  // Comparação timing-safe.
  const bufA = Buffer.from(hmac);
  const bufB = Buffer.from(signatureHeader);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function processarWebhookOpenPix(rawBody, headers, client) {
  const assinaturaValida = validarAssinaturaOpenPix(rawBody, headers['x-openpix-signature']);
  if (!assinaturaValida) {
    console.warn('[Webhook OpenPix] Assinatura inválida/ausente — requisição recusada.');
    return; // resposta HTTP correta (200) já foi enviada pelo chamador; aqui só não processamos.
  }

  let data;
  try { data = JSON.parse(rawBody); } catch { return; }

  const charge = data.charge;
  if (!charge) return; // evento sem cobrança (ex.: transação isolada) — ignorado com segurança

  const correlationID = String(charge.correlationID || '');
  if (!correlationID) return;

  // Idempotência de webhook duplicado (o mesmo evento pode chegar mais de
  // uma vez — mesma proteção já usada no webhook do Mercado Pago acima).
  if (_processandoOpenPix.has(correlationID)) {
    console.warn(`[Webhook OpenPix] Notificação duplicada para ${correlationID} ignorada (já em processamento).`);
    return;
  }
  _processandoOpenPix.add(correlationID);

  try {
    const dados = pagamentosOpenPixAtivos.get(correlationID);
    if (!dados) return; // não é uma cobrança rastreada por este bot (ou já processada)

    const { mapStatus } = require('../payment-system/openpix/openpixManager');
    const status = mapStatus(charge.status);
    console.log(`[Webhook OpenPix] Cobrança ${correlationID} status: ${charge.status} → ${status}`);

    // TAREFA 4 — nunca aprovar por causa do próprio corpo do webhook sem
    // que o status normalizado seja 'approved'; e nunca por clique do
    // usuário/Discord informando pagamento.
    if (status !== 'approved') return;

    removerPagamentoOpenPix(correlationID);

    const { entregarAutomatico } = require('./salesManager');
    await entregarAutomatico({ client, ...dados, openpixCorrelationID: correlationID });
  } catch (e) {
    console.error('[Webhook OpenPix] Erro ao processar:', e.message);
  } finally {
    _processandoOpenPix.delete(correlationID);
  }
}

function iniciarWebhook(client) {
  const PORT = process.env.PORT || 3000;

  const server = http.createServer(async (req, res) => {
    // ── VERIFICAÇÃO WEB (GET /verify/*, POST /verify/api/complete) — mesmo
    // servidor/porta, sem abrir porta nova (mesmo padrão já usado pra OpenPix). ──
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/assets/')) {
      return require('../utils/assets').servirAsset(req, res);
    }

    if (req.url.startsWith('/verify')) {
      try {
        return await require('../verificacao-system/webVerify').handleRequest(req, res, client);
      } catch (e) {
        console.error('[VerificacaoWeb] Erro não tratado:', e.message);
        if (!res.headersSent) { res.writeHead(500); res.end('Erro interno.'); }
        return;
      }
    }

    if (req.method !== 'POST' || !req.url.startsWith('/webhook')) {
      res.writeHead(200);
      res.end('OK');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      // Resposta HTTP correta imediata (TAREFA 4) — a OpenPix e o Mercado
      // Pago não devem re-tentar por timeout enquanto processamos.
      res.writeHead(200);
      res.end('OK');

      // ── ROTA OPENPIX (Parte 2) — path dedicado no MESMO servidor/porta,
      // sem abrir uma porta nova (Task 8: não quebrar o que já existe). ──
      if (req.url.startsWith('/webhook/openpix')) {
        try {
          await processarWebhookOpenPix(body, req.headers, client);
        } catch (e) {
          console.error('[Webhook OpenPix] Erro:', e.message);
        }
        return;
      }

      try {
        const data = JSON.parse(body);
        console.log('[Webhook MP] Recebido:', JSON.stringify(data));
        if (data.type !== 'payment') return;

        const paymentId = String(data.data?.id || data.id);
        if (!paymentId) return;

        // CORREÇÃO (auditoria — Bug 2): se este paymentId já está sendo
        // processado por outra notificação concorrente, ignora esta e
        // deixa a primeira terminar sozinha.
        if (_processandoPagamento.has(paymentId)) {
          console.warn(`[Webhook MP] Notificação duplicada para o pagamento ${paymentId} ignorada (já em processamento).`);
          return;
        }
        _processandoPagamento.add(paymentId);

        try {
        // Busca o pedido rastreado ANTES de consultar o pagamento: é dele
        // que vem o guildId, necessário para saber qual Access Token do
        // Mercado Pago usar (cada servidor tem o seu). Se não houver
        // pedido rastreado, o pagamento não é de uma compra deste bot
        // (ou já foi processado por uma notificação anterior).
        const dados = pagamentosAtivos.get(paymentId);
        if (!dados) return;

        const { accessToken } = getConfigMercadoPago(dados.guildId);
        if (!accessToken) {
          console.error(`[Webhook MP] Access Token ausente/desabilitado no servidor ${dados.guildId} — não foi possível confirmar o pagamento ${paymentId}.`);
          return;
        }

        const pagamento = await consultarPagamento(paymentId, accessToken);
        console.log(`[Webhook MP] Payment ${paymentId} status: ${pagamento.status}`);
        if (pagamento.status !== 'approved') return;

        removerPagamento(paymentId);

        const { entregarAutomatico } = require('./salesManager');
        await entregarAutomatico({ client, ...dados });
        } finally {
          // CORREÇÃO (auditoria — Bug 2): libera a trava sempre, mesmo
          // em caso de erro/return antecipado, pra não bloquear futuras
          // notificações legítimas desse mesmo paymentId.
          _processandoPagamento.delete(paymentId);
        }
      } catch (e) {
        console.error('[Webhook MP] Erro:', e.message);
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[Webhook MP] Servidor rodando na porta ${PORT}`);
  });
}

module.exports = { iniciarWebhook, registrarPagamento, removerPagamento, registrarPagamentoOpenPix, removerPagamentoOpenPix };
