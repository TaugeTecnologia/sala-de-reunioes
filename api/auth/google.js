import { applyCors, sendJson, getAuth } from '../_lib/cors.mjs';
import { HttpError } from '../../server/http-error.mjs';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { erro: 'Método não permitido.' });
  const auth = getAuth();
  try {
    const { usuario, session } = await auth.loginWithGoogle(req.body?.credential);
    sendJson(res, 200, { usuario, token: session.token }, { 'Set-Cookie': auth.cookieHeader(session.token, session.maxAge) });
  } catch (error) {
    sendJson(res, error instanceof HttpError ? error.status : 500, { erro: error instanceof HttpError ? error.message : 'Não foi possível concluir o login.' });
  }
}
