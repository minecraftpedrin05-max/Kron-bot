const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.toJSON) {
    commands.push(command.data.toJSON());
    console.log(`<:positivo:1528401238197276702> Carregado: ${file}`);
  } else {
    console.warn(`⚠️  Ignorado (sem data): ${file}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\n<:canal:1524207214791884890> Registrando ${commands.length} comando(s)...`);

    const data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log(`<:positivo:1528401238197276702> ${data.length} comando(s) registrados com sucesso!`);
  } catch (error) {
    console.error('<:negativo:1528400986744295475> Erro ao registrar comandos:', error);
  }
})();
