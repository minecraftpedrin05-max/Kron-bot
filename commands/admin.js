const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const mensagem = {
  data: new SlashCommandBuilder()
    .setName("mensagem")
    .setDescription("Envia mensagem no canal (admin)")
    .addStringOption(o => o.setName("texto").setDescription("A mensagem").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const _lic = require("../database/db").getLicense(interaction.guild?.id);
    if (_lic?.tipo === "FREE") { 
      await interaction.reply({ 
        embeds: [new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Este comando não está disponível no plano **FREE**.\n> Faça upgrade para **PRO** ou superior.")], 
        ephemeral: true 
      }); 
      return; 
    }
    await interaction.channel.send(interaction.options.getString("texto"));
    await interaction.reply({ content: "<:positivo:1528401238197276702> Mensagem enviada!", ephemeral: true });
  }
};

// Exportando estritamente o comando de mensagem
module.exports = [mensagem];
