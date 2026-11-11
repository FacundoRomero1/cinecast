#!/usr/bin/env node
/**
 * scripts/guard.cjs
 * Ejecuta un comando con límite de tiempo, salida a scratch/logs/<nombre>.log.
 *
 * Uso:
 *   node scripts/guard.cjs <segundos> [--name=<nombre>] [--tail=<n>] -- <comando> [args...]
 *
 * - "node" se resuelve al node actual y "electron" al ejecutable de
 *   node_modules/electron (siempre SIN ELECTRON_RUN_AS_NODE).
 * - Cualquier otro comando (npx, npm, ...) se ejecuta con shell.
 * - Al terminar muestra el final del log.
 * - Si vence el tiempo: taskkill /PID <pid> /T /F, imprime "TIMEOUT" y sale con 124.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'scratch', 'logs');

function usage(msg) {
  if (msg) console.error(`[guard] ${msg}`);
  console.error('Uso: node scripts/guard.cjs <segundos> [--name=<nombre>] [--tail=<n>] -- <comando> [args...]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 1) usage('Falta "--" o los segundos.');
const opts = argv.slice(0, sep);
const cmdParts = argv.slice(sep + 1);
if (cmdParts.length === 0) usage('Falta el comando.');

const seconds = Number(opts[0]);
if (!Number.isFinite(seconds) || seconds <= 0) usage(`Segundos inválidos: ${opts[0]}`);
let name = '';
let tailLines = 40;
for (const o of opts.slice(1)) {
  if (o.startsWith('--name=')) name = o.slice(7);
  else if (o.startsWith('--tail=')) tailLines = Math.max(0, Number(o.slice(7)) || 0);
  else usage(`Opción desconocida: ${o}`);
}

const [cmd, ...args] = cmdParts;
if (!name) {
  const scriptArg = cmdParts.find((a) => /\.(c|m)?(j|t)s$/i.test(a));
  name = scriptArg
    ? path.basename(scriptArg).replace(/\.[^.]+$/, '')
    : cmdParts.slice(0, 2).join('-');
}
name = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'guard';

fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `${name}.log`);
const logFd = fs.openSync(logPath, 'w');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

let exe = cmd;
let useShell = false;
if (cmd === 'node') {
  exe = process.execPath;
} else if (cmd === 'electron') {
  exe = require(path.join(rootDir, 'node_modules', 'electron'));
} else {
  useShell = true;
}

function quote(a) {
  if (a === '') return '""';
  return /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

const start = Date.now();
const child = useShell
  ? spawn([exe, ...args].map(quote).join(' '), { cwd: rootDir, env, shell: true, stdio: ['ignore', logFd, logFd], windowsHide: true })
  : spawn(exe, args, { cwd: rootDir, env, stdio: ['ignore', logFd, logFd], windowsHide: true });

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (_) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}, seconds * 1000);

function finish(code) {
  clearTimeout(timer);
  try { fs.closeSync(logFd); } catch (_) {}
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  let content = '';
  try { content = fs.readFileSync(logPath, 'utf8'); } catch (_) {}
  const lines = content.split(/\r?\n/);
  if (tailLines > 0) {
    console.log(`----- [guard] últimas ${tailLines} líneas de scratch/logs/${name}.log -----`);
    console.log(lines.slice(-tailLines).join('\n'));
    console.log('----- [guard] fin del log -----');
  }
  if (timedOut) {
    console.log(`[guard] TIMEOUT tras ${seconds}s (${name}); árbol de procesos terminado.`);
    process.exit(124);
  }
  console.log(`[guard] ${name}: código de salida ${code} en ${elapsed}s`);
  process.exit(typeof code === 'number' ? code : 1);
}

child.on('error', (err) => {
  try { fs.writeSync(logFd, `\n[guard] Error al lanzar: ${err.message}\n`); } catch (_) {}
  finish(1);
});
child.on('exit', (code) => finish(code));

