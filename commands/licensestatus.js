const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { BOT_OWNER_ID, CORES } = require("../config/constants");
const db = require("../database/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("licensestatus")
    .setDescription("Lista todos os servidores com licença (owner only)"),

  async execute(interaction) {
    // BUGFIX (auditoria licenças): este comando é EXCLUSIVO do dono do bot
    // e lista o status de TODOS os servidores — não faz sentido nenhum ele
    // exigir que o SERVIDOR ONDE FOI EXECUTADO tenha uma licença PRO+
    // (isso era um trecho de gate copiado de comandos comuns por engano).
    // Na prática isso deixava o dono do bot incapaz de rodar /licensestatus
    // em qualquer servidor sem licença paga ativa — inclusive o próprio
    // servidor de suporte do bot. Removido: só a checagem de dono abaixo importa.
    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(CORES.ERRO)
          .setTitle("<:negativo:1528400986744295475> Sem Permissão")
          .setDescription("Apenas o **dono do bot** pode usar este comando.")
        ],
        ephemeral: true
      });
      return;
    }

    const client = interaction.client;
    const guilds = client.guilds.cache;

    const comLicenca    = [];
    const semLicenca    = [];

    for (const [id, guild] of guilds) {
      if (db.hasLicense(id)) {
        comLicenca.push(`<:positivo:1528401238197276702> **${guild.name}**\n└ \`${id}\``);
      } else {
        semLicenca.push(`<:negativo:1528400986744295475> **${guild.name}**\n└ \`${id}\``);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xE50000)
      .setTitle("<:dev:1525538335139958915> Status das Licenças")
      .addFields(
        {
          name: `<:positivo:1528401238197276702> Com Licença (${comLicenca.length})`,
          value: comLicenca.length > 0 ? comLicenca.join("\n\n") : "Nenhum servidor.",
          inline: false
        },
        {
          name: `<:negativo:1528400986744295475> Sem Licença (${semLicenca.length})`,
          value: semLicenca.length > 0 ? semLicenca.join("\n\n") : "Nenhum servidor.",
          inline: false
        }
      )
      .setFooter({ text: `Total: ${guilds.size} servidores` })
      .setTimestamp();

    if (interaction.client.user.displayAvatarURL())
      embed.setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
