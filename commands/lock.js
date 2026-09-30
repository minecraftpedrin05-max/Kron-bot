/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /lock
 *  Bloqueia o canal atual para um cargo específico (remove a
 *  permissão de enviar mensagens desse cargo neste canal).
 *  Segue o mesmo padrão visual dos outros comandos administrativos
 *  do bot: embed com <:positivo:1528401238197276702>, título curto e rodapé "Ação realizada por".
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const COR = { success: 0x00FF7F, danger: 0xFF4444 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Bloqueia o canal atual para um cargo')
    .addRoleOption(opt =>
      opt.setName('cargo')
        .setDescription('Cargo que será bloqueado neste canal')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    if(!require("../utils/helpers").temPlanoMinimo(interaction.guild?.id, "BASICO")) { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Adquira o plano Básico para usar este comando.")], ephemeral:true }); return; }
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Use este comando dentro de um servidor.')],
        flags: 64
      });
    }

    const cargo = interaction.options.getRole('cargo');
    const canal = interaction.channel;

    try {
      await canal.permissionOverwrites.edit(cargo.id, {
        SendMessages: false,
      });
    } catch (e) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível bloquear o canal.')
          .setDescription(`> Verifique se o bot tem permissão **Gerenciar Canais** aqui.\n> Detalhe: ${e.message}`)],
        flags: 64
      });
    }

    const embed = new EmbedBuilder()
      .setColor(COR.success)
      .setDescription(
        `<:CadLock:1533221942256078968> Canal bloqueado para ${cargo}!\n` +
        `<:user:1532137085081878558> Ação realizada por ${interaction.user}`
      );

    return interaction.reply({ embeds: [embed] });
  },
};
