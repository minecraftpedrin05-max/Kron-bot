// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/ui.js — KAEL SERVER TEMPLATES
//
//  Todas as telas do /template. Funções PURAS: recebem dados, devolvem a lista de
//  componentes (Components V2). Quem decide o que mostrar e reage aos cliques é o
//  commands/template.js. Identidade Kael: minimalista, uma cor de destaque,
//  sem excesso de emojis coloridos.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');

const schema = require('./schema');
const perms = require('./perms');

const COR = { marca: 0xFFFFFF, branco: 0xFFFFFF, ok: 0x57F287, aviso: 0xFEE75C, erro: 0xED4245, neutro: 0x2B2D31 };
const BANNER_URL = require('../../utils/assets').assetUrl('kael-banner.png');
const POR_PAGINA = 10;
const CHARS_ARVORE = 2600;

const ROTULO_TIPO = {
  owner: 'Dono', admin: 'Administração', mod: 'Moderação', helper: 'Ajuda', support: 'Suporte', staff: 'Equipe',
  seller: 'Vendas', dev: 'Desenvolvimento', partner: 'Parceria', vip: 'VIP', premium: 'Premium', booster: 'Booster',
  creator: 'Criador', member: 'Membro', cosmetic: 'Identidade', bot: 'Bots',
};
const ROTULO_PRESET = {
  leitura: 'leitura', vitrine: 'vitrine', criadores: 'criadores', staff: 'equipe', gestao: 'gestão',
  vendas: 'vendas', vip: 'vip', parceiros: 'parceiros', dev: 'dev', membros: 'membros', palco: 'só a equipe fala', mudo: 'sem anexos',
};
const ROTULO_TIPO_CANAL = { voz: '*voz*', anuncios: '*anúncios*', palco: '*palco*', forum: '*fórum*' };

const cortar = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const txt = (s) => new TextDisplayBuilder().setContent(cortar(s, 3900));
const linha = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, estilo, opts) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(cortar(label, 80)).setStyle(estilo || ButtonStyle.Secondary);
  if (opts && opts.desativado) b.setDisabled(true);
  return b;
};

function pagina(cor, corpo, linhas, imagemUrl) {
  const c = new ContainerBuilder().setAccentColor(cor)
    .addTextDisplayComponents(txt(corpo));
  if (imagemUrl) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imagemUrl).setSpoiler(false)));
  }
  return [c, ...(linhas || [])];
}

const cab = (extra) => `# KAEL TEMPLATES\n-# ${extra}`;

function badge(t) {
  if (t.oficial) return 'Kael Official';
  return t.origem && t.origem.tipo === 'externa' ? 'Externo' : 'Comunidade';
}

function resumoContagem(c) {
  return `${c.cargos} • ${c.categorias} • ${c.texto + c.outros} • ${c.voz}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════════════════════════════════
function home({ total, contagemSecoes, destaque, novos, revisor, pendentes, erros }) {
  const l = (t) => `• **${cortar(t.nome, 40)}** — ${t._c.cargos} cargos • ${t._c.categorias} categorias • ${t._c.canais} canais`;
  let corpo = `${cab(`Biblioteca de estruturas prontas para Discord • ${total} templates`)}\n\nEscolha uma categoria, pesquise pelo nome ou explore os destaques.\n\n`;
  corpo += `### Em destaque\n${destaque.length ? destaque.map(l).join('\n') : '_Nenhum destaque no momento._'}\n\n`;
  corpo += `### Novos templates\n${novos.length ? novos.map(l).join('\n') : '_Sem novidades ainda._'}`;
  if (erros && erros.length) corpo += `\n\n-# ${erros.length} template(s) foram ignorados por erro de validação.`;

  const opcoes = [
    { label: 'Em destaque', value: 'esp:destaque', description: 'Selecionados pela Kael e mais utilizados' },
    { label: 'Novos templates', value: 'esp:novos', description: 'Adicionados recentemente' },
    { label: 'Kael Official', value: 'ori:oficial', description: 'Feitos pela equipe Kael Apps' },
    { label: 'Templates da comunidade', value: 'ori:comunidade', description: 'Enviados e aprovados pela comunidade' },
    { label: 'Meus favoritos', value: 'esp:favoritos', description: 'Templates que você marcou' },
    ...Object.entries(schema.SECOES).map(([k, s]) => ({ label: s.nome, value: 'sec:' + k, description: `${contagemSecoes[k] || 0} template(s)` })),
  ].slice(0, 25);

  const acoes = [
    btn('tpl_pesquisar', 'Pesquisar', ButtonStyle.Primary),
    btn('tpl_filtros', 'Filtros'),
    btn('tpl_historico', 'Histórico'),
    btn('tpl_enviar', 'Enviar template'),
  ];
  if (revisor) acoes.push(btn('tpl_revisao', `Revisão${pendentes ? ` (${pendentes})` : ''}`));
  return pagina(COR.branco, corpo, [
    linha(new StringSelectMenuBuilder().setCustomId('tpl_sel_secao').setPlaceholder('Escolher categoria').addOptions(opcoes)),
    linha(...acoes),
  ], BANNER_URL);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LISTA
// ═══════════════════════════════════════════════════════════════════════════
function lista({ titulo, filtroTxt, itens, pagina: pg, total, vazioMsg }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const ini = pg * POR_PAGINA;
  const fatia = itens.slice(ini, ini + POR_PAGINA);
  let corpo = `${cab(titulo)}\n\n`;
  if (filtroTxt) corpo += `-# Filtros: ${filtroTxt}\n\n`;
  if (!fatia.length) corpo += vazioMsg || '_Nenhum template encontrado com esses critérios._';
  else {
    corpo += fatia.map((t, i) => `**${ini + i + 1}. ${cortar(t.nome, 45)}**${t.premium ? ' • Premium' : ''}\n-# ${badge(t)} • ${t.estilo} • ${resumoContagem(t._c)}`).join('\n');
    corpo += `\n\n-# Página ${pg + 1}/${paginas} • ${total} template(s)`;
  }
  const rows = [];
  if (fatia.length) {
    rows.push(linha(new StringSelectMenuBuilder().setCustomId('tpl_sel_template').setPlaceholder('Abrir template...').addOptions(
      fatia.map(t => ({ label: cortar(t.nome, 100), value: t.slug, description: cortar(`${t._c.cargos} cargos • ${t._c.categorias} categorias • ${t._c.canais} canais • ${t.estilo}`, 100) })))));
  }
  rows.push(linha(
    btn('tpl_pg_ant', '◀', ButtonStyle.Secondary, { desativado: pg <= 0 }),
    btn('tpl_pg_prox', '▶', ButtonStyle.Secondary, { desativado: pg >= paginas - 1 }),
    btn('tpl_home', '🏠 Início'),
    btn('tpl_pesquisar', 'Pesquisar'),
    btn('tpl_filtros', 'Filtros'),
  ));
  return pagina(COR.marca, corpo, rows);
}

// ═══════════════════════════════════════════════════════════════════════════
//  FILTROS
// ═══════════════════════════════════════════════════════════════════════════
function filtros({ f, estilos }) {
  const marca = (v, atual) => v === (atual || '');
  const orig = [['', 'Todas as origens'], ['oficial', 'Kael Official'], ['comunidade', 'Comunidade'], ['premium', 'Premium']];
  const ord = [['', 'Padrão'], ['recentes', 'Mais recentes'], ['usados', 'Mais utilizados'], ['az', 'Nome (A-Z)'], ['canais', 'Mais canais'], ['cargos', 'Mais cargos']];
  const corpo = `${cab('Filtros da biblioteca')}\n\n` +
    `**Categoria:** ${f.secao ? (schema.SECOES[f.secao] || {}).nome : 'todas'}\n` +
    `**Estilo:** ${f.estilo || 'todos'}\n**Origem:** ${(orig.find(o => o[0] === (f.origem || '')) || orig[0])[1]}\n` +
    `**Ordenar por:** ${(ord.find(o => o[0] === (f.ordem || '')) || ord[0])[1]}\n` +
    `**Mínimo de canais:** ${f.minCanais || 'qualquer'} • **Mínimo de cargos:** ${f.minCargos || 'qualquer'}` +
    (f.q ? `\n**Busca:** "${cortar(f.q, 40)}"` : '');
  return pagina(COR.marca, corpo, [
    linha(new StringSelectMenuBuilder().setCustomId('tpl_f_secao').setPlaceholder('Categoria').addOptions([
      { label: 'Todas as categorias', value: '-', default: !f.secao },
      ...Object.entries(schema.SECOES).map(([k, s]) => ({ label: s.nome, value: k, default: f.secao === k })),
    ])),
    linha(new StringSelectMenuBuilder().setCustomId('tpl_f_estilo').setPlaceholder('Estilo').addOptions([
      { label: 'Todos os estilos', value: '-', default: !f.estilo },
      ...estilos.slice(0, 24).map(e => ({ label: cortar(e, 100), value: e, default: f.estilo === e })),
    ])),
    linha(new StringSelectMenuBuilder().setCustomId('tpl_f_origem').setPlaceholder('Origem').addOptions(orig.map(([v, l]) => ({ label: l, value: v || '-', default: marca(v, f.origem) })))),
    linha(new StringSelectMenuBuilder().setCustomId('tpl_f_ordem').setPlaceholder('Ordenar por').addOptions(ord.map(([v, l]) => ({ label: l, value: v || '-', default: marca(v, f.ordem) })))),
    linha(btn('tpl_f_minimos', 'Mínimos', ButtonStyle.Secondary), btn('tpl_f_limpar', 'Limpar'), btn('tpl_f_ver', 'Ver resultados', ButtonStyle.Primary), btn('tpl_home', '🏠')),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PREVIEW
// ═══════════════════════════════════════════════════════════════════════════
function linhaCargo(c) {
  const temAdmin = schema.permsDoCargo(c, true).includes('Administrator');
  return `${cortar(c.nome, 40)} — ${ROTULO_TIPO[c.tipo] || c.tipo}${temAdmin ? ' `Administrator`' : ''}`;
}

function badgeCat(cat) {
  return cat.preset && ROTULO_PRESET[cat.preset] ? ` \`${ROTULO_PRESET[cat.preset]}\`` : '';
}

function linhasCategoria(cat) {
  const out = [`**${cortar(cat.nome, 60)}**${badgeCat(cat)}`];
  cat.canais.forEach((ch, i) => {
    const ult = i === cat.canais.length - 1;
    const tag = ROTULO_TIPO_CANAL[ch.tipo] ? ` ${ROTULO_TIPO_CANAL[ch.tipo]}` : '';
    const pre = ch.preset && ROTULO_PRESET[ch.preset] ? ` \`${ROTULO_PRESET[ch.preset]}\`` : '';
    out.push(`${ult ? '└─' : '├─'} ${cortar(ch.nome, 60)}${tag}${pre}`);
  });
  return out;
}

function paginasArvore(t) {
  const blocos = t.categorias.map(c => linhasCategoria(c).join('\n'));
  const paginas = [];
  let atual = '';
  for (const b of blocos) {
    if (atual && (atual.length + b.length + 2) > CHARS_ARVORE) { paginas.push(atual); atual = ''; }
    atual += (atual ? '\n\n' : '') + b;
  }
  if (atual) paginas.push(atual);
  return paginas.length ? paginas : ['_Sem categorias._'];
}

function preview({ t, view, catIdx, pagArvore, favorito, revisao, lintLinhas }) {
  const c = t._c;
  let corpo = `# ${t.nome.toUpperCase()}\n> ${t.descricao || 'Estrutura completa para o seu servidor.'}\n` +
    `-# ${badge(t)}${t.premium ? ' • Premium' : ''} • ${t.estilo} • v${t.versao} • por ${cortar(t.autor, 30)}\n\n`;

  if (view === 'visao') {
    corpo += `### Estrutura\n**${c.cargos}** cargos\n**${c.categorias}** categorias\n**${c.texto + c.outros}** canais de texto\n**${c.voz}** canais de voz\n\n`;
    const maxC = 12;
    corpo += `### Cargos\n${t.cargos.slice(0, maxC).map(linhaCargo).join('\n')}${t.cargos.length > maxC ? `\n_+${t.cargos.length - maxC} cargos_` : ''}\n\n`;
    const maxK = 16;
    corpo += `### Categorias\n${t.categorias.slice(0, maxK).map(k => `• ${cortar(k.nome, 45)} — ${k.canais.length} canais${badgeCat(k)}`).join('\n')}${t.categorias.length > maxK ? `\n_+${t.categorias.length - maxK} categorias_` : ''}`;
    if (schema.temAdmin(t).length) corpo += '\n\n-# Cargos com Administrator só são criados assim se você autorizar na confirmação.';
  } else if (view === 'cat') {
    const cat = t.categorias[catIdx] || t.categorias[0];
    corpo += `### Categoria ${catIdx + 1}/${t.categorias.length}\n${linhasCategoria(cat).join('\n')}`;
    if (cat.preset && perms.PRESETS[cat.preset]) corpo += `\n\n-# ${perms.PRESETS[cat.preset].desc}`;
  } else if (view === 'arvore') {
    const pgs = paginasArvore(t);
    const i = Math.min(Math.max(pagArvore || 0, 0), pgs.length - 1);
    corpo += `### Estrutura completa (${i + 1}/${pgs.length})\n${pgs[i]}`;
  } else if (view === 'perms') {
    corpo += `### Permissões dos cargos\n`;
    const maxR = 12;
    corpo += t.cargos.slice(0, maxR).map(r => {
      const p = schema.permsDoCargo(r, true);
      return `**${cortar(r.nome, 32)}** — ${p.length ? cortar(p.join(', '), 110) : 'sem permissões extras'}`;
    }).join('\n');
    if (t.cargos.length > maxR) corpo += `\n_+${t.cargos.length - maxR} cargos_`;
    const usados = [...new Set(t.categorias.map(k => k.preset).filter(Boolean))];
    if (usados.length) corpo += `\n\n### Acesso aos canais\n${usados.map(p => `• \`${ROTULO_PRESET[p] || p}\` — ${perms.PRESETS[p].desc}`).join('\n')}`;
    corpo += '\n\n-# Somente o cargo Dono pode ter Administrator, e apenas se você autorizar ao aplicar.';
  }
  if (revisao && lintLinhas && lintLinhas.length) corpo += `\n\n### Pontos de atenção (revisão)\n${lintLinhas.slice(0, 8).map(x => `• ${cortar(x, 120)}`).join('\n')}`;

  const rows = [];
  if (t.categorias.length) {
    rows.push(linha(new StringSelectMenuBuilder().setCustomId('tpl_sel_cat').setPlaceholder('Ver os canais de uma categoria...').addOptions(
      t.categorias.slice(0, 25).map((k, i) => ({ label: cortar(k.nome, 100), value: String(i), description: `${k.canais.length} canais`, default: view === 'cat' && i === catIdx })))));
  }
  const nav = [
    btn('tpl_v_visao', 'Visão geral', ButtonStyle.Secondary, { desativado: view === 'visao' }),
    btn('tpl_v_arvore', 'Estrutura', ButtonStyle.Secondary, {}),
    btn('tpl_v_perms', 'Permissões', ButtonStyle.Secondary, { desativado: view === 'perms' }),
  ];
  if (!revisao) nav.push(btn('tpl_fav', favorito ? 'Favorito' : 'Favoritar', favorito ? ButtonStyle.Primary : ButtonStyle.Secondary));
  rows.push(linha(...nav));
  if (view === 'arvore') {
    const total = paginasArvore(t).length;
    rows.push(linha(btn('tpl_arv_ant', '◀', ButtonStyle.Secondary, { desativado: (pagArvore || 0) <= 0 }), btn('tpl_arv_prox', '▶', ButtonStyle.Secondary, { desativado: (pagArvore || 0) >= total - 1 })));
  }
  if (revisao) {
    rows.push(linha(btn('tpl_rev_aprovar', 'Aprovar', ButtonStyle.Success), btn('tpl_rev_recusar', 'Recusar', ButtonStyle.Danger), btn('tpl_revisao', '◀ Fila')));
  } else {
    rows.push(linha(btn('tpl_aplicar', 'APLICAR TEMPLATE', ButtonStyle.Success), btn('tpl_voltar', '◀ Voltar')));
  }
  return pagina(COR.marca, corpo, rows);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIRMAÇÃO / PROGRESSO / RESULTADO
// ═══════════════════════════════════════════════════════════════════════════
function confirmar({ t, pf, opcoes }) {
  const p = pf.plano;
  let corpo = `${cab('Confirmação')}\n\n### Aplicar "${cortar(t.nome, 50)}"\n`;
  if (p) {
    corpo += `Você está prestes a criar:\n\n**${p.totais.cargosCriar}** cargos\n**${p.totais.categoriasCriar}** categorias\n**${p.totais.canaisCriar}** canais\n\n`;
  }
  corpo += 'Essa ação modificará a estrutura do servidor. **Nada existente será apagado ou alterado.**\n\n';
  if (pf.checks.length) corpo += `**Verificações**\n${pf.checks.join('\n')}\n\n`;
  if (pf.avisos.length) corpo += `**Atenção**\n${pf.avisos.map(a => `${cortar(a, 260)}`).join('\n')}\n\n`;
  if (pf.erros.length) corpo += `**Não é possível aplicar agora**\n${pf.erros.map(e => `${cortar(e, 260)}`).join('\n')}\n`;
  else corpo += 'Deseja continuar?';

  const rows = [];
  const toggles = [];
  if (schema.temAdmin(t).length) toggles.push(btn('tpl_t_admin', `Administrator: ${opcoes.permitirAdmin ? 'SIM' : 'NÃO'}`, opcoes.permitirAdmin ? ButtonStyle.Danger : ButtonStyle.Secondary));
  toggles.push(btn('tpl_t_dup', `Reaproveitar existentes: ${opcoes.duplicar ? 'NÃO (duplicar)' : 'SIM'}`, ButtonStyle.Secondary));
  rows.push(linha(...toggles));
  if (pf.erros.length) rows.push(linha(btn('tpl_reverificar', 'Verificar novamente', ButtonStyle.Primary), btn('tpl_cancelar', '◀ Voltar')));
  else rows.push(linha(btn('tpl_confirmar', 'Confirmar', ButtonStyle.Success), btn('tpl_cancelar', 'Cancelar', ButtonStyle.Danger)));
  return pagina(pf.erros.length ? COR.erro : COR.aviso, corpo, rows);
}

function barra(pct) {
  const cheios = Math.round((pct / 100) * 15);
  return '█'.repeat(cheios) + '░'.repeat(15 - cheios);
}

function progresso({ nome, estado }) {
  const e = estado;
  const corpo = `# KAEL TEMPLATES\n**Aplicando template...**\n\`${barra(e.pct)} ${e.pct}%\`\n\n` +
    `Cargos: ${e.feitos.cargos}/${e.totais.cargos}\nCategorias: ${e.feitos.categorias}/${e.totais.categorias}\nCanais: ${e.feitos.canais}/${e.totais.canais}\n\n` +
    `**Status:** ${e.estagio}${e.erros ? `\n-# ${e.erros} erro(s) até agora` : ''}\n-# Template: ${cortar(nome, 50)}`;
  return pagina(COR.aviso, corpo, [linha(btn('tpl_parar', 'Parar', ButtonStyle.Danger))]);
}

function resultado({ t, res, reaproveitados, historicoId }) {
  const c = res.criados;
  const criouAlgo = c.cargos.length + c.categorias.length + c.canais.length > 0;
  let titulo = '**Template aplicado com sucesso**';
  let cor = COR.ok;
  if (res.abortou) { titulo = '**Aplicação interrompida**'; cor = COR.erro; }
  else if (res.parou) { titulo = '**Aplicação interrompida por você**'; cor = COR.aviso; }
  else if (res.erros.length) { titulo = '**Template aplicado parcialmente**'; cor = COR.aviso; }
  else if (!criouAlgo) { titulo = '**Nada novo para criar**'; cor = COR.neutro; }
  let corpo = `${cab('Resultado')}\n\n${titulo}\n\n**${c.cargos.length}** cargos criados\n**${c.categorias.length}** categorias criadas\n**${c.canais.length}** canais criados\n\n**Template:** ${cortar(t.nome, 50)}`;
  if (reaproveitados) corpo += `\n-# ${reaproveitados} recurso(s) já existiam e foram reaproveitados.`;
  if (res.abortou) corpo += `\n\n**Motivo:** ${cortar(res.abortou, 300)}`;
  if (res.erros.length) corpo += `\n\n**Erros (${res.erros.length})**\n${res.erros.slice(0, 6).map(e => `• ${cortar(e, 140)}`).join('\n')}${res.erros.length > 6 ? `\n_+${res.erros.length - 6}…_` : ''}`;
  if (criouAlgo && (res.abortou || res.erros.length)) corpo += '\n\nVocê pode desfazer o que foi criado nesta aplicação.';
  const acoes = [];
  if (criouAlgo) acoes.push(btn(`tpl_desf_${historicoId}`, 'Desfazer aplicação', ButtonStyle.Danger));
  acoes.push(btn('tpl_historico', 'Histórico'), btn('tpl_home', '🏠 Biblioteca'));
  return pagina(cor, corpo, [linha(...acoes)]);
}

// ═══════════════════════════════════════════════════════════════════════════
//  HISTÓRICO / ROLLBACK
// ═══════════════════════════════════════════════════════════════════════════
// Rótulo curto por resultado (sem emoji) — usado no histórico e no detalhe da aplicação.
const ROTULO_RES = { sucesso: 'Sucesso', parcial: 'Parcial', falha: 'Falha', interrompido: 'Interrompido', vazio: 'Sem alterações', interrompido_reinicio: 'Interrompido (restart)' };

function historico({ itens }) {
  let corpo = `${cab('Histórico de aplicações deste servidor')}\n\n`;
  if (!itens.length) corpo += '_Nenhum template foi aplicado neste servidor ainda._';
  else {
    corpo += itens.slice(0, 10).map(e => {
      const ts = Math.floor(Date.parse(e.ts) / 1000);
      const desf = e.desfeito ? ' *desfeito*' : '';
      return `**${cortar(e.nome, 40)}** — <t:${ts}:R> por <@${e.userId}>${desf}\n-# ${ROTULO_RES[e.resultado] || e.resultado} • ${e.contagem.cargos} cargos • ${e.contagem.categorias} categorias • ${e.contagem.canais} canais${e.erros && e.erros.length ? ` • ${e.erros.length} erro(s)` : ''}`;
    }).join('\n');
  }
  const rows = [];
  if (itens.length) {
    rows.push(linha(new StringSelectMenuBuilder().setCustomId('tpl_sel_hist').setPlaceholder('Abrir uma aplicação...').addOptions(
      itens.slice(0, 10).map(e => ({ label: cortar(e.nome, 100), value: e.id, description: cortar(`${ROTULO_RES[e.resultado] || e.resultado} — ${new Date(e.ts).toLocaleString('pt-BR')}`, 100) })))));
  }
  rows.push(linha(btn('tpl_home', '🏠 Biblioteca')));
  return pagina(COR.marca, corpo, rows);
}

function historicoDetalhe({ e }) {
  const ts = Math.floor(Date.parse(e.ts) / 1000);
  let corpo = `${cab('Detalhe da aplicação')}\n\n### ${cortar(e.nome, 50)}\n` +
    `**Quando:** <t:${ts}:F>\n**Por:** <@${e.userId}>\n**Versão do template:** ${e.versao || '—'}\n**Resultado:** ${ROTULO_RES[e.resultado] || e.resultado}\n\n` +
    `${e.contagem.cargos} cargos • ${e.contagem.categorias} categorias • ${e.contagem.canais} canais`;
  if (e.reaproveitados) corpo += `\n-# ${e.reaproveitados} recurso(s) já existiam e foram reaproveitados.`;
  if (e.erros && e.erros.length) corpo += `\n\n**Erros**\n${e.erros.slice(0, 8).map(x => `• ${cortar(x, 140)}`).join('\n')}`;
  if (e.desfeito) corpo += `\n\nDesfeito em <t:${Math.floor(Date.parse(e.desfeito) / 1000)}:F>`;
  else if (e.semRollback || !e.criados) corpo += '\n\n-# O desfazer só fica disponível para as aplicações mais recentes.';
  const rows = [];
  const acoes = [];
  const pode = !e.desfeito && e.criados && (e.criados.cargos.length + e.criados.categorias.length + e.criados.canais.length) > 0;
  if (pode) acoes.push(btn(`tpl_desf_${e.id}`, 'Desfazer aplicação', ButtonStyle.Danger));
  acoes.push(btn('tpl_historico', '◀ Histórico'), btn('tpl_home', '🏠'));
  rows.push(linha(...acoes));
  return pagina(COR.marca, corpo, rows);
}

function desfazerConfirmar({ e }) {
  const c = e.criados;
  const corpo = `${cab('Desfazer aplicação')}\n\n### Desfazer "${cortar(e.nome, 50)}"\nIsto removerá **somente** o que esta aplicação criou:\n\n` +
    `${c.canais.length} canais\n${c.categorias.length} categorias\n${c.cargos.length} cargos\n\n` +
    'Canais, categorias e cargos que já existiam **não são tocados**. Categorias que receberam canais novos depois da aplicação são preservadas.\n\n**Essa ação não pode ser desfeita.** Deseja continuar?';
  return pagina(COR.erro, corpo, [linha(btn(`tpl_desf_ok_${e.id}`, 'Confirmar', ButtonStyle.Danger), btn('tpl_historico', 'Cancelar'))]);
}

function desfazerProgresso({ pct, msg }) {
  return pagina(COR.aviso, `# KAEL TEMPLATES\n**Desfazendo aplicação...**\n\`${barra(pct)} ${pct}%\`\n\n**Status:** ${msg}`, []);
}

function desfazerResultado({ e, out }) {
  const r = out.removidos;
  let corpo = `${cab('Resultado')}\n\n${out.erros.length ? '**Aplicação desfeita parcialmente**' : '**Aplicação desfeita**'}\n\n` +
    `${r.canais} canais removidos\n${r.categorias} categorias removidas\n${r.cargos} cargos removidos`;
  if (out.jaNaoExistiam) corpo += `\n-# ${out.jaNaoExistiam} item(ns) já não existiam.`;
  if (out.preservados.length) corpo += `\n\n**Preservados**\n${out.preservados.slice(0, 5).map(x => `• ${cortar(x, 150)}`).join('\n')}`;
  if (out.erros.length) corpo += `\n\n**Erros**\n${out.erros.slice(0, 5).map(x => `• ${cortar(x, 140)}`).join('\n')}`;
  return pagina(out.erros.length ? COR.aviso : COR.ok, corpo, [linha(btn('tpl_historico', 'Histórico'), btn('tpl_home', '🏠 Biblioteca'))]);
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMUNIDADE
// ═══════════════════════════════════════════════════════════════════════════
function enviar({ meusEnvios, maxPend }) {
  const ROTULO_STATUS = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };
  let corpo = `${cab('Enviar template para a biblioteca da comunidade')}\n\n` +
    '**Como funciona**\n1. Você envia um template em JSON.\n2. Ele entra em análise.\n3. A equipe Kael revisa.\n4. É aprovado ou recusado.\n5. Se aprovado, entra na biblioteca.\n\n' +
    '**Nunca publicamos automaticamente.** Só enviamos templates que você criou ou que tenham licença que permita a redistribuição — sem servidores privados, backups de terceiros ou conteúdo vazado.\n\n' +
    '**Para enviar:** use `/template` anexando o arquivo JSON na opção **arquivo**.\n' +
    'Não tem o JSON? Toque em **Exportar este servidor** para gerar a estrutura (cargos, categorias, canais e permissões) do SEU servidor.\n' +
    'Campos importantes: `nome`, `slug`, `secao`, `cargos`, `categorias` e `declaracao: true` (você confirma ter direito de compartilhar). Se o template for de terceiros: `origem: { tipo: "externa", licenca, url }`.';
  if (meusEnvios.length) corpo += `\n\n**Seus envios** (máx. ${maxPend} em análise)\n${meusEnvios.slice(0, 6).map(e => `• ${cortar(e.nome, 40)} — ${ROTULO_STATUS[e.status] || e.status}${e.motivo ? ` (${cortar(e.motivo, 60)})` : ''}`).join('\n')}`;
  return pagina(COR.marca, corpo, [linha(btn('tpl_exportar', 'Exportar este servidor', ButtonStyle.Primary), btn('tpl_home', '🏠 Biblioteca'))]);
}

function revisaoLista({ envios }) {
  let corpo = `${cab('Revisão de templates da comunidade (equipe Kael)')}\n\n`;
  if (!envios.length) corpo += '_Nenhum envio pendente._';
  else corpo += envios.slice(0, 10).map(e => `**${cortar(e.nome, 40)}** — por <@${e.userId}> • <t:${Math.floor(Date.parse(e.criadoEm) / 1000)}:R>${e.avisos && e.avisos.length ? ` • ${e.avisos.length} aviso(s)` : ''}`).join('\n');
  const rows = [];
  if (envios.length) {
    rows.push(linha(new StringSelectMenuBuilder().setCustomId('tpl_sel_envio').setPlaceholder('Abrir envio...').addOptions(
      envios.slice(0, 10).map(e => ({ label: cortar(e.nome, 100), value: e.id, description: cortar(`enviado em ${new Date(e.criadoEm).toLocaleDateString('pt-BR')}`, 100) })))));
  }
  rows.push(linha(btn('tpl_home', '🏠 Biblioteca')));
  return pagina(COR.marca, corpo, rows);
}

function simples(titulo, texto, cor, botoes) {
  return pagina(cor || COR.marca, `${cab(titulo)}\n\n${texto}`, botoes && botoes.length ? [linha(...botoes)] : []);
}

module.exports = {
  COR, POR_PAGINA, ButtonStyle, btn, linha, cortar, barra, paginasArvore,
  home, lista, filtros, preview, confirmar, progresso, resultado,
  historico, historicoDetalhe, desfazerConfirmar, desfazerProgresso, desfazerResultado,
  enviar, revisaoLista, simples,
};
