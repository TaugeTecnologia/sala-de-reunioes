import path from 'node:path';
import { createApp } from './app.mjs';
import { createAuth } from './auth.mjs';

const secret = process.env.SESSAO_SEGREDO;
if (!secret) console.warn('SESSAO_SEGREDO não definido: as sessões serão encerradas a cada reinicialização.');
const auth = createAuth({
  domain: process.env.EMAIL_DOMINIO || 'tauge.com',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  usersFile: path.resolve(process.env.USUARIOS_ARQUIVO || 'usuarios.json'),
  secret: secret || undefined,
});
if (!auth.googleClientId) console.warn('GOOGLE_CLIENT_ID não definido: o acesso com Google ficará indisponível.');
const { server, stop: stopApp } = createApp({ auth });
server.listen(8787, '127.0.0.1', () => {
  console.log('Painel de salas: http://127.0.0.1:8787');
});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'A porta 8787 já está em uso. Encerre o outro painel e tente novamente.' : 'Não foi possível iniciar o servidor local.');
  stopApp();
  process.exit(1);
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  stopApp();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', (message) => { if (message === 'shutdown') stop(); });
process.on('disconnect', stop);
