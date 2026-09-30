/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Definições
 *  Reescrita fiel do Definicoes.py (NX7 VENDAS / Ease Pro)
 *
 *  Acionado por: botão 'painel_definicoes' no /painel
 *
 *  Seções (idênticas ao Python):
 *   • Canais      — configurar 8 canais do servidor
 *   • Cargos      — configurar 5 cargos do servidor
 *   • Anti Fake   — modal com dias mínimos + nomes bloqueados
 *   • Formas de Pagamento — status + configuração de PIX (Semi Auto)
 *   • Bloquear Bancos — lista de bancos aceitos/bloqueados
 *
 *  Dados salvos em: loja.definicoes (canais, cargos, antifake, bancos)
 * ─────────────────────────────────────────────────────────────────
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('../database/db');

// ── Helpers do banco ─────────────────────────────────────────────

function getDef(guildId) {
  return db.getGuild(guildId).loja?.definicoes || {};
}

function saveDef(guildId, definicoes) {
  db.updateGuild(guildId, 'loja.definicoes', definicoes);
}

function getCanais(guildId) {
  return getDef(guildId).canais || {
    logs: null, vendas: null, boasvindas: null, sistema: null,
    registroauditoria: null, antifake: null, tickets: null, feedbacks: null,
  };
}

function getCargos(guildId) {
  return getDef(guildId).cargos || {
    administrador: null, suporte: null, cliente: null, membro: null, verificado: null,
  };
}

function getAntiFake(guildId) {
  return getDef(guildId).antifake || { quantidadeMinima: '', nomesBloqueados: [] };
}

function getBancos(guildId) {
  const def = getDef(guildId);
  return {
    disponiveis: def.bancosDisponiveis || [
      'Nubank', 'Itaú', 'Bradesco', 'Santander', 'Caixa',
      'Banco do Brasil', 'Inter', 'C6', 'PagBank', 'Mercado Pago',
    ],
    bloqueados: def.bancosBloqueados || [],
  };
}

function getFormasPagamento(guildId) {
  const loja = db.getGuild(guildId).loja || {};
  const mp = loja.mercadopago || { habilitado: false, configurado: false, accessKey: null };
  const c6 = loja.c6bank || { habilitado: false };
  const c6ConfigOk = !!(c6.clientId && c6.clientSecret && c6.chavePix);
  return {
    semiauto: {
      habilitado: !!(loja.pix?.chave),
      configurado: !!(loja.pix?.chave),
    },
    mercadopago: { habilitado: !!mp.habilitado, configurado: !!mp.configurado },
    efi:         { habilitado: false, configurado: false },
    c6:          { habilitado: !!c6.habilitado, configurado: c6ConfigOk },
  };
}

// ── Formatadores ─────────────────────────────────────────────────

function fmtCanal(id)  { return id  ? `<#${id}>`   : '<:negativo:1528400986744295475> `Não definido`'; }
function fmtCargo(id)  { return id  ? `<@&${id}>`  : '<:negativo:1528400986744295475> `Não definido`'; }
function fmtStatus(ok) { return ok  ? '<:positivo:1528401238197276702> `Sim`'   : '<:negativo:1528400986744295475> `Não`'; }

// ── PAINEL INICIAL ───────────────────────────────────────────────
// Equivalente a ObterComponentsPainelInicial()

function painelInicialComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('Def_Canais')       .setLabel('Canais')              .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('Def_Cargos')       .setLabel('Cargos')              .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('Def_AntiFake')     .setLabel('Anti Fake')           .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('Def_FormasPag')    .setLabel('Formas de Pagamento') .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('Def_Voltar')       .setLabel('Voltar')              .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// Re-checa se quem clicou é Administrator. O slash command /painel já
// exige Administrator para CRIAR a mensagem do painel, mas depois que
// ela existe no canal, qualquer clique nos botões abaixo não conferia
// de novo quem estava clicando — só o plano da loja era checado. Esta
// função fecha essa brecha sem mudar nenhuma lógica de definições.
async function usuarioTemPermissaoDefinicoes(interaction) {
  if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  const payload = {
    content: '<:negativo:1528400986744295475> Você precisa ser Administrator para usar as Definições.',
    embeds: [],
    components: [],
    flags: 64,
  };
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply(payload).catch(() => {});
  } else {
    await interaction.followUp(payload).catch(() => {});
  }
  return false;
}

async function abrirDefinicoes(interaction) {
  if (!(await usuarioTemPermissaoDefinicoes(interaction))) return;

  const nome = interaction.user.displayName || interaction.user.username;
  return interaction.reply({
    content: `O que precisa configurar, **${nome}**?`,
    components: painelInicialComponents(),
    flags: 64,
  });
}

// ── CANAIS ───────────────────────────────────────────────────────
// Equivalente a Canais.ObterMensagemCanais()

function buildCanaisEmbed(interaction, canais) {
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Configurar Canais')
    .setDescription(
      `**Canal de logs gerais**: ${fmtCanal(canais.logs)}\n` +
      `**Canal de vendas**: ${fmtCanal(canais.vendas)}\n` +
      `**Canal de boas-vindas**: ${fmtCanal(canais.boasvindas)}\n` +
      `**Canal de logs do sistema**: ${fmtCanal(canais.sistema)}\n` +
      `**Canal de registro de auditoria**: ${fmtCanal(canais.registroauditoria)}\n` +
      `**Canal de logs do Anti Fake**: ${fmtCanal(canais.antifake)}\n` +
      `**Canal de logs de tickets**: ${fmtCanal(canais.tickets)}\n` +
      `**Canal de feedbacks**: ${fmtCanal(canais.feedbacks)}`
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildCanaisComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('DefSelect_Canais')
    .setPlaceholder('Selecione um canal para configurar')
    .addOptions([
      { label: 'Canal de logs gerais',             value: 'logs',             emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de vendas',                   value: 'vendas',           emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de boas-vindas',              value: 'boasvindas',       emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de logs do sistema',          value: 'sistema',          emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de registro de auditoria',    value: 'registroauditoria',emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de logs do Anti Fake',        value: 'antifake',         emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de logs de tickets',          value: 'tickets',          emoji: '<:editar:1528400388137549864>' },
      { label: 'Canal de feedbacks',                value: 'feedbacks',        emoji: '<:editar:1528400388137549864>' },
    ]);

  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('GerenciarPainelConfigurar').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── GERENCIAR CANAL ESPECÍFICO ────────────────────────────────────
// Equivalente a Canais.GerenciarCanal()

function buildGerenciarCanalComponents(canalKey, canalAtualId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`DefRemoverCanal_${canalKey}`)
        .setLabel('Remover')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canalAtualId),
      new ButtonBuilder()
        .setCustomId(`DefCriarCanal_${canalKey}`)
        .setLabel('Crie pra mim')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('Def_Canais')
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`DefAlterarCanal_${canalKey}`)
        .setPlaceholder('Selecione o novo canal desejado')
        .setChannelTypes(ChannelType.GuildText)
    ),
  ];
}

// ── CARGOS ───────────────────────────────────────────────────────
// Equivalente a Cargos.ObterMensagemCargos()

function buildCargosEmbed(interaction, cargos) {
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Configurar Cargos')
    .setDescription(
      `**Cargo de administrador**: ${fmtCargo(cargos.administrador)}\n` +
      `**Cargo de suporte**: ${fmtCargo(cargos.suporte)}\n` +
      `**Cargo de cliente**: ${fmtCargo(cargos.cliente)}\n` +
      `**Cargo de membro**: ${fmtCargo(cargos.membro)}\n` +
      `**Cargo verificado**: ${fmtCargo(cargos.verificado)}`
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildCargosComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('DefSelect_Cargos')
    .setPlaceholder('Selecione um cargo para configurar')
    .addOptions([
      { label: 'Cargo de administrador', value: 'administrador', emoji: '<:editar:1528400388137549864>' },
      { label: 'Cargo de suporte',       value: 'suporte',       emoji: '<:editar:1528400388137549864>' },
      { label: 'Cargo de cliente',       value: 'cliente',       emoji: '<:editar:1528400388137549864>' },
      { label: 'Cargo de membro',        value: 'membro',        emoji: '<:editar:1528400388137549864>' },
      { label: 'Cargo de verificado',    value: 'verificado',    emoji: '<:editar:1528400388137549864>' },
    ]);

  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('GerenciarPainelConfigurar').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── GERENCIAR CARGO ESPECÍFICO ────────────────────────────────────
// Equivalente a Cargos.GerenciarCargo()

function buildGerenciarCargoComponents(cargoKey, cargoAtualId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`DefRemoverCargo_${cargoKey}`)
        .setLabel('Remover')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!cargoAtualId),
      new ButtonBuilder()
        .setCustomId(`DefCriarCargo_${cargoKey}`)
        .setLabel('Crie pra mim')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('Def_Cargos')
        .setLabel('Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`DefAlterarCargo_${cargoKey}`)
        .setPlaceholder('Selecione o novo cargo desejado')
    ),
  ];
}

// ── FORMAS DE PAGAMENTO ───────────────────────────────────────────
// Equivalente a Pagamentos.ObterPainelFormasPagamento()

function buildFormasPagEmbed(interaction, fp) {
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  function fmt(habilitado, configurado) {
    return `${fmtStatus(habilitado)} Habilitado\n${fmtStatus(configurado)} Configurado`;
  }

  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Configurar Formas de Pagamento')
    .setDescription('Configure, habilite e desabilite as formas de pagamento disponíveis por aqui.')
    .addFields(
      { name: 'Mercado Pago',   value: fmt(fp.mercadopago.habilitado, fp.mercadopago.configurado), inline: true },
      { name: 'Efí Bank',       value: fmt(fp.efi.habilitado,         fp.efi.configurado),         inline: true },
      { name: 'C6 Bank',        value: fmt(fp.c6.habilitado,          fp.c6.configurado),          inline: true },
      { name: 'Semi Automático',value: fmt(fp.semiauto.habilitado,    fp.semiauto.configurado),    inline: true },
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildFormasPagComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('DefFormasPag_MercadoPago').setLabel('Mercado Pago')   .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('DefFormasPag_Efi')        .setLabel('Efí Bank')        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('DefFormasPag_C6')         .setLabel('C6 Bank')          .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('DefFormasPag_SemiAuto')   .setLabel('Semi Automático') .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('DefBancosBloqueados')        .setLabel('Bloquear Bancos').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('DefDocumentacaoFormasPag')   .setLabel('Documentação')  .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('GerenciarPainelConfigurar')  .setLabel('Voltar')        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── MERCADO PAGO ─────────────────────────────────────────────────
// Reescrita em JavaScript de Functions/Config/FormasPagamento/MercadoPago.py
// (bot NX7, disnake/Python) — mesma função: validar a Access Key na API
// real do Mercado Pago, salvar por servidor, habilitar/desabilitar.
//
// Diferença do original: lá era um arquivo pagamentos.json global único;
// aqui fica em loja.mercadopago (por guildId), reaproveitando db.js.

// Equivalente a verificarMercadoPago(accesskey) — GET /users/me com o
// Bearer token; 200 = chave válida, qualquer outro status = inválida.
async function verificarMercadoPago(accessKey) {
  try {
    const resposta = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessKey}` },
    });
    return resposta.ok;
  } catch (e) {
    console.error('[Mercado Pago] Erro ao validar Access Key:', e.message);
    return false;
  }
}

// Equivalente a salvarMP(access_key)
function salvarMercadoPago(guildId, accessKey) {
  const loja = db.getGuild(guildId).loja || {};
  const atual = loja.mercadopago || { habilitado: false };
  db.updateGuild(guildId, 'loja.mercadopago', {
    habilitado: atual.habilitado,
    configurado: true,
    accessKey,
  });
}

function toggleMercadoPago(guildId) {
  const loja = db.getGuild(guildId).loja || {};
  const mp = loja.mercadopago;
  if (!mp?.configurado) return null; // não deixa habilitar sem credenciais, igual ao Python
  db.updateGuild(guildId, 'loja.mercadopago.habilitado', !mp.habilitado);
  return !mp.habilitado;
}

// Equivalente a GerenciarMercadoPago(inter) — monta o embed com a chave
// mascarada (10 primeiros + 10 últimos caracteres visíveis, resto oculto).
function buildMercadoPagoEmbed(interaction) {
  const loja = db.getGuild(interaction.guildId).loja || {};
  const mp = loja.mercadopago || { habilitado: false, configurado: false, accessKey: null };
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  const embed = new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Mercado Pago | Formas de Pagamento')
    .setDescription('Aqui, você pode configurar tudo referente ao Mercado Pago.')
    .addFields({
      name: 'Sistema',
      value: `${fmtStatus(mp.habilitado)} Habilitado\n${fmtStatus(mp.configurado)} Configurado`,
    })
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();

  if (mp.accessKey) {
    const inicio = mp.accessKey.slice(0, 10);
    const fim = mp.accessKey.slice(-10);
    embed.addFields({ name: 'Access Key', value: `\`\`\`${inicio}${'*'.repeat(20)}${fim}\`\`\`` });
  } else {
    embed.addFields({ name: 'Access Key', value: '<:negativo:1528400986744295475> `Não definido`' });
  }

  return embed;
}

function buildMercadoPagoComponents(interaction) {
  const loja = db.getGuild(interaction.guildId).loja || {};
  const mp = loja.mercadopago || { habilitado: false };
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ConfigurarSistemaMP').setLabel('Configurar Credenciais').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('HabilitarDesabilitarSistemaPagamento_MP')
        .setLabel(mp.habilitado ? 'Desabilitar' : 'Habilitar')
        .setStyle(mp.habilitado ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('Def_FormasPag').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function abrirGerenciarMercadoPago(interaction) {
  const embed = buildMercadoPagoEmbed(interaction);
  const components = buildMercadoPagoComponents(interaction);
  return interaction.update({ content: null, embeds: [embed], components });
}

// Equivalente a ConfigurarMercadoPagoModal
function buildModalMercadoPago() {
  const modal = new ModalBuilder().setCustomId('DefModal_MercadoPago').setTitle('Credenciais Mercado Pago');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('accesskey').setLabel('Chave SDK da API (Mercado Pago)')
        .setStyle(TextInputStyle.Short).setPlaceholder('APP_USR-000000000000000-XXXXXXX-XXXXXXXXX').setRequired(true)
    )
  );
  return modal;
}

async function processarModalMercadoPago(interaction) {
  await interaction.deferUpdate();

  const accessKey = interaction.fields.getTextInputValue('accesskey').trim();
  const valida = await verificarMercadoPago(accessKey);

  if (valida) {
    salvarMercadoPago(interaction.guildId, accessKey);
    const embed = buildMercadoPagoEmbed(interaction);
    const components = buildMercadoPagoComponents(interaction);
    await interaction.editReply({ content: null, embeds: [embed], components });
    return interaction.followUp({ content: '<:positivo:1528401238197276702> Chave salva com sucesso.', flags: 64 });
  }

  const embed = buildMercadoPagoEmbed(interaction);
  const components = buildMercadoPagoComponents(interaction);
  await interaction.editReply({ content: null, embeds: [embed], components });

  const rowAjuda = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Painel de desenvolvedores').setStyle(ButtonStyle.Link).setURL('https://www.mercadopago.com.br/developers/pt')
  );
  return interaction.followUp({
    content:
      '<:negativo:1528400986744295475> Access Token inválida! Caso precise de ajuda, olhe o tutorial abaixo de como obter.\n' +
      '1. Acesse o painel de desenvolvedores do Mercado Pago\n' +
      '2. Acesse **Suas Integrações** no canto superior direito\n' +
      '3. Selecione uma aplicação ou crie uma com a opção **Checkout Transparente**\n' +
      '4. Acesse **Credenciais de produção**\n' +
      '5. Copie o Access Key mostrado e registre no Bot novamente',
    components: [rowAjuda],
    flags: 64,
  });
}

async function handleToggleMercadoPago(interaction) {
  await interaction.deferUpdate();

  const loja = db.getGuild(interaction.guildId).loja || {};
  const mp = loja.mercadopago;

  if (!mp?.configurado) {
    const embed = buildMercadoPagoEmbed(interaction);
    const components = buildMercadoPagoComponents(interaction);
    await interaction.editReply({ content: null, embeds: [embed], components });
    return interaction.followUp({ content: '<:negativo:1528400986744295475> As credenciais não estão configuradas.', flags: 64 });
  }

  const novoEstado = toggleMercadoPago(interaction.guildId);
  const embed = buildMercadoPagoEmbed(interaction);
  const components = buildMercadoPagoComponents(interaction);
  await interaction.editReply({ content: null, embeds: [embed], components });
  return interaction.followUp({
    content: novoEstado ? '<:positivo:1528401238197276702> O sistema de pagamento Mercado Pago foi habilitado.' : '<:positivo:1528401238197276702> O sistema de pagamento Mercado Pago foi desabilitado.',
    flags: 64,
  });
}

// ── BLOQUEAR BANCOS ───────────────────────────────────────────────
// Equivalente a BloquearBancos.ObterPainelBloquearBancos()

function buildBancosEmbed(interaction, bancos) {
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  const desc = bancos.bloqueados.length > 0
    ? bancos.bloqueados.join('\n')
    : '<:negativo:1528400986744295475> Nenhum banco bloqueado';

  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Bloquear Bancos | Formas de Pagamento')
    .setDescription(
      `Aqui você pode bloquear ou desbloquear bancos que não deseja aceitar pagamentos.\n\n` +
      `**Lista de Bancos Bloqueados**\n\`\`\`\n${desc}\n\`\`\``
    )
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();
}

function buildBancosComponents(bancos) {
  const options = bancos.disponiveis.map(b => ({
    label: b,
    value: b,
    default: bancos.bloqueados.includes(b),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('DefSelectBancos')
    .setPlaceholder('<:CadLock:1533221942256078968> Selecione os bancos para bloquear')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('Def_FormasPag').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── MODAL ANTI FAKE ───────────────────────────────────────────────
// Equivalente a AlterarAntiFakeModal

function buildAntiFakeModal(antifake) {
  const modal = new ModalBuilder()
    .setCustomId('DefModal_AntiFake')
    .setTitle('Configurar Anti Fake');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantidademinima')
        .setLabel('Quantidade mínima de dias para entrar')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Deixe em branco para desativar')
        .setValue(String(antifake.quantidadeMinima || ''))
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nomesbloqueados')
        .setLabel('Lista de nomes que deseja bloquear')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Separe por linhas cada nome que deseja punir (expulsar)')
        .setValue((antifake.nomesBloqueados || []).join('\n'))
        .setRequired(false)
    ),
  );

  return modal;
}

// ── DOCUMENTAÇÃO FORMAS DE PAGAMENTO ─────────────────────────────
// Equivalente ao VerDocumentacaoFormasPagamento do Python

const DOCUMENTACAO_FORMAS_PAG = `
# Documentação | Formas de Pagamento
Esta documentação fornece uma visão geral das formas de pagamento que o bot pode utilizar.
## Ordem de Prioridade:
1. **Mercado Pago** — Quando habilitado e configurado, será a forma prioritária.
2. **Efí Bank** — Segunda opção caso o Mercado Pago não esteja disponível.
3. **Semi Automático** — Última opção. Usa a chave PIX configurada no servidor.
`.trim();

// ── CORES DOS CARGOS CRIADOS AUTOMATICAMENTE ──────────────────────
// Equivalente ao CriarCargo_ do Python

const CARGO_CONFIG = {
  administrador: { nome: 'Administrador', cor: 0x010101 },
  suporte:       { nome: 'Suporte',       cor: 0x00FFFF },
  cliente:       { nome: 'Cliente',       cor: 0xFFFF00 },
  membro:        { nome: 'Membro',        cor: 0x00FF00 },
  verificado:    { nome: 'Verificado',    cor: 0x006400 },
};

// ── HANDLER DE BOTÕES ─────────────────────────────────────────────

async function handleButton(interaction) {
  if (!(await usuarioTemPermissaoDefinicoes(interaction))) return;
  const id = interaction.customId;

  // Voltar ao painel principal de definições
  if (id === 'GerenciarPainelConfigurar') {
    return interaction.update({
      content: 'O que precisa configurar?',
      embeds: [],
      components: painelInicialComponents(),
    });
  }

  // Voltar ao /painel principal
  if (id === 'Def_Voltar') {
    // BUGFIX: a mensagem atual NAO e Components V2 (e a ephemeral aberta por
    // este modulo, com content/embed). Editar direto pro /painel (V2) sem
    // limpar content/embeds da erro 50035. voltarParaPainel() limpa os campos
    // antigos e, se falhar, abre o /painel numa mensagem nova.
    const { voltarParaPainel } = require('../commands/painel');
    return voltarParaPainel(interaction);
  }

  // Seção Canais
  if (id === 'Def_Canais') {
    const canais = getCanais(interaction.guildId);
    const embed = buildCanaisEmbed(interaction, canais);
    return interaction.update({ content: null, embeds: [embed], components: buildCanaisComponents() });
  }

  // Seção Cargos
  if (id === 'Def_Cargos') {
    const cargos = getCargos(interaction.guildId);
    const embed = buildCargosEmbed(interaction, cargos);
    return interaction.update({ content: null, embeds: [embed], components: buildCargosComponents() });
  }

  // Anti Fake → abre modal
  if (id === 'Def_AntiFake') {
    const antifake = getAntiFake(interaction.guildId);
    return interaction.showModal(buildAntiFakeModal(antifake));
  }

  // Formas de Pagamento
  if (id === 'Def_FormasPag') {
    const fp = getFormasPagamento(interaction.guildId);
    const embed = buildFormasPagEmbed(interaction, fp);
    return interaction.update({ content: null, embeds: [embed], components: buildFormasPagComponents() });
  }

  // Formas de Pagamento → Mercado Pago e Efi Bank funcionais.
  if (id === 'DefFormasPag_MercadoPago') {
    return abrirGerenciarMercadoPago(interaction);
  }
  if (id === 'DefFormasPag_Efi') {
    // Reaproveita o mesmo painel do /efibank (já funcional) em vez do
    // placeholder "ainda não disponível" — é o mesmo efiBankManager,
    // cujos botões/modais internos (prefixo 'efi_') já são roteados em
    // events/buttonHandler.js.
    const efiBankManager = require('../efi-system/efiBankManager');
    return efiBankManager.showPainel(interaction);
  }
  if (id === 'DefFormasPag_C6') {
    // Mesmo padrão do Efi Bank acima: reaproveita o painel do /c6bank
    // (mesmo c6BankManager, prefixo 'c6_' já roteado em buttonHandler.js).
    const c6BankManager = require('../c6-system/c6BankManager');
    return c6BankManager.showPainel(interaction);
  }
  if (id === 'ConfigurarSistemaMP') {
    return interaction.showModal(buildModalMercadoPago());
  }
  if (id === 'HabilitarDesabilitarSistemaPagamento_MP') {
    return handleToggleMercadoPago(interaction);
  }

  if (id === 'DefFormasPag_SemiAuto') {
    return interaction.reply({
      content: '> 💠 Para configurar o PIX (Semi Automático), use o painel da loja:\n> `/produto criar` → **Ajustar PIX**',
      flags: 64,
    });
  }

  // Documentação
  if (id === 'DefDocumentacaoFormasPag') {
    return interaction.reply({ content: DOCUMENTACAO_FORMAS_PAG, flags: 64 });
  }

  // Bloquear Bancos
  if (id === 'DefBancosBloqueados') {
    const bancos = getBancos(interaction.guildId);
    const embed = buildBancosEmbed(interaction, bancos);
    return interaction.update({ content: null, embeds: [embed], components: buildBancosComponents(bancos) });
  }

  // Remover Canal
  if (id.startsWith('DefRemoverCanal_')) {
    const key = id.replace('DefRemoverCanal_', '');
    const def = getDef(interaction.guildId);
    if (!def.canais) def.canais = {};
    def.canais[key] = null;
    saveDef(interaction.guildId, def);
    const canais = getCanais(interaction.guildId);
    const embed = buildCanaisEmbed(interaction, canais);
    return interaction.update({ content: null, embeds: [embed], components: buildCanaisComponents() });
  }

  // Criar Canal automaticamente
  if (id.startsWith('DefCriarCanal_')) {
    const key = id.replace('DefCriarCanal_', '');
    try {
      const novoCanal = await interaction.guild.channels.create({
        name: key.toLowerCase(),
        type: ChannelType.GuildText,
        permissionOverwrites: [{
          id: interaction.guild.roles.everyone,
          deny: ['ViewChannel'],
        }],
      });
      await novoCanal.send(`||${interaction.user}|| \`First! ;)\``);
      const def = getDef(interaction.guildId);
      if (!def.canais) def.canais = {};
      def.canais[key] = novoCanal.id;
      saveDef(interaction.guildId, def);
      // Espelha pro campo que enviarLog() realmente lê (logs.channelId) —
      // antes esses dois sistemas estavam desconectados: configurar aqui
      // não fazia os logs de verdade (ex: alteração de chave PIX) funcionarem.
      if (key === 'logs') db.updateGuild(interaction.guildId, 'logs.channelId', novoCanal.id);
    } catch (e) {
      console.error('[Definições] Erro ao criar canal:', e.message);
    }
    const canais = getCanais(interaction.guildId);
    const embed = buildCanaisEmbed(interaction, canais);
    return interaction.update({ content: null, embeds: [embed], components: buildCanaisComponents() });
  }

  // Remover Cargo
  if (id.startsWith('DefRemoverCargo_')) {
    const key = id.replace('DefRemoverCargo_', '');
    const def = getDef(interaction.guildId);
    if (!def.cargos) def.cargos = {};
    def.cargos[key] = null;
    saveDef(interaction.guildId, def);
    const cargos = getCargos(interaction.guildId);
    const embed = buildCargosEmbed(interaction, cargos);
    return interaction.update({ content: null, embeds: [embed], components: buildCargosComponents() });
  }

  // Criar Cargo automaticamente
  if (id.startsWith('DefCriarCargo_')) {
    const key = id.replace('DefCriarCargo_', '');
    const cfg = CARGO_CONFIG[key] || { nome: key, cor: 0xFFFFFF };
    try {
      const novoCargo = await interaction.guild.roles.create({
        name: cfg.nome,
        color: cfg.cor,
        hoist: true,
        reason: `[KAEL] Configurar cargo: ${cfg.nome}`,
      });
      const def = getDef(interaction.guildId);
      if (!def.cargos) def.cargos = {};
      def.cargos[key] = novoCargo.id;
      saveDef(interaction.guildId, def);
    } catch (e) {
      console.error('[Definições] Erro ao criar cargo:', e.message);
    }
    const cargos = getCargos(interaction.guildId);
    const embed = buildCargosEmbed(interaction, cargos);
    return interaction.update({ content: null, embeds: [embed], components: buildCargosComponents() });
  }
}

// ── HANDLER DE SELECT MENUS ───────────────────────────────────────

async function handleSelectMenu(interaction) {
  if (!(await usuarioTemPermissaoDefinicoes(interaction))) return;
  const id = interaction.customId;

  // Selecionar canal para editar → mostra ChannelSelect + botões
  if (id === 'DefSelect_Canais') {
    const key = interaction.values[0];
    const canais = getCanais(interaction.guildId);
    const canalAtualId = canais[key] || null;
    return interaction.update({
      content: null,
      embeds: [],
      components: buildGerenciarCanalComponents(key, canalAtualId),
    });
  }

  // Confirmar canal escolhido no ChannelSelect
  if (id.startsWith('DefAlterarCanal_')) {
    const key = id.replace('DefAlterarCanal_', '');
    const novoCanalId = interaction.values[0];
    const def = getDef(interaction.guildId);
    if (!def.canais) def.canais = {};
    def.canais[key] = novoCanalId;
    saveDef(interaction.guildId, def);
    // Mesmo espelhamento do bloco de criação automática acima.
    if (key === 'logs') db.updateGuild(interaction.guildId, 'logs.channelId', novoCanalId);
    const canais = getCanais(interaction.guildId);
    const embed = buildCanaisEmbed(interaction, canais);
    return interaction.update({ content: null, embeds: [embed], components: buildCanaisComponents() });
  }

  // Selecionar cargo para editar → mostra RoleSelect + botões
  if (id === 'DefSelect_Cargos') {
    const key = interaction.values[0];
    const cargos = getCargos(interaction.guildId);
    const cargoAtualId = cargos[key] || null;
    return interaction.update({
      content: null,
      embeds: [],
      components: buildGerenciarCargoComponents(key, cargoAtualId),
    });
  }

  // Confirmar cargo escolhido no RoleSelect
  if (id.startsWith('DefAlterarCargo_')) {
    const key = id.replace('DefAlterarCargo_', '');
    const novoCargoId = interaction.values[0];
    const def = getDef(interaction.guildId);
    if (!def.cargos) def.cargos = {};
    def.cargos[key] = novoCargoId;
    saveDef(interaction.guildId, def);
    const cargos = getCargos(interaction.guildId);
    const embed = buildCargosEmbed(interaction, cargos);
    return interaction.update({ content: null, embeds: [embed], components: buildCargosComponents() });
  }

  // Bloquear/desbloquear bancos
  if (id === 'DefSelectBancos') {
    const selecionados = interaction.values || [];
    const def = getDef(interaction.guildId);
    def.bancosBloqueados = selecionados;
    saveDef(interaction.guildId, def);
    const bancos = getBancos(interaction.guildId);
    const embed = buildBancosEmbed(interaction, bancos);
    return interaction.update({ content: null, embeds: [embed], components: buildBancosComponents(bancos) });
  }
}

// ── HANDLER DE MODAIS ─────────────────────────────────────────────

async function handleModal(interaction) {
  if (!(await usuarioTemPermissaoDefinicoes(interaction))) return;
  const id = interaction.customId;

  // Anti Fake
  if (id === 'DefModal_AntiFake') {
    const qtdStr   = interaction.fields.getTextInputValue('quantidademinima').trim();
    const nomesStr = interaction.fields.getTextInputValue('nomesbloqueados').trim();

    let quantidadeMinima = '';
    if (qtdStr) {
      const num = parseInt(qtdStr, 10);
      if (isNaN(num)) {
        return interaction.reply({
          content: '<:negativo:1528400986744295475> Você informou um número errado. Tente novamente!',
          flags: 64,
        });
      }
      quantidadeMinima = num;
    }

    const nomesBloqueados = nomesStr
      ? nomesStr.split('\n').map(n => n.trim()).filter(n => n.length > 0)
      : [];

    const def = getDef(interaction.guildId);
    def.antifake = { quantidadeMinima, nomesBloqueados };
    saveDef(interaction.guildId, def);

    return interaction.reply({
      content: '<:positivo:1528401238197276702> As configurações foram salvas com sucesso.',
      flags: 64,
    });
  }

  // Mercado Pago — credenciais
  if (id === 'DefModal_MercadoPago') {
    return processarModalMercadoPago(interaction);
  }
}

// ─────────────────────────────────────────────────────────────────
module.exports = { abrirDefinicoes, handleButton, handleSelectMenu, handleModal };
