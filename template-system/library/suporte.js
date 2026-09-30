'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'central-de-suporte', nome: 'Central de Suporte', cat: 'suporte', estilo: 'corporativo', dest: true, data: '2026-09-14', ver: '1.3.0',
    tags: ['suporte', 'tickets', 'base de conhecimento', 'status'],
    desc: 'Central completa de suporte com tickets, base de conhecimento, status e escalonamento.',
    cargos: [
      ['🏢 Gerente de Suporte', '#F39C12', 'owner'], ['🧭 Supervisor', '#E67E22', 'admin'], ['🎧 Agente Sênior', '#16A085', 'support', { key: 'senior' }], ['🎫 Agente', '#1ABC9C', 'support'],
      ['🔧 Engenharia', '#3498DB', 'dev', { key: 'eng' }], ['🙋 Cliente', '#95A5A6', 'member', { hoist: false }], ['🤖 Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('・', '📌 COMECE AQUI', ['📖・como-pedir-ajuda|Antes de abrir um ticket', '🟢・status|Status dos serviços', '📰・atualizacoes|Novidades e manutenções']),
      ['📚 BASE DE CONHECIMENTO', 'leitura', ['📚・artigos|Guias passo a passo', '❓・faq|Perguntas frequentes', '🎥・tutoriais|Vídeos e demonstrações', '🐞・problemas-conhecidos|Bugs já reportados']],
      ['🎫 ATENDIMENTO', null, ['🎫・abrir-ticket|Abra um chamado', '💬・duvidas-rapidas|Perguntas simples|lento10', '💡・sugestoes|Sugira melhorias|lento60', '⭐・avaliar-atendimento|Avalie nosso suporte|lento30']],
      ['🎧 TRIAGEM', 'staff', ['🎧・fila-de-tickets|Tickets aguardando', '🔼・escalonados|Casos escalonados', '🔧・engenharia|Ponte com engenharia']],
      ['📊 QUALIDADE', 'staff', ['📊・metricas-de-sla|Tempo de resposta', '📝・modelos-de-resposta|Respostas padrão', '📚・treinamento|Capacitação de agentes']],
      staff('・', '🔒 SUPERVISÃO', ['🚫・casos-sensiveis|Casos críticos|gestao']),
    ],
  },
  {
    slug: 'atendimento', nome: 'Atendimento', cat: 'suporte', estilo: 'clean', data: '2026-08-17',
    tags: ['atendimento', 'clientes', 'chamados', 'sac'],
    desc: 'SAC simples e direto: abrir chamado, acompanhar andamento e avaliar o atendimento.',
    cargos: [
      ['👑 Responsável', '#F6B93B', 'owner'], ['🧭 Coordenação', '#E55039', 'admin'], ['🎧 Atendente', '#38ADA9', 'support'], ['🙋 Cliente', '#B8E994', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 ORIENTAÇÕES', ['📜・regras|Como funciona o atendimento', '🕒・horarios|Horários de atendimento']),
      ['🎫 ATENDIMENTO', null, ['🎫・abrir-chamado|Fale com a equipe', '❓・perguntas-frequentes|Respostas rápidas|leitura', '💬・conversa|Bate-papo entre clientes|lento10', '⭐・avaliacoes|Deixe sua avaliação|lento30']],
      ['🔊 ATENDIMENTO POR VOZ', null, vozes(['🎧 Fila de Espera', '📞 Atendimento 1|lim2', '📞 Atendimento 2|lim2'])],
      staff('・', '🔒 EQUIPE', ['📋・fila-de-chamados|Casos em aberto']),
    ],
  },
  {
    slug: 'suporte-premium', nome: 'Suporte Premium', cat: 'suporte', estilo: 'premium', prem: true, data: '2026-09-09',
    tags: ['suporte premium', 'sla', 'vip', 'prioridade'],
    desc: 'Suporte com prioridade para clientes premium: SLA, gerente de conta e canais dedicados.',
    cargos: [
      ['💎 Head de Suporte', '#00E5FF', 'owner'], ['⚡ Supervisor', '#FFB300', 'admin'], ['🎧 Especialista', '#00C853', 'support', { key: 'especialista' }], ['🤝 Gerente de Conta', '#AB47BC', 'staff', { key: 'gerente' }],
      ['💎 Cliente Premium', '#FFD600', 'premium'], ['⭐ Cliente Plus', '#7C4DFF', 'vip'], ['🙋 Cliente', '#90A4AE', 'member', { hoist: false }],
    ],
    cats: [
      info('┃', '💎 BEM-VINDO', ['📖┃como-funciona|Níveis de suporte', '⏱️┃sla|Prazos por plano', '🟢┃status|Status da plataforma']),
      ['🎫 SUPORTE PADRÃO', null, ['🎫┃abrir-ticket|Atendimento padrão', '❓┃duvidas|Perguntas gerais|lento10', '📚┃base-de-conhecimento|Artigos e guias|leitura']],
      ['💎 SUPORTE PRIORITÁRIO', 'vip', ['💎┃ticket-prioritario|Atendimento com prioridade', '🤝┃gerente-de-conta|Fale com seu gerente', '🚨┃urgencias|Problemas críticos', 'v:💎 Atendimento por Voz|lim3']],
      ['📣 ATUALIZAÇÕES', 'leitura', ['📣┃manutencoes|Janelas de manutenção', '🆕┃novidades|Novos recursos', '🗓️┃roadmap|O que vem por aí']],
      ['🎧 EQUIPE', 'staff', ['🎧┃fila-prioritaria|Tickets premium', '🔼┃escalonamento|Casos escalados', '📝┃macros|Respostas prontas']],
      staff('┃', '🔒 GESTÃO', ['📊┃indicadores|CSAT e SLA|gestao']),
    ],
  },
  {
    slug: 'tickets', nome: 'Tickets', cat: 'suporte', estilo: 'minimalista', data: '2026-08-06',
    tags: ['tickets', 'chamados', 'simples', 'bot de tickets'],
    desc: 'Estrutura mínima para servidores que giram em torno de tickets: painel, logs e transcrições.',
    cargos: [
      ['👑 Admin', '#FFC048', 'owner'], ['🎫 Suporte', '#0BE881', 'support'], ['🙋 Usuário', '#D2DAE2', 'member', { hoist: false }],
    ],
    cats: [
      ['🎫 TICKETS', null, ['📌・como-abrir|Instruções de abertura|leitura', '🎫・painel-de-tickets|Abra seu ticket aqui|leitura', '⭐・avaliacoes|Avalie o atendimento|leitura']],
      ['📂 TICKETS ABERTOS', 'staff', ['📂・aguardando|Tickets aguardando atendimento']],
      staff('・', '🔒 STAFF', ['📜・transcricoes|Transcrições de tickets fechados']),
    ],
  },
  {
    slug: 'help-center', nome: 'Help Center', cat: 'suporte', estilo: 'clean', data: '2026-08-31',
    tags: ['help center', 'ajuda', 'documentação', 'comunidade ajuda'],
    desc: 'Centro de ajuda estilo fórum: artigos, perguntas da comunidade e suporte oficial.',
    cargos: [
      ['📘 Editor-Chefe', '#F1C40F', 'owner'], ['🧭 Administração', '#E67E22', 'admin'], ['🎧 Suporte Oficial', '#2ECC71', 'support'], ['🎓 Especialista da Comunidade', '#9B59B6', 'helper', { key: 'especialista' }],
      ['🙋 Usuário', '#95A5A6', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📘 INÍCIO', ['🔎・como-buscar-ajuda|Antes de perguntar', '📰・novidades|Atualizações da documentação']),
      ['📚 DOCUMENTAÇÃO', 'leitura', ['🚀・primeiros-passos|Comece por aqui', '📖・guias|Guias completos', '🧩・integracoes|Conecte com outras ferramentas', '🛠️・solucao-de-problemas|Erros comuns']],
      ['🙋 PERGUNTAS & RESPOSTAS', null, ['f:🙋・perguntas|Pergunte e receba respostas', '✅・resolvidos|Casos resolvidos|leitura', '💡・sugestoes|Melhorias na documentação|lento60']],
      ['🎧 SUPORTE OFICIAL', null, ['🎫・falar-com-suporte|Abra um ticket', '🐞・reportar-bug|Envie relatórios']],
      staff('・', '🔒 EDITORIAL', ['✍️・rascunhos|Artigos em produção', '📊・busca-sem-resultado|O que os usuários buscam']),
    ],
  },
  {
    slug: 'customer-support', nome: 'Customer Support', cat: 'suporte', estilo: 'internacional', data: '2026-09-01',
    tags: ['customer support', 'inglês', 'saas', 'global'],
    desc: 'Suporte global em inglês/português, ideal para SaaS: tiers, feedback de produto e status.',
    cargos: [
      ['🌍 Head of Support', '#F9CA24', 'owner'], ['🧭 Team Lead', '#F0932B', 'admin', { key: 'lead' }], ['🎧 Tier 2', '#6AB04C', 'support', { key: 'tier2' }], ['🎫 Tier 1', '#7BED9F', 'support', { key: 'tier1' }],
      ['🧑‍💻 Product', '#22A6B3', 'dev', { key: 'product' }], ['🙋 Customer', '#A4B0BE', 'member', { hoist: false }],
    ],
    cats: [
      info('┃', '🌍 WELCOME', ['📖┃how-to-get-help|How support works', '🟢┃service-status|Live status']),
      ['🎫 SUPPORT', null, ['🎫┃open-a-ticket|Open a support ticket', '💬┃community-help|Ask the community|lento10', '📚┃help-articles|Guides|leitura']],
      ['💡 FEEDBACK', null, ['💡┃feature-requests|Suggest features|lento60', '🐞┃bug-reports|Report bugs', '🗳️┃product-polls|Vote on ideas|leitura']],
      ['🌐 LANGUAGES', null, ['🇧🇷┃suporte-pt|Suporte em português', '🇺🇸┃support-en|Support in English']],
      ['🧑‍💻 INTERNAL', 'staff', ['🎧┃queue|Ticket queue', '🔼┃escalations|Tier 2 / Product', '📊┃csat-and-sla|Metrics']],
      staff('┃', '🔒 LEADERSHIP'),
    ],
  },
  {
    slug: 'suporte-vendas', nome: 'Suporte + Vendas', cat: 'suporte', estilo: 'híbrido', dest: true, data: '2026-09-13',
    tags: ['suporte', 'vendas', 'pós-venda', 'catálogo'],
    desc: 'Combina vitrine de vendas com suporte pós-venda: pedidos, garantias e atendimento no mesmo lugar.',
    cargos: [
      ['👑 Proprietário', '#FFC312', 'owner'], ['🧭 Gerência', '#EE5A24', 'admin'], ['💰 Vendedor', '#009432', 'seller'], ['🎧 Suporte', '#0652DD', 'support'],
      ['💎 Cliente VIP', '#9980FA', 'vip'], ['🙋 Cliente', '#C4E538', 'member', { hoist: false }], ['🤖 Bots', '#A3A3A3', 'bot'],
    ],
    cats: [
      info('・', '📌 INFORMAÇÕES', ['📖・como-comprar|Passo a passo', '🛡️・garantia-e-trocas|Política de pós-venda']),
      ['🛒 VENDAS', 'vitrine', ['🛍️・vitrine|Produtos e serviços', '🔥・ofertas|Promoções', '💬・falar-com-vendedor|Tire dúvidas antes de comprar|publico']],
      ['🎫 PÓS-VENDA', null, ['🎫・abrir-ticket|Suporte ao pedido', '📦・meu-pedido|Acompanhe seu pedido', '🔁・trocas|Solicite troca ou devolução', '⭐・avaliacoes|Avalie sua compra|lento30']],
      ['💎 CLIENTES VIP', 'vip', ['💎・vip-chat|Atendimento exclusivo', '🎁・cupons-vip|Descontos do clube']],
      ['💬 COMUNIDADE', null, ['💬・chat|Bate-papo|lento5', ...vozes(['🔊 Sala Geral', '🎧 Atendimento por Voz|lim3'])]],
      staff('・', '🔒 OPERAÇÃO', ['💰・vendas-internas|Pedidos novos|vendas', '🎧・fila-de-suporte|Casos abertos']),
    ],
  },
];
