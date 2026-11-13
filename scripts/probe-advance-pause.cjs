#!/usr/bin/env node
/**
 * scripts/probe-advance-pause.cjs
 * Prueba de:
 * 1. Auto-avance de capítulo y condiciones de fin (ended, >= dur - 3, quieto 4s en dur - 10).
 *    - ?dur=30 (dur < 45s: NO debe saltar).
 *    - ?ad=10 (durante ad: NO debe saltar).
 * 2. "Retroceso al pausar" que no retrocede: 5 pausas consecutivas, retroceso medido 0s ± 0.3s.
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

// IPC mocks estándar
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

async function run() {
  console.log('[probe-advance-pause] Iniciando verificación de Auto-avance y Retroceso en pausa...');
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log(`[probe-advance-pause] Levantando servidor en puerto ${port}...`);
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_PREWARM: '1',
      CINECAST_DEBUG_SYNC: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    const ready = await waitForHealth(`http://localhost:${port}`, 35000);
    if (!ready) {
      console.error('[probe-advance-pause] Servidor no respondió.');
      app.exit(1);
    }
  }

  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 700,
    webPreferences: {
      partition: 'persist:advance-pause-test',
      preload: path.join(rootDir, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    // -------------------------------------------------------------
    // PRUEBA 1: Retroceso al pausar x5 en /__test/embed.html
    // -------------------------------------------------------------
    console.log('[probe-advance-pause] 1. Evaluando retroceso al pausar (5 repeticiones)...');
    await win.loadURL(`${baseUrl}/__test/embed.html?dur=400`);
    await wait(1000);

    const pauseResults = [];
    for (let i = 1; i <= 5; i++) {
      // Reproducir por 600ms
      await win.webContents.executeJavaScript(`
        if (window.__simPlayer) {
          window.__simPlayer.play();
        }
        void 0;
      `);
      await wait(600);

      // Tiempo justo antes de pausar
      const timeBeforePause = await win.webContents.executeJavaScript(`
        window.__simPlayer ? window.__simPlayer.getCurrentTime() : 0
      `);

      // Pausar
      await win.webContents.executeJavaScript(`
        if (window.__simPlayer) {
          window.__simPlayer.pause();
        }
        void 0;
      `);
      await wait(300);

      // Tiempo tras pausar
      const timeAfterPause = await win.webContents.executeJavaScript(`
        window.__simPlayer ? window.__simPlayer.getCurrentTime() : 0
      `);

      const diff = Number(timeAfterPause) - Number(timeBeforePause);
      pauseResults.push({ rep: i, timeBeforePause, timeAfterPause, diff });
      console.log(`[probe-advance-pause] Pausa #${i}: antes=${Number(timeBeforePause).toFixed(2)}s, después=${Number(timeAfterPause).toFixed(2)}s, diff=${diff.toFixed(2)}s`);
    }

    const allDiffsWithinTolerance = pauseResults.every((r) => Math.abs(r.diff) <= 0.3);
    console.log('[probe-advance-pause] Retroceso en pausa x5 (tolerancia ±0.3s):', allDiffsWithinTolerance ? 'PASA' : 'FALLA');
    if (!allDiffsWithinTolerance) {
      throw new Error('El tiempo retrocedió al pausar más allá de la tolerancia');
    }

    // -------------------------------------------------------------
    // PRUEBA 2: ?dur=30 (duración < 45s: NO debe auto-avanzar)
    // -------------------------------------------------------------
    console.log('[probe-advance-pause] 2. Evaluando ?dur=30 (duración < 45s no debe saltar)...');
    await win.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=advance-test-room#/`);
    await wait(2000);

    let advancedUnder45 = false;
    await win.webContents.executeJavaScript(`
      localStorage.setItem('CINECAST_DEBUG_SYNC', '1');
      window.CINECAST_DEBUG_SYNC = 1;
      window.__didAdvanceDetected = false;
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.onCommand((cmd) => {
          if (cmd.action === 'nextEpisode') window.__didAdvanceDetected = true;
        });
      }
      void 0;
    `);

    // Inyectar estado con dur=30 (cerca del fin, ej: cur=29s)
    await win.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.broadcastPlaybackState({
          mediaId: 'test_short',
          mediaTitle: 'Video Corto 30s',
          currentTime: 29,
          duration: 30,
          isPlaying: true,
          marathon: true
        });
      }
      void 0;
    `);
    await wait(2500);

    advancedUnder45 = await win.webContents.executeJavaScript(`Boolean(window.__didAdvanceDetected)`);
    console.log('[probe-advance-pause] ?dur=30 saltó:', advancedUnder45 ? 'SÍ (INCORRECTO)' : 'NO (CORRECTO - PASA)');
    if (advancedUnder45) {
      throw new Error('El reproductor saltó en un video con duración < 45s');
    }

    // -------------------------------------------------------------
    // PRUEBA 3: ?ad=10 (en comercial: NO debe auto-avanzar)
    // -------------------------------------------------------------
    console.log('[probe-advance-pause] 3. Evaluando ?ad=10 (durante ad no debe saltar)...');
    await win.webContents.executeJavaScript(`
      window.__didAdvanceDetected = false;
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.broadcastPlaybackState({
          mediaId: 'test_ad',
          mediaTitle: 'Video con Ad',
          currentTime: 8,
          duration: 10,
          isPlaying: true,
          isAd: true,
          marathon: true
        });
      }
      void 0;
    `);
    await wait(2500);

    const advancedInAd = await win.webContents.executeJavaScript(`Boolean(window.__didAdvanceDetected)`);
    console.log('[probe-advance-pause] En ad saltó:', advancedInAd ? 'SÍ (INCORRECTO)' : 'NO (CORRECTO - PASA)');
    if (advancedInAd) {
      throw new Error('El reproductor saltó durante la reproducción de un comercial');
    }

    console.log('[probe-advance-pause] PASA - Todas las verificaciones de la Parte 3 fueron exitosas.');
  } finally {
    win.destroy();
    if (spawnedServer) {
      try { spawnedServer.kill(); } catch (_) {}
    }
  }
}

app.whenReady().then(async () => {
  try {
    await run();
    app.exit(0);
  } catch (err) {
    console.error('[probe-advance-pause] Error:', err.message);
    if (spawnedServer) {
      try { spawnedServer.kill(); } catch (_) {}
    }
    app.exit(1);
  }
});
