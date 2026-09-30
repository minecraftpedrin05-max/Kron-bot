/**
 * ─────────────────────────────────────────────────────────────────────
 *  KAEL — Expiração automática de carrinhos (10 minutos, FIXO)
 *
 *  Quando um carrinho chega na etapa de QR Code/Pagamento Pendente,
 *  sales-system/transacaoManager.js grava uma transação PENDING com
 *  `expira_em` = criação + 10 minutos (database/sqliteDb.js). Este
 *  módulo é responsável por:
 *
 *    1) Agendar um setTimeout em memória pra cada transação PENDING
 *       (agendarExpiracao), cancelado assim que ela é paga/cancelada/
 *       recusada (cancelarTimer).
 *    2) NÃO depender só desse setTimeout: no boot do bot
 *       (iniciarExpiracaoScheduler), relê TODAS as transações PENDING
 *       do banco e recalcula quanto tempo falta — se o bot ficou
 *       offline e o prazo já passou, expira na hora; se ainda falta
 *       tempo, reagenda o timer com o tempo restante (nunca reinicia
 *       os 10 minutos do zero).
 *    3) Um safety-net (setInterval) que varre periodicamente transações
 *       PENDING vencidas, cobrindo qualquer timer perdido (ex.: um
 *       crash sem restart limpo entre o agendamento e o disparo).
 *
 *  Os 10 minutos vêm de transacaoManager.DURACAO_EXPIRACAO_MS — não há
 *  (e não deve haver) nenhuma configuração de servidor ou botão de
 *  cliente que altere esse valor.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const transacaoManager = require('../sales-system/transacaoManager');

const COR_EXPIRADO = 0xFF8C00;
const SAFETY_NET_INTERVALO_MS = 60 * 1000; // varredura de segurança a cada 1 min

// canalId -> Timeout, só para não duplicar o agendamento em memória NESTE
// processo — a garantia real contra duplicidade é a transição atômica
// PENDING -> EXPIRED em transacaoManager.marcarExpirada.
const _timers = new Map();

let _clientRef = null;

function cancelarTimer(canalId) {
  const timer = _timers.get(canalId);
  if (timer) {
    clearTimeout(timer);
    _timers.delete(canalId);
  }
}

function agendarExpiracao(canalId, expiraEm, client) {
  cancelarTimer(canalId);
  const restanteMs = new Date(expiraEm).getTime() - Date.now();
  const timer = setTimeout(() => {
    processarExpiracao(client, canalId).catch((e) => {
      console.error('[Expiração] Erro inesperado ao processar expiração:', e.message);
    });
  }, Math.max(0, restanteMs));
  // Timeout não deve impedir o processo de encerrar (ex.: shutdown gracioso).
  if (typeof timer.unref === 'function') timer.unref();
  _timers.set(canalId, timer);
}

async function processarExpiracao(client, canalId) {
  _timers.delete(canalId);

  // Transição atômica PENDING -> EXPIRED. Se falhar, é porque o carrinho já
  // foi pago/cancelado/recusado antes do timer disparar — nada a fazer.
  const venceu = transacaoManager.marcarExpirada(canalId);
  if (!venceu) return;

  const transacao = transacaoManager.getPorCanal(canalId);
  if (!transacao) return;

  // ── Invalida qualquer pagamento pendente vinculado a esta transação ──
  try {
    if (transacao.mp_payment_id) require('../sales-system/webhook').removerPagamento(transacao.mp_payment_id);
  } catch (e) { /* módulo pode não estar carregado (webhook desligado) */ }
  try {
    if (transacao.efi_txid) {
      const efiBank = require('../sales-system/efiBank');
      if (typeof efiBank.removerPendente === 'function') efiBank.removerPendente(transacao.efi_txid);
    }
  } catch (e) {}
  try {
    if (transacao.c6_txid) {
      const c6Bank = require('../sales-system/c6Bank');
      if (typeof c6Bank.removerPendente === 'function') c6Bank.removerPendente(transacao.c6_txid);
    }
  } catch (e) {}

  const clienteFinal = client || _clientRef;
  if (!clienteFinal) {
    console.error(`[Expiração] Transação ${transacao.transacao_id} expirada, mas nenhum client do Discord disponível para notificar/fechar o canal.`);
    return;
  }

  try {
    const guild = await clienteFinal.guilds.fetch(transacao.guild_id).catch(() => null);
    if (!guild) return;

    const canal = await guild.channels.fetch(transacao.canal_id).catch(() => null);

    // ── Atualiza a mensagem do carrinho informando a expiração e trava novas ações ──
    if (canal) {
      const rowDesativada = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prod_var_expirado_done').setLabel('Pagamento Expirado').setEmoji('<:relogio:1524207889441357917>').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      await canal.send({
        embeds: [new EmbedBuilder()
          .setColor(COR_EXPIRADO)
          .setTitle('<:relogio:1524207889441357917> Pagamento Expirado')
          .setDescription('> O prazo de **10 minutos** para pagamento expirou.\n> Este carrinho foi encerrado automaticamente.\n> Caso ainda tenha interesse, inicie uma nova compra.')
          .setTimestamp()],
        components: [rowDesativada],
      }).catch(() => {});
    }

    // ── Registra o encerramento no canal de logs ──
    const { getCfg, resolverCanal } = require('../sales-system/salesManager');
    const cfg = getCfg(transacao.guild_id);
    if (cfg.canalLogsId) {
      const logs = await resolverCanal(guild, cfg.canalLogsId, 'Logs');
      logs?.send({
        embeds: [new EmbedBuilder()
          .setColor(COR_EXPIRADO)
          .setTitle('<:relogio:1524207889441357917> Carrinho Expirado')
          .setDescription(
            `<:user:1532137085081878558> **Cliente:** <@${transacao.cliente_id}>\n` +
            `<:canal:1524207214791884890> **Carrinho:** ${canal ? `#${canal.name}` : `\`${transacao.canal_id}\` (canal já não existe)`}\n` +
            `<:cupom:1524209015008002148> **Transação:** \`${transacao.transacao_id}\`\n` +
            `<:negativo:1528400986744295475> **Status:** Expirado (10 minutos sem pagamento)\n` +
            `<:relogio:1524207889441357917> **Horário:** <t:${Math.floor(Date.now() / 1000)}:F>`
          )
          .setTimestamp()],
      }).catch(() => {});
    }

    // ── Limpa estado em memória e fecha o canal ──
    try { require('../commands/produto').limparMetadadosPedido(transacao.canal_id); } catch (e) {}
    try { require('../sales-system/salesManager').limparPedido(transacao.canal_id); } catch (e) {}
    try { require('../database/db').atualizarStatusCarrinhoPorCanal(transacao.canal_id, 'expirado'); } catch (e) {}

    if (canal) setTimeout(() => canal.delete().catch(() => {}), 15000);
  } catch (e) {
    console.error(`[Expiração] Erro ao encerrar carrinho expirado (canal ${transacao.canal_id}):`, e.message);
  }
}

/**
 * Chamado sempre que um novo pagamento pendente é criado
 * (commands/produto.js → gerarCheckoutPix), pra agendar o timer de 10
 * minutos daquela transação específica.
 */
function registrarNovaExpiracao(canalId, expiraEm, client) {
  if (client) _clientRef = client;
  agendarExpiracao(canalId, expiraEm, client || _clientRef);
}

/**
 * Chamado uma única vez no index.js, quando o bot fica pronto. Relê todas
 * as transações PENDING do banco e recalcula o tempo restante de cada uma
 * — nunca reinicia os 10 minutos do zero após um restart/deploy.
 */
function iniciarExpiracaoScheduler(client) {
  _clientRef = client;

  const pendentes = transacaoManager.listarPendentes();
  let expiradasNaHora = 0;
  let reagendadas = 0;

  for (const t of pendentes) {
    const restanteMs = new Date(t.expira_em).getTime() - Date.now();
    if (restanteMs <= 0) {
      expiradasNaHora++;
      processarExpiracao(client, t.canal_id).catch((e) => console.error('[Expiração] Erro ao expirar carrinho pendente do boot:', e.message));
    } else {
      reagendadas++;
      agendarExpiracao(t.canal_id, t.expira_em, client);
    }
  }

  console.log(`[Expiração] Scheduler iniciado — ${pendentes.length} transação(ões) pendente(s) no banco (${expiradasNaHora} expirada(s) na hora, ${reagendadas} reagendada(s) com o tempo restante).`);

  // Safety-net: cobre timers perdidos (ex.: setTimeout perdido por algum
  // motivo) — nunca deveria disparar nada por si só, já que a transição
  // é sempre condicional a status = 'PENDING'.
  setInterval(() => {
    try {
      const pendentesAgora = transacaoManager.listarPendentes();
      const agoraMs = Date.now();
      for (const t of pendentesAgora) {
        if (new Date(t.expira_em).getTime() <= agoraMs && !_timers.has(t.canal_id)) {
          processarExpiracao(_clientRef, t.canal_id).catch((e) => console.error('[Expiração] Erro no safety-net:', e.message));
        }
      }
    } catch (e) {
      console.error('[Expiração] Erro no safety-net do scheduler:', e.message);
    }
  }, SAFETY_NET_INTERVALO_MS).unref();
}

module.exports = {
  iniciarExpiracaoScheduler,
  registrarNovaExpiracao,
  cancelarTimer,
};
