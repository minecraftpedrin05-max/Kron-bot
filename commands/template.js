// ═══════════════════════════════════════════════════════════════════════════
//  commands/template.js — KAEL SERVER TEMPLATES
//
//  Comando único: /template
//    biblioteca → categoria → template → preview (cargos/categorias/canais/permissões)
//    → aplicar → confirmar → progresso → concluído (com desfazer e histórico).
//
//  Toda a lógica vive em template-system/ (core/ = motor, library/ = templates).
//  Este arquivo só conduz a conversa com o usuário.
//
//    /template                       abre a biblioteca
//    /template arquivo:<json>        envia um template da comunidade para análise
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

const registry = require('../template-system/core/registry');
const store = require('../template-system/core/store');
const schema = require('../template-system/core/schema');
const preflight = require('../template-system/core/preflight');
const applier = require('../template-system/core/applier');
const submit = require('../template-system/core/submit');
const ui = require('../template-system/core/ui');
const lock = require('../template-system/core/lock');

let BOT_OWNER_ID = null;
try { BOT_OWNER_ID = require('../config/constants').BOT_OWNER_ID; } catch { /* sem dono definido */ }

// Plano mínimo para usar o /template (null = qualquer servidor com licença ativa).
// Valores possíveis: 'BASICO' | 'PRO' | 'PREMIUM' | 'PERMANENTE'
const PLANO_MINIMO = null;

const IDLE_MS = 10 * 60 * 1000;
const TOTAL_MS = 60 * 60 * 1000;
const MODAL_MS = 2 * 60 * 1000;

const eph = MessageFlags.Ephemeral;

function revisores() {
  const extra = String(process.env.KRON_TEMPLATE_REVIEWERS || '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set([BOT_OWNER_ID, ...extra].filter(Boolean));
}

function tituloBase(base, f) {
  if (f.q) return `Resultados para "${ui.cortar(f.q, 30)}"`;
  if (base.especial === 'destaque') return 'Em destaque';
  if (base.especial === 'novos') return 'Novos templates';
  if (base.especial === 'favoritos') return 'Meus favoritos';
  if (base.origem === 'oficial') return 'Kael Official';
  if (base.origem === 'comunidade') return 'Templates da comunidade';
  const s = f.secao || base.secao;
  if (s && schema.SECOES[s]) return schema.SECOES[s].nome;
  return 'Biblioteca';
}

function resumoFiltros(f) {
  const p = [];
  if (f.secao) p.push(schema.SECOES[f.secao].nome);
  if (f.estilo) p.push(`estilo ${f.estilo}`);
  if (f.origem) p.push(f.origem);
  if (f.ordem) p.push(`ordem ${f.ordem}`);
  if (f.minCanais) p.push(`≥${f.minCanais} canais`);
  if (f.minCargos) p.push(`≥${f.minCargos} cargos`);
  return p.join(' • ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Kael Templates — biblioteca de estruturas prontas de servidor Discord')
    .addAttachmentOption(o => o.setName('arquivo').setDescription('(Opcional) Envie um template em JSON para análise da equipe Kael').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, client) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: eph });
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores do servidor podem usar o Kael Templates.', flags: eph });
    }
    try {
      const helpers = require('../utils/helpers');
      if (helpers.checkLicense && !helpers.checkLicense(interaction.guild.id)) {
        return interaction.reply({ content: 'Este servidor não possui uma licença ativa.', flags: eph });
      }
      if (PLANO_MINIMO && helpers.temPlanoMinimo && !helpers.temPlanoMinimo(interaction.guild.id, PLANO_MINIMO)) {
        return interaction.reply({ content: `Adquira o plano ${PLANO_MINIMO} para usar o Kael Templates.`, flags: eph });
      }
    } catch { /* helpers indisponível: segue sem gate */ }

    const guild = interaction.guild;
    const user = interaction.user;
    const ehRevisor = revisores().has(user.id);

    // ── envio direto de template da comunidade ──
    const anexo = interaction.options.getAttachment('arquivo');
    if (anexo) {
      await interaction.deferReply({ flags: eph });
      const r = await submit.baixarEValidar(anexo);
      if (!r.ok) {
        return interaction.editReply({ components: ui.simples('Envio recusado na validação', r.erros.map(e => `• ${e}`).join('\n'), ui.COR.erro), flags: MessageFlags.IsComponentsV2 | eph });
      }
      const env = store.criarEnvio({ guildId: guild.id, userId: user.id, template: r.template, avisos: r.avisos });
      if (!env.ok) return interaction.editReply({ components: ui.simples('Não foi possível enviar', env.erro, ui.COR.erro), flags: MessageFlags.IsComponentsV2 | eph });
      const c = schema.contar(r.template);
      return interaction.editReply({
        components: ui.simples('Template enviado para análise', `**${ui.cortar(r.template.nome, 50)}** entrou na fila de revisão da equipe Kael.\n\n${c.cargos} cargos • ${c.categorias} categorias • ${c.canais} canais\n\nNada é publicado automaticamente. Você será avisado por DM quando houver uma decisão.`, ui.COR.ok),
        flags: MessageFlags.IsComponentsV2 | eph,
      });
    }

    await interaction.deferReply({ flags: eph });

    // ── estado da sessão ──
    const S = {
      view: 'home', base: {}, f: {}, pag: 0, slug: null, origem: 'lista',
      pv: { view: 'visao', catIdx: 0, pagArvore: 0 }, opcoes: { permitirAdmin: false, duplicar: false },
      pf: null, envioId: null,
    };
    let ultima = interaction;
    let ocupado = false;
    let parar = false;

    const render = (comps) => ultima.editReply({ components: comps }).catch(e => console.error('[Kael Templates] Falha ao atualizar painel:', e.message));

    // ── telas ──
    const montarHome = () => {
      S.view = 'home';
      const dest = registry.listar({ especial: 'destaque' }).slice(0, 3);
      const nov = registry.listar({ especial: 'novos' }).slice(0, 3);
      return ui.home({
        total: registry.todos().length, contagemSecoes: registry.contagemPorSecao(), destaque: dest, novos: nov,
        revisor: ehRevisor, pendentes: ehRevisor ? store.listarEnvios('pendente').length : 0, erros: registry.erros(),
      });
    };
    const mostrarHome = () => render(montarHome());
    const criterio = () => ({ ...S.base, ...S.f, favoritos: store.getFavoritos(guild.id, user.id) });
    const mostrarLista = () => {
      S.view = 'lista';
      const itens = registry.listar(criterio());
      const maxPg = Math.max(0, Math.ceil(itens.length / ui.POR_PAGINA) - 1);
      if (S.pag > maxPg) S.pag = maxPg;
      return render(ui.lista({
        titulo: tituloBase(S.base, S.f), filtroTxt: resumoFiltros(S.f), itens, pagina: S.pag, total: itens.length,
        vazioMsg: S.base.especial === 'favoritos' ? '_Você ainda não favoritou nenhum template. Abra um template e toque em **Favoritar**._' : undefined,
      }));
    };
    const mostrarFiltros = () => { S.view = 'filtros'; return render(ui.filtros({ f: S.f, estilos: registry.estilos() })); };
    const templateAtual = () => {
      if (S.envioId) { const e = store.getEnvio(S.envioId); return e && e.template ? { ...e.template, _c: schema.contar(e.template) } : null; }
      return registry.obter(S.slug);
    };
    const mostrarPreview = () => {
      S.view = 'preview';
      const t = templateAtual();
      if (!t) return mostrarHome();
      return render(ui.preview({
        t, view: S.pv.view, catIdx: S.pv.catIdx, pagArvore: S.pv.pagArvore,
        favorito: store.getFavoritos(guild.id, user.id).includes(t.slug),
        revisao: !!S.envioId, lintLinhas: S.envioId ? schema.lint(t) : null,
      }));
    };
    const verificar = async () => {
      const t = registry.obter(S.slug);
      S.pf = await preflight.verificar(guild, t, S.opcoes);
      S.view = 'confirmar';
      return render(ui.confirmar({ t, pf: S.pf, opcoes: S.opcoes }));
    };
    const mostrarHistorico = () => { S.view = 'historico'; return render(ui.historico({ itens: store.getHistorico(guild.id) })); };
    const mostrarEnviar = () => {
      S.view = 'enviar';
      const meus = store.listarEnvios().filter(e => e.userId === user.id);
      return render(ui.enviar({ meusEnvios: meus, maxPend: store.MAX_PENDENTES_USUARIO }));
    };
    const mostrarRevisao = () => { S.view = 'revisao'; S.envioId = null; return render(ui.revisaoLista({ envios: store.listarEnvios('pendente') })); };

    // ── modal genérico ──
    async function pedir(i, titulo, campos) {
      const id = `tpl_modal_${i.id}`;
      const modal = new ModalBuilder().setCustomId(id).setTitle(ui.cortar(titulo, 45));
      for (const c of campos) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(c.id).setLabel(ui.cortar(c.label, 45)).setStyle(c.longo ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(!!c.obrigatorio).setMaxLength(c.max || 100).setPlaceholder(ui.cortar(c.placeholder || '', 100))));
      }
      await i.showModal(modal);
      const sub = await i.awaitModalSubmit({ time: MODAL_MS, filter: (m) => m.customId === id && m.user.id === user.id }).catch(() => null);
      if (!sub) return null;
      await sub.deferUpdate().catch(() => {});
      ultima = sub;
      const out = {};
      for (const c of campos) out[c.id] = sub.fields.getTextInputValue(c.id).trim();
      return out;
    }

    // ── aplicação ──
    async function aplicarTemplate() {
      const t = registry.obter(S.slug);
      // revalida tudo no momento de aplicar (o servidor pode ter mudado desde a tela de confirmação)
      const pf = await preflight.verificar(guild, t, S.opcoes);
      S.pf = pf;
      if (!pf.ok) return render(ui.confirmar({ t, pf, opcoes: S.opcoes }));
      if (!lock.tentarTravar(guild.id)) {
        return render(ui.simples('Aplicação em andamento', 'Já existe uma aplicação de template em andamento neste servidor. Aguarde ela terminar.', ui.COR.aviso, [ui.btn('tpl_home', '🏠 Biblioteca')]));
      }
      ocupado = true;
      parar = false;
      let ultimoEdit = 0;
      let res;
      // Abre o registro de operação ANTES de criar qualquer coisa. A partir daqui,
      // cada cargo/categoria/canal criado é persistido no mesmo instante (onRecurso)
      // — se o bot cair no meio, o próximo boot encontra exatamente o que já existe
      // (ver template-system/core/recovery.js), sem precisar adivinhar nem duplicar.
      store.iniciarOperacao(guild.id, { slug: t.slug, templateNome: t.nome, templateVersao: t.versao, userId: user.id });
      try {
        await render(ui.progresso({ nome: t.nome, estado: { pct: 0, feitos: { cargos: 0, categorias: 0, canais: 0 }, totais: { cargos: pf.plano.totais.cargosCriar, categorias: pf.plano.totais.categoriasCriar, canais: pf.plano.totais.canaisCriar }, estagio: 'Preparando...', erros: 0 } }));
        res = await applier.aplicar({
          guild, plano: pf.plano, template: t, executorId: user.id, deveParar: () => parar,
          onEstagio: (estado) => store.atualizarOperacao(guild.id, { estado }),
          onRecurso: (tipo, item) => store.registrarRecursoOperacao(guild.id, tipo, item),
          onProgress: (e) => {
            if (Date.now() - ultimoEdit < 1500 && e.pct < 100) return;
            ultimoEdit = Date.now();
            render(ui.progresso({ nome: t.nome, estado: e }));
          },
        });
      } catch (e) {
        console.error('[Kael Templates] Erro inesperado na aplicação:', e);
        res = { criados: { cargos: [], categorias: [], canais: [] }, erros: [`Erro inesperado: ${String(e.message).slice(0, 120)}`], parou: false, abortou: 'Erro inesperado durante a aplicação.' };
      } finally {
        lock.destravar(guild.id);
        ocupado = false;
      }
      const c = res.criados;
      const criou = c.cargos.length + c.categorias.length + c.canais.length > 0;
      const resultado = res.abortou ? (criou ? 'parcial' : 'falha') : res.parou ? 'interrompido' : res.erros.length ? 'parcial' : criou ? 'sucesso' : 'vazio';
      const reaproveitados = pf.plano.totais.cargosReusar + pf.plano.totais.categoriasReusar + pf.plano.totais.canaisPular;
      const entrada = store.adicionarHistorico(guild.id, {
        userId: user.id, slug: t.slug, nome: t.nome, versao: t.versao,
        contagem: { cargos: c.cargos.length, categorias: c.categorias.length, canais: c.canais.length },
        reaproveitados, resultado, erros: res.erros.slice(0, 10),
        criados: { cargos: c.cargos.map(x => x.id), categorias: c.categorias.map(x => x.id), canais: c.canais.map(x => x.id) },
      });
      // A aplicação terminou dentro deste mesmo processo (sucesso, parcial ou
      // erro tratado) — o resultado definitivo já está no histórico acima, então
      // o registro transitório de operação não serve mais pra nada e é fechado.
      // Se o processo tivesse caído ANTES de chegar aqui, este `finalizarOperacao`
      // nunca rodaria — e é exatamente esse o caso que o recovery.js trata no boot.
      store.finalizarOperacao(guild.id);
      if (criou) store.registrarUso(t.slug);
      S.view = 'resultado';
      return render(ui.resultado({ t, res, reaproveitados, historicoId: entrada.id }));
    }

    async function desfazerAplicacao(id) {
      const e = store.getEntradaHistorico(guild.id, id);
      if (!e || !e.criados || e.desfeito) return render(ui.simples('Desfazer', 'Esta aplicação não pode mais ser desfeita.', ui.COR.aviso, [ui.btn('tpl_historico', '◀ Histórico')]));
      if (!lock.tentarTravar(guild.id)) return render(ui.simples('Aplicação em andamento', 'Aguarde a operação atual terminar.', ui.COR.aviso, [ui.btn('tpl_historico', '◀ Histórico')]));
      ocupado = true;
      let ultimoEdit = 0;
      let out;
      try {
        out = await applier.desfazer({
          guild, criados: e.criados, executorId: user.id,
          onProgress: (p) => { if (Date.now() - ultimoEdit < 1500 && p.pct < 100) return; ultimoEdit = Date.now(); render(ui.desfazerProgresso(p)); },
        });
      } catch (err) {
        console.error('[Kael Templates] Erro no rollback:', err);
        out = { removidos: { canais: 0, categorias: 0, cargos: 0 }, jaNaoExistiam: 0, preservados: [], erros: [`Erro inesperado: ${String(err.message).slice(0, 120)}`] };
      } finally { lock.destravar(guild.id); ocupado = false; }
      store.atualizarHistorico(guild.id, id, { desfeito: new Date().toISOString(), resultado: e.resultado, rollback: { removidos: out.removidos, erros: out.erros.slice(0, 5) } });
      S.view = 'desfeito';
      return render(ui.desfazerResultado({ e, out }));
    }

    // ── revisão (equipe Kael) ──
    async function notificar(userId, texto) {
      try { const u = await (client || interaction.client).users.fetch(userId); await u.send(texto); } catch { /* DM fechada */ }
    }
    async function aprovarEnvio() {
      const env = store.getEnvio(S.envioId);
      if (!env || env.status !== 'pendente') return mostrarRevisao();
      let slug = env.template.slug; let n = 2;
      if (registry.obter(slug)) slug = `com-${slug}`;
      while (registry.obter(slug)) slug = `${env.template.slug}-${n++}`;
      const r = store.aprovarEnvio(env.id, user.id, slug.slice(0, 60));
      if (!r.ok) return render(ui.simples('Revisão', r.erro, ui.COR.erro, [ui.btn('tpl_revisao', '◀ Fila')]));
      registry.recarregar();
      await notificar(env.userId, `Seu template **${env.nome}** foi aprovado e já está na biblioteca do Kael Templates.`);
      S.envioId = null;
      return render(ui.simples('Revisão', `**${ui.cortar(env.nome, 50)}** aprovado e publicado como \`${slug}\`.`, ui.COR.ok, [ui.btn('tpl_revisao', '◀ Fila'), ui.btn('tpl_home', '🏠')]));
    }

    // ── painel ──
    await interaction.editReply({ components: montarHome(), flags: MessageFlags.IsComponentsV2 | eph });
    const resposta = await interaction.fetchReply();
    const collector = resposta.createMessageComponentCollector({ idle: IDLE_MS, time: TOTAL_MS });

    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== user.id) return i.reply({ content: 'Só quem executou o comando pode interagir com este painel.', flags: eph });
        const id = i.customId;

        if (id === 'tpl_parar') { parar = true; return i.deferUpdate(); }
        if (ocupado) return i.reply({ content: 'Uma operação está em andamento. Aguarde.', flags: eph });

        // ── ações que abrem modal ──
        if (id === 'tpl_pesquisar') {
          const r = await pedir(i, 'Pesquisar template', [{ id: 'q', label: 'Nome, estilo ou tag', placeholder: 'Ex.: loja premium, anime, suporte...', obrigatorio: true, max: 60 }]);
          if (!r) return;
          S.base = {}; S.f = { q: r.q }; S.pag = 0;
          return mostrarLista();
        }
        if (id === 'tpl_f_minimos') {
          const r = await pedir(i, 'Mínimos', [
            { id: 'canais', label: 'Mínimo de canais (vazio = qualquer)', placeholder: 'Ex.: 30', max: 3 },
            { id: 'cargos', label: 'Mínimo de cargos (vazio = qualquer)', placeholder: 'Ex.: 8', max: 3 },
          ]);
          if (!r) return;
          S.f = { ...S.f, minCanais: Math.max(0, parseInt(r.canais, 10) || 0) || undefined, minCargos: Math.max(0, parseInt(r.cargos, 10) || 0) || undefined };
          return mostrarFiltros();
        }
        if (id === 'tpl_rev_recusar') {
          if (!ehRevisor) return i.reply({ content: 'Apenas a equipe Kael pode revisar.', flags: eph });
          const r = await pedir(i, 'Recusar template', [{ id: 'motivo', label: 'Motivo (enviado ao autor)', longo: true, obrigatorio: true, max: 300 }]);
          if (!r) return;
          const env = store.getEnvio(S.envioId);
          const rr = store.recusarEnvio(S.envioId, user.id, r.motivo);
          if (rr.ok && env) await notificar(env.userId, `Seu template **${env.nome}** não foi aprovado.\nMotivo: ${r.motivo}`);
          S.envioId = null;
          return mostrarRevisao();
        }

        await i.deferUpdate();
        ultima = i;

        // ── seleções ──
        if (id === 'tpl_sel_secao') {
          const [tipo, valor] = i.values[0].split(':');
          S.f = {}; S.pag = 0;
          S.base = tipo === 'esp' ? { especial: valor } : tipo === 'ori' ? { origem: valor } : { secao: valor };
          return mostrarLista();
        }
        if (id === 'tpl_sel_template') { S.slug = i.values[0]; S.envioId = null; S.pv = { view: 'visao', catIdx: 0, pagArvore: 0 }; return mostrarPreview(); }
        if (id === 'tpl_sel_cat') { S.pv = { ...S.pv, view: 'cat', catIdx: parseInt(i.values[0], 10) || 0 }; return mostrarPreview(); }
        if (id === 'tpl_sel_hist') { const e = store.getEntradaHistorico(guild.id, i.values[0]); S.view = 'hist'; return e ? render(ui.historicoDetalhe({ e })) : mostrarHistorico(); }
        if (id === 'tpl_sel_envio') {
          if (!ehRevisor) return;
          S.envioId = i.values[0]; S.pv = { view: 'visao', catIdx: 0, pagArvore: 0 };
          return mostrarPreview();
        }
        if (id.startsWith('tpl_f_') && i.values) {
          const v = i.values[0] === '-' ? undefined : i.values[0];
          const campo = { tpl_f_secao: 'secao', tpl_f_estilo: 'estilo', tpl_f_origem: 'origem', tpl_f_ordem: 'ordem' }[id];
          if (campo) { S.f = { ...S.f, [campo]: v }; return mostrarFiltros(); }
        }

        // ── botões ──
        if (id.startsWith('tpl_desf_ok_')) return desfazerAplicacao(id.slice('tpl_desf_ok_'.length));
        if (id.startsWith('tpl_desf_')) {
          const e = store.getEntradaHistorico(guild.id, id.slice('tpl_desf_'.length));
          if (!e || !e.criados || e.desfeito) return render(ui.simples('Desfazer', 'Esta aplicação não pode mais ser desfeita.', ui.COR.aviso, [ui.btn('tpl_historico', '◀ Histórico')]));
          return render(ui.desfazerConfirmar({ e }));
        }
        switch (id) {
          case 'tpl_home': S.envioId = null; return mostrarHome();
          case 'tpl_filtros': return mostrarFiltros();
          case 'tpl_f_limpar': S.f = {}; return mostrarFiltros();
          case 'tpl_f_ver': S.base = {}; S.pag = 0; return mostrarLista();
          case 'tpl_pg_ant': S.pag = Math.max(0, S.pag - 1); return mostrarLista();
          case 'tpl_pg_prox': S.pag += 1; return mostrarLista();
          case 'tpl_voltar': return mostrarLista();
          case 'tpl_v_visao': S.pv.view = 'visao'; return mostrarPreview();
          case 'tpl_v_arvore': S.pv = { ...S.pv, view: 'arvore', pagArvore: 0 }; return mostrarPreview();
          case 'tpl_v_perms': S.pv.view = 'perms'; return mostrarPreview();
          case 'tpl_arv_ant': S.pv.pagArvore = Math.max(0, S.pv.pagArvore - 1); return mostrarPreview();
          case 'tpl_arv_prox': S.pv.pagArvore += 1; return mostrarPreview();
          case 'tpl_fav': {
            const r = store.alternarFavorito(guild.id, user.id, S.slug);
            if (r.cheio) await i.followUp({ content: `⭐ Você atingiu o limite de ${store.MAX_FAVORITOS} favoritos. Remova algum para adicionar outro.`, flags: eph }).catch(() => {});
            return mostrarPreview();
          }
          case 'tpl_aplicar': S.opcoes = { permitirAdmin: false, duplicar: false }; return verificar();
          case 'tpl_t_admin': S.opcoes.permitirAdmin = !S.opcoes.permitirAdmin; return verificar();
          case 'tpl_t_dup': S.opcoes.duplicar = !S.opcoes.duplicar; return verificar();
          case 'tpl_reverificar': return verificar();
          case 'tpl_cancelar': return S.envioId ? mostrarRevisao() : mostrarPreview();
          case 'tpl_confirmar': return aplicarTemplate();
          case 'tpl_historico': return mostrarHistorico();
          case 'tpl_enviar': return mostrarEnviar();
          case 'tpl_exportar': {
            const json = submit.exportarServidor(guild);
            const arq = new AttachmentBuilder(Buffer.from(JSON.stringify(json, null, 2), 'utf8'), { name: 'template-do-servidor.json' });
            await i.followUp({
              content: 'Estrutura do seu servidor (somente cargos, categorias, canais e permissões — sem membros, mensagens ou convites).\nEdite `nome`, `descricao`, `secao` e defina `"declaracao": true` se você tem o direito de compartilhar. Depois envie com `/template arquivo:`.',
              files: [arq], flags: eph,
            }).catch(() => {});
            return undefined;
          }
          case 'tpl_revisao': if (!ehRevisor) return undefined; return mostrarRevisao();
          case 'tpl_rev_aprovar': if (!ehRevisor) return undefined; return aprovarEnvio();
          default: return undefined;
        }
      } catch (err) {
        ocupado = false;
        console.error('[Kael Templates] Erro no painel:', err);
        if (!i.replied && !i.deferred) await i.reply({ content: 'Erro ao processar essa ação. Tente novamente.', flags: eph }).catch(() => {});
      }
    });

    collector.on('end', () => {
      ultima.editReply({ components: ui.simples('Painel encerrado', 'Painel encerrado por inatividade. Use **/template** para abrir novamente.', ui.COR.neutro) }).catch(() => {});
    });
  },
};
