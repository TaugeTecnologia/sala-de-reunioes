import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRoomMeeting } from './agenda.js';

const room = { id: 'sala@example.com', status: 'ok' };
const now = Date.parse('2026-09-23T12:00:00Z');
const event = (id, start, end, extra = {}) => ({
  chave: [id], nome: id, inicio: start, fim: end, bloqueio_confirmado: true,
  salas: [{ email: room.id, resposta: 'accepted' }], ...extra,
});
const report = events => ({
  salas: [room], eventos: events,
  periodo: { inicio: '2026-09-01', fim: '2026-10-01' },
});

test('próxima reunião usa o início futuro mais próximo, sem mostrar a reunião em andamento', () => {
  const ongoing = event('Agora', '2026-09-23T08:00:00-03:00', '2026-09-23T10:00:00-03:00');
  const first = event('Primeira', '2026-09-23T10:00:00-03:00', '2026-09-23T11:00:00-03:00');
  const later = event('Depois', '2026-09-24T09:00:00-03:00', '2026-09-24T10:00:00-03:00');
  const data = report([later, ongoing, first, { ...first }]);
  assert.equal(nextRoomMeeting(data, now), first);
  assert.equal(nextRoomMeeting(data, Date.parse(first.inicio) - 1), first);
  assert.equal(nextRoomMeeting(data, Date.parse(first.inicio)), later);
  assert.equal(nextRoomMeeting(data, Date.parse(later.inicio)), null);
  assert.equal(data.eventos[0], later);
});

test('ignora cancelamentos, pendências, outras salas e intervalos inválidos ou fora do período', () => {
  const start = '2026-09-23T10:00:00-03:00', end = '2026-09-23T11:00:00-03:00';
  const data = report([
    event('Pendente', start, end, { bloqueio_confirmado: false }),
    event('Cancelado', start, end, { status: 'cancelled' }),
    event('Livre', start, end, { transparency: 'transparent' }),
    event('Outra sala', start, end, { salas: [{ email: 'outra@example.com', resposta: 'accepted' }] }),
    event('Sala recusou', start, end, { salas: [{ email: room.id, resposta: 'declined' }] }),
    event('Sem horário', start, null), event('Duração inválida', start, start),
    event('Outubro', '2026-10-01T09:00:00-03:00', '2026-10-01T10:00:00-03:00'),
  ]);
  assert.equal(nextRoomMeeting(data, now), null);
  assert.equal(nextRoomMeeting(report([]), now), null);
  assert.equal(nextRoomMeeting(undefined, now), null);
});

test('considera dia inteiro a partir da meia-noite local e acompanha edição ou remoção', () => {
  const wholeDay = event('Dia inteiro', '2026-09-24', '2026-09-25', { dia_inteiro: true, salas: [], agenda_copia_utilizada: room.id });
  assert.equal(nextRoomMeeting(report([wholeDay]), Date.parse('2026-09-24T02:59:59Z')), wholeDay);
  assert.equal(nextRoomMeeting(report([wholeDay]), Date.parse('2026-09-24T03:00:00Z')), null);
  const moved = { ...wholeDay, inicio: '2026-09-23', fim: '2026-09-24' };
  assert.equal(nextRoomMeeting(report([moved]), now), null);
  assert.equal(nextRoomMeeting(report([]), now), null);
});
