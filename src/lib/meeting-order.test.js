import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMeetings } from './agenda.js';

const now = '2026-09-22T12:00:00-03:00';
const meeting = (nome, inicio, fim, overrides = {}) => ({
  nome,
  inicio,
  fim,
  bloqueio_confirmado: true,
  ...overrides,
});
const local = time => `2026-09-22T${time}:00-03:00`;
const names = events => events.map(event => event.nome);

test('ordena andamento, futuros e finalizados sem limitar, filtrar ou deduplicar reuniões', () => {
  const liveEarly = meeting('andamento anterior', local('10:00'), local('13:00'), { bloqueio_confirmado: false });
  const liveLate = meeting('andamento posterior', local('11:00'), local('14:00'));
  const futureEarly = meeting('próxima pendente', local('13:00'), local('14:00'), { bloqueio_confirmado: false });
  const futureLate = meeting('próxima distante', local('15:00'), local('16:00'));
  const pastRecent = meeting('finalizada recente', local('10:00'), local('11:00'), { bloqueio_confirmado: false });
  const pastOld = meeting('finalizada antiga', local('08:00'), local('09:00'));
  const duplicate = { ...futureEarly, chave: ['ical', 'mesma-ocorrencia'] };
  const copy = { ...duplicate };
  const input = [pastOld, futureLate, liveLate, pastRecent, duplicate, liveEarly, copy, futureEarly, futureEarly];

  const result = orderMeetings(input, now);
  const expected = [liveEarly, liveLate, duplicate, copy, futureEarly, futureEarly, futureLate, pastRecent, pastOld];

  assert.equal(result.length, input.length);
  assert.deepEqual(result, expected);
  result.forEach((event, index) => assert.strictEqual(event, expected[index]));
});

test('retorna outro array e preserva a entrada e os objetos congelados', () => {
  const late = Object.freeze(meeting('posterior', local('15:00'), local('16:00')));
  const early = Object.freeze(meeting('anterior', local('13:00'), local('14:00')));
  const input = Object.freeze([late, early]);
  const snapshot = structuredClone(input);

  const result = orderMeetings(input, new Date(now));

  assert.notStrictEqual(result, input);
  assert.deepEqual(input, snapshot);
  assert.strictEqual(input[0], late);
  assert.strictEqual(input[1], early);
  assert.strictEqual(result[0], early);
  assert.strictEqual(result[1], late);
  const empty = Object.freeze([]);
  const emptyResult = orderMeetings(empty, now);
  assert.deepEqual(emptyResult, []);
  assert.notStrictEqual(emptyResult, empty);
});

test('início é inclusivo e fim é exclusivo, inclusive na precisão de milissegundos', () => {
  const input = [
    meeting('terminando agora', local('10:00'), now),
    meeting('começando depois', '2026-09-22T12:00:00.001-03:00', local('13:00')),
    meeting('começando agora', now, local('13:00')),
    meeting('terminando depois', local('11:00'), '2026-09-22T12:00:00.001-03:00'),
    meeting('terminado antes', local('10:00'), '2026-09-22T11:59:59.999-03:00'),
  ];

  assert.deepEqual(names(orderMeetings(input, Date.parse(now))), [
    'terminando depois', 'começando agora', 'começando depois', 'terminando agora', 'terminado antes',
  ]);
});

test('datas de dia inteiro começam à meia-noite UTC-03 e terminam no fim exclusivo', () => {
  const wholeDay = meeting('dia inteiro', '2026-09-22', '2026-09-23', { dia_inteiro: true });
  const previous = meeting('madrugada anterior', '2026-09-22T01:00:00Z', '2026-09-22T02:00:00Z');
  const next = meeting('dia seguinte', '2026-09-23', '2026-09-24', { dia_inteiro: true });
  const input = [next, wholeDay, previous];

  assert.deepEqual(names(orderMeetings(input, '2026-09-22T00:00:00Z')), [
    'madrugada anterior', 'dia inteiro', 'dia seguinte',
  ]);
  assert.deepEqual(names(orderMeetings(input, '2026-09-22T03:00:00Z')), [
    'dia inteiro', 'dia seguinte', 'madrugada anterior',
  ]);
  assert.deepEqual(names(orderMeetings(input, '2026-09-23')), [
    'dia seguinte', 'dia inteiro', 'madrugada anterior',
  ]);
});

test('compara instantes com offsets diferentes e interpreta horário sem offset em UTC-03', () => {
  const input = [
    meeting('futuro sem offset', '2026-09-22T12:30:00', '2026-09-22T13:30:00'),
    meeting('futuro UTC', '2026-09-22T15:15:00Z', '2026-09-22T16:15:00Z'),
    meeting('andamento offset positivo', '2026-09-22T16:30:00+02:00', '2026-09-22T17:30:00+02:00'),
    meeting('finalizado offset negativo', '2026-09-22T08:00:00-05:00', '2026-09-22T09:00:00-05:00'),
  ];

  assert.deepEqual(names(orderMeetings(input, '2026-09-22T15:00:00Z')), [
    'andamento offset positivo', 'futuro UTC', 'futuro sem offset', 'finalizado offset negativo',
  ]);
});

test('intervalos inválidos ou incompletos ficam no final na ordem original', () => {
  const invalid = [
    meeting('início ausente', undefined, local('14:00')),
    meeting('fim nulo', local('09:00'), null),
    meeting('início vazio', '', local('14:00')),
    meeting('fim inválido', local('09:00'), 'não é uma data'),
    meeting('início inválido', new Date(NaN), local('14:00')),
    meeting('duração zero', local('13:00'), local('13:00')),
    meeting('intervalo invertido', local('14:00'), local('13:00')),
    meeting('início infinito', Infinity, local('14:00')),
  ];
  const ended = meeting('finalizado válido', local('08:00'), local('09:00'));
  const future = meeting('futuro válido', local('14:00'), local('15:00'));
  const input = [invalid[0], ended, ...invalid.slice(1, 4), future, ...invalid.slice(4)];

  const result = orderMeetings(input, now);

  assert.deepEqual(result, [future, ended, ...invalid]);
  invalid.forEach((event, index) => assert.strictEqual(result[index + 2], event));
});

test('finalizados usam fim decrescente e depois início decrescente, com desempates estáveis', () => {
  const input = [
    meeting('finalizado início antigo', local('08:00'), local('11:00')),
    meeting('futuro empate A', local('14:00'), local('15:00')),
    meeting('andamento empate A', local('11:00'), local('13:00')),
    meeting('finalizado empate A', local('09:00'), local('11:00')),
    meeting('futuro empate B', local('14:00'), local('15:00')),
    meeting('finalizado empate B', local('09:00'), local('11:00')),
    meeting('andamento empate B', local('11:00'), local('13:00')),
    meeting('finalizado fim antigo', local('09:30'), local('10:00')),
  ];

  assert.deepEqual(names(orderMeetings(input, now)), [
    'andamento empate A', 'andamento empate B', 'futuro empate A', 'futuro empate B',
    'finalizado empate A', 'finalizado empate B', 'finalizado início antigo', 'finalizado fim antigo',
  ]);
});
