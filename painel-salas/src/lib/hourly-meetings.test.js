import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyMeetings, formatTime, splitMeetings, todaysMeetings } from './agenda.js';

const now = '2026-09-24T13:45:00-03:00';
const meeting = (nome, inicio, fim, extra = {}) => Object.freeze({ nome, inicio, fim, ...extra });

test('horários de 00:00 a 23:00 aparecem mesmo sem reuniões', () => {
  const slots = hourlyMeetings([], now);
  assert.equal(slots.length, 24);
  assert.deepEqual(slots.map(slot => formatTime(slot.start)), Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`));
  assert.ok(slots.every(slot => slot.entries.length === 0 && slot.end - slot.start === 3_600_000));
  assert.equal(slots[0].start, Date.parse('2026-09-24T00:00:00-03:00'));
  assert.equal(slots.at(-1).end, Date.parse('2026-09-25T00:00:00-03:00'));
});

test('posiciona horários exatos, preserva reuniões simultâneas e marca continuações sem ocupar o fim exclusivo', () => {
  const first = meeting('Longa', '2026-09-24T13:30:00-03:00', '2026-09-24T15:00:00-03:00');
  const concurrent = meeting('Outra', '2026-09-24T13:45:00-03:00', '2026-09-24T14:05:00-03:00');
  const events = Object.freeze([concurrent, first]);
  const before = structuredClone(events);
  const slots = hourlyMeetings(events, now);
  assert.deepEqual(slots[13].entries, [{ event: first, continuation: false }, { event: concurrent, continuation: false }]);
  assert.deepEqual(slots[14].entries, [{ event: first, continuation: true }, { event: concurrent, continuation: true }]);
  assert.equal(slots[15].entries.length, 0);
  assert.equal(slots[13].entries[0].event.inicio, '2026-09-24T13:30:00-03:00');
  assert.deepEqual(events, before);
});

test('dia inteiro e passagem da meia-noite respeitam o dia local sem incluir reuniões de outro dia', () => {
  const overnight = meeting('Da noite anterior', '2026-09-23T23:00:00-03:00', '2026-09-24T01:00:00-03:00');
  const wholeDay = meeting('Dia inteiro', '2026-09-24', '2026-09-25', { dia_inteiro: true });
  const yesterday = meeting('Ontem', '2026-09-23T22:00:00-03:00', '2026-09-24T00:00:00-03:00');
  const tomorrow = meeting('Amanhã', '2026-09-25T00:00:00-03:00', '2026-09-25T01:00:00-03:00');
  const slots = hourlyMeetings([overnight, wholeDay, yesterday, tomorrow], now);
  assert.deepEqual(slots[0].entries, [{ event: overnight, continuation: true }, { event: wholeDay, continuation: false }]);
  assert.ok(slots.slice(1).every(slot => slot.entries.length === 1 && slot.entries[0].event === wholeDay && slot.entries[0].continuation));
});

test('faixas vazias não entram na contagem de reuniões e cada aba preserva seus eventos', () => {
  const past = meeting('Passada', '2026-09-24T09:00:00-03:00', '2026-09-24T10:30:00-03:00');
  const live = meeting('Atual', '2026-09-24T13:30:00-03:00', '2026-09-24T15:00:00-03:00');
  const groups = splitMeetings(todaysMeetings([past, live], now), now);
  assert.equal(groups.atuais.length, 1);
  assert.equal(groups.historico.length, 1);
  for (const events of Object.values(groups)) {
    const slots = hourlyMeetings(events, now);
    assert.equal(slots.length, 24);
    assert.deepEqual([...new Set(slots.flatMap(slot => slot.entries.map(entry => entry.event)))], events);
  }
});

test('virada do dia segue Brasília e entradas inválidas não criam horários de reunião', () => {
  assert.equal(hourlyMeetings([], '2026-09-25T02:59:59Z')[0].start, Date.parse('2026-09-24T00:00:00-03:00'));
  assert.equal(hourlyMeetings([], '2026-09-25T03:00:00Z')[0].start, Date.parse('2026-09-25T00:00:00-03:00'));
  const slots = hourlyMeetings([meeting('Inválida', '', ''), meeting('Invertida', '2026-09-24T14:00:00-03:00', '2026-09-24T13:00:00-03:00')], now);
  assert.ok(slots.every(slot => slot.entries.length === 0));
  assert.deepEqual(hourlyMeetings([], 'inválido'), []);
});

test('reuniões da outra aba não deixam a faixa parecer disponível', () => {
  const past = meeting('Passada', '2026-09-24T09:00:00-03:00', '2026-09-24T10:30:00-03:00');
  const live = meeting('Atual', '2026-09-24T13:30:00-03:00', '2026-09-24T15:00:00-03:00');
  const allEvents = [past, live];
  const groups = splitMeetings(allEvents, now);
  const currentSlots = hourlyMeetings(groups.atuais, now, allEvents);
  const historicSlots = hourlyMeetings(groups.historico, now, allEvents);
  assert.equal(currentSlots[9].entries.length, 0);
  assert.equal(currentSlots[9].hasAnyMeeting, true);
  assert.equal(currentSlots[10].hasAnyMeeting, true);
  assert.equal(historicSlots[13].entries.length, 0);
  assert.equal(historicSlots[13].hasAnyMeeting, true);
  for (const slots of [currentSlots, historicSlots]) {
    assert.equal(slots[11].hasAnyMeeting, false);
    assert.equal(slots[15].hasAnyMeeting, false);
  }
});

test('até uma reunião curta ou pendente impede indicar a hora inteira como vazia', () => {
  const short = meeting('Curta', '2026-09-24T13:59:00-03:00', '2026-09-24T14:00:00-03:00', { bloqueio_confirmado: false });
  const slots = hourlyMeetings([], now, [short]);
  assert.equal(slots[13].hasAnyMeeting, true);
  assert.equal(slots[14].hasAnyMeeting, false);
  assert.ok(hourlyMeetings([], now).every(slot => !slot.hasAnyMeeting));
});
