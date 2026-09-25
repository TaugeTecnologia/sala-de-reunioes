import test from 'node:test';
import assert from 'node:assert/strict';
import { connectAgenda, connectionLabel, shouldAcceptAgenda } from './live.js';

class FakeEventSource extends EventTarget {
  static last;
  constructor(url) { super(); this.url = url; this.closed = false; FakeEventSource.last = this; }
  close() { this.closed = true; }
  send(type, value) { this.dispatchEvent(new MessageEvent(type, { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
}

function connect(year = 2026, month = 9) {
  const received = { agendas: [], states: [], connections: [] };
  const stop = connectAgenda({ year, month, onAgenda: value => received.agendas.push(value), onState: value => received.states.push(value),
    onConnection: value => received.connections.push(value), EventSourceClass: FakeEventSource });
  return { ...received, stop, stream: FakeEventSource.last };
}

const agenda = (events, year = 2026) => ({ periodo: { ano: year, mes: 9 }, eventos: events, salas: [{ id: 'sala' }] });

test('cache antigo de reconexão e GET atrasado não restauram eventos já removidos', () => {
  const old = { ...agenda([{ nome: 'Evento anterior' }]), geradoEm: '2026-09-22T10:00:00Z' };
  const current = { ...agenda([]), geradoEm: '2026-09-22T10:01:00Z' };
  assert.equal(shouldAcceptAgenda(old, current), false);
  assert.equal(shouldAcceptAgenda(current, old), true);
  assert.equal(shouldAcceptAgenda(current, current), true);
  assert.equal(shouldAcceptAgenda({ ...old, geradoEm: null }, current), false);
  assert.equal(shouldAcceptAgenda({ ...old, periodo: { ano: 2027 } }, current), true);
});

test('recebe criação, alteração e remoção de eventos sem recarregar a página', () => {
  const client = connect();
  assert.equal(client.stream.url, '/api/eventos?ano=2026&mes=9');
  client.stream.send('open', '');
  client.stream.send('agenda', agenda([{ nome: 'Original', inicio: '2026-09-22T09:00:00-03:00' }]));
  client.stream.send('agenda', agenda([{ nome: 'Alterado', inicio: '2026-09-22T10:00:00-03:00' }]));
  client.stream.send('agenda', agenda([]));
  assert.deepEqual(client.agendas.map(a => a.eventos.length), [1, 1, 0]);
  assert.equal(client.agendas[1].eventos[0].nome, 'Alterado');
  assert.deepEqual(client.connections, ['conectando', 'conectado']);
  client.stop();
});

test('falha de conexão e consulta não apagam os últimos dados recebidos', () => {
  const client = connect();
  client.stream.send('agenda', agenda([{ nome: 'Preservado' }]));
  client.stream.send('error', '');
  client.stream.send('estado', { ano: 2026, mes: 9, estado: 'erro', mensagem: 'Aguardando nova tentativa.' });
  assert.equal(client.agendas.length, 1);
  assert.equal(client.agendas[0].eventos[0].nome, 'Preservado');
  assert.equal(client.connections.at(-1), 'reconectando');
  client.stream.send('open', '');
  client.stream.send('agenda', agenda([]));
  assert.equal(client.connections.at(-1), 'conectado');
  assert.deepEqual(client.agendas.at(-1).eventos, []);
  client.stop();
});

test('troca de ano fecha conexão antiga e ignora mensagens atrasadas ou malformadas', () => {
  const old = connect();
  old.stop();
  old.stream.send('agenda', agenda([{ nome: 'Não pode reaparecer' }]));
  assert.equal(old.stream.closed, true);
  assert.equal(old.agendas.length, 0);
  const current = connect(2027);
  current.stream.send('agenda', '{invalid');
  current.stream.send('agenda', agenda([], 2026));
  current.stream.send('agenda', { periodo: { ano: 2027 } });
  current.stream.send('estado', { ano: 2026, mes: 9, estado: 'concluido' });
  current.stream.send('agenda', agenda([], 2027));
  assert.equal(current.agendas.length, 1);
  assert.equal(current.states.length, 0);
  current.stop();
});

test('identifica conexão e frequência sem anunciar atualização instantânea', () => {
  assert.match(connectionLabel('conectado', { estado: 'concluido', intervaloSegundos: 2 }), /2s/);
  assert.match(connectionLabel('conectado', { estado: 'concluido' }), /2s/);
  assert.match(connectionLabel('conectado', { estado: 'executando' }), /Consultando/);
  assert.match(connectionLabel('conectado', { estado: 'erro' }), /Falha/);
  assert.match(connectionLabel('reconectando'), /Conexão interrompida/);
  const connections = [];
  const stop = connectAgenda({ year: 2026, EventSourceClass: null, onConnection: value => connections.push(value) });
  assert.deepEqual(connections, ['conectando', 'indisponivel']);
  stop();
});

test('troca de mês no mesmo ano isola eventos e estados e fecha a conexão anterior', () => {
  const september = connect(2027, 9);
  september.stop();
  const october = connect(2027, 10);
  assert.equal(october.stream.url, '/api/eventos?ano=2027&mes=10');
  october.stream.send('agenda', agenda([], 2027));
  october.stream.send('estado', { ano: 2027, mes: 9, estado: 'erro' });
  assert.equal(october.agendas.length, 0);
  assert.equal(october.states.length, 0);
  october.stream.send('agenda', { ...agenda([], 2027), periodo: { ano: 2027, mes: 10 } });
  october.stream.send('estado', { ano: 2027, mes: 10, estado: 'concluido' });
  assert.equal(october.agendas.length, 1);
  assert.equal(october.states.length, 1);
  october.stop();
});
