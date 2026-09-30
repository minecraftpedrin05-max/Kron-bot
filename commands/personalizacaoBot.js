
/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Personalização do Bot por Servidor
 *  Acionado por: botão 'painel_personalizacao' no /painel
 *
 *  Usa a rota "Modify Current Member" da API do Discord, liberada
 *  pra bots em 10/09/2025:
 *
 *    PATCH /guilds/{guild.id}/members/@me
 *    body: { nick, avatar, banner, bio }
 *
 *  Isso é DIFERENTE de PATCH /users/@me (perfil global do bot, o
 *  mesmo em todo lugar). Aqui cada servidor tem seu próprio nome
 *  (apelido), avatar, banner e bio do bot, sem afetar os outros
 *  servidores.
 *
 *  Guardamos só as URLs usadas (loja.personalizacaoBot) pra exibir
 *  no painel — a imagem em si só existe no perfil do Discord, o bot
 *  não guarda o arquivo.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('../database/db');

const EMOJI_POSITIVO = '<:positivo:1528401238197276702>';
const EMOJI_NEGATIVO = '<:negativo:1528400986744295475>';

const TAMANHO_MAX_IMAGEM = 10 * 1024 * 1024; // 10MB, mesmo limite do Discord pra avatar/banner

// ── Helpers do banco ─────────────────────────────────────────────

function getConfig(guildId) {
  const cfg = db.getGuild(guildId).loja?.personalizacaoBot || {};
  return {
    nick: cfg.nick || null,
    avatarUrl: cfg.avatarUrl || null,
    bannerUrl: cfg.bannerUrl || null,
    bio: cfg.bio || null,
    atualizadoEm: cfg.atualizadoEm || null,
  };
}

function saveConfig(guildId, cfg) {
  db.updateGuild(guildId, 'loja.personalizacaoBot', cfg);
}

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

// ── Buscar imagem e converter pra data URI (formato exigido pela API) ──

async function baixarComoDataUri(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(`Não consegui baixar a imagem (HTTP ${resposta.status}).`);
  }

  const contentType = resposta.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error('O link não aponta pra uma imagem válida.');
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.length > TAMANHO_MAX_IMAGEM) {
    throw new Error('A imagem passa de 10MB, que é o limite do Discord.');
  }

  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

// ── Painel principal ────────────────────────────────────────────

function buildEmbed(interaction) {
  const cfg = getConfig(interaction.guildId);

  const nickTexto   = cfg.nick      ? `${EMOJI_POSITIVO} \`${cfg.nick}\``  : `${EMOJI_NEGATIVO} \`Não configurado\``;
  const avatarTexto = cfg.avatarUrl ? `${EMOJI_POSITIVO} \`Configurado\`` : `${EMOJI_NEGATIVO} \`Não configurado\``;
  const bannerTexto = cfg.bannerUrl ? `${EMOJI_POSITIVO} \`Configurado\`` : `${EMOJI_NEGATIVO} \`Não configurado\``;
  const bioTexto    = cfg.bio       ? `${EMOJI_POSITIVO} \`Configurada\``  : `${EMOJI_NEGATIVO} \`Não configurada\``;

  return new EmbedBuilder()
    .setTitle('Personalização do Bot Neste Servidor')
    .setDescription(
      'Aqui você define nome, avatar, banner e bio do bot **só pra este servidor**' +
      ' — outros servidores onde o bot está não são afetados.\n' +
      'Isso usa o perfil de membro do bot (recurso liberado pelo Discord em ' +
      'setembro de 2025), não o perfil global dele.'
    )
    .setColor(0x00FFFF)
    .setTimestamp()
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined })
    .addFields(
      { name: 'Nome Neste Servidor', value: nickTexto, inline: true },
      { name: 'Avatar Neste Servidor', value: avatarTexto, inline: true },
      { name: 'Banner Neste Servidor', value: bannerTexto, inline: true },
      { name: 'Bio Neste Servidor', value: bioTexto, inline: true },
    );
}

function buildComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('PB_Editar').setLabel('Editar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('PB_Remover').setLabel('Remover Tudo').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('PB_Voltar_Painel').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function abrirPersonalizacao(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;
  const payload = {
    content: null,
    embeds: [buildEmbed(interaction)],
    components: buildComponents(),
    flags: 64,
  };
  // Vindo do botão 'painel_personalizacao': a mensagem atual é o /painel em
  // Components V2, que não pode ser editada com content/embeds via
  // interaction.update() — só aceita "components". Por isso abrimos uma
  // mensagem ephemeral NOVA (mesmo padrão de abrirBoasVindas/abrirDefinicoes).
  if (interaction.customId === 'painel_personalizacao') {
    await interaction.reply(payload);
  } else {
    await interaction.update(payload);
  }
}

// ── Modal de edição ─────────────────────────────────────────────

function modalEditar(interaction) {
  const cfg = getConfig(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('PB_Modal_Editar').setTitle('Personalizar Bot Neste Servidor');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nick')
        .setLabel('Nome do bot neste servidor (branco p/ manter)')
        .setPlaceholder('Ex: KAEL')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.nick || '')
        .setRequired(false)
        .setMaxLength(32),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('avatarUrl')
        .setLabel('URL do avatar (deixe em branco p/ manter)')
        .setPlaceholder('https://...')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.avatarUrl || '')
        .setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bannerUrl')
        .setLabel('URL do banner (deixe em branco p/ manter)')
        .setPlaceholder('https://...')
        .setStyle(TextInputStyle.Short)
        .setValue(cfg.bannerUrl || '')
        .setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bio')
        .setLabel('Bio (deixe em branco p/ manter)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(cfg.bio || '')
        .setRequired(false)
        .setMaxLength(190),
    ),
  );
  return modal;
}

async function handleModalEditar(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;

  const nick      = interaction.fields.getTextInputValue('nick').trim();
  const avatarUrl = interaction.fields.getTextInputValue('avatarUrl').trim();
  const bannerUrl = interaction.fields.getTextInputValue('bannerUrl').trim();
  const bio       = interaction.fields.getTextInputValue('bio').trim();

  try {
    await interaction.deferUpdate();
  } catch (e) {
    // Se nem o deferUpdate foi aceito, a interação já morreu (expirou ou já
    // foi respondida antes) — não tem como responder de outro jeito.
    console.error('[PersonalizacaoBot] Falha no deferUpdate (modal):', e);
    return;
  }

  try {
    const body = {};
    const cfg = getConfig(interaction.guildId);

    if (nick) {
      if (nick.length > 32) {
        await interaction.followUp({
          content: `${EMOJI_NEGATIVO} O nome não pode passar de 32 caracteres (limite do Discord).`,
          flags: 64,
        }).catch(() => {});
        return;
      }
      body.nick = nick;
      cfg.nick = nick;
    }
    if (avatarUrl) {
      body.avatar = await baixarComoDataUri(avatarUrl);
      cfg.avatarUrl = avatarUrl;
    }
    if (bannerUrl) {
      body.banner = await baixarComoDataUri(bannerUrl);
      cfg.bannerUrl = bannerUrl;
    }
    if (bio) {
      body.bio = bio;
      cfg.bio = bio;
    }

    if (Object.keys(body).length === 0) {
      await interaction.followUp({
        content: `${EMOJI_NEGATIVO} Você não preencheu nada pra atualizar.`,
        flags: 64,
      }).catch(() => {});
      return;
    }

    await interaction.client.rest.patch(`/guilds/${interaction.guildId}/members/@me`, { body });

    cfg.atualizadoEm = Date.now();
    saveConfig(interaction.guildId, cfg);

    await interaction.editReply({
      content: null,
      embeds: [buildEmbed(interaction)],
      components: buildComponents(),
    }).catch(() => {});
    await interaction.followUp({
      content: `${EMOJI_POSITIVO} Perfil do bot atualizado neste servidor!`,
      flags: 64,
    }).catch(() => {});
  } catch (e) {
    // Log completo (com stack) pra dar pra identificar a causa real nos
    // logs de deploy, em vez de só um "algo deu errado" genérico.
    console.error('[PersonalizacaoBot] Erro ao processar edição:', e);
    await interaction.followUp({
      content: `${EMOJI_NEGATIVO} Não deu pra atualizar: \`${e?.message || e}\``,
      flags: 64,
    }).catch(() => {});
  }
}

// ── Remover tudo ─────────────────────────────────────────────────

async function handleRemover(interaction) {
  if (!(await usuarioTemPermissao(interaction))) return;

  try {
    await interaction.deferUpdate();
  } catch (e) {
    console.error('[PersonalizacaoBot] Falha no deferUpdate (remover):', e);
    return;
  }

  try {
    await interaction.client.rest.patch(`/guilds/${interaction.guildId}/members/@me`, {
      body: { nick: null, avatar: null, banner: null, bio: null },
    });

    saveConfig(interaction.guildId, { nick: null, avatarUrl: null, bannerUrl: null, bio: null, atualizadoEm: Date.now() });

    await interaction.editReply({
      content: null,
      embeds: [buildEmbed(interaction)],
      components: buildComponents(),
    }).catch(() => {});
    await interaction.followUp({
      content: `${EMOJI_POSITIVO} Nome, avatar, banner e bio deste servidor foram removidos (voltou ao perfil global do bot).`,
      flags: 64,
    }).catch(() => {});
  } catch (e) {
    console.error('[PersonalizacaoBot] Erro ao remover perfil do bot:', e);
    await interaction.followUp({
      content: `${EMOJI_NEGATIVO} Não deu pra remover: \`${e?.message || e}\``,
      flags: 64,
    }).catch(() => {});
  }
}

// ── Roteamento (chamado por events/buttonHandler.js) ──────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  try {
    if (id === 'PB_Editar') {
      if (!(await usuarioTemPermissao(interaction))) return;
      return await interaction.showModal(modalEditar(interaction));
    }
    if (id === 'PB_Remover') return await handleRemover(interaction);
    if (id === 'PB_Voltar_Painel') {
      // BUGFIX: esta mensagem tem embed (nao e V2). Editar pro /painel (V2) sem
      // limpar embeds/content dava erro 50035. voltarParaPainel() resolve.
      const { voltarParaPainel } = require('../commands/painel');
      return await voltarParaPainel(interaction);
    }
  } catch (e) {
    console.error('[PersonalizacaoBot] Erro no botão', id, ':', e);
    const payload = { content: `${EMOJI_NEGATIVO} Não deu pra abrir isso: \`${e?.message || e}\``, flags: 64 };
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply(payload).catch(() => {});
    } else {
      await interaction.followUp(payload).catch(() => {});
    }
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (id === 'PB_Modal_Editar') return handleModalEditar(interaction);
}

module.exports = {
  abrirPersonalizacao,
  handleButton,
  handleModal,
};
