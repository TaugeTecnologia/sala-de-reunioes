# Trazer agenda de setembro da sala de reunião

O script consulta diretamente a agenda da sala **TAUGE CENTRAL-9-Sala de reuniões (8)**,
no período de setembro de 2026, em UTC-03:00. Não lista usuários da organização nem
consulta agendas pessoais. Todas as chamadas ao Google são somente de leitura.

## Executar

Na pasta do script:

```powershell
python -m pip install -r requirements.txt
python .\trazer-agenda-de-setembro.py --ano 2026
```

A sala padrão já está configurada em `SALA_PADRAO`, com o ID identificado no Calendar:

```text
c_1889c407qaa76h6vjchtl29n5u27e@resource.calendar.google.com
```

Para consultar outra sala, informe o e-mail/ID de sua agenda; pode repetir `--sala`:

```powershell
python .\trazer-agenda-de-setembro.py --ano 2026 --sala "email-da-sala@resource.calendar.google.com"
```

O nome completo da sala padrão e os nomes "sala de reunião"/"sala de reuniões"
também são aceitos. Outros nomes exigem o e-mail/ID; o programa não pesquisa o
Directory nem volta a consultar as agendas dos funcionários.

## Autorização

O token existente `token-agenda-setembro.json` continua funcionando. Tokens e
credenciais padrão são localizados ao lado do script; caminhos informados nas
opções são relativos ao terminal. Para escolher um token, use `--token`.

A consulta exige a **Google Calendar API** habilitada e uma conta que possa ler
os eventos da sala. O novo fluxo não precisa da Admin SDK API nem de Usuários > Ler.
A autorização solicita somente:

```text
https://www.googleapis.com/auth/calendar.events.readonly
```

Quando precisar autorizar novamente:

```powershell
python .\trazer-agenda-de-setembro.py --autorizar --ano 2026
```

O script encontra `client_secret*.json`, abre o login e salva o token. Se houver
mais de um arquivo, informe `--client-secret .\nome-do-arquivo.json`. Tokens antigos
com escopos mais amplos são aceitos; o programa não revoga autorizações existentes.
Renovações de tokens expirados não acrescentam permissões.

Para service account com delegação de domínio:

```powershell
python .\trazer-agenda-de-setembro.py --ano 2026 --conta-servico .\conta-servico.json --admin gestor@suaempresa.com
```

O cliente da service account precisa ter o escopo Calendar autorizado na delegação
de domínio. A conta indicada em `--admin` deve ter acesso à sala. O Calendar representa
somente essa conta e consulta o ID da sala; não representa todos os funcionários
nem tenta autenticar como o recurso. O JSON OAuth não é uma chave de service account.

## Arquivos para a aplicação

Cada execução gera, em `exportacoes` (ou na pasta informada em `--saida`):

- `agenda-setembro-2026-<data-hora>.json`: dados dos eventos selecionados e análise.
- `agenda-setembro-2026-<data-hora>-salas.md`: relatório legível dos eventos da sala.

O terminal e o Markdown mostram nome, data, início/fim, criador, organizador,
participantes, respostas e situação da reserva. O Markdown inclui descrição/pauta.
No VS Code, use `Ctrl+Shift+V` para visualizar o relatório.

O JSON final usa o formato `eventos_das_salas_v2`:

- `agendas`: somente as agendas consultadas com eventos selecionados; salas com
  erro ou sem eventos também mantêm seu estado para diagnóstico.
- `gestao_sala.eventos_na_sala`: uma entrada por ocorrência, com horários, participantes,
  criador, organizador, descrição, dados da sala e avisos.
- `emails_vinculados`: e-mails únicos dos criadores, organizadores e convidados desses
  eventos. Recursos não entram nessa lista.
- `coleta_finalizada` e `completo_para_salas_selecionadas`: indicam conclusão e ausência
  de erros ou restrições de acesso.

O catálogo de contas da organização e os eventos fora do filtro não são salvos no
JSON final. Durante a coleta, o JSON salva progresso apenas das salas consultadas.
As exportações antigas permanecem com seu conteúdo original.

## Regras e limites

- Consulta de 01/09 às 00:00 até 01/10 às 00:00, com limite final exclusivo. Inclui
  eventos que atravessam os limites do mês e todas as ocorrências retornadas.
- Um evento obtido diretamente da agenda da sala pertence a essa agenda mesmo sem
  o nome "reunião", local preenchido ou lista de convidados visível.
- Cancelamentos, tipos como ausência/foco e convites recusados pelo recurso ficam
  fora do filtro. Não há alterações ou exclusões no Google.
- Uma sala pendente de aceite não tem bloqueio confirmado. Eventos provisórios,
  marcados como disponíveis (`transparent`) ou sem intervalo válido também não.
- Cópias da mesma reunião são agrupadas pelo `iCalUID`; recorrências usam também
  `originalStartTime`, mantendo ocorrências distintas, inclusive remarcadas.
  Sem esses identificadores, o relatório informa as limitações da deduplicação.
- Os convidados são contados uma vez por e-mail, sem salas e outros recursos.
  Acompanhantes declarados são incluídos nos totais e detalhados separadamente.
  Criador e organizador só entram na contagem se também forem convidados.
- Aceites, recusas, talvez e sem resposta são separados. Aceitar o convite não
  comprova presença física: `pessoas_presenciais` permanece desconhecido.
  Listas ausentes, restritas ou omitidas deixam o total desconhecido.
- Um link de conferência não exclui um evento presencial ou híbrido. Descrição e
  modalidade refletem os dados disponíveis, sem inventar a forma de participação.
- Permissões `reader`, `freeBusyReader` e `writerWithoutPrivateAccess` podem ocultar
  detalhes privados. A coleta sinaliza `acesso_limitado`; HTTP 200 não garante
  todos os detalhes. Erros preservam as páginas recebidas anteriormente.
- Códigos de saída: 0 sem pendências, 1 para falha de configuração, 2 para erro ou
  acesso limitado em uma sala, 130 para interrupção. Falhas transitórias recebem
  até cinco tentativas.

## Atualização automática do painel

O site `painel-salas` executa o coletor com `--painel` a cada 15 segundos entre
consultas enquanto houver uma aba conectada. Você também pode testar uma coleta
única nesse formato:

```powershell
python .\trazer-agenda-de-setembro.py --ano 2026 --painel
```

Esse modo atualiza somente `exportacoes/agenda-setembro-2026-atual.json`, no mesmo
formato `eventos_das_salas_v2`, sem gerar Markdown ou arquivos datados. O arquivo
só é substituído atomicamente depois da coleta concluída. Qualquer erro em sala
ou página mantém o snapshot anterior. Uma coleta válida sem eventos substitui a
anterior, refletindo remoções e cancelamentos. Acesso limitado continua com aviso
e código 2; falha na coleta retorna 1. Não combine `--painel` com `--reprocessar`.

O painel recebe os resultados automaticamente; não é necessário executar o script
à mão ou recarregar a página. O período continua sendo setembro do ano selecionado.

## Reprocessar um arquivo existente

```powershell
python .\trazer-agenda-de-setembro.py --reprocessar ".\exportacoes\agenda-setembro-2026-20260922T175621433700Z.json"
```

Aceita os JSONs antigos com `usuarios` e os novos com `agendas`. Gera outro JSON
filtrado e um relatório da sala, sem modificar o arquivo de origem nem consultar
o Google. Na exportação antiga, só preserva os eventos vinculados à sala e as
agendas onde essas ocorrências apareceram. O alcance da coleta antiga continua
limitado ao que já foi exportado. Nesse modo, `--sala` filtra por nome/e-mail nos
campos disponíveis; o ano é o registrado no arquivo.

## Testes offline

```powershell
python -m unittest -v test_agenda_setembro.py
```

Os testes não leem credenciais nem chamam APIs reais.

## Referências oficiais

- [Recursos e salas: resourceEmail como calendarId](https://developers.google.com/workspace/calendar/api/concepts/domain)
- [Calendar: listar eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Campos dos eventos, recorrências e convidados](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Delegação de domínio](https://developers.google.com/identity/protocols/oauth2/service-account)
