// ============================================================
//  commands/carteira.js — /carteira (KAEL)
//  Migrado da source antiga (carteira funcional) e adaptado à
//  arquitetura atual: mesmo banco (database/carteiraDB.js),
//  mesmo padrão de licença/permissão dos demais comandos
//  financeiros (c6bank.js, efibank.js) e emojis do projeto atual.
// ============================================================

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { lerCarteira } = require('../database/carteiraDB');
const { formatarReal, formatarData, embedErro } = require('../utils/carteiraUtils');
const { checkLicense } = require('../utils/helpers');
const CORES = require('../config/constants').CORES;

function buildEmbedCarteira(interaction, carteira) {
  return new EmbedBuilder()
    .setColor(CORES.PIX)
    .setTitle('<:money:1532503308961448096> Carteira da Loja')
    .setDescription('━━━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: '💰 Saldo Disponível', value: carteira ? formatarReal(carteira.saldo)      : 'R$ 0,00', inline: false },
      { name: '<:carrinho:1524207445600370719> Total de Vendas', value: carteira ? String(carteira.totalVendas) : '0', inline: true },
      { name: '📈 Total Recebido',   value: carteira ? formatarReal(carteira.faturamento) : 'R$ 0,00', inline: true },
      { name: '💸 Total Sacado',     value: carteira ? formatarReal(carteira.totalSacado) : 'R$ 0,00', inline: false },
      { name: '<:relogio:1524207889441357917> Última Venda', value: carteira?.ultimaVenda ? formatarData(carteira.ultimaVenda) : 'Nenhuma ainda', inline: true },
      { name: 'Status', value: '🟢 Operacional', inline: true },
    )
    .setTimestamp()
    .setFooter({ text: interaction.guild.name });
}

function buildMenuCarteira() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('carteira_menu')
    .setPlaceholder('Selecione uma opção...')
    .addOptions([
      { label: 'Ver Saldo',            value: 'saldo',     emoji: '💰', description: 'Visualizar saldo atual' },
      { label: 'Histórico Financeiro', value: 'historico', emoji: '📜', description: 'Últimas movimentações' },
      { label: 'Últimas Vendas',       value: 'vendas',    emoji: '🛒', description: 'Vendas recentes' },
      { label: 'Solicitar Saque',      value: 'saque',     emoji: '💸', description: 'Retirar saldo disponível' },
      { label: 'Configurar PIX',       value: 'pix',       emoji: '🔑', description: 'Gerenciar chave PIX' },
    ]);
  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carteira')
    .setDescription('💳 Gerenciar a carteira financeira da loja')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  buildEmbedCarteira,
  buildMenuCarteira,

  async execute(interaction) {
    if (!checkLicense(interaction.guild?.id)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xE50000).setTitle('<:negativo:1528400986744295475> Sem Licença').setDescription('> Este servidor não possui uma licença ativa.')],
        ephemeral: true,
      });
    }

    const guildId  = interaction.guildId;
    const carteira = lerCarteira(guildId);

    await interaction.reply({
      embeds:   [buildEmbedCarteira(interaction, carteira)],
      components: [buildMenuCarteira()],
      ephemeral: true,
    });
  },
};
