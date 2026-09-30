const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelSelectMenuBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType, AttachmentBuilder
} = require('discord.js');
const db = require('../database/db');
const configExportManager = require('../backup-system/configExportManager');
const { registrar, atualizar, criarBotaoAtualizar } = require('../utils/painelUpdater');
const QRCode = require('qrcode');
let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch (e) { console.error('[QR Code] @napi-rs/canvas indisponível, usando fallback sem logo:', e.message); }

// ─── CORES ──────────────────────────────────────────────────────
const COR = { primary: "#FFFFFF", gold: 0xFFD700, success: 0x00FF7F, danger: 0xFF4444, dark: 0x23272a };

// ─── FOOTER PADRÃO (ícone do servidor + nome) ──────────────────
// Usado em TODAS as embeds — painel admin e fluxo de cliente.
// Nunca usar imagem fixa (KRON_IMG) aqui — sempre o ícone real do servidor.
function footerLoja(guild) {
  const iconURL = guild?.iconURL ? (guild.iconURL({ extension: 'png', size: 256 }) || undefined) : undefined;
  return { text: guild?.name || 'Loja', iconURL };
}
function iconGuild(guild) {
  return guild?.iconURL ? (guild.iconURL({ extension: 'png', size: 256 }) || undefined) : undefined;
}

// ─── QR CODE COM LOGO ──────────────────────────────────────────
async function gerarQrCodeComLogo(copiaECola, logoUrl) {
  const SIZE = 500;
  const qrBuffer = await QRCode.toBuffer(copiaECola, {
    type: 'png', width: SIZE, margin: 2, errorCorrectionLevel: 'H',
  });
  if (!canvasLib) return qrBuffer;
  try {
    const { createCanvas, loadImage } = canvasLib;
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const qrImg = await loadImage(qrBuffer);
    ctx.drawImage(qrImg, 0, 0, SIZE, SIZE);
    if (logoUrl) {
      const logoTamanho = Math.round(SIZE * 0.22);
      const centro = SIZE / 2;
      const raioFundo = logoTamanho / 2 + 10;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centro, centro, raioFundo, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      try {
        const logoImg = await loadImage(logoUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(centro, centro, logoTamanho / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(logoImg, centro - logoTamanho / 2, centro - logoTamanho / 2, logoTamanho, logoTamanho);
        ctx.restore();
      } catch (e) { console.error('[QR Code] Falha ao carregar logo:', e.message); }
    }
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[QR Code] Falha no canvas:', e.message);
    return qrBuffer;
  }
}

// ─── GERADOR DE PIX ESTÁTICO ───────────────────────────────────
function emvCrc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function gerarPixEstatico(chave, valor, beneficiario, cidade) {
  if (!chave || typeof chave !== 'string' || chave.trim().length === 0)
    throw new Error('gerarPixEstatico: chave PIX ausente ou inválida.');
  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0)
    throw new Error(`gerarPixEstatico: valor inválido (recebido: ${JSON.stringify(valor)}).`);
  const f = (id, valorStr) => id + valorStr.length.toString().padStart(2, '0') + valorStr;
  const merchantAccountInfo = f('00', 'BR.GOV.BCB.PIX') + f('01', chave.trim());
  const totalValor = valorNum.toFixed(2);
  const nomeBeneficiario = (beneficiario || 'LOJA').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().slice(0, 25) || 'LOJA';
  const cidadeBeneficiario = (cidade || 'SAO PAULO').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().slice(0, 15) || 'SAO PAULO';
  let payload =
    f('00', '01') + f('01', '12') + f('26', merchantAccountInfo) +
    f('52', '0000') + f('53', '986') + f('54', totalValor) +
    f('58', 'BR') + f('59', nomeBeneficiario) + f('60', cidadeBeneficiario) + f('62', '0503***');
  payload += '6304';
  const payloadFinal = payload + emvCrc16(payload);
  if (payloadFinal.includes('NaN') || payloadFinal.includes('undefined'))
    throw new Error('gerarPixEstatico: payload contém valores inválidos.');
  const payloadSanitizado = payloadFinal.trim();
  for (const ch of payloadSanitizado) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7E)
      throw new Error(`gerarPixEstatico: caractere inválido no payload (code ${code}).`);
  }
  return payloadSanitizado;
}

function getProximoNumeroPedido(guildId) {
  const loja = getLoja(guildId);
  const atual = typeof loja.proximoPedido === 'number' ? loja.proximoPedido : 1;
  db.updateGuild(guildId, 'loja.proximoPedido', atual + 1);
  return atual;
}

// ─── HELPERS DO BANCO DE DADOS ─────────────────────────────────
function getLoja(guildId) {
  try { return db.getGuild(guildId)?.loja || {}; } catch { return {}; }
}
// Checagem única de disponibilidade de pagamento. Mercado Pago tem
// prioridade: quando habilitado e com Access Token salvo, o PIX manual
// (loja.pix.chave) deixa de ser necessário. O PIX manual continua
// funcionando normalmente como fallback para quem ainda o usa.
function pagamentoDisponivel(guildId) {
  const { getConfigMercadoPago } = require('../sales-system/mercadoPago');
  if (getConfigMercadoPago(guildId).habilitado) return true;
  const { getConfigC6Bank } = require('../sales-system/c6Bank');
  if (getConfigC6Bank(guildId).habilitado) return true;
  const { getConfigEfiBank } = require('../sales-system/efiBank');
  if (getConfigEfiBank(guildId).habilitado) return true;
  const { getConfigOpenPix } = require('../payment-system/openpix/openpixManager');
  if (getConfigOpenPix(guildId).habilitado) return true;
  return !!getLoja(guildId).pix?.chave;
}
function getProdutoAtivoId(guildId) {
  try { return db.getProdutoAtivoId(guildId); } catch { return null; }
}

// ─── VALIDAÇÃO DE CONDIÇÕES DE COMPRA ──────────────────────────
// Checa valor mínimo/máximo, quantidade mínima/máxima e cargo bloqueado
// configurados em produto.condicoes (Regras Avançadas). Produtos sem
// nenhuma condição configurada sempre passam (retorna ok:true).
function validarCondicoesCompra(produto, member, quantidade, valorTotal) {
  const cond = produto?.condicoes;
  if (!cond) return { ok: true };

  if (cond.cargosBloqueados?.length && member) {
    const temCargoBloqueado = cond.cargosBloqueados.some(cid => member.roles.cache.has(cid));
    if (temCargoBloqueado) return { ok: false, motivo: 'Você não tem permissão para comprar este produto.' };
  }
  if (cond.quantidadeMinima != null && quantidade < cond.quantidadeMinima) {
    return { ok: false, motivo: `A quantidade mínima para este produto é **${cond.quantidadeMinima}**.` };
  }
  if (cond.quantidadeMaxima != null && quantidade > cond.quantidadeMaxima) {
    return { ok: false, motivo: `A quantidade máxima para este produto é **${cond.quantidadeMaxima}**.` };
  }
  if (cond.valorMinimo != null && valorTotal < cond.valorMinimo) {
    return { ok: false, motivo: `O valor mínimo de compra para este produto é **R$ ${cond.valorMinimo}**.` };
  }
  if (cond.valorMaximo != null && valorTotal > cond.valorMaximo) {
    return { ok: false, motivo: `O valor máximo de compra para este produto é **R$ ${cond.valorMaximo}**.` };
  }
  return { ok: true };
}

// ─── RESOLUÇÃO DE VARIANTE (COM FALLBACK PARA PREÇO BASE) ──────
// BUGFIX: antes, quando getVarianteByKey não encontrava nada (sempre o
// caso pra produtos SEM variantes, já que não existe entrada nenhuma em
// produto.variantes pra procurar), o código caía num fallback fixo
// { preco: '0,00' } — fazendo o valor do carrinho zerar ao trocar a
// quantidade. Agora, se não achar variante, busca o PREÇO BASE do
// próprio produto (produto.preco) antes de desistir.
function resolverVarianteOuBase(guildId, varianteKey, meta) {
  const { getVarianteByKey } = require('../sales-system/salesManager');
  const variante = getVarianteByKey(guildId, varianteKey);
  if (variante) return variante;

  const produto = meta?.produtoId ? db.getProdutoPorId(guildId, meta.produtoId) : null;
  if (produto) return { nome: produto.titulo || meta?.nomeItem || 'Produto', preco: produto.preco || '0.00', estoque: null };

  return { nome: meta?.nomeItem || 'Produto', preco: '0,00', estoque: null };
}

function getProduto(guildId) {
  try {
    const id = db.getProdutoAtivoId(guildId);
    return db.getProdutoPorId(guildId, id) || {};
  } catch { return {}; }
}
function formatarPrecoVariante(precoStr) {
  const { precoParaFloat, floatParaPreco } = require('../sales-system/salesManager');
  const valor = precoParaFloat(precoStr);
  return floatParaPreco(valor).replace('R$ ', '');
}

// Converte '<:nome:id>' ou '<a:nome:id>' (formato usado nos botões deste
// projeto) em {id, name, animated}, que é o formato que as OPTIONS de um
// StringSelectMenu precisam para renderizar o emoji de verdade — colar o
// texto '<:nome:id>' dentro de label/description não funciona, aparece cru.
function parseEmojiParaOption(valor) {
  if (!valor) return undefined;
  const m = String(valor).match(/^<(a)?:(\w+):(\d+)>$/);
  if (m) return { id: m[3], name: m[2], animated: !!m[1] };
  return valor; // emoji unicode (ex: 🍎) — funciona direto como string
}

// ─── URL DE IMAGEM → EMOJI DA VARIANTE ─────────────────────────
// O Discord não permite URL solta dentro de option de select menu — só
// emoji (unicode ou customizado). Pra permitir "colar uma URL de
// imagem" mesmo assim, o bot baixa a imagem e cria um EMOJI DA
// APLICAÇÃO (compartilhado entre todos os servidores que usam o bot,
// não conta na cota de emoji de cada guild) e guarda a referência
// <:nome:id> resultante — parseEmojiParaOption() já sabia ler esse
// formato antes mesmo desta mudança, então nada mais precisou mudar.
async function criarEmojiApartirDeUrl(client, url, nomeBase) {
  if (!/^https?:\/\//i.test(String(url).trim())) {
    throw new Error('A URL precisa começar com http:// ou https://');
  }
  if (!client.application) {
    throw new Error('Aplicação do bot ainda não está pronta — tente de novo em alguns segundos.');
  }
  const nomeSlug = String(nomeBase || 'img')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'img';
  const nomeFinal = `${nomeSlug}_${Date.now().toString(36).slice(-6)}`;
  const emoji = await client.application.emojis.create({ attachment: String(url).trim(), name: nomeFinal });
  return `<:${emoji.name}:${emoji.id}>`;
}

// Apaga o emoji de aplicação antigo quando a imagem de uma variante é
// trocada (best-effort — se falhar, não trava o resto do fluxo). Só
// mexe em valores que já estão no formato <:nome:id> criado por nós;
// não tenta apagar emoji unicode antigo (não tem o que apagar).
async function removerEmojiAppSeExistir(client, valorAntigo) {
  if (!valorAntigo || !client.application) return;
  const m = String(valorAntigo).match(/^<a?:(\w+):(\d+)>$/);
  if (!m) return;
  try { await client.application.emojis.delete(m[2]); } catch (e) { /* best-effort */ }
}

// ─── ESTOQUE REAL DO PRODUTO/VARIANTE ──────────────────────────
// Regra: quando o produto NÃO tem variantes, o estoque exibido é
// sempre o tamanho do array `produto.estoque` (itens colados no
// modal "Adicionar Estoque"). Quando tem variante, usa o campo
// numérico `variante.estoque` (null = ilimitado).
function getEstoqueProdutoSemVariante(produto) {
  const arr = produto?.estoque || [];
  return arr.length;
}
function textoEstoque(qtd) {
  return qtd === null || qtd === undefined ? '∞' : `${qtd}`;
}

// ─── VALIDACAO DE URL DE IMAGEM (Banner e Thumbnail) ───────────
// CORRECAO (auditoria): antes so existia validacao dentro do handler de
// banner. Agora e uma funcao compartilhada usada tanto por Banner quanto
// por Thumbnail, e reconhece corretamente:
//  - Links normais (Imgur, Imgbb, qualquer host externo com extensao de imagem)
//  - CDN do Discord (cdn.discordapp.com/attachments/... e media.discordapp.net)
//    * Com assinatura temporaria (?ex=...&is=...&hm=...) -> aceita, mas avisa
//      que o link expira.
//  - Attachments do Discord SEM extensao de imagem na URL (comum em anexos
//    do CDN que usam apenas um hash) -> aceita mesmo assim, pois o CDN do
//    Discord serve corretamente a imagem mesmo sem a extensao aparente.
function validarUrlImagem(urlDigitada) {
  const pareceUrl = /^https?:\/\//i.test(urlDigitada);
  if (!pareceUrl) {
    return { valido: false, mensagemErro: '> O texto enviado não é um link válido. A URL precisa começar com `http://` ou `https://`.' };
  }

  const ehCdnDiscord = /(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//i.test(urlDigitada);
  const temAssinaturaTemporaria = /[?&]ex=/i.test(urlDigitada) && /[?&]hm=/i.test(urlDigitada);
  const pareceImagem = /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(urlDigitada);

  // CDN do Discord com assinatura de expiração: aceita e salva, mas avisa
  // que o link pode parar de funcionar quando expirar.
  if (ehCdnDiscord && temAssinaturaTemporaria) {
    return {
      valido: true,
      aviso: '> Esse link é um anexo do Discord (`cdn.discordapp.com/attachments/...`) com uma assinatura temporária, que **expira automaticamente** depois de um tempo.\n> Quando expirar, a imagem vai aparecer quebrada na vitrine.\n> Recomendado: suba a imagem em um host permanente (Imgur, Imgbb, etc.) e use esse link.'
    };
  }

  // CDN do Discord sem assinatura (ou anexo permanente de emoji/attachment
  // direto): aceita normalmente, sem aviso — o CDN do Discord serve o
  // conteúdo corretamente mesmo quando a URL não termina em .png/.jpg.
  if (ehCdnDiscord) {
    return { valido: true };
  }

  // Qualquer outro host externo: aceita, mas avisa se a URL não parecer
  // apontar diretamente para um arquivo de imagem.
  if (!pareceImagem) {
    return {
      valido: true,
      aviso: '> O link não termina em `.png`, `.jpg`, `.gif` ou `.webp`. Se a imagem não aparecer na vitrine, confira se o link aponta direto para o arquivo da imagem (clique direito na imagem → Copiar endereço da imagem).'
    };
  }

  return { valido: true };
}

// ─── EMBEDS DO PAINEL ADMIN ────────────────────────────────────
function buildMenuPrincipalEmbed(guildId, guild) {
  const loja = getLoja(guildId);
  const pixChave = loja.pix?.chave || 'Não configurada';
  return new EmbedBuilder()
    .setColor(COR.dark)
    .setAuthor({ name: ' Central de Gerenciamento', iconURL: iconGuild(guild) })
    .setTitle('<:config3:1524208114327617588> CONFIGURAÇÃO GLOBAL DA LOJA')
    .setDescription(
      `Bem-vindo ao centro administrativo da sua aplicação comercial.\n` +
      `Selecione uma das opções abaixo para gerenciar ou publicar.\n\n` +
      `<:safety:1528841000548569239> **Status do Sistema:**\n` +
      `┗ <:pix:1528401197642551436> Gateway PIX: \`${pixChave}\`\n` +
      `┗ 📣 Canal de Logs: ${loja.canalLogsId ? `<#${loja.canalLogsId}>` : '`Não configurado`'}`
    )
    .setFooter(footerLoja(guild))
    .setTimestamp();
}

function buildMenuPrincipalComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_menu_criar_loja').setLabel('Publicar Produto (Canal)').setEmoji('<:canal:1524207214791884890>').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('prod_menu_produtos').setLabel('Configurar Atributos').setEmoji('<:config3:1524208114327617588>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('prod_menu_pagamentos').setLabel('Ajustar PIX').setEmoji('<:pix:1528401197642551436>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('prod_menu_mensagem_posvenda').setLabel('Mensagem Pós-Venda').setEmoji('<:text:1533089802856038461>').setStyle(ButtonStyle.Secondary)
    ),
    configExportManager.botoesExportImport(),
  ];
}

function buildPainelEmbed(guildId, guild, produtoId) {
  const p = (produtoId && db.getProdutoPorId(guildId, produtoId)) || getProduto(guildId);
  const loja = db.getGuild(guildId)?.loja || {};
  const variantes = p.variantes || [];
  const temVariantes = variantes.length > 0;
  const estoqueTxt = temVariantes ? `${variantes.length} variante(s)` : `${getEstoqueProdutoSemVariante(p)} item(ns)`;
  const vendas = loja.vendas || 0;
  const cargoTexto = p.cargoId ? `<@&${p.cargoId}>` : '`Não configurado`';
  // Painel de config agora usa a mesma "Cor da Embed" do produto (se
  // configurada), assim ele já mostra na hora como vai ficar a vitrine.
  const corPainelValida = /^#?[0-9A-Fa-f]{6}$/.test(p.corEmbed || '');
  const corPainelFinal = corPainelValida ? '#' + p.corEmbed.replace('#', '') : '#FFFFFF';
  return new EmbedBuilder()
    .setColor(corPainelFinal)
    .setAuthor({ name: '⚙️ Definições do Produto', iconURL: iconGuild(guild) })
    .setTitle('💎 PRODUTO ATUAL: ' + (p.titulo || '`Não configurado`'))
    .setDescription(`> Edite as informações visuais e comerciais que serão enviadas na vitrine pública.\n\u200b`)
    .addFields(
      { name: '<:caixa:1524207165496099007> IDENTIDADE COMERCIAL', value: `<:npertubar:1533081528966316083> **Nome:** \`${p.titulo || 'Não definido'}\`\n💲 **Preço Base:** \`R$ ${p.preco || '0.00'}\`\n🎨 **Cor do Botão:** \`${p.corBotao || 'Padrão'}\`\n<:personalizar:1528401146274910289> **Cor da Embed:** \`${p.corEmbed ? '#' + p.corEmbed.replace('#', '') : 'Branca (padrão)'}\``, inline: true },
      { name: '<:config3:1524208114327617588> ELEMENTOS VISUAIS', value: `<:foto:1533080648196292679> **Banner:** ${p.banner ? '<:positivo:1528401238197276702> `Ativo`' : '<:negativo:1528400986744295475> `Vazio`'}\n<:foto:1533080648196292679> **Thumbnail:** ${p.thumbnail ? '<:positivo:1528401238197276702> `Ativa`' : '<:negativo:1528400986744295475> `Vazia`'}\n📝 **Descrição:** ${p.descricao ? '<:positivo:1528401238197276702> `Preenchida`' : '<:negativo:1528400986744295475> `Vazia`'}\n🩸 **Rodapé:** ${p.footer ? '<:positivo:1528401238197276702> `Personalizado`' : '<:negativo:1528400986744295475> `Padrão`'}`, inline: true },
      { name: '<:rendimentos:1528401542070145135> INVENTÁRIO & ESTATÍSTICAS', value: `<:caixa:1524207165496099007> Estoque Atual: **\`${estoqueTxt}\`**\n<:config2:1524208021071462533> Sub-Variantes: **\`${variantes.length}\`**\n<:carrinho:1524207445600370719> Vendas Concluídas: **\`${vendas}\`**`, inline: false },
      { name: '<:user:1532137085081878558> ENTREGA AUTOMÁTICA DE CARGO', value: `┗ ${cargoTexto}`, inline: false }
    )
    .setThumbnail(iconGuild(guild))
    .setFooter(footerLoja(guild))
    .setTimestamp();
}

// CORRECAO/REORGANIZACAO (auditoria): interface reagrupada por
// categoria (Identidade Comercial / Visual / Estoque / Gestao /
// Navegacao), e adicionado um botao proprio para "Banner" (imagem
// grande, setImage) separado da "Thumbnail" (imagem pequena,
// setThumbnail) - antes so existia um unico botao/campo para os dois.
function buildPainelComponents(produtoId) {
  return [
    // Linha 1 - Identidade comercial
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_editar_titulo_${produtoId}`).setLabel('Nome').setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_editar_descricao_${produtoId}`).setLabel('Descrição').setEmoji('<:embed:1528400492982571111>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_editar_preco_${produtoId}`).setLabel('Preço').setEmoji('<:money:1532503308961448096>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_cor_botao_${produtoId}`).setLabel('Cor do Botão').setEmoji('<:personalizar:1528401146274910289>').setStyle(ButtonStyle.Secondary)
    ),
    // Linha 2 - Elementos visuais (Banner e Thumbnail agora sao botoes
    // separados, cada um editando seu proprio campo no produto)
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_editar_banner_img_${produtoId}`).setLabel('Banner').setEmoji('<:foto:1533080648196292679>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_editar_thumbnail_${produtoId}`).setLabel('Thumbnail').setEmoji('<:foto:1533080648196292679>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_editar_footer_${produtoId}`).setLabel('Rodapé').setEmoji('<:cupom:1524209015008002148>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_cor_embed_${produtoId}`).setLabel('Cor da Embed').setEmoji('<:personalizar:1528401146274910289>').setStyle(ButtonStyle.Secondary)
    ),
    // Linha 3 - Estoque
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_estoque_add_${produtoId}`).setLabel('Adicionar Estoque').setEmoji('<:caixa:1524207165496099007>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`prod_estoque_ver_${produtoId}`).setLabel('Ver Estoque').setEmoji('<:visible:1528840851654971443>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_estoque_limpar_${produtoId}`).setLabel('Limpar Estoque').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger)
    ),
    // Linha 4 - Gestao do produto
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_btn_variantes_${produtoId}`).setLabel('Gerenciar Variantes').setEmoji('<:config2:1524208021071462533>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_btn_cargo_${produtoId}`).setLabel('Configurar Cargo').setEmoji('<:user:1532137085081878558>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`prod_atalho_cupons_${produtoId}`).setLabel('Cupons').setEmoji('<:cupom:1524209015008002148>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_btn_avancado_${produtoId}`).setLabel('Regras Avançadas').setEmoji('<:ia:1533235376464986313>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_deletar_confirm_${produtoId}`).setLabel('Deletar Produto').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger)
    ),
    // Linha 5 - Navegacao
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_painel_voltar').setLabel('Voltar ao Início').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('prod_novo_produto').setLabel('Novo Produto').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('prod_trocar_produto').setLabel('Trocar Produto').setEmoji('<:arrow:1524206792626933831>').setStyle(ButtonStyle.Secondary),
      criarBotaoAtualizar('produto', produtoId)
    )
  ];
}

// ─── SUB-PAINEL: REGRAS AVANÇADAS DO PRODUTO ───────────────────
// Preço de/por, condições de compra (valor/quantidade mín-máx, cargo
// bloqueado), cargos pós-compra em lista (adicionar/remover) e assinatura
// recorrente. Fica numa tela separada (mesmo padrão de "Gerenciar
// Variantes") porque o painel principal já está no limite de 5 linhas
// de botão do Discord.
function buildAvancadoEmbed(guildId, guild, produtoId) {
  const p = db.getProdutoPorId(guildId, produtoId) || {};
  const cond = p.condicoes || {};
  const cargosPos = p.cargosPosCompra || { adicionar: [], remover: [] };
  const assinatura = p.assinatura || { ativa: false };

  const precoDeTexto = p.precoComparacao ? `~~R$ ${p.precoComparacao}~~ → **R$ ${p.preco || '0.00'}**` : `Sem preço comparativo (\`R$ ${p.preco || '0.00'}\`)`;

  return new EmbedBuilder()
    .setColor(0x00FFFF)
    .setAuthor({ name: '<:ia:1533235376464986313> Regras Avançadas do Produto', iconURL: iconGuild(guild) })
    .setTitle(p.titulo || 'Produto')
    .addFields(
      { name: '💲 Preço De/Por', value: precoDeTexto, inline: false },
      { name: '📏 Condições de Compra', value:
        `Valor mínimo: \`${cond.valorMinimo != null ? 'R$ ' + cond.valorMinimo : 'Sem mínimo'}\`\n` +
        `Valor máximo: \`${cond.valorMaximo != null ? 'R$ ' + cond.valorMaximo : 'Sem máximo'}\`\n` +
        `Quantidade mínima: \`${cond.quantidadeMinima != null ? cond.quantidadeMinima : 'Sem mínimo'}\`\n` +
        `Quantidade máxima: \`${cond.quantidadeMaxima != null ? cond.quantidadeMaxima : 'Sem máximo'}\`\n` +
        `Cargos bloqueados: \`${(cond.cargosBloqueados || []).length}\``, inline: false },
      { name: '<:user:1532137085081878558> Cargos Pós-Compra (lista)', value:
        `Para adicionar: \`${(cargosPos.adicionar || []).length}\`\n` +
        `Para remover: \`${(cargosPos.remover || []).length}\``, inline: true },
      { name: '🔁 Assinatura (Recorrência)', value:
        assinatura.ativa
          ? `<:positivo:1528401238197276702> Ativa — \`${assinatura.duracaoDias || 30} dias\`${assinatura.vipAtivado ? ' • VIP habilitado' : ''}`
          : '<:negativo:1528400986744295475> Desativada (produto avulso)', inline: true },
    )
    .setFooter(footerLoja(guild));
}

function buildAvancadoComponents(produtoId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_modal_precocomp_${produtoId}`).setLabel('Preço De/Por').setEmoji('💲').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_modal_condicoes_${produtoId}`).setLabel('Condições de Compra').setEmoji('📏').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_sel_cargobloq_${produtoId}`).setLabel('Cargos Bloqueados').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_sel_cargospos_add_${produtoId}`).setLabel('Cargos p/ Adicionar').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_sel_cargospos_rem_${produtoId}`).setLabel('Cargos p/ Remover').setEmoji('➖').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_toggle_assinatura_${produtoId}`).setLabel('Ativar/Desativar Assinatura').setEmoji('🔁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`prod_modal_assinatura_${produtoId}`).setLabel('Config. Assinatura').setEmoji('<:config3:1524208114327617588>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prod_voltar_painel_produto_${produtoId}`).setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── EMBED DE LOG DE PAGAMENTO (VISUAL PIXYCORD) ───────────────
function buildLogPagamentoEmbed({ userId, nomeItem, precoFinalStr, cargoId, thumbnailUrl, transacaoId, guild }) {
  const cargoTexto = cargoId ? `<@&${cargoId}>` : 'Nenhum';

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('<:money:1532503308961448096> Pagamento Pendente')
    .setDescription(
      `<:CadLock:1533221942256078968> **ID da transação:** \`${transacaoId}\`\n` +
      `📕 **Produto:** ${nomeItem}\n` +
      `💵 **Valor:** ${precoFinalStr}\n` +
      `<:cupom:1524209015008002148> **Cargo:** ${cargoTexto}\n` +
      `<:user:1532137085081878558> **Usuário:** <@${userId}>\n\n` +
      `-# Informaremos o usuário no privado quando o pagamento for confirmado.`
    )
    .setFooter(footerLoja(guild))
    .setTimestamp();

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  return embed;
}

// ─── EMBED DE CONFIRMAÇÃO DE COMPRA (ANTES DE CRIAR CARRINHO) ──
function buildConfirmacaoCompraEmbed({ nomeItem, precoStr, cargoId, guild }) {
  const cargoTexto = cargoId ? `<@&${cargoId}>` : 'Nenhum';
  return new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('Confirmação de compra')
    .setDescription(
      `Para usar os serviços você precisa ler e concordar com os termos e regras deste servidor.\n\n` +
      `⚠️ Não nos responsabilizamos por perdas de terceiros.\n\n` +
      `🔻 Você está prestes a fazer um pedido de:`
    )
    .addFields(
      { name: '📕 Produto', value: nomeItem, inline: true },
      { name: '<:money:1532503308961448096> Preço', value: `R$ ${precoStr}`, inline: true },
      { name: '<:cupom:1524209015008002148> Cargo', value: cargoTexto, inline: true }
    )
    .setFooter(footerLoja(guild))
    .setTimestamp();
}

// ─── EXECUÇÃO DOS FLUXOS DE INTERAÇÃO ──────────────────────────
async function enviarMenuPrincipal(interaction) {
  const embed = buildMenuPrincipalEmbed(interaction.guildId, interaction.guild);
  const components = buildMenuPrincipalComponents();
  if (interaction.isChatInputCommand?.() || interaction.customId === 'painel_vendas') {
    await interaction.reply({ embeds: [embed], components, flags: 64 });
  } else {
    await interaction.update({ embeds: [embed], components, flags: 64 });
  }
}

async function abrirSeletorParaEnviarVitrine(interaction) {
  const produtosConfigurados = db.getProdutos(interaction.guildId);
  if (produtosConfigurados.length === 0) {
    return interaction.reply({ content: '<:negativo:1528400986744295475> **Nenhum produto foi configurado ainda!** Preencha os atributos primeiro.', flags: 64 });
  }
  const opcoesProdutos = produtosConfigurados.map(p => {
    const variantesDoProduto = p.variantes || [];
    const possuiVariantes = variantesDoProduto.length > 0;
    return {
      label: (p.titulo || 'Produto sem nome').slice(0, 100),
      value: `enviar_vitrine_${p.id}`,
      description: possuiVariantes
        ? `<:caixa:1524207165496099007> ${variantesDoProduto.length} variante${variantesDoProduto.length > 1 ? 's' : ''} disponíve${variantesDoProduto.length > 1 ? 'is' : 'l'}`
        : `Preço: R$ ${p.preco || '0.00'} | Selecione para postar no canal`,
      emoji: '<:caixa:1524207165496099007>'
    };
  });
  const embedSeletor = new EmbedBuilder()
    .setColor(COR.gold)
    .setAuthor({ name: 'Seletor Comercial', iconURL: iconGuild(interaction.guild) })
    .setTitle(' SELECIONE O PRODUTO PARA LANÇAR')
    .setDescription('> Escolha qual produto você deseja instanciar e publicar de forma **pública** neste canal.');
  const rowSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('loja_selecionar_postar_produto')
      .setPlaceholder('<:arrow:1524206792626933831> Clique aqui e escolha o produto...')
      .addOptions(opcoesProdutos.slice(0, 25))
  );
  const rowVoltar = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_painel_voltar').setLabel('Voltar ao Menu').setStyle(ButtonStyle.Secondary).setEmoji({ name: 'voltar', id: '1528548726518448198' })
  );
  await interaction.update({ embeds: [embedSeletor], components: [rowSelect, rowVoltar], flags: 64 });
}

// ─── EMBED DE ENTREGA/VITRINE PÚBLICA — REDESENHADA (HORIZONTAL) ──
// Estilo: Título do produto, descrição (se houver), campos em
// linha (Valor à vista / Restam), thumbnail real do produto
// (nunca imagem preta fixa), footer com ícone + nome do servidor.
function buildVitrineEmbed(produto, guild) {
  const variantes = produto.variantes || [];
  const temVariantes = variantes.length > 0;

  // Cor lateral da embed: aceita hex com ou sem "#" (ex: "FFFFFF" ou "#FFFFFF").
  // Se não configurado, ou se o valor salvo for inválido por algum motivo,
  // cai no branco puro (0xFFFFFF) como padrão — nunca quebra a vitrine.
  const corValida = /^#?[0-9A-Fa-f]{6}$/.test(produto.corEmbed || '');
  const corEmbedFinal = corValida ? parseInt(produto.corEmbed.replace('#', ''), 16) : 0xFFFFFF;

  const embed = new EmbedBuilder()
    .setColor(corEmbedFinal)
    .setTitle(produto.titulo || 'Produto')
    .setFooter(produto.footer ? { text: produto.footer, iconURL: footerLoja(guild).iconURL } : footerLoja(guild))
    .setTimestamp();

  if (produto.descricao) embed.setDescription(produto.descricao);

  // CORRECAO (auditoria): Banner e Thumbnail agora sao campos
  // independentes. Banner (imagem grande, setImage) e Thumbnail (imagem
  // pequena, setThumbnail) - cada um so aparece se tiver sido cadastrado,
  // nunca placeholder fixo. Mantém fallback para produtos legados que só
  // tinham "banner" preenchido (nunca perde a imagem que já existia).
  if (produto.thumbnail) embed.setThumbnail(produto.thumbnail);
  if (produto.banner) embed.setImage(produto.banner);

  if (!temVariantes) {
    const precoFmt = formatarPrecoVariante(produto.preco || '0.00');
    const restam = getEstoqueProdutoSemVariante(produto);
    const valorTxt = produto.precoComparacao
      ? `~~R$${formatarPrecoVariante(produto.precoComparacao)}~~ \`R$${precoFmt}\``
      : `\`R$${precoFmt}\``;
    embed.addFields(
      { name: 'Valor à vista', value: valorTxt, inline: true },
      { name: 'Restam', value: `\`${restam}\``, inline: true }
    );
  }
  // BUGFIX: quando o produto TEM variantes, não injeta mais nenhum campo
  // de texto listando as opções ("<:config2:1524208021071462533> Opções Disponíveis"). As opções
  // ficam disponíveis só através do Select Menu (buildVitrineComponentes,
  // enviado junto com este embed) — o embed em si fica só com
  // título/descrição/imagem, sem duplicar a informação em texto.

  return embed;
}

// Monta os componentes (select de variantes ou botão Comprar) da vitrine
// pública. Extraído para reuso por postarEmbedProdutoNoCanal e por
// atualizarVitrinePublicada (edição ao vivo da mesma mensagem).
function buildVitrineComponentes(produto, produtoId) {
  let estiloBotao = ButtonStyle.Danger;
  if (produto.corBotao === 'Primary') estiloBotao = ButtonStyle.Primary;
  if (produto.corBotao === 'Success') estiloBotao = ButtonStyle.Success;
  if (produto.corBotao === 'Secondary') estiloBotao = ButtonStyle.Secondary;

  const variantes = produto.variantes || [];
  const possuiVariantes = variantes.length > 0;
  const componentesEnvio = [];

  if (possuiVariantes) {
    const optionsMenu = variantes.slice(0, 25).map(v => {
      const precoFormatado = formatarPrecoVariante(v.preco);
      const qtd = v.estoque ?? 0;
      const estoqueTxt = qtd > 0 ? `${qtd}` : 'ESGOTADO';
      return {
        label: (qtd > 0 ? v.nome : `${v.nome} (Esgotado)`).slice(0, 100),
        value: `compra_var_${v.id || v.nome.toLowerCase().replace(/\s/g, '_')}`,
        description: `PREÇO: R$ ${precoFormatado} | ESTOQUE: ${estoqueTxt}`.slice(0, 100),
        // Emojis customizados (formato <:nome:id>) não são renderizados
        // dentro de label/description do select — só funcionam via .emoji
        // na própria option. Por isso vão aqui, e não no texto acima.
        emoji: parseEmojiParaOption(v.emoji) || { name: 'caixa', id: '1524207165496099007' },
      };
    });
    componentesEnvio.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`cliente_comprar_variante_${produtoId}`).setPlaceholder('🛒 Selecione uma opção abaixo.').addOptions(optionsMenu)
    ));
  } else {
    componentesEnvio.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cliente_comprar_direto_${produtoId}`).setLabel('Comprar').setEmoji({ name: 'carrinho', id: '1524207445600370719' }).setStyle(estiloBotao)
    ));
  }
  return componentesEnvio;
}

// CORREÇÃO (auditoria): agora salva vitrineCanalId/vitrineMsgId no
// produto ao publicar, para que futuras compras/edições/exclusões
// consigam localizar e EDITAR esta mesma mensagem em vez de deixá-la
// desatualizada (preço, estoque, variantes antigos) ou de duplicar
// embeds criando uma vitrine nova a cada publicação repetida no MESMO
// canal.
async function postarEmbedProdutoNoCanal(interaction, produtoId) {
  let produto = db.getProdutoPorId(interaction.guildId, produtoId);
  if (!produto) return interaction.reply({ content: '<:negativo:1528400986744295475> Dados do produto corrompidos ou inexistentes.', flags: 64 });

  const embedVitrinePublica = buildVitrineEmbed(produto, interaction.guild);
  const componentesEnvio = buildVitrineComponentes(produto, produtoId);

  try {
    const msgEnviada = await interaction.channel.send({ embeds: [embedVitrinePublica], components: componentesEnvio });
    db.atualizarProduto(interaction.guildId, produtoId, 'vitrineCanalId', interaction.channel.id);
    db.atualizarProduto(interaction.guildId, produtoId, 'vitrineMsgId', msgEnviada.id);
    return interaction.reply({ content: `<:canal:1524207214791884890> **Vitrine de \`${produto.titulo}\` publicada com sucesso!**`, flags: 64 });
  } catch (error) {
    console.error(error);
    return interaction.reply({ content: `<:negativo:1528400986744295475> **Erro ao postar vitrine!** Verifique as permissões do bot neste canal.`, flags: 64 });
  }
}

// CORREÇÃO (auditoria): nova função central de sincronização — chamada
// sempre que o produto muda (edição de atributos, banner/thumbnail,
// estoque, variantes, ou após uma compra que reduz o estoque). Localiza
// a vitrine publicada (via vitrineCanalId/vitrineMsgId salvos no
// produto) e EDITA a mesma mensagem, nunca envia uma nova. Se a
// mensagem não existir mais (foi apagada manualmente), limpa o
// rastreamento salvo para não tentar de novo indefinidamente. Nunca
// lança exceção — silenciosa em caso de falha, para nunca quebrar o
// fluxo principal (compra, edição, etc.) que a chamou.
async function atualizarVitrinePublicada(client, guildId, produtoId) {
  try {
    const produto = db.getProdutoPorId(guildId, produtoId);
    if (!produto || !produto.vitrineCanalId || !produto.vitrineMsgId) return;

    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const canal = guild.channels.cache.get(produto.vitrineCanalId)
      || await guild.channels.fetch(produto.vitrineCanalId).catch(() => null);
    if (!canal || typeof canal.messages?.fetch !== 'function') {
      db.atualizarProduto(guildId, produtoId, 'vitrineCanalId', null);
      db.atualizarProduto(guildId, produtoId, 'vitrineMsgId', null);
      return;
    }

    const msg = await canal.messages.fetch(produto.vitrineMsgId).catch(() => null);
    if (!msg) {
      // Mensagem foi apagada manualmente — limpa o rastreamento para não
      // tentar editar algo que não existe mais em toda alteração futura.
      db.atualizarProduto(guildId, produtoId, 'vitrineCanalId', null);
      db.atualizarProduto(guildId, produtoId, 'vitrineMsgId', null);
      return;
    }

    const embedAtualizado = buildVitrineEmbed(produto, guild);
    const componentesAtualizados = buildVitrineComponentes(produto, produtoId);
    await msg.edit({ embeds: [embedAtualizado], components: componentesAtualizados });
  } catch (e) {
    console.error('[Vitrine] Falha ao sincronizar vitrine publicada:', e.message);
  }
}


const metadadosPedido = {};

// Trava em memória contra clique duplo no botão de comprar: sem isso, dois
// cliques rápidos no mesmo usuário (comum no celular) podem passar os dois
// pela checagem de "já existe compra aberta" antes do primeiro canal
// terminar de ser criado, gerando dois canais/pedidos duplicados.
const criandoCanalCompra = new Set();

// ─── EMBED DE REVISÃO DO PEDIDO — REDESENHADA (HORIZONTAL) ────
// Removido: campo "🧾 Pedido #X" (não deve mais aparecer).
// Corrigido: campo Variante só aparece quando é DIFERENTE do
// nome do produto — evita duplicação visual.
// Corrigido: estoque exibido usa o valor real (array quando sem
// variante, campo numérico quando com variante).
function buildRevisaoEmbedPropria({ user, nomeItem, varianteNome, estoqueTexto, dataCriacao, variante, pedido, guild, produto }) {
  const { calcularTotal } = require('../sales-system/salesManager');
  const { precoFinalStr, subtotalStr } = calcularTotal(variante, pedido);
  const qtd = pedido.quantidade || 1;
  let valorTexto;
  if (pedido.cupom) {
    // Cupons Avançados: cupom.tipo === 'fixo' desconta um valor em R$ fixo
    // em vez de percentual. Cupons antigos não têm `tipo` e caem no ramo
    // percentual de sempre (comportamento 100% preservado).
    const rotuloDesconto = pedido.cupom.tipo === 'fixo'
      ? `-${require('../sales-system/salesManager').floatParaPreco(pedido.cupom.valorFixo)}`
      : `-${pedido.cupom.desconto}%`;
    valorTexto = `~~R$ ${subtotalStr.replace('R$ ', '')}~~ → **${precoFinalStr}** (${rotuloDesconto})`;
  } else {
    valorTexto = `**${precoFinalStr}**`;
  }

  const varianteDiferente = varianteNome && nomeItem && varianteNome.trim().toLowerCase() !== nomeItem.trim().toLowerCase();

  const embed = new EmbedBuilder()
    .setColor('#FFFFFF')
    .setAuthor({ name: user.globalName || user.username, iconURL: user.displayAvatarURL({ extension: 'png', size: 128 }) })
    .setTitle('<:carrinho:1524207445600370719> Revisão do Pedido')
    .setDescription(`Cliente: <@${user.id}>`);

  // Banner do produto (imagem grande cadastrada em /produto → Ajustar
  // Produto → Banner) — mesma imagem que aparece na vitrine, agora
  // também no carrinho, igual ao padrão pedido.
  if (produto?.banner) embed.setImage(produto.banner);

  const fields = [
    { name: '<:caixa:1524207165496099007> Produto', value: nomeItem, inline: true },
  ];
  if (varianteDiferente) {
    fields.push({ name: '<:config2:1524208021071462533> Variante', value: varianteNome, inline: true });
  }
  fields.push(
    { name: '<:block:1533259816871657522> Quantidade', value: `${qtd}x`, inline: true },
    { name: '<:money:1532503308961448096> Valor', value: valorTexto, inline: true },
    { name: '<:caixa:1524207165496099007> Em estoque', value: estoqueTexto, inline: true },
    { name: '<:cupom:1524209015008002148> Cupom', value: pedido.cupom ? `\`${pedido.cupom.codigo}\`` : '`Nenhum aplicado`', inline: true },
    { name: '<:relogio:1524207889441357917> Data/Hora', value: dataCriacao, inline: true },
  );

  embed.addFields(fields);
  embed.setFooter(footerLoja(guild));
  embed.setTimestamp();
  return embed;
}

function buildRevisaoComponentsPropria(varianteKey) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_var_ir_pagamento').setLabel('Ir para Pagamento').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('prod_var_editar_qtd').setLabel('Editar Quantidade').setEmoji('<:editar:1528400388137549864>').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_var_aplicar_cupom').setLabel('Aplicar Cupom').setEmoji('<:cupom:1524209015008002148>').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('prod_var_cancelar').setLabel('Cancelar Compra').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger),
    )
  ];
}

function gerarPixCheckoutEmbed({ nomeItem, varianteNome, precoStr, copiaECola, guild }) {
  const varianteDiferente = varianteNome && nomeItem && varianteNome.trim().toLowerCase() !== nomeItem.trim().toLowerCase();
  const fields = [
    { name: '<:relogio:1524207889441357917> Expira em:', value: '10 minutos', inline: true },
    { name: '<:money:1532503308961448096> Valor:', value: `R$ ${precoStr}`, inline: true },
    { name: '<:caixa:1524207165496099007> Produto:', value: nomeItem, inline: true },
  ];
  if (varianteDiferente) fields.push({ name: '<:config2:1524208021071462533> Variante:', value: varianteNome, inline: true });
  fields.push({ name: '<:copypast:1533880329536802896> Código Copia e Cola', value: '> Use o botão **Copiar Código PIX** abaixo ou o arquivo `.txt` anexado.' });

  return new EmbedBuilder()
    .setColor(COR.success)
    .setTitle('<:pix:1528401197642551436> Pagamento PIX Criado')
    .addFields(fields)
    .setImage('attachment://qrcode-pix.png')
    .setFooter(footerLoja(guild))
    .setTimestamp();
}

async function criarCanalCompraEMostrarRevisao(interaction, { varianteKey, nomeItem, varianteNome, precoStr, produtoId }) {
  const { guild, user } = interaction;
  const { getPedido, varianteToKey: normalizarKey, getCfg, getVarianteByKey } = require('../sales-system/salesManager');
  const cfg = getCfg(guild.id);

  if (criandoCanalCompra.has(user.id)) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sua compra já está sendo criada').setDescription('> Aguarde alguns segundos, não clique novamente.')],
    });
  }

  const todosCanais = await guild.channels.fetch().catch(() => guild.channels.cache);
  const existe = todosCanais.find(c => c?.topic?.startsWith(`compra:${user.id}`));
  if (existe) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Você já tem uma compra aberta').setDescription(`> <#${existe.id}>`)],
    });
  }

  criandoCanalCompra.add(user.id);
  try {

  const keyNormalizada = normalizarKey(varianteKey);
  const perms = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  const todosMembros = await guild.members.fetch().catch(() => guild.members.cache);
  const admins = todosMembros.filter(m => m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot);
  admins.forEach(m => perms.push({
    id: m.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
  }));

  const canal = await guild.channels.create({
    name: `compra-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
    type: ChannelType.GuildText,
    topic: `compra:${user.id}:${keyNormalizada}`,
    parent: cfg.categoriaComprasId || null,
    permissionOverwrites: perms,
  });

  const pedido = getPedido(canal.id);
  pedido.varianteKey = keyNormalizada;
  pedido.quantidade = 1;
  pedido.cupom = null;

  const numeroPedido = getProximoNumeroPedido(guild.id);
  const dataCriacao = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const varianteReal = getVarianteByKey(guild.id, keyNormalizada) || { nome: nomeItem, preco: precoStr, estoque: null };

  // Estoque real: se o produto do pedido não tem variantes, usa o
  // tamanho do array de estoque do produto. Caso contrário, usa o
  // campo numérico da variante (null = ilimitado).
  let estoqueTexto;
  const produtoDoPedido = produtoId ? db.getProdutoPorId(guild.id, produtoId) : null;
  const produtoTemVariantes = produtoDoPedido && (produtoDoPedido.variantes || []).length > 0;
  if (!produtoTemVariantes && produtoDoPedido) {
    estoqueTexto = textoEstoque(getEstoqueProdutoSemVariante(produtoDoPedido));
  } else {
    estoqueTexto = textoEstoque(varianteReal.estoque);
  }

  metadadosPedido[canal.id] = { nomeItem, varianteNome: varianteNome || nomeItem, numeroPedido, dataCriacao, produtoId: produtoId || null };
  try {
    db.registrarCarrinho({ guildId: guild.id, clienteId: user.id, produtoId: produtoId || null, produtoNome: nomeItem, varianteNome: varianteNome || nomeItem, canalId: canal.id });
  } catch (e) {
    console.error('[Kael Intelligence] Erro ao registrar carrinho:', e.message);
  }

  try {
    db.registrarCarrinho({
      guildId: guild.id, clienteId: user.id, produtoId: produtoId || null,
      produtoNome: nomeItem, varianteNome: varianteNome || nomeItem, canalId: canal.id,
    });
  } catch (e) { console.error('[Kael Intelligence] Falha ao registrar carrinho:', e.message); }

  const embedRevisao = buildRevisaoEmbedPropria({ user, nomeItem, varianteNome, estoqueTexto, dataCriacao, variante: varianteReal, pedido, guild, produto: produtoDoPedido });
  const componentsRevisao = buildRevisaoComponentsPropria(keyNormalizada);
  await canal.send({ content: `<@${user.id}>`, embeds: [embedRevisao], components: componentsRevisao });

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Seu carrinho foi criado.').setDescription(`> Acesse <#${canal.id}>`)],
    components: []
  });
  } finally {
    criandoCanalCompra.delete(user.id);
  }
}

async function mostrarSelecaoPagamento(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COR.dark)
    .setDescription('**Selecione a forma de pagamento**');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_var_pagar_pix').setLabel('PIX').setEmoji('<:pix:1528401197642551436>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('prod_var_pagar_cartao').setLabel('Cartão (Em breve)').setEmoji('<:card:1533880211882381422>').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('prod_var_voltar_revisao').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [embed], components: [row] });
}

async function voltarParaRevisao(interaction) {
  const { getPedido, getVarianteByKey } = require('../sales-system/salesManager');
  const canalId = interaction.channel.id;
  const meta = metadadosPedido[canalId];
  if (!meta) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao identificar o pedido').setDescription('> Tente cancelar e iniciar a compra novamente.')],
      components: []
    });
  }
  const pedido = getPedido(canalId);
  const variante = resolverVarianteOuBase(interaction.guildId, pedido.varianteKey, meta);

  let estoqueTexto;
  const produtoDoPedido = meta.produtoId ? db.getProdutoPorId(interaction.guildId, meta.produtoId) : null;
  const produtoTemVariantes = produtoDoPedido && (produtoDoPedido.variantes || []).length > 0;
  if (!produtoTemVariantes && produtoDoPedido) {
    estoqueTexto = textoEstoque(getEstoqueProdutoSemVariante(produtoDoPedido));
  } else {
    estoqueTexto = textoEstoque(variante.estoque);
  }

  const embedRevisao = buildRevisaoEmbedPropria({
    user: interaction.user, nomeItem: meta.nomeItem, varianteNome: meta.varianteNome,
    estoqueTexto, dataCriacao: meta.dataCriacao,
    variante, pedido, guild: interaction.guild, produto: produtoDoPedido
  });
  await interaction.update({ embeds: [embedRevisao], components: buildRevisaoComponentsPropria(pedido.varianteKey) });
}

// ─── C6 BANK: dados do devedor (CPF/CNPJ + nome), exigidos pelo único
// tipo de cobrança confirmado (cobv) — ver aviso em sales-system/c6Bank.js.
// Coletados uma vez por pedido (guardados em metadadosPedido[canalId]),
// nunca persistidos no banco além do necessário pra criar a cobrança.
function buildModalDevedorC6() {
  const modal = new ModalBuilder().setCustomId('prod_var_modal_devedor_c6').setTitle('Dados exigidos pelo C6 Bank pro PIX');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cpfCnpj').setLabel('CPF/CNPJ (exigido p/ emitir o PIX)').setPlaceholder('Só números. Vai direto pro banco, não fica salvo aqui.').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(14)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('nomeCompleto').setLabel('Nome completo (exigido pelo C6 Bank)').setPlaceholder('Usado só para emitir a cobrança PIX.').setStyle(TextInputStyle.Short).setRequired(true)
    ),
  );
  return modal;
}

async function handleModalDevedorC6(interaction) {
  const meta = metadadosPedido[interaction.channel.id];
  if (!meta) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Pedido expirado').setDescription('> Cancele e inicie a compra novamente.')],
      flags: 64,
    });
  }

  const cpfCnpj = interaction.fields.getTextInputValue('cpfCnpj').trim().replace(/\D/g, '');
  const nomeCompleto = interaction.fields.getTextInputValue('nomeCompleto').trim();

  if (!nomeCompleto || (cpfCnpj.length !== 11 && cpfCnpj.length !== 14)) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Dados inválidos').setDescription('> CPF deve ter 11 dígitos ou CNPJ 14 dígitos, e o nome não pode ficar em branco.')],
      flags: 64,
    });
  }

  meta.devedorC6 = cpfCnpj.length === 14
    ? { cnpj: cpfCnpj, nome: nomeCompleto }
    : { cpf: cpfCnpj, nome: nomeCompleto };

  // Modal aberto a partir de um botão (interação ainda não respondida) →
  // reexecuta o checkout normalmente; como meta.devedorC6 já está
  // preenchido, ele passa direto pra criação da cobrança e usa
  // interaction.update() pra editar a MESMA mensagem efêmera do checkout.
  return gerarCheckoutPix(interaction);
}

async function gerarCheckoutPix(interaction) {
  const { guild, channel, user } = interaction;
  const meta = metadadosPedido[channel.id];

  // C6 Bank exige CPF/CNPJ + nome do comprador antes de gerar a cobrança
  // (cobv) — diferente de Mercado Pago/Efi, que não pedem isso. Só
  // interrompe o fluxo com a modal quando o C6 é de fato o gateway ativo
  // (prioridade Mercado Pago → Efi → C6 → manual, igual ao resto do checkout).
  if (meta && !meta.devedorC6) {
    const { getConfigMercadoPago } = require('../sales-system/mercadoPago');
    const { getConfigEfiBank } = require('../sales-system/efiBank');
    const { getConfigC6Bank } = require('../sales-system/c6Bank');
    const mpAtivo  = getConfigMercadoPago(guild.id).habilitado;
    const efiAtivo = getConfigEfiBank(guild.id).habilitado;
    const c6Ativo  = getConfigC6Bank(guild.id).habilitado;
    if (!mpAtivo && !efiAtivo && c6Ativo) {
      return interaction.showModal(buildModalDevedorC6());
    }
  }

  const loja = getLoja(guild.id);
  const { getPedido, getVarianteByKey, calcularTotal } = require('../sales-system/salesManager');

  if (!pagamentoDisponivel(guild.id)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> PIX em manutenção').setDescription('> Nenhuma forma de pagamento configurada. Avise um administrador.')],
      components: []
    });
  }
  if (!meta) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Erro ao identificar o pedido').setDescription('> Tente cancelar e iniciar a compra novamente.')],
      components: []
    });
  }

  const pedido = getPedido(channel.id);
  const variante = resolverVarianteOuBase(guild.id, pedido.varianteKey, meta);
  const { total, precoFinalStr } = calcularTotal(variante, pedido);

  // ─── GERAÇÃO DO PIX: Mercado Pago (API oficial) tem prioridade sobre
  // o PIX manual. Quando habilitado, todo o checkout passa a usar a API
  // do Mercado Pago (criação da cobrança, QR Code e código copia-e-cola).
  // O caminho legado (gerarPixEstatico) continua abaixo, intacto, para
  // quando o Mercado Pago não estiver habilitado.
  const { getConfigMercadoPago, criarPagamentoPix } = require('../sales-system/mercadoPago');
  const { habilitado: mpHabilitado, accessToken: mpAccessToken } = getConfigMercadoPago(guild.id);

  let copiaECola;
  let qrBuffer;
  let mpPaymentId = null;
  let efiTxid = null;
  let c6Txid = null;
  let openpixCorrelationID = null;

  if (mpHabilitado) {
    try {
      const pagamentoMP = await criarPagamentoPix({
        accessToken: mpAccessToken,
        valor: total,
        descricao: `${meta.nomeItem} - ${meta.varianteNome}`,
        clienteId: user.id,
        guildId: guild.id,
      });
      copiaECola = pagamentoMP.copiaECola;
      mpPaymentId = pagamentoMP.id;
      qrBuffer = pagamentoMP.qrCodeBase64
        ? Buffer.from(pagamentoMP.qrCodeBase64, 'base64')
        : await gerarQrCodeComLogo(copiaECola, guild.iconURL({ extension: 'png', size: 256 }) || interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }));
    } catch (e) {
      console.error('[Mercado Pago] Erro ao criar pagamento PIX:', e.message);
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível gerar o PIX')
          .setDescription('> Houve um problema ao criar o pagamento no Mercado Pago.\n> Avise um administrador para verificar o Access Token em `/definicoes`.')],
        components: []
      });
    }
  } else {
    // ─── EFI BANK: 2º gateway de PIX, usado quando o Mercado Pago está
    // desligado. Se também não estiver habilitado, cai no PIX manual
    // legado (gerarPixEstatico), exatamente como já era antes.
    const { getConfigEfiBank, criarPagamentoPix: criarPagamentoPixEfi, registrarPendente } = require('../sales-system/efiBank');
    const efiCfg = getConfigEfiBank(guild.id);

    if (efiCfg.habilitado) {
      try {
        const pagamentoEfi = await criarPagamentoPixEfi({
          ...efiCfg,
          valor: total,
          descricao: `${meta.nomeItem} - ${meta.varianteNome}`,
          clienteId: user.id,
          guildId: guild.id,
        });
        copiaECola = pagamentoEfi.copiaECola;
        efiTxid = pagamentoEfi.id;
        qrBuffer = pagamentoEfi.qrCodeBase64
          ? Buffer.from(pagamentoEfi.qrCodeBase64, 'base64')
          : await gerarQrCodeComLogo(copiaECola, guild.iconURL({ extension: 'png', size: 256 }) || interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }));

        // Registra pra o poller de confirmação (sales-system/efiBank.js)
        // detectar o pagamento e chamar entregarAutomatico sozinho.
        registrarPendente(efiTxid, {
          guildId: guild.id,
          clienteId: user.id,
          varianteKey: pedido.varianteKey,
          canalId: channel.id,
          numeroPedido: meta.numeroPedido,
          produtoId: meta.produtoId,
          efiTxid,
        });
      } catch (e) {
        console.error('[Efi Bank] Erro ao criar pagamento PIX:', e.message);
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível gerar o PIX')
            .setDescription('> Houve um problema ao criar o pagamento no Efi Bank.\n> Avise um administrador para verificar `/efibank`.')],
          components: []
        });
      }
    } else {
      // ─── C6 BANK: 3º gateway de PIX, usado quando Mercado Pago e Efi
      // Bank estão desligados. Se também não estiver habilitado, cai no
      // PIX manual legado (gerarPixEstatico), exatamente como já era antes.
      const { getConfigC6Bank, criarPagamentoPix: criarPagamentoPixC6, registrarPendente: registrarPendenteC6 } = require('../sales-system/c6Bank');
      const c6Cfg = getConfigC6Bank(guild.id);

      if (c6Cfg.habilitado) {
        try {
          const pagamentoC6 = await criarPagamentoPixC6({
            ...c6Cfg,
            valor: total,
            descricao: `${meta.nomeItem} - ${meta.varianteNome}`,
            clienteId: user.id,
            guildId: guild.id,
            devedor: meta.devedorC6,
          });
          copiaECola = pagamentoC6.copiaECola;
          c6Txid = pagamentoC6.id;
          qrBuffer = pagamentoC6.qrCodeBase64
            ? Buffer.from(pagamentoC6.qrCodeBase64, 'base64')
            : await gerarQrCodeComLogo(copiaECola, guild.iconURL({ extension: 'png', size: 256 }) || interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }));

          // Registra pra o poller de confirmação (sales-system/c6Bank.js)
          // detectar o pagamento e chamar entregarAutomatico sozinho.
          registrarPendenteC6(c6Txid, {
            guildId: guild.id,
            clienteId: user.id,
            varianteKey: pedido.varianteKey,
            canalId: channel.id,
            numeroPedido: meta.numeroPedido,
            produtoId: meta.produtoId,
            c6Txid,
          });
        } catch (e) {
          console.error('[C6 Bank] Erro ao criar pagamento PIX:', e.message);
          return interaction.update({
            embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível gerar o PIX')
              .setDescription('> Houve um problema ao criar o pagamento no C6 Bank.\n> Avise um administrador para verificar `/c6bank`.')],
            components: []
          });
        }
      } else {
        // ─── OPENPIX: 4º gateway de PIX (Parte 2), usado quando Mercado
        // Pago, Efi Bank e C6 Bank estão desligados e o servidor já tem
        // subconta OpenPix vinculada (/carteira → Configurar PIX faz o
        // vínculo). Se não estiver vinculado, cai no PIX manual legado,
        // exatamente como já era antes.
        const openpixManager = require('../payment-system/openpix/openpixManager');
        const openpixCfg = openpixManager.getConfigOpenPix(guild.id);

        if (openpixCfg.habilitado) {
          try {
            const pagamentoOpenPix = await openpixManager.criarPagamentoPix({
              valor: total,
              descricao: `${meta.nomeItem} - ${meta.varianteNome}`,
              clienteId: user.id,
              guildId: guild.id,
            });
            copiaECola = pagamentoOpenPix.copiaECola;
            openpixCorrelationID = pagamentoOpenPix.id;
            qrBuffer = await gerarQrCodeComLogo(copiaECola, guild.iconURL({ extension: 'png', size: 256 }) || interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }));

            // Registra pra o webhook (sales-system/webhook.js, rota
            // /webhook/openpix) encontrar os dados do pedido e chamar
            // entregarAutomatico quando a OpenPix confirmar o pagamento.
            const { registrarPagamentoOpenPix } = require('../sales-system/webhook');
            registrarPagamentoOpenPix(openpixCorrelationID, {
              guildId: guild.id,
              clienteId: user.id,
              varianteKey: pedido.varianteKey,
              canalId: channel.id,
              numeroPedido: meta.numeroPedido,
              produtoId: meta.produtoId,
              openpixCorrelationID,
            });
          } catch (e) {
            console.error('[OpenPix] Erro ao criar pagamento PIX:', e.message);
            return interaction.update({
              embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível gerar o PIX')
                .setDescription('> Houve um problema ao criar o pagamento na OpenPix.\n> Avise um administrador para verificar o vínculo em `/carteira`.')],
              components: []
            });
          }
        } else {
          try {
            copiaECola = gerarPixEstatico(loja.pix.chave, total.toFixed(2), loja.pix.nome, loja.pix.cidade);
          } catch (e) {
            console.error('[PIX] Erro ao gerar payload:', e.message);
            return interaction.update({
              embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível gerar o PIX')
                .setDescription('> Houve um problema com o valor ou a configuração do PIX desta loja.\n> Avise um administrador para verificar `/produto criar` → Ajustar PIX.')],
              components: []
            });
          }
          const logoUrl = guild.iconURL({ extension: 'png', size: 256 }) || interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 });
          qrBuffer = await gerarQrCodeComLogo(copiaECola, logoUrl);
        }
      }
    }
  }

  pedido.pixCopiaCola = copiaECola;
  if (mpPaymentId) pedido.mpPaymentId = mpPaymentId;
  if (efiTxid) pedido.efiTxid = efiTxid;
  if (c6Txid) pedido.c6Txid = c6Txid;
  if (openpixCorrelationID) pedido.openpixCorrelationID = openpixCorrelationID;
  console.log('[PIX][AUDITORIA] Payload final:', JSON.stringify(copiaECola));

  try { db.atualizarStatusCarrinhoPorCanal(channel.id, 'pix_gerado'); } catch (e) { console.error('[Kael Intelligence] Falha ao atualizar carrinho:', e.message); }

  // Registra o pagamento para o webhook do Mercado Pago encontrar os
  // dados do pedido quando a confirmação chegar (entrega automática).
  if (mpPaymentId) {
    const { registrarPagamento } = require('../sales-system/webhook');
    registrarPagamento(mpPaymentId, {
      guildId: guild.id,
      clienteId: user.id,
      varianteKey: pedido.varianteKey,
      canalId: channel.id,
      numeroPedido: meta.numeroPedido,
      produtoId: meta.produtoId,
      mpPaymentId,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // KAEL — cria (ou reaproveita) a transação PENDING deste carrinho
  // e agenda os 10 minutos fixos de expiração automática. Esta é a
  // fonte da verdade do status da transação a partir daqui — usada nos
  // botões Confirmar/Recusar Pagamento, no cancelamento pelo cliente e
  // no scheduler de expiração (handlers/expiracaoScheduler.js).
  // ─────────────────────────────────────────────────────────────────
  const transacaoManager = require('../sales-system/transacaoManager');
  const { transacaoId, expiraEm } = transacaoManager.obterOuCriarTransacaoPendente({
    canalId: channel.id,
    guildId: guild.id,
    clienteId: user.id,
    produtoId: meta.produtoId || null,
    numeroPedido: meta.numeroPedido,
    itemNome: meta.nomeItem,
    varianteNome: meta.varianteNome,
    valor: precoFinalStr,
    mpPaymentId,
    efiTxid,
    c6Txid,
    openpixCorrelationID,
  });
  try {
    require('../handlers/expiracaoScheduler').registrarNovaExpiracao(channel.id, expiraEm, interaction.client);
  } catch (e) {
    console.error('[Expiração] Falha ao agendar expiração automática do carrinho:', e.message);
  }

  const qrAttachment = new AttachmentBuilder(qrBuffer, { name: 'qrcode-pix.png' });
  const pixTxtAttachment = new AttachmentBuilder(Buffer.from(copiaECola, 'utf-8'), { name: 'codigo-pix.txt' });

  const embedCheckout = gerarPixCheckoutEmbed({
    nomeItem: meta.nomeItem, varianteNome: meta.varianteNome,
    precoStr: precoFinalStr.replace('R$ ', ''), copiaECola, guild
  });

  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_var_copiar_pix').setLabel('Copiar Código PIX').setEmoji('<:copypast:1533880329536802896>').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('prod_var_cancelar').setLabel('Cancelar Compra').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger),
  );

  await interaction.update({ embeds: [embedCheckout], components: [rowAcoes], files: [qrAttachment, pixTxtAttachment] });

  // ─── ENVIO PARA CANAL DE LOGS — VISUAL PIXYCORD ───────────────
  const cfg = getLoja(guild.id);
  if (cfg.canalLogsId) {
    const { resolverCanal } = require('../sales-system/salesManager');
    const canalConfirmacao = await resolverCanal(guild, cfg.canalLogsId, 'Confirmação de Pagamento');
    if (canalConfirmacao) {
      // KAEL — reaproveita o MESMO transacaoId gravado na transação
      // persistente (criada acima), em vez de gerar outro aqui — o ID
      // mostrado neste log precisa ser o mesmo usado pra consultar/
      // rastrear a transação (ex.: no cancelamento e na expiração).

      const produto = meta.produtoId ? db.getProdutoPorId(guild.id, meta.produtoId) : null;
      const thumbnailUrl = produto?.thumbnail || produto?.banner || null;
      const cargoId = produto?.cargoId || null;

      const rowAprovacao = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`prod_var_confirmar_${user.id}_${channel.id}`)
          .setLabel('Confirmar Pagamento')
          .setEmoji('<:positivo:1528401238197276702>')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`prod_var_recusar_${user.id}_${channel.id}`)
          .setLabel('Recusar Pagamento')
          .setEmoji('<:negativo:1528400986744295475>')
          .setStyle(ButtonStyle.Danger),
      );

      const embedLog = buildLogPagamentoEmbed({
        userId: user.id,
        nomeItem: meta.nomeItem,
        precoFinalStr,
        cargoId,
        thumbnailUrl,
        transacaoId,
        guild
      });

      await canalConfirmacao.send({
        embeds: [embedLog],
        components: [rowAprovacao]
      }).catch(e => console.error('[Confirmação] Erro ao enviar para canal de logs:', e.message));
    }
  }
}

async function atualizarEmbedRevisao(interaction) {
  const { getPedido, getVarianteByKey } = require('../sales-system/salesManager');
  const canalId = interaction.channel.id;
  const meta = metadadosPedido[canalId];
  if (!meta) return;
  const pedido = getPedido(canalId);
  const variante = resolverVarianteOuBase(interaction.guildId, pedido.varianteKey, meta);

  let estoqueTexto;
  const produtoDoPedido = meta.produtoId ? db.getProdutoPorId(interaction.guildId, meta.produtoId) : null;
  const produtoTemVariantes = produtoDoPedido && (produtoDoPedido.variantes || []).length > 0;
  if (!produtoTemVariantes && produtoDoPedido) {
    estoqueTexto = textoEstoque(getEstoqueProdutoSemVariante(produtoDoPedido));
  } else {
    estoqueTexto = textoEstoque(variante.estoque);
  }

  const embedRevisao = buildRevisaoEmbedPropria({
    user: interaction.user, nomeItem: meta.nomeItem, varianteNome: meta.varianteNome,
    estoqueTexto, dataCriacao: meta.dataCriacao,
    variante, pedido, guild: interaction.guild, produto: produtoDoPedido
  });
  const msgs = await interaction.channel.messages.fetch({ limit: 10 });
  const msgRevisao = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('Revisão'));
  if (msgRevisao) await msgRevisao.edit({ embeds: [embedRevisao], components: buildRevisaoComponentsPropria(pedido.varianteKey) });
}

async function abrirModalEditarQtdPropria(interaction) {
  const modal = new ModalBuilder().setCustomId('prod_var_modal_qtd').setTitle('Editar Quantidade');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('prod_var_input_qtd').setLabel('Quantidade desejada')
      .setStyle(TextInputStyle.Short).setPlaceholder('Ex: 2').setRequired(true).setMaxLength(3)
  ));
  await interaction.showModal(modal);
}

async function processarModalQtdPropria(interaction) {
  try {
    const { getPedido, getVarianteByKey } = require('../sales-system/salesManager');
    const qtdStr = interaction.fields.getTextInputValue('prod_var_input_qtd');
    const num = parseInt(qtdStr);
    if (isNaN(num) || num < 1) {
      return await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Quantidade inválida').setDescription('> Digite um número maior que 0.')], flags: 64 });
    }
    const pedido = getPedido(interaction.channel.id);
    const meta = metadadosPedido[interaction.channel.id];
    const variante = getVarianteByKey(interaction.guildId, pedido.varianteKey);

    // Validação de estoque real (array quando sem variante)
    const produtoDoPedido = meta?.produtoId ? db.getProdutoPorId(interaction.guildId, meta.produtoId) : null;
    const produtoTemVariantes = produtoDoPedido && (produtoDoPedido.variantes || []).length > 0;
    const limiteEstoque = !produtoTemVariantes && produtoDoPedido
      ? getEstoqueProdutoSemVariante(produtoDoPedido)
      : (variante?.estoque ?? null);

    if (limiteEstoque != null && num > limiteEstoque) {
      return await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Estoque insuficiente')
          .setDescription(`> Disponível: **${limiteEstoque}** unidade(s).\n> Quantidade solicitada: **${num}**.`)],
        flags: 64
      });
    }

    // Regras Avançadas: revalida quantidade mín/máx e valor mín/máx com a
    // nova quantidade (o valor total muda quando a quantidade muda).
    if (produtoDoPedido) {
      const { precoParaFloat } = require('../sales-system/salesManager');
      const precoUnitario = precoParaFloat(variante?.preco || produtoDoPedido.preco || '0.00');
      const validacao = validarCondicoesCompra(produtoDoPedido, interaction.member, num, precoUnitario * num);
      if (!validacao.ok) {
        return await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não é possível atualizar').setDescription(`> ${validacao.motivo}`)], flags: 64 });
      }
    }

    pedido.quantidade = num;
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Quantidade Atualizada').setDescription(`> Nova quantidade: **${num}x**`)],
      flags: 64
    });
    try {
      await atualizarEmbedRevisao(interaction);
    } catch (error) {
      console.error('[CARRINHO/QTD] Falha ao atualizar a embed de revisão:', error);
    }
  } catch (error) {
    console.error('[CARRINHO/QTD] Erro ao processar quantidade:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível atualizar').setDescription('> Ocorreu um erro ao atualizar a quantidade. Tente novamente.')],
        flags: 64
      });
    }
  }
}

async function abrirModalAplicarCupomPropria(interaction) {
  const modal = new ModalBuilder().setCustomId('prod_var_modal_cupom').setTitle('Aplicar Cupom de Desconto');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('prod_var_input_cupom').setLabel('Código do Cupom')
      .setStyle(TextInputStyle.Short).setPlaceholder('Ex: DESCONTO10').setRequired(true).setMaxLength(50)
  ));
  await interaction.showModal(modal);
}

async function processarModalCupomPropria(interaction) {
  try {
    const { getPedido, getVarianteByKey, calcularTotal, floatParaPreco } = require('../sales-system/salesManager');
    const codigo = interaction.fields.getTextInputValue('prod_var_input_cupom').toUpperCase().trim();
    const meta = metadadosPedido[interaction.channel.id];
    const produtoId = meta?.produtoId || null;
    const pedido = getPedido(interaction.channel.id);

    if (pedido.cupom) {
      return await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('⚠️ Já existe um cupom aplicado')
          .setDescription(`> Cupom atual: \`${pedido.cupom.codigo}\`.\n> Cancele a compra e crie um novo carrinho para trocar de cupom.`)],
        flags: 64
      });
    }

    // ── Fluxo LEGADO (produto sem produtoId) — mantém EXATAMENTE o
    // comportamento original, sem as condições avançadas, preservando 100%
    // de compatibilidade com servidores ainda não migrados para multi-produto.
    if (!produtoId) {
      const loja = getLoja(interaction.guildId);
      const cupons = loja.cupons || {};
      if (!cupons[codigo]) {
        return await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Cupom inválido').setDescription(`> O código \`${codigo}\` não existe ou expirou.`)], flags: 64 });
      }
      const cupomLegado = cupons[codigo];
      pedido.cupom = { codigo, desconto: cupomLegado.desconto };
      cupons[codigo].usos = (cupons[codigo].usos || 0) + 1;
      await db.updateGuild(interaction.guildId, 'loja.cupons', cupons);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:cupom:1524209015008002148> Cupom Aplicado!').setDescription(`> Código: \`${codigo}\`\n> Desconto: **${cupomLegado.desconto}%**`)],
        flags: 64
      });
      try {
        await atualizarEmbedRevisao(interaction);
      } catch (error) {
        console.error('[CARRINHO/CUPOM] Falha ao atualizar a embed de revisão:', error);
      }
      return;
    }

    // ── Produto atual (multi-produto) — Sistema de Cupons Avançados:
    // cargo obrigatório, validade, limite de usos, valor mín/máx, e
    // desconto percentual OU fixo. ──
    const cupomManager = require('../cupom-system/cupomManager');
    const variante = resolverVarianteOuBase(interaction.guildId, pedido.varianteKey, meta);
    const { subtotal } = calcularTotal(variante, pedido);

    const resultado = cupomManager.validarCupom({
      guildId: interaction.guildId, produtoId, codigo,
      member: interaction.member, valorCompra: subtotal,
    });

    if (!resultado.ok) {
      return await interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Cupom inválido').setDescription(`> ${resultado.motivo}`)], flags: 64 });
    }

    pedido.cupom = {
      codigo,
      desconto: resultado.cupom.desconto,
      tipo: resultado.cupom.tipo || 'percentual',
      valorFixo: resultado.cupom.valorFixo || 0,
    };
    cupomManager.registrarUso(interaction.guildId, produtoId, codigo);

    const descText = pedido.cupom.tipo === 'fixo'
      ? `**${floatParaPreco(pedido.cupom.valorFixo)}** de desconto`
      : `**${pedido.cupom.desconto}%** de desconto`;
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:cupom:1524209015008002148> Cupom Aplicado!').setDescription(`> Código: \`${codigo}\`\n> ${descText}`)],
      flags: 64
    });
    try {
      await atualizarEmbedRevisao(interaction);
    } catch (error) {
      console.error('[CARRINHO/CUPOM] Falha ao atualizar a embed de revisão:', error);
    }
  } catch (error) {
    console.error('[CARRINHO/CUPOM] Erro ao processar cupom:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível aplicar o cupom').setDescription('> Ocorreu um erro ao aplicar o cupom. Tente novamente.')],
        flags: 64
      });
    }
  }
}

// ─── TELA DE CONFIRMAÇÃO ANTES DE CRIAR CARRINHO ───────────────
async function mostrarConfirmacaoCompra(interaction, { produtoId, varianteKey, nomeItem, varianteNome, precoStr, thumbnailUrl, cargoId }) {
  const embedConfirmacao = buildConfirmacaoCompraEmbed({
    nomeItem, precoStr, cargoId, guild: interaction.guild
  });

  const varianteIdSafe = String(varianteKey).toLowerCase().replace(/\s/g, '_').slice(0, 30);
  const produtoIdSafe = (produtoId && produtoId !== 'undefined') ? String(produtoId) : 'prod_principal';
  const rowConfirmacao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmar_compra::${produtoIdSafe}::${varianteIdSafe}`)
      .setLabel('Aceitar e Gerar QR Code')
      .setEmoji('<:positivo:1528401238197276702>')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cancelar_confirmacao_compra')
      .setLabel('Cancelar')
      .setEmoji('<:negativo:1528400986744295475>')
      .setStyle(ButtonStyle.Danger)
  );

  return interaction.reply({
    embeds: [embedConfirmacao],
    components: [rowConfirmacao],
    flags: 64
  });
}

async function iniciarCompraDireta(interaction, produtoId) {
  const loja = getLoja(interaction.guildId);
  const produto = db.getProdutoPorId(interaction.guildId, produtoId) || (produtoId === 'prod_principal' ? loja.produto : null);
  if (!produto) return interaction.reply({ content: '<:negativo:1528400986744295475> Produto indisponível para compra.', flags: 64 });
  if (!pagamentoDisponivel(interaction.guildId)) return interaction.reply({ content: '<:negativo:1528400986744295475> Esta loja está com o sistema PIX em manutenção (nenhuma forma de pagamento configurada).', flags: 64 });
  const temVariantes = (produto.variantes || []).length > 0;
  if (!temVariantes && getEstoqueProdutoSemVariante(produto) <= 0) {
    return interaction.reply({ content: `<:negativo:1528400986744295475> **${produto.titulo}** está esgotado no momento.`, flags: 64 });
  }

  const { varianteToKey: normalizarKey, precoParaFloat } = require('../sales-system/salesManager');
  const varianteKey = normalizarKey(produto.titulo || produtoId);

  const validacao = validarCondicoesCompra(produto, interaction.member, 1, precoParaFloat(produto.preco || '0.00'));
  if (!validacao.ok) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não é possível comprar').setDescription(`> ${validacao.motivo}`)], flags: 64 });
  }

  return mostrarConfirmacaoCompra(interaction, {
    produtoId: produto.id || produtoId || 'prod_principal',
    varianteKey,
    nomeItem: produto.titulo || 'Produto',
    varianteNome: produto.titulo || 'Produto',
    precoStr: produto.preco || '0,00',
    thumbnailUrl: produto.thumbnail || produto.banner || null,
    cargoId: produto.cargoId || null
  });
}

async function iniciarCompraVariante(interaction) {
  const produtoId = interaction.customId.replace('cliente_comprar_variante_', '');
  const varianteValue = interaction.values[0];
  const varianteId = varianteValue.replace('compra_var_', '');
  const loja = getLoja(interaction.guildId);
  const produto = db.getProdutoPorId(interaction.guildId, produtoId);
  const variantes = produto ? (produto.variantes || []) : (loja.variantes || []);
  const variante = variantes.find(v => (v.id || v.nome.toLowerCase().replace(/\s/g, '_')) === varianteId);

  if (!variante) return interaction.reply({ content: '<:negativo:1528400986744295475> Esta variante não está mais disponível.', flags: 64 });
  if (!pagamentoDisponivel(interaction.guildId)) return interaction.reply({ content: '<:negativo:1528400986744295475> Esta loja está com o sistema PIX em manutenção (nenhuma forma de pagamento configurada).', flags: 64 });
  const estoqueDisp = variante.estoque;
  if (estoqueDisp != null && estoqueDisp <= 0) return interaction.reply({ content: `<:negativo:1528400986744295475> **${variante.nome}** está esgotada no momento.`, flags: 64 });

  const { precoParaFloat } = require('../sales-system/salesManager');
  const validacao = validarCondicoesCompra(produto, interaction.member, 1, precoParaFloat(variante.preco || '0.00'));
  if (!validacao.ok) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não é possível comprar').setDescription(`> ${validacao.motivo}`)], flags: 64 });
  }

  return mostrarConfirmacaoCompra(interaction, {
    produtoId: (produto ? produto.id : produtoId) || 'prod_principal',
    varianteKey: variante.id || varianteId,
    nomeItem: variante.nome,
    varianteNome: variante.nome,
    precoStr: variante.preco,
    thumbnailUrl: produto?.thumbnail || produto?.banner || null,
    cargoId: produto?.cargoId || null
  });
}

// ─── HANDLER DOS BOTÕES DE CONFIRMAÇÃO DE COMPRA ───────────────
async function processarConfirmacaoCompra(interaction, produtoId, varianteIdSafe) {
  const loja = getLoja(interaction.guildId);
  let produto = db.getProdutoPorId(interaction.guildId, produtoId);
  if (!produto && (produtoId === 'prod_principal' || produtoId === 'undefined' || !produtoId)) {
    produto = loja.produto || null;
  }
  if (!produto) {
    console.error('[Confirmação de Compra] Produto não encontrado. produtoId recebido:', JSON.stringify(produtoId), '| customId completo:', interaction.customId);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Produto não encontrado.').setDescription('> Tente iniciar a compra novamente.')],
      components: []
    });
  }

  const { varianteToKey: normalizarKey } = require('../sales-system/salesManager');
  const variantes = produto.variantes || [];
  const varianteIdSafeLower = String(varianteIdSafe).toLowerCase();

  let variante;
  if (variantes.length === 0) {
    // Produto SEM variantes cadastradas — não é erro nenhum, é o caminho
    // normal esperado. Vai direto pro preço base do produto, sem tentar
    // procurar por ID (não existe nada pra encontrar) e sem logar aviso.
    variante = { nome: produto.titulo || 'Produto', preco: produto.preco || '0.00', emoji: '<:carrinho:1524207445600370719>', estoque: null };
  } else {
    variante = variantes.find(v => {
      const vId = (v.id || v.nome.toLowerCase().replace(/\s/g, '_')).toLowerCase();
      return vId === varianteIdSafeLower;
    });

    if (!variante) {
      // Essa sim é uma anomalia real: o produto TEM variantes, mas o ID
      // recebido não bate com nenhuma delas (ex.: a variante foi
      // deletada entre o clique do cliente e a confirmação).
      console.warn('[Confirmação de Compra] Variante não encontrada por id, tentando fallback. varianteIdSafe:', JSON.stringify(varianteIdSafe), '| variantes disponíveis:', variantes.map(v => v.id || v.nome));
      const varianteKey = normalizarKey(produto.titulo || produtoId);
      variante = variantes.find(v => normalizarKey(v.nome) === varianteKey);
      if (!variante) {
        // CORREÇÃO (auditoria - bug de "variante fantasma"): antes, quando a
        // variante não era encontrada, o código criava uma variante nova em
        // memória E A SALVAVA no banco de dados (db.atualizarProduto /
        // db.updateGuild). Isso podia reintroduzir permanentemente uma
        // variante que o usuário já havia deletado, bastando alguém tentar
        // comprar o produto sem variantes reais configuradas. Agora o
        // objeto é usado apenas em memória, só para esta compra pontual,
        // e NUNCA é persistido no array de variantes do produto.
        variante = { nome: produto.titulo || 'Produto', preco: produto.preco || '0.00', emoji: '<:carrinho:1524207445600370719>', estoque: null };
      }
    }
  }

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COR.gold).setDescription('<a:carregarAnimado:1524207358367236319> **Criando carrinho...**\nAguarde alguns segundos.')],
    components: []
  });

  return criarCanalCompraEMostrarRevisao(interaction, {
    varianteKey: variante.nome,
    nomeItem: variante.nome,
    varianteNome: variante.nome,
    precoStr: variante.preco,
    produtoId: produto.id || null
  });
}

async function confirmarPagamentoVariante(interaction) {
  const { isAdmin, entregarAutomatico, getPedido } = require('../sales-system/salesManager');
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Apenas administradores podem confirmar pagamentos.')], flags: 64 });
  }
  const partes = interaction.customId.replace('prod_var_confirmar_', '').split('_');
  const canalId = partes.pop();
  const clienteId = partes.pop();
  const pedido = getPedido(canalId);
  const varianteKey = pedido.varianteKey;
  if (!varianteKey) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não foi possível identificar o item do pedido.').setDescription('> O canal de compra pode ter sido deletado ou o carrinho expirou.')], flags: 64 });
  }

  // KAEL — checagem otimista de estado: evita gastar um deferUpdate +
  // tentativa de entrega se a transação já foi fechada (cancelada pelo
  // cliente, expirada ou já paga por outra confirmação). A proteção real
  // (atômica) acontece dentro de entregarAutomatico — isto aqui é só pra
  // responder rápido e claro quando já dá pra saber de antemão.
  const transacaoManager = require('../sales-system/transacaoManager');
  const transacaoAntes = transacaoManager.getPorCanal(canalId);
  if (transacaoAntes && transacaoAntes.status !== 'PENDING') {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Esta transação já foi encerrada.')
        .setDescription(`> Status atual: \`${transacaoAntes.status}\`\n> Nenhuma nova entrega será realizada.`)],
      flags: 64
    }).catch(() => {});
  }

  await interaction.deferUpdate();
  const meta = metadadosPedido[canalId];
  if (pedido.mpPaymentId) {
    const { removerPagamento } = require('../sales-system/webhook');
    removerPagamento(pedido.mpPaymentId);
  }
  const resultadoEntrega = await entregarAutomatico({ client: interaction.client, guildId: interaction.guildId, clienteId, varianteKey, canalId, numeroPedido: meta?.numeroPedido, produtoId: meta?.produtoId });
  if (!resultadoEntrega || !resultadoEntrega.ok) {
    console.error('[Entrega][DIAGNOSTICO] entregarAutomatico falhou na confirmacao manual:', JSON.stringify(resultadoEntrega));
    const mensagemErro = resultadoEntrega?.motivo === 'transacao_nao_pendente'
      ? `<:negativo:1528400986744295475> Esta transação já não estava mais pendente (status: ${resultadoEntrega.statusAtual}) — a entrega NÃO foi realizada para evitar duplicidade/conflito.`
      : '<:negativo:1528400986744295475> A entrega NAO foi concluida (motivo: ' + (resultadoEntrega?.motivo || 'desconhecido') + '). Verifique os logs antes de considerar essa venda como entregue.';
    await interaction.followUp({ content: mensagemErro, flags: 64 }).catch(() => {});
  } else {
    await interaction.followUp({ content: '<:positivo:1528401238197276702> Entrega confirmada. Verifique sua DM.', flags: 64 }).catch(() => {});
  }
  try {
    const rowOff = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_var_confirmar_done').setLabel('Confirmado').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('prod_var_recusar_done').setLabel('Recusar Pagamento').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.message.edit({ components: [rowOff] }).catch(() => {});
  } catch (e) {}
  delete metadadosPedido[canalId];
}

async function recusarPagamentoVariante(interaction) {
  const { isAdmin, getCfg, resolverCanal } = require('../sales-system/salesManager');
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Apenas administradores podem recusar pagamentos.')], flags: 64 });
  }
  const partes = interaction.customId.replace('prod_var_recusar_', '').split('_');
  const canalId = partes.pop();
  const clienteId = partes.pop();

  // KAEL — transição atômica PENDING -> REFUSED. Se a transação já
  // tiver sido fechada por outro caminho (cliente cancelou, expirou, ou
  // já foi paga) enquanto este admin ia clicar, a transição falha e a
  // recusa é abortada — nunca sobrescreve um estado já encerrado.
  const transacaoManager = require('../sales-system/transacaoManager');
  const transacaoAntes = transacaoManager.getPorCanal(canalId);
  const recusou = transacaoManager.marcarRecusada(canalId, interaction.user.id);
  if (transacaoAntes && !recusou) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Esta transação já foi encerrada.')
        .setDescription(`> Status atual: \`${transacaoAntes.status}\`\n> Nenhuma ação adicional foi executada.`)],
      flags: 64
    }).catch(() => {});
  }
  try { require('../handlers/expiracaoScheduler').cancelarTimer(canalId); } catch (e) {}

  try {
    db.atualizarStatusCarrinhoPorCanal(canalId, 'cancelado');
  } catch (e) {
    console.error('[Kael Intelligence] Erro ao atualizar status do carrinho:', e.message);
  }
  const canalCompra = await resolverCanal(interaction.guild, canalId, 'Compra (canal temporário)');
  const meta = metadadosPedido[canalId];
  const itemTexto = meta ? `${meta.nomeItem}${meta.varianteNome && meta.varianteNome !== meta.nomeItem ? ` (${meta.varianteNome})` : ''}` : 'Item não identificado';
  const cfg = getCfg(interaction.guildId);

  const { getPedido } = require('../sales-system/salesManager');
  const pedidoRecusado = getPedido(canalId);
  if (pedidoRecusado?.mpPaymentId) {
    const { removerPagamento } = require('../sales-system/webhook');
    removerPagamento(pedidoRecusado.mpPaymentId);
  }
  try { db.atualizarStatusCarrinhoPorCanal(canalId, 'cancelado'); } catch (e) { console.error('[Kael Intelligence] Falha ao atualizar carrinho:', e.message); }

  await interaction.reply({ content: '<:negativo:1528400986744295475> Houve um problema com o pagamento. Aguarde o suporte.', flags: 64 });

  if (canalCompra) {
    await canalCompra.send({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Tivemos um problema na confirmação do pagamento.')
        .setDescription('> Aguarde a equipe analisar sua compra.')]
    }).catch(() => {});
  }

  if (cfg.canalLogsId) {
    const logs = await resolverCanal(interaction.guild, cfg.canalLogsId, 'Logs');
    logs?.send({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Pagamento Recusado')
        .setDescription(
          `<:user:1532137085081878558> **Cliente:** <@${clienteId}>\n` +
          `<:caixa:1524207165496099007> **Item:** ${itemTexto}\n` +
          `👮 **Recusado por:** <@${interaction.user.id}>\n` +
          `<:canal:1524207214791884890> **Canal:** <#${canalId}>\n` +
          `<:relogio:1524207889441357917> <t:${Math.floor(Date.now() / 1000)}:F>`
        ).setTimestamp()]
    }).catch(() => {});
  }

  try {
    const rowOff = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_var_confirmar_done').setLabel('Confirmar Pagamento').setEmoji('<:positivo:1528401238197276702>').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('prod_var_recusar_done').setLabel('Recusado').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.message.edit({ components: [rowOff] }).catch(() => {});
  } catch (e) {}
  // CORREÇÃO (vazamento de memória): este caminho (admin recusa o
  // pagamento) nunca limpava metadadosPedido — mais uma sobra que só
  // some quando o processo reinicia. O pedido terminou aqui.
  delete metadadosPedido[canalId];
}

// ─────────────────────────────────────────────────────────────────────
// KAEL — Cancelamento de carrinho com motivo opcional.
//
// O clique em "Cancelar Compra" NÃO cancela mais na hora: abre um Modal
// pedindo o motivo (opcional). O cancelamento de fato só acontece na
// submissão do modal (confirmarCancelamentoComMotivo), que faz a
// transição atômica PENDING -> CANCELLED, invalida o pagamento pendente,
// trava novos cliques e registra tudo no canal de logs — o motivo
// aparece SÓ nesse log administrativo, nunca em mensagens visíveis a
// outros clientes.
// ─────────────────────────────────────────────────────────────────────
async function abrirModalCancelarCompra(interaction) {
  const isCliente = interaction.channel.topic?.includes(interaction.user.id);
  const isStaff = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isCliente && !isStaff) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sem permissão.')], flags: 64 });
  }

  // Evita duplicidade: se o carrinho já foi encerrado (pago/cancelado/
  // expirado/recusado) antes mesmo de abrir o modal, nem mostra a tela —
  // já avisa de cara, sem permitir novo clique gerar ação nenhuma.
  const transacaoManager = require('../sales-system/transacaoManager');
  const transacaoAtual = transacaoManager.getPorCanal(interaction.channel.id);
  if (transacaoAtual && transacaoAtual.status !== 'PENDING') {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Este carrinho já foi encerrado.')
        .setDescription(`> Status atual: \`${transacaoAtual.status}\``)],
      flags: 64
    });
  }

  const modal = new ModalBuilder().setCustomId('prod_var_modal_cancelar').setTitle('Cancelar Carrinho');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('prod_var_motivo_cancelamento')
        .setLabel('Motivo do cancelamento (opcional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ex.: Estou sem dinheiro, desisti da compra...')
        .setRequired(false)
        .setMaxLength(300)
    )
  );
  return interaction.showModal(modal);
}

async function confirmarCancelamentoComMotivo(interaction) {
  const canalId = interaction.channel.id;
  const isCliente = interaction.channel.topic?.includes(interaction.user.id);
  const isStaff = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isCliente && !isStaff) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Sem permissão.')], flags: 64 });
  }

  const motivoBruto = interaction.fields.getTextInputValue('prod_var_motivo_cancelamento').trim();
  const motivo = motivoBruto.length > 0 ? motivoBruto : null; // motivo NUNCA é obrigatório

  const transacaoManager = require('../sales-system/transacaoManager');
  const { getPedido, limparPedido, getCfg, resolverCanal } = require('../sales-system/salesManager');

  const transacaoAntes = transacaoManager.getPorCanal(canalId);
  let transacaoAtual = transacaoAntes;

  if (transacaoAntes) {
    // Transição atômica PENDING -> CANCELLED. Se falhar, é porque o
    // carrinho já foi pago/cancelado/expirado/recusado por outro
    // processo enquanto o modal estava aberto — nunca cancela de novo
    // (evita duplicar o log e evita "cancelar" algo que já foi pago).
    const cancelou = transacaoManager.marcarCancelada(canalId, { motivo, canceladoPor: interaction.user.id });
    transacaoAtual = transacaoManager.getPorCanal(canalId);
    if (!cancelou) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Este carrinho já foi encerrado.')
          .setDescription(`> Status atual: \`${transacaoAtual?.status || 'desconhecido'}\`\n> Nenhuma ação adicional foi executada.`)],
        flags: 64
      }).catch(() => {});
    }
    try { require('../handlers/expiracaoScheduler').cancelarTimer(canalId); } catch (e) {}
  }
  // Se não havia transação rastreada (carrinho criado antes desta
  // atualização, ou ainda na etapa de Revisão — sem PIX gerado ainda),
  // segue com o cancelamento simples de sempre, sem máquina de estados.

  // ── Invalida qualquer pagamento pendente vinculado a esta transação ──
  try {
    if (transacaoAtual?.mp_payment_id) require('../sales-system/webhook').removerPagamento(transacaoAtual.mp_payment_id);
  } catch (e) {}
  try {
    if (transacaoAtual?.efi_txid) {
      const efiBank = require('../sales-system/efiBank');
      if (typeof efiBank.removerPendente === 'function') efiBank.removerPendente(transacaoAtual.efi_txid);
    }
  } catch (e) {}
  try {
    if (transacaoAtual?.c6_txid) {
      const c6Bank = require('../sales-system/c6Bank');
      if (typeof c6Bank.removerPendente === 'function') c6Bank.removerPendente(transacaoAtual.c6_txid);
    }
  } catch (e) {}
  try {
    if (transacaoAtual?.openpix_correlation_id) require('../sales-system/webhook').removerPagamentoOpenPix(transacaoAtual.openpix_correlation_id);
  } catch (e) {}
  const pedidoAtual = getPedido(canalId);
  if (pedidoAtual?.mpPaymentId) {
    try { require('../sales-system/webhook').removerPagamento(pedidoAtual.mpPaymentId); } catch (e) {}
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Carrinho cancelado').setDescription('> Sua compra foi cancelada com sucesso.')],
    flags: 64
  }).catch(() => {});

  // Trava novos cliques: desativa os botões da mensagem que abriu o modal.
  try {
    if (interaction.message) {
      const rowDesativada = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prod_var_cancelado_done').setLabel('Carrinho Cancelado').setEmoji('<:negativo:1528400986744295475>').setStyle(ButtonStyle.Danger).setDisabled(true)
      );
      await interaction.message.edit({ components: [rowDesativada] }).catch(() => {});
    }
  } catch (e) {}

  limparPedido(canalId);
  try { limparMetadadosPedido(canalId); } catch (e) {}
  try { db.atualizarStatusCarrinhoPorCanal(canalId, 'cancelado'); } catch (e) { console.error('[Kael Intelligence] Falha ao atualizar carrinho:', e.message); }

  // ── Log administrativo — o motivo aparece SÓ aqui, nunca no canal do cliente ──
  const cfg = getCfg(interaction.guildId);
  if (cfg.canalLogsId) {
    const logs = await resolverCanal(interaction.guild, cfg.canalLogsId, 'Logs');
    const agora = new Date();
    const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    logs?.send({
      content: `<@${interaction.user.id}>`,
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Carrinho cancelado')
        .setDescription(
          `<:user:1532137085081878558> **Cliente:** <@${interaction.user.id}>\n` +
          `<:canal:1524207214791884890> **Carrinho:** #${interaction.channel.name}\n` +
          `<:cupom:1524209015008002148> **Transação:** \`${transacaoAtual?.transacao_id || 'N/A'}\`\n` +
          `<:negativo:1528400986744295475> **Status:** Cancelado pelo cliente\n` +
          `💬 **Motivo:** ${motivo || 'Não informado'}\n` +
          `<:relogio:1524207889441357917> **Horário:** ${horaStr}`
        ).setTimestamp()]
    }).catch(() => {});
  }

  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

// Tela mostrada quando o servidor não tem NENHUM produto configurado
// (nunca criou um, ou deletou todos). Nunca cria produto sozinho.
function buildSemProdutoEmbed(guild) {
  return new EmbedBuilder()
    .setColor(COR.dark)
    .setAuthor({ name: '⚙️ Definições do Produto', iconURL: iconGuild(guild) })
    .setTitle('📭 Nenhum produto configurado')
    .setDescription('> Este servidor ainda não tem nenhum produto.\n> Clique em **<:mais2:1528400709018583100> Novo Produto** para criar o primeiro.')
    .setFooter(footerLoja(guild))
    .setTimestamp();
}

function buildSemProdutoComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_novo_produto').setLabel('Novo Produto').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('prod_painel_voltar').setLabel('Voltar ao Início').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
  )];
}

async function enviarPainel(interaction) {
  const produtos = db.getProdutos(interaction.guildId);
  if (produtos.length > 1) return abrirSeletorDeProdutoAtivo(interaction);
  if (produtos.length === 0) {
    return interaction.update({ embeds: [buildSemProdutoEmbed(interaction.guild)], components: buildSemProdutoComponents(), flags: 64 });
  }
  const produtoId = getProdutoAtivoId(interaction.guildId);
  return atualizar(interaction, 'produto', interaction.guildId, interaction.guild, produtoId);
}

// Registrado uma única vez: ensina o painelUpdater a reconstruir o
// painel de produto a partir do banco, reaproveitando exatamente os
// mesmos builders que o resto do arquivo já usa (buildPainelEmbed +
// buildPainelComponents) — nenhuma lógica nova, só centralização.
registrar('produto', (guildId, guild, produtoId) => ({
  embeds: [buildPainelEmbed(guildId, guild, produtoId)],
  components: buildPainelComponents(produtoId),
  flags: 64,
}));

async function abrirSeletorDeProdutoAtivo(interaction) {
  const produtos = db.getProdutos(interaction.guildId);
  const opcoes = produtos.slice(0, 25).map(p => ({
    label: (p.titulo || 'Produto sem nome').slice(0, 100),
    value: `prod_set_ativo_${p.id}`,
    description: `R$ ${p.preco || '0.00'} • ${(p.variantes || []).length} variante(s) • ${(p.estoque || []).length} em estoque`.slice(0, 100),
    emoji: '<:caixa:1524207165496099007>'
  }));
  const embed = new EmbedBuilder()
    .setColor(COR.gold)
    .setAuthor({ name: '<:caixa:1524207165496099007> Selecione o produto', iconURL: iconGuild(interaction.guild) })
    .setTitle('Qual produto você deseja editar?')
    .setDescription(`> Este servidor possui **${produtos.length}** produtos configurados.\n> Escolha qual deles você quer editar agora.`);
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('prod_sel_produto_ativo').setPlaceholder('<:arrow:1524206792626933831> Escolha o produto...').addOptions(opcoes)
  );
  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prod_novo_produto').setLabel('Novo Produto').setEmoji('<:mais2:1528400709018583100>').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('prod_painel_voltar').setLabel('Voltar ao Início').setStyle(ButtonStyle.Secondary).setEmoji({ name: 'voltar', id: '1528548726518448198' })
  );
  await interaction.update({ embeds: [embed], components: [row, rowAcoes], flags: 64 });
}

// CORRECAO (auditoria): extraido para funcao reutilizavel, para que o
// modal de edicao da chave PIX (prod_modal_pix) consiga reconstruir e
// EDITAR esta mesma mensagem depois de salvar, em vez de so responder
// com um texto efemero deixando o menu desatualizado.
function buildPagamentosEmbedComponents(guildId, guild) {
  const loja = getLoja(guildId);
  const produtoAtivoId = getProdutoAtivoId(guildId);
  const produtoAtivo = produtoAtivoId ? db.getProdutoPorId(guildId, produtoAtivoId) : null;
  const pixChave = loja.pix?.chave || 'Nenhuma chave PIX adicionada';
  const canalConf = loja.canalLogsId ? `<#${loja.canalLogsId}>` : '`Não configurado`';
  // BUGFIX: "Canal de Entregas" é salvo POR PRODUTO (produto.canalEntregasId),
  // não em loja.canalEntregasId (campo que nunca é escrito por nenhum
  // código) — por isso sempre aparecia "Não configurado" mesmo depois
  // de selecionar. Agora lê do produto ativo, de onde é salvo de verdade.
  const canalEntregasConf = produtoAtivo?.canalEntregasId ? `<#${produtoAtivo.canalEntregasId}>` : '`Não configurado (usando padrão)`';
  // Canal de Avaliações: se configurado, o botão "Ver Feedbacks" do
  // comprovante manda o cliente pra cá em vez de pro canal da vitrine.
  const canalAvaliacaoConf = produtoAtivo?.canalAvaliacaoId ? `<#${produtoAtivo.canalAvaliacaoId}>` : '`Não configurado (usando canal da vitrine)`';
  const canalRepostagemConf = loja.canalLojaId ? `<#${loja.canalLojaId}>` : '`Não configurado`';
  const embed = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(' CONFIGURAÇÃO FINANCEIRA')
    .setDescription(` **Chave PIX Atual:** \`${pixChave}\`\n📣 **Canal de Logs:** ${canalConf}\n<:caixa:1524207165496099007> **Canal de Entregas:** ${canalEntregasConf}\n💬 **Canal de Avaliações:** ${canalAvaliacaoConf}\n🔁 **Canal de Repostagem:** ${canalRepostagemConf}`)
    .setFooter(footerLoja(guild));
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_pag_pix').setLabel('Definir Chave PIX').setEmoji('<:pix:1528401197642551436>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('prod_pag_canal').setLabel('Definir Logs').setEmoji('📣').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('prod_pag_canal_entregas').setLabel('Configurar Canal de Entregas').setEmoji('<:caixa:1524207165496099007>').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('prod_pag_canal_repostagem').setLabel('Canal de Repostagem').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prod_pag_canal_avaliacao').setLabel('Canal de Avaliações').setEmoji('💬').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('prod_painel_voltar').setLabel('Voltar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary)
    ),
  ];
  return { embed, components };
}
                                                                   async function abrirModalMensagemPosVenda(interaction) {
 const produtoId = getProdutoAtivoId(interaction.guildId);
  const atual = produtoId ? (db.getProdutoPorId(interaction.guildId, produtoId)?.mensagemPosVenda || '') : '';
  const modal = new ModalBuilder().setCustomId(`prod_modal_mensagem_posvenda_${produtoId}`).setTitle(' Mensagem Pós-Venda');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('mensagem_posvenda_input')
      .setLabel('Mensagem enviada por DM após a entrega')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Ex: Obrigado pela compra! Se comprou uma conta, troque a senha em até 10 minutos...')
      .setValue(atual)
      .setMaxLength(1500)
      .setRequired(false)
  ));
  return interaction.showModal(modal);
}

async function abrirMenuPagamentos(interaction) {
  const { embed, components } = buildPagamentosEmbedComponents(interaction.guildId, interaction.guild);
  await interaction.update({ embeds: [embed], components, flags: 64 });
}

// ─── HANDLERS DE INTERAÇÃO ─────────────────────────────────────
async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'prod_menu_criar_loja')  return abrirSeletorParaEnviarVitrine(interaction);
  if (id === 'prod_menu_produtos')    return enviarPainel(interaction);
  if (id === 'prod_menu_pagamentos')  return abrirMenuPagamentos(interaction);
  if (id === 'prod_menu_mensagem_posvenda') return abrirModalMensagemPosVenda(interaction);
  if (id === 'prod_painel_voltar')    return enviarMenuPrincipal(interaction);

  if (id === 'cancelar_confirmacao_compra') {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Compra cancelada.').setDescription('> Sua compra foi cancelada com sucesso.')],
      components: []
    });
  }

  if (id.startsWith('confirmar_compra::')) {
    const partes = id.split('::');
    const produtoId = partes[1];
    const varianteIdSafe = partes[2];
    return processarConfirmacaoCompra(interaction, produtoId, varianteIdSafe);
  }

  if (id === 'prod_novo_produto') {
    const novo = db.criarProduto(interaction.guildId, {});
    db.setProdutoAtivoId(interaction.guildId, novo.id);
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, novo.id);
    return interaction.update({ embeds: [embed], components: buildPainelComponents(novo.id), flags: 64 });
  }
  if (id === 'prod_trocar_produto') {
    const produtos = db.getProdutos(interaction.guildId);
    if (produtos.length <= 1) return interaction.reply({ content: '> ℹ️ Você só tem 1 produto configurado. Use **<:mais2:1528400709018583100> Novo Produto** para criar outro.', flags: 64 });
    return abrirSeletorDeProdutoAtivo(interaction);
  }

  if (id.startsWith('cliente_comprar_direto_')) {
    const produtoId = id.replace('cliente_comprar_direto_', '');
    return iniciarCompraDireta(interaction, produtoId);
  }

  if (id === 'prod_var_cancelar')             return abrirModalCancelarCompra(interaction);
  if (id.startsWith('prod_var_confirmar_'))   return confirmarPagamentoVariante(interaction);
  if (id.startsWith('prod_var_recusar_'))     return recusarPagamentoVariante(interaction);
  if (id === 'prod_var_ir_pagamento')         return mostrarSelecaoPagamento(interaction);
  if (id === 'prod_var_editar_qtd')           return abrirModalEditarQtdPropria(interaction);
  if (id === 'prod_var_aplicar_cupom')        return abrirModalAplicarCupomPropria(interaction);
  if (id === 'prod_var_pagar_pix')            return gerarCheckoutPix(interaction);
  if (id === 'prod_var_pagar_cartao')         return interaction.reply({ content: '<:card:1533880211882381422> Pagamento via cartão estará disponível em breve.', flags: 64 });
  if (id === 'prod_var_voltar_revisao')       return voltarParaRevisao(interaction);

  if (id === 'prod_var_copiar_pix') {
    const { getPedido } = require('../sales-system/salesManager');
    const pedido = getPedido(interaction.channel.id);
    if (!pedido.pixCopiaCola) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Código PIX não disponível').setDescription('> Gere o pagamento novamente.')], flags: 64 });
    }
    const pixTxtAttachment = new AttachmentBuilder(Buffer.from(pedido.pixCopiaCola, 'utf-8'), { name: 'codigo-pix.txt' });
    return interaction.reply({ content: `${pedido.pixCopiaCola}`, files: [pixTxtAttachment], flags: 64 });
  }

  if (id === 'prod_pag_pix') {
    const pixAtual = getLoja(interaction.guildId).pix || {};
    const modal = new ModalBuilder().setCustomId('prod_modal_pix').setTitle('Definir Chave PIX');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_pix_chave').setLabel('CHAVE PIX:').setStyle(TextInputStyle.Short).setValue(pixAtual.chave || '').setRequired(true)),
    );
    return interaction.showModal(modal);
  }
  if (id === 'prod_pag_canal') {
    const select = new ChannelSelectMenuBuilder().setCustomId('prod_sel_canal_confirmacao').setPlaceholder('Selecione o canal de confirmação').setChannelTypes(ChannelType.GuildText);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id === 'prod_pag_canal_repostagem') {
    const select = new ChannelSelectMenuBuilder().setCustomId('prod_sel_canal_repostagem').setPlaceholder('Selecione o canal de repostagem automática').setChannelTypes(ChannelType.GuildText);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id === 'prod_pag_canal_entregas') {
    const produtos = db.getProdutos(interaction.guildId);
    if (produtos.length > 1) {
      const opcoes = produtos.slice(0, 25).map(p => ({
        label: (p.titulo || 'Produto sem nome').slice(0, 100),
        value: `prod_canalentrega_escolher_${p.id}`,
        description: p.canalEntregasId ? `Canal atual: definido` : 'Sem canal próprio (usa o padrão da loja)',
        emoji: '<:caixa:1524207165496099007>'
      }));
      const embed = new EmbedBuilder().setColor(COR.gold).setTitle('<:caixa:1524207165496099007> Para qual produto é este canal de entregas?')
        .setDescription('> Este servidor tem mais de 1 produto. Escolha para qual deles você quer definir o canal de entregas.');
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('prod_sel_produto_para_canal_entregas').setPlaceholder('<:arrow:1524206792626933831> Escolha o produto...').addOptions(opcoes)
      );
      return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }
    const produtoId = getProdutoAtivoId(interaction.guildId);
    const select = new ChannelSelectMenuBuilder().setCustomId(`prod_sel_canal_entregas_${produtoId}`).setPlaceholder('Selecione o canal de entregas').setChannelTypes(ChannelType.GuildText);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }

  // Canal de Avaliações: quando configurado, o botão "Ver Feedbacks" do
  // comprovante manda o cliente pra este canal em vez do canal da vitrine
  // (útil pra quem centraliza as avaliações num canal só, ex: vendendo em
  // vários servidores e querendo um só lugar de prova social por produto).
  if (id === 'prod_pag_canal_avaliacao') {
    const produtos = db.getProdutos(interaction.guildId);
    if (produtos.length > 1) {
      const opcoes = produtos.slice(0, 25).map(p => ({
        label: (p.titulo || 'Produto sem nome').slice(0, 100),
        value: `prod_canalavaliacao_escolher_${p.id}`,
        description: p.canalAvaliacaoId ? 'Canal atual: definido' : 'Sem canal próprio (usa o canal da vitrine)',
        emoji: '💬'
      }));
      const embed = new EmbedBuilder().setColor(COR.gold).setTitle('💬 Para qual produto é este canal de avaliações?')
        .setDescription('> Este servidor tem mais de 1 produto. Escolha para qual deles você quer definir o canal de avaliações.');
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('prod_sel_produto_para_canal_avaliacao').setPlaceholder('<:arrow:1524206792626933831> Escolha o produto...').addOptions(opcoes)
      );
      return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }
    const produtoIdAvaliacao = getProdutoAtivoId(interaction.guildId);
    const selectAvaliacao = new ChannelSelectMenuBuilder().setCustomId(`prod_sel_canal_avaliacao_${produtoIdAvaliacao}`).setPlaceholder('Selecione o canal de avaliações').setChannelTypes(ChannelType.GuildText);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(selectAvaliacao)], flags: 64 });
  }    

  if (id.startsWith('prod_editar_titulo_')) {
    const produtoId = id.replace('prod_editar_titulo_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_titulo_${produtoId}`).setTitle('Editar Nome');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_titulo_input').setLabel('NOME COMERCIAL:').setStyle(TextInputStyle.Short).setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.titulo || '').setRequired(true)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_editar_descricao_')) {
    const produtoId = id.replace('prod_editar_descricao_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_descricao_${produtoId}`).setTitle('Editar Descrição');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_descricao_input').setLabel('TEXTO DA EMBED:').setStyle(TextInputStyle.Paragraph).setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.descricao || '').setRequired(true).setMaxLength(2000)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_editar_preco_')) {
    const produtoId = id.replace('prod_editar_preco_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_preco_${produtoId}`).setTitle('Editar Preço');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_preco_input').setLabel('VALOR BASE:').setStyle(TextInputStyle.Short).setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.preco || '').setRequired(true)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_editar_banner_img_')) {
    const produtoId = id.replace('prod_editar_banner_img_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_banner_img_${produtoId}`).setTitle('Editar Banner');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_banner_img_input').setLabel('URL DA IMAGEM (BANNER):').setStyle(TextInputStyle.Short).setPlaceholder('Deixe vazio e envie pra remover o banner').setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.banner || '').setRequired(false)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_editar_thumbnail_')) {
    const produtoId = id.replace('prod_editar_thumbnail_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_thumbnail_${produtoId}`).setTitle('Editar Thumbnail');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_thumbnail_input').setLabel('URL DA IMAGEM (THUMBNAIL):').setStyle(TextInputStyle.Short).setPlaceholder('Deixe vazio e envie pra remover a thumbnail').setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.thumbnail || '').setRequired(false)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_editar_footer_')) {
    const produtoId = id.replace('prod_editar_footer_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_editar_footer_${produtoId}`).setTitle('Editar Rodapé');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_footer_input').setLabel('TEXTO DO RODAPÉ:').setStyle(TextInputStyle.Short).setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.footer || '').setRequired(true)));
    return interaction.showModal(modal);
  }
  // Cor da Embed: cor lateral do embed da vitrine pública (a barrinha
  // colorida do lado esquerdo). Aceita hex com ou sem "#" (ex: FFFFFF).
  // Campo opcional: vazio = volta pro branco padrão.
  if (id.startsWith('prod_cor_embed_')) {
    const produtoId = id.replace('prod_cor_embed_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_cor_embed_${produtoId}`).setTitle('Cor da Embed');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_cor_embed_input').setLabel('COR EM HEX (ex: FFFFFF):').setStyle(TextInputStyle.Short).setPlaceholder('Deixe vazio e envie para voltar ao branco padrão').setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.corEmbed || '').setMaxLength(7).setRequired(false)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_cor_botao_')) {
    const produtoId = id.replace('prod_cor_botao_', '');
    const select = new StringSelectMenuBuilder().setCustomId(`prod_sel_cor_botao_${produtoId}`).setPlaceholder('Escolha a cor do botão público')
      .addOptions([{ label: 'Vermelho', value: 'Danger' }, { label: 'Azul', value: 'Primary' }, { label: 'Verde', value: 'Success' }, { label: 'Cinza', value: 'Secondary' }]);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id.startsWith('prod_estoque_add_')) {
    const produtoId = id.replace('prod_estoque_add_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_estoque_add_${produtoId}`).setTitle('Injetar Estoque');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_estoque_input').setLabel('UM ITEM POR LINHA:').setStyle(TextInputStyle.Paragraph).setRequired(true)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_estoque_ver_')) {
    const produtoId = id.replace('prod_estoque_ver_', '');
    const estoque = db.getProdutoPorId(interaction.guildId, produtoId)?.estoque || [];
    if (estoque.length === 0) return interaction.reply({ content: '<:negativo:1528400986744295475> O estoque está vazio.', flags: 64 });
    return interaction.reply({ content: `<:caixa:1524207165496099007> **Itens em Estoque (${estoque.length} total):**\n${estoque.slice(0, 15).map((e, i) => `\`${i+1}.\` ${e}`).join('\n')}${estoque.length > 15 ? `\n\n> ...e mais ${estoque.length - 15} item(ns).` : ''}`, flags: 64 });
  }
  if (id.startsWith('prod_estoque_limpar_')) {
    const produtoId = id.replace('prod_estoque_limpar_', '');
    db.atualizarProduto(interaction.guildId, produtoId, 'estoque', []);
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
    await interaction.update({ content: '<:apagar:1524206738885050388> Todo o estoque do produto foi limpo.', embeds: [embed], components: buildPainelComponents(produtoId), flags: 64 });
    return atualizarVitrinePublicada(interaction.client, interaction.guildId, produtoId);
  }
  if (id.startsWith('prod_atalho_cupons_')) {
    const produtoId = id.replace('prod_atalho_cupons_', '');
    db.setProdutoAtivoId(interaction.guildId, produtoId);
    const cupomManager = require('../cupom-system/cupomManager');
    return cupomManager.showAdminPanel(interaction);
  }
  if (id.startsWith('prod_btn_avancado_')) {
    const produtoId = id.replace('prod_btn_avancado_', '');
    return interaction.update({
      embeds: [buildAvancadoEmbed(interaction.guildId, interaction.guild, produtoId)],
      components: buildAvancadoComponents(produtoId),
      flags: 64
    });
  }
  if (id.startsWith('prod_modal_precocomp_')) {
    const produtoId = id.replace('prod_modal_precocomp_', '');
    const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.precoComparacao || '';
    const modal = new ModalBuilder().setCustomId(`prod_modal_precocomp_submit_${produtoId}`).setTitle('Preço De/Por');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('precocomp_input').setLabel('PREÇO "DE" (vazio = remover):').setStyle(TextInputStyle.Short).setValue(atual).setPlaceholder('Ex: 50,00').setRequired(false)
    ));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_modal_condicoes_')) {
    const produtoId = id.replace('prod_modal_condicoes_', '');
    const cond = db.getProdutoPorId(interaction.guildId, produtoId)?.condicoes || {};
    const modal = new ModalBuilder().setCustomId(`prod_modal_condicoes_submit_${produtoId}`).setTitle('Condições de Compra');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('valorMin').setLabel('Valor mínimo em R$ (vazio = sem limite):').setStyle(TextInputStyle.Short).setValue(cond.valorMinimo != null ? String(cond.valorMinimo) : '').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('valorMax').setLabel('Valor máximo em R$ (vazio = sem limite):').setStyle(TextInputStyle.Short).setValue(cond.valorMaximo != null ? String(cond.valorMaximo) : '').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qtdMin').setLabel('Quantidade mínima (vazio = sem limite):').setStyle(TextInputStyle.Short).setValue(cond.quantidadeMinima != null ? String(cond.quantidadeMinima) : '').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qtdMax').setLabel('Quantidade máxima (vazio = sem limite):').setStyle(TextInputStyle.Short).setValue(cond.quantidadeMaxima != null ? String(cond.quantidadeMaxima) : '').setRequired(false)),
    );
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_sel_cargobloq_')) {
    const produtoId = id.replace('prod_sel_cargobloq_', '');
    const select = new RoleSelectMenuBuilder().setCustomId(`prod_roleselect_cargobloq_${produtoId}`).setPlaceholder('Selecione os cargos que NÃO podem comprar').setMinValues(0).setMaxValues(10);
    return interaction.reply({ content: '🚫 Selecione os cargos bloqueados (substitui a lista atual):', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id.startsWith('prod_sel_cargospos_add_')) {
    const produtoId = id.replace('prod_sel_cargospos_add_', '');
    const select = new RoleSelectMenuBuilder().setCustomId(`prod_roleselect_cargospos_add_${produtoId}`).setPlaceholder('Selecione os cargos a ADICIONAR na entrega').setMinValues(0).setMaxValues(10);
    return interaction.reply({ content: '<:mais2:1528400709018583100> Selecione os cargos a adicionar pós-compra (substitui a lista atual):', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id.startsWith('prod_sel_cargospos_rem_')) {
    const produtoId = id.replace('prod_sel_cargospos_rem_', '');
    const select = new RoleSelectMenuBuilder().setCustomId(`prod_roleselect_cargospos_rem_${produtoId}`).setPlaceholder('Selecione os cargos a REMOVER na entrega').setMinValues(0).setMaxValues(10);
    return interaction.reply({ content: '➖ Selecione os cargos a remover pós-compra (substitui a lista atual):', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }
  if (id.startsWith('prod_toggle_assinatura_')) {
    const produtoId = id.replace('prod_toggle_assinatura_', '');
    const p = db.getProdutoPorId(interaction.guildId, produtoId) || {};
    const atual = p.assinatura || { ativa: false, duracaoDias: 30, vipAtivado: false };
    db.atualizarProduto(interaction.guildId, produtoId, 'assinatura', { ...atual, ativa: !atual.ativa });
    return interaction.update({
      embeds: [buildAvancadoEmbed(interaction.guildId, interaction.guild, produtoId)],
      components: buildAvancadoComponents(produtoId),
      flags: 64
    });
  }
  if (id.startsWith('prod_modal_assinatura_')) {
    const produtoId = id.replace('prod_modal_assinatura_', '');
    const p = db.getProdutoPorId(interaction.guildId, produtoId) || {};
    const atual = p.assinatura || { duracaoDias: 30, vipAtivado: false };
    const modal = new ModalBuilder().setCustomId(`prod_modal_assinatura_submit_${produtoId}`).setTitle('Configurar Assinatura');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duracaoDias').setLabel('Duração em dias:').setStyle(TextInputStyle.Short).setValue(String(atual.duracaoDias || 30)).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vipAtivado').setLabel('VIP habilitado? (sim/nao):').setStyle(TextInputStyle.Short).setValue(atual.vipAtivado ? 'sim' : 'nao').setRequired(true)),
    );
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_btn_cargo_')) {
    const produtoId = id.replace('prod_btn_cargo_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_cargo_${produtoId}`).setTitle('Configurar Cargo');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prod_cargo_id_input').setLabel('ID DO CARGO:').setStyle(TextInputStyle.Short).setValue(db.getProdutoPorId(interaction.guildId, produtoId)?.cargoId || '')));
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_deletar_confirm_')) {
    const produtoId = id.replace('prod_deletar_confirm_', '');
    const produto = db.getProdutoPorId(interaction.guildId, produtoId);
    const nomeProduto = produto?.titulo || 'este produto';
    const embedConfirm = new EmbedBuilder()
      .setColor(COR.danger)
      .setTitle('⚠️ Confirmar exclusão')
      .setDescription(`> Tem certeza que deseja apagar **${nomeProduto}**?\n> Estoque, variantes e cupons deste produto serão perdidos. Esta ação não pode ser desfeita.`);
    const rowConfirm = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prod_deletar_executar_${produtoId}`).setLabel('Sim, apagar').setEmoji('<:apagar:1524206738885050388>').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`prod_voltar_painel_produto_${produtoId}`).setLabel('Cancelar').setEmoji({ name: 'voltar', id: '1528548726518448198' }).setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embedConfirm], components: [rowConfirm], flags: 64 });
  }
  if (id.startsWith('prod_deletar_executar_')) {
    const produtoId = id.replace('prod_deletar_executar_', '');
    // CORREÇÃO (auditoria): antes de apagar o produto do banco, captura o
    // rastreamento da vitrine publicada para poder remover a mensagem
    // pública também — o produto não existe mais, então a vitrine não
    // pode continuar disponível para compra.
    const produtoAntesDeApagar = db.getProdutoPorId(interaction.guildId, produtoId);
    const vitrineCanalId = produtoAntesDeApagar?.vitrineCanalId || null;
    const vitrineMsgId = produtoAntesDeApagar?.vitrineMsgId || null;

    db.deletarProduto(interaction.guildId, produtoId);

    if (vitrineCanalId && vitrineMsgId) {
      try {
        const canalVitrine = interaction.guild.channels.cache.get(vitrineCanalId)
          || await interaction.guild.channels.fetch(vitrineCanalId).catch(() => null);
        const msgVitrine = canalVitrine ? await canalVitrine.messages.fetch(vitrineMsgId).catch(() => null) : null;
        if (msgVitrine) {
          await msgVitrine.edit({
            embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Produto Indisponível')
              .setDescription('> Este produto foi removido pela loja e não está mais disponível para compra.')],
            components: []
          }).catch(() => {});
        }
      } catch (e) { console.error('[Vitrine] Falha ao atualizar vitrine após deletar produto:', e.message); }
    }

    const produtosRestantes = db.getProdutos(interaction.guildId);
    if (produtosRestantes.length === 0) {
      return interaction.update({ embeds: [buildSemProdutoEmbed(interaction.guild)], components: buildSemProdutoComponents(), flags: 64 });
    }
    if (produtosRestantes.length > 1) return abrirSeletorDeProdutoAtivo(interaction);
    const novoAtivoId = getProdutoAtivoId(interaction.guildId);
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, novoAtivoId);
    return interaction.update({ embeds: [embed], components: buildPainelComponents(novoAtivoId), flags: 64 });
  }
  if (id.startsWith('prod_btn_variantes_')) {
    const produtoId = id.replace('prod_btn_variantes_', '');
    const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];
    const lista = variantes.length === 0 ? '> Nenhuma variante ativa.' : variantes.map((v, i) => {
      const emojiTxt = v.emoji ? `${v.emoji} ` : '';
      const estoqueTxt = v.estoque != null ? `${v.estoque}` : '∞';
      return `🔹 ${emojiTxt}\`${v.nome}\` — R$ ${formatarPrecoVariante(v.preco)} — Estoque: ${estoqueTxt}`;
    }).join('\n');
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('<:config2:1524208021071462533> SUB-VARIANTES DO PRODUTO').setDescription(lista)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`prod_variante_add_${produtoId}`).setLabel('Adicionar').setStyle(ButtonStyle.Success).setEmoji('<:mais2:1528400709018583100>'),
        new ButtonBuilder().setCustomId(`prod_variante_editar_${produtoId}`).setLabel('Editar').setStyle(ButtonStyle.Primary).setEmoji('<:editar:1528400388137549864>'),
        new ButtonBuilder().setCustomId(`prod_variante_remover_${produtoId}`).setLabel('Remover').setStyle(ButtonStyle.Danger).setEmoji('<:apagar:1524206738885050388>'),
        new ButtonBuilder().setCustomId(`prod_voltar_painel_produto_${produtoId}`).setLabel('Voltar ao Painel').setStyle(ButtonStyle.Secondary).setEmoji({ name: 'voltar', id: '1528548726518448198' })
      )],
      flags: 64
    });
  }
  if (id.startsWith('prod_voltar_painel_produto_')) {
    const produtoId = id.replace('prod_voltar_painel_produto_', '');
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
    return interaction.update({ embeds: [embed], components: buildPainelComponents(produtoId), flags: 64 });
  }
  if (id.startsWith('prod_variante_add_')) {
    const produtoId = id.replace('prod_variante_add_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_variante_add_${produtoId}`).setTitle('Criar Variante');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_nome').setLabel('NOME DA VARIANTE:').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_preco').setLabel('PREÇO DA VARIANTE:').setStyle(TextInputStyle.Short).setRequired(true)),
      // Mesmo componente de estoque do produto principal (prod_estoque_add_):
      // campo de texto multilinha, 1 item por linha. Vazio = ilimitado.
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_estoque_itens').setLabel('UM ITEM POR LINHA:').setStyle(TextInputStyle.Paragraph).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_emoji').setLabel('URL DA IMAGEM (Opcional):').setStyle(TextInputStyle.Short).setPlaceholder('https://exemplo.com/imagem.png').setRequired(false).setMaxLength(300)),
    );
    return interaction.showModal(modal);
  }
  if (id.startsWith('prod_variante_editar_')) {
    const produtoId = id.replace('prod_variante_editar_', '');
    const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];
    if (variantes.length === 0) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Nenhuma variante para editar.')],
        flags: 64
      });
    }
    const options = variantes.slice(0, 25).map(v => ({
      label: v.nome.slice(0, 100),
      value: (v.id || v.nome.toLowerCase().replace(/\s/g, '_')).slice(0, 100),
      description: `R$ ${formatarPrecoVariante(v.preco)} • ${v.estoque ?? 0} item(ns)`.slice(0, 100),
      emoji: parseEmojiParaOption(v.emoji) || { name: 'caixa', id: '1524207165496099007' },
    }));
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('<:editar:1528400388137549864> Qual variante você quer editar?')],
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`prod_sel_variante_editar_${produtoId}`).setPlaceholder('<:arrow:1524206792626933831> Selecione a variante...').addOptions(options)
      )],
      flags: 64
    });
  }
  if (id.startsWith('prod_variante_remover_')) {
    const produtoId = id.replace('prod_variante_remover_', '');
    const modal = new ModalBuilder().setCustomId(`prod_modal_variante_remover_${produtoId}`).setTitle('Remover Variante');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('v_nome_remover').setLabel('NOME DA VARIANTE A REMOVER:').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
    ));
    return interaction.showModal(modal);
  }
}

async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  if (id === 'loja_selecionar_postar_produto') {
    const produtoId = interaction.values[0].replace('enviar_vitrine_', '');
    return postarEmbedProdutoNoCanal(interaction, produtoId);
  }
  if (id.startsWith('prod_sel_variante_editar_')) {
    const produtoId = id.replace('prod_sel_variante_editar_', '');
    const varianteId = interaction.values[0];
    const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];
    const v = variantes.find(x => (x.id || x.nome.toLowerCase().replace(/\s/g, '_')) === varianteId);
    if (!v) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante não encontrada.')],
        flags: 64
      });
    }
    const itensAtuais = Array.isArray(v.itensEstoque) ? v.itensEstoque.join('\n') : '';
    const modal = new ModalBuilder().setCustomId(`prod_modal_variante_editar_${produtoId}::${varianteId}`).setTitle('Editar Variante');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_novo_nome').setLabel('NOME DA VARIANTE:').setStyle(TextInputStyle.Short).setRequired(true).setValue(v.nome)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_novo_preco').setLabel('PREÇO DA VARIANTE:').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(v.preco ?? ''))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_novo_estoque_itens').setLabel('UM ITEM POR LINHA:').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(itensAtuais)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_novo_emoji').setLabel('URL DA IMAGEM (vazio = mantém atual):').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder('https://... | "remover" apaga a imagem')),
    );
    return interaction.showModal(modal);
  }
  if (id === 'prod_sel_produto_ativo') {
    const produtoId = interaction.values[0].replace('prod_set_ativo_', '');
    db.setProdutoAtivoId(interaction.guildId, produtoId);
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
    return interaction.update({ embeds: [embed], components: buildPainelComponents(produtoId), flags: 64 });
  }
  if (id === 'prod_sel_canal_confirmacao') {
    await db.updateGuild(interaction.guildId, 'loja.canalLogsId', interaction.values[0]);
    return interaction.reply({ content: '<:positivo:1528401238197276702> Canal de auditoria atualizado com sucesso.', flags: 64 });
  }
  if (id === 'prod_sel_canal_repostagem') {
    await db.updateGuild(interaction.guildId, 'loja.canalLojaId', interaction.values[0]);
    return interaction.reply({ content: `<:positivo:1528401238197276702> Canal de repostagem automática definido para <#${interaction.values[0]}>.`, flags: 64 });
  }
  if (id === 'prod_sel_produto_para_canal_entregas') {
    const produtoId = interaction.values[0].replace('prod_canalentrega_escolher_', '');
    const select = new ChannelSelectMenuBuilder().setCustomId(`prod_sel_canal_entregas_${produtoId}`).setPlaceholder('Selecione o canal de entregas').setChannelTypes(ChannelType.GuildText);
    return interaction.update({ components: [new ActionRowBuilder().addComponents(select)] });
  }
  if (id.startsWith('prod_sel_canal_entregas_')) {
    const produtoId = id.replace('prod_sel_canal_entregas_', '');
    db.atualizarProduto(interaction.guildId, produtoId, 'canalEntregasId', interaction.values[0]);
    return interaction.reply({ content: `<:positivo:1528401238197276702> Canal de entregas definido para <#${interaction.values[0]}>.`, flags: 64 });
  }
  if (id === 'prod_sel_produto_para_canal_avaliacao') {
    const produtoId = interaction.values[0].replace('prod_canalavaliacao_escolher_', '');
    const select = new ChannelSelectMenuBuilder().setCustomId(`prod_sel_canal_avaliacao_${produtoId}`).setPlaceholder('Selecione o canal de avaliações').setChannelTypes(ChannelType.GuildText);
    return interaction.update({ components: [new ActionRowBuilder().addComponents(select)] });
  }
  if (id.startsWith('prod_sel_canal_avaliacao_')) {
    const produtoId = id.replace('prod_sel_canal_avaliacao_', '');
    db.atualizarProduto(interaction.guildId, produtoId, 'canalAvaliacaoId', interaction.values[0]);
    return interaction.reply({ content: `<:positivo:1528401238197276702> Canal de avaliações definido para <#${interaction.values[0]}>. O botão "Ver Feedbacks" do comprovante agora manda o cliente pra lá.`, flags: 64 });
  }                                                                          
  if (id.startsWith('prod_sel_cor_botao_')) {
    const produtoId = id.replace('prod_sel_cor_botao_', '');
    db.atualizarProduto(interaction.guildId, produtoId, 'corBotao', interaction.values[0]);
    await interaction.reply({ content: `🎨 Cor ajustada para \`${interaction.values[0]}\`.`, flags: 64 });
    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 15 });
      const msgPainel = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds[0]?.title?.includes('PRODUTO ATUAL'));
      if (msgPainel) {
        const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
        await msgPainel.edit({ embeds: [embed], components: buildPainelComponents(produtoId) });
      }
    } catch (e) { console.error('[Painel] Falha ao atualizar painel após cor:', e.message); }
    await atualizarVitrinePublicada(interaction.client, interaction.guildId, produtoId);
    return;
  }
  if (id.startsWith('cliente_comprar_variante')) {
    return iniciarCompraVariante(interaction);
  }
  if (id.startsWith('prod_roleselect_cargobloq_')) {
    const produtoId = id.replace('prod_roleselect_cargobloq_', '');
    const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.condicoes || {};
    db.atualizarProduto(interaction.guildId, produtoId, 'condicoes', { ...atual, cargosBloqueados: interaction.values });
    return interaction.update({ content: `<:positivo:1528401238197276702> Cargos bloqueados atualizados (\`${interaction.values.length}\` cargo(s)).`, components: [] });
  }
  if (id.startsWith('prod_roleselect_cargospos_add_')) {
    const produtoId = id.replace('prod_roleselect_cargospos_add_', '');
    const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.cargosPosCompra || { adicionar: [], remover: [] };
    db.atualizarProduto(interaction.guildId, produtoId, 'cargosPosCompra', { ...atual, adicionar: interaction.values });
    return interaction.update({ content: `<:positivo:1528401238197276702> Cargos para adicionar pós-compra atualizados (\`${interaction.values.length}\` cargo(s)).`, components: [] });
  }
  if (id.startsWith('prod_roleselect_cargospos_rem_')) {
    const produtoId = id.replace('prod_roleselect_cargospos_rem_', '');
    const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.cargosPosCompra || { adicionar: [], remover: [] };
    db.atualizarProduto(interaction.guildId, produtoId, 'cargosPosCompra', { ...atual, remover: interaction.values });
    return interaction.update({ content: `<:positivo:1528401238197276702> Cargos para remover pós-compra atualizados (\`${interaction.values.length}\` cargo(s)).`, components: [] });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  // Atualiza ao vivo a mensagem original do painel (a que o usuário está
  // vendo) sempre que um modal salva uma alteração de produto. Como
  // modais não sabem qual mensagem os abriu, buscamos a última mensagem
  // do próprio bot no canal que seja um painel de produto reconhecível
  // pelo título. Silenciosa em caso de falha (nunca quebra o fluxo do
  // reply principal do modal).
  async function atualizarPainelAposModal(produtoId) {
    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 15 });
      const msgPainel = msgs.find(m =>
        m.author.id === interaction.client.user.id &&
        m.embeds[0]?.title?.includes('PRODUTO ATUAL')
      );
      if (msgPainel) {
        const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
        await msgPainel.edit({ embeds: [embed], components: buildPainelComponents(produtoId) });
      }
    } catch (e) {
      console.error('[Painel] Falha ao atualizar painel ao vivo após modal:', e.message);
    }
    // CORREÇÃO (auditoria): toda alteração salva por modal (nome, preço,
    // descrição, banner, thumbnail, footer, estoque, variantes) também
    // sincroniza a vitrine pública já publicada (mesma mensagem, sem
    // duplicar), se existir uma.
    await atualizarVitrinePublicada(interaction.client, interaction.guildId, produtoId);
  }

  try {
    if (id === 'prod_var_modal_qtd')   return processarModalQtdPropria(interaction);
    if (id === 'prod_var_modal_devedor_c6') return handleModalDevedorC6(interaction);
    if (id === 'prod_var_modal_cancelar') return confirmarCancelamentoComMotivo(interaction);

    if (id.startsWith('prod_modal_mensagem_posvenda_')) {
      const produtoId = id.replace('prod_modal_mensagem_posvenda_', '');
      const valor = interaction.fields.getTextInputValue('mensagem_posvenda_input').trim();
      db.atualizarProduto(interaction.guildId, produtoId, 'mensagemPosVenda', valor || null);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Mensagem Pós-Venda salva')
          .setDescription(valor ? '> Ela será enviada por DM logo após cada entrega.' : '> Mensagem removida — nada será enviado nessa etapa.')],
        flags: 64
      });
    }
    if (id === 'prod_var_modal_cupom') return processarModalCupomPropria(interaction);

    if (id === 'prod_modal_pix') {
      const chave = interaction.fields.getTextInputValue('prod_pix_chave').trim();
      await db.updateGuild(interaction.guildId, 'loja.pix.chave', chave);
      // Nome/Cidade não são mais pedidos aqui — gerarPixEstatico() já usa
      // 'LOJA'/'SAO PAULO' como padrão automático quando não configurados,
      // então o PIX continua funcionando normalmente sem esses campos.
      await interaction.reply({ content: '<:positivo:1528401238197276702> Registro PIX atualizado.', flags: 64 });
      // CORREÇÃO (auditoria): edita a MESMA mensagem "<:money:1532503308961448096> CONFIGURAÇÃO
      // FINANCEIRA" já existente no canal em vez de deixá-la com a chave
      // PIX antiga (nunca cria uma mensagem nova/duplicada).
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 15 });
        const msgPagamentos = msgs.find(m =>
          m.author.id === interaction.client.user.id &&
          m.embeds[0]?.title?.includes('CONFIGURAÇÃO FINANCEIRA')
        );
        if (msgPagamentos) {
          const { embed, components } = buildPagamentosEmbedComponents(interaction.guildId, interaction.guild);
          await msgPagamentos.edit({ embeds: [embed], components });
        }
      } catch (e) {
        console.error('[Painel] Falha ao atualizar menu de pagamentos após editar PIX:', e.message);
      }
      return;
    }
    if (id.startsWith('prod_modal_editar_titulo_')) {
      const produtoId = id.replace('prod_modal_editar_titulo_', '');
      db.atualizarProduto(interaction.guildId, produtoId, 'titulo', interaction.fields.getTextInputValue('prod_titulo_input').trim());
      await interaction.reply({ content: '<:positivo:1528401238197276702> Atributo nome atualizado.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_editar_descricao_')) {
      const produtoId = id.replace('prod_modal_editar_descricao_', '');
      db.atualizarProduto(interaction.guildId, produtoId, 'descricao', interaction.fields.getTextInputValue('prod_descricao_input').trim());
      await interaction.reply({ content: '<:positivo:1528401238197276702> Atributo descrição salvo.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_editar_preco_')) {
      const produtoId = id.replace('prod_modal_editar_preco_', '');
      db.atualizarProduto(interaction.guildId, produtoId, 'preco', interaction.fields.getTextInputValue('prod_preco_input').trim());
      await interaction.reply({ content: '<:positivo:1528401238197276702> Atributo preço salvo.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_editar_banner_img_')) {
      const produtoId = id.replace('prod_modal_editar_banner_img_', '');
      const urlDigitada = interaction.fields.getTextInputValue('prod_banner_img_input').trim();

      if (urlDigitada === '') {
        db.atualizarProduto(interaction.guildId, produtoId, 'banner', null);
        await atualizarPainelAposModal(produtoId);
        return interaction.reply({ content: '<:positivo:1528401238197276702> Banner removido.', flags: 64 });
      }

      const resultado = validarUrlImagem(urlDigitada);
      if (!resultado.valido) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> URL inválida').setDescription(resultado.mensagemErro)],
          flags: 64
        });
      }
      db.atualizarProduto(interaction.guildId, produtoId, 'banner', urlDigitada);
      await atualizarPainelAposModal(produtoId);
      if (resultado.aviso) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('⚠️ Banner salvo, mas confira o link').setDescription(resultado.aviso)],
          flags: 64
        });
      }
      return interaction.reply({ content: '<:positivo:1528401238197276702> Banner atualizado com sucesso.', flags: 64 });
    }
    if (id.startsWith('prod_modal_editar_thumbnail_')) {
      const produtoId = id.replace('prod_modal_editar_thumbnail_', '');
      const urlDigitada = interaction.fields.getTextInputValue('prod_thumbnail_input').trim();

      if (urlDigitada === '') {
        db.atualizarProduto(interaction.guildId, produtoId, 'thumbnail', null);
        await atualizarPainelAposModal(produtoId);
        return interaction.reply({ content: '<:positivo:1528401238197276702> Thumbnail removida.', flags: 64 });
      }

      const resultado = validarUrlImagem(urlDigitada);
      if (!resultado.valido) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> URL inválida').setDescription(resultado.mensagemErro)],
          flags: 64
        });
      }
      db.atualizarProduto(interaction.guildId, produtoId, 'thumbnail', urlDigitada);
      await atualizarPainelAposModal(produtoId);
      if (resultado.aviso) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.gold).setTitle('⚠️ Thumbnail salva, mas confira o link').setDescription(resultado.aviso)],
          flags: 64
        });
      }
      return interaction.reply({ content: '<:positivo:1528401238197276702> Thumbnail atualizada com sucesso.', flags: 64 });
    }
    if (id.startsWith('prod_modal_editar_footer_')) {
      const produtoId = id.replace('prod_modal_editar_footer_', '');
      db.atualizarProduto(interaction.guildId, produtoId, 'footer', interaction.fields.getTextInputValue('prod_footer_input').trim());
      await interaction.reply({ content: '<:positivo:1528401238197276702> Atributo rodapé salvo com sucesso.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_cor_embed_')) {
      const produtoId = id.replace('prod_modal_cor_embed_', '');
      const corDigitada = interaction.fields.getTextInputValue('prod_cor_embed_input').trim().replace('#', '');

      if (corDigitada === '') {
        db.atualizarProduto(interaction.guildId, produtoId, 'corEmbed', null);
        await interaction.reply({ content: '<:positivo:1528401238197276702> Cor da embed voltou para o branco padrão.', flags: 64 });
        return atualizarPainelAposModal(produtoId);
      }

      if (!/^[0-9A-Fa-f]{6}$/.test(corDigitada)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Cor inválida').setDescription('> Use um código hexadecimal de 6 dígitos, com ou sem `#` (ex: `FFFFFF`, `#FF0000`, `5865F2`).')],
          flags: 64
        });
      }

      db.atualizarProduto(interaction.guildId, produtoId, 'corEmbed', corDigitada.toUpperCase());
      await interaction.reply({ content: `<:positivo:1528401238197276702> Cor da embed definida para \`#${corDigitada.toUpperCase()}\`.`, flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_cargo_')) {
      const produtoId = id.replace('prod_modal_cargo_', '');
      const cargoIdDigitado = interaction.fields.getTextInputValue('prod_cargo_id_input').trim();

      // Sem digitar nada = remove a configuração de cargo do produto.
      if (!cargoIdDigitado) {
        db.atualizarProduto(interaction.guildId, produtoId, 'cargoId', '');
        await interaction.reply({ content: '<:positivo:1528401238197276702> Cargo de entrega removido.', flags: 64 });
        return atualizarPainelAposModal(produtoId);
      }

      // Valida se o ID digitado corresponde a um cargo real deste servidor
      // ANTES de salvar — sem isso, um ID errado (digitado errado, de
      // outro servidor, ou de um cargo já deletado) fica salvo do mesmo
      // jeito e a menção aparece como "cargo desconhecido" pro cliente.
      const cargoEncontrado = interaction.guild.roles.cache.get(cargoIdDigitado)
        || await interaction.guild.roles.fetch(cargoIdDigitado).catch(() => null);

      if (!cargoEncontrado) {
        return interaction.reply({
          content: '<:negativo:1528400986744295475> Esse ID não corresponde a nenhum cargo deste servidor. Verifique se copiou o ID certo (clique direito no cargo → Copiar ID) e tente novamente.',
          flags: 64,
        });
      }

      db.atualizarProduto(interaction.guildId, produtoId, 'cargoId', cargoEncontrado.id);

      // Aviso extra (não bloqueia o salvamento): se o cargo do bot estiver
      // abaixo do cargo configurado na hierarquia do servidor, a entrega
      // automática vai falhar mesmo com o ID certo — o Discord não deixa
      // um bot atribuir um cargo acima do cargo mais alto que ele tem.
      const cargoDoBot = interaction.guild.members.me?.roles?.highest;
      const avisoHierarquia = (cargoDoBot && cargoEncontrado.position >= cargoDoBot.position)
        ? '\n\n<:negativo:1528400986744295475> **Atenção:** o cargo do bot está abaixo (ou igual) de **' + cargoEncontrado.name + '** na hierarquia do servidor. Suba o cargo do bot acima dele em Configurações do Servidor → Cargos, senão a entrega automática vai falhar mesmo com o ID certo.'
        : '';

      await interaction.reply({
        content: `<:positivo:1528401238197276702> Cargo de entrega configurado: ${cargoEncontrado}.${avisoHierarquia}`,
        flags: 64,
      });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_precocomp_submit_')) {
      const produtoId = id.replace('prod_modal_precocomp_submit_', '');
      const valor = interaction.fields.getTextInputValue('precocomp_input').trim();
      db.atualizarProduto(interaction.guildId, produtoId, 'precoComparacao', valor || null);
      await interaction.reply({ content: valor ? `<:positivo:1528401238197276702> Preço "de" definido: \`R$ ${valor}\`.` : '<:positivo:1528401238197276702> Preço comparativo removido.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_condicoes_submit_')) {
      const produtoId = id.replace('prod_modal_condicoes_submit_', '');
      const parseOuNull = (campo) => {
        const v = interaction.fields.getTextInputValue(campo).trim();
        if (!v) return null;
        const n = parseFloat(v.replace(',', '.'));
        return isNaN(n) ? null : n;
      };
      const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.condicoes || {};
      db.atualizarProduto(interaction.guildId, produtoId, 'condicoes', {
        ...atual,
        valorMinimo: parseOuNull('valorMin'),
        valorMaximo: parseOuNull('valorMax'),
        quantidadeMinima: parseOuNull('qtdMin'),
        quantidadeMaxima: parseOuNull('qtdMax'),
      });
      await interaction.reply({ content: '<:positivo:1528401238197276702> Condições de compra atualizadas.', flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_assinatura_submit_')) {
      const produtoId = id.replace('prod_modal_assinatura_submit_', '');
      const diasStr = interaction.fields.getTextInputValue('duracaoDias').trim();
      const dias = parseInt(diasStr, 10);
      if (isNaN(dias) || dias <= 0) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Duração inválida').setDescription('> Digite um número de dias maior que 0.')], flags: 64 });
      }
      const vipTexto = interaction.fields.getTextInputValue('vipAtivado').trim().toLowerCase();
      const vipAtivado = vipTexto === 'sim' || vipTexto === 's' || vipTexto === 'true';
      const atual = db.getProdutoPorId(interaction.guildId, produtoId)?.assinatura || { ativa: false };
      db.atualizarProduto(interaction.guildId, produtoId, 'assinatura', { ...atual, duracaoDias: dias, vipAtivado });
      await interaction.reply({ content: `<:positivo:1528401238197276702> Assinatura configurada: \`${dias} dias\`${vipAtivado ? ' • VIP habilitado' : ''}.`, flags: 64 });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_estoque_add_')) {
      const produtoId = id.replace('prod_modal_estoque_add_', '');
      const novos = interaction.fields.getTextInputValue('prod_estoque_input').split('\n').map(x => x.trim()).filter(x => x.length > 0);
      const antigo = db.getProdutoPorId(interaction.guildId, produtoId)?.estoque || [];
      const combinado = [...antigo, ...novos];
      db.atualizarProduto(interaction.guildId, produtoId, 'estoque', combinado);
      const nomeProduto = db.getProdutoPorId(interaction.guildId, produtoId)?.titulo || 'produto';
      await interaction.reply({ content: `<:positivo:1528401238197276702> Adicionados \`${novos.length}\` itens ao estoque de **${nomeProduto}**.\n<:caixa:1524207165496099007> Estoque total agora: \`${combinado.length}\` item(ns).`, flags: 64 });
      try {
        const avisoEstoque = require('../sales-system/avisoEstoque');
        await avisoEstoque.notificarNovoEstoque(interaction.client, interaction.guildId, produtoId, nomeProduto);
      } catch (e) { console.error('[AvisoEstoque] Falha ao notificar:', e.message); }
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_variante_add_')) {
      const produtoId = id.replace('prod_modal_variante_add_', '');
      const nome = interaction.fields.getTextInputValue('v_nome').trim();
      const preco = interaction.fields.getTextInputValue('v_preco').trim();
      const imagemUrl = interaction.fields.getTextInputValue('v_emoji').trim();

      // Mesmo parsing usado pelo estoque do produto principal
      // (prod_modal_estoque_add_): 1 item por linha. Vazio = 0 itens
      // (esgotado), igual ao produto principal.
      const itensEstoque = interaction.fields.getTextInputValue('v_estoque_itens').split('\n').map(x => x.trim()).filter(x => x.length > 0);

      const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];

      // Case-insensitive: impede duplicar variante com nome igual (diferindo só maiúsc/minúsc)
      const nomeLower = nome.toLowerCase();
      const jaExiste = variantes.some(v => v.nome.toLowerCase() === nomeLower);
      if (jaExiste) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante já existe')
            .setDescription(`> Já existe uma variante chamada \`${nome}\` (comparação ignora maiúsculas/minúsculas).`)],
          flags: 64
        });
      }

      let emoji = null;
      if (imagemUrl) {
        try {
          emoji = await criarEmojiApartirDeUrl(interaction.client, imagemUrl, nome);
        } catch (e) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não consegui usar essa imagem')
              .setDescription(`> Motivo: ${e.message}\n> Confira se a URL é pública, aponta direto pra um arquivo PNG/JPG/GIF e tem no máximo 256KB. A variante NÃO foi criada — envie o modal de novo com a URL corrigida.`)],
            flags: 64
          });
        }
      }

      const novaVariante = { id: nome.toLowerCase().replace(/\s/g, '_'), nome, preco, estoque: itensEstoque.length, itensEstoque, emoji };
      variantes.push(novaVariante);
      db.atualizarProduto(interaction.guildId, produtoId, 'variantes', variantes);
      const estoqueResumo = `${itensEstoque.length} item(ns)`;
      const emojiResumo = emoji ? `${emoji} ` : '';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Subvariante registrada.')
          .setDescription(`> ${emojiResumo}**${nome}**\n> Preço: R$ ${formatarPrecoVariante(preco)}\n> Estoque: ${estoqueResumo}`)],
        flags: 64
      });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_variante_editar_')) {
      const raw = id.replace('prod_modal_variante_editar_', '');
      const [produtoId, varianteId] = raw.split('::');
      const novoNome = interaction.fields.getTextInputValue('v_novo_nome').trim();
      const novoPreco = interaction.fields.getTextInputValue('v_novo_preco').trim();
      const novoEstoqueItensInput = interaction.fields.getTextInputValue('v_novo_estoque_itens');
      const novaImagemInput = interaction.fields.getTextInputValue('v_novo_emoji').trim();

      const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];
      const idx = variantes.findIndex(v => (v.id || v.nome.toLowerCase().replace(/\s/g, '_')) === varianteId);
      if (idx === -1) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante não encontrada.')
            .setDescription('> Essa variante pode ter sido removida antes de você salvar a edição.')],
          flags: 64
        });
      }

      // Mesmo parsing usado pelo estoque do produto principal: 1 item por
      // linha. Vazio = 0 itens (esgotado), igual ao produto principal.
      const novosItensEstoque = novoEstoqueItensInput.split('\n').map(x => x.trim()).filter(x => x.length > 0);

      // Checa colisão de nome com outra variante (case-insensitive).
      if (novoNome.toLowerCase() !== variantes[idx].nome.toLowerCase()) {
        const colisao = variantes.some((v, i) => i !== idx && v.nome.toLowerCase() === novoNome.toLowerCase());
        if (colisao) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Já existe uma variante com esse nome')
              .setDescription(`> Já existe uma variante chamada \`${novoNome}\` (comparação ignora maiúsculas/minúsculas).`)],
            flags: 64
          });
        }
      }

      // URL de imagem: vazio = mantém a imagem atual; "remover" (sem
      // acento, sem caixa) apaga; qualquer outra coisa é tratada como
      // URL nova — se o upload falhar, a edição inteira é cancelada e
      // NADA é salvo, pra não perder a imagem antiga por engano.
      let novoEmoji = variantes[idx].emoji || null;
      const emojiAntigo = variantes[idx].emoji || null;
      if (novaImagemInput.length > 0) {
        if (novaImagemInput.toLowerCase() === 'remover') {
          novoEmoji = null;
        } else {
          try {
            novoEmoji = await criarEmojiApartirDeUrl(interaction.client, novaImagemInput, novoNome);
          } catch (e) {
            return interaction.reply({
              embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Não consegui usar essa imagem')
                .setDescription(`> Motivo: ${e.message}\n> Confira se a URL é pública, aponta direto pra um arquivo PNG/JPG/GIF e tem no máximo 256KB. Nada foi alterado — envie o modal de novo com a URL corrigida (ou deixe vazio pra manter a imagem atual).`)],
              flags: 64
            });
          }
        }
      }

      // Mantém o `id` original da variante (não muda ao renomear) para não
      // invalidar carrinhos em andamento que já referenciam essa variante
      // pelo id atual.
      variantes[idx] = {
        ...variantes[idx],
        nome: novoNome,
        preco: novoPreco,
        estoque: novosItensEstoque.length,
        itensEstoque: novosItensEstoque,
        emoji: novoEmoji,
      };
      db.atualizarProduto(interaction.guildId, produtoId, 'variantes', variantes);
      if (novoEmoji !== emojiAntigo) removerEmojiAppSeExistir(interaction.client, emojiAntigo);

      const estoqueResumo = `${novosItensEstoque.length} item(ns)`;
      const emojiResumo = variantes[idx].emoji ? `${variantes[idx].emoji} ` : '';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:positivo:1528401238197276702> Variante atualizada.')
          .setDescription(`> ${emojiResumo}**${novoNome}**\n> Preço: R$ ${formatarPrecoVariante(variantes[idx].preco)}\n> Estoque: ${estoqueResumo}`)],
        flags: 64
      });
      return atualizarPainelAposModal(produtoId);
    }
    if (id.startsWith('prod_modal_variante_remover_')) {
      const produtoId = id.replace('prod_modal_variante_remover_', '');
      const nomeRemover = interaction.fields.getTextInputValue('v_nome_remover').trim();
      const variantes = db.getProdutoPorId(interaction.guildId, produtoId)?.variantes || [];
      const novas = variantes.filter(v => v.nome.toLowerCase() !== nomeRemover.toLowerCase());
      if (novas.length === variantes.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COR.danger).setTitle('<:negativo:1528400986744295475> Variante não encontrada.')
            .setDescription(`> Nenhuma variante com o nome \`${nomeRemover}\`.`)],
          flags: 64
        });
      }
      db.atualizarProduto(interaction.guildId, produtoId, 'variantes', novas);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COR.success).setTitle('<:apagar:1524206738885050388> Variante Removida!')
          .setDescription(`> **${nomeRemover}** foi removida do produto.`)],
        flags: 64
      });
      return atualizarPainelAposModal(produtoId);
    }
  } catch (err) {
    console.error(err);
    return interaction.reply({ content: '<:negativo:1528400986744295475> Erro de processamento interno do modal.', flags: 64 }).catch(() => null);
  }
}

// ATUALIZACAO AO VIVO DO PAINEL - usada pelo salesManager (fluxo legado
// de produto unico) para nunca deixar o painel desatualizado ou criar
// mensagens duplicadas. Edita sempre a MESMA mensagem do painel, nunca
// envia uma nova. Silenciosa em caso de falha.
// CORRECAO (auditoria): esta funcao era chamada em salesManager.js mas
// nunca existia/era exportada aqui, causando erro engolido em todo
// modal do fluxo legado. Agora existe de verdade.
async function atualizarPainelFollowUp(interaction) {
  try {
    const produtoId = getProdutoAtivoId(interaction.guildId);
    const msgs = await interaction.channel.messages.fetch({ limit: 15 });
    const msgPainel = msgs.find(m =>
      m.author.id === interaction.client.user.id &&
      m.embeds[0]?.title?.includes('PRODUTO ATUAL')
    );
    if (!msgPainel) return;
    const embed = buildPainelEmbed(interaction.guildId, interaction.guild, produtoId);
    await msgPainel.edit({ embeds: [embed], components: buildPainelComponents(produtoId) });
  } catch (e) {
    console.error('[Painel] Falha ao atualizar painel (followUp):', e.message);
  }
}

// Variante que nao depende de uma interacao (recebe guildId/guild/client
// diretamente) - usada pelo fluxo legado de selecao de cargo
// (prod_sel_cargo) em salesManager.js.
// CORRECAO (auditoria): tambem nunca existia, causando falha silenciosa.
async function atualizarPainelMsg(guildId, guild, client) {
  try {
    // Sem uma interacao neste fluxo legado nao ha como localizar com
    // certeza a mensagem do painel a editar; garantimos apenas que a
    // chamada nunca derruba o fluxo que a invoca (nao lanca excecao).
    return;
  } catch (e) {
    console.error('[Painel] Falha ao atualizar painel (Msg):', e.message);
  }
}

function limparMetadadosPedido(canalId) {
  if (canalId) delete metadadosPedido[canalId];
}

module.exports = {
  handleButton, handleSelectMenu, handleModal, enviarMenuPrincipal,
  atualizarPainelFollowUp, atualizarPainelMsg, atualizarVitrinePublicada,
  limparMetadadosPedido,
  // Exportado para reuso pelo Context Menu "Gerenciar Produto" (clique
  // direito na vitrine publicada) — evita duplicar a lógica do painel.
  buildPainelEmbed, buildPainelComponents,
  buildVitrineEmbed, buildVitrineComponentes,
  // REMOVIDO: comando /produto criar (data + execute). Era 100% redundante
  // com o botão "Configurar Loja" do /painel (painel_vendas), que chama a
  // MESMA função enviarMenuPrincipal(). As funções acima continuam
  // exportadas normalmente e usadas por produtoHandler/ctxGerenciarProduto
  // — só o registro do slash command em si foi removido.
};
