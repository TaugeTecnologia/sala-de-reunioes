import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMeetings } from './agenda.js';

const now = '2026-09-24T12:00:00-03:00';
const time = hour => `2026-09-24T${hour}:00-03:00`;
const meeting = (nome, inicio, fim, extra = {}) => ({ nome, inicio, fim, bloqueio_confirmado: true, ...extra });

test('separa atuais e histórico, mantendo proximidade, ordem recente e todos os registros', () => {
  const live = Object.freeze(meeting('Em andamento', time('11:30'), time('12:30')));
  const next = Object.freeze(meeting('Próxima', time('13:00'), time('14:00')));
  const later = Object.freeze(meeting('Mais tarde', time('16:00'), time('17:00')));
  const recent = Object.freeze(meeting('Passada recente', time('10:00'), time('11:00')));
  const older = Object.freeze(meeting('Passada antiga', time('08:00'), time('09:00')));
  const input = Object.freeze([older, later, next, recent, live]);
  const original = structuredClone(input);

  const result = splitMeetings(input, now);
  assert.deepEqual(result, { atuais: [live, next, later], historico: [recent, older] });
  assert.deepEqual(input, original);
  assert.strictEqual(result.atuais[0], live);
  assert.strictEqual(result.historico[0], recent);
  assert.equal(result.atuais.length + result.historico.length, input.length);
});

test('move para histórico no instante do fim, mantendo futuras e em andamento em atuais', () => {
  const event = meeting('Reunião', time('11:00'), time('12:00'));
  for (const instant of [time('10:59'), time('11:00'), Date.parse(now) - 1]) {
    assert.deepEqual(splitMeetings([event], instant), { atuais: [event], historico: [] });
  }
  for (const instant of [now, Date.parse(now) + 1]) {
    assert.deepEqual(splitMeetings([event], instant), { atuais: [], historico: [event] });
  }
});

test('dia inteiro e reuniões que atravessam a meia-noite só encerram no fim em UTC-03', () => {
  const allDay = meeting('Dia inteiro', '2026-09-24', '2026-09-25', { dia_inteiro: true });
  const overnight = meeting('Noturna', '2026-09-24T23:00:00-03:00', '2026-09-25T01:00:00-03:00');
  assert.deepEqual(splitMeetings([allDay, overnight], '2026-09-25T02:59:59Z'), { atuais: [allDay, overnight], historico: [] });
  assert.deepEqual(splitMeetings([allDay, overnight], '2026-09-25T03:00:00Z'), { atuais: [overnight], historico: [allDay] });
  assert.deepEqual(splitMeetings([allDay, overnight], '2026-09-25T04:00:00Z'), { atuais: [], historico: [overnight, allDay] });
});

test('pendências são separadas pelo horário e ocorrências recorrentes não são descartadas', () => {
  const extra = { bloqueio_confirmado: false, ical_uid: 'reuniao-recorrente' };
  const events = Array.from({ length: 8 }, (_, index) => meeting(`Reunião ${index}`, time(`${10 + index}:00`), time(`${11 + index}:00`), extra));
  const groups = splitMeetings(events, now);
  assert.deepEqual(groups.atuais, events.slice(2));
  assert.deepEqual(groups.historico, [events[1], events[0]]);
  assert.equal(groups.atuais.length, 6);
  assert.equal(new Set([...groups.atuais, ...groups.historico]).size, events.length);
});

test('horários ausentes, invertidos e inválidos permanecem acessíveis sem presumir encerramento', () => {
  const invalid = [
    meeting('Fim ausente', time('08:00'), undefined),
    meeting('Início ausente', undefined, time('09:00')),
    meeting('Data inválida', time('08:00'), 'inválido'),
    meeting('Invertido', time('09:00'), time('08:00')),
    meeting('Duração zero', time('09:00'), time('09:00')),
  ];
  const next = meeting('Próxima', time('13:00'), time('14:00'));
  const input = [...invalid, next];
  assert.deepEqual(splitMeetings(input, now), { atuais: [next, ...invalid], historico: [] });
  assert.deepEqual(splitMeetings(input, 'inválido'), { atuais: input, historico: [] });
});

test('remarcação, remoção e lista vazia recalculam as abas sem manter histórico obsoleto', () => {
  const past = meeting('Reunião remarcada', time('08:00'), time('09:00'), { chave: ['mesma-reuniao'] });
  const changed = { ...past, inicio: time('14:00'), fim: time('15:00') };
  assert.deepEqual(splitMeetings([past], now), { atuais: [], historico: [past] });
  assert.deepEqual(splitMeetings([changed], now), { atuais: [changed], historico: [] });
  assert.deepEqual(splitMeetings([], now), { atuais: [], historico: [] });
});
