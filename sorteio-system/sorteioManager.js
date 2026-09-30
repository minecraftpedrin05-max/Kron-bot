/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Sistema de Sorteios
 *
 *  Painel completo acionado pelo botão "<:sorteio:1533089699844067418> Sorteios" do /painel.
 *  100% em Components V2 (ContainerBuilder / TextDisplayBuilder /
 *  SeparatorBuilder / MediaGalleryBuilder), seguindo exatamente o
 *  padrão visual de commands/painel.js.
 *
 *  Todo acesso a dados passa por database/db.js (funções getSorteio*,
 *  criarSorteio, adicionarParticipante, encerrarSorteio, etc.) — nunca
 *  lê/escreve o JSON diretamente aqui. Isso é o que permite migrar
 *  para SQLite (better-sqlite3) trocando somente a camada em db.js.
 *
 *  discord-giveaways NÃO está instalado neste projeto (verificado em
 *  package.json). O ciclo de vida do sorteio (contagem, encerramento,
 *  reroll) é implementado aqui + handlers/sorteioScheduler.js, com a
 *  mesma robustez esperada da lib (resistente a restart do bot). Ver
 *  nota de migração no fim de sorteioScheduler.js.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');

const db = require('../database/db');

// ── Constantes visuais (fallback quando não configurado) ───────────
const COR_PADRAO = 0x000000;
const EMOJI_PADRAO = '<:sorteio:1533089699844067418>';

// ── Helpers de formatação/tempo ─────────────────────────────────────

// Converte string tipo "10m", "2h", "1d", "30s" em milissegundos.
function parseDuracao(texto) {
  const match = String(texto).trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const valor = parseInt(match[1], 10);
  const unidade = match[2].toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unidade];
  if (!mult || isNaN(valor) || valor <= 0) return null;
  return valor * mult;
}

function formatarDuracao(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function idadeContaEmDias(userId) {
  // Snowflake do Discord já contém o timestamp de criação.
  const DISCORD_EPOCH = 1420070400000n;
  const timestamp = (BigInt(userId) >> 22n) + DISCORD_EPOCH;
  const criadoEm = Number(timestamp);
  return (Date.now() - criadoEm) / 86_400_000;
}

function embaralhar(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Elegibilidade — equivalente a exemptMembers() do discord-giveaways ──
// Retorna { elegivel: boolean, motivo?: string } em vez de lançar exceção,
// para o handleButton poder mostrar uma mensagem clara ao usuário.
async function verificarElegibilidade(interaction, sorteio) {
  const membro = interaction.member;

  if (sorteio.cargoObrigatorioId && !membro.roles.cache.has(sorteio.cargoObrigatorioId)) {
    return { elegivel: false, motivo: `Você precisa do cargo <@&${sorteio.cargoObrigatorioId}> para participar.` };
  }
  if (sorteio.cargoBloqueadoId && membro.roles.cache.has(sorteio.cargoBloqueadoId)) {
    return { elegivel: false, motivo: `Você possui um cargo que impede sua participação neste sorteio.` };
  }
  if (sorteio.minimoDiasConta > 0) {
    const dias = idadeContaEmDias(interaction.user.id);
    if (dias < sorteio.minimoDiasConta) {
      return { elegivel: false, motivo: `Sua conta precisa ter no mínimo **${sorteio.minimoDiasConta} dia(s)** (atual: ${Math.floor(dias)}).` };
    }
  }
  if (sorteio.necessitaBoost && !membro.premiumSince) {
    return { elegivel: false, motivo: `Este sorteio é exclusivo para quem está impulsionando o servidor (boost).` };
  }

  return { elegivel: true };
}

// ═══════════════════════════════════════════════════════════════════
// PAINEL PRINCIPAL — "<:sorteio:1533089699844067418> Sorteios"
// ═══════════════════════════════════════════════════════════════════

function buildPainelSorteiosContainer(guild) {
  const stats = db.getStatsSorteio(guild.id);
  const icon = guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  return new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${EMOJI_PADRAO} Sistema de Sorteios\n` +
        `-# Crie, gerencie e acompanhe sorteios profissionais direto pelo painel.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<:rendimentos:1528401542070145135> **Resumo**\n` +
        `Ativos: \`${stats.ativos}\` • Encerrados: \`${stats.encerrados}\` • Total criado: \`${stats.totalCriados}\``
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_criar').setLabel('Criar Sorteio').setEmoji({ name: 'sorteio', id: '1533089699844067418' }).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('srt_ativos').setLabel('Sorteios Ativos').setEmoji('<:online:1533081467918221565>').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_encerrados').setLabel('Sorteios Encerrados').setEmoji('🏁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('srt_config').setLabel('Configurações').setEmoji('<:config3:1524208114327617588>').setStyle(ButtonStyle.Secondary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_stats').setLabel('Estatísticas').setEmoji('<:rendimentos:1528401542070145135>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('srt_voltar_painel').setLabel('Voltar ao Painel').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );
}

function painelSorteiosPayload(guild) {
  return {
    components: [buildPainelSorteiosContainer(guild)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

async function abrirPainelSorteios(interaction) {
  const payload = painelSorteiosPayload(interaction.guild);
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(payload);
  }
  // Se veio de um botão existente (ex: painel_sorteios), atualiza a msg;
  // se for chamado como resposta nova, usa reply.
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) {
    return interaction.update(payload);
  }
  return interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════
// CRIAR SORTEIO — Modal (2 etapas, pois Modal do Discord permite
// no máximo 5 campos por vez — dividimos essenciais/avançado)
// ═══════════════════════════════════════════════════════════════════

function buildModalCriarBasico() {
  const modal = new ModalBuilder().setCustomId('srt_modal_criar_basico').setTitle('Criar Sorteio — Etapa 1/2');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('titulo').setLabel('Título do sorteio').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Ex: Sorteio de Nitro')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('premio').setLabel('Prêmio').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('Ex: 1x Nitro Boost (1 mês)')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('descricao').setLabel('Descrição (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('duracao').setLabel('Duração (ex: 30s, 10m, 2h, 1d)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder('Ex: 1d')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('ganhadores').setLabel('Quantidade de ganhadores').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue('1')
    ),
  );
  return modal;
}

function buildModalCriarAvancado() {
  const modal = new ModalBuilder().setCustomId('srt_modal_criar_avancado').setTitle('Criar Sorteio — Etapa 2/2 (opcional)');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('imagem').setLabel('URL da imagem (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cargo_obrigatorio').setLabel('ID do cargo obrigatório (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cargo_bloqueado').setLabel('ID do cargo bloqueado (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('dias_conta').setLabel('Dias mínimos de conta (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(5).setPlaceholder('Ex: 7')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('mensagem_personalizada').setLabel('Mensagem personalizada (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)
    ),
  );
  return modal;
}

// Estado temporário entre a etapa 1 e 2 do modal de criação (em memória,
// por usuário — expira sozinho pois é sobrescrito a cada nova tentativa).
const criacaoEmAndamento = new Map(); // userId -> dadosBasicos

async function iniciarCriacaoSorteio(interaction) {
  return interaction.showModal(buildModalCriarBasico());
}

async function processarModalCriarBasico(interaction) {
  const titulo = interaction.fields.getTextInputValue('titulo').trim();
  const premio = interaction.fields.getTextInputValue('premio').trim();
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  const duracaoStr = interaction.fields.getTextInputValue('duracao').trim();
  const ganhadoresStr = interaction.fields.getTextInputValue('ganhadores').trim();

  const duracaoMs = parseDuracao(duracaoStr);
  if (!duracaoMs) {
    return interaction.reply({
      content: '<:negativo:1528400986744295475> Duração inválida. Use um número seguido de `s`, `m`, `h` ou `d`. Ex: `30s`, `10m`, `2h`, `1d`.',
      flags: 64,
    });
  }
  const ganhadoresQtd = parseInt(ganhadoresStr, 10);
  if (isNaN(ganhadoresQtd) || ganhadoresQtd < 1 || ganhadoresQtd > 20) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Quantidade de ganhadores inválida (use um número de 1 a 20).', flags: 64 });
  }

  criacaoEmAndamento.set(interaction.user.id, { titulo, premio, descricao, duracaoMs, ganhadoresQtd });

  // Etapa 2 é opcional — oferece continuar com avançado ou publicar direto
  // com o canal padrão configurado (ou pede pra escolher canal).
  const cfg = db.getSorteioConfig(interaction.guildId);
  const podePublicarDireto = !!cfg.canalPadraoId;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('srt_criar_avancado').setLabel('Configurar Requisitos (opcional)').setEmoji('<:safety:1528841000548569239>').setStyle(ButtonStyle.Primary),
    podePublicarDireto
      ? new ButtonBuilder().setCustomId('srt_criar_publicar_direto').setLabel('Publicar Agora').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId('srt_criar_escolher_canal').setLabel('Escolher Canal e Publicar').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Success),
  );

  return interaction.reply({
    content:
      `<:positivo:1528401238197276702> **Etapa 1 concluída!**\n` +
      `> <a:trofeu:1532499321008951538> **${titulo}** — ${premio}\n` +
      `> <:clock:1524207889441357917> Duração: **${formatarDuracao(duracaoMs)}** • <:target:1532137085081878558> Ganhadores: **${ganhadoresQtd}**\n\n` +
      `Você pode configurar requisitos (cargo, boost, idade da conta) ou publicar agora.`,
    components: [row],
    flags: 64,
  });
}

async function abrirModalCriarAvancado(interaction) {
  return interaction.showModal(buildModalCriarAvancado());
}

async function processarModalCriarAvancado(interaction) {
  const basicos = criacaoEmAndamento.get(interaction.user.id);
  if (!basicos) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Sessão de criação expirada. Use **Criar Sorteio** novamente.', flags: 64 });
  }

  const imagem = interaction.fields.getTextInputValue('imagem').trim() || null;
  const cargoObrigatorioId = interaction.fields.getTextInputValue('cargo_obrigatorio').trim() || null;
  const cargoBloqueadoId = interaction.fields.getTextInputValue('cargo_bloqueado').trim() || null;
  const diasContaStr = interaction.fields.getTextInputValue('dias_conta').trim();
  const mensagemPersonalizada = interaction.fields.getTextInputValue('mensagem_personalizada').trim() || null;

  let minimoDiasConta = 0;
  if (diasContaStr) {
    const n = parseInt(diasContaStr, 10);
    if (isNaN(n) || n < 0) {
      return interaction.reply({ content: '<:negativo:1528400986744295475> Dias mínimos de conta inválido.', flags: 64 });
    }
    minimoDiasConta = n;
  }

  criacaoEmAndamento.set(interaction.user.id, {
    ...basicos,
    imagem, cargoObrigatorioId, cargoBloqueadoId, minimoDiasConta, mensagemPersonalizada,
  });

  const cfg = db.getSorteioConfig(interaction.guildId);
  const podePublicarDireto = !!cfg.canalPadraoId;

  const row = new ActionRowBuilder().addComponents(
    podePublicarDireto
      ? new ButtonBuilder().setCustomId('srt_criar_publicar_direto').setLabel('Publicar Agora').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId('srt_criar_escolher_canal').setLabel('Escolher Canal e Publicar').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Success),
  );

  return interaction.reply({
    content: '<:positivo:1528401238197276702> **Requisitos configurados!** Agora escolha onde publicar.',
    components: [row],
    flags: 64,
  });
}

async function pedirCanalParaPublicar(interaction) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('srt_sel_canal_publicar')
    .setPlaceholder('<:canal:1524207214791884890> Selecione o canal para publicar o sorteio...')
    .setChannelTypes(ChannelType.GuildText);
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

// Publica de fato o sorteio: cria no banco, monta o container, envia no
// canal, agenda o encerramento automático via sorteioScheduler.
async function publicarSorteio(interaction, canalId) {
  const dados = criacaoEmAndamento.get(interaction.user.id);
  if (!dados) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Sessão de criação expirada. Use **Criar Sorteio** novamente.', flags: 64 });
  }

  const canal = interaction.guild.channels.cache.get(canalId) || await interaction.guild.channels.fetch(canalId).catch(() => null);
  if (!canal) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Canal não encontrado ou sem permissão.', flags: 64 });
  }

  const sorteio = db.criarSorteio(interaction.guildId, {
    ...dados,
    canalId,
    hostId: interaction.user.id,
  });

  const container = buildSorteioPublicoContainer(interaction.guild, sorteio);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`srt_participar_${sorteio.id}`).setLabel('Participar').setEmoji('<:sorteio:1533089699844067418>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`srt_participantes_${sorteio.id}`).setLabel('Participantes').setEmoji('<:user:1532137085081878558>').setStyle(ButtonStyle.Secondary),
  );

  const msg = await canal.send({
    components: [container, row],
    flags: MessageFlags.IsComponentsV2,
  });

  db.atualizarSorteio(interaction.guildId, sorteio.id, { mensagemId: msg.id });
  db.registrarLogSorteio(interaction.guildId, 'criacao', sorteio.id, `Criado por <@${interaction.user.id}> em <#${canalId}>`);

  const { agendarSorteio } = require('../handlers/sorteioScheduler');
  agendarSorteio(interaction.client, interaction.guildId, sorteio);

  criacaoEmAndamento.delete(interaction.user.id);

  const respostaConfirmacao = { content: `<:positivo:1528401238197276702> Sorteio **${sorteio.titulo}** publicado em <#${canalId}>!`, components: [], flags: 64 };
  if (interaction.isAnySelectMenu?.()) return interaction.update(respostaConfirmacao);
  return interaction.reply(respostaConfirmacao);
}

// ═══════════════════════════════════════════════════════════════════
// EMBED PÚBLICA DO SORTEIO (Components V2)
// ═══════════════════════════════════════════════════════════════════

function buildSorteioPublicoContainer(guild, sorteio) {
  const cfg = db.getSorteioConfig(guild.id);
  const cor = cfg.cor ?? COR_PADRAO;
  // Emoji do título FIXO — não usa mais a configuração salva do
  // servidor (cfg.emoji) nem o padrão de fábrica antigo.
  const emoji = '<:present:1538356348989743166>';
  const restanteMs = sorteio.terminaEm - Date.now();
  const timestampFim = Math.floor(sorteio.terminaEm / 1000);

  const requisitos = [];
  if (sorteio.cargoObrigatorioId) requisitos.push(`🔖 Cargo obrigatório: <@&${sorteio.cargoObrigatorioId}>`);
  if (sorteio.cargoBloqueadoId) requisitos.push(`🚫 Cargo bloqueado: <@&${sorteio.cargoBloqueadoId}>`);
  if (sorteio.minimoDiasConta > 0) requisitos.push(`📅 Conta mínima: ${sorteio.minimoDiasConta} dia(s)`);
  if (sorteio.necessitaBoost) requisitos.push(`💎 Requer boost no servidor`);

  const container = new ContainerBuilder()
    .setAccentColor(cor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${emoji} ${sorteio.titulo}\n` +
        `${sorteio.descricao ? `${sorteio.descricao}\n\n` : ''}` +
        `<a:trofeu:1532499321008951538> **Prêmio:** ${sorteio.premio}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

  if (sorteio.imagem || cfg.imagemPadrao) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(sorteio.imagem || cfg.imagemPadrao).setSpoiler(false)
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `<:users:1528840901739151430> **Participantes:** \`${sorteio.participantes.length}\`\n` +
      `<:target:1532137085081878558> **Ganhadores:** \`${sorteio.ganhadoresQtd}\`\n` +
      `<:clock:1524207889441357917> **Termina:** <t:${timestampFim}:R> (<t:${timestampFim}:f>)` +
      (requisitos.length > 0 ? `\n\n**Requisitos:**\n${requisitos.join('\n')}` : '')
    )
  );

  if (cfg.entradaExtraCargoId && cfg.entradaExtraQtd > 0) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Entradas extra:**\n` +
        `<@&${cfg.entradaExtraCargoId}>: \`${cfg.entradaExtraQtd}\` entrada(s)`
      )
    );
  }

  if (sorteio.mensagemPersonalizada) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${sorteio.mensagemPersonalizada}`));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Boa sorte!'));
  return container;
}

function buildSorteioEncerradoContainer(guild, sorteio) {
  const cfg = db.getSorteioConfig(guild.id);
  const cor = cfg.cor ?? COR_PADRAO;
  const emoji = cfg.emoji || EMOJI_PADRAO;

  const ganhadoresTexto = sorteio.ganhadores.length > 0
    ? sorteio.ganhadores.map(id => `<@${id}>`).join(', ')
    : '_Ninguém participou._';

  const container = new ContainerBuilder()
    .setAccentColor(cor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${emoji} ${sorteio.titulo} — Encerrado\n` +
        `<a:trofeu:1532499321008951538> **Prêmio:** ${sorteio.premio}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `🎊 **Ganhador(es):** ${ganhadoresTexto}\n` +
        `<:users:1528840901739151430> **Total de participantes:** \`${sorteio.participantes.length}\``
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Sorteio encerrado • ${cfg.footer || guild.name}`)
    );

  return container;
}

// ═══════════════════════════════════════════════════════════════════
// PARTICIPAÇÃO
// ═══════════════════════════════════════════════════════════════════

/**
 * Botão "Participantes" — gera um .txt com o ID de cada participante do
 * sorteio (um por linha, sem nome/tag, conforme pedido). Ephemeral: só
 * quem clicou recebe o arquivo.
 */
async function gerarListaParticipantes(interaction, sorteioId) {
  const sorteio = db.getSorteio(interaction.guildId, sorteioId);
  if (!sorteio) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Sorteio não encontrado.', flags: 64 });
  }
  if (!sorteio.participantes || sorteio.participantes.length === 0) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Ainda não há participantes neste sorteio.', flags: 64 });
  }

  const conteudo = sorteio.participantes.join('\n');
  const arquivo = new AttachmentBuilder(Buffer.from(conteudo, 'utf-8'), { name: `participantes-${sorteio.id}.txt` });

  return interaction.reply({
    content: `<:users:1528840901739151430> **${sorteio.participantes.length}** participante(s) — lista em anexo.`,
    files: [arquivo],
    flags: 64,
  });
}

async function participarSorteio(interaction, sorteioId) {
  const sorteio = db.getSorteio(interaction.guildId, sorteioId);
  if (!sorteio || sorteio.status !== 'ativo') {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Este sorteio não está mais disponível.', flags: 64 });
  }

  const elegibilidade = await verificarElegibilidade(interaction, sorteio);
  if (!elegibilidade.elegivel) {
    return interaction.reply({ content: `<:negativo:1528400986744295475> ${elegibilidade.motivo}`, flags: 64 });
  }

  const resultado = db.adicionarParticipante(interaction.guildId, sorteioId, interaction.user.id);
  if (!resultado.ok) {
    if (resultado.motivo === 'ja_participando') {
      return interaction.reply({ content: '<:positivo:1528401238197276702> Você já está participando deste sorteio!', flags: 64 });
    }
    return interaction.reply({ content: '<:negativo:1528400986744295475> Não foi possível registrar sua participação.', flags: 64 });
  }

  db.registrarLogSorteio(interaction.guildId, 'participacao', sorteioId, `<@${interaction.user.id}> entrou`);

  // Atualiza a contagem de participantes na mensagem pública, sem travar
  // a resposta ephemeral do participante.
  atualizarMensagemPublica(interaction.client, interaction.guildId, sorteioId).catch(() => {});

  return interaction.reply({ content: `<:sorteio:1533089699844067418> Você está participando! Boa sorte — participantes: \`${resultado.participantes}\`.`, flags: 64 });
}

async function atualizarMensagemPublica(client, guildId, sorteioId) {
  const sorteio = db.getSorteio(guildId, sorteioId);
  if (!sorteio || !sorteio.mensagemId) return;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const canal = guild.channels.cache.get(sorteio.canalId) || await guild.channels.fetch(sorteio.canalId).catch(() => null);
  if (!canal) return;
  const msg = await canal.messages.fetch(sorteio.mensagemId).catch(() => null);
  if (!msg) return;

  if (sorteio.status === 'ativo') {
    const container = buildSorteioPublicoContainer(guild, sorteio);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`srt_participar_${sorteio.id}`).setLabel('Participar').setEmoji('<:sorteio:1533089699844067418>').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`srt_participantes_${sorteio.id}`).setLabel('Participantes').setEmoji('<:user:1532137085081878558>').setStyle(ButtonStyle.Secondary),
    );
    await msg.edit({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  } else {
    const container = buildSorteioEncerradoContainer(guild, sorteio);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`srt_reroll_${sorteio.id}`).setLabel('Escolher novo vencedor').setEmoji('<:xpooo:1523791736948920433>').setStyle(ButtonStyle.Secondary)
    );
    await msg.edit({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENCERRAMENTO (automático via scheduler ou manual)
// ═══════════════════════════════════════════════════════════════════

async function sortearGanhadores(guild, sorteio) {
  const cfg = guild ? db.getSorteioConfig(guild.id) : {};
  let poolPonderado = [];

  if (guild && cfg.entradaExtraCargoId && cfg.entradaExtraQtd > 0) {
    for (const userId of sorteio.participantes) {
      let peso = 1;
      try {
        const membro = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (membro && membro.roles.cache.has(cfg.entradaExtraCargoId)) {
          peso += cfg.entradaExtraQtd;
        }
      } catch { /* membro indisponível — conta como entrada normal */ }
      for (let i = 0; i < peso; i++) poolPonderado.push(userId);
    }
  } else {
    poolPonderado = [...sorteio.participantes];
  }

  const embaralhado = embaralhar(poolPonderado);
  const vistos = new Set();
  const ganhadores = [];
  for (const userId of embaralhado) {
    if (vistos.has(userId)) continue;
    vistos.add(userId);
    ganhadores.push(userId);
    if (ganhadores.length >= sorteio.ganhadoresQtd) break;
  }
  return ganhadores;
}

// Chamado pelo sorteioScheduler quando o tempo termina. Também é o
// caminho usado para reagendar sorteios vencidos durante o downtime.
async function encerrarSorteioAutomatico(client, guildId, sorteioId) {
  const sorteio = db.getSorteio(guildId, sorteioId);
  if (!sorteio || sorteio.status !== 'ativo') return;

  const guildParaSorteio = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const ganhadores = await sortearGanhadores(guildParaSorteio, sorteio);
  db.encerrarSorteio(guildId, sorteioId, ganhadores, 'encerrado');
  db.registrarLogSorteio(guildId, 'finalizacao', sorteioId, `Ganhadores: ${ganhadores.map(id => `<@${id}>`).join(', ') || 'nenhum'}`);

  await atualizarMensagemPublica(client, guildId, sorteioId);
  await enviarDMsGanhadores(client, guildId, sorteioId, ganhadores);
}

async function enviarDMsGanhadores(client, guildId, sorteioId, ganhadores) {
  const sorteio = db.getSorteio(guildId, sorteioId);
  if (!sorteio) return;
  for (const userId of ganhadores) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(
        `<:sorteio:1533089699844067418> **Parabéns!** Você ganhou o sorteio **${sorteio.titulo}**!\n` +
        `<a:trofeu:1532499321008951538> Prêmio: ${sorteio.premio}\n\n` +
        `Entre em contato com a equipe do servidor para resgatar seu prêmio.`
      ).catch(() => {});
    } catch (e) { /* usuário indisponível — segue sem travar os demais */ }
  }
}

// Cancelamento manual — não sorteia ninguém, apenas encerra.
async function cancelarSorteio(interaction, sorteioId) {
  const sorteio = db.getSorteio(interaction.guildId, sorteioId);
  if (!sorteio || sorteio.status !== 'ativo') {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Sorteio não encontrado ou já encerrado.', flags: 64 });
  }
  const { desagendarSorteio } = require('../handlers/sorteioScheduler');
  desagendarSorteio(sorteioId);

  db.encerrarSorteio(interaction.guildId, sorteioId, [], 'cancelado');
  db.registrarLogSorteio(interaction.guildId, 'cancelamento', sorteioId, `Cancelado por <@${interaction.user.id}>`);

  await atualizarMensagemPublica(interaction.client, interaction.guildId, sorteioId);
  return interaction.reply({ content: `<:positivo:1528401238197276702> Sorteio **${sorteio.titulo}** cancelado.`, flags: 64 });
}

// Reroll — sorteia novos ganhadores dentre os participantes que já tinham
// entrado, mantendo o histórico do sorteio encerrado.
async function rerollSorteio(interaction, sorteioId) {
  const sorteio = db.getSorteio(interaction.guildId, sorteioId);
  if (!sorteio || sorteio.status === 'ativo') {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Só é possível fazer reroll em sorteios já encerrados.', flags: 64 });
  }
  if (sorteio.participantes.length === 0) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Este sorteio não teve participantes.', flags: 64 });
  }

  const novosGanhadores = await sortearGanhadores(interaction.guild, sorteio);
  db.atualizarSorteio(interaction.guildId, sorteioId, { ganhadores: novosGanhadores });
  db.registrarLogSorteio(interaction.guildId, 'reroll', sorteioId, `Novo(s) ganhador(es): ${novosGanhadores.map(id => `<@${id}>`).join(', ')}`);

  await atualizarMensagemPublica(interaction.client, interaction.guildId, sorteioId);
  await enviarDMsGanhadores(interaction.client, interaction.guildId, sorteioId, novosGanhadores);

  return interaction.reply({ content: `<:xpooo:1523791736948920433> Novo(s) ganhador(es): ${novosGanhadores.map(id => `<@${id}>`).join(', ')}`, flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// LISTAGENS — Ativos / Encerrados
// ═══════════════════════════════════════════════════════════════════

function buildListaContainer(titulo, sorteios, tipo) {
  const container = new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${titulo}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (sorteios.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Nenhum sorteio encontrado.'));
  } else {
    const linhas = sorteios.slice(0, 15).map(s => {
      if (tipo === 'ativo') {
        const restante = Math.max(0, s.terminaEm - Date.now());
        return `<:sorteio:1533089699844067418> **${s.titulo}** — ${s.premio}\n` +
          `👥 \`${s.participantes.length}\` participante(s) • ⏳ termina em \`${formatarDuracao(restante)}\` • \`${s.id}\``;
      }
      const ganhadoresTxt = s.ganhadores.length > 0 ? s.ganhadores.map(id => `<@${id}>`).join(', ') : '_sem participantes_';
      return `🏁 **${s.titulo}** — ${s.premio}\n` +
        `🎊 Ganhador(es): ${ganhadoresTxt} • \`${s.id}\``;
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linhas.join('\n\n')));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('srt_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary)
    )
  );

  return container;
}

async function abrirSorteiosAtivos(interaction) {
  const ativos = db.getSorteiosAtivos(interaction.guildId).sort((a, b) => a.terminaEm - b.terminaEm);
  const container = buildListaContainer('<:online:1533081467918221565> Sorteios Ativos', ativos, 'ativo');
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function abrirSorteiosEncerrados(interaction) {
  const encerrados = db.getSorteiosEncerrados(interaction.guildId).sort((a, b) => new Date(b.encerradoEm) - new Date(a.encerradoEm));
  const container = buildListaContainer('🏁 Sorteios Encerrados', encerrados, 'encerrado');
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════

function buildConfigContainer(guild) {
  const cfg = db.getSorteioConfig(guild.id);
  const container = new ContainerBuilder()
    .setAccentColor(cfg.cor ?? COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:config3:1524208114327617588> Configurações de Sorteios'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `🎨 **Cor:** \`${cfg.cor != null ? '#' + cfg.cor.toString(16).padStart(6, '0') : 'Padrão'}\`\n` +
        `😀 **Emoji:** ${cfg.emoji || EMOJI_PADRAO}\n` +
        `<:canal:1524207214791884890> **Canal padrão:** ${cfg.canalPadraoId ? `<#${cfg.canalPadraoId}>` : '\`Não definido\`'}\n` +
        `🔖 **Cargo padrão:** ${cfg.cargoPadraoId ? `<@&${cfg.cargoPadraoId}>` : '\`Não definido\`'}\n` +
        `🎟️ **Entradas extra:** ${cfg.entradaExtraCargoId && cfg.entradaExtraQtd > 0 ? `<@&${cfg.entradaExtraCargoId}> +${cfg.entradaExtraQtd}` : '\`Não definido\`'}\n` +
        `💬 **Mensagem padrão:** ${cfg.mensagemPadrao ? '\`Definida\`' : '\`Não definida\`'}\n` +
        `<:foto:1533080648196292679> **Imagem padrão:** ${cfg.imagemPadrao ? '\`Definida\`' : '\`Não definida\`'}\n` +
        `🏷️ **Footer:** \`${cfg.footer || guild.name}\``
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_cfg_texto').setLabel('Editar Textos/Cor').setEmoji('🎨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('srt_cfg_canal').setLabel('Canal Padrão').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_cfg_cargo').setLabel('Cargo Padrão').setEmoji('🔖').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('srt_cfg_entrada_extra').setLabel('Entradas Extra').setEmoji('🎟️').setStyle(ButtonStyle.Primary),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
      )
    );
  return container;
}

async function abrirConfiguracoes(interaction) {
  const container = buildConfigContainer(interaction.guild);
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

function buildModalConfigTexto(guild) {
  const cfg = db.getSorteioConfig(guild.id);
  const modal = new ModalBuilder().setCustomId('srt_modal_cfg_texto').setTitle('🎨 Configurar Textos e Visual');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cor').setLabel('Cor (hex, ex: FFD700)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(6).setValue(cfg.cor != null ? cfg.cor.toString(16).padStart(6, '0') : '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('emoji').setLabel('Emoji padrão').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setValue(cfg.emoji || '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('mensagem_padrao').setLabel('Mensagem padrão').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300).setValue(cfg.mensagemPadrao || '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('imagem_padrao').setLabel('URL da imagem padrão').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setValue(cfg.imagemPadrao || '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('footer').setLabel('Texto do footer').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(cfg.footer || '')
    ),
  );
  return modal;
}

async function abrirModalConfigTexto(interaction) {
  return interaction.showModal(buildModalConfigTexto(interaction.guild));
}

async function processarModalConfigTexto(interaction) {
  const corStr = interaction.fields.getTextInputValue('cor').trim().replace('#', '');
  const emoji = interaction.fields.getTextInputValue('emoji').trim();
  const mensagemPadrao = interaction.fields.getTextInputValue('mensagem_padrao').trim();
  const imagemPadrao = interaction.fields.getTextInputValue('imagem_padrao').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim();

  const patch = {};
  if (corStr) {
    const corNum = parseInt(corStr, 16);
    if (isNaN(corNum)) return interaction.reply({ content: '<:negativo:1528400986744295475> Cor hexadecimal inválida.', flags: 64 });
    patch.cor = corNum;
  }
  if (emoji) patch.emoji = emoji;
  if (mensagemPadrao) patch.mensagemPadrao = mensagemPadrao;
  if (imagemPadrao) patch.imagemPadrao = imagemPadrao;
  if (footer) patch.footer = footer;

  db.setSorteioConfig(interaction.guildId, patch);
  return interaction.reply({ content: '<:positivo:1528401238197276702> Configurações visuais salvas com sucesso.', flags: 64 });
}

async function pedirCanalConfig(interaction) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('srt_sel_cfg_canal')
    .setPlaceholder('<:canal:1524207214791884890> Selecione o canal padrão de sorteios...')
    .setChannelTypes(ChannelType.GuildText);
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function pedirCargoConfig(interaction) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId('srt_sel_cfg_cargo')
    .setPlaceholder('🔖 Selecione o cargo padrão obrigatório...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function pedirCargoEntradaExtra(interaction) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId('srt_sel_cfg_entrada_cargo')
    .setPlaceholder('🎟️ Selecione o cargo com entradas extra...');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

function buildModalEntradaExtraQtd(cargoId, qtdAtual) {
  const modal = new ModalBuilder().setCustomId(`srt_modal_cfg_entrada_qtd_${cargoId}`).setTitle('🎟️ Entradas Extra');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantidade')
        .setLabel('Quantas entradas extra esse cargo dá?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setValue(qtdAtual ? String(qtdAtual) : '2')
    ),
  );
  return modal;
}

async function processarModalEntradaExtraQtd(interaction) {
  const cargoId = interaction.customId.replace('srt_modal_cfg_entrada_qtd_', '');
  const qtdStr = interaction.fields.getTextInputValue('quantidade').trim();
  const qtd = parseInt(qtdStr, 10);
  if (isNaN(qtd) || qtd < 0 || qtd > 999) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Quantidade inválida (use um número de 0 a 999). Use 0 para desativar.', flags: 64 });
  }
  if (qtd === 0) {
    db.setSorteioConfig(interaction.guildId, { entradaExtraCargoId: null, entradaExtraQtd: 0 });
    return interaction.reply({ content: '<:positivo:1528401238197276702> Entradas extra desativadas.', flags: 64 });
  }
  db.setSorteioConfig(interaction.guildId, { entradaExtraCargoId: cargoId, entradaExtraQtd: qtd });
  return interaction.reply({ content: `<:positivo:1528401238197276702> Cargo <@&${cargoId}> agora dá **+${qtd}** entrada(s) extra em novos sorteios.`, flags: 64 });
}

// ═══════════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════════

async function abrirEstatisticas(interaction) {
  const stats = db.getStatsSorteio(interaction.guildId);
  const container = new ContainerBuilder()
    .setAccentColor(COR_PADRAO)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:rendimentos:1528401542070145135> Estatísticas de Sorteios'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<:sorteio:1533089699844067418> **Total Criados:** \`${stats.totalCriados}\`\n` +
        `<:online:1533081467918221565> **Ativos:** \`${stats.ativos}\`\n` +
        `🏁 **Encerrados:** \`${stats.encerrados}\`\n` +
        `<a:trofeu:1532499321008951538> **Maior Sorteio:** ${stats.maiorSorteio ? `\`${stats.maiorSorteio.titulo}\` (${stats.maiorSorteio.participantes} participantes)` : '`Nenhum ainda`'}\n` +
        `🎊 **Último Vencedor:** ${stats.ultimoVencedorId ? `<@${stats.ultimoVencedorId}>` : '`Nenhum ainda`'}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('srt_voltar_menu').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary)
      )
    );
  return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// ═══════════════════════════════════════════════════════════════════
// HANDLERS DE ROTA (chamados pelo events/buttonHandler.js)
// ═══════════════════════════════════════════════════════════════════

// Mensagem amigável e ephemeral para qualquer erro não tratado nos
// handlers de sorteio abaixo, para nunca deixar o Discord mostrar o
// erro genérico de interação ("A interação falhou") nem propagar a
// exceção para fora (o que poderia derrubar o processo em conjunto
// com uma rejeição de promise não tratada).
async function responderErroSorteio(interaction, error) {
  console.error('[SORTEIOS] Erro não tratado em uma interação:', error);
  try {
    const payload = { content: '<:negativo:1528400986744295475> Ocorreu um erro ao processar essa ação do sorteio. Tente novamente.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (e) {
    console.error('[SORTEIOS] Falha ao responder após erro:', e);
  }
}

async function handleButton(interaction) {
  try {
    const id = interaction.customId;

    if (id === 'painel_sorteios' || id === 'srt_voltar_menu') return await abrirPainelSorteios(interaction);
    if (id === 'srt_voltar_painel') {
      const { painelPayload } = require('../commands/painel');
      return await interaction.update(painelPayload(interaction.user));
    }

    if (id === 'srt_criar') return await iniciarCriacaoSorteio(interaction);
    if (id === 'srt_criar_avancado') return await abrirModalCriarAvancado(interaction);
    if (id === 'srt_criar_escolher_canal') return await pedirCanalParaPublicar(interaction);
    if (id === 'srt_criar_publicar_direto') {
      const cfg = db.getSorteioConfig(interaction.guildId);
      return await publicarSorteio(interaction, cfg.canalPadraoId);
    }

    if (id === 'srt_ativos') return await abrirSorteiosAtivos(interaction);
    if (id === 'srt_encerrados') return await abrirSorteiosEncerrados(interaction);
    if (id === 'srt_stats') return await abrirEstatisticas(interaction);

    if (id === 'srt_config') return await abrirConfiguracoes(interaction);
    if (id === 'srt_cfg_texto') return await abrirModalConfigTexto(interaction);
    if (id === 'srt_cfg_canal') return await pedirCanalConfig(interaction);
    if (id === 'srt_cfg_cargo') return await pedirCargoConfig(interaction);
    if (id === 'srt_cfg_entrada_extra') return await pedirCargoEntradaExtra(interaction);

    if (id.startsWith('srt_participar_')) return await participarSorteio(interaction, id.replace('srt_participar_', ''));
    if (id.startsWith('srt_participantes_')) return await gerarListaParticipantes(interaction, id.replace('srt_participantes_', ''));
    if (id.startsWith('srt_reroll_')) return await rerollSorteio(interaction, id.replace('srt_reroll_', ''));
    if (id.startsWith('srt_cancelar_')) return await cancelarSorteio(interaction, id.replace('srt_cancelar_', ''));
  } catch (error) {
    await responderErroSorteio(interaction, error);
  }
}

async function handleSelectMenu(interaction) {
  try {
    const id = interaction.customId;

    if (id === 'srt_sel_canal_publicar') return await publicarSorteio(interaction, interaction.values[0]);
    if (id === 'srt_sel_cfg_canal') {
      db.setSorteioConfig(interaction.guildId, { canalPadraoId: interaction.values[0] });
      return await interaction.reply({ content: `<:positivo:1528401238197276702> Canal padrão definido para <#${interaction.values[0]}>.`, flags: 64 });
    }
    if (id === 'srt_sel_cfg_cargo') {
      db.setSorteioConfig(interaction.guildId, { cargoPadraoId: interaction.values[0] });
      return await interaction.reply({ content: `<:positivo:1528401238197276702> Cargo padrão definido para <@&${interaction.values[0]}>.`, flags: 64 });
    }
    if (id === 'srt_sel_cfg_entrada_cargo') {
      const cfg = db.getSorteioConfig(interaction.guildId);
      const cargoId = interaction.values[0];
      const qtdAtual = cfg.entradaExtraCargoId === cargoId ? cfg.entradaExtraQtd : null;
      return await interaction.showModal(buildModalEntradaExtraQtd(cargoId, qtdAtual));
    }
  } catch (error) {
    await responderErroSorteio(interaction, error);
  }
}

async function handleModal(interaction) {
  try {
    const id = interaction.customId;

    if (id === 'srt_modal_criar_basico') return await processarModalCriarBasico(interaction);
    if (id === 'srt_modal_criar_avancado') return await processarModalCriarAvancado(interaction);
    if (id === 'srt_modal_cfg_texto') return await processarModalConfigTexto(interaction);
    if (id.startsWith('srt_modal_cfg_entrada_qtd_')) return await processarModalEntradaExtraQtd(interaction);
  } catch (error) {
    await responderErroSorteio(interaction, error);
  }
}

module.exports = {
  abrirPainelSorteios,
  painelSorteiosPayload,
  handleButton,
  handleSelectMenu,
  handleModal,
  encerrarSorteioAutomatico,
};
