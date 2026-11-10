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

function runElectronScript(electronPath, scriptRelPath, logName, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const scriptPath = path.join(rootDir, scriptRelPath);
    const logPath = path.join(logsDir, `${logName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const start = Date.now();
    const proc = spawn(electronPath, [scriptPath, 'http://localhost:3000'], {
      cwd: rootDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      killProcessTree(proc.pid);
      logStream.write(`\n[test-ui] TIMEOUT de ${timeoutMs}ms alcanzado\n`);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      logStream.end();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const passed = !killed && code === 0;
      resolve({ name: logName, passed, elapsed, code });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      logStream.write(`\n[test-ui] Spawn error: ${err.message}\n`);
      logStream.end();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      resolve({ name: logName, passed: false, elapsed, code: 1 });
    });
  });
}

async function main() {
  const occupied = await isPortInUse(3000);
  if (occupied) {
    console.error('[test-ui] Error: El puerto 3000 está ocupado. Abortando pruebas.');
    process.exit(1);
  }

  // Resolver ejecutable oficial de Electron
  const electronPath = require('electron');

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
    const res = await runElectronScript(electronPath, t.file, t.name, 180000);
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
    console.log(`| ${r.name} | ${r.passed ? 'PASA' : 'FALLA'} | ${r.elapsed}s |`);
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
