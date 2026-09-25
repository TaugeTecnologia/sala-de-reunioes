#!/usr/bin/env bash
# Sobe o backend em Docker com túnel HTTPS e mostra a URL da API.
# Uso: bash scripts/subir.sh            -> backend + túnel temporário
#      PUBLICAR=1 bash scripts/subir.sh -> também republica o front no GitHub Pages apontando para a API
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
set_env() { # chave valor: só preenche se estiver vazio
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    [ -n "$(sed -n "s/^${key}=//p" .env)" ] || sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}
set_env SESSAO_SEGREDO "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
set_env HOSTS_PERMITIDOS ".trycloudflare.com"
set_env ORIGENS_PERMITIDAS "https://taugetecnologia.github.io"

mkdir -p dados
chgrp -R sala-de-reunioes dados 2>/dev/null || true
chmod 2775 dados

docker compose --profile rapido up -d --build

echo -n "Aguardando o túnel"
url=""
for _ in $(seq 1 45); do
  url="$(docker compose logs tunel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)"
  [ -n "$url" ] && break
  echo -n "."; sleep 2
done
echo
[ -n "$url" ] || { echo "Não foi possível obter a URL do túnel. Veja: docker compose logs tunel" >&2; exit 1; }
echo "API / painel: $url"
echo "$url" > dados/url-api.txt

if [ "${PUBLICAR:-0}" = "1" ]; then
  VITE_API_URL="$url" bash scripts/publicar-pages.sh
fi
