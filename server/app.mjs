import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRealtimeMonitor } from './realtime.mjs';
import { periodAt, monthPeriod } from '../src/lib/periods.js';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COLLECTOR_DIR = path.resolve(PROJECT_DIR, 'coletor');
export const EXPORT_DIR = path.join(COLLECTOR_DIR, 'exportacoes');
const LOCAL_ORIGINS = new Set(['http://127.0.0.1:8787', 'http://localhost:8787', 'http://127.0.0.1:5175', 'http://localhost:5175']);
const EVENT_FIELDS = ['chave', 'ical_uid', 'id_evento', 'nome', 'data', 'inicio', 'fim', 'inicio_legivel', 'fim_legivel', 'dia_inteiro', 'fim_exclusivo', 'duracao_minutos', 'criador', 'organizador', 'local', 'salas', 'participantes', 'descricao', 'tem_conferencia_online', 'modalidade', 'classificacao', 'motivo', 'bloqueio_confirmado', 'agenda_copia_utilizada', 'copias_encontradas', 'agendas_origem', 'avisos'];

import { HttpError } from './http-error.mjs';
export { HttpError };

export function parseYear(value = periodAt().ano) {
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,4}$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 9998) {
    throw new HttpError(400, 'Informe um ano inteiro entre 1 e 9998.');
  }
  return Number(value);
}

export function parseMonth(value = periodAt().mes) {
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,2}$/.test(String(value)) || Number(value) < 1 || Number(value) > 12) throw new HttpError(400, 'Informe um mês inteiro entre 1 e 12.');
  return Number(value);
}
const periodKey = (year, month) => monthPeriod(year, month).key;

const array = (value) => Array.isArray(value) ? value : [];
const usable = (report) => array(report.agendas).some((room) => ['ok', 'acesso_limitado'].includes(room.status));
const unique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];

export function serializeReport(report, filename, extraWarnings = []) {
  const rooms = array(report.agendas).map((room) => ({
    id: room.calendar_id || room.email || '',
    nome: room.nome || 'Sala de reunião',
    status: room.status || 'erro',
    aviso: room.aviso || room.erro || (room.status === 'acesso_limitado' ? 'O Google pode ocultar detalhes de eventos privados.' : null),
  }));
  const events = array(report.gestao_sala?.eventos_na_sala).map((event) => Object.fromEntries(
    EVENT_FIELDS.filter((field) => Object.hasOwn(event, field)).map((field) => [field, event[field]]),
  ));
  return {
    arquivo: path.basename(filename),
    geradoEm: report.gerado_em || null,
    periodo: { ano: report.ano, mes: report.mes, inicio: report.time_min || null, fim: report.time_max || null, fuso: report.fuso || 'UTC-03:00' },
    salas: rooms,
    eventos: events,
    emailsVinculados: unique(array(report.emails_vinculados)).sort(),
    avisos: unique([...extraWarnings, report.observacao, ...rooms.map((room) => room.aviso), ...events.flatMap((event) => array(event.avisos))]),
    coletaFinalizada: report.coleta_finalizada === true,
  };
}

export async function loadAgenda(year = periodAt().ano, exportDir = EXPORT_DIR, month = periodAt().mes) {
  year = parseYear(year);
  month = parseMonth(month);
  let entries;
  try { entries = await readdir(exportDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, 'Nenhuma exportação da sala foi encontrada. Sincronize os dados para começar.');
    throw new HttpError(503, 'Não foi possível ler as exportações da sala.');
  }
  const candidates = [];
  // Only collector exports are read. Credentials and unfinished .tmp files never enter this list.
  for (const entry of entries) {
    if (!entry.isFile() || !/^agenda-(?:setembro-\d{1,4}|\d{4}-\d{2})-(?:\d{8}T\d+Z|atual)\.json$/.test(entry.name)) continue;
    try {
      const fullPath = path.join(exportDir, entry.name);
      if ((await stat(fullPath)).size > 32 * 1024 * 1024) continue;
      const report = JSON.parse(await readFile(fullPath, 'utf8'));
      if (report.ano !== year || report.mes !== month || report.coleta_finalizada !== true || report.formato !== 'eventos_das_salas_v2' || report.origem_coleta !== 'agendas_das_salas' || !Array.isArray(report.gestao_sala?.eventos_na_sala)) continue;
      const expected = monthPeriod(year, month);
      if (Date.parse(report.time_min) !== Date.parse(expected.inicio) || Date.parse(report.time_max) !== Date.parse(expected.fim)) continue;
      const timestamp = Date.parse(report.gerado_em);
      candidates.push({ report, name: entry.name, timestamp: Number.isNaN(timestamp) ? 0 : timestamp });
    } catch {
      // An interrupted or invalid file does not hide the last complete export.
    }
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp || b.name.localeCompare(a.name));
  const selected = candidates.find(({ report }) => usable(report)) || candidates[0];
  if (!selected) throw new HttpError(404, `Ainda não há uma exportação concluída das salas para ${String(month).padStart(2, '0')}/${year}. Sincronize os dados.`);
  const warnings = selected !== candidates[0] ? ['A coleta mais recente apresentou falhas em todas as salas. Exibindo a última coleta concluída com dados acessíveis.'] : [];
  if (!usable(selected.report)) warnings.push('Todas as agendas apresentaram erro. Os eventos podem não estar disponíveis.');
  return serializeReport(selected.report, selected.name, warnings);
}

export function createSyncController({ spawnProcess = spawn, load = (year, month) => loadAgenda(year, EXPORT_DIR, month), timeoutMs = 180_000, collectorDir = COLLECTOR_DIR, python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3') } = {}) {
  const states = new Map();
  const listeners = new Set();
  const queue = [];
  let active = null;
  let stopped = false;
  let lastPeriod = periodAt();
  const idle = (ano, mes) => ({ estado: 'ocioso', ano, mes, mensagem: 'Pronto para atualizar os dados da sala.', iniciadoEm: null, finalizadoEm: null });
  const getState = (year = lastPeriod.ano, month = lastPeriod.mes) => ({ ...(states.get(periodKey(year, month)) || idle(year, month)) });
  const publish = (state, agenda) => {
    states.set(periodKey(state.ano, state.mes), state);
    lastPeriod = state;
    for (const listener of listeners) listener({ state: { ...state }, agenda });
  };
  const finish = (run, estado, mensagem, agenda) => {
    if (run.finished || active !== run || stopped) return;
    run.finished = true;
    clearTimeout(run.timer);
    publish({ ...getState(run.year, run.month), estado, mensagem, finalizadoEm: new Date().toISOString() }, agenda);
  };
  const release = (run) => {
    if (active !== run) return;
    clearTimeout(run.timer);
    active = null;
    pump();
  };
  const pump = () => {
    if (active || stopped || !queue.length) return;
    const run = queue.shift();
    active = run;
    run.started = new Date().toISOString();
    publish({ ...idle(run.year, run.month), estado: 'executando', mensagem: `Consultando a agenda da sala em ${String(run.month).padStart(2, '0')}/${run.year}…`, iniciadoEm: run.started });
    try {
      run.child = spawnProcess(python, ['-X', 'utf8', path.join(collectorDir, 'trazer-agenda-de-setembro.py'), '--painel', '--mes', String(run.month), '--ano', String(run.year)], {
        cwd: collectorDir, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      finish(run, 'erro', 'Não foi possível iniciar o coletor. Confira a instalação do Python e suas dependências.');
      release(run);
      return;
    }
    run.child.once('error', () => {
      finish(run, 'erro', 'Não foi possível executar o Python. Confira a instalação ou configure PYTHON_EXECUTABLE.');
      // A failed spawn has no process to wait for. A running process must close before another starts.
      if (!run.child.pid) release(run);
    });
    run.child.once('close', async (code) => {
      if (active !== run || stopped) return;
      clearTimeout(run.timer);
      if (run.finished) { release(run); return; }
      if (code !== 0 && code !== 2) {
        finish(run, 'erro', 'A consulta falhou. Confira a autorização do Google e a conexão; os últimos dados salvos continuam disponíveis.');
        release(run);
        return;
      }
      try {
        const agenda = await load(run.year, run.month);
        if (active !== run || stopped) return;
        const generated = Date.parse(agenda.geradoEm);
        if (!agenda.salas?.length || !agenda.salas.every((room) => ['ok', 'acesso_limitado'].includes(room.status)) || !Number.isFinite(generated) || generated < Date.parse(run.started)) {
          finish(run, 'erro', 'A consulta não produziu uma nova exportação completa e acessível. Os últimos dados salvos continuam disponíveis.');
        } else {
          const limited = code === 2 || agenda.salas.some((room) => room.status !== 'ok');
          finish(run, 'concluido', limited ? 'Consulta concluída. O Google pode ocultar detalhes privados; confira os avisos da agenda.' : 'Agenda da sala atualizada.', agenda);
        }
      } catch {
        finish(run, 'erro', 'A consulta terminou, mas nenhuma nova exportação pôde ser carregada. Os últimos dados salvos continuam disponíveis.');
      } finally { release(run); }
    });
    run.timer = setTimeout(() => {
      finish(run, 'erro', 'A consulta excedeu o tempo limite. Os últimos dados salvos continuam disponíveis.');
      // Keep the lock until close confirms that the process actually exited.
      run.child.kill();
    }, timeoutMs);
    run.timer.unref?.();
  };
  return {
    getState,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start(value, { automatic = false, month = periodAt().mes } = {}) {
      const year = parseYear(value);
      month = parseMonth(month);
      if (stopped) throw new HttpError(503, 'O painel está sendo encerrado.');
      const existing = (active?.year === year && active.month === month && !active.finished ? active : null) || queue.find((run) => run.year === year && run.month === month);
      if (existing) { if (!automatic) existing.automatic = false; return getState(year, month); }
      queue.push({ year, month, automatic, finished: false });
      if (active) publish({ ...idle(year, month), mensagem: 'Aguardando a consulta em andamento; os períodos são atualizados um por vez.' });
      pump();
      return getState(year, month);
    },
    cancelAutomatic(year, month = periodAt().mes) {
      const index = queue.findIndex((run) => run.year === year && run.month === month && run.automatic);
      if (index !== -1) queue.splice(index, 1);
    },
    stop() {
      if (stopped) return;
      queue.length = 0;
      if (active) {
        finish(active, 'erro', 'A consulta foi interrompida pelo encerramento do painel.');
        clearTimeout(active.timer);
        active.child?.kill();
      }
      stopped = true;
      listeners.clear();
    },
  };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(body));
}

async function jsonBody(request, limit = 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, 'Envie os dados em JSON.');
  if (Number(request.headers['content-length']) > limit) throw new HttpError(413, 'O pedido excede o tamanho permitido.');
  let body = '';
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, 'O pedido excede o tamanho permitido.');
    body += chunk.toString('utf8');
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch { throw new HttpError(400, 'Envie um objeto JSON válido.'); }
}

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

async function serveFrontend(request, response, pathname, distDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Endereço inválido.'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) throw new HttpError(404, 'Arquivo não encontrado.');
  const root = path.resolve(distDir);
  let target = path.resolve(root, `.${decoded}`);
  if (!within(root, target)) throw new HttpError(404, 'Arquivo não encontrado.');
  if (decoded === '/' || !path.extname(decoded)) target = path.join(root, 'index.html');
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!within(realRoot, realTarget) || !(await stat(realTarget)).isFile()) throw new HttpError(404, 'Arquivo não encontrado.');
    const content = await readFile(realTarget);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'ENOENT') throw new HttpError(404, 'Página não encontrada. Execute npm run build para preparar o painel.');
    throw new HttpError(503, 'Não foi possível carregar o painel.');
  }
}

async function handleAuth(auth, request, response, url) {
  const route = url.pathname.slice('/api/auth/'.length);
  if (route === 'sessao' && request.method === 'GET') {
    const session = auth?.getSession(request);
    sendJson(response, 200, { autenticado: !auth || Boolean(session), usuario: session || null, ...(auth?.publicConfig() ?? { dominio: null, googleClientId: null }) });
  } else if (!auth) {
    throw new HttpError(404, 'Rota da API não encontrada.');
  } else if (request.method === 'POST' && route === 'google') {
    const body = await jsonBody(request, 8192);
    const { usuario, session } = await auth.loginWithGoogle(body.credential);
    console.info(`[auth] login ok: ${usuario.email}`);
    sendJson(response, 200, { usuario, token: session.token }, { 'Set-Cookie': auth.cookieHeader(session.token, session.maxAge) });
  } else if (route === 'ticket' && request.method === 'POST') {
    const session = auth.getSession(request);
    if (!session) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    sendJson(response, 200, { ticket: auth.createTicket(session.email, session.nome) });
  } else if (route === 'renovar' && request.method === 'POST') {
    // Renovação deslizante: enquanto o painel está em uso, a sessão continua valendo.
    const session = auth.getSession(request);
    if (!session) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    const renewed = auth.renewSession(session);
    sendJson(response, 200, { usuario: session, token: renewed.token }, { 'Set-Cookie': auth.cookieHeader(renewed.token, renewed.maxAge) });
  } else if (route === 'sair' && request.method === 'POST') {
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  } else {
    throw new HttpError(404, 'Rota da API não encontrada.');
  }
}

export function createApp({ auth = null, allowedOrigins = [], allowedHosts = [], exportDir = EXPORT_DIR, distDir = path.join(PROJECT_DIR, 'dist'), syncController, load = (year, month) => loadAgenda(year, exportDir, month), realtimeOptions = {} } = {}) {
  const sync = syncController || createSyncController({ load });
  const realtime = createRealtimeMonitor({ sync, load, ...realtimeOptions });
  const streams = new Set();
  const trustedOrigins = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/, '')));
  const trustedHosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  // Entradas iniciadas por ponto (ex.: .trycloudflare.com) valem para qualquer subdomínio.
  const isTrustedHost = (name) => trustedHosts.has(name) || [...trustedHosts].some((entry) => entry.startsWith('.') && name.endsWith(entry));
  const stop = () => {
    realtime.stop();
    for (const response of streams) response.end();
    streams.clear();
    sync.stop();
  };
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    try {
      const host = (request.headers.host || '').toLowerCase();
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host) && !isTrustedHost(host.replace(/:\d+$/, ''))) throw new HttpError(403, 'Endereço de acesso não autorizado.');
      const rawPath = (request.url || '/').split('?')[0];
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        const origin = request.headers.origin;
        const trusted = Boolean(origin) && trustedOrigins.has(origin);
        const sameOrigin = !origin || LOCAL_ORIGINS.has(origin) || origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
        if (!trusted && (!sameOrigin || request.headers['sec-fetch-site'] === 'cross-site')) throw new HttpError(403, 'Origem não autorizada para acessar os dados.');
        if (trusted) {
          response.setHeader('Access-Control-Allow-Origin', origin);
          response.setHeader('Access-Control-Allow-Credentials', 'true');
          response.setHeader('Vary', 'Origin');
          if (request.method === 'OPTIONS') {
            response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
            response.end();
            return;
          }
        }
      }
      if (url.pathname.startsWith('/api/auth/')) {
        await handleAuth(auth, request, response, url);
        return;
      }
      if (auth && url.pathname.startsWith('/api/') && !auth.getSession(request) && !(url.pathname === '/api/eventos' && auth.readTicket(url.searchParams.get('ticket')))) {
        console.warn(`[auth] 401 ${url.pathname} (Authorization: ${request.headers.authorization ? 'sim' : 'não'}, cookie: ${request.headers.cookie ? 'sim' : 'não'})`);
        throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      }
      if (url.pathname === '/api/agenda' && request.method === 'GET') {
        sendJson(response, 200, await load(parseYear(url.searchParams.get('ano') ?? undefined), parseMonth(url.searchParams.get('mes') ?? undefined)));
      } else if (url.pathname === '/api/eventos' && request.method === 'GET') {
        const year = parseYear(url.searchParams.get('ano') ?? undefined);
        const month = parseMonth(url.searchParams.get('mes') ?? undefined);
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        response.flushHeaders();
        request.socket.setTimeout(0);
        streams.add(response);
        response.write('retry: 3000\n\n');
        const disconnect = realtime.subscribe(year, (event, data) => {
          if (!response.destroyed && !response.writableEnded) {
            // A stalled client should reconnect instead of buffering unlimited private data.
            if (response.writableLength > 1024 * 1024) response.destroy();
            else response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        }, month);
        const heartbeat = setInterval(() => {
          if (!response.destroyed && !response.writableEnded) response.write(': conectado\n\n');
        }, 15_000);
        heartbeat.unref?.();
        response.once('close', () => { clearInterval(heartbeat); disconnect(); streams.delete(response); });
      } else if (url.pathname === '/api/sincronizacao' && request.method === 'GET') {
        sendJson(response, 200, realtime.getState(parseYear(url.searchParams.get('ano') ?? undefined), parseMonth(url.searchParams.get('mes') ?? undefined)));
      } else if (url.pathname === '/api/sincronizar' && request.method === 'POST') {
        const body = await jsonBody(request);
        if (!Object.hasOwn(body, 'ano')) throw new HttpError(400, 'Informe o ano da coleta.');
        sendJson(response, 202, sync.start(parseYear(body.ano), { month: parseMonth(body.mes) }));
      } else if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Rota da API não encontrada.');
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        await serveFrontend(request, response, rawPath, distDir);
      } else throw new HttpError(405, 'Método não permitido.');
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { erro: error instanceof HttpError ? error.message : 'Não foi possível concluir a operação.' });
    }
  });
  server.maxConnections = 32;
  server.on('close', stop);
  return { server, sync, realtime, stop };
}
