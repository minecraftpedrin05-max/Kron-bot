// ═══════════════════════════════════════════════════════════════════════════
//  template-system/core/recovery.js — KAEL SERVER TEMPLATES
//
//  Roda UMA VEZ no boot do bot (chamado a partir de index.js, junto com os
//  outros "resistentes a restart" — sorteioScheduler, expiracaoScheduler etc.)
//
//  O QUE RESOLVE:
//  Se o bot for reiniciado (deploy, crash, queda) NO MEIO de uma aplicação de
//  template, `template-system/core/store.js` já tem um registro aberto
//  (`kronTemplates.operacao`) com o estágio em que parou e os IDs de tudo
//  que já foi criado até aquele instante (persistido recurso a recurso pelo
//  applier.js, não só no final).
//
//  DECISÃO DE DESIGN — por que NÃO continuar criando o que falta:
//  Continuar de onde parou exigiria confiar que o estado do servidor no
//  Discord não mudou nada entre a queda e o boot (cargos/canais podem ter
//  sido apagados manualmente, o bot pode ter perdido permissão, etc.) e que
//  o "resto do plano" calculado antes da queda ainda é válido. Não dá pra
//  garantir isso com segurança — e o pedido explícito é "nunca duplicar
//  recursos". Em vez de arriscar recriar algo que já existe (ou pior, tentar
//  aplicar overwrites de permissão sobre cargos que não existem mais), a
//  recovery:
//
//    1. transforma a operação órfã num item de HISTÓRICO normal, com o
//       resultado "interrompido_reinicio" e a lista exata (por ID) do que
//       foi criado até a queda;
//    2. isso automaticamente HABILITA O BOTÃO "Desfazer" já existente
//       (applier.desfazer só apaga por ID e já verifica se cada recurso
//       ainda existe antes — reaproveita 100% do rollback que já existia,
///      não inventa um segundo mecanismo);
//    3. avisa por DM (best-effort) quem tinha iniciado a aplicação;
//    4. fecha o registro transitório e libera o índice global.
//
//  O administrador decide, olhando o servidor real: manter o que foi criado
//  (e seguir manualmente) ou desfazer com um clique. Nenhum recurso é
//  recriado, nenhuma permissão é reaplicada às cegas — zero risco de
//  duplicação.
//
//  Observação sobre DESFAZER (rollback) em si: se a queda acontecer DURANTE
//  um rollback (em vez de uma aplicação), não precisa de tratamento especial
//  aqui — apagar por ID já é idempotente (ver applier.desfazer: cada recurso
//  é checado antes de apagar), então repetir o mesmo "Desfazer" depois do
//  restart simplesmente termina o que faltava, sem duplicar exclusão nenhuma.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const store = require('./store');

function idsDe(lista) {
  return (Array.isArray(lista) ? lista : []).map((x) => x.id).filter(Boolean);
}

async function notificar(client, userId, texto) {
  try {
    const u = await client.users.fetch(userId);
    await u.send(texto);
  } catch { /* DM fechada, usuário saiu, ou client ainda sem cache — não é crítico */ }
}

/**
 * Varre as guilds com operação pendente (índice global, não precisa varrer
 * todas as guilds do bot) e converte cada uma em histórico + libera o lock.
 * Retorna quantas foram recuperadas (para log).
 */
async function recuperar(client) {
  const guildIds = store.getIndiceOperacoes();
  let total = 0;

  for (const guildId of guildIds) {
    const op = store.getOperacao(guildId);
    if (!op) { store.finalizarOperacao(guildId); continue; } // índice órfão (sem registro) — só limpa

    const criados = op.criados || { cargos: [], categorias: [], canais: [] };
    const contagem = { cargos: criados.cargos.length, categorias: criados.categorias.length, canais: criados.canais.length };

    try {
      const entrada = store.adicionarHistorico(guildId, {
        userId: op.userId, slug: op.slug, nome: op.templateNome, versao: op.templateVersao,
        contagem, reaproveitados: 0,
        resultado: 'interrompido_reinicio',
        erros: [`O bot foi reiniciado durante a aplicação (estágio: ${op.estado || 'desconhecido'}). Os recursos já criados foram preservados — use "Desfazer" no histórico se quiser removê-los.`],
        criados: { cargos: idsDe(criados.cargos), categorias: idsDe(criados.categorias), canais: idsDe(criados.canais) },
      });

      console.log(`[Kael Templates] Recovery: guild ${guildId} tinha aplicação "${op.templateNome || op.slug}" interrompida (estágio ${op.estado}). Registrada como histórico ${entrada.id} — ${contagem.cargos} cargo(s), ${contagem.categorias} categoria(s), ${contagem.canais} canal(is) preservados.`);

      if (client && op.userId) {
        const total3 = contagem.cargos + contagem.categorias + contagem.canais;
        await notificar(client, op.userId,
          `O Kael Templates foi reiniciado enquanto o template **${op.templateNome || op.slug}** estava sendo aplicado no seu servidor.\n` +
          (total3 > 0
            ? `${contagem.cargos} cargo(s), ${contagem.categorias} categoria(s) e ${contagem.canais} canal(is) já tinham sido criados e foram preservados — nada foi apagado.\nAbra **/template → Histórico** para continuar manualmente ou usar **Desfazer**.`
            : `Nenhum recurso chegou a ser criado antes da interrupção. Pode abrir **/template** e aplicar novamente quando quiser.`));
      }
      total++;
    } catch (e) {
      console.error(`[Kael Templates] Recovery: falha ao processar operação pendente da guild ${guildId}:`, e.message);
    } finally {
      // Sempre fecha, mesmo se algo acima falhou — nunca deixar o índice
      // apontando pra uma operação "fantasma" pra sempre.
      store.finalizarOperacao(guildId);
    }
  }

  if (total > 0) console.log(`[Kael Templates] Recovery: ${total} operação(ões) interrompida(s) recuperada(s).`);
  return total;
}

module.exports = { recuperar };
