import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from './app.mjs';
import { createAuth } from './auth.mjs';

const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
const credential = 'x'.repeat(40);
const goodClaims = () => ({ aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Bia@tauge.com.br', email_verified: 'true', hd: 'tauge.com.br', name: 'Bia' });

async function setup(t, { authOptions = {}, appOptions = {} } = {}) {
  const auth = createAuth({ domain: 'tauge.com.br', googleClientId: CLIENT_ID, secret: 'segredo-de-teste', ...authOptions });
  const { server } = createApp({ auth, load: async () => ({ eventos: [] }), ...appOptions });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, { method = 'GET', body, cookie } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, port: server.address().port };
}
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
const googleOk = (claims = goodClaims()) => async () => ({ ok: true, json: async () => claims });

test('a API exige sessão; login com Google libera e o logout encerra', async (t) => {
  const { call } = await setup(t, { authOptions: { fetchImpl: googleOk() } });
  assert.equal((await call('/api/agenda')).status, 401);
  const session = await (await call('/api/auth/sessao')).json();
  assert.deepEqual([session.autenticado, session.dominio, session.googleClientId], [false, 'tauge.com.br', CLIENT_ID]);

  const login = await call('/api/auth/google', { method: 'POST', body: { credential } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = cookieOf(login);
  assert.equal((await call('/api/agenda', { cookie })).status, 200);
  assert.equal((await (await call('/api/auth/sessao', { cookie })).json()).usuario.email, 'bia@tauge.com.br');

  const logout = await call('/api/auth/sair', { method: 'POST', cookie });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('não existe mais login por senha', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/api/auth/entrar', { method: 'POST', body: { email: 'bia@tauge.com.br', senha: 'qualquer' } })).status, 404);
});

test('login com Google valida cliente, emissor, verificação e domínio', async (t) => {
  let claims = goodClaims();
  let response = { ok: true, json: async () => claims };
  const { call } = await setup(t, { authOptions: { fetchImpl: async () => response } });
  for (const change of [{ aud: 'outro' }, { hd: 'gmail.com' }, { hd: undefined }, { email: 'bia@gmail.com' }, { email: 'bia@tauge.com' }, { email_verified: 'false' }, { iss: 'evil.example' }, { exp: '1' }]) {
    claims = { ...goodClaims(), ...change };
    response = { ok: true, json: async () => claims };
    assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential } })).status, 403, JSON.stringify(change));
  }
  response = { ok: false, json: async () => ({}) };
  assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential } })).status, 401);
  assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential: 'curto' } })).status, 400);
});

test('sessão expirada ou adulterada é recusada', async (t) => {
  let time = 1_000_000;
  const claims = { ...goodClaims(), exp: String(Math.floor((time + 60_000) / 1000)) };
  const { call } = await setup(t, { authOptions: { now: () => time, ttlMs: 1000, fetchImpl: googleOk(claims) } });
  const cookie = cookieOf(await call('/api/auth/google', { method: 'POST', body: { credential } }));
  assert.equal((await call('/api/agenda', { cookie })).status, 200);
  assert.equal((await call('/api/agenda', { cookie: `${cookie}x` })).status, 401);
  time += 2000;
  assert.equal((await call('/api/agenda', { cookie })).status, 401);
});

test('sem GOOGLE_CLIENT_ID ninguém entra', async (t) => {
  const { call } = await setup(t, { authOptions: { googleClientId: '' } });
  assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential } })).status, 503);
});

test('front em outro domínio: CORS com cookies só para origens autorizadas', async (t) => {
  const front = 'https://taugetecnologia.github.io';
  const { port } = await setup(t, { authOptions: { crossSite: true, fetchImpl: googleOk() }, appOptions: { allowedOrigins: [front], allowedHosts: ['api.tauge.com.br'] } });
  const send = (route, { method = 'GET', origin, host = 'api.tauge.com.br', body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port, host: '127.0.0.1', path: route, method, headers: { Host: host, ...(origin ? { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let data = ''; res.on('data', (chunk) => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });

  const preflight = await send('/api/auth/google', { method: 'OPTIONS', origin: front });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], front);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');

  const login = await send('/api/auth/google', { method: 'POST', origin: front, body: { credential } });
  assert.equal(login.status, 200);
  assert.equal(login.headers['access-control-allow-origin'], front);
  assert.match(login.headers['set-cookie'][0], /Secure; SameSite=None/);

  assert.equal((await send('/api/auth/sessao', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await send('/api/auth/sessao', { origin: front, host: 'outro.exemplo.com' })).status, 403);
});

test('hosts iniciados por ponto valem para subdomínios', async (t) => {
  const { port } = await setup(t, { authOptions: {}, appOptions: { allowedHosts: ['.trycloudflare.com'] } });
  const status = (host) => new Promise((resolve, reject) => {
    const req = httpRequest({ port, host: '127.0.0.1', path: '/api/auth/sessao', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(await status('abc-def.trycloudflare.com'), 200);
  assert.equal(await status('trycloudflare.com.evil.example'), 403);
  assert.equal(await status('evil.example'), 403);
});
