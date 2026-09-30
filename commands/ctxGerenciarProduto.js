// Context Menu Command (clique direito numa MENSAGEM) — "<:tools1:1533222180408791080> Gerenciar Produto"
//
// Localiza qual produto tem essa mensagem como vitrine publicada
// (produto.vitrineMsgId, já gravado por commands/produto.js ao publicar)
// e abre o mesmo painel de gestão que `/produto criar` mostraria — sem
// precisar navegar pelo seletor de produtos quando há mais de um.
const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const produtoHandler = require('./produto');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('🛠️ Gerenciar Produto')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const produtos = db.getProdutos(interaction.guildId);
    const produto = produtos.find(p => p.vitrineMsgId === interaction.targetMessage.id);

    if (!produto) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('<:negativo:1528400986744295475> Não é uma vitrine de produto')
          .setDescription('> Esta mensagem não corresponde a nenhum produto publicado pela KAEL.')],
        flags: 64,
      });
    }

    // Alinha o "produto ativo" ao produto clicado, pra que os botões do
    // painel (editar, estoque, variantes...) atuem no produto certo.
    db.setProdutoAtivoId(interaction.guildId, produto.id);

    const embed = produtoHandler.buildPainelEmbed(interaction.guildId, interaction.guild, produto.id);
    const components = produtoHandler.buildPainelComponents(produto.id);
    return interaction.reply({ embeds: [embed], components, flags: 64 });
  }
};
