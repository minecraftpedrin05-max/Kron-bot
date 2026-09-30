/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /status
 *  Altera a presença REAL do bot no Discord (nome da atividade e o
 *  tipo: Jogando, Ouvindo, Assistindo, Transmitindo, Competindo).
 *  Isso é GLOBAL — afeta o bot em todos os servidores ao mesmo tempo,
 *  não é uma configuração por-servidor.
 *
 *  Restrito ao dono do bot (BOT_OWNER_ID em config/constants.js) —
 *  ninguém mais consegue ver nem usar este comando responder.
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const { BOT_OWNER_ID, CORES } = require('../config/constants');

const TIPOS_ATIVIDADE = {
  jogando: ActivityType.Playing,
  ouvindo: ActivityType.Listening,
  assistindo: ActivityType.Watching,
  transmitindo: ActivityType.Streaming,
  competindo: ActivityType.Competing,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Altera a presença do bot (apenas dono do bot)')
    .addStringOption(o =>
      o.setName('tipo')
        .setDescription('Tipo de atividade')
        .setRequired(true)
        .addChoices(
          { name: 'Jogando', value: 'jogando' },
          { name: 'Ouvindo', value: 'ouvindo' },
          { name: 'Assistindo', value: 'assistindo' },
          { name: 'Transmitindo', value: 'transmitindo' },
          { name: 'Competindo', value: 'competindo' },
        )
    )
    .addStringOption(o =>
      o.setName('texto')
        .setDescription('Texto da atividade (ex: KAEL)')
        .setRequired(true)
        .setMaxLength(128)
    )
    .addStringOption(o =>
      o.setName('presenca')
        .setDescription('Status de presença (padrão: Online)')
        .setRequired(false)
        .addChoices(
          { name: 'Online', value: 'online' },
          { name: 'Ausente', value: 'idle' },
          { name: 'Não Perturbe', value: 'dnd' },
          { name: 'Invisível', value: 'invisible' },
        )
    )
    .addStringOption(o =>
      o.setName('url')
        .setDescription('URL da stream (obrigatório só para tipo Transmitindo, ex: link da Twitch)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle('<:negativo:1528400986744295475> Sem Permissão').setDescription('Apenas o dono do bot pode usar este comando.')],
        flags: 64,
      });
    }

    const tipo = interaction.options.getString('tipo');
    const texto = interaction.options.getString('texto');
    const presenca = interaction.options.getString('presenca') || 'online';
    const url = interaction.options.getString('url');

    if (tipo === 'transmitindo' && !url) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle('<:negativo:1528400986744295475> URL obrigatória').setDescription('O tipo "Transmitindo" exige uma URL de stream (ex: `https://twitch.tv/seucanal`).')],
        flags: 64,
      });
    }

    const activity = { name: texto, type: TIPOS_ATIVIDADE[tipo] };
    if (tipo === 'transmitindo') activity.url = url;

    try {
      interaction.client.user.setPresence({
        status: presenca,
        activities: [activity],
      });
    } catch (e) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle('<:negativo:1528400986744295475> Erro ao alterar presença').setDescription(`\`${e.message}\``)],
        flags: 64,
      });
    }

    const labelTipo = { jogando: 'Jogando', ouvindo: 'Ouvindo', assistindo: 'Assistindo', transmitindo: 'Transmitindo', competindo: 'Competindo' }[tipo];

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(CORES.SUCESSO)
        .setTitle('<:positivo:1528401238197276702> Presença Atualizada')
        .setDescription(`> **${labelTipo}** ${texto}`)
        .addFields({ name: 'Status', value: `\`${presenca}\``, inline: true })
        .setFooter({ text: 'Esta alteração é global e afeta todos os servidores.' })
        .setTimestamp()
      ],
      flags: 64,
    });
  },
};
