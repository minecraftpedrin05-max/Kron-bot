const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cargo-id')
    .setDescription('Mostra o ID de um cargo do servidor (só você vê a resposta)')
    .addRoleOption(o => o
      .setName('cargo')
      .setDescription('O cargo que você quer ver o ID')
      .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const cargo = interaction.options.getRole('cargo');

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(cargo.color || 0x2B2D31)
          .setTitle('<:positivo:1528401238197276702> ID do Cargo')
          .setDescription(
            `**Cargo:** ${cargo}\n` +
            `**ID:** \`${cargo.id}\`\n\n` +
            `-# Toque e segure o ID acima pra copiar.`
          ),
      ],
      flags: 64,
    });
  },
};
