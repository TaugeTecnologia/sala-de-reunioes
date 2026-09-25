# Backend do painel (API + coletor Python). O front é publicado à parte no GitHub Pages,
# mas esta imagem também serve o front em / para acesso direto.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache python3 py3-pip && python3 -m venv /venv
COPY coletor/requirements.txt /tmp/requirements.txt
RUN /venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORTA=8787 \
    PYTHON_EXECUTABLE=/venv/bin/python
COPY package.json ./
COPY server server
COPY src/lib/periods.js src/lib/agenda.js src/lib/week.js src/lib/
COPY coletor coletor
COPY --from=build /app/dist dist
# Usuário sem privilégios; o grupo 1011 (sala-de-reunioes) escreve nas pastas montadas.
USER 65534:1011
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/api/auth/sessao').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
