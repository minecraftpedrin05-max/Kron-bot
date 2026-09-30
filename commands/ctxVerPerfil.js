// Context Menu Command (clique direito num USUÁRIO) — "<:rendimentos:1528401542070145135> Ver Perfil de Compras"
//
// Reaproveita 100% a agregação já feita por commands/ranking.js
// (getRankingCompradores) — nenhuma lógica de soma de histórico é
// duplicada aqui. Ephemeral (só quem clicou vê), gated a Administrator
// por padrão (mostra o gasto total de outra pessoa).
const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getRankingCompradores } = require('./ranking');
const { floatParaPreco } = require('../sales-system/salesManager');

const COR = { gold: 0xFFD700, danger: 0xFF4444 };

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Ver Perfil de Compras')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const alvo = interaction.targetUser;
    const ranking = getRankingCompradores(interaction.guildId);
    const idx = ranking.findIndex(r => r.clienteId === alvo.id);

    if (idx === -1) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:rendimentos:1528401542070145135> Perfil de Compras')
          .setDescription(`> <@${alvo.id}> ainda não fez nenhuma compra registrada neste servidor.`)],
        flags: 64,
      });
    }

    const dados = ranking[idx];
    const embed = new EmbedBuilder()
      .setColor(COR.gold)
      .setAuthor({ name: alvo.username, iconURL: alvo.displayAvatarURL({ dynamic: true }) })
      .setTitle('<:rendimentos:1528401542070145135> Perfil de Compras')
      .addFields(
        { name: '💰 Total Gasto', value: `\`${floatParaPreco(dados.totalGasto)}\``, inline: true },
        { name: '<:carrinho:1524207445600370719> Pedidos', value: `\`${dados.totalPedidos}\``, inline: true },
        { name: '<a:trofeu:1532499321008951538> Posição no Ranking', value: `\`#${idx + 1} de ${ranking.length}\``, inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
