// ═══════════════════════════════════════════════════════════════════════
//  antifraude.js — Varredura Anti-Fraude de Reembolsos/Chargebacks
//  Módulo NOVO e independente.
// ═══════════════════════════════════════════════════════════════════════
//
//  Periodicamente, para cada servidor com Mercado Pago habilitado,
//  percorre as vendas recentes (loja.historicoCompras) que têm um
//  mpPaymentId registrado e consulta o status atual no Mercado Pago.
//  Se o status vier como reembolsado/estornado/cancelado, o comprador é
//  adicionado à BLACKLIST JÁ EXISTENTE do sistema de proteção
//  (protectionSystem.js) — nenhuma blacklist paralela é criada.
//
//  Não altera o fluxo de checkout/entrega existente: só LÊ o histórico
//  (sales-system/salesManager.js já grava mpPaymentId em cada venda) e
//  marca cada registro verificado, pra não reprocessar a mesma venda
//  toda hora. Depois que a venda sai da janela de checagem (30 dias),
//  ela deixa de ser consultada — economiza chamadas à API do MP.
// ═══════════════════════════════════════════════════════════════════════

const db = require('../database/db');
const { consultarPagamento, getConfigMercadoPago } = require('./mercadoPago');

const JANELA_DIAS   = 30;              // só verifica vendas dos últimos 30 dias
const INTERVALO_MS  = 60 * 60 * 1000;  // varredura a cada 1 hora
const DELAY_ENTRE_CONSULTAS_MS = 300;  // evita rajada de chamadas à API do MP

const STATUS_SUSPEITOS = ['refunded', 'charged_back', 'cancelled'];

let intervaloGlobal = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verificarGuild(client, guildId) {
  try {
    const { habilitado, accessToken } = getConfigMercadoPago(guildId);
    if (!habilitado || !accessToken) return;

    const historico = db.getGuild(guildId).loja?.historicoCompras || [];
    const limiteMs = Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000;
    const candidatos = historico.filter(r =>
      r.mpPaymentId && !r.reembolsoDetectado && new Date(r.dataISO).getTime() >= limiteMs
    );
    if (candidatos.length === 0) return;

    const { PDB } = require('../protectionSystem');
    const { enviarLog } = require('../utils/helpers');
    const guild = client.guilds.cache.get(guildId);

    let mudouAlgumRegistro = false;

    for (const registro of candidatos) {
      try {
        const pagamento = await consultarPagamento(registro.mpPaymentId, accessToken);

        if (STATUS_SUSPEITOS.includes(pagamento.status)) {
          registro.reembolsoDetectado = true;
          registro.statusDetectado = pagamento.status;
          mudouAlgumRegistro = true;

          const jaEstava = PDB.isBlacklisted(guildId, 'user', registro.clienteId);
          if (!jaEstava) {
            const motivo = `Reembolso/chargeback detectado automaticamente (pedido #${registro.numeroPedido ?? '?'}, pagamento ${registro.mpPaymentId}, status Mercado Pago: ${pagamento.status})`;
            PDB.addBlacklist(guildId, 'user', registro.clienteId, motivo, 'sistema-antifraude');
            PDB.registrarLog(guildId, {
              moduleKey: 'antifraude',
              targetId: registro.clienteId,
              action: 'auto-blacklist',
              result: `status Mercado Pago: ${pagamento.status}`,
              reason: motivo,
            });
            console.log(`[Anti-Fraude] 🚨 <${registro.clienteId}> adicionado à blacklist da guild ${guildId} — pagamento ${registro.mpPaymentId} (${pagamento.status})`);

            if (guild) {
              await enviarLog(guild, 0xED4245, '🚨 Anti-Fraude — Reembolso/Chargeback Detectado', [
                { name: '<:user:1532137085081878558> Cliente', value: `<@${registro.clienteId}>`, inline: true },
                { name: '🧾 Pedido', value: `#${registro.numeroPedido ?? '?'}`, inline: true },
                { name: '<:card:1533880211882381422> Status Mercado Pago', value: `\`${pagamento.status}\``, inline: true },
                { name: '💰 Valor', value: `\`${registro.valor}\``, inline: true },
                { name: '🆔 Payment ID', value: `\`${registro.mpPaymentId}\``, inline: true },
                { name: '⛔ Ação', value: 'Adicionado automaticamente à blacklist de proteção.', inline: false },
              ]);
            }
          }
        }
      } catch (e) {
        console.error(`[Anti-Fraude] Erro ao consultar pagamento ${registro.mpPaymentId} (guild ${guildId}):`, e.message);
      }
      await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }

    if (mudouAlgumRegistro) db.updateGuild(guildId, 'loja.historicoCompras', historico);
  } catch (e) {
    console.error(`[Anti-Fraude] Erro na varredura da guild ${guildId}:`, e.message);
  }
}

async function executarVarreduraCompleta(client) {
  for (const guildId of client.guilds.cache.keys()) {
    await verificarGuild(client, guildId);
  }
}

/** Chamado uma única vez no index.js, depois que o bot estiver pronto. */
function iniciarAntiFraude(client) {
  if (intervaloGlobal) clearInterval(intervaloGlobal);
  console.log('[Anti-Fraude] Sistema iniciado — varredura de reembolsos/chargebacks a cada 1h.');
  intervaloGlobal = setInterval(() => executarVarreduraCompleta(client), INTERVALO_MS);
  // Primeira varredura logo após iniciar (não trava o boot: roda em paralelo)
  executarVarreduraCompleta(client).catch(e => console.error('[Anti-Fraude] Erro na varredura inicial:', e.message));
}

module.exports = { iniciarAntiFraude, verificarGuild, executarVarreduraCompleta };
