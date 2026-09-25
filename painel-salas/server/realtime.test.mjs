import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeMonitor } from './realtime.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function clock() {
  let instant = Date.parse('2026-09-22T12:00:00Z');
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => instant,
    setTimer(callback, delay) { const id = ++sequence; timers.set(id, { at: instant + delay, callback }); return id; },
    clearTimer(id) { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const until = instant + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        instant = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      instant = until;
    },
  };
}

function fakeSync(timer) {
  const listeners = new Set();
  const states = new Map();
  const api = {
    starts: [], canceled: [],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState(ano) { return states.get(ano) || { estado: 'ocioso', ano }; },
    start(ano) { api.starts.push(ano); api.emit({ ano, estado: 'executando', iniciadoEm: new Date(timer.now()).toISOString() }); },
    emit(state, agenda) { state = { mes: 9, ...state }; states.set(state.ano, state); for (const listener of listeners) listener({ state, agenda }); },
    finish(ano, agenda, success = true) { api.emit({ ano, estado: success ? 'concluido' : 'erro', finalizadoEm: new Date(timer.now()).toISOString(), mensagem: success ? 'Atualizado.' : 'A conexão falhou.' }, agenda); },
    cancelAutomatic(ano) { api.canceled.push(ano); },
    subscribers: () => listeners.size,
  };
  return api;
}

const agenda = (year, generated, names = ['Projeto']) => ({
  arquivo: `agenda-setembro-${year}-atual.json`, geradoEm: new Date(generated).toISOString(), periodo: { ano: year, mes: 9 },
  salas: [{ status: 'acesso_limitado' }], eventos: names.map((nome) => ({ nome })), avisos: ['Detalhes privados podem estar ocultos.'],
});

test('duas abas compartilham a consulta automática e recebem alteração e exclusão, inclusive agenda vazia', async () => {
  const timer = clock();
  const sync = fakeSync(timer);
  let loads = 0;
  const monitor = createRealtimeMonitor({ sync, ...timer, load: async (year) => { loads++; return agenda(year, timer.now() - 60_000); } });
  const first = [], second = [];
  assert.equal(sync.starts.length, 0);
  const leave1 = monitor.subscribe(2026, (type, value) => first.push({ type, value }), 9);
  const leave2 = monitor.subscribe(2026, (type, value) => second.push({ type, value }), 9);
  await tick();
  timer.advance(0);
  assert.equal(loads, 1);
  assert.deepEqual(sync.starts, [2026]);
  sync.finish(2026, agenda(2026, timer.now(), ['Projeto atualizado', 'Nova reunião']));
  for (const messages of [first, second]) assert.equal(messages.filter((event) => event.type === 'agenda').at(-1).value.eventos.length, 2);
  timer.advance(1_999);
  assert.equal(sync.starts.length, 1);
  timer.advance(1);
  assert.equal(sync.starts.length, 2);
  sync.finish(2026, agenda(2026, timer.now(), []));
  assert.deepEqual(first.filter((event) => event.type === 'agenda').at(-1).value.eventos, []);
  assert.deepEqual(second.filter((event) => event.type === 'agenda').at(-1).value.eventos, []);
  leave1();
  assert.equal(timer.pending(), 1);
  leave2();
  assert.equal(timer.pending(), 0);
  monitor.stop();
});

test('desconectar a última aba remove a consulta agendada; reconectar reproduz cache e retoma se antigo', async () => {
  const timer = clock(), sync = fakeSync(timer);
  const cached = agenda(2026, timer.now());
  const monitor = createRealtimeMonitor({ sync, ...timer, load: async () => cached });
  const leave = monitor.subscribe(2026, () => {}, 9);
  await tick();
  leave();
  timer.advance(60_000);
  assert.equal(sync.starts.length, 0);
  assert.deepEqual(sync.canceled, [2026]);
  const received = [];
  const leaveAgain = monitor.subscribe(2026, (event, data) => received.push({ event, data }), 9);
  assert.deepEqual(received.find((item) => item.event === 'agenda').data, cached);
  assert.equal(received.find((item) => item.event === 'estado').data.intervaloSegundos, 2);
  timer.advance(0);
  assert.deepEqual(sync.starts, [2026]);
  leaveAgain();
  monitor.stop();
  assert.equal(sync.subscribers(), 0);
});

test('falhas mantêm a agenda visível e recuam 30s, 60s, 120s; sucesso restaura 2s', async () => {
  const timer = clock(), sync = fakeSync(timer), received = [];
  const monitor = createRealtimeMonitor({ sync, ...timer, load: async () => agenda(2026, timer.now() - 60_000) });
  monitor.subscribe(2026, (event, data) => received.push({ event, data }), 9);
  await tick();
  timer.advance(0);
  for (const delay of [30_000, 60_000, 120_000, 120_000]) {
    sync.finish(2026, undefined, false);
    const state = monitor.getState(2026, 9);
    assert.equal(state.estado, 'erro');
    assert.equal(Date.parse(state.proximaConsultaEm) - timer.now(), delay);
    const calls = sync.starts.length;
    timer.advance(delay - 1);
    assert.equal(sync.starts.length, calls);
    timer.advance(1);
    assert.equal(sync.starts.length, calls + 1);
  }
  assert.equal(received.filter((item) => item.event === 'agenda').length, 1);
  sync.finish(2026, agenda(2026, timer.now()));
  assert.equal(Date.parse(monitor.getState(2026, 9).proximaConsultaEm) - timer.now(), 2_000);
  monitor.stop();
});

test('assinaturas isolam anos, iniciam sem exportação e não enviam dados de outro período', async () => {
  const timer = clock(), sync = fakeSync(timer), first = [], second = [];
  const monitor = createRealtimeMonitor({ sync, ...timer, load: async () => { throw new Error('Sem snapshot.'); } });
  const leave1 = monitor.subscribe(2026, (event, data) => first.push({ event, data }), 9);
  const leave2 = monitor.subscribe(2027, (event, data) => second.push({ event, data }), 9);
  await tick();
  timer.advance(0);
  assert.deepEqual(sync.starts, [2026, 2027]);
  sync.finish(2026, agenda(2026, timer.now()));
  assert.equal(first.filter((message) => message.event === 'agenda').length, 1);
  assert.equal(second.filter((message) => message.event === 'agenda').length, 0);
  leave1();
  sync.finish(2027, agenda(2027, timer.now()));
  timer.advance(2_000);
  assert.deepEqual(sync.starts, [2026, 2027, 2027]);
  leave2();
  monitor.stop();
});
