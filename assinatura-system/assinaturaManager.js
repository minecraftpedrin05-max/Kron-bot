// ═══════════════════════════════════════════════════════════════════════
// assinaturaManager.js — Assinaturas Recorrentes (produtos com cargo por
// tempo determinado, ex.: VIP 30 dias). Módulo NOVO e independente.
// ═══════════════════════════════════════════════════════════════════════
//
// O cargo em si já é concedido no fluxo normal de entrega
// (sales-system/salesManager.js → entregarAutomatico), que também grava o
// registro de expiração via db.salvarAssinaturaAtiva. Este módulo só cuida
// da outra ponta: verificar periodicamente quais assinaturas venceram e
// remover o cargo do cliente.

const db = require('../database/db');

const INTERVALO_MS = 30 * 60 * 1000; // verifica a cada 30 minutos

async function verificarExpiracoes(client) {
  for (const guildId of client.guilds.cache.keys()) {
    let ativas;
    try { ativas = db.getAssinaturasAtivas(guildId); } catch { continue; }
    const vencidas = ativas.filter(a => new Date(a.expiraEm).getTime() <= Date.now());
    if (vencidas.length === 0) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    for (const assinatura of vencidas) {
      try {
        if (assinatura.cargoId) {
          const membro = await guild.members.fetch(assinatura.clienteId).catch(() => null);
          if (membro) await membro.roles.remove(assinatura.cargoId).catch(() => {});
        }
        db.removerAssinaturaAtiva(guildId, assinatura.id);
        console.log(`[Assinatura] Expirada e removida — cliente ${assinatura.clienteId}, guild ${guildId}, produto ${assinatura.produtoId}.`);
      } catch (e) {
        console.error(`[Assinatura] Erro ao expirar assinatura ${assinatura.id}:`, e.message);
      }
    }
  }
}

let intervaloAtivo = false;
function iniciarVerificacaoAssinaturas(client) {
  if (intervaloAtivo) return;
  intervaloAtivo = true;
  console.log('[Assinatura] Verificação de expiração iniciada (a cada 30 minutos).');
  setInterval(() => verificarExpiracoes(client), INTERVALO_MS);
  // Primeira checagem logo após iniciar, sem travar o boot.
  verificarExpiracoes(client).catch(e => console.error('[Assinatura] Erro na checagem inicial:', e.message));
}

module.exports = { verificarExpiracoes, iniciarVerificacaoAssinaturas };
