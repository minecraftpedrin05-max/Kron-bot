'use strict';
/**
 * KAEL — Sistema de Verificação
 * Acesso: /painel → 🛡️ Verificação (prefixo de customId: 'vf_').
 * Persistência: db.getGuild(guildId).verificacao (SQLite, isolado por guild).
 * Painéis: cfg.panels[panelId] = { panelId, guildId, channelId, messageId, appearance, button… }
 * (hoje só 'default' é usado; a estrutura já suporta vários painéis por servidor).
 */
const crypto = require('crypto');
const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('../database/db');

// ── Estados ───────────────────────────────────────────────────────
const SystemState = Object.freeze({ DISABLED: 'DISABLED', ENABLED: 'ENABLED' });
const UserState = Object.freeze({
  PENDING: 'PENDING', VERIFIED: 'VERIFIED', FAILED: 'FAILED', COOLDOWN: 'COOLDOWN', BLOCKED: 'BLOCKED',
});

// ── Constantes ────────────────────────────────────────────────────
const PANEL_DEFAULT = 'default';
const ID_BOTAO_PUBLICO = 'vf_pub_verify';   // aceita também 'vf_pub_verify:<panelId>'
const ID_PREVIEW_BTN = 'vf_preview_dummy';
const MAX_EXTRA = 10;
const MAX_HIST = 15;
const MAX_FIELDS = 25;
const EMBED_TOTAL_MAX = 6000;
const USER_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_MS = 2000;                    // botão público: 1 clique / 2s por usuário
const SESSION_TTL_MS = 2 * 60 * 1000;
const SESSION_CAP = 2000;
const ADMIN_MAX = 15;                    // ações administrativas: 15 / 10s por admin
const ADMIN_WINDOW_MS = 10000;
const PUBLISH_COOLDOWN_MS = 8000;        // publicar/atualizar: 1 / 8s por servidor
const TZ = 'America/Sao_Paulo';
const STYLES = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
const STYLE_LABEL = { Primary: 'Azul (Primary)', Secondary: 'Cinza (Secondary)', Success: 'Verde (Success)', Danger: 'Vermelho (Danger)' };
const POLICY_LABEL = { allow: 'Permitir', step: 'Exigir etapa adicional', block: 'Bloquear (sem banir)' };
const AGE_OPTIONS = [0, 1, 3, 7, 14, 30];

// ── Defaults ──────────────────────────────────────────────────────
const DEFAULT_APPEARANCE = () => ({
  title: 'Verificação',
  description: 'Clique no botão abaixo para se verificar e liberar o acesso ao servidor.',
  color: '#2B2D31',
  bannerUrl: null,
  thumbnailUrl: null,
  author: { name: '', iconUrl: '' },
  footer: { text: '', iconUrl: '' },
  timestamp: false,
  fields: [],
});
const DEFAULT_LOG_TEMPLATE = () => ({
  title: '{evento}',
  description: '**Usuário:** {menção}\n**ID:** `{id}`\n**Status:** {status}\n**Cargo:** {cargo}\n**Horário:** {hora}',
  color: null, // null = cor automática por tipo de evento
  bannerUrl: null,
  thumbnailUrl: null,
  author: { name: '', iconUrl: '' },
  footer: { text: '', iconUrl: '' },
  timestamp: true,
  fields: [],
});
const DEFAULT_MESSAGES = () => ({
  success: 'Sua conta foi verificada com sucesso.',
  error: 'Não foi possível concluir sua verificação.',
  cooldown: 'Aguarde antes de tentar novamente.',
  already: 'Você já está verificado.',
  step: 'Sua conta precisa de uma etapa adicional. Confirme abaixo em até 2 minutos.',
  stepButton: 'Confirmar que sou humano',
  tooNew: 'Sua conta não possui a idade mínima necessária.',
  attempts: 'Você atingiu o limite de tentativas.',
  suspicious: 'Sua conta não atende aos requisitos de segurança.',
  disabled: 'O sistema de verificação está indisponível no momento.',
  dm: 'Olá, {menção}! Sua verificação no servidor {servidor} foi concluída com sucesso.',
});
const DEFAULT_BUTTON = () => ({ label: 'Verificar-se', emoji: '✅', style: 'Success', enabled: true });
const DEFAULT_WEB = () => ({ enabled: false, mode: 'kron', customUrl: null, customSecretHash: null });

// Textos-padrão da Parte 1 (migração: tratados como "não personalizados")
const OLD_DEFAULT_MSG = { success: 'Você foi verificado com sucesso!', dm: 'Sua verificação em **{servidor}** foi concluída.' };

function normAppearance(ra = {}, base = DEFAULT_APPEARANCE()) {
  const out = {
    ...base, ...ra,
    bannerUrl: ra.bannerUrl ?? ra.imageUrl ?? null,
    author: { ...base.author, ...(ra.author || {}) },
    footer: { ...base.footer, ...(ra.footer || {}) },
    fields: Array.isArray(ra.fields) ? ra.fields.map((f) => ({ ...f })) : [],
  };
  delete out.imageUrl;
  return out;
}
function normMessages(raw = {}) {
  const rm = { ...raw };
  if (rm.failure !== undefined && rm.error === undefined) rm.error = rm.failure;
  delete rm.failure;
  if (rm.success === OLD_DEFAULT_MSG.success) delete rm.success;
  if (rm.dm === OLD_DEFAULT_MSG.dm) delete rm.dm;
  return { ...DEFAULT_MESSAGES(), ...rm };
}
function normButton(raw = {}) {
  const rb = { ...raw };
  // Botão-padrão da Parte 1 (sem chave 'enabled', que só a Parte 2 em diante grava)
  if (rb.enabled === undefined && rb.label === 'Verificar' && !rb.emoji) { delete rb.label; delete rb.emoji; }
  return { ...DEFAULT_BUTTON(), ...rb };
}
function normPanel(guildId, panelId, rp = {}) {
  return {
    panelId, guildId,
    channelId: rp.channelId || null,
    messageId: rp.messageId || null,
    messageChannelId: rp.messageChannelId || null,
    status: rp.messageId ? (rp.status || 'ok') : 'none',   // none | ok | missing
    publishedAt: rp.publishedAt || null,
    updatedAt: rp.updatedAt || null,
    appearance: normAppearance(rp.appearance),
    button: normButton(rp.button),
  };
}

/** Constrói a config completa a partir do JSON persistido (aceita dados antigos/vazios). */
function hydrate(guildId, raw = {}) {
  const active = typeof raw.activePanelId === 'string' && raw.activePanelId ? raw.activePanelId : PANEL_DEFAULT;
  const panels = {};
  for (const [id, p] of Object.entries(raw.panels || {})) panels[id] = normPanel(guildId, id, p);
  if (!panels[active]) { // legado (Partes 1/2): campos do painel ficavam no topo
    panels[active] = normPanel(guildId, active, {
      channelId: raw.channelId, appearance: raw.appearance, button: raw.button,
      messageId: raw.publishedMessage?.messageId, messageChannelId: raw.publishedMessage?.channelId,
    });
  }
  const p = panels[active];
  const rs = raw.security || {};
  return {
    enabled: !!raw.enabled,
    logChannelId: raw.logChannelId || null,
    roles: { main: null, unverified: null, removeUnverified: true, ...(raw.roles || {}), extra: [...(raw.roles?.extra || [])] },
    security: { dmAfterVerify: false, cooldownSeconds: 30, maxAttempts: 3, minAccountAgeDays: 0, blockMinutes: 60, suspiciousPolicy: 'block', noAvatarSuspicious: false, ...rs },
    messages: normMessages(raw.messages),
    logs: { template: normAppearance(raw.logs?.template || {}, DEFAULT_LOG_TEMPLATE()) },
    web: { ...DEFAULT_WEB(), ...(raw.web || {}) },
    users: raw.users || {},
    history: raw.history || [],
    updatedAt: raw.updatedAt || null,
    activePanelId: active,
    panels,
    // Atalhos do painel ativo (mesmas referências de panels[active])
    channelId: p.channelId,
    appearance: p.appearance,
    button: p.button,
    publishedMessage: p.messageId ? { channelId: p.messageChannelId || p.channelId, messageId: p.messageId } : null,
  };
}

const defaults = () => hydrate('', {});
const getConfig = (guildId) => hydrate(guildId, db.getGuild(guildId).verificacao || {});

function saveConfig(guildId, cfg) {
  const now = Date.now();
  cfg.updatedAt = now;
  const p = cfg.panels[cfg.activePanelId] || (cfg.panels[cfg.activePanelId] = normPanel(guildId, cfg.activePanelId));
  p.guildId = guildId;
  p.channelId = cfg.channelId || null;
  p.appearance = cfg.appearance;
  p.button = cfg.button;
  p.messageId = cfg.publishedMessage?.messageId || null;
  p.messageChannelId = cfg.publishedMessage?.channelId || null;
  if (!p.messageId) p.status = 'none';
  const { channelId, appearance, button, publishedMessage, ...persist } = cfg; // atalhos não são persistidos
  db.updateGuild(guildId, 'verificacao', persist);
  return cfg;
}

const getSystemState = (cfg) => (cfg.enabled ? SystemState.ENABLED : SystemState.DISABLED);

// Estado por usuário — separado do estado global
function getUserState(guildId, userId) {
  const u = getConfig(guildId).users[userId];
  const now = Date.now();
  if (!u) return { state: UserState.PENDING, attempts: 0, cooldownUntil: 0, blockedUntil: 0 };
  let r = { attempts: 0, cooldownUntil: 0, blockedUntil: 0, ...u };
  if (r.state === UserState.BLOCKED && r.blockedUntil <= now) r = { ...r, state: UserState.PENDING, attempts: 0, blockedUntil: 0 };
  if (r.state === UserState.COOLDOWN && r.cooldownUntil <= now) r = { ...r, state: UserState.PENDING };
  return r;
}
function setUserState(guildId, userId, patch) {
  const cfg = getConfig(guildId);
  const now = Date.now();
  cfg.users[userId] = { ...getUserState(guildId, userId), ...patch, updatedAt: now };
  for (const [id, u] of Object.entries(cfg.users)) { // poda entradas antigas/expiradas
    if (id !== userId && (u.updatedAt || 0) < now - USER_TTL_MS && !(u.blockedUntil > now)) delete cfg.users[id];
  }
  saveConfig(guildId, cfg);
  return cfg.users[userId];
}

// ── Painéis (estrutura multi-painel) ──────────────────────────────
const acharPainelPorMensagem = (cfg, channelId, messageId) =>
  Object.values(cfg.panels).find((p) => p.messageId === messageId && (p.messageChannelId || p.channelId) === channelId) || null;

function atualizarStatusPainel(guildId, panelId, status) {
  const cfg = getConfig(guildId);
  const p = cfg.panels[panelId];
  if (!p || p.status === status) return false;
  p.status = status;
  saveConfig(guildId, cfg);
  return true;
}

// ── Validadores ───────────────────────────────────────────────────
function validarHex(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}
function validarUrl(u) {
  try {
    const s = String(u || '').trim();
    const x = new URL(s);
    return (x.protocol === 'https:' || x.protocol === 'http:') && s.length <= 2000 && !/\s/.test(s) ? s : null;
  } catch { return null; }
}
/** string (unicode) | {name,id,animated} (custom) | null (vazio) | false (inválido) */
function parseEmoji(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const c = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/.exec(s);
  if (c) return { name: c[2], id: c[3], animated: c[1] === 'a' };
  if (/^(\p{Extended_Pictographic}(\uFE0F|\p{Emoji_Modifier})?(\u200D\p{Extended_Pictographic}(\uFE0F|\p{Emoji_Modifier})?)*|[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2})$/u.test(s)) return s;
  return false;
}
function embedLength(a) {
  let n = (a.title || '').length + (a.description || '').length + (a.author?.name || '').length + (a.footer?.text || '').length;
  for (const f of a.fields || []) if (f.enabled) n += (f.name || '').length + (f.value || '').length;
  return n;
}
function checarLimitesEmbed(a) {
  if ((a.fields || []).filter((f) => f.enabled).length > MAX_FIELDS) return `O Discord permite no máximo ${MAX_FIELDS} campos.`;
  if (embedLength(a) > EMBED_TOTAL_MAX) return `O embed passa de ${EMBED_TOTAL_MAX} caracteres somados (limite do Discord).`;
  return null;
}
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function discordErro(e) {
  const c = e?.code;
  if (c === 50013 || c === 50001) return 'Sem permissão para acessar/enviar mensagens nesse canal.';
  if (c === 10003) return 'Canal não encontrado.';
  if (c === 10008) return 'Mensagem não encontrada.';
  if (c === 50035) return 'O Discord recusou o conteúdo do painel (confira URLs de imagem e emojis).';
  if (c === 429) return 'O Discord aplicou rate limit. Tente novamente em instantes.';
  return cut(e?.message || 'erro desconhecido', 200);
}

// ── Placeholders ──────────────────────────────────────────────────
const PLACEHOLDER_LIST = ['{menção}', '{nome}', '{username}', '{servidor}', '{membros}', '{cargo}', '{id}', '{data}', '{hora}', '{timestamp}'];
const LOG_PLACEHOLDERS = ['{evento}', '{status}', '{motivo}'];
const safe = (s) => String(s ?? '').replace(/@/g, '@\u200b');

function aplicarPlaceholders(texto, { guild, member, cfg, extra } = {}) {
  if (!texto) return '';
  const now = new Date();
  const mainRole = cfg?.roles?.main && guild?.roles?.cache?.get(cfg.roles.main);
  const map = {
    servidor: guild ? safe(guild.name) : undefined,
    membros: guild?.memberCount !== undefined ? String(guild.memberCount) : undefined,
    cargo: mainRole ? safe(mainRole.name) : undefined,
    data: new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now),
    hora: new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(now),
    timestamp: `<t:${Math.floor(now.getTime() / 1000)}:f>`,
  };
  if (member) {
    const u = member.user || member;
    Object.assign(map, {
      menção: `<@${member.id || u.id}>`, mencao: `<@${member.id || u.id}>`,
      nome: safe(member.displayName || u.globalName || u.username),
      username: safe(u.username), id: String(member.id || u.id),
    });
  }
  if (extra) for (const [k, v] of Object.entries(extra)) if (v !== undefined) map[k] = String(v);
  return String(texto).replace(/\{(menção|mencao|nome|username|servidor|membros|cargo|id|data|hora|timestamp|evento|status|motivo)\}/gi, (m, k) => {
    const v = map[k.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// ── Renderização de embeds (painel público, preview e logs) ───────
/** Aplica aparência (título, cor, banner, thumbnail, autor, footer, timestamp, campos) a um embed. */
function embedDeAparencia(a, P, corPadrao) {
  const embed = new EmbedBuilder().setColor(validarHex(a.color) || corPadrao);
  if (a.title) embed.setTitle(P(a.title).slice(0, 256));
  if (a.description) embed.setDescription(P(a.description).slice(0, 4096));
  if (a.author?.name) embed.setAuthor({ name: P(a.author.name).slice(0, 256), ...(a.author.iconUrl ? { iconURL: a.author.iconUrl } : {}) });
  if (a.footer?.text) embed.setFooter({ text: P(a.footer.text).slice(0, 2048), ...(a.footer.iconUrl ? { iconURL: a.footer.iconUrl } : {}) });
  if (a.bannerUrl) embed.setImage(a.bannerUrl);
  if (a.thumbnailUrl) embed.setThumbnail(a.thumbnailUrl);
  if (a.timestamp) embed.setTimestamp();
  const fields = (a.fields || []).filter((f) => f.enabled).slice(0, MAX_FIELDS)
    .map((f) => ({ name: P(f.name).slice(0, 256) || '\u200b', value: P(f.value).slice(0, 1024) || '\u200b', inline: !!f.inline }));
  if (fields.length) embed.addFields(fields);
  return embed;
}

/** Painel público. Usada tanto pelo Publicar quanto pelo Preview (mesma renderização). */
function buildPanelMessage(g, cfg, { preview = false } = {}) {
  const P = (t) => aplicarPlaceholders(t, { guild: g, cfg });
  const embed = embedDeAparencia(cfg.appearance, P, '#2B2D31');
  const b = cfg.button;
  const btn = new ButtonBuilder().setCustomId(preview ? ID_PREVIEW_BTN : `${ID_BOTAO_PUBLICO}:${cfg.activePanelId}`)
    .setStyle(STYLES[b.style] || ButtonStyle.Success).setDisabled(!b.enabled);
  if (b.label) btn.setLabel(b.label);
  const em = parseEmoji(b.emoji);
  if (em) btn.setEmoji(em);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] };
}

// ── Logs ──────────────────────────────────────────────────────────
const LOG_EVENTS = {
  verified:   { title: 'Verificação concluída', status: 'Verificado', color: 0x57F287 },
  denied:     { title: 'Verificação recusada', status: 'Recusado', color: 0xED4245 },
  tooNew:     { title: 'Conta abaixo da idade mínima', status: 'Recusado', color: 0xED4245 },
  attempts:   { title: 'Tentativas excedidas', status: 'Bloqueado', color: 0xED4245 },
  cooldown:   { title: 'Verificação em cooldown', status: 'Cooldown', color: 0xFEE75C },
  suspicious: { title: 'Conta suspeita', status: 'Recusado', color: 0xED4245 },
  step:       { title: 'Etapa adicional exigida', status: 'Pendente', color: 0xFEE75C },
  error:      { title: 'Erro na verificação', status: 'Erro', color: 0xED4245 },
  admin:      { title: 'Alteração administrativa', status: 'Configuração', color: 0x5865F2 },
  published:  { title: 'Painel publicado', status: 'Publicado', color: 0x5865F2 },
  updated:    { title: 'Painel atualizado', status: 'Atualizado', color: 0x5865F2 },
  missing:    { title: 'Painel não encontrado', status: 'Ausente', color: 0xFEE75C },
};

function buildLogEmbed(g, cfg, tipo, { member, motivo, cargo } = {}) {
  const ev = LOG_EVENTS[tipo] || LOG_EVENTS.admin;
  const t = cfg.logs.template;
  const extra = {
    evento: ev.title, status: ev.status, motivo: motivo || '—',
    cargo: cargo ?? (cfg.roles.main ? `<@&${cfg.roles.main}>` : '—'),
  };
  const P = (x) => aplicarPlaceholders(x, { guild: g, member, cfg, extra });
  const embed = embedDeAparencia({ ...t, color: validarHex(t.color) || `#${ev.color.toString(16).padStart(6, '0')}` }, P, '#5865F2');
  if (!t.title) embed.setTitle(ev.title);
  const usaMotivo = /\{motivo\}/i.test([t.title, t.description, ...(t.fields || []).map((f) => f.value)].join(' '));
  if (motivo && !usaMotivo && (t.fields || []).filter((f) => f.enabled).length < MAX_FIELDS) {
    embed.addFields({ name: 'Detalhes', value: cut(motivo, 1024), inline: false });
  }
  return embed;
}

/** Registra no histórico e envia ao canal de logs. Nunca lança erro; o envio não bloqueia o fluxo. */
function registrarEvento(g, tipo, opts = {}) {
  try {
    const cfg = getConfig(g.id);
    const ev = LOG_EVENTS[tipo] || LOG_EVENTS.admin;
    const quem = opts.member ? ` <@${opts.member.id}>` : '';
    cfg.history = [{ t: Date.now(), tipo, texto: `**${ev.title}**${quem}${opts.motivo ? ` — ${opts.motivo}` : ''}` }, ...cfg.history].slice(0, MAX_HIST);
    saveConfig(g.id, cfg);
    const ch = cfg.logChannelId && g.channels.cache.get(cfg.logChannelId);
    if (!ch?.isTextBased?.()) return Promise.resolve();
    return Promise.resolve(ch.send({ embeds: [buildLogEmbed(g, cfg, tipo, opts)], allowedMentions: { parse: [] } }))
      .catch((e) => console.error('[Verificacao] Falha ao enviar log:', discordErro(e)));
  } catch (e) {
    console.error('[Verificacao] Falha ao registrar log:', e.message);
    return Promise.resolve();
  }
}

// ── Permissões ────────────────────────────────────────────────────
function validarCargo(guild, roleId, member) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return 'Cargo não existe mais.';
  if (role.id === guild.id) return 'O cargo @everyone não pode ser usado.';
  if (role.managed) return `${role} é gerenciado por integração e não pode ser atribuído.`;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'O bot precisa da permissão **Gerenciar Cargos**.';
  if (role.comparePositionTo(me.roles.highest) >= 0) return `${role} está acima (ou igual) ao cargo do bot. Suba o cargo do Kael.`;
  if (member && guild.ownerId !== member.id && role.comparePositionTo(member.roles.highest) >= 0) {
    return `${role} está acima do seu cargo mais alto.`;
  }
  return null;
}

function validarCanal(guild, channelId, { historico = false } = {}) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased?.()) return 'Canal inválido.';
  const perms = ch.permissionsFor(guild.members.me);
  const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (historico) need.push(PermissionFlagsBits.ReadMessageHistory);
  if (!perms || !perms.has(need)) return `O bot não tem as permissões necessárias em ${ch} (Ver canal, Enviar mensagens, Inserir links${historico ? ', Ver histórico' : ''}).`;
  return null;
}

const adminBuckets = new Map();
function limiteAdmin(key) {
  const now = Date.now();
  const arr = (adminBuckets.get(key) || []).filter((t) => now - t < ADMIN_WINDOW_MS);
  if (arr.length >= ADMIN_MAX) { adminBuckets.set(key, arr); return false; }
  arr.push(now); adminBuckets.set(key, arr);
  if (adminBuckets.size > 2000) for (const [k, v] of adminBuckets) if (!v.some((t) => now - t < ADMIN_WINDOW_MS)) adminBuckets.delete(k);
  return true;
}

/** Guarda comum das interações administrativas: guild, permissão, dono da mensagem e rate limit. */
async function checarAdmin(interaction) {
  const g = interaction.guild;
  let motivo = null;
  if (!interaction.inGuild() || !g || interaction.guildId !== g.id) motivo = 'Use este painel dentro do servidor.';
  else if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) motivo = 'Você precisa ser Administrador para configurar a verificação.';
  else {
    const owner = interaction.message?.interactionMetadata?.user?.id;
    if (owner && owner !== interaction.user.id) motivo = 'Este painel pertence a outro usuário.';
    else if (!limiteAdmin(`${g.id}:${interaction.user.id}`)) motivo = 'Muitas ações em sequência. Aguarde alguns segundos.';
  }
  if (!motivo) return true;
  const p = { content: `❌ ${motivo}`, flags: MessageFlags.Ephemeral };
  if (!interaction.replied && !interaction.deferred) await interaction.reply(p).catch(() => {});
  else await interaction.followUp(p).catch(() => {});
  return false;
}

// ── UI ────────────────────────────────────────────────────────────
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const txt = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 3800));
const onOff = (b) => (b ? '`Ativado`' : '`Desativado`');
const canalTxt = (g, id) => (id ? (g.channels.cache.get(id) ? `<#${id}>` : '`Canal inválido`') : '`Não configurado`');
const cargoTxt = (g, id) => (id ? (g.roles.cache.get(id) ? `<@&${id}>` : '`Cargo inválido`') : '`Não configurado`');
const val = (s) => (s ? `\`${cut(s, 60)}\`` : '`Nenhum`');
const PANEL_STATUS = { none: '`Não publicado`', ok: '`Publicado`', missing: '⚠️ `Ausente (mensagem apagada)`' };

function container(header, notice) {
  const c = new ContainerBuilder().setAccentColor(0x000000)
    .addTextDisplayComponents(txt(`# KAEL — Sistema de Verificação\n-# ${header}`));
  if (notice) c.addTextDisplayComponents(txt(`> ⚠️ ${notice}`));
  return c.addSeparatorComponents(sep());
}
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const voltarRow = (to = 'vf_home') => row(btn(to, 'Voltar'));
/** customId com sufixo ':l' quando a tela edita o template de LOG (mesmo editor da aparência). */
const I = (isLog, base, arg) => [base, arg, isLog ? 'l' : null].filter(Boolean).join(':');

function chSel(g, id, ph, cur) {
  const m = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(ph)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (cur && g.channels.cache.has(cur)) m.setDefaultChannels(cur);
  return row(m);
}

function screenHome(g, cfg, notice) {
  const p = cfg.panels[cfg.activePanelId];
  return container('Configure aparência, cargos, segurança, mensagens e logs.', notice)
    .addTextDisplayComponents(txt(
      'Configure o sistema de verificação do seu servidor, incluindo aparência, cargos, segurança, mensagens e logs.\n\n' +
      `**Status:** ${onOff(cfg.enabled)}  •  **Painel:** ${PANEL_STATUS[p.status] || PANEL_STATUS.none}\n` +
      `**Canal do painel:** ${canalTxt(g, cfg.channelId)}\n**Canal de logs:** ${canalTxt(g, cfg.logChannelId)}\n` +
      `**Cargo principal:** ${cargoTxt(g, cfg.roles.main)}\n-# Alterou a aparência? Use **Publicar** para atualizar o painel público.`))
    .addSeparatorComponents(sep())
    .addActionRowComponents(row(
      btn('vf_cfg', 'Configuração'), btn('vf_app', 'Aparência'), btn('vf_msg', 'Mensagens'),
      btn('vf_sec', 'Segurança'), btn('vf_roles', 'Cargos')))
    .addActionRowComponents(row(
      btn('vf_logs', 'Logs'), btn('vf_preview', 'Preview'), btn('vf_publish', 'Publicar', ButtonStyle.Primary),
      btn('vf_toggle', cfg.enabled ? 'Desativar' : 'Ativar', cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      btn('vf_back', 'Voltar')))
    .addActionRowComponents(row(btn('vf_web', `Verificação Web${cfg.web.enabled ? ' (ativa)' : ''}`, cfg.web.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)));
}

function screenCfg(g, cfg, notice) {
  return container('Configuração geral', notice)
    .addTextDisplayComponents(txt(
      `**Canal do painel:** ${canalTxt(g, cfg.channelId)}\n**Canal de logs:** ${canalTxt(g, cfg.logChannelId)}\n` +
      `**Remover não verificado:** ${onOff(cfg.roles.removeUnverified)}\n**DM após verificação:** ${onOff(cfg.security.dmAfterVerify)}`))
    .addActionRowComponents(chSel(g, 'vf_sel_channel', 'Canal do painel de verificação', cfg.channelId))
    .addActionRowComponents(chSel(g, 'vf_sel_logchannel', 'Canal de logs', cfg.logChannelId))
    .addActionRowComponents(row(
      btn('vf_tg_removeunv', `Remover não verificado: ${cfg.roles.removeUnverified ? 'Sim' : 'Não'}`),
      btn('vf_tg_dm', `DM após verificar: ${cfg.security.dmAfterVerify ? 'Sim' : 'Não'}`)))
    .addActionRowComponents(voltarRow());
}

function screenRoles(g, cfg, notice) {
  const rs = (id, ph, max, cur) => {
    const m = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).setMinValues(1).setMaxValues(max);
    const valid = cur.filter((x) => g.roles.cache.has(x)).slice(0, max);
    if (valid.length) m.setDefaultRoles(valid);
    return row(m);
  };
  const extras = cfg.roles.extra.length ? cfg.roles.extra.map((id) => cargoTxt(g, id)).join(', ') : '`Nenhum`';
  return container('Cargos', notice)
    .addTextDisplayComponents(txt(
      `**Principal:** ${cargoTxt(g, cfg.roles.main)}\n**Adicionais:** ${extras}\n**Não verificado:** ${cargoTxt(g, cfg.roles.unverified)}\n` +
      '-# O cargo precisa estar abaixo do cargo do Kael na hierarquia.'))
    .addActionRowComponents(rs('vf_sel_rolemain', 'Cargo principal (verificado)', 1, cfg.roles.main ? [cfg.roles.main] : []))
    .addActionRowComponents(rs('vf_sel_roleextra', 'Cargos adicionais', MAX_EXTRA, cfg.roles.extra))
    .addActionRowComponents(rs('vf_sel_roleunv', 'Cargo de não verificado', 1, cfg.roles.unverified ? [cfg.roles.unverified] : []))
    .addActionRowComponents(voltarRow());
}

function screenSec(g, cfg, notice) {
  const s = cfg.security;
  const ageOpts = [...AGE_OPTIONS.map((d) => ({ label: d === 0 ? 'Desativado' : `${d} dia${d > 1 ? 's' : ''}`, value: String(d) })), { label: 'Personalizado…', value: 'custom' }];
  const ageSel = new StringSelectMenuBuilder().setCustomId('vf_sel_age').setPlaceholder('Idade mínima da conta')
    .addOptions(ageOpts.map((o) => ({ ...o, default: o.value === String(s.minAccountAgeDays) })));
  const polSel = new StringSelectMenuBuilder().setCustomId('vf_sel_policy').setPlaceholder('Conta suspeita / fora das regras')
    .addOptions(Object.entries(POLICY_LABEL).map(([value, label]) => ({ label, value, default: s.suspiciousPolicy === value })));
  return container('Segurança', notice)
    .addTextDisplayComponents(txt(
      `**Idade mínima:** ${s.minAccountAgeDays ? `\`${s.minAccountAgeDays} dia(s)\`` : '`Desativado`'}\n` +
      `**Tentativas máximas:** \`${s.maxAttempts}\`  •  **Cooldown:** \`${s.cooldownSeconds}s\`  •  **Bloqueio:** \`${s.blockMinutes} min\`\n` +
      `**Conta suspeita:** \`${POLICY_LABEL[s.suspiciousPolicy] || s.suspiciousPolicy}\`\n` +
      `**Conta sem avatar = suspeita:** ${onOff(s.noAvatarSuspicious)}\n` +
      '-# Nenhuma opção bane automaticamente. Ao exceder as tentativas o membro fica bloqueado temporariamente.'))
    .addActionRowComponents(row(ageSel))
    .addActionRowComponents(row(polSel))
    .addActionRowComponents(row(
      btn('vf_edit_sec', 'Tentativas, cooldown e bloqueio', ButtonStyle.Primary),
      btn('vf_tg_noavatar', `Sem avatar suspeito: ${s.noAvatarSuspicious ? 'Sim' : 'Não'}`)))
    .addActionRowComponents(voltarRow());
}

/** Aparência do painel público (which≠'l') ou do template de LOG (which='l'). */
function screenApp(g, cfg, notice, ctx = {}) {
  const isLog = ctx.which === 'l';
  const a = isLog ? cfg.logs.template : cfg.appearance;
  const on = a.fields.filter((f) => f.enabled).length;
  const extra = isLog
    ? `\n-# Placeholders extras nos logs: ${LOG_PLACEHOLDERS.map((p) => `\`${p}\``).join(' ')} (além dos padrões)`
    : `\n**Botão:** \`${`${cfg.button.emoji || ''} ${cfg.button.label || ''}`.trim() || '—'}\``;
  const c = container(isLog ? 'Aparência dos logs' : 'Aparência do painel público', notice)
    .addTextDisplayComponents(txt(
      `**Título:** ${val(a.title)}\n**Descrição:** ${val(a.description)}\n**Cor:** ${a.color ? `\`${a.color}\`` : '`Automática por evento`'}\n` +
      `**Banner:** ${val(a.bannerUrl)}\n**Thumbnail:** ${val(a.thumbnailUrl)}\n` +
      `**Autor:** ${val(a.author.name)}  •  **Footer:** ${val(a.footer.text)}\n` +
      `**Timestamp:** ${onOff(a.timestamp)}  •  **Campos:** \`${on}/${a.fields.length}\` ativos${extra}`))
    .addActionRowComponents(row(
      btn(I(isLog, 'vf_edit_app'), 'Título/Descrição', ButtonStyle.Primary), btn(I(isLog, 'vf_edit_color'), 'Cor'),
      btn(I(isLog, 'vf_edit_banner'), 'Banner'), btn(I(isLog, 'vf_edit_thumb'), 'Thumbnail'), btn(I(isLog, 'vf_edit_author'), 'Autor')))
    .addActionRowComponents(row(
      btn(I(isLog, 'vf_edit_footer'), 'Footer'), btn(I(isLog, 'vf_tg_timestamp'), `Timestamp: ${a.timestamp ? 'Sim' : 'Não'}`),
      btn(I(isLog, 'vf_fields'), 'Campos'), btn(I(isLog, 'vf_preview'), 'Preview'), btn(I(isLog, 'vf_rst_app'), 'Restaurar', ButtonStyle.Danger)));
  return c.addActionRowComponents(isLog
    ? row(btn('vf_logs', 'Voltar'))
    : row(btn('vf_btn', 'Botão'), btn('vf_home', 'Voltar')));
}

function screenBtn(g, cfg, notice) {
  const b = cfg.button;
  const sel = new StringSelectMenuBuilder().setCustomId('vf_sel_style').setPlaceholder('Estilo do botão')
    .addOptions(Object.entries(STYLE_LABEL).map(([value, label]) => ({ label, value, default: b.style === value })));
  return container('Botão de verificação', notice)
    .addTextDisplayComponents(txt(
      `**Nome:** ${val(b.label)}\n**Emoji:** ${b.emoji ? cut(b.emoji, 60) : '`Nenhum`'}\n**Estilo:** \`${STYLE_LABEL[b.style]}\`\n` +
      `**Estado:** ${b.enabled ? '`Ativo`' : '`Desativado (aparece cinza e não clicável)`'}\n-# Emoji: unicode (🔐) ou personalizado (<:nome:id>). Publique de novo para aplicar.`))
    .addActionRowComponents(row(sel))
    .addActionRowComponents(row(
      btn('vf_edit_btn', 'Nome/Emoji', ButtonStyle.Primary),
      btn('vf_tg_btn', b.enabled ? 'Desativar botão' : 'Ativar botão')))
    .addActionRowComponents(voltarRow('vf_app'));
}

function screenFields(g, cfg, notice, ctx = {}) {
  const isLog = ctx.which === 'l';
  const fs = (isLog ? cfg.logs.template : cfg.appearance).fields;
  const selId = fs.some((f) => f.id === ctx.sel) ? ctx.sel : null;
  const idx = fs.findIndex((f) => f.id === selId);
  const c = container(isLog ? 'Campos do log' : 'Campos personalizados', notice).addTextDisplayComponents(txt(
    (fs.length
      ? fs.map((f, i) => `${f.id === selId ? '▶ ' : ''}**${i + 1}.** ${f.enabled ? '' : '~~'}${cut(f.name, 40)}${f.enabled ? '' : '~~'} — ${cut(f.value, 50)}${f.inline ? ' *(inline)*' : ''}`).join('\n')
      : '`Nenhum campo criado.`') + `\n-# ${fs.length}/${MAX_FIELDS} campos • nome até 256, valor até 1024 caracteres.`));
  if (fs.length) {
    const sel = new StringSelectMenuBuilder().setCustomId(I(isLog, 'vf_fld_sel')).setPlaceholder('Selecione um campo')
      .addOptions(fs.map((f, i) => ({ label: cut(`${i + 1}. ${f.name}`, 100), value: f.id, default: f.id === selId })));
    c.addActionRowComponents(row(sel));
  }
  const d = !selId; const k = selId || 'x';
  c.addActionRowComponents(row(
    btn(I(isLog, 'vf_fld_add'), 'Adicionar', ButtonStyle.Primary, fs.length >= MAX_FIELDS),
    btn(I(isLog, 'vf_fld_edit', k), 'Editar', ButtonStyle.Secondary, d),
    btn(I(isLog, 'vf_fld_rm', k), 'Remover', ButtonStyle.Danger, d),
    btn(I(isLog, 'vf_fld_up', k), '↑', ButtonStyle.Secondary, d || idx <= 0),
    btn(I(isLog, 'vf_fld_dn', k), '↓', ButtonStyle.Secondary, d || idx === fs.length - 1)));
  const cur = fs[idx];
  c.addActionRowComponents(row(
    btn(I(isLog, 'vf_fld_tg', k), cur?.enabled === false ? 'Ativar campo' : 'Desativar campo', ButtonStyle.Secondary, d),
    btn(I(isLog, 'vf_fld_il', k), `Inline: ${cur?.inline ? 'Sim' : 'Não'}`, ButtonStyle.Secondary, d),
    btn(I(isLog, 'vf_app'), 'Voltar')));
  return c;
}

const MSG_ROWS = [['success', 'Sucesso'], ['error', 'Erro'], ['cooldown', 'Cooldown'], ['already', 'Já verificado'], ['step', 'Etapa adicional'],
  ['tooNew', 'Conta nova'], ['attempts', 'Tentativas'], ['suspicious', 'Suspeita'], ['stepButton', 'Botão da etapa'], ['disabled', 'Indisponível']];

function screenMsg(g, cfg, notice, ctx = {}) {
  const m = cfg.messages;
  const ex = aplicarPlaceholders(m.dm, { guild: g, member: ctx.member, cfg });
  return container('Mensagens', notice)
    .addTextDisplayComponents(txt(
      `${MSG_ROWS.map(([k, l]) => `**${l}:** ${cut(m[k], 70)}`).join('\n')}\n` +
      `**DM (${cfg.security.dmAfterVerify ? 'ativada' : 'desativada'}):** ${cut(m.dm, 100)}\n\n` +
      `**Exemplo da DM:** ${cut(ex, 250)}\n\n**Placeholders:** ${PLACEHOLDER_LIST.map((p) => `\`${p}\``).join(' ')}`))
    .addActionRowComponents(row(btn('vf_edit_msg1', 'Mensagens 1/2', ButtonStyle.Primary), btn('vf_edit_msg2', 'Mensagens 2/2', ButtonStyle.Primary)))
    .addActionRowComponents(row(
      btn('vf_edit_dm', 'Editar DM'), btn('vf_tg_dm_m', `DM: ${cfg.security.dmAfterVerify ? 'Ativada' : 'Desativada'}`),
      btn('vf_rst_msg', 'Restaurar', ButtonStyle.Danger)))
    .addActionRowComponents(voltarRow());
}

function screenLogs(g, cfg, notice) {
  const hist = cfg.history.length
    ? cfg.history.map((h) => `<t:${Math.floor(h.t / 1000)}:R> ${cut(h.texto, 150)}`).join('\n').slice(0, 2400)
    : '`Nenhum registro ainda.`';
  const m = new ChannelSelectMenuBuilder().setCustomId('vf_sel_logchannel_l').setPlaceholder('Canal de logs')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (cfg.logChannelId && g.channels.cache.has(cfg.logChannelId)) m.setDefaultChannels(cfg.logChannelId);
  return container('Logs', notice)
    .addTextDisplayComponents(txt(`**Canal de logs:** ${canalTxt(g, cfg.logChannelId)}\n\n**Últimos registros**\n${hist}`))
    .addActionRowComponents(row(m))
    .addActionRowComponents(row(btn('vf_app:l', 'Aparência do log', ButtonStyle.Primary), btn('vf_preview:l', 'Preview do log'), btn('vf_home', 'Voltar')));
}

function screenConfirm(g, cfg, notice, ctx = {}) {
  const app = ctx.kind === 'app'; const isLog = ctx.which === 'l';
  const alvo = app ? (isLog ? 'log' : 'aparencia') : 'msg';
  const textos = {
    aparencia: '**Restaurar aparência?** Título, descrição, cor, banner, thumbnail, autor, footer, timestamp e campos do painel voltam ao padrão.\n-# Segurança, cargos, canais, logs e o botão NÃO são alterados.',
    log: '**Restaurar aparência dos logs?** O template dos logs volta ao padrão.\n-# Painel, segurança, cargos e canais NÃO são alterados.',
    msg: '**Restaurar mensagens?** Todas as mensagens (incluindo o texto da DM) voltam ao padrão.\n-# Segurança, cargos, canais e aparência NÃO são alterados.',
  };
  return container(`Restaurar ${alvo === 'msg' ? 'mensagens' : 'aparência'}`, notice)
    .addTextDisplayComponents(txt(textos[alvo]))
    .addActionRowComponents(row(
      btn(I(isLog, app ? 'vf_rst_app_ok' : 'vf_rst_msg_ok'), 'Confirmar', ButtonStyle.Danger),
      btn(I(isLog, app ? 'vf_rst_app_no' : 'vf_rst_msg_no'), 'Cancelar')));
}

function screenPublish(g, cfg, notice, ctx = {}) {
  const chk = ctx.checks || { items: [], ok: false };
  const st = ctx.status || 'none';
  const p = cfg.panels[cfg.activePanelId];
  const estado = {
    none: 'Nenhum painel publicado ainda.',
    ok: `Publicado em <#${p.messageChannelId || p.channelId}>. Confirmar **atualiza a mensagem existente** (sem duplicar).`,
    missing: '⚠️ **O painel publicado não foi encontrado** (mensagem apagada). Os dados foram mantidos — publique novamente.',
    unknown: '⚠️ Não foi possível verificar o painel atual (permissões/API). Nada foi alterado.',
  }[st] || '';
  const linhas = chk.items.map((i) => `${i.pass ? '✅' : (i.blocking === false ? '⚠️' : '❌')} ${i.texto}`).join('\n');
  const c = container('Publicar painel', notice)
    .addTextDisplayComponents(txt(
      `**Canal:** ${canalTxt(g, cfg.channelId)}\n**Estado:** ${estado}\n\n**Verificações**\n${linhas || '`—`'}\n\n` +
      `**Título:** ${val(cfg.appearance.title)}  •  **Botão:** \`${`${cfg.button.emoji || ''} ${cfg.button.label || ''}`.trim() || '—'}\`\n` +
      '-# Selecione o canal, revise as verificações e confirme.'))
    .addActionRowComponents(chSel(g, 'vf_sel_pubchannel', 'Canal do painel de verificação', cfg.channelId));
  const acoes = [];
  if (st === 'missing') acoes.push(btn('vf_pub_new', 'Publicar novamente', ButtonStyle.Success, !chk.ok));
  else acoes.push(btn('vf_pub_go', st === 'ok' ? 'Confirmar e atualizar' : 'Confirmar e publicar', ButtonStyle.Primary, !chk.ok || st === 'unknown'));
  acoes.push(btn('vf_home', 'Voltar'));
  return c.addActionRowComponents(row(...acoes));
}

function screenWeb(g, cfg, notice) {
  const w = cfg.web;
  const okEnv = require('./webVerify').baseUrlOk();
  return container('Verificação Web', notice)
    .addTextDisplayComponents(txt(
      'Ao clicar no botão do painel, em vez de verificar na hora dentro do Discord, o bot manda o usuário para uma ' +
      'página web (OAuth2 oficial do Discord) e libera o cargo depois da confirmação.\n\n' +
      `**Status:** ${onOff(w.enabled)}\n**Modo:** \`${w.mode === 'custom' ? 'Site personalizado' : 'Site padrão Kael'}\`\n` +
      (w.mode === 'custom' ? `**URL do site:** ${val(w.customUrl)}\n**Secret configurado:** ${w.customSecretHash ? '`Sim`' : '`Não`'}\n` : '') +
      (!okEnv ? '\n> ⚠️ O OAuth2 do Discord ainda não foi configurado no bot (variáveis de ambiente `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`). O modo Site padrão Kael não vai funcionar até isso ser configurado.' : '') +
      '\n-# Aparência, cor, banner, mensagens e o texto do botão continuam sendo os mesmos configurados em **Aparência**/**Botão**/**Mensagens** — a Verificação Web reaproveita tudo isso, só muda o que acontece ao clicar.'))
    .addSeparatorComponents(sep())
    .addActionRowComponents(row(
      btn('vf_web_toggle', w.enabled ? 'Desativar' : 'Ativar', w.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      btn('vf_web_mode', w.mode === 'custom' ? 'Usar site padrão Kael' : 'Usar site personalizado'),
      ...(w.mode === 'custom' ? [btn('vf_web_url', 'Configurar URL', ButtonStyle.Primary), btn('vf_web_secret', w.customSecretHash ? 'Gerar novo secret' : 'Gerar secret', ButtonStyle.Primary)] : []),
    ))
    .addActionRowComponents(voltarRow());
}

const SCREENS = { home: screenHome, cfg: screenCfg, roles: screenRoles, sec: screenSec, app: screenApp, btn: screenBtn, fields: screenFields, msg: screenMsg, logs: screenLogs, confirm: screenConfirm, publish: screenPublish, web: screenWeb };

function payload(interaction, screen, notice, ctx = {}) {
  const cfg = getConfig(interaction.guildId);
  return {
    content: null, embeds: [],
    components: [SCREENS[screen](interaction.guild, cfg, notice, { ...ctx, member: interaction.member })],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

// Edita a mensagem atual (padrão do /painel); se não der, responde nova.
async function render(interaction, screen, notice, ctx) {
  const p = payload(interaction, screen, notice, ctx);
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content: null, embeds: [], components: p.components, flags: MessageFlags.IsComponentsV2 });
    }
    if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) return await interaction.update(p);
    return await interaction.reply(p);
  } catch (e) {
    console.error('[Verificacao] Falha ao renderizar:', e.message);
    if (!interaction.replied && !interaction.deferred) return interaction.reply(p).catch(() => {});
  }
}

// ── Execução segura + auditoria de alterações administrativas ─────
async function seguro(interaction, fn) {
  try { return await fn(); } catch (e) {
    console.error('[Verificacao] Erro em', interaction.customId, '-', e.stack || e.message);
    const p = { content: '❌ Ocorreu um erro inesperado. Tente novamente.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(p); else await interaction.reply(p);
    } catch { /* interação expirada */ }
  }
}

const SECOES = { enabled: 'Ativação', channelId: 'Canal do painel', logChannelId: 'Canal de logs', roles: 'Cargos', security: 'Segurança', appearance: 'Aparência', button: 'Botão', messages: 'Mensagens', logs: 'Aparência dos logs', web: 'Verificação Web' };
function snapshotAdmin(guildId) {
  const c = getConfig(guildId);
  return Object.fromEntries(Object.keys(SECOES).map((k) => [k, JSON.stringify(c[k])]));
}
async function admin(interaction, fn) {
  if (!(await checarAdmin(interaction))) return undefined;
  const antes = snapshotAdmin(interaction.guildId);
  const r = await fn();
  try {
    const depois = snapshotAdmin(interaction.guildId);
    const mudou = Object.keys(SECOES).filter((k) => antes[k] !== depois[k]).map((k) => SECOES[k]);
    if (mudou.length) registrarEvento(interaction.guild, 'admin', { member: interaction.member, motivo: `Alterado: ${mudou.join(', ')}` });
  } catch (e) { console.error('[Verificacao] Falha na auditoria:', e.message); }
  return r;
}

// ── Ações administrativas ─────────────────────────────────────────
const abrir = (interaction) => seguro(interaction, () => admin(interaction, () => render(interaction, 'home')));

async function toggle(interaction) {
  const g = interaction.guild; const cfg = getConfig(g.id);
  if (!cfg.enabled) {
    if (!cfg.channelId) return render(interaction, 'home', 'Defina o canal do painel antes de ativar.');
    if (!cfg.roles.main) return render(interaction, 'home', 'Defina o cargo principal antes de ativar.');
    const err = validarCargo(g, cfg.roles.main, null);
    if (err) return render(interaction, 'home', err);
  }
  cfg.enabled = !cfg.enabled; saveConfig(g.id, cfg);
  return render(interaction, 'home');
}

// ── Publicar / atualizar painel ───────────────────────────────────
const publicando = new Set();
const publishLast = new Map();

/** 'none' | 'ok' | 'missing' | 'unknown' (+ message quando encontrada). Nunca apaga dados. */
async function verificarPainel(g, panel) {
  if (!panel?.messageId) return { status: 'none' };
  const chId = panel.messageChannelId || panel.channelId;
  let ch = g.channels.cache.get(chId);
  if (!ch && chId) {
    try { ch = await g.channels.fetch(chId); } catch (e) { return { status: e?.code === 10003 ? 'missing' : 'unknown' }; }
  }
  if (!ch || !ch.isTextBased?.()) return { status: 'missing' };
  try {
    const message = await ch.messages.fetch(panel.messageId);
    return message ? { status: 'ok', message } : { status: 'missing' };
  } catch (e) {
    return { status: e?.code === 10008 ? 'missing' : 'unknown' };
  }
}

function checarPublicacao(g, cfg) {
  const items = []; let ok = true;
  const add = (pass, texto, blocking = true) => { items.push({ pass, texto, blocking }); if (!pass && blocking) ok = false; };
  const eCanal = cfg.channelId ? validarCanal(g, cfg.channelId, { historico: true }) : 'Selecione o canal do painel.';
  add(!eCanal, eCanal ? `Canal: ${eCanal}` : `Canal ${canalTxt(g, cfg.channelId)}: acesso e permissões OK`);
  const eMain = cfg.roles.main ? validarCargo(g, cfg.roles.main, null) : 'Defina o cargo principal.';
  add(!eMain, eMain ? `Cargo principal: ${eMain}` : `Cargo principal ${cargoTxt(g, cfg.roles.main)}: OK`);
  const extras = [...cfg.roles.extra, ...(cfg.roles.unverified ? [cfg.roles.unverified] : [])];
  const errosExtra = extras.map((id) => [id, validarCargo(g, id, null)]).filter(([, e]) => e);
  add(!errosExtra.length, errosExtra.length ? errosExtra.map(([, e]) => `Cargo extra: ${e}`).join('\n❌ ') : `Cargos adicionais/não verificado: ${extras.length} OK`);
  const eEmbed = checarLimitesEmbed(cfg.appearance);
  add(!eEmbed, eEmbed || 'Limites do embed OK');
  if (cfg.logChannelId) { const eLog = validarCanal(g, cfg.logChannelId); add(!eLog, eLog ? `Canal de logs: ${eLog}` : 'Canal de logs OK', false); }
  else add(false, 'Canal de logs não configurado (opcional).', false);
  return { items, ok };
}

async function abrirPublicar(interaction, notice) {
  const g = interaction.guild; let cfg = getConfig(g.id);
  const panel = cfg.panels[cfg.activePanelId];
  const r = await verificarPainel(g, panel);
  if (r.status === 'missing' && atualizarStatusPainel(g.id, panel.panelId, 'missing')) {
    registrarEvento(g, 'missing', { motivo: `Painel \`${panel.panelId}\` não encontrado. Os dados foram mantidos.` });
  } else if (r.status === 'ok') atualizarStatusPainel(g.id, panel.panelId, 'ok');
  cfg = getConfig(g.id);
  return render(interaction, 'publish', notice, { status: r.status, checks: checarPublicacao(g, cfg) });
}

async function executarPublicacao(interaction, { novo }) {
  const g = interaction.guild;
  if (publicando.has(g.id)) return abrirPublicar(interaction, 'Já existe uma publicação em andamento.');
  const espera = PUBLISH_COOLDOWN_MS - (Date.now() - (publishLast.get(g.id) || 0));
  if (espera > 0) return abrirPublicar(interaction, `Aguarde ${Math.ceil(espera / 1000)}s antes de publicar/atualizar novamente.`);
  publicando.add(g.id);
  publishLast.set(g.id, Date.now());
  try {
    await interaction.deferUpdate().catch(() => {});
    let cfg = getConfig(g.id);
    const chk = checarPublicacao(g, cfg);
    if (!chk.ok) return await abrirPublicar(interaction, 'Corrija os itens marcados com ❌ antes de publicar.');
    const panel = cfg.panels[cfg.activePanelId];
    const ch = g.channels.cache.get(cfg.channelId);
    const msgPayload = buildPanelMessage(g, cfg);

    let existente = null;
    if (panel.messageId && !novo) {
      const r = await verificarPainel(g, panel);
      if (r.status === 'missing') {
        if (atualizarStatusPainel(g.id, panel.panelId, 'missing')) registrarEvento(g, 'missing', { motivo: `Painel \`${panel.panelId}\` não encontrado. Os dados foram mantidos.` });
        return await abrirPublicar(interaction, 'O painel publicado não foi encontrado. Use **Publicar novamente**.');
      }
      if (r.status === 'unknown') return await abrirPublicar(interaction, 'Não foi possível verificar o painel atual. Confira o acesso do bot ao canal e tente de novo.');
      existente = r.message;
    }

    let msg; let tipo;
    if (existente && (panel.messageChannelId || panel.channelId) === ch.id) {
      msg = await existente.edit(msgPayload); tipo = 'updated';
    } else {
      if (existente) await existente.delete().catch(() => {}); // canal mudou: remove o antigo
      msg = await ch.send(msgPayload); tipo = 'published';
    }
    cfg = getConfig(g.id); // recarrega: estado de usuários pode ter mudado durante os awaits
    const p = cfg.panels[cfg.activePanelId];
    cfg.publishedMessage = { channelId: ch.id, messageId: msg.id };
    p.status = 'ok'; p.publishedAt = p.publishedAt || Date.now(); p.updatedAt = Date.now();
    saveConfig(g.id, cfg);
    registrarEvento(g, tipo, { member: interaction.member, motivo: `Canal: <#${ch.id}> • [ir para o painel](https://discord.com/channels/${g.id}/${ch.id}/${msg.id})` });
    return await abrirPublicar(interaction, tipo === 'updated' ? `Painel atualizado em <#${ch.id}>.` : `Painel publicado em <#${ch.id}>.`);
  } catch (e) {
    console.error('[Verificacao] Falha ao publicar:', e.message);
    registrarEvento(g, 'error', { member: interaction.member, motivo: `Falha ao publicar/atualizar o painel: ${discordErro(e)}` });
    return abrirPublicar(interaction, `Falha ao publicar: ${discordErro(e)}`).catch(() => {});
  } finally {
    publicando.delete(g.id);
  }
}

// Preview: MESMA renderização do painel real (ou do log); vai como mensagem efêmera separada (V2 não aceita embed).
async function preview(interaction, isLog) {
  const g = interaction.guild; const cfg = getConfig(g.id);
  const err = checarLimitesEmbed(isLog ? cfg.logs.template : cfg.appearance);
  if (err) return interaction.reply({ content: `⚠️ ${err}`, flags: MessageFlags.Ephemeral });
  try {
    const base = isLog
      ? { embeds: [buildLogEmbed(g, cfg, 'verified', { member: interaction.member })], content: '-# Preview do log — exemplo: "Verificação concluída".' }
      : { ...buildPanelMessage(g, cfg, { preview: true }), content: '-# Preview — é assim que o painel será publicado.' };
    return await interaction.reply({ ...base, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
  } catch (e) {
    return interaction.reply({ content: `⚠️ Não foi possível montar o preview: ${discordErro(e)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// ── Modais / campos ───────────────────────────────────────────────
function campo(id, label, value, style = TextInputStyle.Short, max = 100, required = true, placeholder) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  if (value) t.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(t);
}
const modal = (id, title, ...rows) => new ModalBuilder().setCustomId(id).setTitle(title.slice(0, 45)).addComponents(...rows);
const newFieldId = () => `f${Date.now().toString(36).slice(-4)}${crypto.randomBytes(2).toString('hex')}`;
const FID = /^[a-z0-9]{4,16}$/;
const int = (v, min, max) => { const s = String(v).trim(); const n = Number(s); return /^\d+$/.test(s) && Number.isInteger(n) && n >= min && n <= max ? n : null; };

function fieldModal(fid, f, pos, total, isLog) {
  return modal(I(isLog, 'vf_modal_fld', fid), fid === 'new' ? 'Novo campo' : 'Editar campo',
    campo('nome', 'Nome do campo', f?.name || '', TextInputStyle.Short, 256),
    campo('valor', 'Valor do campo', f?.value || '', TextInputStyle.Paragraph, 1024),
    campo('inline', 'Inline? (sim/não)', f?.inline ? 'sim' : 'não', TextInputStyle.Short, 3, false),
    campo('pos', `Posição (1-${Math.max(total, 1)})`, fid === 'new' ? '' : String(pos), TextInputStyle.Short, 2, false, fid === 'new' ? 'vazio = no final' : undefined));
}

// ── Botões administrativos ────────────────────────────────────────
async function adminButton(interaction) {
  const g = interaction.guild;
  const parts = interaction.customId.split(':');
  const base = parts[0];
  const isLog = parts.includes('l');
  const fid = parts.slice(1).find((p) => FID.test(p)) || null;
  const W = isLog ? { which: 'l' } : {};
  const tgt = (c) => (isLog ? c.logs.template : c.appearance);
  const toggleKey = (fn, tela, ctx) => { const c = getConfig(g.id); fn(c); saveConfig(g.id, c); return render(interaction, tela, null, ctx); };

  switch (base) {
    case 'vf_home': return render(interaction, 'home');
    case 'vf_cfg': return render(interaction, 'cfg');
    case 'vf_roles': return render(interaction, 'roles');
    case 'vf_sec': return render(interaction, 'sec');
    case 'vf_app': return render(interaction, 'app', null, W);
    case 'vf_btn': return render(interaction, 'btn');
    case 'vf_msg': return render(interaction, 'msg');
    case 'vf_logs': return render(interaction, 'logs');
    case 'vf_fields': return render(interaction, 'fields', null, W);
    case 'vf_preview': return preview(interaction, isLog);
    case 'vf_publish': return abrirPublicar(interaction);
    case 'vf_pub_go': return executarPublicacao(interaction, { novo: false });
    case 'vf_pub_new': return executarPublicacao(interaction, { novo: true });
    case 'vf_toggle': return toggle(interaction);
    case 'vf_back': return require('../commands/painel').voltarParaPainel(interaction);
    case 'vf_web': return render(interaction, 'web');
    case 'vf_web_toggle': {
      const c = getConfig(g.id);
      if (!c.web.enabled) {
        if (!c.roles.main) return render(interaction, 'web', 'Defina o cargo principal (aba Cargos) antes de ativar a Verificação Web.');
        const errC = validarCargo(g, c.roles.main, null);
        if (errC) return render(interaction, 'web', errC);
      }
      c.web.enabled = !c.web.enabled; saveConfig(g.id, c);
      return render(interaction, 'web');
    }
    case 'vf_web_mode': {
      const c = getConfig(g.id); c.web.mode = c.web.mode === 'custom' ? 'kron' : 'custom'; saveConfig(g.id, c);
      return render(interaction, 'web');
    }
    case 'vf_web_url': {
      const w = getConfig(g.id).web;
      return interaction.showModal(modal('vf_modal_web_url', 'Site personalizado',
        campo('url', 'URL do site de verificação', w.customUrl || '', TextInputStyle.Short, 500, true, 'https://meusite.com/verificar')));
    }
    case 'vf_web_secret': {
      const c = getConfig(g.id);
      const secret = require('./webVerify').gerarSecret();
      c.web.customSecretHash = require('./webVerify').hashSecret(secret);
      saveConfig(g.id, c);
      return interaction.reply({
        content: `🔑 **Secret gerado — copie agora, ele não será mostrado de novo:**\n\`\`\`${secret}\`\`\`\n` +
          'Configure seu site para enviar este valor no campo `secret` ao chamar `POST /verify/api/complete`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    case 'vf_tg_removeunv': return toggleKey((c) => { c.roles.removeUnverified = !c.roles.removeUnverified; }, 'cfg');
    case 'vf_tg_dm': return toggleKey((c) => { c.security.dmAfterVerify = !c.security.dmAfterVerify; }, 'cfg');
    case 'vf_tg_dm_m': return toggleKey((c) => { c.security.dmAfterVerify = !c.security.dmAfterVerify; }, 'msg');
    case 'vf_tg_noavatar': return toggleKey((c) => { c.security.noAvatarSuspicious = !c.security.noAvatarSuspicious; }, 'sec');
    case 'vf_tg_timestamp': return toggleKey((c) => { tgt(c).timestamp = !tgt(c).timestamp; }, 'app', W);
    case 'vf_tg_btn': return toggleKey((c) => { c.button.enabled = !c.button.enabled; }, 'btn');

    case 'vf_rst_app': return render(interaction, 'confirm', null, { kind: 'app', ...W });
    case 'vf_rst_msg': return render(interaction, 'confirm', null, { kind: 'msg' });
    case 'vf_rst_app_no': return render(interaction, 'app', null, W);
    case 'vf_rst_msg_no': return render(interaction, 'msg');
    case 'vf_rst_app_ok': {
      const c = getConfig(g.id);
      if (isLog) c.logs.template = DEFAULT_LOG_TEMPLATE(); else c.appearance = DEFAULT_APPEARANCE();
      saveConfig(g.id, c);
      return render(interaction, 'app', isLog ? 'Aparência dos logs restaurada ao padrão.' : 'Aparência restaurada ao padrão.', W);
    }
    case 'vf_rst_msg_ok': { const c = getConfig(g.id); c.messages = DEFAULT_MESSAGES(); saveConfig(g.id, c); return render(interaction, 'msg', 'Mensagens restauradas ao padrão.'); }

    case 'vf_edit_sec': {
      const s = getConfig(g.id).security;
      return interaction.showModal(modal('vf_modal_sec', 'Tentativas, cooldown e bloqueio',
        campo('cooldown', 'Cooldown (segundos, 0-3600)', String(s.cooldownSeconds), TextInputStyle.Short, 4),
        campo('tentativas', 'Tentativas máximas (1-20)', String(s.maxAttempts), TextInputStyle.Short, 2),
        campo('bloqueio', 'Bloqueio ao exceder (minutos, 1-1440)', String(s.blockMinutes), TextInputStyle.Short, 4)));
    }
    case 'vf_edit_app': {
      const a = tgt(getConfig(g.id));
      return interaction.showModal(modal(I(isLog, 'vf_modal_app'), 'Título e descrição',
        campo('titulo', 'Título', a.title, TextInputStyle.Short, 256),
        campo('descricao', 'Descrição', a.description, TextInputStyle.Paragraph, 2000, true, 'Aceita placeholders como {servidor}')));
    }
    case 'vf_edit_color': {
      const a = tgt(getConfig(g.id));
      return interaction.showModal(modal(I(isLog, 'vf_modal_color'), 'Cor do embed',
        campo('cor', 'Cor HEX (vazio = restaurar padrão)', a.color || '', TextInputStyle.Short, 7, false, '#5865F2')));
    }
    case 'vf_edit_banner': case 'vf_edit_thumb': {
      const a = tgt(getConfig(g.id)); const ban = base === 'vf_edit_banner';
      return interaction.showModal(modal(I(isLog, ban ? 'vf_modal_banner' : 'vf_modal_thumb'), ban ? 'Banner' : 'Thumbnail',
        campo('url', `URL ${ban ? 'do banner' : 'da thumbnail'} (vazio = remover)`, (ban ? a.bannerUrl : a.thumbnailUrl) || '', TextInputStyle.Short, 500, false, 'https://…')));
    }
    case 'vf_edit_author': {
      const a = tgt(getConfig(g.id));
      return interaction.showModal(modal(I(isLog, 'vf_modal_author'), 'Autor',
        campo('nome', 'Nome do autor (vazio = remover)', a.author.name, TextInputStyle.Short, 256, false),
        campo('icone', 'URL do ícone (opcional)', a.author.iconUrl, TextInputStyle.Short, 500, false)));
    }
    case 'vf_edit_footer': {
      const a = tgt(getConfig(g.id));
      return interaction.showModal(modal(I(isLog, 'vf_modal_footer'), 'Footer',
        campo('texto', 'Texto do footer (vazio = remover)', a.footer.text, TextInputStyle.Short, 512, false),
        campo('icone', 'URL do ícone (opcional)', a.footer.iconUrl, TextInputStyle.Short, 500, false)));
    }
    case 'vf_edit_btn': {
      const b = getConfig(g.id).button;
      return interaction.showModal(modal('vf_modal_btn', 'Botão de verificação',
        campo('nome', 'Nome do botão', b.label, TextInputStyle.Short, 80, false),
        campo('emoji', 'Emoji (vazio = nenhum)', b.emoji || '', TextInputStyle.Short, 60, false, '✅ ou <:nome:id>')));
    }
    case 'vf_edit_msg1': {
      const m = getConfig(g.id).messages;
      return interaction.showModal(modal('vf_modal_msg1', 'Mensagens (1/2)',
        campo('success', 'Sucesso', m.success, TextInputStyle.Paragraph, 300),
        campo('error', 'Erro', m.error, TextInputStyle.Paragraph, 300),
        campo('cooldown', 'Cooldown', m.cooldown, TextInputStyle.Paragraph, 300),
        campo('already', 'Já verificado', m.already, TextInputStyle.Paragraph, 300),
        campo('step', 'Etapa adicional', m.step, TextInputStyle.Paragraph, 300)));
    }
    case 'vf_edit_msg2': {
      const m = getConfig(g.id).messages;
      return interaction.showModal(modal('vf_modal_msg2', 'Mensagens (2/2)',
        campo('tooNew', 'Conta muito nova', m.tooNew, TextInputStyle.Paragraph, 300),
        campo('attempts', 'Tentativas excedidas', m.attempts, TextInputStyle.Paragraph, 300),
        campo('suspicious', 'Conta suspeita', m.suspicious, TextInputStyle.Paragraph, 300),
        campo('stepButton', 'Texto do botão da etapa', m.stepButton, TextInputStyle.Short, 80),
        campo('disabled', 'Sistema indisponível', m.disabled, TextInputStyle.Paragraph, 300)));
    }
    case 'vf_edit_dm': {
      const m = getConfig(g.id).messages;
      return interaction.showModal(modal('vf_modal_dm', 'Mensagem da DM',
        campo('dm', 'Texto da DM', m.dm, TextInputStyle.Paragraph, 800, true, 'Ex.: Olá, {menção}! …')));
    }

    case 'vf_fld_add': {
      if (tgt(getConfig(g.id)).fields.length >= MAX_FIELDS) return render(interaction, 'fields', `Limite de ${MAX_FIELDS} campos atingido.`, W);
      return interaction.showModal(fieldModal('new', null, 0, 1, isLog));
    }
    case 'vf_fld_edit': {
      const fs = tgt(getConfig(g.id)).fields; const i = fs.findIndex((f) => f.id === fid);
      if (i < 0) return render(interaction, 'fields', 'Campo não encontrado.', W);
      return interaction.showModal(fieldModal(fid, fs[i], i + 1, fs.length, isLog));
    }
    case 'vf_fld_rm': case 'vf_fld_up': case 'vf_fld_dn': case 'vf_fld_tg': case 'vf_fld_il': {
      const c = getConfig(g.id); const t = tgt(c); const fs = t.fields; const i = fs.findIndex((f) => f.id === fid);
      if (i < 0) return render(interaction, 'fields', 'Campo não encontrado.', W);
      let sel = fid;
      if (base === 'vf_fld_rm') { fs.splice(i, 1); sel = null; }
      else if (base === 'vf_fld_up' && i > 0) [fs[i - 1], fs[i]] = [fs[i], fs[i - 1]];
      else if (base === 'vf_fld_dn' && i < fs.length - 1) [fs[i + 1], fs[i]] = [fs[i], fs[i + 1]];
      else if (base === 'vf_fld_tg') fs[i].enabled = !fs[i].enabled;
      else if (base === 'vf_fld_il') fs[i].inline = !fs[i].inline;
      const lim = checarLimitesEmbed(t);
      if (lim) return render(interaction, 'fields', lim, { ...W, sel });
      saveConfig(g.id, c);
      return render(interaction, 'fields', null, { ...W, sel });
    }
    default:
      return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// ── Selects administrativos ───────────────────────────────────────
async function adminSelect(interaction) {
  const g = interaction.guild; const cfg = getConfig(g.id);
  const parts = interaction.customId.split(':'); const id = parts[0];
  const isLog = parts.includes('l'); const W = isLog ? { which: 'l' } : {};
  const v = interaction.values[0];

  if (id === 'vf_sel_channel' || id === 'vf_sel_logchannel' || id === 'vf_sel_logchannel_l' || id === 'vf_sel_pubchannel') {
    const tela = id === 'vf_sel_logchannel_l' ? 'logs' : id === 'vf_sel_pubchannel' ? 'publish' : 'cfg';
    const falha = (m) => (tela === 'publish' ? abrirPublicar(interaction, m) : render(interaction, tela, m));
    if (!/^\d{5,25}$/.test(v)) return falha('Canal inválido.');
    const err = validarCanal(g, v, { historico: id === 'vf_sel_channel' || id === 'vf_sel_pubchannel' });
    if (err) return falha(err);
    if (id === 'vf_sel_channel' || id === 'vf_sel_pubchannel') cfg.channelId = v; else cfg.logChannelId = v;
    saveConfig(g.id, cfg);
    return tela === 'publish' ? abrirPublicar(interaction) : render(interaction, tela);
  }
  if (id === 'vf_sel_rolemain' || id === 'vf_sel_roleunv') {
    const err = validarCargo(g, v, interaction.member);
    if (err) return render(interaction, 'roles', err);
    if (id === 'vf_sel_rolemain') cfg.roles.main = v; else cfg.roles.unverified = v;
    saveConfig(g.id, cfg);
    return render(interaction, 'roles');
  }
  if (id === 'vf_sel_roleextra') {
    const ids = [...new Set(interaction.values)].slice(0, MAX_EXTRA);
    for (const rid of ids) { const err = validarCargo(g, rid, interaction.member); if (err) return render(interaction, 'roles', err); }
    cfg.roles.extra = ids; saveConfig(g.id, cfg);
    return render(interaction, 'roles');
  }
  if (id === 'vf_sel_age') {
    if (v === 'custom') {
      return interaction.showModal(modal('vf_modal_age', 'Idade mínima da conta',
        campo('dias', 'Dias (0 = desativado, máx. 365)', String(cfg.security.minAccountAgeDays), TextInputStyle.Short, 3)));
    }
    const n = Number(v);
    if (!AGE_OPTIONS.includes(n)) return render(interaction, 'sec', 'Valor inválido.');
    cfg.security.minAccountAgeDays = n; saveConfig(g.id, cfg);
    return render(interaction, 'sec');
  }
  if (id === 'vf_sel_policy') {
    if (!POLICY_LABEL[v]) return render(interaction, 'sec', 'Opção inválida.');
    cfg.security.suspiciousPolicy = v; saveConfig(g.id, cfg);
    return render(interaction, 'sec');
  }
  if (id === 'vf_sel_style') {
    if (!STYLES[v]) return render(interaction, 'btn', 'Estilo inválido.');
    cfg.button.style = v; saveConfig(g.id, cfg);
    return render(interaction, 'btn');
  }
  if (id === 'vf_fld_sel') {
    const fs = (isLog ? cfg.logs.template : cfg.appearance).fields;
    if (!fs.some((f) => f.id === v)) return render(interaction, 'fields', 'Campo não encontrado.', W);
    return render(interaction, 'fields', null, { ...W, sel: v });
  }
  return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
}

// ── Modais administrativos ────────────────────────────────────────
async function adminModal(interaction) {
  const g = interaction.guild; const cfg = getConfig(g.id);
  const parts = interaction.customId.split(':'); const base = parts[0];
  const isLog = parts.includes('l'); const W = isLog ? { which: 'l' } : {};
  const arg = parts[1] && parts[1] !== 'l' ? parts[1] : null;
  const f = (k) => interaction.fields.getTextInputValue(k).trim();
  const a = isLog ? cfg.logs.template : cfg.appearance;
  const corPadrao = isLog ? null : DEFAULT_APPEARANCE().color;
  const commit = (tela, ctx = {}) => {
    const lim = checarLimitesEmbed(a);
    if (lim) return render(interaction, tela, lim, { ...W, ...ctx });
    saveConfig(g.id, cfg);
    return render(interaction, tela, null, { ...W, ...ctx });
  };

  switch (base) {
    case 'vf_modal_sec': {
      const cd = int(f('cooldown'), 0, 3600); const at = int(f('tentativas'), 1, 20); const bl = int(f('bloqueio'), 1, 1440);
      if (cd === null || at === null || bl === null) return render(interaction, 'sec', 'Valores inválidos: cooldown 0-3600, tentativas 1-20, bloqueio 1-1440.');
      Object.assign(cfg.security, { cooldownSeconds: cd, maxAttempts: at, blockMinutes: bl });
      saveConfig(g.id, cfg);
      return render(interaction, 'sec');
    }
    case 'vf_modal_age': {
      const n = int(f('dias'), 0, 365);
      if (n === null) return render(interaction, 'sec', 'Informe um número inteiro entre 0 e 365.');
      cfg.security.minAccountAgeDays = n; saveConfig(g.id, cfg);
      return render(interaction, 'sec');
    }
    case 'vf_modal_app': {
      if (!f('titulo') || !f('descricao')) return render(interaction, 'app', 'Título e descrição são obrigatórios.', W);
      Object.assign(a, { title: f('titulo'), description: f('descricao') });
      return commit('app');
    }
    case 'vf_modal_color': {
      const raw = f('cor');
      if (!raw) a.color = corPadrao;
      else { const c = validarHex(raw); if (!c) return render(interaction, 'app', 'Cor inválida. Use o formato HEX #RRGGBB (ex.: #5865F2).', W); a.color = c; }
      return commit('app');
    }
    case 'vf_modal_banner': case 'vf_modal_thumb': {
      const raw = f('url'); const key = base === 'vf_modal_banner' ? 'bannerUrl' : 'thumbnailUrl';
      if (!raw) a[key] = null;
      else { const u = validarUrl(raw); if (!u) return render(interaction, 'app', 'URL inválida. Use um link http(s) direto para a imagem.', W); a[key] = u; }
      return commit('app');
    }
    case 'vf_modal_author': case 'vf_modal_footer': {
      const isA = base === 'vf_modal_author';
      const name = f(isA ? 'nome' : 'texto'); const icon = f('icone');
      if (!name && icon) return render(interaction, 'app', `Informe ${isA ? 'o nome do autor' : 'o texto do footer'} para usar um ícone.`, W);
      let iconOk = '';
      if (icon) { iconOk = validarUrl(icon); if (!iconOk) return render(interaction, 'app', 'URL do ícone inválida.', W); }
      if (isA) a.author = { name, iconUrl: iconOk }; else a.footer = { text: name, iconUrl: iconOk };
      return commit('app');
    }
    case 'vf_modal_btn': {
      const label = f('nome'); const em = parseEmoji(f('emoji'));
      if (em === false) return render(interaction, 'btn', 'Emoji inválido. Use um emoji unicode ou <:nome:id>.');
      if (!label && !em) return render(interaction, 'btn', 'O botão precisa de nome ou emoji.');
      cfg.button.label = label; cfg.button.emoji = f('emoji') || null;
      saveConfig(g.id, cfg);
      return render(interaction, 'btn');
    }
    case 'vf_modal_msg1': case 'vf_modal_msg2': {
      const keys = base === 'vf_modal_msg1' ? ['success', 'error', 'cooldown', 'already', 'step'] : ['tooNew', 'attempts', 'suspicious', 'stepButton', 'disabled'];
      for (const k of keys) if (!f(k)) return render(interaction, 'msg', 'Nenhuma mensagem pode ficar vazia. Use Restaurar para voltar ao padrão.');
      for (const k of keys) cfg.messages[k] = f(k);
      saveConfig(g.id, cfg);
      return render(interaction, 'msg');
    }
    case 'vf_modal_dm': {
      if (!f('dm')) return render(interaction, 'msg', 'A DM não pode ficar vazia.');
      cfg.messages.dm = f('dm'); saveConfig(g.id, cfg);
      return render(interaction, 'msg');
    }
    case 'vf_modal_web_url': {
      const u = validarUrl(f('url'));
      if (!u || !u.startsWith('https://')) return render(interaction, 'web', 'URL inválida. Use um link https:// completo.');
      cfg.web.customUrl = u; saveConfig(g.id, cfg);
      return render(interaction, 'web');
    }
    case 'vf_modal_fld': {
      const isNew = arg === 'new';
      if (!isNew && !(arg && FID.test(arg))) return render(interaction, 'fields', 'Campo inválido.', W);
      const fs = a.fields; const selAtual = isNew ? null : arg;
      const name = f('nome'); const value = f('valor');
      if (!name || !value) return render(interaction, 'fields', 'Nome e valor são obrigatórios.', { ...W, sel: selAtual });
      const il = f('inline').toLowerCase();
      if (il && !['sim', 'não', 'nao', 's', 'n'].includes(il)) return render(interaction, 'fields', 'Inline deve ser "sim" ou "não".', { ...W, sel: selAtual });
      const inline = ['sim', 's'].includes(il);
      let field;
      if (isNew) {
        if (fs.length >= MAX_FIELDS) return render(interaction, 'fields', `Limite de ${MAX_FIELDS} campos.`, W);
        field = { id: newFieldId(), name, value, inline, enabled: true };
        fs.push(field);
      } else {
        field = fs.find((x) => x.id === arg);
        if (!field) return render(interaction, 'fields', 'Campo não encontrado.', W);
        Object.assign(field, { name, value, inline });
      }
      const posRaw = f('pos');
      if (posRaw) {
        const p = int(posRaw, 1, fs.length);
        if (p === null) return render(interaction, 'fields', `Posição deve ser de 1 a ${fs.length}.`, { ...W, sel: selAtual });
        fs.splice(fs.indexOf(field), 1); fs.splice(p - 1, 0, field);
      }
      return commit('fields', { sel: field.id });
    }
    default:
      return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// ── Entradas públicas do roteador (buttonHandler.js) ──────────────
function handleButton(interaction) {
  return seguro(interaction, () => {
    const id = interaction.customId;
    if (id === ID_BOTAO_PUBLICO || id.startsWith(`${ID_BOTAO_PUBLICO}:`)) return handleClickPublico(interaction);
    if (id === ID_PREVIEW_BTN) return interaction.reply({ content: 'Este é apenas um preview — o botão não faz nada aqui.', flags: MessageFlags.Ephemeral });
    if (id.startsWith('vf_step:')) return handleStep(interaction);
    return admin(interaction, () => adminButton(interaction));
  });
}
const handleSelectMenu = (interaction) => seguro(interaction, () => admin(interaction, () => adminSelect(interaction)));
const handleModal = (interaction) => seguro(interaction, () => admin(interaction, () => adminModal(interaction)));

// ══════════════════════════════════════════════════════════════════
// Fluxo público de verificação (botão do painel publicado)
// ══════════════════════════════════════════════════════════════════
const inFlight = new Set();          // "guild:user" com verificação em andamento
const lastClick = new Map();         // "guild:user" → timestamp (rate limit)
const sessions = new Map();          // token → { guildId, userId, expires }
const sessionByUser = new Map();     // "guild:user" → token

function purgarSessoes(now = Date.now()) {
  for (const [t, s] of sessions) if (s.expires <= now) { sessions.delete(t); if (sessionByUser.get(`${s.guildId}:${s.userId}`) === t) sessionByUser.delete(`${s.guildId}:${s.userId}`); }
  if (lastClick.size > 5000) for (const [k, t] of lastClick) if (now - t > RATE_MS) lastClick.delete(k);
}
function criarSessao(guildId, userId) {
  const now = Date.now(); purgarSessoes(now);
  const key = `${guildId}:${userId}`;
  const antigo = sessionByUser.get(key);
  if (antigo) sessions.delete(antigo);                 // 1 sessão por usuário
  if (sessions.size >= SESSION_CAP) return null;       // teto global
  const token = crypto.randomBytes(8).toString('hex');
  sessions.set(token, { guildId, userId, expires: now + SESSION_TTL_MS });
  sessionByUser.set(key, token);
  return token;
}

function avaliarSeguranca(user, cfg, now = Date.now()) {
  const s = cfg.security;
  if (s.minAccountAgeDays > 0 && now - user.createdTimestamp < s.minAccountAgeDays * 86400000) return { ok: false, reason: 'tooNew' };
  if (s.noAvatarSuspicious && !user.avatar) return { ok: false, reason: 'suspicious' };
  return { ok: true };
}

const MSG_OPTS = { allowedMentions: { parse: [] } };
const msgTxt = (cfg, key, g, member, extra = '') =>
  `${aplicarPlaceholders(cfg.messages[key], { guild: g, member, cfg })}${extra}`.slice(0, 1900);

/** Registra falha: incrementa tentativas, aplica cooldown ou bloqueio temporário. */
function registrarFalha(guildId, userId, cfg) {
  const st = getUserState(guildId, userId);
  const attempts = st.attempts + 1;
  const now = Date.now();
  if (attempts >= cfg.security.maxAttempts) {
    setUserState(guildId, userId, { state: UserState.BLOCKED, attempts, blockedUntil: now + cfg.security.blockMinutes * 60000, cooldownUntil: 0 });
    return { blocked: true };
  }
  if (cfg.security.cooldownSeconds > 0) {
    setUserState(guildId, userId, { state: UserState.COOLDOWN, attempts, cooldownUntil: now + cfg.security.cooldownSeconds * 1000, cooldownLogged: false });
  } else setUserState(guildId, userId, { state: UserState.FAILED, attempts });
  return { blocked: false };
}

/** Concede os cargos. Resultado detalhado (nada acontece "em silêncio"). */
async function concluirVerificacao(member, g, cfg) {
  const r = cfg.roles;
  const errMain = validarCargo(g, r.main, null);
  if (errMain) return { ok: false, motivo: `Cargo principal: ${errMain}` };
  const add = [r.main]; const avisos = [];
  for (const id of r.extra) {
    const e = validarCargo(g, id, null);
    if (e) avisos.push(`Cargo adicional ignorado: ${e}`); else if (!add.includes(id)) add.push(id);
  }
  try {
    await member.roles.add(add, 'Kael Verificação');
  } catch (e) {
    return { ok: false, motivo: `Falha ao atribuir cargos (nenhum cargo foi concedido): ${discordErro(e)}` };
  }
  if (r.removeUnverified && r.unverified && member.roles.cache?.has(r.unverified)) {
    try { await member.roles.remove(r.unverified, 'Kael Verificação'); }
    catch (e) { avisos.push(`Cargo concedido, mas não foi possível remover o cargo de não verificado: ${discordErro(e)}`); }
  }
  setUserState(g.id, member.id, { state: UserState.VERIFIED, attempts: 0, cooldownUntil: 0, blockedUntil: 0 });
  return { ok: true, granted: add, avisos };
}

async function enviarDM(member, g, cfg) {
  try {
    await member.send({ content: aplicarPlaceholders(cfg.messages.dm, { guild: g, member, cfg }).slice(0, 1900), ...MSG_OPTS });
    return true;
  } catch { return false; } // DM fechada nunca quebra a verificação
}

async function responder(interaction, content, components = []) {
  const p = { content, components, ...MSG_OPTS };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(p);
    return await interaction.reply({ ...p, flags: MessageFlags.Ephemeral });
  } catch (e) { console.error('[Verificacao] Falha ao responder:', e.message); }
}

/** Núcleo (clique inicial e etapa adicional): já verificado → cooldown → tentativas → segurança → cargos → logs → DM. */
async function executarVerificacao(interaction, cfg, { pularSeguranca = false } = {}) {
  const g = interaction.guild;
  let member = interaction.member;
  if (!member?.roles?.add) member = await g.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return responder(interaction, '❌ Não foi possível localizar você no servidor.');

  const r = cfg.roles;
  if (r.main && member.roles.cache.has(r.main)) return responder(interaction, msgTxt(cfg, 'already', g, member));

  const st = getUserState(g.id, member.id);
  const now = Date.now();
  if (st.state === UserState.BLOCKED) {
    return responder(interaction, msgTxt(cfg, 'attempts', g, member, `\n-# Tente novamente <t:${Math.ceil(st.blockedUntil / 1000)}:R>.`));
  }
  if (st.state === UserState.COOLDOWN) {
    if (!st.cooldownLogged) {
      setUserState(g.id, member.id, { cooldownLogged: true });
      registrarEvento(g, 'cooldown', { member, motivo: `Nova tentativa durante o cooldown de ${cfg.security.cooldownSeconds}s.` });
    }
    return responder(interaction, msgTxt(cfg, 'cooldown', g, member, `\n-# Tente novamente <t:${Math.ceil(st.cooldownUntil / 1000)}:R>.`));
  }
  const errMain = r.main ? validarCargo(g, r.main, null) : 'Cargo principal não configurado.';
  if (errMain) {
    registrarEvento(g, 'error', { member, motivo: `Não foi possível verificar: ${errMain}` });
    return responder(interaction, msgTxt(cfg, 'error', g, member));
  }

  if (!pularSeguranca) {
    const av = avaliarSeguranca(member.user, cfg, now);
    if (!av.ok) {
      const pol = cfg.security.suspiciousPolicy;
      const rotulo = av.reason === 'tooNew' ? 'conta abaixo da idade mínima' : 'conta suspeita (sem avatar)';
      if (pol === 'step') {
        const token = criarSessao(g.id, member.id);
        if (!token) return responder(interaction, msgTxt(cfg, 'error', g, member));
        registrarEvento(g, 'step', { member, motivo: `Etapa adicional exigida: ${rotulo}.` });
        return responder(interaction, msgTxt(cfg, 'step', g, member),
          [row(btn(`vf_step:${token}`, cut(cfg.messages.stepButton, 80), ButtonStyle.Primary))]);
      }
      if (pol === 'block') {
        const f = registrarFalha(g.id, member.id, cfg);
        if (f.blocked) registrarEvento(g, 'attempts', { member, motivo: `Limite de ${cfg.security.maxAttempts} tentativas atingido (${rotulo}). Bloqueado por ${cfg.security.blockMinutes} min.` });
        else registrarEvento(g, av.reason, { member, motivo: `Verificação recusada: ${rotulo}.` });
        return responder(interaction, msgTxt(cfg, f.blocked ? 'attempts' : av.reason, g, member));
      }
      // 'allow' → segue
    }
  }

  const res = await concluirVerificacao(member, g, cfg);
  if (!res.ok) {
    registrarEvento(g, 'error', { member, motivo: res.motivo });
    return responder(interaction, msgTxt(cfg, 'error', g, member));
  }
  await responder(interaction, msgTxt(cfg, 'success', g, member));
  const avisos = [...res.avisos];
  if (cfg.security.dmAfterVerify && !(await enviarDM(member, g, cfg))) avisos.push('DM não enviada (mensagens diretas fechadas).');
  registrarEvento(g, 'verified', {
    member, cargo: res.granted.map((id) => `<@&${id}>`).join(' '), motivo: avisos.length ? avisos.join('\n') : undefined,
  });
  return undefined;
}

async function comProtecao(interaction, fn) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (inFlight.has(key)) return interaction.reply({ content: 'Sua verificação já está em andamento.', flags: MessageFlags.Ephemeral }).catch(() => {});
  inFlight.add(key);
  try { return await fn(); } finally { inFlight.delete(key); }
}

async function iniciarVerificacaoWeb(interaction, cfg, panel) {
  const g = interaction.guild;
  let member = interaction.member;
  if (!member?.roles?.add) member = await g.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.reply({ content: '❌ Não foi possível localizar você no servidor.', flags: MessageFlags.Ephemeral }).catch(() => {});
  if (cfg.roles.main && member.roles.cache.has(cfg.roles.main)) {
    return interaction.reply({ content: msgTxt(cfg, 'already', g, member), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const errMain = cfg.roles.main ? validarCargo(g, cfg.roles.main, null) : 'Cargo principal não configurado.';
  if (errMain) {
    registrarEvento(g, 'error', { member, motivo: `Verificação Web indisponível: ${errMain}` });
    return interaction.reply({ content: msgTxt(cfg, 'error', g, member), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const webVerify = require('./webVerify');
  if (cfg.web.mode === 'kron' && !webVerify.baseUrlOk()) {
    return interaction.reply({ content: '❌ A Verificação Web ainda não foi configurada pelo administrador deste bot (OAuth2 do Discord pendente).', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (cfg.web.mode === 'custom' && !cfg.web.customUrl) {
    return interaction.reply({ content: '❌ O site personalizado de verificação ainda não foi configurado pelo administrador.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const sessionId = webVerify.criarSessao(g.id, member.id, panel.panelId);
  const link = cfg.web.mode === 'custom'
    ? `${cfg.web.customUrl}${cfg.web.customUrl.includes('?') ? '&' : '?'}session=${sessionId}&guild=${g.id}`
    : `${process.env.PUBLIC_BASE_URL || ''}/verify/${sessionId}`;
  const linkBtn = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel('🛡️ Verificar');
  return interaction.reply({
    content: '🛡️ **Verificação necessária**\nClique no botão abaixo para iniciar sua verificação. O link expira em alguns minutos.',
    components: [row(linkBtn)],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleClickPublico(interaction) {
  const g = interaction.guild;
  const nao = (c) => interaction.reply({ content: c, flags: MessageFlags.Ephemeral }).catch(() => {});
  if (!interaction.inGuild() || !g || interaction.guildId !== g.id) return nao('Use este botão dentro do servidor.');
  const cfg = getConfig(g.id);
  const panel = acharPainelPorMensagem(cfg, interaction.channelId, interaction.message?.id);
  const panelId = interaction.customId.split(':')[1];
  if (!panel || (panelId && panelId !== panel.panelId)) return nao('Este painel não é mais válido.');
  if (!cfg.enabled || !panel.button.enabled) return nao(msgTxt(cfg, 'disabled', g, interaction.member));

  const key = `${g.id}:${interaction.user.id}`;
  const now = Date.now();
  if (now - (lastClick.get(key) || 0) < RATE_MS) return nao('Calma! Aguarde um instante antes de clicar novamente.');
  lastClick.set(key, now);

  if (cfg.web.enabled) {
    return comProtecao(interaction, async () => iniciarVerificacaoWeb(interaction, cfg, panel));
  }

  return comProtecao(interaction, async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    return executarVerificacao(interaction, cfg);
  });
}

async function handleStep(interaction) {
  const g = interaction.guild;
  const nao = (c) => interaction.reply({ content: c, flags: MessageFlags.Ephemeral }).catch(() => {});
  if (!interaction.inGuild() || !g || interaction.guildId !== g.id) return nao('Use este botão dentro do servidor.');
  const token = interaction.customId.split(':')[1] || '';
  const s = /^[a-f0-9]{16}$/.test(token) ? sessions.get(token) : null;
  if (!s || s.guildId !== g.id || s.userId !== interaction.user.id || s.expires <= Date.now()) {
    if (s && s.expires <= Date.now()) sessions.delete(token);
    return nao('Sessão inválida ou expirada. Clique novamente no botão do painel.');
  }
  const cfg = getConfig(g.id);
  if (!cfg.enabled) return nao(msgTxt(cfg, 'disabled', g, interaction.member));
  return comProtecao(interaction, async () => {
    sessions.delete(token); sessionByUser.delete(`${g.id}:${interaction.user.id}`); // uso único
    await interaction.deferUpdate().catch(() => {});
    return executarVerificacao(interaction, cfg, { pularSeguranca: true });
  });
}

// ══════════════════════════════════════════════════════════════════
// Recovery após restart
// ══════════════════════════════════════════════════════════════════
/** Relocaliza os painéis publicados. Não recria mensagens e não apaga dados; ausentes ficam marcados. */
async function recuperarPaineis(client) {
  const resumo = { ok: 0, missing: 0, unknown: 0 };
  for (const g of client.guilds.cache.values()) {
    try {
      if (!db.getGuild(g.id).verificacao) continue;
      const cfg = getConfig(g.id);
      for (const p of Object.values(cfg.panels)) {
        if (!p.messageId) continue;
        const r = await verificarPainel(g, p);
        resumo[r.status] = (resumo[r.status] || 0) + 1;
        if (r.status === 'missing' && atualizarStatusPainel(g.id, p.panelId, 'missing')) {
          registrarEvento(g, 'missing', { motivo: `Painel \`${p.panelId}\` não foi encontrado após reinicialização. Os dados foram mantidos.` });
        } else if (r.status === 'ok') atualizarStatusPainel(g.id, p.panelId, 'ok');
      }
    } catch (e) {
      console.error(`[Verificacao] Falha ao recuperar painéis da guild ${g.id}:`, e.message);
    }
  }
  return resumo;
}

module.exports = {
  SystemState, UserState, defaults, getConfig, saveConfig, getSystemState,
  getUserState, setUserState, validarCargo, validarCanal, registrarEvento,
  aplicarPlaceholders, buildPanelMessage, buildLogEmbed, validarHex, validarUrl, parseEmoji,
  checarLimitesEmbed, avaliarSeguranca, verificarPainel, recuperarPaineis,
  abrir, handleButton, handleSelectMenu, handleModal,
  concluirVerificacao, enviarDM, // reaproveitados pela Verificação Web (verificacao-system/webVerify.js)
  _test: { sessions, inFlight, lastClick, adminBuckets, publishLast },
};
