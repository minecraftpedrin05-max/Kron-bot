// ═══════════════════════════════════════════════════════════════════════════
//  database/backupSqlite.js — Backup/restauração COMPLETA via Discord
// ═══════════════════════════════════════════════════════════════════════════
//
//  PROBLEMA QUE ISSO RESOLVE: em hospedagens sem disco persistente (ex:
//  Replit Autoscale, Railway sem Volume), os dados do bot podem voltar a um
//  estado antigo/vazio toda vez que o bot reinicia, porque o disco do
//  container é recriado do zero a cada deploy.
//
//  O QUE É PROTEGIDO (levantado revisando a source inteira, não só um
//  arquivo — se um dia mais um banco/arquivo persistente for adicionado ao
//  bot, ele PRECISA ser adicionado na lista ARQUIVOS_BANCO ou PASTAS_EXTRA
//  abaixo, senão fica de fora do backup):
//    1) database/database.sqlite  — produtos, variantes (+ imagens/emoji),
//       vendas, cupons, config da loja, sorteios, tickets, assinaturas,
//       snapshots do backup-system de servidor. TUDO que passa por
//       database/db.js cai aqui.
//    2) database/licenses.sqlite  — chaves e licenças ativadas.
//    3) database/protection.sqlite — config do sistema anti-raid/proteção.
//    4) certs/*.p12                — certificados do Efi Bank, um por
//       servidor que configurou esse gateway de pagamento. Não é um banco,
//       são arquivos binários soltos — tratados à parte dos 3 acima.
//
//  COMO FUNCIONA:
//  1) restaurarBackupAntesDeIniciar() — chamado ANTES de qualquer coisa
//     abrir os bancos (ver index.js). Busca mensagens recentes do canal de
//     backup, baixa o anexo de cada banco pra um arquivo TEMPORÁRIO, VALIDA
//     a integridade (conta linhas de uma tabela-chave) antes de aceitar, e
//     só então substitui o arquivo local — MAS SÓ SE o backup for mais novo
//     E não for uma regressão pra um estado vazio/corrompido (nunca
//     sobrescreve dado real por dado vazio).
//  2) fazerBackupAgora(client, motivo) — sobe o estado atual de TUDO (os 3
//     bancos + certificados) numa ÚNICA mensagem no Discord, com vários
//     anexos. Usa a API oficial de backup do SQLite pra cada banco. ANTES de
//     enviar, compara a contagem de linhas de cada banco com a do último
//     backup [completo] conhecido — se a contagem caiu pra 0 (ou ficou
//     ilegível) enquanto o backup anterior tinha dados, o envio é ABORTADO
//     e um alerta é disparado, pra nunca publicar um backup vazio por cima
//     de um backup bom.
//  3) iniciarBackupPeriodico(client) — dispara isso a cada poucos minutos,
//     como rede de segurança geral.
//
//  CONFIGURAÇÃO (Secrets/env): BACKUP_CANAL_ID
//  Se não estiver definida, tudo aqui vira "no-op" — bot funciona igual,
//  só sem backup automático.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');

// IMPORTANTE: NÃO fazer `require('./sqliteDb')`, `require('./licenseDb')`
// nem `require('../protectionSystem')` aqui no topo do arquivo. Isso abriria
// os bancos no instante em que este módulo fosse carregado — exatamente o
// que precisamos EVITAR até a restauração terminar. Todo acesso a esses
// módulos é feito dentro das funções (lazy require).

const DATABASE_DIR = require('./dataDir').DATA_DIR; // aponta pro Volume persistente da Railway, se configurado
const RAIZ_PROJETO = path.join(__dirname, '..');
const TOKEN = process.env.DISCORD_TOKEN;
const CANAL_BACKUP_ID = process.env.BACKUP_CANAL_ID || null;

const TAMANHO_MAX_SEGURO_POR_ARQUIVO = 20 * 1024 * 1024; // 20MB, margem abaixo do limite de 25MB do Discord
const MAX_ANEXOS_POR_MENSAGEM = 9; // Discord permite até 10 anexos por mensagem; deixamos 1 de folga
const INTERVALO_BACKUP_MS = 90 * 1000; // backup periódico a cada 90s
const MAX_BACKUPS_COMPLETOS = 5;
const CANAL_ALERTA_ID = process.env.BACKUP_ALERTA_CANAL_ID || process.env.LOGS_CANAL_ID || null;

// ─────────────────────────────────────────────────────────────
//  NOVO: validação de integridade — uma tabela "sentinela" por banco.
//  Se essa tabela existe mas está vazia (0 linhas) enquanto um estado
//  anterior tinha dados, o arquivo é tratado como SUSPEITO (possível
//  banco vazio criado por container efêmero), nunca como "restaurado
//  com sucesso" ou "pronto pra publicar".
// ─────────────────────────────────────────────────────────────
const TABELA_SAUDE = {
  'database.sqlite': 'guild_meta',
  'licenses.sqlite': 'licenses',
  'protection.sqlite': 'protection_config',
};

// Conta linhas de `tabela` no arquivo SQLite `caminho`.
// Retorna: número >= 0 se conseguiu ler; null se o arquivo não existe,
// está corrompido, ou a tabela ainda não existe (estado indeterminado —
// tratado como "suspeito" por quem chama, nunca como "vazio confirmado").
function contarLinhas(caminho, tabela) {
  if (!tabela) return null;
  let Database;
  try { Database = require('better-sqlite3'); } catch (e) { return null; }
  let db;
  try {
    if (!fs.existsSync(caminho)) return null;
    db = new Database(caminho, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${tabela}"`).get();
    return row.n;
  } catch (e) {
    return null;
  } finally {
    if (db) { try { db.close(); } catch (e) { /* ok */ } }
  }
}

async function alertarFalhaBackup(client, mensagem) {
  console.error(`[Backup][ALERTA] ${mensagem}`);
  if (!client || !CANAL_ALERTA_ID) return;
  try {
    const canal = await client.channels.fetch(CANAL_ALERTA_ID).catch(() => null);
    if (canal) await canal.send({ content: `🚨 **[Backup] ATENÇÃO — ação necessária** 🚨\n${mensagem}` }).catch(() => {});
  } catch (e) { /* alerta é best-effort, nunca deve travar nada */ }
}

// ─────────────────────────────────────────────────────────────
//  Definição de tudo que precisa ser protegido
// ─────────────────────────────────────────────────────────────

// Os 3 bancos SQLite. `obterDb()` é chamado só na hora do backup (lazy),
// nunca no carregamento deste módulo.
function listaArquivosBanco() {
  return [
    { caminho: path.join(DATABASE_DIR, 'database.sqlite'), nome: 'database.sqlite', obterDb: () => require('./sqliteDb').db },
    { caminho: path.join(DATABASE_DIR, 'licenses.sqlite'), nome: 'licenses.sqlite', obterDb: () => require('./licenseDb').db },
    { caminho: path.join(DATABASE_DIR, 'protection.sqlite'), nome: 'protection.sqlite', obterDb: () => require('../protectionSystem').db },
  ];
}

// Certificados do Efi Bank (certs/efibank-<guildId>.p12) — arquivos binários
// soltos, um por servidor que configurou esse gateway. Lista dinamicamente
// o que existir no momento do backup (pode não existir nenhum ainda).
function listaCertificados() {
  const pastaCerts = path.join(RAIZ_PROJETO, 'certs');
  if (!fs.existsSync(pastaCerts)) return [];
  return fs.readdirSync(pastaCerts)
    .filter(f => f.endsWith('.p12') || f.endsWith('.pfx'))
    .map(f => ({ caminho: path.join(pastaCerts, f), nome: `cert__${f}` })); // prefixo "cert__" identifica no restore que é pra ir pra pasta certs/, não database/
}

// ─────────────────────────────────────────────────────────────
//  Helpers HTTP crus (sem depender do client do discord.js logado)
// ─────────────────────────────────────────────────────────────
function apiDiscordGET(caminho) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10${caminho}`,
      method: 'GET',
      headers: { Authorization: `Bot ${TOKEN}` },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} em ${caminho}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Baixa `url` pra um arquivo TEMPORÁRIO (nunca direto no destino final).
// Quem chama decide, depois de validar o conteúdo, se promove (rename) ou
// descarta (unlink) esse temporário.
function baixarArquivoTemp(url, pastaDestino, prefixoNome) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} ao baixar o backup`));
      }
      try { fs.mkdirSync(pastaDestino, { recursive: true }); } catch (e) { /* ok */ }
      const tmp = path.join(pastaDestino, `${prefixoNome}.tmp-download-${Date.now()}`);
      const arquivo = fs.createWriteStream(tmp);
      res.pipe(arquivo);
      arquivo.on('finish', () => {
        arquivo.close((err) => {
          if (err) return reject(err);
          resolve(tmp);
        });
      });
      arquivo.on('error', reject);
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────
//  1) RESTAURAÇÃO — roda antes de qualquer coisa abrir os bancos
// ─────────────────────────────────────────────────────────────
async function restaurarBackupAntesDeIniciar(client = null) {
  if (!CANAL_BACKUP_ID) {
    console.log('[Backup] BACKUP_CANAL_ID não configurado — pulando restauração automática.');
    return;
  }
  if (!TOKEN) {
    console.log('[Backup] DISCORD_TOKEN não disponível ainda — pulando restauração automática.');
    return;
  }

  const MAX_TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const mensagens = await apiDiscordGET(`/channels/${CANAL_BACKUP_ID}/messages?limit=30`);
      const comAnexo = mensagens
        .filter(m => m.attachments && m.attachments.length > 0)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // mais novo primeiro

      if (comAnexo.length === 0) {
        console.log('[Backup] Nenhum backup encontrado no canal ainda — seguindo com os dados locais.');
        return;
      }

      let restaurados = 0;
      let algumEncontrado = false;

      for (const arq of listaArquivosBanco()) {
        const tabelaSaude = TABELA_SAUDE[arq.nome];
        const candidatos = comAnexo.filter(m => m.attachments.some(a => a.filename === arq.nome));

        if (candidatos.length === 0) {
          console.log(`[Backup] Nenhuma mensagem recente tem "${arq.nome}" anexado — mantendo o arquivo local.`);
          continue;
        }
        algumEncontrado = true;

        let mtimeLocal = 0;
        try { mtimeLocal = fs.statSync(arq.caminho).mtimeMs; } catch (e) { /* pode não existir ainda */ }
        const contagemLocal = contarLinhas(arq.caminho, tabelaSaude); // null = não existe/indeterminado

        let restaurouEsse = false;

        for (const msg of candidatos) {
          const anexo = msg.attachments.find(a => a.filename === arq.nome);
          const timestampBackup = new Date(msg.timestamp).getTime();

          if (mtimeLocal >= timestampBackup) {
            console.log(`[Backup] "${arq.nome}" local já está atualizado — mantendo como está.`);
            break; // candidatos mais antigos ainda, não faz sentido continuar
          }

          let tmpPath;
          try {
            tmpPath = await baixarArquivoTemp(anexo.url, DATABASE_DIR, `${arq.nome}.check`);
          } catch (e) {
            console.error(`[Backup] Falha ao baixar candidato de "${arq.nome}":`, e.message);
            continue;
          }

          const contagemBackup = contarLinhas(tmpPath, tabelaSaude);
          const backupSuspeito = (contagemBackup === 0 || contagemBackup === null) && (contagemLocal === null ? false : contagemLocal > 0);

          if (backupSuspeito) {
            console.error(`[Backup] ⚠️ Candidato de "${arq.nome}" (backup de ${new Date(msg.timestamp).toLocaleString('pt-BR')}) está vazio/ilegível (contagem=${contagemBackup}) enquanto o local tem ${contagemLocal} registro(s) — REJEITADO. Tentando backup mais antigo...`);
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ok */ }
            continue; // tenta o próximo candidato (mais antigo)
          }

          // Aceito: promove o temporário pro caminho final.
          try {
            for (const ext of ['-wal', '-shm']) {
              try { fs.unlinkSync(arq.caminho + ext); } catch (e) { /* ok */ }
            }
            fs.renameSync(tmpPath, arq.caminho);
            restaurados++;
            restaurouEsse = true;
            console.log(`[Backup] "${arq.nome}" restaurado a partir do backup de ${new Date(msg.timestamp).toLocaleString('pt-BR')} (registros: ${contagemBackup ?? 'n/d'}).`);
          } catch (e) {
            console.error(`[Backup] Falha ao promover "${arq.nome}" restaurado:`, e.message);
            try { fs.unlinkSync(tmpPath); } catch (e2) { /* ok */ }
          }
          break; // achou candidato válido (ou tentou e falhou tecnicamente) — não continua descendo
        }

        if (!restaurouEsse && contagemLocal > 0) {
          // Nenhum candidato do Discord era seguro pra restaurar, e o
          // arquivo local JÁ TEM dados reais — preserva o local e avisa
          // em vez de arriscar zerar tudo.
          console.error(`[Backup] RECOVERY_REQUIRED — nenhum backup recente de "${arq.nome}" passou na validação de integridade. Mantendo o arquivo local (${contagemLocal} registro(s)) intacto.`);
          await alertarFalhaBackup(client, `RECOVERY_REQUIRED: todos os backups recentes de "${arq.nome}" estavam vazios/suspeitos. O arquivo local (com dados) foi preservado e NÃO foi sobrescrito. Verifique o canal de backup manualmente.`);
        }
      }

      if (!algumEncontrado) {
        console.log('[Backup] Nenhum dos 3 bancos foi encontrado em mensagens recentes — seguindo com os dados locais.');
      } else {
        console.log(`[Backup] Restauração concluída: ${restaurados} de 3 banco(s) atualizado(s) (com validação de integridade).`);
      }
      return;
    } catch (e) {
      console.error(`[Backup] Tentativa ${tentativa}/${MAX_TENTATIVAS} de restaurar falhou: ${e.message}`);
      if (tentativa < MAX_TENTATIVAS) await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('[Backup] Não foi possível restaurar o backup após várias tentativas. Iniciando com os dados locais existentes.');
}

// ─────────────────────────────────────────────────────────────
//  2) BACKUP — sobe o estado atual de tudo pro canal do Discord
// ─────────────────────────────────────────────────────────────
let _backupEmAndamento = false;

// Lê as tags `[[SAUDE:nome=valor]]` embutidas no content de uma mensagem
// de backup anterior, pra sabermos quantos registros ela tinha.
function extrairSaudeDoConteudo(conteudo) {
  const resultado = {};
  if (!conteudo) return resultado;
  const regex = /\[\[SAUDE:([^=\]]+)=([^\]]+)\]\]/g;
  let m;
  while ((m = regex.exec(conteudo)) !== null) {
    const valor = m[2] === '?' ? null : parseInt(m[2], 10);
    resultado[m[1]] = Number.isNaN(valor) ? null : valor;
  }
  return resultado;
}

async function fazerBackupAgora(client, motivo = 'periódico') {
  if (!CANAL_BACKUP_ID) return;
  if (_backupEmAndamento) return; // evita duas subidas simultâneas se dispararem quase juntas
  _backupEmAndamento = true;

  const snapshotsTemporarios = [];
  try {
    const { AttachmentBuilder } = require('discord.js');
    const anexos = [];
    const snapshotsPorNome = {}; // nome -> caminho do snapshot, pra validar integridade antes de enviar

    // ── Snapshot de cada banco SQLite (API oficial de backup — segura
    //    mesmo com o banco em uso, já inclui o que estava só no -wal) ──
    for (const arq of listaArquivosBanco()) {
      const snapshotPath = `${arq.caminho}.snapshot-tmp-${Date.now()}`;
      try {
        const db = arq.obterDb();
        await db.backup(snapshotPath);
        const tamanho = fs.statSync(snapshotPath).size;
        if (tamanho > TAMANHO_MAX_SEGURO_POR_ARQUIVO) {
          await alertarFalhaBackup(client, `"${arq.nome}" está com ${(tamanho / 1024 / 1024).toFixed(1)}MB — acima do limite seguro. Este arquivo NÃO ESTÁ SENDO BACKUPADO desde agora. Investigue urgentemente.`);
          fs.unlinkSync(snapshotPath);
          continue;
        }
        snapshotsTemporarios.push(snapshotPath);
        snapshotsPorNome[arq.nome] = snapshotPath;
        anexos.push(new AttachmentBuilder(snapshotPath, { name: arq.nome }));
      } catch (e) {
        console.error(`[Backup] Falha ao gerar snapshot de "${arq.nome}":`, e.message);
      }
    }

    // ── Certificados do Efi Bank (cópia direta — não são banco, não
    //    precisam de .backup(), só de estarem completos em disco) ──
    const certs = listaCertificados();
    if (certs.length > (MAX_ANEXOS_POR_MENSAGEM - anexos.length)) {
      console.error(`[Backup] ${certs.length} certificados encontrados, mais do que cabe numa mensagem só (limite do Discord). Só os primeiros serão salvos nesta rodada — considere arquivar certificados antigos não usados.`);
    }
    for (const cert of certs) {
      if (anexos.length >= MAX_ANEXOS_POR_MENSAGEM) break;
      try {
        anexos.push(new AttachmentBuilder(cert.caminho, { name: cert.nome }));
      } catch (e) {
        console.error(`[Backup] Falha ao anexar certificado "${cert.nome}":`, e.message);
      }
    }

    if (anexos.length === 0) {
      console.error('[Backup] Nenhum arquivo pôde ser preparado para backup nesta rodada — pulado.');
      return;
    }

    const canal = await client.channels.fetch(CANAL_BACKUP_ID).catch(() => null);
    if (!canal) {
      console.error('[Backup] Canal de backup (BACKUP_CANAL_ID) não encontrado — confira o ID e as permissões do bot nesse canal.');
      return;
    }

    // ── NOVO: calcula a saúde (contagem de linhas) de cada banco que vai
    //    ser publicado, e compara com o último backup [completo] conhecido
    //    ANTES de enviar. Se algum banco regrediu pra vazio/ilegível
    //    enquanto o backup anterior tinha dados, ABORTA o envio inteiro —
    //    nunca publica um backup pior que o anterior por cima dele.
    const saudeAtual = {};
    for (const nome of Object.keys(TABELA_SAUDE)) {
      if (snapshotsPorNome[nome]) {
        saudeAtual[nome] = contarLinhas(snapshotsPorNome[nome], TABELA_SAUDE[nome]);
      }
    }

    let saudeAnterior = {};
    try {
      const recentesAntes = await canal.messages.fetch({ limit: 50 });
      const ultimoCompleto = [...recentesAntes.values()]
        .filter(m => m.author?.id === client.user.id && m.content.includes('[completo]'))
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
      if (ultimoCompleto) saudeAnterior = extrairSaudeDoConteudo(ultimoCompleto.content);
    } catch (e) {
      console.error('[Backup] Não foi possível ler o backup anterior pra comparar saúde:', e.message);
    }

    const regressoes = [];
    for (const nome of Object.keys(saudeAtual)) {
      const atual = saudeAtual[nome];
      const anterior = saudeAnterior[nome];
      const atualVazioOuInvalido = atual === 0 || atual === null;
      if (atualVazioOuInvalido && typeof anterior === 'number' && anterior > 0) {
        regressoes.push(`"${nome}": tinha ${anterior} registro(s) no último backup, agora está com ${atual === null ? 'leitura inválida' : '0 registros'}`);
      }
    }

    if (regressoes.length > 0) {
      const msg = `Backup ABORTADO (${motivo}) pra não publicar uma regressão: ${regressoes.join('; ')}. O último backup [completo] bom continua sendo o mais recente no canal. Verifique o banco local — algo apagou/zerou os dados.`;
      console.error(`[Backup] ${msg}`);
      await alertarFalhaBackup(client, msg);
      return; // NÃO envia — mantém o backup bom anterior como "o mais recente"
    }

    const nomesAnexados = listaArquivosBanco().map(a => a.nome);
    const completo = nomesAnexados.every(nome => anexos.some(a => a.name === nome));
    const marcador = completo ? '[completo]' : '[INCOMPLETO — faltam bancos]';
    const tagsSaude = Object.entries(saudeAtual)
      .map(([nome, n]) => `[[SAUDE:${nome}=${n === null ? '?' : n}]]`)
      .join(' ');

    await canal.send({
      content: `💾 Backup automático (${motivo}) ${marcador} — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — ${anexos.length} arquivo(s) ${tagsSaude}`,
      files: anexos,
    });

    // CORREÇÃO CRÍTICA (perda de dados de 16/09/2026): só conta e só
    // apaga backups [completo] pro limite de MAX_BACKUPS_COMPLETOS.
    // Nunca apaga uma mensagem completa por causa de backups
    // incompletos mais novos.
    try {
      const recentes = await canal.messages.fetch({ limit: 50 });
      const doBot = [...recentes.values()]
        .filter(m => m.attachments.size > 0 && m.author?.id === client.user.id)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

      const completas = doBot.filter(m => m.content.includes('[completo]'));
      const incompletas = doBot.filter(m => !m.content.includes('[completo]'));

      for (const antiga of completas.slice(MAX_BACKUPS_COMPLETOS)) {
        await antiga.delete().catch(() => {});
      }
      const UMA_HORA_MS = 60 * 60 * 1000;
      const agora = Date.now();
      for (const [i, m] of incompletas.entries()) {
        const velha = (agora - m.createdTimestamp) > UMA_HORA_MS;
        if (velha || i >= 3) await m.delete().catch(() => {});
      }

      if (!completo) {
        await alertarFalhaBackup(client, 'Este backup ficou INCOMPLETO. O último backup COMPLETO continua guardado e protegido da limpeza automática.');
      }
    } catch (e) { console.error('[Backup] Falha na limpeza de mensagens antigas:', e.message); }

  } catch (e) {
    console.error(`[Backup] Falha ao fazer backup automático (${motivo}):`, e.message);
  } finally {
    for (const s of snapshotsTemporarios) {
      try { fs.unlinkSync(s); } catch (e) { /* pode já não existir */ }
    }
    _backupEmAndamento = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  3) BACKUP PERIÓDICO — rede de segurança geral
// ─────────────────────────────────────────────────────────────
function iniciarBackupPeriodico(client) {
  if (!CANAL_BACKUP_ID) {
    console.log('[Backup] BACKUP_CANAL_ID não configurado — backup automático desativado.');
    return;
  }
  console.log(`[Backup] Backup automático ativo (a cada ${INTERVALO_BACKUP_MS / 1000}s + após cada venda/ativação) — protegendo: database.sqlite, licenses.sqlite, protection.sqlite e certificados Efi Bank. Validação de integridade ATIVA.`);
  setInterval(() => { fazerBackupAgora(client, 'periódico'); }, INTERVALO_BACKUP_MS);
}

module.exports = {
  restaurarBackupAntesDeIniciar,
  fazerBackupAgora,
  iniciarBackupPeriodico,
};
