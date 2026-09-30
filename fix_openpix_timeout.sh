#!/usr/bin/env bash
set -e
echo "Corrigindo timeout dos botoes do /openpix (defer antes da chamada lenta de saldo)..."

cat > openpix-system/openPixManager.js << 'KRON_EOF_OPENPIX'
// ═══════════════════════════════════════════════════════════════════════
// openPixManager.js — Painel de configuração do gateway OpenPix/Woovi
// Módulo novo e independente, espelhando efi-system/efiBankManager.js e
// c6-system/c6BankManager.js (mesma estrutura visual/fluxo de botões).
//
// TAREFA 2 (Parte 2) — vínculo do servidor:
//   1) validar (chave PIX + AppID presentes)
//   2) verificar se já existe vínculo (obterSubconta antes de criar)
//   3) criar a estrutura na OpenPix usando somente a API oficial (criarSubconta)
//   4) salvar o identificador retornado (subaccountPixKey/subaccountName)
//   5) vincular guildId ↔ subaccount (db.updateGuild('loja.openpix', ...))
// Se a OpenPix recusar por falta da funcionalidade "Subconta" habilitada
// na conta principal, o erro da própria API é mostrado tal como veio —
// nunca contornado (REGRA ABSOLUTA do pedido).
// ═══════════════════════════════════════════════════════════════════════

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const db = require('../database/db');
const openPix = require('../sales-system/openPix');

function getOpenPix(guildId) {
  return db.getGuild(guildId).loja?.openpix || { habilitado: false };
}

function fmtStatus(ok) { return ok ? '<:positivo:1528401238197276702>' : '<:negativo:1528400986744295475>'; }

function estadoConexao(cfg) {
  if (cfg.habilitado && cfg.appId && cfg.subaccountPixKey) return '🟢 Conectado';
  if (cfg.appId || cfg.subaccountPixKey) return '🟡 Configuração incompleta';
  return '🔴 Desconectado';
}

async function buildPainelEmbed(interaction) {
  const cfg = getOpenPix(interaction.guildId);
  const icon = interaction.guild.iconURL({ extension: 'png', size: 256 }) || undefined;

  const embed = new EmbedBuilder()
    .setColor(0x00E599)
    .setTitle('OpenPix / Woovi | Formas de Pagamento')
    .setDescription(
      '> Quarto gateway de PIX. **Modelo de subcontas**: cada servidor tem sua própria subconta na OpenPix, com saldo isolado — o cliente final nunca precisa criar conta na OpenPix, só paga o PIX normalmente.\n' +
      '> Prioridade de uso: **Mercado Pago → Efi Bank → C6 Bank → OpenPix → PIX manual**. Quando OpenPix estiver habilitado e os anteriores desligados, o checkout passa a usar a OpenPix automaticamente.\n\n' +
      '📋 Exige uma conta OpenPix/Woovi com a funcionalidade **Subconta** habilitada (fale com o suporte da OpenPix se o botão "Criar Vínculo" retornar erro sobre isso).'
    )
    .addFields({ name: 'Estado da Conexão', value: estadoConexao(cfg) })
    .addFields({
      name: 'Sistema',
      value: `${fmtStatus(cfg.habilitado)} Habilitado\n${fmtStatus(!!cfg.appId)} AppID configurado\n${fmtStatus(!!cfg.subaccountPixKey)} Subconta vinculada`,
    })
    .addFields({ name: 'Ambiente', value: cfg.sandbox ? '🧪 Sandbox (woovi-sandbox)' : '<:online:1533081467918221565> Produção', inline: true })
    .setFooter({ text: interaction.guild.name, iconURL: icon })
    .setTimestamp();

  if (cfg.appId) {
    embed.addFields({ name: 'AppID', value: `\`\`\`${cfg.appId.slice(0, 10)}${'*'.repeat(14)}\`\`\`` });
  }
  if (cfg.subaccountPixKey) {
    embed.addFields({ name: 'Subconta (chave PIX)', value: `\`${cfg.subaccountPixKey}\`` });

    // Saldo real — TAREFA 5: o saldo mostrado deve refletir o modelo
    // financeiro real da integração (aqui, a subconta é a fonte de verdade).
    try {
      const saldo = await openPix.saldoSubconta({ appId: cfg.appId, sandbox: cfg.sandbox, pixKey: cfg.subaccountPixKey });
      if (saldo) {
        embed.addFields({ name: '💰 Saldo na Subconta (OpenPix)', value: `R$ ${saldo.balance.toFixed(2).replace('.', ',')}` });
      }
    } catch (e) {
      embed.addFields({ name: '💰 Saldo na Subconta (OpenPix)', value: `<:negativo:1528400986744295475> Erro ao consultar: \`${e.message}\`` });
    }
  }

  return embed;
}

function buildPainelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('openpix_modal_credenciais').setLabel('Configurar AppID').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('openpix_criar_vinculo').setLabel('Criar Vínculo (Subconta)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('openpix_testar').setLabel('Testar Configuração').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('openpix_toggle_sandbox').setLabel('Sandbox / Produção').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('openpix_toggle_habilitado').setLabel('Habilitar / Desabilitar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('openpix_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function showPainel(interaction) {
  // CORREÇÃO: buildPainelEmbed() faz uma chamada de rede real pra OpenPix
  // (consulta de saldo) — isso pode passar dos 3s que o Discord dá pra
  // responder. Por isso confirmamos (defer) IMEDIATAMENTE, antes de buscar
  // qualquer coisa lenta, e só then construímos o embed e editamos a
  // resposta. Se quem chamou já tiver deferido/respondido antes (ex.:
  // criarVinculo), não deferimos de novo — só seguimos pro editReply.
  if (!interaction.deferred && !interaction.replied) {
    if (interaction.isButton() || interaction.isAnySelectMenu()) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: 64 });
  }
  const embed = await buildPainelEmbed(interaction);
  const components = buildPainelComponents();
  return interaction.editReply({ content: null, embeds: [embed], components });
}

function buildModalCredenciais(interaction) {
  const cfg = getOpenPix(interaction.guildId);
  const modal = new ModalBuilder().setCustomId('openpix_modal_credenciais_submit').setTitle('Credenciais OpenPix/Woovi');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appId').setLabel('AppID (App Master, emitido pela OpenPix)').setStyle(TextInputStyle.Short).setRequired(true).setValue(cfg.appId || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pixKey').setLabel('Chave PIX da SUBCONTA deste servidor').setStyle(TextInputStyle.Short).setRequired(true).setValue(cfg.subaccountPixKeyDesejada || cfg.subaccountPixKey || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome da loja (exibido na subconta)').setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.subaccountName || interaction.guild.name)),
  );
  return modal;
}

async function processarModalCredenciais(interaction) {
  const appId = interaction.fields.getTextInputValue('appId').trim();
  const pixKey = interaction.fields.getTextInputValue('pixKey').trim();
  const nome = interaction.fields.getTextInputValue('nome').trim();

  const atual = getOpenPix(interaction.guildId);
  // Nunca loga o AppID completo em lugar nenhum — só confirma que foi salvo.
  db.updateGuild(interaction.guildId, 'loja.openpix', {
    habilitado: atual.habilitado || false,
    sandbox: atual.sandbox ?? true,
    appId,
    subaccountPixKeyDesejada: pixKey, // chave PIX que o dono quer usar (ainda não vinculada)
    subaccountName: nome || interaction.guild.name,
    subaccountPixKey: atual.subaccountPixKey || null, // só é preenchido após "Criar Vínculo"
  });

  await interaction.reply({ content: '<:positivo:1528401238197276702> Credenciais salvas. Agora clique em **"Criar Vínculo (Subconta)"** para criar/verificar a subconta na OpenPix.', flags: 64 });
}

/** TAREFA 2 — fluxo completo de vínculo do servidor. */
async function criarVinculo(interaction) {
  await interaction.deferUpdate();
  const cfg = getOpenPix(interaction.guildId);

  // 1) validar
  if (!cfg.appId) {
    return interaction.followUp({ content: '<:negativo:1528400986744295475> Configure o AppID antes ("Configurar AppID").', flags: 64 });
  }
  const pixKey = cfg.subaccountPixKeyDesejada || cfg.subaccountPixKey;
  if (!pixKey) {
    return interaction.followUp({ content: '<:negativo:1528400986744295475> Configure a chave PIX da subconta antes ("Configurar AppID").', flags: 64 });
  }

  try {
    // 2) verificar se já existe vínculo (nunca cria duplicado)
    const existente = await openPix.obterSubconta({ appId: cfg.appId, sandbox: cfg.sandbox, pixKey });

    let subconta = existente;
    if (!existente) {
      // 3) criar a estrutura na OpenPix usando somente a API oficial
      subconta = await openPix.criarSubconta({ appId: cfg.appId, sandbox: cfg.sandbox, pixKey, name: cfg.subaccountName });
    }

    // 4) salvar o identificador retornado + 5) vincular guildId ↔ subaccount
    db.updateGuild(interaction.guildId, 'loja.openpix.subaccountPixKey', subconta.pixKey || pixKey);
    db.updateGuild(interaction.guildId, 'loja.openpix.subaccountName', subconta.name || cfg.subaccountName);

    await interaction.followUp({
      content: existente
        ? '<:positivo:1528401238197276702> Subconta já existia na OpenPix — vínculo confirmado com este servidor.'
        : '<:positivo:1528401238197276702> Subconta criada na OpenPix e vinculada a este servidor.',
      flags: 64,
    });
  } catch (e) {
    console.error('[OpenPix] Erro ao criar/verificar vínculo de subconta:', e.message);
    await interaction.followUp({
      content: `<:negativo:1528400986744295475> A OpenPix recusou a operação: \`${e.message}\`\n` +
        '> Se o erro mencionar a funcionalidade **Subconta** não habilitada, é uma pendência da conta principal — fale com o suporte da OpenPix/Woovi para ativá-la. Não é algo que este bot pode contornar.',
      flags: 64,
    });
  }

  return showPainel(interaction);
}

async function testarConfiguracao(interaction) {
  await interaction.deferReply({ flags: 64 });
  const cfg = getOpenPix(interaction.guildId);

  if (!cfg.appId) return interaction.editReply({ content: '<:negativo:1528400986744295475> Configure o AppID antes de testar.' });
  if (!cfg.subaccountPixKey) return interaction.editReply({ content: '<:negativo:1528400986744295475> Ainda não há subconta vinculada. Use "Criar Vínculo" primeiro.' });

  try {
    const saldo = await openPix.saldoSubconta({ appId: cfg.appId, sandbox: cfg.sandbox, pixKey: cfg.subaccountPixKey });
    if (!saldo) return interaction.editReply({ content: '<:negativo:1528400986744295475> A subconta vinculada não foi encontrada na OpenPix (pode ter sido removida por lá).' });
    return interaction.editReply({ content: `🟢 Conexão OK. Saldo atual na subconta: **R$ ${saldo.balance.toFixed(2).replace('.', ',')}**.` });
  } catch (e) {
    console.error('[OpenPix] Erro ao testar configuração:', e.message);
    return interaction.editReply({ content: `<:negativo:1528400986744295475> Erro ao testar: \`${e.message}\`` });
  }
}

async function toggleSandbox(interaction) {
  const cfg = getOpenPix(interaction.guildId);
  db.updateGuild(interaction.guildId, 'loja.openpix.sandbox', !(cfg.sandbox ?? true));
  return showPainel(interaction);
}

async function toggleHabilitado(interaction) {
  const cfg = getOpenPix(interaction.guildId);
  if (!cfg.habilitado && (!cfg.appId || !cfg.subaccountPixKey)) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> Configure o AppID e crie o vínculo da subconta antes de habilitar a OpenPix.', flags: 64 });
  }
  db.updateGuild(interaction.guildId, 'loja.openpix.habilitado', !cfg.habilitado);
  return showPainel(interaction);
}

/** Desconecta: desabilita e apaga credenciais salvas (nunca apaga a subconta na OpenPix nem o histórico de pedidos). */
async function desconectar(interaction) {
  db.updateGuild(interaction.guildId, 'loja.openpix', {
    habilitado: false, sandbox: true, appId: null,
    subaccountPixKey: null, subaccountPixKeyDesejada: null, subaccountName: null,
  });
  return showPainel(interaction);
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === 'openpix_modal_credenciais') return interaction.showModal(buildModalCredenciais(interaction));
  if (id === 'openpix_criar_vinculo')      return criarVinculo(interaction);
  if (id === 'openpix_testar')             return testarConfiguracao(interaction);
  if (id === 'openpix_toggle_sandbox')     return toggleSandbox(interaction);
  if (id === 'openpix_toggle_habilitado')  return toggleHabilitado(interaction);
  if (id === 'openpix_desconectar')        return desconectar(interaction);
}

async function handleModal(interaction) {
  if (interaction.customId === 'openpix_modal_credenciais_submit') return processarModalCredenciais(interaction);
}

module.exports = { showPainel, handleButton, handleModal };
KRON_EOF_OPENPIX
echo "  ok: openpix-system/openPixManager.js"

echo "Pronto. Reinicie o bot e teste os botoes do /openpix."
