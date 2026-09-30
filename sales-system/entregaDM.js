/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — sales-system/entregaDM.js
 *
 *  Fluxo de acompanhamento do pedido por DM, 100% em MENSAGENS
 *  INDEPENDENTES (channel.send). Nenhuma etapa edita mensagem
 *  anterior — cada uma é enviada como uma mensagem nova, o que
 *  elimina o custo de buscar (fetch) e editar mensagens antigas na
 *  API do Discord a cada mudança de status (menos chamadas, menos
 *  lag, menos uso de CPU/memória no processo do bot).
 *
 *  Sequência:
 *    1. <:CadLock:1533221942256078968> Pedido solicitado   (enviada na criação do carrinho — sem mudanças aqui)
 *    2. <:positivo:1528401238197276702> Pedido aprovado     (nova mensagem, ao confirmar pagamento)
 *    3. 📦 Entrega realizada   (nova mensagem, com os itens + botões)
 *       └─ mensagem configurável da loja (se existir)
 *    4. ⭐ Pedido de feedback  (nova mensagem, 5 minutos depois)
 *
 *  Não decide estoque, não decide preço, não fala com Mercado
 *  Pago/EFI — só recebe os dados já prontos.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const db = require('../database/db');

const CORES = {
  solicitado: 0xFFD700,
  aprovado:   0x00FF7F,
  entregue:   0x5865F2,
};

const FEEDBACK_DELAY_MS = 5 * 60 * 1000;

// ── Utilitário comum: resolve o canal de DM do cliente e nunca lança
// erro pra quem chama (DM fechada = entrega segue, só sem essa etapa
// visível ao cliente). ──────────────────────────────────────────────
async function getDmChannel(client, clienteId) {
  const clienteUser = client.users.cache.get(clienteId) || await client.users.fetch(clienteId).catch(() => null);
  if (!clienteUser) return null;
  try {
    return await clienteUser.createDM();
  } catch {
    return null;
  }
}

// ── ETAPA 1 — Pedido solicitado (sem mudanças de comportamento) ───
async function enviarPedidoSolicitado({ client, clienteId, guild, icon, variante, precoFinalStr, pedidoId }) {
  const dmChannel = await getDmChannel(client, clienteId);
  if (!dmChannel) return null;

  const linhaProduto = `🛒 1x ${variante.nome} | ${precoFinalStr}`;
  const embed = new EmbedBuilder()
    .setColor(CORES.solicitado)
    .setTitle('<:pedidoSolicitado:1528401082777342044> Pedido solicitado')
    .setDescription('Seu pedido foi criado e está aguardando a confirmação do pagamento.')
    .addFields(
      { name: 'Detalhes', value: `\`${linhaProduto}\`` },
      { name: 'ID do Pedido', value: `\`${pedidoId}\`` },
    )
    .setFooter({ text: `${guild.name} | ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, iconURL: icon })
    .setTimestamp();

  try {
    const msg = await dmChannel.send({ embeds: [embed] });
    return { channelId: dmChannel.id, messageId: msg.id };
  } catch {
    return null;
  }
}

// ── ETAPA 2 — Pedido aprovado (MENSAGEM NOVA, nunca edita a etapa 1) ──
async function enviarPedidoAprovado({ client, clienteId, guild, icon, variante, precoFinalStr, pedidoId }) {
  const dmChannel = await getDmChannel(client, clienteId);
  if (!dmChannel) return false;

  const linhaProduto = `🛒 1x ${variante.nome} | ${precoFinalStr}`;
  const embed = new EmbedBuilder()
    .setColor(CORES.aprovado)
    .setTitle('<:pedidoEntregue:1528401023054385202> Pedido aprovado')
    .setDescription('Seu pagamento foi aprovado, e o processo de entrega já foi iniciado.')
    .addFields(
      { name: 'Detalhes', value: `\`${linhaProduto}\`` },
      { name: 'ID do Pedido', value: `\`${pedidoId}\`` },
    )
    .setFooter({ text: `${guild.name} | ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, iconURL: icon })
    .setTimestamp();

  try {
    await dmChannel.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

function montarBotoesEntrega({ guildId, produtoId, pedidoId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dm_copiar_entrega_${guildId}_${pedidoId}`).setLabel('Copiar produto entregue').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dm_avisar_estoque_${guildId}_${produtoId || ''}`).setLabel('Avisar atualizações de estoque').setEmoji({ name: 'sino', id: '1528840971096297482' })
.setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dm_comprar_novamente_${guildId}_${produtoId || ''}`).setLabel('Comprar novamente').setEmoji({ name: 'dólar', id: '1525538525964013749' })
.setStyle(ButtonStyle.Success),
  );
}

// ── ETAPA 3 — Entrega realizada (MENSAGEM NOVA) + mensagem da loja
// (opcional) + botão de ticket (opcional) + agenda o feedback ────────
async function enviarEntregaRealizada({ client, clienteId, guild, guildId, icon, variante, precoFinalStr, pedidoId, itensEntregues, produtoId, produto }) {
  const dmChannel = await getDmChannel(client, clienteId);
  if (!dmChannel) return false;

  const linhaProduto = `🛒 1x ${variante.nome} | ${precoFinalStr}`;
  const embed = new EmbedBuilder()
    .setColor(CORES.entregue)
    .setTitle('<:produtoEntregue:1528401373874487467> Entrega realizada')
    .setDescription('Seu pedido foi anexado a essa mensagem.')
    .addFields(
      { name: 'Detalhes', value: `\`${linhaProduto}\`` },
      { name: 'ID do Pedido', value: `\`${pedidoId}\`` },
    )
    .setFooter({ text: `${guild.name} | ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, iconURL: icon })
    .setTimestamp();

  if (itensEntregues?.length > 0) {
    embed.addFields({ name: 'SEU PRODUTO ABAIXO', value: itensEntregues.join('\n').slice(0, 1024) });
  }

  try {
    await dmChannel.send({ embeds: [embed], components: [montarBotoesEntrega({ guildId, produtoId, pedidoId })] });
  } catch {
    return false;
  }

  // ── Mensagem configurável da loja (opcional) ──────────────────────
  // Lida direto de `produto.mensagemPosVenda` (texto livre configurado
  // pela loja — ex.: instruções de troca de senha, agradecimento,
  // suporte). Se não existir, simplesmente não envia nada — sem criar
  // mensagem vazia ou placeholder.
  const mensagemLoja = produto?.mensagemPosVenda || null;
  if (mensagemLoja) {
    const rowTicket = [];
    // Botão de ticket só aparece se a loja já tiver um painel de
    // tickets publicado (lido direto do ticketConfig já existente no
    // banco — não cria nem altera nada do sistema de tickets).
    try {
      const ticketConfig = db.getGuild(guildId)?.ticketConfig || {};
      if (ticketConfig.painelCanalId) {
        rowTicket.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Ticket Suporte')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guildId}/${ticketConfig.painelCanalId}`)
        ));
      }
    } catch {}

    try {
      await dmChannel.send({ content: mensagemLoja, components: rowTicket });
    } catch {}
  }

  // ── Agenda a etapa 4 (feedback), 5 minutos depois — não bloqueia o
  // restante da entrega, roda em segundo plano. ─────────────────────
  setTimeout(() => {
    enviarPedidoFeedback({ client, clienteId, guildId, pedidoId }).catch(() => {});
  }, FEEDBACK_DELAY_MS);

  return true;
}

// ── ETAPA 4 — Pedido de feedback (MENSAGEM NOVA, 5 min depois) ─────
async function enviarPedidoFeedback({ client, clienteId, guildId, pedidoId }) {
  const dmChannel = await getDmChannel(client, clienteId);
  if (!dmChannel) return false;

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('⭐ O que achou da sua compra?')
    .setDescription('Sua avaliação ajuda muito a loja a melhorar. Como foi sua experiência?');

  const rowAvaliacao = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dm_feedback_ruim_${guildId}_${pedidoId}`).setLabel('Ruim').setEmoji('😞').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dm_feedback_mediano_${guildId}_${pedidoId}`).setLabel('Mediano').setEmoji('😐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dm_feedback_bom_${guildId}_${pedidoId}`).setLabel('Muito Bom').setEmoji('😍').setStyle(ButtonStyle.Success),
  );

  try {
    await dmChannel.send({ embeds: [embed], components: [rowAvaliacao] });
    return true;
  } catch {
    return false;
  }
}

// ── Handler dos botões da DM (feedback, avisar estoque, etc.) ──────
async function handleButtonDM(interaction) {
  const id = interaction.customId;

  if (id.startsWith('dm_feedback_')) {
    const resto = id.replace('dm_feedback_', '');
    const [nota, guildId, pedidoId] = resto.split('_');
    const mapaNota = { ruim: 1, mediano: 3, bom: 5 };
    const estrelas = mapaNota[nota] ?? 3;

    try {
      const feedbacks = db.getGuild(guildId)?.loja?.feedbacks || [];
      feedbacks.push({
        userId: interaction.user.id,
        estrelas,
        texto: '(avaliação rápida via DM)',
        pedidoId,
        dataISO: new Date().toISOString(),
      });
      db.updateGuild(guildId, 'loja.feedbacks', feedbacks);
    } catch (e) {
      console.error('[Feedback DM] Falha ao salvar avaliação:', e.message);
    }

    return interaction.reply({ content: '⭐ Obrigado pela sua avaliação!', flags: 64 }).catch(() => {});
  }

  if (id.startsWith('dm_copiar_entrega_')) {
    const resto = id.replace('dm_copiar_entrega_', '');
    const [guildId, pedidoId] = resto.split('_');
    const historico = db.getGuild(guildId)?.loja?.historicoCompras || [];
    const registro = [...historico].reverse().find(r => r.clienteId === interaction.user.id);
    if (!registro?.itensEntregues?.length) {
      return interaction.reply({ content: '📦 Não encontrei itens de estoque associados a este pedido.', flags: 64 }).catch(() => {});
    }
    return interaction.reply({ content: `\`\`\`\n${registro.itensEntregues.join('\n')}\n\`\`\``, flags: 64 }).catch(() => {});
  }

  if (id.startsWith('dm_avisar_estoque_')) {
    const resto = id.replace('dm_avisar_estoque_', '');
    const [guildId, produtoId] = resto.split('_');
    const avisoEstoque = require('./avisoEstoque');
    const registradoAgora = avisoEstoque.registrar(guildId, produtoId || null, interaction.user.id);
    return interaction.reply({
      content: registradoAgora
        ? '<:sino:1528840971096297482> Combinado! Vou te avisar por aqui assim que o estoque desse produto for reabastecido.'
        : '<:sino:1528840971096297482> Você já está na lista de aviso pra esse produto — só aguardar!',
      flags: 64,
    }).catch(() => {});
  }

  if (id.startsWith('dm_comprar_novamente_')) {
    return interaction.reply({ content: '💰 Volte ao servidor para comprar novamente pela vitrine publicada.', flags: 64 }).catch(() => {});
  }
}

module.exports = {
  enviarPedidoSolicitado,
  enviarPedidoAprovado,
  enviarEntregaRealizada,
  enviarPedidoFeedback,
  handleButtonDM,
};
