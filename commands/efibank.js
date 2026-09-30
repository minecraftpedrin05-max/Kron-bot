const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const efiBankManager = require('../efi-system/efiBankManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('efibank')
    .setDescription('Configurar o Efi Bank como gateway de PIX (alternativo ao Mercado Pago)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if(!require("../utils/helpers").checkLicense(interaction.guild?.id)){ await interaction.reply({embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Sem Licença").setDescription("> Este servidor não possui uma licença ativa.")],ephemeral:true}); return; }
    const _lic = require("../database/db").getLicense(interaction.guild?.id);
    if(_lic?.tipo === "FREE") { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Este comando não está disponível no plano **FREE**.\n> Faça upgrade para **PRO** ou superior.")], ephemeral:true }); return; }
    await efiBankManager.showPainel(interaction);
  }
};
