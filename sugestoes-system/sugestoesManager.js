'use strict';
/**
 * KAEL — Sistema de Sugestões
 * Envio: /sugestao (modal → escolher canal → publica embed + abre Tópico).
 * Administração: /painel → 💡 Sugestões (Histórico + Configuração).
 * Dados: db.getGuild(guildId).sugestoes (SQLite, isolado por guild).
 */
const crypto = require('crypto');
const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('../database/db');
console.log('[Sugestoes] sugestoesManager.js carregado — versão com botão sug_open_modal (fix v2).');

const MAX_ITEMS_LISTADOS = 25;    // limite de opções de um StringSelectMenu
const PENDING_TTL_MS = 10 * 60 * 1000;
const VOTE_DEBOUNCE_MS = 1500;
const STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
const STATUS_LABEL = { pending: '🟡 Em análise', approved: '🟢 Aprovada', rejected: '🔴 Não aprovada' };
const STATUS_COLOR = { pending: 0xFEE75C, approved: 0x57F287, rejected: 0xED4245 };
const NEED_PERMS_CANAL = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads,
];

// ── Config / persistência ──────────────────────────────────────────
function defaults() {
  return {
    config: {
      title: 'Sugestões do servidor',
      description: 'Tem uma ideia para melhorar o servidor? Use **/sugestao** para enviar. A comunidade vota e a equipe decide.',
      imageUrl: null,
      channelId: null,
      publishedMessage: null,
    },
    items: {},
  };
}
function getData(guildId) {
  const raw = db.getGuild(guildId).sugestoes || {};
  const d = defaults();
  return { config: { ...d.config, ...(raw.config || {}) }, items: { ...(raw.items || {}) } };
}
function saveData(guildId, data) { db.updateGuild(guildId, 'sugestoes', data); return data; }

const newId = () => `s${Date.now().toString(36).slice(-5)}${crypto.randomBytes(2).toString('hex')}`;

function validarUrl(u) {
  try {
    const s = String(u || '').trim();
    const x = new URL(s);
    return (x.protocol === 'https:' || x.protocol === 'http:') && s.length <= 2000 && !/\s/.test(s) ? s : null;
  } catch { return null; }
}
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
function discordErro(e) {
  const c = e?.code;
  if (c === 50013 || c === 50001) return 'Sem permissão para acessar/enviar mensagens/criar tópicos nesse canal.';
  if (c === 10003) return 'Canal não encontrado.';
  if (c === 10008) return 'Mensagem não encontrada (pode ter sido apagada).';
  return cut(e?.message || 'erro desconhecido', 200);
}
function validarCanal(guild, channelId) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || ch.type !== ChannelType.GuildText) return 'Escolha um canal de texto comum (tópicos não funcionam em fóruns/anúncios).';
  const perms = ch.permissionsFor(guild.members.me);
  if (!perms || !perms.has(NEED_PERMS_CANAL)) return `O bot precisa de Ver Canal, Enviar Mensagens, Inserir Links e Criar Tópicos Públicos em ${ch}.`;
  return null;
}

async function checarAdmin(interaction) {
  const g = interaction.guild;
  let motivo = null;
  if (!interaction.inGuild() || !g || interaction.guildId !== g.id) motivo = 'Use isso dentro do servidor.';
  else if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) motivo = 'Você precisa ser Administrador para isso.';
  if (!motivo) return true;
  const p = { content: `❌ ${motivo}`, flags: MessageFlags.Ephemeral };
  if (!interaction.replied && !interaction.deferred) await interaction.reply(p).catch(() => {});
  else await interaction.followUp(p).catch(() => {});
  return false;
}

// ── Embed + botões da sugestão publicada ───────────────────────────
function embedSugestao(item) {
  const e = new EmbedBuilder()
    .setColor(STATUS_COLOR[item.status])
    .setTitle(`💡 ${cut(item.title, 240)}`)
    .setDescription(cut(item.description, 4000))
    .setAuthor({ name: item.authorTag, iconURL: item.authorAvatar || undefined })
    .addFields({ name: 'Status', value: STATUS_LABEL[item.status], inline: true })
    .setFooter({ text: `ID: ${item.id}` })
    .setTimestamp(item.createdAt);
  return e;
}
function rowsSugestao(item) {
  const ativo = item.status === STATUS.PENDING;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sug_vote:${item.id}:up`).setLabel(`Apoiar (${item.support.length})`).setEmoji('👍').setStyle(ButtonStyle.Secondary).setDisabled(!ativo),
    new ButtonBuilder().setCustomId(`sug_vote:${item.id}:down`).setLabel(`Não apoiar (${item.against.length})`).setEmoji('👎').setStyle(ButtonStyle.Secondary).setDisabled(!ativo),
    new ButtonBuilder().setCustomId(`sug_approve:${item.id}`).setLabel(ativo ? 'Aprovar Sugestão' : 'Decidida').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!ativo),
  )];
}
async function atualizarMensagem(guild, item) {
  const ch = guild.channels.cache.get(item.channelId);
  if (!ch?.isTextBased?.()) return;
  const msg = await ch.messages.fetch(item.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [embedSugestao(item)], components: rowsSugestao(item) }).catch(() => {});
}

// ── Envio: /sugestao ────────────────────────────────────────────────
function abrirModalNovaSugestao(interaction) {
  return interaction.showModal(new ModalBuilder().setCustomId('sug_modal_new').setTitle('Nova sugestão').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titulo').setLabel('Título').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)),
  ));
}

const pendentes = new Map(); // token → { guildId, userId, title, description, expires }
function purgarPendentes(now = Date.now()) { for (const [t, p] of pendentes) if (p.expires <= now) pendentes.delete(t); }

async function handleModalNovaSugestao(interaction) {
  const titulo = interaction.fields.getTextInputValue('titulo').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  if (!titulo || !descricao) return interaction.reply({ content: '❌ Título e descrição são obrigatórios.', flags: MessageFlags.Ephemeral });
  purgarPendentes();
  const token = crypto.randomBytes(6).toString('hex');
  pendentes.set(token, { guildId: interaction.guildId, userId: interaction.user.id, titulo, descricao, expires: Date.now() + PENDING_TTL_MS });

  const { config } = getData(interaction.guildId);
  const sel = new ChannelSelectMenuBuilder().setCustomId(`sug_sel_channel:${token}`).setPlaceholder('Canal onde a sugestão será publicada')
    .setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  if (config.channelId && interaction.guild.channels.cache.has(config.channelId)) sel.setDefaultChannels(config.channelId);
  return interaction.reply({
    content: `**${cut(titulo, 100)}**\nEm qual canal essa sugestão deve ser publicada?`,
    components: [new ActionRowBuilder().addComponents(sel)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSelecaoCanalSugestao(interaction) {
  const token = interaction.customId.split(':')[1];
  const p = pendentes.get(token);
  if (!p || p.expires <= Date.now()) { pendentes.delete(token); return interaction.update({ content: '❌ Essa sugestão expirou. Use `/sugestao` novamente.', components: [] }); }
  if (p.userId !== interaction.user.id) return interaction.reply({ content: '❌ Essa sugestão não é sua.', flags: MessageFlags.Ephemeral });
  const g = interaction.guild;
  const channelId = interaction.values[0];
  const err = validarCanal(g, channelId);
  if (err) return interaction.update({ content: `❌ ${err}`, components: interaction.message.components });

  const item = {
    id: newId(), guildId: g.id, authorId: p.userId,
    authorTag: interaction.user.username, authorAvatar: interaction.user.displayAvatarURL?.() || null,
    title: p.titulo, description: p.descricao,
    channelId, messageId: null, threadId: null,
    status: STATUS.PENDING, support: [], against: [],
    createdAt: Date.now(), decidedBy: null, decidedAt: null,
  };
  const ch = g.channels.cache.get(channelId);
  let msg;
  try {
    msg = await ch.send({ embeds: [embedSugestao(item)], components: rowsSugestao(item) });
  } catch (e) {
    return interaction.update({ content: `❌ Falha ao publicar: ${discordErro(e)}`, components: [] });
  }
  item.messageId = msg.id;
  try {
    const thread = await msg.startThread({ name: cut(item.title, 90), autoArchiveDuration: 1440, reason: 'Discussão da sugestão' });
    item.threadId = thread.id;
  } catch (e) {
    console.error('[Sugestoes] Falha ao criar tópico:', e.message); // publicação já feita; segue sem tópico
  }

  const data = getData(g.id);
  data.items[item.id] = item;
  saveData(g.id, data);
  pendentes.delete(token);

  return interaction.update({ content: `✅ Sugestão publicada em <#${channelId}>${item.threadId ? ` — [tópico criado](https://discord.com/channels/${g.id}/${channelId}/${item.threadId})` : ''}.`, components: [] });
}

// ── Votos + aprovação rápida (botões públicos da sugestão) ─────────
const votando = new Set();
async function handleVoto(interaction) {
  const [, id, direcao] = interaction.customId.split(':');
  const g = interaction.guild;
  if (!interaction.inGuild() || !g) return interaction.reply({ content: '❌ Use isso dentro do servidor.', flags: MessageFlags.Ephemeral });
  const data = getData(g.id);
  const item = data.items[id];
  if (!item) return interaction.reply({ content: '❌ Sugestão não encontrada (pode ter sido removida).', flags: MessageFlags.Ephemeral });
  if (item.status !== STATUS.PENDING) return interaction.reply({ content: 'Essa sugestão já foi decidida e não recebe mais votos.', flags: MessageFlags.Ephemeral });

  const key = `${g.id}:${id}:${interaction.user.id}:${direcao}`;
  const now = Date.now();
  if (votando.has(key)) return interaction.reply({ content: 'Calma! Aguarde um instante.', flags: MessageFlags.Ephemeral });
  votando.add(key);
  setTimeout(() => votando.delete(key), VOTE_DEBOUNCE_MS);

  const uid = interaction.user.id;
  const jaApoiou = item.support.includes(uid);
  const jaNaoApoiou = item.against.includes(uid);
  item.support = item.support.filter((x) => x !== uid);
  item.against = item.against.filter((x) => x !== uid);
  if (direcao === 'up' && !jaApoiou) item.support.push(uid);
  if (direcao === 'down' && !jaNaoApoiou) item.against.push(uid);
  saveData(g.id, data);

  try {
    await interaction.update({ embeds: [embedSugestao(item)], components: rowsSugestao(item) });
  } catch (e) {
    console.error('[Sugestoes] Falha ao atualizar votos:', e.message);
  }
}

async function decidirSugestao(guild, item, novoStatus, decisor) {
  item.status = novoStatus;
  item.decidedBy = decisor.id;
  item.decidedAt = Date.now();
  const data = getData(guild.id);
  data.items[item.id] = item;
  saveData(guild.id, data);
  await atualizarMensagem(guild, item);
  if (item.threadId) {
    const thread = guild.channels.cache.get(item.threadId) || await guild.channels.fetch(item.threadId).catch(() => null);
    if (thread) {
      const txt = novoStatus === STATUS.APPROVED ? `✅ Sugestão **aprovada** por <@${decisor.id}>.` : `❌ Sugestão **não aprovada** por <@${decisor.id}>.`;
      await thread.send({ content: txt, allowedMentions: { parse: [] } }).catch(() => {});
      await thread.setArchived(true, 'Sugestão decidida').catch(() => {});
    }
  }
}

async function handleAprovarRapido(interaction) {
  const id = interaction.customId.split(':')[1];
  const g = interaction.guild;
  if (!interaction.inGuild() || !g) return interaction.reply({ content: '❌ Use isso dentro do servidor.', flags: MessageFlags.Ephemeral });
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Você não tem permissão para aprovar sugestões.', flags: MessageFlags.Ephemeral });
  }
  const data = getData(g.id);
  const item = data.items[id];
  if (!item) return interaction.reply({ content: '❌ Sugestão não encontrada.', flags: MessageFlags.Ephemeral });
  if (item.status !== STATUS.PENDING) return interaction.reply({ content: 'Essa sugestão já foi decidida.', flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate().catch(() => {});
  await decidirSugestao(g, item, STATUS.APPROVED, interaction.user);
}

// ── UI do painel administrativo ────────────────────────────────────
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const txt = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 3800));
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
function container(header, notice) {
  const c = new ContainerBuilder().setAccentColor(0x000000).addTextDisplayComponents(txt(`# KAEL — Sistema de Sugestões\n-# ${header}`));
  if (notice) c.addTextDisplayComponents(txt(`> ⚠️ ${notice}`));
  return c.addSeparatorComponents(sep());
}

function ordenarItens(items) {
  const ordem = { [STATUS.PENDING]: 0, [STATUS.APPROVED]: 1, [STATUS.REJECTED]: 2 };
  return Object.values(items).sort((a, b) => (ordem[a.status] - ordem[b.status]) || (b.createdAt - a.createdAt));
}

function screenHome(g, data, notice) {
  const n = Object.values(data.items).length;
  const pend = Object.values(data.items).filter((i) => i.status === STATUS.PENDING).length;
  return container('Histórico de sugestões e configuração do canal.', notice)
    .addTextDisplayComponents(txt(
      `**Sugestões recebidas:** \`${n}\`  •  **Em análise:** \`${pend}\`\n` +
      `**Canal padrão:** ${data.config.channelId ? `<#${data.config.channelId}>` : '`Não configurado`'}\n` +
      '-# Envie sugestões com **/sugestao**. Aqui você acompanha e decide.'))
    .addActionRowComponents(row(btn('sug_hist', '📋 Histórico', ButtonStyle.Primary), btn('sug_cfg', '⚙️ Configuração'), btn('sug_back', 'Voltar')));
}

function screenHist(g, data, notice, ctx = {}) {
  const itens = ordenarItens(data.items).slice(0, MAX_ITEMS_LISTADOS);
  const linhas = itens.length ? itens.map((i) =>
    `${i.id === ctx.sel ? '▶ ' : ''}${STATUS_LABEL[i.status].split(' ')[0]} **${cut(i.title, 50)}** — <@${i.authorId}> — <t:${Math.floor(i.createdAt / 1000)}:d> — 👍${i.support.length} 👎${i.against.length}`
  ).join('\n') : '`Nenhuma sugestão ainda.`';
  const c = container('Histórico', notice).addTextDisplayComponents(txt(
    `🟡 Em análise • 🟢 Aprovadas • 🔴 Não aprovadas\n\n${linhas}` +
    (Object.keys(data.items).length > MAX_ITEMS_LISTADOS ? `\n-# Mostrando as ${MAX_ITEMS_LISTADOS} mais recentes.` : '')));
  if (itens.length) {
    c.addActionRowComponents(row(new StringSelectMenuBuilder().setCustomId('sug_sel_hist').setPlaceholder('Selecione uma sugestão').addOptions(
      itens.map((i) => ({ label: cut(`${STATUS_LABEL[i.status].split(' ')[0]} ${i.title}`, 100), value: i.id, default: i.id === ctx.sel })),
    )));
  }
  const sel = itens.find((i) => i.id === ctx.sel);
  if (sel) {
    c.addSeparatorComponents(sep()).addTextDisplayComponents(txt(
      `**${sel.title}**\n${cut(sel.description, 500)}\n\n**Autor:** <@${sel.authorId}>  •  **Status:** ${STATUS_LABEL[sel.status]}\n` +
      `**Votos:** 👍 ${sel.support.length}  👎 ${sel.against.length}` +
      (sel.decidedBy ? `\n**Decidido por:** <@${sel.decidedBy}> em <t:${Math.floor(sel.decidedAt / 1000)}:f>` : '')));
    const link = sel.messageId ? `https://discord.com/channels/${g.id}/${sel.channelId}/${sel.messageId}` : null;
    const acoes = [
      btn(`sug_decide:${sel.id}:approve`, '✅ Aprovar', ButtonStyle.Success, sel.status === STATUS.APPROVED),
      btn(`sug_decide:${sel.id}:reject`, '❌ Reprovar', ButtonStyle.Danger, sel.status === STATUS.REJECTED),
    ];
    if (link) acoes.push(new ButtonBuilder().setLabel('Ver publicação').setStyle(ButtonStyle.Link).setURL(link));
    c.addActionRowComponents(row(...acoes));
  }
  return c.addActionRowComponents(row(btn('sug_home', 'Voltar')));
}

function screenCfg(g, data, notice) {
  const cfg = data.config;
  const sel = new ChannelSelectMenuBuilder().setCustomId('sug_sel_cfgchannel').setPlaceholder('Canal de publicação').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  if (cfg.channelId && g.channels.cache.has(cfg.channelId)) sel.setDefaultChannels(cfg.channelId);
  return container('Configuração', notice)
    .addTextDisplayComponents(txt(
      `**Título:** \`${cut(cfg.title, 80)}\`\n**Descrição:** \`${cut(cfg.description, 100)}\`\n` +
      `**Imagem:** ${cfg.imageUrl ? `\`${cut(cfg.imageUrl, 60)}\`` : '`Nenhuma`'}\n` +
      `**Canal de publicação:** ${cfg.channelId ? `<#${cfg.channelId}>` : '`Não configurado`'}\n` +
      `**Painel informativo publicado:** ${cfg.publishedMessage ? '`Sim`' : '`Não`'}\n` +
      '-# Este canal é usado como sugestão padrão ao criar uma nova sugestão.'))
    .addActionRowComponents(row(sel))
    .addActionRowComponents(row(btn('sug_edit_cfg', 'Editar título/descrição/imagem', ButtonStyle.Primary), btn('sug_cfg_publish', 'Publicar painel informativo')))
    .addActionRowComponents(row(btn('sug_home', 'Voltar')));
}

const SCREENS = { home: screenHome, hist: screenHist, cfg: screenCfg };
function payload(interaction, screen, notice, ctx) {
  const data = getData(interaction.guildId);
  return { content: null, embeds: [], components: [SCREENS[screen](interaction.guild, data, notice, ctx)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}
async function render(interaction, screen, notice, ctx) {
  const p = payload(interaction, screen, notice, ctx);
  try {
    if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) return await interaction.update(p);
    return await interaction.reply(p);
  } catch (e) {
    console.error('[Sugestoes] Falha ao renderizar:', e.message);
    if (!interaction.replied && !interaction.deferred) return interaction.reply(p).catch(() => {});
  }
}

async function abrirPainel(interaction) {
  if (!(await checarAdmin(interaction))) return;
  return render(interaction, 'home');
}

async function publicarPainelInformativo(interaction) {
  const g = interaction.guild; const data = getData(g.id); const cfg = data.config;
  if (!cfg.channelId) return render(interaction, 'cfg', 'Defina o canal de publicação antes.');
  const err = validarCanal(g, cfg.channelId);
  if (err) return render(interaction, 'cfg', err);
  const ch = g.channels.cache.get(cfg.channelId);
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 ${cfg.title}`).setDescription(cfg.description);
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sug_open_modal').setLabel('Enviar Sugestão').setEmoji('📤').setStyle(ButtonStyle.Success),
  )];

  // Sempre apaga a mensagem antiga (se existir) e manda uma NOVA — evita
  // qualquer ambiguidade de "editei mas não sei se pegou" (edit silencioso
  // que falha vira só null e passava batido antes). Assim, clicar em
  // "Publicar painel informativo" sempre resulta numa mensagem nova e
  // visível, com certeza, com o botão.
  if (cfg.publishedMessage) {
    const oldCh = g.channels.cache.get(cfg.publishedMessage.channelId);
    const old = oldCh?.isTextBased?.() ? await oldCh.messages.fetch(cfg.publishedMessage.messageId).catch(() => null) : null;
    if (old) await old.delete().catch((e) => console.error('[Sugestoes] Falha ao apagar painel antigo:', e.message));
  }

  let msg;
  try {
    msg = await ch.send({ embeds: [embed], components });
  } catch (e) {
    console.error('[Sugestoes] Falha ao publicar painel informativo:', e.message);
    return render(interaction, 'cfg', `Falha ao publicar: ${discordErro(e)}`);
  }
  console.log(`[Sugestoes] Painel publicado em #${ch.name} (${ch.id}), mensagem ${msg.id}, com botão sug_open_modal.`);
  cfg.publishedMessage = { channelId: ch.id, messageId: msg.id };
  saveData(g.id, data);
  return render(interaction, 'cfg', `Painel informativo publicado em <#${ch.id}>.`);
}

// ── Envio direto pelo botão "Enviar Sugestão" do painel publicado ──
// Mesmo formulário de /sugestao, mas publica direto no canal do
// painel (sem etapa de escolher canal — o painel já está no canal certo).
function abrirModalNovaSugestaoDireta(interaction) {
  return interaction.showModal(new ModalBuilder().setCustomId('sug_modal_panel').setTitle('Nova sugestão').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titulo').setLabel('Título').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)),
  ));
}

async function handleModalNovaSugestaoDireta(interaction) {
  const titulo = interaction.fields.getTextInputValue('titulo').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  if (!titulo || !descricao) return interaction.reply({ content: '❌ Título e descrição são obrigatórios.', flags: MessageFlags.Ephemeral });

  const g = interaction.guild;
  const channelId = interaction.channelId;
  const err = validarCanal(g, channelId);
  if (err) return interaction.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral });

  const item = {
    id: newId(), guildId: g.id, authorId: interaction.user.id,
    authorTag: interaction.user.username, authorAvatar: interaction.user.displayAvatarURL?.() || null,
    title: titulo, description: descricao,
    channelId, messageId: null, threadId: null,
    status: STATUS.PENDING, support: [], against: [],
    createdAt: Date.now(), decidedBy: null, decidedAt: null,
  };
  const ch = g.channels.cache.get(channelId);
  let msg;
  try {
    msg = await ch.send({ embeds: [embedSugestao(item)], components: rowsSugestao(item) });
  } catch (e) {
    return interaction.reply({ content: `❌ Falha ao publicar: ${discordErro(e)}`, flags: MessageFlags.Ephemeral });
  }
  item.messageId = msg.id;
  try {
    const thread = await msg.startThread({ name: cut(item.title, 90), autoArchiveDuration: 1440, reason: 'Discussão da sugestão' });
    item.threadId = thread.id;
  } catch (e) {
    console.error('[Sugestoes] Falha ao criar tópico:', e.message);
  }

  const data = getData(g.id);
  data.items[item.id] = item;
  saveData(g.id, data);

  return interaction.reply({ content: '✅ Sugestão enviada!', flags: MessageFlags.Ephemeral });
}

async function handleButtonAdmin(interaction) {
  if (!(await checarAdmin(interaction))) return;
  const g = interaction.guild;
  const [base, id, acao] = interaction.customId.split(':');
  switch (base) {
    case 'sug_home': return render(interaction, 'home');
    case 'sug_hist': return render(interaction, 'hist');
    case 'sug_cfg': return render(interaction, 'cfg');
    case 'sug_cfg_publish': return publicarPainelInformativo(interaction);
    case 'sug_back': return require('../commands/painel').voltarParaPainel(interaction);
    case 'sug_edit_cfg': {
      const cfg = getData(g.id).config;
      return interaction.showModal(new ModalBuilder().setCustomId('sug_modal_cfg').setTitle('Configuração das sugestões').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titulo').setLabel('Título do painel').setStyle(TextInputStyle.Short).setMaxLength(100).setValue(cfg.title)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('Descrição do painel').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setValue(cfg.description)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('imagem').setLabel('URL da imagem (opcional)').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false).setValue(cfg.imageUrl || '')),
      ));
    }
    case 'sug_decide': {
      const data = getData(g.id); const item = data.items[id];
      if (!item) return render(interaction, 'hist', 'Sugestão não encontrada.');
      const novo = acao === 'approve' ? STATUS.APPROVED : STATUS.REJECTED;
      if (item.status === novo) return render(interaction, 'hist', null, { sel: id });
      await decidirSugestao(g, item, novo, interaction.user);
      return render(interaction, 'hist', `Sugestão marcada como ${STATUS_LABEL[novo].toLowerCase()}.`, { sel: id });
    }
    default: return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function handleSelectAdmin(interaction) {
  if (!(await checarAdmin(interaction))) return;
  const g = interaction.guild; const id = interaction.customId; const v = interaction.values[0];
  if (id === 'sug_sel_cfgchannel') {
    const err = validarCanal(g, v);
    if (err) return render(interaction, 'cfg', err);
    const data = getData(g.id); data.config.channelId = v; saveData(g.id, data);
    return render(interaction, 'cfg');
  }
  if (id === 'sug_sel_hist') {
    if (!getData(g.id).items[v]) return render(interaction, 'hist', 'Sugestão não encontrada.');
    return render(interaction, 'hist', null, { sel: v });
  }
  return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function handleModalCfg(interaction) {
  if (!(await checarAdmin(interaction))) return;
  const g = interaction.guild;
  const titulo = interaction.fields.getTextInputValue('titulo').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  const imagemRaw = interaction.fields.getTextInputValue('imagem').trim();
  if (!titulo || !descricao) return render(interaction, 'cfg', 'Título e descrição são obrigatórios.');
  let imageUrl = null;
  if (imagemRaw) { imageUrl = validarUrl(imagemRaw); if (!imageUrl) return render(interaction, 'cfg', 'URL de imagem inválida.'); }
  const data = getData(g.id);
  Object.assign(data.config, { title: titulo, description: descricao, imageUrl });
  saveData(g.id, data);
  return render(interaction, 'cfg');
}

// ── Roteadores (buttonHandler.js) ──────────────────────────────────
async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === 'sug_open_modal') return abrirModalNovaSugestaoDireta(interaction);
  if (id.startsWith('sug_vote:')) return handleVoto(interaction);
  if (id.startsWith('sug_approve:')) return handleAprovarRapido(interaction);
  return handleButtonAdmin(interaction);
}
async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  if (id.startsWith('sug_sel_channel:')) return handleSelecaoCanalSugestao(interaction);
  return handleSelectAdmin(interaction);
}
async function handleModal(interaction) {
  const id = interaction.customId;
  if (id === 'sug_modal_new') return handleModalNovaSugestao(interaction);
  if (id === 'sug_modal_panel') return handleModalNovaSugestaoDireta(interaction);
  if (id === 'sug_modal_cfg') return handleModalCfg(interaction);
  return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
}

module.exports = {
  STATUS, getData, saveData, validarUrl, validarCanal, embedSugestao, rowsSugestao,
  abrirModalNovaSugestao, abrirPainel, handleButton, handleSelectMenu, handleModal,
  _test: { pendentes, votando },
};
