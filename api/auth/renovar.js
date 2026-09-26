import { applyCors, sendJson, getAuth } from '../_lib/cors.mjs';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { erro: 'Método não permitido.' });
  const auth = getAuth();
  const session = auth.getSession(req);
  if (!session) return sendJson(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
  const renewed = auth.renewSession(session);
  sendJson(res, 200, { usuario: session, token: renewed.token }, { 'Set-Cookie': auth.cookieHeader(renewed.token, renewed.maxAge) });
}
