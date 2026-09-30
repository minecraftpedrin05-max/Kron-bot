// ═══════════════════════════════════════════════════════════════════════
// invite-system/inviteText.js
//
// KAEL INVITE SYSTEM — Parte 2: motor de placeholders para textos/embeds
// personalizáveis. Usado pelo painel público, notificações e perfil.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Substitui placeholders {chave} por valores de `data`. Placeholders sem
 * valor correspondente viram string vazia (nunca quebram a mensagem).
 *
 * Placeholders suportados: {user} {username} {guild} {invites} {validInvites}
 * {currentMembers} {leftMembers} {nextReward} {progress} {position}
 * {inviter} {requiredInvites} {reward}
 */
function applyPlaceholders(template, data = {}) {
  if (typeof template !== 'string' || !template) return template || '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (data[key] === undefined || data[key] === null) return '';
    return String(data[key]);
  });
}

/**
 * Monta o objeto de dados padrão de um usuário para os placeholders,
 * a partir de estatísticas já calculadas (evita recomputar em cada lugar).
 */
function buildUserPlaceholderData({ member, user, guild, stats, next, position }) {
  const u = user || member?.user;
  return {
    user: u ? `<@${u.id}>` : '',
    username: u?.username || '',
    guild: guild?.name || '',
    invites: stats ? String(stats.total) : '0',
    validInvites: stats ? String(stats.validos) : '0',
    currentMembers: stats ? String(stats.atuais) : '0',
    leftMembers: stats ? String(stats.sairam) : '0',
    nextReward: next?.name || 'Nenhuma',
    requiredInvites: next ? String(next.required_invites) : '',
    progress: stats && next ? `${stats.validos}/${next.required_invites}` : (stats ? String(stats.validos) : '0'),
    position: position ? `#${position}` : 'Sem posição',
  };
}

module.exports = { applyPlaceholders, buildUserPlaceholderData };
