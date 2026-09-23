import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.connected) child.send('shutdown', () => {});
    else child.kill();
  }
  const forced = setTimeout(() => { for (const child of children) child.kill(); }, 1500);
  forced.unref();
}

function run(args, ipc = false) {
  const child = spawn(process.execPath, args, { cwd: projectDir, shell: false, windowsHide: true, stdio: ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit' });
  children.push(child);
  child.on('error', () => { console.error('Não foi possível iniciar o painel. Execute npm install e tente novamente.'); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 0); });
}

run(['server/index.mjs'], true);
run(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort']);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
