// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteFraud.js
//
// KAEL INVITE SYSTEM — camada inicial de proteção contra fraude (Parte 1).
//
// Apenas MARCA registros como suspeitos (`suspicious = true`). Nunca
// bane, expulsa ou toma qualquer ação destrutiva automaticamente — a
// decisão de como tratar usuários suspeitos fica para configuração
// futura (Parte 2).
// ═══════════════════════════════════════════════════════════════════════

const inviteDb = require('../database/inviteDb');

const CONTA_NOVA_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias
const JANELA_RAJADA_MS = 60 * 1000;            // entradas do mesmo convite em <60s
const LIMITE_RAJADA = 5;                        // 5+ entradas na janela = padrão suspeito

/**
 * Avalia uma entrada de membro e decide se deve ser marcada como
 * suspeita. Retorna { suspicious, reason }.
 */
function evaluateJoin({ guild, member, config, record }) {
  const reasons = [];

  // 1) Conta muito nova (indício comum de conta descartável/fraude)
  const accountAge = Date.now() - member.user.createdTimestamp;
  if (accountAge < CONTA_NOVA_MS) {
    reasons.push('conta_recente');
  }

  // 2) Entrada e saída extremamente rápidas em reentradas (join farming)
  if (record && record.rejoin_count >= 2) {
    reasons.push('reentradas_repetidas');
  }

  // 3) Rajada de entradas usando o mesmo convite em curto intervalo
  if (record?.invite_code) {
    const recentes = inviteDb.getHistory(guild.id, { limit: 100 })
      .filter(h => h.action === 'entrada' && h.invite_code === record.invite_code);
    const agora = Date.now();
    const naJanela = recentes.filter(h => agora - new Date(h.timestamp).getTime() <= JANELA_RAJADA_MS);
    if (naJanela.length >= LIMITE_RAJADA) {
      reasons.push('rajada_de_entradas');
    }
  }

  // 4) Convite sem inviter identificado mas com uses > 0 previamente (inconsistência)
  if (record && !record.inviter_id && record.invite_code) {
    reasons.push('convite_inconsistente');
  }

  if (!reasons.length) return { suspicious: false, reason: null };
  return { suspicious: true, reason: reasons.join(',') };
}

module.exports = { evaluateJoin };
