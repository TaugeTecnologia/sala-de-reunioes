import { createApp } from './app.mjs';

const { server, stop: stopApp } = createApp();
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
