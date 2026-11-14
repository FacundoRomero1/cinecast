#!/usr/bin/env node
/**
 * scripts/guard.cjs
 *
 * Ejecuta cualquier comando de prueba con un límite estricto de tiempo.
 * Registra el PID lanzado en scratch/.pids.json y al vencer el tiempo o salir
 * mata ÚNICAMENTE el árbol del PID que lanzó (taskkill /PID <child.pid> /T /F).
 *
 * Uso:
 *   node scripts/guard.cjs <segundos> <comando> [args...]
 */

const { spawn } = require('child_process');
const {
  registerPid,
  unregisterPid,
  killPidTree,
  assertNoUserAppRunning,
} = require('./lib/testenv.cjs');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Uso: node scripts/guard.cjs <timeout_segundos> <comando> [args...]');
  process.exit(2);
}

const timeoutSec = Number(args[0]);
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
  console.error(`[guard] Timeout inválido: ${args[0]}`);
  process.exit(2);
}

// Comprobar que no esté corriendo la app del usuario en puerto 3000 o electron.exe externo
if (process.env.CINECAST_SKIP_USER_CHECK !== '1') {
  assertNoUserAppRunning();
}

const cmd = args[1];
const cmdArgs = args.slice(2);
const timeoutMs = Math.round(timeoutSec * 1000);

console.log(`[guard] Iniciando (límite ${timeoutSec}s): ${cmd} ${cmdArgs.join(' ')}`);
const startTime = Date.now();

const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  shell: useShell,
  windowsHide: false,
  env: childEnv,
});

if (child.pid) {
  registerPid(child.pid, {
    role: 'guard-child',
    cmd: `${cmd} ${cmdArgs.join(' ')}`,
    parentPid: process.pid,
  });
}

let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`\n[guard] TIMEOUT (${elapsed}s > ${timeoutSec}s). Matando árbol del PID ${child.pid}...`);
  if (child.pid) {
    killPidTree(child.pid);
  }
  process.exit(124);
}, timeoutMs);

child.on('error', (err) => {
  clearTimeout(timer);
  if (child.pid) unregisterPid(child.pid);
  console.error(`[guard] Error al lanzar "${cmd}": ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (child.pid) {
    killPidTree(child.pid);
  }
  if (timedOut) {
    process.exit(124);
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (signal) {
    console.error(`[guard] Proceso terminado por señal ${signal} tras ${elapsed}s`);
    process.exit(1);
  }
  console.log(`[guard] Finalizado con código ${code ?? 0} en ${elapsed}s`);
  process.exit(code ?? 0);
});
