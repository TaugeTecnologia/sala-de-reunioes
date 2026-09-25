import test from 'node:test';
import assert from 'node:assert/strict';
import { maskDateInput, parseDateInput, dateInputCaret, findAgendaFocus, agendaResultWeeks, resultWeekNavigation } from './agenda-filters.js';
import { filterEvents, meetingPhase } from './agenda.js';
import { weeklyCalendar } from './week.js';

const now = '2026-09-25T13:00:00-03:00';
const period = { inicio: '2026-09-01', fim: '2026-10-01' };
const meeting = (nome, date, inicio = '09:00', fim = '10:00', extra = {}) => ({
  nome, inicio: `${date}T${inicio}:00-03:00`, fim: `${date}T${fim}:00-03:00`, ...extra,
});

test('digita dia, mês e ano continuamente, aceita colagem e permite apagar', () => {
  let value = '';
  const displayed = [];
  for (const digit of '25092026') {
    value = maskDateInput(value + digit);
    displayed.push(value);
  }
  assert.deepEqual(displayed, ['2', '25', '25/0', '25/09', '25/09/2', '25/09/20', '25/09/202', '25/09/2026']);
  assert.equal(parseDateInput(value), '2026-09-25');
  assert.equal(maskDateInput('25/09/2026'), value);
  assert.equal(maskDateInput('25/09/2026abc123'), value);
  assert.equal(maskDateInput(''), '');
  assert.equal(maskDateInput('25/'), '25');
  assert.equal(dateInputCaret('25/09/2026', 3), 4);
  assert.equal(dateInputCaret('25/09/2026', 0), 0);
  assert.equal(dateInputCaret('25/09/2026', 8), 10);
});

test('data incompleta ou inexistente não vira outro dia silenciosamente', () => {
  for (const value of ['', '25', '25/09/202', '31/02/2026', '29/02/2026', '31/04/2026', '00/09/2026', '25/13/2026', '25/09/0000']) {
    assert.equal(parseDateInput(value), null, value);
  }
  assert.equal(parseDateInput('29/02/2024'), '2024-02-29');
  assert.equal(parseDateInput('31/12/2026'), '2026-12-31');
});

test('busca encontra reunião, criador, organizador e convidados e combina com data e situação', () => {
  const planning = meeting('Reunião de planejamento', '2026-09-25', '14:00', '15:00', {
    criador: { nome: 'José Costa', email: 'jose.costa@example.com' },
    organizador: { displayName: 'Ana Silva' },
    participantes: { lista: [{ nome: 'Mário Reis' }, { email: 'esther.soares@example.com' }, null] },
    bloqueio_confirmado: false,
  });
  const other = meeting('Outro assunto', '2026-09-24');
  const events = Object.freeze([Object.freeze(planning), Object.freeze(other)]);
  for (const busca of ['PLANEJAMENTO', 'reuniao jose', 'ANA SILVA', 'mario', 'ESTHER SOARES', 'jose.costa@example.com']) {
    assert.deepEqual(filterEvents(events, { busca, data: parseDateInput('25/09/2026'), status: 'previstos' }, now), [planning]);
  }
  assert.deepEqual(filterEvents(events, { busca: 'inexistente' }, now), []);
  assert.deepEqual(filterEvents(events, { busca: 'planejamento', data: '2026-09-24' }, now), []);
  assert.deepEqual(filterEvents(events, { busca: 'planejamento', status: 'finalizados' }, now), []);
});

test('situação acompanha começo e fim exatos, sem depender da confirmação da reserva', () => {
  const event = meeting('Teste', '2026-09-25', '13:00', '14:00', { bloqueio_confirmado: false });
  for (const [instant, phase] of [
    ['2026-09-25T12:59:59-03:00', 'previstos'],
    ['2026-09-25T13:00:00-03:00', 'em-andamento'],
    ['2026-09-25T13:59:59-03:00', 'em-andamento'],
    ['2026-09-25T14:00:00-03:00', 'finalizados'],
  ]) {
    assert.equal(meetingPhase(event, instant), phase);
    assert.deepEqual(filterEvents([event], { status: phase }, instant), [event]);
    assert.deepEqual(filterEvents([event], { status: 'todos' }, instant), [event]);
  }
  const invalid = { nome: 'Sem horários', inicio: '', fim: '' };
  assert.equal(meetingPhase(invalid, now), null);
  assert.deepEqual(filterEvents([invalid], { status: 'previstos' }, now), []);
  assert.deepEqual(filterEvents([invalid], { status: 'todos' }, now), [invalid]);
});

test('busca em outra semana posiciona o resultado no calendário com o horário real', () => {
  const event = meeting('Planejamento', '2026-09-14', '08:15', '09:45');
  const matches = filterEvents([event], { busca: 'planejamento' }, now);
  assert.equal(weeklyCalendar(matches, period, now).flatMap(day => day.timed).length, 0);
  const focus = findAgendaFocus(matches, period, now);
  assert.deepEqual(focus, { date: '2026-09-14', sunday: false });
  const days = weeklyCalendar(matches, period, now, focus.date);
  assert.equal(days[0].timed[0].event, event);
  assert.equal(days[0].timed[0].startMinute, 495);
});

test('busca mantém semana com resultados e ignora eventos inválidos ou fora da coleta', () => {
  const older = meeting('Antiga', '2026-09-14');
  const current = meeting('Na semana', '2026-09-25', '16:00', '17:00');
  assert.equal(findAgendaFocus([current, older], period, now, '2026-09-14').date, '2026-09-14');
  assert.equal(findAgendaFocus([current, older], period, now).date, '2026-09-25');
  assert.equal(findAgendaFocus([], period, now), null);
  assert.equal(findAgendaFocus([{ inicio: '', fim: '' }, meeting('Fora', '2026-10-05')], period, now), null);
});

test('pesquisa por data mostra só o dia escolhido, inclusive domingo, sem mudar a semana padrão', () => {
  const sunday = meeting('Domingo', '2026-09-27');
  const saturday = meeting('Sábado', '2026-09-26');
  const date = parseDateInput('27/09/2026');
  const events = filterEvents([sunday, saturday], { data: date }, now);
  const days = weeklyCalendar(events, period, now, date, date);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, date);
  assert.deepEqual(days[0].timed.map(item => item.event), [sunday]);
  assert.equal(weeklyCalendar([sunday, saturday], period, now).length, 6);
  assert.deepEqual(findAgendaFocus([sunday], period, now), { date, sunday: true });
});

test('dia escolhido preserva a passagem de meia-noite e informa ausência de cobertura', () => {
  const event = { nome: 'Noturna', inicio: '2026-09-24T23:30:00-03:00', fim: '2026-09-25T00:30:00-03:00' };
  const date = parseDateInput('25/09/2026');
  const days = weeklyCalendar(filterEvents([event], { data: date }, now), period, now, date, date);
  assert.equal(days[0].timed[0].startMinute, 0);
  assert.equal(days[0].timed[0].endMinute, 30);
  assert.equal(days[0].timed[0].continuesBefore, true);
  const outside = weeklyCalendar([], period, now, '2026-10-05', '2026-10-05');
  assert.equal(outside[0].covered, false);
});

test('navegação de resultados pula semanas vazias, volta e para nos limites', () => {
  const events = Object.freeze([
    Object.freeze(meeting('Primeira', '2026-09-01')),
    Object.freeze(meeting('Outra na mesma semana', '2026-09-03')),
    Object.freeze(meeting('Segunda semana encontrada', '2026-09-22')),
    Object.freeze(meeting('Última', '2026-09-30')),
  ]);
  const before = structuredClone(events);
  const weeks = agendaResultWeeks(events, period);
  assert.deepEqual(weeks.map(week => week.date), ['2026-08-31', '2026-09-21', '2026-09-28']);
  const first = resultWeekNavigation(weeks, '2026-09-01');
  assert.equal(first.index, 0);
  assert.equal(first.previous, null);
  assert.equal(first.next, weeks[1]);
  const middle = resultWeekNavigation(weeks, first.next.date);
  assert.equal(middle.index, 1);
  assert.equal(middle.previous, weeks[0]);
  assert.equal(middle.next, weeks[2]);
  const last = resultWeekNavigation(weeks, middle.next.date);
  assert.equal(last.previous, weeks[1]);
  assert.equal(last.next, null);
  const emptyWeek = resultWeekNavigation(weeks, '2026-09-14');
  assert.equal(emptyWeek.index, -1);
  assert.equal(emptyWeek.previous, weeks[0]);
  assert.equal(emptyWeek.next, weeks[1]);
  assert.deepEqual(events, before);
});

test('semanas de resultados respeitam busca, pessoa, situação e data combinadas', () => {
  const person = { nome: 'Ana Silva' };
  const events = [
    meeting('Planejamento', '2026-09-01', '09:00', '10:00', { organizador: person }),
    meeting('Planejamento', '2026-09-22', '09:00', '10:00', { organizador: person }),
    meeting('Planejamento', '2026-09-29', '09:00', '10:00', { organizador: person }),
    meeting('Outro assunto', '2026-09-14', '09:00', '10:00', { organizador: person }),
    meeting('Planejamento', '2026-09-08', '09:00', '10:00', { organizador: { nome: 'Outra pessoa' } }),
  ];
  const filters = { busca: 'planejamento ana', status: 'finalizados' };
  const weeks = agendaResultWeeks(filterEvents(events, filters, now), period);
  assert.deepEqual(weeks.map(week => week.date), ['2026-08-31', '2026-09-21']);
  const selectedDate = '2026-09-22';
  const oneDay = agendaResultWeeks(filterEvents(events, { ...filters, data: selectedDate }, now), period, selectedDate);
  assert.deepEqual(oneDay.map(week => week.date), ['2026-09-21']);
});

test('reuniões entre semanas e de dia inteiro entram em todas as semanas ocupadas, sem incluir o fim', () => {
  const spanning = { nome: 'Entre semanas', inicio: '2026-09-06T23:30:00-03:00', fim: '2026-09-07T00:30:00-03:00' };
  assert.deepEqual(agendaResultWeeks([spanning], period).map(week => week.date), ['2026-08-31', '2026-09-07']);
  const wholeDay = { nome: 'Dia inteiro', inicio: '2026-09-05', fim: '2026-09-07', dia_inteiro: true };
  assert.deepEqual(agendaResultWeeks([wholeDay], period).map(week => week.date), ['2026-08-31']);
  const selectedDate = '2026-09-07';
  assert.deepEqual(agendaResultWeeks([spanning], period, selectedDate).map(week => week.date), ['2026-09-07']);
});

test('semana com resultados apenas no domingo abre esse dia e continua navegável', () => {
  const sunday = meeting('Domingo', '2026-09-20');
  const next = meeting('Seguinte', '2026-09-29');
  const weeks = agendaResultWeeks([sunday, next], period);
  assert.equal(weeks[0].date, '2026-09-14');
  assert.equal(weeks[0].focusDate, '2026-09-20');
  assert.equal(weeks[0].sunday, true);
  const days = weeklyCalendar([sunday, next], period, now, weeks[0].date, weeks[0].focusDate);
  assert.equal(days[0].timed[0].event, sunday);
  assert.equal(resultWeekNavigation(weeks, weeks[0].focusDate).next, weeks[1]);
});

test('não oferece destinos inválidos, fora da coleta ou sem resultados após alterações', () => {
  assert.deepEqual(agendaResultWeeks([{ inicio: '', fim: '' }, meeting('Fora', '2026-10-05')], period), []);
  assert.deepEqual(agendaResultWeeks([], period), []);
  assert.deepEqual(agendaResultWeeks([meeting('Válida', '2026-09-25')], {}), []);
  assert.deepEqual(resultWeekNavigation([], now), { index: -1, previous: null, next: null });
  const updated = agendaResultWeeks([meeting('Remarcada', '2026-09-29')], period);
  assert.equal(resultWeekNavigation(updated, '2026-09-14').previous, null);
  assert.equal(resultWeekNavigation(updated, '2026-09-14').next, updated[0]);
});
