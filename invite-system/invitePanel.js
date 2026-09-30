// ═══════════════════════════════════════════════════════════════════════
// invite-system/invitePanel.js
//
// KAEL INVITE SYSTEM — Parte 2: fonte única de verdade do painel público
// (embed + botões, já respeitando personalização) e do deploy/atualização
// automática (guarda channelId/messageId e edita a mensagem existente em
// vez de criar uma nova toda vez que a config muda).
// ═══════════════════════════════════════════════════════════════════════

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { buildCustomPanelEmbed } = require('./inviteEmbed');

const CUSTOM_IDS = {
  CONFIRMAR: 'invite_confirmar',
  COPIAR: 'invite_copiar',
  MEUS: 'invite_meus',
  RANKING: 'invite_ranking',
};

const BOTOES_PADRAO = {
  confirmar: { enabled: true, label: 'Confirmar', emoji: '✅', order: 1 },
  copiar: { enabled: true, label: 'Copiar Convite', emoji: '🔗', order: 2 },
  meus: { enabled: true, label: 'Meus Convites', emoji: '📊', order: 3 },
  ranking: { enabled: true, label: 'Ranking', emoji: '🏆', order: 4 },
};

function getButtonsConfig(guildId) {
  const config = inviteDb.getGuildConfig(guildId);
  const salvo = config.buttonsConfig || {};
  const combinado = {};
  for (const chave of Object.keys(BOTOES_PADRAO)) {
    combinado[chave] = { ...BOTOES_PADRAO[chave], ...(salvo[chave] || {}) };
  }
  return combinado;
}

const ESTILOS = {
  confirmar: ButtonStyle.Success,
  copiar: ButtonStyle.Primary,
  meus: ButtonStyle.Secondary,
  ranking: ButtonStyle.Secondary,
};

const IDS_POR_CHAVE = {
  confirmar: CUSTOM_IDS.CONFIRMAR,
  copiar: CUSTOM_IDS.COPIAR,
  meus: CUSTOM_IDS.MEUS,
  ranking: CUSTOM_IDS.RANKING,
};

/**
 * Monta a linha de botões do painel público, respeitando ativar/desativar,
 * nome, emoji e ordem configurados pelo administrador. Nunca gera uma
 * linha vazia (Discord rejeita); se tudo estiver desativado, mostra só o
 * Ranking como fallback para o painel nunca ficar sem ação nenhuma.
 */
function buildPanelRow(guildId) {
  const cfg = getButtonsConfig(guildId);
  let chaves = Object.keys(cfg).filter(k => cfg[k].enabled);
  if (!chaves.length) chaves = ['ranking'];
  chaves.sort((a, b) => (cfg[a].order ?? 99) - (cfg[b].order ?? 99));

  const row = new ActionRowBuilder();
  for (const chave of chaves) {
    const b = new ButtonBuilder()
      .setCustomId(IDS_POR_CHAVE[chave])
      .setLabel((cfg[chave].label || BOTOES_PADRAO[chave].label).slice(0, 80))
      .setStyle(ESTILOS[chave]);
    const emoji = cfg[chave].emoji || BOTOES_PADRAO[chave].emoji;
    if (emoji) b.setEmoji(emoji);
    row.addComponents(b);
  }
  return row;
}

function buildPanelEmbed(guild) {
  return buildCustomPanelEmbed(guild);
}

/**
 * Publica (ou, se já existir, ATUALIZA a mensagem existente) o painel
 * público no canal informado. Nunca cria uma segunda mensagem duplicada
 * quando já existe uma publicada — edita a mesma, como pedido na Parte 2.
 */
async function deployOrUpdatePanel(guild, channel) {
  const config = inviteDb.getGuildConfig(guild.id);
  const embed = buildPanelEmbed(guild);
  const row = buildPanelRow(guild.id);

  if (config.panelChannelId === channel.id && config.panelMessageId) {
    const existente = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (existente) {
      await existente.edit({ embeds: [embed], components: [row] });
      return { message: existente, created: false };
    }
  }

  const msg = await channel.send({ embeds: [embed], components: [row] });
  inviteDb.updateGuildConfig(guild.id, { panelChannelId: channel.id, panelMessageId: msg.id });
  return { message: msg, created: true };
}

/**
 * Atualiza o painel já publicado (se existir) refletindo mudanças de
 * configuração. Chamado depois de qualquer alteração feita no /invite
 * setup. Silenciosamente não faz nada se o painel nunca foi publicado
 * ou se o bot perdeu acesso ao canal/mensagem — nunca lança erro para
 * quem está mexendo no setup.
 */
async function refreshPanel(guild) {
  try {
    const config = inviteDb.getGuildConfig(guild.id);
    if (!config.panelChannelId || !config.panelMessageId) return false;
    const canal = await guild.channels.fetch(config.panelChannelId).catch(() => null);
    if (!canal || !canal.isTextBased?.()) return false;
    const msg = await canal.messages.fetch(config.panelMessageId).catch(() => null);
    if (!msg) return false;
    await msg.edit({ embeds: [buildPanelEmbed(guild)], components: [buildPanelRow(guild.id)] });
    return true;
  } catch (e) {
    console.error('[InviteSystem] Erro ao atualizar painel publico:', e.message);
    return false;
  }
}

module.exports = {
  CUSTOM_IDS, BOTOES_PADRAO, getButtonsConfig,
  buildPanelRow, buildPanelEmbed, deployOrUpdatePanel, refreshPanel,
};
