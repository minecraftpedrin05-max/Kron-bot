// ═══════════════════════════════════════════════════════════════════════
// EFI BANK — Integração oficial via API PIX v2 (segundo gateway de
// pagamento, alternativo ao Mercado Pago)
// ═══════════════════════════════════════════════════════════════════════
// Módulo novo e isolado, espelhando EXATAMENTE a mesma interface pública
// de sales-system/mercadoPago.js (criarPagamentoPix, consultarPagamento,
// getConfigX) — pra que commands/produto.js consiga trocar de gateway
// trocando só a chamada, sem duplicar lógica de checkout.
//
// ⚠️ IMPORTANTE: a API PIX da Efi exige autenticação mTLS (certificado
// .p12/.pfx cliente) em toda chamada — não é só um Bearer token como no
// Mercado Pago. Por isso este módulo usa o `https` nativo do Node com um
// https.Agent(pfx), em vez do `fetch` global usado no mercadoPago.js.
//
// Este código segue fielmente a documentação pública da API PIX da Efi
// (POST /oauth/token, PUT /v2/cob/:txid, GET /v2/loc/:id/qrcode,
// GET /v2/cob/:txid), mas — como não há como testar contra uma conta real
// da Efi neste ambiente — recomenda-se validar em SANDBOX antes de usar
// em produção (o toggle sandbox/produção já está pronto no `/efibank`).
// ═══════════════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOSTS = {
  producao: 'pix.api.efipay.com.br',
  sandbox: 'pix-h.api.efipay.com.br',
};

const PASTA_CERTS = path.join(__dirname, '..', 'certs');

/** Caminho onde o certificado .p12/.pfx de cada guild é salvo em disco. */
function caminhoCertificado(guildId) {
  return path.join(PASTA_CERTS, `efibank-${guildId}.p12`);
}

function montarAgente(certificadoPath, senhaCertificado) {
  if (!certificadoPath || !fs.existsSync(certificadoPath)) {
    throw new Error('Certificado do Efi Bank não encontrado. Envie o arquivo .p12 pelo comando /efibank.');
  }
  const pfx = fs.readFileSync(certificadoPath);
  return new https.Agent({ pfx, passphrase: senhaCertificado || '', keepAlive: true });
}

function requestJson({ hostname, path: reqPath, method, headers, body, agent }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path: reqPath, method, agent,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* resposta não-JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json?.mensagem || json?.error_description || json?.detail || `HTTP ${res.statusCode} (Efi Bank)`));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function obterAccessToken({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox }) {
  const agent = montarAgente(certificadoPath, senhaCertificado);
  const hostname = HOSTS[sandbox ? 'sandbox' : 'producao'];
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resposta = await requestJson({
    hostname, path: '/oauth/token', method: 'POST', agent,
    headers: { Authorization: `Basic ${basic}` },
    body: { grant_type: 'client_credentials' },
  });
  if (!resposta?.access_token) throw new Error('Efi Bank não retornou um access_token válido (verifique Client ID/Secret e o certificado).');
  return { accessToken: resposta.access_token, agent, hostname };
}

/**
 * Cria uma cobrança PIX via API oficial da Efi Bank.
 * @returns {Promise<{id: string, status: string, copiaECola: string, qrCodeBase64: string|null}>}
 */
async function criarPagamentoPix({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox, pixKey, valor, descricao, clienteId, guildId }) {
  if (!clientId || !clientSecret || !pixKey) {
    throw new Error('Efi Bank não está totalmente configurado (Client ID / Client Secret / Chave PIX).');
  }
  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) throw new Error('Valor inválido para gerar o pagamento PIX (Efi Bank).');

  const { accessToken, agent, hostname } = await obterAccessToken({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox });

  // txid: identificador único da cobrança, 26 a 35 caracteres alfanuméricos
  const txidBruto = `kron${guildId}${clienteId}${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '');
  const txid = txidBruto.slice(0, 35).padEnd(26, '0');

  const cobranca = await requestJson({
    hostname, path: `/v2/cob/${txid}`, method: 'PUT', agent,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      calendario: { expiracao: 3600 },
      valor: { original: valorNum.toFixed(2) },
      chave: pixKey,
      solicitacaoPagador: (descricao || 'Compra via Discord').slice(0, 140),
    },
  });

  const locId = cobranca?.loc?.id;
  if (!locId) throw new Error('Efi Bank não retornou o location ID da cobrança PIX.');

  const qr = await requestJson({
    hostname, path: `/v2/loc/${locId}/qrcode`, method: 'GET', agent,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    id: txid,
    status: cobranca.status || 'ATIVA',
    copiaECola: qr?.qrcode,
    qrCodeBase64: qr?.imagemQrcode ? qr.imagemQrcode.replace(/^data:image\/png;base64,/, '') : null,
  };
}

/**
 * Consulta o status atual de uma cobrança na Efi Bank.
 * Status já MAPEADO pro mesmo vocabulário usado no restante do sistema
 * (igual ao que mercadoPago.js retorna: 'approved' | 'pending' | 'cancelled').
 */
async function consultarPagamento(txid, cfg) {
  const { accessToken, agent, hostname } = await obterAccessToken(cfg);
  const cobranca = await requestJson({
    hostname, path: `/v2/cob/${txid}`, method: 'GET', agent,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const mapa = {
    CONCLUIDA: 'approved',
    ATIVA: 'pending',
    REMOVIDA_PELO_USUARIO_RECEBEDOR: 'cancelled',
    REMOVIDA_PELO_PSP: 'cancelled',
  };
  return { id: txid, status: mapa[cobranca?.status] || 'pending', status_detail: cobranca?.status };
}

/**
 * Único ponto de leitura da configuração do Efi Bank salva pelo /efibank.
 * Usado no checkout (produto.js) e no poller de confirmação.
 */
function getConfigEfiBank(guildId) {
  const db = require('../database/db');
  const efi = db.getGuild(guildId)?.loja?.efibank || null;
  const certificadoPath = caminhoCertificado(guildId);
  const habilitado = !!(efi && efi.habilitado && efi.clientId && efi.clientSecret && efi.pixKey && fs.existsSync(certificadoPath));
  return {
    habilitado,
    clientId: efi?.clientId || null,
    clientSecret: efi?.clientSecret || null,
    pixKey: efi?.pixKey || null,
    sandbox: !!efi?.sandbox,
    senhaCertificado: efi?.senhaCertificado || '',
    certificadoPath,
  };
}

// ── Confirmação automática por POLLING ──────────────────────────────────
// A Efi também suporta webhook, mas exige um endpoint HTTPS público com
// certificado válido cadastrado na própria API deles — infraestrutura
// fora do alcance deste código. Em vez disso, um poller local consulta
// periodicamente as cobranças pendentes (mesmo efeito prático do webhook
// do Mercado Pago, sem exigir configuração adicional de infraestrutura).
const pendentes = new Map(); // txid -> dados do pedido (mesmo shape do MP)

function registrarPendente(txid, dados) { pendentes.set(txid, dados); }
function removerPendente(txid) { pendentes.delete(txid); }

let pollerAtivo = false;
function iniciarPollerEfiBank(client) {
  if (pollerAtivo) return;
  pollerAtivo = true;
  console.log('[Efi Bank] Poller de confirmação de pagamentos iniciado (a cada 15s).');
  setInterval(async () => {
    for (const [txid, dados] of pendentes.entries()) {
      try {
        const cfg = getConfigEfiBank(dados.guildId);
        if (!cfg.habilitado) continue;
        const pagamento = await consultarPagamento(txid, cfg);
        if (pagamento.status === 'approved') {
          removerPendente(txid);
          const { entregarAutomatico } = require('./salesManager');
          await entregarAutomatico({ client, ...dados });
        } else if (pagamento.status === 'cancelled') {
          removerPendente(txid);
        }
      } catch (e) {
        console.error(`[Efi Bank] Erro ao consultar txid ${txid}:`, e.message);
      }
    }
  }, 15000);
}

module.exports = {
  criarPagamentoPix, consultarPagamento, getConfigEfiBank, caminhoCertificado,
  registrarPendente, removerPendente, iniciarPollerEfiBank,
};
