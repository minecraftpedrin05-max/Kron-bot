// ============================================================
//  handlers/carteiraHandler.js — Handler de interações da carteira
//  Migrado da source antiga (commands/carteira.js + handlers/
//  carteiraHandler.js) e adaptado à arquitetura atual do KAEL:
//    • Mesmo banco (database/carteiraDB.js) — sem duplicar dados.
//    • Roteado pelo events/buttonHandler.js (padrão de prefixo por
//      customId já usado por todo o projeto, ex.: c6-system,
//      efi-system, ticket-system).
//  Processa: select menu, botões e modal de cadastro de PIX.
// ============================================================

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  lerCarteira,
  registrarSaque,
  salvarPix,
  obterHistorico,
  obterUltimasVendas,
} = require('../database/carteiraDB');

const {
  formatarReal,
  formatarData,
  formatarDataHora,
  mascaraPix,
  embedErro,
} = require('../utils/carteiraUtils');

const CORES = require('../config/constants').CORES;
const openpixManager = require('../payment-system/openpix/openpixManager');

// ── Entry point (chamado pelo events/buttonHandler.js) ───────
// Retorna `true` se a interação foi tratada aqui, `false` caso
// contrário (deixa o buttonHandler seguir para os outros fluxos).

async function handleCarteira(interaction) {
  const { customId } = interaction;

  if (interaction.isStringSelectMenu() && customId === 'carteira_menu') {
    const opcao = interaction.values[0];
    switch (opcao) {
      case 'saldo':     await handleVerSaldo(interaction); return true;
      case 'historico': await handleHistorico(interaction); return true;
      case 'vendas':    await handleUltimasVendas(interaction); return true;
      case 'saque':     await handleSolicitarSaque(interaction); return true;
      case 'pix':       await handleConfigurarPix(interaction); return true;
    }
    return false;
  }

  if (interaction.isButton() && customId?.startsWith('carteira_')) {
    if (customId === 'carteira_voltar')      { await handleVoltar(interaction); return true; }
    if (customId === 'carteira_sacar_tudo')  { await handleSacarTudo(interaction); return true; }
    if (customId === 'carteira_alterar_pix') { await handleConfigurarPix(interaction); return true; }
    if (customId.startsWith('carteira_pix_tipo_')) { await handlePixTipo(interaction); return true; }
  }

  if (interaction.isModalSubmit() && customId === 'modal_pix_chave') {
    await handleModalPixChave(interaction);
    return true;
  }

  return false;
}

// ── Tela Principal (Voltar) ──────────────────────────────────

async function handleVoltar(interaction) {
  const guildId  = interaction.guildId;
  const carteira = lerCarteira(guildId);

  const embed = new EmbedBuilder()
    .setColor(CORES.PIX)
    .setTitle('<:money:1532503308961448096> Carteira da Loja')
    .setDescription('━━━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: '💰 Saldo Disponível', value: carteira ? formatarReal(carteira.saldo)      : 'R$ 0,00', inline: false },
      { name: '<:carrinho:1524207445600370719> Total de Vendas', value: carteira ? String(carteira.totalVendas) : '0', inline: true },
      { name: '📈 Total Recebido',   value: carteira ? formatarReal(carteira.faturamento) : 'R$ 0,00', inline: true },
      { name: '💸 Total Sacado',     value: carteira ? formatarReal(carteira.totalSacado) : 'R$ 0,00', inline: false },
      { name: '<:relogio:1524207889441357917> Última Venda', value: carteira?.ultimaVenda ? formatarData(carteira.ultimaVenda) : 'Nenhuma ainda', inline: true },
      { name: 'Status', value: '🟢 Operacional', inline: true },
    )
    .setTimestamp();

  return interaction.update({ embeds: [embed], components: [menuPrincipal()] });
}

function menuPrincipal() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('carteira_menu')
    .setPlaceholder('Selecione uma opção...')
    .addOptions([
      { label: 'Ver Saldo',            value: 'saldo',     emoji: '💰', description: 'Visualizar saldo atual' },
      { label: 'Histórico Financeiro', value: 'historico', emoji: '📜', description: 'Últimas movimentações' },
      { label: 'Últimas Vendas',       value: 'vendas',    emoji: '🛒', description: 'Vendas recentes' },
      { label: 'Solicitar Saque',      value: 'saque',     emoji: '💸', description: 'Retirar saldo disponível' },
      { label: 'Configurar PIX',       value: 'pix',       emoji: '🔑', description: 'Gerenciar chave PIX' },
    ]);
  return new ActionRowBuilder().addComponents(menu);
}

function rowVoltar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('carteira_voltar')
      .setLabel('Voltar')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );
}

// ── Opção 1 — Ver Saldo ──────────────────────────────────────

async function handleVerSaldo(interaction) {
  const carteira = lerCarteira(interaction.guildId);

  if (!carteira) {
    return interaction.update({ embeds: [embedErroCarteira()], components: [rowVoltar()] });
  }

  const embed = new EmbedBuilder()
    .setColor(CORES.PIX)
    .setTitle('💳 Saldo da Carteira')
    .setDescription('━━━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: '💰 Disponível',     value: formatarReal(carteira.saldo),      inline: false },
      { name: '📈 Total Recebido', value: formatarReal(carteira.faturamento), inline: true  },
      { name: '💸 Total Sacado',   value: formatarReal(carteira.totalSacado), inline: true  },
    )
    .setTimestamp();

  return interaction.update({ embeds: [embed], components: [rowVoltar()] });
}

// ── Opção 2 — Histórico Financeiro ──────────────────────────

async function handleHistorico(interaction) {
  const registros = obterHistorico(interaction.guildId, 10);

  const embed = new EmbedBuilder()
    .setColor(CORES.AVISO)
    .setTitle('📜 Histórico Financeiro')
    .setDescription(registros.length === 0 ? '_Nenhuma movimentação registrada ainda._' : '━━━━━━━━━━━━━━━━━━━━━━')
    .setTimestamp();

  if (registros.length > 0) {
    const linhas = registros.map(r => {
      if (r.tipo === 'VENDA') {
        return (
          `🛒 **${r.produto}**\n` +
          `💰 ${formatarReal(r.valor)}\n` +
          `👤 ${r.comprador}\n` +
          (r.provider ? `🏦 ${r.provider}\n` : '') +
          `📅 ${formatarData(r.data)}` +
          (r.vendaId ? `\n🔖 ID: \`${r.vendaId}\`` : '') +
          '\n━━━━━━━━━━━━━━'
        );
      }
      return (
        `💸 **Saque Realizado**\n` +
        `💰 ${formatarReal(r.valor)}\n` +
        `🔑 PIX: ${mascaraPix(r.pixKey)}\n` +
        `📅 ${formatarData(r.data)}\n━━━━━━━━━━━━━━`
      );
    });

    const chunks = chunkArray(linhas, 3);
    chunks.forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? 'Movimentações Recentes' : '\u200b', value: chunk.join('\n'), inline: false });
    });
  }

  return interaction.update({ embeds: [embed], components: [rowVoltar()] });
}

// ── Opção 3 — Últimas Vendas ─────────────────────────────────

async function handleUltimasVendas(interaction) {
  const vendas = obterUltimasVendas(interaction.guildId, 5);

  const embed = new EmbedBuilder()
    .setColor(CORES.SUCESSO)
    .setTitle('🛒 Últimas Vendas')
    .setDescription(vendas.length === 0 ? '_Nenhuma venda registrada ainda._' : '━━━━━━━━━━━━━━━━━━━━━━')
    .setTimestamp();

  if (vendas.length > 0) {
    vendas.forEach((v, i) => {
      embed.addFields({
        name: `Venda #${i + 1}`,
        value: `🛒 **${v.produto}**\n💰 ${formatarReal(v.valor)}\n👤 ${v.comprador}\n📅 ${formatarData(v.data)}`,
        inline: true,
      });
    });
  }

  return interaction.update({ embeds: [embed], components: [rowVoltar()] });
}

// ── Opção 4 — Solicitar Saque ────────────────────────────────

async function handleSolicitarSaque(interaction) {
  const carteira = lerCarteira(interaction.guildId);

  if (!carteira) {
    return interaction.update({ embeds: [embedErroCarteira()], components: [rowVoltar()] });
  }

  const embed = new EmbedBuilder()
    .setColor(CORES.SUCESSO)
    .setTitle('💸 Solicitação de Saque')
    .setDescription('━━━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: '💰 Saldo Disponível', value: formatarReal(carteira.saldo),           inline: false },
      { name: '🔑 Chave PIX',        value: mascaraPix(carteira.pixKey),            inline: true  },
      { name: '📅 Data',             value: formatarData(new Date().toISOString()), inline: true  },
    )
    .setTimestamp();

  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('carteira_sacar_tudo').setLabel('Sacar Tudo').setEmoji('💸').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('carteira_alterar_pix').setLabel('Alterar Chave PIX').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('carteira_voltar').setLabel('Voltar').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );

  return interaction.update({ embeds: [embed], components: [rowAcoes] });
}

// ── Botão: Sacar Tudo ────────────────────────────────────────
// TAREFA 6 (Parte 2): se o servidor já tem subconta OpenPix vinculada,
// o saque vai pelo mecanismo OFICIAL (lock → consulta saldo real →
// saque integral na OpenPix → só então zera localmente). Sem OpenPix
// vinculada, mantém o registro manual legado (MP/C6/Efi), inalterado.

async function handleSacarTudo(interaction) {
  const cfgOpenPix = openpixManager.getConfigOpenPix(interaction.guildId);

  if (cfgOpenPix.habilitado) {
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(CORES.AVISO).setTitle('⏳ Processando saque...').setDescription('Consultando saldo e solicitando o saque na OpenPix.')],
      components: [],
    });

    const resultado = await openpixManager.sacarTudo(interaction.guildId);

    if (!resultado.ok) {
      const mensagens = {
        saldo_insuficiente:   'Não há saldo disponível para saque no momento.',
        saque_ja_em_andamento:'Já existe um saque em processamento para este servidor. Aguarde.',
        openpix_nao_vinculado:'Este servidor não está vinculado à OpenPix.',
      };
      const motivo = mensagens[resultado.motivo] || `Falha ao processar o saque (${resultado.motivo}). O saldo NÃO foi alterado.`;
      return interaction.editReply({ embeds: [embedErro('❌ Saque Não Realizado', motivo)], components: [rowVoltar()] });
    }

    // Saque confirmado pela OpenPix — só agora registra localmente
    // (histórico + zera saldo), usando a mesma trava/estrutura já
    // existente (registrarSaque), sem duplicar lógica de persistência.
    const registro = registrarSaque(interaction.guildId, { origem: 'OPENPIX' });
    const carteira = lerCarteira(interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(CORES.SUCESSO)
      .setTitle('✅ Saque Realizado')
      .setDescription('Saque processado pela OpenPix com sucesso.')
      .addFields(
        { name: '💰 Valor Sacado', value: formatarReal(resultado.valorCentavos / 100), inline: false },
        { name: '🔑 PIX',          value: mascaraPix(cfgOpenPix.pixKey),                inline: true  },
        { name: '📅 Data',         value: formatarDataHora(new Date().toISOString()),   inline: true  },
        { name: '💳 Saldo Atual',  value: formatarReal(carteira?.saldo ?? 0),           inline: false },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed], components: [rowVoltar()] });
  }

  // ── Fallback legado (sem OpenPix vinculada) — inalterado ──────────
  const resultado = registrarSaque(interaction.guildId);

  if (!resultado.sucesso) {
    return interaction.update({ embeds: [embedErro('❌ Saque Não Realizado', resultado.motivo)], components: [rowVoltar()] });
  }

  const carteira = lerCarteira(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(CORES.SUCESSO)
    .setTitle('✅ Solicitação Registrada')
    .setDescription('Seu pedido de saque foi registrado com sucesso.')
    .addFields(
      { name: '💰 Valor Sacado', value: formatarReal(resultado.valor),      inline: false },
      { name: '🔑 PIX',          value: mascaraPix(resultado.pixKey),       inline: true  },
      { name: '📅 Data',         value: formatarDataHora(resultado.data),   inline: true  },
      { name: '💳 Saldo Atual',  value: formatarReal(carteira?.saldo ?? 0), inline: false },
    )
    .setTimestamp();

  return interaction.update({ embeds: [embed], components: [rowVoltar()] });
}

// ── Opção 5 — Configurar PIX ─────────────────────────────────

async function handleConfigurarPix(interaction) {
  const carteira = lerCarteira(interaction.guildId);
  const cfgOpenPix = openpixManager.getConfigOpenPix(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(CORES.PRIMARIA)
    .setTitle('🔑 Configuração PIX')
    .setDescription(
      cfgOpenPix.habilitado
        ? 'Este servidor já está vinculado à OpenPix.\n\n⚠️ A documentação oficial não expõe um endpoint para alterar a chave PIX de uma subconta já criada — por isso, a partir daqui, só é possível **atualizar o PIX exibido localmente** (não altera a subconta OpenPix). Fale com o suporte da Kael para trocar a chave vinculada à OpenPix.'
        : 'Selecione o tipo da chave PIX:'
    )
    .addFields(
      { name: '🔑 Chave Atual', value: mascaraPix(carteira?.pixKey),        inline: true },
      { name: '📌 Tipo',        value: carteira?.pixType || 'Não definido', inline: true },
    )
    .setTimestamp();

  const rowTipos = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('carteira_pix_tipo_EMAIL').setLabel('E-mail').setEmoji('📧').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_TELEFONE').setLabel('Telefone').setEmoji('📱').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_CPF').setLabel('CPF').setEmoji('🆔').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_ALEATORIA').setLabel('Chave Aleatória').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
  );

  return interaction.update({ embeds: [embed], components: [rowTipos, rowVoltar()] });
}

// ── Botão: Tipo de PIX → abre modal ─────────────────────────

async function handlePixTipo(interaction) {
  const tipo = interaction.customId.replace('carteira_pix_tipo_', '');

  const modal = new ModalBuilder().setCustomId('modal_pix_chave').setTitle(`PIX — ${tipo}`);

  const inputChave = new TextInputBuilder()
    .setCustomId('pix_chave_input')
    .setLabel(`Informe sua chave PIX (${tipo})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholderPorTipo(tipo))
    .setRequired(true)
    .setMaxLength(100);

  const inputTipo = new TextInputBuilder()
    .setCustomId('pix_tipo_input')
    .setLabel('Tipo (não altere)')
    .setStyle(TextInputStyle.Short)
    .setValue(tipo)
    .setRequired(true)
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputChave),
    new ActionRowBuilder().addComponents(inputTipo),
  );

  return interaction.showModal(modal);
}

// ── Modal: Salvar PIX e atualizar embed automaticamente ──────

async function handleModalPixChave(interaction) {
  const chave = interaction.fields.getTextInputValue('pix_chave_input').trim();
  const tipo  = interaction.fields.getTextInputValue('pix_tipo_input').trim().toUpperCase();

  salvarPix(interaction.guildId, tipo, chave);

  // TAREFA 2 (Parte 2): 1º cadastro de PIX neste servidor → cria o
  // vínculo (subconta) na OpenPix, se a integração estiver configurada
  // nesta instância e o servidor ainda não tiver subconta. Se já
  // houver vínculo, `vincularServidor` não faz nada (não existe
  // endpoint oficial de troca de chave numa subconta já criada).
  let avisoOpenPix = null;
  if (openpixManager.appConfigurado()) {
    const resultado = await openpixManager.vincularServidor(interaction.guildId, { pixKey: chave, pixType: tipo, nomeServidor: interaction.guild?.name });
    if (!resultado.ok && resultado.motivo !== 'já_vinculado') {
      avisoOpenPix = `⚠️ PIX salvo localmente, mas o vínculo com a OpenPix falhou: ${resultado.motivo}`;
    }
  }

  const carteira = lerCarteira(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(CORES.PRIMARIA)
    .setTitle('🔑 Configuração PIX')
    .setDescription(avisoOpenPix || '✅ PIX atualizado com sucesso.')
    .addFields(
      { name: '🔑 Chave Atual', value: mascaraPix(carteira?.pixKey), inline: true },
      { name: '📌 Tipo',        value: carteira?.pixType || tipo,    inline: true },
    )
    .setTimestamp();

  const rowTipos = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('carteira_pix_tipo_EMAIL').setLabel('E-mail').setEmoji('📧').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_TELEFONE').setLabel('Telefone').setEmoji('📱').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_CPF').setLabel('CPF').setEmoji('🆔').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('carteira_pix_tipo_ALEATORIA').setLabel('Chave Aleatória').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
  );

  return interaction.update({ embeds: [embed], components: [rowTipos, rowVoltar()] });
}

// ── Embed de erro para carteira vazia ────────────────────────
function embedErroCarteira() {
  return new EmbedBuilder()
    .setColor(0xE50000)
    .setTitle('❌ Carteira Não Encontrada')
    .setDescription('Ainda não existem registros financeiros neste servidor.\n\nRealize uma venda para iniciar sua carteira.')
    .setTimestamp();
}

// ── Utils internos ───────────────────────────────────────────

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function placeholderPorTipo(tipo) {
  switch (tipo) {
    case 'CPF':      return '000.000.000-00';
    case 'EMAIL':    return 'seuemail@exemplo.com';
    case 'TELEFONE': return '+55 11 99999-9999';
    default:         return 'Cole sua chave aleatória aqui';
  }
}

module.exports = { handleCarteira };
