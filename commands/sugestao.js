/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /sugestao
 *  Abre o formulário de nova sugestão (título, descrição, imagem
 *  opcional). Depois do envio, o próprio módulo pergunta em qual
 *  canal publicar. Lógica real em sugestoes-system/sugestoesManager.js.
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sugestao')
    .setDescription('Envie uma sugestão para o servidor'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ Use este comando dentro de um servidor.', flags: 64 });
    }
    return require('../sugestoes-system/sugestoesManager').abrirModalNovaSugestao(interaction);
  },
};
