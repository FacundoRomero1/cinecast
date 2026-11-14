const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { assertNoUserAppRunning } = require('./lib/testenv.cjs');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'scratch', 'logs');
fs.mkdirSync(logsDir, { recursive: true });

function runElectronScript(scriptRelPath, logName, timeoutSec = 150) {
  return new Promise((resolve) => {
    const start = Date.now();
    const electronBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    const proc = spawn(
      process.execPath,
      [
        path.join(rootDir, 'scripts', 'guard.cjs'),
        String(timeoutSec),
        electronBin,
        scriptRelPath,
      ],
      { cwd: rootDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('close', (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      try {
        fs.writeFileSync(path.join(logsDir, `${logName}.log`), out, 'utf8');
      } catch (_) {}
      resolve({ name: logName, passed: code === 0, elapsed, code, timeout: code === 124 });
    });
    proc.on('error', () => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      resolve({ name: logName, passed: false, elapsed, code: 1, timeout: false });
    });
  });
}

async function main() {
  assertNoUserAppRunning();
  try {
    execSync(`"${process.execPath}" "${path.join(rootDir, 'scripts', 'cleanup.cjs')}"`, { stdio: 'inherit' });
  } catch (_) {}

  const tests = [
    { name: 'smoke-ui', file: 'scripts/smoke-ui.cjs' },
    { name: 'e2e-touch', file: 'scripts/e2e-touch.cjs' },
  ];

  const results = [];
  for (const t of tests) {
    const res = await runElectronScript(t.file, t.name, 150);
    results.push(res);
  }

  console.log('| nombre | PASA/FALLA | segundos |');
  console.log('| :--- | :---: | :---: |');
  for (const r of results) {
    console.log(`| ${r.name} | ${r.passed ? 'PASA' : r.timeout ? 'FALLA (TIMEOUT)' : 'FALLA'} | ${r.elapsed}s |`);
  }

  const allPassed = results.every((r) => r.passed);
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test-ui] Excepción no controlada:', err);
  process.exit(1);
});
