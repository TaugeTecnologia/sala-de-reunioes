import { createApp } from './app.mjs';
import { createAuth } from './auth.mjs';

const secret = process.env.SESSAO_SEGREDO;
if (!secret) console.warn('SESSAO_SEGREDO não definido: as sessões serão encerradas a cada reinicialização.');
const list = (value) => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const allowedOrigins = list(process.env.ORIGENS_PERMITIDAS);
const allowedHosts = list(process.env.HOSTS_PERMITIDOS);
const listenHost = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORTA) || 8787;
const auth = createAuth({
  crossSite: allowedOrigins.length > 0,
  domain: process.env.EMAIL_DOMINIO || 'tauge.com.br',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  secret: secret || undefined,
});
if (!auth.googleClientId) console.warn('GOOGLE_CLIENT_ID não definido: ninguém conseguirá entrar (o login é somente pelo Google).');
const { server, stop: stopApp } = createApp({ auth, allowedOrigins, allowedHosts });
server.listen(port, listenHost, () => {
  console.log(`Painel de salas: http://${listenHost}:${port}`);
});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Encerre o outro painel e tente novamente.` : 'Não foi possível iniciar o servidor local.');
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
