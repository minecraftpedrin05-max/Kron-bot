'use strict';
/**
 * KAEL — Verificação Web
 *
 * Fluxo (site padrão Kael):
 *   1) Usuário clica no botão do painel público (Discord) → cria sessão (PENDING),
 *      já sabendo guildId + userId (vieram da própria interação do Discord).
 *   2) Bot responde (efêmero) com um link único para /verify/<sessionId>.
 *   3) A página Kael mostra um botão "Verificar" que É o próprio link de
 *      autorização OAuth2 do Discord (authorize), com state=<sessionId>.
 *   4) Discord redireciona para /verify/callback?code=...&state=<sessionId>.
 *   5) Backend troca o code por um access_token (OAuth2 oficial, scope
 *      "identify"), busca /users/@me, e CONFIRMA que o id retornado é
 *      exatamente o userId que iniciou a sessão (nunca confia só no clique).
 *   6) Concede o cargo reaproveitando concluirVerificacao() do sistema de
 *      verificação já existente (mesmas validações de cargo/hierarquia/bot).
 *   7) Marca sessão VERIFIED, registra log (registrarEvento já existente),
 *      renderiza página de sucesso com link de volta pro Discord.
 *
 * Fluxo (site personalizado do servidor):
 *   O admin configura uma URL própria. O bot ainda cria a sessão da mesma
 *   forma e manda o usuário pra lá com ?session=<id>. Não existe um padrão
 *   oficial do Discord para "federar" verificação entre dois backends
 *   diferentes — isso é um contrato próprio do Kael: o site do servidor,
 *   depois de identificar o usuário do jeito que quiser, chama de volta
 *   POST /verify/api/complete com { session, secret }. O "secret" é gerado
 *   uma única vez por servidor (mostrado uma vez só no /painel) e funciona
 *   como um webhook secret — só quem tem o secret consegue completar
 *   verificações daquele servidor. Isso é análogo a um webhook signature
 *   (mesma ideia usada no webhook da OpenPix), não um endpoint do Discord.
 *
 * Nunca armazena o access_token OAuth além do tempo necessário pra buscar
 * o /users/@me (usado e descartado na mesma requisição).
 */
const crypto = require('crypto');
const db = require('../database/db');

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min — tempo suficiente pra passar pelo OAuth no celular
const SESSION_CAP = 5000;
const DISCORD_API = 'https://discord.com/api/v10';

// ── Sessões (em memória — mesmo padrão já usado pelo `sessions` Map da
// etapa adicional em verificacaoManager.js: curta duração, não precisa
// sobreviver a um restart do bot; se cair no meio, o usuário simplesmente
// clica em "Verificar" de novo no Discord e ganha um link novo). ─────────
const sessoes = new Map();

function limparExpiradas() {
  const now = Date.now();
  for (const [id, s] of sessoes) if (s.expiresAt <= now) sessoes.delete(id);
}
setInterval(limparExpiradas, 60 * 1000).unref?.();

function criarSessao(guildId, userId, panelId) {
  limparExpiradas();
  if (sessoes.size > SESSION_CAP) { // proteção contra esgotamento de memória
    const mais_antiga = [...sessoes.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (mais_antiga) sessoes.delete(mais_antiga[0]);
  }
  const id = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  sessoes.set(id, {
    id, guildId, userId, panelId,
    status: 'PENDING',
    createdAt: now, expiresAt: now + SESSION_TTL_MS,
    motivo: null,
  });
  return id;
}

function getSessao(id) {
  if (!/^[a-f0-9]{48}$/.test(String(id || ''))) return null;
  const s = sessoes.get(id);
  if (!s) return null;
  if (s.expiresAt <= Date.now() && s.status === 'PENDING') { s.status = 'EXPIRED'; }
  return s;
}

// ── Rate limit simples por IP (janela deslizante) — usado nas rotas de
// callback/API, que são as únicas que fazem trabalho de verdade. ────────
const buckets = new Map();
function rateLimitOk(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (buckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(ip, arr); return false; }
  arr.push(now); buckets.set(ip, arr);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return true;
}

// ── Config por guild (persistida por verificacaoManager em cfg.web) ────
function getWebConfig(guildId) {
  return require('./verificacaoManager').getConfig(guildId).web;
}

function gerarSecret() {
  return crypto.randomBytes(24).toString('hex');
}
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// ── OAuth2 oficial do Discord (developers.discord.com/docs/topics/oauth2) ──
function baseUrlOk() {
  return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.PUBLIC_BASE_URL);
}
function redirectUri() {
  return `${process.env.PUBLIC_BASE_URL}/verify/callback`;
}
function authorizeUrl(sessionId) {
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    state: sessionId,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

async function trocarCodigoPorToken(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    scope: 'identify',
  });
  const r = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Discord recusou a troca do code (HTTP ${r.status}).`);
  return r.json(); // { access_token, token_type, expires_in, scope, ... }
}

async function buscarUsuarioOAuth(accessToken) {
  const r = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Falha ao buscar identidade do usuário (HTTP ${r.status}).`);
  return r.json(); // { id, username, ... }
}

// ── Concede o cargo reaproveitando o núcleo já existente ────────────────
async function concederCargo(client, session) {
  const vm = require('./verificacaoManager');
  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) return { ok: false, motivo: 'O bot não está mais neste servidor.' };
  const member = await guild.members.fetch(session.userId).catch(() => null);
  if (!member) return { ok: false, motivo: 'Não foi possível confirmar sua participação neste servidor.' };

  const cfg = vm.getConfig(guild.id);
  if (!cfg.enabled) return { ok: false, motivo: 'A verificação está desativada neste servidor.' };
  if (cfg.roles.main && member.roles.cache.has(cfg.roles.main)) {
    return { ok: true, jaVerificado: true, granted: [] };
  }
  const errMain = cfg.roles.main ? vm.validarCargo(guild, cfg.roles.main, null) : 'Cargo de verificação não configurado.';
  if (errMain) return { ok: false, motivo: errMain };

  const res = await vm.concluirVerificacao(member, guild, cfg);
  if (!res.ok) return { ok: false, motivo: res.motivo };

  vm.registrarEvento(guild, 'verified', { member, motivo: 'Verificado via site (Verificação Web).', cargo: res.granted.map((id) => `<@&${id}>`).join(' ') });
  if (cfg.security.dmAfterVerify) vm.enviarDM(member, guild, cfg).catch(() => {});
  return { ok: true, granted: res.granted, guildName: guild.name, guildIcon: guild.iconURL?.({ extension: 'png', size: 128 }) };
}

// ═══════════════════════════════════════════════════════════════════════
// HTML — site padrão Kael (auto-contido, sem dependências externas)
// ═══════════════════════════════════════════════════════════════════════
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function baseHtml({ titulo, corpo }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
:root{--bg:#0b0d12;--card:#12151c;--border:#242833;--txt:#f2f3f5;--muted:#9aa1ac;--accent:#5865F2;--ok:#57F287;--err:#ED4245}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(circle at 50% 0%,#1a1e2a 0%,var(--bg) 60%);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--txt)}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);border-radius:20px;
  padding:36px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.logo{font-weight:800;letter-spacing:2px;font-size:13px;color:var(--muted);margin-bottom:18px;text-transform:uppercase}
.icon-guild{width:64px;height:64px;border-radius:50%;margin-bottom:14px;object-fit:cover;border:1px solid var(--border)}
h1{font-size:20px;margin:0 0 10px}
p.desc{color:var(--muted);font-size:14px;line-height:1.55;margin:0 0 26px}
.btn{display:inline-flex;align-items:center;gap:8px;justify-content:center;width:100%;padding:14px 18px;border-radius:12px;
  background:var(--accent);color:#fff;font-weight:600;font-size:15px;text-decoration:none;border:none;cursor:pointer;
  transition:filter .15s}
.btn:hover{filter:brightness(1.1)}
.btn.secondary{background:transparent;border:1px solid var(--border);color:var(--txt)}
.state-icon{width:56px;height:56px;margin:0 auto 16px}
.state-icon.ok{color:var(--ok)}.state-icon.err{color:var(--err)}
.footer{margin-top:22px;font-size:11px;color:#5b6270}
</style></head>
<body><div class="card">${corpo}</div></body></html>`;
}

function paginaVerificar(session, guildInfo) {
  const nome = guildInfo?.name || 'seu servidor';
  const icone = guildInfo?.iconUrl;
  return baseHtml({
    titulo: 'Verificação necessária',
    corpo: `
      <div class="logo">KAEL</div>
      ${icone ? `<img class="icon-guild" src="${esc(icone)}" alt="">` : ''}
      <h1>🛡️ Verificação necessária</h1>
      <p class="desc">Verifique sua conta para acessar <strong>${esc(nome)}</strong> e liberar os canais.</p>
      <a class="btn" href="${esc(authorizeUrl(session.id))}">🛡️ Verificar com Discord</a>
      <div class="footer">Sessão expira em poucos minutos • Nunca pedimos sua senha</div>`,
  });
}

const ICON_OK = `<svg class="state-icon ok" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="1.5"/><path d="M7 12.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_ERR = `<svg class="state-icon err" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="1.5"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function paginaSucesso(guildId, res) {
  return baseHtml({
    titulo: 'Verificação concluída',
    corpo: `
      <div class="logo">KAEL</div>
      ${ICON_OK}
      <h1>Verificação concluída</h1>
      <p class="desc">${res.jaVerificado ? 'Sua conta já estava verificada.' : 'Sua conta foi verificada com sucesso.'}<br>Seu acesso foi liberado.</p>
      <a class="btn" href="https://discord.com/channels/${esc(guildId)}">Entrar no Discord</a>
      <div class="footer">Você já pode fechar esta página.</div>`,
  });
}

function paginaErro(titulo, mensagem) {
  return baseHtml({
    titulo,
    corpo: `
      <div class="logo">KAEL</div>
      ${ICON_ERR}
      <h1>${esc(titulo)}</h1>
      <p class="desc">${esc(mensagem)}</p>
      <div class="footer">Se o problema continuar, inicie uma nova verificação pelo Discord.</div>`,
  });
}

// Textos exigidos (item 15 do escopo) — nunca stack trace pro usuário.
const MSG_EXPIRADA = 'Esta sessão de verificação expirou. Inicie uma nova verificação pelo Discord.';
const MSG_FORA_DO_SERVIDOR = 'Não foi possível confirmar sua participação neste servidor.';
const MSG_SEM_CARGO = 'A verificação está temporariamente indisponível. O administrador precisa configurar o cargo de verificação.';
const MSG_FALHA_INTERNA = 'Não foi possível concluir a verificação. Tente novamente.';

// ═══════════════════════════════════════════════════════════════════════
// Roteador HTTP — chamado por sales-system/webhook.js (MESMO servidor,
// mesma porta; nenhuma porta nova é aberta).
// ═══════════════════════════════════════════════════════════════════════
async function handleRequest(req, res, client) {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || 'desconhecido';

  // GET /verify/callback — volta do OAuth2 do Discord
  if (req.method === 'GET' && url.pathname === '/verify/callback') {
    if (!rateLimitOk(`cb:${ip}`)) { res.writeHead(429); return res.end(paginaErro('Muitas tentativas', 'Aguarde um instante e tente novamente.')); }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const erroDiscord = url.searchParams.get('error');
    const session = getSessao(state);

    if (erroDiscord) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaErro('Verificação cancelada', 'Você cancelou a autorização no Discord.')); }
    if (!session || session.status === 'EXPIRED') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaErro('Sessão expirada', MSG_EXPIRADA)); }
    if (session.status === 'VERIFIED') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaSucesso(session.guildId, { jaVerificado: true })); }
    if (!code) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaErro('Requisição inválida', MSG_FALHA_INTERNA)); }

    session.status = 'PROCESSING';
    try {
      const token = await trocarCodigoPorToken(code);
      const usuario = await buscarUsuarioOAuth(token.access_token);
      // Nunca reter o access_token além deste ponto.
      if (String(usuario.id) !== String(session.userId)) {
        session.status = 'FAILED'; session.motivo = 'Identidade não corresponde à sessão iniciada.';
        console.warn(`[VerificacaoWeb] Tentativa de uso de sessão de outro usuário (sessão=${session.userId}, oauth=${usuario.id}, guild=${session.guildId}).`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(paginaErro('Não foi possível verificar', 'A conta do Discord usada não corresponde a quem iniciou esta verificação.'));
      }

      const r = await concederCargo(client, session);
      if (!r.ok) {
        session.status = 'FAILED'; session.motivo = r.motivo;
        console.error(`[VerificacaoWeb] Falha ao conceder cargo (guild=${session.guildId} user=${session.userId}): ${r.motivo}`);
        const msgPublica = /cargo/i.test(r.motivo) ? MSG_SEM_CARGO : /servidor/i.test(r.motivo) ? MSG_FORA_DO_SERVIDOR : MSG_FALHA_INTERNA;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(paginaErro('Não foi possível concluir', msgPublica));
      }

      session.status = 'VERIFIED';
      console.log(`[VerificacaoWeb] Verificação concluída: guild=${session.guildId} user=${session.userId} cargos=${(r.granted || []).join(',')}`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaSucesso(session.guildId, r));
    } catch (e) {
      session.status = 'FAILED'; session.motivo = e.message;
      console.error('[VerificacaoWeb] Erro no callback OAuth2:', e.message);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaErro('Não foi possível concluir', MSG_FALHA_INTERNA));
    }
  }

  // POST /verify/api/complete — integração de site personalizado (contrato próprio do Kael, ver comentário no topo do arquivo)
  if (req.method === 'POST' && url.pathname === '/verify/api/complete') {
    if (!rateLimitOk(`api:${ip}`, 30, 60_000)) { res.writeHead(429); return res.end(JSON.stringify({ ok: false, erro: 'rate_limit' })); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const session = getSessao(data.session);
        if (!session || session.status === 'EXPIRED') { res.writeHead(410, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'sessao_expirada' })); }
        if (session.status === 'VERIFIED') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, jaVerificado: true })); }

        const cfg = getWebConfig(session.guildId);
        if (cfg?.mode !== 'custom' || !cfg.customSecretHash) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'site_personalizado_nao_configurado' })); }
        const okSecret = typeof data.secret === 'string' && data.secret.length > 10 &&
          crypto.timingSafeEqual(Buffer.from(hashSecret(data.secret)), Buffer.from(cfg.customSecretHash));
        if (!okSecret) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'secret_invalido' })); }

        session.status = 'PROCESSING';
        const r = await concederCargo(client, session);
        if (!r.ok) { session.status = 'FAILED'; session.motivo = r.motivo; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: r.motivo })); }
        session.status = 'VERIFIED';
        console.log(`[VerificacaoWeb] Verificação concluída via site personalizado: guild=${session.guildId} user=${session.userId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, granted: r.granted }));
      } catch (e) {
        console.error('[VerificacaoWeb] Erro na API de site personalizado:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, erro: 'requisicao_invalida' }));
      }
    });
    return;
  }

  // GET /verify/:sessionId — página Kael (site padrão)
  if (req.method === 'GET' && /^\/verify\/[a-f0-9]{48}$/.test(url.pathname)) {
    const id = url.pathname.split('/')[2];
    const session = getSessao(id);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (!session || session.status === 'EXPIRED') return res.end(paginaErro('Sessão expirada', MSG_EXPIRADA));
    if (session.status === 'VERIFIED') return res.end(paginaSucesso(session.guildId, { jaVerificado: true }));
    if (!baseUrlOk()) return res.end(paginaErro('Indisponível', 'A Verificação Web ainda não foi configurada pelo administrador do bot (OAuth2 do Discord).'));
    let guildInfo = null;
    try {
      const g = await client.guilds.fetch(session.guildId);
      guildInfo = { name: g.name, iconUrl: g.iconURL({ extension: 'png', size: 128 }) };
    } catch { /* segue sem nome/ícone */ }
    return res.end(paginaVerificar(session, guildInfo));
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(paginaErro('Não encontrado', 'Esta página não existe.'));
}

module.exports = {
  criarSessao, getSessao, baseUrlOk, gerarSecret, hashSecret, handleRequest,
};
