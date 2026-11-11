const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'scratch', 'logs');
fs.mkdirSync(logsDir, { recursive: true });

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (_) {}
}

async function waitForHealth(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.status === 'ok' || data.buildId)) {
          return true;
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// Cada prueba de Electron se ejecuta a través de scripts/guard.cjs (límite de
// tiempo, log en scratch/logs/<nombre>.log y taskkill del árbol si se traba).
function runElectronScript(scriptRelPath, logName, timeoutSec = 150) {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn(
      process.execPath,
      [
        path.join(rootDir, 'scripts', 'guard.cjs'),
        String(timeoutSec),
        `--name=${logName}`,
        '--tail=0',
        '--',
        'electron',
        scriptRelPath,
        'http://localhost:3000',
      ],
      { cwd: rootDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('close', (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      resolve({ name: logName, passed: code === 0, elapsed, code, timeout: code === 124 });
    });
    proc.on('error', () => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      resolve({ name: logName, passed: false, elapsed, code: 1, timeout: false });
    });
  });
}

async function main() {
  // Limpieza previa (electron del proyecto y node en :3000)
  try {
    execSync(`"${process.execPath}" "${path.join(rootDir, 'scripts', 'cleanup.cjs')}"`, { stdio: 'inherit' });
  } catch (_) {
    // cleanup sale con 1 si el puerto sigue ocupado; lo verifica el chequeo siguiente
  }
  const occupied = await isPortInUse(3000);
  if (occupied) {
    console.error('[test-ui] Error: El puerto 3000 está ocupado. Abortando pruebas.');
    process.exit(1);
  }

  // Iniciar servidor de desarrollo
  const serverLogPath = path.join(logsDir, 'dev-server.log');
  const serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'w' });
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const serverProc = spawn(npmCmd, ['run', 'dev'], {
    cwd: rootDir,
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.pipe(serverLogStream);
  serverProc.stderr.pipe(serverLogStream);

  const ready = await waitForHealth('http://localhost:3000', 40000);
  if (!ready) {
    console.error('[test-ui] Error: El servidor de desarrollo no respondió a /api/health a tiempo.');
    killProcessTree(serverProc.pid);
    serverLogStream.end();
    process.exit(1);
  }

  const tests = [
    { name: 'smoke-ui', file: 'scripts/smoke-ui.cjs' },
    { name: 'e2e-remote', file: 'scripts/e2e-remote.cjs' },
    { name: 'probe-search-params', file: 'scripts/probe-search-params.cjs' },
    { name: 'probe-year-filter', file: 'scripts/probe-year-filter.cjs' },
    { name: 'probe-detail-episodes', file: 'scripts/probe-detail-episodes.cjs' },
  ];

  const results = [];
  for (const t of tests) {
    const res = await runElectronScript(t.file, t.name, 150);
    results.push(res);
  }

  // Apagar el servidor de desarrollo
  killProcessTree(serverProc.pid);
  serverLogStream.end();

  // Confirmar que el puerto 3000 quedó libre
  let portFree = false;
  for (let i = 0; i < 20; i++) {
    const inUse = await isPortInUse(3000);
    if (!inUse) {
      portFree = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Imprimir tabla
  console.log('| nombre | PASA/FALLA | segundos |');
  console.log('| :--- | :---: | :---: |');
  for (const r of results) {
    console.log(`| ${r.name} | ${r.passed ? 'PASA' : r.timeout ? 'FALLA (TIMEOUT)' : 'FALLA'} | ${r.elapsed}s |`);
  }

  if (portFree) {
    console.log('\nPuerto 3000 libre: OK');
  } else {
    console.warn('\nAdvertencia: El puerto 3000 sigue en uso.');
  }

  const allPassed = results.every((r) => r.passed);
  if (!allPassed || !portFree) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test-ui] Excepción no controlada:', err);
  process.exit(1);
});
