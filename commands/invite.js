// ═══════════════════════════════════════════════════════════════════════
// commands/invite.js
//
// KAEL INVITE SYSTEM — comando /invite (Parte 1 + Parte 2).
//
// Subcomandos:
//   /invite painel  -> publica/atualiza o painel público no canal atual
//   /invite setup   -> abre o painel administrativo de configuração
//
// O embed/botões do painel público agora vêm de invite-system/invitePanel
// (respeitando toda a personalização feita em /invite setup). Os handlers
// de botão (Confirmar/Copiar/Meus/Ranking) mantêm exatamente o mesmo
// comportamento da Parte 1.
// ═══════════════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
} = require('discord.js');
const inviteDb = require('../database/inviteDb');
const { getNextReward } = require('../invite-system/inviteRewards');
const { CORES } = require('../config/constants');
const invitePanel = require('../invite-system/invitePanel');
const { CUSTOM_IDS } = invitePanel;

function isAdmin(interaction) {
  return !!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Kael Invite System')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('setup').setDescription('Abre o painel administrativo do Invite System (gerencia tudo)')),

  CUSTOM_IDS,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Esse comando só funciona dentro de um servidor.', ephemeral: true });
    }
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Você precisa ser Administrator para usar o Invite System.', ephemeral: true });
    }

    // Único fluxo: /invite só tem o subcomando setup, então sempre abre o painel administrativo
    const { buildMainMenuEmbed, buildMainMenuRow } = require('../invite-system/inviteSetupUI');
    return interaction.reply({ embeds: [buildMainMenuEmbed(interaction.guild)], components: buildMainMenuRow(), ephemeral: true });
  },

  // ── Botão: ✅ Confirmar ──
  async handleConfirmar(interaction) {
    const { guild, user } = interaction;
    const config = inviteDb.getGuildConfig(guild.id);
    const ok = inviteDb.confirmParticipation(guild.id, user.id, config.campaignId);
    if (!ok) {
      return interaction.reply({ content: 'ℹ️ Você já confirmou sua participação.', ephemeral: true });
    }
    inviteDb.logHistory({ guildId: guild.id, userId: user.id, action: 'confirmacao', campaignId: config.campaignId });
    return interaction.reply({ content: '✅ Participação confirmada com sucesso!', ephemeral: true });
  },

  // ── Botão: 🔗 Copiar Convite ──
  async handleCopiar(interaction) {
    const { guild, user } = interaction;
    await interaction.deferReply({ ephemeral: true });

    try {
      let invite = inviteDb.getUserInvite(guild.id, user.id);

      if (invite) {
        const stillExists = await guild.invites.fetch({ code: invite.invite_code }).catch(() => null);
        if (!stillExists) invite = null;
      }

      if (!invite) {
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
          return interaction.editReply('<:negativo:1528400986744295475> Não tenho permissão para criar convites neste servidor.');
        }
        const channel = guild.channels.cache.find(c => c.isTextBased?.() && c.viewable &&
          c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite));
        if (!channel) {
          return interaction.editReply('<:negativo:1528400986744295475> Não encontrei um canal onde eu possa criar convites.');
        }
        const created = await channel.createInvite({ maxAge: 0, unique: true, reason: `Convite individual — Kael Invite System (${user.id})` });
        inviteDb.upsertInvite(guild.id, created.code, user.id, 0, null);
        invite = inviteDb.getInvite(guild.id, created.code);
      }

      return interaction.editReply(`🔗 Seu convite pessoal: **https://discord.gg/${invite.invite_code}**`);
    } catch (e) {
      console.error('[InviteSystem] Erro ao copiar convite:', e);
      return interaction.editReply('<:negativo:1528400986744295475> Ocorreu um erro ao gerar seu convite.');
    }
  },

  // ── Botão: 📊 Meus Convites ──
  async handleMeus(interaction) {
    const { guild, user } = interaction;
    const config = inviteDb.getGuildConfig(guild.id);
    const stats = inviteDb.getInviterStats(guild.id, user.id, config);
    const { next, faltam } = getNextReward(guild, user.id);
    const posicao = inviteDb.getUserPosition(guild.id, user.id, config);
    const total = stats.validos > 0 ? stats.validos : 1;
    const proximo = next ? Math.min(100, Math.round((stats.validos / next.required_invites) * 100)) : 100;
    const barra = '█'.repeat(Math.round(proximo / 10)).padEnd(10, '░');

    const embed = new EmbedBuilder()
      .setColor(CORES.INFO)
      .setTitle(`📊 Meus Convites — ${user.username}`)
      .addFields(
        { name: '👥 Total', value: `\`${stats.total}\``, inline: true },
        { name: '✅ Válidos', value: `\`${stats.validos}\``, inline: true },
        { name: '🏆 Ranking', value: posicao ? `\`#${posicao}\`` : 'Sem posição', inline: true },
        { name: '👤 Atualmente no servidor', value: `\`${stats.atuais}\``, inline: true },
        { name: '🚪 Saíram', value: `\`${stats.sairam}\``, inline: true },
        { name: '⚠️ Suspeitos', value: `\`${stats.suspeitos}\``, inline: true },
        { name: '🎁 Próxima recompensa', value: next ? `**${next.name}** (faltam \`${faltam}\`)` : 'Nenhuma recompensa configurada ou tudo desbloqueado.', inline: false },
        { name: '📈 Progresso', value: next ? `\`${barra}\` ${stats.validos}/${next.required_invites}` : `\`${barra}\` 100%`, inline: false },
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  // ── Botão: 🏆 Ranking (com paginação) ──
  async handleRanking(interaction, pagina = 0) {
    const { guild } = interaction;
    const config = inviteDb.getGuildConfig(guild.id);
    const TAMANHO_PAGINA = 10;

    if (interaction.isButton() && interaction.customId?.startsWith('invite_ranking_page_')) {
      pagina = parseInt(interaction.customId.replace('invite_ranking_page_', ''), 10) || 0;
    }

    const completo = inviteDb.getRanking(guild.id, config, Number.MAX_SAFE_INTEGER);
    if (!completo.length) {
      const resposta = { content: 'ℹ️ Ainda não há convites registrados neste servidor.', ephemeral: true };
      if (interaction.isButton() && interaction.message?.interaction) return interaction.update({ content: resposta.content, embeds: [], components: [] });
      return interaction.reply(resposta);
    }

    const totalPaginas = Math.max(1, Math.ceil(completo.length / TAMANHO_PAGINA));
    pagina = Math.min(Math.max(0, pagina), totalPaginas - 1);
    const fatia = completo.slice(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA);

    const medalha = (p) => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `**#${p}**`;
    const linhas = fatia.map(e => `${medalha(e.position)} <@${e.userId}> — \`${e.count}\` convite(s)`);
    const posicaoUsuario = inviteDb.getUserPosition(guild.id, interaction.user.id, config);

    const embed = new EmbedBuilder()
      .setColor(CORES.INFO)
      .setTitle('🏆 Ranking de Convites')
      .setDescription(linhas.join('\n'))
      .setFooter({ text: `Página ${pagina + 1}/${totalPaginas} • ${posicaoUsuario ? `Sua posição: #${posicaoUsuario}` : 'Você ainda não está no ranking'}` })
      .setTimestamp();

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`invite_ranking_page_${pagina - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(pagina <= 0),
      new ButtonBuilder().setCustomId(`invite_ranking_page_${pagina + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPaginas - 1),
    );

    if (interaction.isButton() && interaction.customId?.startsWith('invite_ranking_page_')) {
      return interaction.update({ embeds: [embed], components: [row] });
    }
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
