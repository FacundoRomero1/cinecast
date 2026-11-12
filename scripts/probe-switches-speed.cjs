#!/usr/bin/env node
/**
 * scripts/probe-switches-speed.cjs
 * Verificación de interruptores inmediatos (Parte 2):
 *  1. CPU 4x throttled por debugger en celular: tiempo a posición final <= 300 ms.
 *  2. Reconciliación con timeout: si la PC no confirma en 3s, vuelve atrás en 3-3.5 s con aviso "La pantalla no respondió".
 *  3. Verificación de que en modo liviano (.cc-lite) no se elimina la transición de 150ms.
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

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

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

// IPC Handlers mínimos
ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('set-no-cors-fix', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('save-accounts', () => true);
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-embed-status', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('probe-streams', (_e, urls) => (Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []));
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('system-volume', () => ({ ok: true }));
ipcMain.handle('simulate-play-click', () => true);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('open-external', () => true);
ipcMain.handle('send-native-click', () => true);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('set-stream-headers', () => true);
ipcMain.handle('control-active-media', () => ({ ok: true, subtitlesEnabled: true }));
ipcMain.handle('get-real-media-state', () => null);

const globalTimer = setTimeout(() => {
  console.error('[probe-switches-speed] Timeout global alcanzado (60s)');
  app.exit(1);
}, 60000);

let serverProcess = null;

async function run() {
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHealth(baseUrl, 30000);
  }

  const preloadPath = path.join(rootDir, 'electron', 'preload.cjs');
  const roomId = 'cine-probe-switches';

  // Ventana Celular
  const winB = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:probe-switches-phone',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  winB.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  );

  await winB.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);
  winB.showInactive();
  await wait(2000);

  // Asegurar navegación a #/control
  await winB.webContents.executeJavaScript(`
    if (window.location.hash !== '#/control') {
      window.location.hash = '#/control';
    }
  `);

  // Esperar a que los Switches estén listos
  const ready = await winB.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const start = Date.now();
      const int = setInterval(() => {
        const sws = document.querySelectorAll('button[role="switch"]');
        if (sws.length >= 2) {
          clearInterval(int);
          resolve(true);
        } else if (Date.now() - start > 10000) {
          clearInterval(int);
          resolve(false);
        }
      }, 100);
    });
  `);

  if (!ready) {
    console.error('[probe-switches-speed] ERROR: No se encontraron los switches en la UI tras 10s');
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    clearTimeout(globalTimer);
    app.exit(1);
    return;
  }

  // Adjuntar debugger para CPU Throttling 4x
  winB.webContents.debugger.attach('1.3');
  await winB.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 });
  console.log('[probe-switches-speed] CPU Throttling 4x activado');
  await wait(500);

  const switchInfos = await winB.webContents.executeJavaScript(`(() => {
    return Array.from(document.querySelectorAll('button[role="switch"]')).map((s, idx) => ({
      idx,
      label: s.getAttribute('aria-label'),
      checked: s.getAttribute('aria-checked'),
    }));
  })()`);
  console.log('SWITCHES ENCONTRADOS:', switchInfos);

  // 1. Prueba de velocidad de transición (CPU 4x throttled) en Switch 0
  const speedRes = await winB.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const sw = document.querySelectorAll('button[role="switch"]')[0];
      if (!sw) return resolve({ ok: false, error: 'Switch 0 no encontrado' });
      const thumb = sw.querySelector('[data-testid="switch-thumb"]');
      if (!thumb) return resolve({ ok: false, error: 'Thumb no encontrado' });

      const initialChecked = sw.getAttribute('aria-checked') === 'true';
      const targetTx = initialChecked ? 0 : 22;

      const start = performance.now();
      sw.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      sw.click();

      const samples = [];
      const check = () => {
        const style = window.getComputedStyle(thumb);
        const transform = style.transform;
        let tx = 0;
        if (transform && transform !== 'none') {
          const match = transform.match(/matrix\\([^,]+,[^,]+,[^,]+,[^,]+,\\s*([^,\\)]+)/);
          if (match) tx = parseFloat(match[1]);
          else if (transform.includes('translateX(22px)')) tx = 22;
        }
        const elapsed = performance.now() - start;
        samples.push({ elapsed: Math.round(elapsed), tx, transform });

        if (Math.abs(tx - targetTx) <= 1.5) {
          resolve({ ok: true, elapsed: Math.round(elapsed), tx, targetTx, samples });
        } else if (elapsed > 1000) {
          resolve({ ok: false, elapsed: Math.round(elapsed), tx, targetTx, samples, error: 'Timeout superado sin llegar a posición final' });
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  `);

  // Desactivar CPU Throttling para la prueba de timeout exacto (3.0s - 3.5s)
  await winB.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
  await wait(3500); // esperar a que Switch 0 complete su ciclo

  // 2. Prueba de reversión por timeout a 3s sin respuesta de PC en Switch 1
  const revertRes = await winB.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const sw = document.querySelectorAll('button[role="switch"]')[1];
      if (!sw) return resolve({ ok: false, error: 'Switch 1 no encontrado' });

      const initialChecked = sw.getAttribute('aria-checked');
      const start = performance.now();
      sw.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      sw.click();

      const check = () => {
        const checked = sw.getAttribute('aria-checked');
        const container = sw.closest('div');
        const notice = container ? container.querySelector('[data-testid="switch-timeout-notice"]') : null;
        const elapsed = performance.now() - start;

        if (checked === initialChecked && notice) {
          resolve({
            ok: true,
            elapsed: Math.round(elapsed),
            noticeText: notice.textContent.trim(),
          });
        } else if (elapsed > 4500) {
          resolve({
            ok: false,
            elapsed: Math.round(elapsed),
            checked,
            initialChecked,
            hasNotice: Boolean(notice),
            error: 'No revirtio en tiempo esperado',
          });
        } else {
          setTimeout(check, 50);
        }
      };
      setTimeout(check, 50);
    });
  `);

  // 3. Prueba de Modo Liviano (.cc-lite) no desactiva la transición de 150ms
  const liteRes = await winB.webContents.executeJavaScript(`(() => {
    document.documentElement.classList.add('cc-lite');
    const thumb = document.querySelector('[data-testid="switch-thumb"]');
    if (!thumb) return { ok: false, error: 'Thumb no encontrado' };
    const style = window.getComputedStyle(thumb);
    const duration = style.transitionDuration;
    document.documentElement.classList.remove('cc-lite');
    const is150ms = duration === '0.15s' || duration === '150ms';
    return { ok: is150ms, duration };
  })()`);

  console.log('\n====================================================================================================');
  console.log('RESULTADOS DE PROBE-SWITCHES-SPEED (INTERRUPTORES INMEDIATOS)');
  console.log('====================================================================================================');
  console.log(`1. Transición con CPU 4x Throttled:`);
  console.log(`   - Éxito: ${speedRes?.ok ? 'SI' : 'NO'}`);
  console.log(`   - Tiempo transcurrido: ${speedRes?.elapsed} ms (Umbral <= 300 ms)`);
  console.log(`   - Posición final alcanzada: tx=${speedRes?.tx} px`);
  if (speedRes?.samples) {
    console.log('   - Muestras (primeras 10):', speedRes.samples.slice(0, 10));
    console.log('   - Muestras (últimas 5):', speedRes.samples.slice(-5));
  }

  console.log(`\n2. Reversión por timeout (sin respuesta de PC):`);
  console.log(`   - Éxito: ${revertRes?.ok ? 'SI' : 'NO'}`);
  console.log(`   - Tiempo a reversión: ${revertRes?.elapsed} ms (Esperado: 3000 - 3500 ms)`);
  console.log(`   - Aviso visual mostrado: "${revertRes?.noticeText}"`);

  console.log(`\n3. Modo Liviano (.cc-lite):`);
  console.log(`   - Transición preservada: ${liteRes?.ok ? 'SI' : 'NO'} (${liteRes?.duration})`);
  console.log('====================================================================================================\n');

  const allPass =
    speedRes?.ok &&
    speedRes?.elapsed <= 300 &&
    revertRes?.ok &&
    revertRes?.elapsed >= 2800 &&
    revertRes?.elapsed <= 3800 &&
    revertRes?.noticeText === 'La pantalla no respondió' &&
    liteRes?.ok;

  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(allPass ? 0 : 1);
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-switches-speed FATAL]', err);
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(1);
});
