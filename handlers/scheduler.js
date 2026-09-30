/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Scheduler / Ações Automáticas
 *  Reescrita fiel do AcoesAutomaticas.py (NX7 VENDAS / Ease Pro)
 *
 *  3 sistemas configuráveis via painel:
 *   1. Repostagem  — reposicia a vitrine a cada X minutos
 *   2. Limpeza     — limpa mensagens de canais a cada X minutos
 *   3. Mensagens   — envia texto automático em canais a cada X minutos
 *
 *  Todos os sistemas são por servidor (guildId), configuráveis
 *  individualmente, e salvos em loja.acoesAuto no banco.
 *
 *  Chamado uma única vez no index.js: iniciarScheduler(client)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../database/db');

// ── Helpers do banco ─────────────────────────────────────────────

function getAcoes(guildId) {
  return db.getGuild(guildId).loja?.acoesAuto || {
    repostagem: { sistema: false, delay: 180 },
    limpeza:    { sistema: false, canais: [], delay: 60  },
    mensagens:  { sistema: false, canais: [], delay: 30, content: '' },
  };
}

// ── Controle de timers ativos por guild ──────────────────────────
// Map<guildId, Map<'repostagem'|'limpeza'|'mensagens', intervalId>>
const timers = new Map();

function getGuildTimers(guildId) {
  if (!timers.has(guildId)) timers.set(guildId, new Map());
  return timers.get(guildId);
}

function pararTimer(guildId, sistema) {
  const gt = getGuildTimers(guildId);
  if (gt.has(sistema)) {
    clearInterval(gt.get(sistema));
    gt.delete(sistema);
    console.log(`[Scheduler] ⏹ ${sistema} parado — guild ${guildId}`);
  }
}

function iniciarTimer(guildId, sistema, fn, delayMinutos) {
  pararTimer(guildId, sistema);
  const ms = (delayMinutos || 1) * 60 * 1000;
  const id  = setInterval(fn, ms);
  getGuildTimers(guildId).set(sistema, id);
  console.log(`[Scheduler] ▶ ${sistema} iniciado — guild ${guildId} — a cada ${delayMinutos} min`);
}

// ── 1. REPOSTAGEM ────────────────────────────────────────────────
// Equivalente ao AtivarDesativarSistemaAcoesAuto_repostagem do Python
// Apaga a embed antiga da vitrine e reenvia no mesmo canal

// CORREÇÃO: esta função usava o sistema de loja LEGADO
// (sales-system/salesManager.js + loja.variantes), que:
//   1) ainda carrega produtos de teste antigos que nunca foram limpos
//      (ex: "test", "zoiw"), reaparecendo a cada repostagem/backup;
//   2) gerava um menu ("loja_sel_plano"/"loja_comprar") cujo fluxo de
//      compra no salesManager está desatualizado e falha ("Esta
//      interação falhou") pois não reflete mais os produtos reais.
// Agora a repostagem usa os MESMOS builders da vitrine real
// (commands/produto.js → buildVitrineEmbed/buildVitrineComponentes),
// reaproveitando o botão "Comprar" (cliente_comprar_direto_<id>) que
// já funciona normalmente na vitrine publicada manualmente.
async function executarRepostagem(client, guildId) {
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const produtos = db.getProdutos(guildId);
    const publicados = produtos.filter(p => p.vitrineCanalId);
    if (publicados.length === 0) return; // nenhuma vitrine publicada ainda, nada a repostar

    const { buildVitrineEmbed, buildVitrineComponentes } = require('../commands/produto');

    for (const produto of publicados) {
      const canal = guild.channels.cache.get(produto.vitrineCanalId)
        || await guild.channels.fetch(produto.vitrineCanalId).catch(() => null);
      if (!canal) continue;

      // Apaga a mensagem antiga da vitrine deste produto (se existir e ainda estiver lá)
      if (produto.vitrineMsgId) {
        const msgAntiga = await canal.messages.fetch(produto.vitrineMsgId).catch(() => null);
        if (msgAntiga) await msgAntiga.delete().catch(() => {});
      }

      const embed      = buildVitrineEmbed(produto, guild);
      const componentes = buildVitrineComponentes(produto, produto.id);

      const msgNova = await canal.send({ embeds: [embed], components: componentes }).catch(() => null);
      if (msgNova) db.atualizarProduto(guildId, produto.id, 'vitrineMsgId', msgNova.id);
    }

    console.log(`[Scheduler] <:xpooo:1523791736948920433> Repostagem executada — guild ${guildId} (${publicados.length} produto(s))`);
  } catch (e) {
    console.error(`[Scheduler] Erro na repostagem (guild ${guildId}):`, e.message);
  }
}

// ── 2. LIMPEZA ───────────────────────────────────────────────────
// Equivalente ao AcessarLimpezaAcoesAuto do Python
// Limpa mensagens dos canais configurados

async function executarLimpeza(client, guildId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const acoes = getAcoes(guildId);
    const canais = acoes.limpeza?.canais || [];
    if (canais.length === 0) return;

    for (const canalId of canais) {
      const canal = guild.channels.cache.get(canalId)
        || await guild.channels.fetch(canalId).catch(() => null);
      if (!canal) continue;

      // Bulk delete: máximo 100 mensagens com até 14 dias
      const msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs || msgs.size === 0) continue;

      const deletaveis = msgs.filter(m => {
        const diff = Date.now() - m.createdTimestamp;
        return diff < 14 * 24 * 60 * 60 * 1000; // menos de 14 dias
      });

      if (deletaveis.size === 0) continue;
      if (deletaveis.size === 1) {
        await deletaveis.first().delete().catch(() => {});
      } else {
        await canal.bulkDelete(deletaveis, true).catch(() => {});
      }

      console.log(`[Scheduler] 🗑 Limpeza: ${deletaveis.size} msgs apagadas em #${canal.name} — guild ${guildId}`);
    }
  } catch (e) {
    console.error(`[Scheduler] Erro na limpeza (guild ${guildId}):`, e.message);
  }
}

// ── 3. MENSAGENS AUTOMÁTICAS ─────────────────────────────────────
// Equivalente ao AcessarMensagensAcoesAuto do Python
// Envia texto automático nos canais configurados

async function executarMensagens(client, guildId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const acoes  = getAcoes(guildId);
    const canais  = acoes.mensagens?.canais  || [];
    const content = acoes.mensagens?.content || '';
    if (canais.length === 0 || !content) return;

    for (const canalId of canais) {
      const canal = guild.channels.cache.get(canalId)
        || await guild.channels.fetch(canalId).catch(() => null);
      if (!canal) continue;

      await canal.send({ content }).catch(() => {});
      console.log(`[Scheduler] 💬 Mensagem automática enviada em #${canal.name} — guild ${guildId}`);
    }
  } catch (e) {
    console.error(`[Scheduler] Erro nas mensagens automáticas (guild ${guildId}):`, e.message);
  }
}

// ── LIGAR/DESLIGAR SISTEMA POR GUILD ─────────────────────────────
// Chamado pelo acoesAuto.js (painel) quando o admin clica Habilitar/Desabilitar

function aplicarSistema(client, guildId, sistema) {
  const acoes = getAcoes(guildId);
  const cfg   = acoes[sistema];
  if (!cfg) return;

  if (!cfg.sistema) {
    // Desligado — para o timer
    pararTimer(guildId, sistema);
    return;
  }

  // Ligado — inicia o timer com o delay configurado
  const delay = cfg.delay || (sistema === 'repostagem' ? 180 : 60);

  if (sistema === 'repostagem') {
    iniciarTimer(guildId, sistema, () => executarRepostagem(client, guildId), delay);
    // Executa imediatamente na primeira vez
    executarRepostagem(client, guildId);
  } else if (sistema === 'limpeza') {
    iniciarTimer(guildId, sistema, () => executarLimpeza(client, guildId), delay);
  } else if (sistema === 'mensagens') {
    iniciarTimer(guildId, sistema, () => executarMensagens(client, guildId), delay);
    executarMensagens(client, guildId);
  }
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────────
// Chamado uma vez no index.js depois que o bot estiver pronto

function iniciarScheduler(client) {
  console.log('[Scheduler] Iniciando sistemas automáticos...');

  // Para cada guild que o bot está, verifica se algum sistema está ativo
  const guilds = client.guilds.cache;
  guilds.forEach(guild => {
    const acoes = getAcoes(guild.id);
    ['repostagem', 'limpeza', 'mensagens'].forEach(sistema => {
      if (acoes[sistema]?.sistema) {
        aplicarSistema(client, guild.id, sistema);
      }
    });
  });

  console.log(`[Scheduler] <:positivo:1528401238197276702> Pronto — ${guilds.size} servidor(es) verificado(s).`);
}

// ─────────────────────────────────────────────────────────────────
module.exports = { iniciarScheduler, aplicarSistema, getAcoes };
