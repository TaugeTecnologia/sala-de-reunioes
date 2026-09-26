import { applyCors, sendJson, getAuth } from '../_lib/cors.mjs';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const auth = getAuth();
  const session = auth.getSession(req);
  sendJson(res, 200, { autenticado: Boolean(session), usuario: session, ...auth.publicConfig() });
}
