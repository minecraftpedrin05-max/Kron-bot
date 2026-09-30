'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  // ─────────── PARCERIAS ───────────
  {
    slug: 'parcerias', nome: 'Parcerias', cat: 'outros', estilo: 'corporativo', data: '2026-08-07',
    tags: ['parcerias', 'divulgação cruzada', 'servidores parceiros', 'rede'],
    desc: 'Central de parcerias entre servidores: propostas, requisitos, canais de parceiros e acordos.',
    cargos: [
      ['🤝 Diretor de Parcerias', '#F9CA24', 'owner'], ['📋 Gerente', '#F0932B', 'admin'], ['🛡️ Moderação', '#4834D4', 'mod'], ['🌐 Servidor Parceiro', '#22A6B3', 'partner'], ['🙋 Visitante', '#95AFC0', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🤝 PROGRAMA', ['📖・como-funciona|Nosso programa de parcerias', '✅・requisitos|Critérios para ser parceiro', '📜・termos|Termos e conduta']),
      ['📝 PROPOSTAS', null, ['📝・enviar-proposta|Solicite uma parceria', '⏳・em-analise|Propostas em análise|leitura', '✅・aprovadas|Parcerias fechadas|leitura']],
      ['🌐 PARCEIROS', 'parceiros', ['🌐・vitrine-de-parceiros|Servidores parceiros', '📣・divulgacao-cruzada|Anúncios entre parceiros|lento3600', '💬・lounge-de-parceiros|Conversa entre donos', 'v:🤝 Sala de Parceiros|lim10']],
      staff('・', '🔒 EQUIPE', ['🔎・avaliacao-de-servidores|Análise de candidatos']),
    ],
  },
  // ─────────── DIVULGAÇÃO ───────────
  {
    slug: 'divulgacao', nome: 'Divulgação', cat: 'outros', estilo: 'vibrante', data: '2026-08-12',
    tags: ['divulgação', 'promoção', 'servidores', 'crescimento'],
    desc: 'Servidor de divulgação organizado por nicho, com regras claras e cooldown para evitar spam.',
    cargos: [
      ['📣 Dono', '#FF793F', 'owner'], ['⚙️ Admin', '#EE5A24', 'admin'], ['🛡️ Moderador', '#0652DD', 'mod'], ['⭐ Divulgador Ativo', '#009432', 'vip'], ['🙋 Membro', '#D1D8E0', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 REGRAS', ['📜・regras-de-divulgacao|Leia antes de postar', '⏱️・cooldown|Tempo entre divulgações']),
      ['📣 DIVULGUE', null, ['🎮・servidores-de-games|Divulgue servidores gamers|lento7200', '💬・comunidades|Comunidades em geral|lento7200', '🛒・lojas-e-servicos|Vendas e serviços|lento7200', '🎨・criadores|Canais e criadores|lento7200', '🤖・bots|Bots e ferramentas|lento7200']],
      ['💬 CONVERSA', null, ['💬・chat|Bate-papo|lento5', '🔄・parceria-rapida|Proponha trocas de divulgação|lento600', '⭐・feedback|Avalie o servidor|lento60']],
      ['⭐ DIVULGADORES ATIVOS', 'vip', ['⭐・destaque-semanal|Divulgação com mais alcance', '🎁・beneficios|Vantagens para ativos']],
      staff('・', '🔒 STAFF', ['🚫・denuncias-de-spam|Denúncias']),
    ],
  },
  // ─────────── SORTEIOS ───────────
  {
    slug: 'sorteios', nome: 'Sorteios', cat: 'outros', estilo: 'festivo', data: '2026-09-01',
    tags: ['sorteios', 'giveaway', 'prêmios', 'eventos'],
    desc: 'Servidor focado em sorteios: regras, sorteios ativos, ganhadores, provas e reivindicação de prêmios.',
    cargos: [
      ['🎁 Organizador', '#FDA7DF', 'owner'], ['🎉 Gerente de Sorteios', '#FFC312', 'admin'], ['🛡️ Auditor', '#12CBC4', 'mod', { key: 'auditor' }], ['🏆 Ganhador', '#F79F1F', 'vip', { key: 'ganhador' }], ['🎟️ Participante', '#C4E538', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎁 COMO FUNCIONA', ['📜・regras-dos-sorteios|Elegibilidade e regras', '🧾・transparencia|Como sorteamos (auditável)']),
      ['🎉 SORTEIOS', 'leitura', ['🎉・sorteios-ativos|Participe agora', '⏳・encerrando-hoje|Últimas horas', '🏆・ganhadores|Quem levou os prêmios', '📸・provas-de-entrega|Comprovantes de entrega']],
      ['🎫 PRÊMIOS', null, ['🎫・resgatar-premio|Ganhou? Fale aqui', '❓・duvidas|Perguntas sobre sorteios', '💡・sugerir-sorteio|Que prêmio você quer?|lento60']],
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa geral|lento5', '🍀・boa-sorte|Torça pelos amigos', 'v:🎲 Sorteio ao Vivo']],
      staff('・', '🔒 ORGANIZAÇÃO', ['🎲・sorteio-interno|Preparação e sorteio|gestao', '🧾・auditoria|Registros dos sorteios']),
    ],
  },
  // ─────────── NOTÍCIAS ───────────
  {
    slug: 'noticias', nome: 'Notícias', cat: 'outros', estilo: 'jornal', data: '2026-08-19',
    tags: ['notícias', 'jornalismo', 'atualidades', 'newsroom'],
    desc: 'Redação em servidor: editorias, fontes, verificação de fatos, chat de leitores e newsletter.',
    cargos: [
      ['📰 Editor-Chefe', '#F5F6FA', 'owner'], ['🗞️ Editor', '#EA8685', 'admin', { key: 'editor' }], ['✍️ Repórter', '#546DE5', 'creator', { key: 'reporter' }], ['🔎 Checador de Fatos', '#3DC1D3', 'mod', { key: 'checador' }],
      ['⭐ Leitor Assinante', '#F5CD79', 'vip'], ['👤 Leitor', '#C7ECEE', 'member', { hoist: false }],
    ],
    cats: [
      info('｜', '📰 REDAÇÃO', ['📜｜politica-editorial|Nossos princípios', '📢｜ultimas-noticias|Manchetes do momento']),
      ['🗞️ EDITORIAS', 'criadores', ['🌎｜mundo|Internacional', '🇧🇷｜brasil|Nacional', '💼｜economia|Mercado e negócios', '🎮｜tecnologia|Tech e games', '⚽｜esportes|Esportes', '🎬｜cultura|Entretenimento']],
      ['💬 LEITORES', null, ['💬｜debate|Converse sobre as notícias|lento10', '❓｜pergunte-a-redacao|Envie perguntas', '🚩｜desinformacao|Denuncie boatos']],
      ['⭐ ASSINANTES', 'vip', ['⭐｜newsletter|Resumo exclusivo', '🗣️｜conversa-com-a-redacao|Fale com os editores']],
      ['✍️ REDAÇÃO INTERNA', 'staff', ['✍️｜pauta|Pautas do dia', '🔎｜checagem|Verificação de fatos', '🕓｜fechamento|Fechamento da edição', 'v:🎙️ Reunião de Pauta|lim10']],
      staff('｜', '🔒 DIREÇÃO'),
    ],
  },
  // ─────────── PROJETOS ───────────
  {
    slug: 'projetos', nome: 'Projetos', cat: 'outros', estilo: 'clean', data: '2026-08-28',
    tags: ['projetos', 'colaboração', 'gestão de projetos', 'equipes'],
    desc: 'Espaço para gerir projetos colaborativos: um canal por projeto, tarefas, reuniões e entregas.',
    cargos: [
      ['🧭 Gerente de Projetos', '#F6B93B', 'owner'], ['📋 Coordenador', '#E55039', 'admin'], ['🛠️ Colaborador', '#4A69BD', 'dev', { key: 'colab' }], ['👀 Stakeholder', '#78E08F', 'partner', { key: 'stakeholder' }], ['👥 Membro', '#CAD3C8', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 PMO', ['📢・avisos|Comunicados de projeto', '🗺️・portfolio-de-projetos|Visão geral']),
      ['🚀 PROJETO ALFA', 'membros', ['📋・alfa-tarefas|Backlog e tarefas', '💬・alfa-chat|Conversa do time', '📎・alfa-arquivos|Materiais']],
      ['🚀 PROJETO BETA', 'membros', ['📋・beta-tarefas|Backlog e tarefas', '💬・beta-chat|Conversa do time', '📎・beta-arquivos|Materiais']],
      ['📦 ENTREGAS', 'leitura', ['✅・entregas-concluidas|Histórico de entregas', '📈・status-semanal|Relatório semanal', '🐞・riscos-e-bloqueios|O que impede o avanço']],
      ['🎙️ REUNIÕES', 'membros', vozes(['🎙️ Daily|lim15', '🧭 Planejamento|lim12', '🤝 Reunião com Stakeholders|lim10'])],
      staff('・', '🔒 GESTÃO', ['💰・orcamento|Custos e prazos|gestao']),
    ],
  },
  // ─────────── NETWORK ───────────
  {
    slug: 'network', nome: 'Network', cat: 'outros', estilo: 'moderno', data: '2026-09-05',
    tags: ['network', 'rede de servidores', 'hub', 'comunidades'],
    desc: 'Hub central de uma rede de servidores: diretório, comunicados globais, staff geral e eventos da rede.',
    cargos: [
      ['🌐 Network Owner', '#00CEC9', 'owner'], ['⚙️ Network Admin', '#FDCB6E', 'admin'], ['🛡️ Network Mod', '#6C5CE7', 'mod'], ['🏷️ Dono de Servidor', '#55EFC4', 'partner', { key: 'donoserver' }],
      ['🧑‍🤝‍🧑 Membro da Rede', '#81ECEC', 'member'], ['🤖 Bots', '#636E72', 'bot'],
    ],
    cats: [
      info('┃', '🌐 REDE', ['🌐┃sobre-a-rede|Quem faz parte', '📢┃comunicados-globais|Avisos para todos os servidores', '🗺️┃diretorio|Lista de servidores']),
      ['💬 COMUNIDADE DA REDE', null, ['💬┃chat-global|Conversa entre todos|lento5', '💡┃ideias-para-a-rede|Sugestões|lento60', '🎉┃eventos-da-rede|Eventos conjuntos|leitura', ...vozes(['🔊 Sala da Rede', '🎧 Música da Rede'])]],
      ['🏷️ DONOS DE SERVIDOR', 'parceiros', ['🏷️┃lounge-de-donos|Conversa entre donos', '🤝┃parcerias-internas|Ações conjuntas', '📚┃boas-praticas|Gestão de comunidades', 'v:🏷️ Reunião de Donos|lim12']],
      ['🛡️ MODERAÇÃO', 'staff', ['🚨┃denuncias-globais|Casos entre servidores', '🔨┃banimentos-sincronizados|Lista compartilhada']],
      staff('┃', '🔒 ADMINISTRAÇÃO DA REDE'),
    ],
  },
  // ─────────── VIP COMMUNITY ───────────
  {
    slug: 'vip-community', nome: 'VIP Community', cat: 'outros', estilo: 'luxo', prem: true, data: '2026-09-16',
    tags: ['vip', 'exclusivo', 'assinatura', 'clube'],
    desc: 'Clube exclusivo por assinatura: níveis de acesso, concierge, eventos privados e conteúdo premium.',
    cargos: [
      ['👑 Owner', '#D4AF37', 'owner'], ['🥂 Concierge', '#C0C0C0', 'admin', { key: 'concierge' }], ['🛡️ Guardião', '#7D5BA6', 'mod'], ['💎 Diamond', '#7EE8FA', 'premium', { key: 'diamond' }],
      ['🥇 Gold', '#F5C542', 'vip', { key: 'gold' }], ['🥈 Silver', '#B8C1CC', 'vip', { key: 'silver', hoist: false }], ['🚪 Convidado', '#6B7280', 'member', { hoist: false }],
    ],
    cats: [
      ['🚪 RECEPÇÃO', 'leitura', ['👋┃boas-vindas|Bem-vindo ao clube', '📜┃regras-do-clube|Conduta e privacidade', '🏅┃niveis-de-acesso|Silver, Gold e Diamond', '💳┃assinar|Como participar']],
      ['🥈 SALÃO SILVER', 'vip', ['💬┃chat-silver|Conversa dos membros', '🎁┃beneficios-silver|Vantagens']],
      ['🥇 SALÃO GOLD', 'vip', ['💬┃chat-gold|Conversa Gold', '🎟️┃eventos-gold|Eventos exclusivos', 'v:🥇 Lounge Gold|lim15']],
      ['💎 SALÃO DIAMOND', 'gestao', ['💎┃chat-diamond|Somente Diamond', '🔑┃acesso-antecipado|Lançamentos em primeira mão', '🥂┃concierge|Fale com seu concierge', 'v:💎 Suíte Diamond|lim8']],
      ['🎉 EVENTOS PRIVADOS', 'vip', ['📆┃agenda-de-eventos|Programação', 'v:🎙️ Palestra Exclusiva|lim50']],
      staff('┃', '🔒 BASTIDORES', ['💳┃assinaturas|Controle de assinaturas|gestao']),
    ],
  },

  // ═════════════════ EDUCAÇÃO ═════════════════
  {
    slug: 'estudos', nome: 'Estudos', cat: 'educacao', estilo: 'foco', dest: true, data: '2026-09-14', ver: '1.1.0',
    tags: ['estudos', 'concursos', 'vestibular', 'pomodoro'],
    desc: 'Grupo de estudos com salas de foco, metas, resumos por matéria e dúvidas.',
    cargos: [
      ['📚 Coordenador', '#F6B93B', 'owner'], ['🎓 Monitor', '#38ADA9', 'admin', { key: 'monitor' }], ['🛡️ Moderador', '#3C6382', 'mod'], ['🧠 Estudante Dedicado', '#B8E994', 'vip', { key: 'dedicado' }], ['✏️ Estudante', '#DFE4EA', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 COMECE POR AQUI', ['📖・como-usar|Regras e rotinas', '🎯・metas-da-semana|Metas coletivas']),
      ['📚 MATÉRIAS', null, ['➗・matematica|Cálculo e lógica', '🧪・ciencias|Física, química e biologia', '📜・humanas|História, geografia e filosofia', '✍️・linguagens|Português, redação e idiomas', '💻・tecnologia|Programação e computação']],
      ['📝 PRODUÇÃO', null, ['📝・resumos|Compartilhe resumos', '🃏・flashcards|Cartões de revisão', '📆・cronogramas|Planos de estudo', '❓・duvidas|Pergunte e ajude|lento10']],
      ['⏳ SALAS DE FOCO', null, vozes(['🍅 Pomodoro 25/5|lim15', '🤫 Silêncio Total|lim10', '📖 Estudo em Grupo|lim8', '☕ Intervalo'])],
      ['💬 COMUNIDADE', null, ['💬・resenha|Descontrai o estudo|lento5', '🏆・conquistas|Aprovações e metas batidas', '🎵・playlists-de-foco|Trilhas para estudar']],
      staff('・', '🔒 COORDENAÇÃO'),
    ],
  },
  {
    slug: 'curso-online', nome: 'Curso Online', cat: 'educacao', estilo: 'profissional', data: '2026-09-09',
    tags: ['curso', 'aulas', 'alunos', 'mentoria'],
    desc: 'Servidor de curso online: módulos, aulas ao vivo, plantão de dúvidas, materiais e certificados.',
    cargos: [
      ['🎓 Professor', '#F1C40F', 'owner'], ['📋 Coordenação', '#E67E22', 'admin'], ['🧑‍🏫 Monitor', '#2ECC71', 'helper', { key: 'monitor' }], ['🛡️ Suporte ao Aluno', '#3498DB', 'support'],
      ['🏅 Aluno Destaque', '#9B59B6', 'vip', { key: 'destaque' }], ['📘 Aluno', '#95A5A6', 'member'], ['👀 Interessado', '#BDC3C7', 'cosmetic', { key: 'interessado', hoist: false }],
    ],
    cats: [
      info('｜', '🎓 SECRETARIA', ['📢｜avisos|Comunicados da turma', '📅｜calendario|Aulas e entregas', '📜｜regulamento|Regras do curso']),
      ['📘 MÓDULOS', 'membros', ['1️⃣｜modulo-1|Fundamentos', '2️⃣｜modulo-2|Prática guiada', '3️⃣｜modulo-3|Projeto aplicado', '📎｜materiais|Apostilas e arquivos']],
      ['🎙️ AULAS AO VIVO', 'membros', ['🎙️｜chat-da-aula|Interaja durante a aula|lento10', 's:🎓 Sala de Aula', 'v:👥 Trabalho em Grupo|lim8']],
      ['❓ DÚVIDAS', 'membros', ['❓｜duvidas|Pergunte aos monitores', '🆘｜plantao|Plantão de dúvidas', '💡｜boas-praticas|Dicas dos professores']],
      ['🏆 RESULTADOS', 'membros', ['📝｜entregas|Envie suas atividades', '🏅｜certificados|Emissão de certificados', '⭐｜depoimentos|Conte sua experiência|lento30']],
      ['💬 TURMA', 'membros', ['💬｜resenha|Conversa da turma|lento5', '🤝｜networking|Conecte-se com colegas']],
      staff('｜', '🔒 CORPO DOCENTE', ['📊｜notas|Notas e frequência|gestao']),
    ],
  },
  {
    slug: 'bootcamp-dev', nome: 'Bootcamp Dev', cat: 'educacao', estilo: 'dev', data: '2026-09-17',
    tags: ['bootcamp', 'programação', 'mentoria', 'projetos'],
    desc: 'Bootcamp de programação intensivo: semanas temáticas, code review, mentorias e projeto final.',
    cargos: [
      ['🧠 Head do Bootcamp', '#00D2D3', 'owner'], ['📋 Coordenador', '#FF9F43', 'admin'], ['🧑‍🏫 Mentor', '#10AC84', 'dev', { key: 'mentor', extra: ['ManageThreads'] }], ['🛡️ Suporte', '#5F27CD', 'support'],
      ['🚀 Bootcamper', '#54A0FF', 'member'], ['🏆 Formado', '#FECA57', 'vip', { key: 'formado' }],
    ],
    cats: [
      info('┃', '📌 ONBOARDING', ['📖┃como-funciona|Metodologia do bootcamp', '📆┃cronograma|Semana a semana', '🧭┃trilha|O que você vai aprender']),
      ['📘 SEMANAS', 'membros', ['1️⃣┃semana-1-fundamentos|Lógica e terminal', '2️⃣┃semana-2-frontend|HTML, CSS e JavaScript', '3️⃣┃semana-3-backend|APIs e bancos de dados', '4️⃣┃semana-4-projeto-final|Construção do projeto']],
      ['🧪 PRÁTICA', 'membros', ['🧪┃desafios-diarios|Exercícios do dia', '🔀┃code-review|Revisão de código', '🐞┃debug-help|Pedir ajuda com erros|lento10', '🙌┃demo-day|Apresente seu projeto']],
      ['🎓 MENTORIA', 'membros', ['🎓┃pedir-mentoria|Agende com um mentor', '💼┃carreira|Currículo, LinkedIn e entrevistas', ...vozes(['🎙️ Aula ao Vivo|lim50', '🧑‍💻 Pair Programming 1|lim3', '🧑‍💻 Pair Programming 2|lim3', '🆘 Plantão de Dúvidas|lim6'])]],
      ['💬 TURMA', 'membros', ['💬┃resenha|Conversa da turma|lento5', '🏆┃conquistas|Comemore vitórias']],
      staff('┃', '🔒 EQUIPE PEDAGÓGICA', ['📊┃acompanhamento|Progresso dos alunos|gestao']),
    ],
  },
];
