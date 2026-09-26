import { applyCors, sendJson, getAuth } from '../_lib/cors.mjs';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { erro: 'Método não permitido.' });
  const auth = getAuth();
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
}
