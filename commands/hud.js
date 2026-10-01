'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KAEL — /hud
// Salva a estrutura do servidor (cargos, categorias, canais e permissões) e
// restaura tudo se alguém destruir (nukear) o servidor.
// Só o dono do servidor (ou o dono do bot) consegue usar.
// ═══════════════════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const hud = require('../utils/hudBackup');
const { assetUrl } = require('../utils/assets');
const { BOT_OWNER_ID } = require('../config/constants');
const LEGADO = require('../config/emojis-legado.json');

const E = (nome, alt = '') => {
  const e = LEGADO.find(x => x.name === nome);
  return e ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : alt;
};

const TEMPO = 14 * 60 * 1000;

function quando(ts) {
  return `<t:${Math.floor(ts / 1000)}:d> às <t:${Math.floor(ts / 1000)}:t>`;
}

function rotulo(b) {
  const data = new Date(b.criadoEm);
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const hh = String(data.getHours()).padStart(2, '0');
  const mi = String(data.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi} • ${b.canais} canais • ${b.tipo === 'auto' ? 'automático' : 'manual'}`;
}

function botao(id, texto, emoji, estilo = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(texto).setStyle(estilo);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function linhaTexto(c, texto) {
  return c.addTextDisplayComponents(new TextDisplayBuilder().setContent(texto));
}

function separador(c) {
  return c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
}

function resumoRelatorio(r) {
  if (r.erroGeral) return `${E('negativo', '❌')} Não consegui concluir: ${r.erroGeral}`;
  if (r.membros !== undefined) {
    const linhas = [
      `${E('positivo', '✅')} **${r.membros}** membros receberam **${r.cargosDados}** cargos de volta.`,
      r.ausentes ? `${r.ausentes} membros do backup não estão mais no servidor.` : '',
    ].filter(Boolean);
    if (r.erros.length) linhas.push(`\n**Falhas (${r.erros.length}):**\n` + r.erros.slice(0, 6).map(x => `• ${x}`).join('\n'));
    return linhas.join('\n');
  }
  const linhas = [
    `${E('positivo', '✅')} **Restauração concluída** (${r.modo === 'tudo' ? 'tudo' : 'só o que faltava'})`,
    `Cargos: **${r.cargosCriados}** criados • ${r.cargosExistentes} já existiam`,
    `Canais: **${r.canaisCriados}** criados • ${r.canaisExistentes} já existiam`,
  ];
  if (r.modo === 'tudo') linhas.push(`Itens corrigidos: **${r.ajustados}**`);
  if (r.erros.length) {
    linhas.push(`\n**Falhas (${r.erros.length}):**\n` + r.erros.slice(0, 6).map(x => `• ${x}`).join('\n'));
    if (r.erros.length > 6) linhas.push(`…e mais ${r.erros.length - 6}.`);
  }
  return linhas.join('\n');
}

function montar(estado, guild) {
  const c = new ContainerBuilder().setAccentColor(0x000000);
  const lista = hud.listar(guild.id);
  const auto = hud.getAuto(guild.id);
  const banner = assetUrl('kael-banner.png');

  linhaTexto(c, `# ${E('safety', '🛡️')} Kael HUD\nSalva **cargos, categorias, canais e permissões** do servidor. Se alguém destruir tudo, é só restaurar por aqui.`);
  if (banner && estado.view === 'home') {
    separador(c);
    c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)));
  }
  separador(c);

  if (estado.view === 'home') {
    const u = lista[0];
    linhaTexto(c,
      (u
        ? `**Último backup:** ${quando(u.criadoEm)}\n${u.cargos} cargos • ${u.categorias} categorias • ${u.canais} canais • ${u.membros} membros com cargo`
        : 'Nenhum backup salvo ainda. Toque em **Salvar agora**.') +
      `\n**Backup automático:** ${auto.ativo ? `ligado (a cada ${auto.horas}h)` : 'desligado'}` +
      (estado.aviso ? `\n\n${estado.aviso}` : ''));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      botao('hud:salvar', 'Salvar agora', E('save', '💾')),
      botao('hud:lista', 'Backups e restaurar', E('folder', '📁')),
      botao('hud:auto', auto.ativo ? 'Desligar automático' : 'Ligar automático', E('clock', '⏱️')),
    ));
  } else if (estado.view === 'lista') {
    if (!lista.length) {
      linhaTexto(c, 'Nenhum backup salvo ainda.');
    } else {
      linhaTexto(c, '**Escolha um backup para ver ou restaurar:**');
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hud:sel')
          .setPlaceholder('Selecione um backup')
          .addOptions(lista.slice(0, 25).map(b => ({ label: rotulo(b), value: b.id }))),
      ));
    }
    c.addActionRowComponents(new ActionRowBuilder().addComponents(botao('hud:home', 'Voltar', E('voltar', '↩️'))));
  } else if (estado.view === 'detalhe') {
    const b = lista.find(x => x.id === estado.backupId);
    if (!b) {
      linhaTexto(c, 'Esse backup não existe mais.');
      c.addActionRowComponents(new ActionRowBuilder().addComponents(botao('hud:lista', 'Voltar', E('voltar', '↩️'))));
    } else {
      linhaTexto(c,
        `**Backup de** ${quando(b.criadoEm)} (${b.tipo === 'auto' ? 'automático' : 'manual'})\n` +
        `${b.cargos} cargos • ${b.categorias} categorias • ${b.canais} canais` +
        (b.membrosIncluidos ? ` • ${b.membros} membros com cargo` : ' • sem cargos dos membros') +
        `\n\n**Restaurar o que falta:** recria só o que sumiu. Não mexe no que existe.\n` +
        `**Restaurar tudo:** também corrige nome, permissões e ordem do que já existe.\n` +
        `Nada é apagado em nenhum dos dois.` +
        (estado.aviso ? `\n\n${estado.aviso}` : ''));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        botao('hud:rest_faltando', 'Restaurar o que falta', E('import1', '📥'), ButtonStyle.Success),
        botao('hud:rest_tudo', 'Restaurar tudo', E('import1', '📥')),
        botao('hud:rest_membros', 'Cargos dos membros', E('users', '👥')),
      ));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        botao('hud:apagar', 'Apagar backup', E('apagar', '🗑️'), ButtonStyle.Danger),
        botao('hud:lista', 'Voltar', E('voltar', '↩️')),
      ));
    }
  } else if (estado.view === 'confirmar') {
    const textos = {
      rest_faltando: '**Restaurar o que falta?**\nVou recriar cargos e canais que não existem mais. O que já existe não será alterado.',
      rest_tudo: '**Restaurar tudo?**\nVou recriar o que falta e também corrigir nome, permissões e ordem dos cargos e canais que já existem, inclusive as permissões do @everyone.',
      rest_membros: '**Devolver os cargos dos membros?**\nVou dar de volta os cargos que cada membro tinha no backup. Pode demorar em servidores grandes.',
      apagar: '**Apagar este backup?**\nIsso não pode ser desfeito.',
    };
    linhaTexto(c, textos[estado.acao] || 'Confirmar?');
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      botao('hud:ok', 'Confirmar', E('positivo', '✅'), estado.acao === 'apagar' ? ButtonStyle.Danger : ButtonStyle.Success),
      botao('hud:cancel', 'Cancelar', E('negativo', '❌')),
    ));
  } else if (estado.view === 'progresso') {
    linhaTexto(c, `${E('carregarAnimado', '⏳')} **Trabalhando…**\n${estado.progresso || ''}`);
  } else if (estado.view === 'resultado') {
    linhaTexto(c, resumoRelatorio(estado.relatorio || {}));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(botao('hud:home', 'Voltar ao início', E('voltar', '↩️'))));
  }
  return c;
}

const payload = (estado, guild) => ({ components: [montar(estado, guild)], flags: MessageFlags.IsComponentsV2 });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hud')
    .setDescription('Salva e restaura a estrutura do servidor (canais, cargos e permissões)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'Use este comando dentro de um servidor.', ephemeral: true });
    }
    const permitido = interaction.user.id === guild.ownerId || (BOT_OWNER_ID && interaction.user.id === BOT_OWNER_ID);
    if (!permitido) {
      return interaction.reply({
        content: `${E('negativo', '❌')} Só o **dono do servidor** pode usar o \`/hud\`. Isso impede que um administrador mal-intencionado apague ou restaure backups.`,
        ephemeral: true,
      });
    }

    const estado = { view: 'home', backupId: null, acao: null, relatorio: null, progresso: '', aviso: '' };

    const resposta = await interaction.reply({
      ...payload(estado, guild),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      withResponse: true,
    });
    const msg = (resposta && resposta.resource && resposta.resource.message) || await interaction.fetchReply();
    const coletor = msg.createMessageComponentCollector({ time: TEMPO, filter: i => i.user.id === interaction.user.id });

    async function executar(i, acao) {
      if (!hud.tentarTravar(guild.id)) {
        estado.view = 'detalhe';
        estado.aviso = `${E('negativo', '❌')} Já existe uma operação em andamento neste servidor. Aguarde terminar.`;
        return i.editReply(payload(estado, guild));
      }
      estado.view = 'progresso';
      estado.progresso = 'Iniciando…';
      await i.editReply(payload(estado, guild)).catch(() => {});

      let ultima = 0;
      const onProgress = async (texto) => {
        estado.progresso = texto;
        if (Date.now() - ultima < 3000) return;
        ultima = Date.now();
        await i.editReply(payload(estado, guild)).catch(() => {});
      };

      try {
        const snap = hud.carregar(guild.id, estado.backupId);
        estado.relatorio = acao === 'rest_membros'
          ? await hud.restaurarCargosMembros(guild, snap, { onProgress })
          : await hud.restaurar(guild, snap, { modo: acao === 'rest_tudo' ? 'tudo' : 'faltando', onProgress });
      } catch (e) {
        estado.relatorio = { erroGeral: String(e && e.message ? e.message : e).slice(0, 200) };
      } finally {
        hud.destravar(guild.id);
      }
      estado.view = 'resultado';
      await i.editReply(payload(estado, guild)).catch(() => {});
      interaction.user.send({ content: resumoRelatorio(estado.relatorio).slice(0, 1900) }).catch(() => {});
    }

    coletor.on('collect', async (i) => {
      try {
        estado.aviso = '';
        switch (i.customId) {
          case 'hud:home':
            estado.view = 'home';
            return await i.update(payload(estado, guild));
          case 'hud:lista':
            estado.view = 'lista';
            return await i.update(payload(estado, guild));
          case 'hud:sel':
            estado.backupId = i.values[0];
            estado.view = 'detalhe';
            return await i.update(payload(estado, guild));
          case 'hud:auto': {
            const atual = hud.getAuto(guild.id);
            hud.setAuto(guild.id, { ativo: !atual.ativo, ultimo: atual.ativo ? atual.ultimo : Date.now() });
            if (!atual.ativo && !hud.listar(guild.id).length) {
              await i.deferUpdate();
              if (hud.tentarTravar(guild.id)) {
                try {
                  hud.salvar(guild.id, await hud.capturar(guild), 'auto');
                } catch (_) { /* o agendador tenta de novo depois */ } finally { hud.destravar(guild.id); }
              }
              estado.view = 'home';
              return await i.editReply(payload(estado, guild));
            }
            estado.view = 'home';
            return await i.update(payload(estado, guild));
          }
          case 'hud:salvar': {
            await i.deferUpdate();
            if (!hud.tentarTravar(guild.id)) {
              estado.aviso = `${E('negativo', '❌')} Já existe uma operação em andamento. Aguarde terminar.`;
              return await i.editReply(payload(estado, guild));
            }
            try {
              const ultimo = hud.listar(guild.id)[0];
              const snap = await hud.capturar(guild);
              hud.salvar(guild.id, snap, 'manual');
              estado.aviso = `${E('positivo', '✅')} Backup salvo: **${snap.cargos.length}** cargos, **${snap.canais.length}** canais/categorias.` +
                (hud.parecendoDestruido(snap, ultimo) ? `\n⚠️ Este servidor tem bem menos canais que o backup anterior. Se foi atacado, **não apague os backups antigos**.` : '');
            } catch (e) {
              estado.aviso = `${E('negativo', '❌')} Não consegui salvar: ${String(e && e.message ? e.message : e).slice(0, 150)}`;
            } finally {
              hud.destravar(guild.id);
            }
            estado.view = 'home';
            return await i.editReply(payload(estado, guild));
          }
          case 'hud:rest_faltando':
          case 'hud:rest_tudo':
          case 'hud:rest_membros':
          case 'hud:apagar':
            estado.acao = i.customId.slice(4);
            estado.view = 'confirmar';
            return await i.update(payload(estado, guild));
          case 'hud:cancel':
            estado.view = estado.backupId ? 'detalhe' : 'home';
            return await i.update(payload(estado, guild));
          case 'hud:ok': {
            if (estado.acao === 'apagar') {
              hud.remover(guild.id, estado.backupId);
              estado.backupId = null;
              estado.view = 'lista';
              return await i.update(payload(estado, guild));
            }
            await i.deferUpdate();
            return await executar(i, estado.acao);
          }
          default:
            return undefined;
        }
      } catch (e) {
        console.error('[HUD] Erro no menu:', e && e.message ? e.message : e);
        try {
          if (!i.replied && !i.deferred) await i.reply({ content: 'Algo deu errado. Rode `/hud` de novo.', ephemeral: true });
        } catch (_) { /* interação expirada */ }
      }
    });

    coletor.on('end', async () => {
      try {
        const c = new ContainerBuilder().setAccentColor(0x000000);
        linhaTexto(c, `# ${E('safety', '🛡️')} Kael HUD\nEste menu expirou. Rode \`/hud\` de novo.`);
        await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      } catch (_) { /* mensagem já expirou */ }
    });
  },
};
