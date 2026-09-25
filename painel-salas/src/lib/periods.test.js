import test from 'node:test';
import assert from 'node:assert/strict';
import { monthPeriod, periodAt, calendarPeriods, overviewPeriods, mergeAgendas } from './periods.js';
import { weeklyCalendar } from './week.js';

test('mês completo respeita ano bissexto e virada de dezembro para janeiro', () => {
  for (const [year, days] of [[2027, 28], [2028, 29]]) {
    const period = monthPeriod(year, 2);
    assert.equal((Date.parse(period.fim) - Date.parse(period.inicio)) / 86400000, days);
  }
  assert.equal(monthPeriod(2030, 12).fim, '2031-01-01T00:00:00-03:00');
  for (const args of [[2027, 0], [2027, 13], [2027, 1.5], [9999, 12], [0, 1]]) assert.throws(() => monthPeriod(...args));
});

test('Visão geral acompanha a meia-noite de Brasília inclusive nos próximos anos', () => {
  assert.equal(periodAt('2027-01-01T02:59:59Z').key, '2026-12');
  assert.equal(periodAt('2027-01-01T03:00:00Z').key, '2027-01');
  assert.deepEqual(overviewPeriods('2030-12-31').map(item => item.key), ['2030-12', '2031-01']);
});

test('semana entre anos solicita ambos os meses; data exata consulta apenas seu mês', () => {
  assert.deepEqual(calendarPeriods('2027-01-01').map(item => item.key), ['2026-12', '2027-01']);
  assert.deepEqual(calendarPeriods('2027-01-11').map(item => item.key), ['2027-01']);
  assert.deepEqual(calendarPeriods('2026-09-01', '2034-05-14').map(item => item.key), ['2034-05']);
});

const periods = [monthPeriod(2026, 12), monthPeriod(2027, 1)];
const event = { chave: ['recorrente', '2026-12-31'], nome: 'Virada', inicio: '2026-12-31T23:30:00-03:00', fim: '2027-01-01T00:30:00-03:00' };
const report = (periodo, eventos, geradoEm = '2026-09-25T12:00:00Z') => ({ periodo, eventos, geradoEm, salas: [{ id: 'sala', status: 'ok' }], coletaFinalizada: true });

test('une meses sem duplicar reunião e mantém cada trecho no dia correto', () => {
  const data = mergeAgendas(periods, { '2026-12': report(periods[0], [event]), '2027-01': report(periods[1], [event]) });
  assert.equal(data.eventos.length, 1);
  assert.equal(data.coletaFinalizada, true);
  const days = weeklyCalendar(data.eventos, data.periodo, Date.parse('2026-09-25'), '2027-01-01');
  assert.equal(days.find(day => day.date === '2026-12-31').timed.length, 1);
  assert.equal(days.find(day => day.date === '2027-01-01').timed.length, 1);
});

test('edição vence cópia antiga; exclusão mais recente não ressuscita evento entre meses', () => {
  const snapshots = { '2026-12': report(periods[0], [event]), '2027-01': report(periods[1], [{ ...event, nome: 'Editada' }], '2026-09-25T12:01:00Z') };
  assert.equal(mergeAgendas(periods, snapshots).eventos[0].nome, 'Editada');
  snapshots['2027-01'].eventos = [];
  assert.deepEqual(mergeAgendas(periods, snapshots).eventos, []);
});

test('troca de mês não exibe eventos de outro período e não trata mês pendente como coleta completa', () => {
  const snapshots = { '2026-12': report(periods[0], [event]) };
  assert.equal(mergeAgendas(periods, snapshots).coletaFinalizada, false);
  const future = mergeAgendas([monthPeriod(2032, 5)], snapshots);
  assert.deepEqual(future.eventos, []);
  assert.equal(future.geradoEm, null);
  assert.equal(future.periodo.ano, 2032);
});
