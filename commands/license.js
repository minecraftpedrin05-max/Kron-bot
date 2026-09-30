const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const db = require("../database/db");
const licenseDb = require("../database/licenseDb");
const { BOT_OWNER_ID, CORES } = require("../config/constants");

// ═══════════════════════════════════════════════════════════════════
// PAINEL /license painel — reaproveita 100% a mesma base de dados
// (database/licenseDb.js). Não cria tabela nova, não duplica nada do
// /license add|remove|info acima.
// ═══════════════════════════════════════════════════════════════════
const POR_PAGINA = 5;

const STATUS_META = {
  em_uso:         { emoji: "🟢", label: "Em uso" },
  nao_utilizada:  { emoji: "🟡", label: "Não utilizada" },
  expirada:       { emoji: "⚫", label: "Expirada" },
  revogada:       { emoji: "🔴", label: "Revogada" },
};

function statusTexto(status) {
  const meta = STATUS_META[status] || { emoji: "❔", label: status };
  return `${meta.emoji} ${meta.label}`;
}

function fmtData(iso) {
  if (!iso) return "—";
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${ts}:d> (<t:${ts}:R>)`;
}

function fmtDuracao(row) {
  return row.dias > 0 ? `${row.dias} dia(s)` : "Vitalícia";
}

function fmtExpiracao(row) {
  if (row.status === "nao_utilizada") return "—";
  if (!row.licenca_expiry) return "Nunca (vitalícia)";
  return fmtData(row.licenca_expiry);
}

function buildPainelEmbed() {
  const s = licenseDb.getKeyStats();
  return new EmbedBuilder()
    .setColor(CORES.INFO)
    .setTitle("🔐 Painel de Licenças — KAEL")
    .addFields(
      { name: "Total de licenças", value: `\`${s.total}\``, inline: true },
      { name: `${STATUS_META.nao_utilizada.emoji} Não utilizadas`, value: `\`${s.naoUtilizadas}\``, inline: true },
      { name: `${STATUS_META.em_uso.emoji} Em uso`, value: `\`${s.emUso}\``, inline: true },
      { name: `${STATUS_META.expirada.emoji} Expiradas`, value: `\`${s.expiradas}\``, inline: true },
      { name: `${STATUS_META.revogada.emoji} Revogadas`, value: `\`${s.revogadas}\``, inline: true },
    )
    .setTimestamp();
}

function buildPainelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lic_listar_0").setLabel("Listar").setEmoji("<:embed:1528400492982571111>").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lic_buscar").setLabel("Buscar").setEmoji("🔍").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lic_revogar").setLabel("Revogar").setEmoji("🚫").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("lic_excluir").setLabel("Excluir").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("lic_atualizar").setLabel("Atualizar").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );
}

function buildPainelRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lic_add_massa").setLabel("Adicionar em Massa").setEmoji("➕").setStyle(ButtonStyle.Success),
  );
}

function campoLicenca(row) {
  return {
    name: `\`${row.chave}\``,
    value:
      `> Plano: **${row.tipo}**\n` +
      `> Duração: **${fmtDuracao(row)}**\n` +
      `> Criada em: ${fmtData(row.criada_em)}\n` +
      `> Status: ${statusTexto(row.status)}\n` +
      `> Servidor: ${row.guild_id ? `\`${row.guild_id}\`` : "—"}\n` +
      `> Ativada em: ${fmtData(row.usada_em)}\n` +
      `> Expira em: ${fmtExpiracao(row)}`,
    inline: false,
  };
}

function buildListaEmbed(pagina) {
  const todas = licenseDb.listKeysComStatus();
  const totalPaginas = Math.max(1, Math.ceil(todas.length / POR_PAGINA));
  pagina = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const inicio = pagina * POR_PAGINA;
  const pageRows = todas.slice(inicio, inicio + POR_PAGINA);

  const embed = new EmbedBuilder().setColor(CORES.INFO).setTitle("<:embed:1528400492982571111> Licenças Cadastradas")
    .setFooter({ text: `Página ${pagina + 1}/${totalPaginas} • ${todas.length} licença(s) no total` });

  if (pageRows.length === 0) embed.setDescription("> Nenhuma licença cadastrada ainda.");
  else embed.addFields(pageRows.map(campoLicenca));

  return { embed, pagina, totalPaginas };
}

function buildListaRow(pagina, totalPaginas) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lic_listar_${pagina - 1}`).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(pagina <= 0),
    new ButtonBuilder().setCustomId(`lic_listar_${pagina + 1}`).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPaginas - 1),
    new ButtonBuilder().setCustomId("lic_painel").setLabel("Voltar").setEmoji("<:voltar:1528548726518448198>").setStyle(ButtonStyle.Secondary),
  );
}

function buildVoltarRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lic_painel").setLabel("Voltar").setEmoji("<:voltar:1528548726518448198>").setStyle(ButtonStyle.Secondary),
  );
}

function modalChave(customId, titulo) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(titulo);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("chave").setLabel("CÓDIGO DA LICENÇA:").setStyle(TextInputStyle.Short).setRequired(true),
    ),
  );
  return modal;
}

function modalAdicionarMassa() {
  const modal = new ModalBuilder().setCustomId("lic_modal_add_massa").setTitle("Cadastrar Chaves em Massa");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("linhas").setLabel("1 LINHA = 1 CHAVE (texto livre):").setStyle(TextInputStyle.Paragraph).setRequired(true)
        .setPlaceholder("1mey\n2mey\n3mey"),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("tipo").setLabel("TIPO (FREE/BASICO/PRO/PREMIUM/PERMANENTE):").setStyle(TextInputStyle.Short).setRequired(true).setValue("PRO"),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("dias").setLabel("DIAS (0 = vitalícia):").setStyle(TextInputStyle.Short).setRequired(true).setValue("0"),
    ),
  );
  return modal;
}

async function bloquearSeNaoDono(interaction) {
  if (interaction.user.id === BOT_OWNER_ID) return false;
  const payload = {
    embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Sem Permissão").setDescription("> Apenas o dono do bot pode gerenciar licenças.")],
    flags: 64,
  };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
  else await interaction.reply(payload);
  return true;
}

async function handleButton(interaction) {
  if (await bloquearSeNaoDono(interaction)) return;
  const id = interaction.customId;

  if (id === "lic_painel" || id === "lic_atualizar") {
    return interaction.update({ embeds: [buildPainelEmbed()], components: [buildPainelRow(), buildPainelRow2()] });
  }

  if (id.startsWith("lic_listar_")) {
    const pagina = parseInt(id.replace("lic_listar_", ""), 10) || 0;
    const { embed, totalPaginas, pagina: paginaFinal } = buildListaEmbed(pagina);
    return interaction.update({ embeds: [embed], components: [buildListaRow(paginaFinal, totalPaginas)] });
  }

  if (id === "lic_buscar") return interaction.showModal(modalChave("lic_modal_buscar", "Buscar Licença"));
  if (id === "lic_revogar") return interaction.showModal(modalChave("lic_modal_revogar", "Revogar Licença"));
  if (id === "lic_excluir") return interaction.showModal(modalChave("lic_modal_excluir", "Excluir Licença"));
  if (id === "lic_add_massa") return interaction.showModal(modalAdicionarMassa());

  if (id.startsWith("lic_excluir_confirmar_")) {
    const chave = id.replace("lic_excluir_confirmar_", "");
    const registro = licenseDb.getKey(chave);
    if (!registro) {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Licença não encontrada").setDescription("> Ela pode já ter sido excluída.")],
        components: [buildVoltarRow()],
      });
    }
    licenseDb.deleteKey(chave);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(CORES.SUCESSO).setTitle("<:positivo:1528401238197276702> Licença excluída")
        .setDescription(`> A licença \`${chave}\` e qualquer vínculo com servidor foram removidos permanentemente.`)],
      components: [buildVoltarRow()],
    });
  }

  if (id === "lic_excluir_cancelar") {
    return interaction.update({ embeds: [buildPainelEmbed()], components: [buildPainelRow(), buildPainelRow2()] });
  }
}

async function handleModal(interaction) {
  if (await bloquearSeNaoDono(interaction)) return;
  const id = interaction.customId;

  if (id === "lic_modal_add_massa") {
    const bruto = interaction.fields.getTextInputValue("linhas");
    const tipo = interaction.fields.getTextInputValue("tipo").trim().toUpperCase();
    const diasTexto = interaction.fields.getTextInputValue("dias").trim();
    const dias = parseInt(diasTexto, 10);

    const TIPOS_VALIDOS = ["FREE", "BASICO", "PRO", "PREMIUM", "PERMANENTE"];
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Tipo inválido").setDescription(`> Use um destes: ${TIPOS_VALIDOS.join(", ")}.`)],
        flags: 64,
      });
    }
    if (!Number.isFinite(dias) || dias < 0) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Dias inválido").setDescription("> Informe um número (0 = vitalícia).")],
        flags: 64,
      });
    }

    // Uma linha = uma chave a gerar. O CONTEÚDO da linha não importa,
    // só a quantidade de linhas não-vazias.
    const linhas = bruto.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const quantidade = linhas.length;

    if (quantidade === 0) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Nenhuma linha informada").setDescription("> Cole pelo menos 1 linha (o texto de cada linha não importa, só a quantidade).")],
        flags: 64,
      });
    }
    const MAX_POR_VEZ = 30;
    if (quantidade > MAX_POR_VEZ) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Muitas linhas de uma vez").setDescription(`> Você colou **${quantidade}** linhas. O máximo por vez é **${MAX_POR_VEZ}** — rode o modal de novo pro restante.`)],
        flags: 64,
      });
    }

    const geradas = [];
    try {
      for (let i = 0; i < quantidade; i++) {
        const registro = licenseDb.addKey({ chave: null, tipo, dias, criadaPor: interaction.user.id });
        geradas.push(registro.chave);
      }
    } catch (e) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Erro no meio do cadastro em massa")
          .setDescription(`> Erro: ${e.message}\n> Chaves já cadastradas ANTES do erro (${geradas.length}): ${geradas.length ? geradas.join(", ") : "nenhuma"}`)],
        components: [buildVoltarRow()], flags: 64,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(CORES.SUCESSO)
      .setTitle("🔑 Chaves Geradas em Massa")
      .addFields(
        { name: "Linhas coladas", value: `\`${quantidade}\``, inline: true },
        { name: "Plano", value: tipo, inline: true },
        { name: "Duração", value: dias > 0 ? `${dias} dia(s)` : "Vitalícia", inline: true },
        { name: "Chaves geradas", value: geradas.map(c => `\`${c}\``).join("\n") },
      )
      .setDescription("O cliente deve usar `/ativar` no servidor dele e informar a chave correspondente.")
      .setTimestamp();

    return interaction.reply({ embeds: [embed], components: [buildVoltarRow()], flags: 64 });
  }

  const chaveInformada = interaction.fields.getTextInputValue("chave").trim().toUpperCase();

  if (id === "lic_modal_buscar") {
    const row = licenseDb.listKeysComStatus().find(k => k.chave === chaveInformada);
    if (!row) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Licença não encontrada").setDescription(`> Nenhuma licença com o código \`${chaveInformada}\`.`)],
        components: [buildVoltarRow()], flags: 64,
      });
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(CORES.INFO).setTitle(`🔍 Licença: ${row.chave}`).addFields(campoLicenca(row))],
      components: [buildVoltarRow()], flags: 64,
    });
  }

  if (id === "lic_modal_revogar") {
    const registro = licenseDb.getKey(chaveInformada);
    if (!registro) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Licença não encontrada").setDescription(`> Nenhuma licença com o código \`${chaveInformada}\`.`)],
        components: [buildVoltarRow()], flags: 64,
      });
    }
    if (registro.revogada) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.AVISO).setTitle("🔴 Já estava revogada").setDescription(`> A licença \`${registro.chave}\` já estava revogada.`)],
        components: [buildVoltarRow()], flags: 64,
      });
    }
    licenseDb.revokeKey(chaveInformada);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(CORES.SUCESSO).setTitle("🚫 Licença revogada")
        .setDescription(`> A licença \`${chaveInformada}\` foi revogada.\n> Se estava vinculada a um servidor, o acesso foi cortado imediatamente.`)],
      components: [buildVoltarRow()], flags: 64,
    });
  }

  if (id === "lic_modal_excluir") {
    const registro = licenseDb.getKey(chaveInformada);
    if (!registro) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Licença não encontrada").setDescription(`> Nenhuma licença com o código \`${chaveInformada}\`.`)],
        components: [buildVoltarRow()], flags: 64,
      });
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(CORES.AVISO).setTitle("⚠️ Confirmar exclusão")
        .setDescription(`> Tem certeza que deseja excluir permanentemente a licença \`${registro.chave}\`?\n> Essa ação não pode ser desfeita.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lic_excluir_confirmar_${registro.chave}`).setLabel("Sim, excluir").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("lic_excluir_cancelar").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
      )],
      flags: 64,
    });
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName("license").setDescription("Gerenciar licenças (dono do bot)")
    .addSubcommand(s => s.setName("add").setDescription("Cadastra uma nova chave de licença (usada em /ativar)")
      .addStringOption(o => o.setName("tipo").setDescription("Tipo").setRequired(true)
        .addChoices({ name: "FREE", value: "FREE" }, { name: "BASICO", value: "BASICO" }, { name: "PRO", value: "PRO" }, { name: "PREMIUM", value: "PREMIUM" }, { name: "PERMANENTE", value: "PERMANENTE" }))
      .addIntegerOption(o => o.setName("dias").setDescription("Duração da licença").setRequired(false)
        .addChoices(
          { name: "1 dia", value: 1 },
          { name: "3 dias", value: 3 },
          { name: "7 dias", value: 7 },
          { name: "30 dias", value: 30 },
          { name: "90 dias", value: 90 },
          { name: "Vitalícia", value: 0 },
        ))
      .addStringOption(o => o.setName("chave").setDescription("Chave customizada (opcional, gerada automaticamente se vazio)").setRequired(false)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a licença de um servidor")
      .addStringOption(o => o.setName("guild_id").setDescription("ID do servidor").setRequired(true)))
    .addSubcommand(s => s.setName("info").setDescription("Info da licença")
      .addStringOption(o => o.setName("guild_id").setDescription("ID do servidor").setRequired(false)))
    .addSubcommand(s => s.setName("painel").setDescription("Painel administrativo de licenças (estatísticas, listar, buscar, revogar, excluir)")),

  async execute(interaction) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Sem Permissão").setDescription("Apenas o dono do bot pode usar este comando.")], ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();

    // ── /license add ── cadastra uma CHAVE (não mais vinculada direto a um guild_id) ──
    if (sub === "add") {
      const tipo = interaction.options.getString("tipo");
      const dias = interaction.options.getInteger("dias") || 0;
      const chaveInformada = interaction.options.getString("chave");

      let registro;
      try {
        registro = licenseDb.addKey({ chave: chaveInformada, tipo, dias, criadaPor: interaction.user.id });
      } catch (e) {
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Erro ao cadastrar chave").setDescription(e.message)], ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(CORES.SUCESSO)
        .setTitle("🔑 Chave de Licença Cadastrada")
        .addFields(
          { name: "Chave", value: "`" + registro.chave + "`", inline: false },
          { name: "Plano", value: tipo, inline: true },
          { name: "Duração", value: dias > 0 ? `${dias} dia(s)` : "Vitalícia", inline: true },
        )
        .setDescription("O cliente deve usar `/ativar` no servidor dele e informar essa chave.")
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── /license remove ── revisado: remove a licença, libera a chave e limpa o vínculo ──
    if (sub === "remove") {
      const guildId = interaction.options.getString("guild_id");
      const licencaAtual = db.getLicense(guildId);

      if (!licencaAtual) {
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Nenhuma licença encontrada").setDescription("O servidor `" + guildId + "` não possui licença ativa para remover.")], ephemeral: true });
        return;
      }

      db.removeLicense(guildId); // remove vínculo guild_id + libera a chave para reutilização (licenseDb.removeLicense cuida disso)

      const embed = new EmbedBuilder()
        .setColor(CORES.ERRO)
        .setTitle("<:apagar:1524206738885050388> Licença Removida")
        .addFields(
          { name: "Servidor", value: "`" + guildId + "`", inline: true },
          { name: "Plano removido", value: licencaAtual.tipo || "?", inline: true },
        );
      if (licencaAtual.chave) {
        embed.addFields({ name: "Chave liberada", value: "`" + licencaAtual.chave + "` (disponível para reutilização)", inline: false });
      }
      embed.setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── /license info ── inalterado na lógica, apenas lendo da nova camada SQLite ──
    if (sub === "info") {
      const guildId = interaction.options.getString("guild_id") || interaction.guild.id;
      const license = db.getLicense(guildId);
      const ativa = db.hasLicense(guildId);
      const embed = new EmbedBuilder().setColor(ativa ? CORES.SUCESSO : CORES.ERRO).setTitle("🔐 Licença — " + guildId).addFields({ name: "Status", value: ativa ? "<:positivo:1528401238197276702> Ativa" : "<:negativo:1528400986744295475> Inativa", inline: true });
      if (license) {
        embed.addFields(
          { name: "Tipo", value: license.tipo || "?", inline: true },
          { name: "Ativado por", value: license.ativadoPor ? "<@" + license.ativadoPor + ">" : "—", inline: true },
          { name: "Expira em", value: license.expiry ? new Date(license.expiry).toLocaleDateString("pt-BR") : "Nunca", inline: true },
        );
        if (license.chave) embed.addFields({ name: "Chave", value: "`" + license.chave + "`", inline: true });
      }
      await interaction.reply({ embeds: [embed.setTimestamp()], ephemeral: true });
      return;
    }

    // ── /license painel ── painel administrativo (estatísticas + botões) ──
    if (sub === "painel") {
      await interaction.reply({ embeds: [buildPainelEmbed()], components: [buildPainelRow(), buildPainelRow2()], flags: 64 });
      return;
    }
  },

  handleButton,
  handleModal,
};
