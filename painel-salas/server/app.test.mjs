import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { createApp, createSyncController, loadAgenda, parseYear, serializeReport } from './app.mjs';

function report(overrides = {}) {
  return {
    ano: 2026, mes: 9, time_min: '2026-09-01T00:00:00-03:00', time_max: '2026-10-01T00:00:00-03:00', fuso: 'UTC-03:00',
    gerado_em: '2026-09-22T19:03:08.961983+00:00', formato: 'eventos_das_salas_v2', origem_coleta: 'agendas_das_salas', coleta_finalizada: true,
    agendas: [{ email: 'sala@resource.calendar.google.com', nome: 'Sala de reuniões', status: 'acesso_limitado', aviso: 'A API pode ocultar detalhes privados.', eventos: [{ secretRaw: 'not-for-api' }] }],
    emails_vinculados: ['pessoa@empresa.com'],
    gestao_sala: { eventos_na_sala: [{ id_evento: 'abc', nome: 'Projeto', inicio: '2026-09-22T14:00:00-03:00', fim: '2026-09-22T15:00:00-03:00', participantes: { pessoas_convidadas: 2, aceites_observados: 1, lista: [{ email: 'pessoa@empresa.com', resposta: 'accepted' }] }, avisos: [] }], fora_do_filtro: [{ nome: 'Não compartilhar' }] },
    credentials: { access_token: 'never-expose' }, ...overrides,
  };
}

async function fixture(t) {
  const tmpRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tmpRoot, 'painel-salas-test-'));
  t.after(async () => {
    const checked = path.resolve(directory);
    assert.equal(path.dirname(checked), tmpRoot);
    assert.ok(path.basename(checked).startsWith('painel-salas-test-'));
    await rm(checked, { recursive: true, force: true });
  });
  return directory;
}

async function writeReport(directory, stamp, data) {
  const name = `agenda-setembro-2026-${stamp}Z.json`;
  await writeFile(path.join(directory, name), JSON.stringify(data), 'utf8');
  return name;
}

test('valida ano sem aceitar caminhos, objetos, frações ou arrays', () => {
  assert.equal(parseYear('2026'), 2026);
  for (const value of [0, 10000, '2026.5', '../token', [2026], {}, '', null, '2026;python']) {
    assert.throws(() => parseYear(value), { status: 400 });
  }
});

test('serializa apenas o contrato público, preservando participantes e avisos de acesso', () => {
  const serialized = serializeReport(report(), 'agenda-setembro-2026-20260922T190308961952Z.json');
  assert.equal(serialized.eventos[0].participantes.aceites_observados, 1);
  assert.equal(serialized.salas[0].status, 'acesso_limitado');
  assert.deepEqual(serialized.avisos, ['A API pode ocultar detalhes privados.']);
  assert.equal(serialized.coletaFinalizada, true);
  assert.equal(serialized.periodo.fim, '2026-10-01T00:00:00-03:00');
  assert.doesNotMatch(JSON.stringify(serialized), /never-expose|secretRaw|Não compartilhar|access_token/);
});

test('seleciona última coleta concluída acessível e ignora coleta interrompida e antiga geral', async (t) => {
  const directory = await fixture(t);
  const selected = await writeReport(directory, '20260922T190000000000', report());
  await writeReport(directory, '20260922T200000000000', report({ gerado_em: '2026-09-22T20:00:00Z', coleta_finalizada: false }));
  await writeReport(directory, '20260922T210000000000', report({ gerado_em: '2026-09-22T21:00:00Z', origem_coleta: 'todos_os_usuarios' }));
  await writeFile(path.join(directory, 'agenda-setembro-2026-20260922T220000000000Z.json'), '{interrompido');
  await writeFile(path.join(directory, 'token-agenda-setembro.json'), JSON.stringify(report({ gerado_em: '2027-01-01T00:00:00Z' })));
  const agenda = await loadAgenda(2026, directory);
  assert.equal(agenda.arquivo, selected);
  assert.equal(agenda.eventos.length, 1);
});

test('preserva coleta anterior quando a mais recente tem erro em todas as salas', async (t) => {
  const directory = await fixture(t);
  const selected = await writeReport(directory, '20260922T190000000000', report());
  await writeReport(directory, '20260922T200000000000', report({ gerado_em: '2026-09-22T20:00:00Z', agendas: [{ nome: 'Sala', status: 'erro', erro: 'Google indisponível.' }] }));
  const agenda = await loadAgenda(2026, directory);
  assert.equal(agenda.arquivo, selected);
  assert.ok(agenda.avisos.some((warning) => warning.includes('coleta mais recente')));
});

test('retorna 404 claro se não há exportação concluída para o ano solicitado', async (t) => {
  const directory = await fixture(t);
  await writeReport(directory, '20260922T190000000000', report());
  await assert.rejects(loadAgenda(2027, directory), { status: 404 });
  await assert.rejects(loadAgenda(2026, path.join(directory, 'ausente')), { status: 404 });
});

test('permite uma sala vazia e mantém aviso se a única coleta contém erro', async (t) => {
  const directory = await fixture(t);
  await writeReport(directory, '20260922T190000000000', report({ gestao_sala: { eventos_na_sala: [] }, agendas: [{ status: 'erro', erro: 'Acesso recusado.' }] }));
  const agenda = await loadAgenda(2026, directory);
  assert.equal(agenda.eventos.length, 0);
  assert.ok(agenda.avisos.includes('Acesso recusado.'));
});

test('snapshot atual mais recente substitui o arquivo antigo mesmo quando a última reunião foi removida', async (t) => {
  const directory = await fixture(t);
  await writeReport(directory, '20260922T190000000000', report());
  await writeFile(path.join(directory, 'agenda-setembro-2026-atual.json'), JSON.stringify(report({ gerado_em: '2026-09-22T20:00:00Z', gestao_sala: { eventos_na_sala: [] }, emails_vinculados: [] })));
  await writeFile(path.join(directory, 'agenda-setembro-2026-atual.json.tmp'), JSON.stringify(report({ gerado_em: '2026-09-22T21:00:00Z' })));
  const result = await loadAgenda(2026, directory);
  assert.equal(result.arquivo, 'agenda-setembro-2026-atual.json');
  assert.deepEqual(result.eventos, []);
  assert.deepEqual(result.emailsVinculados, []);
});

function fakeProcess() {
  const process = new EventEmitter();
  process.killed = false;
  process.kill = () => { process.killed = true; return true; };
  return process;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('sincroniza com comando fixo sem shell e aceita exit 2 com coleta acessível', async () => {
  const child = fakeProcess();
  let spawned;
  const controller = createSyncController({
    python: 'python-seguro', collectorDir: 'C:/coletor', spawnProcess: (...args) => { spawned = args; return child; },
    load: async () => ({ geradoEm: new Date().toISOString(), salas: [{ status: 'acesso_limitado' }] }),
  });
  assert.equal(controller.start(2026).estado, 'executando');
  assert.equal(controller.start(2026).estado, 'executando');
  assert.equal(spawned[0], 'python-seguro');
  assert.deepEqual(spawned[1].slice(-2), ['--ano', '2026']);
  assert.ok(spawned[1].includes('--painel'));
  assert.equal(spawned[2].shell, false);
  assert.equal(spawned[2].windowsHide, true);
  assert.deepEqual(spawned[2].stdio, ['ignore', 'ignore', 'ignore']);
  child.emit('close', 2);
  await tick();
  assert.equal(controller.getState().estado, 'concluido');
  assert.match(controller.getState().mensagem, /ocultar/);
  controller.stop();
});

test('exit 2 não é anunciado como sucesso se só restaram dados anteriores', async () => {
  const child = fakeProcess();
  const controller = createSyncController({ spawnProcess: () => child, load: async () => ({ geradoEm: '2020-01-01T00:00:00Z', salas: [{ status: 'acesso_limitado' }] }) });
  controller.start(2026);
  child.emit('close', 2);
  await tick();
  assert.equal(controller.getState().estado, 'erro');
  controller.stop();
});

test('falhas do coletor não expõem stdout, stderr nem detalhes de autenticação', () => {
  const child = fakeProcess();
  const controller = createSyncController({ spawnProcess: () => child });
  controller.start(2026);
  child.emit('error', new Error('token=secret/path/to/credential'));
  assert.equal(controller.getState().estado, 'erro');
  assert.doesNotMatch(JSON.stringify(controller.getState()), /secret|credential/);
  controller.stop();
});

test('tempo limite encerra processo e permite uma nova tentativa', async () => {
  const child = fakeProcess();
  const controller = createSyncController({ spawnProcess: () => child, timeoutMs: 10 });
  controller.start(2026);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(controller.getState().estado, 'erro');
  assert.equal(child.killed, true);
  controller.stop();
});

test('pedidos manuais e automáticos se agrupam por ano e mantêm uma única execução com fila justa', async () => {
  const spawned = [];
  const controller = createSyncController({
    spawnProcess: (...args) => { const child = fakeProcess(); spawned.push({ child, args }); return child; },
    load: async () => ({ geradoEm: new Date().toISOString(), salas: [{ status: 'ok' }] }),
  });
  controller.start(2026, { automatic: true });
  controller.start(2026);
  controller.start(2027, { automatic: true });
  controller.start(2027);
  controller.start(2028, { automatic: true });
  controller.cancelAutomatic(2027); // A manual request keeps its place in the queue.
  controller.cancelAutomatic(2028); // A disconnected automatic-only request is dropped.
  assert.equal(spawned.length, 1);
  spawned[0].child.emit('close', 0);
  await tick();
  assert.equal(spawned.length, 2);
  assert.equal(spawned[1].args[1].at(-1), '2027');
  controller.start(2026, { automatic: true });
  assert.equal(spawned.length, 2);
  spawned[1].child.emit('close', 0);
  await tick();
  assert.equal(spawned.length, 3);
  assert.equal(spawned[2].args[1].at(-1), '2026');
  spawned[2].child.emit('close', 0);
  await tick();
  assert.equal(spawned.length, 3);
  controller.stop();
});

test('timeout não libera o bloqueio antes do encerramento real do processo', async () => {
  const children = [];
  const controller = createSyncController({ timeoutMs: 10, spawnProcess: () => { const child = fakeProcess(); children.push(child); return child; } });
  controller.start(2026);
  await new Promise((resolve) => setTimeout(resolve, 25));
  controller.start(2027);
  assert.equal(children.length, 1);
  assert.equal(children[0].killed, true);
  children[0].emit('close', 1);
  assert.equal(children.length, 2);
  controller.stop();
});

test('exit 2 com falha em uma das salas preserva o erro e não publica agenda parcial', async () => {
  const child = fakeProcess(), events = [];
  const controller = createSyncController({ spawnProcess: () => child, load: async () => ({ geradoEm: new Date().toISOString(), salas: [{ status: 'acesso_limitado' }, { status: 'erro' }] }) });
  controller.subscribe((event) => events.push(event));
  controller.start(2026);
  child.emit('close', 2);
  await tick();
  assert.equal(controller.getState().estado, 'erro');
  assert.ok(events.every((event) => !event.agenda));
  controller.stop();
});

async function withServer(t, options = {}) {
  const { server } = createApp(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('API entrega JSON, valida ano e não oferece CORS público', async (t) => {
  const port = await withServer(t, { load: async (year) => serializeReport(report({ ano: year }), 'exportacao.json') });
  const good = await call(port, '/api/agenda?ano=2026');
  assert.equal(good.status, 200);
  assert.equal(JSON.parse(good.text).periodo.ano, 2026);
  assert.equal(good.headers['access-control-allow-origin'], undefined);
  assert.equal((await call(port, '/api/agenda?ano=../token')).status, 400);
  assert.equal((await call(port, '/api/desconhecido')).status, 404);
  assert.equal((await call(port, '/api/agenda', { headers: { Host: 'externo.example' } })).status, 403);
});

test('POST bloqueia origem externa e exige JSON pequeno com ano', async (t) => {
  let started = 0;
  const syncController = { start: () => { started += 1; return { estado: 'executando' }; }, getState: () => ({ estado: 'ocioso' }), stop() {} };
  const port = await withServer(t, { syncController });
  const valid = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5175' }, body: '{"ano":2026}' };
  assert.equal((await call(port, '/api/sincronizar', { ...valid, headers: { ...valid.headers, Origin: 'https://externo.example' } })).status, 403);
  assert.equal((await call(port, '/api/sincronizar', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: valid.body })).status, 415);
  assert.equal((await call(port, '/api/sincronizar', { ...valid, body: '{}' })).status, 400);
  assert.equal((await call(port, '/api/sincronizar', { ...valid, body: '{"ano":[2026]}' })).status, 400);
  assert.equal((await call(port, '/api/sincronizar', { ...valid, headers: { ...valid.headers, 'Content-Length': '2048' }, body: ' '.repeat(2048) })).status, 413);
  assert.equal(started, 0);
  assert.equal((await call(port, '/api/sincronizar', valid)).status, 202);
  assert.equal(started, 1);
});

test('SSE bloqueia origem e Host externos e rejeita ano inválido antes de abrir a conexão', async (t) => {
  const port = await withServer(t);
  assert.equal((await call(port, '/api/eventos?ano=2026', { headers: { Origin: 'https://externo.example' } })).status, 403);
  assert.equal((await call(port, '/api/eventos?ano=2026', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(port, '/api/eventos?ano=2026', { headers: { Host: 'externo.example' } })).status, 403);
  assert.equal((await call(port, '/api/eventos?ano=../2026')).status, 400);
});

function openStream(port, year = 2026) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: `/api/eventos?ano=${year}` }, (response) => {
      const messages = [], waiters = [];
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!type || !data) continue;
          const message = { type, data: JSON.parse(data) };
          const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
          if (waiterIndex === -1) messages.push(message);
          else { const [waiter] = waiters.splice(waiterIndex, 1); clearTimeout(waiter.timer); waiter.resolve(message.data); }
        }
      });
      resolve({
        response,
        close() { req.destroy(); response.destroy(); for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('Stream encerrado.')); } },
        next(type, matches = () => true) {
          const predicate = (message) => message.type === type && matches(message.data);
          const index = messages.findIndex(predicate);
          if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0].data);
          return new Promise((resolve, reject) => {
            const waiter = { predicate, resolve, reject };
            waiter.timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error(`Não recebeu evento SSE ${type}.`)); }, 2000);
            waiters.push(waiter);
          });
        },
      });
    });
    req.once('error', reject);
    req.end();
  });
}

test('SSE HTTP liga coleta compartilhada, publica a alteração e a remoção para as duas abas', async (t) => {
  const children = [];
  let current = serializeReport(report({ gerado_em: '2020-01-01T00:00:00Z' }), 'agenda-setembro-2026-atual.json');
  const load = async () => current;
  const syncController = createSyncController({ load, spawnProcess: () => { const child = fakeProcess(); children.push(child); return child; } });
  const port = await withServer(t, { load, syncController });
  const streams = await Promise.all([openStream(port), openStream(port)]);
  t.after(() => streams.forEach((stream) => stream.close()));
  assert.equal(streams[0].response.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(streams[0].response.headers['access-control-allow-origin'], undefined);
  await Promise.all(streams.map((stream) => stream.next('agenda')));
  await Promise.all(streams.map((stream) => stream.next('estado', (state) => state.estado === 'executando')));
  assert.equal(children.length, 1);
  const manual = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ano":2026}' };
  assert.equal((await call(port, '/api/sincronizar', manual)).status, 202);
  assert.equal(children.length, 1);
  current = { ...current, geradoEm: new Date().toISOString(), eventos: [{ nome: 'Reunião recém-criada' }] };
  children[0].emit('close', 2);
  await Promise.all(streams.map((stream) => stream.next('agenda', (agenda) => agenda.eventos[0]?.nome === 'Reunião recém-criada')));
  await Promise.all(streams.map((stream) => stream.next('estado', (state) => state.estado === 'concluido')));
  await call(port, '/api/sincronizar', manual);
  assert.equal(children.length, 2);
  current = { ...current, geradoEm: new Date().toISOString(), eventos: [], emailsVinculados: [] };
  children[1].emit('close', 2);
  await Promise.all(streams.map((stream) => stream.next('agenda', (agenda) => agenda.eventos.length === 0)));
  streams.forEach((stream) => stream.close());
});

test('servidor estático serve SPA e bloqueia caminhos fora de dist e arquivos ocultos', async (t) => {
  const directory = await fixture(t);
  const distDir = path.join(directory, 'dist');
  await mkdir(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<h1>Agenda da sala</h1>');
  await writeFile(path.join(directory, 'token.json'), 'secret-token');
  await writeFile(path.join(distDir, '.env'), 'secret-env');
  const port = await withServer(t, { distDir });
  assert.equal((await call(port, '/salas')).text, '<h1>Agenda da sala</h1>');
  for (const pathname of ['/../token.json', '/%2e%2e/token.json', '/..%5ctoken.json', '/.env', '/ausente.js', '/%00']) {
    const response = await call(port, pathname);
    assert.equal(response.status, 404, pathname);
    assert.doesNotMatch(response.text, /secret-token|secret-env/);
  }
});
