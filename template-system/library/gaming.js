'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'gaming-community', nome: 'Gaming Community', cat: 'gaming', estilo: 'gamer', dest: true, data: '2026-09-10', ver: '1.3.0',
    tags: ['gaming', 'comunidade', 'lfg', 'clips'],
    desc: 'Comunidade gamer completa com busca de squad, clips, eventos e salas de voz por jogo.',
    cargos: [
      ['👑 Founder', '#FFD32A', 'owner'], ['⚡ Admin', '#FF3F34', 'admin'], ['🛡️ Moderador', '#0FBCF9', 'mod'], ['🎧 Helper', '#05C46B', 'helper'],
      ['🏆 Lenda', '#FFA801', 'vip', { key: 'lenda' }], ['🎬 Streamer', '#A55EEA', 'creator'], ['🚀 Booster', '#FD79A8', 'booster'], ['🎮 Gamer', '#808E9B', 'member', { hoist: false }], ['🤖 Bots', '#485460', 'bot'],
    ],
    cats: [
      info('┃', '🎮 START', ['🎮┃bem-vindo|Comece por aqui', '🎭┃cargos|Escolha seus jogos']),
      ['💬 GERAL', null, ['💬┃chat-geral|Papo livre|lento5', '😂┃memes|Memes gamers', '📷┃clips|Suas melhores jogadas', '🎵┃musica|Comandos de música']],
      ['🔎 LFG', null, ['🔎┃procuro-squad|Ache jogadores', '🏆┃ranked|Duos e trios ranqueados', '🎲┃casual|Partidas descontraídas']],
      ['🏟️ EVENTOS', 'leitura', ['🏟️┃torneios|Campeonatos da comunidade', '🎁┃sorteios|Prêmios e sorteios', '📆┃agenda|Calendário de eventos']],
      ['🔊 VOZ', null, vozes(['🎧 Lobby Geral', '🎮 Squad Alpha|lim5', '🎮 Squad Bravo|lim5', '🎮 Squad Charlie|lim5', '🏆 Ranked|lim3', '😴 AFK'])],
      ['🎙️ PALCO', 'palco', ['s:🎙️ Palco da Comunidade']],
      staff('┃', '🔒 STAFF', ['📊┃relatorios|Denúncias e relatórios']),
    ],
  },
  {
    slug: 'clan', nome: 'Clan', cat: 'gaming', estilo: 'militar', data: '2026-08-14',
    tags: ['clan', 'squad', 'recrutamento', 'treinos'],
    desc: 'Estrutura hierárquica de clan com recrutamento, treinos e sala de guerra.',
    cargos: [
      ['⚔️ Líder', '#C0392B', 'owner'], ['🛡️ Vice-Líder', '#E67E22', 'admin'], ['🎖️ Capitão', '#F1C40F', 'mod'], ['🔰 Recrutador', '#2ECC71', 'staff', { key: 'recrutador' }],
      ['🗡️ Elite', '#3498DB', 'vip'], ['⚔️ Membro do Clan', '#7F8C8D', 'member'], ['🕵️ Recruta', '#95A5A6', 'cosmetic', { key: 'recruta', hoist: false }],
    ],
    cats: [
      info('｜', '📜 QUARTEL', ['🏛️｜sobre-o-clan|História e regras', '⚔️｜codigo-de-conduta|Regras internas']),
      ['🔰 RECRUTAMENTO', null, ['📝｜candidatura|Envie sua candidatura', '📊｜requisitos|O que exigimos', '🗂️｜resultados|Aprovados da semana|leitura']],
      ['⚔️ OPERAÇÕES', 'membros', ['⚔️｜guerra|Comunicados de guerra', '📆｜treinos|Agenda de treinos', '🎯｜estrategias|Táticas e mapas', '🏅｜ranking-interno|Desempenho dos membros']],
      ['💬 SOCIAL', 'membros', ['💬｜chat-do-clan|Conversa da equipe|lento5', '📸｜clips|Highlights', ...vozes(['🎧 Comunicação|lim10', '⚔️ Sala de Guerra|lim8', '🎮 Treino Livre'])]],
      ['🎖️ COMANDO', 'staff', ['🎖️｜comando|Decisões de liderança', '📋｜avaliacoes|Avaliação de membros', 'v:🎙️ Alto Comando']],
    ],
  },
  {
    slug: 'guild', nome: 'Guild', cat: 'gaming', estilo: 'fantasia', data: '2026-08-02',
    tags: ['guild', 'mmo', 'raid', 'rpg'],
    desc: 'Guilda para jogos de RPG/MMO com raids, banco da guilda e crafting.',
    cargos: [
      ['🏰 Guild Master', '#F7B731', 'owner'], ['📜 Oficial', '#EB3B5A', 'admin'], ['🛡️ Tank Leader', '#2D98DA', 'mod', { key: 'tankleader' }],
      ['🔮 Veterano', '#8854D0', 'vip'], ['🗡️ Aventureiro', '#20BF6B', 'member'], ['🌱 Iniciante', '#A5B1C2', 'cosmetic', { key: 'iniciante', hoist: false }], ['🤖 Bots', '#4B6584', 'bot'],
    ],
    cats: [
      info('・', '🏰 SALÃO PRINCIPAL', ['📖・lore-e-regras|Nossa história', '🪧・quadro-de-avisos|Comunicados', '🎭・classes|Escolha sua classe']),
      ['⚔️ RAIDS & DUNGEONS', 'membros', ['🐉・agenda-de-raids|Datas e horários', '📋・composicao|Montagem de grupos', '🏆・loot-e-drops|Registro de loot', '🧭・guias|Estratégias por encontro']],
      ['💰 BANCO DA GUILD', 'membros', ['💰・banco|Depósitos e retiradas', '⚒️・crafting|Pedidos de craft', '🔁・trocas|Troque itens entre membros']],
      ['🍻 TAVERNA', null, ['🍻・taverna|Conversa livre|lento5', '📸・screenshots|Cenários do jogo', ...vozes(['🍻 Taverna', '🐉 Raid 1|lim20', '🐉 Raid 2|lim20', '🗺️ Exploração|lim6'])]],
      staff('・', '🔒 CONSELHO', ['📜・recrutamento|Análise de candidatos']),
    ],
  },
  {
    slug: 'esports', nome: 'E-Sports', cat: 'gaming', estilo: 'profissional', dest: true, prem: true, data: '2026-09-14', ver: '1.1.0',
    tags: ['esports', 'time', 'patrocínio', 'torneios'],
    desc: 'Organização de e-sports com elenco, comissão técnica, fãs, patrocínios e comunicação oficial.',
    cargos: [
      ['🏢 CEO', '#FFD700', 'owner'], ['📈 Diretor', '#FF5252', 'admin'], ['🧠 Coach', '#00B0FF', 'mod', { key: 'coach' }], ['📊 Analista', '#1DE9B6', 'staff', { key: 'analista' }],
      ['🎮 Player', '#7C4DFF', 'creator', { key: 'player', mention: true }], ['🤝 Patrocinador', '#FFAB40', 'partner'], ['⭐ Fã Clube', '#F50057', 'vip', { key: 'fa' }], ['🎧 Torcida', '#78909C', 'member', { hoist: false }],
    ],
    cats: [
      info('┃', '🏆 ORGANIZAÇÃO', ['🏢┃sobre-a-org|Quem somos', '📰┃noticias|Comunicados oficiais', '🤝┃patrocinadores|Nossos parceiros']),
      ['🎮 ELENCO', 'criadores', ['🎮┃line-up|Elenco atual', '📅┃calendario-de-jogos|Próximas partidas', '📊┃resultados|Placar e resumos', '🎥┃vods|Replays oficiais']],
      ['⭐ TORCIDA', null, ['💬┃torcida|Converse com os fãs|lento5', '📸┃midia-dos-fans|Artes e edições', '🎁┃sorteios|Prêmios para a torcida', 'v:🎧 Watch Party', 'v:🔊 Torcida Geral']],
      ['🏋️ COMISSÃO TÉCNICA', 'staff', ['🧠┃analise-taticas|Estudo de adversários', '📆┃scrims|Agenda de treinos', '📈┃desempenho|Métricas individuais', 'v:🎙️ Sala Tática', 'v:🎮 Scrim Room|lim10']],
      ['💼 COMERCIAL', 'gestao', ['🤝┃contratos|Negociações e contratos', '📣┃marketing|Ações de marca', '💸┃financeiro|Fluxo de caixa']],
    ],
  },
  {
    slug: 'competitive', nome: 'Competitive', cat: 'gaming', estilo: 'neon', data: '2026-08-25',
    tags: ['competitivo', 'ladder', 'ranked', 'arbitragem'],
    desc: 'Servidor de ladder e campeonatos com arbitragem, check-in e reporte de resultados.',
    cargos: [
      ['⚡ Admin', '#00F5D4', 'owner'], ['⚖️ Árbitro', '#F15BB5', 'mod', { key: 'arbitro' }], ['📋 Organizador', '#FEE440', 'staff', { key: 'organizador' }],
      ['🥇 Campeão', '#FF9F1C', 'vip'], ['🎯 Competidor', '#9B5DE5', 'member'], ['👀 Espectador', '#8D99AE', 'cosmetic', { key: 'espectador', hoist: false }],
    ],
    cats: [
      info('✦', '⚡ REGULAMENTO', ['📜✦regulamento-geral|Regras dos campeonatos', '⚖️✦politica-de-arbitragem|Como decidimos']),
      ['🏆 CAMPEONATOS', 'leitura', ['📢✦anuncios-de-torneio|Inscrições e datas', '🗓️✦tabela|Chaves e confrontos', '🥇✦hall-da-fama|Campeões anteriores']],
      ['🎯 COMPETIÇÃO', 'membros', ['✅✦check-in|Confirme presença', '📝✦reportar-resultado|Envie o placar', '⚖️✦disputas|Contestações', '💬✦chat-competidores|Conversa dos times|lento5']],
      ['🔊 SALAS DE PARTIDA', 'membros', vozes(['🎮 Partida 1|lim10', '🎮 Partida 2|lim10', '🎮 Partida 3|lim10', '🎙️ Aquecimento'])],
      ['👀 ARQUIBANCADA', null, ['💬✦arquibancada|Comente as partidas|lento5', 'v:🔊 Transmissão']],
      staff('✦', '🔒 ORGANIZAÇÃO', ['🧾✦resultados-internos|Conferência de placares']),
    ],
  },
  {
    slug: 'minecraft', nome: 'Minecraft', cat: 'gaming', estilo: 'pixel', dest: true, data: '2026-09-05', ver: '1.2.0',
    tags: ['minecraft', 'survival', 'servidor', 'builds'],
    desc: 'Comunidade de servidor Minecraft com IP, sugestões, builds, suporte in-game e eventos.',
    cargos: [
      ['🧱 Dono', '#F1C40F', 'owner'], ['⛏️ Admin', '#E74C3C', 'admin'], ['🧭 Moderador', '#3498DB', 'mod'], ['🪓 Ajudante', '#2ECC71', 'helper'],
      ['💎 Apoiador', '#1ABC9C', 'vip'], ['🏗️ Construtor', '#E67E22', 'creator', { key: 'construtor' }], ['🌱 Jogador', '#95A5A6', 'member', { hoist: false }], ['🤖 Bots', '#7F8C8D', 'bot'],
    ],
    cats: [
      info('・', '📌 SPAWN', ['🌐・ip-do-servidor|Como entrar', '📜・regras|Regras do servidor', '🗺️・mapa-e-wiki|Guias e comandos']),
      ['💬 COMUNIDADE', null, ['💬・chat-geral|Fale com os jogadores|lento5', '📸・screenshots|Prints do servidor', '😂・memes|Humor bloquinho', '🔗・chat-in-game|Ponte com o servidor']],
      ['🏗️ BUILDS', null, ['🏗️・construcoes|Mostre suas builds', '🎨・skins|Skins e texturas', '🗳️・build-da-semana|Vote na melhor']],
      ['🛠️ SUPORTE', null, ['🎫・suporte|Peça ajuda', '🐞・bugs|Relate bugs', '💡・sugestoes|Sugira novidades|lento60', '🚫・denuncias|Denuncie jogadores']],
      ['💎 APOIADORES', 'vip', ['💎・chat-vip|Espaço dos apoiadores', '🎁・kits-e-beneficios|Vantagens']],
      ['🔊 VOZ', null, vozes(['🔊 Geral', '⛏️ Mineração|lim6', '🏗️ Construção|lim6', '⚔️ PvP|lim6'])],
      staff('・', '🔒 STAFF', ['🖥️・console|Comandos e logs do servidor', '🚫・punicoes|Bans e avisos']),
    ],
  },
  {
    slug: 'roblox', nome: 'Roblox', cat: 'gaming', estilo: 'colorido', data: '2026-08-20',
    tags: ['roblox', 'jogos', 'crianças e teens', 'trades'],
    desc: 'Comunidade Roblox com anúncios de jogos, trades seguros, chat moderado e criadores.',
    cargos: [
      ['👑 Dono', '#FFD32A', 'owner'], ['🔧 Admin', '#FF5E57', 'admin'], ['🛡️ Guardião', '#0BE881', 'mod'], ['🧩 Dev de Jogos', '#4BCFFA', 'dev'],
      ['🌟 Criador', '#FFC048', 'creator'], ['🎮 Jogador', '#A4B0BE', 'member', { hoist: false }], ['🤖 Bots', '#57606F', 'bot'],
    ],
    cats: [
      info('・', '📌 COMECE AQUI', ['📜・regras|Regras (chat moderado)', '🎭・cargos|Escolha seu perfil', '🛡️・seguranca-online|Dicas de segurança']),
      ['🎮 JOGOS', 'leitura', ['🎮・jogos-da-comunidade|Jogos para testar', '🆕・updates|Novidades dos jogos', '🏆・eventos|Eventos e prêmios']],
      ['💬 CHAT', 'mudo', ['💬・chat-geral|Conversa moderada|lento10', '😂・memes|Sem conteúdo impróprio|lento10', '🎨・criacoes|Mostre suas criações', '🔎・procuro-amigos|Ache parceiros de jogo|lento30']],
      ['🔁 TRADES', null, ['🔁・trades|Ofertas de troca (cuidado com golpes)|lento30', '🚫・golpes-conhecidos|Alertas de scam', '⭐・reputacao|Trocas concluídas']],
      ['🧩 CRIADORES', 'dev', ['🧩・dev-lounge|Conversa de desenvolvedores', '🧪・playtests|Teste jogos novos', '📚・tutoriais|Aprenda a criar']],
      ['🔊 VOZ', null, vozes(['🔊 Sala Geral|lim10', '🎮 Time A|lim6', '🎮 Time B|lim6'])],
      staff('・', '🔒 STAFF', ['🚫・denuncias|Denúncias de jogadores']),
    ],
  },
  {
    slug: 'gta-rp', nome: 'GTA RP', cat: 'gaming', estilo: 'urbano', data: '2026-08-08', ver: '1.1.0',
    tags: ['gta', 'roleplay', 'whitelist', 'facções'],
    desc: 'Servidor de roleplay com whitelist, facções, economia, polícia e departamentos.',
    cargos: [
      ['👑 Diretor RP', '#F5CD79', 'owner'], ['⚙️ Administrador', '#FF5252', 'admin'], ['🚔 Moderação RP', '#3C40C6', 'mod'], ['📝 Analista Whitelist', '#0FB9B1', 'staff', { key: 'whitelist' }],
      ['🎫 Suporte', '#20BF6B', 'support'], ['💎 Apoiador', '#A55EEA', 'vip'], ['🏙️ Cidadão', '#778CA3', 'member', { hoist: false }], ['🕒 Aguardando WL', '#4B6584', 'cosmetic', { key: 'espera', hoist: false }],
    ],
    cats: [
      info('┃', '🏙️ CIDADE', ['📜┃regras-rp|Regras do roleplay', '🌐┃como-entrar|Conexão e whitelist', '📖┃leis-da-cidade|Código penal e civil']),
      ['📝 WHITELIST', null, ['📝┃solicitar-whitelist|Faça sua candidatura', '🗂️┃resultados-wl|Aprovados', '🎥┃aulas-de-rp|Vídeos de aprendizado']],
      ['🎭 ROLEPLAY', 'membros', ['💬┃chat-cidade|Conversa fora do RP (OOC)|lento5', '📰┃jornal-da-cidade|Notícias in-character', '📸┃galeria|Prints e clipes', '🔁┃classificados|Compra e venda in-game']],
      ['🚔 DEPARTAMENTOS', 'membros', ['🚔┃policia|Departamento policial', '🚑┃hospital|Saúde e resgate', '🔧┃mecanica|Oficinas', '🏛️┃governo|Prefeitura']],
      ['🕶️ FACÇÕES', 'membros', ['🕶️┃organizacoes|Cadastro de facções', '📆┃eventos-rp|Ações organizadas']],
      ['🎫 SUPORTE', null, ['🎫┃suporte|Abra um chamado', '🐞┃bugs|Reporte bugs', '🚫┃denuncias|Denúncias de players']],
      ['🔊 VOZ', 'membros', vozes(['🎧 Aeroporto|lim20', '🚔 Rádio Polícia|lim12', '🚑 Rádio Hospital|lim12', '💬 OOC'])],
      staff('┃', '🔒 STAFF', ['📋┃whitelist-interna|Fila de avaliação', '💸┃economia|Ajustes econômicos|gestao']),
    ],
  },
  {
    slug: 'fps', nome: 'FPS', cat: 'gaming', estilo: 'tatico', data: '2026-08-27',
    tags: ['fps', 'tiro', 'ranked', 'mira'],
    desc: 'Comunidade para jogadores de FPS com dicas de mira, sensibilidade, ranked e scrims.',
    cargos: [
      ['🎯 Comandante', '#FF4D4D', 'owner'], ['🛰️ Coordenador', '#FFA502', 'admin'], ['🛡️ Moderador', '#1E90FF', 'mod'],
      ['🏅 Radiante', '#2ED573', 'vip', { key: 'radiante' }], ['🔫 Operador', '#A4B0BE', 'member'], ['🕶️ Novato', '#747D8C', 'cosmetic', { key: 'novato', hoist: false }],
    ],
    cats: [
      info('┃', '🎯 BRIEFING', ['📜┃regras|Conduta e fair play', '🧭┃guia-iniciante|Comece pelo básico']),
      ['🎯 TREINO', null, ['🎯┃dicas-de-mira|Aim e crosshair', '🖱️┃sensibilidade|Configurações de mouse', '🎮┃configs|Config de vídeo e áudio', '🎬┃analise-de-gameplay|Envie sua partida para análise']],
      ['🏆 RANKED', null, ['🏆┃procuro-duo|Duo e trio ranqueado', '📊┃tracker|Compare estatísticas', '🥇┃conquistas|Suba de elo e comemore']],
      ['⚔️ SCRIMS', 'membros', ['📆┃agenda-de-scrims|Treinos entre times', '📝┃inscricao|Inscreva seu time', '🏅┃resultados|Placar dos treinos']],
      ['💬 SOCIAL', null, ['💬┃chat-geral|Bate-papo|lento5', '📷┃clips|Melhores jogadas', ...vozes(['🎧 Lobby', '🎯 Ranked A|lim5', '🎯 Ranked B|lim5', '⚔️ Scrim|lim10'])]],
      staff('┃', '🔒 STAFF', ['🚫┃cheaters|Denúncias de trapaça']),
    ],
  },
  {
    slug: 'multi-gaming', nome: 'Multi-Gaming', cat: 'gaming', estilo: 'moderno', data: '2026-09-01',
    tags: ['multi-jogos', 'comunidade', 'hub', 'lfg'],
    desc: 'Hub para vários jogos: cada jogo tem sua categoria, além de chat geral, LFG e eventos.',
    cargos: [
      ['🌐 Fundador', '#FFC312', 'owner'], ['⚙️ Admin', '#EA2027', 'admin'], ['🛡️ Moderador', '#0652DD', 'mod'], ['🤝 Embaixador de Jogo', '#009432', 'helper', { key: 'embaixador' }],
      ['💜 Apoiador', '#9980FA', 'vip'], ['🎮 Player', '#A3CB38', 'member', { hoist: false }], ['🤖 Bots', '#5758BB', 'bot'],
    ],
    cats: [
      info('・', '🌐 HUB', ['🌐・bem-vindo|Como o servidor funciona', '🎭・escolher-jogos|Pegue os cargos dos seus jogos']),
      ['💬 GERAL', null, ['💬・chat-geral|Fale sobre qualquer coisa|lento5', '😂・memes|Humor gamer', '📸・clips|Melhores momentos', '🎁・promocoes-de-jogos|Ofertas e jogos grátis']],
      ['🔎 PROCURO JOGADORES', null, ['🔎・lfg-geral|Procure squad para qualquer jogo', '🏆・lfg-ranked|Ranked e competitivo']],
      ['🔫 SALA — TIRO', null, ['🔫・fps-chat|Conversa sobre FPS', 'v:🔫 Tiro A|lim5', 'v:🔫 Tiro B|lim5']],
      ['🧙 SALA — RPG & MMO', null, ['🧙・rpg-chat|Aventuras e builds', 'v:🧙 Grupo A|lim6', 'v:🧙 Grupo B|lim6']],
      ['⚽ SALA — ESPORTES', null, ['⚽・esportes-chat|Futebol e corridas', 'v:⚽ Jogo Amistoso|lim8']],
      ['🎉 EVENTOS', 'leitura', ['🎉・eventos|Calendário da comunidade', '🏆・torneios|Campeonatos internos']],
      staff('・', '🔒 STAFF', ['📊・relatorios|Feedbacks e denúncias']),
    ],
  },
];
