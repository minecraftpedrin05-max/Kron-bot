const db = require("../database/db");

// Tipos que precisam de members.fetch (cache completo)
const PRECISA_FETCH = new Set(['bots', 'humanos']);

const TIPOS = {
  membros:    { label: "👥 Membros: {v}",    fn: (guild)         => guild.memberCount },
  bots:       { label: "<:bot:1524207085850591273> Bots: {v}",       fn: (guild)         => guild.members.cache.filter(m => m.user.bot).size },
  humanos:    { label: "🙋 Humanos: {v}",    fn: (guild)         => guild.members.cache.filter(m => !m.user.bot).size },
  botonline:  { label: "<:online:1533081467918221565> Bot Online: {v}", fn: (guild, client) => client.ws.status === 0 ? "<:positivo:1528401238197276702> Online" : "<:negativo:1528400986744295475> Offline" },
  servidores: { label: "🌐 Servidores: {v}", fn: (guild, client) => client.guilds.cache.size },
};

async function atualizarContadores(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const data       = db.getGuild(guild.id);
      const contadores = data.contadores || {};
      if (Object.keys(contadores).length === 0) continue;

      // Faz fetch de membros só se algum contador precisar
      const tiposAtivos = Object.keys(contadores);
      const precisaFetch = tiposAtivos.some(t => PRECISA_FETCH.has(t));
      if (precisaFetch) {
        await guild.members.fetch().catch(() => {});
      }

      for (const [tipo, canalId] of Object.entries(contadores)) {
        if (!TIPOS[tipo]) continue;
        const canal = guild.channels.cache.get(canalId);
        if (!canal) continue;
        const valor = TIPOS[tipo].fn(guild, client);
        const nome  = TIPOS[tipo].label.replace("{v}", valor);
        if (canal.name !== nome) {
          await canal.setName(nome).catch(e =>
            console.error(`[Contadores] Falha ao renomear canal ${canalId}:`, e.message)
          );
        }
      }
    } catch (e) {
      console.error(`[Contadores] Erro em guild ${guild.id}:`, e.message);
    }
  }
}

function iniciarContadores(client) {
  // Garante que o client está pronto antes de iniciar
  const start = () => {
    // Primeira atualização após 5 segundos (dar tempo ao cache)
    setTimeout(() => {
      atualizarContadores(client).catch(e =>
        console.error('[Contadores] Erro na primeira atualização:', e.message)
      );
    }, 5000);

    // Intervalo de 5 minutos — referência salva para evitar GC
    const intervalo = setInterval(() => {
      atualizarContadores(client).catch(e =>
        console.error('[Contadores] Erro no intervalo:', e.message)
      );
    }, 5 * 60 * 1000);

    console.log("<:rendimentos:1528401542070145135> Contadores iniciados!");
    return intervalo;
  };

  if (client.isReady()) {
    return start();
  } else {
    client.once('ready', start);
  }
}

module.exports = { iniciarContadores, atualizarContadores, TIPOS };
