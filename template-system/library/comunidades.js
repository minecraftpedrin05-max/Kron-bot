'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'community', nome: 'Community', cat: 'comunidades', estilo: 'clean', dest: true, data: '2026-09-09', ver: '1.4.0',
    tags: ['comunidade', 'geral', 'social', 'starter'],
    desc: 'Base equilibrada para qualquer comunidade: informações, chat, mídia, sugestões e staff.',
    cargos: [
      ['👑 Owner', '#F1C40F', 'owner'], ['⚡ Admin', '#E74C3C', 'admin'], ['🛡️ Moderador', '#3498DB', 'mod'], ['🔨 Helper', '#1ABC9C', 'helper'],
      ['💎 Apoiador', '#9B59B6', 'vip'], ['👤 Membro', '#95A5A6', 'member', { hoist: false }], ['🤖 Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('・', '📌 INFORMAÇÕES', ['📖・informacoes|Sobre o servidor', '🎭・cargos|Escolha seus cargos']),
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa geral|lento5', '📸・midia|Fotos e vídeos', '😂・memes|Humor', '💡・sugestoes|Ideias para o servidor|lento60']],
      ['🔊 VOZ', null, vozes(['🔊 Sala Geral', '🎧 Música', '💬 Conversa|lim5', '😴 AFK'])],
      ['🎫 AJUDA', null, ['🎫・tickets|Fale com a equipe', '❓・duvidas|Perguntas rápidas']],
      staff('・', '🔒 STAFF'),
    ],
  },
  {
    slug: 'community-premium', nome: 'Community Premium', cat: 'comunidades', estilo: 'premium', dest: true, prem: true, data: '2026-09-16', ver: '2.1.0',
    tags: ['comunidade', 'premium', 'níveis', 'eventos'],
    desc: 'Comunidade de alto nível com sistema de níveis, área premium, eventos e palco.',
    cargos: [
      ['👑 Owner', '#FFD700', 'owner'], ['💎 Co-Owner', '#00E5FF', 'admin', { key: 'coowner' }], ['⚡ Administrator', '#FF6D00', 'admin'], ['🛡️ Moderator', '#2979FF', 'mod'],
      ['🔨 Helper', '#26A69A', 'helper'], ['🎉 Event Host', '#EC407A', 'staff', { key: 'host' }], ['⭐ Premium', '#FBC02D', 'premium'], ['💎 VIP', '#7E57C2', 'vip'],
      ['🚀 Booster', '#FF8A80', 'booster'], ['👤 Member', '#90A4AE', 'member', { hoist: false }], ['🤖 Bots', '#607D8B', 'bot'],
    ],
    cats: [
      info('┃', '📌 WELCOME', ['🌟┃welcome|Apresentação do servidor', '🏅┃niveis-e-beneficios|Como subir de nível', '🎭┃self-roles|Cargos por interesse']),
      ['💬 COMMUNITY', null, ['💬┃chat|Conversa principal|lento5', '📸┃midia|Fotos e vídeos', '😂┃memes|Humor', '🎮┃games|Papo gamer', '🎵┃musica|Compartilhe músicas', '🐾┃pets|Seus bichinhos', '💡┃sugestoes|Sugestões|lento60']],
      ['🎉 EVENTOS', 'leitura', ['🎉┃eventos|Calendário de eventos', '🏆┃campeonatos|Competições internas', '🎁┃giveaways|Sorteios', '🗳️┃enquetes|Vote nas novidades']],
      ['⭐ PREMIUM', 'vip', ['⭐┃chat-premium|Área exclusiva', '🎁┃beneficios-premium|Vantagens ativas', '🧪┃beta-tests|Teste novidades', 'v:⭐ Lounge Premium']],
      ['🎙️ PALCO', 'palco', ['s:🎙️ Palco Principal', 's:🎤 Palco Aberto']],
      ['🔊 VOZ', null, vozes(['🔊 Sala Geral', '🎧 Música 1', '🎧 Música 2', '💬 Conversa 1|lim5', '💬 Conversa 2|lim5'])],
      ['🎫 SUPORTE', null, ['🎫┃tickets|Abra um ticket', '❓┃ajuda|Dúvidas rápidas', '🚫┃denuncias|Denuncie condutas']],
      staff('┃', '🔒 STAFF', ['📊┃metricas|Crescimento e engajamento', '🎉┃planejamento-de-eventos|Organização']),
    ],
  },
  {
    slug: 'social', nome: 'Social', cat: 'comunidades', estilo: 'fofo', data: '2026-08-16',
    tags: ['social', 'amizade', 'conversa', 'lifestyle'],
    desc: 'Espaço acolhedor para conversar, fazer amigos e compartilhar o dia a dia.',
    cargos: [
      ['🌸 Dona(o)', '#FF9FF3', 'owner'], ['🌷 Administração', '#F368E0', 'admin'], ['🍀 Guardiã(o)', '#1DD1A1', 'mod'], ['☕ Anfitrião', '#FF9F43', 'helper', { key: 'anfitriao' }],
      ['✨ Amigo Especial', '#FECA57', 'vip'], ['🫶 Membro', '#C8D6E5', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🌸 COMEÇO', ['👋・recepcao|Chegou? Fale oi!', '📜・cantinho-das-regras|Convivência saudável']),
      ['☕ CONVERSA', null, ['☕・bate-papo|Conversa do dia|lento5', '🌙・desabafo|Espaço acolhedor|lento10', '📸・fotos-do-dia|Compartilhe seu dia', '🍕・comidinhas|Receitas e fotos de comida', '🐶・pets|Nossos bichinhos']],
      ['🎨 HOBBIES', null, ['📚・livros|Leituras e indicações', '🎬・filmes-e-series|O que assistir', '🎧・playlist|Músicas do momento', '🎮・jogos|Games casuais']],
      ['🎈 DIVERSÃO', null, ['🎲・brincadeiras|Jogos da comunidade', '🔮・perguntas-do-dia|Pergunta para todos', ...vozes(['☕ Sala de Estar', '🎧 Ouvindo Juntos', '🌙 Papo Noturno|lim6'])]],
      staff('・', '🔒 CANTINHO DA EQUIPE'),
    ],
  },
  {
    slug: 'friends', nome: 'Friends', cat: 'comunidades', estilo: 'casual', data: '2026-08-04',
    tags: ['amigos', 'grupo privado', 'rolê', 'pequeno'],
    desc: 'Servidor enxuto para grupos de amigos: chat, jogos, fotos e call sempre aberta.',
    cargos: [
      ['👑 Dono da Casa', '#F6E58D', 'owner'], ['🔧 Admin da Resenha', '#FFBE76', 'admin'], ['😎 Parça', '#7ED6DF', 'member'], ['👀 Visita', '#DFF9FB', 'cosmetic', { key: 'visita', hoist: false }],
    ],
    cats: [
      ['🏠 A CASA', null, ['📌・regras-da-casa|Poucas e boas|leitura', '💬・resenha|Papo do dia|lento5', '📸・fotos|Fotos da galera', '😂・memes|Memes internos', '🍻・rolê|Combine encontros']],
      ['🎮 JOGATINA', null, ['🎮・qual-o-jogo|Vamos jogar?', '🏆・placar|Placar da resenha', ...vozes(['🔊 Call da Galera', '🎮 Call Jogo 1|lim6', '🎮 Call Jogo 2|lim6', '🎬 Cinema|lim10'])]],
      ['🔧 BASTIDORES', 'gestao', ['🔧・admin|Ajustes do servidor']],
    ],
  },
  {
    slug: 'creator-community', nome: 'Creator Community', cat: 'comunidades', estilo: 'criativo', data: '2026-09-06',
    tags: ['criadores', 'networking', 'feedback', 'colab'],
    desc: 'Comunidade para criadores trocarem feedback, colabs, dicas e divulgarem seu conteúdo.',
    cargos: [
      ['🌟 Fundador', '#FFA502', 'owner'], ['🧭 Admin', '#FF6348', 'admin'], ['🛡️ Curador', '#1E90FF', 'mod', { key: 'curador' }], ['🎓 Mentor', '#2ED573', 'helper', { key: 'mentor' }],
      ['🎬 Criador Verificado', '#A55EEA', 'creator', { key: 'verificado', mention: true }], ['🌱 Criador Iniciante', '#7BED9F', 'creator', { key: 'iniciante', hoist: false }], ['🙋 Membro', '#CED6E0', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '📌 INÍCIO', ['🌟・sobre|Nossa missão', '🎭・seu-nicho|Escolha sua área de atuação']),
      ['🎬 SHOWCASE', 'criadores', ['🎬・novos-videos|Vídeos dos criadores', '🎨・artes|Ilustrações e design', '🎙️・lives|Avisos de live', '🔊・audio|Podcasts e músicas']],
      ['🧠 APRENDIZADO', null, ['🎓・mentoria|Peça mentoria', '📚・recursos|Ferramentas e tutoriais', '📈・crescimento|Estratégias de audiência', '💬・feedback|Receba críticas construtivas|lento30']],
      ['🤝 COLAB', null, ['🤝・procuro-colab|Encontre parceiros', '📣・divulgacao|Divulgue com regras|lento1800', '🔁・troca-de-shoutouts|Ajuda mútua']],
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa geral|lento5', ...vozes(['🎙️ Sala de Criação', '🎧 Coworking|lim8', '🎥 Revisão de Vídeos|lim6'])]],
      staff('・', '🔒 CURADORIA', ['✅・verificacao|Analisar pedidos de verificado']),
    ],
  },
  {
    slug: 'public-community', nome: 'Public Community', cat: 'comunidades', estilo: 'moderno', data: '2026-08-24', ver: '1.1.0',
    tags: ['público', 'grande', 'moderação', 'verificação'],
    desc: 'Servidor público de grande porte, com verificação, chat moderado e forte estrutura de moderação.',
    cargos: [
      ['👑 Owner', '#F1C40F', 'owner'], ['🌐 Head Admin', '#C0392B', 'admin', { key: 'head' }], ['⚡ Admin', '#E67E22', 'admin'], ['🛡️ Senior Mod', '#2980B9', 'mod', { key: 'srmod', extra: ['BanMembers'] }],
      ['🔨 Moderator', '#3498DB', 'mod'], ['🤝 Trial Mod', '#1ABC9C', 'helper', { key: 'trial' }], ['✅ Verificado', '#2ECC71', 'member'], ['🤖 Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('┃', '📌 CENTRAL', ['✅┃verificacao|Clique para se verificar', '📖┃guia-do-servidor|Como tudo funciona', '📰┃novidades|Atualizações']),
      ['💬 CHAT PÚBLICO', 'mudo', ['💬┃chat-geral|Conversa moderada|lento10', '🖼️┃midia|Compartilhe imagens|lento30', '😂┃memes|Humor com moderação|lento30', '💡┃sugestoes|Ideias|lento60']],
      ['🌍 IDIOMAS', null, ['🇧🇷┃portugues|Papo em português|lento5', '🇺🇸┃english|Chat in English|lento5', '🇪🇸┃espanol|Charla en español|lento5']],
      ['🔊 VOZ PÚBLICA', null, vozes(['🔊 Sala 1|lim15', '🔊 Sala 2|lim15', '🎧 Música|lim20', '🎮 Gaming|lim10'])],
      ['🎫 AJUDA', null, ['🎫┃tickets|Fale com a moderação', '🚫┃denunciar|Denuncie usuários']],
      staff('┃', '🔒 MODERAÇÃO', ['🧾┃casos|Histórico de punições', '⚖️┃apelacoes|Apelações de ban', '📚┃treinamento|Material para novos mods']),
    ],
  },
  {
    slug: 'entertainment', nome: 'Entertainment', cat: 'comunidades', estilo: 'vibrante', data: '2026-08-30',
    tags: ['entretenimento', 'filmes', 'séries', 'jogos'],
    desc: 'Cultura pop em um só lugar: filmes, séries, música, games e noites de cinema.',
    cargos: [
      ['🎬 Diretor', '#FFC048', 'owner'], ['🎞️ Produtor', '#FF5E57', 'admin'], ['🛡️ Segurança', '#575FCF', 'mod'], ['🍿 Curador de Sessão', '#0BE881', 'helper', { key: 'curador' }],
      ['🌟 Estrela', '#FFDD59', 'vip'], ['🎟️ Espectador', '#D2DAE2', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎬 BILHETERIA', ['📜・regras|Ingresso e conduta', '📅・programacao|O que vem por aí']),
      ['🍿 CINEMA', null, ['🍿・filmes|Debata filmes', '📺・series|Debata séries', '⚠️・spoilers|Com spoiler, por sua conta', '⭐・criticas|Suas resenhas']],
      ['🎧 MÚSICA & GAMES', null, ['🎧・musica|Músicas e clipes', '🎮・games|Lançamentos e opiniões', '🎲・jogos-do-servidor|Quiz e brincadeiras']],
      ['🎭 SESSÕES', null, ['🎭・sessao-em-grupo|Combine sessões', 's:🎬 Cinema da Comunidade', 'v:🍿 Sala de Sessão|lim20']],
      ['💬 FOYER', null, ['💬・chat-geral|Bate-papo|lento5', '😂・memes|Memes pop', ...vozes(['🔊 Foyer', '🎧 Playlist Colaborativa'])]],
      staff('・', '🔒 BASTIDORES'),
    ],
  },
  {
    slug: 'anime', nome: 'Anime', cat: 'comunidades', estilo: 'anime', dest: true, data: '2026-09-11', ver: '1.2.0',
    tags: ['anime', 'mangá', 'otaku', 'cosplay'],
    desc: 'Comunidade otaku com discussão de animes e mangás, fanarts, cosplay e watch parties.',
    cargos: [
      ['🌸 Hokage', '#FF9FF3', 'owner'], ['⛩️ Sannin', '#F368E0', 'admin'], ['🗡️ Jounin', '#54A0FF', 'mod'], ['🍥 Chunin', '#1DD1A1', 'helper'],
      ['🎨 Artista', '#FECA57', 'creator'], ['👘 Cosplayer', '#FF6B6B', 'creator', { key: 'cosplayer' }], ['🌟 Otaku Lendário', '#A29BFE', 'vip'], ['🍙 Genin', '#C8D6E5', 'member', { hoist: false }],
    ],
    cats: [
      info('✦', '⛩️ ENTRADA', ['📜✦regras|Regras da vila', '🎭✦cargos-e-generos|Escolha seus gêneros favoritos']),
      ['📺 ANIMES', null, ['📺✦anime-da-temporada|O que está passando', '⚠️✦spoilers|Fale sem medo de spoiler', '⭐✦recomendacoes|Indique e peça indicações', '🏆✦rankings|Tops da comunidade']],
      ['📖 MANGÁS & LIGHT NOVELS', null, ['📖✦mangas|Capítulos e teorias', '📚✦light-novels|Leituras', '🖋️✦teorias|Discussões profundas']],
      ['🎨 CRIATIVO', null, ['🎨✦fanarts|Suas artes', '👘✦cosplay|Fotos de cosplay', '🎬✦amv-e-edits|Edições e AMVs', '✍️✦fanfics|Histórias']],
      ['🎉 EVENTOS', 'leitura', ['🍿✦watch-party|Sessões coletivas', '🏆✦torneios-e-quiz|Competições', '🎁✦sorteios|Prêmios otaku']],
      ['💬 VILA', null, ['💬✦chat-geral|Conversa livre|lento5', '🎮✦jogos-otaku|Gacha e visual novels', ...vozes(['🍥 Ichiraku Ramen', '🍿 Watch Party|lim25', '🎧 Openings & Endings'])]],
      staff('✦', '🔒 CONSELHO DA VILA'),
    ],
  },
  {
    slug: 'music', nome: 'Music', cat: 'comunidades', estilo: 'groove', data: '2026-08-19',
    tags: ['música', 'playlists', 'bandas', 'produção'],
    desc: 'Comunidade musical com compartilhamento de faixas, feedback de produtores e sessões de escuta.',
    cargos: [
      ['🎼 Maestro', '#F8EFBA', 'owner'], ['🎚️ Produtor Executivo', '#FD7272', 'admin'], ['🎧 DJ Mod', '#3B3B98', 'mod'], ['🎙️ Artista', '#55E6C1', 'creator'],
      ['🎸 Músico', '#58B19F', 'creator', { key: 'musico', hoist: false }], ['💿 Ouvinte VIP', '#B33771', 'vip'], ['🎵 Ouvinte', '#CAD3C8', 'member', { hoist: false }],
    ],
    cats: [
      info('♪', '🎼 PALCO PRINCIPAL', ['📜♪regras|Regras de convivência', '📢♪lancamentos|Lançamentos dos membros']),
      ['🎧 OUVIR & INDICAR', null, ['🎧♪indicacoes|Indique faixas', '📀♪albuns|Álbuns da semana', '🎶♪playlists|Compartilhe playlists', '🎤♪shows|Shows e ingressos']],
      ['🎛️ PRODUÇÃO', 'criadores', ['🎛️♪feedback-de-mix|Envie sua mix', '🎹♪beats-e-samples|Beats e samples', '📚♪tutoriais|Aprenda produção', '🤝♪procuro-banda|Conecte-se com músicos']],
      ['💬 LOUNGE', null, ['💬♪chat|Papo de música|lento5', '🎲♪quiz-musical|Adivinhe a música', ...vozes(['🎧 Sessão de Escuta', '🎸 Jam Session|lim8', '🎤 Karaokê|lim12', '🔊 Lounge'])]],
      ['🎙️ PALCO', 'palco', ['s:🎙️ Show ao Vivo']],
      staff('♪', '🔒 BASTIDORES'),
    ],
  },
  {
    slug: 'events', nome: 'Events', cat: 'comunidades', estilo: 'festivo', data: '2026-09-17',
    tags: ['eventos', 'calendário', 'inscrições', 'palco'],
    desc: 'Central de eventos com agenda, inscrições, palco, feedback e equipe organizadora.',
    cargos: [
      ['🎪 Produtor Geral', '#FFC312', 'owner'], ['📋 Coordenador', '#EE5A24', 'admin'], ['🎤 Apresentador', '#9980FA', 'creator', { key: 'apresentador', mention: true }],
      ['🛡️ Segurança', '#0652DD', 'mod'], ['📣 Comunicação', '#009432', 'staff', { key: 'comunicacao' }], ['🌟 Convidado VIP', '#FDA7DF', 'vip'], ['🎟️ Participante', '#C4E538', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎪 PROGRAMAÇÃO', ['🎟️・como-participar|Ingressos e regras', '📆・agenda|Calendário completo', '🗺️・mapa-do-evento|Salas e horários']),
      ['📝 INSCRIÇÕES', null, ['📝・inscricoes|Faça sua inscrição', '✅・confirmacoes|Presenças confirmadas|leitura', '❓・duvidas|Perguntas sobre o evento']],
      ['🎙️ PALCOS', 'palco', ['s:🎙️ Palco Principal', 's:🎤 Palco 2', 's:💡 Workshop']],
      ['💬 NETWORKING', null, ['💬・chat-do-evento|Converse com participantes|lento5', '📸・fotos|Registros do evento', '🤝・networking|Conecte-se', ...vozes(['🤝 Mesa 1|lim8', '🤝 Mesa 2|lim8', '🎧 Lounge'])]],
      ['⭐ PÓS-EVENTO', null, ['⭐・feedback|Avalie o evento|lento30', '🏆・premiacao|Resultados e prêmios|leitura']],
      staff('・', '🔒 ORGANIZAÇÃO', ['📋・checklist|Tarefas da produção', '📣・comunicacao|Textos e artes']),
    ],
  },
];
