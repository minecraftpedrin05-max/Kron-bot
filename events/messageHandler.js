const{EmbedBuilder,ContainerBuilder,TextDisplayBuilder,SeparatorBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require("discord.js");
const{CORES,BOT_OWNER_ID}=require("../config/constants");
const{getNome}=require("../utils/helpers");
const db=require("../database/db");
const pkg=require("../package.json");

module.exports={
name:"messageCreate",
async execute(message){
  if(message.author.bot)return;

  // Reescrito de Events/BotInfo.py (KAKA) — quando o bot é mencionado
  // sozinho (sem nenhum comando junto), responde com um "cartão de
  // identidade": título, versão, prefixo, dono, latência, botão de suporte.
  if(message.mentions.has(message.client.user)){
    const versao = pkg.version || "1.0.0";
    const prefixo = "!";
    const ownerMention = BOT_OWNER_ID ? `<@${BOT_OWNER_ID}>` : "Não definido";
    const latenciaMs = Math.round(message.client.ws.ping);

    const container1 = new ContainerBuilder()
      .setAccentColor(CORES.PRIMARIA)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${message.client.user.username}\n-# Informações do bot`
      ));

    const container2 = new ContainerBuilder()
      .setAccentColor(CORES.PRIMARIA)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `Informações do **${message.client.user.username}**\n` +
        `**<:casa:1524207827009409054> Exclusivo para o servidor** ${message.guild.name}\n` +
        `**<:user:1532137085081878558> Menção:** ${message.client.user}\n` +
        `**<:bot:1524207085850591273> Versão:** \`${versao}\`\n` +
        `**📎 Prefixo:** \`${prefixo}\`\n` +
        `**<:user:1532137085081878558> Dono:** ${ownerMention}\n` +
        `**<:raio:1533080818258411662> Tempo de Resposta:** \`${latenciaMs}ms\``
      ));

    const container3 = new ContainerBuilder()
      .setAccentColor(CORES.PRIMARIA)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        "-# caso precise de suporte clique no botão abaixo"
      ))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Servidor de Suporte").setStyle(ButtonStyle.Link).setURL("https://discord.gg/SEU_SERVIDOR_AQUI")
      ));

    await message.reply({
      components: [container1, container2, container3],
      flags: MessageFlags.IsComponentsV2,
      failIfNotExists: false,
    });
    return;
  }

  if(message.content.startsWith("!perfil")){
    let target = null;

    // 1. Tenta pegar menção @usuario
    target = message.mentions.users.first() || null;

    // 2. Se não tiver menção, tenta pegar por ID no comando
    if(!target){
      const args = message.content.trim().split(/\s+/);
      const idArg = args[1];
      if(idArg && /^\d{17,20}$/.test(idArg)){
        try{
          target = await message.client.users.fetch(idArg);
        }catch(e){
          await message.reply("<:negativo:1528400986744295475> Usuário não encontrado com esse ID.");
          return;
        }
      }
    }

    // 3. Se não tiver nada, mostra o próprio perfil
    if(!target) target = message.author;

    const g = db.getGuild(message.guild.id);
    const s = g.stats?.[target.id] || { vitorias: 0, derrotas: 0 };
    const total = s.vitorias + s.derrotas;
    const taxa = total > 0 ? ((s.vitorias / total) * 100).toFixed(1) : "0.0";

    // barra de progresso da taxa de vitória
    const taxaNum = parseFloat(taxa);
    const blocos = 10;
    const preenchidos = Math.round((taxaNum / 100) * blocos);
    const barra = "🟩".repeat(preenchidos) + "⬛".repeat(blocos - preenchidos);

    // posição no ranking do servidor
    const statsAll = g.stats || {};
    const ranking = Object.entries(statsAll)
      .sort((a, b) => b[1].vitorias - a[1].vitorias);
    const posicao = ranking.findIndex(([uid]) => uid === target.id);
    const posicaoTexto = posicao >= 0 ? `#${posicao + 1} de ${ranking.length}` : "Não rankeado";

    await message.reply({
      embeds:[new EmbedBuilder()
        .setColor(0xFFD700)
        .setAuthor({ name: `Perfil de ${target.username}`, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(
          `**<:medal:1534356044367790161> Posição no ranking:** ${posicaoTexto}\n\n` +
          `**<:rendimentos:1528401542070145135> Taxa de vitória**\n${barra}  **${taxa}%**`
        )
        .addFields(
          { name: "<:positivo:1528401238197276702> Vitórias",  value: String(s.vitorias), inline: true },
          { name: "<:negativo:1528400986744295475> Derrotas",  value: String(s.derrotas), inline: true },
          { name: "🎮 Total",     value: String(total),      inline: true }
        )
        .setFooter({ text: `${getNome(message.guild)} • Kael`, iconURL: message.guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp()
      ]
    });
    return;
  }

  if(message.content.startsWith("!ranking")){
    const g=db.getGuild(message.guild.id);
    const stats=g.stats||{};
    const sorted=Object.entries(stats).sort((a,b)=>b[1].vitorias-a[1].vitorias).slice(0,10);
    if(sorted.length===0){await message.reply("Nenhum jogador registrado ainda.");return;}
    const lista=sorted.map(([uid,s],i)=>"**"+(i+1)+".** <@"+uid+"> — "+s.vitorias+"W / "+s.derrotas+"L").join("\n");
    const thumb=message.guild.iconURL({dynamic:true})||null;
    const embed=new EmbedBuilder().setColor(CORES.INFO).setTitle("<a:trofeu:1532499321008951538> Ranking — "+getNome(message.guild)).setDescription(lista).setTimestamp();
    if(thumb)embed.setThumbnail(thumb);
    await message.reply({embeds:[embed]});
    return;
  }

  // KAEL — Central de Ajuda (!ajuda)
  // Pública, no canal (sem DM), reaproveitando o mesmo handler de
  // mensagens prefixadas e o mesmo padrão visual usado no resto do
  // arquivo. Lista só comandos que realmente existem no projeto.
  if(message.content.trim() === "!minhascompras"){
    return require("../commands/minhascompras").enviarHistoricoCompras(message);
  }

  if(message.content.trim() === "!ajuda"){
    const thumb = message.guild?.iconURL({ dynamic: true }) || undefined;
    const embed = new EmbedBuilder()
      .setColor(CORES.INFO)
      .setAuthor({ name: "👑 KAEL", iconURL: thumb })
      .setTitle("Central de Ajuda")
      .setDescription("Central de ajuda e principais recursos do KAEL.")
      .addFields(
        { name: "🛒 Vendas", value: "• Sistema de loja\n• Produtos e variantes\n• Estoque\n• Carrinho\n• Pagamentos PIX\n• Entrega automática\n• Pedidos\n• Cupons" },
        { name: "⚙️ Gerenciamento", value: "• Backup\n• Ranking\n• Gerenciamento de cargos\n• Lock / Unlock\n• Sistema de mensagens\n• Definições" },
        { name: "🔐 Segurança", value: "• Sistema de licenças\n• Proteção anti-raid" },
        { name: "🎫 Suporte", value: "• Sistema de tickets\n• Atendimento" },
        { name: "📋 Principais Comandos", value:
          "`/painel` — Painel de controle da loja (produtos, tickets, definições)\n" +
          "`/backup` — Backup e restauração do servidor\n" +
          "`/ranking` — Ranking de compras do servidor\n" +
          "`/cargo-id` — Mostra o ID de um cargo\n" +
          "`/limpar` — Apaga mensagens do canal\n" +
          "`/lock` — Bloqueia o canal para um cargo\n" +
          "`/unlock` — Desbloqueia o canal para um cargo\n" +
          "`!minhascompras` — Seu histórico de compras (comando por prefixo)\n" +
          "`/mensagem` — Envia uma mensagem pelo bot\n" +
          "`/ativar` — Ativa a licença do servidor\n"
        },
        { name: "💡 Precisa de ajuda?", value: "Consulte os canais de suporte ou abra um ticket caso precise de atendimento." },
      )
      .setFooter({ text: `${getNome(message.guild)} • Kael`, iconURL: thumb })
      .setTimestamp();
    if (thumb) embed.setThumbnail(thumb);
    await message.reply({ embeds: [embed] });
    return;
  }
}};
