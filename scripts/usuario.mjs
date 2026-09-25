// Cadastra ou atualiza um usuário do painel: npm run usuario -- nome@dominio "Nome Completo"
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { hashPassword, normalizeEmail } from '../server/auth.mjs';

const domain = (process.env.EMAIL_DOMINIO || 'tauge.com').toLowerCase();
const file = path.resolve(process.env.USUARIOS_ARQUIVO || 'usuarios.json');
const email = normalizeEmail(process.argv[2]);
const nome = process.argv.slice(3).join(' ').trim();

if (!email.endsWith(`@${domain}`)) {
  console.error(`Uso: npm run usuario -- nome@${domain} "Nome Completo"`);
  process.exit(1);
}

function askPassword(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      rl._writeToOutput = (text) => { if (text === question) process.stdout.write(text); };
    }
    rl.question(question, (answer) => { rl.close(); if (process.stdin.isTTY) process.stdout.write('\n'); resolve(answer); });
  });
}

const senha = await askPassword('Senha (mínimo 10 caracteres): ');
if (senha.length < 10) { console.error('A senha precisa ter ao menos 10 caracteres.'); process.exit(1); }
if (process.stdin.isTTY && senha !== await askPassword('Repita a senha: ')) { console.error('As senhas não conferem.'); process.exit(1); }

let data = { usuarios: [] };
try { data = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const usuarios = (data.usuarios || []).filter((user) => normalizeEmail(user.email) !== email);
usuarios.push({ email, nome, hash: hashPassword(senha) });
await writeFile(file, `${JSON.stringify({ usuarios }, null, 2)}\n`, { mode: 0o660 });
console.log(`Usuário ${email} salvo em ${file}.`);
