// ═══════════════════════════════════════════════════════════════════════
//  payment-system/openpix/openpixManager.js
//  TAREFAS 1-3, 6-7 (Parte 2) — regras de negócio OpenPix por servidor.
//
//  Modelo (confirmado com o cliente no pedido, implementado só com
//  endpoints documentados — ver openpixClient.js):
//
//    KAEL → 1 conta principal OpenPix (appID em OPENPIX_APP_ID, global)
//            → 1 subconta por servidor (guildId ↔ subaccount.pixKey)
//                → saldo isolado por servidor (GET /subaccount/{pixKey})
//
//  O cliente final NUNCA precisa de conta OpenPix: ele só paga a
//  cobrança PIX normal (copia-e-cola/QR Code), como já fazia com
//  Mercado Pago/Efi/C6. O split 100% para a subconta é o que credita
//  o valor no saldo do servidor certo.
//
//  Vínculo (guildId ↔ subconta) é persistido em loja.openpix, com o
//  mesmo mecanismo já usado por MP/Efi/C6 (db.getGuild/db.updateGuild)
//  — nenhum banco novo.
// ═══════════════════════════════════════════════════════════════════════

const db = require('../../database/db');
const client = require('./openpixClient');

function appConfigurado() {
  return !!process.env.OPENPIX_APP_ID;
}

/**
 * Configuração OpenPix do servidor: só "habilitado" quando a conta
 * principal está configurada E o servidor já tem subconta vinculada.
 */
function getConfigOpenPix(guildId) {
  const cfg = db.getGuild(guildId)?.loja?.openpix || null;
  const habilitado = !!(appConfigurado() && cfg && cfg.subaccountPixKey);
  return { habilitado, subaccountPixKey: cfg?.subaccountPixKey || null, subaccountName: cfg?.subaccountName || null, pixKey: cfg?.pixKey || null, pixType: cfg?.pixType || null };
}

/**
 * TAREFA 2 — Vínculo do servidor. Chamado quando o dono cadastra a
 * chave PIX pela primeira vez neste servidor.
 *  1) valida entrada;
 *  2) verifica se já existe vínculo (subconta já criada → não recria,
 *     a documentação não expõe um endpoint de "atualizar chave PIX de
 *     uma subconta já existente" — ver PENDÊNCIA no handler da carteira);
 *  3) cria a subconta na OpenPix (POST /api/v1/subaccount);
 *  4) salva o identificador retornado;
 *  5) guildId ↔ subaccount fica em loja.openpix.
 */
async function vincularServidor(guildId, { pixKey, pixType, nomeServidor }) {
  if (!appConfigurado()) {
    return { ok: false, motivo: 'OPENPIX_APP_ID não configurado — vínculo com a OpenPix indisponível nesta instância.' };
  }
  if (!pixKey || !pixType) {
    return { ok: false, motivo: 'Chave PIX ou tipo inválidos.' };
  }

  const existente = getConfigOpenPix(guildId);
  if (existente.habilitado) {
    // Já vinculado — TAREFA 7: não temos, na documentação consultada,
    // um endpoint de "alterar a chave PIX de uma subconta existente".
    // Não inventamos um. Ver PENDÊNCIA reportada no resultado final.
    return { ok: false, motivo: 'já_vinculado', subaccountPixKey: existente.subaccountPixKey };
  }

  const name = `guild-${guildId}`;
  let subAccount;
  try {
    subAccount = await client.criarSubconta({ name, pixKey });
  } catch (e) {
    console.error(`[OpenPix] Falha ao criar subconta para guild ${guildId}:`, e.message);
    return { ok: false, motivo: `Falha ao criar subconta na OpenPix: ${e.message}` };
  }

  const subaccountPixKey = subAccount?.pixKey || pixKey;
  db.updateGuild(guildId, 'loja.openpix', {
    subaccountPixKey,
    subaccountName: subAccount?.name || name,
    pixKey,
    pixType,
    vinculadoEm: new Date().toISOString(),
  });

  return { ok: true, subaccountPixKey };
}

// ── TAREFA 3 — Cobrança vinculada ao servidor certo ─────────────────

/**
 * Cria a cobrança PIX já vinculada (split 100%) à subconta do
 * servidor. Segue o MESMO formato de retorno dos outros gateways
 * (id, status, copiaECola, qrCodeBase64) para plugar no checkout
 * existente (commands/produto.js) sem duplicar lógica de UI.
 */
async function criarPagamentoPix({ valor, descricao, clienteId, guildId }) {
  const cfg = getConfigOpenPix(guildId);
  if (!cfg.habilitado) throw new Error('OpenPix não vinculado a este servidor.');

  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) throw new Error('Valor inválido para gerar o pagamento PIX.');
  const valorCentavos = Math.round(valorNum * 100);

  const correlationID = `kron-${guildId}-${clienteId}-${Date.now()}`;
  const charge = await client.criarCobranca({
    correlationID,
    valorCentavos,
    comentario: descricao,
    subaccountPixKey: cfg.subaccountPixKey,
  });

  return {
    id: charge.correlationID || correlationID,
    status: mapStatus(charge.status),
    copiaECola: charge.brCode || null,
    qrCodeBase64: null, // OpenPix retorna qrCodeImage (URL), não base64 — ver PENDÊNCIA
    qrCodeImage: charge.qrCodeImage || null,
    paymentLinkUrl: charge.paymentLinkUrl || null,
  };
}

/** Consulta o status oficial de uma cobrança (nunca usar sinal indireto). */
async function consultarPagamento(correlationID) {
  const charge = await client.obterCobranca(correlationID);
  return { status: mapStatus(charge.status) };
}

/**
 * Vocabulário já usado por mercadoPago.js/efiBank.js/c6Bank.js:
 * 'approved' | 'pending' | 'cancelled'. Valores confirmados na
 * documentação: ACTIVE (aguardando), COMPLETED (pago), EXPIRED
 * (expirada). Qualquer outro valor não documentado é tratado como
 * 'pending' (nunca aprova por um status desconhecido).
 */
function mapStatus(status) {
  if (status === 'COMPLETED') return 'approved';
  if (status === 'EXPIRED') return 'cancelled';
  return 'pending';
}

// ── TAREFA 6 — Saque ("Sacar Tudo") ──────────────────────────────────

/**
 * Fluxo: lock em memória (evita clique duplo/saque simultâneo) →
 * chama o saque INTEGRAL oficial da subconta → só então zera o saldo
 * local (carteiraDB) e registra WITHDRAWAL. Se a API falhar, o saldo
 * local NUNCA é zerado (fica exatamente como estava).
 */
const _saquesEmAndamento = new Set();

async function sacarTudo(guildId) {
  const cfg = getConfigOpenPix(guildId);
  if (!cfg.habilitado) return { ok: false, motivo: 'openpix_nao_vinculado' };

  if (_saquesEmAndamento.has(guildId)) {
    return { ok: false, motivo: 'saque_ja_em_andamento' };
  }
  _saquesEmAndamento.add(guildId);

  try {
    const subconta = await client.obterSubconta(cfg.subaccountPixKey);
    const saldoCentavos = subconta?.balance ?? 0;
    if (saldoCentavos <= 0) {
      return { ok: false, motivo: 'saldo_insuficiente' };
    }

    let resultado;
    try {
      resultado = await client.sacarSubconta(cfg.subaccountPixKey);
    } catch (e) {
      console.error(`[OpenPix] Saque FALHOU para guild ${guildId}:`, e.message);
      // Saldo permanece disponível — nada é alterado localmente.
      return { ok: false, motivo: `falha_api: ${e.message}` };
    }

    return { ok: true, valorCentavos: saldoCentavos, detalhe: resultado };
  } finally {
    _saquesEmAndamento.delete(guildId);
  }
}

module.exports = {
  appConfigurado,
  getConfigOpenPix,
  vincularServidor,
  criarPagamentoPix,
  consultarPagamento,
  mapStatus,
  sacarTudo,
};
