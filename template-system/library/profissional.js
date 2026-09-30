'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'empresa', nome: 'Empresa', cat: 'profissional', estilo: 'corporativo', dest: true, data: '2026-09-07', ver: '1.2.0',
    tags: ['empresa', 'departamentos', 'equipe', 'comunicação interna'],
    desc: 'Comunicação interna por departamentos, com avisos oficiais, RH, TI e reuniões.',
    cargos: [
      ['🏢 Diretoria', '#C8A951', 'owner'], ['📊 Gerência', '#D35400', 'admin'], ['🧑‍💼 RH', '#8E44AD', 'staff', { key: 'rh' }], ['🖥️ TI', '#2980B9', 'dev', { key: 'ti' }],
      ['💼 Comercial', '#27AE60', 'seller'], ['📣 Marketing', '#E84393', 'creator', { key: 'mkt' }], ['👥 Colaborador', '#95A5A6', 'member'], ['🤖 Sistemas', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('｜', '🏢 INSTITUCIONAL', ['📋｜mural-de-avisos|Comunicados oficiais', '📘｜politicas-internas|Normas e políticas', '🎉｜celebracoes|Aniversários e conquistas']),
      ['💼 COMERCIAL', 'membros', ['📈｜metas|Metas do trimestre', '🤝｜clientes|Andamento de contas', '📊｜relatorios|Resultados semanais']],
      ['📣 MARKETING', 'membros', ['🎨｜campanhas|Campanhas em andamento', '🗓️｜calendario-editorial|Cronograma de conteúdo', '📷｜materiais|Artes e materiais']],
      ['🖥️ TECNOLOGIA', 'membros', ['🛠️｜chamados-ti|Suporte de TI', '🚀｜deploys|Avisos de publicação', '🔐｜acessos|Solicitações de acesso']],
      ['🧑‍💼 PESSOAS & CULTURA', 'membros', ['🧑‍💼｜rh-duvidas|Dúvidas de RH', '🎓｜treinamentos|Capacitações', '💬｜cafe-virtual|Conversa informal|lento5']],
      ['🎙️ REUNIÕES', 'membros', vozes(['🎙️ All Hands|lim50', '📞 Sala 1|lim10', '📞 Sala 2|lim10', '☕ Café'])],
      staff('｜', '🔒 GESTÃO', ['💰｜financeiro|Orçamentos|gestao']),
    ],
  },
  {
    slug: 'agencia', nome: 'Agência', cat: 'profissional', estilo: 'criativo', data: '2026-08-28',
    tags: ['agência', 'clientes', 'projetos', 'criação'],
    desc: 'Agência criativa com canais por cliente, aprovação de peças e gestão de projetos.',
    cargos: [
      ['🏆 Sócio-Diretor', '#F9CA24', 'owner'], ['🧭 Head de Contas', '#F0932B', 'admin', { key: 'head' }], ['🎨 Criação', '#EB4D4B', 'creator', { key: 'criacao' }],
      ['📈 Performance', '#6AB04C', 'staff', { key: 'performance' }], ['🗂️ Atendimento', '#22A6B3', 'support'], ['🤝 Cliente', '#BE2EDD', 'partner', { key: 'cliente' }], ['👥 Time', '#95AFC0', 'member'],
    ],
    cats: [
      info('・', '🏷️ AGÊNCIA', ['📢・comunicados|Avisos ao time', '🧭・processos|Como trabalhamos']),
      ['🤝 CLIENTES', 'parceiros', ['🤝・cliente-a|Canal do cliente A', '🤝・cliente-b|Canal do cliente B', '🤝・cliente-c|Canal do cliente C', '✅・aprovacoes|Aprovação de peças']],
      ['🎨 PRODUÇÃO', 'membros', ['🎨・briefings|Novos briefings', '🖼️・pecas-em-andamento|Criações em progresso', '🎬・edicao-de-video|Fila de vídeo', '🔁・revisoes|Ajustes solicitados']],
      ['📈 RESULTADOS', 'membros', ['📊・relatorios|Relatórios mensais', '💡・insights|Aprendizados de campanha']],
      ['🎙️ SALAS', 'membros', vozes(['🎙️ Daily|lim15', '🧠 Brainstorm|lim10', '🤝 Reunião com Cliente|lim8'])],
      staff('・', '🔒 SÓCIOS', ['💰・financeiro|Faturamento|gestao', '📆・planejamento|Estratégia trimestral|gestao']),
    ],
  },
  {
    slug: 'startup', nome: 'Startup', cat: 'profissional', estilo: 'moderno', data: '2026-09-02',
    tags: ['startup', 'produto', 'roadmap', 'growth'],
    desc: 'Rotina de startup: roadmap, sprints, growth, feedback de usuários e investidores.',
    cargos: [
      ['🚀 Founder', '#FF6B6B', 'owner'], ['🧠 C-Level', '#FFA502', 'admin', { key: 'clevel' }], ['🛠️ Engineering', '#1E90FF', 'dev', { key: 'eng' }], ['🎨 Product & Design', '#A55EEA', 'creator', { key: 'produto' }],
      ['📈 Growth', '#2ED573', 'seller', { key: 'growth' }], ['💼 Investidor', '#FFD32A', 'partner', { key: 'investidor' }], ['👥 Team', '#CED6E0', 'member'],
    ],
    cats: [
      info('・', '🚀 HQ', ['📣・all-hands|Atualizações da empresa', '🗺️・roadmap|Roadmap público do time', '🎯・okrs|Objetivos do trimestre']),
      ['🛠️ PRODUTO', 'membros', ['💡・ideias|Backlog de ideias', '🏃・sprint|Andamento da sprint', '🐞・bugs|Bugs reportados', '🚀・releases|Notas de versão']],
      ['📈 GROWTH', 'membros', ['📈・metricas|MRR, churn e funil', '🧪・experimentos|Testes A/B', '📣・aquisicao|Canais de aquisição']],
      ['🗣️ USUÁRIOS', 'membros', ['🗣️・feedback-de-usuarios|O que ouvimos', '🎧・entrevistas|Descobertas de entrevistas']],
      ['💼 INVESTIDORES', 'parceiros', ['💼・investor-updates|Atualização mensal', '📑・data-room|Documentos']],
      ['🎙️ SALAS', 'membros', vozes(['🎙️ Daily|lim15', '🧠 War Room|lim8', '☕ Coworking'])],
      staff('・', '🔒 FOUNDERS', ['💰・caixa-e-runway|Fluxo de caixa|gestao']),
    ],
  },
  {
    slug: 'tecnologia', nome: 'Tecnologia', cat: 'profissional', estilo: 'tech', data: '2026-08-21',
    tags: ['tecnologia', 'ti', 'infraestrutura', 'comunidade tech'],
    desc: 'Comunidade de tecnologia com trilhas por área, notícias, carreira e projetos.',
    cargos: [
      ['⚙️ Tech Lead', '#00D2D3', 'owner'], ['🔧 SysAdmin', '#EE5253', 'admin'], ['🛡️ Moderador', '#5F27CD', 'mod'], ['🧑‍💻 Sênior', '#10AC84', 'dev', { key: 'senior' }],
      ['💻 Dev', '#54A0FF', 'dev', { hoist: false }], ['🌱 Júnior', '#C8D6E5', 'member', { hoist: false }], ['🤖 Bots', '#576574', 'bot'],
    ],
    cats: [
      info('┃', '🖥️ ROOT', ['📜┃regras|Regras da comunidade', '📰┃noticias-tech|Novidades do setor', '🗺️┃trilhas|Trilhas de estudo']),
      ['🌐 DESENVOLVIMENTO', null, ['🌐┃frontend|HTML, CSS e frameworks', '🗄️┃backend|APIs e bancos', '📱┃mobile|Apps nativos e híbridos', '🤖┃ia-e-dados|IA e ciência de dados']],
      ['☁️ INFRA & SEGURANÇA', null, ['☁️┃cloud-e-devops|Nuvem e CI/CD', '🔐┃seguranca|Boas práticas de segurança', '🐧┃linux|Terminal e servidores']],
      ['💼 CARREIRA', null, ['💼┃vagas|Oportunidades', '📄┃revisao-de-curriculo|Feedback de CV', '🎤┃entrevistas|Preparação']],
      ['🚧 PROJETOS', null, ['🚧┃projetos-open-source|Contribua', '🧪┃code-review|Peça revisão de código', '🙌┃show-your-project|Mostre o que construiu']],
      ['💬 SOCIAL', null, ['💬┃off-topic|Conversa livre|lento5', ...vozes(['🎧 Pair Programming|lim4', '🔊 Sala Geral', '📚 Estudo em Grupo|lim8'])]],
      staff('┃', '🔒 STAFF'),
    ],
  },
  {
    slug: 'desenvolvimento', nome: 'Desenvolvimento', cat: 'profissional', estilo: 'dev', dest: true, data: '2026-09-13', ver: '1.3.0',
    tags: ['dev', 'time de software', 'sprints', 'deploy'],
    desc: 'Time de desenvolvimento de software: repositórios, PRs, incidentes, deploys e QA.',
    cargos: [
      ['🧠 CTO', '#F1C40F', 'owner'], ['🧭 Tech Manager', '#E67E22', 'admin'], ['🛠️ Tech Lead', '#3498DB', 'dev', { key: 'techlead', extra: ['ManageThreads'] }], ['💻 Backend', '#1ABC9C', 'dev', { key: 'backend', hoist: false }],
      ['🖼️ Frontend', '#9B59B6', 'dev', { key: 'frontend', hoist: false }], ['🧪 QA', '#E74C3C', 'staff', { key: 'qa' }], ['🚨 On-call', '#FF3838', 'staff', { key: 'oncall', mention: true }], ['🤖 CI/CD Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('・', '📌 GERAL', ['📣・anuncios-do-time|Comunicados', '📘・convencoes|Padrões de código e commits']),
      ['🧭 PLANEJAMENTO', 'dev', ['🗓️・sprint-planning|Planejamento', '📝・rfcs|Propostas técnicas', '🧱・arquitetura|Decisões de arquitetura']],
      ['💻 ENGENHARIA', 'dev', ['💻・backend|Discussões de backend', '🖼️・frontend|Discussões de frontend', '🔀・pull-requests|PRs abertos', '🧪・qa|Testes e qualidade']],
      ['🚀 ENTREGA', 'dev', ['🚀・deploys|Log de deploys', '📦・releases|Versões publicadas', '🤖・ci-cd|Status de pipelines']],
      ['🚨 INCIDENTES', 'dev', ['🚨・incidentes|Incidentes em andamento', '📖・postmortems|Aprendizados', '📟・plantao|Escala de on-call']],
      ['💬 TIME', 'dev', ['💬・cafe|Conversa informal|lento5', ...vozes(['🎙️ Daily|lim15', '🧑‍💻 Pair 1|lim3', '🧑‍💻 Pair 2|lim3', '🚨 War Room|lim10'])]],
      staff('・', '🔒 LIDERANÇA'),
    ],
  },
  {
    slug: 'design-studio', nome: 'Design Studio', cat: 'profissional', estilo: 'minimalista', data: '2026-08-10',
    tags: ['design', 'ui/ux', 'estúdio', 'critique'],
    desc: 'Estúdio de design com crítica de peças, biblioteca de referências e fluxo de projetos.',
    cargos: [
      ['🖤 Creative Director', '#EAEAEA', 'owner'], ['📐 Design Lead', '#FF7675', 'admin'], ['🎨 Designer', '#74B9FF', 'creator', { key: 'designer' }], ['🔬 UX Researcher', '#55EFC4', 'staff', { key: 'ux' }],
      ['🤝 Cliente', '#FDCB6E', 'partner', { key: 'cliente' }], ['👥 Time', '#B2BEC3', 'member'],
    ],
    cats: [
      info('・', '◽ ESTÚDIO', ['📌・principios|Nossos princípios de design', '🗓️・agenda|Entregas da semana']),
      ['◼️ PROJETOS', 'membros', ['◼️・projeto-alfa|Canal do projeto Alfa', '◼️・projeto-beta|Canal do projeto Beta', '📎・entregaveis|Arquivos finais']],
      ['🔍 CRÍTICA & REFERÊNCIAS', 'membros', ['🔍・design-critique|Peça feedback', '🧠・referencias|Inspirações', '🔤・tipografia-e-cores|Sistemas visuais', '🧩・design-system|Componentes e tokens']],
      ['🤝 CLIENTES', 'parceiros', ['🤝・sala-do-cliente|Apresentações e aprovações', '✅・aprovacoes|Histórico de aprovações']],
      ['💬 ESTÚDIO', 'membros', ['💬・papo|Conversa geral|lento5', ...vozes(['🎙️ Sala de Crit|lim8', '🎧 Foco'])]],
      staff('・', '🔒 DIREÇÃO', ['💰・orcamentos|Propostas comerciais|gestao']),
    ],
  },
  {
    slug: 'marketing', nome: 'Marketing', cat: 'profissional', estilo: 'vibrante', data: '2026-08-26',
    tags: ['marketing', 'social media', 'tráfego', 'conteúdo'],
    desc: 'Time e comunidade de marketing digital: conteúdo, tráfego pago, social e métricas.',
    cargos: [
      ['📣 CMO', '#FF793F', 'owner'], ['🧭 Coordenação', '#EE5A24', 'admin'], ['✍️ Conteúdo', '#33D9B2', 'creator', { key: 'conteudo' }], ['📊 Tráfego', '#34ACE0', 'staff', { key: 'trafego' }],
      ['📱 Social Media', '#FF5252', 'creator', { key: 'social' }], ['📈 Analista', '#706FD3', 'staff', { key: 'analista' }], ['👥 Membro', '#D1D8E0', 'member'],
    ],
    cats: [
      info('・', '📣 BRIEFING', ['🎯・objetivos|Metas do trimestre', '🗓️・calendario|Planejamento de campanhas']),
      ['✍️ CONTEÚDO', 'membros', ['✍️・pauta|Ideias de conteúdo', '📝・copy|Textos e roteiros', '🖼️・criativos|Artes e vídeos', '✅・aprovacao|Aprovação final']],
      ['📊 TRÁFEGO PAGO', 'membros', ['📊・campanhas|Campanhas ativas', '💸・verba|Investimento e ROI', '🧪・testes|Testes A/B']],
      ['📱 REDES SOCIAIS', 'membros', ['📱・instagram|Rotina do Instagram', '🎵・tiktok|Rotina do TikTok', '📺・youtube|Rotina do YouTube', '💬・comunidade|Engajamento e respostas']],
      ['📈 RESULTADOS', 'membros', ['📈・dashboards|Painéis de métricas', '🏆・cases|Cases de sucesso']],
      ['🎙️ SALAS', 'membros', vozes(['🎙️ Alinhamento|lim15', '🧠 Brainstorm|lim8'])],
      staff('・', '🔒 GESTÃO'),
    ],
  },
  {
    slug: 'freelancer', nome: 'Freelancer', cat: 'profissional', estilo: 'clean', data: '2026-08-13',
    tags: ['freelancer', 'clientes', 'propostas', 'autônomo'],
    desc: 'Estrutura enxuta para freelancers: captação, propostas, projetos e pós-venda.',
    cargos: [
      ['⭐ Freelancer', '#F5CD79', 'owner'], ['🤝 Cliente', '#3DC1D3', 'partner', { key: 'cliente' }], ['🔎 Lead', '#C7ECEE', 'member', { key: 'lead', hoist: false }], ['🤖 Bots', '#778BEB', 'bot'],
    ],
    cats: [
      ['👋 APRESENTAÇÃO', 'leitura', ['👋・quem-sou|Sobre mim', '💼・servicos|O que ofereço', '🖼️・portfolio|Trabalhos anteriores', '⭐・depoimentos|Clientes satisfeitos', '💲・precos|Faixas de valor']],
      ['📝 CONTATO', null, ['📝・pedir-orcamento|Conte sobre seu projeto', '❓・duvidas|Perguntas antes de contratar', '📆・agendar-conversa|Marque uma call']],
      ['📂 PROJETOS', 'parceiros', ['📂・meu-projeto|Andamento do seu projeto', '📎・arquivos|Envio de materiais', '🔁・revisoes|Ajustes', '✅・entrega|Entrega final']],
      ['🔊 CALLS', 'parceiros', vozes(['📞 Reunião com Cliente|lim4', '🎧 Sala Aberta'])],
      ['🔧 BASTIDORES', 'gestao', ['📋・tarefas|Minhas tarefas', '💰・financeiro|Recebimentos']],
    ],
  },
  {
    slug: 'portfolio', nome: 'Portfolio', cat: 'profissional', estilo: 'showcase', data: '2026-09-18',
    tags: ['portfólio', 'carreira', 'vitrine', 'contato'],
    desc: 'Portfólio interativo em formato de servidor: projetos, currículo, blog e contato.',
    cargos: [
      ['🌟 Dono do Portfólio', '#FFD700', 'owner'], ['🧑‍💼 Recrutador', '#00B894', 'partner', { key: 'recrutador' }], ['🤝 Contratante', '#0984E3', 'partner', { key: 'contratante' }], ['👀 Visitante', '#B2BEC3', 'member', { hoist: false }],
    ],
    cats: [
      ['🌟 SOBRE', 'leitura', ['👤・sobre-mim|Quem sou e o que faço', '📄・curriculo|Experiência e formação', '🧰・skills|Tecnologias e habilidades', '🎓・certificacoes|Cursos e títulos']],
      ['🚀 PROJETOS', 'leitura', ['🚀・projeto-destaque|Meu melhor trabalho', '📁・projetos|Todos os projetos', '🧪・experimentos|Estudos e protótipos', '📰・blog|Artigos e reflexões']],
      ['🤝 CONTATO', null, ['📩・fale-comigo|Envie uma mensagem', '📆・agendar-entrevista|Marque um horário', '💬・livro-de-visitas|Deixe seu recado|lento30']],
      ['🎙️ SALA', null, vozes(['🎙️ Bate-papo Aberto|lim6'])],
      ['🔧 BASTIDORES', 'gestao', ['🔧・notas|Anotações internas']],
    ],
  },
  {
    slug: 'business', nome: 'Business', cat: 'profissional', estilo: 'executivo', data: '2026-09-04',
    tags: ['negócios', 'networking', 'empreendedorismo', 'mentoria'],
    desc: 'Comunidade de empreendedores: networking, oportunidades, mentorias e mastermind.',
    cargos: [
      ['💼 Founder', '#C8A951', 'owner'], ['🧭 Conselho', '#B33771', 'admin'], ['🎓 Mentor', '#3B3B98', 'helper', { key: 'mentor' }], ['🛡️ Moderação', '#182C61', 'mod'],
      ['🏆 Mastermind', '#FD7272', 'vip'], ['🤝 Sócio-Membro', '#58B19F', 'member'], ['🌱 Convidado', '#BDC581', 'cosmetic', { key: 'convidado', hoist: false }],
    ],
    cats: [
      info('｜', '💼 RECEPÇÃO', ['📜｜diretrizes|Conduta profissional', '📣｜novidades|Anúncios da comunidade']),
      ['🤝 NETWORKING', 'membros', ['🤝｜apresentacoes|Apresente seu negócio', '💬｜networking|Conversas do dia|lento5', '🔎｜oportunidades|Parcerias e vagas', '📣｜divulgue-seu-negocio|Vitrine (1x/semana)|lento3600']],
      ['📚 CONHECIMENTO', 'membros', ['📚｜biblioteca|Livros e materiais', '💡｜estrategia|Discussões de negócios', '💰｜financas|Finanças e investimentos', '📈｜vendas-e-marketing|Aquisição e receita']],
      ['🏆 MASTERMIND', 'vip', ['🏆｜mastermind|Grupo fechado', '📆｜encontros|Agenda dos encontros', 'v:🏆 Sala Mastermind|lim12']],
      ['🎓 MENTORIA', 'membros', ['🎓｜pedir-mentoria|Solicite um mentor', '❓｜tire-duvidas|Perguntas de negócio']],
      ['🎙️ SALAS', 'membros', vozes(['🎙️ Palestra|lim50', '☕ Café de Negócios|lim8', '🤝 Networking Rápido|lim6'])],
      staff('｜', '🔒 CONSELHO'),
    ],
  },
];
