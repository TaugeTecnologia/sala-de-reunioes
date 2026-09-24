import test from 'node:test';
import assert from 'node:assert/strict';
import { todaysMeetings, splitMeetings } from './agenda.js';

const meeting = (nome, inicio, fim, extra = {}) => Object.freeze({ nome, inicio, fim, ...extra });

test('lista diária mantém só reuniões que ocupam hoje em Brasília, inclusive dia inteiro e passagem da meia-noite', () => {
  const events = Object.freeze([
    meeting('Ontem', '2026-09-23T10:00:00-03:00', '2026-09-23T11:00:00-03:00'),
    meeting('Termina à meia-noite', '2026-09-23T23:00:00-03:00', '2026-09-24T00:00:00-03:00'),
    meeting('Atravessa meia-noite', '2026-09-23T23:30:00-03:00', '2026-09-24T00:30:00-03:00'),
    meeting('Hoje', '2026-09-24T09:00:00-03:00', '2026-09-24T10:00:00-03:00'),
    meeting('Dia inteiro', '2026-09-24', '2026-09-25', { dia_inteiro: true }),
    meeting('Amanhã', '2026-09-25T09:00:00-03:00', '2026-09-25T10:00:00-03:00'),
    meeting('UTC, ainda ontem local', '2026-09-24T01:00:00Z', '2026-09-24T02:00:00Z'),
    meeting('Pendente hoje', '2026-09-24T15:00:00-03:00', '2026-09-24T16:00:00-03:00', { bloqueio_confirmado: false }),
    meeting('Sem horário', '', ''),
  ]);
  const before = structuredClone(events);
  assert.deepEqual(todaysMeetings(events, '2026-09-24T13:45:00-03:00'), [events[2], events[3], events[4], events[7]]);
  assert.deepEqual(events, before);
});

test('troca de dia ocorre à meia-noite de Brasília, sem depender da data UTC nem de nova coleta', () => {
  const events = [
    meeting('Quinta', '2026-09-24T09:00:00-03:00', '2026-09-24T10:00:00-03:00'),
    meeting('Sexta', '2026-09-25T09:00:00-03:00', '2026-09-25T10:00:00-03:00'),
  ];
  assert.deepEqual(todaysMeetings(events, '2026-09-25T02:59:59.999Z'), [events[0]]);
  assert.deepEqual(todaysMeetings(events, '2026-09-25T03:00:00.000Z'), [events[1]]);
  assert.deepEqual(todaysMeetings(events, '2026-09-26T12:00:00-03:00'), []);
  assert.deepEqual(todaysMeetings(events, 'inválido'), []);
});

test('Atuais e Histórico contêm apenas reuniões de hoje e mudam no instante do término', () => {
  const past = meeting('Encerrada hoje', '2026-09-24T08:00:00-03:00', '2026-09-24T09:00:00-03:00');
  const live = meeting('Em andamento', '2026-09-24T13:00:00-03:00', '2026-09-24T14:00:00-03:00');
  const future = meeting('Próxima hoje', '2026-09-24T15:00:00-03:00', '2026-09-24T16:00:00-03:00');
  const tomorrow = meeting('Amanhã', '2026-09-25T08:00:00-03:00', '2026-09-25T09:00:00-03:00');
  const yesterday = meeting('Ontem', '2026-09-23T08:00:00-03:00', '2026-09-23T09:00:00-03:00');
  const events = [tomorrow, past, future, yesterday, live];
  const now = '2026-09-24T13:45:00-03:00';
  assert.deepEqual(splitMeetings(todaysMeetings(events, now), now), { atuais: [live, future], historico: [past] });
  const end = live.fim;
  assert.deepEqual(splitMeetings(todaysMeetings(events, end), end), { atuais: [future], historico: [live, past] });
});
