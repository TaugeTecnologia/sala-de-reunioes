import { applyCors, sendJson, getAuth } from './_lib/cors.mjs';

// Sem processo contínuo no Vercel: cada consulta a /api/agenda já busca dados frescos.
// Este endpoint só existe para o painel mostrar um estado coerente ("Agenda atualizada").
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const auth = getAuth();
  if (!auth.getSession(req)) return sendJson(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
  const ano = Number(req.query.ano) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;
  sendJson(res, 200, { estado: 'concluido', ano, mes, intervaloSegundos: 5, mensagem: 'Consulta direta a cada atualização.' });
}
