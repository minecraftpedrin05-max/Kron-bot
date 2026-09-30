const x = require("../config/constants");
const M = x.MODOS_VALIDOS;
const V = x.VALORES;

const q = {};
const f = {};
const p = {};

function i(g) {
  if (!q[g]) {
    q[g] = {};
    f[g] = {};
    for (const m of M) {
      q[g][m] = {};
      f[g][m] = {};
      for (const v of V) q[g][m][v] = { normal: [], inf: [], emu3: [] };
    }
  }
}

function getQueue(g, m, v) {
  i(g);
  return q[g][m][v];
}

function removeFromAllQueues(g, u) {
  i(g);
  for (const m of M)
    for (const v of V) {
      q[g][m][v].normal = q[g][m][v].normal.filter((id) => id !== u);
      q[g][m][v].inf = q[g][m][v].inf.filter((id) => id !== u);
      if (q[g][m][v].emu3)
        q[g][m][v].emu3 = q[g][m][v].emu3.filter((id) => id !== u);
    }
}

// Salva { webhook, messageId } para permitir webhook.editMessage()
function getFilaMsg(g, m, v) {
  i(g);
  return f[g]?.[m]?.[v] || null;
}

function setFilaMsg(g, m, v, data) {
  i(g);
  // Aceita tanto Message direto quanto { webhook, messageId }
  f[g][m][v] = data;
}

function getPartida(c) {
  return p[c] || null;
}

function setPartida(c, d) {
  p[c] = d;
}

function deletePartida(c) {
  delete p[c];
}

module.exports = {
  initGuild: i,
  getQueue,
  removeFromAllQueues,
  getFilaMsg,
  setFilaMsg,
  getPartida,
  setPartida,
  deletePartida,
};
