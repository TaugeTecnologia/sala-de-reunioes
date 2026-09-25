import test from 'node:test';
import assert from 'node:assert/strict';
import { eventStatus, filterEvents, formatDate, formatDuration, formatTime, metrics, monthDays } from './agenda.js';

const room = { nome: 'Sala de reuniões', email: 'sala@resource.calendar.google.com', resposta: 'accepted' };
const event = (overrides = {}) => ({
  chave: ['ical', 'reuniao-1'],
  nome: 'Reunião de planejamento',
  inicio: '2026-09-22T09:00:00-03:00',
  fim: '2026-09-22T10:00:00-03:00',
  bloqueio_confirmado: true,
  criador: { displayName: 'José Costa', email: 'jose@example.com' },
  organizador: { displayName: 'Ana Silva', email: 'ana@example.com' },
  salas: [room],
  participantes: { lista: [{ nome: 'Mário', email: 'mario@example.com' }] },
  ...overrides,
});

test('horários e datas são exibidos em UTC-03 independentemente do fuso do computador', () => {
  assert.equal(formatDate('2026-09-22T01:30:00Z'), '21/09/2026');
  assert.equal(formatTime('2026-09-22T01:30:00Z'), '22:30');
  assert.equal(formatDate('2026-09-22'), '22/09/2026');
  assert.equal(formatTime('2026-09-22T09:00:00'), '09:00');
  assert.equal(formatTime('2026-09-22T03:00:00Z'), '00:00');
  assert.equal(formatDate(null), '—');
  assert.equal(formatTime('inválido'), '—');
});

test('duração trata zero, fração, horas e valores ausentes sem inventar ocupação', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(90), '1 h 30 min');
  assert.equal(formatDuration(120), '2 h');
  assert.equal(formatDuration(1.5), '2 min');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(-1), '—');
});

test('situação do evento usa início inclusivo, fim exclusivo e indica bloqueio não confirmado', () => {
  assert.equal(eventStatus(event(), new Date('2026-09-22T11:59:59Z')).label, 'Previsto');
  assert.equal(eventStatus(event(), new Date('2026-09-22T12:00:00Z')).label, 'Em andamento');
  assert.equal(eventStatus(event(), new Date('2026-09-22T13:00:00Z')).label, 'Finalizado');
  assert.equal(eventStatus(event({ bloqueio_confirmado: false }), new Date('2026-09-22T12:30:00Z')).label, 'Reserva pendente');
  assert.equal(eventStatus(event({ fim: null })).label, 'Horário indisponível');
});

test('busca combina termos sem acentos no título, criador, organizador e convidados', () => {
  const events = [event()];
  assert.equal(filterEvents(events, { busca: 'reuniao jose' }).length, 1);
  assert.equal(filterEvents(events, { busca: 'ANA@EXAMPLE.COM' }).length, 1);
  assert.equal(filterEvents(events, { busca: 'mario' }).length, 1);
  assert.equal(filterEvents(events, { busca: 'cliente inexistente' }).length, 0);
});

test('filtro de dia inclui passagem da meia-noite e respeita fim exclusivo de eventos de dia inteiro', () => {
  const overnight = event({ inicio: '2026-09-21T23:00:00-03:00', fim: '2026-09-22T01:00:00-03:00' });
  assert.equal(filterEvents([overnight], { data: '2026-09-22' }).length, 1);
  assert.equal(filterEvents([overnight], { data: '2026-09-23' }).length, 0);
  const wholeDay = event({ inicio: '2026-09-22', fim: '2026-09-24', dia_inteiro: true });
  assert.equal(filterEvents([wholeDay], { data: '2026-09-23' }).length, 1);
  assert.equal(filterEvents([wholeDay], { data: '2026-09-24' }).length, 0);
  assert.equal(filterEvents([wholeDay], { data: 'não é data' }).length, 0);
});

test('filtros de sala, confirmação e andamento podem ser combinados', () => {
  const events = [event(), event({ chave: ['ical', 'pendente'], bloqueio_confirmado: false })];
  const now = new Date('2026-09-22T12:30:00Z');
  assert.equal(filterEvents(events, { sala: room.email.toUpperCase(), status: 'confirmados' }, now).length, 1);
  assert.equal(filterEvents(events, { status: 'pendentes' }, now).length, 1);
  assert.equal(filterEvents(events, { status: 'em-andamento' }, now).length, 2);
  assert.equal(filterEvents(events, { sala: 'outra-sala' }, now).length, 0);
});

test('calendário inicia na segunda-feira, inclui as bordas e lida com ano bissexto', () => {
  const september = monthDays(2026, 9);
  assert.deepEqual(september[0], { key: '2026-08-31', date: '2026-08-31', day: 31, inMonth: false });
  assert.equal(september.at(-1).key, '2026-10-04');
  assert.equal(september.filter(cell => cell.inMonth).length, 30);
  assert.equal(monthDays(2024, 2).filter(cell => cell.inMonth).length, 29);
  assert.equal(monthDays(2026, 3).length, 42);
  assert.throws(() => monthDays(2026, 0), RangeError);
});

test('métricas limitam o período e unem sobreposições da mesma sala sem somar cópias', () => {
  const first = event({ inicio: '2026-08-31T23:30:00-03:00', fim: '2026-09-01T01:00:00-03:00' });
  const second = event({ chave: ['ical', 'outra'], inicio: '2026-09-01T00:30:00-03:00', fim: '2026-09-01T02:00:00-03:00' });
  const result = metrics([first, { ...first }, second], { inicio: '2026-09-01', fim: '2026-10-01' });
  assert.deepEqual(result, { eventos: 2, totalMinutos: 120, participantesUnicos: 1, confirmados: 2 });
});

test('métricas somam minutos por sala e não atribuem bloqueio à sala que recusou', () => {
  const accepted = { nome: 'Outra sala', email: 'outra@resource.calendar.google.com', resposta: 'accepted' };
  const result = metrics([
    event(),
    event({ chave: ['ical', 'outra'], salas: [accepted, { ...room, resposta: 'declined' }] }),
  ]);
  assert.equal(result.totalMinutos, 120);
  assert.equal(result.eventos, 2);
});

test('convites únicos não somam recursos, convidados adicionais anônimos ou e-mails repetidos', () => {
  const people = [
    { email: 'Mario@example.com', convidados_adicionais: 3 },
    { email: 'mario@example.com' },
    { email: room.email },
    { email: 'projetor@example.com', resource: true },
    { nome: 'Sem e-mail' },
  ];
  const result = metrics([event({ participantes: { lista: people } }), event({ chave: ['ical', 'outra'] })]);
  assert.equal(result.participantesUnicos, 1);
});

test('recorrências com mesmo iCalUID preservam ocorrências distintas e pendentes não somam tempo', () => {
  const result = metrics([
    event({ chave: ['recorrente', 'uid', '2026-09-22'], ical_uid: 'uid' }),
    event({ chave: ['recorrente', 'uid', '2026-09-23'], ical_uid: 'uid', inicio: '2026-09-23T09:00:00-03:00', fim: '2026-09-23T10:00:00-03:00' }),
    event({ chave: ['ical', 'pendente'], bloqueio_confirmado: false }),
  ]);
  assert.equal(result.eventos, 3);
  assert.equal(result.confirmados, 2);
  assert.equal(result.totalMinutos, 120);
});

test('eventos fora do período e intervalos inválidos não alteram métricas', () => {
  const result = metrics([
    event({ inicio: '2026-08-31T23:00:00-03:00', fim: '2026-09-01T00:00:00-03:00' }),
    event({ chave: ['ical', 'outubro'], inicio: '2026-10-01T00:00:00-03:00', fim: '2026-10-01T01:00:00-03:00' }),
    event({ chave: ['ical', 'invalido'], inicio: null }),
  ], { inicio: '2026-09-01', fim: '2026-10-01' });
  assert.deepEqual(result, { eventos: 0, totalMinutos: 0, participantesUnicos: 0, confirmados: 0 });
});
