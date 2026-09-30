// ═══════════════════════════════════════════════════════════════════════
// C6 BANK — Integração PIX (3º gateway de pagamento, alternativo ao
// Mercado Pago e ao Efi Bank)
// ═══════════════════════════════════════════════════════════════════════
// Módulo novo e isolado, espelhando a MESMA interface pública de
// sales-system/efiBank.js e sales-system/mercadoPago.js
// (criarPagamentoPix, consultarPagamento, getConfigX, poller de
// confirmação) — pra que commands/produto.js troque de gateway sem
// duplicar lógica de checkout.
//
// ⚠️⚠️⚠️ LEIA ANTES DE USAR EM PRODUÇÃO ⚠️⚠️⚠️
//
// O portal oficial do C6 (developers.c6bank.com.br) é uma SPA em
// JavaScript sem documentação pública legível. O acesso técnico real
// (endpoints, schemas oficiais) só é liberado depois de um cadastro
// como Software House/ERP junto ao C6, que envia Client ID, Client
// Secret e um CERTIFICADO DIGITAL diretamente para quem se cadastrar
// (confirmado por reclamação pública no Reclame Aqui e por um artigo
// da TecnoSpeed sobre integração C6 — não são documentos do próprio
// C6). Portanto os detalhes abaixo NÃO vêm de documentação oficial
// confirmada — vêm da melhor evidência de terceiros disponível
// publicamente. Cada ponto está marcado.
//
// CONFIRMADO (por mais de uma fonte independente):
//   • Autenticação exige mTLS (certificado cliente) + client_credentials
//     — igual ao Efi Bank, não é só Bearer token.
//   • O C6 exige credenciamento prévio como Software House/ERP; as
//     credenciais (Client ID/Secret + certificado) são emitidas pelo
//     próprio banco, não podem ser geradas por este código.
//
// PENDENTE / NECESSITA CONFIRMAÇÃO DO C6 (vindo de UM SDK de terceiros
// no GitHub, não da documentação oficial — trate como HIPÓTESE, não
// como fato, até testar contra o sandbox real do C6):
//   • POST /v1/auth/ (form: grant_type=client_credentials, client_id,
//     client_secret) — endpoint de token.
//   • PUT /v2/pix/cobv/{txid} — criação de cobrança. Só encontrei
//     evidência de "cobv" (cobrança COM VENCIMENTO, que exige dados
//     do devedor: CPF/CNPJ, nome, endereço completo) — NÃO encontrei
//     nenhuma evidência de "cob" (cobrança imediata simples, sem
//     dados do devedor, que é o que Mercado Pago e Efi Bank usam
//     neste projeto). Isso é uma diferença real de UX: o comprador
//     do Discord precisa informar CPF + nome + endereço antes de
//     gerar o PIX pelo C6 (ver c6-system/ e o modal de devedor em
//     commands/produto.js), o que NÃO acontece com os outros gateways.
//   • GET /v2/pix/cobv/{txid} — consulta de cobrança.
//   • GET /v2/pix/pix/{e2eid} — consulta de Pix recebido.
//   • PUT/GET/DELETE /v2/pix/webhook/{chave} — webhook, amarrado à
//     chave Pix. Formato do payload de notificação NÃO confirmado.
//     Por isso este módulo NÃO implementa webhook — só POLLING (igual
//     ao Efi Bank), que é mais seguro por não depender de invenção de
//     schema de payload.
//   • Hosts de sandbox/produção — não confirmados; usar variáveis de
//     ambiente (ver HOSTS abaixo) até confirmação oficial.
//
// NÃO HABILITE em produção sem antes validar CADA chamada abaixo
// manualmente contra o sandbox real do C6, com as credenciais reais
// emitidas pelo banco. Este módulo falha de forma segura (nunca marca
// pedido como pago sem uma confirmação explícita do C6) mas os
// detalhes de payload podem estar errados até essa validação.
// ═══════════════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');

// PENDENTE: hosts reais não confirmados pela documentação oficial.
// Configuráveis por variável de ambiente até confirmação; os valores
// abaixo são apenas um placeholder de mesmo formato usado por outros
// bancos (api.c6bank.com.br), NÃO confirmados.
const HOSTS = {
  producao: process.env.C6BANK_HOST_PRODUCAO || 'api.c6bank.com.br',
  sandbox: process.env.C6BANK_HOST_SANDBOX || 'api-sandbox.c6bank.com.br',
};

const PASTA_CERTS = path.join(__dirname, '..', 'certs');

/** Caminho onde o certificado (.pem/.p12) de cada guild é salvo em disco. */
function caminhoCertificado(guildId) {
  return path.join(PASTA_CERTS, `c6bank-${guildId}.pem`);
}

function montarAgente(certificadoPath, senhaCertificado) {
  if (!certificadoPath || !fs.existsSync(certificadoPath)) {
    throw new Error('Certificado do C6 Bank não encontrado. Envie o certificado pelo comando /c6bank.');
  }
  const pfx = fs.readFileSync(certificadoPath);
  return new https.Agent({ pfx, passphrase: senhaCertificado || '', keepAlive: true });
}

function requestJson({ hostname, path: reqPath, method, headers, body, agent, form }) {
  return new Promise((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : (body ? JSON.stringify(body) : null);
    const req = https.request({
      hostname, path: reqPath, method, agent,
      headers: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* resposta não-JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json?.mensagem || json?.error_description || json?.detail || `HTTP ${res.statusCode} (C6 Bank)`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout na chamada à API do C6 Bank.')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// PENDENTE: /v1/auth/ e o form grant_type/client_id/client_secret vêm
// de um SDK de terceiros, não da documentação oficial do C6.
async function obterAccessToken({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox }) {
  const agent = montarAgente(certificadoPath, senhaCertificado);
  const hostname = HOSTS[sandbox ? 'sandbox' : 'producao'];

  const resposta = await requestJson({
    hostname, path: '/v1/auth/', method: 'POST', agent,
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
  });
  if (!resposta?.access_token) throw new Error('C6 Bank não retornou um access_token válido (verifique Client ID/Secret e o certificado).');
  return { accessToken: resposta.access_token, agent, hostname };
}

/**
 * Cria uma cobrança PIX via API do C6 Bank.
 *
 * ⚠️ PENDENTE: usa "cobv" (cobrança COM VENCIMENTO) por ser o único tipo
 * com evidência encontrada — exige dados do devedor (CPF, nome,
 * endereço). Se o C6 realmente oferecer "cob" (cobrança imediata, sem
 * devedor, igual Efi/Mercado Pago), troque para esse endpoint assim que
 * confirmado oficialmente — reduz fricção pro comprador.
 *
 * @param {object} p
 * @param {object} p.devedor - { cpf ou cnpj, nome, logradouro, cidade, uf, cep } — OBRIGATÓRIO para cobv.
 * @returns {Promise<{id: string, status: string, copiaECola: string, qrCodeBase64: string|null}>}
 */
async function criarPagamentoPix({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox, chavePix, valor, descricao, clienteId, guildId, devedor }) {
  if (!clientId || !clientSecret || !chavePix) {
    throw new Error('C6 Bank não está totalmente configurado (Client ID / Client Secret / Chave PIX).');
  }
  if (!devedor || !devedor.nome || !(devedor.cpf || devedor.cnpj)) {
    // Falha segura: cobv (o único tipo confirmado) exige devedor. Sem
    // isso, NÃO inventamos dados — abortamos com erro claro.
    throw new Error('Dados do pagador (CPF/CNPJ e nome) são obrigatórios para gerar cobrança PIX pelo C6 Bank.');
  }
  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) throw new Error('Valor inválido para gerar o pagamento PIX (C6 Bank).');

  const { accessToken, agent, hostname } = await obterAccessToken({ clientId, clientSecret, certificadoPath, senhaCertificado, sandbox });

  // txid: identificador único da cobrança (igual ao padrão Bacen usado
  // pelos outros gateways deste projeto — 26 a 35 caracteres alfanuméricos).
  const txidBruto = `kronc6${guildId}${clienteId}${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '');
  const txid = txidBruto.slice(0, 35).padEnd(26, '0');

  // Vencimento em 1 dia (o mínimo prático pra uma cobrança "com
  // vencimento" funcionar como cobrança imediata de checkout).
  // PENDENTE: confirmar se o C6 aceita vencimento no mesmo dia.
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const devedorBody = devedor.cnpj
    ? { cnpj: devedor.cnpj, nome: devedor.nome }
    : { cpf: devedor.cpf, nome: devedor.nome };
  if (devedor.logradouro) devedorBody.logradouro = devedor.logradouro;
  if (devedor.cidade) devedorBody.cidade = devedor.cidade;
  if (devedor.uf) devedorBody.uf = devedor.uf;
  if (devedor.cep) devedorBody.cep = devedor.cep;

  const cobranca = await requestJson({
    hostname, path: `/v2/pix/cobv/${txid}`, method: 'PUT', agent,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      calendario: { dataDeVencimento: amanha, validadeAposVencimento: 1 },
      devedor: devedorBody,
      valor: { original: valorNum.toFixed(2) },
      chave: chavePix,
      solicitacaoPagador: (descricao || 'Compra via Discord').slice(0, 140),
    },
  });

  const localizacao = cobranca?.pixCopiaECola || cobranca?.brcode || null;
  if (!localizacao) throw new Error('C6 Bank não retornou o código PIX copia-e-cola da cobrança.');

  return {
    id: txid,
    status: cobranca.status || 'ATIVA',
    copiaECola: localizacao,
    // PENDENTE: não confirmei se o C6 retorna a imagem do QR Code pronta
    // (como Efi/MP) ou só o texto copia-e-cola. Se só vier o texto, o
    // QR é gerado localmente a partir dele — igual ao caminho já usado
    // em produto.js quando qrCodeBase64 vem nulo.
    qrCodeBase64: cobranca?.qrCode ? String(cobranca.qrCode).replace(/^data:image\/png;base64,/, '') : null,
  };
}

/**
 * Consulta o status atual de uma cobrança no C6 Bank.
 * Status já MAPEADO pro mesmo vocabulário usado no restante do sistema
 * ('approved' | 'pending' | 'cancelled') — igual a mercadoPago.js/efiBank.js.
 * PENDENTE: os valores de status abaixo (CONCLUIDA/ATIVA/...) seguem o
 * padrão Bacen usado por outros PSPs (inclusive Efi); não confirmei se
 * o C6 usa exatamente os mesmos nomes.
 */
async function consultarPagamento(txid, cfg) {
  const { accessToken, agent, hostname } = await obterAccessToken(cfg);
  const cobranca = await requestJson({
    hostname, path: `/v2/pix/cobv/${txid}`, method: 'GET', agent,
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
 * Único ponto de leitura da configuração do C6 Bank salva pelo /c6bank.
 * Usado no checkout (produto.js) e no poller de confirmação.
 * Isolado por guildId — nunca mistura credenciais/cobranças entre servidores.
 */
function getConfigC6Bank(guildId) {
  const db = require('../database/db');
  const c6 = db.getGuild(guildId)?.loja?.c6bank || null;
  const certificadoPath = caminhoCertificado(guildId);
  const habilitado = !!(c6 && c6.habilitado && c6.clientId && c6.clientSecret && c6.chavePix && fs.existsSync(certificadoPath));
  return {
    habilitado,
    clientId: c6?.clientId || null,
    clientSecret: c6?.clientSecret || null,
    chavePix: c6?.chavePix || null,
    sandbox: c6?.sandbox ?? true,
    senhaCertificado: c6?.senhaCertificado || '',
    certificadoPath,
  };
}

// ── Confirmação automática por POLLING (não webhook — ver aviso no
// topo do arquivo sobre o payload de webhook do C6 não estar
// confirmado). Mesmo padrão do Efi Bank: consulta periódica das
// cobranças pendentes, idempotente — cada txid só é processado uma
// vez, porque é removido do Map assim que aprovado ou cancelado. ──
const pendentes = new Map(); // txid -> dados do pedido (mesmo shape do MP/Efi)

function registrarPendente(txid, dados) { pendentes.set(txid, dados); }
function removerPendente(txid) { pendentes.delete(txid); }

let pollerAtivo = false;
function iniciarPollerC6Bank(client) {
  if (pollerAtivo) return;
  pollerAtivo = true;
  console.log('[C6 Bank] Poller de confirmação de pagamentos iniciado (a cada 15s).');
  setInterval(async () => {
    for (const [txid, dados] of pendentes.entries()) {
      try {
        const cfg = getConfigC6Bank(dados.guildId);
        if (!cfg.habilitado) continue;
        const pagamento = await consultarPagamento(txid, cfg);
        if (pagamento.status === 'approved') {
          // Falha segura: só entrega depois de uma consulta oficial de
          // status vinda do C6 — nunca por causa de comprovante ou
          // qualquer outro sinal. Remove do Map ANTES de entregar, pra
          // uma segunda leitura concorrente do poller não conseguir
          // processar o mesmo txid duas vezes (mesma proteção do Efi Bank).
          removerPendente(txid);
          const { entregarAutomatico } = require('./salesManager');
          await entregarAutomatico({ client, ...dados });
        } else if (pagamento.status === 'cancelled') {
          removerPendente(txid);
        }
      } catch (e) {
        console.error(`[C6 Bank] Erro ao consultar txid ${txid}:`, e.message);
      }
    }
  }, 15000);
}

module.exports = {
  criarPagamentoPix, consultarPagamento, getConfigC6Bank, caminhoCertificado,
  registrarPendente, removerPendente, iniciarPollerC6Bank,
};
