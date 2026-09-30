const{ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,PermissionFlagsBits,ChannelType}=require("discord.js");
const db=require("../database/db");
const{MODO_DISPLAY,CORES}=require("../config/constants");
const{getCor,getNome,enviarDM,enviarLog,checkLicense}=require("../utils/helpers");
const qm=require("../handlers/queueManager");
const{buildFilaEmbed}=require("../commands/fila");

function getThumb(guild,client){
  return guild.iconURL({dynamic:true,size:256})||client?.user?.displayAvatarURL({size:256})||null;
}

async function atualizarFila(guild,modo,valor,client){
  try{
    const data=qm.getFilaMsg(guild.id,modo,valor);
    if(!data)return;
    const{embeds,components}=buildFilaEmbed(guild,modo,valor,client);
    if(data.webhook&&data.messageId){
      await data.webhook.editMessage(data.messageId,{embeds,components});
    }else{
      await data.edit({embeds,components});
    }
  }catch(e){console.error("Erro ao atualizar fila:",e.message);}
}

async function criarCanalPartida(guild,client,p1,p2,modo,valor,tipo){
  try{
    const canal=await guild.channels.create({name:"partida-"+Math.floor(Math.random()*999999),type:ChannelType.GuildText,permissionOverwrites:[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:p1,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]},{id:p2,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]},{id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]}]});
    qm.setPartida(canal.id,{p1,p2,valor,modo,tipo,pagamentos:[],confirmacoes:[],guildId:guild.id});
    const thumb=getThumb(guild,client);
    const embed=new EmbedBuilder().setColor(getCor(guild.id)).setTitle("⚔️ Partida Encontrada!").addFields({name:"🎮 Modo",value:MODO_DISPLAY[modo]+" - "+tipo,inline:true},{name:"💰 Valor",value:"R$ "+valor+",00",inline:true},{name:"👥 Jogadores",value:"<@"+p1+"> vs <@"+p2+">",inline:false}).setDescription("Ambos devem confirmar para iniciar a partida.").setFooter({text:getNome(guild)}).setTimestamp();
    if(thumb)embed.setThumbnail(thumb);
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("confirmar_"+canal.id).setLabel("Confirmar").setStyle(ButtonStyle.Success).setEmoji("✅"),new ButtonBuilder().setCustomId("cancelar_"+canal.id).setLabel("Cancelar").setStyle(ButtonStyle.Danger).setEmoji("❌"));
    await canal.send({content:"<@"+p1+"> <@"+p2+">",embeds:[embed],components:[row]});
    const link="<#"+canal.id+">";
    await enviarDM(client,p1,"⚔️ Adversário encontrado! Acesse: "+link);
    await enviarDM(client,p2,"⚔️ Adversário encontrado! Acesse: "+link);
    await enviarLog(guild,CORES.SUCESSO,"⚔️ Partida Encontrada",[{name:"Jogadores",value:"<@"+p1+"> vs <@"+p2+">",inline:false},{name:"Modo",value:MODO_DISPLAY[modo],inline:true},{name:"Valor",value:"R$ "+valor+",00",inline:true},{name:"Tipo",value:tipo,inline:true},{name:"Canal",value:link,inline:false}]);
  }catch(err){console.error("Erro ao criar canal de partida:",err);}
}

async function enviarPix(canal,partida,guild,client){
  const guildData=db.getGuild(guild.id);
  const chave=guildData.pix?.chave||"Não configurado";
  const qrcode=guildData.pix?.qrcode||null;
  const thumb=getThumb(guild,client);
  const embed=new EmbedBuilder().setColor(CORES.PIX).setTitle("💰 Realize o Pagamento PIX").setDescription("**Valor:** R$ "+partida.valor+",00 cada\n\n**Bancos aceitos:**\nINTER • PICPAY • MERCADO PAGO\nNEXT/BRADESCO • SANTANDER\n\nEnvie o comprovante e clique em **Já paguei**.").setFooter({text:guildData.pix?.nome||getNome(guild)});
  if(thumb)embed.setThumbnail(thumb);
  if(qrcode)embed.setImage(qrcode);
  await canal.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("pagou_"+canal.id).setLabel("Já paguei").setStyle(ButtonStyle.Success).setEmoji("✅"))]});
  await canal.send("```\n"+chave+"\n```");
  await canal.send({content:"🔒 Apenas ADMs — clique para encerrar a sala.",components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("fechar_"+canal.id).setLabel("Fechar Sala").setStyle(ButtonStyle.Danger).setEmoji("🔒"))]});
  await enviarLog(guild,CORES.PIX,"💰 Pagamento Iniciado",[{name:"Jogadores",value:"<@"+partida.p1+"> vs <@"+partida.p2+">",inline:false},{name:"Valor",value:"R$ "+partida.valor+",00",inline:true},{name:"Canal",value:"<#"+canal.id+">",inline:true}]);
}

module.exports={name:"interactionCreate",async execute(interaction,client){
  if(!interaction.isButton())return;
  const userId=interaction.user.id,customId=interaction.customId,guild=interaction.guild;

  // ── CONFIRMAR ──
  if(customId.startsWith("confirmar_")&&!customId.includes("done")){
    const canalId=customId.replace("confirmar_","");
    const partida=qm.getPartida(canalId);
    if(!partida)return;
    if(userId!==partida.p1&&userId!==partida.p2){await interaction.reply({content:"❌ Você não faz parte desta partida.",ephemeral:true});return;}
    if(!partida.confirmacoes)partida.confirmacoes=[];
    if(partida.confirmacoes.includes(userId)){await interaction.reply({content:"✅ Você já confirmou! Aguardando o outro jogador...",ephemeral:true});return;}
    partida.confirmacoes.push(userId);

    const outroId=userId===partida.p1?partida.p2:partida.p1;

    if(partida.confirmacoes.length>=2){
      // Ambos confirmaram — desativa botões e avisa publicamente
      const rowOff=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirmar_done").setLabel("Confirmado").setStyle(ButtonStyle.Success).setEmoji("✅").setDisabled(true),
        new ButtonBuilder().setCustomId("cancelar_done").setLabel("Cancelar").setStyle(ButtonStyle.Danger).setEmoji("❌").setDisabled(true)
      );
      await interaction.update({embeds:[EmbedBuilder.from(interaction.message.embeds[0]).setColor(CORES.SUCESSO).setDescription("✅ Ambos confirmaram! Partida iniciada.")],components:[rowOff]});
      await interaction.channel.send({content:`✅ <@${userId}> confirmou! Ambos confirmaram, partida iniciada! 🎮`});
      await enviarPix(interaction.channel,partida,guild,client);
    }else{
      // Primeiro a confirmar — avisa publicamente quem confirmou e quem falta
      await interaction.reply({content:`✅ <@${userId}> confirmou! Aguardando <@${outroId}> confirmar...`});
    }
    return;
  }

  // ── CANCELAR ──
  if(customId.startsWith("cancelar_")&&!customId.includes("done")){
    const canalId=customId.replace("cancelar_","");
    const partida=qm.getPartida(canalId);
    if(!partida)return;
    if(userId!==partida.p1&&userId!==partida.p2){await interaction.reply({content:"❌ Você não faz parte desta partida.",ephemeral:true});return;}
    const rowOff=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("confirmar_done").setLabel("Confirmar").setStyle(ButtonStyle.Success).setEmoji("✅").setDisabled(true),new ButtonBuilder().setCustomId("cancelar_done").setLabel("Cancelado").setStyle(ButtonStyle.Danger).setEmoji("❌").setDisabled(true));
    await interaction.update({embeds:[EmbedBuilder.from(interaction.message.embeds[0]).setColor(CORES.ERRO).setDescription("❌ Cancelado por <@"+userId+">. Canal deletado em 5 segundos.")],components:[rowOff]});
    await enviarLog(guild,CORES.ERRO,"❌ Partida Cancelada",[{name:"Cancelado por",value:"<@"+userId+">",inline:true},{name:"Modo",value:MODO_DISPLAY[partida.modo],inline:true},{name:"Valor",value:"R$ "+partida.valor+",00",inline:true}]);
    setTimeout(async()=>{try{qm.deletePartida(canalId);await interaction.channel.delete();}catch(e){}},5000);
    return;
  }

  // ── FECHAR SALA ──
  if(customId.startsWith("fechar_")){
    const membro=await guild.members.fetch(userId).catch(()=>null);
    if(!membro||!membro.permissions.has(PermissionFlagsBits.Administrator)){await interaction.reply({content:"❌ Apenas ADMs.",ephemeral:true});return;}
    const canalId=customId.replace("fechar_","");
    const partida=qm.getPartida(canalId);
    await interaction.reply({content:"🔒 Encerrado por <@"+userId+">. Deletando em 5 segundos..."});
    await enviarLog(guild,CORES.CINZA,"🔒 Sala Fechada",[{name:"ADM",value:"<@"+userId+">",inline:true},{name:"Canal",value:interaction.channel.name,inline:true},...(partida?[{name:"Jogadores",value:"<@"+partida.p1+"> vs <@"+partida.p2+">",inline:false},{name:"Modo",value:MODO_DISPLAY[partida.modo],inline:true},{name:"Valor",value:"R$ "+partida.valor+",00",inline:true}]:[])]);
    setTimeout(async()=>{try{qm.deletePartida(canalId);await interaction.channel.delete();}catch(e){}},5000);
    return;
  }

  // ── JÁ PAGUEI ──
  if(customId.startsWith("pagou_")){
    const canalId=customId.replace("pagou_","");
    const partida=qm.getPartida(canalId);
    if(!partida)return;
    if(userId!==partida.p1&&userId!==partida.p2){await interaction.reply({content:"❌ Você não faz parte desta partida.",ephemeral:true});return;}
    if(partida.pagamentos.includes(userId)){await interaction.reply({content:"✅ Você já marcou como pago.",ephemeral:true});return;}
    partida.pagamentos.push(userId);

    if(partida.pagamentos.length>=2){
      // Os dois pagaram — busca ADMs e marca todos
      await interaction.deferUpdate();
      const membros=await guild.members.fetch();
      const adms=membros.filter(m=>m.permissions.has(PermissionFlagsBits.Administrator)&&!m.user.bot);
      const mencaoAdms=adms.map(m=>`<@${m.id}>`).join(" ");
      await interaction.channel.send({
        content:`✅ <@${partida.p1}> e <@${partida.p2}> já pagaram!\n\n${mencaoAdms} — confirmem o pagamento e encerrem a sala.`
      });
    }else{
      // Apenas um pagou — avisa publicamente quem falta
      const outroId=userId===partida.p1?partida.p2:partida.p1;
      await interaction.reply({content:`✅ <@${userId}> já pagou! Aguardando <@${outroId}> confirmar o pagamento...`});
    }
    return;
  }

  // ── ENTRAR FILA NORMAL ──
  if(customId.startsWith("normal_")){
    if(!checkLicense(guild.id)){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("❌ Servidor sem licença ativa")],ephemeral:true});return;}
    const guildData=db.getGuild(guild.id);
    if(guildData.blacklist?.[userId]){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("🚫 Você está na blacklist").addFields({name:"Motivo",value:guildData.blacklist[userId].motivo})],ephemeral:true});return;}
    const partes=customId.replace("normal_","").split("_");
    const valor=parseInt(partes[partes.length-1]),modo=partes.slice(0,-1).join("_");
    const q=qm.getQueue(guild.id,modo,valor);
    if(q.normal.includes(userId)){await interaction.reply({content:"⚠️ Você já está nessa fila!",ephemeral:true});return;}
    qm.removeFromAllQueues(guild.id,userId);
    q.normal.push(userId);
    const tipo=modo==="1x1mob"||modo==="1x1emu"?"Gel Normal":"Entrar";
    await enviarDM(client,userId,"✅ Você entrou na fila "+MODO_DISPLAY[modo]+" | R$ "+valor+",00 | "+tipo);
    await enviarLog(guild,CORES.INFO,"📥 Entrou na Fila",[{name:"Jogador",value:"<@"+userId+">",inline:true},{name:"Modo",value:MODO_DISPLAY[modo],inline:true},{name:"Valor",value:"R$ "+valor+",00",inline:true},{name:"Tipo",value:tipo,inline:true}]);
    await interaction.deferUpdate();
    await atualizarFila(guild,modo,valor,client);
    const needed=modo.startsWith("2x2")?2:modo.startsWith("3x3")?3:modo.startsWith("4x4")?4:2;
    if(q.normal.length>=needed){const players=q.normal.splice(0,needed);await atualizarFila(guild,modo,valor,client);await criarCanalPartida(guild,client,players[0],players[1],modo,valor,tipo);}
    return;
  }

  // ── ENTRAR FILA INF ──
  if(customId.startsWith("inf_")){
    if(!checkLicense(guild.id)){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("❌ Servidor sem licença ativa")],ephemeral:true});return;}
    const guildData=db.getGuild(guild.id);
    if(guildData.blacklist?.[userId]){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("🚫 Você está na blacklist").addFields({name:"Motivo",value:guildData.blacklist[userId].motivo})],ephemeral:true});return;}
    const partes=customId.replace("inf_","").split("_");
    const valor=parseInt(partes[partes.length-1]),modo=partes.slice(0,-1).join("_");
    const q=qm.getQueue(guild.id,modo,valor);
    if(q.inf.includes(userId)){await interaction.reply({content:"⚠️ Você já está nessa fila!",ephemeral:true});return;}
    qm.removeFromAllQueues(guild.id,userId);
    q.inf.push(userId);
    const tipo=modo==="1x1mob"||modo==="1x1emu"?"Gel Inf":"2 Emuladores";
    await enviarDM(client,userId,"✅ Você entrou na fila "+MODO_DISPLAY[modo]+" | R$ "+valor+",00 | "+tipo);
    await enviarLog(guild,CORES.INFO,"📥 Entrou na Fila",[{name:"Jogador",value:"<@"+userId+">",inline:true},{name:"Modo",value:MODO_DISPLAY[modo],inline:true},{name:"Valor",value:"R$ "+valor+",00",inline:true},{name:"Tipo",value:tipo,inline:true}]);
    await interaction.deferUpdate();
    await atualizarFila(guild,modo,valor,client);
    if(q.inf.length>=2){const[p1,p2]=q.inf.splice(0,2);await atualizarFila(guild,modo,valor,client);await criarCanalPartida(guild,client,p1,p2,modo,valor,tipo);}
    return;
  }

  // ── SAIR DA FILA ──
  if(customId.startsWith("sair_")){
    const partes=customId.replace("sair_","").split("_");
    const valor=parseInt(partes[partes.length-1]),modo=partes.slice(0,-1).join("_");
    const q=qm.getQueue(guild.id,modo,valor);
    const estaNormal=q.normal.includes(userId),estaInf=q.inf.includes(userId),estaEmu3=q.emu3?.includes(userId);
    if(!estaNormal&&!estaInf&&!estaEmu3){await interaction.reply({content:"⚠️ Você não está nessa fila.",ephemeral:true});return;}
    const tipoSaiu=estaNormal?"Normal":estaInf?"Inf":"3 Emuladores";
    if(estaNormal)q.normal=q.normal.filter(id=>id!==userId);
    if(estaInf)q.inf=q.inf.filter(id=>id!==userId);
    if(estaEmu3)q.emu3=q.emu3.filter(id=>id!==userId);
    await enviarLog(guild,CORES.ERRO,"📤 Saiu da Fila",[{name:"Jogador",value:"<@"+userId+">",inline:true},{name:"Modo",value:MODO_DISPLAY[modo],inline:true},{name:"Valor",value:"R$ "+valor+",00",inline:true},{name:"Tipo",value:tipoSaiu,inline:true}]);
    await interaction.deferUpdate();
    await atualizarFila(guild,modo,valor,client);
    return;
  }

  // ── ENTRAR FILA EMU3 ──
  if(customId.startsWith("emu3_")){
    if(!checkLicense(guild.id)){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("❌ Servidor sem licença ativa")],ephemeral:true});return;}
    const guildData=db.getGuild(guild.id);
    if(guildData.blacklist?.[userId]){await interaction.reply({embeds:[new EmbedBuilder().setColor(CORES.ERRO).setTitle("🚫 Você está na blacklist").addFields({name:"Motivo",value:guildData.blacklist[userId].motivo})],ephemeral:true});return;}
    const partes=customId.replace("emu3_","").split("_");
    const valor=parseInt(partes[partes.length-1]),modo=partes.slice(0,-1).join("_");
    const q=qm.getQueue(guild.id,modo,valor);
    if(!q.emu3)q.emu3=[];
    if(q.emu3.includes(userId)){await interaction.reply({content:"⚠️ Você já está nessa fila!",ephemeral:true});return;}
    qm.removeFromAllQueues(guild.id,userId);
    q.emu3.push(userId);
    await enviarDM(client,userId,"✅ Você entrou na fila "+MODO_DISPLAY[modo]+" | R$ "+valor+",00 | 3 Emuladores");
    await enviarLog(guild,CORES.INFO,"📥 Entrou na Fila",[{name:"Jogador",value:"<@"+userId+">",inline:true},{name:"Modo",value:MODO_DISPLAY[modo],inline:true},{name:"Valor",value:"R$ "+valor+",00",inline:true},{name:"Tipo",value:"3 Emuladores",inline:true}]);
    await interaction.deferUpdate();
    await atualizarFila(guild,modo,valor,client);
    return;
  }
}};