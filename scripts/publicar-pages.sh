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
touch "$tmp/.nojekyll"
cd "$tmp"
git add -A
if git diff --cached --quiet; then echo "Nada a publicar."; exit 0; fi
git -c user.name="${GIT_AUTHOR_NAME:-Tauge}" -c user.email="${GIT_AUTHOR_EMAIL:-noreply@users.noreply.github.com}" commit -q -m "Publica front $(date +%F_%H:%M)"
git push -q origin gh-pages
echo "Publicado: https://${REPO%%/*}.github.io/${REPO#*/}/" | tr 'A-Z' 'a-z'
