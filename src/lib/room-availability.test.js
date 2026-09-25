import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAvailability } from './agenda.js';
import { watchClock } from './clock.js';

const roomId = 'sala@resource.calendar.google.com';
const start = Date.parse('2026-09-23T12:00:00Z');
const end = start + 3_600_000;
const reservation = (changes = {}) => ({
  chave: ['evento', 'um'], inicio: new Date(start).toISOString(), fim: new Date(end).toISOString(),
  bloqueio_confirmado: true, salas: [{ email: roomId, resposta: 'accepted' }], ...changes,
});
const report = (events, now = start) => ({
  geradoEm: new Date(now).toISOString(),
  periodo: { inicio: '2026-09-01T00:00:00-03:00', fim: '2026-10-01T00:00:00-03:00' },
  salas: [{ id: roomId, status: 'acesso_limitado' }], eventos: events,
});

test('muda Livre/Ocupado no segundo de início e de fim sem precisar de nova exportação', () => {
  const first = report([reservation()], start - 1000);
  assert.equal(roomAvailability(first, start - 1000).label, 'Livre');
  assert.equal(roomAvailability(first, start).label, 'Ocupado');
  assert.equal(roomAvailability(first, start + 1000).label, 'Ocupado');
  const last = report([reservation()], end - 1000);
  assert.equal(roomAvailability(last, end - 1000).label, 'Ocupado');
  assert.equal(roomAvailability(last, end).label, 'Livre');
});

test('sobreposições, cópias e reservas consecutivas não geram intervalo livre falso', () => {
  const events = [reservation(), reservation(), reservation({ chave: ['outro'], inicio: new Date(end).toISOString(), fim: new Date(end + 1800000).toISOString() })];
  assert.equal(roomAvailability(report(events, end), end).label, 'Ocupado');
  events.push(reservation({ chave: ['sobreposta'], fim: new Date(end + 3600000).toISOString() }));
  assert.equal(roomAvailability(report(events, end + 1800000), end + 1800000).label, 'Ocupado');
});

test('considera somente bloqueios confirmados da sala acompanhada', () => {
  const ignored = [
    reservation({ bloqueio_confirmado: false }),
    reservation({ chave: ['cancelado'], status: 'cancelled' }),
    reservation({ chave: ['livre'], transparency: 'transparent' }),
    reservation({ chave: ['outra'], salas: [{ email: 'outra@resource.calendar.google.com', resposta: 'accepted' }] }),
    reservation({ chave: ['recusado'], salas: [{ email: roomId, resposta: 'declined' }] }),
    reservation({ chave: ['sem-aceite'], salas: [{ email: roomId, resposta: 'needsAction' }] }),
  ];
  assert.equal(roomAvailability(report(ignored), start).label, 'Livre');
  const direct = reservation({ salas: [], agenda_copia_utilizada: roomId });
  assert.equal(roomAvailability(report([direct]), start).label, 'Ocupado');
});

test('reconhece meia-noite, passagem de dia, UTC e fim exclusivo do dia inteiro', () => {
  const time = Date.parse('2026-09-23T03:00:00Z');
  const overnight = reservation({ inicio: '2026-09-22T23:00:00-03:00', fim: '2026-09-23T01:00:00-03:00' });
  assert.equal(roomAvailability(report([overnight], time), time).label, 'Ocupado');
  const wholeDay = reservation({ inicio: '2026-09-23', fim: '2026-09-24', dia_inteiro: true });
  assert.equal(roomAvailability(report([wholeDay], time), time).label, 'Ocupado');
  const nextDay = time + 86400000;
  assert.equal(roomAvailability(report([wholeDay], nextDay), nextDay).label, 'Livre');
});

test('não inventa Livre quando faltam dados atuais, conexão, permissão ou cobertura do mês', () => {
  const data = report([]);
  assert.equal(roomAvailability(data, start + 29999).label, 'Livre');
  assert.equal(roomAvailability(data, start + 30000).occupied, null);
  assert.equal(roomAvailability(data, start, { connection: 'reconectando' }).occupied, null);
  assert.equal(roomAvailability(data, start, { queryState: { estado: 'erro' } }).occupied, null);
  assert.equal(roomAvailability({ ...data, salas: [{ id: roomId, status: 'erro' }] }, start).occupied, null);
  assert.equal(roomAvailability({ ...data, geradoEm: null }, start).occupied, null);
  assert.equal(roomAvailability({ ...data, geradoEm: new Date(start + 6000).toISOString() }, start).occupied, null);
  assert.equal(roomAvailability(data, Date.parse(data.periodo.fim)).occupied, null);
  assert.equal(roomAvailability(data, Date.parse('2027-09-23T12:00:00Z')).occupied, null);
  assert.equal(roomAvailability(report([reservation({ fim: null })]), start).occupied, null);
});

test('criação, remarcação e cancelamento recebidos mudam imediatamente a disponibilidade', () => {
  assert.equal(roomAvailability(report([]), start).label, 'Livre');
  assert.equal(roomAvailability(report([reservation()]), start).label, 'Ocupado');
  const moved = reservation({ inicio: new Date(end).toISOString(), fim: new Date(end + 3600000).toISOString() });
  assert.equal(roomAvailability(report([moved]), start).label, 'Livre');
  assert.equal(roomAvailability(report([]), start).label, 'Livre');
});

test('relógio segue segundos reais, recupera aba suspensa e limpa todos os listeners', () => {
  let instant = start - 250;
  let sequence = 0;
  const timers = new Map();
  const page = new EventTarget(), windowTarget = new EventTarget();
  const observed = [];
  const data = report([reservation()], start - 1000);
  const stop = watchClock(value => observed.push({ value, label: roomAvailability(data, value).label }), {
    now: () => instant,
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id), page, windowTarget,
  });
  assert.equal(observed[0].label, 'Livre');
  const first = [...timers.values()][0];
  assert.equal(first.delay, 250);
  instant = start;
  first.callback();
  assert.equal(observed.at(-1).label, 'Ocupado');
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 1000);
  instant = end;
  data.geradoEm = new Date(end).toISOString();
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(observed.at(-1).label, 'Livre');
  instant += 4200;
  windowTarget.dispatchEvent(new Event('focus'));
  assert.equal(observed.at(-1).value, instant);
  assert.equal([...timers.values()][0].delay, 800);
  const count = observed.length;
  const delayedCallback = [...timers.values()][0].callback;
  stop();
  assert.equal(timers.size, 0);
  page.dispatchEvent(new Event('visibilitychange'));
  windowTarget.dispatchEvent(new Event('focus'));
  delayedCallback();
  assert.equal(observed.length, count);
});
