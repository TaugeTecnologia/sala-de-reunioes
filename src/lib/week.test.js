import test from 'node:test';
import assert from 'node:assert/strict';
import { currentWeek, weeklyCalendar } from './week.js';

const now = '2026-09-24T13:45:00-03:00';
const period = { inicio: '2026-09-01T00:00:00-03:00', fim: '2026-10-01T00:00:00-03:00' };
const meeting = (nome, inicio, fim, extra = {}) => ({ nome, inicio, fim, ...extra });
const local = time => `2026-09-24T${time}:00-03:00`;
const thursday = events => weeklyCalendar(events, period, now)[3];

test('semana atual tem somente sete dias de segunda a domingo e identifica hoje', () => {
  const days = currentWeek(now);
  assert.deepEqual(days.map(day => day.date), [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
  ]);
  assert.deepEqual(days.filter(day => day.today).map(day => day.date), ['2026-09-24']);
  for (const day of days) assert.equal(day.end - day.start, 86_400_000);
});

test('virada de semana segue meia-noite UTC-03, incluindo mudança de mês e ano', () => {
  assert.equal(currentWeek('2026-09-28T02:59:59Z')[0].date, '2026-09-21');
  assert.equal(currentWeek('2026-09-28T03:00:00Z')[0].date, '2026-09-28');
  assert.equal(currentWeek('2026-09-28T03:00:00Z')[6].date, '2026-10-04');
  assert.equal(currentWeek('2027-01-01')[0].date, '2026-12-28');
  assert.equal(currentWeek('2027-01-01')[6].date, '2027-01-03');
  assert.throws(() => currentWeek('inválido'), RangeError);
});

test('posiciona minutos exatos em UTC-03, com offsets distintos e horário sem offset', () => {
  const events = [
    meeting('UTC', '2026-09-24T16:30:00Z', '2026-09-24T17:45:00Z'),
    meeting('Sem offset', '2026-09-24T15:15:00', '2026-09-24T16:00:00'),
  ];
  const day = thursday(events);
  assert.equal(day.currentMinute, 825);
  assert.deepEqual(day.timed.map(item => [item.startMinute, item.endMinute, item.column, item.columns]), [
    [810, 885, 0, 1], [915, 960, 0, 1],
  ]);
  assert.strictEqual(day.timed[0].event, events[0]);
});

test('reunião entre dois dias é dividida sem aparecer após seu fim exclusivo', () => {
  const overnight = meeting('Noturna', '2026-09-23T23:30:00-03:00', '2026-09-24T00:30:00-03:00');
  const midnight = meeting('Até meia-noite', '2026-09-24T23:00:00-03:00', '2026-09-25T00:00:00-03:00');
  const days = weeklyCalendar([overnight, midnight], period, now);
  assert.deepEqual(days.map(day => day.timed.length), [0, 0, 1, 2, 0, 0]);
  const wednesday = days[2].timed[0];
  const thursdayPart = days[3].timed[0];
  assert.deepEqual([wednesday.startMinute, wednesday.endMinute, wednesday.continuesAfter], [1410, 1440, true]);
  assert.deepEqual([thursdayPart.startMinute, thursdayPart.endMinute, thursdayPart.continuesBefore], [0, 30, true]);
  assert.equal(days[3].timed[1].continuesAfter, false);
});

test('eventos de dia inteiro ficam na faixa própria, sem ocupar horários nem duplicar o fim', () => {
  const allDay = meeting('Dois dias', '2026-09-23', '2026-09-25', { dia_inteiro: true });
  const days = weeklyCalendar([allDay], period, now);
  assert.deepEqual(days.map(day => day.allDay.length), [0, 0, 1, 1, 0, 0]);
  assert.ok(days.every(day => day.timed.length === 0));
  assert.strictEqual(days[2].allDay[0], allDay);
});

test('sobreposições usam colunas separadas e reservas consecutivas voltam à largura inteira', () => {
  const events = [
    meeting('A', local('09:00'), local('10:00')),
    meeting('B', local('09:30'), local('10:30')),
    meeting('C', local('10:00'), local('11:00')),
    meeting('D', local('11:00'), local('12:00')),
  ];
  const slots = thursday(events).timed;
  assert.deepEqual(slots.map(slot => [slot.column, slot.columns]), [[0, 2], [1, 2], [0, 2], [0, 1]]);
  for (const left of slots) for (const right of slots) {
    if (left === right || left.displayEndMinute <= right.startMinute || right.displayEndMinute <= left.startMinute) continue;
    assert.notEqual(left.column, right.column);
  }
});

test('reuniões curtas continuam selecionáveis sem cobrir outra reunião próxima', () => {
  const events = [
    meeting('Curta A', local('09:00'), local('09:05')),
    meeting('Curta B', local('09:10'), local('09:15')),
    meeting('Último minuto', local('23:59'), '2026-09-25T00:00:00-03:00'),
  ];
  const slots = thursday(events).timed;
  assert.equal(slots[0].endMinute, 545);
  assert.equal(slots[0].displayEndMinute, 560);
  assert.notEqual(slots[0].column, slots[1].column);
  assert.equal(slots[2].displayEndMinute, 1440);
});

test('dias fora do período são identificados sem simular agenda vazia ou ampliar consulta', () => {
  const days = weeklyCalendar([], period, '2026-09-30T12:00:00-03:00');
  assert.deepEqual(days.filter(day => day.covered).map(day => day.date), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(days.filter(day => !day.covered).map(day => day.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.ok(weeklyCalendar([], period, '2027-09-24').every(day => !day.covered));
});

test('somente eventos posicionáveis da semana aparecem e os dados originais são preservados', () => {
  const events = Object.freeze([
    Object.freeze(meeting('Válido', local('08:00'), local('09:00'), { bloqueio_confirmado: false })),
    Object.freeze(meeting('Outra semana', '2026-09-14T08:00:00-03:00', '2026-09-14T09:00:00-03:00')),
    Object.freeze(meeting('Inválido', '', local('09:00'))),
    Object.freeze(meeting('Invertido', local('10:00'), local('09:00'))),
  ]);
  const before = structuredClone(events);
  assert.deepEqual(weeklyCalendar(events, period, now).flatMap(day => day.timed.map(slot => slot.event)), [events[0]]);
  assert.deepEqual(events, before);
});

test('atualizações reposicionam e removem eventos sem manter blocos antigos', () => {
  const event = meeting('Reunião', local('09:00'), local('10:00'));
  assert.equal(thursday([event]).timed[0].startMinute, 540);
  assert.equal(thursday([{ ...event, inicio: local('14:00'), fim: local('15:00') }]).timed[0].startMinute, 840);
  assert.equal(thursday([]).timed.length, 0);
});

test('navega entre semanas sem deslocar hoje nem a linha de hora atual', () => {
  const events = [
    meeting('Anterior', '2026-09-15T09:00:00-03:00', '2026-09-15T10:00:00-03:00'),
    meeting('Atual', local('13:00'), local('14:00')),
    meeting('Próxima', '2026-09-28T09:00:00-03:00', '2026-09-28T10:00:00-03:00'),
  ];
  const monday = currentWeek(now)[0].start;
  const week = 7 * 86_400_000;
  for (const [offset, expectedDate, expectedEvent] of [[-1, '2026-09-14', events[0]], [1, '2026-09-28', events[2]]]) {
    const days = weeklyCalendar(events, period, now, monday + offset * week);
    assert.equal(days[0].date, expectedDate);
    assert.equal(days.length, 6);
    assert.ok(days.every(day => !day.today && day.currentMinute === null));
    assert.deepEqual(days.flatMap(day => day.timed.map(slot => slot.event)), [expectedEvent]);
  }
  const returned = weeklyCalendar(events, period, now, monday);
  assert.deepEqual(returned.filter(day => day.today).map(day => [day.date, day.currentMinute]), [['2026-09-24', 825]]);
});

test('domingo não aparece mesmo quando é hoje, preservando os eventos originais', () => {
  const events = Object.freeze([
    Object.freeze(meeting('Domingo', '2026-09-27T09:00:00-03:00', '2026-09-27T10:00:00-03:00')),
    Object.freeze(meeting('Fim de semana', '2026-09-26', '2026-09-28', { dia_inteiro: true })),
  ]);
  const before = structuredClone(events);
  const days = weeklyCalendar(events, period, '2026-09-27T10:00:00-03:00');
  assert.deepEqual(days.map(day => day.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  assert.ok(days.every(day => !day.today && day.currentMinute === null && day.timed.length === 0));
  assert.deepEqual(days[5].allDay, [events[1]]);
  assert.deepEqual(events, before);
});

test('navegação atravessa mês e ano e mantém aviso de dados não consultados', () => {
  const monday = currentWeek('2026-12-31')[0].start;
  const days = weeklyCalendar([], period, now, monday + 7 * 86_400_000);
  assert.equal(days[0].date, '2027-01-04');
  assert.equal(days.at(-1).date, '2027-01-09');
  assert.ok(days.every(day => !day.covered && !day.today && day.currentMinute === null));
});
