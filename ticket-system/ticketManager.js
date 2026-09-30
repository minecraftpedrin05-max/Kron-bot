// ═══════════════════════════════════════════════════════════════════════════
//  ticketManager.js — Sistema de Tickets (Components V2, Discord.js v14)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Seções deste arquivo:
//    1. Imports & DB
//    2. Constantes
//    3. Utilitários gerais
//    4. DB helpers
//    5. Builders de container (painel público, painel admin, ticket, equipe)
//    6. Painel admin — showAdminPanel + atualizarPainelMsg
//    7. Config handlers (canal, categoria, staff, logs, toggleModal)
//    8. Editor de layout (embed, blocos, thumbnail, cor, estrutura)
//    9. Gerenciar variantes
//   10. Publicar / deletar painel
//   11. Abrir / criar ticket
//   12. Ações do ticket (fechar, deletar, claim, notificar, painel equipe)
//       12b. Avaliação do atendimento por DM (enviada ao fechar o ticket)
//   13. handleButton / handleSelectMenu / handleModal
//   14. Exports
//
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  1. IMPORTS & DB
// ─────────────────────────────────────────────────────────────
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType, AttachmentBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SectionBuilder, ThumbnailBuilder, MessageFlags,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  RESTJSONErrorCodes,
} = require('discord.js');

let db;
try {
  db = require('../database/db');
} catch {
  const mem = {};
  db = {
    getGuild:    (id)           => mem[id] ?? {},
    updateGuild: (id, key, val) => { if (!mem[id]) mem[id] = {}; mem[id][key] = val; },
  };
}

// ─────────────────────────────────────────────────────────────
//  2. CONSTANTES
// ─────────────────────────────────────────────────────────────
const COR = {
  SUCCESS : 0x57F287, // verde
  DANGER  : 0xED4245, // vermelho
  PRIMARY : 0x5865F2, // azul/roxo
  GOLD    : 0xFFD700, // dourado
};

// ─────────────────────────────────────────────────────────────
//  3. UTILITÁRIOS GERAIS
// ─────────────────────────────────────────────────────────────

/** Ícone de status configurado/não configurado. */
function statusIcon(valor) {
  return valor
    ? '<:confimado:1513207838472802304>'
    : '<:naoconfigurado:1513207873243578438>';
}

/** Barra de progresso visual de 10 blocos. */
function barraProgresso(atual, total) {
  const filled = Math.round((atual / total) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/** Timestamp Discord formatado (data e hora completa). */
function formatTs(ms) {
  return `<t:${Math.floor((ms ?? Date.now()) / 1000)}:F>`;
}

/**
 * Normaliza o nome de uma variante para uso em customId.
 * Máx 50 caracteres, apenas a-z0-9 e _.
 */
function normalizarNome(nome) {
  return nome.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 50);
}

/**
 * Responde a interação de forma segura:
 * - Se ainda não respondida → reply()
 * - Se já respondida       → followUp()
 * Nunca duplica nem lança InteractionAlreadyReplied.
 */
async function responder(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}

/**
 * Atualiza a mensagem do componente.
 * Funciona tanto para ButtonInteraction quanto para SelectMenuInteraction.
 */
async function atualizar(interaction, payload) {
  return interaction.update(payload).catch(() => {});
}

/**
 * Container ephemeral simples de erro.
 */
function errContainer(texto) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(COR.DANGER)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(texto)),
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

/**
 * Container ephemeral simples de sucesso.
 */
function okContainer(texto) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(COR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(texto)),
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

// ─────────────────────────────────────────────────────────────
//  4. DB HELPERS
// ─────────────────────────────────────────────────────────────

function getConfig(guildId) {
  return (db.getGuild(guildId) || {}).ticketConfig || {};
}

function saveConfig(guildId, updates) {
  const current = getConfig(guildId);
  const merged  = { ...current, ...updates };
  try   { db.updateGuild(guildId, 'ticketConfig', merged); }
  catch { db.updateGuild(guildId, { ticketConfig: merged }); }
}

async function categoriaTicketValida(guild, categoryId) {
  if (!categoryId) return true;
  let categoria = guild.channels.cache.get(categoryId);
  if (!categoria) categoria = await guild.channels.fetch(categoryId).catch(function () { return null; });
  return !!(categoria && categoria.type === ChannelType.GuildCategory);
}

function categoriaInvalidaContainer() {
  return {
    components: [
      new ContainerBuilder().setAccentColor(COR.DANGER)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:negativo:1528400986744295475>  **Categoria de tickets invalida.**\n> A categoria configurada nao existe mais neste servidor.\n> Peca a um administrador para configurar a categoria novamente no painel de tickets.'))
    ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}


/** Quem assumiu um ticket (por canal), persistido no mesmo ticketConfig do guild — sem tabela nova. */
function getClaim(guildId, channelId) {
  const cfg = getConfig(guildId);
  return (cfg.claims || {})[channelId] || null;
}
function setClaim(guildId, channelId, userId) {
  const cfg = getConfig(guildId);
  saveConfig(guildId, { claims: { ...(cfg.claims || {}), [channelId]: userId } });
}

/**
 * Registro de cada ticket (protocolo, quem abriu/fechou, avaliação), por canal,
 * no mesmo ticketConfig do guild — mesmo padrão dos claims, sem tabela nova.
 *   ticketConfig.protocoloSeq          = último número de protocolo emitido no servidor
 *   ticketConfig.registros[channelId]  = {
 *     protocolo, abertoPor, abertoEm,
 *     fechadoPor?, fechadoEm?,
 *     dmAvaliacao?: 'enviada' | 'dm_fechada' | 'usuario_inexistente',
 *     avaliacao?:   { nota, avaliadoPor, avaliadoEm },
 *   }
 * O canal continua identificado pelo topic `ticket:<userId>` — nada disso o altera.
 */
function formatarProtocolo(seq) {
  return `TKT-${String(seq).padStart(6, '0')}`;
}

function getRegistro(guildId, channelId) {
  return (getConfig(guildId).registros || {})[channelId] || null;
}

function salvarRegistro(guildId, channelId, registro) {
  const cfg = getConfig(guildId);
  saveConfig(guildId, { registros: { ...(cfg.registros || {}), [channelId]: registro } });
  return registro;
}

/** Emite o próximo protocolo do servidor e registra o ticket. */
function registrarTicket(guildId, channelId, abertoPor, abertoEm = Date.now()) {
  const cfg      = getConfig(guildId);
  const seq      = (cfg.protocoloSeq || 0) + 1;
  const registro = { protocolo: formatarProtocolo(seq), abertoPor, abertoEm };
  saveConfig(guildId, {
    protocoloSeq: seq,
    registros:    { ...(cfg.registros || {}), [channelId]: registro },
  });
  return registro;
}

function isStaff(member, cfg) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild))   return true;
  if (cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
//  5. BUILDERS DE CONTAINER
// ─────────────────────────────────────────────────────────────

/**
 * Valida se uma string de emoji está num formato que o Discord aceita
 * (emoji customizado `<:nome:id>` / `<a:nome:id>`, ou um emoji unicode
 * curto). Se não bater com nenhum dos dois, cai no emoji padrão — evita
 * que um valor digitado errado quebre a publicação do painel inteiro.
 */
function emojiValido(raw) {
  const valor = (raw || '').trim();
  if (!valor) return '<:config3:1524208114327617588>';
  if (/^<a?:\w{2,32}:\d{15,25}>$/.test(valor)) return valor;
  if (valor.length <= 8) return valor; // emoji unicode simples (ou combinado)
  return '<:config3:1524208114327617588>';
}

/**
 * Aplica um bloco de layout personalizado (texto, divisor ou mídia) ao container.
 * Reutilizado em buildPreviewContainer e buildEditorContainer.
 */
function aplicarBloco(container, bloco) {
  if (bloco.tipo === 'texto') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bloco.conteudo)
    );
  } else if (bloco.tipo === 'divisor') {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(1)
    );
  } else if (bloco.tipo === 'midia') {
    // Imagem GRANDE (como o "Banner" do sistema de produto principal).
    // Antes usava SectionBuilder + ThumbnailAccessory (igual ao Thumbnail),
    // por isso ficava sempre pequena/no canto e confundia com a thumbnail.
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(bloco.conteudo))
    );
  }
}

/**
 * Monta a pré-visualização do painel público (título, thumbnail, descrição, blocos, botões, footer).
 * Usada tanto para publicar o painel quanto para o editor de layout.
 *
 * @param {Object} cfg   - Configuração da guild
 * @param {Object} guild - Objeto Guild do Discord.js
 * @returns {ContainerBuilder}
 */
function buildPreviewContainer(cfg, guild) {
  const titulo    = cfg.embedTitulo    || 'Central de Suporte';
  const descricao = cfg.embedDescricao || 'Escolha uma opção abaixo para iniciar um atendimento.';
  const footer    = cfg.embedFooter    || guild.name;
  const cor       = cfg.corPainel != null ? cfg.corPainel : COR.SUCCESS;
  const blocos    = cfg.layoutBlocos  || [];
  const variantes = cfg.variantes     || [];

  // KAEL — corrigido: com variantes, o público deve ver um SELECT MENU
  // (dropdown) pra escolher a categoria do ticket, não botões. Antes usava
  // botões limitados a `.slice(0, 5)` — com mais de 5 variantes cadastradas,
  // as demais simplesmente não apareciam (bug). Um StringSelectMenu suporta
  // até 25 opções, então passa a mostrar TODAS as variantes cadastradas.
  const linhaAbrirTicket = variantes.length > 0
    ? new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('tkt_sel_abrir')
          .setPlaceholder('Selecione uma opção para abrir um ticket')
          .addOptions(variantes.slice(0, 25).map(v => ({
            label: v.nome.slice(0, 100),
            value: normalizarNome(v.nome),
            description: (v.descricao || undefined)?.slice(0, 100),
            emoji: emojiValido(v.emoji),
          })))
      )
    : new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_abrir_geral').setLabel('Suporte Geral').setEmoji('<:config3:1524208114327617588>').setStyle(ButtonStyle.Primary)
      );

  const container = new ContainerBuilder().setAccentColor(cor);

  // Título + descrição (com ou sem thumbnail). Quando há thumbnail, título
  // E descrição precisam estar na MESMA Section pra ficarem visualmente
  // juntos ao lado da miniatura — antes a descrição era um bloco separado
  // fora da Section e "escapava" pra fora da área da imagem.
  if (cfg.thumbnailUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<:config3:1524208114327617588>  **${titulo}**`),
          new TextDisplayBuilder().setContent(descricao),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(cfg.thumbnailUrl))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:config3:1524208114327617588>  **${titulo}**`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(descricao));
  }

  for (const bloco of blocos.filter(b => b.posicao !== 'depois')) {
    aplicarBloco(container, bloco);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1))
    .addActionRowComponents(linhaAbrirTicket);

  for (const bloco of blocos.filter(b => b.posicao === 'depois')) {
    aplicarBloco(container, bloco);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));

  return container;
}

/**
 * Monta o container do editor de layout (pré-visualização + controles do editor).
 * Reutiliza buildPreviewContainer — zero duplicação.
 *
 * @param {Object} cfg   - Configuração da guild
 * @param {Object} guild - Objeto Guild do Discord.js
 * @returns {ContainerBuilder}
 */
function buildEditorContainer(cfg, guild) {
  const container = buildPreviewContainer(cfg, guild);

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:personalizarE:1528401146274910289>  **Editor de Layout**'))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_layout_textbase')   .setLabel('Editar Texto').setEmoji('<:editar:1528400388137549864>') .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_layout_add_texto')  .setLabel('Add Texto')   .setEmoji('📝') .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_layout_add_divisor').setLabel('Add Divisor') .setEmoji('➖') .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_layout_add_midia')  .setLabel('Add Mídia')   .setEmoji('<:foto:1533080648196292679>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_layout_thumbnail')  .setLabel('Thumbnail')   .setEmoji('<:foto:1533080648196292679>').setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_layout_estrutura').setLabel('Gerenciar Estrutura').setEmoji('<:config2:1524208021071462533>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tkt_layout_cor')      .setLabel('Cor do Painel')      .setEmoji('<:personalizarE:1528401146274910289>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tkt_cfg_canal')       .setLabel('Canal Envio')         .setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tkt_layout_voltar')   .setLabel('Voltar')              .setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
      )
    );

  return container;
}

/**
 * Painel de configuração admin (Components V2).
 *
 * CORREÇÃO: label do campo Canal estava marcado como 'Categoria' (linha 75 original).
 * Corrigido para 'Canal'.
 */
function buildAdminContainer(cfg, guild) {
  const campos = [
    { key: cfg.channelId,     label: 'Canal',         valor: cfg.channelId     ? `<#${cfg.channelId}>`     : 'Não definido'  },
    { key: cfg.categoryId,    label: 'Categoria',     valor: cfg.categoryId    ? `<#${cfg.categoryId}>`    : 'Não definida'  },
    { key: cfg.staffRoleId,   label: 'Cargo Suporte', valor: cfg.staffRoleId   ? `<@&${cfg.staffRoleId}>`  : 'Não definido'  },
    { key: cfg.logsChannelId, label: 'Logs',          valor: cfg.logsChannelId ? `<#${cfg.logsChannelId}>` : 'Não definido'  },
  ];

  const configurados = campos.filter(c => c.key).length;
  const barra        = barraProgresso(configurados, campos.length);
  const modoModal    = cfg.modoModal !== false;

  const linhas = [
    `**Definições de Sistema:** ${barra} (${configurados}/${campos.length})`,
    ...campos.map(c => `• **${c.label}:** ${statusIcon(c.key)} ${c.valor}`),
    `• **Modo Modal:** ${statusIcon(modoModal)} ${modoModal ? '<:positivo:1528401238197276702> Ativado' : '<:negativo:1528400986744295475> Desativado'}`,
  ].join('\n');

  return new ContainerBuilder()
    .setAccentColor(COR.SUCCESS)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:config3:1524208114327617588>  **Configuração de Tickets**'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(linhas))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_cfg_canal')    .setLabel('Canal')         .setEmoji({ id: '1513175932687483030', name: 'fone'  }).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_cfg_categoria').setLabel('Categoria')     .setEmoji({ id: '1513176718934937813', name: 'pasta' }).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_cfg_staff')    .setLabel('Cargo Suporte') .setEmoji({ id: '1512951869327278140', name: 'staff' }).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_cfg_logs')     .setLabel('Logs')          .setEmoji({ id: '1512955357016756304', name: 'logs'  }).setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_cfg_modal_toggle').setLabel(modoModal ? 'Desativar Modal' : 'Ativar Modal').setEmoji('🔁').setStyle(modoModal ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tkt_cfg_embed')       .setLabel('Personalizar Visual')  .setEmoji('<:personalizarE:1528401146274910289>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tkt_cfg_variantes')   .setLabel('Gerenciar Variantes')  .setEmoji({ id: '1512951960733483008', name: 'escala' }).setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_cfg_publicar').setLabel('Postar Painel')  .setEmoji('<:arrow:1524206792626933831>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tkt_cfg_deletar') .setLabel('Deletar Painel').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
      )
    );
}

/**
 * Container interno do ticket (boas-vindas + botões de ação).
 */
function buildTicketContainer({ user, staffRoleId, categoriaNome, motivo }) {
  const mencoes = staffRoleId
    ? `<@${user.id}> | <@&${staffRoleId}>`
    : `<@${user.id}>`;

  return new ContainerBuilder()
    .setAccentColor(COR.SUCCESS)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(mencoes))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<:config3:1524208114327617588>  **Atendimento Iniciado**\n\n` +
        `Olá <@${user.id}>, seja bem-vindo ao seu ticket de **${categoriaNome}**!\n` +
        (motivo ? `**Motivo:**\n> ${motivo}\n\n` : '\n') +
        `Aguarde, um membro da equipe irá atendê-lo em breve.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_fechar')       .setLabel('Fechar Ticket')    .setEmoji('<:CadLock:1533221942256078968>').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tkt_notificar')    .setLabel('Notificar Usuário').setEmoji('<:sino:1528840971096297482>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tkt_painel_equipe').setLabel('Painel da Equipe') .setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
      )
    );
}

/**
 * Container do painel da equipe (staff).
 */
function buildPainelEquipeContainer({ user, categoriaNome, claimUserId }) {
  return new ContainerBuilder()
    .setAccentColor(COR.PRIMARY)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:embed:1528400492982571111>  **Painel da Equipe**'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> <:user:1532137085081878558>  **Usuário:** <@${user.id}>\n` +
        `> 📂  **Categoria:** ${categoriaNome}\n` +
        `> <:dev:1525538335139958915>  **Assumido por:** ${claimUserId ? `<@${claimUserId}>` : '`Ninguém ainda`'}\n` +
        `> <:clock:1524207889441357917>  **Aberto em:** ${formatTs()}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tkt_claim').setLabel(claimUserId ? 'Ticket Assumido' : 'Assumir Ticket').setEmoji('<:dev:1525538335139958915>')
          .setStyle(claimUserId ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(!!claimUserId),
        new ButtonBuilder().setCustomId('tkt_transcricao').setLabel('Transcrição').setEmoji('<:copypast:1533880329536802896>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('tkt_renomear').setLabel('Renomear').setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Secondary),
      )
    );
}

// ─────────────────────────────────────────────────────────────
//  6. PAINEL ADMIN — showAdminPanel + atualizarPainelMsg
// ─────────────────────────────────────────────────────────────

async function showAdminPanel(interaction) {
  const cfg = getConfig(interaction.guildId);
  await interaction.reply({
    components: [buildAdminContainer(cfg, interaction.guild)],
    flags: MessageFlags.IsComponentsV2,
  });
  const msg = await interaction.fetchReply();
  saveConfig(interaction.guildId, { painelMsgId: msg.id, painelCanalId: msg.channelId });
}

/** Atualiza a mensagem do painel admin no canal onde foi postada (após qualquer mudança de config). */
async function atualizarPainelMsg(guildId, guild) {
  try {
    const cfg   = getConfig(guildId);
    if (!cfg.painelMsgId || !cfg.painelCanalId) return;
    const canal = guild.channels.cache.get(cfg.painelCanalId);
    if (!canal) return;
    const msg   = await canal.messages.fetch(cfg.painelMsgId).catch(() => null);
    if (!msg) return;
    await msg.edit({
      components: [buildAdminContainer(cfg, guild)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (e) {
    console.error('[Tickets] Erro ao atualizar painel admin:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  7. CONFIG HANDLERS
// ─────────────────────────────────────────────────────────────

async function cfgCanal(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('tkt_sel_canal').setPlaceholder('Selecione o canal do painel').setChannelTypes(ChannelType.GuildText)
  );
  await responder(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:canal:1524207214791884890>  **Canal do Painel**\n> Selecione onde o painel será enviado.'))
        .addActionRowComponents(row)
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function cfgCategoria(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('tkt_sel_categoria').setPlaceholder('Selecione a categoria').setChannelTypes(ChannelType.GuildCategory)
  );
  await responder(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('📂  **Categoria**\n> Selecione onde os tickets serão criados.'))
        .addActionRowComponents(row)
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function cfgStaff(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('tkt_sel_staff').setPlaceholder('Selecione o cargo Staff')
  );
  await responder(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:dev:1525538335139958915>  **Cargo Suporte**\n> Selecione o cargo que gerenciará tickets.'))
        .addActionRowComponents(row)
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function cfgLogs(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('tkt_sel_logs').setPlaceholder('Selecione o canal de logs').setChannelTypes(ChannelType.GuildText)
  );
  await responder(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:termos:1533454585169973288>  **Canal de Logs**\n> Selecione onde os logs serão enviados.'))
        .addActionRowComponents(row)
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function toggleModal(interaction) {
  const cfg     = getConfig(interaction.guildId);
  const novoVal = cfg.modoModal === false;            // inverte: false→true, true/undefined→false
  saveConfig(interaction.guildId, { modoModal: novoVal });
  await atualizarPainelMsg(interaction.guildId, interaction.guild);
  return responder(interaction, okContainer(
    `🔁  **Modo Modal ${novoVal ? 'Ativado' : 'Desativado'}!**\n> O modal de motivo foi ${novoVal ? 'ativado' : 'desativado'}.`
  ));
}

// ─────────────────────────────────────────────────────────────
//  8. EDITOR DE LAYOUT
// ─────────────────────────────────────────────────────────────

/**
 * Abre o editor de layout com reply() ephemeral (primeira abertura via botão do painel admin).
 * Sempre usa reply() pois é a primeira resposta a essa interação.
 */
async function abrirEditorLayout(interaction) {
  const cfg = getConfig(interaction.guildId);
  await interaction.reply({
    components: [buildEditorContainer(cfg, interaction.guild)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

/**
 * Atualiza o editor de layout na mesma mensagem (após ações dentro do editor).
 * Sempre usa update() pois a mensagem ephemeral já existe.
 */
async function atualizarEditorLayout(interaction) {
  const cfg = getConfig(interaction.guildId);
  await atualizar(interaction, {
    components: [buildEditorContainer(cfg, interaction.guild)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function modalEditarTextoBase(interaction) {
  const cfg   = getConfig(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('tkt_modal_embed').setTitle('Editar Texto do Painel');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_titulo').setLabel('Título do Painel').setStyle(TextInputStyle.Short)
        .setValue(cfg.embedTitulo || 'Central de Suporte').setMaxLength(100).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_descricao').setLabel('Descrição').setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.embedDescricao || 'Escolha uma opção abaixo para iniciar um atendimento.')
        .setMaxLength(500).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_footer').setLabel('Footer').setStyle(TextInputStyle.Short)
        .setValue(cfg.embedFooter || '').setMaxLength(100).setRequired(false)
    ),
  );
  await interaction.showModal(modal);
}

async function modalAddTexto(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_layout_texto').setTitle('Adicionar Bloco de Texto');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_conteudo').setLabel('Conteúdo do texto').setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
        .setPlaceholder('antes').setValue('antes').setMaxLength(10).setRequired(true)
    ),
  );
  await interaction.showModal(modal);
}

async function modalAddMidia(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_layout_midia').setTitle('Adicionar Mídia (URL)');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_url').setLabel('URL da imagem').setStyle(TextInputStyle.Short)
        .setPlaceholder('https://...').setMaxLength(500).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
        .setPlaceholder('antes').setValue('antes').setMaxLength(10).setRequired(true)
    ),
  );
  await interaction.showModal(modal);
}

async function modalAddDivisor(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_layout_divisor').setTitle('Adicionar Divisor');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
        .setPlaceholder('antes').setValue('antes').setMaxLength(10).setRequired(true)
    ),
  );
  await interaction.showModal(modal);
}

/**
 * KAEL — corrige a reclamação de "duplicação de texto": antes, a única
 * forma de mudar um bloco já existente era clicar em "Add Texto"/"Add
 * Mídia" de novo, que sempre criava um bloco NOVO (vazio) em vez de deixar
 * editar o que já tinha sido digitado — daí a sensação de duplicar texto.
 *
 * Esta função abre o modal do bloco selecionado em "Gerenciar Estrutura"
 * JÁ PRÉ-PREENCHIDO com o conteúdo/posição atuais, e o submit (handleModal,
 * customId `tkt_modal_layout_editar_<indice>`) SUBSTITUI o bloco no mesmo
 * índice — nunca dá push() de um bloco novo.
 */
async function modalEditarBloco(interaction, idx, bloco) {
  if (bloco.tipo === 'divisor') {
    const modal = new ModalBuilder().setCustomId(`tkt_modal_layout_editar_${idx}`).setTitle('Editar Divisor');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
          .setValue(bloco.posicao === 'depois' ? 'depois' : 'antes').setMaxLength(10).setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  if (bloco.tipo === 'midia') {
    const modal = new ModalBuilder().setCustomId(`tkt_modal_layout_editar_${idx}`).setTitle('Editar Mídia');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('tkt_layout_url').setLabel('URL da imagem').setStyle(TextInputStyle.Short)
          .setValue(bloco.conteudo || '').setPlaceholder('https://...').setMaxLength(500).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
          .setValue(bloco.posicao === 'depois' ? 'depois' : 'antes').setMaxLength(10).setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  // texto
  const modal = new ModalBuilder().setCustomId(`tkt_modal_layout_editar_${idx}`).setTitle('Editar Bloco de Texto');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_conteudo').setLabel('Conteúdo do texto').setStyle(TextInputStyle.Paragraph)
        .setValue(bloco.conteudo || '').setMaxLength(1000).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_posicao').setLabel('Posição: "antes" ou "depois" dos botões').setStyle(TextInputStyle.Short)
        .setValue(bloco.posicao === 'depois' ? 'depois' : 'antes').setMaxLength(10).setRequired(true)
    ),
  );
  return interaction.showModal(modal);
}

async function modalThumbnail(interaction) {
  const cfg   = getConfig(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('tkt_modal_layout_thumb').setTitle('Definir Thumbnail');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_layout_thumb_url').setLabel('URL da imagem (vazio = remover)').setStyle(TextInputStyle.Short)
        .setValue(cfg.thumbnailUrl || '').setPlaceholder('https://...').setMaxLength(500).setRequired(false)
    ),
  );
  await interaction.showModal(modal);
}

async function gerenciarEstrutura(interaction) {
  const cfg    = getConfig(interaction.guildId);
  const blocos = cfg.layoutBlocos || [];
  const voltar = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tkt_layout_voltar_editor').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
  );

  if (blocos.length === 0) {
    return atualizar(interaction, {
      components: [
        new ContainerBuilder().setAccentColor(COR.GOLD)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:config2:1524208021071462533>  **Gerenciar Estrutura**\n\n> Nenhum bloco adicionado ainda.'))
          .addActionRowComponents(voltar)
      ],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }

  const lista = blocos.map((b, i) => {
    const tipoLabel = b.tipo === 'texto' ? '📝 Texto' : b.tipo === 'divisor' ? '➖ Divisor' : '<:foto:1533080648196292679> Mídia';
    const posLabel  = b.posicao === 'depois' ? 'abaixo dos botões' : 'acima dos botões';
    const preview   = b.tipo === 'texto'
      ? `\n┗ "${b.conteudo.slice(0, 60)}${b.conteudo.length > 60 ? '...' : ''}"`
      : b.tipo === 'midia' ? `\n┗ ${b.conteudo}` : '';
    return `**${i + 1}.** ${tipoLabel} — ${posLabel}${preview}`;
  }).join('\n\n');

  const selectEditar = new StringSelectMenuBuilder()
    .setCustomId('tkt_sel_layout_editar')
    .setPlaceholder('Selecione um bloco para editar (vem pré-preenchido)')
    .addOptions(blocos.slice(0, 25).map((b, i) => ({
      label: `${i + 1}. ${b.tipo === 'texto' ? 'Texto' : b.tipo === 'divisor' ? 'Divisor' : 'Mídia'} (${b.posicao === 'depois' ? 'abaixo' : 'acima'})`.slice(0, 100),
      value: String(i),
    })));

  const selectRemover = new StringSelectMenuBuilder()
    .setCustomId('tkt_sel_layout_remover')
    .setPlaceholder('Selecione um bloco para remover')
    .addOptions(blocos.slice(0, 25).map((b, i) => ({
      label: `${i + 1}. ${b.tipo === 'texto' ? 'Texto' : b.tipo === 'divisor' ? 'Divisor' : 'Mídia'} (${b.posicao === 'depois' ? 'abaixo' : 'acima'})`.slice(0, 100),
      value: String(i),
    })));

  await atualizar(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.GOLD)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:config2:1524208021071462533>  **Gerenciar Estrutura**\n\n${lista}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(new ActionRowBuilder().addComponents(selectEditar))
        .addActionRowComponents(new ActionRowBuilder().addComponents(selectRemover))
        .addActionRowComponents(voltar)
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function selecionarCorPainel(interaction) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('tkt_sel_layout_cor')
    .setPlaceholder('Escolha a cor do painel')
    .addOptions([
      { label: 'Verde (padrão)', emoji: '<:online:1533081467918221565>', value: String(COR.SUCCESS)  },
      { label: 'Azul/Roxo',     emoji: '🔵', value: String(COR.PRIMARY)  },
      { label: 'Dourado',       emoji: '🟡', value: String(COR.GOLD)     },
      { label: 'Vermelho',      emoji: '<:npertubar:1533081528966316083>', value: String(COR.DANGER)   },
      { label: 'Branco',        emoji: '⚪', value: String(0xFFFFFF)      },
      { label: 'Preto',         emoji: '⚫', value: String(0x23272A)      },
    ]);

  await atualizar(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.GOLD)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:personalizarE:1528401146274910289>  **Cor do Painel**\n> Selecione a cor da barra lateral do painel público.'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tkt_layout_voltar_editor').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
          )
        )
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

// ─────────────────────────────────────────────────────────────
//  9. GERENCIAR VARIANTES
// ─────────────────────────────────────────────────────────────

/**
 * Exibe a tela de gerenciamento de variantes.
 *
 * CORREÇÃO: era reply() quando chamada de tkt_var_listar (botão dentro de mensagem ephemeral).
 * Agora usa o parâmetro `modoUpdate` para decidir entre reply() e update(),
 * eliminando a segunda mensagem ephemeral duplicada.
 *
 * @param {Interaction} interaction
 * @param {boolean} modoUpdate - true quando chamada de dentro de uma mensagem ephemeral existente
 */
async function mostrarVariantes(interaction, modoUpdate = false) {
  const cfg       = getConfig(interaction.guildId);
  const variantes = cfg.variantes || [];
  const lista     = variantes.length > 0
    ? variantes.map((v, i) => `**${i + 1}.** ${v.emoji || '<:config3:1524208114327617588>'}  **${v.nome}**\n┗ ${v.descricao || 'Sem descrição'}`).join('\n\n')
    : '> Nenhuma variante cadastrada.';

  const payload = {
    components: [
      new ContainerBuilder().setAccentColor(COR.GOLD)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:config3:1524208114327617588>  **Gerenciar Variantes**\n\n${lista}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:rendimentos:1528401542070145135>  **Total:** ${variantes.length} variante(s)`))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tkt_var_adicionar').setLabel('Adicionar').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('tkt_var_editar')   .setLabel('Editar')   .setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('tkt_var_remover')  .setLabel('Remover')  .setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('tkt_var_listar')   .setLabel('Listar')   .setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('tkt_var_voltar')   .setLabel('Voltar')   .setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
          )
        )
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };

  if (modoUpdate) return atualizar(interaction, payload);
  return responder(interaction, payload);
}

async function listarVariantes(interaction) {
  const cfg       = getConfig(interaction.guildId);
  const variantes = cfg.variantes || [];

  if (variantes.length === 0)
    // CORREÇÃO: era reply() → agora update() pois estamos dentro da tela de variantes
    return atualizar(interaction, errContainer('<:negativo:1528400986744295475>  Nenhuma variante cadastrada.'));

  const lista = variantes
    .map((v, i) => `**${i + 1}.** ${v.emoji || '<:config3:1524208114327617588>'}  **${v.nome}**\n┗ 📝  ${v.descricao || 'Sem descrição'}`)
    .join('\n\n');

  // CORREÇÃO: era reply() → agora update() pois estamos dentro da tela de variantes
  return atualizar(interaction, {
    components: [
      new ContainerBuilder().setAccentColor(COR.GOLD)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:embed:1528400492982571111>  **Variantes Cadastradas**\n\n${lista}`))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tkt_var_voltar').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
          )
        )
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function modalAdicionarVariante(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_variante_add').setTitle('Adicionar Variante');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_nome') .setLabel('Nome').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Suporte, Parceria...').setRequired(true).setMaxLength(50)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setPlaceholder('Ex: <:config3:1524208114327617588> 💰 🤝').setRequired(false).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_desc') .setLabel('Descrição').setStyle(TextInputStyle.Short).setPlaceholder('Aparece no botão').setRequired(false).setMaxLength(100)),
  );
  await interaction.showModal(modal);
}

async function modalEditarVariante(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_variante_editar').setTitle('Editar Variante');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_nome_ant') .setLabel('Nome atual').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_nome_novo').setLabel('Novo nome (vazio = manter)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_emoji_ed') .setLabel('Novo emoji (vazio = manter)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tkt_var_desc_ed')  .setLabel('Nova descrição (vazio = manter)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
  );
  await interaction.showModal(modal);
}

async function modalRemoverVariante(interaction) {
  const modal = new ModalBuilder().setCustomId('tkt_modal_variante_remover').setTitle('Remover Variante');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_var_nome_rem').setLabel('Nome da variante').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
    )
  );
  await interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────
//  10. PUBLICAR / DELETAR PAINEL
// ─────────────────────────────────────────────────────────────

async function publicar(interaction) {
  const cfg     = getConfig(interaction.guildId);
  const { guild } = interaction;

  if (!cfg.channelId)
    return responder(interaction, errContainer('<:negativo:1528400986744295475>  Configure o canal primeiro.'));

  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel)
    return responder(interaction, errContainer('<:negativo:1528400986744295475>  Canal não encontrado.'));

  // Remove painel anterior se existir
  if (cfg.publicMsgId) {
    const old = await channel.messages.fetch(cfg.publicMsgId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const msg = await channel.send({
    components: [buildPreviewContainer(cfg, guild)],
    flags: MessageFlags.IsComponentsV2,
  });

  saveConfig(interaction.guildId, { publicMsgId: msg.id });

  return responder(interaction, okContainer(`<:positivo:1528401238197276702>  **Painel Publicado!**\n> Enviado em <#${cfg.channelId}>.`));
}

async function deletarPainel(interaction) {
  const cfg     = getConfig(interaction.guildId);
  const { guild } = interaction;

  if (!cfg.publicMsgId || !cfg.channelId)
    return responder(interaction, errContainer('<:negativo:1528400986744295475>  Nenhum painel publicado encontrado.'));

  const channel = guild.channels.cache.get(cfg.channelId);
  const msg     = await channel?.messages.fetch(cfg.publicMsgId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
  saveConfig(interaction.guildId, { publicMsgId: null });

  return responder(interaction, okContainer(`<:apagar:1524206738885050388>  **Painel Deletado!**\n> Removido de <#${cfg.channelId}>.`));
}

// ─────────────────────────────────────────────────────────────
//  11. ABRIR / CRIAR TICKET
// ─────────────────────────────────────────────────────────────

async function abrirTicket(interaction) {
  const cfg          = getConfig(interaction.guildId);
  // Aceita tanto o botão antigo (tkt_abrir_<categoria> no customId) quanto o
  // select menu novo (tkt_sel_abrir, categoria vem em interaction.values[0]).
  const categoriaVal = interaction.isAnySelectMenu()
    ? interaction.values[0]
    : interaction.customId.replace('tkt_abrir_', '');
  const variantes    = cfg.variantes || [];
  const varianteObj  = variantes.find(v => normalizarNome(v.nome) === categoriaVal);

  // Ticket já aberto?
  const existe = interaction.guild.channels.cache.find(c => c.topic === `ticket:${interaction.user.id}`);
  if (existe)
    return interaction.reply(errContainer(`<:negativo:1528400986744295475>  Você já tem um ticket aberto: <#${existe.id}>`));

  // Com modal de motivo
  if (cfg.modoModal !== false) {
    const modal = new ModalBuilder()
      .setCustomId(`modal_tkt_abrir_${categoriaVal}`)
      .setTitle(`Ticket — ${varianteObj?.nome || 'Suporte Geral'}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('tkt_motivo')
            .setLabel('Motivo do ticket')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Descreva brevemente o motivo do seu ticket...')
            .setRequired(true)
            .setMaxLength(500)
        )
      );
    return interaction.showModal(modal);
  }

  // Sem modal — cria direto
  return criarTicket(interaction, categoriaVal, null);
}

async function criarTicket(interaction, categoriaVal, motivo) {
  const cfg               = getConfig(interaction.guildId);
  const { guild, user }   = interaction;
  const variantes         = cfg.variantes || [];
  const varianteObj       = variantes.find(v => normalizarNome(v.nome) === categoriaVal);
  const categoriaNome     = varianteObj ? `${varianteObj.emoji || '<:config3:1524208114327617588>'}  ${varianteObj.nome}` : 'Suporte Geral';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (cfg.categoryId && !(await categoriaTicketValida(guild, cfg.categoryId))) {
    saveConfig(interaction.guildId, { categoryId: null });
    return interaction.editReply(categoriaInvalidaContainer());
  }

  try {
    const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

    const permOverwrites = [
      { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel] },
      { id: user.id,              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    if (cfg.staffRoleId) {
      permOverwrites.push({
        id: cfg.staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
      });
    }

    const channel = await guild.channels.create({
      name:               `ticket-${cleanName}`,
      type:               ChannelType.GuildText,
      topic:              `ticket:${user.id}`,
      parent: cfg.categoryId || null,
permissionOverwrites: permOverwrites, 
    });

    // Protocolo do ticket (usado na avaliação enviada por DM ao fechar).
    registrarTicket(guild.id, channel.id, user.id, channel.createdTimestamp);

    await channel.send({
      components: [buildTicketContainer({ user, staffRoleId: cfg.staffRoleId, categoriaNome, motivo })],
      flags:      MessageFlags.IsComponentsV2,
    });

    await interaction.editReply({
      components: [
        new ContainerBuilder().setAccentColor(COR.SUCCESS)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:positivo:1528401238197276702>  **Ticket criado!**\n> Acesse: <#${channel.id}>`))
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });

    // Log de abertura
    if (cfg.logsChannelId) {
      const logs = guild.channels.cache.get(cfg.logsChannelId);
      logs?.send({
        components: [
          new ContainerBuilder().setAccentColor(COR.GOLD)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              `<:termos:1533454585169973288>  **Ticket Aberto**\n` +
              `> <:user:1532137085081878558>  **Usuário:** <@${user.id}>\n` +
              `> 📂  **Categoria:** ${categoriaNome}\n` +
              `> <:canal:1524207214791884890>  **Canal:** <#${channel.id}>\n` +
              `> <:clock:1524207889441357917>  ${formatTs()}`
            ))
        ],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => {});
    }
  } catch (err) {
    if (err && err.code === 50035 && err.rawError && err.rawError.errors && err.rawError.errors.parent_id) {
      saveConfig(interaction.guildId, { categoryId: null });
      await interaction.editReply(categoriaInvalidaContainer());
      return;
    }
    console.error('[Tickets] Erro ao criar ticket:', err);
    await interaction.editReply({
      components: [
        new ContainerBuilder().setAccentColor(COR.DANGER)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:negativo:1528400986744295475>  Erro ao criar o ticket. Verifique as permissões do bot.'))
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  12. AÇÕES DO TICKET
// ─────────────────────────────────────────────────────────────

async function mostrarPainelEquipe(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode acessar este painel.'));

  const channel = interaction.channel;
  const userId  = channel.topic?.replace('ticket:', '') || null;
  const user    = userId ? await interaction.client.users.fetch(userId).catch(() => null) : null;

  await interaction.reply({
    components: [buildPainelEquipeContainer({ user: user || { id: 'desconhecido' }, categoriaNome: channel.name, claimUserId: getClaim(interaction.guildId, channel.id) })],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function notificarUsuario(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Sem permissão.'));

  const userId = interaction.channel.topic?.replace('ticket:', '');
  if (!userId) return interaction.reply({ content: '<:negativo:1528400986744295475>  Canal inválido.', flags: MessageFlags.Ephemeral });

  await interaction.reply({
    components: [
      new ContainerBuilder().setAccentColor(COR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:sino:1528840971096297482>  <@${userId}>, você tem uma resposta no seu ticket!`))
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function claimTicket(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode assumir tickets.'));

  const channel = interaction.channel;
  const jaAssumidoPor = getClaim(interaction.guildId, channel.id);
  if (jaAssumidoPor) {
    return interaction.reply(errContainer(`<:negativo:1528400986744295475>  Este ticket já foi assumido por <@${jaAssumidoPor}>.`));
  }

  setClaim(interaction.guildId, channel.id, interaction.user.id);

  // Atualiza a MESMA mensagem efêmera do Painel da Equipe (update, não reply)
  // — evita a mensagem duplicada/repetida que acontecia antes.
  const userId = channel.topic?.replace('ticket:', '') || null;
  const user   = userId ? await interaction.client.users.fetch(userId).catch(() => null) : null;
  await interaction.update({
    components: [buildPainelEquipeContainer({ user: user || { id: 'desconhecido' }, categoriaNome: channel.name, claimUserId: interaction.user.id })],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });

  // Aviso público no canal, visível pro cliente e resto da equipe.
  await channel.send({
    components: [
      new ContainerBuilder().setAccentColor(COR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `<:dev:1525538335139958915>  **Ticket Assumido**\n> Este atendimento foi assumido por <@${interaction.user.id}>.`
        ))
    ],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
}

async function abrirModalRenomear(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode renomear tickets.'));

  const channel = interaction.channel;
  if (!channel.topic?.startsWith('ticket:'))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Este canal não é um ticket.'));

  // Sufixo atual (sem o prefixo fixo "ticket-"/"closed-") — pré-preenche o
  // campo pra facilitar, já que só o sufixo pode ser alterado.
  const sufixoAtual = channel.name.replace(/^ticket-|^closed-/, '');

  const modal = new ModalBuilder().setCustomId('tkt_modal_renomear').setTitle('Renomear Ticket');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('tkt_novo_nome').setLabel('Novo nome (sem espaços/acentos)').setStyle(TextInputStyle.Short)
        .setValue(sufixoAtual).setRequired(true).setMaxLength(80),
    ),
  );
  return interaction.showModal(modal);
}

async function gerarTranscricao(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode gerar transcrição.'));

  const channel = interaction.channel;
  if (!channel.topic?.startsWith('ticket:'))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Este canal não é um ticket.'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const mensagens = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!mensagens || mensagens.size === 0) {
    return interaction.editReply({
      components: [
        new ContainerBuilder().setAccentColor(COR.DANGER)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:negativo:1528400986744295475>  Nenhuma mensagem encontrada neste canal.'))
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  const ordenadas = [...mensagens.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const linhas = ordenadas.map(m => {
    const hora   = new Date(m.createdTimestamp).toLocaleString('pt-BR');
    const autor  = m.author?.tag || m.author?.username || 'desconhecido';
    const corpo  = m.content?.trim() || (m.embeds?.length ? '[embed]' : m.components?.length ? '[componente]' : '[sem texto]');
    return `[${hora}] ${autor}: ${corpo}`;
  });
  const conteudo = `Transcrição de #${channel.name}\nGerada em ${new Date().toLocaleString('pt-BR')} por ${interaction.user.tag}\n\n${linhas.join('\n')}`;
  const arquivo = new AttachmentBuilder(Buffer.from(conteudo, 'utf-8'), { name: `transcricao-${channel.name}.txt` });

  await interaction.editReply({
    components: [
      new ContainerBuilder().setAccentColor(COR.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:copypast:1533880329536802896>  **Transcrição gerada** (${ordenadas.length} mensagem(ns))`))
    ],
    files: [arquivo],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function fecharTicket(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode fechar tickets.'));

  const channel = interaction.channel;
  if (!channel.topic?.startsWith('ticket:'))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Este canal não é um ticket.'));

  const userId = channel.topic.replace('ticket:', '');
  await interaction.deferReply();
  await channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
  await channel.setName(channel.name.replace('ticket-', 'closed-')).catch(() => {});

  await interaction.editReply({
    components: [
      new ContainerBuilder()
        .setAccentColor(COR.DANGER)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `<:CadLock:1533221942256078968>  **Ticket Fechado**\n` +
          `> Fechado por <@${interaction.user.id}>\n` +
          `> ${formatTs()}\n\n` +
          `> Use <:apagar:1524206738885050388>  **Deletar Ticket** para apagar o canal.`
        ))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tkt_deletar').setLabel('Deletar Ticket').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
          )
        )
    ],
    flags: MessageFlags.IsComponentsV2,
  });

  if (cfg.logsChannelId) {
    const logs = interaction.guild.channels.cache.get(cfg.logsChannelId);
    logs?.send({
      components: [
        new ContainerBuilder().setAccentColor(COR.DANGER)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `<:CadLock:1533221942256078968>  **Ticket Fechado**\n> <:canal:1524207214791884890>  <#${channel.id}>\n> <:user:1532137085081878558>  <@${interaction.user.id}>\n> <:clock:1524207889441357917>  ${formatTs()}`
          ))
      ],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }

  // Por último, para nunca atrasar/bloquear o fechamento em si.
  await enviarAvaliacaoPorDM(interaction, channel, userId);
}

// ─────────────────────────────────────────────────────────────
//  12b. AVALIAÇÃO DO ATENDIMENTO (DM ao fechar o ticket)
// ─────────────────────────────────────────────────────────────

/** 5 botões ⭐ 1..5. Após avaliar: todos desativados e o escolhido em verde. */
function buildAvaliacaoBotoes(guildId, channelId, notaEscolhida = null) {
  const row = new ActionRowBuilder();
  for (let nota = 1; nota <= 5; nota++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tkt_aval_${nota}_${guildId}_${channelId}`)
        .setLabel(String(nota))
        .setEmoji('⭐')
        .setStyle(notaEscolhida === nota ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(notaEscolhida !== null),
    );
  }
  return row;
}

function buildAvaliacaoDM({ guildId, channelId, protocolo, fechadoPorId }) {
  // O rodapé + timestamp é renderizado pelo próprio Discord no fuso de quem
  // lê ("Hoje às HH:MM"), então não depende do fuso do servidor do bot.
  const embed = new EmbedBuilder()
    .setColor(COR.GOLD)
    .setTitle('🎫 Ticket Fechado')
    .setDescription(
      'Seu ticket foi fechado com sucesso, avalie nosso atendimento clicando nas estrelas abaixo.\n\n' +
      `👤 **Fechado por:**\n<@${fechadoPorId}>\n\n` +
      `📋 **Protocolo:**\n\`${protocolo}\``,
    )
    .setFooter({ text: 'Caso necessário, não hesite em abrir ticket novamente!' })
    .setTimestamp();

  return { embeds: [embed], components: [buildAvaliacaoBotoes(guildId, channelId)] };
}

/**
 * Envia a DM de avaliação para QUEM ABRIU o ticket (não para quem fechou).
 * Chamada no fim de fecharTicket, depois de o ticket já estar fechado.
 *
 * Só os dois erros esperados do Discord são tratados aqui (DM fechada / usuário
 * inexistente): ficam registrados no ticket e o fechamento segue normal.
 * Qualquer outro erro é relançado — nada é engolido em silêncio.
 */
async function enviarAvaliacaoPorDM(interaction, channel, abertoPorTopic) {
  const guildId = interaction.guildId;

  // Ticket aberto antes desta função existir não tem registro: cria agora.
  const existente = getRegistro(guildId, channel.id)
    || registrarTicket(guildId, channel.id, abertoPorTopic, channel.createdTimestamp);
  const registro = salvarRegistro(guildId, channel.id, {
    ...existente, fechadoPor: interaction.user.id, fechadoEm: Date.now(),
  });

  // O botão "Fechar" continua na mensagem do ticket: fechar de novo não gera 2ª DM.
  if (registro.dmAvaliacao === 'enviada' || registro.avaliacao) return;

  const payload = buildAvaliacaoDM({
    guildId,
    channelId:      channel.id,
    protocolo:      registro.protocolo,
    fechadoPorId:   interaction.user.id,
  });

  let status = 'enviada';
  try {
    const abriu = await interaction.client.users.fetch(registro.abertoPor);
    await abriu.send(payload);
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser)  status = 'dm_fechada';
    else if (err.code === RESTJSONErrorCodes.UnknownUser)              status = 'usuario_inexistente';
    else throw err;
    console.warn(`[Tickets] Avaliação de ${registro.protocolo} não enviada (${status}) — usuário ${registro.abertoPor}.`);
  }

  // Relê antes de gravar: não sobrescreve nada gravado durante o await acima.
  salvarRegistro(guildId, channel.id, { ...getRegistro(guildId, channel.id), dmAvaliacao: status });
}

/** Clique numa das estrelas da DM (customId: tkt_aval_<nota>_<guildId>_<channelId>). */
async function registrarAvaliacao(interaction) {
  const m = /^tkt_aval_([1-5])_(\d+)_(\d+)$/.exec(interaction.customId);
  if (!m) {
    return interaction.reply({ content: '<:negativo:1528400986744295475>  Avaliação inválida.', flags: MessageFlags.Ephemeral });
  }
  const nota      = Number(m[1]);
  const guildId   = m[2];
  const channelId = m[3];

  const registro = getRegistro(guildId, channelId);
  if (!registro) {
    return interaction.reply({ content: '<:negativo:1528400986744295475>  Não encontrei esse ticket para registrar a avaliação.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== registro.abertoPor) {
    return interaction.reply({ content: '<:negativo:1528400986744295475>  Apenas quem abriu o ticket pode avaliá-lo.', flags: MessageFlags.Ephemeral });
  }

  // Sem await entre a checagem e a gravação: clique duplo não avalia duas vezes.
  // Se já foi avaliado, a nota original é mantida.
  const avaliacao = registro.avaliacao
    || { nota, avaliadoPor: interaction.user.id, avaliadoEm: Date.now() };
  if (!registro.avaliacao) salvarRegistro(guildId, channelId, { ...registro, avaliacao });

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(COR.SUCCESS)
    .setFields({ name: 'Sua avaliação', value: `${'⭐'.repeat(avaliacao.nota)} (${avaliacao.nota}/5) — obrigado!` });

  return interaction.update({
    embeds:     [embed],
    components: [buildAvaliacaoBotoes(guildId, channelId, avaliacao.nota)],
  });
}

async function deletarTicket(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg))
    return interaction.reply(errContainer('<:negativo:1528400986744295475>  Apenas a equipe pode deletar tickets.'));

  // Sem mensagem no chat — só confirma a interação silenciosamente
  // (deferUpdate não posta nada visível) e já deleta em 2s.
  await interaction.deferUpdate().catch(() => {});

  if (cfg.logsChannelId) {
    try {
      const mensagens  = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = mensagens.reverse().map(m =>
        `[${new Date(m.createdTimestamp).toLocaleString('pt-BR')}] ${m.author.tag}: ${m.content || '[embed/componente]'}`
      ).join('\n');

      const buffer     = Buffer.from(transcript, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });
      const logs       = interaction.guild.channels.cache.get(cfg.logsChannelId);

      await logs?.send({
        components: [
          new ContainerBuilder().setAccentColor(COR.DANGER)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              `<:apagar:1524206738885050388>  **Ticket Deletado — Transcript**\n` +
              `> <:canal:1524207214791884890>  **Canal:** ${interaction.channel.name}\n` +
              `> <:user:1532137085081878558>  **Por:** <@${interaction.user.id}>\n` +
              `> <:clock:1524207889441357917>  ${formatTs()}`
            ))
        ],
        files: [attachment],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => {});
    } catch {}
  }

  setTimeout(() => interaction.channel.delete().catch(console.error), 2000);
}

// ─────────────────────────────────────────────────────────────
//  13. HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  // ── Config admin ──
  if (id === 'tkt_cfg_canal')          return cfgCanal(interaction);
  if (id === 'tkt_cfg_categoria')      return cfgCategoria(interaction);
  if (id === 'tkt_cfg_staff')          return cfgStaff(interaction);
  if (id === 'tkt_cfg_logs')           return cfgLogs(interaction);
  if (id === 'tkt_cfg_modal_toggle')   return toggleModal(interaction);
  if (id === 'tkt_cfg_embed')          return abrirEditorLayout(interaction);
  if (id === 'tkt_cfg_variantes')      return mostrarVariantes(interaction, false);
  if (id === 'tkt_cfg_publicar')       return publicar(interaction);
  if (id === 'tkt_cfg_deletar')        return deletarPainel(interaction);

  // ── Variantes (dentro da tela de variantes — usa update) ──
  if (id === 'tkt_var_adicionar')      return modalAdicionarVariante(interaction);
  if (id === 'tkt_var_editar')         return modalEditarVariante(interaction);
  if (id === 'tkt_var_remover')        return modalRemoverVariante(interaction);
  if (id === 'tkt_var_listar')         return listarVariantes(interaction);
  // CORREÇÃO: tkt_var_voltar estava fazendo reply() → duplicava mensagem.
  // Agora chama mostrarVariantes com modoUpdate=true → usa update().
  if (id === 'tkt_var_voltar')         return mostrarVariantes(interaction, true);

  // ── Editor de layout (dentro do editor — usa update) ──
  if (id === 'tkt_layout_textbase')        return modalEditarTextoBase(interaction);
  if (id === 'tkt_layout_add_texto')       return modalAddTexto(interaction);
  if (id === 'tkt_layout_add_divisor')     return modalAddDivisor(interaction);
  if (id === 'tkt_layout_add_midia')       return modalAddMidia(interaction);
  if (id === 'tkt_layout_thumbnail')       return modalThumbnail(interaction);
  if (id === 'tkt_layout_estrutura')       return gerenciarEstrutura(interaction);
  if (id === 'tkt_layout_cor')             return selecionarCorPainel(interaction);
  if (id === 'tkt_layout_voltar_editor')   return atualizarEditorLayout(interaction);
  // CORREÇÃO: tkt_layout_voltar estava fazendo reply() → duplicava mensagem.
  // Agora usa atualizarEditorLayout que faz update() na mesma mensagem efêmera.
  if (id === 'tkt_layout_voltar') {
    return interaction.update({
      components: [buildAdminContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  // ── Ticket público / equipe ──
  if (id.startsWith('tkt_abrir_'))     return abrirTicket(interaction);
  if (id === 'tkt_claim')              return claimTicket(interaction);
  if (id === 'tkt_renomear')           return abrirModalRenomear(interaction);
  if (id === 'tkt_transcricao')        return gerarTranscricao(interaction);
  if (id === 'tkt_fechar')             return fecharTicket(interaction);
  if (id === 'tkt_deletar')            return deletarTicket(interaction);
  if (id === 'tkt_notificar')          return notificarUsuario(interaction);
  if (id === 'tkt_painel_equipe')      return mostrarPainelEquipe(interaction);

  // ── Avaliação do atendimento (botões da DM enviada ao fechar o ticket) ──
  if (id.startsWith('tkt_aval_'))      return registrarAvaliacao(interaction);
}

async function handleSelectMenu(interaction) {
  const id  = interaction.customId;
  const val = interaction.values[0];

  // ── Abrir ticket via select menu (categoria/variante) ──
  if (id === 'tkt_sel_abrir') return abrirTicket(interaction);

  // ── Selects de config (canal, categoria, staff, logs) ──
  const cfgMap = {
    tkt_sel_canal:     { key: 'channelId',     titulo: '<:positivo:1528401238197276702>  Canal Configurado!',     desc: `Canal: <#${val}>`      },
    tkt_sel_categoria: { key: 'categoryId',    titulo: '<:positivo:1528401238197276702>  Categoria Configurada!', desc: `Categoria: <#${val}>`  },
    tkt_sel_staff:     { key: 'staffRoleId',   titulo: '<:positivo:1528401238197276702>  Staff Configurado!',     desc: `Cargo: <@&${val}>`     },
    tkt_sel_logs:      { key: 'logsChannelId', titulo: '<:positivo:1528401238197276702>  Logs Configurado!',      desc: `Logs: <#${val}>`       },
  };

  if (cfgMap[id]) {
    saveConfig(interaction.guildId, { [cfgMap[id].key]: val });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    return interaction.reply({
      components: [
        new ContainerBuilder().setAccentColor(COR.SUCCESS)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${cfgMap[id].titulo}\n> ${cfgMap[id].desc}`))
      ],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }

  if (id === 'tkt_sel_layout_cor') {
    saveConfig(interaction.guildId, { corPainel: parseInt(val) });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    return atualizarEditorLayout(interaction);
  }

  if (id === 'tkt_sel_layout_editar') {
    const cfg    = getConfig(interaction.guildId);
    const blocos = cfg.layoutBlocos || [];
    const idx    = parseInt(val);
    const bloco  = blocos[idx];
    if (!bloco) return gerenciarEstrutura(interaction);
    return modalEditarBloco(interaction, idx, bloco);
  }

  if (id === 'tkt_sel_layout_remover') {
    const cfg    = getConfig(interaction.guildId);
    const blocos = cfg.layoutBlocos || [];
    const idx    = parseInt(val);
    if (idx >= 0 && idx < blocos.length) {
      blocos.splice(idx, 1);
      saveConfig(interaction.guildId, { layoutBlocos: blocos });
      await atualizarPainelMsg(interaction.guildId, interaction.guild);
    }
    return gerenciarEstrutura(interaction);
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  // ── Renomear ticket (painel da equipe → Renomear) ──
  if (id === 'tkt_modal_renomear') {
    const channel = interaction.channel;
    const prefixo = channel.name.startsWith('closed-') ? 'closed-' : 'ticket-';
    const novoSufixo = interaction.fields.getTextInputValue('tkt_novo_nome').trim()
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    if (!novoSufixo) {
      return interaction.reply(errContainer('<:negativo:1528400986744295475>  Nome inválido. Use apenas letras, números e hífens.'));
    }

    const nomeFinal = `${prefixo}${novoSufixo}`.slice(0, 100);
    await channel.setName(nomeFinal).catch(() => {});

    return interaction.reply({
      components: [
        new ContainerBuilder().setAccentColor(COR.SUCCESS)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:editar:1528400388137549864>  Ticket renomeado para \`${nomeFinal}\`.`))
      ],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }


  if (id.startsWith('modal_tkt_abrir_')) {
    const categoriaVal = id.replace('modal_tkt_abrir_', '');
    const motivo       = interaction.fields.getTextInputValue('tkt_motivo').trim();
    return criarTicket(interaction, categoriaVal, motivo);
  }

  // ── Editor de layout: após submissão de modal, re-abre o editor ──
  // Todos os modais de layout abaixo salvam e reabrem o editor com reply()
  // (modal submit nunca tem mensagem prévia para dar update).

  if (id === 'tkt_modal_embed') {
    saveConfig(interaction.guildId, {
      embedTitulo:    interaction.fields.getTextInputValue('tkt_titulo'),
      embedDescricao: interaction.fields.getTextInputValue('tkt_descricao'),
      embedFooter:    interaction.fields.getTextInputValue('tkt_footer'),
    });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    // Atualiza a MESMA mensagem efêmera do editor (update), em vez de
    // reply() — reply() criava uma mensagem nova a cada edição e por
    // isso o editor parecia "duplicar" a cada Add Texto/Mídia/Divisor.
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  if (id === 'tkt_modal_layout_texto') {
    const posicao = interaction.fields.getTextInputValue('tkt_layout_posicao').trim().toLowerCase() === 'depois' ? 'depois' : 'antes';
    const cfg     = getConfig(interaction.guildId);
    const blocos  = cfg.layoutBlocos || [];
    blocos.push({ tipo: 'texto', conteudo: interaction.fields.getTextInputValue('tkt_layout_conteudo').trim(), posicao });
    saveConfig(interaction.guildId, { layoutBlocos: blocos });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    // Atualiza a MESMA mensagem efêmera do editor (update), em vez de
    // reply() — reply() criava uma mensagem nova a cada edição e por
    // isso o editor parecia "duplicar" a cada Add Texto/Mídia/Divisor.
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  if (id === 'tkt_modal_layout_midia') {
    const posicao = interaction.fields.getTextInputValue('tkt_layout_posicao').trim().toLowerCase() === 'depois' ? 'depois' : 'antes';
    const cfg     = getConfig(interaction.guildId);
    const blocos  = cfg.layoutBlocos || [];
    blocos.push({ tipo: 'midia', conteudo: interaction.fields.getTextInputValue('tkt_layout_url').trim(), posicao });
    saveConfig(interaction.guildId, { layoutBlocos: blocos });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    // Atualiza a MESMA mensagem efêmera do editor (update), em vez de
    // reply() — reply() criava uma mensagem nova a cada edição e por
    // isso o editor parecia "duplicar" a cada Add Texto/Mídia/Divisor.
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  if (id === 'tkt_modal_layout_divisor') {
    const posicao = interaction.fields.getTextInputValue('tkt_layout_posicao').trim().toLowerCase() === 'depois' ? 'depois' : 'antes';
    const cfg     = getConfig(interaction.guildId);
    const blocos  = cfg.layoutBlocos || [];
    blocos.push({ tipo: 'divisor', conteudo: null, posicao });
    saveConfig(interaction.guildId, { layoutBlocos: blocos });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    // Atualiza a MESMA mensagem efêmera do editor (update), em vez de
    // reply() — reply() criava uma mensagem nova a cada edição e por
    // isso o editor parecia "duplicar" a cada Add Texto/Mídia/Divisor.
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  // KAEL — edição de um bloco JÁ EXISTENTE (via "Gerenciar Estrutura" >
  // select "editar"), aberto pré-preenchido em modalEditarBloco(). Ao
  // contrário dos handlers de "Add ..." acima (que sempre fazem push de um
  // bloco novo), este SUBSTITUI o bloco no mesmo índice — corrige a
  // duplicação de texto quando o cliente só queria alterar o que já tinha.
  if (id.startsWith('tkt_modal_layout_editar_')) {
    const idx    = parseInt(id.replace('tkt_modal_layout_editar_', ''), 10);
    const cfg    = getConfig(interaction.guildId);
    const blocos = cfg.layoutBlocos || [];
    const atual  = blocos[idx];
    if (!atual) {
      return interaction.reply(errContainer('<:negativo:1528400986744295475>  Este bloco não existe mais (pode ter sido removido).'));
    }

    const posicao = interaction.fields.getTextInputValue('tkt_layout_posicao').trim().toLowerCase() === 'depois' ? 'depois' : 'antes';
    if (atual.tipo === 'texto') {
      blocos[idx] = { ...atual, conteudo: interaction.fields.getTextInputValue('tkt_layout_conteudo').trim(), posicao };
    } else if (atual.tipo === 'midia') {
      blocos[idx] = { ...atual, conteudo: interaction.fields.getTextInputValue('tkt_layout_url').trim(), posicao };
    } else {
      blocos[idx] = { ...atual, posicao };
    }
    saveConfig(interaction.guildId, { layoutBlocos: blocos });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  if (id === 'tkt_modal_layout_thumb') {
    const url = interaction.fields.getTextInputValue('tkt_layout_thumb_url').trim();
    saveConfig(interaction.guildId, { thumbnailUrl: url || null });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    // Atualiza a MESMA mensagem efêmera do editor (update), em vez de
    // reply() — reply() criava uma mensagem nova a cada edição e por
    // isso o editor parecia "duplicar" a cada Add Texto/Mídia/Divisor.
    const payload = {
      components: [buildEditorContainer(getConfig(interaction.guildId), interaction.guild)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply(payload);
  }

  // ── Variantes ──
  if (id === 'tkt_modal_variante_add') {
    const nome      = interaction.fields.getTextInputValue('tkt_var_nome').trim();
    const emoji     = emojiValido(interaction.fields.getTextInputValue('tkt_var_emoji').trim());
    const descricao = interaction.fields.getTextInputValue('tkt_var_desc').trim();
    const cfg       = getConfig(interaction.guildId);
    const variantes = cfg.variantes || [];
    variantes.push({ nome, emoji, descricao, criado: new Date().toISOString() });
    saveConfig(interaction.guildId, { variantes });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    return interaction.reply(okContainer(`<:positivo:1528401238197276702>  **Variante Adicionada!**\n> ${emoji}  **${nome}**`));
  }

  if (id === 'tkt_modal_variante_remover') {
    const nome      = interaction.fields.getTextInputValue('tkt_var_nome_rem').trim();
    const cfg       = getConfig(interaction.guildId);
    const variantes = cfg.variantes || [];
    const novas     = variantes.filter(v => v.nome.toLowerCase() !== nome.toLowerCase());
    if (novas.length === variantes.length)
      return interaction.reply(errContainer(`<:negativo:1528400986744295475>  Variante \`${nome}\` não encontrada.`));
    saveConfig(interaction.guildId, { variantes: novas });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    return interaction.reply(okContainer(`<:apagar:1524206738885050388>  **Variante Removida!**\n> **${nome}**`));
  }

  if (id === 'tkt_modal_variante_editar') {
    const nomeAntigo = interaction.fields.getTextInputValue('tkt_var_nome_ant').trim();
    const nomeNovo   = interaction.fields.getTextInputValue('tkt_var_nome_novo').trim();
    const emoji      = interaction.fields.getTextInputValue('tkt_var_emoji_ed').trim();
    const descricao  = interaction.fields.getTextInputValue('tkt_var_desc_ed').trim();
    const cfg        = getConfig(interaction.guildId);
    const variantes  = cfg.variantes || [];
    const idx        = variantes.findIndex(v => v.nome.toLowerCase() === nomeAntigo.toLowerCase());
    if (idx === -1)
      return interaction.reply(errContainer(`<:negativo:1528400986744295475>  Variante \`${nomeAntigo}\` não encontrada.`));
    variantes[idx] = {
      ...variantes[idx],
      nome:      nomeNovo   || variantes[idx].nome,
      emoji:     emoji      ? emojiValido(emoji) : variantes[idx].emoji,
      descricao: descricao  || variantes[idx].descricao,
    };
    saveConfig(interaction.guildId, { variantes });
    await atualizarPainelMsg(interaction.guildId, interaction.guild);
    return interaction.reply(okContainer(`<:positivo:1528401238197276702>  **Variante Editada!**\n> **${nomeNovo || nomeAntigo}**`));
  }
}

// ─────────────────────────────────────────────────────────────
//  14. EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = { showAdminPanel, handleButton, handleSelectMenu, handleModal };
