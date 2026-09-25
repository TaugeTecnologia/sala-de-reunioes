import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createApp, createSyncController, loadAgenda, parseMonth } from './app.mjs';
import { createRealtimeMonitor } from './realtime.mjs';
import { monthPeriod } from '../src/lib/periods.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (year, month) => ({ periodo: monthPeriod(year, month), eventos: [], salas: [{ id: 'sala', status: 'ok' }], geradoEm: new Date().toISOString() });

test('carrega meses separados, aceita setembro legado e rejeita intervalo inconsistente', async t => {
  const root = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(root, 'painel-months-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), root);
    assert.ok(path.basename(directory).startsWith('painel-months-'));
    await rm(directory, { recursive: true, force: true });
  });
  for (const [year, month] of [[2026, 9], [2027, 1], [2027, 12], [2028, 2]]) {
    const period = monthPeriod(year, month);
    const name = month === 9 ? 'agenda-setembro-2026-atual.json' : `agenda-${period.key}-atual.json`;
    await writeFile(path.join(directory, name), JSON.stringify({ ano: year, mes: month, time_min: period.inicio, time_max: period.fim,
      gerado_em: new Date().toISOString(), coleta_finalizada: true, formato: 'eventos_das_salas_v2', origem_coleta: 'agendas_das_salas',
      agendas: [{ email: 'sala', status: 'ok' }], gestao_sala: { eventos_na_sala: [] } }));
    const loaded = await loadAgenda(year, directory, month);
    assert.equal(loaded.periodo.ano, year);
    assert.equal(loaded.periodo.mes, month);
    assert.equal(loaded.periodo.fim, period.fim);
  }
  await assert.rejects(loadAgenda(2027, directory, 2), { status: 404 });
  for (const invalid of [0, 13, 1.5, '', null, [], {}, '1;echo']) assert.throws(() => parseMonth(invalid), { status: 400 });
});

test('fila distingue meses do mesmo ano, agrupa pedidos iguais e remove consultas desconectadas', async t => {
  const children = [], loaded = [];
  const sync = createSyncController({ spawnProcess: (_python, args) => {
    const child = new EventEmitter(); child.kill = () => true;
    children.push({ child, args }); return child;
  }, load: async (year, month) => { loaded.push([year, month]); return snapshot(year, month); } });
  t.after(() => sync.stop());
  sync.start(2027, { month: 1 }); sync.start(2027, { month: 1 });
  sync.start(2027, { month: 2 }); sync.start(2028, { month: 3, automatic: true });
  sync.cancelAutomatic(2028, 3);
  assert.equal(children.length, 1);
  children[0].child.emit('close', 0); await tick();
  assert.equal(children.length, 2);
  assert.equal(children[1].args[children[1].args.indexOf('--mes') + 1], '2');
  children[1].child.emit('close', 0); await tick();
  assert.deepEqual(loaded, [[2027, 1], [2027, 2]]);
  assert.equal(sync.getState(2027, 1).estado, 'concluido');
  assert.equal(sync.getState(2027, 2).estado, 'concluido');
  assert.equal(children.length, 2);
});

test('SSE isola clientes por mês e ano, inclusive cancelamento da consulta ao desconectar', async t => {
  let listener;
  const canceled = [];
  const sync = { subscribe(callback) { listener = callback; return () => {}; }, getState() { return { estado: 'executando' }; }, cancelAutomatic(year, month) { canceled.push([year, month]); } };
  const monitor = createRealtimeMonitor({ sync, load: async (year, month) => snapshot(year, month) });
  t.after(() => monitor.stop());
  const january = [], february = [], future = [];
  const leave = monitor.subscribe(2027, (type, data) => january.push({ type, data }), 1);
  monitor.subscribe(2027, (type, data) => february.push({ type, data }), 2);
  monitor.subscribe(2030, (type, data) => future.push({ type, data }), 1);
  await tick();
  listener({ state: { ano: 2027, mes: 1, estado: 'executando' }, agenda: undefined });
  assert.equal(january.at(-1).data.mes, 1);
  for (const item of february.filter(item => item.type === 'agenda')) assert.equal(item.data.periodo.mes, 2);
  for (const item of future.filter(item => item.type === 'agenda')) assert.equal(item.data.periodo.ano, 2030);
  assert.equal(february.filter(item => item.type === 'estado' && item.data.estado === 'executando').length, 0);
  leave();
  assert.deepEqual(canceled, [[2027, 1]]);
});

test('API propaga mês e ano em leitura, consulta e validação antes de abrir SSE', async t => {
  const calls = [];
  const app = createApp({ load: async (year, month) => { calls.push(['get', year, month]); return snapshot(year, month); },
    syncController: { start(year, { month }) { calls.push(['sync', year, month]); return { ano: year, mes: month, estado: 'executando' }; }, getState() { return { estado: 'ocioso' }; }, stop() {} } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.stop(); app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/agenda?ano=2032&mes=7`)).status, 200);
  const response = await fetch(`${base}/api/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ano: 2033, mes: 11 }) });
  assert.equal(response.status, 202);
  assert.deepEqual(calls, [['get', 2032, 7], ['sync', 2033, 11]]);
  assert.equal((await fetch(`${base}/api/eventos?ano=2027&mes=13`)).status, 400);
});
