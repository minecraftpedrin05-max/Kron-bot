/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /ping
 *  Mostra a latência do bot: WebSocket (heartbeat com o Discord) e
 *  latência de resposta real (round-trip da própria interação).
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { CORES } = require('../config/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mostra a latência do bot'),

  async execute(interaction) {
    const antes = Date.now();
    await interaction.deferReply({ flags: 64 });
    const latenciaResposta = Date.now() - antes;
    const latenciaWs = interaction.client.ws.ping;

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(CORES.INFO)
        .setTitle('🏓 Pong!')
        .addFields(
          { name: '📡 WebSocket', value: `\`${latenciaWs}ms\``, inline: true },
          { name: '<:relogio:1524207889441357917> Resposta', value: `\`${latenciaResposta}ms\``, inline: true },
        )
        .setTimestamp()
      ],
    });
  },
};
