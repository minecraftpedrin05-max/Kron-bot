/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL INTELLIGENCE — Recuperação de Carrinho (seção 5 do briefing)
 *
 *  Verifica periodicamente carrinhos abandonados (tabela carrinho_eventos,
 *  já preenchida pelos hooks em commands/produto.js e
 *  sales-system/salesManager.js) e envia UMA DM de recuperação, só se:
 *    - a guild tiver recuperacaoAtiva = true (loja.intelligence)
 *    - o carrinho estiver parado há mais que o minutosAbandono CONFIGURADO
 *      NAQUELA GUILD especificamente (cada servidor pode ter um valor
 *      diferente — configurável via /intelligence configuracoes)
 *    - o carrinho ainda não tiver sido notificado antes (campo `notificado`)
 *    - o status ainda for 'iniciado' ou 'pix_gerado' (nunca manda pra
 *      pedido já pago ou já cancelado — isso já vem filtrado do banco)
 *
 *  Falha de DM (usuário com DMs fechadas) NUNCA derruba nada — é só
 *  logada, e o carrinho é marcado como notificado mesmo assim, pra não
 *  ficar tentando pra sempre o mesmo cliente sem DM aberta.
 *
 *  Chamado uma única vez no index.js: iniciarCarrinhoScheduler(client)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../database/db');

const INTERVALO_MS = 5 * 60 * 1000; // verifica a cada 5 min — suficiente mesmo pro menor threshold configurável (5 min), sem sobrecarregar o banco
const MINUTOS_BASE_CONSULTA = 5; // busca candidatos usando o menor threshold possível; o filtro fino por guild acontece depois, em memória

async function processarRecuperacoes(client) {
  let candidatos;
  try {
    candidatos = db.listarCarrinhosParaNotificar(MINUTOS_BASE_CONSULTA);
  } catch (e) {
    console.error('[Kael Intelligence] Erro ao consultar carrinhos pendentes:', e.message);
    return;
  }
  if (!candidatos || candidatos.length === 0) return;

  for (const carrinho of candidatos) {
    try {
      const loja = db.getGuild(carrinho.guild_id).loja || {};
      const config = loja.intelligence;

      // Recuperação desativada nessa guild (ou nunca configurada) — pula
      // SEM marcar como notificado, porque o admin pode ativar depois e
      // ainda faz sentido recuperar esse carrinho quando isso acontecer.
      if (!config || !config.recuperacaoAtiva) continue;

      const minutosAbandono = config.minutosAbandono || 60;
      const minutosParado = (Date.now() - new Date(carrinho.atualizado_em).getTime()) / 60000;

      // Ainda não passou do tempo configurado POR ESSA GUILD especificamente
      // (guilds diferentes podem ter thresholds diferentes) — tenta de novo
      // no próximo ciclo, sem marcar notificado.
      if (minutosParado < minutosAbandono) continue;

      const mensagem = config.mensagemRecuperacao || '🛒 Você iniciou uma compra recentemente, mas ainda não finalizou seu pedido. Se ainda tiver interesse, volte à loja pra concluir!';

      try {
        const usuario = await client.users.fetch(carrinho.cliente_id);
        await usuario.send({ content: mensagem });
        console.log(`[Kael Intelligence] DM de recuperação enviada — guild ${carrinho.guild_id}, cliente ${carrinho.cliente_id}, carrinho #${carrinho.id}.`);
      } catch (e) {
        // Cliente com DM fechada, conta deletada, ou qualquer outro erro de
        // envio — não é uma falha do sistema, é esperado que aconteça às
        // vezes. Só loga e segue (o carrinho ainda é marcado como
        // notificado logo abaixo, pra não tentar de novo pro mesmo cliente).
        console.log(`[Kael Intelligence] Não foi possível enviar DM de recuperação (${e.message}) — guild ${carrinho.guild_id}, cliente ${carrinho.cliente_id}.`);
      }

      // Marca como notificado independente do resultado do envio — já
      // tentamos uma vez, não faz sentido tentar de novo pro mesmo carrinho
      // (evita spam e loop de tentativas pra clientes com DM fechada).
      db.marcarCarrinhoNotificado(carrinho.id);
    } catch (e) {
      console.error(`[Kael Intelligence] Erro ao processar recuperação do carrinho #${carrinho.id}:`, e.message);
      // Erro num carrinho não pode travar o processamento dos outros.
    }
  }
}

function iniciarCarrinhoScheduler(client) {
  console.log(`[Kael Intelligence] Scheduler de recuperação de carrinho ativo (verifica a cada ${INTERVALO_MS / 60000} min).`);
  setInterval(() => processarRecuperacoes(client), INTERVALO_MS);
}

module.exports = { iniciarCarrinhoScheduler };
