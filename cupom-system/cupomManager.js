// ═══════════════════════════════════════════════════════════════════════════
//  cupomManager.js — Sistema de Cupons Avançados (Components V2)
//  Módulo NOVO e independente.
// ═══════════════════════════════════════════════════════════════════════════
//
//  Opera sempre sobre `produto.cupons` — a MESMA estrutura já lida por
//  commands/produto.js e sales-system/salesManager.js no checkout. Nenhuma
//  migração de dados é necessária; os campos novos são todos opcionais e
//  cupons antigos (só `{ desconto, usos }`) continuam funcionando 100%.
//
//  Novo shape de um cupom:
//  {
//    desconto: number,            // % — usado quando tipo === 'percentual'
//    tipo: 'percentual' | 'fixo',
//    valorFixo: number,           // R$ — usado quando tipo === 'fixo'
//    usos: number,
//    usosMaximos: number|null,    // null = ilimitado
//    cargoObrigatorioId: string|null,
//    valorMinimo: number|null,
//    valorMaximo: number|null,
//    validoAte: string|null (ISO),
//    criadoEm: string (ISO), criadoPor: string,
//  }
// ═══════════════════════════════════════════════════════════════════════════

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db = require('../database/db');
const { precoParaFloat, floatParaPreco } = require('../sales-system/salesManager');

const COR = { GOLD: 0xFFD700, SUCCESS: 0x57F287, DANGER: 0xED4245 };

// Rascunhos de criação em 2 etapas (modal → seleção opcional de cargo).
// Em memória, por admin — se o bot reiniciar no meio da criação, o admin
// só refaz `/cupom` → Criar Cupom. Não precisa persistir em disco.
const rascunhos = new Map();
function chaveRascunho(guildId, userId) { return `${guildId}_${userId}`; }

// ─────────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────────────────────────
function errContainer(texto) {
  return {
    components: [new ContainerBuilder().setAccentColor(COR.DANGER).addTextDisplayComponents(new TextDisplayBuilder().setContent(texto))],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

function botaoVoltar() {
  return new ButtonBuilder().setCustomId('cup_painel_voltar').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary);
}

/** Aceita "20%" (percentual) ou "15" / "R$15,50" (valor fixo). */
function parseDescontoInput(valorDigitado) {
  const limpo = (valorDigitado || '').trim();
  if (limpo.endsWith('%')) {
    const num = parseFloat(limpo.slice(0, -1).replace(',', '.'));
    if (isNaN(num) || num <= 0 || num > 100) return null;
    return { tipo: 'percentual', valor: num };
  }
  const num = precoParaFloat(limpo.toUpperCase().startsWith('R$') ? limpo : `R$ ${limpo}`);
  if (isNaN(num) || num <= 0) return null;
  return { tipo: 'fixo', valor: num };
}

/** Aceita "10-100" (mín-máx em R$), "-100" (só máx), "10-" (só mín), ou vazio. */
function parseMinMax(valorDigitado) {
  const limpo = (valorDigitado || '').trim();
  if (!limpo) return { min: null, max: null };
  const [minStr, maxStr] = limpo.split('-').map(s => s.trim());
  const parse = (s) => {
    if (!s) return null;
    const num = precoParaFloat(s.toUpperCase().startsWith('R$') ? s : `R$ ${s}`);
    return isNaN(num) ? null : num;
  };
  return { min: parse(minStr), max: parse(maxStr) };
}

// ─────────────────────────────────────────────────────────────
//  DB HELPERS (sempre em cima de produto.cupons)
// ─────────────────────────────────────────────────────────────
function getCupons(guildId, produtoId) {
  return db.getProdutoPorId(guildId, produtoId)?.cupons || {};
}

function salvarCupons(guildId, produtoId, cupons) {
  db.atualizarProduto(guildId, produtoId, 'cupons', cupons);
}

function criarCupom(guildId, produtoId, codigo, dados) {
  const cupons = getCupons(guildId, produtoId);
  cupons[codigo] = {
    desconto: dados.tipo === 'percentual' ? dados.valor : 0,
    tipo: dados.tipo,
    valorFixo: dados.tipo === 'fixo' ? dados.valor : 0,
    usos: 0,
    usosMaximos: dados.usosMaximos ?? null,
    cargoObrigatorioId: dados.cargoObrigatorioId ?? null,
    valorMinimo: dados.valorMinimo ?? null,
    valorMaximo: dados.valorMaximo ?? null,
    validoAte: dados.validoAte ?? null,
    criadoEm: new Date().toISOString(),
    criadoPor: dados.criadoPor,
  };
  salvarCupons(guildId, produtoId, cupons);
  return cupons[codigo];
}

function removerCupom(guildId, produtoId, codigo) {
  const cupons = getCupons(guildId, produtoId);
  if (!cupons[codigo]) return false;
  delete cupons[codigo];
  salvarCupons(guildId, produtoId, cupons);
  return true;
}

/** Chamado no mesmo instante em que o cupom é aplicado no carrinho —
 * preserva o timing exato de incremento que o KAEL já usava antes
 * deste sistema existir (não espera a confirmação do pagamento). */
function registrarUso(guildId, produtoId, codigo) {
  const cupons = getCupons(guildId, produtoId);
  if (!cupons[codigo]) return;
  cupons[codigo].usos = (cupons[codigo].usos || 0) + 1;
  salvarCupons(guildId, produtoId, cupons);
}

/**
 * Valida um cupom no momento em que o cliente tenta aplicá-lo no carrinho.
 * NÃO incrementa o uso — isso é feito por registrarUso() separadamente.
 */
function validarCupom({ guildId, produtoId, codigo, member, valorCompra }) {
  const cupom = getCupons(guildId, produtoId)[codigo];
  if (!cupom) return { ok: false, motivo: `O código \`${codigo}\` não existe ou expirou.` };

  if (cupom.validoAte && new Date(cupom.validoAte).getTime() < Date.now()) {
    return { ok: false, motivo: `O cupom \`${codigo}\` expirou.` };
  }
  if (cupom.usosMaximos != null && (cupom.usos || 0) >= cupom.usosMaximos) {
    return { ok: false, motivo: `O cupom \`${codigo}\` já atingiu o limite de usos.` };
  }
  if (cupom.cargoObrigatorioId && member && !member.roles.cache.has(cupom.cargoObrigatorioId)) {
    return { ok: false, motivo: `Este cupom exige o cargo <@&${cupom.cargoObrigatorioId}> para ser usado.` };
  }
  if (cupom.valorMinimo != null && valorCompra < cupom.valorMinimo) {
    return { ok: false, motivo: `Este cupom exige uma compra de no mínimo **${floatParaPreco(cupom.valorMinimo)}**.` };
  }
  if (cupom.valorMaximo != null && valorCompra > cupom.valorMaximo) {
    return { ok: false, motivo: `Este cupom só é válido para compras de até **${floatParaPreco(cupom.valorMaximo)}**.` };
  }
  return { ok: true, cupom };
}

// ─────────────────────────────────────────────────────────────
//  BUILDERS DE CONTAINER (Components V2)
// ─────────────────────────────────────────────────────────────
function buildPainelContainer(guildId, produtoId, statusMsg = null) {
  const produto = db.getProdutoPorId(guildId, produtoId);
  const total = Object.keys(getCupons(guildId, produtoId)).length;

  const container = new ContainerBuilder().setAccentColor(COR.GOLD);
  if (statusMsg) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusMsg));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## <:cupom:1524209015008002148> Cupons — ${produto?.titulo || 'Produto Ativo'}\n` +
    `> Desconto percentual ou valor fixo, com cargo obrigatório, validade, valor mínimo/máximo e limite de usos.\n\n` +
    `**Cupons ativos:** \`${total}\``
  ));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cup_modal_criar').setLabel('Criar Cupom').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cup_listar').setLabel('Ver Cupons').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
  ));
  return container;
}

function buildListaContainer(guildId, produtoId) {
  const entradas = Object.entries(getCupons(guildId, produtoId));
  const container = new ContainerBuilder().setAccentColor(COR.GOLD);
  if (entradas.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('> Nenhum cupom criado para este produto ainda.'));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
    return container;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## <:embed:1528400492982571111> Cupons deste Produto\n> Selecione um para ver detalhes ou apagar.'));
  const select = new StringSelectMenuBuilder().setCustomId('cup_sel_cupom').setPlaceholder('Selecione um cupom...')
    .addOptions(entradas.slice(0, 25).map(([codigo, c]) => ({
      label: codigo,
      description: `${c.tipo === 'fixo' ? `-${floatParaPreco(c.valorFixo)}` : `-${c.desconto}%`} • usos: ${c.usos || 0}${c.usosMaximos != null ? '/' + c.usosMaximos : ''}`.slice(0, 100),
      value: codigo,
    })));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
  return container;
}

function buildDetalheContainer(codigo, cupom) {
  return new ContainerBuilder()
    .setAccentColor(COR.GOLD)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## <:cupom:1524209015008002148> Cupom \`${codigo}\`\n` +
      `**Tipo:** ${cupom.tipo === 'fixo' ? `Valor fixo (${floatParaPreco(cupom.valorFixo)})` : `Percentual (${cupom.desconto}%)`}\n` +
      `**Usos:** \`${cupom.usos || 0}${cupom.usosMaximos != null ? '/' + cupom.usosMaximos : ' (ilimitado)'}\`\n` +
      `**Cargo obrigatório:** ${cupom.cargoObrigatorioId ? `<@&${cupom.cargoObrigatorioId}>` : 'Nenhum'}\n` +
      `**Valor mínimo:** ${cupom.valorMinimo != null ? floatParaPreco(cupom.valorMinimo) : 'Sem mínimo'}\n` +
      `**Valor máximo:** ${cupom.valorMaximo != null ? floatParaPreco(cupom.valorMaximo) : 'Sem máximo'}\n` +
      `**Validade:** ${cupom.validoAte ? `<t:${Math.floor(new Date(cupom.validoAte).getTime() / 1000)}:D>` : 'Sem validade'}`
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cup_apagar_${codigo}`).setLabel('Apagar Cupom').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
      botaoVoltar(),
    ));
}

// ─────────────────────────────────────────────────────────────
//  HANDLERS
// ─────────────────────────────────────────────────────────────
async function showAdminPanel(interaction) {
  const produtoId = db.getProdutoAtivoId(interaction.guildId);
  if (!produtoId) return interaction.reply(errContainer('<:negativo:1528400986744295475> Nenhum produto ativo. Use `/produto criar` e selecione um produto antes de gerenciar cupons.'));
  await interaction.reply({ components: [buildPainelContainer(interaction.guildId, produtoId)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function abrirModalCriar(interaction) {
  try {
    const produtoId = db.getProdutoAtivoId(interaction.guildId);
    if (!produtoId) return interaction.reply(errContainer('<:negativo:1528400986744295475> Nenhum produto ativo.'));

    const modal = new ModalBuilder().setCustomId('cup_modal_criar_submit').setTitle('Criar Cupom de Desconto');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('codigo').setLabel('Código do Cupom').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true).setPlaceholder('Ex: BLACKFRIDAY')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desconto').setLabel('Desconto: 20% (percentual) ou 15 (fixo R$)').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('usosMaximos').setLabel('Limite de usos (vazio = ilimitado)').setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('validadeDias').setLabel('Validade em dias (vazio = sem validade)').setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minmax').setLabel('Compra mín-máx em R$ (ex: 10-100)').setStyle(TextInputStyle.Short).setMaxLength(30).setRequired(false)),
    );
    return interaction.showModal(modal);
  } catch (error) {
    console.error('[CUPOM/CRIAR] Erro ao abrir modal:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errContainer('<:negativo:1528400986744295475> Não foi possível abrir a criação de cupom. Tente novamente.'));
    }
  }
}

async function processarModalCriar(interaction) {
  try {
    const produtoId = db.getProdutoAtivoId(interaction.guildId);
    if (!produtoId) return interaction.reply(errContainer('<:negativo:1528400986744295475> Nenhum produto ativo.'));

    const codigo = interaction.fields.getTextInputValue('codigo').toUpperCase().trim();
    if (!codigo) return interaction.reply(errContainer('<:negativo:1528400986744295475> Código inválido.'));
    if (getCupons(interaction.guildId, produtoId)[codigo]) {
      return interaction.reply(errContainer(`<:negativo:1528400986744295475> Já existe um cupom com o código \`${codigo}\` neste produto.`));
    }

    const descontoParsed = parseDescontoInput(interaction.fields.getTextInputValue('desconto'));
    if (!descontoParsed) return interaction.reply(errContainer('<:negativo:1528400986744295475> Desconto inválido. Use algo como `20%` (percentual) ou `15` (valor fixo em R$).'));

    const usosMaximosInput = interaction.fields.getTextInputValue('usosMaximos').trim();
    const usosMaximos = usosMaximosInput ? parseInt(usosMaximosInput, 10) : null;
    if (usosMaximos != null && (isNaN(usosMaximos) || usosMaximos <= 0)) return interaction.reply(errContainer('<:negativo:1528400986744295475> Limite de usos inválido.'));

    const validadeDiasInput = interaction.fields.getTextInputValue('validadeDias').trim();
    let validoAte = null;
    if (validadeDiasInput) {
      const dias = parseInt(validadeDiasInput, 10);
      if (isNaN(dias) || dias <= 0) return interaction.reply(errContainer('<:negativo:1528400986744295475> Validade em dias inválida.'));
      validoAte = new Date(Date.now() + dias * 86400000).toISOString();
    }

    const { min, max } = parseMinMax(interaction.fields.getTextInputValue('minmax'));

    rascunhos.set(chaveRascunho(interaction.guildId, interaction.user.id), {
      produtoId, codigo, tipo: descontoParsed.tipo, valor: descontoParsed.valor,
      usosMaximos, validoAte, valorMinimo: min, valorMaximo: max,
      cargoObrigatorioId: null, criadoPor: interaction.user.id,
    });

    const container = new ContainerBuilder()
      .setAccentColor(COR.GOLD)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## <:user:1532137085081878558> Cargo Obrigatório (opcional)\n` +
        `Quer exigir que o cliente tenha um cargo específico para usar o cupom \`${codigo}\`?\n` +
        `Selecione um cargo abaixo, ou clique em "Sem restrição" para pular esta etapa.`
      ))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('cup_sel_cargo_draft').setPlaceholder('Selecione um cargo...')
      ))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cup_sem_cargo_draft').setLabel('Sem restrição de cargo').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success)
      ));

    return interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  } catch (error) {
    console.error('[CUPOM/CRIAR] Erro ao processar criação:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errContainer('<:negativo:1528400986744295475> Não foi possível criar o cupom. Tente novamente.'));
    }
  }
}

async function finalizarCriacao(interaction, rascunho) {
  const cupom = criarCupom(interaction.guildId, rascunho.produtoId, rascunho.codigo, rascunho);
  rascunhos.delete(chaveRascunho(interaction.guildId, interaction.user.id));
  const resumo =
    `<:positivo:1528401238197276702> Cupom \`${rascunho.codigo}\` criado!\n\n` +
    `**Tipo:** ${cupom.tipo === 'fixo' ? `Valor fixo (${floatParaPreco(cupom.valorFixo)})` : `Percentual (${cupom.desconto}%)`}\n` +
    `**Cargo obrigatório:** ${cupom.cargoObrigatorioId ? `<@&${cupom.cargoObrigatorioId}>` : 'Nenhum'}`;
  return interaction.update({
    components: [buildPainelContainer(interaction.guildId, rascunho.produtoId, resumo)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function handleSelectMenu(interaction) {
  try {
    if (interaction.customId === 'cup_sel_cupom') {
      const produtoId = db.getProdutoAtivoId(interaction.guildId);
      const codigo = interaction.values[0];
      const cupom = getCupons(interaction.guildId, produtoId)[codigo];
      if (!cupom) return interaction.update(errContainer('<:negativo:1528400986744295475> Este cupom não existe mais.'));
      return interaction.update({ components: [buildDetalheContainer(codigo, cupom)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }
    if (interaction.customId === 'cup_sel_cargo_draft') {
      const rascunho = rascunhos.get(chaveRascunho(interaction.guildId, interaction.user.id));
      if (!rascunho) return interaction.update(errContainer('<:negativo:1528400986744295475> Sessão de criação expirada. Use `/cupom` novamente.'));
      rascunho.cargoObrigatorioId = interaction.values[0];
      return finalizarCriacao(interaction, rascunho);
    }
  } catch (error) {
    console.error('[CUPOM/SELECT] Erro ao processar select menu:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errContainer('<:negativo:1528400986744295475> Não foi possível processar essa seleção. Tente novamente.'));
    }
  }
}

async function handleButton(interaction) {
  try {
    const customId = interaction.customId;

    if (customId === 'cup_painel_voltar') {
      const produtoId = db.getProdutoAtivoId(interaction.guildId);
      return interaction.update({ components: [buildPainelContainer(interaction.guildId, produtoId)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }
    if (customId === 'cup_modal_criar') return abrirModalCriar(interaction);
    if (customId === 'cup_listar') {
      const produtoId = db.getProdutoAtivoId(interaction.guildId);
      return interaction.update({ components: [buildListaContainer(interaction.guildId, produtoId)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }
    if (customId === 'cup_sem_cargo_draft') {
      const rascunho = rascunhos.get(chaveRascunho(interaction.guildId, interaction.user.id));
      if (!rascunho) return interaction.update(errContainer('<:negativo:1528400986744295475> Sessão de criação expirada. Use `/cupom` novamente.'));
      return finalizarCriacao(interaction, rascunho);
    }
    if (customId.startsWith('cup_apagar_')) {
      const codigo = customId.replace('cup_apagar_', '');
      const produtoId = db.getProdutoAtivoId(interaction.guildId);
      removerCupom(interaction.guildId, produtoId, codigo);
      return interaction.update({
        components: [buildPainelContainer(interaction.guildId, produtoId, `<:apagar:1524206738885050388> Cupom \`${codigo}\` removido.`)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
    }
  } catch (error) {
    console.error('[CUPOM/BOTAO] Erro ao processar botão:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errContainer('<:negativo:1528400986744295475> Não foi possível processar esse botão. Tente novamente.'));
    }
  }
}

async function handleModal(interaction) {
  try {
    if (interaction.customId === 'cup_modal_criar_submit') return processarModalCriar(interaction);
  } catch (error) {
    console.error('[CUPOM/MODAL] Erro ao processar modal:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errContainer('<:negativo:1528400986744295475> Não foi possível processar esse formulário. Tente novamente.'));
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  showAdminPanel, handleButton, handleSelectMenu, handleModal,
  // Usados por commands/produto.js no momento de aplicar o cupom no carrinho
  validarCupom, registrarUso, getCupons,
};
