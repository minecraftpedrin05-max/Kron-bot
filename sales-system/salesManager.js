const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder, PermissionFlagsBits, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const db = require('../database/db');
const { gerarComprovante } = require('./gerarComprovante');
const QRCode = require('qrcode');
const { registrarPagamento } = require('./webhook');

const COR = { primary: 0xDC143C, gold: 0xFFD700, success: 0x00FF7F, danger: 0xFF4444, warn: 0xFF8C00 };
const CANAL_ENTREGAS = null;

// pedidosAtivos[channelId] = { varianteKey, quantidade, cupom: { codigo, desconto, precoOriginal, precoFinal } | null }
const pedidosAtivos = {};

// Trava em memória contra clique duplo no botão de comprar (ver mesma
// explicação em commands/produto.js).
const criandoCanalCompraLoja = new Set();

// ─────────────────────────────────────────────────────────────────────
// CORREÇÃO (auditoria — Bug 1: entrega/estoque duplicados por corrida
// de concorrência): trava em memória por "entrega". Garante que, para
// a MESMA compra, apenas UMA execução de `entregarAutomatico` decremente
// estoque/entregue item por vez — mesmo se chamada duas vezes quase
// simultaneamente (webhook duplicado do Mercado Pago, botão "Confirmar
// Pagamento" clicado 2x, etc.).
//
// NÃO altera nenhuma lógica de negócio, preço, estoque ou entrega — só
// serializa/deduplica chamadas concorrentes para a mesma chave.
// ─────────────────────────────────────────────────────────────────────
const _entregasEmAndamento = new Set();

function _chaveEntrega({ mpPaymentId, efiTxid, openpixCorrelationID, canalId, guildId, clienteId, varianteKey }) {
  // Prioriza um identificador único de pagamento quando disponível (é o
  // mais forte contra duplicidade — 1 pagamento = 1 entrega). Sem isso
  // disponível, cai para a combinação canal+cliente+variante (formato
  // legado / confirmação manual pelo botão).
  if (mpPaymentId) return `mp:${mpPaymentId}`;
  if (efiTxid) return `efi:${efiTxid}`;
  if (openpixCorrelationID) return `openpix:${openpixCorrelationID}`;
  return `pedido:${guildId}:${canalId || 'sem-canal'}:${clienteId}:${varianteKey}`;
}

// CORREÇÃO (auditoria — Bug 3: duplo clique / múltiplos admins
// confirmando a mesma compra ao mesmo tempo no botão "Confirmar
// Pagamento"): trava em memória por confirmação em andamento.
const _confirmacoesEmAndamento = new Set();

function getCfg(guildId) { return db.getGuild(guildId).loja || {}; }
function isAdmin(member) { return member.permissions.has(PermissionFlagsBits.Administrator); }

// ── Footer padrão (ícone do servidor + nome) — usado em todas as embeds
// do fluxo de cliente para nunca depender de imagem fixa. ──────────────
function footerLoja(guild) {
  const iconURL = guild?.iconURL ? (guild.iconURL({ extension: 'png', size: 256 }) || undefined) : undefined;
  return { text: guild?.name || 'Loja', iconURL };
}
function iconGuild(guild) {
  return guild?.iconURL ? (guild.iconURL({ extension: 'png', size: 256 }) || undefined) : undefined;
}

// ── Normalização de chave de variante (corrige acentos/emojis) ──
function varianteToKey(nome) {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')     // qualquer coisa que não seja a-z0-9 -> _
    .replace(/^_+|_+$/g, '')         // remove _ nas pontas
    .slice(0, 80);                   // espaço de sobra pro prefixo do customId (limite 100)
}

// ── BUG 1/2 (correção): busca de variante agora percorre TODOS os produtos
// do servidor (cada um com seu próprio array `variantes`), em vez de um
// único array global `loja.variantes`. Mantém fallback no array legado para
// nunca quebrar um carrinho que já estivesse em andamento antes da migração.
function getVarianteEProdutoId(guildId, key) {
  const keyNorm = varianteToKey(key);
  const produtos = db.getProdutos(guildId);
  for (const p of produtos) {
    const v = (p.variantes || []).find(v => varianteToKey(v.nome) === keyNorm);
    if (v) return { variante: v, produtoId: p.id };
  }
  const legado = (getCfg(guildId).variantes || []).find(v => varianteToKey(v.nome) === keyNorm);
  if (legado) return { variante: legado, produtoId: null };
  return null;
}

// Mantida por compatibilidade com todos os chamadores existentes que só
// precisam da variante (sem produtoId) — delega para a busca multi-produto.
function getVarianteByKey(guildId, key) {
  const r = getVarianteEProdutoId(guildId, key);
  return r ? r.variante : null;
}

function getPedido(channelId) {
  if (!pedidosAtivos[channelId]) {
    pedidosAtivos[channelId] = { varianteKey: null, quantidade: 1, cupom: null };
  }
  return pedidosAtivos[channelId];
}

// KAEL — limpa o pedido em memória de um canal (cancelamento/expiração/
// entrega). Exportado pra quem não pode/deve mexer direto no objeto
// `pedidosAtivos` (privado deste módulo), como o cancelamento com motivo e
// o scheduler de expiração automática.
function limparPedido(channelId) {
  delete pedidosAtivos[channelId];
}

function aplicarDesconto(precoStr, desconto) {
  const valor = precoParaFloat(precoStr);
  const novo = (valor * (1 - desconto / 100)).toFixed(2).replace('.', ',');
  return `R$ ${novo}`;
}

function precoParaFloat(precoStr) {
  const limpo = String(precoStr).replace(/[^\d,\.]/g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

function floatParaPreco(valor) {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Calcula o preço final considerando quantidade e cupom
function calcularTotal(variante, pedido) {
  const unitario = precoParaFloat(variante.preco);
  const subtotal = unitario * (pedido.quantidade || 1);
  if (pedido.cupom) {
    // Cupons Avançados: suporta desconto por VALOR FIXO além do percentual
    // já existente. Cupons antigos não têm `tipo` definido — nesse caso
    // cai no `else` abaixo e o cálculo é IDÊNTICO ao comportamento
    // original (100% compatível com cupons já criados).
    const total = pedido.cupom.tipo === 'fixo'
      ? Math.max(0, subtotal - (pedido.cupom.valorFixo || 0))
      : subtotal * (1 - pedido.cupom.desconto / 100);
    return { unitario, subtotal, total, precoFinalStr: floatParaPreco(total), subtotalStr: floatParaPreco(subtotal) };
  }
  return { unitario, subtotal, total: subtotal, precoFinalStr: floatParaPreco(subtotal), subtotalStr: floatParaPreco(subtotal) };
}

// ── Estoque real (mesma regra usada no produto.js): quando o produto não
// tem variantes, o estoque exibido é sempre o tamanho do array
// `produto.estoque`. Quando a variante define `estoque` (número), usa esse
// valor. `null`/`undefined` = ilimitado (∞). ───────────────────────────
function getEstoqueProdutoSemVariante(produto) {
    const estoque = produto?.estoque;
    // BUGFIX (auditoria - Bug 3): `produto.estoque` é sempre um array no
    // db.js atual (um item por linha do modal "Adicionar Estoque"). A versão
    // antiga desta função tratava o valor como string e chamava `.trim()`,
    // o que lança TypeError em um array ("estoque.trim is not a function").
    // Suporta também o caso defensivo de vir como string (compatibilidade
    // com dados legados que eventualmente tenham sido salvos assim).
    if (Array.isArray(estoque)) return estoque.length;
    if (typeof estoque === 'string') return estoque.trim() ? estoque.trim().split('\n').length : 0;
    return 0;
}

function textoEstoque(qtd) {
  return qtd === null || qtd === undefined ? '∞' : `${qtd}`;
}

// ── CORREÇÃO (auditoria - Bug 1): quando a variante tem itens reais
// cadastrados (`itensEstoque`), ELE é a fonte de verdade do estoque —
// `variante.estoque` (numérico) passa a ser apenas um espelho dele.
// Variantes sem `itensEstoque` continuam usando só o número, 100% como
// antes (nenhuma mudança de comportamento pra quem não usa itens reais).
function getEstoqueRealVariante(variante) {
  if (Array.isArray(variante?.itensEstoque)) return variante.itensEstoque.length;
  return variante?.estoque ?? null; // null = ilimitado (comportamento original)
}

// ── PIX Copia e Cola (EMV padrão, sem API externa) ────────────
function gerarPixCopiaCola(chave, valor) {
  function campo(id, valor) {
    const tam = String(valor.length).padStart(2, '0');
    return `${id}${tam}${valor}`;
  }

  const pixKey = campo('01', chave);
  const gui    = campo('00', 'br.gov.bcb.pix');
  const dados  = campo('26', gui + pixKey);

  const valorStr = parseFloat(valor).toFixed(2);
  const valorCampo = campo('54', valorStr);

  const payload =
    campo('00', '01') +       // Payload Format Indicator
    dados +                    // Merchant Account Info
    campo('52', '0000') +     // Merchant Category Code
    campo('53', '986') +      // Transaction Currency (BRL)
    valorCampo +               // Transaction Amount
    campo('58', 'BR') +       // Country Code
    campo('59', 'KAEL') +   // Merchant Name
    campo('60', 'BRASIL') +   // Merchant City
    campo('62', campo('05', '***')); // Additional Data

  // CRC16-CCITT
  const payloadComCrc = payload + '6304';
  let crc = 0xFFFF;
  for (let i = 0; i < payloadComCrc.length; i++) {
    crc ^= payloadComCrc.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  const crcHex = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  return payload + '6304' + crcHex;
}

async function respostaModalComBotao(interaction, campo) {
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Salvo!').setDescription(`> **${campo}** atualizado com sucesso.`)],
    flags: 64
  });
  try {
    const { atualizarPainelFollowUp } = require('../commands/produto');
    await atualizarPainelFollowUp(interaction);
  } catch (e) {
    console.error('[Painel] Erro ao atualizar painel após modal:', e.message);
  }
}

// ── Embed de revisão (agora considera quantidade) ──────────────
// CORREÇÃO: estoque exibido agora usa a regra real (array do produto
// quando não há variante configurada com número próprio), em vez de cair
// sempre em `cfg.estoque?.length` (array legado que pode nem existir mais).
// CORREÇÃO: troca setImage (imagem grande fixa) por setThumbnail somente
// quando existir banner real — nunca mostra imagem preta/placeholder.
// CORREÇÃO: footer agora usa o ícone real do servidor.
function buildRevisaoEmbed(user, variante, cfg, pedido, guild) {
  const p = cfg.produto || {};
  const qtd = pedido?.quantidade || 1;
  const estoqueCount = variante.estoque != null ? variante.estoque : getEstoqueProdutoSemVariante(cfg);
  const { unitario, subtotal, total, precoFinalStr, subtotalStr } = calcularTotal(variante, pedido || { quantidade: qtd, cupom: null });

  let valorField;
  if (pedido?.cupom) {
    valorField = `~~${subtotalStr}~~\n**${precoFinalStr}** — *${pedido.cupom.desconto}% de desconto*`;
  } else {
    valorField = `**${precoFinalStr}**`;
  }

  const embed = new EmbedBuilder()
    .setColor(COR.primary)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ dynamic: true, size: 64 }) })
    .setTitle('<:carrinho:1524207445600370719>  Revisão do Pedido')
    .addFields(
      { name: '<:money:1532503308961448096>  Valor à vista', value: valorField, inline: true },
      { name: '<:caixa:1524207165496099007>  Em estoque', value: `\`${textoEstoque(estoqueCount)}\``, inline: true },
      { name: '<:block:1533259816871657522>  Quantidade', value: `\`${qtd}x\``, inline: true },
      { name: '🛍️  Carrinho', value: `\`${qtd}x\` ${variante.emoji || ''} **${variante.nome}** | ${floatParaPreco(unitario)} cada`, inline: false }
    )
    .setFooter(footerLoja(guild))
    .setTimestamp();
  const banner = p.banner || cfg.banner;
  if (banner) embed.setThumbnail(banner);
  return embed;
}

function buildRevisaoComponents(varianteKey) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loja_ir_pagamento_${varianteKey}`).setLabel('Ir para Pagamento').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`loja_alterar_qtd_${varianteKey}`).setLabel('Alterar Quantidade').setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loja_aplicar_cupom_${varianteKey}`).setLabel('Aplicar Cupom').setEmoji('<:cupom:1524209015008002148>').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('loja_cancelar_confirmar').setLabel('Cancelar Pedido').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

// ── Embed da loja (preço/estoque corrigidos) ───────────────────
// CORREÇÃO: estoque sem variante agora usa o array real do produto
// (getEstoqueProdutoSemVariante), igual ao restante do sistema — antes já
// estava certo aqui (cfg.estoque?.length), mantido e só uniformizado.
// CORREÇÃO: troca setImage por setThumbnail (nunca imagem grande fixa) e só
// define quando existir banner de verdade.
function buildLojaEmbed(guildId, guild, client) {
  const cfg = getCfg(guildId);
  const p = cfg.produto || {};
  const variantes = cfg.variantes || [];
  const icon = iconGuild(guild) || client.user.displayAvatarURL({ dynamic: true });

  const embed = new EmbedBuilder()
    .setColor(COR.primary)
    .setTitle(p.titulo || cfg.titulo || 'Produto')
    .setFooter(footerLoja(guild))
    .setTimestamp();

  if (p.descricao || cfg.descricao) embed.setDescription(p.descricao || cfg.descricao);

  if (variantes.length === 1) {
    // Produto com 1 variante — mostra campos separados igual à referência
    const v = variantes[0];
    embed.addFields(
      { name: '<:money:1532503308961448096> Valor à vista', value: `\`${v.preco}\``, inline: true },
      { name: '<:caixa:1524207165496099007> Restam',        value: `\`${textoEstoque(v.estoque)}\``, inline: true }
    );
  } else if (variantes.length > 1) {
    // Múltiplas variantes — lista cada uma com preço e estoque
    const lista = variantes
      .map(v => `${v.emoji || '<:carrinho:1524207445600370719>'} **${v.nome}** — <:money:1532503308961448096> \`${v.preco}\` | <:caixa:1524207165496099007> Estoque: \`${textoEstoque(v.estoque)}\``)
      .join('\n');
    embed.addFields({ name: '<:config2:1524208021071462533> Planos Disponíveis', value: lista, inline: false });
  } else if (p.preco) {
    // Sem variantes — usa estoque real (array) do produto
    const estoqueGeral = getEstoqueProdutoSemVariante(cfg);
    embed.addFields(
      { name: '<:money:1532503308961448096> Valor à vista', value: `\`${p.preco}\``, inline: true },
      { name: '<:caixa:1524207165496099007> Restam',        value: `\`${estoqueGeral}\``, inline: true }
    );
  }

  // Thumbnail real apenas se existir — nunca placeholder/imagem preta fixa.
  const banner = p.banner || cfg.banner;
  if (banner) embed.setThumbnail(banner);
  return embed;
}

// ── PUBLICAR — select menu de canais ─────────────────────────
async function publicar(interaction) {
  const canaisTexto = interaction.guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position)
    .first(25);

  if (!canaisTexto || canaisTexto.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Nenhum canal de texto encontrado.')],
      flags: 64
    });
  }

  const options = canaisTexto.map(c => ({
    label: `#${c.name}`.slice(0, 100),
    value: c.id,
    description: c.parent?.name?.slice(0, 100) || 'Sem categoria',
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('prod_sel_canal_publicar')
    .setPlaceholder('<:canal:1524207214791884890> Selecione o canal para publicar a embed...')
    .addOptions(options);

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(COR.gold)
      .setTitle('<:canal:1524207214791884890> Publicar no Canal')
      .setDescription('> Selecione em qual canal a embed da loja será publicada.')
    ],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64
  });
}

// ── PUBLICAR EXECUTAR — após select do canal ──────────────────
async function publicarNoCanal(interaction) {
  // <:positivo:1528401238197276702> deferUpdate logo no início (evita "interação falhou" em operações lentas)
  await interaction.deferUpdate();

  const canalId = interaction.values[0];
  const cfg = getCfg(interaction.guildId);
  const canal = interaction.guild.channels.cache.get(canalId);

  if (!canal) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Canal não encontrado.')],
      components: []
    });
  }

  const embed = buildLojaEmbed(interaction.guildId, interaction.guild, interaction.client);
  const variantes = cfg.variantes || [];

  let rowSelect;
  if (variantes.length > 0) {
    const options = variantes.slice(0, 25).map(v => ({
      label: v.nome.slice(0, 100),
      description: `Preço: ${v.preco} | Estoque: ${textoEstoque(v.estoque)}`,
      emoji: v.emoji || '<:carrinho:1524207445600370719>',
      value: varianteToKey(v.nome)
    }));
    rowSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('loja_sel_plano').setPlaceholder('Clique aqui para ver as opções').addOptions(options)
    );
  } else {
    rowSelect = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('loja_comprar').setLabel('Comprar').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(ButtonStyle.Danger)
    );
  }

  await canal.send({ embeds: [embed], components: [rowSelect] });

  db.updateGuild(interaction.guildId, 'loja.canalLojaId', canalId);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Publicado!').setDescription(`> Embed enviada em <#${canalId}>`)],
    components: []
  });
}

async function abrirSelectPlanos(interaction) {
  const cfg = getCfg(interaction.guild.id);
  const variantes = cfg.variantes || [];
  const icon = iconGuild(interaction.guild) || interaction.client.user.displayAvatarURL({ dynamic: true });

  if (variantes.length === 0) {
    const p = cfg.produto || {};

    // BUGFIX (auditoria - Bug 2): este bloco monta um "produto padrão"
    // fictício quando não há loja.variantes (sistema legado de produto
    // único). Se o servidor nunca configurou loja.produto (por usar apenas
    // o sistema multi-produto atual, loja.produtos[]), isso resultava num
    // carrinho para "Produto" a "R$ 0,00" — sem relação com o catálogo
    // real. Em vez de criar esse carrinho fantasma, orientamos o cliente a
    // usar a vitrine publicada (/produto criar → Publicar Produto). O botão
    // e o fluxo legado continuam funcionando normalmente para quem ainda
    // tem loja.produto/loja.variantes configurados.
    const legadoConfigurado = !!(p && (p.titulo || p.preco));
    if (!legadoConfigurado) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Este botão de compra está desatualizado')
          .setDescription('> Este produto foi configurado pelo sistema atual de produtos.\n> Por favor, compre pela vitrine publicada no canal da loja (ou peça a um administrador para republicar em `/produto criar` → **Publicar Produto (Canal)**).')],
        flags: 64
      });
    }

    const variantePadrao = {
      nome: p.titulo || 'Produto',
      preco: p.preco || 'R$ 0,00',
      emoji: '<:carrinho:1524207445600370719>',
      estoque: null,
    };
    const varianteKey = varianteToKey(variantePadrao.nome);

    await interaction.deferReply({ flags: 64 });

    const existe = interaction.guild.channels.cache.find(c => c.topic?.startsWith(`compra:${interaction.user.id}`));
    if (existe) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Você já tem uma compra aberta').setDescription(`> <#${existe.id}>`)],
      });
    }

    const perms = [
      { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    const admins = interaction.guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot);
    admins.forEach(m => perms.push({
      id: m.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
    }));

    const canal = await interaction.guild.channels.create({
      name: `compra-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      topic: `compra:${interaction.user.id}:${varianteKey}`,
      parent: cfg.categoriaComprasId || null,
      permissionOverwrites: perms,
    });

    const pedido = getPedido(canal.id);
    pedido.varianteKey = varianteKey;
    pedido.quantidade = 1;
    pedido.cupom = null;

    const embed = buildRevisaoEmbed(interaction.user, variantePadrao, cfg, pedido, interaction.guild);
    const components = buildRevisaoComponents(varianteKey);
    await canal.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components });

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Canal Criado!').setDescription(`> Acesse <#${canal.id}> para finalizar sua compra.`)],
    });
  }

  const options = variantes.slice(0, 25).map(v => ({
    label: v.nome.slice(0, 100),
    description: `Preço: ${v.preco} | Estoque: ${textoEstoque(v.estoque)}`,
    emoji: v.emoji || '<:carrinho:1524207445600370719>',
    value: varianteToKey(v.nome)
  }));

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(COR.primary).setTitle('<:carrinho:1524207445600370719> ESCOLHA SEU PLANO').setDescription('> Selecione o plano que deseja adquirir.')
      .setThumbnail(icon).setFooter(footerLoja(interaction.guild)).setTimestamp()
    ],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('loja_sel_plano').setPlaceholder('Clique aqui para ver as opções').addOptions(options)
    )],
    flags: 64
  });
}

async function gerenciarVariantes(interaction) {
  const variantes = db.getGuild(interaction.guildId).loja?.variantes || [];
  const lista = variantes.length > 0
    ? variantes.map((v, i) => `**${i + 1}.** ${v.emoji || '<:carrinho:1524207445600370719>'} **${v.nome}** — ${v.preco} | Estoque: ${textoEstoque(v.estoque)}`).join('\n')
    : '> Nenhuma variante cadastrada ainda.';

  const embed = new EmbedBuilder()
    .setColor(COR.gold)
    .setTitle('<:config2:1524208021071462533> Gerenciar Variantes')
    .setDescription(lista)
    .setFooter({ text: 'Use os botões abaixo para gerenciar' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_variante_criar').setLabel('Criar').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('prod_variante_listar').setLabel('Listar').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('prod_variante_remover').setLabel('Remover').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('prod_variante_voltar').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function configurarCargo(interaction) {
  const loja = db.getGuild(interaction.guildId).loja || {};
  const cargoAtual = loja.produto?.cargoId ? `<@&${loja.produto.cargoId}>` : '`Não configurado`';

  const cargos = interaction.guild.roles.cache
    .filter(r => !r.managed && r.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position)
    .first(25);

  const options = cargos.map(r => ({
    label: r.name.slice(0, 100),
    value: r.id,
    description: `ID: ${r.id}`,
  }));

  if (options.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Nenhum cargo encontrado.')],
      flags: 64
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COR.gold)
    .setTitle('<:user:1532137085081878558> Configurar Cargo Automático')
    .setDescription(`> Selecione o cargo que será entregue automaticamente após uma compra.\n\n**Cargo atual:** ${cargoAtual}`)
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId('prod_sel_cargo')
    .setPlaceholder('<:user:1532137085081878558> Selecione o cargo...')
    .addOptions(options);

  await interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64
  });
}

async function criarCanalCompra(interaction) {
  // <:positivo:1528401238197276702> deferUpdate logo no início
  await interaction.deferUpdate();

  const varianteKeyRaw = interaction.values[0];
  const varianteKey = varianteToKey(varianteKeyRaw);
  const { guild, user, client } = interaction;
  const cfg = getCfg(guild.id);
  const variante = getVarianteByKey(guild.id, varianteKey) || { nome: varianteKeyRaw, preco: 'R$ 0,00', emoji: '<:carrinho:1524207445600370719>', recursos: '' };

  if (criandoCanalCompraLoja.has(user.id)) {
    return interaction.followUp({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sua compra já está sendo criada').setDescription('> Aguarde alguns segundos, não clique novamente.')],
      flags: 64
    });
  }

  const existe = guild.channels.cache.find(c => c.topic?.startsWith(`compra:${user.id}`));
  if (existe) {
    return interaction.followUp({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Você já tem uma compra aberta').setDescription(`> <#${existe.id}>`)],
      flags: 64
    });
  }

  criandoCanalCompraLoja.add(user.id);
  try {

  const perms = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  const admins = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot);
  admins.forEach(m => perms.push({
    id: m.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
  }));

  const canal = await guild.channels.create({
    name: `compra-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
    type: ChannelType.GuildText,
    topic: `compra:${user.id}:${varianteKey}`,
    parent: cfg.categoriaComprasId || null,
    permissionOverwrites: perms,
  });

  const pedido = getPedido(canal.id);
  pedido.varianteKey = varianteKey;
  pedido.quantidade = 1;
  pedido.cupom = null;

  const embed = buildRevisaoEmbed(user, variante, cfg, pedido, guild);
  const components = buildRevisaoComponents(varianteKey);
  await canal.send({ content: `<@${user.id}>`, embeds: [embed], components });

  await interaction.followUp({
    embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Canal Criado!').setDescription(`> Acesse <#${canal.id}> para finalizar sua compra.`)],
    flags: 64
  });
  } finally {
    criandoCanalCompraLoja.delete(user.id);
  }

  if (cfg.canalLogsId) {
      const logs = guild.channels.cache.get(cfg.canalLogsId);

      // 1. Botões de Ação Rápida
      const rowAcao = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`loja_confirmar_${varianteKey}_${user.id}_${canal.id}`)
          .setLabel('Aprovar Pedido')
          .setEmoji('<:positivo:1528401238197276702>')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('loja_cancelar_confirmar')
          .setLabel('Cancelar/Recusar')
          .setEmoji('<:negativo:1528400986744295475>')
          .setStyle(ButtonStyle.Danger)
      );

      // 2. Embed Profissional Estilo /Painel
      // CORREÇÃO: removido "<:cupom:1524209015008002148> ID do Pedido: #0001" fixo/fake (não era um
      // número real de pedido, sempre mostrava #0001). Footer com ícone
      // real do servidor.
      const embedLog = new EmbedBuilder()
        .setColor(COR.gold || 0xFFD700)
        .setTitle('<:carrinho:1524207445600370719> Notificação de Novo Pedido')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 })) // Adiciona a foto do cliente no canto
        .setDescription(
          `> <:user:1532137085081878558> **Cliente:** <@${user.id}>\n` +
          `> <:caixa:1524207165496099007> **Produto:** \`${variante.nome}\`\n` +
          `> <:block:1533259816871657522> **Quantidade:** \`${pedido?.quantidade || 1}x\`\n` +
          `> <:money:1532503308961448096> **Valor Total:** \`${variante.preco || 'R$ 0,00'}\`\n` +
          `> <:canal:1524207214791884890> **Ticket de Compra:** <#${canal.id}>\n` +
          `> 📅 **Iniciado em:** <t:${Math.floor(Date.now() / 1000)}:F>`
        )
        .setFooter(footerLoja(guild))
        .setTimestamp();

      // 3. Envia para o canal de logs
      logs?.send({ embeds: [embedLog], components: [rowAcao] }).catch(() => {});
    }
}
// ── Monta embed + QR Code (local) + componentes para a tela de pagamento PIX ──
async function buildPagamentoPix({ guild, pixChave, valorFloat, qtd, precoFinalStr, varianteKey }) {
  let pixCopiaCola = null;
  let qrBuffer = null;

  if (pixChave && valorFloat > 0) {
    try {
      pixCopiaCola = gerarPixCopiaCola(pixChave, valorFloat);
              // --- Monta a URL e busca o QR Code ---
const iconUrl = guild.iconURL({ extension: 'png', size: 128 });
let quickChartUrl = `https://quickchart.io/qr?text=${encodeURIComponent(pixCopiaCola)}&size=400&margin=2`;

if (iconUrl) {
    quickChartUrl += `&centerImageUrl=${encodeURIComponent(iconUrl)}`;
}

// O fetch é obrigatório para baixar a imagem!
const respostaDaApi = await fetch(quickChartUrl);
const bufferDeImagem = await respostaDaApi.arrayBuffer();
qrBuffer = Buffer.from(bufferDeImagem);
 } catch (e) {
      console.error('[PIX] Erro ao gerar PIX/QR Code:', e.message);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x00C851)
        .setTitle('<:card:1533880211882381422> Realize o Pagamento PIX')
    .setFooter(footerLoja(guild))
    .setTimestamp();

  const files = [];
  if (qrBuffer) {
    const attachment = new AttachmentBuilder(qrBuffer, { name: 'qrcode-pix.png' });
    embed.setImage('attachment://qrcode-pix.png');
    files.push(attachment);
  }

  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loja_ja_paguei_${varianteKey}`).setLabel('Já Paguei').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('loja_cancelar_confirmar').setLabel('Cancelar').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger),
  );

  const rowCopiar = new ActionRowBuilder();
  if (pixChave) {
    rowCopiar.addComponents(
      new ButtonBuilder().setCustomId('loja_copiar_pix').setLabel('Copiar Chave PIX').setEmoji('<:pix:1528401197642551436>').setStyle(ButtonStyle.Secondary)
    );
  }
  if (pixCopiaCola) {
    rowCopiar.addComponents(
      new ButtonBuilder().setCustomId(`loja_copiar_copiacola_${varianteKey}`).setLabel('Copiar PIX Copia e Cola').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary)
    );
  }

  const components = rowCopiar.components.length > 0 ? [rowAcoes, rowCopiar] : [rowAcoes];

  return { embed, files, components, pixCopiaCola };
}

// ── IR PARA PAGAMENTO (corrigido: usa pedido com quantidade/cupom) ──
async function irParaPagamento(interaction) {
  await interaction.deferUpdate();

  const varianteKey = varianteToKey(interaction.customId.replace('loja_ir_pagamento_', ''));
  const { guild, channel, user } = interaction;
  const cfg = getCfg(guild.id);
  const variante = getVarianteByKey(guild.id, varianteKey) || { nome: varianteKey, preco: 'R$ 0,00', emoji: '<:carrinho:1524207445600370719>' };

  const pedido = getPedido(channel.id);
  if (!pedido.varianteKey) pedido.varianteKey = varianteKey;

  const { total, precoFinalStr } = calcularTotal(variante, pedido);
  const valorFloat = total;
  const qtd = pedido.quantidade || 1;

  // ── PIX automático via chave configurada no servidor ──
  const pixChaveRaw = cfg.pix?.chave || db.getGuild(guild.id).pix?.chave || null;
const pixChave = pixChaveRaw ? pixChaveRaw.replace(/[.\-\/\s]/g, '').trim() : null;

  const { embed, files, components } = await buildPagamentoPix({ guild, pixChave, valorFloat, qtd, precoFinalStr, varianteKey });

  // Guarda o copia-e-cola para o botão de copiar usar depois
  if (pixChave && valorFloat > 0) {
    try {
      pedido.pixCopiaCola = gerarPixCopiaCola(pixChave, valorFloat);
    } catch (e) {}
  }

  await interaction.editReply({ embeds: [embed], components, files });
}

// ── BUG 4 (correção): Resolução robusta de canais ──────────────────────
async function resolverCanal(guild, canalId, rotulo) {
  if (!canalId) {
    console.warn(`[Entrega] Canal de "${rotulo}" não está configurado no servidor "${guild.name}" (${guild.id}).`);
    return null;
  }
  let canal = guild.channels.cache.get(canalId);
  if (!canal) {
    try {
      canal = await guild.channels.fetch(canalId);
    } catch (e) {
      console.error(`[Entrega] Canal de "${rotulo}" (ID: ${canalId}) não foi encontrado no servidor "${guild.name}" (${guild.id}). Verifique se o canal ainda existe e se o bot tem permissão para vê-lo. Detalhe: ${e.message}`);
      return null;
    }
  }
  if (canal && typeof canal.isTextBased === 'function' && !canal.isTextBased()) {
    console.error(`[Entrega] Canal de "${rotulo}" (ID: ${canalId}) no servidor "${guild.name}" (${guild.id}) existe mas não é um canal de texto válido para envio de mensagens.`);
    return null;
  }
  return canal;
}

// ── ENTREGA AUTOMÁTICA (suporta múltiplos itens do estoque) ──
async function entregarAutomatico({ client, guildId, clienteId, varianteKey, canalId, numeroPedido, produtoId, mpPaymentId, efiTxid, openpixCorrelationID, dmRef }) {
  // CORREÇÃO (auditoria — Bug 1): se já existe uma entrega em andamento
  // para esta mesma chave (mesmo pagamento, ou mesmo canal+cliente+
  // variante), ignora a chamada duplicada em vez de processar de novo.
  const _chave = _chaveEntrega({ mpPaymentId, efiTxid, openpixCorrelationID, canalId, guildId, clienteId, varianteKey });
  if (_entregasEmAndamento.has(_chave)) {
    console.warn(`[Entrega] Chamada duplicada ignorada para a chave "${_chave}" (já em processamento).`);
    return { ok: false, motivo: 'entrega_duplicada_ignorada' };
  }
  _entregasEmAndamento.add(_chave);
  try {
    // ─────────────────────────────────────────────────────────────────
    // KAEL — proteção de estado da transação: TODA confirmação de
    // pagamento (webhook Mercado Pago, poller Efi/C6 Bank, botão manual
    // "Confirmar Pagamento") passa por aqui. Se este canal tem uma
    // transação rastreada, só entrega quando ela ainda está PENDING —
    // a transição é atômica (UPDATE ... WHERE status = 'PENDING'), então
    // nunca entrega duas vezes nem entrega um carrinho já cancelado,
    // expirado ou recusado, não importa a ordem de chegada dos eventos.
    // ─────────────────────────────────────────────────────────────────
    if (canalId) {
      const transacaoManager = require('./transacaoManager');
      const transacaoAtual = transacaoManager.getPorCanal(canalId);
      if (transacaoAtual) {
        const venceu = transacaoManager.marcarPaga(canalId);
        if (!venceu) {
          console.warn(`[Entrega] Transação do canal ${canalId} não estava mais PENDING (status atual: ${transacaoAtual.status}) — entrega bloqueada para evitar conflito de estado.`);
          return { ok: false, motivo: 'transacao_nao_pendente', statusAtual: transacaoAtual.status };
        }
        try { require('../handlers/expiracaoScheduler').cancelarTimer(canalId); } catch (e) { /* scheduler pode não estar carregado ainda; sem problema, a checagem de status acima já protege */ }
      }
    }

    let guild = client.guilds.cache.get(guildId);
    if (!guild) {
      try {
        guild = await client.guilds.fetch(guildId);
      } catch (e) {
        console.error(`[Entrega] Servidor (guild ID: ${guildId}) não encontrado/inacessível para esta entrega. Detalhe: ${e.message}`);
        return;
      }
    }
    const cfg = getCfg(guildId);
    const key = varianteToKey(varianteKey);

    let produtoIdResolvido = produtoId || null;
    let variante;
    if (produtoIdResolvido) {
      const prodTmp = db.getProdutoPorId(guildId, produtoIdResolvido);
      variante = (prodTmp?.variantes || []).find(v => varianteToKey(v.nome) === key) || null;
    }
    if (!variante) {
      const achado = getVarianteEProdutoId(guildId, key);
      if (achado) { variante = achado.variante; produtoIdResolvido = achado.produtoId; }
    }
    const produto = produtoIdResolvido ? db.getProdutoPorId(guildId, produtoIdResolvido) : null;
    // BUGFIX: antes, sem variante encontrada, caía num fallback fixo de
    // R$0,00 — mesmo bug já corrigido no carrinho (produto.js), mas esta
    // função tem sua própria resolução separada. Agora usa o preço BASE
    // do produto (produto.preco) quando ele não tem variantes.
    variante = variante || (produto ? { nome: produto.titulo || key, preco: produto.preco || '0.00', emoji: '<:carrinho:1524207445600370719>' } : { nome: key, preco: '0.00', emoji: '<:carrinho:1524207445600370719>' });

    const canal = canalId ? await resolverCanal(guild, canalId, 'Compra (canal temporário)') : null;

    const pedido = canalId ? getPedido(canalId) : { quantidade: 1, cupom: null };
    const qtd = pedido.quantidade || 1;
    const { total, precoFinalStr } = calcularTotal(variante, pedido);

    // CORREÇÃO (auditoria - Bug 1): checagem de estoque real ANTES de
    // conceder qualquer cargo, registrar assinatura ou entregar — nunca
    // confirma pagamento/entrega se a variante tiver itensEstoque
    // cadastrado e ele estiver vazio (fonte de verdade = itens reais).
    if (produto) {
      const variantesProdutoCheck = produto.variantes || [];
      const idxVCheck = variantesProdutoCheck.findIndex(v => varianteToKey(v.nome) === key);
      if (idxVCheck !== -1 && Array.isArray(variantesProdutoCheck[idxVCheck].itensEstoque) && variantesProdutoCheck[idxVCheck].itensEstoque.length === 0) {
        return { ok: false, motivo: 'sem_estoque' };
      }
    }

    if (variante.cargoId) {
      const membro = await guild.members.fetch(clienteId).catch(() => null);
      if (membro) await membro.roles.add(variante.cargoId).catch(() => {});
    }

    const cargoGeralId = produto?.cargoId || (!produto ? cfg.produto?.cargoId : null) || null;
    if (cargoGeralId) {
      const membro = await guild.members.fetch(clienteId).catch(() => null);
      if (membro) await membro.roles.add(cargoGeralId).catch(() => {});
    }

    // ── Cargos Pós-Compra (lista) — além do cargoId único acima, o produto
    // pode ter uma lista de cargos pra ADICIONAR e outra pra REMOVER na
    // entrega. Totalmente aditivo: produtos sem essa config não são afetados.
    if (produto?.cargosPosCompra) {
      const membro = await guild.members.fetch(clienteId).catch(() => null);
      if (membro) {
        for (const cid of (produto.cargosPosCompra.adicionar || [])) {
          await membro.roles.add(cid).catch(() => {});
        }
        for (const cid of (produto.cargosPosCompra.remover || [])) {
          await membro.roles.remove(cid).catch(() => {});
        }
      }
    }

    // ── Assinatura (produto recorrente) — o cargo já foi concedido acima
    // (cargoGeralId); aqui só REGISTRAMOS a expiração pra o job periódico
    // (assinatura-system/assinaturaManager.js) remover o cargo quando vencer.
    if (produto?.assinatura?.ativa && cargoGeralId) {
      const duracaoDias = produto.assinatura.duracaoDias || 30;
      db.salvarAssinaturaAtiva(guildId, {
        produtoId: produto.id,
        clienteId,
        cargoId: cargoGeralId,
        vipAtivado: !!produto.assinatura.vipAtivado,
        expiraEm: new Date(Date.now() + duracaoDias * 86400000).toISOString(),
      });
    }

    const itensEntregues = [];
    if (produto) {
      const variantesProduto = produto.variantes || [];
      const idxV = variantesProduto.findIndex(v => varianteToKey(v.nome) === key);

      // CORREÇÃO (auditoria - Bug 1): `itensEstoque`, quando existe, é a
      // ÚNICA fonte de verdade — se ele existir e estiver vazio, a entrega
      // é ABORTADA (nunca decrementa nada, nunca confirma pagamento sem
      // item real pra entregar). `variante.estoque` deixa de ser checado
      // isoladamente aqui: ele só é atualizado para refletir
      // itensEstoque.length (nunca o contrário).
      if (idxV !== -1 && Array.isArray(variantesProduto[idxV].itensEstoque)) {
        const itensVariante = variantesProduto[idxV].itensEstoque;
        if (itensVariante.length === 0) {
          return { ok: false, motivo: 'sem_estoque' };
        }
        const n = Math.min(qtd, itensVariante.length);
        for (let i = 0; i < n; i++) itensEntregues.push(itensVariante.shift());
        // Sincroniza SEMPRE o contador numérico com a quantidade real
        // restante de itens (fonte de verdade = itensEstoque.length).
        variantesProduto[idxV].estoque = itensVariante.length;
        db.atualizarProduto(guildId, produto.id, 'variantes', variantesProduto);
      } else if (idxV === -1) {
        // Produto sem variante correspondente — comportamento original intacto.
        const estoqueProduto = produto.estoque || [];
        if (estoqueProduto.length > 0) {
          const n = Math.min(qtd, estoqueProduto.length);
          for (let i = 0; i < n; i++) itensEntregues.push(estoqueProduto.shift());
          db.atualizarProduto(guildId, produto.id, 'estoque', estoqueProduto);
        }
      } else if (variantesProduto[idxV].estoque != null) {
        // Variante existe mas ainda não tem itensEstoque cadastrados
        // (só o contador numérico antigo) — só decrementa o contador,
        // sem inventar item nenhum pra entregar. Comportamento original
        // preservado para quem nunca usou itens reais.
        variantesProduto[idxV].estoque = Math.max(0, (variantesProduto[idxV].estoque || 0) - qtd);
        db.atualizarProduto(guildId, produto.id, 'variantes', variantesProduto);
      }
    } else {
      const estoque = db.getGuild(guildId).loja?.estoque || [];
      if (estoque.length > 0) {
        const n = Math.min(qtd, estoque.length);
        for (let i = 0; i < n; i++) itensEntregues.push(estoque.shift());
        db.updateGuild(guildId, 'loja.estoque', estoque);
      }
      const variantesLegado = cfg.variantes || [];
      const idxLegado = variantesLegado.findIndex(v => varianteToKey(v.nome) === key);
      if (idxLegado !== -1 && variantesLegado[idxLegado].estoque != null) {
        variantesLegado[idxLegado].estoque = Math.max(0, (variantesLegado[idxLegado].estoque || 0) - qtd);
        db.updateGuild(guildId, 'loja.variantes', variantesLegado);
      }
    }

    // CORREÇÃO (auditoria): após reduzir o estoque (produto ou variante),
    // sincroniza a vitrine pública já publicada para este produto, se
    // existir uma — edita a MESMA mensagem, nunca cria uma nova. Usa
    // require tardio para evitar dependência circular com produto.js
    // (que também faz require deste arquivo).
    if (produto) {
      try {
        const { atualizarVitrinePublicada } = require('../commands/produto');
        if (typeof atualizarVitrinePublicada === 'function') {
          await atualizarVitrinePublicada(client, guildId, produto.id);
        }
      } catch (e) { console.error('[Vitrine] Falha ao sincronizar vitrine após entrega:', e.message); }
    }

    if (canalId) delete pedidosAtivos[canalId];

    const icon = iconGuild(guild) || client.user.displayAvatarURL({ dynamic: true });
    const p = produto || cfg.produto || {};

    const agoraISO = new Date().toISOString();
    const registroId = `${guildId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let numeroPedidoFinal = numeroPedido;
    if (numeroPedidoFinal == null) {
      const atualContador = typeof cfg.proximoPedido === 'number' ? cfg.proximoPedido : 1;
      db.updateGuild(guildId, 'loja.proximoPedido', atualContador + 1);
      numeroPedidoFinal = atualContador;
    }

    const historico = db.getGuild(guildId).loja?.historicoCompras || [];
    historico.push({
      id: registroId,
      clienteId,
      produtoNome: p.titulo || variante.nome,
      varianteNome: variante.nome,
      varianteEmoji: variante.emoji || null,
      quantidade: qtd,
      valor: precoFinalStr,
      itensEntregues,
      dataISO: agoraISO,
      numeroPedido: numeroPedidoFinal,
      mpPaymentId: mpPaymentId || null,
      efiTxid: efiTxid || null,
    });
    db.updateGuild(guildId, 'loja.historicoCompras', historico);
    console.log('[Entrega][DIAGNOSTICO] Venda registrada no historico. guildId=' + guildId + ' registroId=' + registroId + ' total_historico=' + historico.length);
    if (canalId) {
      try {
        db.atualizarStatusCarrinhoPorCanal(canalId, 'pago');
      } catch (e) {
        console.error('[Kael Intelligence] Erro ao atualizar status do carrinho:', e.message);
      }
    }

    const clienteUser = await client.users.fetch(clienteId).catch(() => null);

    // ─────────────────────────────────────────────────────────────────
    // KAEL — CARTEIRA: este é o ÚNICO ponto do sistema onde o saldo
    // do servidor é creditado. Chegar até aqui já significa que:
    //   1) o webhook do Mercado Pago confirmou status "approved" (via
    //      consultarPagamento), OU o poller do Efi Bank/C6 Bank confirmou
    //      "approved" numa consulta oficial ao provedor; e
    //   2) a transação estava PENDING e foi marcada como paga de forma
    //      atômica (transacaoManager.marcarPaga, checado no início desta
    //      função) — nunca dispara em cobrança criada, PIX gerado,
    //      checkout aberto, clique do usuário ou aviso do Discord.
    // Nunca chamar onVendaAprovada em nenhum outro lugar do fluxo de
    // venda — isso duplicaria crédito de saldo.
    // ─────────────────────────────────────────────────────────────────
    try {
      const { onVendaAprovada } = require('../utils/carteiraIntegration');
      const providerId = mpPaymentId || efiTxid || openpixCorrelationID || null;
      const provider    = mpPaymentId ? 'MERCADO_PAGO' : (efiTxid ? 'EFI' : (openpixCorrelationID ? 'OPENPIX' : (providerId ? 'C6' : null)));
      await onVendaAprovada(guildId, total, {
        produto:               p.titulo || variante.nome,
        comprador:             clienteUser?.tag || clienteId,
        vendaId:               registroId,
        provider,
        providerTransactionId: providerId,
      });
    } catch (e) {
      // Nunca deixar a carteira quebrar a entrega já confirmada.
      console.error('[Carteira] Erro ao creditar venda aprovada:', e.message);
    }

    const { enviarPedidoAprovado, enviarEntregaRealizada } = require('./entregaDM');
    const dadosDM = { guild, icon, variante, precoFinalStr, pedidoId: canalId || guildId };

    // CORREÇÃO (reestruturação): cada etapa agora é uma MENSAGEM NOVA
    // (channel.send), nunca edição de mensagem anterior.
    await enviarPedidoAprovado({ client, clienteId, ...dadosDM });
    const dmEnviada = await enviarEntregaRealizada({
      client, clienteId, guildId, ...dadosDM, itensEntregues, produtoId, produto: p,
    });                    
                    
         const vendas = db.getGuild(guildId).loja?.vendas || 0;
    db.updateGuild(guildId, 'loja.vendas', (typeof vendas === 'number' ? vendas : 0) + qtd);

    const canalEntregasId = p.canalEntregasId || cfg.canalEntregasId || null;
const canalEntregas = canalEntregasId ? await resolverCanal(guild, canalEntregasId, 'Entregas') : null;
if (!canalEntregasId) console.warn(`[Entrega] Canal de entregas não configurado — "${guild.name}". Configure em /produto criar → Configurar Canal de Entregas.`);
    if (canalEntregas) {
      const agora = new Date();
      const dataStr = agora.toLocaleDateString('pt-BR');
      const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      // Campos estruturados: cliente, produto, variante, valor, data, hora.
      // CORREÇÃO: sem número de pedido fixo/fake aqui também.
      const camposEstruturados =
        `<:user:1532137085081878558> **Cliente**\n<@${clienteId}>\n\n` +
        `<:caixa:1524207165496099007> **Produto**\n${p.titulo || variante.nome}\n\n` +
        `🎁 **Variante**\n${variante.emoji ? `${variante.emoji} ` : ''}${variante.nome}\n\n` +
        `<:money:1532503308961448096> **Valor**\n${precoFinalStr}\n\n` +
        `📅 **Data**\n${dataStr}\n\n` +
        `<:relogio:1524207889441357917> **Hora**\n${horaStr}`;
      try {
        const avatarURL = clienteUser ? clienteUser.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 }) : icon;
        const linkVitrine = p.vitrineCanalId ? `https://discord.com/channels/${guildId}/${p.vitrineCanalId}` : null;
        const linkAvaliacao = p.canalAvaliacaoId ? `https://discord.com/channels/${guildId}/${p.canalAvaliacaoId}` : linkVitrine;
        const rowEntrega = new ActionRowBuilder().addComponents(
          linkVitrine
            ? new ButtonBuilder().setLabel('Comprar Novamente').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(ButtonStyle.Link).setURL(linkVitrine)
            : new ButtonBuilder().setCustomId('loja_comprar').setLabel('Comprar').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(ButtonStyle.Danger),
          linkAvaliacao
            ? new ButtonBuilder().setLabel('Ver Feedbacks').setEmoji({ name: 'trofeu', id: '1533235838345937086' }).setStyle(ButtonStyle.Link).setURL(linkAvaliacao)
            : new ButtonBuilder().setCustomId(`loja_feedbacks_${p.id}`).setLabel('Ver Feedbacks').setEmoji({ name: 'trofeu', id: '1533235838345937086' }).setStyle(ButtonStyle.Secondary)
        );

        // Tentativa PRIMÁRIA: comprovante em imagem (canvas), estilo cartão.
        const buffer = await gerarComprovante({
  username: clienteUser?.username || 'Cliente', avatarURL,
  produtoNome: p.titulo || variante.nome, produtoEmoji: variante.emoji || '',
  preco: precoFinalStr, footerText: p.footer || guild.name,
  guildIconURL: icon, guildName: guild.name,
  produtoImagemURL: p.thumbnail || p.banner || null,
});

        if (buffer) {
          const attachment = new AttachmentBuilder(buffer, { name: 'comprovante.png' });
          await canalEntregas.send({ files: [attachment], components: [rowEntrega] })
            .catch((e) => console.error(`[Entrega] Falha ao enviar registro para o canal de entregas (ID: ${canalEntregasId}) no servidor "${guild.name}" (${guild.id}): ${e.message}`));
        } else {
          throw new Error('canvas indisponível (buffer nulo)');
        }
      } catch (e) {
        console.error('[Entrega] Comprovante em canvas falhou, usando embed nativo como fallback:', e.message);
        const itemLinha = `${variante.emoji ? variante.emoji + ' ' : ''}1x ${p.titulo || variante.nome}`;
        const embedRecibo = new EmbedBuilder()
          .setColor(COR.success)
          .setAuthor({ name: clienteUser?.username || 'Cliente', iconURL: clienteUser ? clienteUser.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 }) : icon })
          .setTitle('<:positivo:1528401238197276702> Compra Realizada')
          .addFields(
            { name: 'Carrinho', value: `${itemLinha}\n\`${precoFinalStr}\`` },
            { name: 'Valor pago', value: `## ${precoFinalStr}` },
          )
          .setFooter(footerLoja(guild))
          .setTimestamp();
        const linkVitrineFallback = p.vitrineCanalId ? `https://discord.com/channels/${guildId}/${p.vitrineCanalId}` : null;
        const linkAvaliacaoFallback = p.canalAvaliacaoId ? `https://discord.com/channels/${guildId}/${p.canalAvaliacaoId}` : linkVitrineFallback;
        const rowEntrega = new ActionRowBuilder().addComponents(
          linkVitrineFallback
            ? new ButtonBuilder().setLabel('Comprar Novamente').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(ButtonStyle.Link).setURL(linkVitrineFallback)
            : new ButtonBuilder().setCustomId('loja_comprar').setLabel('Comprar').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(ButtonStyle.Danger),
          linkAvaliacaoFallback
            ? new ButtonBuilder().setLabel('Ver Feedbacks').setEmoji({ name: 'trofeu', id: '1533235838345937086' }).setStyle(ButtonStyle.Link).setURL(linkAvaliacaoFallback)
            : new ButtonBuilder().setCustomId(`loja_feedbacks_${p.id}`).setLabel('Ver Feedbacks').setEmoji({ name: 'trofeu', id: '1533235838345937086' }).setStyle(ButtonStyle.Secondary)
        );
        await canalEntregas.send({ embeds: [embedRecibo], components: [rowEntrega] })
          .catch((e2) => console.error(`[Entrega] Falha ao enviar registro (sem comprovante) para o canal de entregas (ID: ${canalEntregasId}) no servidor "${guild.name}" (${guild.id}): ${e2.message}`));
      }
    }

    if (cfg.canalLogsId) {
      const logs = await resolverCanal(guild, cfg.canalLogsId, 'Logs');
      logs?.send({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Venda Confirmada')
        .setDescription(`<:user:1532137085081878558> **Cliente:** <@${clienteId}>\n${variante.emoji || '<:carrinho:1524207445600370719>'} **Plano:** ${variante.nome}\n<:block:1533259816871657522> **Quantidade:** ${qtd}x\n<:money:1532503308961448096> **Valor:** ${precoFinalStr}`)
        .setFooter(footerLoja(guild))
        .setTimestamp()] }).catch((e) => console.error(`[Entrega] Falha ao enviar log de venda no servidor "${guild.name}" (${guild.id}): ${e.message}`));
    }

    if (canal) {
      // Sem mensagem no chat — só apaga o canal em 2 segundos.
      setTimeout(() => canal.delete().catch(() => {}), 2000);
    }
    if (canalId) { try { db.atualizarStatusCarrinhoPorCanal(canalId, 'pago'); } catch(e) {} }
    // CORREÇÃO (vazamento de memória — crash de 15/09/2026): esta é a
    // entrega AUTOMÁTICA (webhook MP/Efi Bank), que nunca limpava
    // metadadosPedido de commands/produto.js — a maioria das vendas reais
    // é automática, então cada uma deixava uma sobra permanente na
    // memória até o processo reiniciar.
    if (canalId) {
      try { require('../commands/produto').limparMetadadosPedido(canalId); } catch (e) { /* nunca deve travar a entrega */ }
    }
    // Backup automático pro Discord logo após uma venda, ESPERANDO terminar de subir.
    try { await require('../database/backupSqlite').fazerBackupAgora(client, 'venda concluída'); } catch (e) { /* nunca deve travar a entrega */ }

    // CORREÇÃO (auditoria - Bug 1): sinaliza sucesso pra quem chamou
    // (ex.: confirmarPagamentoVariante em produto.js) sem alterar em nada
    // o comportamento de quem ignora o retorno (webhook MP/EFI).
    return { ok: true };
  } catch (e) {
    console.error('[Entrega] Erro:', e.message);
    console.error('[Entrega][DIAGNOSTICO] Erro completo (guildId=' + guildId + ', canalId=' + canalId + '):', e.stack || e);
    return { ok: false, motivo: 'erro_interno', detalhe: e.message };
  } finally {
    // CORREÇÃO (auditoria — Bug 1): libera a trava sempre, mesmo em
    // caso de erro, pra não travar entregas futuras legítimas.
    _entregasEmAndamento.delete(_chave);
  }
}

async function copiarPix(interaction) {
  const cfg = getCfg(interaction.guildId);
  const chave = cfg.pix?.chave || db.getGuild(interaction.guildId).pix?.chave || 'Não configurado';
  await interaction.reply({ content: `<:pix:1528401197642551436> **Chave PIX:**\n\`${chave}\``, flags: 64 });
}

async function copiarCodigoPix(interaction) {
  const pedido = getPedido(interaction.channel.id);
  if (!pedido.pixCopiaCola) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Código PIX não disponível')
        .setDescription('> Gere o pagamento novamente clicando em **Ir para Pagamento**.')],
      flags: 64
    });
  }
  const pixTxtAttachment = new AttachmentBuilder(Buffer.from(pedido.pixCopiaCola, 'utf-8'), { name: 'codigo-pix.txt' });
  await interaction.reply({
    content: `${pedido.pixCopiaCola}`,
    files: [pixTxtAttachment],
    flags: 64
  });
}

async function copiarEntrega(interaction) {
  const registroId = interaction.customId.replace('loja_copiar_entrega_', '');
  const guildIdDoRegistro = registroId.split('-')[0];

  if (!guildIdDoRegistro) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Registro inválido.')], flags: 64 });
  }

  const historico = db.getGuild(guildIdDoRegistro).loja?.historicoCompras || [];
  const registro = historico.find(r => r.id === registroId);

  if (!registro) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Entrega não encontrada')
        .setDescription('> Este registro pode ter sido removido ou é muito antigo.')],
      flags: 64
    });
  }

  if (interaction.user.id !== registro.clienteId) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Esta entrega não pertence a você.')], flags: 64 });
  }

  // Entrega direta: só o conteúdo pronto pra copiar, sem reexplicar a
  // compra (isso já foi mostrado na hora da confirmação).
  if (registro.itensEntregues && registro.itensEntregues.length > 0) {
    return interaction.reply({
      content: `\`\`\`\n${registro.itensEntregues.join('\n')}\n\`\`\``,
      flags: 64
    });
  }

  return interaction.reply({
    content: '<:caixa:1524207165496099007> Este pedido não tem itens de estoque associados (licença/acesso ativado direto no servidor).',
    flags: 64
  });
}

async function minhasComprasBotao(interaction) {
  const guildId = interaction.customId.replace('loja_minhas_compras_', '');
  const historicoCompleto = db.getGuild(guildId).loja?.historicoCompras || [];
  const minhasCompras = historicoCompleto
    .filter(r => r.clienteId === interaction.user.id)
    .sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));

  if (minhasCompras.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('🛍️ Minhas Compras')
        .setDescription('> Você ainda não realizou nenhuma compra neste servidor.')],
      flags: 64
    });
  }

  const MAX_EXIBIDOS = 10;
  const exibidos = minhasCompras.slice(0, MAX_EXIBIDOS);

  const embed = new EmbedBuilder()
    .setColor(COR.primary)
    .setAuthor({ name: `Histórico de ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('🛍️ Minhas Compras')
    .setDescription(
      exibidos.map((r) => {
        const dataFormatada = new Date(r.dataISO).toLocaleDateString('pt-BR');
        const emojiTxt = r.varianteEmoji ? `${r.varianteEmoji} ` : '';
        return `${emojiTxt}Produto: ${r.produtoNome}\nVariante: ${r.varianteNome}\nData: ${dataFormatada}`;
      }).join('\n\n')
    )
    .setFooter({ text: minhasCompras.length > MAX_EXIBIDOS ? `Mostrando ${MAX_EXIBIDOS} de ${minhasCompras.length} compras` : `${minhasCompras.length} compra(s) no total` })
    .setTimestamp();

  const rows = [];
  for (let i = 0; i < exibidos.length; i += 5) {
    const lote = exibidos.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      lote.map((r, idx) =>
        new ButtonBuilder()
          .setCustomId(`loja_copiar_entrega_${r.id}`)
          .setLabel(`Ver Entrega ${i + idx + 1}`.slice(0, 80))
          .setEmoji('<:embed:1528400492982571111>')
          .setStyle(ButtonStyle.Secondary)
      )
    ));
  }

  return interaction.reply({ embeds: [embed], components: rows, flags: 64 });
}

async function avaliarCompra(interaction) {
  const registroId = interaction.customId.replace('loja_avaliar_', '');
  const guildIdDoRegistro = registroId.split('-')[0];

  const historico = db.getGuild(guildIdDoRegistro).loja?.historicoCompras || [];
  const registro = historico.find(r => r.id === registroId);

  if (!registro) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Registro de compra não encontrado.')], flags: 64 });
  }
  if (interaction.user.id !== registro.clienteId) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Esta compra não pertence a você.')], flags: 64 });
  }

  const modal = new ModalBuilder().setCustomId(`loja_modal_avaliar_${registroId}`).setTitle('⭐ Avaliar Compra');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('loja_avaliar_estrelas').setLabel('Nota (de 1 a 5)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 5').setMaxLength(1).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('loja_avaliar_texto').setLabel('Comentário (opcional)').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false)
    )
  );
  return interaction.showModal(modal);
}

async function jaPaguei(interaction) {
  const varianteKey = varianteToKey(interaction.customId.replace('loja_ja_paguei_', ''));
  const { guild, user } = interaction;
  const variante = getVarianteByKey(guild.id, varianteKey) || { nome: varianteKey, preco: 'R$ 0,00', emoji: '<:carrinho:1524207445600370719>' };
  const pedido = getPedido(interaction.channel.id);
  const { precoFinalStr } = calcularTotal(variante, pedido);

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.warn).setTitle('⏳ Pagamento Enviado para Análise').setDescription('> Nossa equipe irá verificar seu pagamento em breve.')],
    flags: 64
  });

  const admins = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot);
  const mencao = admins.map(m => `<@${m.id}>`).join(' ');

  const rowConfirmar = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loja_confirmar_${varianteKey}_${user.id}_${interaction.channel.id}`).setLabel('Confirmar Pagamento').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('loja_cancelar_confirmar').setLabel('Cancelar').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger),
  );

  await interaction.channel.send({
    content: `🚨 ${mencao}\n\n> O cliente <@${user.id}> informou que realizou o pagamento.\n> **Plano:** ${variante.nome} (${pedido.quantidade || 1}x) — ${precoFinalStr}`,
    components: [rowConfirmar]
  });
}

async function confirmarCancelamento(interaction) {
  const { user } = interaction;
  const isClienteOuAdmin = isAdmin(interaction.member) || interaction.channel.topic?.includes(user.id);
  if (!isClienteOuAdmin) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sem permissão.')], flags: 64 });
  const rowConf = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('loja_cancelar_executar').setLabel('Confirmar Cancelamento').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('loja_cancelar_voltar').setLabel('Voltar').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.warn).setTitle('⚠️ Cancelar Compra').setDescription('> Tem certeza que deseja cancelar esta compra?\n> Esta ação não pode ser desfeita.')],
    components: [rowConf], flags: 64
  });
}

async function executarCancelamento(interaction) {
  const { guild, user } = interaction;
  const isClienteOuAdmin = isAdmin(interaction.member) || interaction.channel.topic?.includes(user.id);
  if (!isClienteOuAdmin) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sem permissão.')], flags: 64 });
  const cfg = getCfg(guild.id);
  delete pedidosAtivos[interaction.channel.id];
  // Sem mensagem no chat — só confirma a interação silenciosamente.
  await interaction.deferUpdate().catch(() => {});
  if (cfg.canalLogsId) {
    const logs = guild.channels.cache.get(cfg.canalLogsId);
    logs?.send({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Compra Cancelada')
      .setDescription(`<:user:1532137085081878558> **Cliente:** <@${user.id}>\n<:canal:1524207214791884890> **Canal:** ${interaction.channel.name}\n<:relogio:1524207889441357917> <t:${Math.floor(Date.now() / 1000)}:F>`)
      .setFooter(footerLoja(guild))
      .setTimestamp()] }).catch(() => {});
  }
  setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
}

async function confirmarPagamento(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Apenas administradores podem confirmar pagamentos.')], flags: 64 });
  }
  // Formato do customId: loja_confirmar_<varianteKey>_<clienteId>_<canalCompraId>
  // canalCompraId é sempre um snowflake de 17-19 dígitos (só números).
  // Isso permite que o botão funcione tanto do canal de compra quanto do canal de logs.
  const partes = interaction.customId.replace('loja_confirmar_', '').split('_');
  let canalCompraId = null;
  let clienteId;
  let varianteKey;
  // Snowflake tem somente dígitos. Se o último segmento for só dígitos com
  // comprimento ≥ 17, é o canalCompraId (novo formato). Caso contrário, é
  // o formato antigo (clienteId no final) e usamos o canal atual.
  if (/^\d{17,20}$/.test(partes[partes.length - 1]) && /^\d{17,20}$/.test(partes[partes.length - 2])) {
    canalCompraId = partes[partes.length - 1];
    clienteId     = partes[partes.length - 2];
    varianteKey   = partes.slice(0, -2).join('_');
  } else {
    // Formato legado: sem canalCompraId no customId
    clienteId   = partes[partes.length - 1];
    varianteKey = partes.slice(0, -1).join('_');
    canalCompraId = interaction.channel.id;
  }
  const { guild, client } = interaction;

  // CORREÇÃO (auditoria — Bug 3): se esta mesma compra já está sendo
  // confirmada por outro clique/outro admin, ignora esta chamada
  // duplicada em vez de processar de novo.
  const _chaveConfirmacao = `confirmar:${guild.id}:${canalCompraId}:${clienteId}:${varianteKey}`;
  if (_confirmacoesEmAndamento.has(_chaveConfirmacao)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.warn).setTitle('<:relogio:1524207889441357917> Esta compra já está sendo confirmada, aguarde.')], flags: 64 }).catch(() => {});
  }
  _confirmacoesEmAndamento.add(_chaveConfirmacao);
  try {
    await interaction.deferUpdate();
    await entregarAutomatico({ client, guildId: guild.id, clienteId, varianteKey, canalId: canalCompraId });
  } finally {
    // CORREÇÃO (auditoria — Bug 3): libera a trava sempre, mesmo em
    // caso de erro, pra não bloquear confirmações futuras legítimas.
    _confirmacoesEmAndamento.delete(_chaveConfirmacao);
  }
}

async function verFeedbacks(interaction) {
  const cfg = getCfg(interaction.guildId);
  const feedbacks = cfg.feedbacks || [];
  if (feedbacks.length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('<a:trofeu:1532499321008951538> Feedbacks').setDescription('> Nenhum feedback ainda.')], flags: 64 });
  const lista = feedbacks.slice(-10).reverse().map((f, i) => `**${i + 1}.** <@${f.userId}> — ${f.estrelas} ⭐\n> ${f.texto}`).join('\n\n');
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('<a:trofeu:1532499321008951538> Feedbacks dos Clientes').setDescription(lista).setTimestamp()], flags: 64 });
}

async function abrirModalCampo(interaction, campo, titulo, label, style, maxLen) {
  const atual = db.getGuild(interaction.guildId).loja?.produto?.[campo] || '';
  const modal = new ModalBuilder().setCustomId(`prod_modal_${campo}`).setTitle(titulo);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(`prod_input_${campo}`).setLabel(label)
      .setStyle(style).setValue(atual).setMaxLength(maxLen).setRequired(true)
  ));
  await interaction.showModal(modal);
}

async function abrirModalEstoque(interaction) {
  const modal = new ModalBuilder().setCustomId('prod_modal_estoque').setTitle('<:caixa:1524207165496099007> Adicionar Estoque');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('prod_input_estoque')
      .setLabel('Produtos (1 por linha)').setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Conta1:senha1\nConta2:senha2\nKEY-123').setRequired(true).setMaxLength(4000)
  ));
  await interaction.showModal(modal);
}

async function abrirModalCupom(interaction) {
  const varianteKey = interaction.customId.replace('loja_aplicar_cupom_', '');
  const modal = new ModalBuilder().setCustomId(`loja_modal_cupom_${varianteKey}`).setTitle('<:cupom:1524209015008002148> Aplicar Cupom de Desconto');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('loja_input_cupom').setLabel('Código do Cupom')
      .setStyle(TextInputStyle.Short).setPlaceholder('Ex: DESCONTO10').setRequired(true).setMaxLength(50)
  ));
  await interaction.showModal(modal);
}

async function abrirModalQtd(interaction) {
  const varianteKey = interaction.customId.replace('loja_alterar_qtd_', '');
  const modal = new ModalBuilder().setCustomId(`loja_modal_qtd_${varianteKey}`).setTitle('<:editar:1528400388137549864> Alterar Quantidade');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('loja_input_qtd').setLabel('Quantidade desejada')
      .setStyle(TextInputStyle.Short).setPlaceholder('Ex: 2').setRequired(true).setMaxLength(3)
  ));
  await interaction.showModal(modal);
}

async function abrirModalCriarVariante(interaction) {
  const modal = new ModalBuilder().setCustomId('prod_modal_variante_criar').setTitle('<:config2:1524208021071462533> Criar Variante');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('var_nome').setLabel('Nome da variante').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('var_preco').setLabel('Preço (ex: R$ 29,90)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('var_emoji').setLabel('Emoji (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setPlaceholder('🛒')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('var_estoque').setLabel('Estoque (deixe vazio para ilimitado)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)
    ),
  );
  await interaction.showModal(modal);
}

async function abrirModalRemoverVariante(interaction) {
  const modal = new ModalBuilder().setCustomId('prod_modal_variante_remover').setTitle('<:apagar:1524206738885050388> Remover Variante');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('var_nome_remover').setLabel('Nome da variante a remover')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
  ));
  await interaction.showModal(modal);
}

async function verEstoque(interaction) {
  const estoque = db.getGuild(interaction.guildId).loja?.estoque || [];
  if (estoque.length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:caixa:1524207165496099007> Estoque Vazio')], flags: 64 });
  const lista = estoque.map((item, i) => `**${i + 1}.** \`${item}\``).join('\n').slice(0, 2000);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.gold).setTitle(`<:caixa:1524207165496099007> Estoque — ${estoque.length} item(s)`).setDescription(lista).setTimestamp()], flags: 64 });
}

async function limparEstoque(interaction) {
  db.updateGuild(interaction.guildId, 'loja.estoque', []);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:apagar:1524206738885050388> Estoque Limpo!').setDescription('> Todos os itens foram removidos.')], flags: 64 });
}

async function abrirSelectCor(interaction) {
  const select = new StringSelectMenuBuilder().setCustomId('prod_cor_sel_menu').setPlaceholder('Escolha a cor do botão Comprar')
    .addOptions([
      { label: 'Vermelho', emoji: '<:npertubar:1533081528966316083>', value: 'prod_cor_sel_danger' },
      { label: 'Verde', emoji: '<:online:1533081467918221565>', value: 'prod_cor_sel_success' },
      { label: 'Azul', emoji: '🔵', value: 'prod_cor_sel_primary' },
      { label: 'Cinza', emoji: '⚫', value: 'prod_cor_sel_secondary' },
    ]);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('🎨 Escolha a cor do botão Comprar')], components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function verCupons(interaction) {
  const cupons = db.getGuild(interaction.guildId).loja?.cupons || {};
  if (Object.keys(cupons).length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:cupom:1524209015008002148> Nenhum cupom').setDescription('> Use `/produto cupom criar`')], flags: 64 });
  const lista = Object.entries(cupons).map(([k, v]) => `\`${k}\` — **${v.desconto}%** — ${v.usos} uso(s)`).join('\n');
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('<:cupom:1524209015008002148> Cupons Ativos').setDescription(lista)], flags: 64 });
}

async function backupEstoque(interaction) {
  const estoque = db.getGuild(interaction.guildId).loja?.estoque || [];
  if (estoque.length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:caixa:1524207165496099007> Estoque Vazio')], flags: 64 });
  const buffer = Buffer.from(estoque.join('\n'), 'utf-8');
  const arquivo = new AttachmentBuilder(buffer, { name: `estoque-${Date.now()}.txt` });
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:import1:1533080710544625684> Backup do Estoque').setDescription(`> **${estoque.length}** item(s) exportados.`)], files: [arquivo], flags: 64 });
}

async function exportarConfig(interaction) {
  const loja = db.getGuild(interaction.guildId).loja || {};
  const exportar = { produto: loja.produto || {}, planos: loja.planos || {}, cupons: loja.cupons || {}, variantes: loja.variantes || [] };
  const buffer = Buffer.from(JSON.stringify(exportar, null, 2), 'utf-8');
  const arquivo = new AttachmentBuilder(buffer, { name: `config-produto-${Date.now()}.json` });
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:save:1533080403810713773> Configurações Exportadas!')], files: [arquivo], flags: 64 });
}

async function confirmarDeletar(interaction) {
  const rowConf = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_deletar_executar').setLabel('Sim, deletar tudo').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('prod_deletar_voltar').setLabel('Cancelar').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('⚠️ Deletar Produto').setDescription('> Tem certeza? Isso irá apagar **todas** as configurações:\n> estoque, cupons, variantes, produto e o painel do canal.')],
    components: [rowConf], flags: 64
  });
}

async function executarDeletar(interaction) {
  try {
    const cfg = db.getGuild(interaction.guildId).loja || {};
    if (cfg.painelMsgId && cfg.painelCanalId) {
      const canal = interaction.guild.channels.cache.get(cfg.painelCanalId);
      if (canal) {
        const msg = await canal.messages.fetch(cfg.painelMsgId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
      }
    }
  } catch (e) { console.error('[Deletar] Erro ao apagar embed:', e.message); }

  db.updateGuild(interaction.guildId, 'loja.produto', {});
  db.updateGuild(interaction.guildId, 'loja.estoque', []);
  db.updateGuild(interaction.guildId, 'loja.cupons', {});
  db.updateGuild(interaction.guildId, 'loja.variantes', []);
  db.updateGuild(interaction.guildId, 'loja.painelMsgId', null);
  db.updateGuild(interaction.guildId, 'loja.painelCanalId', null);

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:apagar:1524206738885050388> Produto Deletado!').setDescription('> Todas as configurações foram resetadas e o painel foi removido do canal.')],
    components: []
  });
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'loja_comprar')                return abrirSelectPlanos(interaction);
  if (id === 'loja_copiar_pix')             return copiarPix(interaction);
  if (id.startsWith('loja_copiar_copiacola_')) return copiarCodigoPix(interaction);
  if (id.startsWith('loja_copiar_entrega_')) return copiarEntrega(interaction);
  if (id.startsWith('loja_ir_pagamento_'))  return irParaPagamento(interaction);
  if (id.startsWith('loja_aplicar_cupom_')) return abrirModalCupom(interaction);
  if (id.startsWith('loja_alterar_qtd_'))   return abrirModalQtd(interaction);
  if (id.startsWith('loja_ja_paguei_'))     return jaPaguei(interaction);
  if (id.startsWith('loja_confirmar_'))     return confirmarPagamento(interaction);
  if (id === 'loja_cancelar_confirmar')     return confirmarCancelamento(interaction);
  if (id === 'loja_cancelar_executar')      return executarCancelamento(interaction);
  if (id === 'loja_cancelar_voltar')        return interaction.update({ components: [] });
  if (id === 'loja_feedbacks')              return verFeedbacks(interaction);
  if (id.startsWith('loja_minhas_compras_')) return minhasComprasBotao(interaction);
  if (id.startsWith('loja_avaliar_'))       return avaliarCompra(interaction);

  if (id === 'prod_editar_titulo')    return abrirModalCampo(interaction, 'titulo',    '<:editar:1528400388137549864> Editar Título',    'Título',       TextInputStyle.Short,     100);
  if (id === 'prod_editar_descricao') return abrirModalCampo(interaction, 'descricao', '📝 Editar Descrição', 'Descrição',    TextInputStyle.Paragraph, 1000);
  if (id === 'prod_editar_preco')     return abrirModalCampo(interaction, 'preco',     '<:money:1532503308961448096> Editar Preço',     'Ex: R$ 29,90', TextInputStyle.Short,     50);
  if (id === 'prod_editar_banner')    return abrirModalCampo(interaction, 'banner',    '<:foto:1533080648196292679> Editar Thumbnail', 'URL imagem',   TextInputStyle.Short,     500);
  if (id === 'prod_editar_footer')    return abrirModalCampo(interaction, 'footer',    '<:cupom:1524209015008002148> Editar Footer',    'Footer',       TextInputStyle.Short,     100);
  if (id === 'prod_estoque_add')      return abrirModalEstoque(interaction);
  if (id === 'prod_estoque_ver')      return verEstoque(interaction);
  if (id === 'prod_estoque_limpar')   return limparEstoque(interaction);
  if (id === 'prod_cor_botao')        return abrirSelectCor(interaction);
  if (id === 'prod_salvar')           return publicar(interaction);
  if (id === 'prod_btn_cargo')        return configurarCargo(interaction);

  if (id === 'prod_btn_variantes')    return gerenciarVariantes(interaction);
  if (id === 'prod_variante_criar')   return abrirModalCriarVariante(interaction);
  if (id === 'prod_variante_listar')  return gerenciarVariantes(interaction);
  if (id === 'prod_variante_remover') return abrirModalRemoverVariante(interaction);
  if (id === 'prod_variante_voltar')  return interaction.update({ components: [] });

  if (id === 'prod_btn_cupons')       return verCupons(interaction);
  if (id === 'prod_btn_backup')       return backupEstoque(interaction);
  if (id === 'prod_btn_exportar')     return exportarConfig(interaction);
  if (id === 'prod_deletar_confirm')  return confirmarDeletar(interaction);
  if (id === 'prod_deletar_executar') return executarDeletar(interaction);
  if (id === 'prod_deletar_voltar')   return interaction.update({ components: [] });
}

async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  if (id === 'loja_sel_plano')          return criarCanalCompra(interaction);
  if (id === 'prod_sel_canal_publicar') return publicarNoCanal(interaction);
  if (id === 'prod_sel_cargo') {
    const cargoId = interaction.values[0];
    db.updateGuild(interaction.guildId, 'loja.produto.cargoId', cargoId);
    const { atualizarPainelMsg } = require('../commands/produto');
    await atualizarPainelMsg(interaction.guildId, interaction.guild, interaction.client);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Cargo Configurado!').setDescription(`> Cargo <@&${cargoId}> será entregue automaticamente após cada compra.`)],
      components: []
    });
  }
  if (id === 'prod_cor_sel_menu') {
    const cor = interaction.values[0].replace('prod_cor_sel_', '');
    db.updateGuild(interaction.guildId, 'loja.produto.corBotao', cor);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Cor Salva!').setDescription(`> Botão Comprar agora é **${cor}**.`)], flags: 64 });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  // ── Submissão do modal "⭐ Avaliar Compra" ──────────────────────────
  if (id.startsWith('loja_modal_avaliar_')) {
    const registroId = id.replace('loja_modal_avaliar_', '');
    const guildIdDoRegistro = registroId.split('-')[0];
    const estrelasStr = interaction.fields.getTextInputValue('loja_avaliar_estrelas').trim();
    const texto = interaction.fields.getTextInputValue('loja_avaliar_texto').trim();
    const estrelas = parseInt(estrelasStr, 10);

    if (isNaN(estrelas) || estrelas < 1 || estrelas > 5) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Nota inválida').setDescription('> Digite um número de 1 a 5.')],
        flags: 64
      });
    }

    const feedbacks = db.getGuild(guildIdDoRegistro).loja?.feedbacks || [];
    feedbacks.push({
      userId: interaction.user.id,
      estrelas,
      texto: texto || '(sem comentário)',
      dataISO: new Date().toISOString(),
    });
    db.updateGuild(guildIdDoRegistro, 'loja.feedbacks', feedbacks);

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('⭐ Avaliação enviada!')
        .setDescription(`> Obrigado pelo seu feedback!\n> Nota: ${'⭐'.repeat(estrelas)}`)],
      flags: 64
    });
  }

  if (id === 'prod_modal_variante_criar') {
    const nome       = interaction.fields.getTextInputValue('var_nome').trim();
    const preco      = interaction.fields.getTextInputValue('var_preco').trim();
    const emoji      = interaction.fields.getTextInputValue('var_emoji').trim() || '<:carrinho:1524207445600370719>';
    const estoqueStr = interaction.fields.getTextInputValue('var_estoque').trim();
    const estoque    = estoqueStr ? parseInt(estoqueStr) : null;

    if (!nome || !preco) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Informe nome e preço.')], flags: 64 });
    }

    const variantes = db.getGuild(interaction.guildId).loja?.variantes || [];

    // CORREÇÃO: case-insensitive, igual ao produto.js — impede criar duas
    // variantes com nomes iguais diferindo só em maiúsculas/minúsculas.
    const nomeLower = nome.toLowerCase();
    const jaExiste = variantes.some(v => v.nome.toLowerCase() === nomeLower);
    if (jaExiste) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante já existe')
          .setDescription(`> Já existe uma variante chamada \`${nome}\` (comparação ignora maiúsculas/minúsculas).`)],
        flags: 64
      });
    }

    variantes.push({ nome, preco, emoji, estoque: isNaN(estoque) ? null : estoque, criado: new Date().toISOString() });
    db.updateGuild(interaction.guildId, 'loja.variantes', variantes);

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:config2:1524208021071462533> Variante Criada!')
        .setDescription(`> ${emoji} **${nome}** — ${preco} | Estoque: ${textoEstoque(isNaN(estoque) ? null : estoque)}`)],
      flags: 64
    });
    return;
  }

  if (id === 'prod_modal_variante_remover') {
    const nome = interaction.fields.getTextInputValue('var_nome_remover').trim();
    const variantes = db.getGuild(interaction.guildId).loja?.variantes || [];
    const novas = variantes.filter(v => v.nome.toLowerCase() !== nome.toLowerCase());

    if (novas.length === variantes.length) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante não encontrada.').setDescription(`> Nenhuma variante com o nome \`${nome}\`.`)], flags: 64 });
    }

    db.updateGuild(interaction.guildId, 'loja.variantes', novas);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:apagar:1524206738885050388> Variante Removida!').setDescription(`> **${nome}** foi removida.`)], flags: 64 });
  }

  // ── Cupom: agora recalcula com base na quantidade do pedido ──
  if (id.startsWith('loja_modal_cupom_')) {
    const varianteKey = varianteToKey(id.replace('loja_modal_cupom_', ''));
    const codigo = interaction.fields.getTextInputValue('loja_input_cupom').toUpperCase().trim();
    const cupons = getCfg(interaction.guildId).cupons || {};
    if (!cupons[codigo]) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Cupom inválido').setDescription(`> O código \`${codigo}\` não existe ou expirou.`)], flags: 64 });
    }
    const cupom = cupons[codigo];
    const variante = getVarianteByKey(interaction.guildId, varianteKey);
    if (!variante) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao aplicar cupom')], flags: 64 });

    const pedido = getPedido(interaction.channel.id);
    pedido.varianteKey = varianteKey;
    pedido.cupom = { codigo, desconto: cupom.desconto };

    const { precoFinalStr, subtotalStr } = calcularTotal(variante, pedido);

    cupons[codigo].usos = (cupons[codigo].usos || 0) + 1;
    db.updateGuild(interaction.guildId, 'loja.cupons', cupons);

    try {
      const cfg = getCfg(interaction.guildId);
      const novaEmbed = buildRevisaoEmbed(interaction.user, variante, cfg, pedido, interaction.guild);
      const components = buildRevisaoComponents(varianteKey);
      const msgs = await interaction.channel.messages.fetch({ limit: 5 });
      const msgRevisao = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('Revisão'));
      if (msgRevisao) await msgRevisao.edit({ embeds: [novaEmbed], components });
    } catch (e) { console.error('[Cupom]', e.message); }

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:cupom:1524209015008002148> Cupom Aplicado!')
        .setDescription(`> Código: \`${codigo}\`\n> Desconto: **${cupom.desconto}%**\n> De: ~~${subtotalStr}~~ → **${precoFinalStr}**`)],
      flags: 64
    });
  }

  // ── Alterar quantidade: recalcula total, atualiza Revisão/PIX/entrega ──
  if (id.startsWith('loja_modal_qtd_')) {
    const varianteKey = varianteToKey(id.replace('loja_modal_qtd_', ''));
    const qtdStr = interaction.fields.getTextInputValue('loja_input_qtd');
    const num = parseInt(qtdStr);

    if (isNaN(num) || num < 1) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Quantidade inválida').setDescription('> Digite um número maior que 0.')], flags: 64 });
    }

    const cfg = getCfg(interaction.guildId);
    const variante = getVarianteByKey(interaction.guildId, varianteKey) || { nome: varianteKey, preco: 'R$ 0,00', emoji: '<:carrinho:1524207445600370719>' };

    // checa limite de estoque, se a variante tiver estoque definido
    if (variante.estoque != null && num > variante.estoque) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Estoque insuficiente')
          .setDescription(`> Disponível: **${variante.estoque}** unidade(s).\n> Quantidade solicitada: **${num}**.`)],
        flags: 64
      });
    }

    const pedido = getPedido(interaction.channel.id);
    pedido.varianteKey = varianteKey;
    pedido.quantidade = num;

    const { precoFinalStr } = calcularTotal(variante, pedido);

    // atualiza a embed de Revisão do Pedido (se existir)
    try {
      const novaEmbed = buildRevisaoEmbed(interaction.user, variante, cfg, pedido, interaction.guild);
      const components = buildRevisaoComponents(varianteKey);
      const msgs = await interaction.channel.messages.fetch({ limit: 10 });
      const msgRevisao = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('Revisão'));
      if (msgRevisao) await msgRevisao.edit({ embeds: [novaEmbed], components });

      // se já existe uma embed de pagamento PIX neste canal, atualiza ela também
      const msgPix = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('Pagamento PIX'));
      if (msgPix) {
        const pixChaveRaw = cfg.pix?.chave || db.getGuild(interaction.guildId).pix?.chave || null;
        const pixChave = pixChaveRaw ? pixChaveRaw.replace(/[.\-\/\s]/g, '').trim() : null;
        const valorFloat = precoParaFloat(precoFinalStr);

        const { embed: embedPix, files: filesPix, components: componentsPix } = await buildPagamentoPix({
          guild: interaction.guild, pixChave, valorFloat, qtd: num, precoFinalStr, varianteKey
        });

        if (pixChave && valorFloat > 0) {
          try { pedido.pixCopiaCola = gerarPixCopiaCola(pixChave, valorFloat); } catch (e) {}
        }

        await msgPix.edit({ embeds: [embedPix], components: componentsPix, files: filesPix });
      }
    } catch (e) { console.error('[Quantidade]', e.message); }

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Quantidade Atualizada')
        .setDescription(`> Quantidade: **${num}x**\n> Novo total: **${precoFinalStr}**`)],
      flags: 64
    });
  }

  if (id === 'loja_modal_produto') {
    const titulo    = interaction.fields.getTextInputValue('loja_titulo');
    const descricao = interaction.fields.getTextInputValue('loja_descricao');
    const footer    = interaction.fields.getTextInputValue('loja_footer');
    const banner    = interaction.fields.getTextInputValue('loja_banner') || null;
    db.updateGuild(interaction.guildId, 'loja.titulo', titulo);
    db.updateGuild(interaction.guildId, 'loja.descricao', descricao);
    db.updateGuild(interaction.guildId, 'loja.footer', footer);
    db.updateGuild(interaction.guildId, 'loja.banner', banner);
    return respostaModalComBotao(interaction, 'Produto');
  }

  const campos = ['titulo', 'descricao', 'preco', 'banner', 'footer'];
  for (const campo of campos) {
    if (id === `prod_modal_${campo}`) {
      const valor = interaction.fields.getTextInputValue(`prod_input_${campo}`);
      db.updateGuild(interaction.guildId, `loja.produto.${campo}`, valor);
      return respostaModalComBotao(interaction, campo);
    }
  }

  if (id === 'prod_modal_estoque') {
    const texto = interaction.fields.getTextInputValue('prod_input_estoque');
    const novos = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const atual = db.getGuild(interaction.guildId).loja?.estoque || [];
    const combinado = [...atual, ...novos];
    db.updateGuild(interaction.guildId, 'loja.estoque', combinado);
    return respostaModalComBotao(interaction, `Estoque (+${novos.length} itens, total ${combinado.length})`);
  }
}

module.exports = {
  handleButton, handleSelectMenu, handleModal, publicar, buildLojaEmbed, entregarAutomatico,
  // Exportados para reuso pelo fluxo cliente_comprar_variante / cliente_comprar_direto_
  // em commands/produto.js — mantém o MESMO objeto pedidosAtivos em memória (estado
  // compartilhado) em vez de duplicar a lógica de pedido/variante em outro arquivo.
  getPedido, limparPedido, varianteToKey, getVarianteByKey, getVarianteEProdutoId, isAdmin, getCfg,
  calcularTotal, precoParaFloat, floatParaPreco, resolverCanal, getEstoqueRealVariante,
};
