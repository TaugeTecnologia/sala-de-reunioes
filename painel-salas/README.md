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

- **Visão geral:** situação atual da sala, próxima reunião, dia da semana e data
  de hoje, quantidade de salas acompanhadas e lista de reuniões do dia com abas
  Atuais e Histórico.
- **Calendário semanal na Agenda:** segunda a sábado, com dia/data no cabeçalho e as 24
  horas à esquerda. Ao abrir e na virada do dia, a rolagem destaca a hora atual,
  com contexto anterior e espaço para os próximos horários. A rolagem manual
  permanece livre e não é reposicionada a cada atualização dos eventos.
  Em telas pequenas também é possível deslizar
  na horizontal. Abre na semana atual, com botões **Semana anterior** e
  **Próxima semana**. A navegação mantém a posição da rolagem; o destaque de hoje
  e a linha da hora atual aparecem somente na data real de Brasília.
  Eventos simultâneos ficam lado a lado, reuniões que atravessam a
  meia-noite aparecem nos dias correspondentes e eventos de dia inteiro têm uma
  faixa própria. Clicar no evento abre seus detalhes; clicar na data filtra o dia.
  O campo Data leva o calendário à semana escolhida. Os botões de semana removem
  o filtro de dia, mantendo a busca, a sala e a situação da reserva.
  Dias fora do período coletado ficam marcados como sem dados.
- **Agenda:** calendário semanal com busca por evento ou pessoa e filtros de data,
  sala e confirmação, substituindo a antiga tabela de eventos.
- **Lista de reuniões:** na visão geral, mostra somente reuniões que ocupam alguma
  parte do dia atual em Brasília, incluindo dia inteiro e passagem da meia-noite.
  As colunas são **Horário / data**, **Evento**, **Organizador**, **Convidados** e
  **Situação**. Os convidados aparecem por nome; listas longas são resumidas no
  modo compacto e exibidas completas ao expandir ou abrir os detalhes do evento.
  As duas abas mostram faixas de **00:00 a 23:00**, inclusive sem eventos.
  Nas faixas sem reunião na aba selecionada, somente horário e data aparecem;
  as demais colunas ficam em branco, sem indicação de disponibilidade.
  A aba **Atuais** exibe reuniões em andamento e futuras; **Histórico** exibe
  as encerradas hoje. O início e fim reais aparecem junto ao nome do evento,
  sem arredondamento. Reuniões que atravessam uma hora ficam identificadas como
  continuação na faixa seguinte, sem aumentar a contagem de reuniões.
  As contagens e a separação
  acompanham o relógio a cada segundo; a reunião muda de aba no horário de término.
  À meia-noite a lista muda automaticamente para o novo dia. Eventos sem intervalo
  válido não são atribuídos a hoje; os dados originais são preservados.
  Na visão geral, a área recolhida tem altura fixa para quatro linhas,
  mesmo quando há menos reuniões ou nenhuma. As abas Atuais e Histórico ficam
  junto ao título e mantêm a mesma altura ao alternar. A rolagem dá acesso às demais
  reuniões, com rodapé compacto junto à base do card.
  Todas as reuniões permanecem na lista. O botão **Exibir tudo** fica sempre
  visível e expande a lista da aba selecionada; **Recolher lista** restaura a rolagem.
  Abrir a lista, recolher ou trocar de aba posiciona a rolagem perto da hora atual.
  A rolagem manual permanece livre durante as atualizações. **Exibir tudo** mostra
  todas as faixas do dia mesmo sem reuniões.
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
  consulta a agenda da sala em intervalos de **2 segundos entre consultas**,
  mais o tempo necessário para a resposta do Google.
- Cada nova coleta é enviada ao navegador por **Server-Sent Events (SSE)**.
  Criações, edições, mudanças de horário e cancelamentos aparecem sem F5 ou clique.
  Uma coleta válida vazia também limpa os eventos que deixaram de existir.
- O primeiro cartão compara o relógio com os eventos **a cada segundo**, sem
  depender de outra consulta para mudar no início ou fim de uma reserva conhecida.
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

A atualização automática usa o token existente. Se precisar renovar a autorização,
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

**Hoje:** dia da semana e data atual no fuso de Brasília (UTC-03:00). Acompanha
o relógio do computador e muda automaticamente à meia-noite, independentemente
do ano selecionado para a agenda. Os quatro cartões usam texto principal de 20 px,
com rótulos e informações complementares de 11 px.

**Próxima reunião:** nome, data e horários de início/fim da próxima reserva
confirmada da sala que ainda não começou, dentro do período consultado. O cartão
é recalculado a cada segundo e avança quando a reunião começa. Se não houver
outra reserva futura, mostra “Nenhuma reunião prevista”. Eventos de dia inteiro
aparecem com essa indicação, sem inventar horários.

**Situação da sala agora:** `Ocupado` quando existe uma reserva confirmada da
primeira sala acompanhada com `início <= agora < fim`; `Livre` nos demais horários
cobertos pelos dados atuais. Reservas recusadas, pendentes, canceladas ou marcadas
como livres não ocupam a sala. Sobreposições e reuniões consecutivas mantêm o
estado ocupado. Datas de dia inteiro respeitam o fim exclusivo e UTC-03:00.

O cartão usa a hora do computador e é recalculado a cada segundo enquanto a aba
está ativa; ao voltar a uma aba suspensa, confere imediatamente o relógio novamente.
O indicador descreve a agenda, não detecta presença física. Se a conexão cair, a
consulta falhar, o snapshot tiver 30 segundos ou mais, ou o horário atual estiver
fora de setembro do ano consultado, exibe `—` com o motivo em vez de afirmar que
a sala está livre. A lista de reuniões permanece disponível.

Criações/edições no Google entram após a próxima coleta: **2 segundos de espera
mais o tempo de resposta do Google e do coletor**. O código Python permanece
inalterado. A consulta é compartilhada entre abas e não abre processos simultâneos.
Falhas continuam usando intervalos de 30, 60 e até 120 segundos antes de tentar
novamente, preservando os limites da API.

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
├── src/lib/clock.js        Relógio por segundo e retomada da aba
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
