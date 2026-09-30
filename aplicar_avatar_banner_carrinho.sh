#!/usr/bin/env bash
set -e
if [ ! -f "commands/produto.js" ]; then
  echo "Não encontrei commands/produto.js na pasta atual. Rode este script na raiz do projeto."
  exit 1
fi
echo ">> Aplicando patch (avatar do cliente + banner do produto no carrinho)..."
patch -p0 --backup --suffix=.bak < patch_carrinho_avatar_banner.patch
node -c commands/produto.js && echo ">> Sintaxe validada OK. Backup em commands/produto.js.bak"
