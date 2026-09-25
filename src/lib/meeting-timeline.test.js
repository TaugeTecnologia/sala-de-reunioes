import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingTimeline, isOffDefaultInterval, MINUTE_HEIGHT } from './meeting-timeline.js';
import { splitMeetings, todaysMeetings, formatTime } from './agenda.js';

const now = '2026-09-25T13:30:00-03:00';
const time = value => `2026-09-25T${value}:00-03:00`;
const meeting = (nome, inicio, fim, extra = {}) => Object.freeze({ nome, inicio, fim, ...extra });
const QUARTER_HEIGHT = 15 * MINUTE_HEIGHT;

test('13:06–14:06 gera um único bloco, deslocado seis minutos da linha de 13:00', () => {
  const event = meeting('Projeto X', time('13:06'), time('14:06'));
  const layout = meetingTimeline([event], now);
  assert.equal(layout.blocks.length, 1);
  const block = layout.blocks[0];
  assert.equal(block.event, event);
  assert.equal(block.startMinute, 786);
  assert.equal(block.endMinute, 846);
  assert.ok(Math.abs(block.top - (13 * 60 * MINUTE_HEIGHT + QUARTER_HEIGHT * 6 / 15)) < 1e-9);
  assert.equal(block.height, 4 * QUARTER_HEIGHT);
  assert.equal(block.offGrid, true);
  assert.equal(event.inicio, time('13:06'));
});

test('15, 30 e 60 minutos ocupam exatamente 1, 2 e 4 intervalos visuais', () => {
  const events = [meeting('Curta', time('09:00'), time('09:15')), meeting('Média', time('10:00'), time('10:30')), meeting('Longa', time('11:00'), time('12:00'))];
  const layout = meetingTimeline(events, now);
  assert.deepEqual(layout.blocks.map(block => block.height), [QUARTER_HEIGHT, 2 * QUARTER_HEIGHT, 4 * QUARTER_HEIGHT]);
  assert.deepEqual(layout.blocks.map(block => block.event), events);
  assert.equal(layout.laneCount, 1);
});

test('as 48 marcações padrão formam uma sequência neutra de 30 em 30 minutos', () => {
  const layout = meetingTimeline([], now);
  assert.equal(layout.blocks.length, 0);
  assert.equal(layout.intervalMinutes, 30);
  assert.equal(layout.markers.length, 48);
  assert.equal(formatTime(layout.markers[0].time), '00:00');
  assert.equal(formatTime(layout.markers.at(-1).time), '23:30');
  assert.ok(layout.markers.every((marker, index) => marker.top === index * 30 * MINUTE_HEIGHT && marker.label === formatTime(marker.time)));
  assert.ok(layout.markers.every(marker => !('hour' in marker)));
  assert.equal(layout.height, 1440 * MINUTE_HEIGHT);
});

test('simultâneas usam faixas distintas; consecutivas reutilizam a faixa sem se sobrepor', () => {
  const a = meeting('A', time('13:06'), time('14:06'));
  const b = meeting('B', time('13:15'), time('13:45'));
  const c = meeting('C', time('13:45'), time('14:00'));
  const d = meeting('D', time('14:06'), time('14:15'));
  const layout = meetingTimeline([d, c, b, a], now);
  assert.deepEqual(layout.blocks.map(block => [block.event.nome, block.lane]), [['A', 0], ['B', 1], ['C', 1], ['D', 0]]);
  assert.equal(layout.laneCount, 2);
  assert.equal(layout.blocks.length, 4);
});

test('eventos muito curtos mantêm minutos e segundos reais, sem altura mínima artificial', () => {
  const event = meeting('Exata', '2026-09-25T13:06:30-03:00', '2026-09-25T13:07:00-03:00');
  const layout = meetingTimeline([event], now);
  const block = layout.blocks[0];
  assert.equal(block.startMinute, 786.5);
  assert.equal(block.height, 0.5 * layout.minuteHeight);
  assert.ok(isOffDefaultInterval(event.inicio));
  assert.ok(!isOffDefaultInterval(time('13:30')));
  assert.ok(!isOffDefaultInterval('inválido'));
});

test('passagem da meia-noite é recortada ao dia em um único bloco, preservando os horários originais', () => {
  const overnight = meeting('Ontem', '2026-09-24T23:30:00-03:00', time('01:00'));
  const nextDay = meeting('Amanhã', time('23:30'), '2026-09-26T01:00:00-03:00');
  const layout = meetingTimeline([overnight, nextDay], now);
  assert.equal(layout.blocks.length, 2);
  assert.deepEqual(layout.blocks.map(block => [block.startMinute, block.endMinute, block.continuesBefore, block.continuesAfter]), [[0, 60, true, false], [1410, 1440, false, true]]);
  assert.equal(layout.blocks[0].event.inicio, overnight.inicio);
  assert.equal(layout.blocks[1].event.fim, nextDay.fim);
});

test('dia inteiro aparece uma vez na faixa própria, sem repetir ou cobrir as reuniões com horário', () => {
  const allDay = meeting('Dia inteiro', '2026-09-25', '2026-09-26', { dia_inteiro: true });
  const timed = meeting('Com horário', time('13:06'), time('14:06'));
  const layout = meetingTimeline([allDay, timed], now);
  assert.deepEqual(layout.allDay, [allDay]);
  assert.deepEqual(layout.blocks.map(block => block.event), [timed]);
  assert.equal(layout.laneCount, 1);
});

test('Atuais e Histórico preservam registros e contagens, com uma representação por evento', () => {
  const events = Object.freeze([meeting('Encerrada', time('09:06'), time('10:36')), meeting('Em andamento', time('13:06'), time('14:06')), meeting('Próxima', time('14:15'), time('15:30'))]);
  const before = structuredClone(events);
  const groups = splitMeetings(todaysMeetings(events, now), now);
  assert.deepEqual([groups.atuais.length, groups.historico.length], [2, 1]);
  for (const group of Object.values(groups)) {
    const layout = meetingTimeline(group, now);
    assert.equal(layout.blocks.length + layout.allDay.length, group.length);
    assert.deepEqual(new Set(layout.blocks.map(block => block.event)), new Set(group));
  }
  const afterEnd = splitMeetings(events, time('14:06'));
  assert.deepEqual([afterEnd.atuais.length, afterEnd.historico.length], [1, 2]);
  assert.deepEqual(events, before);
});

test('fim exclusivo, fuso local, intervalos inválidos e eventos de outros dias não criam blocos', () => {
  const layout = meetingTimeline([
    meeting('Inválido', '', ''), meeting('Invertido', time('14:00'), time('13:00')),
    meeting('Terminou à meia-noite', '2026-09-24T23:30:00-03:00', time('00:00')),
    meeting('Outro dia', '2026-09-26T00:00:00-03:00', '2026-09-26T01:00:00-03:00'),
    meeting('UTC', '2026-09-25T16:06:00Z', '2026-09-25T17:06:00Z'),
  ], now);
  assert.equal(layout.blocks.length, 1);
  assert.equal(layout.blocks[0].startMinute, 786);
  assert.equal(meetingTimeline([], '2026-09-25T02:59:59Z').dayStart, Date.parse('2026-09-24T00:00:00-03:00'));
  assert.equal(meetingTimeline([], '2026-09-25T03:00:00Z').dayStart, Date.parse(time('00:00')));
  assert.equal(meetingTimeline([], 'inválido').dayStart, null);
});

test('edições e remoções recalculam o bloco sem manter cópias antigas', () => {
  const initial = meeting('Projeto X', time('13:06'), time('14:06'));
  const edited = { ...initial, inicio: time('13:21'), fim: time('14:51') };
  const layout = meetingTimeline([edited], now);
  assert.equal(layout.blocks.length, 1);
  assert.equal(layout.blocks[0].startMinute, 801);
  assert.equal(layout.blocks[0].height, 90 * layout.minuteHeight);
  assert.equal(meetingTimeline([], now).blocks.length, 0);
});

test('mantém 30 minutos quando todas as reuniões começam e terminam nas meias horas', () => {
  const layout = meetingTimeline([meeting('Primeira', time('09:00'), time('09:30')), meeting('Segunda', time('13:30'), time('15:00'))], now);
  assert.equal(layout.intervalMinutes, 30);
  assert.deepEqual(layout.markers.slice(24, 28).map(marker => marker.label), ['12:00', '12:30', '13:00', '13:30']);
  assert.equal(layout.blocks.length, 2);
});

test('ajusta o dia para 15, 10 ou 5 minutos conforme os horários de início e fim', () => {
  for (const [start, end, expected] of [['13:15', '14:00', 15], ['13:00', '13:10', 10], ['13:05', '14:00', 5]]) {
    const layout = meetingTimeline([meeting('Menor intervalo', time(start), time(end))], now);
    assert.equal(layout.intervalMinutes, expected);
    assert.equal(layout.markers.length, 1440 / expected);
    assert.ok(layout.markers.some(marker => marker.label === start));
    assert.ok(layout.markers.some(marker => marker.label === end));
    assert.equal(layout.blocks.length, 1);
  }
  const mixed = meetingTimeline([meeting('15', time('09:00'), time('09:15')), meeting('10', time('10:00'), time('10:10'))], now);
  assert.equal(mixed.intervalMinutes, 5);
});

test('horários fora dos padrões continuam exatos e a sequência fica legível', () => {
  for (const [start, expected] of [['13:06', 6], ['13:07', 1]]) {
    const event = meeting('Exata', time(start), time('14:00'));
    const layout = meetingTimeline([event], now);
    assert.equal(layout.intervalMinutes, expected);
    const mark = layout.markers.find(marker => marker.label === start);
    assert.ok(mark);
    assert.equal(mark.top, layout.blocks[0].top);
    assert.ok(layout.intervalHeight >= 18);
    assert.equal(layout.blocks[0].event.inicio, event.inicio);
  }
});

test('a granularidade considera o dia inteiro e permanece igual entre Atuais e Histórico', () => {
  const events = [meeting('Passada curta', time('09:00'), time('09:15')), meeting('Atual', time('13:00'), time('14:00'))];
  const groups = splitMeetings(events, now);
  const layouts = Object.values(groups).map(group => meetingTimeline(group, now, events));
  assert.ok(layouts.every(layout => layout.intervalMinutes === 15));
  assert.deepEqual(layouts[0].markers, layouts[1].markers);
  assert.equal(meetingTimeline([], now, events).intervalMinutes, 15);
});

test('outros dias e eventos de dia inteiro não alteram a escala; remoção restaura o padrão', () => {
  const events = [meeting('Ontem curta', '2026-09-24T09:01:00-03:00', '2026-09-24T09:02:00-03:00'), meeting('Dia inteiro', '2026-09-25', '2026-09-26', { dia_inteiro: true })];
  assert.equal(meetingTimeline(events, now).intervalMinutes, 30);
  const short = meeting('Hoje curta', time('09:00'), time('09:15'));
  assert.equal(meetingTimeline([...events, short], now).intervalMinutes, 15);
  assert.equal(meetingTimeline(events, now).intervalMinutes, 30);
  assert.equal(meetingTimeline([short], '2026-09-26T13:00:00-03:00').intervalMinutes, 30);
});
