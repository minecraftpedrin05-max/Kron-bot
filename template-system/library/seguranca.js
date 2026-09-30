'use strict';
const { staff, vozes } = require('./_blocos');

module.exports = [
  {
    slug: 'security', nome: 'Security', cat: 'seguranca', estilo: 'dark', dest: true, data: '2026-09-15', ver: '1.2.0',
    tags: ['segurança', 'anti-raid', 'verificação', 'logs'],
    desc: 'Servidor blindado: verificação obrigatória, quarentena, logs completos e resposta a incidentes.',
    cargos: [
      ['🛡️ Security Owner', '#F5F6FA', 'owner'], ['🔐 Security Admin', '#E84118', 'admin'], ['🚨 Incident Response', '#C23616', 'mod', { key: 'incident', extra: ['BanMembers'] }],
      ['🔍 Analista', '#00A8FF', 'staff', { key: 'analista' }], ['✅ Verificado', '#4CD137', 'member'], ['⚠️ Quarentena', '#7F8FA6', 'cosmetic', { key: 'quarentena', hoist: false }], ['🤖 Bots de Segurança', '#353B48', 'bot'],
    ],
    cats: [
      ['✅ VERIFICAÇÃO', 'leitura', ['✅┃verificacao|Verifique-se para acessar o servidor', '📜┃regras|Regras e código de conduta', '📢┃avisos-de-seguranca|Alertas oficiais']],
      ['💬 COMUNIDADE', 'membros', ['💬┃chat|Conversa moderada|lento10', '❓┃duvidas|Ajuda|lento10', '🚨┃denunciar|Denuncie condutas suspeitas']],
      ['⚠️ QUARENTENA', null, ['⚠️┃quarentena|Explicação e apelação para quem está em quarentena']],
      ['📋 LOGS', 'staff', ['📋┃logs-de-entrada|Entradas e saídas', '🗑️┃logs-de-mensagens|Mensagens apagadas/editadas', '🔨┃logs-de-punicoes|Bans, kicks e timeouts', '⚙️┃logs-de-servidor|Alterações de canais e cargos', '🎙️┃logs-de-voz|Atividade de voz']],
      ['🚨 RESPOSTA A INCIDENTES', 'staff', ['🚨┃incidentes|Incidentes ativos', '🔍┃investigacoes|Análises em andamento', '📖┃playbooks|Procedimentos de resposta', 'v:🚨 War Room|lim10']],
      staff('┃', '🔒 ADMINISTRAÇÃO', ['🔑┃acessos|Auditoria de permissões|gestao']),
    ],
  },
  {
    slug: 'moderacao', nome: 'Moderação', cat: 'seguranca', estilo: 'clean', data: '2026-08-11',
    tags: ['moderação', 'punições', 'denúncias', 'equipe'],
    desc: 'Centro de moderação da comunidade: denúncias, casos, apelações e treinamento.',
    cargos: [
      ['👑 Head de Moderação', '#F1C40F', 'owner'], ['🛡️ Moderador Sênior', '#2980B9', 'mod', { key: 'senior', extra: ['BanMembers'] }], ['🔨 Moderador', '#3498DB', 'mod'],
      ['🧪 Trial', '#1ABC9C', 'helper', { key: 'trial' }], ['👥 Membro', '#95A5A6', 'member', { hoist: false }],
    ],
    cats: [
      ['📌 EQUIPE', 'staff', ['📢・avisos-da-moderacao|Comunicados internos', '📜・regulamento|Regras e punições padrão', '📆・escala|Escala de plantão']],
      ['🚨 CASOS', 'staff', ['🚨・denuncias|Denúncias recebidas', '🔨・punicoes|Histórico de punições', '⚖️・apelacoes|Pedidos de revisão', '🗂️・casos-arquivados|Casos encerrados']],
      ['🎓 TREINAMENTO', 'staff', ['📚・guias|Como moderar', '🧪・casos-de-estudo|Cenários reais', '📝・feedback-de-trials|Avaliação de novatos']],
      ['💬 PÚBLICO', null, ['🚨・denunciar|Envie uma denúncia', '⚖️・apelar-punicao|Apele uma punição']],
      ['🔊 VOZ', 'staff', vozes(['🎧 Moderação em Voz', '🧠 Reunião de Casos|lim8'])],
    ],
  },
  {
    slug: 'staff-center', nome: 'Staff Center', cat: 'seguranca', estilo: 'corporativo', data: '2026-08-23',
    tags: ['staff', 'gestão de equipe', 'rh', 'escalas'],
    desc: 'Servidor interno da equipe: comunicados, escalas, treinamentos, promoções e RH.',
    cargos: [
      ['🏛️ Diretor', '#FFC048', 'owner'], ['📋 Gerente de Staff', '#FF5E57', 'admin'], ['🛡️ Supervisor', '#575FCF', 'mod'], ['🎧 Staff', '#0BE881', 'staff'], ['🌱 Staff em Treinamento', '#D2DAE2', 'helper', { key: 'trainee' }],
    ],
    cats: [
      ['📌 CENTRAL', 'staff', ['📢・comunicados|Avisos da diretoria', '📆・escalas|Escalas e plantões', '🎉・reconhecimentos|Destaques da equipe']],
      ['🎓 CARREIRA', 'staff', ['🎓・treinamentos|Materiais de treinamento', '📈・promocoes|Critérios de promoção', '📝・avaliacoes|Avaliações de desempenho']],
      ['💬 EQUIPE', 'staff', ['💬・chat-staff|Conversa da equipe|lento5', '💡・ideias|Melhorias internas', '🚨・alertas|Urgências', ...vozes(['🎙️ Reunião Geral|lim30', '☕ Sala de Descanso'])]],
      ['🔒 GESTÃO', 'gestao', ['🧑‍💼・rh|Assuntos de pessoas', '⚖️・advertencias|Registros disciplinares', '📊・relatorios|Relatórios da equipe']],
    ],
  },
  {
    slug: 'administracao', nome: 'Administração', cat: 'seguranca', estilo: 'executivo', data: '2026-08-15',
    tags: ['administração', 'gestão do servidor', 'bots', 'configurações'],
    desc: 'Painel administrativo para donos de servidores grandes: bots, configurações, auditoria e finanças.',
    cargos: [
      ['👑 Proprietário', '#FFD700', 'owner'], ['⚙️ Administrador', '#E17055', 'admin'], ['🤖 Gestor de Bots', '#0984E3', 'dev', { key: 'bots' }], ['🧾 Auditor', '#00B894', 'staff', { key: 'auditor' }],
    ],
    cats: [
      ['⚙️ ADMINISTRAÇÃO', 'gestao', ['📌・visao-geral|Estado atual do servidor', '🧭・decisoes|Decisões e votações internas', '📆・planejamento|Roadmap do servidor']],
      ['🤖 BOTS & AUTOMAÇÃO', 'dev', ['🤖・bots-ativos|Inventário de bots', '🧪・testes|Ambiente de testes', '📜・changelog|Mudanças aplicadas', '🚨・falhas|Erros e quedas']],
      ['🔐 AUDITORIA', 'gestao', ['🔑・permissoes|Revisão de permissões', '📋・logs-completos|Logs do servidor', '🧾・relatorio-de-auditoria|Relatórios periódicos']],
      ['💰 FINANÇAS', 'gestao', ['💰・receitas|Entradas', '💸・despesas|Saídas', '📊・balanco|Balanço mensal']],
      ['🔊 SALA', 'gestao', vozes(['🎙️ Reunião de Administração|lim8'])],
    ],
  },
  {
    slug: 'anti-raid', nome: 'Anti-Raid', cat: 'seguranca', estilo: 'alerta', data: '2026-09-10',
    tags: ['anti-raid', 'proteção', 'lockdown', 'verificação'],
    desc: 'Estrutura pensada para resistir a raids: entrada verificada, canais isolados e sala de resposta rápida.',
    cargos: [
      ['🛡️ Comando Anti-Raid', '#FF4757', 'owner'], ['🚨 Defesa', '#FFA502', 'admin'], ['🔨 Sentinela', '#1E90FF', 'mod', { key: 'sentinela' }], ['👁️ Vigia', '#2ED573', 'helper', { key: 'vigia' }],
      ['✅ Verificado', '#7BED9F', 'member'], ['🚫 Não Verificado', '#747D8C', 'cosmetic', { key: 'naoverificado', hoist: false }], ['🤖 Bots', '#57606F', 'bot'],
    ],
    cats: [
      ['🚪 PORTARIA', 'leitura', ['✅┃verificar|Complete a verificação', '📜┃regras|Regras e avisos', '📢┃status-do-servidor|Comunicados de segurança']],
      ['💬 COMUNIDADE', 'membros', ['💬┃chat|Conversa (acesso só após verificação)|lento10', '📸┃midia|Mídia liberada só a verificados|lento60', ...vozes(['🔊 Sala Geral|lim15'])]],
      ['🚨 CENTRO DE DEFESA', 'staff', ['🚨┃alertas-de-raid|Detecções automáticas', '🔒┃lockdown|Protocolos de bloqueio', '🧹┃limpeza|Remoção em massa de contas', '📖┃manual-de-defesa|Procedimentos', 'v:🚨 Sala de Crise|lim12']],
      ['📋 LOGS', 'staff', ['📥┃entradas|Contas novas', '📤┃saidas|Saídas suspeitas', '🔨┃banimentos|Punições aplicadas', '🔗┃convites|Rastreio de convites']],
      staff('┃', '🔒 COMANDO'),
    ],
  },
  {
    slug: 'management', nome: 'Management', cat: 'seguranca', estilo: 'profissional', data: '2026-09-03',
    tags: ['gestão', 'liderança', 'okr', 'equipes'],
    desc: 'Gestão de servidor em camadas: liderança, supervisores por área e acompanhamento de metas.',
    cargos: [
      ['🏛️ Executive', '#F9CA24', 'owner'], ['📊 Manager', '#F0932B', 'admin'], ['🧭 Team Lead', '#4834D4', 'mod', { key: 'lead' }], ['🎧 Staff', '#22A6B3', 'staff'], ['👥 Member', '#95AFC0', 'member', { hoist: false }],
    ],
    cats: [
      ['📌 EXECUTIVO', 'gestao', ['📢・diretrizes|Diretrizes gerais', '🎯・okrs|Metas e resultados-chave', '📊・kpis|Indicadores', '🧭・decisoes|Registro de decisões']],
      ['🧭 ÁREAS', 'staff', ['🛡️・moderacao|Coordenação da moderação', '🎉・eventos|Coordenação de eventos', '📣・comunicacao|Coordenação de conteúdo', '🤝・parcerias|Coordenação de parcerias']],
      ['👥 PESSOAS', 'staff', ['🎓・treinamento|Capacitação', '📝・feedbacks|Ciclos de feedback', '🎉・reconhecimento|Destaques do mês']],
      ['🔊 REUNIÕES', 'staff', vozes(['🎙️ Reunião Executiva|lim10', '🧭 Reunião de Área|lim12', '☕ Alinhamento Rápido|lim6'])],
    ],
  },
  {
    slug: 'moderation-hub', nome: 'Moderation Hub', cat: 'seguranca', estilo: 'tech', data: '2026-09-17',
    tags: ['moderation', 'hub', 'ferramentas', 'multi-servidor'],
    desc: 'Hub de moderação para equipes que cuidam de vários servidores: filas, ferramentas e sincronização.',
    cargos: [
      ['🌐 Hub Owner', '#00D2D3', 'owner'], ['⚙️ Hub Admin', '#FF9F43', 'admin'], ['🛡️ Global Mod', '#5F27CD', 'mod', { key: 'global', extra: ['BanMembers'] }], ['🔍 Server Mod', '#54A0FF', 'mod', { key: 'servermod' }], ['🧪 Trainee', '#C8D6E5', 'helper', { key: 'trainee' }],
    ],
    cats: [
      ['🌐 HUB', 'staff', ['📢┃hub-avisos|Comunicados', '📜┃politica-global|Regras entre servidores', '🗺️┃servidores|Lista de servidores atendidos']],
      ['🚨 FILAS', 'staff', ['🚨┃fila-de-denuncias|Denúncias de todos os servidores', '🔨┃banimentos-globais|Sincronização de bans', '⚖️┃apelacoes|Pedidos de revisão', '🕵️┃investigacoes|Casos complexos']],
      ['🧰 FERRAMENTAS', 'staff', ['🧰┃ferramentas|Bots e comandos úteis', '📚┃wiki-de-moderacao|Base de conhecimento', '🤖┃automacoes|Automações ativas']],
      ['💬 EQUIPE', 'staff', ['💬┃chat-hub|Conversa da equipe|lento5', ...vozes(['🎙️ Central|lim20', '🔍 Investigação|lim6'])]],
      ['🎓 FORMAÇÃO', 'staff', ['🎓┃trilha-de-formacao|Do trainee ao global mod', '📝┃provas|Avaliações práticas']],
    ],
  },
];
