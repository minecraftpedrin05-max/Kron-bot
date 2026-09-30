/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL INTELLIGENCE — Alertas Automáticos (Parte 4)
 *
 *  Verifica periodicamente (a cada 30 min) cada servidor com alertas
 *  ativados e manda pro canal configurado (`canalRelatorioId`) só as
 *  situações novas — usa `loja.intelligence.alertasEnviados` (mapa
 *  chave -> data ISO do último envio) pra nunca repetir o mesmo alerta
 *  antes de 24h, mesmo que a condição continue verdadeira no próximo
 *  ciclo. Isso evita spam sem precisar de tabela nova no banco.
 *
 *  Toda a detecção vem de insightsEngine.detectarAlertas(guildId) —
 *  função pura, só leitura. Este arquivo só decide SE e QUANDO enviar.
 *
 *  Chamado uma única vez no index.js: iniciarAlertScheduler(client)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const sqliteDb = require('../database/sqliteDb');
const engine = require('./insightsEngine');
const { CORES } = require('../config/constants');

const INTERVALO_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RETENCAO_HISTORICO_MS = 7 * 24 * 60 * 60 * 1000;

function limparAntigos(alertasEnviados) {
  const limite = Date.now() - RETENCAO_HISTORICO_MS;
  const limpo = {};
  for (const [chave, dataISO] of Object.entries(alertasEnviados)) {
    if (new Date(dataISO).getTime() >= limite) limpo[chave] = dataISO;
  }
  return limpo;
}

async function processarGuild(client, guildId) {
  const guild = db.getGuild(guildId);
  const config = guild.loja?.intelligence;
  if (!config || !config.alertasAtivo || !config.canalRelatorioId) return;

  let alertas;
  try {
    alertas = engine.detectarAlertas(guildId);
  } catch (e) {
    console.error(`[Kael Intelligence][Alertas] Erro ao detectar alertas na guild ${guildId}:`, e.stack || e);
    return;
  }
  if (alertas.length === 0) return;

  const alertasEnviados = limparAntigos(config.alertasEnviados || {});
  const agora = Date.now();
  const paraEnviar = alertas.filter(a => {
    const ultimo = alertasEnviados[a.chave];
    return !ultimo || (agora - new Date(ultimo).getTime()) >= COOLDOWN_MS;
  });

  if (paraEnviar.length === 0) {
    db.updateGuild(guildId, 'loja.intelligence.alertasEnviados', alertasEnviados);
    return;
  }

  const canal = client.channels.cache.get(config.canalRelatorioId)
    || await client.channels.fetch(config.canalRelatorioId).catch(() => null);
  if (!canal) {
    console.error(`[Kael Intelligence][Alertas] Canal ${config.canalRelatorioId} não encontrado na guild ${guildId} — verifique se ainda existe e se o bot tem permissão.`);
    return;
  }

  const PESO = { '🔴 Alta': 0, '🟠 Média': 1, '🟡 Atenção': 2, '🟢 Baixa': 3 };
  paraEnviar.sort((a, b) => (PESO[a.prioridade] ?? 9) - (PESO[b.prioridade] ?? 9));

  const embed = new EmbedBuilder()
    .setColor(CORES.AVISO)
    .setTitle('🧠 Kael Intelligence — Alertas')
    .setDescription(paraEnviar.slice(0, 10).map(a => `${a.prioridade} **${a.titulo}**\n${a.texto}`).join('\n\n'))
    .setFooter({ text: 'Veja mais detalhes em /insights' })
    .setTimestamp();

  try {
    await canal.send({ embeds: [embed] });
  } catch (e) {
    console.error(`[Kael Intelligence][Alertas] Falha ao enviar alerta no canal ${config.canalRelatorioId} (guild ${guildId}):`, e.message);
    return;
  }

  for (const a of paraEnviar) alertasEnviados[a.chave] = new Date(agora).toISOString();
  db.updateGuild(guildId, 'loja.intelligence.alertasEnviados', alertasEnviados);
}

async function processarTodasGuilds(client) {
  let guildIds;
  try {
    guildIds = sqliteDb.todosGuildIds();
  } catch (e) {
    console.error('[Kael Intelligence][Alertas] Erro ao listar guilds:', e.message);
    return;
  }

  for (const guildId of guildIds) {
    try {
      await processarGuild(client, guildId);
    } catch (e) {
      console.error(`[Kael Intelligence][Alertas] Erro inesperado na guild ${guildId}:`, e.stack || e);
    }
  }
}

function iniciarAlertScheduler(client) {
  setInterval(() => processarTodasGuilds(client), INTERVALO_MS);
}

module.exports = { iniciarAlertScheduler };
