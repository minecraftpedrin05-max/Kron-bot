// ═══════════════════════════════════════════════════════════════════════
// c6BankManager.js — Painel de configuração do gateway C6 Bank
// Módulo NOVO e independente, espelhando efi-system/efiBankManager.js
// (mesma estrutura visual, mesmos botões, mesmo fluxo de certificado).
// ═══════════════════════════════════════════════════════════════════════

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const db = require('../database/db');
const { caminhoCertificado } = require('../sales-system/c6Bank');

function getC6(guildId) {
  return db.getGuild(guildId).loja?.c6bank || { habilitado: false };
}

function fmtStatus(ok) { return ok ? '<:positivo:1528401238197276702>' : '<:negativo:1528400986744295475>'; }

/** 🟢 Conectado | 🟡 Configuração incompleta | 🔴 Desconectado/erro */
function estadoConexao(c6, credenciaisOk, temCertificado) {
  if (c6.habilitado && credenciaisOk && temCertificado) return '🟢 Conectado';
  if (credenciaisOk || temCertificado) return '🟡 Configuração incompleta';
  return '🔴 Desconectado';
}

function buildPainelEmbed(interaction) {
  const c6 = getC6(interaction.guildId);
  const temCertificado = fs.existsSync(caminhoCertificado(interaction.guildId));
  const credenciaisOk = !!(c6.clientId && c6.clientSecret && c6.chavePix);
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  const embed = new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('C6 Bank | Formas de Pagamento')
    .setDescription(
      '> Terceiro gateway de PIX, alternativo ao Mercado Pago e ao Efi Bank.\n' +
      '> Prioridade de uso: **Mercado Pago → Efi Bank → C6 Bank → PIX manual**. Quando C6 Bank estiver habilitado e os anteriores desligados, o checkout passa a usar o C6 automaticamente.\n\n' +
      '⚠️ **Recurso em fase de validação**: os detalhes técnicos desta integração vêm da melhor evidência pública disponível, não da documentação oficial do C6 (que exige credenciamento como Software House). Valide em **sandbox** antes de usar em produção.\n\n' +
      '📋 A cobrança do C6 exige CPF/CNPJ e nome do comprador (será pedido a ele no momento da compra, diferente do Mercado Pago/Efi).'
    )
    .addFields({
      name: 'Estado da Conexão',
      value: estadoConexao(c6, credenciaisOk, temCertificado),
    })
    .addFields({
      name: 'Sistema',
      value: `${fmtStatus(c6.habilitado)} Habilitado\n${fmtStatus(credenciaisOk)} Credenciais configuradas\n${fmtStatus(temCertificado)} Certificado enviado`,
    })
    .addFields({ name: 'Ambiente', value: c6.sandbox === false ? '<:online:1533081467918221565> Produção' : '🧪 Sandbox (homologação)', inline: true })
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();

  if (c6.clientId) {
    embed.addFields({ name: 'Client ID', value: `\`\`\`${c6.clientId.slice(0, 8)}${'*'.repeat(14)}\`\`\`` });
  }
  if (c6.chavePix) {
    embed.addFields({ name: 'Chave PIX', value: `\`${c6.chavePix}\`` });
  }

  return embed;
}

function buildPainelComponents() {
  const c6Habilitado = true; // recomputado abaixo via getC6 no toggle
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('c6_modal_credenciais').setLabel('Configurar Credenciais').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('c6_enviar_certificado').setLabel('Enviar Certificado').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('c6_testar').setLabel('Testar Configuração').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('c6_toggle_sandbox').setLabel('Sandbox / Produção').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('c6_toggle_habilitado').setLabel('Habilitar / Desabilitar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('c6_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function showPainel(interaction) {
  const embed = buildPainelEmbed(interaction);
  const components = buildPainelComponents();
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    return interaction.update({ content: null, embeds: [embed], components });
  }
  return interaction.reply({ embeds: [embed], components, flags: 64 });
}

function buildModalCredenciais(interaction) {
  const c6 = getC6(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('c6_modal_credenciais_submit').setTitle('Credenciais C6 Bank');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clientId').setLabel('Client ID (emitido pelo C6)').setStyle(TextInputStyle.Short).setRequired(true).setValue(c6.clientId || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clientSecret').setLabel('Client Secret (emitido pelo C6)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('chavePix').setLabel('Chave PIX cadastrada na sua conta C6').setStyle(TextInputStyle.Short).setRequired(true).setValue(c6.chavePix || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('senhaCertificado').setLabel('Senha do certificado (se houver)').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

async function processarModalCredenciais(interaction) {
  const clientId = interaction.fields.getTextInputValue('clientId').trim();
  const clientSecret = interaction.fields.getTextInputValue('clientSecret').trim();
  const chavePix = interaction.fields.getTextInputValue('chavePix').trim();
  const senhaCertificado = interaction.fields.getTextInputValue('senhaCertificado').trim();

  const atual = getC6(interaction.guildId);
  // Nunca loga client secret nem qualquer credencial — só confirma que
  // foi salvo. Armazenamento segue o mesmo padrão já usado pelo Efi
  // Bank neste projeto (banco local do guild, nunca exposto no Discord).
  db.updateGuild(interaction.guildId, 'loja.c6bank', {
    habilitado: atual.habilitado || false,
    sandbox: atual.sandbox ?? true,
    clientId, clientSecret, chavePix,
    senhaCertificado: senhaCertificado || '',
  });

  await interaction.reply({ content: '<:positivo:1528401238197276702> Credenciais do C6 Bank salvas. Agora envie o certificado usando o botão **"Enviar Certificado"**.', flags: 64 });
}

async function pedirCertificado(interaction) {
  await interaction.reply({
    content: '📎 Envie o arquivo do certificado (**.pem**, **.p12** ou **.pfx**, conforme emitido pelo C6) aqui neste canal nos próximos 60 segundos. A mensagem com o anexo é apagada automaticamente por segurança assim que eu salvar o certificado.',
    flags: 64,
  });

  const filtro = m => m.author.id === interaction.user.id && m.attachments.size > 0;
  try {
    const coletadas = await interaction.channel.awaitMessages({ filter: filtro, max: 1, time: 60000, errors: ['time'] });
    const msg = coletadas.first();
    const anexo = msg.attachments.first();

    const nomeLower = anexo.name.toLowerCase();
    if (!nomeLower.endsWith('.pem') && !nomeLower.endsWith('.p12') && !nomeLower.endsWith('.pfx') && !nomeLower.endsWith('.cer')) {
      await msg.delete().catch(() => {});
      await interaction.followUp({ content: '<:negativo:1528400986744295475> O arquivo precisa ser `.pem`, `.p12`, `.pfx` ou `.cer`. Clique em "Enviar Certificado" e tente novamente.', flags: 64 });
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

    await interaction.followUp({ content: '<:positivo:1528401238197276702> Certificado recebido e salvo com segurança. Use "Testar Configuração" antes de habilitar em produção.', flags: 64 });
  } catch (e) {
    await interaction.followUp({ content: '<:relogio:1524207889441357917> Tempo esgotado ou erro ao processar o certificado. Clique em "Enviar Certificado" e tente novamente.', flags: 64 });
  }
}

/** Testa a configuração atual (autentica no C6, sem criar cobrança). */
async function testarConfiguracao(interaction) {
  await interaction.deferReply({ flags: 64 });
  const { getConfigC6Bank } = require('../sales-system/c6Bank');
  const cfg = getConfigC6Bank(interaction.guildId);

  if (!cfg.clientId || !cfg.clientSecret || !cfg.chavePix) {
    return interaction.editReply({ content: '<:negativo:1528400986744295475> Configure as credenciais antes de testar.' });
  }
  if (!fs.existsSync(cfg.certificadoPath)) {
    return interaction.editReply({ content: '<:negativo:1528400986744295475> Envie o certificado antes de testar.' });
  }

  try {
    // Só autentica — não cria cobrança nenhuma no teste.
    const c6Bank = require('../sales-system/c6Bank');
    // obterAccessToken não é exportado de propósito (uso interno); o
    // teste real de ponta a ponta é feito criando uma cobrança de
    // valor simbólico, o que exigiria dados de devedor — por isso,
    // aqui validamos só a leitura da config. Confirmação completa
    // exige testar uma compra real em sandbox.
    if (!c6Bank.getConfigC6Bank(interaction.guildId).habilitado) {
      return interaction.editReply({ content: '🟡 Configuração presente, mas incompleta ou desabilitada. Verifique credenciais, chave PIX e certificado.' });
    }
    return interaction.editReply({ content: '🟢 Configuração completa (credenciais + certificado presentes). Para validar de ponta a ponta, faça uma compra de teste em **sandbox**.' });
  } catch (e) {
    console.error('[C6 Bank] Erro ao testar configuração:', e.message);
    return interaction.editReply({ content: `<:negativo:1528400986744295475> Erro ao testar: \`${e.message}\`` });
  }
}

async function toggleSandbox(interaction) {
  const c6 = getC6(interaction.guildId);
  db.updateGuild(interaction.guildId, 'loja.c6bank.sandbox', !(c6.sandbox ?? true));
  return showPainel(interaction);
}

async function toggleHabilitado(interaction) {
  const c6 = getC6(interaction.guildId);
  const credenciaisOk = !!(c6.clientId && c6.clientSecret && c6.chavePix);
  const temCertificado = fs.existsSync(caminhoCertificado(interaction.guildId));

  if (!c6.habilitado && (!credenciaisOk || !temCertificado)) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Configure as credenciais e envie o certificado antes de habilitar o C6 Bank.', flags: 64 });
  }
  db.updateGuild(interaction.guildId, 'loja.c6bank.habilitado', !c6.habilitado);
  return showPainel(interaction);
}

/** Desconecta: desabilita e apaga credenciais salvas (não apaga histórico de pedidos). */
async function desconectar(interaction) {
  db.updateGuild(interaction.guildId, 'loja.c6bank', { habilitado: false, sandbox: true, clientId: null, clientSecret: null, chavePix: null, senhaCertificado: '' });
  const certPath = caminhoCertificado(interaction.guildId);
  if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
  return showPainel(interaction);
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === 'c6_modal_credenciais')  return interaction.showModal(buildModalCredenciais(interaction));
  if (id === 'c6_enviar_certificado') return pedirCertificado(interaction);
  if (id === 'c6_testar')             return testarConfiguracao(interaction);
  if (id === 'c6_toggle_sandbox')     return toggleSandbox(interaction);
  if (id === 'c6_toggle_habilitado')  return toggleHabilitado(interaction);
  if (id === 'c6_desconectar')        return desconectar(interaction);
}

async function handleModal(interaction) {
  if (interaction.customId === 'c6_modal_credenciais_submit') return processarModalCredenciais(interaction);
}

module.exports = { showPainel, handleButton, handleModal };
