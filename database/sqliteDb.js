// ═══════════════════════════════════════════════════════════════════════
// database/sqliteDb.js
//
// Camada de acesso ao banco SQLite (better-sqlite3) que substitui a
// persistência em arquivo único JSON (database/database.json).
//
// Responsabilidade deste arquivo: SOMENTE schema + leitura/escrita de
// baixo nível. Nenhuma regra de negócio de vendas/sorteios/backup/
// assinaturas vive aqui — isso continua 100% em database/db.js, que é
// quem chama as funções abaixo.
//
// Por que separar assim:
//  - database/db.js precisa manter EXATAMENTE as mesmas funções e
//    assinaturas que o resto do bot já usa (getGuild, setGuild,
//    updateGuild, getProdutos, atualizarProduto, etc.).
//  - Este arquivo é livre para ter uma API própria, pensada para
//    performance, que db.js consome por baixo dos panos.
//
// ─────────────────────────────────────────────────────────────────────
// MODELO DE DADOS
// ─────────────────────────────────────────────────────────────────────
// Tabela `guild_meta`: um registro por servidor (guildId), com TUDO que
// hoje mora em `guild.*` no JSON, EXCETO `guild.loja.produtos` (que vira
// tabelas relacionais abaixo por ser o dado de maior volume/frequência
// de escrita: aplicar cupom, editar produto, adicionar estoque, etc.).
// Isso inclui: pix, logs, config, blacklist, sorteios, backups,
// assinaturas, ticketConfig, e TODOS os campos de `loja.*` que não são
// o array `produtos` (ex: loja.pix, loja.efibank, loja.mercadopago,
// loja.definicoes, loja.produto/variantes/estoque/cupons LEGADOS
// (singulares, pré multi-produto — nunca apagados, ver db.js), etc.
//
// Tabelas relacionais (só para loja.produtos[] e seus filhos):
//   produtos         — 1 linha por produto
//   produto_variantes — 1 linha por variante de um produto
//   produto_estoque   — 1 linha por item de estoque (do produto OU de
//                        uma variante específica)
//   produto_cupons    — 1 linha por cupom de um produto
//
// Nenhum campo foi inventado: todas as colunas abaixo correspondem a
// campos confirmados em uso real no código (produto.js, salesManager.js,
// cupomManager.js) antes desta implementação ser escrita.
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(require('./dataDir').DATA_DIR, 'database.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ─────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS guild_meta (
  guild_id    TEXT PRIMARY KEY,
  data_json   TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id                    TEXT PRIMARY KEY,
  guild_id              TEXT NOT NULL,
  ordem                 INTEGER NOT NULL DEFAULT 0,
  titulo                TEXT,
  descricao             TEXT,
  preco                 TEXT,
  banner                TEXT,
  thumbnail             TEXT,
  footer                TEXT,
  corBotao              TEXT,
  corEmbed              TEXT,
  cargoId               TEXT,
  canalEntregasId       TEXT,
  canalAvaliacaoId      TEXT,
  vitrineCanalId        TEXT,
  vitrineMsgId          TEXT,
  ativo                 INTEGER,
  criadoEm              TEXT,
  precoComparacao       TEXT,
  mensagemPosVenda      TEXT,
  condicoes_json        TEXT,
  cargosPosCompra_json  TEXT,
  assinatura_json       TEXT,
  legado                INTEGER,
  extra_json            TEXT
);
CREATE INDEX IF NOT EXISTS idx_produtos_guild ON produtos(guild_id, ordem);

CREATE TABLE IF NOT EXISTS produto_variantes (
  produto_id  TEXT NOT NULL,
  variante_id TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0,
  nome        TEXT,
  preco       TEXT,
  emoji       TEXT,
  estoque_num INTEGER,
  PRIMARY KEY (produto_id, variante_id)
);
CREATE INDEX IF NOT EXISTS idx_variantes_produto ON produto_variantes(produto_id, ordem);

CREATE TABLE IF NOT EXISTS produto_estoque (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  TEXT NOT NULL,
  variante_id TEXT,
  ordem       INTEGER NOT NULL DEFAULT 0,
  item_texto  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_estoque_produto ON produto_estoque(produto_id, variante_id, ordem);

CREATE TABLE IF NOT EXISTS produto_cupons (
  produto_id          TEXT NOT NULL,
  codigo              TEXT NOT NULL,
  desconto            REAL,
  tipo                TEXT,
  valorFixo           REAL,
  usos                INTEGER,
  usosMaximos         INTEGER,
  cargoObrigatorioId  TEXT,
  valorMinimo         REAL,
  valorMaximo         REAL,
  validoAte           TEXT,
  criadoEm            TEXT,
  criadoPor           TEXT,
  PRIMARY KEY (produto_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_cupons_produto ON produto_cupons(produto_id);

CREATE TABLE IF NOT EXISTS migration_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- KAEL INTELLIGENCE — eventos do ciclo de vida do carrinho, pra permitir
-- detectar carrinhos abandonados e analisar conversão. Não substitui
-- "pedidosAtivos" (em memória, sales-system/salesManager.js) — este é um
-- REGISTRO HISTÓRICO/PERSISTENTE dos mesmos eventos, que sobrevive a
-- restart e permite consulta depois.
CREATE TABLE IF NOT EXISTS carrinho_eventos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  cliente_id    TEXT NOT NULL,
  produto_id    TEXT,
  produto_nome  TEXT,
  variante_nome TEXT,
  canal_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'iniciado',
  notificado    INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_carrinho_guild_status ON carrinho_eventos(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_carrinho_canal ON carrinho_eventos(canal_id);

-- KAEL — máquina de estados PERSISTENTE da transação de pagamento de
-- cada carrinho (1 linha por canal de compra). Não substitui
-- "pedidosAtivos"/"metadadosPedido" (em memória) nem "carrinho_eventos"
-- (histórico/analytics) — esta tabela é a FONTE DA VERDADE do status da
-- transação (PENDING/PAID/CANCELLED/EXPIRED/REFUSED), usada para:
--   1) decidir atomicamente se uma entrega/cancelamento/expiração pode
--      acontecer (transições WHERE status = 'PENDING', nunca lidas e
--      escritas em passos separados — ver transacaoManager.js);
--   2) sobreviver a um restart do bot, recalculando quanto tempo falta
--      pro timer de 10 minutos (ou expirando na hora, se já passou).
CREATE TABLE IF NOT EXISTS transacoes_pagamento (
  canal_id            TEXT PRIMARY KEY,
  transacao_id        TEXT NOT NULL UNIQUE,
  guild_id            TEXT NOT NULL,
  cliente_id          TEXT NOT NULL,
  produto_id          TEXT,
  numero_pedido       INTEGER,
  item_nome           TEXT,
  variante_nome       TEXT,
  valor               TEXT,
  mp_payment_id       TEXT,
  efi_txid            TEXT,
  c6_txid             TEXT,
  openpix_correlation_id TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  motivo_cancelamento TEXT,
  cancelado_por       TEXT,
  criado_em           TEXT NOT NULL,
  expira_em           TEXT NOT NULL,
  atualizado_em       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transacoes_status_expira ON transacoes_pagamento(status, expira_em);
CREATE INDEX IF NOT EXISTS idx_transacoes_guild ON transacoes_pagamento(guild_id);
`);

// KAEL — OPENPIX (Parte 2): coluna aditiva. Bancos já existentes (de
// deploys anteriores) já têm a tabela criada sem esta coluna — o
// `CREATE TABLE IF NOT EXISTS` acima não a adiciona retroativamente,
// por isso o ALTER TABLE abaixo é necessário. Idempotente: se a coluna
// já existir (banco novo, criado pelo CREATE TABLE acima já com a
// coluna), o SQLite lança "duplicate column name" — ignorado de propósito.
try {
  db.exec(`ALTER TABLE transacoes_pagamento ADD COLUMN openpix_correlation_id TEXT`);
} catch (e) {
  if (!/duplicate column/i.test(e.message)) console.error('[SQLite] Falha ao migrar coluna openpix_correlation_id:', e.message);
}

// ─────────────────────────────────────────────────────────────────────
// STATEMENTS PREPARADOS (reuso — melhor performance)
// ─────────────────────────────────────────────────────────────────────
const stmts = {
  getGuildMeta: db.prepare(`SELECT data_json FROM guild_meta WHERE guild_id = ?`),
  upsertGuildMeta: db.prepare(`
    INSERT INTO guild_meta (guild_id, data_json, updated_at) VALUES (@guild_id, @data_json, @updated_at)
    ON CONFLICT(guild_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `),
  allGuildIds: db.prepare(`SELECT guild_id FROM guild_meta`),

  getProdutosByGuild: db.prepare(`SELECT * FROM produtos WHERE guild_id = ? ORDER BY ordem ASC`),
  getProdutoById: db.prepare(`SELECT * FROM produtos WHERE id = ?`),
  deleteProdutosByGuild: db.prepare(`DELETE FROM produtos WHERE guild_id = ?`),
  insertProduto: db.prepare(`
    INSERT INTO produtos (
      id, guild_id, ordem, titulo, descricao, preco, banner, thumbnail, footer,
      corBotao, corEmbed, cargoId, canalEntregasId, canalAvaliacaoId, vitrineCanalId,
      vitrineMsgId, ativo, criadoEm, precoComparacao, mensagemPosVenda,
      condicoes_json, cargosPosCompra_json, assinatura_json, legado, extra_json
    ) VALUES (
      @id, @guild_id, @ordem, @titulo, @descricao, @preco, @banner, @thumbnail, @footer,
      @corBotao, @corEmbed, @cargoId, @canalEntregasId, @canalAvaliacaoId, @vitrineCanalId,
      @vitrineMsgId, @ativo, @criadoEm, @precoComparacao, @mensagemPosVenda,
      @condicoes_json, @cargosPosCompra_json, @assinatura_json, @legado, @extra_json
    )
  `),
  updateProdutoField: (coluna) => db.prepare(`UPDATE produtos SET ${coluna} = ? WHERE id = ?`),
  deleteProduto: db.prepare(`DELETE FROM produtos WHERE id = ?`),

  deleteVariantesByProduto: db.prepare(`DELETE FROM produto_variantes WHERE produto_id = ?`),
  getVariantesByProduto: db.prepare(`SELECT * FROM produto_variantes WHERE produto_id = ? ORDER BY ordem ASC`),
  insertVariante: db.prepare(`
    INSERT INTO produto_variantes (produto_id, variante_id, ordem, nome, preco, emoji, estoque_num)
    VALUES (@produto_id, @variante_id, @ordem, @nome, @preco, @emoji, @estoque_num)
  `),

  deleteEstoqueByProduto: db.prepare(`DELETE FROM produto_estoque WHERE produto_id = ?`),
  getEstoqueByProduto: db.prepare(`SELECT * FROM produto_estoque WHERE produto_id = ? ORDER BY ordem ASC`),
  insertEstoqueItem: db.prepare(`
    INSERT INTO produto_estoque (produto_id, variante_id, ordem, item_texto)
    VALUES (@produto_id, @variante_id, @ordem, @item_texto)
  `),

  deleteCuponsByProduto: db.prepare(`DELETE FROM produto_cupons WHERE produto_id = ?`),
  getCuponsByProduto: db.prepare(`SELECT * FROM produto_cupons WHERE produto_id = ?`),
  insertCupom: db.prepare(`
    INSERT INTO produto_cupons (
      produto_id, codigo, desconto, tipo, valorFixo, usos, usosMaximos,
      cargoObrigatorioId, valorMinimo, valorMaximo, validoAte, criadoEm, criadoPor
    ) VALUES (
      @produto_id, @codigo, @desconto, @tipo, @valorFixo, @usos, @usosMaximos,
      @cargoObrigatorioId, @valorMinimo, @valorMaximo, @validoAte, @criadoEm, @criadoPor
    )
  `),

  getMigrationMeta: db.prepare(`SELECT value FROM migration_meta WHERE key = ?`),
  setMigrationMeta: db.prepare(`
    INSERT INTO migration_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),

  // KAEL INTELLIGENCE — carrinho_eventos
  insertCarrinho: db.prepare(`
    INSERT INTO carrinho_eventos (guild_id, cliente_id, produto_id, produto_nome, variante_nome, canal_id, status, criado_em, atualizado_em)
    VALUES (@guild_id, @cliente_id, @produto_id, @produto_nome, @variante_nome, @canal_id, 'iniciado', @criado_em, @atualizado_em)
  `),
  atualizarStatusCarrinhoPorCanal: db.prepare(`
    UPDATE carrinho_eventos SET status = @status, atualizado_em = @atualizado_em WHERE canal_id = @canal_id
  `),
  getCarrinhoPorCanal: db.prepare(`SELECT * FROM carrinho_eventos WHERE canal_id = ? ORDER BY id DESC LIMIT 1`),
  listarCarrinhosAbandonadosPorGuild: db.prepare(`
    SELECT * FROM carrinho_eventos
    WHERE guild_id = @guild_id AND status IN ('iniciado', 'pix_gerado') AND atualizado_em <= @limite
    ORDER BY criado_em ASC
  `),
  listarCarrinhosParaNotificar: db.prepare(`
    SELECT * FROM carrinho_eventos
    WHERE status IN ('iniciado', 'pix_gerado') AND notificado = 0 AND atualizado_em <= @limite
    ORDER BY criado_em ASC
  `),
  marcarCarrinhoNotificado: db.prepare(`UPDATE carrinho_eventos SET notificado = 1 WHERE id = ?`),
  getCarrinhosPorGuildDesde: db.prepare(`SELECT * FROM carrinho_eventos WHERE guild_id = @guild_id AND criado_em >= @desde ORDER BY criado_em ASC`),

  // KAEL — transacoes_pagamento (estado da transação de pagamento)
  upsertTransacaoPendente: db.prepare(`
    INSERT INTO transacoes_pagamento (
      canal_id, transacao_id, guild_id, cliente_id, produto_id, numero_pedido,
      item_nome, variante_nome, valor, mp_payment_id, efi_txid, c6_txid, openpix_correlation_id,
      status, criado_em, expira_em, atualizado_em
    ) VALUES (
      @canal_id, @transacao_id, @guild_id, @cliente_id, @produto_id, @numero_pedido,
      @item_nome, @variante_nome, @valor, @mp_payment_id, @efi_txid, @c6_txid, @openpix_correlation_id,
      'PENDING', @criado_em, @expira_em, @atualizado_em
    )
    ON CONFLICT(canal_id) DO UPDATE SET
      transacao_id = excluded.transacao_id,
      produto_id = excluded.produto_id,
      numero_pedido = excluded.numero_pedido,
      item_nome = excluded.item_nome,
      variante_nome = excluded.variante_nome,
      valor = excluded.valor,
      mp_payment_id = excluded.mp_payment_id,
      efi_txid = excluded.efi_txid,
      c6_txid = excluded.c6_txid,
      openpix_correlation_id = excluded.openpix_correlation_id,
      status = 'PENDING',
      motivo_cancelamento = NULL,
      cancelado_por = NULL,
      criado_em = excluded.criado_em,
      expira_em = excluded.expira_em,
      atualizado_em = excluded.atualizado_em
  `),
  getTransacaoPorCanal: db.prepare(`SELECT * FROM transacoes_pagamento WHERE canal_id = ?`),
  getTransacaoPorId: db.prepare(`SELECT * FROM transacoes_pagamento WHERE transacao_id = ?`),
  // Todas as transições abaixo só têm efeito quando o status ATUAL ainda é
  // 'PENDING' — é isso que impede qualquer condição de corrida (cliente
  // cancela x pagamento aprovado x timer expira x admin confirma, em
  // qualquer ordem/simultaneidade). `changes === 1` = a transição venceu;
  // `changes === 0` = outra transição já tinha fechado essa transação antes.
  marcarTransacaoPaga: db.prepare(`
    UPDATE transacoes_pagamento SET status = 'PAID', atualizado_em = @agora
    WHERE canal_id = @canal_id AND status = 'PENDING'
  `),
  marcarTransacaoCancelada: db.prepare(`
    UPDATE transacoes_pagamento SET status = 'CANCELLED', motivo_cancelamento = @motivo,
      cancelado_por = @cancelado_por, atualizado_em = @agora
    WHERE canal_id = @canal_id AND status = 'PENDING'
  `),
  marcarTransacaoExpirada: db.prepare(`
    UPDATE transacoes_pagamento SET status = 'EXPIRED', atualizado_em = @agora
    WHERE canal_id = @canal_id AND status = 'PENDING'
  `),
  marcarTransacaoRecusada: db.prepare(`
    UPDATE transacoes_pagamento SET status = 'REFUSED', cancelado_por = @recusado_por, atualizado_em = @agora
    WHERE canal_id = @canal_id AND status = 'PENDING'
  `),
  listarTransacoesPendentes: db.prepare(`SELECT * FROM transacoes_pagamento WHERE status = 'PENDING'`),
};

// ─────────────────────────────────────────────────────────────────────
// Colunas conhecidas do produto (top-level, 1 nível — confirmado que
// TODOS os path_keys usados em db.atualizarProduto no projeto inteiro
// são de 1 único nível, nunca aninhados) mapeadas para coluna simples.
// Campos que já eram objetos/arrays no JSON original viram colunas
// *_json (serializadas), preservando o dado exatamente como está —
// sem inventar novo formato. Qualquer path desconhecido no futuro cai
// em `extra_json` (fallback seguro, nunca perde dado).
// ─────────────────────────────────────────────────────────────────────
const COLUNAS_TEXTO_SIMPLES = new Set([
  'titulo', 'descricao', 'preco', 'banner', 'thumbnail', 'footer',
  'corBotao', 'corEmbed', 'cargoId', 'canalEntregasId', 'canalAvaliacaoId',
  'vitrineCanalId', 'vitrineMsgId', 'criadoEm', 'precoComparacao', 'mensagemPosVenda',
]);
const COLUNAS_JSON = {
  condicoes: 'condicoes_json',
  cargosPosCompra: 'cargosPosCompra_json',
  assinatura: 'assinatura_json',
};
// campos que têm tratamento especial fora do loop genérico:
// 'ativo' (boolean -> 0/1), 'variantes' (tabela própria),
// 'estoque' (tabela própria), 'cupons' (tabela própria), 'id' (imutável).

function boolParaInt(v) { return v ? 1 : 0; }
function intParaBool(v) { return v === 1 || v === true; }

function parseJsonSeguro(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────
// Materializa um produto (linha `produtos` + variantes + estoque +
// cupons) de volta para o MESMO formato de objeto que o db.js antigo
// (baseado em JSON) sempre produziu — para que produto.js, salesManager.js
// e cupomManager.js continuem funcionando sem nenhuma alteração.
// ─────────────────────────────────────────────────────────────────────
function materializarProduto(row) {
  if (!row) return null;

  const variantesRows = stmts.getVariantesByProduto.all(row.id);
  const estoqueRows = stmts.getEstoqueByProduto.all(row.id);
  const cuponsRows = stmts.getCuponsByProduto.all(row.id);

  // estoque do produto principal = itens com variante_id NULL
  const estoqueProduto = estoqueRows
    .filter(e => e.variante_id == null)
    .map(e => e.item_texto);

  const variantes = variantesRows.map(v => {
    const itensVariante = estoqueRows
      .filter(e => e.variante_id === v.variante_id)
      .map(e => e.item_texto);
    const variante = {
      id: v.variante_id,
      nome: v.nome,
      preco: v.preco,
      emoji: v.emoji,
      // Espelha o comportamento original: se existem itens reais
      // (itensEstoque), `estoque` é o length deles; senão é o número
      // armazenado (ou null = ilimitado).
      estoque: itensVariante.length > 0 ? itensVariante.length : v.estoque_num,
    };
    // `itensEstoque` só é incluído quando de fato existem itens —
    // igual ao formato original (variantes sem estoque real nunca
    // tinham essa chave populada com array vazio "fantasma").
    if (itensVariante.length > 0) variante.itensEstoque = itensVariante;
    return variante;
  });

  const cupons = {};
  for (const c of cuponsRows) {
    cupons[c.codigo] = {
      desconto: c.desconto,
      tipo: c.tipo,
      valorFixo: c.valorFixo,
      usos: c.usos,
      usosMaximos: c.usosMaximos,
      cargoObrigatorioId: c.cargoObrigatorioId,
      valorMinimo: c.valorMinimo,
      valorMaximo: c.valorMaximo,
      validoAte: c.validoAte,
      criadoEm: c.criadoEm,
      criadoPor: c.criadoPor,
    };
  }

  const produto = {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    preco: row.preco,
    banner: row.banner,
    thumbnail: row.thumbnail,
    footer: row.footer,
    corBotao: row.corBotao,
    corEmbed: row.corEmbed,
    cargoId: row.cargoId,
    canalEntregasId: row.canalEntregasId,
    canalAvaliacaoId: row.canalAvaliacaoId,
    vitrineCanalId: row.vitrineCanalId,
    vitrineMsgId: row.vitrineMsgId,
    ativo: intParaBool(row.ativo),
    criadoEm: row.criadoEm,
    variantes,
    estoque: estoqueProduto,
    cupons,
  };

  if (row.precoComparacao != null) produto.precoComparacao = row.precoComparacao;
  if (row.mensagemPosVenda != null) produto.mensagemPosVenda = row.mensagemPosVenda;
  if (row.condicoes_json != null) produto.condicoes = parseJsonSeguro(row.condicoes_json, undefined);
  if (row.cargosPosCompra_json != null) produto.cargosPosCompra = parseJsonSeguro(row.cargosPosCompra_json, undefined);
  if (row.assinatura_json != null) produto.assinatura = parseJsonSeguro(row.assinatura_json, undefined);
  if (row.legado) produto._legado = true;

  // Campos desconhecidos (futuros / não previstos hoje) — nunca perdidos.
  const extra = parseJsonSeguro(row.extra_json, null);
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in produto)) produto[k] = v;
    }
  }

  return produto;
}

function getProdutosByGuild(guildId) {
  return stmts.getProdutosByGuild.all(guildId).map(materializarProduto);
}

function getProdutoById(produtoId) {
  return materializarProduto(stmts.getProdutoById.get(produtoId));
}

// Grava (INSERT OR full REPLACE) um produto inteiro — usado por
// criarProduto, e internamente por sincronização de variantes/estoque/
// cupons quando o valor inteiro é substituído (mesmo padrão do
// db.js original: `atualizarProduto(id, 'variantes', arrayCompleto)`).
function upsertProdutoCompleto(guildId, produto, ordem) {
  const camposConhecidos = new Set([
    'id', 'titulo', 'descricao', 'preco', 'banner', 'thumbnail', 'footer',
    'corBotao', 'corEmbed', 'cargoId', 'canalEntregasId', 'canalAvaliacaoId',
    'vitrineCanalId', 'vitrineMsgId', 'ativo', 'criadoEm', 'variantes',
    'estoque', 'cupons', 'precoComparacao', 'mensagemPosVenda', 'condicoes',
    'cargosPosCompra', 'assinatura', '_legado',
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(produto)) {
    if (!camposConhecidos.has(k)) extra[k] = v;
  }

  const row = {
    id: produto.id,
    guild_id: guildId,
    ordem: ordem ?? 0,
    titulo: produto.titulo ?? null,
    descricao: produto.descricao ?? null,
    preco: produto.preco ?? null,
    banner: produto.banner ?? null,
    thumbnail: produto.thumbnail ?? null,
    footer: produto.footer ?? null,
    corBotao: produto.corBotao ?? null,
    corEmbed: produto.corEmbed ?? null,
    cargoId: produto.cargoId ?? null,
    canalEntregasId: produto.canalEntregasId ?? null,
    canalAvaliacaoId: produto.canalAvaliacaoId ?? null,
    vitrineCanalId: produto.vitrineCanalId ?? null,
    vitrineMsgId: produto.vitrineMsgId ?? null,
    ativo: boolParaInt(produto.ativo),
    criadoEm: produto.criadoEm ?? null,
    precoComparacao: produto.precoComparacao ?? null,
    mensagemPosVenda: produto.mensagemPosVenda ?? null,
    condicoes_json: produto.condicoes !== undefined ? JSON.stringify(produto.condicoes) : null,
    cargosPosCompra_json: produto.cargosPosCompra !== undefined ? JSON.stringify(produto.cargosPosCompra) : null,
    assinatura_json: produto.assinatura !== undefined ? JSON.stringify(produto.assinatura) : null,
    legado: boolParaInt(produto._legado),
    extra_json: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
  };

  stmts.deleteProduto.run(produto.id);
  stmts.insertProduto.run(row);

  sincronizarVariantes(produto.id, Array.isArray(produto.variantes) ? produto.variantes : []);
  sincronizarEstoqueProduto(produto.id, Array.isArray(produto.estoque) ? produto.estoque
    : (typeof produto.estoque === 'string' && produto.estoque.trim()
        ? produto.estoque.trim().split('\n').map(s => s.trim()).filter(Boolean)
        : []));
  sincronizarCupons(produto.id, produto.cupons && typeof produto.cupons === 'object' ? produto.cupons : {});
}

// Atualiza SOMENTE um campo top-level de um produto (equivalente ao
// antigo `atualizarProduto(guildId, produtoId, path_keys, value)` com
// path_keys de 1 nível — confirmado ser o único caso usado no projeto).
function updateProdutoCampo(produtoId, campo, value) {
  if (campo === 'variantes') return sincronizarVariantes(produtoId, Array.isArray(value) ? value : []);
  if (campo === 'estoque') {
    const arr = Array.isArray(value) ? value
      : (typeof value === 'string' && value.trim() ? value.trim().split('\n').map(s => s.trim()).filter(Boolean) : []);
    return sincronizarEstoqueProduto(produtoId, arr);
  }
  if (campo === 'cupons') return sincronizarCupons(produtoId, value && typeof value === 'object' ? value : {});
  if (campo === 'ativo') return stmts.updateProdutoField('ativo').run(boolParaInt(value), produtoId);
  if (campo === 'id') return false; // id é imutável

  if (COLUNAS_TEXTO_SIMPLES.has(campo)) {
    stmts.updateProdutoField(campo).run(value ?? null, produtoId);
    return true;
  }
  if (COLUNAS_JSON[campo]) {
    stmts.updateProdutoField(COLUNAS_JSON[campo]).run(value !== undefined ? JSON.stringify(value) : null, produtoId);
    return true;
  }

  // Campo desconhecido: guarda dentro de extra_json sem perder o que já
  // existia lá (merge), em vez de rejeitar a escrita.
  const atual = stmts.getProdutoById.get(produtoId);
  if (!atual) return false;
  const extra = parseJsonSeguro(atual.extra_json, {});
  extra[campo] = value;
  stmts.updateProdutoField('extra_json').run(JSON.stringify(extra), produtoId);
  return true;
}

function sincronizarVariantes(produtoId, variantesArray) {
  stmts.deleteVariantesByProduto.run(produtoId);
  // Os itens de estoque de variante ficam em produto_estoque com
  // variante_id preenchido — ao resincronizar a lista de variantes,
  // removemos também os itens de estoque das variantes que deixaram
  // de existir, e reinserimos os itens das que continuam/são novas
  // (evita "itens órfãos" de uma variante removida).
  const existentes = new Set(variantesArray.map(v => v.id));
  const todosEstoqueVariante = stmts.getEstoqueByProduto.all(produtoId).filter(e => e.variante_id != null);
  const paraRemover = todosEstoqueVariante.filter(e => !existentes.has(e.variante_id));
  if (paraRemover.length > 0) {
    const del = db.prepare(`DELETE FROM produto_estoque WHERE id = ?`);
    for (const item of paraRemover) del.run(item.id);
  }

  variantesArray.forEach((v, idx) => {
    stmts.insertVariante.run({
      produto_id: produtoId,
      variante_id: v.id,
      ordem: idx,
      nome: v.nome ?? null,
      preco: v.preco ?? null,
      emoji: v.emoji ?? null,
      estoque_num: (typeof v.estoque === 'number') ? v.estoque : null,
    });
    // Reinsere itensEstoque da variante (se existirem), substituindo
    // qualquer estado anterior daquela variante específica.
    const del = db.prepare(`DELETE FROM produto_estoque WHERE produto_id = ? AND variante_id = ?`);
    del.run(produtoId, v.id);
    if (Array.isArray(v.itensEstoque)) {
      v.itensEstoque.forEach((texto, i) => {
        stmts.insertEstoqueItem.run({ produto_id: produtoId, variante_id: v.id, ordem: i, item_texto: String(texto) });
      });
    }
  });
}

function sincronizarEstoqueProduto(produtoId, itensArray) {
  // Remove só os itens do PRODUTO principal (variante_id NULL);
  // itens de variantes são geridos por sincronizarVariantes.
  const del = db.prepare(`DELETE FROM produto_estoque WHERE produto_id = ? AND variante_id IS NULL`);
  del.run(produtoId);
  itensArray.forEach((texto, idx) => {
    stmts.insertEstoqueItem.run({ produto_id: produtoId, variante_id: null, ordem: idx, item_texto: String(texto) });
  });
}

function sincronizarCupons(produtoId, cuponsObj) {
  stmts.deleteCuponsByProduto.run(produtoId);
  for (const [codigo, c] of Object.entries(cuponsObj)) {
    stmts.insertCupom.run({
      produto_id: produtoId,
      codigo,
      desconto: c.desconto ?? null,
      tipo: c.tipo ?? null,
      valorFixo: c.valorFixo ?? null,
      usos: c.usos ?? 0,
      usosMaximos: c.usosMaximos ?? null,
      cargoObrigatorioId: c.cargoObrigatorioId ?? null,
      valorMinimo: c.valorMinimo ?? null,
      valorMaximo: c.valorMaximo ?? null,
      validoAte: c.validoAte ?? null,
      criadoEm: c.criadoEm ?? null,
      criadoPor: c.criadoPor ?? null,
    });
  }
}

function deleteProdutoCompleto(produtoId) {
  stmts.deleteVariantesByProduto.run(produtoId);
  db.prepare(`DELETE FROM produto_estoque WHERE produto_id = ?`).run(produtoId);
  stmts.deleteCuponsByProduto.run(produtoId);
  stmts.deleteProduto.run(produtoId);
}

// Substitui TODOS os produtos de uma guild de uma vez (usado por
// setGuild/import de backup, quando o objeto completo `loja.produtos`
// é fornecido de fora).
function sincronizarProdutosDaGuild(guildId, produtosArray) {
  const atuais = stmts.getProdutosByGuild.all(guildId);
  for (const p of atuais) deleteProdutoCompleto(p.id);
  produtosArray.forEach((produto, idx) => upsertProdutoCompleto(guildId, produto, idx));
}

// ─────────────────────────────────────────────────────────────────────
// guild_meta: leitura/escrita do blob JSON (tudo em guild.* exceto
// loja.produtos, que é sempre calculado a partir das tabelas acima).
// ─────────────────────────────────────────────────────────────────────
const GUILD_DEFAULT = () => ({
  pix: { chave: null, nome: null, qrcode: null },
  logs: { channelId: null },
  config: { logo: null, cor: '0x2b2d31', nome: null },
  blacklist: {},
});

function getGuildRaw(guildId) {
  const row = stmts.getGuildMeta.get(guildId);
  if (!row) return null;
  return parseJsonSeguro(row.data_json, {});
}

function setGuildRaw(guildId, dataSemProdutos) {
  stmts.upsertGuildMeta.run({
    guild_id: guildId,
    data_json: JSON.stringify(dataSemProdutos),
    updated_at: new Date().toISOString(),
  });
}

function guildExiste(guildId) {
  return !!stmts.getGuildMeta.get(guildId);
}

function todosGuildIds() {
  return stmts.allGuildIds.all().map(r => r.guild_id);
}

function getMigrationFlag(key) {
  const row = stmts.getMigrationMeta.get(key);
  return row ? row.value : null;
}
function setMigrationFlag(key, value) {
  stmts.setMigrationMeta.run(key, value);
}

// ─────────────────────────────────────────────────────────────────────
// KAEL INTELLIGENCE — funções de carrinho (usadas por commands/produto.js,
// sales-system/salesManager.js, commands/intelligence.js e o scheduler de
// recuperação). Todas isoladas por guild_id — nenhuma consulta cruza dados
// entre servidores diferentes.
// ─────────────────────────────────────────────────────────────────────
function registrarCarrinho({ guildId, clienteId, produtoId, produtoNome, varianteNome, canalId }) {
  const agora = new Date().toISOString();
  const info = stmts.insertCarrinho.run({
    guild_id: guildId,
    cliente_id: clienteId,
    produto_id: produtoId || null,
    produto_nome: produtoNome || null,
    variante_nome: varianteNome || null,
    canal_id: canalId || null,
    criado_em: agora,
    atualizado_em: agora,
  });
  return info.lastInsertRowid;
}

function atualizarStatusCarrinhoPorCanal(canalId, novoStatus) {
  if (!canalId) return;
  stmts.atualizarStatusCarrinhoPorCanal.run({ canal_id: canalId, status: novoStatus, atualizado_em: new Date().toISOString() });
}

function getCarrinhoPorCanal(canalId) {
  if (!canalId) return null;
  return stmts.getCarrinhoPorCanal.get(canalId) || null;
}

function listarCarrinhosAbandonados(guildId, minutosLimite) {
  const limite = new Date(Date.now() - minutosLimite * 60000).toISOString();
  return stmts.listarCarrinhosAbandonadosPorGuild.all({ guild_id: guildId, limite });
}

function listarCarrinhosParaNotificar(minutosLimite) {
  const limite = new Date(Date.now() - minutosLimite * 60000).toISOString();
  return stmts.listarCarrinhosParaNotificar.all({ limite });
}

function marcarCarrinhoNotificado(id) {
  stmts.marcarCarrinhoNotificado.run(id);
}

function getCarrinhosPorGuildDesde(guildId, desdeISO) {
  return stmts.getCarrinhosPorGuildDesde.all({ guild_id: guildId, desde: desdeISO });
}

// ─────────────────────────────────────────────────────────────────────
// KAEL — transacoes_pagamento
// ─────────────────────────────────────────────────────────────────────
function criarOuReaproveitarTransacaoPendente(dados) {
  stmts.upsertTransacaoPendente.run({
    canal_id: dados.canalId,
    transacao_id: dados.transacaoId,
    guild_id: dados.guildId,
    cliente_id: dados.clienteId,
    produto_id: dados.produtoId || null,
    numero_pedido: dados.numeroPedido ?? null,
    item_nome: dados.itemNome || null,
    variante_nome: dados.varianteNome || null,
    valor: dados.valor || null,
    mp_payment_id: dados.mpPaymentId || null,
    efi_txid: dados.efiTxid || null,
    c6_txid: dados.c6Txid || null,
    openpix_correlation_id: dados.openpixCorrelationID || null,
    criado_em: dados.criadoEm,
    expira_em: dados.expiraEm,
    atualizado_em: dados.atualizadoEm,
  });
}

function getTransacaoPagamentoPorCanal(canalId) {
  if (!canalId) return null;
  return stmts.getTransacaoPorCanal.get(canalId) || null;
}

function getTransacaoPagamentoPorId(transacaoId) {
  if (!transacaoId) return null;
  return stmts.getTransacaoPorId.get(transacaoId) || null;
}

function marcarTransacaoPaga(canalId, agoraISO) {
  const info = stmts.marcarTransacaoPaga.run({ canal_id: canalId, agora: agoraISO });
  return info.changes;
}

function marcarTransacaoCancelada(canalId, motivo, canceladoPor, agoraISO) {
  const info = stmts.marcarTransacaoCancelada.run({ canal_id: canalId, motivo: motivo || null, cancelado_por: canceladoPor || null, agora: agoraISO });
  return info.changes;
}

function marcarTransacaoExpirada(canalId, agoraISO) {
  const info = stmts.marcarTransacaoExpirada.run({ canal_id: canalId, agora: agoraISO });
  return info.changes;
}

function marcarTransacaoRecusada(canalId, recusadoPor, agoraISO) {
  const info = stmts.marcarTransacaoRecusada.run({ canal_id: canalId, recusado_por: recusadoPor || null, agora: agoraISO });
  return info.changes;
}

function listarTransacoesPendentes() {
  return stmts.listarTransacoesPendentes.all();
}

function withTransaction(fn) {
  return db.transaction(fn)();
}

module.exports = {
  db,
  DB_PATH,
  GUILD_DEFAULT,
  getGuildRaw,
  setGuildRaw,
  guildExiste,
  todosGuildIds,
  getProdutosByGuild,
  getProdutoById,
  upsertProdutoCompleto,
  updateProdutoCampo,
  deleteProdutoCompleto,
  sincronizarProdutosDaGuild,
  getMigrationFlag,
  setMigrationFlag,
  withTransaction,
  // KAEL INTELLIGENCE
  registrarCarrinho,
  atualizarStatusCarrinhoPorCanal,
  getCarrinhoPorCanal,
  listarCarrinhosAbandonados,
  listarCarrinhosParaNotificar,
  marcarCarrinhoNotificado,
  getCarrinhosPorGuildDesde,
  // KAEL — transacoes_pagamento
  criarOuReaproveitarTransacaoPendente,
  getTransacaoPagamentoPorCanal,
  getTransacaoPagamentoPorId,
  marcarTransacaoPaga,
  marcarTransacaoCancelada,
  marcarTransacaoExpirada,
  marcarTransacaoRecusada,
  listarTransacoesPendentes,
};
