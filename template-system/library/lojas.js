'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  // ───────────────────────── 1. LOJA DIGITAL ─────────────────────────
  {
    slug: 'loja-digital', nome: 'Loja Digital', cat: 'lojas', estilo: 'minimalista', dest: true, data: '2026-09-12', ver: '1.2.0',
    tags: ['vendas', 'pix', 'produtos digitais', 'entrega automática'],
    desc: 'Vitrine limpa para vender produtos digitais com atendimento e logs de vendas.',
    cargos: [
      ['👑 Dono', '#F1C40F', 'owner'], ['⚡ Gestor', '#E67E22', 'admin'], ['🛡️ Moderador', '#3498DB', 'mod'],
      ['🎫 Atendente', '#1ABC9C', 'support'], ['🛒 Vendedor', '#2ECC71', 'seller', { mention: true }],
      ['💎 Cliente VIP', '#9B59B6', 'vip'], ['✅ Cliente', '#95A5A6', 'member', { hoist: false }], ['🤖 Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('・', '📌 INFORMAÇÕES', ['📖・como-comprar|Passo a passo da compra', '❓・faq|Perguntas frequentes']),
      ['🛒 LOJA', 'vitrine', ['🛍️・loja|Catálogo oficial', '📦・produtos|Lista de produtos e preços', '🎁・ofertas|Promoções e cupons', '🔔・reposicao|Avisos de estoque']],
      ['💰 COMPRAS', 'leitura', ['🧾・pedidos-aprovados|Pedidos entregues', '⭐・avaliacoes|Feedback dos clientes']],
      ['🎫 ATENDIMENTO', null, ['🎫・abrir-ticket|Fale com a equipe', '💡・duvidas|Tire suas dúvidas', '📝・sugestoes|Ideias para a loja|lento30']],
      ['💬 COMUNIDADE', null, ['💬・chat|Converse com outros clientes|lento5', '📸・comprovantes|Mostre sua compra', ...vozes(['🔊 Sala Geral'])]],
      staff('・', '🔒 STAFF', ['💰・caixa|Fechamento diário', '📦・estoque-interno|Controle de estoque']),
    ],
  },
  // ───────────────────────── 2. LOJA PREMIUM ─────────────────────────
  {
    slug: 'loja-premium', nome: 'Loja Premium', cat: 'lojas', estilo: 'premium', dest: true, prem: true, data: '2026-09-15', ver: '2.0.0',
    tags: ['vendas', 'premium', 'profissional', 'vip'],
    desc: 'Estrutura completa para servidores profissionais de vendas, com área VIP, parceiros e logs.',
    cargos: [
      ['👑 Owner', '#FFD700', 'owner'], ['💎 Co-Owner', '#00E5FF', 'admin', { key: 'coowner' }], ['⚡ Administrator', '#FF6F00', 'admin'],
      ['🛡️ Moderator', '#2979FF', 'mod'], ['🔨 Helper', '#26A69A', 'helper'], ['🎫 Support', '#66BB6A', 'support'],
      ['💰 Seller', '#43A047', 'seller', { mention: true }], ['🤝 Partner', '#AB47BC', 'partner'], ['💎 VIP', '#7E57C2', 'vip'],
      ['⭐ Premium', '#FBC02D', 'premium'], ['👤 Member', '#90A4AE', 'member', { hoist: false }], ['🤖 Bots', '#607D8B', 'bot'],
    ],
    cats: [
      info('┃', '📌 INFORMAÇÕES', ['📖┃informacoes|Sobre a loja', '🏆┃termos|Termos de uso e garantia']),
      ['🛒 LOJA', 'vitrine', ['🛍️┃loja|Catálogo oficial', '📦┃produtos|Produtos e valores', '💰┃compras|Como comprar', '🎁┃ofertas|Promoções da semana', '🔥┃lancamentos|Novidades da loja', '🧾┃planos|Planos e assinaturas']],
      ['⭐ CLIENTES', 'leitura', ['🧾┃entregas|Pedidos entregues', '⭐┃avaliacoes|Depoimentos', '📸┃provas|Provas sociais', '🏅┃ranking-clientes|Top compradores']],
      ['🎫 SUPORTE', null, ['🎫┃tickets|Abra um atendimento', '💡┃duvidas|Perguntas e respostas', '📝┃feedback|Sua opinião importa|lento30', '🛠️┃problemas|Relate problemas com pedidos']],
      ['💬 COMUNIDADE', null, ['💬┃chat|Bate-papo geral|lento5', '📷┃midia|Imagens e vídeos', '💡┃sugestoes|Sugestões|lento60', '🎮┃off-topic|Assuntos livres', 'v:🔊 Sala Geral', 'v:🎧 Música', 'v:💬 Conversa 1|lim5']],
      ['💎 ÁREA VIP', 'vip', ['💎┃chat-vip|Exclusivo para VIP e Premium', '🎁┃beneficios|Vantagens da área VIP', '🚀┃acesso-antecipado|Produtos antes de todo mundo', 'v:💎 Lounge VIP']],
      ['🤝 PARCEIROS', 'parceiros', ['🤝┃parcerias|Canal de parceiros', '📣┃divulgacao-parceiros|Divulgação cruzada']],
      staff('┃', '🔒 STAFF', ['💰┃financeiro|Controle financeiro|gestao', '📊┃metricas|Números da loja', '📦┃estoque-interno|Reposição e controle', 'v:🎙️ Alinhamento']),
    ],
  },
  // ───────────────────────── 3. MARKETPLACE ─────────────────────────
  {
    slug: 'marketplace', nome: 'Marketplace', cat: 'lojas', estilo: 'corporativo', data: '2026-08-29', ver: '1.1.0',
    tags: ['marketplace', 'vendedores', 'middleman', 'negociação'],
    desc: 'Vários vendedores verificados, categorias de produtos e mediação de negociações.',
    cargos: [
      ['🏛️ Fundador', '#D4AF37', 'owner'], ['🧭 Diretoria', '#C0392B', 'admin'], ['⚖️ Middleman', '#16A085', 'mod', { key: 'middleman', extra: ['MoveMembers'] }],
      ['🛡️ Moderação', '#2980B9', 'mod'], ['✔️ Vendedor Verificado', '#27AE60', 'seller', { mention: true }],
      ['🏪 Vendedor', '#7FB77E', 'seller', { key: 'vendedor2', hoist: false }], ['🛍️ Comprador', '#BDC3C7', 'member', { hoist: false }], ['🤖 Sistemas', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('│', '🏛️ PORTAL', ['📘│como-funciona|Regras do marketplace', '⚖️│middleman|Como usar a mediação', '🚫│golpes-conhecidos|Alertas de fraude']),
      ['🏪 ANÚNCIOS', 'vitrine', ['🎮│games|Anúncios de games', '💻│software|Anúncios de software', '🎨│designs|Arte e design', '📚│cursos|Cursos e mentorias', '🧩│outros|Demais anúncios']],
      ['🔎 BUSCA', null, ['🔎│procura-se|Peça o que precisa', '💬│negociacao-livre|Converse com vendedores|lento10', '⭐│reputacao|Feedback de vendedores']],
      ['⚖️ MEDIAÇÃO', null, ['🎫│solicitar-middleman|Peça um mediador', '📜│termos-de-mediacao|Como funciona']],
      ['🏪 VENDEDORES', 'vendas', ['💬│lounge-vendedores|Conversa entre vendedores', '📈│dicas-de-venda|Boas práticas', '📌│regras-de-anuncio|Regras para publicar', 'v:🔊 Reunião Vendedores']],
      staff('│', '🔒 DIRETORIA', ['🔎│analise-de-vendedores|Aprovar novos vendedores', '🚫│denuncias|Denúncias de golpe']),
    ],
  },
  // ───────────────────────── 4. LOJA DE PRODUTOS ─────────────────────────
  {
    slug: 'loja-de-produtos', nome: 'Loja de Produtos', cat: 'lojas', estilo: 'clean', data: '2026-08-05',
    tags: ['produtos físicos', 'catálogo', 'envio', 'rastreio'],
    desc: 'Catálogo por categorias, acompanhamento de pedidos e pós-venda para produtos físicos.',
    cargos: [
      ['🏬 Proprietário', '#E1B12C', 'owner'], ['📋 Gerente', '#E84118', 'admin'], ['📦 Expedição', '#00A8FF', 'staff', { key: 'expedicao' }],
      ['🎧 Atendimento', '#4CD137', 'support'], ['🛒 Vendedor', '#44BD32', 'seller'], ['🛍️ Cliente', '#A4B0BE', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 BEM-VINDO', ['🏬・sobre-a-loja|Quem somos', '🚚・prazos-e-frete|Envio e prazos', '🔁・trocas-e-devolucoes|Política de troca']),
      ['🛍️ CATÁLOGO', 'vitrine', ['🆕・novidades|Chegou agora', '👕・moda|Vestuário e acessórios', '🏠・casa|Casa e decoração', '📱・eletronicos|Eletrônicos', '🏷️・promocoes|Ofertas relâmpago']],
      ['📦 MEU PEDIDO', null, ['📦・acompanhar-pedido|Consulte seu pedido', '🚚・rastreio|Códigos de rastreio', '⭐・avaliacoes|Conte como foi']],
      ['🎧 ATENDIMENTO', null, ['🎫・abrir-chamado|Fale conosco', '❓・duvidas|Dúvidas frequentes', '💬・conversa|Bate-papo geral|lento5']],
      staff('・', '🔒 OPERAÇÃO', ['📦・pedidos-internos|Fila de expedição', '🚚・logistica|Transportadoras']),
    ],
  },
  // ───────────────────────── 5. LOJA DE KEYS ─────────────────────────
  {
    slug: 'loja-de-keys', nome: 'Loja de Keys', cat: 'lojas', estilo: 'gamer', data: '2026-08-18', ver: '1.0.3',
    tags: ['keys', 'licenças', 'estoque', 'garantia'],
    desc: 'Foco em entrega rápida de chaves, controle de estoque e garantia.',
    cargos: [
      ['🗝️ Owner', '#FF9F1A', 'owner'], ['⚙️ Admin', '#FF3838', 'admin'], ['🔒 Moderador', '#3D3D3D', 'mod', { key: 'mod' }],
      ['🔑 Key Dealer', '#32FF7E', 'seller'], ['🎫 Suporte', '#18DCFF', 'support'], ['🔥 Cliente Fiel', '#C56CF0', 'vip'], ['🎮 Cliente', '#ADB5BD', 'member', { hoist: false }],
    ],
    cats: [
      info('┃', '⚡ START', ['🔑┃como-resgatar|Ativando sua key', '🛡️┃garantia|Termos de garantia']),
      ['🔑 KEYS', 'vitrine', ['🔑┃keys-disponiveis|Estoque atual', '🔥┃keys-em-promocao|Ofertas', '📥┃reposicao|Novas keys chegaram', '🧾┃vendas-recentes|Últimas entregas']],
      ['⭐ CLIENTES', null, ['⭐┃feedbacks|Avalie sua compra|lento30', '📸┃prints-de-ativacao|Mostre a ativação', '💬┃chat|Bate-papo|lento5']],
      ['🎫 SUPORTE', null, ['🎫┃ticket|Abra um ticket', '🛠️┃key-invalida|Reporte key com problema', '❓┃faq|Dúvidas comuns']],
      ['🔥 CLUBE FIEL', 'vip', ['🔥┃chat-fiel|Somente clientes fiéis', '🎁┃cupons-exclusivos|Descontos do clube']],
      staff('┃', '🔒 EQUIPE', ['📦┃estoque-keys|Controle de lotes|vendas', '💸┃financeiro|Fechamento|gestao']),
    ],
  },
  // ───────────────────────── 6. LOJA DE SERVIÇOS ─────────────────────────
  {
    slug: 'loja-de-servicos', nome: 'Loja de Serviços', cat: 'lojas', estilo: 'corporativo', data: '2026-08-22',
    tags: ['serviços', 'orçamento', 'portfólio', 'prazos'],
    desc: 'Orçamentos, portfólio e acompanhamento de projetos para prestadores de serviço.',
    cargos: [
      ['💼 Diretor', '#F39C12', 'owner'], ['🧠 Coordenador', '#D35400', 'admin'], ['🛠️ Prestador', '#2ECC71', 'seller', { key: 'prestador', mention: true }],
      ['📞 Comercial', '#3498DB', 'support'], ['🤝 Cliente Ativo', '#9B59B6', 'vip'], ['👤 Cliente', '#BDC3C7', 'member', { hoist: false }],
    ],
    cats: [
      info('｜', '📌 APRESENTAÇÃO', ['🏢｜sobre-nos|Quem somos', '💼｜servicos|O que oferecemos', '💲｜tabela-de-precos|Valores base']),
      ['🖼️ PORTFÓLIO', 'vitrine', ['🖼️｜trabalhos-entregues|Projetos concluídos', '⭐｜depoimentos|O que dizem os clientes', '🚀｜cases|Resultados alcançados']],
      ['📝 ORÇAMENTOS', null, ['📝｜pedir-orcamento|Descreva o que precisa', '🎫｜abrir-projeto|Inicie um projeto', '📆｜prazos|Cronograma e entregas']],
      ['📂 PROJETOS EM ANDAMENTO', 'membros', ['📂｜acompanhamento|Atualizações dos projetos', '🔁｜revisoes|Solicite ajustes', '📎｜arquivos|Envio de materiais']],
      ['💬 COMUNIDADE', null, ['💬｜chat|Conversa geral|lento5', 'v:🔊 Sala de Reunião|lim8']],
      staff('｜', '🔒 GESTÃO', ['💰｜financeiro|Cobranças e recebimentos|gestao', '📆｜agenda-da-equipe|Distribuição de tarefas']),
    ],
  },
  // ───────────────────────── 7. LOJA DE CONTAS ─────────────────────────
  {
    slug: 'loja-de-contas', nome: 'Loja de Contas', cat: 'lojas', estilo: 'dark', data: '2026-07-30',
    tags: ['contas', 'streaming', 'games', 'garantia'],
    desc: 'Venda de contas com garantia, política de troca e canais de verificação.',
    cargos: [
      ['🖤 Owner', '#F5F6FA', 'owner'], ['⛓️ Admin', '#8C7AE6', 'admin'], ['🔒 Segurança', '#353B48', 'mod'],
      ['💳 Vendedor', '#44BD32', 'seller'], ['🛠️ Suporte', '#00A8FF', 'support'], ['🌑 Cliente Black', '#718093', 'vip'], ['👤 Cliente', '#2F3640', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 REGRAS E GARANTIA', ['🛡️・garantia|Prazo e cobertura', '🚫・proibido|O que não fazemos']),
      ['💳 CONTAS DISPONÍVEIS', 'vitrine', ['🎬・streaming|Contas de streaming', '🎮・games|Contas de jogos', '🎵・musica|Contas de áudio', '🎁・combos|Pacotes com desconto']],
      ['🔁 PÓS-VENDA', null, ['🔁・solicitar-troca|Peça a troca dentro da garantia', '🛠️・conta-com-problema|Reporte falhas', '⭐・feedbacks|Avalie o atendimento|lento30']],
      ['🌑 CLUBE BLACK', 'vip', ['🌑・chat-black|Exclusivo para clientes recorrentes', '🎟️・cupons-black|Descontos exclusivos']],
      ['🎫 SUPORTE', null, ['🎫・ticket|Abra seu atendimento', '💬・chat|Conversa geral|lento10']],
      staff('・', '🔒 OPERAÇÃO', ['🔑・estoque-de-contas|Lotes disponíveis|vendas', '💸・financeiro|Caixa|gestao']),
    ],
  },
  // ───────────────────────── 8. LOJA DE DESIGNS ─────────────────────────
  {
    slug: 'loja-de-designs', nome: 'Loja de Designs', cat: 'lojas', estilo: 'criativo', data: '2026-09-03',
    tags: ['design', 'artes', 'encomendas', 'assets'],
    desc: 'Encomendas de arte, showcase de trabalhos e pacotes de assets prontos.',
    cargos: [
      ['🎨 Diretor Criativo', '#FD79A8', 'owner'], ['🧵 Gerente', '#E17055', 'admin'], ['🖌️ Designer', '#6C5CE7', 'seller', { key: 'designer', mention: true }],
      ['📬 Atendimento', '#00CEC9', 'support'], ['✨ Cliente Recorrente', '#FDCB6E', 'vip'], ['🎟️ Cliente', '#B2BEC3', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎨 BEM-VINDO', ['📘・como-encomendar|Fluxo de encomenda', '💲・precos|Tabela de preços', '⏱️・prazos|Prazos de entrega']),
      ['🖼️ SHOWCASE', 'vitrine', ['🖼️・logos|Logotipos', '🎞️・banners|Banners e capas', '🧿・icones|Ícones e avatares', '🌟・destaques-do-mes|Melhores do mês']],
      ['📦 ASSETS PRONTOS', 'vitrine', ['📦・pacotes-de-assets|Kits para download', '🔤・fontes-e-paletas|Fontes e cores', '🎁・freebies|Presentes gratuitos']],
      ['✏️ ENCOMENDAS', null, ['✏️・fazer-pedido|Peça sua arte', '🔁・pedir-revisao|Ajustes no projeto', '⭐・avaliacoes|Depoimentos|lento30']],
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa criativa|lento5', '🧠・inspiracao|Referências', 'v:🎧 Sala de Criação']],
      staff('・', '🔒 ATELIÊ', ['📋・fila-de-pedidos|Pedidos em produção|vendas', '💸・financeiro|Caixa|gestao']),
    ],
  },
  // ───────────────────────── 9. LOJA DE GAMES ─────────────────────────
  {
    slug: 'loja-de-games', nome: 'Loja de Games', cat: 'lojas', estilo: 'gamer', data: '2026-09-08',
    tags: ['games', 'moedas', 'itens', 'boost'],
    desc: 'Itens, moedas e serviços para jogadores, com área de clientes e torneios internos.',
    cargos: [
      ['🕹️ Founder', '#00D2D3', 'owner'], ['🎛️ Admin', '#FF9F43', 'admin'], ['🎮 Game Master', '#EE5253', 'mod'],
      ['💰 Vendedor', '#10AC84', 'seller'], ['🎧 Suporte', '#54A0FF', 'support'], ['🏆 Cliente Pro', '#5F27CD', 'vip'], ['🎮 Player', '#8395A7', 'member', { hoist: false }], ['🤖 Bots', '#576574', 'bot'],
    ],
    cats: [
      info('┃', '🎯 LOBBY', ['🎯┃como-funciona|Como comprar itens', '🛡️┃seguranca|Boas práticas de conta']),
      ['🛒 LOJA', 'vitrine', ['🛒┃loja|Catálogo geral', '🪙┃moedas-e-creditos|Moedas dos jogos', '⚔️┃itens-e-skins|Itens e skins', '🚀┃boost-e-coach|Serviços de boost e coaching', '🔥┃promocoes|Ofertas relâmpago']],
      ['🎫 ATENDIMENTO', null, ['🎫┃tickets|Fale com o suporte', '⭐┃feedbacks|Avaliações|lento30', '❓┃duvidas|Perguntas e respostas']],
      ['🏆 CLUBE PRO', 'vip', ['🏆┃chat-pro|Área dos clientes Pro', '🎟️┃cupons-pro|Descontos do clube']],
      ['🎮 PLAYERS', null, ['💬┃chat-geral|Bate-papo|lento5', '🔎┃procuro-time|Encontre parceiros de jogo', '📸┃clips|Melhores jogadas', ...vozes(['🎮 Squad 1|lim4', '🎮 Squad 2|lim4', '🎧 Lobby'])]],
      staff('┃', '🔒 STAFF', ['💰┃caixa|Fechamento diário|gestao']),
    ],
  },
  // ───────────────────────── 10. LOJA DE COMUNIDADE ─────────────────────────
  {
    slug: 'loja-de-comunidade', nome: 'Loja de Comunidade', cat: 'lojas', estilo: 'social', data: '2026-08-12',
    tags: ['loja', 'comunidade', 'clube', 'boosters'],
    desc: 'Loja integrada a uma comunidade ativa, com clube de clientes e benefícios para boosters.',
    cargos: [
      ['👑 Dono', '#F9CA24', 'owner'], ['🌟 Administrador', '#F0932B', 'admin'], ['🛡️ Guardião', '#4834D4', 'mod'], ['🎫 Suporte', '#22A6B3', 'support'],
      ['🛒 Vendedor', '#6AB04C', 'seller'], ['🚀 Booster', '#FF7979', 'booster'], ['💜 Membro Clube', '#BE2EDD', 'vip'], ['🙂 Membro', '#95AFC0', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 INÍCIO', ['👋・boas-vindas|Apresente-se', '🎭・cargos|Escolha seus cargos']),
      ['🛒 LOJINHA', 'vitrine', ['🛒・loja|Produtos da comunidade', '🎁・ofertas-do-clube|Vantagens para membros']],
      ['🎫 SUPORTE', null, ['🎫・tickets|Fale com a equipe', '💡・sugestoes|Ideias|lento60']],
      ['💬 COMUNIDADE', null, ['💬・chat-geral|Conversa livre|lento5', '📸・fotos|Mídia da comunidade', '🎮・jogos|Papo gamer', '🎵・musica|Trilha da comunidade', ...vozes(['🔊 Sala Geral', '🎧 Música'])]],
      ['🚀 BOOSTERS', 'vip', ['🚀・lounge-boosters|Espaço de quem impulsiona', '🎁・brindes|Recompensas exclusivas']],
      staff('・', '🔒 STAFF', ['💰・caixa|Controle da loja|vendas']),
    ],
  },
];
