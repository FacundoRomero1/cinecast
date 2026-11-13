#!/usr/bin/env node
/**
 * scripts/chaos-sync.cjs
 * Prueba de resiliencia y confiabilidad de sincronización entre Celular y PC.
 * Evalúa 5 escenarios bajo condiciones de caos de red y ciclo de vida:
 *  (a) Normal
 *  (b) WebSocket del celular terminado con terminate() cada 8 s
 *  (c) Celular offline 3 s cada 10 s (CDP Network.emulateNetworkConditions)
 *  (d) Celular oculto/visible cada 10 s (CDP Emulation.setFocusEmulationEnabled / visibility)
 *  (e) PC desconectada 3 s y vuelta (CDP Network.emulateNetworkConditions)
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const cp = require('child_process');

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name]) {
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        return netInfo.address;
      }
    }
  }
  return '127.0.0.1';
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    s.once('listening', () => {
      s.close(() => resolve(false));
    });
    s.listen(port, '0.0.0.0');
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await wait(600);
  }
  return false;
}

// IPC mocks necesarios para evitar bloqueos
ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('control-active-media', () => ({ ok: true }));
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('check-embed-providers', () => []);

let spawnedServer = null;
const globalTimeout = setTimeout(() => {
  console.error('[chaos-sync] TIMEOUT GLOBAL ALCANZADO (140s)');
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }
  app.exit(1);
}, 140000);

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

async function runScenario(scenarioKey, name, config, ctx) {
  const { winScreen, winPhone, baseUrl, roomId } = ctx;
  console.log(`\n================================================================================`);
  console.log(`[chaos-sync] Iniciando Escenario: ${name}`);
  console.log(`================================================================================`);

  // Limpiar estados e instrumentalizar receptores
  await winScreen.webContents.executeJavaScript(`
    window.__receivedCommands = [];
    if (window.__chaosUnsub) window.__chaosUnsub();
    window.__chaosUnsub = window.cinecastDeviceSync?.onCommand((cmd, fromDev) => {
      const now = Date.now();
      const cId = (cmd && (cmd.__chaosId || (cmd.payload && cmd.payload.__chaosId))) || '';
      window.__receivedCommands.push({
        id: cId,
        action: String(cmd?.action || ''),
        receivedAt: now,
      });
    });
    void 0;
  `);

  await winPhone.webContents.executeJavaScript(`
    window.__sentCommands = [];
    window.__receivedStates = [];
    if (window.__chaosStateUnsub) window.__chaosStateUnsub();
    window.__chaosStateUnsub = window.cinecastDeviceSync?.onStateSync((st) => {
      window.__receivedStates.push({
        timestamp: Date.now(),
        mediaId: st?.mediaId,
        currentTime: st?.currentTime,
      });
    });
    void 0;
  `);

  await wait(500);

  // Bucle de caos controlado
  let chaosRunning = true;
  const recoveryEvents = [];

  (async () => {
    while (chaosRunning) {
      if (scenarioKey === 'b') {
        await wait(8000);
        if (!chaosRunning) break;
        try {
          console.log('[chaos] Forzando terminate() en WS de celular...');
          await fetch(`${baseUrl}/api/sync/chaos/terminate-client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'remote' }),
          });
          recoveryEvents.push(Date.now());
        } catch (_) {}
      } else if (scenarioKey === 'c') {
        await wait(7000);
        if (!chaosRunning) break;
        try {
          console.log('[chaos] Celular offline (3s)...');
          await winPhone.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
            offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
          });
          await wait(3000);
          if (!chaosRunning) break;
          console.log('[chaos] Celular online recuperado');
          await winPhone.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
          });
          recoveryEvents.push(Date.now());
        } catch (_) {}
      } else if (scenarioKey === 'd') {
        await wait(7000);
        if (!chaosRunning) break;
        try {
          console.log('[chaos] Celular oculto (3s)...');
          await winPhone.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { focus: false });
          await winPhone.webContents.executeJavaScript(`
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
            document.dispatchEvent(new Event('visibilitychange'));
          `);
          await wait(3000);
          if (!chaosRunning) break;
          console.log('[chaos] Celular visible recuperado');
          await winPhone.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { focus: true });
          await winPhone.webContents.executeJavaScript(`
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
            document.dispatchEvent(new Event('visibilitychange'));
          `);
          recoveryEvents.push(Date.now());
        } catch (_) {}
      } else if (scenarioKey === 'e') {
        await wait(7000);
        if (!chaosRunning) break;
        try {
          console.log('[chaos] PC offline (3s)...');
          await winScreen.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
            offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
          });
          await wait(3000);
          if (!chaosRunning) break;
          console.log('[chaos] PC online recuperada');
          await winScreen.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
          });
          recoveryEvents.push(Date.now());
        } catch (_) {}
      } else {
        break;
      }
    }
  })();

  // Generación de 100 comandos únicos a ~5 por segundo con pausas aleatorias de 0 a 1.5s
  const TOTAL_COMMANDS = 100;
  console.log(`[chaos-sync] Enviando ${TOTAL_COMMANDS} comandos desde el celular...`);

  for (let i = 1; i <= TOTAL_COMMANDS; i++) {
    const cmdId = `chaos_${scenarioKey}_${i}_${Date.now()}`;
    let action = 'seekRelative';
    let payload = { seconds: i, __chaosId: cmdId };

    if (i % 3 === 2) {
      action = 'togglePlay';
      payload = { __chaosId: cmdId };
    } else if (i % 3 === 0) {
      action = 'navigateUp';
      payload = { __chaosId: cmdId };
    }

    await winPhone.webContents.executeJavaScript(`
      (function() {
        const cmdId = ${JSON.stringify(cmdId)};
        const action = ${JSON.stringify(action)};
        const payload = ${JSON.stringify(payload)};
        const now = Date.now();
        window.__sentCommands.push({ id: cmdId, action, payload, sentAt: now });
        if (window.cinecastDeviceSync) {
          window.cinecastDeviceSync.sendCommand({
            action: action,
            payload: payload,
            __chaosId: cmdId,
          });
        }
      })()
    `);

    // A ~7 por seg (140ms) con pequeñas pausas aleatorias cada 25 comandos
    if (i % 25 === 0) {
      const pause = 200 + Math.floor(Math.random() * 300);
      await wait(pause);
    } else {
      await wait(140);
    }
  }

  console.log(`[chaos-sync] Envío completado. Esperando 2s para absorción de mensajes...`);
  await wait(2000);

  chaosRunning = false;

  // Restaurar red de ambas ventanas si quedó alterada
  try {
    await winPhone.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
    });
    await winScreen.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
    });
  } catch (_) {}

  // Recolectar datos de la PC y del celular como cadenas JSON
  const receivedRaw = await winScreen.webContents.executeJavaScript(`
    JSON.stringify(window.__receivedCommands || [])
  `);
  const receivedList = JSON.parse(receivedRaw || '[]');

  const sentRaw = await winPhone.webContents.executeJavaScript(`
    JSON.stringify({
      commands: window.__sentCommands || [],
      states: window.__receivedStates || [],
    })
  `);
  const sentData = JSON.parse(sentRaw || '{"commands":[],"states":[]}');

  // Métricas
  const sentMap = new Map(sentData.commands.map((c) => [c.id, c]));
  const receivedIds = new Set();
  let duplicates = 0;
  const latencies = [];
  let outOfOrder = 0;
  let lastSentIndex = -1;

  for (const rc of receivedList) {
    if (!rc.id || !sentMap.has(rc.id)) continue;
    if (receivedIds.has(rc.id)) {
      duplicates++;
    } else {
      receivedIds.add(rc.id);
    }

    const sent = sentMap.get(rc.id);
    const lat = Math.max(0, rc.receivedAt - sent.sentAt);
    latencies.push(lat);

    const sentIdx = sentData.commands.findIndex((x) => x.id === rc.id);
    if (sentIdx < lastSentIndex) {
      outOfOrder++;
    }
    lastSentIndex = Math.max(lastSentIndex, sentIdx);
  }

  const uniqueDelivered = receivedIds.size;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const maxLat = latencies.length > 0 ? Math.max(...latencies) : 0;

  // Medir convergencia: tiempo tras cada evento de recuperación hasta ver un sync_state
  let convergenceTimes = [];
  for (const rev of recoveryEvents) {
    const nextState = sentData.states.find((s) => s.timestamp >= rev);
    if (nextState) {
      convergenceTimes.push(nextState.timestamp - rev);
    } else {
      convergenceTimes.push(3000); // penalización si no vio estado
    }
  }
  const avgConvergenceMs =
    convergenceTimes.length > 0
      ? Math.round(convergenceTimes.reduce((a, b) => a + b, 0) / convergenceTimes.length)
      : (scenarioKey === 'a' ? 0 : 500);

  const result = {
    key: scenarioKey,
    name,
    delivered: `${uniqueDelivered}/${TOTAL_COMMANDS}`,
    duplicates,
    outOfOrder,
    p50: `${p50} ms`,
    p95: `${p95} ms`,
    max: `${maxLat} ms`,
    convergence: `${(avgConvergenceMs / 1000).toFixed(2)} s`,
    deliveredNum: uniqueDelivered,
  };

  console.log(`[chaos-sync] Resultado Escenario (${scenarioKey}): ${JSON.stringify(result)}`);
  return result;
}

app.whenReady().then(async () => {
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log(`[chaos-sync] Levantando servidor en puerto ${port}...`);
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_TEST: '1', CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    const ready = await waitForHealth(`http://localhost:${port}`, 35000);
    if (!ready) {
      console.error('[chaos-sync] Servidor no respondió.');
      app.exit(1);
    }
  }

  const preloadPath = path.join(rootDir, 'electron', 'preload.cjs');

  // Ventana PC (screen)
  const winScreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:chaos-screen',
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ventana Celular (remote)
  const winPhone = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:chaos-phone',
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  winPhone.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  );

  console.log(`[chaos-sync] Cargando ventanas en ${baseUrl}...`);
  await Promise.all([
    winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo`),
    winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo`),
  ]);

  // Habilitar depuradores para CDP
  try {
    winScreen.webContents.debugger.attach('1.3');
    await winScreen.webContents.debugger.sendCommand('Network.enable');
  } catch (_) {}

  try {
    winPhone.webContents.debugger.attach('1.3');
    await winPhone.webContents.debugger.sendCommand('Network.enable');
    await winPhone.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await winPhone.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
  } catch (_) {}

  winScreen.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.error(`[winScreen error] ${msg}`);
  });
  winPhone.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.error(`[winPhone error] ${msg}`);
  });

  console.log('[chaos-sync] Esperando que ambas aplicaciones estén listas...');
  async function waitForAppReady(win, label, timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await win.webContents.executeJavaScript(`
          Boolean(window.cinecastDeviceSync && typeof window.cinecastDeviceSync.sendCommand === 'function')
        `);
        if (ready) {
          console.log(`[chaos-sync] ${label} lista.`);
          return true;
        }
      } catch (_) {}
      await wait(500);
    }
    console.error(`[chaos-sync] ${label} NO estuvo lista a tiempo.`);
    return false;
  }

  await waitForAppReady(winScreen, 'PC (screen)');
  await waitForAppReady(winPhone, 'Celular (remote)');
  await wait(1000);

  // Asegurar que la PC emita estado periódicamente para medir convergencia
  await winScreen.webContents.executeJavaScript(`
    if (!window.__stateBroadcastInterval) {
      window.__stateBroadcastInterval = setInterval(() => {
        if (window.cinecastDeviceSync) {
          window.cinecastDeviceSync.broadcastPlaybackState({
            mediaId: 'chaos-media-1',
            mediaTitle: 'Caos Sincronización',
            currentTime: Math.floor(Date.now() / 1000) % 3600,
            duration: 3600,
            isPlaying: true,
          });
        }
      }, 1000);
    }
    void 0;
  `);

  const ctx = { winScreen, winPhone, baseUrl, roomId: 'cine-home-1' };

  const scenarios = [
    { key: 'a', name: 'Normal (sin interferencias)' },
    { key: 'b', name: 'Caída de WS cada 8 s (terminate)' },
    { key: 'c', name: 'Celular offline 3 s cada 10 s (Network offline)' },
    { key: 'd', name: 'Celular oculto/visible cada 10 s (visibilitychange/focus)' },
    { key: 'e', name: 'PC desconectada 3 s y vuelta (Network offline)' },
  ];

  const results = [];
  for (const s of scenarios) {
    const res = await runScenario(s.key, s.name, {}, ctx);
    results.push(res);
    await wait(600);
  }

  console.log('\n================================================================================');
  console.log('TABLA DE MÉTRICAS - CHAOS-SYNC');
  console.log('================================================================================');
  console.log('| Escenario | Entregados únicos / 100 | Duplicados ejecutados | Desordenados | Latencia p50 | Latencia p95 | Latencia Máx | Convergencia |');
  console.log('| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const r of results) {
    console.log(`| (${r.key}) ${r.name} | ${r.delivered} | ${r.duplicates} | ${r.outOfOrder} | ${r.p50} | ${r.p95} | ${r.max} | ${r.convergence} |`);
  }
  console.log('================================================================================\n');

  clearTimeout(globalTimeout);
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }

  // Guardar resultado estructurado para comparación antes/después
  const outPath = path.join(rootDir, 'scratch', 'chaos-sync-report.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  } catch (_) {}

  app.exit(0);
});
