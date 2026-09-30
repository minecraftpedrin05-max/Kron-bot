# Kael — Discord Bot

## Visão geral
Bot de Discord (Node.js + discord.js v14) para gerenciamento de loja virtual dentro de servidores Discord. Funcionalidades:
- Sistema de loja com produtos, variantes, estoque e cupons
- Pagamentos via PIX (Mercado Pago e EFI Bank)
- Sistema de tickets de suporte
- Assinaturas, sorteios, ranking, proteção anti-raid
- Canvas para geração de banners e comprovantes
- Backup e restauração de configurações

## Como rodar
```bash
npm start
# ou
node index.js
```

## Secrets necessários
| Variável | Descrição |
|---|---|
| `DISCORD_TOKEN` | Token do bot no Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID do bot |
| `GUILD_ID` | ID do servidor Discord (opcional, para comandos por guild) |
| `LOG_CHANNEL_ID` | ID do canal de logs padrão |
| `SESSION_SECRET` | Secret de sessão |

Pagamentos opcionais (configuravelmente por `/produto criar`):
- Credenciais Mercado Pago (via `/definicoes`)
- Credenciais EFI Bank (via `/painel → EFI Bank`)

## Estrutura principal
- `index.js` — ponto de entrada, registra comandos e inicia o bot
- `commands/` — comandos slash (`/produto`, `/config`, `/painel`, etc.)
- `events/` — handlers de interações (`buttonHandler.js`, `messageHandler.js`)
- `sales-system/` — lógica de vendas, entrega e pagamentos
- `ticket-system/` — sistema de tickets
- `database/db.js` — acesso ao banco SQLite local (`database/database.json`)
- `handlers/` — schedulers, filas, atualizações periódicas

## Preferências do usuário
- Nome do bot/marca: **Kael** (não "Vortex Store")
