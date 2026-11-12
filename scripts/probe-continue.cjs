#!/usr/bin/env node
/**
 * scripts/probe-continue.cjs
 * Verificación de "Continuar viendo" abriendo el episodio guardado (datos fijos):
 *  1. Clevatess T1:E12 (episodeTitle: "Episodio 1")
 *  2. Black Clover T2:E7 (episodeTitle: "Episodio 1")
 *  3. Breaking Bad T1:E5 (episodeTitle: "Episodio 1")
 *  4. Película Spider-Man (currentTime: 600)
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

// IPC Handlers
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
  console.error('[probe-continue] Timeout global alcanzado (100s)');
  app.exit(1);
}, 100000);

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
    const healthy = await waitForHealth(baseUrl, 30000);
    if (!healthy) {
      console.error('[probe-continue] Servidor no respondió en /api/health');
      app.exit(1);
      return;
    }
  }

  const preloadPath = path.join(rootDir, 'electron', 'preload.cjs');
  const roomId = 'cine-probe-continue';

  // Ventana PC
  const winA = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:probe-continue-pc',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Ventana Celular
  const winB = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:probe-continue-phone',
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

  winA.webContents.on('console-message', (_e, l, msg) => {
    if (l >= 2 && !msg.includes('bluetooth') && !msg.includes('[vite]')) {
      console.log('[winA console]', msg);
    }
  });
  winB.webContents.on('console-message', (_e, l, msg) => {
    if (l >= 2 && !msg.includes('bluetooth') && !msg.includes('[vite]')) {
      console.log('[winB console]', msg);
    }
  });

  await Promise.all([
    winA.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}`),
    winB.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}`),
  ]);
  await wait(2000);

  // Sembrar 4 datos fijos con episodeTitle="Episodio 1"
  const sampleProgress = [
    {
      id: 'tmdb-anime-258348',
      mediaId: 'tmdb-anime-258348',
      title: 'Clevatess',
      posterUrl: 'https://image.tmdb.org/t/p/w500/sample1.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/sample1.jpg',
      type: 'series',
      category: 'anime',
      seasonNumber: 1,
      episodeNumber: 12,
      episodeTitle: 'Episodio 1',
      currentTime: 450,
      duration: 1440,
      progressPercentage: 31,
      lastWatchedAt: Date.now() - 1000,
      mediaItem: {
        id: 'tmdb-anime-258348',
        tmdbId: 258348,
        title: 'Clevatess',
        type: 'series',
        category: 'anime',
      },
      episodeItem: {
        id: 'ep-clevatess-1',
        title: 'Episodio 1',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    },
    {
      id: 'tmdb-anime-73223',
      mediaId: 'tmdb-anime-73223',
      title: 'Black Clover',
      posterUrl: 'https://image.tmdb.org/t/p/w500/sample2.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/sample2.jpg',
      type: 'series',
      category: 'anime',
      seasonNumber: 2,
      episodeNumber: 7,
      episodeTitle: 'Episodio 1',
      currentTime: 300,
      duration: 1440,
      progressPercentage: 20,
      lastWatchedAt: Date.now() - 2000,
      mediaItem: {
        id: 'tmdb-anime-73223',
        tmdbId: 73223,
        title: 'Black Clover',
        type: 'series',
        category: 'anime',
      },
      episodeItem: {
        id: 'ep-bc-1',
        title: 'Episodio 1',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    },
    {
      id: 'tmdb-series-1396',
      mediaId: 'tmdb-series-1396',
      title: 'Breaking Bad',
      posterUrl: 'https://image.tmdb.org/t/p/w500/sample3.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/sample3.jpg',
      type: 'series',
      category: 'series',
      seasonNumber: 1,
      episodeNumber: 5,
      episodeTitle: 'Episodio 1',
      currentTime: 600,
      duration: 2880,
      progressPercentage: 21,
      lastWatchedAt: Date.now() - 3000,
      mediaItem: {
        id: 'tmdb-series-1396',
        tmdbId: 1396,
        title: 'Breaking Bad',
        type: 'series',
        category: 'series',
      },
      episodeItem: {
        id: 'ep-bb-1',
        title: 'Episodio 1',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    },
    {
      id: 'tmdb-movie-969681',
      mediaId: 'tmdb-movie-969681',
      title: 'Spider-Man: Un nuevo día',
      posterUrl: 'https://image.tmdb.org/t/p/w500/sample4.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/sample4.jpg',
      type: 'movie',
      category: 'movie',
      currentTime: 600,
      duration: 7200,
      progressPercentage: 8,
      lastWatchedAt: Date.now() - 4000,
      mediaItem: {
        id: 'tmdb-movie-969681',
        tmdbId: 969681,
        title: 'Spider-Man: Un nuevo día',
        type: 'movie',
        category: 'movie',
      },
    },
  ];

  const serialized = JSON.stringify(sampleProgress);
  await winA.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_watch_progress_v2', ${JSON.stringify(serialized)});
    window.location.hash = '#/';
  `);
  await winB.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_watch_progress_v2', ${JSON.stringify(serialized)});
    window.location.hash = '#/';
  `);
  await wait(2000);

  const testCases = [
    { name: 'Clevatess (Celular -> PC)', cardIdx: 0, fromWin: winB, expS: '1', expE: '12' },
    { name: 'Black Clover (Celular -> PC)', cardIdx: 1, fromWin: winB, expS: '2', expE: '7' },
    { name: 'Breaking Bad (Celular -> PC)', cardIdx: 2, fromWin: winB, expS: '1', expE: '5' },
    { name: 'Película Spider-Man (Celular -> PC)', cardIdx: 3, fromWin: winB, expMovie: true },
    { name: 'Clevatess (PC directo)', cardIdx: 0, fromWin: winA, expS: '1', expE: '12' },
    { name: 'Black Clover (PC directo)', cardIdx: 1, fromWin: winA, expS: '2', expE: '7' },
    { name: 'Breaking Bad (PC directo)', cardIdx: 2, fromWin: winA, expS: '1', expE: '5' },
    { name: 'Película Spider-Man (PC directo)', cardIdx: 3, fromWin: winA, expMovie: true },
  ];

  const results = [];

  for (const tc of testCases) {
    // Asegurar que PC esté en #/ sin reproductor abierto
    await winA.webContents.executeJavaScript(`(() => {
      if (window.location.hash !== '#/') window.location.hash = '#/';
      const closeBtn = document.querySelector('button[title*="Volver atrás"], button[aria-label*="Cerrar"]');
      if (closeBtn) closeBtn.click();
    })()`);
    await wait(800);

    // Clic en la tarjeta correspondiente
    const clicked = await tc.fromWin.webContents.executeJavaScript(`(() => {
      const cards = Array.from(document.querySelectorAll('div[role="button"][class*="group relative"]'));
      const target = cards[${tc.cardIdx}];
      if (target) {
        target.click();
        return true;
      }
      return false;
    })()`);

    if (!clicked) {
      results.push({
        name: tc.name,
        pass: false,
        obtenido: 'Tarjeta no encontrada',
        esperado: tc.expMovie ? 'Player montado' : `T${tc.expS}:E${tc.expE}`,
      });
      continue;
    }

    await wait(2000);

    // Leer estado en PC (winA)
    const pcState = await winA.webContents.executeJavaScript(`(() => {
      const selects = Array.from(document.querySelectorAll('div[class*="rounded-xl"] select'));
      const sVal = selects[0] ? selects[0].value : null;
      const eVal = selects[1] ? selects[1].value : null;
      const isPlayer = Boolean(
        document.querySelector('video') ||
        document.querySelector('iframe[data-embed]') ||
        document.querySelector('webview') ||
        document.querySelector('div[class*="VideoPlayer"]')
      );
      return { isPlayer, sVal, eVal };
    })()`);

    let pass = false;
    let obtenido = '';
    let esperado = '';

    if (tc.expMovie) {
      pass = pcState.isPlayer;
      obtenido = `Player: ${pcState.isPlayer ? 'SI' : 'NO'}`;
      esperado = 'Player: SI';
    } else {
      pass = pcState.sVal === tc.expS && pcState.eVal === tc.expE;
      obtenido = `T=${pcState.sVal ?? 'null'}:E=${pcState.eVal ?? 'null'}`;
      esperado = `T=${tc.expS}:E=${tc.expE}`;
    }

    results.push({ name: tc.name, pass, obtenido, esperado });
  }

  console.log('\n====================================================================================================');
  console.log('RESULTADOS DE PROBE-CONTINUE (DATOS FIJOS EN CONTINUAR VIENDO)');
  console.log('====================================================================================================');
  console.log('CASO'.padEnd(38) + 'ESTADO'.padEnd(10) + 'OBTENIDO'.padEnd(25) + 'ESPERADO');
  console.log('----------------------------------------------------------------------------------------------------');
  for (const r of results) {
    const status = r.pass ? 'PASA' : 'FALLA';
    console.log(r.name.padEnd(38) + status.padEnd(10) + r.obtenido.padEnd(25) + r.esperado);
  }
  console.log('====================================================================================================\n');

  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(results.every((r) => r.pass) ? 0 : 1);
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-continue FATAL]', err);
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(1);
});
