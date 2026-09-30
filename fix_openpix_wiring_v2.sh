#!/usr/bin/env bash
set -e
echo "Reaplicando a rota dos botoes openpix_ (nao estava no seu projeto)..."

cat > events/buttonHandler.js << 'KRON_EOF_BTNHANDLER2'
const { ActionRowBuilder, EmbedBuilder } = require("discord.js");
const ticketManager  = require('../ticket-system/ticketManager');
const salesManager   = require('../sales-system/salesManager');
const produtoHandler = require('../commands/produto');
const db             = require("../database/db");
const { getNome, temPlanoMinimo } = require("../utils/helpers");
const rendimentos    = require('../commands/rendimentos');
const definicoes     = require('../commands/definicoes');
const acoesAuto      = require('../commands/acoesAuto');
const sorteioManager = require('../sorteio-system/sorteioManager');
const { Manager: protectionManager } = require('../protectionSystem');
const backupManager   = require('../backup-system/backupManager');
const cupomManager    = require('../cupom-system/cupomManager');
const efiBankManager  = require('../efi-system/efiBankManager');
const c6BankManager   = require('../c6-system/c6BankManager');
const openPixManager  = require('../openpix-system/openPixManager');
const rankingCommand  = require('../commands/ranking');
const configExportManager = require('../backup-system/configExportManager');
const licenseCommand = require('../commands/license');
const boasVindas     = require('../commands/boasVindas');
const personalizacaoBot = require('../commands/personalizacaoBot');

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    const guild    = interaction.guild;
    const userId   = interaction.user.id;
    const customId = interaction.customId;

    // ── GATE DE PLANO (botões do /painel que não têm slash command próprio) ──
    // Retorna true (e já responde ao usuário) se o servidor não tem o plano mínimo exigido.
    async function bloqueadoPorPlano(minimo, nomeRecurso) {
      if (temPlanoMinimo(guild?.id, minimo)) return false;
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription(`> **${nomeRecurso}** exige o plano **${minimo}** ou superior.\n> Faça upgrade para liberar.`)],
        ephemeral: true,
      });
      return true;
    }

    // ── SISTEMA DE LICENÇAS (/ativar → botões Ativar/Recusar + modal de recusa) ──
    // Observação: os botões chegam via DM do dono do bot, então não há `interaction.guild` aqui.
    if (customId?.startsWith('license_modal_recusar_')) {
      if (interaction.isModalSubmit()) return require('../commands/ativar').handleModal(interaction);
    }
    if (customId?.startsWith('license_ativar_') || customId?.startsWith('license_recusar_')) {
      if (interaction.isButton()) return require('../commands/ativar').handleButton(interaction);
    }

    // ── CARTEIRA (KRON PRO) — migrada da source antiga, reaproveitando
    // o mesmo banco (database/carteiraDB.js) já usado pela Parte 1. ──
    if (customId === 'carteira_menu' || customId === 'modal_pix_chave' || customId?.startsWith('carteira_')) {
      const { handleCarteira } = require('../handlers/carteiraHandler');
      const tratado = await handleCarteira(interaction);
      if (tratado) return;
    }

    // ── BOTÕES DA DM DE ENTREGA (feedback, copiar entrega, etc.) ──
    if (customId?.startsWith('dm_')) {
      if (interaction.isButton()) return require('../sales-system/entregaDM').handleButtonDM(interaction);
    }

    // ── EXPORTAR / IMPORTAR CONFIGURAÇÕES ──
    if (customId?.startsWith('cfg_')) {
      if (interaction.isButton()) return configExportManager.handleButton(interaction);
    }

    // -- KRON INVITE SYSTEM --
    if (customId?.startsWith('invite_')) {
      const inviteCommand = require('../commands/invite');

      // Botões fixos do painel público (Confirmar/Copiar/Meus/Ranking)
      if (interaction.isButton()) {
        switch (customId) {
          case inviteCommand.CUSTOM_IDS.CONFIRMAR: return inviteCommand.handleConfirmar(interaction);
          case inviteCommand.CUSTOM_IDS.COPIAR:    return inviteCommand.handleCopiar(interaction);
          case inviteCommand.CUSTOM_IDS.MEUS:      return inviteCommand.handleMeus(interaction);
          case inviteCommand.CUSTOM_IDS.RANKING:   return inviteCommand.handleRanking(interaction);
        }
        if (customId.startsWith('invite_ranking_page_')) return inviteCommand.handleRanking(interaction);
      }

      // Painel administrativo (/invite setup) — botões, selects e modais
      if (customId.startsWith('invite_setup_') || customId.startsWith('invite_modal_') ||
          customId.startsWith('invite_reward_') || customId.startsWith('invite_campaign_')) {
        return require('../invite-system/inviteSetupUI').handleInteraction(interaction);
      }
      return;
    }

    // ── <:xpooo:1523791736948920433> ATUALIZAR PAINEL (genérico, vale pra qualquer painel registrado) ──
    if (customId?.startsWith('painel_refresh::')) {
      return require('../utils/painelUpdater').handleBotaoAtualizar(interaction);
    }

    // ── TICKETS ──
    if (customId?.startsWith('tkt_') || customId?.startsWith('modal_tkt_')) {
      if (interaction.isButton())       return ticketManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return ticketManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())  return ticketManager.handleModal(interaction);
    }

    // ── AÇÕES AUTOMÁTICAS — modais (antes do isButton check) ──
        if (customId === 'AcoesModal_Repostagem' || customId === 'AcoesModal_Limpeza' || customId === 'AcoesModal_Mensagens') {
      if (interaction.isModalSubmit()) return acoesAuto.handleModal(interaction);
    }


    if (customId?.startsWith('DefSelect') || customId?.startsWith('DefAlterar') || customId === 'DefSelectBancos') {
      if (interaction.isAnySelectMenu()) return definicoes.handleSelectMenu(interaction);
    }
    if (customId === 'DefModal_AntiFake' || customId === 'DefModal_MercadoPago') {
      if (interaction.isModalSubmit()) return definicoes.handleModal(interaction);
    }

    // ── PAINEL DE PRODUTO ──
    const customIdsProdutoExatos = new Set([
      'prod_menu_criar_loja', 'prod_menu_produtos', 'prod_menu_pagamentos', 'prod_painel_voltar',
      'prod_pag_pix', 'prod_pag_canal', 'prod_pag_canal_entregas',
      // BUGFIX: 'prod_pag_canal_repostagem' nunca tinha sido cadastrado aqui
      // — o clique sempre caía no fallback genérico 'prod_' mais abaixo e
      // ia pro salesManager (legado), que não reconhece esse customId.
      'prod_pag_canal_repostagem',
      // Canal de Avaliações (botão "Ver Feedbacks" do comprovante manda o
      // cliente pra cá quando configurado): botão + seletor de produto
      // (quando há mais de 1 produto) são customIds exatos; o seletor de
      // canal em si tem produtoId dinâmico no final, por isso vai na lista
      // de prefixos (startsWith) mais abaixo, junto com os outros 'prod_sel_*'.
      'prod_pag_canal_avaliacao', 'prod_sel_produto_para_canal_avaliacao',
      'loja_selecionar_postar_produto', 'prod_sel_canal_confirmacao',
      'prod_modal_pix',
      'prod_novo_produto', 'prod_sel_produto_ativo', 'prod_trocar_produto',
      'prod_sel_produto_para_canal_entregas',
      // BUGFIX: 'prod_sel_canal_repostagem' nunca tinha sido cadastrado aqui
      // (mesmo tipo de bug do 'prod_pag_canal_repostagem' acima) — o botão
      // "Canal de Repostagem" abria o select normalmente, mas ao ESCOLHER
      // o canal a interação nunca chegava no produto.js e dava timeout.
      'prod_sel_canal_repostagem',
      'cancelar_confirmacao_compra',
      'prod_menu_mensagem_posvenda',
    ]);
    const isProdutoMenu =
      customIdsProdutoExatos.has(customId) ||
      customId?.startsWith('cliente_comprar_variante') ||
      customId?.startsWith('cliente_comprar_direto_') ||
      customId?.startsWith('confirmar_compra::') ||
      customId?.startsWith('prod_var_') ||
      customId?.startsWith('prod_editar_titulo_') ||
      customId?.startsWith('prod_editar_descricao_') ||
      customId?.startsWith('prod_editar_preco_') ||
      // Canal de Avaliações: seletor de canal com produtoId dinâmico no
      // final do customId (mesmo padrão do 'prod_sel_canal_entregas_' logo
      // abaixo) — sem esta linha, o clique ia pro salesManager (legado).
      customId?.startsWith('prod_sel_canal_avaliacao_') ||
      // BUGFIX (auditoria): "prod_editar_banner_" foi separado em dois
      // customIds distintos — "prod_editar_banner_img_" (Banner, imagem
      // grande) e "prod_editar_thumbnail_" (Thumbnail, imagem pequena).
      // Sem estas duas entradas, os novos botões cairiam no fallback
      // genérico "prod_" mais abaixo e seriam enviados ao salesManager
      // (legado), que não reconhece esses customIds.
      customId?.startsWith('prod_editar_banner_img_') ||
      customId?.startsWith('prod_editar_thumbnail_') ||
      customId?.startsWith('prod_editar_footer_') ||
      customId?.startsWith('prod_cor_botao_') ||
      customId?.startsWith('prod_sel_cor_botao_') ||
      // Cor da Embed (barra lateral do embed da vitrine): botão abre modal,
      // customId com produtoId dinâmico — mesmo padrão dos outros 'prod_'.
      customId?.startsWith('prod_cor_embed_') ||
      customId?.startsWith('prod_estoque_add_') ||
      customId?.startsWith('prod_estoque_ver_') ||
      customId?.startsWith('prod_estoque_limpar_') ||
      customId?.startsWith('prod_btn_cargo_') ||
      customId?.startsWith('prod_btn_variantes_') ||
      customId?.startsWith('prod_voltar_painel_produto_') ||
      customId?.startsWith('prod_variante_add_') ||
      customId?.startsWith('prod_variante_editar_') ||
      customId?.startsWith('prod_sel_variante_editar_') ||
      customId?.startsWith('prod_variante_remover_') ||
      customId?.startsWith('prod_deletar_confirm_') ||
      // BUGFIX (auditoria - Bug 1): faltava o prefixo do botão "Sim, apagar"
      // (criado em commands/produto.js após o clique em prod_deletar_confirm_).
      // Sem esta linha, o clique caía no bloco genérico 'prod_' mais abaixo
      // e era enviado para o salesManager (legado), que não reconhece esse
      // customId — a exclusão de produto nunca era executada.
      customId?.startsWith('prod_deletar_executar_') ||
      customId?.startsWith('prod_sel_canal_entregas_') ||
      customId?.startsWith('prod_canalentrega_escolher_') ||
      customId?.startsWith('prod_modal_editar_titulo_') ||
      customId?.startsWith('prod_modal_editar_descricao_') ||
      customId?.startsWith('prod_modal_editar_preco_') ||
      customId?.startsWith('prod_modal_editar_banner_img_') ||
      customId?.startsWith('prod_modal_editar_thumbnail_') ||
      customId?.startsWith('prod_modal_editar_footer_') ||
      customId?.startsWith('prod_modal_cor_embed_') ||
      customId?.startsWith('prod_modal_mensagem_posvenda_') ||
      customId?.startsWith('prod_modal_cargo_') ||
      customId?.startsWith('prod_modal_estoque_add_') ||
      customId?.startsWith('prod_modal_variante_add_') ||
      customId?.startsWith('prod_modal_variante_editar_') ||
      customId?.startsWith('prod_modal_variante_remover_') ||
      // BUGFIX (sessão de Regras Avançadas): estes customIds foram criados
      // em commands/produto.js (atalho de cupons, preço de/por, condições
      // de compra, cargos bloqueados/pós-compra, assinatura) mas nunca
      // foram adicionados a esta lista branca — o clique nunca chegava a
      // lugar nenhum e o Discord mostrava "Esta interação falhou".
      customId?.startsWith('prod_atalho_cupons_') ||
      customId?.startsWith('prod_btn_avancado_') ||
      customId?.startsWith('prod_modal_precocomp_') ||
      customId?.startsWith('prod_modal_condicoes_') ||
      customId?.startsWith('prod_sel_cargobloq_') ||
      customId?.startsWith('prod_sel_cargospos_add_') ||
      customId?.startsWith('prod_sel_cargospos_rem_') ||
      customId?.startsWith('prod_roleselect_cargobloq_') ||
      customId?.startsWith('prod_roleselect_cargospos_add_') ||
      customId?.startsWith('prod_roleselect_cargospos_rem_') ||
      customId?.startsWith('prod_toggle_assinatura_') ||
      customId?.startsWith('prod_modal_assinatura_');

    if (isProdutoMenu) {
      if (interaction.isButton())       return produtoHandler.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return produtoHandler.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())  return produtoHandler.handleModal(interaction);
    }

    // ── SORTEIOS ──
    if (
      customId === 'painel_sorteios' ||
      customId?.startsWith('srt_')
    ) {
      if (customId === 'painel_sorteios' && await bloqueadoPorPlano("PREMIUM", "Sorteios")) return;
      if (interaction.isButton())        return sorteioManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return sorteioManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())   return sorteioManager.handleModal(interaction);
    }

    // ── SISTEMA DE PROTEÇÃO ──
    // Mesmo padrão do bloco SORTEIOS acima: intercepta antes de qualquer
    // outra checagem pois 'painel_protecao' e os customIds 'prot_*' não
    // devem colidir com nada mais no roteamento abaixo.
    if (
      customId === 'painel_protecao' ||
      customId?.startsWith('prot_')
    ) {
      if (customId === 'painel_protecao' && await bloqueadoPorPlano("PREMIUM", "Proteção")) return;
      if (interaction.isButton())        return protectionManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return protectionManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())   return protectionManager.handleModal(interaction);
    }

    // ── BACKUP & RESTAURAÇÃO DE SERVIDOR ──
    // Mesmo padrão dos blocos SORTEIOS/PROTEÇÃO acima. Prefixo 'bkp_' é
    // exclusivo deste sistema — não colide com o customId exato
    // 'painel_backup' (botão antigo de exportar estoque/config), que
    // continua funcionando normalmente mais abaixo neste arquivo.
    if (customId?.startsWith('bkp_')) {
      if (interaction.isButton())       return backupManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return backupManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())  return backupManager.handleModal(interaction);
    }

    // ── PAINEL DE LICENÇAS (/license painel) ──
    if (customId?.startsWith('lic_')) {
      if (interaction.isButton())      return licenseCommand.handleButton(interaction);
      if (interaction.isModalSubmit()) return licenseCommand.handleModal(interaction);
    }

    // ── EFI BANK (2º gateway de pagamento) ──
    if (customId?.startsWith('efi_')) {
      if (interaction.isButton())      return efiBankManager.handleButton(interaction);
      if (interaction.isModalSubmit()) return efiBankManager.handleModal(interaction);
    }

    if (customId?.startsWith('c6_')) {
      if (interaction.isButton())      return c6BankManager.handleButton(interaction);
      if (interaction.isModalSubmit()) return c6BankManager.handleModal(interaction);
    }

    // ── OPENPIX/WOOVI (painel de configuração /openpix — AppID, subconta, sandbox) ──
    if (customId?.startsWith('openpix_')) {
      if (interaction.isButton())      return openPixManager.handleButton(interaction);
      if (interaction.isModalSubmit()) return openPixManager.handleModal(interaction);
    }

    // ── BOAS VINDAS ──
    // (fica ANTES do gate "if (!interaction.isButton()) return;" logo abaixo,
    // porque BV_Modal_Mensagem/BV_Modal_Saida e BV_Canal_Select/BV_Cargo_Select
    // não são botões — cairiam nesse gate e seriam descartados em silêncio.)
    if (customId === 'painel_boasvindas') {
      return boasVindas.abrirBoasVindas(interaction);
    }
    if (customId?.startsWith('BV_')) {
      if (interaction.isButton())        return boasVindas.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return boasVindas.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())   return boasVindas.handleModal(interaction);
    }

    // ── SISTEMA DE SUGESTÕES (painel admin + botões públicos da sugestão) ──
    if (customId === 'painel_sugestoes') {
      return require('../sugestoes-system/sugestoesManager').abrirPainel(interaction);
    }
    if (customId?.startsWith('sug_')) {
      const sg = require('../sugestoes-system/sugestoesManager');
      if (interaction.isButton())        return sg.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return sg.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())   return sg.handleModal(interaction);
    }

    // ── SISTEMA DE VERIFICAÇÃO (painel admin + botão público) ──
    if (customId === 'painel_verificacao') {
      return require('../verificacao-system/verificacaoManager').abrir(interaction);
    }
    if (customId?.startsWith('vf_')) {
      const vf = require('../verificacao-system/verificacaoManager');
      if (interaction.isButton())        return vf.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return vf.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())   return vf.handleModal(interaction);
    }

    // ── PERSONALIZAÇÃO DO BOT (avatar/banner/bio por servidor) ──
    // (mesmo motivo acima: PB_Modal_Editar é modal, não botão.)
    if (customId === 'painel_personalizacao') {
      return personalizacaoBot.abrirPersonalizacao(interaction);
    }
    if (customId?.startsWith('PB_')) {
      if (interaction.isButton())      return personalizacaoBot.handleButton(interaction);
      if (interaction.isModalSubmit()) return personalizacaoBot.handleModal(interaction);
    }

    // ── CUPONS AVANÇADOS ──
    // Prefixo 'cup_' é exclusivo deste sistema — não colide com
    // 'prod_var_modal_cupom'/'prod_var_aplicar_cupom' (aplicação de cupom
    // no carrinho do cliente, que continua no bloco LOJA/PRODUTO abaixo).
    if (customId?.startsWith('cup_')) {
      if (interaction.isButton())       return cupomManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return cupomManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())  return cupomManager.handleModal(interaction);
    }

    // ── LOJA / VENDAS ──
    if (customId?.startsWith('loja_') || customId?.startsWith('prod_')) {
      if (interaction.isButton())       return salesManager.handleButton(interaction);
      if (interaction.isAnySelectMenu()) return salesManager.handleSelectMenu(interaction);
      if (interaction.isModalSubmit())  return salesManager.handleModal(interaction);
    }

    if (!interaction.isButton()) return;

    // ── PAINEL DE BOTÕES ADM / INTERFACE ──
    if (customId === 'painel_filas') {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('Filas').setDescription('As filas de matchmaking foram desativadas neste servidor.')], ephemeral: true });
      return;
    }
    if (customId === 'painel_comandos') {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('Comandos').setDescription('/painel /config /suporte')], ephemeral: true });
      return;
    }
    if (customId === 'painel_suporte') {
      const { StringSelectMenuBuilder } = require('discord.js');
      const guildData = db.getGuild(guild.id);
      const t = guildData.ticket || {};
      const thumb = guild.iconURL({ dynamic: true, size: 256 }) || client?.user?.displayAvatarURL({ size: 256 }) || null;
      const embedSup = new EmbedBuilder().setColor(0xFFFFFF).setTitle('🎫 | Atendimento VORTEX').setDescription('🎧 **Suporte:** Tire duvidas com nossa equipe\n<:dev:1525538335139958915> **Falar com ADM:** Reembolso ou pagamento\n🤝 **Parceria:** Faca parceria com a VORTEX\n<a:trofeu:1532499321008951538> **Vagas Mediador:** Garanta sua vaga\n\nCertifique-se de ja ter lido as **regras**.').setFooter({text:'VORTEX TICKET SYSTEM'}).setTimestamp();
      if (thumb) embedSup.setThumbnail(thumb);
      if (t.banner) embedSup.setImage(t.banner);
      const selectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('Selecione o tipo de suporte...').addOptions([{ label: 'Suporte', description: 'Tire duvidas com nossa equipe', emoji: '🎧', value: 'suporte' }, { label: 'Falar com ADM', description: 'Reembolso ou pagamento', emoji: '<:dev:1525538335139958915>', value: 'adm' }, { label: 'Parceria', description: 'Faca parceria com a VORTEX', emoji: '🤝', value: 'parceria' }, { label: 'Vagas Mediador', description: 'Garanta sua vaga como mediador', emoji: '<a:trofeu:1532499321008951538>', value: 'mediador' }]));
      await interaction.reply({ embeds: [embedSup], components: [selectRow], ephemeral: true });
      return;
    }
    if (customId === 'painel_pix') {
      const guildData = db.getGuild(guild.id);
      const pix = guildData.pix;
      if (!pix || !pix.chave) { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('PIX nao configurado').setDescription('Use: /config pix-chave')], ephemeral: true }); return; }
      const embedPix = new EmbedBuilder().setColor(0xFFFFFF).setTitle('Chave PIX').setDescription('Recebedor: ' + (pix.nome || 'Nao definido') + '\nChave: ' + pix.chave).setFooter({ text: 'VORTEX BOT' }).setTimestamp();
      if (pix.qrcode) embedPix.setImage(pix.qrcode);
      await interaction.reply({ embeds: [embedPix], ephemeral: true });
      return;
    }

    if (customId === 'painel_vendas')      return produtoHandler.enviarMenuPrincipal(interaction);
    if (customId === 'painel_ticket') {
      if (await bloqueadoPorPlano("BASICO", "Gerenciar Ticket")) return;
      return ticketManager.showAdminPanel(interaction);
    }

    // ── RENDIMENTOS ──
    if (customId === 'painel_rendimentos') {
      if (await bloqueadoPorPlano("PRO", "Ver Rendimento")) return;
      return rendimentos.abrirRendimentos(interaction);
    }
    if (customId === 'RendimentosVoltar' || customId.startsWith('VisualizarRendimento')) return rendimentos.handleButton(interaction);

    // ── AÇÕES AUTOMÁTICAS ──
    if (customId === 'painel_acoes_auto') {
      if (await bloqueadoPorPlano("PREMIUM", "Ações Automáticas")) return;
      return acoesAuto.abrirAcoesAuto(interaction);
    }
    if (
      customId === 'GerenciarAcoesAutomaticas'                      ||
      customId === 'AcoesAutoVoltar'                                ||
      customId.startsWith('AcessarRepostagemAcoesAuto')             ||
      customId.startsWith('AcessarLimpezaAcoesAuto')                ||
      customId.startsWith('AcessarMensagensAcoesAuto')              ||
      customId.startsWith('AtivarDesativarSistemaAcoesAuto_')       ||
      customId === 'ConfigurarSistemaRepostagem'                    ||
      customId === 'ConfigurarSistemaLimpeza'                       ||
      customId === 'ConfigurarSistemaMensagens'
    ) return acoesAuto.handleButton(interaction);

        if (customId === 'painel_definicoes') {
          if (await bloqueadoPorPlano("PRO", "Definições")) return;
          return definicoes.abrirDefinicoes(interaction);
        }
    if (
      customId === 'GerenciarPainelConfigurar' ||
      customId === 'Def_Voltar'               ||
      customId === 'DefBancosBloqueados'      ||
      customId === 'DefDocumentacaoFormasPag' ||
      customId === 'ConfigurarSistemaMP'      ||
      customId === 'HabilitarDesabilitarSistemaPagamento_MP' ||
      customId.startsWith('Def_')             ||
      customId.startsWith('DefRemoverCanal_') ||
      customId.startsWith('DefCriarCanal_')   ||
      customId.startsWith('DefRemoverCargo_') ||
      customId.startsWith('DefCriarCargo_')   ||
      customId.startsWith('DefFormasPag_')
    ) return definicoes.handleButton(interaction);

    if (customId === 'painel_estoque')    { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('<:caixa:1524207165496099007> Estoque').setDescription('Use `/produto criar` e clique em **Adicionar Estoque** para gerenciar itens.')], ephemeral: true }); return; }
    if (customId === 'painel_cupons')     { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('<:cupom:1524209015008002148> Cupons').setDescription('Use `/produto cupom criar` para adicionar cupons de desconto.')], ephemeral: true }); return; }
    if (customId === 'painel_variantes')  { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('<:config2:1524208021071462533> Variantes').setDescription('Use `/produto variante criar` para adicionar variantes ao produto.')], ephemeral: true }); return; }
    if (customId === 'painel_estatisticas') {
      const guildData = db.getGuild(guild.id); const loja = guildData.loja || {};
      const produtos = db.getProdutos(guild.id);
      const estoqueTotal   = produtos.reduce((acc, p) => acc + (p.estoque   || []).length, 0);
      const variantesTotal = produtos.reduce((acc, p) => acc + (p.variantes || []).length, 0);
      const cuponsTotal    = produtos.reduce((acc, p) => acc + Object.keys(p.cupons || {}).length, 0);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('<:rendimentos:1528401542070145135> Estatísticas').addFields({ name: '<:carrinho:1524207445600370719> Vendas Totais', value: `\`${loja.vendas || 0}\``, inline: true }, { name: '<:caixa:1524207165496099007> Estoque Atual', value: `\`${estoqueTotal}\``, inline: true }, { name: '<:config2:1524208021071462533> Variantes', value: `\`${variantesTotal}\``, inline: true }, { name: '<:cupom:1524209015008002148> Cupons Ativos', value: `\`${cuponsTotal}\``, inline: true }, { name: '🏬 Produtos', value: `\`${produtos.length}\``, inline: true }).setFooter({ text: getNome(guild) }).setTimestamp()], ephemeral: true }); return;
    }
    if (customId === 'painel_deletar')  { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('<:apagar:1524206738885050388> Deletar Produto').setDescription('Use `/produto criar` e clique em **Deletar Produto** para remover o produto.')], ephemeral: true }); return; }
    if (customId === 'painel_status') {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('💚 Status do Bot').addFields({ name: '🌐 Servidor', value: `\`${guild.name}\``, inline: true }, { name: '👥 Membros', value: `\`${guild.memberCount}\``, inline: true }, { name: '📡 Ping', value: `\`${client.ws.ping}ms\``, inline: true }, { name: '<:online:1533081467918221565> Status', value: '`Online`', inline: true }, { name: '<:config3:1524208114327617588> Versão', value: '`Discord.js v14`', inline: true }, { name: '🔑 Licença', value: '`<:positivo:1528401238197276702> Ativa`', inline: true }).setFooter({ text: getNome(guild) }).setTimestamp()], ephemeral: true }); return;
    }
    if (customId === 'painel_backup') { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFFFFF).setTitle('💾 Backup').setDescription('Use **Configurar Loja → Exportar/Importar Configurações** para fazer backup ou restaurar todas as configurações do bot.')], ephemeral: true }); return; }
    if (customId === 'painel_backup_servidor') return backupManager.showAdminPanel(interaction);
    if (customId === 'painel_cupom')           return cupomManager.showAdminPanel(interaction);
    if (customId === 'painel_efibank')         return efiBankManager.showPainel(interaction);
    if (customId === 'painel_ranking') return rankingCommand.execute(interaction);

    // NOTA: a v2 do /ranking (layout horizontal) é self-contida — usa um
    // collector próprio na mensagem, com timeout e checagem de usuário,
    // em vez de depender do roteamento global daqui. Por isso a rota
    // antiga de 'rank_' foi removida (chamava rankingCommand.handleButton,
    // que não existe mais nessa versão — deixá-la causaria erro duplo
    // toda vez que alguém clicasse num botão do ranking).
    if (customId === 'painel_apagar') {
      try {
        await interaction.message.delete();
      } catch (error) {
        console.error('Erro ao apagar o painel:', error);
        try { await interaction.reply({ content: '<:apagar:1524206738885050388> Painel apagado ou sem permissão para deletar.', ephemeral: true }); } catch (e) {}
      }
      return;
    }
  }
};
KRON_EOF_BTNHANDLER2
echo "  ok: events/buttonHandler.js"

echo "Pronto. Reinicie o bot e teste os botoes do /openpix."
