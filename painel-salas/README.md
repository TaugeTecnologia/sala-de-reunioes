# Painel de salas — Tauge

Uma nova interface para acompanhar as reuniões da sala, inspirada no visual de
`reserva-salas`. O projeto anterior permanece independente. Este painel usa os dados
reais do coletor Python e oferece somente consulta e atualização dos dados.

## Abrir o painel

Na raiz `teste`, execute:

```powershell
cd .\painel-salas
npm.cmd install
npm.cmd run dev
```

Acesse **http://127.0.0.1:5175**. O comando inicia a interface e o serviço de dados
em conjunto. Para encerrar, pressione `Ctrl+C` no terminal. Requer Node.js 22.12+
e as dependências Python do coletor já instalado na pasta vizinha.

As dependências já foram preparadas nesta máquina; basta `npm.cmd run dev`.

## O que aparece

- **Visão geral:** quantidade de eventos, horas agendadas, convidados únicos,
  calendário mensal e próximos encontros disponíveis na exportação.
- **Agenda:** busca por evento ou pessoa, filtros de data, sala e confirmação.
- **Sala de reunião:** dados da sala e as pessoas vinculadas aos seus eventos.
- **Detalhes do evento:** início/fim, criador, organizador, descrição, convidados,
  respostas ao convite, acompanhantes e situação da reserva.

Não há aba, botão ou formulário de criação de reservas. A ilustração da sala é
decorativa; não representa uma planta real nem informa capacidade.

O período atual é **setembro**, conforme o coletor existente. O seletor de ano
permite consultar outras exportações de setembro ou executar uma nova coleta.
Horários são apresentados em UTC-03:00, independentemente do fuso do navegador.

## Integração dos dados

O serviço consulta o Google automaticamente enquanto houver uma aba do painel
conectada, usando o coletor Python existente. Ele também lê a exportação mais recente de
`../recuperando-dados-sala-de-reunião/exportacoes`, com o formato
`eventos_das_salas_v2`, proveniente da consulta direta à agenda da sala.
Arquivos de coletas interrompidas ou exportações antigas de todos os funcionários
não são apresentados. Se a última tentativa falhar, preserva os dados acessíveis
da coleta anterior e informa essa condição.

- Ao abrir o painel, inicia o acompanhamento do ano selecionado. O servidor
  consulta a agenda da sala em intervalos de **15 segundos entre consultas**,
  mais o tempo necessário para a resposta do Google.
- Cada nova coleta é enviada ao navegador por **Server-Sent Events (SSE)**.
  Criações, edições, mudanças de horário e cancelamentos aparecem sem F5 ou clique.
  Uma coleta válida vazia também limpa os eventos que deixaram de existir.
- **Atualizar agora** antecipa a próxima consulta. **Recarregar dados** relê os
  dados locais, sem iniciar uma consulta separada ao Google.
- Várias abas compartilham a coleta; há somente um processo Python por vez.
  Anos diferentes são atendidos em fila. Ao fechar todas as abas, não são
  agendadas novas consultas automáticas.
- A conexão se restabelece automaticamente após quedas. Uma falha não apaga a
  última agenda recebida; o aviso permanece visível até a recuperação. As
  tentativas ao Google passam a ter intervalos maiores, limitados a 120 segundos.

Esta é uma atualização automática por consultas periódicas, **não uma garantia
de entrega instantânea**. Notificações push do Google exigem um receptor HTTPS
acessível pelo serviço, que não existe no endereço local `127.0.0.1`.
[Requisitos oficiais das notificações](https://developers.google.com/workspace/calendar/api/guides/push).

Os eventos precisam estar vinculados à agenda da sala e dentro de **setembro do
ano selecionado**. Criar uma reunião somente na agenda pessoal, sem incluir a
sala, não faz esse evento aparecer no painel.

O coletor automático usa `--painel` e atualiza somente
`exportacoes/agenda-setembro-<ano>-atual.json`, publicado atomicamente ao concluir
a consulta. Não gera um novo par JSON/Markdown a cada atualização. Se alguma sala
ou página falhar, mantém o arquivo anterior. As exportações convencionais continuam
disponíveis para uso manual do script.

O botão de atualização usa o token existente. Se precisar renovar a autorização,
faça isso no terminal, na pasta do coletor:

```powershell
python .\trazer-agenda-de-setembro.py --autorizar --ano 2026
```

Credenciais e tokens ficam no coletor; não são enviados ao navegador nem incluídos
no build. Apenas os dados necessários à consulta são devolvidos pela API local.
O servidor escuta exclusivamente em `127.0.0.1`; esta versão é de uso local.

O Python desta máquina é encontrado automaticamente. Em outra instalação, pode
informar seu executável antes de iniciar o painel:

```powershell
$env:PYTHON_EXECUTABLE = 'C:\caminho\python.exe'
npm.cmd run dev
```

## Significado dos indicadores

As horas representam a união dos intervalos confirmados por sala dentro do mês,
evitando somar horários sobrepostos em duplicidade. Não são uma taxa de ocupação
nem prova de uso físico do espaço.

Convidados únicos são e-mails identificados na lista de participantes, excluindo
recursos. A página de pessoas também inclui criadores e organizadores. Convidados
adicionais anônimos são detalhados na reunião, mas não viram contatos individuais.
Aceites não comprovam comparecimento presencial. Campos que o Google omitiu
aparecem como não informados; os avisos de acesso limitado permanecem visíveis.

## Estrutura

```text
painel-salas/
├── src/App.jsx             Telas, navegação e detalhes das reuniões
├── src/styles.css          Visual responsivo
├── src/lib/agenda.js       Datas, filtros, calendário e métricas
├── src/lib/live.js         Conexão automática e reconexão da tela
├── server/app.mjs          API local, exportações e sincronização
├── server/realtime.mjs     Acompanhamento dos anos conectados e intervalos
├── server/index.mjs        Inicialização do servidor
├── scripts/dev.mjs         Execução conjunta da interface e API
├── vite.config.js          Interface em 5175 e proxy da API em 8787
└── public/favicon.svg
```

Rotas da API: `GET /api/agenda?ano=2026`, `GET /api/eventos?ano=2026` (SSE),
`POST /api/sincronizar` com `{"ano":2026}` e `GET /api/sincronizacao`.
O fluxo SSE envia `agenda` com os dados e `estado` com a situação da consulta,
intervalo e horários da última/próxima tentativa. A sincronização aceita um processo
por vez e limita sua duração a três minutos. Os testes usam processos simulados.

## Validar e executar o build

```powershell
npm.cmd test
npm.cmd run build
```

Para usar o build, encerre o comando de desenvolvimento e execute:

```powershell
npm.cmd start
```

Nesse modo, interface e API ficam juntas em **http://127.0.0.1:8787**.
