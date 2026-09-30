/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — utils/painelUpdater.js
 *  Atualizador GLOBAL de painéis/embeds.
 *
 *  Ideia central: cada painel do sistema (Loja, Produtos, Variantes,
 *  Estoque, Cupons, Sorteios, Painel Principal, Painel Admin,
 *  Definições, Bancos/EFI/Mercado Pago, Pix, Canais, Cargos, Logs,
 *  Tickets, Entrega, Proteção, Blacklist, Licenças, e qualquer tela
 *  futura) se REGISTRA aqui UMA vez, dizendo "quando alguém pedir pra
 *  me atualizar, é assim que eu reconstruo minha embed/components a
 *  partir do banco". Depois disso, atualizar aquele painel de
 *  qualquer lugar do código é sempre a mesma chamada de uma linha.
 *
 *  Este arquivo NUNCA sabe o que tem dentro de cada painel — ele só
 *  sabe COMO entregar o resultado (editando a mensagem/interação
 *  existente, nunca criando uma nova). Quem sabe montar o conteúdo de
 *  cada painel continua sendo o próprio arquivo daquele sistema
 *  (produto.js, sorteioManager.js, etc.) — evitando duplicar lógica
 *  de negócio aqui.
 *
 *  Regra de ouro: NUNCA cria mensagem nova. Sempre:
 *    • interaction.update(...)   — quando a origem é um componente
 *      (botão/select) que ainda não foi respondido.
 *    • interaction.editReply(...) — quando a interação já foi
 *      deferida/respondida (ex.: depois de um deferUpdate()).
 *    • message.edit(...)          — quando o alvo é uma Message já
 *      existente (ex.: uma vitrine pública postada há dias, ou uma
 *      atualização disparada por um cron/job sem interação nenhuma).
 * ─────────────────────────────────────────────────────────────────
 */

// ── 1. REGISTRO DE PAINÉIS ────────────────────────────────────────
// Map<nomeDoPainel, async function(...args) => payload>
// `payload` é sempre um objeto pronto pro Discord.js: pode ter
// { embeds, components, content, files, flags } — cada painel decide
// o que ele usa.
const registro = new Map();

/**
 * Registra (ou substitui) o "builder" de um painel.
 * @param {string} nome - identificador único do painel (ex.: 'produto', 'sorteio', 'painel_principal').
 * @param {(...args: any[]) => Promise<object> | object} builderFn - função que recebe os
 *   mesmos argumentos passados em `atualizar(..., nome, ...args)` e devolve o payload novo.
 */
function registrar(nome, builderFn) {
  if (typeof builderFn !== 'function') {
    throw new Error(`[painelUpdater] O builder de "${nome}" precisa ser uma função.`);
  }
  registro.set(nome, builderFn);
}

/** Remove o registro de um painel (raramente necessário — só se um sistema inteiro for desativado). */
function desregistrar(nome) {
  registro.delete(nome);
}

/** Lista os nomes de painéis já registrados (útil para debug). */
function listarPaineisRegistrados() {
  return Array.from(registro.keys());
}

// ── 2. RESOLUÇÃO DO PAYLOAD ───────────────────────────────────────
async function construirPayload(nome, args) {
  const builderFn = registro.get(nome);
  if (!builderFn) {
    throw new Error(
      `[painelUpdater] Nenhum painel registrado com o nome "${nome}". ` +
      `Painéis disponíveis: ${listarPaineisRegistrados().join(', ') || '(nenhum)'}.`
    );
  }
  const payload = await builderFn(...args);
  if (!payload || typeof payload !== 'object') {
    throw new Error(`[painelUpdater] O builder de "${nome}" não retornou um payload válido.`);
  }
  return payload;
}

// ── 3. APLICAÇÃO DO PAYLOAD (edita, nunca cria) ───────────────────
async function aplicarPayload(alvo, payload) {
  // Interação de componente (botão/select) ainda não respondida —
  // edita a própria mensagem que carrega o componente.
  if (alvo && typeof alvo.isMessageComponent === 'function' && alvo.isMessageComponent() && !alvo.deferred && !alvo.replied) {
    return alvo.update(payload);
  }

  // Qualquer interação já deferida/respondida (deferUpdate, deferReply,
  // reply anterior, ou uma ChatInputCommandInteraction/ModalSubmit que
  // já passou por defer) — edita a resposta já existente.
  if (alvo && (alvo.deferred || alvo.replied) && typeof alvo.editReply === 'function') {
    return alvo.editReply(payload);
  }

  // Interação que ainda não foi respondida de forma nenhuma (raro
  // chegar aqui pra "atualizar", mas cobre o caso defensivamente) —
  // ainda assim tenta reply, nunca cria uma segunda mensagem depois.
  if (alvo && typeof alvo.reply === 'function' && !alvo.replied && !alvo.deferred) {
    return alvo.reply(payload);
  }

  // Message.js (mensagem já existente no canal — vitrine pública,
  // painel fixado, atualização vinda de um cron/job sem interação).
  if (alvo && typeof alvo.edit === 'function') {
    return alvo.edit(payload);
  }

  throw new Error('[painelUpdater] Alvo inválido: não é uma Interaction nem uma Message editável.');
}

// ── 4. API PRINCIPAL ──────────────────────────────────────────────
/**
 * Atualiza QUALQUER painel já registrado, editando a mensagem/interação
 * existente (nunca cria uma nova). Uso típico, de qualquer arquivo:
 *
 *   const { atualizar } = require('../utils/painelUpdater');
 *   await atualizar(interaction, 'produto', interaction.guildId, produtoId);
 *
 * @param {import('discord.js').Interaction | import('discord.js').Message} alvo
 * @param {string} nome - nome do painel (o mesmo usado em `registrar`).
 * @param {...any} args - argumentos repassados ao builder daquele painel.
 */
async function atualizar(alvo, nome, ...args) {
  const payload = await construirPayload(nome, args);
  return aplicarPayload(alvo, payload);
}

/**
 * Igual a `atualizar`, mas quando você não tem a Interaction em mãos
 * (ex.: dentro de um cron/scheduler, de um webhook, ou depois que o
 * canal/mensagem original já foi fechado) — só o client + IDs. Busca a
 * mensagem existente e edita ela. Nunca cria uma nova; se a mensagem
 * não existir mais, retorna null silenciosamente (não é um erro do
 * atualizador, é só um painel que já não existe mais no Discord).
 *
 *   const { atualizarPorReferencia } = require('../utils/painelUpdater');
 *   await atualizarPorReferencia(client, guildId, canalId, mensagemId, 'produto', guildId, produtoId);
 */
async function atualizarPorReferencia(client, guildId, canalId, mensagemId, nome, ...args) {
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const canal = guild.channels.cache.get(canalId) || await guild.channels.fetch(canalId).catch(() => null);
    if (!canal?.isTextBased?.()) return null;
    const mensagem = await canal.messages.fetch(mensagemId).catch(() => null);
    if (!mensagem) return null;

    const payload = await construirPayload(nome, args);
    return mensagem.edit(payload);
  } catch (e) {
    console.error(`[painelUpdater] Erro ao atualizar painel "${nome}" por referência:`, e.message);
    return null;
  }
}

module.exports = {
  registrar,
  desregistrar,
  listarPaineisRegistrados,
  atualizar,
  atualizarPorReferencia,
  criarBotaoAtualizar,
  handleBotaoAtualizar,
};

// ── 5. BOTÃO GLOBAL "<:xpooo:1523791736948920433> Atualizar Painel" ─────────────────────────
// Convenção única para TODOS os painéis administrativos: o builder
// registrado em `registrar(nome, fn)` deve aceitar sempre
// `fn(guildId, guild, ...extras)` como assinatura — os dois primeiros
// argumentos o botão já sabe preencher sozinho (vêm da própria
// interação), e `...extras` são só os IDs extras que aquele painel
// específico precisar (ex.: produtoId, cupomId, sorteioId...).
const PREFIXO_REFRESH = 'painel_refresh::';

/**
 * Cria o botão "<:xpooo:1523791736948920433> Atualizar Painel" pra qualquer painel já registrado.
 * Uso, dentro do arquivo que já monta os componentes daquele painel:
 *
 *   const { criarBotaoAtualizar } = require('../utils/painelUpdater');
 *   row.addComponents(criarBotaoAtualizar('produto', produtoId));
 *
 * @param {string} nome - nome do painel (o mesmo usado em `registrar`).
 * @param {...(string|number)} extras - IDs extras que o builder daquele painel precisa (opcional).
 */
function criarBotaoAtualizar(nome, ...extras) {
  const { ButtonBuilder, ButtonStyle } = require('discord.js');
  const customId = [PREFIXO_REFRESH + nome, ...extras].join('::').slice(0, 100);
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel('Atualizar Painel')
    .setEmoji('<:xpooo:1523791736948920433>')
    .setStyle(ButtonStyle.Secondary);
}

// Trava por mensagem: se o clique já está em andamento pra esta
// mensagem específica, ignora cliques extras até terminar — evita que
// clique duplo/spam dispare duas atualizações concorrentes (que
// poderiam gerar "message has already been acknowledged" ou, em algum
// fluxo futuro que crie mensagem em vez de editar, duplicar embeds).
const emAndamento = new Set();

/**
 * Handler genérico do botão "<:xpooo:1523791736948920433> Atualizar Painel". Registre isto UMA
 * vez no seu roteador de botões (buttonHandler.js) para qualquer
 * customId que comece com "painel_refresh::" — nenhum painel precisa
 * de handler de botão próprio pra isso.
 */
async function handleBotaoAtualizar(interaction) {
  const [, resto] = interaction.customId.split(PREFIXO_REFRESH);
  const [nome, ...extras] = resto.split('::');

  const chaveMensagem = interaction.message?.id || `${interaction.channelId}:${interaction.user.id}`;
  if (emAndamento.has(chaveMensagem)) {
    // Já tem uma atualização rodando pra esta mensagem — ignora
    // silenciosamente este clique extra (sem novo reply, sem duplicar nada).
    return interaction.deferUpdate().catch(() => {});
  }

  emAndamento.add(chaveMensagem);
  try {
    await atualizar(interaction, nome, interaction.guildId, interaction.guild, ...extras);
  } catch (e) {
    console.error(`[painelUpdater] Erro ao atualizar painel "${nome}" via botão:`, e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `<:negativo:1528400986744295475> Não foi possível atualizar este painel: ${e.message}`, flags: 64 }).catch(() => {});
    }
  } finally {
    emAndamento.delete(chaveMensagem);
  }
}
