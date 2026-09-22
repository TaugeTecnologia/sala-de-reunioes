import { dataLocal } from '../utils/reservas';

// Cada sala é um objeto independente. IDs conectam salas e reservas.
export const salas = [
  { id: 'diretoria', nome: 'Sala Diretoria', descricao: 'Espaço para decisões e apresentações.', capacidade: 10, localizacao: '1º andar', recursos: ['TV', 'Videoconferência', 'Quadro'], ativa: true },
  { id: 'criativa', nome: 'Sala Criativa', descricao: 'Ideias, planejamento e trabalho em equipe.', capacidade: 6, localizacao: '2º andar', recursos: ['Quadro', 'TV'], ativa: true },
  { id: 'foco', nome: 'Sala Foco', descricao: 'Conversas rápidas em um ambiente reservado.', capacidade: 4, localizacao: '2º andar', recursos: ['Monitor'], ativa: true },
  { id: 'auditorio', nome: 'Auditório', descricao: 'Encontros e apresentações para grandes grupos.', capacidade: 30, localizacao: 'Térreo', recursos: ['Projetor', 'Microfone'], ativa: false },
];

export function criarReservasIniciais() {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  return [
    { id: 'exemplo-1', salaId: 'diretoria', titulo: 'Planejamento da equipe', data: dataLocal(), inicio: '09:00', fim: '10:00', responsavel: 'Marina Costa' },
    { id: 'exemplo-2', salaId: 'criativa', titulo: 'Oficina de ideias', data: dataLocal(), inicio: '14:00', fim: '15:30', responsavel: 'Pedro Lima' },
    { id: 'exemplo-3', salaId: 'foco', titulo: 'Alinhamento do projeto', data: dataLocal(amanha), inicio: '10:00', fim: '11:00', responsavel: 'Marina Costa' },
  ];
}
