// ============================================================
//  carteiraUtils.js — Formatadores e embeds padronizados
// ============================================================

const { EmbedBuilder } = require('discord.js');

// ── Formatadores ─────────────────────────────────────────────

/**
 * Formata número para moeda brasileira.
 * Ex.: 1500.5 → "R$ 1.500,50"
 */
function formatarReal(valor = 0) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata ISO string para data legível.
 * Ex.: "2026-06-05T..." → "05/06/2026"
 */
function formatarData(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  return d.toLocaleDateString('pt-BR', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });
}

/**
 * Formata ISO string para data + hora.
 * Ex.: "05/06/2026 às 14:32"
 */
function formatarDataHora(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Mascara chave PIX para exibição segura.
 * Ex.: "12345678901" → "123...901"
 */
function mascaraPix(chave) {
  if (!chave) return 'Não cadastrada';
  if (chave.length <= 6) return chave;
  return chave.slice(0, 3) + '...' + chave.slice(-3);
}

// ── Embeds padrão ────────────────────────────────────────────

/** Embed de erro padrão (vermelho #E74C3C). */
function embedErro(titulo, descricao) {
  return new EmbedBuilder()
    .setColor('#E74C3C')
    .setTitle(titulo)
    .setDescription(descricao)
    .setTimestamp();
}

/** Embed de sucesso padrão (verde #2ECC71). */
function embedSucesso(titulo, descricao) {
  return new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle(titulo)
    .setDescription(descricao)
    .setTimestamp();
}

module.exports = {
  formatarReal,
  formatarData,
  formatarDataHora,
  mascaraPix,
  embedErro,
  embedSucesso,
};
