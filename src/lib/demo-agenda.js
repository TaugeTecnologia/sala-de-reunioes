import { mergeAgendas } from './periods.js';
import { timestamp } from './agenda.js';

const DAY_MS = 86_400_000;
const demoStartedAt = Date.now();
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
});
const room = { id: 'sala-demonstracao', nome: 'Sala de demonstração', status: 'ok' };
const guests = [
  { nome: 'Ana Exemplo', email: 'ana@example.com' },
  { nome: 'Bruno Exemplo', email: 'bruno@example.com' },
  { nome: 'Carla Exemplo', email: 'carla@example.com' },
];

function dateKey(value) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function event(id, title, start, end, people = guests) {
  return {
    chave: [id], id_evento: id, nome: title, inicio: start, fim: end,
    duracao_minutos: Math.round((timestamp(end) - timestamp(start)) / 60_000),
    criador: { nome: 'Organização Exemplo', email: 'organizacao@example.com' },
    organizador: { nome: 'Organização Exemplo', email: 'organizacao@example.com' },
    local: room.nome, salas: [{ email: room.id, nome: room.nome, resposta: 'accepted' }],
    participantes: { pessoas_convidadas: people.length, lista: people },
    descricao: 'Encontro fictício para testar a visualização da agenda no celular.',
    bloqueio_confirmado: true,
  };
}

function at(offset, hour, minute = 0) {
  const day = dateKey(new Date(demoStartedAt + offset * DAY_MS));
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`;
}

function demoEvents() {
  return [
    event('demo-1', 'Planejamento da equipe', at(0, 9), at(0, 9, 45)),
    event('demo-2', 'Revisão do projeto', at(0, 11), at(0, 12), guests.slice(0, 2)),
    event('demo-3', 'Apresentação de resultados', at(0, 14), at(0, 15)),
    event('demo-4', 'Alinhamento da semana', at(0, 16), at(0, 17), guests.slice(1)),
    event('demo-5', 'Próximos passos', at(1, 10), at(1, 11), guests.slice(0, 1)),
    event('demo-6', 'Reunião de acompanhamento', at(3, 15), at(3, 16)),
  ];
}

export function demoSnapshots(periods, generatedAt = new Date().toISOString()) {
  const events = demoEvents();
  return Object.fromEntries(periods.map(period => [period.key, {
    periodo: period, geradoEm: generatedAt, salas: [room],
    eventos: events.filter(item => timestamp(item.inicio) < timestamp(period.fim) && timestamp(item.fim) > timestamp(period.inicio)),
    avisos: [], coletaFinalizada: true,
  }]));
}

export function useDemoAgendaPeriods(periods) {
  return {
    data: mergeAgendas(periods, demoSnapshots(periods)),
    loading: false, error: '', liveState: null, liveConnection: 'conectado', retry: () => {},
  };
}
