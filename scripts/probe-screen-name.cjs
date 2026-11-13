#!/usr/bin/env node
/**
 * scripts/probe-screen-name.cjs
 * Verificación de estabilidad del nombre de pantalla seleccionada en el control remoto.
 * Evalúa 6 escenarios:
 *  (a) reposo 20 s
 *  (b) servidor cierra WebSocket de la PC con terminate() cada 5 s
 *  (c) la PC recarga su ventana 3 veces
 *  (d) el celular pasa offline 3 s y vuelve
 *  (e) un segundo celular se une y se va
 *  (f) el celular se une por polling HTTP
 *
 * Mide cada 200 ms:
 *  - Nombre en cabecera ("Controlando pantalla: ...")
 *  - Nombre en RemotePanel ("Ninguna pantalla..." / nombre)
 *  - connectedScreenName y selectedScreenId
 *  - Dispositivos en lista (duplicados screen, remotes)
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

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) { }
    await wait(500);
  }
  return false;
}

// IPC mocks
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
  console.error('[probe-screen-name] TIMEOUT GLOBAL ALCANZADO (140s)');
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) { }
  }
  app.exit(1);
}, 140000);

app.whenReady().then(async () => {
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const roomId = 'room_screen_test_' + Date.now();

  const isHealthy = await waitForHealth(baseUrl, 3000);
  if (!isHealthy) {
    console.log('[probe-screen-name] Iniciando servidor local...');
    const rootDir = path.resolve(__dirname, '..');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_BROWSER: '1',
      CINECAST_DISABLE_PREWARM: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });
    const ready = await waitForHealth(baseUrl, 25000);
    if (!ready) {
      console.error('[probe-screen-name] No se pudo levantar el servidor.');
      app.exit(1);
      return;
    }
  }

  // Ventana Pantalla (PC)
  const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');
  const winScreen = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ventana Celular (Remote)
  const winPhone = new BrowserWindow({
    width: 390,
    height: 844,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const screenUrl = `${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`;
  const phoneUrl = `${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`;

  console.log(`[probe-screen-name] Cargando pantalla: ${screenUrl}`);
  await winScreen.loadURL(screenUrl);

  console.log(`[probe-screen-name] Cargando celular: ${phoneUrl}`);
  await winPhone.loadURL(phoneUrl);

  // Adjuntar CDP en celular para emulación táctil
  try {
    winPhone.webContents.debugger.attach('1.3');
    await winPhone.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
  } catch (e) {
    console.warn('[probe-screen-name] Debugger attach error:', e.message);
  }

  // Esperar a que se establezca la conexión
  await wait(3000);

  // Muestreador cada 200 ms
  const samples = [];
  let samplingActive = true;
  let currentScenario = 'inicio';

  const sampleSampler = async () => {
    while (samplingActive) {
      try {
        const phoneData = await winPhone.webContents.executeJavaScript(`
          (function() {
            const rt = window.__cinecastRuntime || {};
            const sync = window.cinecastDeviceSync;
            let headerName = null;
            let panelName = null;
            let sheetName = null;
            try {
              const h = document.querySelector('p.text-xs.text-zinc-400 strong');
              if (h) headerName = h.textContent.trim();
            } catch (_) {}
            try {
              const p = document.querySelector('div.flex-1.min-w-0 p.text-sm.font-extrabold');
              if (p) panelName = p.textContent.trim();
            } catch (_) {}
            try {
              const spans = Array.from(document.querySelectorAll('span'));
              const s = spans.find((el) => el.className && el.className.includes('text-[10px]'));
              if (s) sheetName = s.textContent.trim();
            } catch (_) {}
            
            return {
              headerName,
              panelName,
              sheetName,
              connectedScreenName: rt.connectedScreenName || null,
              selectedScreenId: rt.selectedScreenId || null,
              devices: typeof sync?.getDevices === 'function' ? sync.getDevices() : (rt.devices || []),
              localDeviceId: typeof sync?.getDeviceId === 'function' ? sync.getDeviceId() : null,
            };
          })()
        `);

        // Leer también los dispositivos directamente del servidor
        let serverDevices = [];
        try {
          const res = await fetch(`${baseUrl}/api/rooms/${roomId}/devices`);
          if (res.ok) {
            const data = await res.json();
            serverDevices = data.devices || [];
          }
        } catch (_) { }

        samples.push({
          time: Date.now(),
          scenario: currentScenario,
          phoneData,
          serverDevices,
        });
      } catch (_) { }
      await wait(200);
    }
  };

  const samplerPromise = sampleSampler();

  console.log('\n--- Escenario (a): reposo 20 s ---');
  currentScenario = 'a';
  await wait(20000);

  console.log('\n--- Escenario (b): el servidor cierra WebSocket de la PC con terminate() cada 5 s (15 s) ---');
  currentScenario = 'b';
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`[b] Terminate WS PC #${i + 1}`);
      await fetch(`${baseUrl}/api/sync/chaos/terminate-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'screen' }),
      });
    } catch (_) { }
    await wait(5000);
  }

  console.log('\n--- Escenario (c): la PC recarga su ventana 3 veces ---');
  currentScenario = 'c';
  for (let i = 0; i < 3; i++) {
    console.log(`[c] Recarga PC #${i + 1}`);
    winScreen.reload();
    await wait(3500);
  }

  console.log('\n--- Escenario (d): el celular pasa offline 3 s y vuelve ---');
  currentScenario = 'd';
  try {
    console.log('[d] Celular offline (3s)...');
    await winPhone.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    await wait(3000);
    console.log('[d] Celular online recuperado');
    await winPhone.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await wait(3000);
  } catch (err) {
    console.warn('[d] Error offline:', err.message);
  }

  console.log('\n--- Escenario (e): un segundo celular se une y se va ---');
  currentScenario = 'e';
  try {
    console.log('[e] Segundo celular se une...');
    await fetch(`${baseUrl}/api/sync/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        deviceId: 'dev_phone_segundo_999',
        deviceName: 'Segundo Celular',
        deviceType: 'remote',
      }),
    });
    await wait(3000);
    console.log('[e] Segundo celular se va...');
    // Se va (sin heartbeat o delete)
    await wait(3000);
  } catch (err) {
    console.warn('[e] Error segundo celular:', err.message);
  }

  console.log('\n--- Escenario (f): el celular se une por polling HTTP ---');
  currentScenario = 'f';
  try {
    console.log('[f] Forzando celular a HTTP polling (cerrando su WS)...');
    await winPhone.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.stopWsForTesting?.();
      }
    `);
    await fetch(`${baseUrl}/api/sync/chaos/terminate-client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'remote' }),
    });
    await wait(5000);
  } catch (err) {
    console.warn('[f] Error polling HTTP:', err.message);
  }

  // Detener muestreo
  samplingActive = false;
  await samplerPromise;

  // Análisis de muestras
  console.log('\n================================================================================');
  console.log('REPORTE Y ANÁLISIS DE MUESTRAS (scripts/probe-screen-name.cjs)');
  console.log('================================================================================');

  let lastName = null;
  let lastScreenId = null;
  const timelineChanges = [];
  let remoteNameAppearedCount = 0;
  let multipleScreensCount = 0;
  let nameChangesCount = 0;

  const startTime = samples[0]?.time || Date.now();

  for (const s of samples) {
    const elapsedSec = ((s.time - startTime) / 1000).toFixed(1);
    const pData = s.phoneData || {};
    const curName = pData.connectedScreenName || pData.headerName || pData.panelName;
    const curScreenId = pData.selectedScreenId;
    const devices = pData.devices || [];
    const serverDevs = s.serverDevices || [];

    // Detectar si aparece el nombre de un remote
    const remoteDevs = devices.filter((d) => d.type === 'remote');
    const isRemoteName = remoteDevs.some((r) => r.name === curName);
    if (isRemoteName || curName === 'Segundo Celular' || curName === 'Celular Control') {
      remoteNameAppearedCount++;
    }

    // Detectar si la lista de dispositivos tuvo 2 pantallas (pantallas fantasma duplicadas)
    const screensOnServer = serverDevs.filter((d) => d.type === 'screen');
    const screensOnClient = devices.filter((d) => d.type === 'screen');
    if (screensOnServer.length > 1 || screensOnClient.length > 1) {
      multipleScreensCount++;
    }

    // Detectar cambio de nombre o id
    if (lastName !== null && (curName !== lastName || curScreenId !== lastScreenId)) {
      nameChangesCount++;
      timelineChanges.push({
        elapsed: `${elapsedSec}s`,
        scenario: s.scenario,
        fromName: lastName,
        toName: curName,
        fromId: lastScreenId,
        toId: curScreenId,
      });
    }

    lastName = curName;
    lastScreenId = curScreenId;
  }

  console.log(`Total muestras recogidas: ${samples.length}`);
  console.log(`Cambios de nombre/id registrados: ${nameChangesCount}`);
  console.log(`Apariciones de nombre de dispositivo 'remote': ${remoteNameAppearedCount}`);
  console.log(`Veces que hubo >1 pantalla ('screen') en la lista: ${multipleScreensCount}`);

  console.log('\n--- Línea de tiempo de cambios detectados ---');
  if (timelineChanges.length === 0) {
    console.log('Sin cambios de nombre registrados.');
  } else {
    console.table(timelineChanges);
  }

  console.log('\n--- Resumen por Escenario ---');
  const scenarios = ['a', 'b', 'c', 'd', 'e', 'f'];
  const scenarioSummary = scenarios.map((sc) => {
    const scSamples = samples.filter((s) => s.scenario === sc);
    const scChanges = timelineChanges.filter((c) => c.scenario === sc).length;
    const scRemoteHits = scSamples.filter((s) => {
      const name = s.phoneData?.connectedScreenName || s.phoneData?.headerName;
      return name === 'Segundo Celular' || name === 'Celular Control';
    }).length;
    const scMultipleScreens = scSamples.filter((s) => {
      const screens = (s.serverDevices || []).filter((d) => d.type === 'screen');
      return screens.length > 1;
    }).length;
    return {
      Escenario: sc,
      Muestras: scSamples.length,
      'Cambios Nombre': scChanges,
      'Apariciones Remote': scRemoteHits,
      'Pantallas Fantasma (>1)': scMultipleScreens,
    };
  });
  console.table(scenarioSummary);

  const pass = nameChangesCount === 0 && remoteNameAppearedCount === 0 && multipleScreensCount === 0;
  console.log(`\nResultado global: ${pass ? 'PASA' : 'FALLA'}`);

  clearTimeout(globalTimeout);
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) { }
  }
  winScreen.destroy();
  winPhone.destroy();

  app.exit(pass ? 0 : 1);
});

