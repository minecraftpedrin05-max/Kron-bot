module.exports = {
  BOT_OWNER_ID: String(process.env.BOT_OWNER_ID || "").trim(),
  MODOS_VALIDOS: [
    "1x1mob", "2x2mob", "3x3mob", "4x4mob",
    "1x1emu", "2x2emu", "3x3emu", "4x4emu",
    "2x2misto", "3x3misto", "4x4misto"
  ],
  MODO_DISPLAY: {
    "1x1mob": "1x1 Mobile", "2x2mob": "2x2 Mobile",
    "3x3mob": "3x3 Mobile", "4x4mob": "4x4 Mobile",
    "1x1emu": "1x1 Emulador", "2x2emu": "2x2 Emulador",
    "3x3emu": "3x3 Emulador", "4x4emu": "4x4 Emulador",
    "2x2misto": "2x2 Misto", "3x3misto": "3x3 Misto", "4x4misto": "4x4 Misto"
  },
  VALORES: [100, 50, 20, 15, 10, 5, 3, 2, 1],
  CORES: {
    PRIMARIA: 0x2b2d31, SUCESSO: 0x57f287, ERRO: 0xed4245,
    AVISO: 0xfee75c, INFO: 0x5865f2, PIX: 0xf5a623, CINZA: 0x99aab5
  }
};