import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HttpError } from './http-error.mjs';

export const COOKIE_NAME = 'sala_sessao';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos.';

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex'));
const base64url = (value) => Buffer.from(value).toString('base64url');

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function createAuth({
  domain = 'tauge.com',
  googleClientId = '',
  usersFile,
  secret = randomBytes(32).toString('hex'),
  ttlMs = SESSION_TTL_MS,
  crossSite = false,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const suffix = `@${domain.toLowerCase()}`;
  const failures = new Map();

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function createSession(email, nome) {
    const payload = base64url(JSON.stringify({ e: email, n: nome || '', x: now() + ttlMs }));
    return { token: `${payload}.${sign(payload)}`, maxAge: Math.floor(ttlMs / 1000) };
  }

  function readSession(request) {
    const cookie = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (!cookie) return null;
    const [payload, signature] = cookie.slice(COOKIE_NAME.length + 1).split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof data.e !== 'string' || !(data.x > now())) return null;
      return { email: data.e, nome: data.n || '' };
    } catch { return null; }
  }

  // Front em outro domínio (GitHub Pages): o cookie precisa ser SameSite=None e Secure (HTTPS).
  const attributes = crossSite ? 'HttpOnly; Secure; SameSite=None; Path=/' : 'HttpOnly; SameSite=Strict; Path=/';
  const cookieHeader = (token, maxAge) => `${COOKIE_NAME}=${token}; ${attributes}; Max-Age=${maxAge}`;

  function checkLock(key) {
    const entry = failures.get(key);
    if (entry?.until > now()) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.');
  }
  function registerFailure(key) {
    const entry = failures.get(key);
    const count = (entry && (!entry.until || entry.until > now()) ? entry.count : 0) + 1;
    failures.set(key, count >= MAX_FAILURES ? { count: 0, until: now() + LOCK_MS } : { count });
  }

  async function findUser(email) {
    if (!usersFile) return null;
    try {
      const { usuarios = [] } = JSON.parse(await readFile(usersFile, 'utf8'));
      return usuarios.find((user) => normalizeEmail(user.email) === email) || null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new HttpError(503, 'Não foi possível consultar os usuários cadastrados.');
    }
  }

  return {
    domain,
    googleClientId,
    publicConfig: () => ({ dominio: domain, googleClientId: googleClientId || null }),
    getSession: readSession,
    cookieHeader,
    clearCookie: () => `${COOKIE_NAME}=; ${attributes}; Max-Age=0`,

    async login(emailValue, password, ip = '') {
      const email = normalizeEmail(emailValue);
      if (!email.endsWith(suffix) || email.length <= suffix.length || typeof password !== 'string' || !password) {
        throw new HttpError(400, `Informe seu e-mail institucional (nome${suffix}) e a senha.`);
      }
      const keys = [`ip:${ip}`, `email:${email}`];
      keys.forEach(checkLock);
      const user = await findUser(email);
      // Sempre calcula o hash, para que a resposta não revele se o e-mail existe.
      const valid = verifyPassword(password.slice(0, 256), user?.hash || DUMMY_HASH) && Boolean(user);
      if (!valid) {
        keys.forEach(registerFailure);
        throw new HttpError(401, GENERIC_LOGIN_ERROR);
      }
      keys.forEach((key) => failures.delete(key));
      const session = createSession(email, user.nome);
      return { usuario: { email, nome: user.nome || '' }, session };
    },

    async loginWithGoogle(credential) {
      if (!googleClientId) throw new HttpError(503, 'O acesso com Google não está configurado.');
      if (typeof credential !== 'string' || credential.length < 20) throw new HttpError(400, 'Credencial do Google inválida.');
      let claims;
      try {
        const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('rejeitado');
        claims = await response.json();
      } catch { throw new HttpError(401, 'Não foi possível validar o acesso com Google.'); }
      const email = normalizeEmail(claims.email);
      const valid = claims.aud === googleClientId
        && GOOGLE_ISSUERS.has(claims.iss)
        && Number(claims.exp) * 1000 > now()
        && String(claims.email_verified) === 'true'
        && email.endsWith(suffix)
        && String(claims.hd || '').toLowerCase() === domain.toLowerCase();
      if (!valid) throw new HttpError(403, `Use uma conta Google do domínio ${suffix}.`);
      const nome = typeof claims.name === 'string' ? claims.name.slice(0, 120) : '';
      return { usuario: { email, nome }, session: createSession(email, nome) };
    },
  };
}
