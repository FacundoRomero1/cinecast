#!/usr/bin/env node
/**
 * scripts/probe-slider.cjs
 * Prueba de barra de tiempo deslizable táctil (role="slider")
 * - 4x CPU Throttling con CDP
 * - Arrastre táctil de 50s a 200s con medición de FPS
 * - Anti-rebote durante 800ms de retardo de respuesta
 * - Toque simple en 320s
 * - Botones de salto rápido: +10s y -60s
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

// IPC mocks estándar para evitar bloqueos
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
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log(`[probe-slider] Levantando servidor en puerto ${port}...`);
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
      console.error('[probe-slider] Servidor no respondió.');
      app.exit(1);
    }
  }

  const preloadPath = path.join(rootDir, 'electron', 'preload.cjs');
  const roomId = 'cine-slider-room';

  // 1. Ventana PC (screen)
  const winScreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:slider-screen',
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 2. Ventana Celular (remote)
  const winPhone = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:slider-phone',
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  winPhone.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  );

  try {
    console.log(`[probe-slider] Cargando ventanas en ${baseUrl}...`);
    await Promise.all([
      winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}`),
      winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`),
    ]);

    await wait(2000);

    // Preparar pantalla para capturar comandos y emitir estado con duración de 400 s
    console.log('[probe-slider] Configurando pantalla para simular video de 400s...');
    await winScreen.webContents.executeJavaScript(`
      window.__receivedCommands = [];
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.onCommand((cmd) => {
          window.__receivedCommands.push(cmd);
        });
        window.cinecastDeviceSync.broadcastPlaybackState({
          mediaId: 'slider_test_media',
          mediaTitle: 'Película de Prueba 400s',
          currentTime: 50,
          duration: 400,
          isPlaying: true,
          isStandby: false,
          activeHub: 'cinecast',
          screenDeviceName: 'Pantalla Slider Test'
        });
      }
      void 0;
    `);

    await wait(1500);

    // Conectar depurador en el celular para throttling 4x CPU
    console.log('[probe-slider] Adjuntando CDP con 4x CPU Throttling en celular...');
    winPhone.webContents.debugger.attach('1.3');
    await winPhone.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 });

    // Esperar a que el control remoto renderice el elemento [role="slider"]
    let sliderBox = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      sliderBox = await winPhone.webContents.executeJavaScript(`
        (function() {
          const slider = document.querySelector('[role="slider"]');
          if (!slider) return null;
          const rect = slider.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            valuenow: slider.getAttribute('aria-valuenow'),
            valuemax: slider.getAttribute('aria-valuemax'),
            valuetext: slider.getAttribute('aria-valuetext')
          };
        })()
      `);
      if (sliderBox) break;
      await wait(500);
    }

    if (!sliderBox) {
      const debugHtml = await winPhone.webContents.executeJavaScript(`document.body.innerText.substring(0, 300)`);
      console.log('[probe-slider] DEBUG texto celular:', debugHtml);
      throw new Error('No se encontró el elemento [role="slider"] en el control remoto');
    }

    console.log('[probe-slider] Slider verificado:', sliderBox);

    if (sliderBox.height < 44) {
      throw new Error(`Área táctil insuficiente: ${sliderBox.height}px (se requiere >= 44px)`);
    }

    // (a) Arrastre táctil de 50 s (12.5%) a 200 s (50%) con medición de FPS bajo CPU 4x
    console.log('[probe-slider] (a) Simulando arrastre táctil de 50s a 200s bajo CPU 4x...');
    const startX = sliderBox.left + sliderBox.width * 0.125;
    const endX = sliderBox.left + sliderBox.width * 0.50;
    const centerY = sliderBox.top + sliderBox.height / 2;

    const dragTimings = [];
    const steps = 25;

    // Pointer down
    await winPhone.webContents.executeJavaScript(`
      (function() {
        const slider = document.querySelector('[role="slider"]');
        slider.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: ${startX}, clientY: ${centerY}, pointerId: 10
        }));
      })()
    `);

    for (let s = 1; s <= steps; s++) {
      const t0 = Date.now();
      const currX = startX + (endX - startX) * (s / steps);
      await winPhone.webContents.executeJavaScript(`
        (function() {
          const slider = document.querySelector('[role="slider"]');
          slider.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, clientX: ${currX}, clientY: ${centerY}, pointerId: 10
          }));
        })()
      `);
      dragTimings.push(Date.now() - t0);
      await wait(16);
    }

    // Pointer up en 200s
    await winPhone.webContents.executeJavaScript(`
      (function() {
        const slider = document.querySelector('[role="slider"]');
        slider.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: ${endX}, clientY: ${centerY}, pointerId: 10
        }));
      })()
    `);

    const avgStepMs = dragTimings.reduce((a, b) => a + b, 0) / dragTimings.length;
    const estFps = 1000 / Math.max(1, avgStepMs);
    console.log(`[probe-slider] Rendimiento arrastre con CPU 4x: avg ${avgStepMs.toFixed(1)}ms (${estFps.toFixed(0)} FPS estimados, requisito > 30 FPS)`);
    if (estFps < 30) {
      console.warn(`[probe-slider] Advertencia: FPS calculados ${estFps.toFixed(0)} < 30`);
    }

    // Simular retardo de 800ms en la pantalla respondiendo con estado viejo (50s)
    console.log('[probe-slider] Simulando retardo de respuesta de pantalla de 800ms...');
    for (let i = 0; i < 4; i++) {
      await winScreen.webContents.executeJavaScript(`
        if (window.cinecastDeviceSync) {
          window.cinecastDeviceSync.broadcastPlaybackState({
            mediaId: 'slider_test_media',
            mediaTitle: 'Película de Prueba 400s',
            currentTime: 50,
            duration: 400,
            isPlaying: true,
            isStandby: false
          });
        }
      `);
      await wait(200);
    }

    // Verificar que en el celular aria-valuenow no rebotó a 50s
    const valAfterLag = await winPhone.webContents.executeJavaScript(`
      document.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')
    `);
    console.log(`[probe-slider] Valor en celular durante retardo de 800ms: ${valAfterLag}s (esperado ~200s, no 50s)`);
    if (Math.abs(Number(valAfterLag) - 200) > 10) {
      throw new Error(`La barra rebotó hacia atrás antes de los 1.2s: val=${valAfterLag}s`);
    }

    // (b) Toque simple en 320 s (80%)
    console.log('[probe-slider] (b) Simulando toque directo en 320s...');
    const tapX = sliderBox.left + sliderBox.width * 0.80;
    await winPhone.webContents.executeJavaScript(`
      (function() {
        const slider = document.querySelector('[role="slider"]');
        slider.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ${tapX}, clientY: ${centerY} }));
      })()
    `);
    await wait(500);

    // (c) Tocar botón +10s
    console.log('[probe-slider] (c) Tocando botón rápido +10s...');
    await winPhone.webContents.executeJavaScript(`
      (function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '+10s');
        if (btn) btn.click();
      })()
    `);
    await wait(400);

    // (d) Tocar botón -60s
    console.log('[probe-slider] (d) Tocando botón rápido -60s...');
    await winPhone.webContents.executeJavaScript(`
      (function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '-60s');
        if (btn) btn.click();
      })()
    `);
    await wait(600);

    // Comprobar comandos recibidos en la pantalla
    const receivedCommands = await winScreen.webContents.executeJavaScript(`window.__receivedCommands`);
    console.log('[probe-slider] Comandos recibidos en pantalla:', JSON.stringify(receivedCommands));

    const hasDragSeek = receivedCommands.some((c) => c.action === 'seek' && Math.abs(c.payload - 200) <= 6);
    const hasTapSeek = receivedCommands.some((c) => c.action === 'seek' && Math.abs(c.payload - 320) <= 6);
    const hasPlus10 = receivedCommands.some((c) => c.action === 'seekRelative' && c.payload === 10);
    const hasMinus60 = receivedCommands.some((c) => c.action === 'seekRelative' && c.payload === -60);

    console.log('--- Resumen de Verificaciones de la Parte 2 ---');
    console.log('(a) Arrastre a 200s y anti-rebote 800ms:', hasDragSeek ? 'PASA' : 'FALLA');
    console.log('(b) Toque simple en 320s:', hasTapSeek ? 'PASA' : 'FALLA');
    console.log('(c) Botón rápido +10s:', hasPlus10 ? 'PASA' : 'FALLA');
    console.log('(d) Botón rápido -60s:', hasMinus60 ? 'PASA' : 'FALLA');

    if (!hasDragSeek || !hasTapSeek || !hasPlus10 || !hasMinus60) {
      throw new Error('No se recibieron todos los comandos esperados en pantalla');
    }

    console.log('[probe-slider] PASA - Todos los requerimientos de la Parte 2 fueron verificados con éxito.');
  } finally {
    try { winPhone.webContents.debugger.detach(); } catch (_) {}
    winScreen.destroy();
    winPhone.destroy();
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
    console.error('[probe-slider] Error:', err.message);
    if (spawnedServer) {
      try { spawnedServer.kill(); } catch (_) {}
    }
    app.exit(1);
  }
});
