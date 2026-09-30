// ═══════════════════════════════════════════════════════════════════════
// database/db.js
//
// CAMADA DE PERSISTÊNCIA — migrada de arquivo único JSON para SQLite
// (better-sqlite3, via database/sqliteDb.js).
//
// IMPORTANTE: este arquivo mantém EXATAMENTE as mesmas funções e
// assinaturas que o resto do projeto já usa (getGuild, setGuild,
// updateGuild, getProdutos, criarProduto, atualizarProduto,
// deletarProduto, getProdutoAtivoId, setProdutoAtivoId,
// migrarLojaSeNecessario, getLicense/setLicense/removeLicense/hasLicense,
// e todas as funções de sorteios/backup/assinaturas). Nenhum outro
// arquivo do projeto (produto.js, salesManager.js, cupomManager.js,
// sorteioManager.js, backupManager.js, assinaturaManager.js,
// ticketManager.js, etc.) precisa ser alterado.
//
// O QUE MUDOU POR BAIXO DOS PANOS:
//  - `loja.produtos[]` (e variantes/estoque/cupons dentro de cada
//    produto) agora vive em tabelas relacionais próprias no SQLite
//    (ver database/sqliteDb.js), em vez de dentro do blob JSON —
//    é o dado de maior volume/frequência de escrita (aplicar cupom,
//    editar produto, adicionar estoque, criar/editar variante).
//  - Todo o restante de `guild.*` (pix, logs, config, blacklist,
//    sorteios, backups, assinaturas, ticketConfig, e os campos legados
//    de loja — loja.produto/variantes/estoque/cupons singulares,
//    loja.efibank, loja.mercadopago, loja.definicoes, etc.) continua
//    sendo um blob JSON — só que agora uma linha por guild no SQLite,
//    em vez de um arquivo inteiro reescrito a cada operação.
//
// Isso significa: uma escrita em UMA guild não trava/reescreve o
// registro de nenhuma outra guild — diferente do JSON antigo, que
// serializava o arquivo inteiro (todas as guilds) a cada save().
// ═══════════════════════════════════════════════════════════════════════

const path = require('path');
const sqliteDb = require('./sqliteDb');

// Símbolo interno (nunca aparece em JSON.stringify/Object.keys/for...in)
// usado só para o `save()` conseguir recuperar, a partir do proxy
// retornado por `load()`, quais guilds foram tocadas nesta "sessão" e
// devem ser persistidas de volta. Ver explicação da função load() abaixo.
const META = Symbol('guildsProxyMeta');

// ─────────────────────────────────────────────────────────────────────
// load() / save() — mantidas com a MESMA assinatura/formato de sempre
// ({ guilds: {...}, licenses: {} }), pois algumas funções deste arquivo
// (sorteios, backup, assinaturas, updateGuild, migrarLojaSeNecessario)
// usam esse padrão: `const dbData = load(); ... mutar ...; save(dbData);`
//
// Implementação: `load()` devolve um objeto cujo `.guilds` é um Proxy.
// Acessar `dbData.guilds[guildId]` materializa aquela guild (blob JSON +
// produtos relacionais remontados em array, no MESMO formato de sempre)
// e guarda em um cache local desta chamada de load(). Mutações no objeto
// retornado (ex: `guildData.sorteios.ativos[id] = x`) acontecem nesse
// mesmo objeto em memória. `save(dbData)` então persiste de volta APENAS
// as guilds que foram de fato acessadas/atribuídas nesta sessão — nunca
// o banco inteiro.
//
// Isso preserva 100% do comportamento observável por quem já usa
// load()/save() (nenhuma outra função de db.js precisou ser reescrita
// além das de produtos), com o ganho de performance de nunca mais
// reescrever guilds que não foram tocadas.
// ─────────────────────────────────────────────────────────────────────

function materializarGuildCompleta(guildId) {
  let raw = sqliteDb.getGuildRaw(guildId);
  let novaGuild = false;
  if (raw === null) {
    raw = sqliteDb.GUILD_DEFAULT();
    novaGuild = true;
  }
  // `raw` nunca contém `loja.produtos` (removido antes de salvar, ver
  // persistirGuildCompleta). Remonta a partir das tabelas relacionais.
  if (raw.loja) {
    raw.loja.produtos = sqliteDb.getProdutosByGuild(guildId);
  }
  if (novaGuild) {
    // Mesma semântica do getGuild() original: guild nova já é
    // persistida imediatamente com o schema default.
    sqliteDb.setGuildRaw(guildId, raw);
  }
  return raw;
}

function persistirGuildCompleta(guildId, guildData) {
  // Separa `loja.produtos` (vai para as tabelas relacionais) do resto
  // (vai para o blob JSON). Nunca perde dado: se `guildData.loja` não
  // existir, simplesmente não há produtos para sincronizar.
  if (guildData && guildData.loja && Array.isArray(guildData.loja.produtos)) {
    sqliteDb.sincronizarProdutosDaGuild(guildId, guildData.loja.produtos);
    const { produtos, ...lojaSemProdutos } = guildData.loja;
    const dataSemProdutos = { ...guildData, loja: lojaSemProdutos };
    sqliteDb.setGuildRaw(guildId, dataSemProdutos);
  } else {
    sqliteDb.setGuildRaw(guildId, guildData);
  }
}

function criarGuildsProxy() {
  const cache = new Map();
  const touched = new Set();

  const handler = {
    get(target, prop, receiver) {
      if (prop === META) return { cache, touched };
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      const guildId = prop;
      if (cache.has(guildId)) return cache.get(guildId);
      const materializada = materializarGuildCompleta(guildId);
      cache.set(guildId, materializada);
      touched.add(guildId);
      return materializada;
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') return true;
      cache.set(prop, value);
      touched.add(prop);
      return true;
    },
    has(target, prop) {
      if (typeof prop === 'symbol') return false;
      return cache.has(prop) || sqliteDb.guildExiste(prop);
    },
    deleteProperty(target, prop) {
      cache.delete(prop);
      touched.delete(prop);
      return true;
    },
    ownKeys() {
      // Usado raramente (nenhum código do projeto itera todas as
      // guilds hoje), mas mantido correto por segurança/futuro.
      return sqliteDb.todosGuildIds();
    },
    getOwnPropertyDescriptor(target, prop) {
      return { enumerable: true, configurable: true };
    },
  };

  return new Proxy({}, handler);
}

function load() {
  return { guilds: criarGuildsProxy(), licenses: {} };
}

function save(data) {
  const guildsProxy = data && data.guilds;
  if (!guildsProxy) return;
  const meta = guildsProxy[META];
  if (!meta) {
    // Defensivo: caso algum código no futuro construa manualmente um
    // objeto `{ guilds: {...} }` sem passar por load() (não acontece
    // hoje em nenhum lugar do projeto), ainda assim persiste o que
    // vier, iterando as chaves normais do objeto.
    for (const guildId of Object.keys(guildsProxy)) {
      persistirGuildCompleta(guildId, guildsProxy[guildId]);
    }
    return;
  }
  sqliteDb.withTransaction(() => {
    for (const guildId of meta.touched) {
      persistirGuildCompleta(guildId, meta.cache.get(guildId));
    }
  });
}

function getGuild(guildId) {
  return materializarGuildCompleta(guildId);
}

function setGuild(guildId, guildData) {
  persistirGuildCompleta(guildId, guildData);
}

function updateGuild(guildId, path_keys, value) {
  const guildData = materializarGuildCompleta(guildId);
  let obj = guildData;
  const keys = path_keys.split('.');
  for (let i = 0; i < keys.length - 1; i++) { if (!obj[keys[i]]) obj[keys[i]] = {}; obj = obj[keys[i]]; }
  obj[keys[keys.length - 1]] = value;
  persistirGuildCompleta(guildId, guildData);
}

// ─────────────────────────────────────────────────────────────────────
// LICENÇAS — inalterado (já era SQLite, via database/licenseDb.js).
// As assinaturas abaixo são mantidas idênticas de propósito, para que
// nenhum outro arquivo do projeto (helpers.js, licensestatus.js, etc.)
// precise ser alterado: eles continuam chamando db.getLicense/
// setLicense/removeLicense/hasLicense normalmente.
// ─────────────────────────────────────────────────────────────────────
const licenseDb = require("./licenseDb");
function getLicense(guildId) { return licenseDb.getLicense(guildId); }
function setLicense(guildId, data) { return licenseDb.setLicense(guildId, data); }
function removeLicense(guildId) { return licenseDb.removeLicense(guildId); }
function hasLicense(guildId) { return licenseDb.hasLicense(guildId); }

// ═══════════════════════════════════════════════════════════════════════
// MULTI-PRODUTO — agora com produtos/variantes/estoque/cupons em
// tabelas SQLite relacionais (database/sqliteDb.js), acessadas por
// estas mesmas funções de sempre. A estrutura ANTIGA/legada continua
// intacta dentro do blob JSON da guild, nunca apagada:
//   loja.produto    = {...}   objeto único (legado)
//   loja.variantes  = [...]   array único (legado)
//   loja.estoque    = [...]   array único (legado)
//   loja.cupons     = {...}   objeto único (legado)
//
// Estrutura nova (em tabelas SQLite, exposta pelas funções abaixo
// exatamente no mesmo formato de objeto de antes):
//   loja.produtos = [
//     { id, titulo, descricao, preco, banner, footer, corBotao, cargoId,
//       canalEntregasId, ativo, criadoEm, variantes:[], estoque:[], cupons:{} }
//   ]
//   loja.produtoEmEdicaoId = "<id>"
//   loja._migradoMultiProduto = true
// ═══════════════════════════════════════════════════════════════════════

function gerarProdutoId() {
  return 'prod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Roda no máximo uma vez por servidor (idempotente, guardado por
// `loja._migradoMultiProduto` dentro do blob JSON da guild — mesma
// semântica de antes). Nunca remove loja.produto/variantes/estoque/cupons
// legados. O produto legado migrado vira mais uma linha normal nas
// tabelas relacionais (com a flag `_legado`/coluna `legado`).
function migrarLojaSeNecessario(guildId) {
  const guildData = materializarGuildCompleta(guildId);
  if (!guildData.loja) guildData.loja = { produtos: [] };
  const loja = guildData.loja;

  if (loja._migradoMultiProduto) return guildData;

  if (!Array.isArray(loja.produtos)) loja.produtos = [];

  const produtoLegado = loja.produto;
  const temProdutoLegado = produtoLegado && (produtoLegado.titulo || produtoLegado.descricao || produtoLegado.preco);
  const jaTemLegadoMigrado = loja.produtos.some(p => p._legado);

  if (temProdutoLegado && !jaTemLegadoMigrado) {
    const novoId = gerarProdutoId();
    const novoProduto = {
      id: novoId,
      titulo: produtoLegado.titulo || 'Produto',
      descricao: produtoLegado.descricao || '',
      preco: produtoLegado.preco || '0.00',
      banner: produtoLegado.banner || null,
      thumbnail: produtoLegado.thumbnail || produtoLegado.banner || null,
      footer: produtoLegado.footer || null,
      corBotao: produtoLegado.corBotao || null,
      cargoId: produtoLegado.cargoId || null,
      canalEntregasId: null,
      vitrineCanalId: null,
      vitrineMsgId: null,
      ativo: true,
      criadoEm: new Date().toISOString(),
      variantes: Array.isArray(loja.variantes) ? JSON.parse(JSON.stringify(loja.variantes)) : [],
      estoque: Array.isArray(loja.estoque) ? JSON.parse(JSON.stringify(loja.estoque)) : [],
      cupons: loja.cupons ? JSON.parse(JSON.stringify(loja.cupons)) : {},
      _legado: true,
    };
    loja.produtos.push(novoProduto);
    loja.produtoEmEdicaoId = novoId;
    console.log(`[Migração] <:positivo:1528401238197276702> Servidor ${guildId}: produto legado migrado → produtos[] com id "${novoId}" (variantes: ${(loja.variantes || []).length}, estoque: ${(loja.estoque || []).length}, cupons: ${Object.keys(loja.cupons || {}).length}).`);
  } else if (!temProdutoLegado && loja.produtos.length === 0) {
    console.log(`[Migração] ℹ️ Servidor ${guildId}: nenhum produto legado configurado, iniciando com produtos: [].`);
  }

  // Limpa a fonte de dados legada (loja.produto) depois de copiada para
  // produtos[]. Sem isso, esse dado antigo fica parado pra sempre e pode
  // "ressuscitar" um produto já deletado caso esta função rode de novo
  // por qualquer motivo (ex: leitura da trava abaixo falhar no boot).
  if (loja.produto) loja.produto = null;

  loja._migradoMultiProduto = true;
  loja._migradoEm = new Date().toISOString();
  persistirGuildCompleta(guildId, guildData);

  // Relê do banco em vez de devolver o objeto "cru" em memória: o
  // produto legado migrado acima usa uma cópia direta do formato antigo
  // (ex: cupom legado só tinha {desconto, usos}), enquanto o que fica
  // persistido nas tabelas relacionais já normaliza para o formato
  // completo (todos os campos, com null onde não havia valor). Reler
  // garante que quem chamou getProdutos/getProdutoPorId logo após a
  // migração automática veja exatamente o mesmo shape que qualquer
  // leitura subsequente vai ver.
  return materializarGuildCompleta(guildId);
}

function getProdutos(guildId) {
  const guildData = migrarLojaSeNecessario(guildId);
  return (guildData.loja && guildData.loja.produtos) || [];
}

function getProdutoPorId(guildId, produtoId) {
  return getProdutos(guildId).find(p => p.id === produtoId) || null;
}

function criarProduto(guildId, dadosIniciais = {}) {
  migrarLojaSeNecessario(guildId);
  const novo = {
    id: gerarProdutoId(),
    titulo: dadosIniciais.titulo || 'Novo Produto',
    descricao: dadosIniciais.descricao || '',
    preco: dadosIniciais.preco || '0.00',
    banner: dadosIniciais.banner || null,
    thumbnail: dadosIniciais.thumbnail || null,
    footer: dadosIniciais.footer || null,
    corBotao: dadosIniciais.corBotao || null,
    corEmbed: dadosIniciais.corEmbed || null,
    cargoId: dadosIniciais.cargoId || null,
    canalEntregasId: null,
    canalAvaliacaoId: null,
    vitrineCanalId: null,
    vitrineMsgId: null,
    ativo: true,
    criadoEm: new Date().toISOString(),
    variantes: [],
    estoque: [],
    cupons: {},
  };

  const produtosAtuais = sqliteDb.getProdutosByGuild(guildId);
  sqliteDb.upsertProdutoCompleto(guildId, novo, produtosAtuais.length);

  const guildData = materializarGuildCompleta(guildId);
  if (!guildData.loja) guildData.loja = {};
  guildData.loja.produtoEmEdicaoId = novo.id;
  // Não usa persistirGuildCompleta aqui para não re-sincronizar TODOS os
  // produtos (já inserimos o novo diretamente acima) — só grava o blob.
  const { produtos, ...lojaSemProdutos } = guildData.loja;
  sqliteDb.setGuildRaw(guildId, { ...guildData, loja: lojaSemProdutos });

  console.log(`[Produto] <:mais2:1528400709018583100> Novo produto criado no servidor ${guildId}: id="${novo.id}".`);
  return novo;
}

function atualizarProduto(guildId, produtoId, path_keys, value) {
  migrarLojaSeNecessario(guildId);
  const produtoExiste = sqliteDb.getProdutoById(produtoId);
  if (!produtoExiste) return false;

  // Confirmado na auditoria: todo path_keys usado no projeto para
  // atualizarProduto tem exatamente 1 nível (nunca "a.b.c"). Mantém
  // suporte a múltiplos níveis por segurança/compatibilidade futura,
  // delegando para dentro do objeto materializado quando necessário.
  const keys = path_keys.split('.');
  if (keys.length === 1) {
    sqliteDb.updateProdutoCampo(produtoId, keys[0], value);
    return true;
  }

  // Caminho defensivo (não usado hoje em nenhum call-site conhecido):
  // materializa o produto inteiro, aplica o path aninhado, e regrava.
  const produto = sqliteDb.getProdutoById(produtoId);
  let obj = produto;
  for (let i = 0; i < keys.length - 1; i++) { if (obj[keys[i]] == null) obj[keys[i]] = {}; obj = obj[keys[i]]; }
  obj[keys[keys.length - 1]] = value;
  const produtosAtuais = sqliteDb.getProdutosByGuild(guildId);
  const idx = produtosAtuais.findIndex(p => p.id === produtoId);
  sqliteDb.upsertProdutoCompleto(guildId, produto, idx === -1 ? produtosAtuais.length : idx);
  return true;
}

function deletarProduto(guildId, produtoId) {
  migrarLojaSeNecessario(guildId);
  const antes = sqliteDb.getProdutosByGuild(guildId);
  const produtoDeletado = antes.find(p => p.id === produtoId);
  if (!produtoDeletado) return false;

  sqliteDb.deleteProdutoCompleto(produtoId);

  const guildData = materializarGuildCompleta(guildId);
  const precisaAtualizarMeta =
    (guildData.loja && guildData.loja.produtoEmEdicaoId === produtoId) ||
    (produtoDeletado._legado && guildData.loja && guildData.loja.produto);

  if (precisaAtualizarMeta) {
    const restantes = sqliteDb.getProdutosByGuild(guildId);
    guildData.loja.produtoEmEdicaoId = (restantes[0] && restantes[0].id) || null;
    // Se o produto deletado era o migrado do sistema antigo, garante que
    // a fonte legada (loja.produto) também fica limpa — impede que ele
    // volte sozinho numa migração futura.
    if (produtoDeletado._legado) guildData.loja.produto = null;
    const { produtos, ...lojaSemProdutos } = guildData.loja;
    sqliteDb.setGuildRaw(guildId, { ...guildData, loja: lojaSemProdutos });
  }

  console.log(`[Produto] <:apagar:1524206738885050388> Produto "${produtoId}" removido do servidor ${guildId}.`);
  return true;
}

// Retorna o id do produto ativo, ou null se o servidor não tem NENHUM
// produto configurado. NÃO cria mais um produto vazio automaticamente —
// isso causava o bug de "produto fantasma reaparecendo" após deletar tudo
// e reiniciar o bot. Agora quem decide criar um produto novo é sempre uma
// ação explícita do usuário (botão "Novo Produto").
function getProdutoAtivoId(guildId) {
  const guildData = migrarLojaSeNecessario(guildId);
  const loja = guildData.loja;
  let produtos = loja.produtos || [];
  if (produtos.length === 0) {
    return null;
  }
  if (!loja.produtoEmEdicaoId || !produtos.some(p => p.id === loja.produtoEmEdicaoId)) {
    loja.produtoEmEdicaoId = produtos[0].id;
    const { produtos: _p, ...lojaSemProdutos } = loja;
    sqliteDb.setGuildRaw(guildId, { ...guildData, loja: lojaSemProdutos });
    return produtos[0].id;
  }
  return loja.produtoEmEdicaoId;
}

function setProdutoAtivoId(guildId, produtoId) {
  migrarLojaSeNecessario(guildId);
  const guildData = materializarGuildCompleta(guildId);
  if (!guildData.loja) guildData.loja = {};
  guildData.loja.produtoEmEdicaoId = produtoId;
  const { produtos, ...lojaSemProdutos } = guildData.loja;
  sqliteDb.setGuildRaw(guildId, { ...guildData, loja: lojaSemProdutos });
}

// ═══════════════════════════════════════════════════════════════════════
// SORTEIOS — camada de acesso isolada (sorteio-system/sorteioManager.js)
// ═══════════════════════════════════════════════════════════════════════
//
// Estrutura armazenada em cada guild:
//   guild.sorteios = {
//     config: { cor, emoji, canalPadraoId, cargoPadraoId, mensagemPadrao,
//               imagemPadrao, footer, autor, miniatura },
//     ativos:    { [sorteioId]: SorteioObj },
//     encerrados:{ [sorteioId]: SorteioObj },
//     logs: [ { tipo, sorteioId, dataISO, detalhe } ],
//     stats: { totalCriados: number, maiorSorteio: { sorteioId, participantes } | null }
//   }
//
// Toda leitura/escrita passa OBRIGATORIAMENTE pelas funções abaixo — nunca
// acesse `db.getGuild(id).sorteios` diretamente fora deste arquivo. Isso
// é o que permitiu trocar JSON -> SQLite alterando SOMENTE a camada de
// load()/save()/getGuild()/setGuild() acima, sem tocar em nenhuma linha
// deste bloco nem no sorteioManager.js/scheduler.
// ═══════════════════════════════════════════════════════════════════════

function getSorteiosState(guildId) {
  const guildData = getGuild(guildId);
  if (!guildData.sorteios) {
    guildData.sorteios = {
      config: {},
      ativos: {},
      encerrados: {},
      logs: [],
      stats: { totalCriados: 0, maiorSorteio: null },
    };
    setGuild(guildId, guildData);
  }
  return guildData.sorteios;
}

function getSorteioConfig(guildId) {
  return getSorteiosState(guildId).config || {};
}

function setSorteioConfig(guildId, parcial) {
  getSorteiosState(guildId);
  const dbData = load();
  const state = dbData.guilds[guildId].sorteios;
  state.config = { ...(state.config || {}), ...parcial };
  save(dbData);
  return state.config;
}

function gerarSorteioId() {
  return 'srt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function criarSorteio(guildId, dados) {
  getSorteiosState(guildId);
  const dbData = load();
  const state = dbData.guilds[guildId].sorteios;
  const id = gerarSorteioId();
  const sorteio = {
    id,
    titulo: dados.titulo || 'Sorteio',
    premio: dados.premio || 'Prêmio',
    descricao: dados.descricao || '',
    canalId: dados.canalId,
    mensagemId: null,
    duracaoMs: dados.duracaoMs,
    terminaEm: Date.now() + dados.duracaoMs,
    ganhadoresQtd: dados.ganhadoresQtd || 1,
    imagem: dados.imagem || null,
    cargoObrigatorioId: dados.cargoObrigatorioId || null,
    cargoBloqueadoId: dados.cargoBloqueadoId || null,
    minimoDiasConta: dados.minimoDiasConta || 0,
    necessitaBoost: !!dados.necessitaBoost,
    mensagemPersonalizada: dados.mensagemPersonalizada || null,
    hostId: dados.hostId,
    participantes: [],
    status: 'ativo',
    ganhadores: [],
    criadoEm: new Date().toISOString(),
  };
  state.ativos[id] = sorteio;
  state.stats.totalCriados = (state.stats.totalCriados || 0) + 1;
  save(dbData);
  return sorteio;
}

function getSorteio(guildId, sorteioId) {
  const state = getSorteiosState(guildId);
  return state.ativos[sorteioId] || state.encerrados[sorteioId] || null;
}

function getSorteiosAtivos(guildId) {
  const state = getSorteiosState(guildId);
  return Object.values(state.ativos || {});
}

function getSorteiosEncerrados(guildId) {
  const state = getSorteiosState(guildId);
  return Object.values(state.encerrados || {});
}

function atualizarSorteio(guildId, sorteioId, patch) {
  const dbData = load();
  if (!dbData.guilds[guildId]?.sorteios) return false;
  const state = dbData.guilds[guildId].sorteios;
  const alvo = state.ativos[sorteioId] || state.encerrados[sorteioId];
  if (!alvo) return false;
  Object.assign(alvo, patch);
  save(dbData);
  return true;
}

function adicionarParticipante(guildId, sorteioId, userId) {
  const dbData = load();
  const state = dbData.guilds[guildId]?.sorteios;
  const sorteio = state?.ativos[sorteioId];
  if (!sorteio) return { ok: false, motivo: 'nao_encontrado' };
  if (sorteio.status !== 'ativo') return { ok: false, motivo: 'encerrado' };
  if (sorteio.participantes.includes(userId)) return { ok: false, motivo: 'ja_participando' };
  sorteio.participantes.push(userId);
  save(dbData);
  return { ok: true, participantes: sorteio.participantes.length };
}

function removerParticipante(guildId, sorteioId, userId) {
  const dbData = load();
  const state = dbData.guilds[guildId]?.sorteios;
  const sorteio = state?.ativos[sorteioId];
  if (!sorteio) return { ok: false, motivo: 'nao_encontrado' };
  const antes = sorteio.participantes.length;
  sorteio.participantes = sorteio.participantes.filter(id => id !== userId);
  save(dbData);
  return { ok: true, saiu: antes !== sorteio.participantes.length, participantes: sorteio.participantes.length };
}

function encerrarSorteio(guildId, sorteioId, ganhadores, statusFinal = 'encerrado') {
  const dbData = load();
  const state = dbData.guilds[guildId]?.sorteios;
  const sorteio = state?.ativos[sorteioId];
  if (!sorteio) return false;

  sorteio.status = statusFinal;
  sorteio.ganhadores = ganhadores || [];
  sorteio.encerradoEm = new Date().toISOString();

  delete state.ativos[sorteioId];
  state.encerrados[sorteioId] = sorteio;

  const maiorAtual = state.stats.maiorSorteio;
  if (!maiorAtual || sorteio.participantes.length > maiorAtual.participantes) {
    state.stats.maiorSorteio = { sorteioId, participantes: sorteio.participantes.length, titulo: sorteio.titulo };
  }
  if (ganhadores && ganhadores.length > 0) {
    state.stats.ultimoVencedorId = ganhadores[0];
  }

  save(dbData);
  return true;
}

function registrarLogSorteio(guildId, tipo, sorteioId, detalhe) {
  getSorteiosState(guildId);
  const dbData = load();
  const state = dbData.guilds[guildId].sorteios;
  state.logs = state.logs || [];
  state.logs.push({ tipo, sorteioId, detalhe: detalhe || null, dataISO: new Date().toISOString() });
  if (state.logs.length > 200) state.logs = state.logs.slice(-200);
  save(dbData);
}

function getLogsSorteio(guildId, limite = 10) {
  const state = getSorteiosState(guildId);
  return (state.logs || []).slice(-limite).reverse();
}

function getStatsSorteio(guildId) {
  const state = getSorteiosState(guildId);
  return {
    totalCriados: state.stats?.totalCriados || 0,
    ativos: Object.keys(state.ativos || {}).length,
    encerrados: Object.keys(state.encerrados || {}).length,
    maiorSorteio: state.stats?.maiorSorteio || null,
    ultimoVencedorId: state.stats?.ultimoVencedorId || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// BACKUP & RESTAURAÇÃO DE SERVIDOR — camada de acesso isolada
// (backup-system/backupManager.js). Mesmo padrão dos blocos SORTEIOS
// acima: toda leitura/escrita de guild.backups passa por aqui.
// ═══════════════════════════════════════════════════════════════════════
//
// guild.backups = {
//   snapshots: [ SnapshotObj, ... ],
//   templates: { [nomeTemplate]: SnapshotObj }
// }

const MAX_SNAPSHOTS = 5;

function getBackupState(guildId) {
  const guildData = getGuild(guildId);
  if (!guildData.backups) {
    guildData.backups = { snapshots: [], templates: {} };
    setGuild(guildId, guildData);
  }
  return guildData.backups;
}

function gerarBackupId() {
  return 'bkp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function salvarSnapshot(guildId, snapshot) {
  getBackupState(guildId);
  const dbData = load();
  const state = dbData.guilds[guildId].backups;
  const registro = { id: gerarBackupId(), criadoEm: new Date().toISOString(), ...snapshot };
  state.snapshots.push(registro);
  if (state.snapshots.length > MAX_SNAPSHOTS) state.snapshots = state.snapshots.slice(-MAX_SNAPSHOTS);
  save(dbData);
  return registro;
}

function getSnapshots(guildId) {
  return getBackupState(guildId).snapshots || [];
}

function getSnapshotPorId(guildId, snapshotId) {
  return getSnapshots(guildId).find(s => s.id === snapshotId) || null;
}

function removerSnapshot(guildId, snapshotId) {
  const dbData = load();
  const state = dbData.guilds[guildId]?.backups;
  if (!state) return false;
  const antes = state.snapshots.length;
  state.snapshots = state.snapshots.filter(s => s.id !== snapshotId);
  save(dbData);
  return antes !== state.snapshots.length;
}

function salvarTemplate(guildId, nomeTemplate, snapshot) {
  getBackupState(guildId);
  const dbData = load();
  const state = dbData.guilds[guildId].backups;
  const registro = { id: gerarBackupId(), criadoEm: new Date().toISOString(), nome: nomeTemplate, ...snapshot };
  state.templates[nomeTemplate] = registro;
  save(dbData);
  return registro;
}

function getTemplates(guildId) {
  return getBackupState(guildId).templates || {};
}

function getTemplatePorNome(guildId, nomeTemplate) {
  return getTemplates(guildId)[nomeTemplate] || null;
}

function getTemplatePorId(guildId, templateId) {
  return Object.values(getTemplates(guildId)).find(t => t.id === templateId) || null;
}

function removerTemplate(guildId, nomeTemplate) {
  const dbData = load();
  const state = dbData.guilds[guildId]?.backups;
  if (!state?.templates) return false;
  const existia = !!state.templates[nomeTemplate];
  delete state.templates[nomeTemplate];
  save(dbData);
  return existia;
}

// ═══════════════════════════════════════════════════════════════════════
// ASSINATURAS ATIVAS (produtos recorrentes) — camada de acesso isolada.
// guild.assinaturas.ativas = [ { id, produtoId, clienteId, cargoId,
//   vipAtivado, criadaEm (ISO), expiraEm (ISO) }, ... ]
// ═══════════════════════════════════════════════════════════════════════
function getAssinaturasAtivas(guildId) {
  const guildData = getGuild(guildId);
  if (!guildData.assinaturas) {
    guildData.assinaturas = { ativas: [] };
    setGuild(guildId, guildData);
  }
  return guildData.assinaturas.ativas || [];
}

function gerarAssinaturaId() {
  return 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function salvarAssinaturaAtiva(guildId, registro) {
  getAssinaturasAtivas(guildId);
  const dbData = load();
  const lista = dbData.guilds[guildId].assinaturas.ativas;
  const nova = { id: gerarAssinaturaId(), criadaEm: new Date().toISOString(), ...registro };
  lista.push(nova);
  save(dbData);
  return nova;
}

function removerAssinaturaAtiva(guildId, assinaturaId) {
  const dbData = load();
  const state = dbData.guilds[guildId]?.assinaturas;
  if (!state) return false;
  const antes = state.ativas.length;
  state.ativas = state.ativas.filter(a => a.id !== assinaturaId);
  save(dbData);
  return antes !== state.ativas.length;
}

// KAEL INTELLIGENCE — repassa direto pra camada SQL (mesmo padrão de
// getLicense/setLicense abaixo, que repassam pra licenseDb).
// KAEL — transacoes_pagamento (estado persistente da transação de pagamento)
function criarOuReaproveitarTransacaoPendente(dados) { return sqliteDb.criarOuReaproveitarTransacaoPendente(dados); }
function getTransacaoPagamentoPorCanal(canalId) { return sqliteDb.getTransacaoPagamentoPorCanal(canalId); }
function getTransacaoPagamentoPorId(transacaoId) { return sqliteDb.getTransacaoPagamentoPorId(transacaoId); }
function marcarTransacaoPaga(canalId, agoraISO) { return sqliteDb.marcarTransacaoPaga(canalId, agoraISO); }
function marcarTransacaoCancelada(canalId, motivo, canceladoPor, agoraISO) { return sqliteDb.marcarTransacaoCancelada(canalId, motivo, canceladoPor, agoraISO); }
function marcarTransacaoExpirada(canalId, agoraISO) { return sqliteDb.marcarTransacaoExpirada(canalId, agoraISO); }
function marcarTransacaoRecusada(canalId, recusadoPor, agoraISO) { return sqliteDb.marcarTransacaoRecusada(canalId, recusadoPor, agoraISO); }
function listarTransacoesPendentes() { return sqliteDb.listarTransacoesPendentes(); }

function registrarCarrinho(dados) { return sqliteDb.registrarCarrinho(dados); }
function atualizarStatusCarrinhoPorCanal(canalId, status) { return sqliteDb.atualizarStatusCarrinhoPorCanal(canalId, status); }
function getCarrinhoPorCanal(canalId) { return sqliteDb.getCarrinhoPorCanal(canalId); }
function listarCarrinhosAbandonados(guildId, minutosLimite) { return sqliteDb.listarCarrinhosAbandonados(guildId, minutosLimite); }
function listarCarrinhosParaNotificar(minutosLimite) { return sqliteDb.listarCarrinhosParaNotificar(minutosLimite); }
function marcarCarrinhoNotificado(id) { return sqliteDb.marcarCarrinhoNotificado(id); }
function getCarrinhosPorGuildDesde(guildId, desdeISO) { return sqliteDb.getCarrinhosPorGuildDesde(guildId, desdeISO); }

module.exports = {
  load, save, getGuild, setGuild, updateGuild, getLicense, setLicense, removeLicense, hasLicense,
  // KAEL INTELLIGENCE
  registrarCarrinho, atualizarStatusCarrinhoPorCanal, getCarrinhoPorCanal,
  listarCarrinhosAbandonados, listarCarrinhosParaNotificar, marcarCarrinhoNotificado, getCarrinhosPorGuildDesde,
  // KAEL — transacoes_pagamento
  criarOuReaproveitarTransacaoPendente, getTransacaoPagamentoPorCanal, getTransacaoPagamentoPorId,
  marcarTransacaoPaga, marcarTransacaoCancelada, marcarTransacaoExpirada, marcarTransacaoRecusada,
  listarTransacoesPendentes,
  migrarLojaSeNecessario, gerarProdutoId, getProdutos, getProdutoPorId, criarProduto,
  atualizarProduto, deletarProduto, getProdutoAtivoId, setProdutoAtivoId,
  // Sorteios
  getSorteiosState, getSorteioConfig, setSorteioConfig, gerarSorteioId, criarSorteio,
  getSorteio, getSorteiosAtivos, getSorteiosEncerrados, atualizarSorteio,
  adicionarParticipante, removerParticipante, encerrarSorteio,
  registrarLogSorteio, getLogsSorteio, getStatsSorteio,
  // Backup & Restauração de Servidor
  getBackupState, salvarSnapshot, getSnapshots, getSnapshotPorId, removerSnapshot,
  salvarTemplate, getTemplates, getTemplatePorNome, getTemplatePorId, removerTemplate,
  // Assinaturas Ativas (produtos recorrentes)
  getAssinaturasAtivas, salvarAssinaturaAtiva, removerAssinaturaAtiva,
};
