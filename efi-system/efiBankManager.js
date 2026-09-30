// ═══════════════════════════════════════════════════════════════════════
// efiBankManager.js — Painel de configuração do gateway Efi Bank
// Módulo NOVO e independente. Estilo visual (EmbedBuilder clássico)
// espelha a tela de configuração do Mercado Pago em commands/definicoes.js
// — são telas irmãs da mesma categoria ("Formas de Pagamento").
// ═══════════════════════════════════════════════════════════════════════

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const db = require('../database/db');
const { caminhoCertificado } = require('../sales-system/efiBank');

function getEfi(guildId) {
  return db.getGuild(guildId).loja?.efibank || { habilitado: false };
}

function fmtStatus(ok) { return ok ? '<:positivo:1528401238197276702>' : '<:negativo:1528400986744295475>'; }

function buildPainelEmbed(interaction) {
  const efi = getEfi(interaction.guildId);
  const temCertificado = fs.existsSync(caminhoCertificado(interaction.guildId));
  const credenciaisOk = !!(efi.clientId && efi.clientSecret && efi.pixKey);
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  const embed = new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('Efi Bank | Formas de Pagamento')
    .setDescription(
      '> Segundo gateway de PIX, alternativo ao Mercado Pago.\n' +
      '> Quando **habilitado** e o Mercado Pago estiver **desligado**, o checkout passa a usar o Efi Bank automaticamente — nenhuma configuração do Mercado Pago é alterada.'
    )
    .addFields({
      name: 'Sistema',
      value: `${fmtStatus(efi.habilitado)} Habilitado\n${fmtStatus(credenciaisOk)} Credenciais configuradas\n${fmtStatus(temCertificado)} Certificado enviado`,
    })
    .addFields({ name: 'Ambiente', value: efi.sandbox ? '🧪 Sandbox (homologação)' : '<:online:1533081467918221565> Produção', inline: true })
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();

  if (efi.clientId) {
    embed.addFields({ name: 'Client ID', value: `\`\`\`${efi.clientId.slice(0, 8)}${'*'.repeat(14)}\`\`\`` });
  }
  if (efi.pixKey) {
    embed.addFields({ name: 'Chave PIX', value: `\`${efi.pixKey}\`` });
  }

  return embed;
}

function buildPainelComponents(interaction) {
  const efi = getEfi(interaction.guildId);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('efi_modal_credenciais').setLabel('Configurar Credenciais').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('efi_enviar_certificado').setLabel('Enviar Certificado (.p12)').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('efi_toggle_sandbox').setLabel(efi.sandbox ? 'Mudar p/ Produção' : 'Mudar p/ Sandbox').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('efi_toggle_habilitado')
        .setLabel(efi.habilitado ? 'Desabilitar' : 'Habilitar')
        .setStyle(efi.habilitado ? ButtonStyle.Danger : ButtonStyle.Success),
    ),
  ];
}

async function showPainel(interaction) {
  const embed = buildPainelEmbed(interaction);
  const components = buildPainelComponents(interaction);
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    return interaction.update({ content: null, embeds: [embed], components });
  }
  return interaction.reply({ embeds: [embed], components, flags: 64 });
}

function buildModalCredenciais(interaction) {
  const efi = getEfi(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('efi_modal_credenciais_submit').setTitle('Credenciais Efi Bank');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clientId').setLabel('Client ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(efi.clientId || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clientSecret').setLabel('Client Secret').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pixKey').setLabel('Chave PIX cadastrada na Efi').setStyle(TextInputStyle.Short).setRequired(true).setValue(efi.pixKey || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('senhaCertificado').setLabel('Senha do certificado (se houver)').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

async function processarModalCredenciais(interaction) {
  const clientId = interaction.fields.getTextInputValue('clientId').trim();
  const clientSecret = interaction.fields.getTextInputValue('clientSecret').trim();
  const pixKey = interaction.fields.getTextInputValue('pixKey').trim();
  const senhaCertificado = interaction.fields.getTextInputValue('senhaCertificado').trim();

  const atual = getEfi(interaction.guildId);
  db.updateGuild(interaction.guildId, 'loja.efibank', {
    habilitado: atual.habilitado || false,
    sandbox: atual.sandbox ?? true,
    clientId, clientSecret, pixKey,
    senhaCertificado: senhaCertificado || '',
  });

  await interaction.reply({ content: '<:positivo:1528401238197276702> Credenciais do Efi Bank salvas. Agora envie o certificado `.p12` usando o botão **"Enviar Certificado"**.', flags: 64 });
}

async function pedirCertificado(interaction) {
  await interaction.reply({
    content: '📎 Envie o arquivo **.p12** (ou `.pfx`) do Efi Bank aqui neste canal nos próximos 60 segundos. A mensagem com o anexo é apagada automaticamente por segurança assim que eu salvar o certificado.',
    flags: 64,
  });

  const filtro = m => m.author.id === interaction.user.id && m.attachments.size > 0;
  try {
    const coletadas = await interaction.channel.awaitMessages({ filter: filtro, max: 1, time: 60000, errors: ['time'] });
    const msg = coletadas.first();
    const anexo = msg.attachments.first();

    const nomeLower = anexo.name.toLowerCase();
    if (!nomeLower.endsWith('.p12') && !nomeLower.endsWith('.pfx')) {
      await msg.delete().catch(() => {});
      await interaction.followUp({ content: '<:negativo:1528400986744295475> O arquivo precisa ser `.p12` ou `.pfx`. Clique em "Enviar Certificado" e tente novamente.', flags: 64 });
      return;
    }

    const resposta = await fetch(anexo.url);
    const buffer = Buffer.from(await resposta.arrayBuffer());

    const path = require('path');
    const destino = caminhoCertificado(interaction.guildId);
    const pastaCerts = path.dirname(destino);
    if (!fs.existsSync(pastaCerts)) fs.mkdirSync(pastaCerts, { recursive: true });
    fs.writeFileSync(destino, buffer);

    await msg.delete().catch(() => {}); // remove o anexo sensível do canal assim que salvo em disco

    await interaction.followUp({ content: '<:positivo:1528401238197276702> Certificado recebido e salvo com segurança. Já pode habilitar o Efi Bank no painel `/efibank`.', flags: 64 });
  } catch (e) {
    await interaction.followUp({ content: '<:relogio:1524207889441357917> Tempo esgotado ou erro ao processar o certificado. Clique em "Enviar Certificado" e tente novamente.', flags: 64 });
  }
}

async function toggleSandbox(interaction) {
  const efi = getEfi(interaction.guildId);
  db.updateGuild(interaction.guildId, 'loja.efibank.sandbox', !efi.sandbox);
  return showPainel(interaction);
}

async function toggleHabilitado(interaction) {
  const efi = getEfi(interaction.guildId);
  const credenciaisOk = !!(efi.clientId && efi.clientSecret && efi.pixKey);
  const temCertificado = fs.existsSync(caminhoCertificado(interaction.guildId));

  if (!efi.habilitado && (!credenciaisOk || !temCertificado)) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Configure as credenciais e envie o certificado antes de habilitar o Efi Bank.', flags: 64 });
  }
  db.updateGuild(interaction.guildId, 'loja.efibank.habilitado', !efi.habilitado);
  return showPainel(interaction);
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === 'efi_modal_credenciais') return interaction.showModal(buildModalCredenciais(interaction));
  if (id === 'efi_enviar_certificado') return pedirCertificado(interaction);
  if (id === 'efi_toggle_sandbox') return toggleSandbox(interaction);
  if (id === 'efi_toggle_habilitado') return toggleHabilitado(interaction);
}

async function handleModal(interaction) {
  if (interaction.customId === 'efi_modal_credenciais_submit') return processarModalCredenciais(interaction);
}

module.exports = { showPainel, handleButton, handleModal };
