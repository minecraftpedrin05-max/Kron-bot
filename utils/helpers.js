const{EmbedBuilder}=require("discord.js");
const db=require("../database/db");

function getThumb(guild){
  return guild.iconURL({dynamic:true})||null;
}
function getCor(guildId){
  const cfg=db.getGuild(guildId);
  const cor=cfg.config?.cor||"0x2b2d31";
  return parseInt(cor.replace("#","").replace("0x",""),16)||0x2b2d31;
}
function getNome(guild){
  return guild.name;
}
async function enviarDM(client,userId,mensagem){
  try{const user=await client.users.fetch(userId);await user.send(mensagem);}catch(e){}
}
async function enviarLog(guild,cor,titulo,campos){
  try{
    const cfg=db.getGuild(guild.id);
    const channelId=cfg.logs?.channelId;
    if(!channelId)return;
    const canal=await guild.channels.fetch(channelId).catch(()=>null);
    if(!canal)return;
    const embed=new EmbedBuilder().setColor(cor).setTitle(titulo).addFields(campos).setTimestamp().setFooter({text:guild.name,iconURL:guild.iconURL({dynamic:true})||undefined});
    await canal.send({embeds:[embed]});
  }catch(e){console.error("Erro log:",e.message);}
}
function checkLicense(guildId){return db.hasLicense(guildId);}

const ORDEM_PLANOS = ['FREE', 'BASICO', 'PRO', 'PREMIUM', 'PERMANENTE'];
function temPlanoMinimo(guildId, minimo) {
  try {
    const lic = db.getLicense(guildId);
    const tipo = lic?.tipo || 'FREE';
    // PERMANENTE tem acesso a tudo — sempre passa
    if (tipo === 'PERMANENTE') return true;
    return ORDEM_PLANOS.indexOf(tipo) >= ORDEM_PLANOS.indexOf(minimo);
  } catch { return false; }
}

module.exports={getThumb,getCor,getNome,enviarDM,enviarLog,checkLicense,temPlanoMinimo};