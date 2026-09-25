import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { createAuth, hashPassword, verifyPassword } from './auth.mjs';

const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';

async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sala-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const usersFile = path.join(dir, 'usuarios.json');
  await writeFile(usersFile, JSON.stringify({ usuarios: [{ email: 'Ana@tauge.com', nome: 'Ana', hash: hashPassword('senha-correta-1') }] }));
  const auth = createAuth({ domain: 'tauge.com', googleClientId: CLIENT_ID, usersFile, secret: 'segredo-de-teste', ...options });
  const load = async () => ({ eventos: [] });
  const { server } = createApp({ auth, load, syncController: { getState() {}, subscribe() { return () => {}; }, start() {}, cancelAutomatic() {}, stop() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, { method = 'GET', body, cookie } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { auth, call };
}

const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];

test('hash de senha valida somente a senha correta', () => {
  const hash = hashPassword('outra-senha-123');
  assert.equal(verifyPassword('outra-senha-123', hash), true);
  assert.equal(verifyPassword('errada', hash), false);
  assert.equal(verifyPassword('x', 'formato-invalido'), false);
});

test('a API exige sessão e libera após o login com e-mail e senha', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/api/agenda')).status, 401);
  const session = await (await call('/api/auth/sessao')).json();
  assert.deepEqual([session.autenticado, session.dominio, session.googleClientId], [false, 'tauge.com', CLIENT_ID]);

  const login = await call('/api/auth/entrar', { method: 'POST', body: { email: ' ANA@tauge.com ', senha: 'senha-correta-1' } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = cookieOf(login);
  assert.equal((await call('/api/agenda', { cookie })).status, 200);
  assert.equal((await (await call('/api/auth/sessao', { cookie })).json()).usuario.email, 'ana@tauge.com');

  const logout = await call('/api/auth/sair', { method: 'POST', cookie });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('rejeita senha errada, e-mail desconhecido e domínio de fora com mensagem genérica', async (t) => {
  const { call } = await setup(t);
  const wrong = await call('/api/auth/entrar', { method: 'POST', body: { email: 'ana@tauge.com', senha: 'errada' } });
  const unknown = await call('/api/auth/entrar', { method: 'POST', body: { email: 'ninguem@tauge.com', senha: 'senha-correta-1' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  const outside = await call('/api/auth/entrar', { method: 'POST', body: { email: 'ana@gmail.com', senha: 'senha-correta-1' } });
  assert.equal(outside.status, 400);
});

test('bloqueia temporariamente após várias tentativas erradas', async (t) => {
  const { call } = await setup(t);
  for (let i = 0; i < 5; i += 1) await call('/api/auth/entrar', { method: 'POST', body: { email: 'ana@tauge.com', senha: 'errada' } });
  const locked = await call('/api/auth/entrar', { method: 'POST', body: { email: 'ana@tauge.com', senha: 'senha-correta-1' } });
  assert.equal(locked.status, 429);
});

test('sessão expirada ou adulterada é recusada', async (t) => {
  let time = 1_000_000;
  const { call } = await setup(t, { now: () => time, ttlMs: 1000 });
  const login = await call('/api/auth/entrar', { method: 'POST', body: { email: 'ana@tauge.com', senha: 'senha-correta-1' } });
  const cookie = cookieOf(login);
  assert.equal((await call('/api/agenda', { cookie })).status, 200);
  assert.equal((await call('/api/agenda', { cookie: `${cookie}x` })).status, 401);
  time += 2000;
  assert.equal((await call('/api/agenda', { cookie })).status, 401);
});

test('login com Google valida cliente, emissor, verificação e domínio', async (t) => {
  const claims = { aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Bia@tauge.com', email_verified: 'true', hd: 'tauge.com', name: 'Bia' };
  let response = { ok: true, json: async () => claims };
  const { call } = await setup(t, { fetchImpl: async () => response });
  const credential = 'x'.repeat(40);

  const ok = await call('/api/auth/google', { method: 'POST', body: { credential } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/api/agenda', { cookie: cookieOf(ok) })).status, 200);

  for (const change of [{ aud: 'outro' }, { hd: 'gmail.com' }, { email: 'bia@gmail.com' }, { email_verified: 'false' }, { iss: 'evil.example' }, { exp: '1' }]) {
    response = { ok: true, json: async () => ({ ...claims, ...change }) };
    assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential } })).status, 403, JSON.stringify(change));
  }
  response = { ok: false, json: async () => ({}) };
  assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential } })).status, 401);
});

test('sem GOOGLE_CLIENT_ID o acesso com Google fica indisponível', async (t) => {
  const { call } = await setup(t, { googleClientId: '' });
  assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential: 'x'.repeat(40) } })).status, 503);
});
