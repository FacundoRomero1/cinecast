#!/usr/bin/env node
/**
 * scripts/cleanup.cjs
 * Limpieza previa a cada prueba:
 *  1. Mata (taskkill /T /F) los electron.exe cuyo ejecutable sea el de
 *     node_modules\electron\dist de ESTE proyecto.
 *  2. Mata los procesos node que escuchan en el puerto 3000 (netstat -ano).
 *  3. Confirma que el puerto 3000 quedó libre e imprime cuántos mató.
 *
 * Uso: node scripts/cleanup.cjs [puerto]
 */
const { execSync } = require('child_process');
const path = require('path');
const net = require('net');

const rootDir = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 3000;
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist').toLowerCase();

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch (err) {
    return (err && err.stdout) ? String(err.stdout) : '';
  }
}

function killTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (_) {
    return false;
  }
}

function listProjectElectron() {
  const out = sh(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"'
  ).trim();
  if (!out) return [];
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .filter((p) => p && p.ExecutablePath && String(p.ExecutablePath).toLowerCase().startsWith(electronDist))
    .map((p) => Number(p.ProcessId))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

function listPortListeners(port) {
  const out = sh('netstat -ano -p TCP');
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto  Local  Foreign  State  PID
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
    const local = cols[1];
    const state = cols[3].toUpperCase();
    const pid = Number(cols[4]);
    if (state !== 'LISTENING' && state !== 'ESCUCHANDO') continue;
    if (!local.endsWith(`:${port}`)) continue;
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
  }
  return [...pids];
}

function processName(pid) {
  const out = sh(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).trim();
  const m = out.match(/^"([^"]+)"/);
  return m ? m[1].toLowerCase() : '';
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[cleanup] Solo implementado para Windows; nada que hacer.');
    return;
  }

  let killedElectron = 0;
  for (const pid of listProjectElectron()) {
    if (killTree(pid)) killedElectron++;
  }

  let killedNode = 0;
  const skipped = [];
  for (const pid of listPortListeners(PORT)) {
    const name = processName(pid);
    if (name === 'node.exe') {
      if (killTree(pid)) killedNode++;
    } else if (name) {
      skipped.push(`${name}(${pid})`);
    }
  }

  let free = false;
  for (let i = 0; i < 20; i++) {
    if (await isPortFree(PORT)) {
      free = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(
    `[cleanup] electron.exe del proyecto matados: ${killedElectron} | node en :${PORT} matados: ${killedNode}` +
      (skipped.length ? ` | ignorados (no node): ${skipped.join(', ')}` : '')
  );
  console.log(`[cleanup] Puerto ${PORT}: ${free ? 'LIBRE' : 'OCUPADO'}`);
  process.exit(free ? 0 : 1);
}

main();

