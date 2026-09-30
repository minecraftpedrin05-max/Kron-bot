// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/store.js — KAEL SERVER TEMPLATES
//
//  ÚNICA camada de persistência do sistema de templates. Usa o banco que o
//  KAEL já tem (database/db.js → database.sqlite, que já entra no backup
//  automático do bot). Nenhuma tabela nova, nenhum schema alterado:
//
//    POR SERVIDOR  (db.getGuild(guildId).kronTemplates)
//        favoritos { [userId]: [slug] }   histórico [ ... ] (últimos 15)
//
//    GLOBAL        (guild reservada '__kron_templates__')
//        usos { [slug]: n }   envios [ ... ]   comunidade { [slug]: template }
//
//  Se um dia a comunidade passar de algumas centenas de templates, é só trocar
//  a implementação DESTE arquivo (ex.: tabela própria) — o resto do sistema só
//  usa as funções exportadas aqui.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const db = require('../../database/db');

const GLOBAL = '__kron_templates__';
const MAX_FAVORITOS = 25;
const MAX_HISTORICO = 15;
const HISTORICO_COM_ROLLBACK = 3;
const MAX_ENVIOS = 40;
const MAX_PENDENTES_USUARIO = 3;

const novoId = () => crypto.randomBytes(5).toString('hex');
const lerGuild = (guildId) => (db.getGuild(guildId).kronTemplates || {});
const lerGlobal = () => (db.getGuild(GLOBAL).kronTemplates || {});

// ── favoritos (por servidor + usuário) ───────────────────────────────────
function getFavoritos(guildId, userId) {
  const f = lerGuild(guildId).favoritos || {};
  return Array.isArray(f[userId]) ? f[userId] : [];
}

/** Alterna favorito. Retorna { favorito: bool, cheio: bool } */
function alternarFavorito(guildId, userId, slug) {
  const todos = { ...(lerGuild(guildId).favoritos || {}) };
  const atual = Array.isArray(todos[userId]) ? [...todos[userId]] : [];
  const i = atual.indexOf(slug);
  if (i >= 0) { atual.splice(i, 1); todos[userId] = atual; db.updateGuild(guildId, 'kronTemplates.favoritos', todos); return { favorito: false, cheio: false }; }
  if (atual.length >= MAX_FAVORITOS) return { favorito: false, cheio: true };
  atual.push(slug);
  todos[userId] = atual;
  db.updateGuild(guildId, 'kronTemplates.favoritos', todos);
  return { favorito: true, cheio: false };
}

// ── estatísticas de uso (global) ─────────────────────────────────────────
function usoTodos() {
  return lerGlobal().uso || {};
}
function registrarUso(slug) {
  try {
    const uso = { ...usoTodos() };
    uso[slug] = (uso[slug] || 0) + 1;
    db.updateGuild(GLOBAL, 'kronTemplates.uso', uso);
  } catch (e) { console.error('[Kael Templates] Falha ao registrar uso:', e.message); }
}

// ── histórico de aplicações (por servidor) ───────────────────────────────
function getHistorico(guildId) {
  const h = lerGuild(guildId).historico;
  return Array.isArray(h) ? h : [];
}

function salvarHistorico(guildId, lista) {
  const cortada = lista.slice(0, MAX_HISTORICO);
  // só as aplicações mais recentes guardam IDs para rollback (mantém o blob da guild pequeno)
  cortada.forEach((e, i) => { if (i >= HISTORICO_COM_ROLLBACK && e.criados) { delete e.criados; e.semRollback = true; } });
  db.updateGuild(guildId, 'kronTemplates.historico', cortada);
}

function adicionarHistorico(guildId, entrada) {
  const e = { id: novoId(), ts: new Date().toISOString(), desfeito: null, ...entrada };
  salvarHistorico(guildId, [e, ...getHistorico(guildId)]);
  return e;
}

function atualizarHistorico(guildId, id, patch) {
  const lista = getHistorico(guildId).map(e => (e.id === id ? { ...e, ...patch } : e));
  salvarHistorico(guildId, lista);
}

function getEntradaHistorico(guildId, id) {
  return getHistorico(guildId).find(e => e.id === id) || null;
}

// ── comunidade: envios, revisão e biblioteca aprovada (global) ───────────
function comunidade() {
  const c = lerGlobal().comunidade || {};
  return Object.values(c);
}

function listarEnvios(status) {
  const e = lerGlobal().envios;
  const lista = Array.isArray(e) ? e : [];
  return status ? lista.filter(x => x.status === status) : lista;
}

function getEnvio(id) {
  return listarEnvios().find(e => e.id === id) || null;
}

function salvarEnvios(lista) {
  // mantém todos os pendentes + os 15 resolvidos mais recentes; resolvidos perdem o corpo do template
  const pend = lista.filter(e => e.status === 'pendente');
  const resolvidos = lista.filter(e => e.status !== 'pendente').slice(0, 15).map(e => ({ ...e, template: undefined }));
  db.updateGuild(GLOBAL, 'kronTemplates.envios', [...pend, ...resolvidos].slice(0, MAX_ENVIOS));
}

function pendentesDoUsuario(userId) {
  return listarEnvios('pendente').filter(e => e.userId === userId).length;
}

/** @returns {{ok:boolean, envio?:object, erro?:string}} */
function criarEnvio({ guildId, userId, template, avisos }) {
  if (pendentesDoUsuario(userId) >= MAX_PENDENTES_USUARIO) return { ok: false, erro: `Você já tem ${MAX_PENDENTES_USUARIO} templates em análise. Aguarde a revisão da equipe Kael.` };
  if (listarEnvios('pendente').length >= MAX_ENVIOS - 5) return { ok: false, erro: 'A fila de análise está cheia no momento. Tente novamente mais tarde.' };
  const envio = {
    id: novoId(), guildId, userId, criadoEm: new Date().toISOString(), status: 'pendente',
    nome: template.nome, slug: template.slug, avisos: (avisos || []).slice(0, 10), template,
  };
  salvarEnvios([envio, ...listarEnvios()]);
  return { ok: true, envio };
}

function resolverEnvio(id, patch) {
  salvarEnvios(listarEnvios().map(e => (e.id === id ? { ...e, ...patch, revisadoEm: new Date().toISOString() } : e)));
}

/** Publica um envio aprovado na biblioteca da comunidade. NUNCA é chamado automaticamente. */
function aprovarEnvio(id, revisorId, slugFinal) {
  const envio = getEnvio(id);
  if (!envio || envio.status !== 'pendente' || !envio.template) return { ok: false, erro: 'Envio não está mais pendente.' };
  const hoje = new Date().toISOString().slice(0, 10);
  const t = {
    ...envio.template,
    slug: slugFinal, id: `com:${slugFinal}`, oficial: false, premium: false, destaque: false,
    status: 'publicado', criadoEm: hoje, atualizadoEm: hoje,
    envioId: envio.id, enviadoPor: envio.userId,
  };
  const c = { ...(lerGlobal().comunidade || {}) };
  c[slugFinal] = t;
  db.updateGuild(GLOBAL, 'kronTemplates.comunidade', c);
  resolverEnvio(id, { status: 'aprovado', revisor: revisorId, slugFinal });
  return { ok: true, template: t };
}

function recusarEnvio(id, revisorId, motivo) {
  const envio = getEnvio(id);
  if (!envio || envio.status !== 'pendente') return { ok: false, erro: 'Envio não está mais pendente.' };
  resolverEnvio(id, { status: 'recusado', revisor: revisorId, motivo: String(motivo || '').slice(0, 300) });
  return { ok: true, envio };
}

function removerComunidade(slug) {
  const c = { ...(lerGlobal().comunidade || {}) };
  const existia = !!c[slug];
  delete c[slug];
  db.updateGuild(GLOBAL, 'kronTemplates.comunidade', c);
  return existia;
}

// ── operação em andamento (recovery após restart) ────────────────────────
//
//  Enquanto uma APLICAÇÃO (criar cargos/categorias/canais) está rodando,
//  guardamos aqui o estado atual + os IDs já criados, ATUALIZANDO a cada
//  recurso criado (não só no final). Se o bot cair no meio, o processo
//  seguinte encontra esse registro ainda "aberto" e sabe exatamente o que
//  já foi criado — sem precisar adivinhar ou duplicar nada.
//
//  Um índice global (`operacoesAtivas`) evita ter que varrer todas as
//  guilds no boot: só olhamos as guilds que de fato têm operação pendente.
//
//  DESFAZER (rollback) não precisa disso: apagar por ID já verifica se o
//  recurso existe antes de apagar (ver applier.desfazer), então repetir
//  um rollback interrompido é seguro por natureza — não há como duplicar
//  uma exclusão.
const ESTADOS_OPERACAO = [
  'STARTED', 'CREATING_ROLES', 'CREATING_CATEGORIES', 'CREATING_CHANNELS',
  'APPLYING_PERMISSIONS', 'COMPLETED', 'FAILED', 'ROLLBACK',
];

function getIndiceOperacoes() {
  const l = lerGlobal().operacoesAtivas;
  return Array.isArray(l) ? l : [];
}
function salvarIndiceOperacoes(lista) {
  db.updateGuild(GLOBAL, 'kronTemplates.operacoesAtivas', [...new Set(lista)]);
}

function getOperacao(guildId) {
  return lerGuild(guildId).operacao || null;
}

/** Abre uma nova operação para a guild (estado inicial STARTED). Sobrescreve qualquer operação anterior já finalizada/órfã. */
function iniciarOperacao(guildId, dados) {
  const op = {
    id: novoId(), guildId,
    estado: 'STARTED',
    criados: { cargos: [], categorias: [], canais: [] },
    iniciadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    ...dados,
  };
  db.updateGuild(guildId, 'kronTemplates.operacao', op);
  const idx = getIndiceOperacoes();
  if (!idx.includes(guildId)) salvarIndiceOperacoes([...idx, guildId]);
  return op;
}

/** Atualiza campos da operação atual (ex.: mudar de estágio). Não faz nada se não houver operação aberta. */
function atualizarOperacao(guildId, patch) {
  const atual = getOperacao(guildId);
  if (!atual) return null;
  if (patch && patch.estado && !ESTADOS_OPERACAO.includes(patch.estado)) delete patch.estado;
  const novo = { ...atual, ...patch, atualizadoEm: new Date().toISOString() };
  db.updateGuild(guildId, 'kronTemplates.operacao', novo);
  return novo;
}

/** Registra IMEDIATAMENTE um recurso criado (cargo/categoria/canal) na operação atual — chamado a cada criação, não só no final. */
function registrarRecursoOperacao(guildId, tipo, item) {
  const atual = getOperacao(guildId);
  if (!atual) return;
  const criados = { ...atual.criados, [tipo]: [...(atual.criados[tipo] || []), item] };
  db.updateGuild(guildId, 'kronTemplates.operacao', { ...atual, criados, atualizadoEm: new Date().toISOString() });
}

/** Fecha a operação (sucesso, falha tratada, ou consumida pelo recovery). Remove do índice global. */
function finalizarOperacao(guildId) {
  db.updateGuild(guildId, 'kronTemplates.operacao', null);
  const idx = getIndiceOperacoes();
  if (idx.includes(guildId)) salvarIndiceOperacoes(idx.filter((g) => g !== guildId));
}

module.exports = {
  GLOBAL, MAX_FAVORITOS, MAX_PENDENTES_USUARIO, ESTADOS_OPERACAO,
  getFavoritos, alternarFavorito, usoTodos, registrarUso,
  getHistorico, adicionarHistorico, atualizarHistorico, getEntradaHistorico,
  comunidade, listarEnvios, getEnvio, pendentesDoUsuario, criarEnvio, aprovarEnvio, recusarEnvio, removerComunidade,
  getIndiceOperacoes, getOperacao, iniciarOperacao, atualizarOperacao, registrarRecursoOperacao, finalizarOperacao,
};
