# Reserva de salas — primeiros passos

Uma base frontend para aprender React com JavaScript, HTML e CSS. O projeto contém Login demonstrativo, Dashboard, Salas, Agenda e formulário de Reserva. Não contém backend, banco de dados, autenticação real ou integrações.

## 1. Preparar e executar

Você precisa do Node.js 22.12 ou superior e de um editor, como o VS Code. O Node executa as ferramentas do projeto; o npm, instalado junto com ele, baixa os pacotes necessários.

1. Abra a pasta `reserva-salas` no editor. É a pasta que contém este README e o `package.json`.
2. Abra um terminal nessa pasta. No VS Code, use **Terminal → Novo Terminal**.
3. Confira as ferramentas:

```powershell
node --version
npm --version
```

4. Na primeira execução, instale as dependências:

```powershell
npm install
```

5. Inicie o site:

```powershell
npm run dev
```

6. Abra no navegador o endereço `Local` mostrado pelo terminal, normalmente `http://127.0.0.1:5173`. Deixe o terminal aberto. Para encerrar, pressione **Ctrl+C**.

Se o PowerShell bloquear `npm.ps1`, use `npm.cmd install` e `npm.cmd run dev`, sem alterar a política de segurança do computador.

O Vite prepara os arquivos para o navegador e atualiza a página quando você salva uma alteração. Ele é apenas uma ferramenta de desenvolvimento; não implementamos um backend de reservas.

## 2. Entender as pastas

```text
reserva-salas/
├── public/favicon.svg          Ícone da aba do navegador
├── src/
│   ├── components/             Partes reutilizadas nas páginas
│   │   ├── Layout.jsx          Menu e área principal
│   │   └── ListaReservas.jsx   Lista usada no dashboard e na agenda
│   ├── context/
│   │   └── ReservasContext.jsx Estado compartilhado entre páginas
│   ├── data/mock.js            Salas e reservas fictícias
│   ├── pages/                 Uma tela por arquivo
│   ├── styles/global.css      Cores, espaçamentos e adaptação ao celular
│   ├── utils/                 Funções de datas e validação
│   ├── App.jsx                Mapa de rotas
│   └── main.jsx               Inicialização do React
├── index.html                 Documento HTML que recebe o React
├── package.json               Dependências e comandos
└── package-lock.json          Versões exatas instaladas
```

Um **componente** é uma função que devolve um pedaço da interface. Um arquivo `.jsx` continua sendo JavaScript: JSX permite escrever marcação semelhante a HTML dentro dele. Não usamos TypeScript.

**Props** são informações passadas a um componente: `ListaReservas` recebe quais reservas deve mostrar. **Estado**, criado com `useState`, guarda informações que mudam e faz a tela se atualizar. O **Context** compartilha esse estado entre as páginas, evitando passar os mesmos dados por muitos componentes.

## 3. Entender as páginas e rotas

Uma rota associa um endereço a uma página. O React Router faz essa navegação sem recarregar o documento inteiro.

| Endereço | Página | O que experimentar |
|---|---|---|
| `/login` | Login | Digite um nome de exemplo e entre. Não há senha. |
| `/dashboard` | Visão geral | Veja salas ativas, reservas de hoje e capacidade total. |
| `/salas` | Salas | Confira capacidade e recursos. Clique em Reservar sala. |
| `/reserva` | Nova reserva | Escolha sala, título, data e horários. |
| `/agenda` | Agenda | Confira reservas e filtre por sala ou data. |

Fluxo principal:

```text
Login → Dashboard → Salas → Reserva → Agenda
                      ↘ menu permite acessar todas as telas
```

Ao clicar em reservar em uma sala, o endereço inclui `?sala=diretoria`, por exemplo. A página de reserva lê esse valor e já seleciona a sala. Ao confirmar um formulário válido, a reserva aparece na Agenda e, se for para hoje, no Dashboard.

A entrada é apenas demonstrativa. A barreira de navegação em `App.jsx` não oferece proteção de dados. Um administrador futuramente usará essas mesmas páginas; permissões administrativas ainda não estão implementadas.

## 4. Entender os dados fictícios

Abra `src/data/mock.js`. O array `salas` contém objetos como:

```javascript
{
  id: 'foco',
  nome: 'Sala Foco',
  descricao: 'Conversas rápidas em um ambiente reservado.',
  capacidade: 4,
  localizacao: '2º andar',
  recursos: ['Monitor'],
  ativa: true
}
```

O `id` identifica a sala. Cada reserva guarda o `salaId` para indicar a qual sala pertence. Os IDs precisam ser únicos. `ativa: false` impede o agendamento da sala; estar ativa não significa estar livre em qualquer horário.

Os exemplos de reuniões são criados para hoje e amanhã. As alterações ficam na memória do React: navegar pelo menu preserva os dados; recarregar a página reinicia as reservas e pede que você entre novamente. Nada é enviado ou salvo em serviços externos.

## 5. Entender a criação de uma reserva

1. Os campos atualizam o estado `dados` em `Reserva.jsx`.
2. O envio chama `criarReserva`, disponível no Context.
3. `validarReserva` verifica sala ativa, campos, horário futuro, duração e conflitos.
4. A reserva válida é adicionada ao array em memória.
5. O navegador muda para a Agenda, que lê o array atualizado.

Dois horários conflitam se o início novo ocorre antes do fim existente **e** o fim novo ocorre depois do início existente, para a mesma sala e data. Uma reunião das 10h às 11h permite outra começando às 11h. Nesta etapa, as reuniões começam e terminam no mesmo dia e usam o horário local do navegador.

Essa validação é uma simulação para um único navegador. Ela não coordena reservas entre funcionários ou dispositivos.

## 6. Praticar em pequenas etapas

1. Execute o site, entre com um nome e navegue pelas quatro telas internas.
2. Altere o nome da Sala Foco em `mock.js`, salve e observe a tela Salas.
3. Altere `--blue` em `global.css` para experimentar a cor principal.
4. Crie uma reserva para amanhã e confira a Agenda.
5. Tente criar outra reserva na mesma sala e horário: deve aparecer um erro.
6. Reserve outra sala no mesmo horário: deve funcionar.
7. Recarregue a página e veja os exemplos originais voltarem.

Ao adicionar uma nova sala, copie um objeto existente, use um ID novo e mantenha a vírgula entre os objetos do array. Comece com essas alterações pequenas antes de criar novas telas.

## 7. Verificar o projeto

```powershell
npm test
npm run build
```

Os testes verificam as regras de conflito e os principais campos inválidos. O build verifica a montagem do frontend e gera `dist/`. Você não precisa editar essa pasta. Para conferir essa versão localmente, execute `npm run preview` e abra o endereço informado.

Mantenha `package-lock.json` junto com o código. Em outra máquina, `npm ci` instala exatamente as versões desse arquivo. Não copie `node_modules`: essa pasta é recriada pelo npm.

O próximo exercício dentro do frontend pode ser melhorar o formulário ou criar uma tela de detalhes de sala. Backend, banco de dados, Google Calendar e n8n ficam para uma etapa posterior.
