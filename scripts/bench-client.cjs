#!/usr/bin/env node
/**
 * scripts/bench-client.cjs
 * Benchmark de cliente en Electron (390x844 mobile + throttling CPU 4x + URL LAN):
 * Recorre #/explorar y #/ haciendo scroll automático de 30 pantallas y mide:
 *  - nodos DOM (document.querySelectorAll('*').length)
 *  - cantidad de <img>
 *  - performance.memory.usedJSHeapSize
 *  - bytes transferidos de /api/poster
 */
if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env });
  process.exit(res.status ?? 1);
}

const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const cp = require('node:child_process');

app.on('window-all-closed', (e) => e.preventDefault());

const rootDir = path.resolve(__dirname, '..');
const MOBILE_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const info of nets[name]) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
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
    await wait(500);
  }
  return false;
}

const lanIp = getLanIp();
const port = Number(process.env.PORT || 3000);
const baseUrl = `http://${lanIp}:${port}`;

ipcMain.handle('get-local-ip', () => ({ ip: lanIp, port }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('set-no-cors-fix', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('save-accounts', () => true);
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-embed-status', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('probe-streams', (_e, urls) =>
  Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []
);
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('system-volume', () => ({ ok: true }));
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('control-active-media', () => true);
ipcMain.handle('search-media-tracks', () => []);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('send-native-click', () => true);
ipcMain.handle('simulate-play-click', () => true);
ipcMain.handle('open-external', () => true);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('set-stream-headers', () => true);
ipcMain.handle('send-native-trackpad-event', () => true);

let spawnedServer = null;

function stopServer() {
  if (!spawnedServer || !spawnedServer.pid) return;
  try {
    if (process.platform === 'win32') {
      cp.execSync(`taskkill /PID ${spawnedServer.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      spawnedServer.kill('SIGTERM');
    }
  } catch (_) {}
  spawnedServer = null;
}

const globalTimer = setTimeout(() => {
  console.error('[bench-client] Timeout global de 145s alcanzado');
  stopServer();
  app.exit(124);
}, 145000);

async function measureRoute(routeHash, queryExtra) {
  const win = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: `bench-client-${Date.now()}`,
      preload: path.join(rootDir, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.webContents.setUserAgent(MOBILE_ANDROID_UA);

  const posterRequests = new Set();
  let posterBytes = 0;
  let posterCount = 0;

  // Inicializar renderer con about:blank antes de adjuntar debugger/emulación
  await win.loadURL('about:blank');

  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 });
  await win.webContents.debugger.sendCommand('Network.enable');
  await win.webContents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });

  win.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const url = params?.request?.url || '';
      if (url.includes('/api/poster')) {
        posterRequests.add(params.requestId);
      }
    } else if (method === 'Network.loadingFinished') {
      if (posterRequests.has(params.requestId)) {
        posterBytes += Number(params.encodedDataLength || 0);
        posterCount += 1;
      }
    }
  });

  const targetUrl = `${baseUrl}/?ui=nuevo${queryExtra ? `&${queryExtra}` : ''}${routeHash}`;
  console.log(`[bench-client] Cargando ${targetUrl}...`);
  await win.loadURL(targetUrl);
  win.showInactive();

  // Esperar carga inicial del UI (sin quedarse en skeleton)
  for (let i = 0; i < 30; i += 1) {
    const ready = await win.webContents.executeJavaScript(`
      (() => {
        const imgs = document.querySelectorAll('img').length;
        const cards = document.querySelectorAll('a, button, img').length;
        return imgs > 0 || cards > 10;
      })()
    `);
    if (ready) break;
    await wait(300);
  }
  await wait(800);

  // Scroll automático de 30 pantallas (30 x 844 px)
  for (let step = 1; step <= 30; step += 1) {
    await win.webContents.executeJavaScript(`
      window.scrollTo(0, ${step * 844});
      void 0;
    `);
    await wait(250);
  }
  await wait(1200);

  const metrics = await win.webContents.executeJavaScript(`
    (() => {
      const mem = performance && performance.memory ? performance.memory : null;
      return {
        domNodes: document.querySelectorAll('*').length,
        imgCount: document.querySelectorAll('img').length,
        usedJSHeapSize: mem ? Number(mem.usedJSHeapSize || 0) : 0,
        totalJSHeapSize: mem ? Number(mem.totalJSHeapSize || 0) : 0,
        scrollY: Math.round(window.scrollY || 0),
        scrollHeight: Math.round(document.documentElement.scrollHeight || 0),
      };
    })()
  `);

  try {
    win.webContents.debugger.detach();
  } catch (_) {}
  win.destroy();

  return {
    route: routeHash,
    url: targetUrl,
    ...metrics,
    posterCount,
    posterBytes,
  };
}

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
    } catch (_) {}
  }

  const args = process.argv.slice(1);
  const liteArg = args.find((a) => a.startsWith('--lite='));
  const queryExtra = liteArg ? `lite=${liteArg.split('=')[1]}` : '';
  const outArg = args.find((a) => a.startsWith('--out='));

  try {
    const alreadyUp = await isPortInUse(port);
    if (!alreadyUp) {
      const srvLog = fs.openSync(path.join(rootDir, 'scratch', 'logs', 'bench-client-server.log'), 'w');
      spawnedServer = cp.spawn('node', [path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(rootDir, 'server.ts')], {
        cwd: rootDir,
        env: { ...process.env, CINECAST_DISABLE_PREWARM: '1', PORT: String(port) },
        stdio: ['ignore', srvLog, srvLog],
        windowsHide: true,
      });
      const healthy = await waitForHealth(`http://127.0.0.1:${port}`, 30000);
      if (!healthy) {
        throw new Error('Servidor local no respondió /api/health en 30s');
      }
    }

    const resExplore = await measureRoute('#/explorar', queryExtra);
    const resHome = await measureRoute('#/', queryExtra);
    const results = [resExplore, resHome];

    console.log('\n=== [bench-client] Electron 390x844 CPU 4x (LAN) ===');
    console.log(`URL base: ${baseUrl} | extra=${queryExtra || '(default)'}`);
    console.log('Ruta        | DOM nodos | <img> | usedJSHeap MiB | /api/poster reqs | /api/poster MiB | scrollY/H');
    console.log('-'.repeat(102));
    for (const r of results) {
      const heapMiB = (r.usedJSHeapSize / (1024 * 1024)).toFixed(2);
      const posterMiB = (r.posterBytes / (1024 * 1024)).toFixed(2);
      console.log(
        `${r.route.padEnd(11)} | ${String(r.domNodes).padStart(9)} | ${String(r.imgCount).padStart(5)} | ${heapMiB.padStart(14)} | ${String(r.posterCount).padStart(16)} | ${posterMiB.padStart(15)} | ${r.scrollY}/${r.scrollHeight}`
      );
    }

    if (outArg) {
      const outPath = path.resolve(rootDir, outArg.slice('--out='.length));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ baseUrl, queryExtra, results }, null, 2));
    }

    clearTimeout(globalTimer);
    stopServer();
    app.exit(0);
  } catch (err) {
    console.error('[bench-client] Error:', err);
    clearTimeout(globalTimer);
    stopServer();
    app.exit(1);
  }
});

