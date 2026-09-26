// CORS para as funções Node do Vercel: só a origem do front (GitHub Pages) chama a API,
// com cookies. Sem essa origem configurada, a API fica só acessível pelo próprio backend.
export function applyCors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.origin;
  if (allowed && origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res, status, body, headers = {}) {
  res.status(status);
  for (const [key, value] of Object.entries({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })) res.setHeader(key, value);
  res.json(body);
}

import { createAuth } from '../../server/auth.mjs';

let cached = null;
export function getAuth() {
  // Uma função do Vercel pode ficar "quente" entre chamadas; evita recriar o objeto à toa.
  cached ||= createAuth({
    domain: process.env.EMAIL_DOMINIO || 'tauge.com.br',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    secret: process.env.SESSAO_SEGREDO,
    crossSite: true,
  });
  return cached;
}
