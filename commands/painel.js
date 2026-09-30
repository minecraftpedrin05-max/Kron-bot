'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const LOGO       = '<:coroa:1520751629350080582> KAEL';
const { assetUrl } = require('../utils/assets');
const BANNER_URL = assetUrl('kael-banner.png');

function getSaudacao() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'bom dia! ☀️';
  if (h >= 12 && h < 18) return 'boa tarde! 🌞';
  return 'boa noite! 🌙';
}

function buildPainelContainer(user) {
  const nome = user.displayName || user.username;

  const container = new ContainerBuilder()
    .setAccentColor(0x000000)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${LOGO}\n` +
        `-# Olá, **${nome}**! ${getSaudacao()} Aqui você pode configurar e personalizar as funcionalidades do seu bot.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    )
;

  if (BANNER_URL) {
    container
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(BANNER_URL).setSpoiler(false)
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      );
  }

  container
    // Linha 1: Configurar Loja | Gerenciar Ticket | Ver Rendimento | Sorteios
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('painel_vendas')      .setLabel('Configurar Loja') .setEmoji({ name: 'carrinho', id: '1515379197349073107' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_ticket')      .setLabel('Gerenciar Ticket').setEmoji({ name: 'tickets',  id: '1515363874873020508' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_rendimentos') .setLabel('Ver Rendimento')  .setEmoji({ name: 'grafico', id: '1514959476493521117' }) .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_sorteios')    .setLabel('Sorteios')        .setEmoji({ name: 'sorteio', id: '1520998962545295530' }) .setStyle(ButtonStyle.Secondary),
      )
    )
    // Linha 2: Definições | Ações Automáticas | Proteção | Boas Vindas
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('painel_definicoes') .setLabel('Definições').setEmoji({ name: 'configuracoes', id: '1515379328475730081' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_acoes_auto').setLabel('Ações Automáticas').setEmoji({ name: 'xpooo', id: '1523791736948920433' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_protecao')  .setLabel('Proteção').setEmoji({ name: 'safety', id: '1528841000548569239' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_boasvindas').setLabel('Boas Vindas').setEmoji({ name: 'sino', id: '1528840971096297482' }).setStyle(ButtonStyle.Secondary),
      )
    )
    // Linha 3: Personalização do Bot (avatar/banner/bio por servidor)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('painel_personalizacao').setLabel('Personalizar Bot').setEmoji({ name: 'personalizarE', id: '1528401146274910289' }).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_verificacao').setLabel('Verificação').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('painel_sugestoes').setLabel('Sugestões').setEmoji('💡').setStyle(ButtonStyle.Secondary),
      )
    );


  return container;
}

function painelPayload(user) {
  return {
    components: [ buildPainelContainer(user) ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

/**
 * Payload pra VOLTAR ao /painel EDITANDO uma mensagem que nao e Components V2.
 *
 * Definicoes, Acoes Automaticas, Ver Rendimento, Boas-Vindas e Personalizar Bot
 * abrem uma mensagem ephemeral NOVA (com content e/ou embed). Ao clicar em
 * "Voltar", essa mensagem precisa virar o /painel (Components V2). O Discord
 * so aceita essa conversao se content e embeds forem LIMPOS explicitamente na
 * mesma edicao — se ficarem de fora, a mensagem antiga mantem eles e a API
 * responde 50035 MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2.
 */
function painelUpdatePayload(user) {
  return {
    content: null,
    embeds: [],
    components: [ buildPainelContainer(user) ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

/**
 * "Voltar ao /painel" unico pra todos os modulos (Definicoes, Acoes Auto,
 * Rendimentos, Boas-Vindas, Personalizar Bot).
 *
 * 1) Tenta editar a mensagem atual, limpando content/embeds.
 * 2) Se a API recusar por qualquer motivo, abre o /painel numa mensagem
 *    ephemeral nova — assim o usuario nunca cai em "erro interno".
 */
async function voltarParaPainel(interaction) {
  try {
    return await interaction.update(painelUpdatePayload(interaction.user));
  } catch (e) {
    console.error('[Painel] Falha ao editar a mensagem pra voltar ao /painel:', e?.message || e);
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply(painelPayload(interaction.user));
    }
    throw e;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Abre o painel de controle do bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.reply(painelPayload(interaction.user));
  },

  painelPayload,
  painelUpdatePayload,
  voltarParaPainel,
};
