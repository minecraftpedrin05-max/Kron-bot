/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Boas-Vindas
 *  Reescrita fiel do Commands/Admin/Plugins/BoasVindas.py (NX7 VENDAS /
 *  Ease Pro), incluindo o sub-sistema de Auto Role que veio junto no
 *  mesmo arquivo Python original.
 *
 *  Acionado por: botão 'painel_boasvindas' no /painel
 *
 *  Duas seções, iguais ao Python:
 *   • Mensagem de Boas-Vindas — liga/desliga, edita texto + tempo pra
 *     apagar, pré-visualização, canal onde a mensagem é enviada.
 *   • Auto Role — liga/desliga, define qual cargo é dado automaticamente
 *     a quem entra no servidor.
 *
 *  Dados salvos em: loja.boasVindas (mensagem/autorole) e reaproveita
 *  loja.definicoes.canais.boasvindas pro canal (mesmo campo que a tela
 *  de Definições > Canais já usa — não duplica configuração).
 *
 *  A entrega de verdade (quando alguém entra no servidor) acontece em
 *  handleGuildMemberAdd(member), chamada a partir do client.on('guild
 *  MemberAdd', ...) já existente em index.js.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');

const db = require('../database/db');
const { gerarCard, sortearFundo, PRESETS } = require('../canvas-system/gerarCardBoasVindas');

const EMOJI_POSITIVO = '<:positivo:1528401238197276702>';
const EMOJI_NEGATIVO = '<:negativo:1528400986744295475>';
const EMOJI_SINO     = '<:sino:1528840971096297482>';
const EMOJI_EDITAR   = '<:editar:1528400388137549864>';

const CORES_NOMEADAS = {
  verde:    '#57F287',
  azul:     '#5865F2',
  vermelho: '#ED4245',
  amarelo:  '#FEE75C',
  roxo:     '#9B59B6',
  branco:   '#FFFFFF',
  dourado:  '#FFD700',
};

const IMAGEM_PADRAO = { ativa: false, tipoFundo: 'preset', fundoId: 'aurora', fundoUrl: '', corNome: CORES_NOMEADAS.verde, coresGeradas: null };

// ── Helpers do banco ─────────────────────────────────────────────

function getBoasVindas(guildId) {
  const config = db.getGuild(guildId).loja?.boasVindas || {};
  return {
    mensagemAtiva: !!config.mensagemAtiva,
    conteudo: config.conteudo || '',
    variacoes: Array.isArray(config.variacoes) ? config.variacoes.filter(Boolean) : [],
    dmAtiva: !!config.dmAtiva,
    tempoApagar: config.tempoApagar ?? null,
    autoRoleAtiva: !!config.autoRoleAtiva,
    autoRoleCargoId: config.autoRoleCargoId || null, // mantido só por compatibilidade com configs antigas
    autoRoleCargoIds: Array.isArray(config.autoRoleCargoIds) && config.autoRoleCargoIds.length > 0
      ? config.autoRoleCargoIds
      : (config.autoRoleCargoId ? [config.autoRoleCargoId] : []), // migra transparente do cargo único antigo
    saidaAtiva: !!config.saidaAtiva,
    marcoMembrosAtiva: !!config.marcoMembrosAtiva,
    marcoMembrosIntervalo: config.marcoMembrosIntervalo ?? 100,
    marcoMembrosConteudo: config.marcoMembrosConteudo || 'Ei, já somos **{contagem}** em {servidor}!',
    conteudoSaida: config.conteudoSaida || '',
    tempoApagarSaida: config.tempoApagarSaida ?? null,
    canalSaidaId: config.canalSaidaId || null,
    imagemEntrada: { ...IMAGEM_PADRAO, ...(config.imagemEntrada || {}) },
    imagemSaida: { ...IMAGEM_PADRAO, ...(config.imagemSaida || {}) },
  };
}

function saveBoasVindas(guildId, config) {
  db.updateGuild(guildId, 'loja.boasVindas', config);
}

// Se houver variações cadastradas, sorteia uma; senão usa a mensagem única
// de sempre (100% compatível com quem nunca configurou variações).
function escolherConteudo(cfg) {
  if (cfg.variacoes && cfg.variacoes.length > 0) {
    return cfg.variacoes[Math.floor(Math.random() * cfg.variacoes.length)];
  }
  return cfg.conteudo;
}

// Busca quem convidou o membro no sistema de Invites (Kael Invite System)
// já existente — não duplicamos lógica de rastreio de convites aqui, só
// lemos o que aquele sistema já registrou. Se o sistema de Invites estiver
// desligado nesse servidor, ou o convite não puder ser identificado
// (vanity URL, link de instante único, etc.), cai no texto padrão.
function resolverConvidadoPorTexto(member) {
  try {
    const inviteDb = require('../database/inviteDb');
    const registro = inviteDb.getMember(member.guild.id, member.id);
    if (registro?.inviter_id) return `<@${registro.inviter_id}>`;
  } catch (e) {
    console.error('[BoasVindas] Falha ao resolver quem convidou:', e.message);
  }
  return 'alguém';
}

// Mesmo campo que a tela de Definições > Canais já usa — não criamos
// um segundo lugar pra guardar o mesmo canal.
function getCanalBoasVindasId(guildId) {
  return db.getGuild(guildId).loja?.definicoes?.canais?.boasvindas || null;
}

function setCanalBoasVindasId(guildId, canalId) {
  db.updateGuild(guildId, 'loja.definicoes.canais.boasvindas', canalId);
}

function renderizarConteudo(conteudo, member, convidadoPorTexto) {
  return (conteudo || '')
    .replaceAll('{mencao}', `<@${member.id}>`)
    .replaceAll('{nome}', member.user?.username || member.displayName || 'membro')
    .replaceAll('{servidor}', member.guild?.name || '')
    .replaceAll('{convidadoPor}', convidadoPorTexto || 'alguém');
}

// Só quem é Administrator pode mexer nisso — a mensagem do painel já
// existe publicamente pra quem tiver acesso ao canal, então cada clique
// precisa reconferir a permissão de quem clicou (não só de quem abriu
// o /painel originalmente).
async function usuarioTemPermissao(interaction) {
  if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const payload = {
    content: `${EMOJI_NEGATIVO} Você precisa ser Administrator para usar isso.`,
    embeds: [], components: [], flags: 64,
  };
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply(payload).catch(() => {});
  } else {
    await interaction.followUp(payload).catch(() => {});
  }
  return false;
}

// ── SUBMENU INICIAL (equivalente a 'GerenciarPainelBoasVindas') ───

function submenuComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('BV_Menu_Mensagem').setLabel('Boas-Vindas').setEmoji(EMOJI_SINO).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('BV_Menu_Saida').setLabel('Mensagem de Saída').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('BV_Menu_AutoRole').setLabel('Auto Role').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('BV_Menu_Marco').setLabel('Marco de Membros').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('BV_Voltar_Painel').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function abrirBoasVindas(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const content = 'Selecione um sistema para gerenciar :)';

  // BUGFIX: vindo do botao 'painel_boasvindas', a mensagem atual e o /painel
  // em Components V2, que NAO aceita content/embeds via interaction.update()
  // (erro 50035 "cannot use legacy fields with IS_COMPONENTS_V2"). Por isso
  // abrimos uma mensagem ephemeral NOVA, igual a abrirDefinicoes/abrirAcoesAuto.
  if (interaction.customId === 'painel_boasvindas') {
    await interaction.reply({ content, components: submenuComponents(), flags: 64 });
    return;
  }

  // Vindo do 'BV_Voltar_Submenu': a mensagem atual ja e essa ephemeral normal
  // (nao-V2, pode ter embed de um submenu), entao editamos e limpamos o embed.
  await interaction.update({
    content,
    embeds: [],
    components: submenuComponents(),
  });
}

// ── MENSAGEM DE BOAS-VINDAS (equivalente a obterPainelMensagemBoasVindas) ──

function iconGuild(interaction) {
  return interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;
}

function buildMensagemEmbed(interaction) {
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const canalId = getCanalBoasVindasId(guildId);

  const canalTexto = canalId
    ? (interaction.guild.channels.cache.get(canalId) ? `${EMOJI_POSITIVO} <#${canalId}>` : `${EMOJI_NEGATIVO} \`Canal inválido\``)
    : `${EMOJI_NEGATIVO} \`Não configurado\``;

  const tempoTexto = cfg.tempoApagar
    ? `${EMOJI_POSITIVO} \`${cfg.tempoApagar} segundos\``
    : `${EMOJI_NEGATIVO} \`Não configurado\``;

  const statusTexto = cfg.mensagemAtiva ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;
  const dmTexto = cfg.dmAtiva ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;
  const variacoesTexto = cfg.variacoes.length > 0 ? `${EMOJI_POSITIVO} \`${cfg.variacoes.length} cadastrada(s)\`` : `${EMOJI_NEGATIVO} \`Nenhuma (usa a mensagem única)\``;

  return new EmbedBuilder()
    .setTitle('Sistema de Boas-Vindas')
    .setDescription(
      'Aqui você pode configurar seu sistema de Boas-Vindas.\n' +
      'Ele será acionado sempre que um membro entrar no servidor.\n' +
      'Configure o canal de boas-vindas em Definições → Canais.\n' +
      'Placeholders: {mencao} {nome} {servidor} {convidadoPor}'
    )
    .setColor(0x00FFFF)
    .setTimestamp()
    .setFooter({ text: interaction.guild.name, iconURL: iconGuild(interaction) })
    .addFields(
      { name: 'Canal Configurado', value: canalTexto, inline: true },
      { name: 'Tempo para Apagar Mensagem', value: tempoTexto, inline: true },
      { name: 'Status do Sistema', value: statusTexto, inline: true },
      { name: 'Enviar também por DM', value: dmTexto, inline: true },
      { name: 'Variações de Mensagem', value: variacoesTexto, inline: true },
    );
}

function buildMensagemComponents(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const botaoToggle = cfg.mensagemAtiva
    ? new ButtonBuilder().setCustomId('BV_Toggle_Mensagem').setLabel('Desabilitar').setStyle(ButtonStyle.Danger)
    : new ButtonBuilder().setCustomId('BV_Toggle_Mensagem').setLabel('Habilitar').setStyle(ButtonStyle.Success);

  const botaoToggleDM = cfg.dmAtiva
    ? new ButtonBuilder().setCustomId('BV_Toggle_DM').setLabel('Desabilitar DM').setStyle(ButtonStyle.Danger)
    : new ButtonBuilder().setCustomId('BV_Toggle_DM').setLabel('Habilitar DM').setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(
      botaoToggle,
      new ButtonBuilder().setCustomId('BV_Editar_Mensagem').setLabel('Editar Mensagem').setEmoji(EMOJI_EDITAR).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('BV_Preview_Mensagem').setLabel('Pré-visualização').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('BV_Img_Menu_entrada').setLabel('Configurar Imagem').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      botaoToggleDM,
      new ButtonBuilder().setCustomId('BV_Editar_Variacoes').setLabel('Variações de Mensagem').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('BV_Canal_Select')
        .setPlaceholder('Selecione o canal de boas-vindas')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('BV_Voltar_Submenu').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function abrirMensagem(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
}

async function toggleMensagem(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.mensagemAtiva = !cfg.mensagemAtiva;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} O sistema de Mensagem de Boas-Vindas foi ${cfg.mensagemAtiva ? 'habilitado' : 'desabilitado'}.`,
    flags: 64,
  }).catch(() => {});
}

async function toggleDM(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.dmAtiva = !cfg.dmAtiva;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} Envio por DM foi ${cfg.dmAtiva ? 'habilitado' : 'desabilitado'}.`,
    flags: 64,
  }).catch(() => {});
}

function modalMensagem(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('BV_Modal_Mensagem').setTitle('Editar Mensagem Boas-Vindas');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('conteudo')
        .setLabel('Conteúdo da mensagem')
        .setPlaceholder('{mencao} - Mencione o usuário\n{nome} - Nome do usuário\n{servidor} - Nome do servidor')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.conteudo || '')
        .setRequired(false)
        .setMaxLength(2000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tempo')
        .setLabel('Tempo para apagar mensagem (segundos)')
        .setPlaceholder('Deixe em branco pra nunca apagar')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.tempoApagar != null ? String(cfg.tempoApagar) : '')
        .setRequired(false),
    ),
  );
  return modal;
}

async function handleModalMensagem(interaction) {
  const guildId = interaction.guildId;
  const conteudo = interaction.fields.getTextInputValue('conteudo');
  const tempoBruto = interaction.fields.getTextInputValue('tempo').trim();

  let tempo = null;
  if (tempoBruto !== '') {
    const n = parseInt(tempoBruto, 10);
    if (isNaN(n) || n < 0) {
      return interaction.reply({
        content: `${EMOJI_NEGATIVO} O tempo pra apagar deve ser um número inteiro positivo.`,
        flags: 64,
      });
    }
    tempo = n;
  }

  const cfg = getBoasVindas(guildId);
  cfg.conteudo = conteudo;
  cfg.tempoApagar = tempo;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} Mensagem de Boas-Vindas configurada com sucesso!`,
    flags: 64,
  }).catch(() => {});
}

function modalVariacoes(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('BV_Modal_Variacoes').setTitle('Variações de Mensagem');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('variacoes')
        .setLabel('Uma mensagem por linha "---"')
        .setPlaceholder('Bem-vindo(a), {mencao}!\n---\n{nome} chegou, convidado por {convidadoPor}!\n---\nMais um pra família {servidor}!')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.variacoes.join('\n---\n'))
        .setRequired(false)
        .setMaxLength(4000),
    ),
  );
  return modal;
}

async function handleModalVariacoes(interaction) {
  const guildId = interaction.guildId;
  const bruto = interaction.fields.getTextInputValue('variacoes');
  const variacoes = bruto.split(/\n?---\n?/).map(v => v.trim()).filter(Boolean);

  const cfg = getBoasVindas(guildId);
  cfg.variacoes = variacoes;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
  await interaction.followUp({
    content: variacoes.length > 0
      ? `${EMOJI_POSITIVO} ${variacoes.length} variação(ões) salva(s) — uma será sorteada a cada entrada.`
      : `${EMOJI_POSITIVO} Variações removidas — voltando a usar a mensagem única de "Editar Mensagem".`,
    flags: 64,
  }).catch(() => {});
}

async function previewMensagem(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const convidadoPorTexto = resolverConvidadoPorTexto(interaction.member);
  const conteudoRenderizado = renderizarConteudo(escolherConteudo(cfg), interaction.member, convidadoPorTexto);

  const botao = new ButtonBuilder()
    .setCustomId('BV_Preview_Disabled')
    .setLabel('Mensagem do Sistema')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const resposta = await interaction.reply({
    content: conteudoRenderizado || `${EMOJI_NEGATIVO} Nenhuma mensagem configurada ainda.`,
    components: [new ActionRowBuilder().addComponents(botao)],
    flags: 64,
    fetchReply: true,
  });

  if (cfg.tempoApagar) {
    setTimeout(() => { interaction.deleteReply().catch(() => {}); }, cfg.tempoApagar * 1000);
  }
}

async function selecionarCanal(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  setCanalBoasVindasId(interaction.guildId, interaction.values[0]);

  await interaction.update({
    content: null,
    embeds: [buildMensagemEmbed(interaction)],
    components: buildMensagemComponents(interaction),
  });
}

// ── MENSAGEM DE SAÍDA (novo — não existia no Python original, mas o
// mesmo padrão da mensagem de entrada se aplica) ──────────────────

function buildSaidaEmbed(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const canalTexto = cfg.canalSaidaId
    ? (interaction.guild.channels.cache.get(cfg.canalSaidaId) ? `${EMOJI_POSITIVO} <#${cfg.canalSaidaId}>` : `${EMOJI_NEGATIVO} \`Canal inválido\``)
    : `${EMOJI_NEGATIVO} \`Não configurado\``;
  const tempoTexto = cfg.tempoApagarSaida
    ? `${EMOJI_POSITIVO} \`${cfg.tempoApagarSaida} segundos\``
    : `${EMOJI_NEGATIVO} \`Não configurado\``;
  const statusTexto = cfg.saidaAtiva ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;

  return new EmbedBuilder()
    .setTitle('Mensagem de Saída')
    .setDescription(
      'Aqui você pode configurar a mensagem enviada quando um membro SAI do servidor.\n' +
      'Use {nome} e {servidor} — não dá pra mencionar quem já saiu, então {mencao} não funciona aqui.'
    )
    .setColor(0x00FFFF)
    .setTimestamp()
    .setFooter({ text: interaction.guild.name, iconURL: iconGuild(interaction) })
    .addFields(
      { name: 'Canal Configurado', value: canalTexto, inline: true },
      { name: 'Tempo para Apagar Mensagem', value: tempoTexto, inline: true },
      { name: 'Status do Sistema', value: statusTexto, inline: true },
    );
}

function buildSaidaComponents() {
  return (interaction) => {
    const c = getBoasVindas(interaction.guildId);
    const botaoToggle = c.saidaAtiva
      ? new ButtonBuilder().setCustomId('BV_Toggle_Saida').setLabel('Desabilitar').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId('BV_Toggle_Saida').setLabel('Habilitar').setStyle(ButtonStyle.Success);

    return [
      new ActionRowBuilder().addComponents(
        botaoToggle,
        new ButtonBuilder().setCustomId('BV_Editar_Saida').setLabel('Editar Mensagem').setEmoji(EMOJI_EDITAR).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('BV_Preview_Saida').setLabel('Pré-visualização').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('BV_Img_Menu_saida').setLabel('Configurar Imagem').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('BV_CanalSaida_Select')
          .setPlaceholder('Selecione o canal de mensagem de saída')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('BV_Voltar_Submenu').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      ),
    ];
  };
}
const montarComponentesSaida = buildSaidaComponents();

async function abrirSaida(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  await interaction.update({
    content: null,
    embeds: [buildSaidaEmbed(interaction)],
    components: montarComponentesSaida(interaction),
  });
}

async function toggleSaida(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.saidaAtiva = !cfg.saidaAtiva;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildSaidaEmbed(interaction)],
    components: montarComponentesSaida(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} O sistema de Mensagem de Saída foi ${cfg.saidaAtiva ? 'habilitado' : 'desabilitado'}.`,
    flags: 64,
  }).catch(() => {});
}

function modalSaida(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('BV_Modal_Saida').setTitle('Editar Mensagem de Saída');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('conteudo')
        .setLabel('Conteúdo da mensagem')
        .setPlaceholder('{nome} - Nome do usuário\n{servidor} - Nome do servidor')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.conteudoSaida || '')
        .setRequired(false)
        .setMaxLength(2000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tempo')
        .setLabel('Tempo para apagar mensagem (segundos)')
        .setPlaceholder('Deixe em branco pra nunca apagar')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.tempoApagarSaida != null ? String(cfg.tempoApagarSaida) : '')
        .setRequired(false),
    ),
  );
  return modal;
}

async function handleModalSaida(interaction) {
  const guildId = interaction.guildId;
  const conteudo = interaction.fields.getTextInputValue('conteudo');
  const tempoBruto = interaction.fields.getTextInputValue('tempo').trim();

  let tempo = null;
  if (tempoBruto !== '') {
    const n = parseInt(tempoBruto, 10);
    if (isNaN(n) || n < 0) {
      return interaction.reply({
        content: `${EMOJI_NEGATIVO} O tempo pra apagar deve ser um número inteiro positivo.`,
        flags: 64,
      });
    }
    tempo = n;
  }

  const cfg = getBoasVindas(guildId);
  cfg.conteudoSaida = conteudo;
  cfg.tempoApagarSaida = tempo;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildSaidaEmbed(interaction)],
    components: montarComponentesSaida(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} Mensagem de Saída configurada com sucesso!`,
    flags: 64,
  }).catch(() => {});
}

async function previewSaida(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const conteudoRenderizado = renderizarConteudo(cfg.conteudoSaida, interaction.member);

  const botao = new ButtonBuilder()
    .setCustomId('BV_Preview_Disabled')
    .setLabel('Mensagem do Sistema')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  await interaction.reply({
    content: conteudoRenderizado || `${EMOJI_NEGATIVO} Nenhuma mensagem configurada ainda.`,
    components: [new ActionRowBuilder().addComponents(botao)],
    flags: 64,
    fetchReply: true,
  });

  if (cfg.tempoApagarSaida) {
    setTimeout(() => { interaction.deleteReply().catch(() => {}); }, cfg.tempoApagarSaida * 1000);
  }
}

async function selecionarCanalSaida(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.canalSaidaId = interaction.values[0];
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildSaidaEmbed(interaction)],
    components: montarComponentesSaida(interaction),
  });
}

// ── CONFIGURAR IMAGEM (fundo + cor do nome) — usado tanto pela
// entrada quanto pela saída, então é tudo parametrizado por `tipo`
// ('entrada' | 'saida'). Isso evita duplicar a mesma lógica duas vezes.
//
// IMPORTANTE: a cor do nome (corNome) SÓ muda como o nome aparece
// NESTA IMAGEM gerada — nunca o apelido de verdade do usuário no
// servidor, e só existe no momento em que a imagem é gerada (entrada
// ou saída), não fica "permanente" em lugar nenhum.

function chaveConfig(tipo) { return tipo === 'entrada' ? 'imagemEntrada' : 'imagemSaida'; }

function rotuloFundo(cfgImagem) {
  if (cfgImagem.tipoFundo === 'custom') {
    return cfgImagem.fundoUrl ? `URL personalizada` : `${EMOJI_NEGATIVO} URL não configurada`;
  }
  if (cfgImagem.tipoFundo === 'gerado') {
    const nomeEstilo = PRESETS[cfgImagem.fundoId]?.nome || cfgImagem.fundoId;
    return `Gerado (estilo ${nomeEstilo})`;
  }
  return PRESETS[cfgImagem.fundoId]?.nome || 'Aurora';
}

async function gerarPreviewBuffer(interaction, tipo) {
  const cfg = getBoasVindas(interaction.guildId);
  const cfgImagem = cfg[chaveConfig(tipo)];
  return gerarCard({
    tipo,
    member: interaction.member,
    config: cfgImagem,
    contagemMembros: interaction.guild.memberCount,
  });
}

function buildImagemEmbed(interaction, tipo, cfgImagem) {
  const statusTexto = cfgImagem.ativa ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;
  return new EmbedBuilder()
    .setTitle(`Imagem de ${tipo === 'entrada' ? 'Boas-Vindas' : 'Saída'}`)
    .setDescription(
      'Escolha um fundo pronto, gere um novo aleatório ou cole a URL de uma imagem sua.\n' +
      'A cor do nome muda só nesta imagem — não altera o apelido de verdade do usuário no servidor.'
    )
    .setColor(0x00FFFF)
    .setImage('attachment://preview_boasvindas.png')
    .addFields(
      { name: 'Status', value: statusTexto, inline: true },
      { name: 'Fundo Atual', value: rotuloFundo(cfgImagem), inline: true },
      { name: 'Cor do Nome', value: `\`${cfgImagem.corNome}\``, inline: true },
    );
}

function buildImagemComponents(tipo) {
  const selectFundo = new StringSelectMenuBuilder()
    .setCustomId(`BV_Img_Preset_${tipo}`)
    .setPlaceholder('Fundos prontos')
    .addOptions(Object.entries(PRESETS).map(([id, p]) => ({ label: p.nome, value: id })));

  const selectCor = new StringSelectMenuBuilder()
    .setCustomId(`BV_Img_Cor_${tipo}`)
    .setPlaceholder('Cor do nome')
    .addOptions([
      ...Object.entries(CORES_NOMEADAS).map(([nome, hex]) => ({ label: nome[0].toUpperCase() + nome.slice(1), value: hex })),
      { label: 'Personalizada (hex)', value: 'custom' },
    ]);

  return [
    new ActionRowBuilder().addComponents(selectFundo),
    new ActionRowBuilder().addComponents(selectCor),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`BV_Img_Toggle_${tipo}`).setLabel('Ativar/Desabilitar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`BV_Img_Gerar_${tipo}`).setLabel('Gerar Fundo').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`BV_Img_URL_${tipo}`).setLabel('URL Personalizada').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`BV_Img_Voltar_${tipo}`).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function renderizarPainelImagem(interaction, tipo) {
  const cfg = getBoasVindas(interaction.guildId);
  const cfgImagem = cfg[chaveConfig(tipo)];
  const buffer = await gerarPreviewBuffer(interaction, tipo);
  const anexo = new AttachmentBuilder(buffer, { name: 'preview_boasvindas.png' });

  await interaction.update({
    content: null,
    embeds: [buildImagemEmbed(interaction, tipo, cfgImagem)],
    components: buildImagemComponents(tipo),
    files: [anexo],
  });
}

async function abrirImagem(interaction, tipo) {
  if (!(await usuarioTemPermissao(interaction))) return;
  await renderizarPainelImagem(interaction, tipo);
}

async function toggleImagem(interaction, tipo) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  cfg[chave].ativa = !cfg[chave].ativa;
  saveBoasVindas(guildId, cfg);
  await renderizarPainelImagem(interaction, tipo);
}

// "Gerar Fundo" — sorteia um estilo+paleta novos e já salva na hora
// (é isso que aparece a cada entrada/saída a partir de agora, até o
// admin clicar de novo ou trocar pra outra opção). Clicar de novo
// gera outro, então o admin pode ficar clicando até gostar do
// resultado — o preview no embed já mostra o resultado na hora.
async function gerarFundoAleatorio(interaction, tipo) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  const { estiloId, cores } = sortearFundo();
  cfg[chave].tipoFundo = 'gerado';
  cfg[chave].fundoId = estiloId;
  cfg[chave].coresGeradas = cores;
  saveBoasVindas(guildId, cfg);
  await renderizarPainelImagem(interaction, tipo);
}

function modalUrlImagem(interaction, tipo) {
  const cfg = getBoasVindas(interaction.guildId)[chaveConfig(tipo)];
  const modal = new ModalBuilder().setCustomId(`BV_Modal_ImgURL_${tipo}`).setTitle('URL do Fundo Personalizado');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('url')
        .setLabel('Link direto da imagem (https://...)')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.tipoFundo === 'custom' ? (cfg.fundoUrl || '') : '')
        .setRequired(true),
    ),
  );
  return modal;
}

async function handleModalUrlImagem(interaction, tipo) {
  const url = interaction.fields.getTextInputValue('url').trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    return interaction.reply({ content: `${EMOJI_NEGATIVO} Isso não parece uma URL válida (precisa começar com http:// ou https://).`, flags: 64 });
  }

  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  cfg[chave].tipoFundo = 'custom';
  cfg[chave].fundoUrl = url;
  saveBoasVindas(guildId, cfg);

  // Gera o card já com a nova URL — se a imagem falhar ao carregar, o
  // gerador cai sozinho pro fundo padrão (ver gerarCardBoasVindas.js),
  // mas avisamos o admin na hora em vez de ele só descobrir quando
  // alguém entrar/sair de verdade.
  let avisoFalha = '';
  try {
    const https = require('https');
    await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        res.destroy();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(); else reject(new Error('status ' + res.statusCode));
      }).on('error', reject);
    });
  } catch (e) {
    avisoFalha = ` ${EMOJI_NEGATIVO} Não consegui acessar essa URL agora — confira se o link é direto (termina em .png/.jpg/.webp) e público.`;
  }

  const buffer = await gerarPreviewBuffer(interaction, tipo);
  const anexo = new AttachmentBuilder(buffer, { name: 'preview_boasvindas.png' });
  await interaction.update({
    content: null,
    embeds: [buildImagemEmbed(interaction, tipo, cfg[chave])],
    components: buildImagemComponents(tipo),
    files: [anexo],
  });
  await interaction.followUp({ content: `${EMOJI_POSITIVO} URL personalizada salva.${avisoFalha}`, flags: 64 }).catch(() => {});
}

async function selecionarPreset(interaction, tipo) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  cfg[chave].tipoFundo = 'preset';
  cfg[chave].fundoId = interaction.values[0];
  saveBoasVindas(guildId, cfg);
  await renderizarPainelImagem(interaction, tipo);
}

function modalCorCustom(interaction, tipo) {
  const cfg = getBoasVindas(interaction.guildId)[chaveConfig(tipo)];
  const modal = new ModalBuilder().setCustomId(`BV_Modal_ImgCor_${tipo}`).setTitle('Cor Personalizada do Nome');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('hex')
        .setLabel('Cor em hexadecimal (ex: #57F287)')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.corNome || '')
        .setRequired(true),
    ),
  );
  return modal;
}

async function handleModalCorCustom(interaction, tipo) {
  const bruto = interaction.fields.getTextInputValue('hex').trim();
  const hex = bruto.startsWith('#') ? bruto : `#${bruto}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return interaction.reply({ content: `${EMOJI_NEGATIVO} Cor inválida. Use o formato hexadecimal, ex: \`#57F287\`.`, flags: 64 });
  }

  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  cfg[chave].corNome = hex;
  saveBoasVindas(guildId, cfg);

  const buffer = await gerarPreviewBuffer(interaction, tipo);
  const anexo = new AttachmentBuilder(buffer, { name: 'preview_boasvindas.png' });
  await interaction.update({
    content: null,
    embeds: [buildImagemEmbed(interaction, tipo, cfg[chave])],
    components: buildImagemComponents(tipo),
    files: [anexo],
  });
}

async function selecionarCor(interaction, tipo) {
  const valor = interaction.values[0];
  if (valor === 'custom') {
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalCorCustom(interaction, tipo));
  }
  if (!(await usuarioTemPermissao(interaction))) return;

  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  const chave = chaveConfig(tipo);
  cfg[chave].corNome = valor;
  saveBoasVindas(guildId, cfg);
  await renderizarPainelImagem(interaction, tipo);
}

// ── MARCO DE MEMBROS (novo) ────────────────────────────────────────
// Mensagem especial disparada quando a contagem de membros do servidor
// bate um múltiplo redondo (ex: a cada 100). Independente da mensagem de
// boas-vindas normal — pode estar ligado mesmo com ela desligada, e
// vice-versa. Usa o mesmo canal configurado pra boas-vindas.

function buildMarcoEmbed(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const statusTexto = cfg.marcoMembrosAtiva ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;
  const canalId = getCanalBoasVindasId(interaction.guildId);
  const canalTexto = canalId
    ? (interaction.guild.channels.cache.get(canalId) ? `${EMOJI_POSITIVO} <#${canalId}>` : `${EMOJI_NEGATIVO} \`Canal inválido\``)
    : `${EMOJI_NEGATIVO} \`Não configurado\``;

  return new EmbedBuilder()
    .setTitle('Marco de Membros')
    .setDescription(
      'Manda uma mensagem especial toda vez que o servidor bate um número redondo de membros.\n' +
      'Usa o MESMO canal configurado na aba "Boas-Vindas". Placeholders: {contagem} {servidor}'
    )
    .setColor(0x00FFFF)
    .setTimestamp()
    .setFooter({ text: interaction.guild.name, iconURL: iconGuild(interaction) })
    .addFields(
      { name: 'Status', value: statusTexto, inline: true },
      { name: 'Canal (mesmo da Boas-Vindas)', value: canalTexto, inline: true },
      { name: 'A cada quantos membros', value: `\`${cfg.marcoMembrosIntervalo}\``, inline: true },
      { name: 'Mensagem atual', value: cfg.marcoMembrosConteudo || '\`vazia\`' },
    );
}

function buildMarcoComponents() {
  return (interaction) => {
    const cfg = getBoasVindas(interaction.guildId);
    const botaoToggle = cfg.marcoMembrosAtiva
      ? new ButtonBuilder().setCustomId('BV_Toggle_Marco').setLabel('Desabilitar').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId('BV_Toggle_Marco').setLabel('Habilitar').setStyle(ButtonStyle.Success);

    return [
      new ActionRowBuilder().addComponents(
        botaoToggle,
        new ButtonBuilder().setCustomId('BV_Editar_Marco').setLabel('Editar').setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('BV_Voltar_Submenu').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      ),
    ];
  };
}
const montarComponentesMarco = buildMarcoComponents();

async function abrirMarco(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  await interaction.update({
    content: null,
    embeds: [buildMarcoEmbed(interaction)],
    components: montarComponentesMarco(interaction),
  });
}

async function toggleMarco(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.marcoMembrosAtiva = !cfg.marcoMembrosAtiva;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMarcoEmbed(interaction)],
    components: montarComponentesMarco(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} O Marco de Membros foi ${cfg.marcoMembrosAtiva ? 'habilitado' : 'desabilitado'}.`,
    flags: 64,
  }).catch(() => {});
}

function modalMarco(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('BV_Modal_Marco').setTitle('Marco de Membros');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('intervalo')
        .setLabel('A cada quantos membros (ex: 100)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(cfg.marcoMembrosIntervalo))
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('conteudo')
        .setLabel('Mensagem')
        .setPlaceholder('{contagem} - número de membros\n{servidor} - nome do servidor')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.marcoMembrosConteudo || '')
        .setRequired(true)
        .setMaxLength(2000),
    ),
  );
  return modal;
}

async function handleModalMarco(interaction) {
  const guildId = interaction.guildId;
  const intervaloBruto = interaction.fields.getTextInputValue('intervalo').trim();
  const conteudo = interaction.fields.getTextInputValue('conteudo');

  const intervalo = parseInt(intervaloBruto, 10);
  if (isNaN(intervalo) || intervalo <= 0) {
    return interaction.reply({
      content: `${EMOJI_NEGATIVO} O intervalo precisa ser um número inteiro maior que zero.`,
      flags: 64,
    });
  }

  const cfg = getBoasVindas(guildId);
  cfg.marcoMembrosIntervalo = intervalo;
  cfg.marcoMembrosConteudo = conteudo;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildMarcoEmbed(interaction)],
    components: montarComponentesMarco(interaction),
  });
  await interaction.followUp({ content: `${EMOJI_POSITIVO} Marco de Membros configurado com sucesso!`, flags: 64 }).catch(() => {});
}

// ── AUTO ROLE (equivalente a obterPainelAutoRole) ─────────────────

function buildAutoRoleEmbed(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const cargosValidos = cfg.autoRoleCargoIds.filter(id => interaction.guild.roles.cache.has(id));
  const cargosInvalidos = cfg.autoRoleCargoIds.length - cargosValidos.length;

  let cargoTexto;
  if (cargosValidos.length === 0) {
    cargoTexto = `${EMOJI_NEGATIVO} \`Não configurado\``;
  } else {
    cargoTexto = cargosValidos.map(id => `<@&${id}>`).join(', ');
    if (cargosInvalidos > 0) cargoTexto += `\n${EMOJI_NEGATIVO} \`${cargosInvalidos} cargo(s) inválido(s) — foram removidos ou excluídos\``;
  }

  const statusTexto = cfg.autoRoleAtiva ? `${EMOJI_POSITIVO} \`Ativado\`` : `${EMOJI_NEGATIVO} \`Desativado\``;

  return new EmbedBuilder()
    .setTitle('Sistema de Auto Role')
    .setDescription(
      'Aqui você pode gerenciar o sistema de Auto Role.\n' +
      'Ele atribuirá automaticamente o(s) cargo(s) selecionado(s) aos membros que entrarem no servidor — dá pra escolher mais de um.\n' +
      'Certifique-se de que o bot tenha permissão pra atribuí-los (o cargo do bot precisa estar ACIMA de todos os cargos escolhidos).'
    )
    .setColor(0x00FFFF)
    .setTimestamp()
    .setFooter({ text: interaction.guild.name, iconURL: iconGuild(interaction) })
    .addFields(
      { name: 'Status do Sistema', value: statusTexto, inline: true },
      { name: 'Cargo(s) Configurado(s)', value: cargoTexto, inline: true },
    );
}

function buildAutoRoleComponents(interaction) {
  const cfg = getBoasVindas(interaction.guildId);
  const botaoToggle = cfg.autoRoleAtiva
    ? new ButtonBuilder().setCustomId('BV_Toggle_AutoRole').setLabel('Desabilitar').setStyle(ButtonStyle.Danger)
    : new ButtonBuilder().setCustomId('BV_Toggle_AutoRole').setLabel('Habilitar').setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('BV_Cargo_Select')
        .setPlaceholder('Selecione um ou mais cargos automáticos')
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder().addComponents(
      botaoToggle,
      new ButtonBuilder().setCustomId('BV_Cargo_Limpar').setLabel('Limpar Cargos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('BV_Voltar_Submenu').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function abrirAutoRole(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  await interaction.update({
    content: null,
    embeds: [buildAutoRoleEmbed(interaction)],
    components: buildAutoRoleComponents(interaction),
  });
}

async function toggleAutoRole(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.autoRoleAtiva = !cfg.autoRoleAtiva;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildAutoRoleEmbed(interaction)],
    components: buildAutoRoleComponents(interaction),
  });
  await interaction.followUp({
    content: `${EMOJI_POSITIVO} O sistema de Auto Role foi ${cfg.autoRoleAtiva ? 'habilitado' : 'desabilitado'}.`,
    flags: 64,
  }).catch(() => {});
}

async function limparCargos(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.autoRoleCargoIds = [];
  cfg.autoRoleCargoId = null;
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildAutoRoleEmbed(interaction)],
    components: buildAutoRoleComponents(interaction),
  });
  await interaction.followUp({ content: `${EMOJI_POSITIVO} Cargos automáticos removidos.`, flags: 64 }).catch(() => {});
}

async function selecionarCargo(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const guildId = interaction.guildId;
  const cfg = getBoasVindas(guildId);
  cfg.autoRoleCargoIds = interaction.values; // até 10 cargos, já validado pelo próprio Discord no select
  cfg.autoRoleCargoId = interaction.values[0] || null; // mantém o campo antigo em sincronia, por compatibilidade
  saveBoasVindas(guildId, cfg);

  await interaction.update({
    content: null,
    embeds: [buildAutoRoleEmbed(interaction)],
    components: buildAutoRoleComponents(interaction),
  });
}

// ── ROTEAMENTO (chamado por events/buttonHandler.js) ──────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'BV_Menu_Mensagem')  return abrirMensagem(interaction);
  if (id === 'BV_Toggle_Mensagem') return toggleMensagem(interaction);
  if (id === 'BV_Toggle_DM') return toggleDM(interaction);
  if (id === 'BV_Editar_Variacoes') {
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalVariacoes(interaction));
  }
  if (id === 'BV_Editar_Mensagem') {
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalMensagem(interaction));
  }
  if (id === 'BV_Preview_Mensagem') return previewMensagem(interaction);

  if (id === 'BV_Menu_AutoRole')   return abrirAutoRole(interaction);
  if (id === 'BV_Toggle_AutoRole') return toggleAutoRole(interaction);
  if (id === 'BV_Cargo_Limpar') return limparCargos(interaction);

  if (id === 'BV_Menu_Marco')   return abrirMarco(interaction);
  if (id === 'BV_Toggle_Marco') return toggleMarco(interaction);
  if (id === 'BV_Editar_Marco') {
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalMarco(interaction));
  }

  if (id === 'BV_Menu_Saida')   return abrirSaida(interaction);
  if (id === 'BV_Toggle_Saida') return toggleSaida(interaction);
  if (id === 'BV_Editar_Saida') {
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalSaida(interaction));
  }
  if (id === 'BV_Preview_Saida') return previewSaida(interaction);

  // ── Configurar Imagem (entrada/saída) ──
  if (id.startsWith('BV_Img_Menu_'))    return abrirImagem(interaction, id.replace('BV_Img_Menu_', ''));
  if (id.startsWith('BV_Img_Toggle_'))  return toggleImagem(interaction, id.replace('BV_Img_Toggle_', ''));
  if (id.startsWith('BV_Img_Gerar_'))   return gerarFundoAleatorio(interaction, id.replace('BV_Img_Gerar_', ''));
  if (id.startsWith('BV_Img_URL_')) {
    const tipo = id.replace('BV_Img_URL_', '');
    if (!(await usuarioTemPermissao(interaction))) return;
    return interaction.showModal(modalUrlImagem(interaction, tipo));
  }
  if (id.startsWith('BV_Img_Voltar_')) {
    const tipo = id.replace('BV_Img_Voltar_', '');
    return tipo === 'entrada' ? abrirMensagem(interaction) : abrirSaida(interaction);
  }

  if (id === 'BV_Voltar_Submenu') return abrirBoasVindas(interaction);
  if (id === 'BV_Voltar_Painel') {
    // BUGFIX: a mensagem atual NAO e Components V2 (e a ephemeral aberta por
    // este modulo, com content/embed). Editar direto pro /painel (V2) sem
    // limpar content/embeds da erro 50035. voltarParaPainel() limpa os campos
    // antigos e, se falhar, abre o /painel numa mensagem nova.
    const { voltarParaPainel } = require('../commands/painel');
    return voltarParaPainel(interaction);
  }
}

async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  if (id === 'BV_Canal_Select') return selecionarCanal(interaction);
  if (id === 'BV_Cargo_Select') return selecionarCargo(interaction);
  if (id === 'BV_CanalSaida_Select') return selecionarCanalSaida(interaction);

  if (id.startsWith('BV_Img_Preset_')) return selecionarPreset(interaction, id.replace('BV_Img_Preset_', ''));
  if (id.startsWith('BV_Img_Cor_'))    return selecionarCor(interaction, id.replace('BV_Img_Cor_', ''));
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (id === 'BV_Modal_Mensagem') return handleModalMensagem(interaction);
  if (id === 'BV_Modal_Marco') return handleModalMarco(interaction);
  if (id === 'BV_Modal_Variacoes') return handleModalVariacoes(interaction);
  if (id === 'BV_Modal_Saida') return handleModalSaida(interaction);

  if (id.startsWith('BV_Modal_ImgURL_')) return handleModalUrlImagem(interaction, id.replace('BV_Modal_ImgURL_', ''));
  if (id.startsWith('BV_Modal_ImgCor_')) return handleModalCorCustom(interaction, id.replace('BV_Modal_ImgCor_', ''));
}

// ── ENTREGA DE VERDADE (guildMemberAdd) ───────────────────────────
// Chamada a partir de index.js quando um membro entra no servidor.
// Envia a mensagem configurada (se ativa) e dá o cargo automático (se
// ativo) — tudo em blocos try/catch independentes, pra uma falha num
// não travar o outro.

async function enviarMensagemDeEntrada(member) {
  const cfg = getBoasVindas(member.guild.id);
  if (!cfg.mensagemAtiva) return;

  const canalId = getCanalBoasVindasId(member.guild.id);
  if (!canalId) return;

  const canal = member.guild.channels.cache.get(canalId);
  if (!canal || !canal.isTextBased?.()) return;

  const convidadoPorTexto = resolverConvidadoPorTexto(member);
  const conteudo = renderizarConteudo(escolherConteudo(cfg), member, convidadoPorTexto);
  const temImagem = cfg.imagemEntrada?.ativa;
  if (!conteudo && !temImagem) return;

  try {
    const payload = {};
    if (conteudo) payload.content = conteudo;
    if (temImagem) {
      const buffer = await gerarCard({
        tipo: 'entrada',
        member,
        config: cfg.imagemEntrada,
        contagemMembros: member.guild.memberCount,
      });
      payload.files = [new AttachmentBuilder(buffer, { name: 'boas-vindas.png' })];
    }

    const mensagem = await canal.send(payload);
    if (cfg.tempoApagar) {
      setTimeout(() => { mensagem.delete().catch(() => {}); }, cfg.tempoApagar * 1000);
    }
  } catch (e) {
    console.error('[BoasVindas] Falha ao enviar mensagem de entrada:', e.message);
  }

  // Envio por DM é OPCIONAL e best-effort: muita gente tem DM fechada pra
  // membros do servidor, então uma falha aqui NUNCA pode afetar a mensagem
  // do canal (que já foi enviada acima, em bloco try/catch separado).
  if (cfg.dmAtiva && conteudo) {
    try {
      await member.send({ content: conteudo });
    } catch (e) {
      console.log(`[BoasVindas] Não foi possível enviar DM de boas-vindas pra ${member.id} (provavelmente DM fechada).`);
    }
  }
}

async function aplicarAutoRole(member) {
  const cfg = getBoasVindas(member.guild.id);
  if (!cfg.autoRoleAtiva || cfg.autoRoleCargoIds.length === 0) return;

  const cargos = cfg.autoRoleCargoIds
    .map(id => member.guild.roles.cache.get(id))
    .filter(Boolean); // ignora silenciosamente cargos que foram excluídos do servidor

  if (cargos.length === 0) return;

  try {
    await member.roles.add(cargos);
  } catch (e) {
    console.error('[BoasVindas] Falha ao aplicar Auto Role:', e.message);
  }
}

async function enviarMarcoDeMembros(member) {
  const cfg = getBoasVindas(member.guild.id);
  if (!cfg.marcoMembrosAtiva) return;
  if (!cfg.marcoMembrosIntervalo || cfg.marcoMembrosIntervalo <= 0) return;
  if (member.guild.memberCount % cfg.marcoMembrosIntervalo !== 0) return;

  const canalId = getCanalBoasVindasId(member.guild.id);
  if (!canalId) return;
  const canal = member.guild.channels.cache.get(canalId);
  if (!canal || !canal.isTextBased?.()) return;

  const conteudo = (cfg.marcoMembrosConteudo || '')
    .replaceAll('{contagem}', String(member.guild.memberCount))
    .replaceAll('{servidor}', member.guild.name || '');
  if (!conteudo) return;

  try {
    await canal.send({ content: conteudo });
  } catch (e) {
    console.error('[BoasVindas] Falha ao enviar Marco de Membros:', e.message);
  }
}

async function handleGuildMemberAdd(member) {
  await Promise.allSettled([
    enviarMensagemDeEntrada(member),
    aplicarAutoRole(member),
    enviarMarcoDeMembros(member),
  ]);
}

// ── ENTREGA DE VERDADE (guildMemberRemove) ────────────────────────
// Chamada a partir de index.js quando um membro sai do servidor. Nesse
// momento o member já não tem mais cargos/permissões no servidor, mas
// ainda dá pra ler nome e avatar normalmente (o Discord manda o objeto
// completo, só não é mais possível interagir com ele no servidor).

async function enviarMensagemDeSaida(member) {
  const cfg = getBoasVindas(member.guild.id);
  if (!cfg.saidaAtiva) return;
  if (!cfg.canalSaidaId) return;

  const canal = member.guild.channels.cache.get(cfg.canalSaidaId);
  if (!canal || !canal.isTextBased?.()) return;

  const conteudo = renderizarConteudo(cfg.conteudoSaida, member);
  const temImagem = cfg.imagemSaida?.ativa;
  if (!conteudo && !temImagem) return;

  try {
    const payload = {};
    if (conteudo) payload.content = conteudo;
    if (temImagem) {
      const buffer = await gerarCard({
        tipo: 'saida',
        member,
        config: cfg.imagemSaida,
      });
      payload.files = [new AttachmentBuilder(buffer, { name: 'saida.png' })];
    }

    const mensagem = await canal.send(payload);
    if (cfg.tempoApagarSaida) {
      setTimeout(() => { mensagem.delete().catch(() => {}); }, cfg.tempoApagarSaida * 1000);
    }
  } catch (e) {
    console.error('[BoasVindas] Falha ao enviar mensagem de saída:', e.message);
  }
}

async function handleGuildMemberRemove(member) {
  await enviarMensagemDeSaida(member);
}

module.exports = {
  abrirBoasVindas,
  handleButton,
  handleSelectMenu,
  handleModal,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
};
