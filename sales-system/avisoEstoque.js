/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — sales-system/avisoEstoque.js
 *  Lista de clientes que pediram pra ser avisados quando um produto
 *  específico for reabastecido, e o disparo desse aviso por DM.
 * ─────────────────────────────────────────────────────────────────
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');

function registrar(guildId, produtoId, clienteId) {
  const loja = db.getGuild(guildId).loja || {};
  const avisos = loja.avisosEstoque || {};
  const chave = produtoId || '_semproduto';
  const lista = avisos[chave] || [];
  if (!lista.includes(clienteId)) {
    lista.push(clienteId);
    avisos[chave] = lista;
    db.updateGuild(guildId, 'loja.avisosEstoque', avisos);
    return true; // registrado agora
  }
  return false; // já estava na lista
}

/**
 * Chamado sempre que estoque é adicionado a um produto/variante.
 * Avisa todo mundo que pediu, por DM, e depois LIMPA a lista daquele
 * produto (aviso único — quem quiser de novo, clica de novo).
 */
async function notificarNovoEstoque(client, guildId, produtoId, tituloProduto) {
  const loja = db.getGuild(guildId).loja || {};
  const avisos = loja.avisosEstoque || {};
  const chave = produtoId || '_semproduto';
  const lista = avisos[chave] || [];
  if (lista.length === 0) return;

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const icon = guild?.iconURL?.({ extension: 'png', size: 256 }) || undefined;

  const embed = new EmbedBuilder()
    .setColor(0x00FF7F)
    .setTitle('<:sino:1528840971096297482> Estoque reabastecido!')
    .setDescription(`> **${tituloProduto || 'Um produto que você acompanhava'}** acabou de receber novo estoque.\n> Corre lá antes que acabe de novo!`)
    .setFooter(guild ? { text: guild.name, iconURL: icon } : undefined)
    .setTimestamp();

  for (const clienteId of lista) {
    try {
      const user = client.users.cache.get(clienteId) || await client.users.fetch(clienteId).catch(() => null);
      if (user) await user.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }

  delete avisos[chave];
  db.updateGuild(guildId, 'loja.avisosEstoque', avisos);
}

module.exports = { registrar, notificarNovoEstoque };
