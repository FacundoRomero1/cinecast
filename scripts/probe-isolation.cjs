#!/usr/bin/env node
/**
 * scripts/probe-isolation.cjs
 *
 * Prueba de aislamiento (PARTE 0 - Paso 3):
 * 1. Comprueba que no haya una app real del usuario corriendo.
 * 2. Toma hashes SHA-256 de public/data/watch_history.json y de todos los archivos de .cinecast-data (o su ausencia).
 * 3. Levanta un servidor "del usuario" simulado en el puerto 3000 con sala cine-home-1 y un cliente WebSocket
 *    (rol screen en cine-home-1) que registra todos los mensajes recibidos.
 * 4. Corre smoke-ui, e2e-touch y chaos-sync (--only=a) usando testenv.
 * 5. Verifica que el servidor "del usuario" en :3000 reciba 0 mensajes de comando y que los hashes de
 *    public/data/watch_history.json y .cinecast-data no cambien.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const {
  ROOT,
  assertNoUserAppRunning,
  registerPid,
  unregisterPid,
  killPidTree,
  waitHealth,
} = require('./lib/testenv.cjs');

function sha256File(fp) {
  if (!fs.existsSync(fp)) return 'ABSENT';
  const buf = fs.readFileSync(fp);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listFilesRecursive(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results = results.concat(listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      results.push({ rel, full, hash: sha256File(full) });
    }
  }
  return results.sort((a, b) => a.rel.localeCompare(b.rel));
}

function snapshotState() {
  const historyPath = path.join(ROOT, 'public', 'data', 'watch_history.json');
  const cinecastDataDir = path.join(ROOT, '.cinecast-data');
  const historyHash = sha256File(historyPath);
  const dataDirExists = fs.existsSync(cinecastDataDir);
  const dataFiles = listFilesRecursive(cinecastDataDir);
  return {
    historyHash,
    dataDirExists,
    dataFiles,
  };
}

function formatSnapshotSummary(snap) {
  let dataSummary = 'ABSENT (directorio no existe)';
  if (snap.dataDirExists) {
    if (snap.dataFiles.length === 0) {
      dataSummary = 'EMPTY (0 archivos)';
    } else {
      const treeHash = crypto
        .createHash('sha256')
        .update(snap.dataFiles.map((f) => `${f.rel}:${f.hash}`).join('\n'))
        .digest('hex');
      dataSummary = `${snap.dataFiles.length} archivos (tree-sha256: ${treeHash.slice(0, 16)}...)`;
    }
  }
  return {
    watchHistorySha256: snap.historyHash,
    cinecastDataSummary: dataSummary,
  };
}

function snapshotsEqual(a, b) {
  if (a.historyHash !== b.historyHash) return false;
  if (a.dataDirExists !== b.dataDirExists) return false;
  if (a.dataFiles.length !== b.dataFiles.length) return false;
  for (let i = 0; i < a.dataFiles.length; i++) {
    if (a.dataFiles[i].rel !== b.dataFiles[i].rel || a.dataFiles[i].hash !== b.dataFiles[i].hash) {
      return false;
    }
  }
  return true;
}

function runGuardedElectron(scriptRel, extraArgs = [], timeoutSec = 150) {
  return new Promise((resolve) => {
    const start = Date.now();
    const electronBin = path.join(
      ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron.cmd' : 'electron'
    );
    const guardScript = path.join(ROOT, 'scripts', 'guard.cjs');
    const child = spawn(
      process.execPath,
      [guardScript, String(timeoutSec), electronBin, scriptRel, ...extraArgs],
      {
        cwd: ROOT,
        env: { ...process.env },
        stdio: 'inherit',
      }
    );
    child.on('exit', (code) => {
      resolve({
        script: `${scriptRel}${extraArgs.length ? ' ' + extraArgs.join(' ') : ''}`,
        code: code ?? 1,
        elapsedSec: ((Date.now() - start) / 1000).toFixed(1),
      });
    });
  });
}

async function main() {
  assertNoUserAppRunning();
  registerPid(process.pid, { role: 'probe-isolation-runner' });

  const beforeSnap = snapshotState();
  const beforeFormatted = formatSnapshotSummary(beforeSnap);
  console.log('\n================================================================================');
  console.log('[probe-isolation] Estado inicial de archivos reales:');
  console.log(`  public/data/watch_history.json : ${beforeFormatted.watchHistorySha256}`);
  console.log(`  .cinecast-data                 : ${beforeFormatted.cinecastDataSummary}`);
  console.log('================================================================================\n');

  // Levantar servidor "del usuario" simulado en puerto 3000 con su propio dataDir temporal para no crear .cinecast-data
  const simUserDir = path.join(ROOT, 'scratch', 'test-data', `sim-user-3000-${Date.now()}`);
  fs.mkdirSync(simUserDir, { recursive: true });
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const userSrv = spawn(process.execPath, [tsxCli, 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '3000',
      CINECAST_PORT: '3000',
      CINECAST_DATA_DIR: simUserDir,
      CINECAST_DISABLE_PREWARM: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  registerPid(userSrv.pid, {
    role: 'simulated-user-server-3000',
    port: 3000,
    room: 'cine-home-1',
    parentPid: process.pid,
  });

  let wsClient = null;
  const allWsMessages = [];
  const commandMessages = [];

  try {
    await waitHealth(3000, 25000);
    console.log(`[probe-isolation] Servidor "del usuario" activo en :3000 (PID ${userSrv.pid}, sala cine-home-1)`);

    wsClient = new WebSocket('ws://127.0.0.1:3000/ws');
    await new Promise((resolve, reject) => {
      wsClient.once('open', resolve);
      wsClient.once('error', reject);
    });

    wsClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        allWsMessages.push(msg);
        if (
          msg.type === 'command' ||
          msg.type === 'sync_command' ||
          msg.type === 'remote_command'
        ) {
          commandMessages.push(msg);
        }
      } catch (_) {}
    });

    wsClient.send(
      JSON.stringify({
        type: 'join',
        roomId: 'cine-home-1',
        deviceId: 'user-pc-screen-main',
        deviceName: 'PC del Usuario (Puerto 3000)',
        deviceType: 'screen',
      })
    );

    await new Promise((r) => setTimeout(r, 500));

    // Correr las 3 suites con testenv
    const suiteRuns = [];
    console.log('\n[probe-isolation] 1/3 Ejecutando smoke-ui.cjs...');
    suiteRuns.push(await runGuardedElectron('scripts/smoke-ui.cjs', [], 150));

    console.log('\n[probe-isolation] 2/3 Ejecutando e2e-touch.cjs...');
    suiteRuns.push(await runGuardedElectron('scripts/e2e-touch.cjs', [], 150));

    console.log('\n[probe-isolation] 3/3 Ejecutando chaos-sync.cjs --only=a...');
    suiteRuns.push(await runGuardedElectron('scripts/chaos-sync.cjs', ['--only=a'], 150));

    // También consultar /api/sync/poll en el servidor :3000 para verificar cola HTTP de cine-home-1
    let polledCommands = [];
    try {
      const pollRes = await fetch('http://127.0.0.1:3000/api/sync/poll?roomId=cine-home-1&since=0');
      if (pollRes.ok) {
        const pollJson = await pollRes.json();
        polledCommands = pollJson.commands || [];
      }
    } catch (_) {}

    const afterSnap = snapshotState();
    const afterFormatted = formatSnapshotSummary(afterSnap);
    const hashesUnchanged = snapshotsEqual(beforeSnap, afterSnap);
    const totalUserCommands = commandMessages.length + polledCommands.length;
    const allSuitesPassed = suiteRuns.every((r) => r.code === 0);
    const isolationPassed = totalUserCommands === 0 && hashesUnchanged;
    const globalStatus = !isolationPassed ? 'FALLA' : (!allSuitesPassed ? 'PARCIAL' : 'PASA');

    console.log('\n================================================================================');
    console.log('RESULTADO PROBE-ISOLATION (PARTE 0 - Paso 3)');
    console.log('================================================================================');
    console.log('| Verificación | Antes | Después / Valor | Estado |');
    console.log('| :--- | :--- | :--- | :---: |');
    console.log(
      `| Comandos recibidos en :3000 (cine-home-1) | 0 | WS=${commandMessages.length}, Poll=${polledCommands.length} (Total=${totalUserCommands}) | ${totalUserCommands === 0 ? 'PASA' : 'FALLA'} |`
    );
    console.log(
      `| Hash public/data/watch_history.json | ${beforeFormatted.watchHistorySha256.slice(0, 16)}... | ${afterFormatted.watchHistorySha256.slice(0, 16)}... | ${beforeSnap.historyHash === afterSnap.historyHash ? 'PASA' : 'FALLA'} |`
    );
    console.log(
      `| Archivos en .cinecast-data | ${beforeFormatted.cinecastDataSummary} | ${afterFormatted.cinecastDataSummary} | ${hashesUnchanged ? 'PASA' : 'FALLA'} |`
    );
    for (const run of suiteRuns) {
      console.log(
        `| Sub-prueba: ${run.script} | exit 0 | exit ${run.code} (${run.elapsedSec}s) | ${run.code === 0 ? 'PASA' : 'FALLA'} |`
      );
    }
    console.log('================================================================================');
    console.log(`Resultado global probe-isolation: ${globalStatus}\n`);

    process.exitCode = globalStatus === 'PASA' ? 0 : 1;
  } finally {
    if (wsClient) {
      try {
        wsClient.close();
      } catch (_) {}
    }
    killPidTree(userSrv.pid);
    unregisterPid(process.pid);
    try {
      fs.rmSync(simUserDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('[probe-isolation] Error fatal:', err);
  unregisterPid(process.pid);
  process.exit(1);
});

