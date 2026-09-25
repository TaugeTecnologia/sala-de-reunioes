#!/usr/bin/env bash
# Publica o front no GitHub Pages (branch gh-pages) sem precisar de workflow.
# Uso: VITE_API_URL=https://api.exemplo.com.br npm run publicar
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${PAGES_REPO:-TaugeTecnologia/sala-de-reunioes}"
BASE="/${REPO#*/}/"
[ -n "${VITE_API_URL:-}" ] || echo "Aviso: VITE_API_URL não definido; o site abrirá sem conexão com o backend." >&2

npx vite build --base="$BASE"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --branch gh-pages "https://github.com/$REPO.git" "$tmp"
find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$tmp/"
# Qualquer endereço desconhecido (favoritos antigos, /login, /agenda...) volta para a página inicial.
cat > "$tmp/404.html" <<HTML
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Sala de Reuniões</title>
<meta http-equiv="refresh" content="0;url=$BASE"><script>location.replace("$BASE" + location.hash)</script></head>
<body><a href="$BASE">Ir para a Sala de Reuniões</a></body></html>
HTML
touch "$tmp/.nojekyll"
cd "$tmp"
git add -A
if git diff --cached --quiet; then echo "Nada a publicar."; exit 0; fi
# Autor do commit: o de quem publica (git config ou conta do gh). Nunca um e-mail genérico,
# que o GitHub atribuiria a uma conta de terceiros.
author_name="${GIT_AUTHOR_NAME:-$(git config user.name || gh api user --jq '.name // .login')}"
author_email="${GIT_AUTHOR_EMAIL:-$(git config user.email || gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')}"
git -c user.name="$author_name" -c user.email="$author_email" commit -q -m "Publica front $(date +%F_%H:%M)"
git push -q origin gh-pages
echo "Publicado: https://${REPO%%/*}.github.io/${REPO#*/}/" | tr 'A-Z' 'a-z'
