'use strict';
const { staff, info, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'youtuber', nome: 'YouTuber', cat: 'creator', estilo: 'vibrante', dest: true, data: '2026-09-12', ver: '1.2.0',
    tags: ['youtube', 'canal', 'inscritos', 'comunidade'],
    desc: 'Servidor oficial de canal do YouTube: avisos de vídeo, comunidade, lives, memes e área de membros.',
    cargos: [
      ['▶️ Criador', '#FF0000', 'owner'], ['🎬 Editor', '#FF7F50', 'admin', { key: 'editor' }], ['🛡️ Moderador', '#3742FA', 'mod'], ['💎 Membro do Canal', '#FFA502', 'vip', { key: 'membrocanal' }],
      ['🔔 Inscrito', '#FF6B81', 'member'], ['🎥 Amigo do Canal', '#2ED573', 'partner'], ['🤖 Bots', '#747D8C', 'bot'],
    ],
    cats: [
      info('・', '📌 CANAL', ['▶️・sobre-o-canal|Conheça o canal', '🔔・novos-videos|Avisos de vídeo novo', '🔴・avisos-de-live|Quando vou ao vivo', '🎭・cargos|Escolha seus cargos']),
      ['💬 COMUNIDADE', null, ['💬・chat-geral|Papo com a galera|lento5', '😂・memes|Memes do canal', '🎨・fanarts|Artes dos fãs', '🎬・clips-da-comunidade|Cortes e melhores momentos', '💡・ideias-de-video|Sugira vídeos|lento60']],
      ['🎥 EXTRAS', null, ['⭐・desafios|Desafios para o canal', '🗳️・enquetes|Vote no próximo vídeo|leitura', '🎁・sorteios|Prêmios para inscritos|leitura']],
      ['💎 MEMBROS DO CANAL', 'vip', ['💎・chat-membros|Exclusivo para membros', '🎁・bastidores|Conteúdo dos bastidores', 'v:💎 Sala dos Membros']],
      ['🔴 AO VIVO', null, ['🔴・chat-da-live|Chat durante as lives|lento10', ...vozes(['🎙️ Sala de Live', '🔊 Conversa Livre', '🎮 Jogando Junto|lim8'])]],
      staff('・', '🔒 EQUIPE DO CANAL', ['🗓️・cronograma|Calendário de gravação|gestao', '🎬・edicao|Fila de edição']),
    ],
  },
  {
    slug: 'streamer', nome: 'Streamer', cat: 'creator', estilo: 'gamer', data: '2026-09-08',
    tags: ['streamer', 'twitch', 'live', 'subs'],
    desc: 'Casa do streamer: alertas de live, comunidade de subs, clips, sorteios e cargos por nível.',
    cargos: [
      ['🎮 Streamer', '#9146FF', 'owner'], ['🛠️ Manager', '#EB0400', 'admin'], ['🛡️ Mod da Live', '#00AD03', 'mod', { key: 'modlive' }], ['👑 Sub Tier 3', '#FFD700', 'premium', { key: 'tier3' }],
      ['💜 Sub', '#B983FF', 'vip', { key: 'sub' }], ['🎧 Viewer', '#ADADB8', 'member', { hoist: false }], ['🤖 Bots', '#3A3A3D', 'bot'],
    ],
    cats: [
      info('┃', '📺 CANAL', ['📺┃sobre-a-stream|Horários e regras', '🔴┃live-agora|Avisos de live', '📅┃agenda-da-semana|Programação']),
      ['💬 COMUNIDADE', null, ['💬┃chat-geral|Papo dos viewers|lento5', '🎬┃clips|Melhores clips da live', '😂┃memes|Memes da stream', '🎨┃fanarts|Arte dos fãs', '💡┃sugestoes-de-jogos|O que jogar|lento60']],
      ['🎁 INTERAÇÃO', null, ['🎁┃sorteios|Prêmios para a comunidade|leitura', '🗳️┃enquetes|Vote em decisões da live|leitura', '🎲┃jogos-com-viewers|Jogue junto']],
      ['💜 ÁREA DOS SUBS', 'vip', ['💜┃chat-subs|Exclusivo para subs', '🎁┃beneficios|Vantagens de sub', 'v:💜 Sala dos Subs']],
      ['🎮 VOZ', null, vozes(['🔊 Sala Geral', '🎮 Jogando com o Streamer|lim8', '🎧 Assistindo Juntos'])],
      staff('┃', '🔒 EQUIPE DA LIVE', ['🛡️┃moderacao-da-live|Comandos e casos', '🎬┃edicao-de-clips|Fila de cortes']),
    ],
  },
  {
    slug: 'designer', nome: 'Designer', cat: 'creator', estilo: 'minimalista', data: '2026-08-20',
    tags: ['designer', 'artes', 'portfólio', 'encomendas'],
    desc: 'Servidor de designer independente: portfólio, encomendas, processo criativo e comunidade de fãs.',
    cargos: [
      ['🎨 Designer', '#FD79A8', 'owner'], ['🧵 Assistente', '#E17055', 'admin'], ['🖌️ Colega de Arte', '#6C5CE7', 'creator', { key: 'colega' }], ['🌟 Cliente', '#FDCB6E', 'vip'], ['👀 Fã', '#B2BEC3', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎨 ATELIÊ', ['👋・sobre-mim|Quem sou', '📥・como-encomendar|Como pedir uma arte', '💲・valores|Tabela de preços']),
      ['🖼️ PORTFÓLIO', 'criadores', ['🖼️・destaques|Trabalhos favoritos', '🎨・ilustracoes|Ilustrações', '🔤・identidade-visual|Logos e marcas', '🎞️・motion|Animações']],
      ['🧠 PROCESSO', 'leitura', ['🧠・processo-criativo|Do rascunho à arte final', '🧪・estudos|Testes e rabiscos', '📚・dicas-de-design|Aprenda comigo']],
      ['💬 COMUNIDADE', null, ['💬・chat|Papo criativo|lento5', '🎨・suas-artes|Compartilhe seu trabalho', '💡・referencias|Inspirações', 'v:🎧 Sala de Desenho']],
      ['✏️ ENCOMENDAS', 'vip', ['✏️・minha-encomenda|Acompanhe seu pedido', '🔁・revisoes|Ajustes']],
      staff('・', '🔒 ATELIÊ PRIVADO', ['📋・fila-de-encomendas|Pedidos em produção|gestao']),
    ],
  },
  {
    slug: 'editor', nome: 'Editor', cat: 'creator', estilo: 'cinema', data: '2026-08-09',
    tags: ['editor de vídeo', 'edição', 'presets', 'motion'],
    desc: 'Servidor de editor de vídeo: reels de trabalhos, presets, tutoriais, encomendas e feedback.',
    cargos: [
      ['🎞️ Editor Chefe', '#F1C40F', 'owner'], ['🎬 Assistente de Edição', '#E67E22', 'admin'], ['🎥 Editor', '#3498DB', 'creator', { key: 'editor2' }], ['⭐ Cliente', '#9B59B6', 'vip'], ['👀 Membro', '#95A5A6', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '🎞️ ESTÚDIO', ['🎬・sobre|O que edito', '📥・como-contratar|Passo a passo', '💲・precos|Valores por tipo de vídeo']),
      ['🎬 REELS & TRABALHOS', 'criadores', ['🎬・reel-principal|Meu reel', '📺・youtube|Edições para YouTube', '📱・shorts-e-reels|Vídeos verticais', '🎞️・motion-graphics|Animações']],
      ['🧰 RECURSOS', 'leitura', ['🧰・presets-e-luts|Downloads', '🎵・musicas-e-sfx|Bibliotecas de áudio', '📚・tutoriais|Aprenda edição', '🖥️・softwares|Ferramentas que uso']],
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa de editores|lento5', '🎥・critique-de-edicao|Feedback de vídeos|lento30', 'v:🎧 Sala de Edição|lim6']],
      ['✏️ ENCOMENDAS', 'vip', ['✏️・meu-projeto|Andamento', '📎・envio-de-material|Arquivos brutos', '🔁・revisoes|Ajustes']],
      staff('・', '🔒 ILHA DE EDIÇÃO', ['📋・fila|Projetos na fila|gestao']),
    ],
  },
  {
    slug: 'influencer', nome: 'Influencer', cat: 'creator', estilo: 'glamour', data: '2026-09-06',
    tags: ['influencer', 'lifestyle', 'parcerias', 'fã clube'],
    desc: 'Comunidade de influenciador: fã clube, bastidores, publis, marcas parceiras e eventos.',
    cargos: [
      ['✨ Influencer', '#FF9FF3', 'owner'], ['📈 Assessoria', '#F368E0', 'admin'], ['🌸 Moderação', '#48DBFB', 'mod'], ['🏷️ Marca Parceira', '#FECA57', 'partner'],
      ['💖 Fã Clube VIP', '#FF6B81', 'vip'], ['🌟 Fã', '#DFE4EA', 'member', { hoist: false }],
    ],
    cats: [
      info('・', '✨ BEM-VINDO', ['💫・sobre|Quem sou e o que compartilho', '📱・redes-sociais|Onde me encontrar', '📅・agenda|Eventos e posts']),
      ['🌟 FÃ CLUBE', null, ['💬・chat-dos-fas|Conversa geral|lento5', '📸・fotos-dos-fas|Suas fotos e edições', '💌・mensagens|Deixe um recado', '🎁・sorteios|Prêmios para os fãs|leitura']],
      ['👗 LIFESTYLE', 'leitura', ['👗・looks|Meus looks', '🍽️・rotina|Meu dia a dia', '🎁・recebidos|Presentes e novidades']],
      ['💖 CLUBE VIP', 'vip', ['💖・chat-vip|Espaço exclusivo', '🎥・bastidores|Conteúdo dos bastidores', 'v:💖 Sala VIP|lim20']],
      ['🏷️ PARCERIAS', 'parceiros', ['🏷️・publis|Campanhas em andamento', '📩・contato-de-marcas|Fale com a assessoria']],
      ['🔊 VOZ', null, vozes(['🔊 Bate-papo com Fãs|lim30', '🎧 Sala de Música'])],
      staff('・', '🔒 ASSESSORIA', ['📆・calendario-de-posts|Agenda editorial|gestao']),
    ],
  },
  {
    slug: 'content-creator', nome: 'Content Creator', cat: 'creator', estilo: 'moderno', data: '2026-09-18',
    tags: ['criador de conteúdo', 'multiplataforma', 'audiência', 'colab'],
    desc: 'Para criadores multiplataforma: avisos por rede, comunidade, ideias, feedback e colaborações.',
    cargos: [
      ['🌟 Creator', '#FFA502', 'owner'], ['🧭 Manager', '#FF6348', 'admin'], ['🎬 Editor', '#1E90FF', 'creator', { key: 'editor' }], ['🛡️ Moderador', '#2ED573', 'mod'],
      ['💎 Apoiador', '#A55EEA', 'vip'], ['🔔 Seguidor', '#CED6E0', 'member', { hoist: false }], ['🤖 Bots', '#747D8C', 'bot'],
    ],
    cats: [
      info('┃', '📌 HUB', ['🌟┃sobre|Sobre o criador e o conteúdo', '🎭┃cargos|Escolha as redes que segue']),
      ['📢 NOVIDADES', 'leitura', ['🎥┃youtube|Novos vídeos', '🎵┃tiktok|Novos vídeos curtos', '📸┃instagram|Novos posts', '🎙️┃podcast|Novos episódios', '🔴┃lives|Avisos de live']],
      ['💬 COMUNIDADE', null, ['💬┃chat-geral|Papo da comunidade|lento5', '💡┃ideias-de-conteudo|Sugira temas|lento60', '🗳️┃enquetes|Vote no próximo conteúdo|leitura', '🎨┃criacoes-dos-fas|Suas criações']],
      ['🤝 COLABORAÇÕES', null, ['🤝┃procuro-colab|Encontre parceiros', '📣┃divulgacao|Divulgue seu trabalho|lento3600']],
      ['💎 APOIADORES', 'vip', ['💎┃chat-apoiadores|Exclusivo', '🎁┃extras|Conteúdo extra', 'v:💎 Sala de Apoiadores']],
      ['🔊 VOZ', null, vozes(['🔊 Sala Geral', '🎧 Coworking de Criadores|lim8'])],
      staff('┃', '🔒 EQUIPE', ['🗓️┃calendario-editorial|Cronograma|gestao']),
    ],
  },
  {
    slug: 'portfolio-creator', nome: 'Portfolio Creator', cat: 'creator', estilo: 'showcase', data: '2026-09-19',
    tags: ['portfólio', 'creator', 'vitrine', 'contratação'],
    desc: 'Portfólio de creator com vitrine por especialidade, kit de mídia, depoimentos e contratação.',
    cargos: [
      ['🌟 Creator', '#FFD32A', 'owner'], ['🧑‍💼 Agente', '#0BE881', 'admin'], ['🤝 Marca / Contratante', '#4BCFFA', 'partner', { key: 'marca' }], ['💜 Seguidor', '#A29BFE', 'vip'], ['👀 Visitante', '#D2DAE2', 'member', { hoist: false }],
    ],
    cats: [
      ['🌟 APRESENTAÇÃO', 'leitura', ['👋・quem-sou|Sobre mim', '📊・midia-kit|Números e audiência', '🏷️・marcas-que-ja-trabalhei|Cases com marcas', '⭐・depoimentos|O que dizem de mim']],
      ['🎬 VITRINE', 'leitura', ['🎬・videos|Melhores vídeos', '📸・fotos|Ensaios e posts', '🎙️・audio|Podcasts e locuções', '✍️・textos|Artigos e roteiros']],
      ['🤝 CONTRATAÇÃO', null, ['📩・fale-comigo|Envie sua proposta', '📝・briefing|Preencha o briefing', '💲・tabela-de-valores|Faixas de investimento']],
      ['💬 COMUNIDADE', null, ['💬・chat|Conversa aberta|lento5', '📣・novidades|Últimas notícias|leitura', 'v:🎙️ Bate-papo Aberto|lim10']],
      ['🔧 BASTIDORES', 'gestao', ['📋・pipeline-de-propostas|Propostas recebidas']],
    ],
  },
];
