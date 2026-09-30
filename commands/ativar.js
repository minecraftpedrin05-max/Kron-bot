const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const db = require("../database/db");
const licenseDb = require("../database/licenseDb");
const { BOT_OWNER_ID, CORES } = require("../config/constants");

function formatarData(iso) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function embedSolicitacao(request) {
  return new EmbedBuilder()
    .setColor(CORES.AVISO)
    .setTitle(" Nova Solicitação de Ativação")
    .addFields(
      { name: "Servidor", value: request.guild_name || "?", inline: true },
      { name: "ID do Servidor", value: "`" + request.guild_id + "`", inline: true },
      { name: "Solicitante", value: `<@${request.solicitante_id}> (\`${request.solicitante_id}\`)`, inline: false },
      { name: "Chave Informada", value: "`" + request.chave + "`", inline: false },
    )
    .setFooter({ text: `Solicitação #${request.id}` })
    .setTimestamp();
}

function linhaBotoes(requestId, desabilitado = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`license_ativar_${requestId}`).setLabel("Ativar").setEmoji("<:positivo:1528401238197276702>").setStyle(ButtonStyle.Success).setDisabled(desabilitado),
    new ButtonBuilder().setCustomId(`license_recusar_${requestId}`).setLabel("Recusar").setEmoji("<:negativo:1528400986744295475>").setStyle(ButtonStyle.Danger).setDisabled(desabilitado),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ativar")
    .setDescription("Ativa a licença deste servidor informando a chave recebida")
    .addStringOption(o => o.setName("chave").setDescription("Chave de licença").setRequired(true)),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Comando indisponível").setDescription("Use este comando dentro de um servidor.")], ephemeral: true });
      return;
    }

    const chave = interaction.options.getString("chave").trim().toUpperCase();

    if (db.hasLicense(guild.id)) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Este servidor já possui uma licença ativa").setDescription("Use `/license remove` (dono do bot) caso precise substituir a licença atual.")], ephemeral: true });
      return;
    }

    const pendente = licenseDb.getPendingRequestForGuild(guild.id);
    if (pendente) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.AVISO).setTitle("⏳ Já existe uma solicitação pendente").setDescription("Aguarde a análise do administrador antes de enviar uma nova chave.")], ephemeral: true });
      return;
    }

    const registroChave = licenseDb.getKey(chave);
    if (!registroChave) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Chave inválida").setDescription("Não encontramos nenhuma licença cadastrada com essa chave. Verifique e tente novamente.")], ephemeral: true });
      return;
    }
    // BUGFIX (auditoria licenças): faltava checar chave revogada aqui —
    // uma chave revogada pelo painel ainda podia ser submetida normalmente.
    if (registroChave.revogada) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Chave revogada").setDescription("Essa chave foi revogada e não pode mais ser utilizada. Entre em contato para receber uma nova.")], ephemeral: true });
      return;
    }
    if (registroChave.usada) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.ERRO).setTitle("<:negativo:1528400986744295475> Chave já utilizada").setDescription("Essa chave já foi utilizada em outro servidor. Entre em contato para receber uma nova.")], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const request = licenseDb.createActivationRequest({
      guildId: guild.id,
      guildName: guild.name,
      chave,
      solicitanteId: interaction.user.id,
      canalId: interaction.channel?.id,
    });

    // Envia a solicitação diretamente na DM do dono do bot, único autorizado a clicar nos botões.
    let dmEnviada = false;
    try {
      const owner = await interaction.client.users.fetch(BOT_OWNER_ID);
      const msg = await owner.send({ embeds: [embedSolicitacao(request)], components: [linhaBotoes(request.id)] });
      licenseDb.setRequestMessageId(request.id, msg.id);
      dmEnviada = true;
    } catch (e) {
      console.error("[/ativar] Falha ao enviar DM ao dono do bot:", e.message);
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(CORES.INFO)
        .setTitle(" Solicitação de Ativação Enviada")
        .setDescription(dmEnviada
          ? "Sua solicitação foi enviada para análise. Você será avisado por aqui assim que ela for respondida."
          : "Sua solicitação foi registrada, mas não foi possível notificar o administrador automaticamente. Entre em contato com o suporte informando o ID: `" + request.id + "`.")
        .addFields({ name: "Chave", value: "`" + chave + "`", inline: true }),
      ],
    });
  },

  // ─────────────────────────────────────────────────────────────
  // BOTÕES: <:positivo:1528401238197276702> Ativar / <:negativo:1528400986744295475> Recusar (apenas BOT_OWNER_ID)
  // ─────────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [, acao, idStr] = interaction.customId.split("_"); // license_ativar_<id> / license_recusar_<id>
    const requestId = Number(idStr);

    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({ content: "<:negativo:1528400986744295475> Apenas administradores autorizados podem responder a esta solicitação.", ephemeral: true });
      return;
    }

    const request = licenseDb.getActivationRequest(requestId);
    if (!request) {
      await interaction.reply({ content: "<:negativo:1528400986744295475> Solicitação não encontrada (pode já ter sido processada).", ephemeral: true });
      return;
    }
    if (request.status !== "pendente") {
      await interaction.reply({ content: `⚠️ Esta solicitação já foi ${request.status === "ativada" ? "ativada" : "recusada"} anteriormente.`, ephemeral: true });
      return;
    }

    if (acao === "recusar") {
      const modal = new ModalBuilder()
        .setCustomId(`license_modal_recusar_${requestId}`)
        .setTitle("Recusar Ativação")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("motivo")
              .setLabel("Motivo da recusa")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("Ex: chave inválida, pagamento não confirmado...")
              .setMaxLength(300)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    if (acao === "ativar") {
      await interaction.deferUpdate();
      return module.exports._processarAtivacao(interaction, request);
    }
  },

  // ─────────────────────────────────────────────────────────────
  // MODAL: motivo da recusa
  // ─────────────────────────────────────────────────────────────
  async handleModal(interaction) {
    const idStr = interaction.customId.replace("license_modal_recusar_", "");
    const requestId = Number(idStr);
    const request = licenseDb.getActivationRequest(requestId);
    const motivo = interaction.fields.getTextInputValue("motivo");

    if (!request || request.status !== "pendente") {
      await interaction.reply({ content: "⚠️ Esta solicitação não está mais pendente.", ephemeral: true });
      return;
    }

    licenseDb.resolveActivationRequest(requestId, { status: "recusada", resolvidaPor: interaction.user.id, motivo });

    const embedRecusado = embedSolicitacao(request)
      .setColor(CORES.ERRO)
      .setTitle("<:negativo:1528400986744295475> Solicitação Recusada")
      .addFields({ name: "Motivo", value: motivo });
    try { await interaction.update({ embeds: [embedRecusado], components: [linhaBotoes(requestId, true)] }); }
    catch (e) { await interaction.message?.edit?.({ embeds: [embedRecusado], components: [linhaBotoes(requestId, true)] }).catch(() => {}); }

    try {
      const solicitante = await interaction.client.users.fetch(request.solicitante_id);
      await solicitante.send({ embeds: [new EmbedBuilder()
        .setColor(CORES.ERRO)
        .setTitle("<:negativo:1528400986744295475> Sua solicitação de ativação foi recusada")
        .addFields(
          { name: "Servidor", value: request.guild_name || request.guild_id, inline: true },
          { name: "Motivo", value: motivo, inline: false },
        )
        .setTimestamp(),
      ] });
    } catch (e) { /* cliente pode estar com DMs fechadas */ }

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "<:negativo:1528400986744295475> Solicitação recusada e cliente notificado.", ephemeral: true });
    }
  },

  // ─────────────────────────────────────────────────────────────
  // Lógica de ativação (compartilhada pelo clique em "Ativar")
  // ─────────────────────────────────────────────────────────────
  async _processarAtivacao(interaction, request) {
    const registroChave = licenseDb.getKey(request.chave);

    if (!registroChave) {
      await interaction.followUp({ content: "<:negativo:1528400986744295475> A chave associada a esta solicitação não existe mais.", ephemeral: true });
      return;
    }
    // BUGFIX (auditoria licenças): faltava essa checagem aqui — se a chave
    // fosse revogada DEPOIS que a solicitação de /ativar já tinha sido
    // criada, clicar em "Ativar" mesmo assim concedia a licença normalmente,
    // ignorando a revogação por completo.
    if (registroChave.revogada) {
      licenseDb.resolveActivationRequest(request.id, { status: "recusada", resolvidaPor: interaction.user.id, motivo: "Chave revogada antes da aprovação." });
      await interaction.followUp({ content: "<:negativo:1528400986744295475> Essa chave foi revogada — solicitação cancelada automaticamente.", ephemeral: true });
      return;
    }
    if (registroChave.usada) {
      await interaction.followUp({ content: "<:negativo:1528400986744295475> Essa chave já foi utilizada em outro servidor.", ephemeral: true });
      return;
    }

    // BUGFIX (auditoria licenças): a chave agora é "reivindicada" de forma
    // ATÔMICA antes de qualquer outra coisa. Se duas aprovações da mesma
    // chave acontecerem em paralelo (ex: duas solicitações de servidores
    // diferentes com a mesma chave, ambas aprovadas quase ao mesmo tempo),
    // só a primeira consegue o claim — a segunda para aqui, sem nunca criar
    // uma licença "fantasma". Isso também garante que nenhuma etapa deixa a
    // licença parcialmente ativada: ou a chave é reivindicada E a licença é
    // criada, ou nada acontece.
    const reivindicada = licenseDb.markKeyUsed(registroChave.chave, request.guild_id);
    if (!reivindicada) {
      await interaction.followUp({ content: "<:negativo:1528400986744295475> Essa chave acabou de ser utilizada em outro servidor (corrida evitada). Nenhuma licença duplicada foi criada.", ephemeral: true });
      return;
    }

    const agora = new Date();
    const dias = registroChave.dias || 0;
    const expiry = dias > 0 ? new Date(agora.getTime() + dias * 86400000).toISOString() : null;

    // Chave já reivindicada com sucesso acima — agora sim vincula a licença ao guild.id.
    db.setLicense(request.guild_id, {
      tipo: registroChave.tipo,
      chave: registroChave.chave,
      ativadoPor: interaction.user.id,
      ativadoEm: agora.toISOString(),
      expiry,
      dias: dias || "permanente",
    });
    licenseDb.resolveActivationRequest(request.id, { status: "ativada", resolvidaPor: interaction.user.id });

    // Espera o backup terminar de subir ANTES de confirmar a ativação pro
    // admin — mesma lógica já aplicada na venda (sales-system/salesManager.js).
    // Fecha a janela de risco de reiniciar o bot logo após ativar uma
    // licença e ela "voltar" pra não-ativada num restart em hospedagem sem
    // disco persistente.
    try { await require('../database/backupSqlite').fazerBackupAgora(interaction.client, 'licença ativada'); } catch (e) { /* nunca deve travar a ativação */ }

    const embedAtivado = new EmbedBuilder()
      .setColor(CORES.SUCESSO)
      .setTitle("<:positivo:1528401238197276702> Licença ativada com sucesso")
      .addFields(
        { name: "Plano", value: registroChave.tipo, inline: true },
        { name: "Servidor", value: request.guild_name || "?", inline: true },
        { name: "ID do Servidor", value: "`" + request.guild_id + "`", inline: true },
        { name: "Ativada por", value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: false },
        { name: "Data da ativação", value: formatarData(agora.toISOString()), inline: true },
        { name: "Vencimento", value: expiry ? formatarData(expiry) : "Vitalícia", inline: true },
      )
      .setFooter({ text: `Solicitação #${request.id}` })
      .setTimestamp();

    try { await interaction.editReply({ embeds: [embedAtivado], components: [linhaBotoes(request.id, true)] }); }
    catch (e) { await interaction.message?.edit?.({ embeds: [embedAtivado], components: [linhaBotoes(request.id, true)] }).catch(() => {}); }

    try {
      const solicitante = await interaction.client.users.fetch(request.solicitante_id);
      await solicitante.send({ embeds: [embedAtivado] });
    } catch (e) { /* cliente pode estar com DMs fechadas */ }
  },
};
