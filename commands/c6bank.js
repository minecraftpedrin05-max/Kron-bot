const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const c6BankManager = require('../c6-system/c6BankManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('c6bank')
    .setDescription('Configurar o C6 Bank como gateway de PIX (alternativo ao Mercado Pago e Efi Bank)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if(!require("../utils/helpers").checkLicense(interaction.guild?.id)){ await interaction.reply({embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Sem Licença").setDescription("> Este servidor não possui uma licença ativa.")],ephemeral:true}); return; }
    const _lic = require("../database/db").getLicense(interaction.guild?.id);
    if(_lic?.tipo === "FREE") { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Este comando não está disponível no plano **FREE**.\n> Faça upgrade para **PRO** ou superior.")], ephemeral:true }); return; }
    await c6BankManager.showPainel(interaction);
  }
};
