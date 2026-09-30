/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /limpar
 *  Apaga uma quantidade de mensagens do canal atual (bulk delete).
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const COR = { success: 0x00FF7F, danger: 0xFF4444 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('limpar')
    .setDescription('Apaga uma quantidade de mensagens deste canal')
    .addIntegerOption(opt =>
      opt.setName('quantidade')
        .setDescription('Quantidade de mensagens a apagar (1 a 100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Apagar só mensagens deste usuário (opcional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    if(!require("../utils/helpers").temPlanoMinimo(interaction.guild?.id, "BASICO")) { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Adquira o plano Básico para usar este comando.")], ephemeral:true }); return; }
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Use este comando dentro de um servidor.')],
        flags: 64
      });
    }

    const quantidade = interaction.options.getInteger('quantidade');
    const usuario = interaction.options.getUser('usuario');
    const canal = interaction.channel;

    await interaction.deferReply({ flags: 64 });

    try {
      // Discord só permite bulkDelete em mensagens com até 14 dias.
      const buscadas = await canal.messages.fetch({ limit: 100 });
      let alvo = Array.from(buscadas.values());

      if (usuario) {
        alvo = alvo.filter(m => m.author.id === usuario.id);
      }

      alvo = alvo.slice(0, quantidade);

      if (alvo.length === 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Nenhuma mensagem encontrada para apagar.')
            .setDescription(usuario ? `> Não há mensagens recentes de ${usuario} neste canal (ou têm mais de 14 dias).` : '> Não há mensagens recentes neste canal (ou têm mais de 14 dias).')]
        });
      }

      const deletadas = await canal.bulkDelete(alvo, true);

      const embed = new EmbedBuilder()
        .setColor(COR.success)
        .setDescription(
          `🧹 ${deletadas.size} mensagem${deletadas.size === 1 ? '' : 's'} apagada${deletadas.size === 1 ? '' : 's'}${usuario ? ` de ${usuario}` : ''}!\n` +
          `<:user:1532137085081878558> Ação realizada por ${interaction.user}`
        );

      const resposta = await interaction.editReply({ embeds: [embed] });
      // Some sozinha depois de alguns segundos pra não poluir o canal.
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return resposta;
    } catch (e) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível apagar as mensagens.')
          .setDescription(`> Detalhe: ${e.message}\n> Mensagens com mais de 14 dias não podem ser apagadas em massa pelo Discord.`)]
      });
    }
  },
};
