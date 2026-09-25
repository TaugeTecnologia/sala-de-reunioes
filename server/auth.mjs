import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http-error.mjs';

export const COOKIE_NAME = 'sala_sessao';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const base64url = (value) => Buffer.from(value).toString('base64url');

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function createAuth({
  domain = 'tauge.com.br',
  googleClientId = '',
  secret = randomBytes(32).toString('hex'),
  ttlMs = SESSION_TTL_MS,
  crossSite = false,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const suffix = `@${domain.toLowerCase()}`;

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function createSession(email, nome) {
    const payload = base64url(JSON.stringify({ e: email, n: nome || '', x: now() + ttlMs }));
    return { token: `${payload}.${sign(payload)}`, maxAge: Math.floor(ttlMs / 1000) };
  }

  // Bilhete de curta duração, só para abrir o fluxo /api/eventos (EventSource não envia cabeçalhos).
  function createTicket(email, nome) {
    const payload = base64url(JSON.stringify({ e: email, n: nome || '', x: now() + TICKET_TTL_MS, t: 1 }));
    return `${payload}.${sign(payload)}`;
  }

  function parseToken(token) {
    if (typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof data.e === 'string' && data.x > now() ? data : null;
    } catch { return null; }
  }

  // A sessão vem no cabeçalho Authorization (funciona com o front em outro domínio, sem depender
  // de cookies de terceiros) ou no cookie (painel aberto direto pelo servidor).
  function readSession(request) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization || '')?.[1];
    const cookie = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
    for (const token of [bearer, cookie?.slice(COOKIE_NAME.length + 1)]) {
      const data = parseToken(token);
      if (data && !data.t) return { email: data.e, nome: data.n || '' };
    }
    return null;
  }

  function readTicket(ticket) {
    const data = parseToken(ticket);
    return data?.t ? { email: data.e, nome: data.n || '' } : null;
  }

  // Front em outro domínio (GitHub Pages): o cookie precisa ser SameSite=None e Secure (HTTPS).
  const attributes = crossSite ? 'HttpOnly; Secure; SameSite=None; Path=/' : 'HttpOnly; SameSite=Strict; Path=/';
  const cookieHeader = (token, maxAge) => `${COOKIE_NAME}=${token}; ${attributes}; Max-Age=${maxAge}`;

  return {
    domain,
    googleClientId,
    publicConfig: () => ({ dominio: domain, googleClientId: googleClientId || null }),
    getSession: readSession,
    createTicket,
    readTicket,
    renewSession: (session) => createSession(session.email, session.nome),
    cookieHeader,
    clearCookie: () => `${COOKIE_NAME}=; ${attributes}; Max-Age=0`,

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
