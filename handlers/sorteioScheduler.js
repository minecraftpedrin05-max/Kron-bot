/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Scheduler de Sorteios
 *
 *  Responsável por encerrar sorteios automaticamente quando o tempo
 *  configurado termina. Segue o MESMO padrão de handlers/scheduler.js
 *  (setTimeout/setInterval em memória, Map por guild), sem depender
 *  de bibliotecas externas (discord-giveaways NÃO está instalado
 *  neste projeto — ver nota de migração no fim do arquivo).
 *
 *  Resistente a restart: ao iniciar, relê TODOS os sorteios ativos
 *  de TODAS as guilds e reagenda o timeout de cada um com base em
 *  `terminaEm` (timestamp absoluto salvo no banco). Sorteios cujo
 *  prazo já passou enquanto o bot estava offline são encerrados
 *  imediatamente na inicialização.
 *
 *  Chamado uma única vez no index.js: iniciarSorteioScheduler(client)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../database/db');

// Map<sorteioId, TimeoutID> — controla os timers agendados em memória.
const timersAtivos = new Map();

function cancelarTimer(sorteioId) {
  if (timersAtivos.has(sorteioId)) {
    clearTimeout(timersAtivos.get(sorteioId));
    timersAtivos.delete(sorteioId);
  }
}

// setTimeout tem limite de ~24.8 dias (2^31-1 ms) no Node. Sorteios mais
// longos que isso são reagendados em fatias, sem estourar o limite.
const MAX_TIMEOUT_MS = 2147000000;

function agendar(client, guildId, sorteioId, delayMs) {
  cancelarTimer(sorteioId);
  const delayReal = Math.max(0, delayMs);

  if (delayReal > MAX_TIMEOUT_MS) {
    const t = setTimeout(() => agendar(client, guildId, sorteioId, delayReal - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
    timersAtivos.set(sorteioId, t);
    return;
  }

  const t = setTimeout(() => {
    const { encerrarSorteioAutomatico } = require('../sorteio-system/sorteioManager');
    encerrarSorteioAutomatico(client, guildId, sorteioId).catch(e =>
      console.error(`[SorteioScheduler] Erro ao encerrar sorteio ${sorteioId}:`, e.message)
    );
  }, delayReal);

  timersAtivos.set(sorteioId, t);
}

// Chamado pelo sorteioManager toda vez que um sorteio novo é criado.
function agendarSorteio(client, guildId, sorteio) {
  const delayMs = sorteio.terminaEm - Date.now();
  agendar(client, guildId, sorteio.id, delayMs);
}

// Chamado quando um sorteio é cancelado manualmente ou já foi encerrado —
// evita que o timeout antigo dispare em cima de um sorteio que não existe
// mais em `ativos`.
function desagendarSorteio(sorteioId) {
  cancelarTimer(sorteioId);
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────────
// Varre todas as guilds em cache e reagenda cada sorteio ativo. Sorteios
// vencidos durante o downtime do bot são encerrados na hora.
function iniciarSorteioScheduler(client) {
  console.log('[SorteioScheduler] Iniciando reagendamento de sorteios ativos...');
  let reagendados = 0;
  let encerradosNaHora = 0;

  client.guilds.cache.forEach(guild => {
    const ativos = db.getSorteiosAtivos(guild.id);
    for (const sorteio of ativos) {
      const restante = sorteio.terminaEm - Date.now();
      if (restante <= 0) {
        encerradosNaHora++;
        const { encerrarSorteioAutomatico } = require('../sorteio-system/sorteioManager');
        encerrarSorteioAutomatico(client, guild.id, sorteio.id).catch(e =>
          console.error(`[SorteioScheduler] Erro ao encerrar sorteio vencido ${sorteio.id}:`, e.message)
        );
      } else {
        agendar(client, guild.id, sorteio.id, restante);
        reagendados++;
      }
    }
  });

  console.log(`[SorteioScheduler] <:positivo:1528401238197276702> Pronto — ${reagendados} sorteio(s) reagendado(s), ${encerradosNaHora} encerrado(s) por atraso.`);
}

module.exports = {
  iniciarSorteioScheduler,
  agendarSorteio,
  desagendarSorteio,
};

/**
 * ─────────────────────────────────────────────────────────────────
 * NOTA DE MIGRAÇÃO FUTURA (discord-giveaways / SQLite)
 * ─────────────────────────────────────────────────────────────────
 * Se no futuro o pacote `discord-giveaways` for instalado, ele traz seu
 * próprio GiveawaysManager com persistência e reagendamento automático —
 * este arquivo poderia ser substituído inteiramente por uma instância de
 * GiveawaysManager configurada com um `storage` customizado que aponte
 * para as funções de sorteioManager/db.js (getSorteiosAtivos, criarSorteio,
 * encerrarSorteio etc.), sem precisar reescrever o painel Components V2.
 *
 * Para a migração de JSON -> SQLite (better-sqlite3): este arquivo NÃO
 * precisa mudar em nada, pois ele só lê `terminaEm` e chama funções de
 * database/db.js — a troca de storage acontece inteiramente lá.
 * ─────────────────────────────────────────────────────────────────
 */
