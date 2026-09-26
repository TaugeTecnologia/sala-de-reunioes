import test from 'node:test';
import assert from 'node:assert/strict';
import { dayIndicator, todaysMeetings } from './agenda.js';

const now = '2026-09-24T12:00:00-03:00';
const at = hour => `2026-09-24T${hour}:00-03:00`;
const meeting = (nome, inicio, fim, extra = {}) => ({ nome, inicio, fim, bloqueio_confirmado: true, ...extra });

test('conta reuniões do dia: total, em andamento, a acontecer e encerradas', () => {
  const events = [
    meeting('Encerrada', at('08:00'), at('09:00')),
    meeting('Em andamento', at('11:30'), at('12:30')),
    meeting('Próxima', at('13:00'), at('14:00')),
    meeting('Mais tarde', at('16:00'), at('17:00')),
  ];
  assert.deepEqual(dayIndicator(events, now), { total: 4, emAndamento: 1, aAcontecer: 2, encerradas: 1 });
});

test('a reunião muda de contagem no instante em que começa e em que termina', () => {
  const events = [meeting('Reunião', at('13:00'), at('14:00'))];
  assert.deepEqual(dayIndicator(events, at('12:59')), { total: 1, emAndamento: 0, aAcontecer: 1, encerradas: 0 });
  assert.deepEqual(dayIndicator(events, at('13:00')), { total: 1, emAndamento: 1, aAcontecer: 0, encerradas: 0 });
  assert.deepEqual(dayIndicator(events, at('14:00')), { total: 1, emAndamento: 0, aAcontecer: 0, encerradas: 1 });
});

test('só entram reuniões de hoje quando combinado com todaysMeetings', () => {
  const events = [
    meeting('Hoje', at('15:00'), at('16:00')),
    meeting('Ontem', '2026-09-23T15:00:00-03:00', '2026-09-23T16:00:00-03:00'),
    meeting('Amanhã', '2026-09-25T15:00:00-03:00', '2026-09-25T16:00:00-03:00'),
  ];
  assert.deepEqual(dayIndicator(todaysMeetings(events, now), now), { total: 1, emAndamento: 0, aAcontecer: 1, encerradas: 0 });
});

test('sem reuniões ou com horário inválido não presume nada', () => {
  assert.deepEqual(dayIndicator([], now), { total: 0, emAndamento: 0, aAcontecer: 0, encerradas: 0 });
  const invalid = meeting('Sem fim', at('13:00'), null);
  assert.deepEqual(dayIndicator([invalid], now), { total: 1, emAndamento: 0, aAcontecer: 0, encerradas: 0 });
});
