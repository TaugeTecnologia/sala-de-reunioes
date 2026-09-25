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
  O campo Data aceita digitação contínua em **DD/MM/AAAA** (digite `25092026`)
  e mostra somente o dia escolhido, inclusive quando a consulta específica é de
  domingo. Datas incompletas ou inválidas não substituem o último filtro válido.
  Sem filtros, os botões percorrem semanas consecutivas. Com filtros ativos,
  passam a percorrer somente semanas com resultados, preservando os filtros.
  Dias fora do período coletado ficam em branco, sem aviso ou fundo listrado.
  Navegar para outros meses ou anos carrega automaticamente os meses da semana exibida. Uma data exata consulta seu próprio mês.
- **Agenda:** busca por nome da reunião, criador, organizador ou convidado
  (incluindo e-mail), sem distinguir acentos ou maiúsculas. Os termos podem ser
  combinados com data e sala. A busca leva à semana de um resultado e destaca seu
  horário; a contagem informa quantas reuniões foram encontradas no período e na
  área exibida. A rolagem manual é preservada durante a atualização dos dados.
  A navegação usa um único par de botões no cabeçalho do calendário: **Semana
  anterior / Próxima semana** sem filtros e **Anterior / Próxima** durante a busca.
  Nesse modo, o título indica a posição (por exemplo, **Semana 2 de 3**), e os
  botões ficam desabilitados nos limites ou quando não há resultados. Os eventos encontrados recebem um
  contorno discreto e título levemente destacado, também nos eventos de dia inteiro.
  O destaque desaparece ao limpar os filtros. Uma data exata restringe a busca ao
  dia informado, sem oferecer navegação para semanas fora desse filtro.
  O filtro **Situação da reserva** oferece **Todas as situações**, **Finalizada**,
  **Em andamento** e **Prevista**, segundo o início e fim reais. A seleção acompanha
  o relógio a cada segundo e independe da confirmação do convite da sala.
- **Lista de reuniões:** na visão geral, mostra somente reuniões que ocupam alguma
  parte do dia atual em Brasília, incluindo dia inteiro e passagem da meia-noite.
  As colunas são **Horário / data**, **Evento**, **Organizador**, **Convidados** e
  **Situação**. A visualização única mostra uma sequência neutra de horários, de **30 em 30 minutos**
  por padrão, de 00:00 a 23:30. Quando os horários de início ou fim exigem uma
  escala menor, apenas aquele dia se adapta ao maior intervalo comum compatível
  com os eventos (por exemplo, 15, 10, 5 ou 1 minuto). O cálculo considera todas as
  reuniões do dia e mantém a mesma escala entre Atuais e Histórico. Dias inteiros
  e eventos de outros dias não reduzem os intervalos. A coluna usa cor e fonte
  uniformes, sem realçar as horas cheias. Escalas muito pequenas ganham espaço
  para manter os horários legíveis e a rolagem preserva o trecho que estava aberto.
  Cada reunião continua em um único bloco. A posição e a altura usam os minutos
  reais: 13:06–14:06 começa em 13:06 e representa uma hora, sem arredondar.
  Um ponto discreto no evento acompanha os inícios fora do intervalo padrão.
  Reuniões simultâneas ficam lado a lado, com as colunas preservadas e rolagem
  horizontal quando necessário. Eventos de dia inteiro têm uma faixa própria.
  Reuniões que atravessam a meia-noite ocupam somente a parte do dia exibido,
  preservando os horários originais nos detalhes. Intervalos vazios ficam em branco.
  Os blocos resumem os convidados e abrem o modal de detalhes completos ao clicar.
  Eventos muito curtos mantêm sua altura real na linha do tempo.
  A aba **Atuais** exibe reuniões em andamento e futuras; **Histórico** exibe
  as encerradas hoje. O início e fim reais aparecem junto ao nome do evento,
  sem arredondamento nem repetição a cada intervalo.
  As contagens e a separação
  acompanham o relógio a cada segundo; a reunião muda de aba no horário de término.
  À meia-noite a lista muda automaticamente para o novo dia. Eventos sem intervalo
  válido não são atribuídos a hoje; os dados originais são preservados.
  Na visão geral, a área recolhida mantém altura fixa equivalente a quatro linhas,
  mesmo quando há menos reuniões ou nenhuma. As abas Atuais e Histórico ficam
  junto ao título e mantêm a mesma altura ao alternar. A rolagem dá acesso às demais
  reuniões, com rodapé compacto junto à base do card.
  Todas as reuniões permanecem na lista. O botão **Exibir tudo** fica sempre
  visível e expande a lista da aba selecionada; **Recolher lista** restaura a rolagem.
  Abrir, recolher ou trocar de aba posiciona a rolagem perto da hora atual.
  A rolagem manual permanece livre durante as atualizações. **Exibir tudo** mostra
  o dia completo. O card da sala é apenas informativo, sem botão de navegação.
- **Detalhes do evento:** início/fim, criador, organizador, descrição, convidados,
  respostas ao convite, acompanhantes e situação da reserva.

Não há aba, botão ou formulário de criação de reservas. A ilustração da sala é
decorativa; não representa uma planta real nem informa capacidade.

A integração aceita **todos os meses e anos**, inclusive futuros. Use os botões de semana ou digite uma data em **DD/MM/AAAA** para acessar o período desejado. A coleta é mensal, sob demanda; não tenta expandir recorrências por infinitos anos. A Visão geral acompanha o mês atual e o seguinte e muda automaticamente na virada do mês/ano. A próxima reunião é procurada nesse intervalo; a Agenda permite consultar datas mais distantes.
Horários são apresentados em UTC-03:00, independentemente do fuso do navegador.

## Integração dos dados

O serviço consulta o Google automaticamente enquanto houver uma aba do painel
conectada, usando o coletor Python existente. Ele também lê a exportação mais recente de
`../recuperando-dados-sala-de-reunião/exportacoes`, com o formato
`eventos_das_salas_v2`, proveniente da consulta direta à agenda da sala.
Arquivos de coletas interrompidas ou exportações antigas de todos os funcionários
não são apresentados. Se a última tentativa falhar, preserva os dados acessíveis
da coleta anterior e informa essa condição.

- Ao abrir o painel, inicia o acompanhamento dos meses selecionados. O servidor
  consulta a agenda da sala em intervalos de **2 segundos entre consultas**,
  mais o tempo necessário para a resposta do Google.
- Cada nova coleta é enviada ao navegador por **Server-Sent Events (SSE)**.
  Criações, edições, mudanças de horário e cancelamentos aparecem sem F5 ou clique.
  Uma coleta válida vazia também limpa os eventos que deixaram de existir.
- O primeiro cartão compara o relógio com os eventos **a cada segundo**, sem
  depender de outra consulta para mudar no início ou fim de uma reserva conhecida.
- Várias abas compartilham a coleta; há somente um processo Python por vez.
  Meses e anos diferentes são atendidos em fila, com estados e arquivos separados. Ao fechar todas as abas, não são
  agendadas novas consultas automáticas.
- A conexão se restabelece automaticamente após quedas. Uma falha não apaga a
  última agenda recebida; o aviso permanece visível até a recuperação. As
  tentativas ao Google passam a ter intervalos maiores, limitados a 120 segundos.

Esta é uma atualização automática por consultas periódicas, **não uma garantia
de entrega instantânea**. Notificações push do Google exigem um receptor HTTPS
acessível pelo serviço, que não existe no endereço local `127.0.0.1`.
[Requisitos oficiais das notificações](https://developers.google.com/workspace/calendar/api/guides/push).

Os eventos precisam estar vinculados à agenda da sala e dentro do **período consultado**. Criar uma reunião somente na agenda pessoal, sem incluir a
sala, não faz esse evento aparecer no painel.

O coletor automático usa `--painel` e atualiza somente
`exportacoes/agenda-AAAA-MM-atual.json`, publicado atomicamente ao concluir
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
fora do período consultado, exibe `—` com o motivo em vez de afirmar que
a sala está livre. A lista de reuniões permanece disponível.

Criações/edições no Google entram após a próxima coleta: **2 segundos de espera
mais o tempo de resposta do Google e do coletor**. O coletor recebe `--ano` e `--mes`. A consulta é compartilhada entre abas e não abre processos simultâneos.
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
├── server/realtime.mjs     Acompanhamento dos meses conectados e intervalos
├── server/index.mjs        Inicialização do servidor
├── scripts/dev.mjs         Execução conjunta da interface e API
├── vite.config.js          Interface em 5175 e proxy da API em 8787
└── public/favicon.svg
```

Rotas da API: `GET /api/agenda?ano=2027&mes=1`, `GET /api/eventos?ano=2027&mes=1` (SSE),
`POST /api/sincronizar` com `{"ano":2027,"mes":1}` e `GET /api/sincronizacao?ano=2027&mes=1`. Quando omitidos, ano e mês usam a data atual em UTC-03.
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

As exportações antigas de setembro continuam legíveis. Reuniões entre meses são combinadas pela chave da ocorrência, mantendo uma única reunião e a versão mais recente. Consultas usam limites mensais e fim exclusivo, conforme a [documentação de events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).
