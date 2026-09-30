const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');

const COR = { primary: 0xDC143C, gold: 0xFFD700, success: 0x00FF7F, danger: 0xFF4444 };
const MAX_EXIBIDOS = 10;

// Comando do cliente para visualizar compras anteriores — agora acessível
// só por prefixo (!minhascompras), não mais como slash command.
// O botão "<:embed:1528400492982571111> Ver Entrega" reaproveita o MESMO
// histórico (loja.historicoCompras) e a mesma checagem de propriedade
// (clienteId) já usada no botão Copiar Entrega da DM
// (sales-system/salesManager.js -> copiarEntrega), sem duplicar a lógica
// de segurança em dois lugares diferentes.
function getHistoricoDoUsuario(guildId, userId) {
  const historico = db.getGuild(guildId).loja?.historicoCompras || [];
  return historico.filter(r => r.clienteId === userId).sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));
}

// Chamado por events/messageHandler.js quando a mensagem é "!minhascompras".
// Recebe o Message do Discord (não uma Interaction).
async function enviarHistoricoCompras(message) {
  if (!message.guild) {
    return message.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Use este comando dentro de um servidor.')],
    });
  }

  const minhasCompras = getHistoricoDoUsuario(message.guild.id, message.author.id);

  if (minhasCompras.length === 0) {
    return message.reply({
      embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('🛍️ Minhas Compras')
        .setDescription('> Você ainda não realizou nenhuma compra neste servidor.')],
    });
  }

  const exibidos = minhasCompras.slice(0, MAX_EXIBIDOS);

  const embed = new EmbedBuilder()
    .setColor(COR.primary)
    .setAuthor({ name: `Histórico de ${message.author.username}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
    .setTitle('🛍️ Minhas Compras')
    .setDescription(
      exibidos.map((r) => {
        const dataFormatada = new Date(r.dataISO).toLocaleDateString('pt-BR');
        const emojiTxt = r.varianteEmoji ? `${r.varianteEmoji} ` : '';
        return `**Pedido #${r.id.split('-')[1]}**\n${emojiTxt}Produto: ${r.produtoNome}\nVariante: ${r.varianteNome}\nData: ${dataFormatada}`;
      }).join('\n\n')
    )
    .setFooter({ text: minhasCompras.length > MAX_EXIBIDOS ? `Mostrando ${MAX_EXIBIDOS} de ${minhasCompras.length} compras` : `${minhasCompras.length} compra(s) no total` })
    .setTimestamp();

  // Botões "Ver Entrega" — até 5 por linha, limite de 25 componentes por
  // mensagem do Discord. Com MAX_EXIBIDOS=10, cabem em 2 linhas de botões.
  const rows = [];
  for (let i = 0; i < exibidos.length; i += 5) {
    const lote = exibidos.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      lote.map((r) =>
        new ButtonBuilder()
          .setCustomId(`loja_copiar_entrega_${r.id}`)
          .setLabel(`Ver Entrega #${r.id.split('-')[1]}`.slice(0, 80))
          .setEmoji('<:embed:1528400492982571111>')
          .setStyle(ButtonStyle.Secondary)
      )
    ));
  }

  return message.reply({ embeds: [embed], components: rows });
}

module.exports = { enviarHistoricoCompras };
