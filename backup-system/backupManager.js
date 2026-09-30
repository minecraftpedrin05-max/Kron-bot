// ═══════════════════════════════════════════════════════════════════════════
//  backupManager.js — Sistema de Backup & Restauração de Servidor
//  (Components V2, Discord.js v14) — módulo NOVO e independente.
// ═══════════════════════════════════════════════════════════════════════════
//
//  Captura um snapshot de: cargos, categorias, canais (com overwrites de
//  CARGO — overwrites de membro específico não são portáveis e por isso
//  não são capturados), e emojis customizados. NÃO captura histórico de
//  mensagens (custo/risco alto, pouco valor para reconstrução estrutural).
//
//  Restauração é sempre em modo ADITIVO: cria o que estiver faltando
//  (comparando por nome), nunca apaga ou substitui o que já existe no
//  servidor no momento da restauração. Isso evita perda de dados em uma
//  restauração acidental.
//
//  Seções deste arquivo:
//    1. Imports & DB
//    2. Constantes / utilitários
//    3. Captura de snapshot (leitura do servidor ao vivo)
//    4. Restauração (recriação no servidor)
//    5. Builders de container (Components V2)
//    6. handleButton / handleSelectMenu / handleModal
//    7. Exports
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  1. IMPORTS & DB
// ─────────────────────────────────────────────────────────────
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db = require('../database/db');

// ─────────────────────────────────────────────────────────────
//  2. CONSTANTES / UTILITÁRIOS
// ─────────────────────────────────────────────────────────────
const COR = {
  SUCCESS: 0x57F287,
  DANGER : 0xED4245,
  GOLD   : 0xFFD700,
};

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

function botaoVoltar() {
  return new ButtonBuilder().setCustomId('bkp_painel_voltar').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary);
}

function tsRelativo(iso) {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

// ─────────────────────────────────────────────────────────────
//  3. CAPTURA DE SNAPSHOT
// ─────────────────────────────────────────────────────────────

/** Guarda só os overwrites de CARGO (type 0) de um canal, pelo NOME do cargo. */
function capturarOverwrites(channel) {
  // BUGFIX: threads (e alguns outros tipos) não têm permissionOverwrites
  // — acessar .cache neles quebrava com "Cannot read properties of
  // undefined (reading 'cache')". Agora é defensivo.
  if (!channel.permissionOverwrites?.cache) return [];
  return channel.permissionOverwrites.cache
    .filter(o => o.type === 0)
    .map(o => {
      const cargo = channel.guild?.roles?.cache?.get(o.id);
      if (!cargo) return null;
      return { cargoNome: cargo.name, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() };
    })
    .filter(Boolean);
}

// Tipos de canal que realmente fazem sentido num backup de estrutura de
// servidor (exclui threads e qualquer tipo sem permissionOverwrites).
const TIPOS_CANAL_BACKUP = [
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia,
].filter(t => t !== undefined);

async function capturarSnapshot(guild) {
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position) // do topo pra base, pra recriar na mesma ordem
    .map(r => ({
      nome: r.name,
      cor: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
    }));

  const categorias = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map(c => ({ nome: c.name, overwrites: capturarOverwrites(c) }));

  const canais = guild.channels.cache
    .filter(c => TIPOS_CANAL_BACKUP.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map(c => ({
      nome: c.name,
      tipo: c.type,
      categoriaNome: c.parent ? c.parent.name : null,
      topico: ('topic' in c) ? (c.topic || null) : null,
      nsfw: c.nsfw || false,
      overwrites: capturarOverwrites(c),
    }));

  const emojis = guild.emojis.cache.map(e => ({
    nome: e.name,
    url: e.imageURL({ extension: e.animated ? 'gif' : 'png' }),
  }));

  return {
    guildNomeOriginal: guild.name,
    criadoPor: null, // preenchido por quem chamar (id do admin)
    totalCargos: roles.length,
    totalCategorias: categorias.length,
    totalCanais: canais.length,
    totalEmojis: emojis.length,
    roles, categorias, canais, emojis,
  };
}

// ─────────────────────────────────────────────────────────────
//  4. RESTAURAÇÃO
// ─────────────────────────────────────────────────────────────

function construirOverwrites(overwrites, nomeParaRoleId, guild) {
  const lista = [];
  for (const o of (overwrites || [])) {
    const roleId = nomeParaRoleId.get(o.cargoNome) || guild.roles.cache.find(r => r.name === o.cargoNome)?.id;
    if (!roleId) continue;
    lista.push({ id: roleId, allow: BigInt(o.allow || '0'), deny: BigInt(o.deny || '0') });
  }
  return lista;
}

/**
 * Restaura um snapshot no servidor em modo ADITIVO: se já existe um
 * cargo/categoria/canal/emoji com o mesmo nome, PULA (não duplica, não
 * substitui). Retorna um resumo do que foi criado + eventuais erros.
 */
async function restaurarSnapshot(guild, snapshot) {
  const resultado = { cargosCriados: 0, categoriasCriadas: 0, canaisCriados: 0, emojisCriados: 0, erros: [] };
  const nomeParaRoleId = new Map();
  const nomeParaCategoriaId = new Map();

  // 1) Cargos (do topo pra base, preserva hierarquia aproximada)
  for (const r of (snapshot.roles || [])) {
    try {
      const existente = guild.roles.cache.find(x => x.name === r.nome);
      if (existente) { nomeParaRoleId.set(r.nome, existente.id); continue; }
      const novo = await guild.roles.create({
        name: r.nome,
        color: r.cor || undefined,
        hoist: !!r.hoist,
        mentionable: !!r.mentionable,
        permissions: BigInt(r.permissions || '0'),
        reason: 'Restauração de backup — KAEL',
      });
      nomeParaRoleId.set(r.nome, novo.id);
      resultado.cargosCriados++;
    } catch (e) { resultado.erros.push(`Cargo "${r.nome}": ${e.message}`); }
  }

  // 2) Categorias
  for (const c of (snapshot.categorias || [])) {
    try {
      const existente = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name === c.nome);
      if (existente) { nomeParaCategoriaId.set(c.nome, existente.id); continue; }
      const overwrites = construirOverwrites(c.overwrites, nomeParaRoleId, guild);
      const nova = await guild.channels.create({
        name: c.nome, type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: 'Restauração de backup — KAEL',
      });
      nomeParaCategoriaId.set(c.nome, nova.id);
      resultado.categoriasCriadas++;
    } catch (e) { resultado.erros.push(`Categoria "${c.nome}": ${e.message}`); }
  }

  // 3) Canais
  for (const c of (snapshot.canais || [])) {
    try {
      const jaExiste = guild.channels.cache.some(x => x.name === c.nome && x.type === c.tipo);
      if (jaExiste) continue;
      const overwrites = construirOverwrites(c.overwrites, nomeParaRoleId, guild);
      const parentId = c.categoriaNome ? nomeParaCategoriaId.get(c.categoriaNome) : null;
      await guild.channels.create({
        name: c.nome,
        type: c.tipo,
        parent: parentId || undefined,
        topic: c.topico || undefined,
        nsfw: c.nsfw || false,
        permissionOverwrites: overwrites,
        reason: 'Restauração de backup — KAEL',
      });
      resultado.canaisCriados++;
    } catch (e) { resultado.erros.push(`Canal "${c.nome}": ${e.message}`); }
  }

  // 4) Emojis (ignora se já existir um com o mesmo nome, ou se o servidor
  // já atingiu o limite de slots de emoji — erro é só registrado, não trava o resto)
  for (const e of (snapshot.emojis || [])) {
    try {
      if (guild.emojis.cache.some(x => x.name === e.nome)) continue;
      await guild.emojis.create({ attachment: e.url, name: e.nome, reason: 'Restauração de backup — KAEL' });
      resultado.emojisCriados++;
    } catch (e2) { resultado.erros.push(`Emoji "${e.nome}": ${e2.message}`); }
  }

  return resultado;
}

// ─────────────────────────────────────────────────────────────
//  5. BUILDERS DE CONTAINER (Components V2)
// ─────────────────────────────────────────────────────────────

function buildPainelContainer(guild, statusMsg = null) {
  const state = db.getBackupState(guild.id);
  const totalSnapshots = (state.snapshots || []).length;
  const totalTemplates = Object.keys(state.templates || {}).length;
  const ultimo = (state.snapshots || [])[state.snapshots.length - 1];

  const container = new ContainerBuilder().setAccentColor(COR.GOLD);

  if (statusMsg) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusMsg));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## <:save:1533080403810713773> Backup & Restauração do Servidor\n` +
      `> Salva canais, categorias, cargos, permissões e emojis para reconstruir o servidor ` +
      `rapidamente em caso de nuke, raid ou exclusão acidental. A restauração nunca apaga nada — só cria o que faltar.`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**<:import1:1533080710544625684> Snapshots salvos:** \`${totalSnapshots}/5\`\n` +
      `**<:block:1533259816871657522> Templates salvos:** \`${totalTemplates}\`\n` +
      `**<:clock:1524207889441357917> Último snapshot:** ${ultimo ? tsRelativo(ultimo.criadoEm) : 'Nenhum ainda'}`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bkp_criar_snapshot').setLabel('Criar Backup Agora').setEmoji('<:import1:1533080710544625684>').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('bkp_modal_template').setLabel('Salvar como Template').setEmoji('<:block:1533259816871657522>').setStyle(ButtonStyle.Primary),
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bkp_listar_snapshots').setLabel('Ver Snapshots').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('bkp_listar_templates').setLabel('Ver Templates').setEmoji('<:folder:1533259504936816641>').setStyle(ButtonStyle.Secondary),
    )
  );

  return container;
}

function buildListaContainer(itens, tipo) {
  // tipo: 'snapshot' | 'template'
  const container = new ContainerBuilder().setAccentColor(COR.GOLD);
  if (itens.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      tipo === 'snapshot' ? '> Nenhum snapshot salvo ainda.' : '> Nenhum template salvo ainda.'
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
    return container;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    tipo === 'snapshot' ? '## <:embed:1528400492982571111> Snapshots Salvos\n> Selecione um para ver detalhes, restaurar ou apagar.'
                        : '## <:folder:1533259504936816641> Templates Salvos\n> Selecione um para ver detalhes, restaurar ou apagar.'
  ));

  const select = new StringSelectMenuBuilder()
    .setCustomId(tipo === 'snapshot' ? 'bkp_sel_snapshot' : 'bkp_sel_template')
    .setPlaceholder('Selecione um item...')
    .addOptions(itens.slice(0, 25).map(item => ({
      label: (item.nome ? `${item.nome}` : `Snapshot de ${new Date(item.criadoEm).toLocaleDateString('pt-BR')}`).slice(0, 100),
      description: `${item.totalCanais} canais • ${item.totalCargos} cargos • ${item.totalEmojis} emojis`.slice(0, 100),
      value: item.id,
    })));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
  return container;
}

function buildDetalheContainer(item, tipo) {
  const idOuNome = item.id;
  const container = new ContainerBuilder()
    .setAccentColor(COR.GOLD)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${tipo === 'snapshot' ? '<:import1:1533080710544625684>' : '<:block:1533259816871657522>'} ${item.nome || 'Snapshot'}\n` +
      `**Criado em:** ${tsRelativo(item.criadoEm)}\n` +
      `**Servidor original:** \`${item.guildNomeOriginal}\`\n\n` +
      `**Cargos:** \`${item.totalCargos}\`\n` +
      `**Categorias:** \`${item.totalCategorias}\`\n` +
      `**Canais:** \`${item.totalCanais}\`\n` +
      `**Emojis:** \`${item.totalEmojis}\`\n\n` +
      `⚠️ A restauração é **aditiva** — recria apenas o que não existir mais no servidor (comparando pelo nome). Nada é apagado ou substituído.`
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp_confirmar_restaurar_${tipo}_${idOuNome}`).setLabel('Restaurar').setEmoji('♻️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bkp_apagar_${tipo}_${idOuNome}`).setLabel('Apagar').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
        botaoVoltar(),
      )
    );
  return container;
}

function buildConfirmarContainer(item, tipo) {
  const idOuNome = item.id;
  return new ContainerBuilder()
    .setAccentColor(COR.DANGER)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ⚠️ Confirmar Restauração\n` +
      `Isso vai criar no servidor **tudo que estiver faltando** de:\n` +
      `\`${item.totalCargos}\` cargos, \`${item.totalCategorias}\` categorias, \`${item.totalCanais}\` canais e \`${item.totalEmojis}\` emojis.\n\n` +
      `Nada existente será apagado ou sobrescrito. Isso pode levar alguns segundos. Confirmar?`
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp_executar_restaurar_${tipo}_${idOuNome}`).setLabel('Sim, restaurar').setEmoji('♻️').setStyle(ButtonStyle.Danger),
        botaoVoltar(),
      )
    );
}

// ─────────────────────────────────────────────────────────────
//  6. HANDLERS
// ─────────────────────────────────────────────────────────────

async function showAdminPanel(interaction) {
  await interaction.reply({
    components: [buildPainelContainer(interaction.guild)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function criarSnapshotAgora(interaction) {
  await interaction.deferUpdate();
  try {
    const snapshot = await capturarSnapshot(interaction.guild);
    const registro = db.salvarSnapshot(interaction.guildId, { ...snapshot, criadoPor: interaction.user.id });
    await interaction.editReply({
      components: [buildPainelContainer(interaction.guild,
        `<:positivo:1528401238197276702> Snapshot criado! (\`${registro.totalCanais}\` canais, \`${registro.totalCargos}\` cargos, \`${registro.totalEmojis}\` emojis)`)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  } catch (e) {
    console.error('[Backup] Erro ao criar snapshot:', e.message);
    await interaction.editReply(errContainer(`<:negativo:1528400986744295475> Erro ao criar snapshot: ${e.message}`));
  }
}

async function abrirModalTemplate(interaction) {
  const modal = new ModalBuilder().setCustomId('bkp_modal_input_template').setTitle('Salvar como Template');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('nome').setLabel('Nome do template').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)
    )
  );
  return interaction.showModal(modal);
}

async function salvarTemplateSubmit(interaction) {
  const nome = interaction.fields.getTextInputValue('nome').trim().slice(0, 80);
  if (!nome) return interaction.reply(errContainer('<:negativo:1528400986744295475> Nome inválido.'));
  await interaction.deferUpdate();
  try {
    const snapshot = await capturarSnapshot(interaction.guild);
    db.salvarTemplate(interaction.guildId, nome, { ...snapshot, criadoPor: interaction.user.id });
    await interaction.editReply({
      components: [buildPainelContainer(interaction.guild, `<:positivo:1528401238197276702> Template **"${nome}"** salvo com sucesso!`)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  } catch (e) {
    console.error('[Backup] Erro ao salvar template:', e.message);
    await interaction.editReply(errContainer(`<:negativo:1528400986744295475> Erro ao salvar template: ${e.message}`));
  }
}

async function listarSnapshots(interaction) {
  const itens = db.getSnapshots(interaction.guildId).slice().reverse();
  return interaction.update({ components: [buildListaContainer(itens, 'snapshot')], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function listarTemplates(interaction) {
  const itens = Object.values(db.getTemplates(interaction.guildId));
  return interaction.update({ components: [buildListaContainer(itens, 'template')], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function handleSelectMenu(interaction) {
  const tipo = interaction.customId === 'bkp_sel_snapshot' ? 'snapshot' : 'template';
  const valor = interaction.values[0];
  const item = tipo === 'snapshot' ? db.getSnapshotPorId(interaction.guildId, valor) : db.getTemplatePorId(interaction.guildId, valor);
  if (!item) return interaction.update(errContainer('<:negativo:1528400986744295475> Este item não existe mais.'));
  return interaction.update({ components: [buildDetalheContainer(item, tipo)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'bkp_painel_voltar') {
    return interaction.update({ components: [buildPainelContainer(interaction.guild)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  if (customId === 'bkp_criar_snapshot')    return criarSnapshotAgora(interaction);
  if (customId === 'bkp_modal_template')    return abrirModalTemplate(interaction);
  if (customId === 'bkp_listar_snapshots')  return listarSnapshots(interaction);
  if (customId === 'bkp_listar_templates')  return listarTemplates(interaction);

  // bkp_confirmar_restaurar_<tipo>_<idOuNome> / bkp_executar_restaurar_<tipo>_<idOuNome> / bkp_apagar_<tipo>_<idOuNome>
  if (customId.startsWith('bkp_confirmar_restaurar_')) {
    const resto = customId.replace('bkp_confirmar_restaurar_', '');
    const tipo = resto.startsWith('snapshot_') ? 'snapshot' : 'template';
    const idOuNome = resto.replace(`${tipo}_`, '');
    const item = tipo === 'snapshot' ? db.getSnapshotPorId(interaction.guildId, idOuNome) : db.getTemplatePorId(interaction.guildId, idOuNome);
    if (!item) return interaction.update(errContainer('<:negativo:1528400986744295475> Este item não existe mais.'));
    return interaction.update({ components: [buildConfirmarContainer(item, tipo)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }

  if (customId.startsWith('bkp_executar_restaurar_')) {
    const resto = customId.replace('bkp_executar_restaurar_', '');
    const tipo = resto.startsWith('snapshot_') ? 'snapshot' : 'template';
    const idOuNome = resto.replace(`${tipo}_`, '');
    const item = tipo === 'snapshot' ? db.getSnapshotPorId(interaction.guildId, idOuNome) : db.getTemplatePorId(interaction.guildId, idOuNome);
    if (!item) return interaction.update(errContainer('<:negativo:1528400986744295475> Este item não existe mais.'));
    await interaction.deferUpdate();
    try {
      const resultado = await restaurarSnapshot(interaction.guild, item);
      const resumo =
        `## <:positivo:1528401238197276702> Restauração concluída\n` +
        `**Cargos criados:** \`${resultado.cargosCriados}\`\n` +
        `**Categorias criadas:** \`${resultado.categoriasCriadas}\`\n` +
        `**Canais criados:** \`${resultado.canaisCriados}\`\n` +
        `**Emojis criados:** \`${resultado.emojisCriados}\`` +
        (resultado.erros.length ? `\n\n⚠️ **${resultado.erros.length} erro(s):**\n\`\`\`\n${resultado.erros.slice(0, 8).join('\n')}\n\`\`\`` : '');
      const container = new ContainerBuilder()
        .setAccentColor(resultado.erros.length ? COR.DANGER : COR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(resumo))
        .addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
      await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    } catch (e) {
      console.error('[Backup] Erro ao restaurar:', e.message);
      await interaction.editReply(errContainer(`<:negativo:1528400986744295475> Erro ao restaurar: ${e.message}`));
    }
    return;
  }

  if (customId.startsWith('bkp_apagar_')) {
    const resto = customId.replace('bkp_apagar_', '');
    const tipo = resto.startsWith('snapshot_') ? 'snapshot' : 'template';
    const idOuNome = resto.replace(`${tipo}_`, '');
    if (tipo === 'snapshot') {
      db.removerSnapshot(interaction.guildId, idOuNome);
    } else {
      // Templates são armazenados por NOME, mas o customId carrega o ID
      // (curto, pra nunca estourar o limite de 100 caracteres do
      // Discord) — busca o item pelo ID pra descobrir o nome real antes
      // de remover.
      const template = db.getTemplatePorId(interaction.guildId, idOuNome);
      if (template) db.removerTemplate(interaction.guildId, template.nome);
    }
    return interaction.update({
      components: [buildPainelContainer(interaction.guild, `<:apagar:1524206738885050388> ${tipo === 'snapshot' ? 'Snapshot' : 'Template'} removido.`)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }
}

async function handleModal(interaction) {
  if (interaction.customId === 'bkp_modal_input_template') return salvarTemplateSubmit(interaction);
}

// ─────────────────────────────────────────────────────────────
//  7. EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  showAdminPanel,
  handleButton,
  handleSelectMenu,
  handleModal,
  // Exportado para reuso futuro (ex.: gatilho automático de snapshot
  // antes de ações de risco em outro sistema), sem duplicar a lógica.
  capturarSnapshot,
  restaurarSnapshot,
};
