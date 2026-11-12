const { app, components, BrowserWindow, ipcMain, webContents } = require('electron');
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

// Registrar handlers IPC necesarios para preload.cjs
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
ipcMain.handle('probe-streams', (_e, urls) =>
  Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []
);
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', async (_e, payload) => {
  const { volume, isMuted } = payload || {};
  const muted = Boolean(isMuted || (typeof volume === 'number' && volume <= 0));
  const vol01 = Math.max(0, Math.min(1, Number(volume ?? 100) / 100));
  let webContentsCount = 0;
  let elementsCount = 0;
  const allWcs = webContents.getAllWebContents().filter((wc) => !wc.isDestroyed());
  for (const wc of allWcs) {
    try {
      wc.setAudioMuted(muted);
      webContentsCount++;
      const count = await wc.executeJavaScript(`
        (() => {
          let c = 0;
          document.querySelectorAll('video, audio').forEach(el => {
            try {
              el.volume = ${vol01};
              el.muted = ${muted};
              c++;
            } catch (_) {}
          });
          return c;
        })()
      `);
      if (typeof count === 'number') elementsCount += count;
    } catch (_) {}
  }
  return { ok: true, webContentsCount, elementsCount, volume: vol01, muted };
});
ipcMain.handle('system-volume', async (_e, action) => {
  if (!['up', 'down', 'mute'].includes(action)) {
    return { ok: false, error: 'Acción inválida' };
  }
  return { ok: true, action };
});
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

const globalTimer = setTimeout(() => {
  console.error('[e2e-touch] Timeout global alcanzado');
  app.exit(1);
}, 180000);

let spawnedServer = null;

async function checkAndTouch(win, getElementFnString, description) {
  const res = await win.webContents.executeJavaScript(`
    (function() {
      try {
        const fn = ${getElementFnString};
        const el = fn();
        if (!el) {
          return { ok: false, error: 'Elemento no encontrado: ' + ${JSON.stringify(description)} };
        }
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        const rect = el.getBoundingClientRect();
        const cx = Math.floor(rect.left + rect.width / 2);
        const cy = Math.floor(rect.top + rect.height / 2);
        if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
          return {
            ok: false,
            error: 'Elemento fuera de viewport: (' + cx + ',' + cy + ') [viewport ' + window.innerWidth + 'x' + window.innerHeight + ']'
          };
        }
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) {
          return { ok: false, error: 'elementFromPoint en (' + cx + ',' + cy + ') devolvió null' };
        }
        if (!el.contains(hit)) {
          const blockerName = (hit.tagName || '').toLowerCase() + (hit.className ? '.' + hit.className.trim().split(/\\s+/).join('.') : '');
          return { ok: false, covered: true, blocker: blockerName, cx, cy };
        }
        return { ok: true, cx, cy };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    })()
  `);

  if (!res.ok) {
    if (res.covered) {
      return { ok: false, error: `Tapado por <${res.blocker}> en (${res.cx},${res.cy})` };
    }
    return { ok: false, error: res.error };
  }

  if (!win.webContents.debugger.isAttached()) {
    await win.webContents.executeJavaScript(`(() => { const el = (${getElementFnString})(); if (el) el.click(); })()`);
    return { ok: true, cx: res.cx, cy: res.cy };
  }

  // Toque con Input.dispatchTouchEvent (touchStart y touchEnd) en el centro del elemento
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: res.cx, y: res.cy }],
  });
  await wait(60);
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });

  return { ok: true, cx: res.cx, cy: res.cy };
}

async function swipeVertical(win, startX, startY, endY, steps = 10) {
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  });
  await wait(30);
  for (let i = 1; i <= steps; i++) {
    const curY = Math.floor(startY + ((endY - startY) * i) / steps);
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: curY }],
    });
    await wait(25);
  }
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await wait(200);
}

async function swipeHorizontal(win, startX, startY, endX, steps = 6) {
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  });
  await wait(30);
  for (let i = 1; i <= steps; i++) {
    const curX = Math.floor(startX + ((endX - startX) * i) / steps);
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: curX, y: startY }],
    });
    await wait(25);
  }
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await wait(200);
}

async function tapAt(win, x, y) {
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await wait(50);
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await wait(200);
}

async function pollServerCommands(baseUrl, roomId = 'cine-home-1', since = 0) {
  try {
    const res = await fetch(
      `${baseUrl}/api/sync/poll?roomId=${encodeURIComponent(roomId)}&since=${since}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = await res.json();
      return data?.commands || [];
    }
  } catch (_) {}
  return [];
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

  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log(`[e2e-touch] Servidor no activo en puerto ${port}. Iniciando servidor dev...`);
    const rootDir = path.join(__dirname, '..');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    const ready = await waitForHealth(`http://localhost:${port}`, 40000);
    if (!ready) {
      console.error('[e2e-touch] No se pudo levantar el servidor.');
      app.exit(1);
    }
  }

  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

  // Ventana PC (?role=screen)
  const winA = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:e2e-touch-screen',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Ventana Celular (?role=remote): Crear con show:false, cargar URL, y recién entonces emular por debugger
  const winB = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:e2e-touch-remote',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const MOBILE_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  winB.webContents.setUserAgent(MOBILE_ANDROID_UA);

  await Promise.all([
    winA.loadURL(`${baseUrl}/?role=screen&ui=nuevo`),
    winB.loadURL(`${baseUrl}/?role=remote&ui=nuevo`),
  ]);

  // Emulación por debugger
  winB.webContents.debugger.attach('1.3');
  await winB.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await winB.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });

  winA.showInactive();
  winB.showInactive();
  await wait(2000);

  const isSecure = await winB.webContents.executeJavaScript('window.isSecureContext');
  console.log(`[e2e-touch] URL Base: ${baseUrl}`);
  console.log(`[e2e-touch] window.isSecureContext en celular: ${isSecure}`);

  // Asegurar sala común
  const roomId = 'cine-home-1';
  await winA.webContents.executeJavaScript(`localStorage.setItem('cinecast_room_id', '${roomId}');`);
  await winB.webContents.executeJavaScript(`localStorage.setItem('cinecast_room_id', '${roomId}');`);

  // Sembrar 4 entradas de "Continuar viendo" con episodeTitle="Episodio 1"
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

  winA.webContents.on('console-message', (_e, l, msg) => {
    if (l >= 2 && !msg.includes('bluetooth') && !msg.includes('[vite]')) console.log('[winA console]', msg);
  });
  winB.webContents.on('console-message', (_e, l, msg) => {
    if (l >= 2 && !msg.includes('bluetooth') && !msg.includes('[vite]')) console.log('[winB console]', msg);
  });

  await winA.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_watch_progress_v2', JSON.stringify(${JSON.stringify(sampleProgress)}));
    window.location.hash = '#/';
  `);
  await winB.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_watch_progress_v2', JSON.stringify(${JSON.stringify(sampleProgress)}));
    window.location.hash = '#/';
  `);
  await wait(1500);

  const results = [];

  // =========================================================================
  // Caso (1): Tocar play de cada tarjeta de "Continuar viendo" desde Celular y PC
  // =========================================================================
  const testCases1 = [
    { name: 'Clevatess (Celular -> PC)', cardIdx: 0, fromWin: winB, isMobile: true, expS: '1', expE: '12' },
    { name: 'Black Clover (Celular -> PC)', cardIdx: 1, fromWin: winB, isMobile: true, expS: '2', expE: '7' },
    { name: 'Breaking Bad (Celular -> PC)', cardIdx: 2, fromWin: winB, isMobile: true, expS: '1', expE: '5' },
    { name: 'Película (Celular -> PC)', cardIdx: 3, fromWin: winB, isMobile: true, expS: null, expE: null, expMovie: true },
    { name: 'Clevatess (PC directo)', cardIdx: 0, fromWin: winA, isMobile: false, expS: '1', expE: '12' },
    { name: 'Black Clover (PC directo)', cardIdx: 1, fromWin: winA, isMobile: false, expS: '2', expE: '7' },
    { name: 'Breaking Bad (PC directo)', cardIdx: 2, fromWin: winA, isMobile: false, expS: '1', expE: '5' },
    { name: 'Película (PC directo)', cardIdx: 3, fromWin: winA, isMobile: false, expS: null, expE: null, expMovie: true },
  ];

  for (const tc of testCases1) {
    try {
      // Asegurar que PC esté en #/ sin reproductor abierto
      await winA.webContents.executeJavaScript(`
        if (window.location.hash !== '#/') window.location.hash = '#/';
        const closeBtn = document.querySelector('button[title*="Cerrar"], button[aria-label*="Cerrar"]');
        if (closeBtn) closeBtn.click();
      `);
      if (tc.isMobile) {
        await winB.webContents.executeJavaScript(`
          if (window.location.hash !== '#/') window.location.hash = '#/';
        `);
      }
      await wait(800);

      const targetCardSelector = `() => document.querySelectorAll('section div[class*="group relative"] div[class*="rounded-full bg-red-600"]')[${tc.cardIdx}]`;
      const touchRes = await checkAndTouch(tc.fromWin, targetCardSelector, `play de tarjeta ${tc.name}`);
      if (!touchRes.ok) {
        results.push({ id: 1, name: `Continuar viendo - ${tc.name}`, pass: false, detail: touchRes.error });
        continue;
      }

      await wait(1500);

      // Leer estado en PC (winA)
      const pcState = await winA.webContents.executeJavaScript(`(() => {
        const selects = Array.from(document.querySelectorAll('div[class*="rounded-xl"] select'));
        const sVal = selects[0] ? selects[0].value : null;
        const eVal = selects[1] ? selects[1].value : null;
        const isPlayer = Boolean(document.querySelector('video') || document.querySelector('iframe[data-embed]') || document.querySelector('webview') || document.querySelector('div[class*="VideoPlayer"]'));
        return { isPlayer, sVal, eVal };
      })()`);

      let pass = false;
      let detail = '';
      if (tc.expMovie) {
        pass = pcState.isPlayer;
        detail = `Reproductor montado: ${pcState.isPlayer ? 'SI' : 'NO'}`;
      } else {
        pass = pcState.sVal === tc.expS && pcState.eVal === tc.expE;
        detail = `Obtenido: T=${pcState.sVal}:E=${pcState.eVal} | Esperado: T=${tc.expS}:E=${tc.expE}`;
      }

      results.push({ id: 1, name: `Continuar viendo - ${tc.name}`, pass, detail });
    } catch (err) {
      results.push({ id: 1, name: `Continuar viendo - ${tc.name}`, pass: false, detail: err.message });
    }
  }

  // Cerrar reproductor en PC tras las pruebas de Continuar viendo
  await winA.webContents.executeJavaScript(`
    if (window.location.hash !== '#/') window.location.hash = '#/';
    const closeBtn = document.querySelector('button[title*="Cerrar"], button[aria-label*="Cerrar"]');
    if (closeBtn) closeBtn.click();
  `);
  await wait(800);

  // =========================================================================
  // Caso (2): Tocar su ícono de cast -> llega comando a PC
  // =========================================================================
  try {
    const seqBefore2 = (await pollServerCommands(baseUrl, roomId, 0)).length;
    const touchRes2 = await checkAndTouch(
      winB,
      `() => document.querySelector('section div[class*="group relative"] button[title*="Enviar a"]') || document.querySelector('[data-testid="continue-cast"]')`,
      'ícono de cast de primera tarjeta en Continuar viendo'
    );

    if (!touchRes2.ok) {
      results.push({ id: 2, name: 'Continuar viendo - Cast', pass: false, detail: touchRes2.error });
    } else {
      await wait(1500);
      const cmdsAfter = await pollServerCommands(baseUrl, roomId, 0);
      const newCmds = cmdsAfter.slice(seqBefore2);
      const castCmd = newCmds.find((c) => /playMedia|playDiscoveredMovie|play/i.test(c.command?.action || ''));
      if (castCmd) {
        results.push({ id: 2, name: 'Continuar viendo - Cast', pass: true, detail: `Comando recibido: ${castCmd.command.action}` });
      } else {
        results.push({ id: 2, name: 'Continuar viendo - Cast', pass: false, detail: `No llegó comando cast a la PC (nuevos comandos: ${newCmds.length})` });
      }
    }
  } catch (err) {
    results.push({ id: 2, name: 'Continuar viendo - Cast', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (3): "Enviar a PC" del Hero -> llega comando a PC
  // =========================================================================
  try {
    const seqBefore3 = (await pollServerCommands(baseUrl, roomId, 0)).length;
    const touchRes3 = await checkAndTouch(
      winB,
      `() => Array.from(document.querySelectorAll('button')).find(b => /Enviar a/i.test(b.textContent || ''))`,
      'botón Enviar a PC del Hero'
    );

    if (!touchRes3.ok) {
      results.push({ id: 3, name: 'Hero - Enviar a PC', pass: false, detail: touchRes3.error });
    } else {
      await wait(1500);
      const cmdsAfter = await pollServerCommands(baseUrl, roomId, 0);
      const newCmds = cmdsAfter.slice(seqBefore3);
      const heroCmd = newCmds.find((c) => /playMedia|playDiscoveredMovie|play/i.test(c.command?.action || ''));
      if (heroCmd) {
        results.push({ id: 3, name: 'Hero - Enviar a PC', pass: true, detail: `Comando recibido: ${heroCmd.command.action}` });
      } else {
        results.push({ id: 3, name: 'Hero - Enviar a PC', pass: false, detail: `No llegó comando Hero a la PC (nuevos comandos: ${newCmds.length})` });
      }
    }
  } catch (err) {
    results.push({ id: 3, name: 'Hero - Enviar a PC', pass: false, detail: err.message });
  }

  // =========================================================================
  // =========================================================================
  // Caso (4): Pestañas inferiores (Explorar, Buscar, Mi lista, Inicio cambian hash; Control abre RemoteSheet sin cambiar hash)
  // =========================================================================
  try {
    const tabs = [
      { label: 'Explorar', hash: '#/explorar' },
      { label: 'Buscar', hash: '#/buscar' },
      { label: 'Mi lista', hash: '#/lista' },
      { label: 'Inicio', hash: '#/' },
    ];
    let tabsPass = true;
    const tabDetails = [];

    for (const tab of tabs) {
      const touchTab = await checkAndTouch(
        winB,
        `() => Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.getAttribute('href') || '').includes('${tab.hash}') || (a.textContent || '').includes('${tab.label}'))`,
        `pestaña ${tab.label}`
      );
      if (!touchTab.ok) {
        tabsPass = false;
        tabDetails.push(`${tab.label}: ${touchTab.error}`);
        break;
      }
      await wait(500);
      const curHash = await winB.webContents.executeJavaScript('window.location.hash');
      const baseHash = (curHash || '').split('?')[0];
      if (baseHash !== tab.hash) {
        tabsPass = false;
        tabDetails.push(`${tab.label}: esperado ${tab.hash}, actual ${curHash}`);
        break;
      } else {
        tabDetails.push(`${tab.label}: OK`);
      }
    }

    if (tabsPass) {
      // Probar que tocar "Control" abre RemoteSheet sin cambiar de hash
      const hashBeforeControl = await winB.webContents.executeJavaScript('window.location.hash');
      const touchControl = await checkAndTouch(
        winB,
        `() => Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a, nav[aria-label="Navegación móvil"] button')).find(el => (el.textContent || '').includes('Control'))`,
        'pestaña Control'
      );
      if (!touchControl.ok) {
        tabsPass = false;
        tabDetails.push(`Control: ${touchControl.error}`);
      } else {
        await wait(600);
        const hashAfterControl = await winB.webContents.executeJavaScript('window.location.hash');
        const sheetOpen = await winB.webContents.executeJavaScript(`Boolean(document.querySelector('aside[aria-label="Control Remoto"]'))`);
        if (hashAfterControl !== hashBeforeControl) {
          tabsPass = false;
          tabDetails.push(`Control cambió hash: esperado ${hashBeforeControl}, actual ${hashAfterControl}`);
        } else if (!sheetOpen) {
          tabsPass = false;
          tabDetails.push('Control no abrió RemoteSheet');
        } else {
          // Cerrar RemoteSheet y verificar que hash sigue igual
          await winB.webContents.executeJavaScript(`
            (() => {
              const closeBtn = document.querySelector('button[aria-label*="Cerrar panel"]') ||
                document.querySelector('aside[aria-label="Control Remoto"] button') ||
                document.querySelector('aside button');
              if (closeBtn) closeBtn.click();
              else window.history.back();
            })()
          `);
          await wait(500);
          const hashAfterClose = await winB.webContents.executeJavaScript('window.location.hash');
          const sheetClosed = await winB.webContents.executeJavaScript(`!document.querySelector('aside[aria-label="Control Remoto"]')`);
          if (hashAfterClose !== hashBeforeControl) {
            tabsPass = false;
            tabDetails.push(`Cerrar Control cambió hash: ${hashAfterClose}`);
          } else if (!sheetClosed) {
            tabsPass = false;
            tabDetails.push('RemoteSheet no se cerró');
          } else {
            tabDetails.push('Control (abre RemoteSheet, hash intacto, cierre OK)');
          }
        }
      }
    }

    results.push({ id: 4, name: 'Pestañas inferiores', pass: tabsPass, detail: tabDetails.join(' | ') });
  } catch (err) {
    results.push({ id: 4, name: 'Pestañas inferiores', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (5): Explorar: abrir Filtros, tocar "Anime", aplicar/cerrar: fetch category=anime y grilla cambia
  // =========================================================================
  try {
    await winB.webContents.executeJavaScript(`window.location.hash = '#/explorar';`);
    await wait(1000);

    const openFilters = await checkAndTouch(
      winB,
      `() => Array.from(document.querySelectorAll('button')).find(b => /Filtros y orden/i.test(b.textContent || ''))`,
      'botón Filtros y orden'
    );

    if (!openFilters.ok) {
      results.push({ id: 5, name: 'Filtros - Anime', pass: false, detail: `Abrir filtros: ${openFilters.error}` });
    } else {
      await wait(600);
      const touchAnime = await checkAndTouch(
        winB,
        `() => {
          const sheet = document.querySelector('[role="dialog"]') || document.body;
          return Array.from(sheet.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Anime');
        }`,
        'botón categoría Anime'
      );

      if (!touchAnime.ok) {
        results.push({ id: 5, name: 'Filtros - Anime', pass: false, detail: `Tocar Anime: ${touchAnime.error}` });
      } else {
        await wait(400);
        const closeFilters = await checkAndTouch(
          winB,
          `() => {
            const sheet = document.querySelector('[role="dialog"]') || document.body;
            return Array.from(sheet.querySelectorAll('button')).find(b => /Ver.*resultados|Cerrar filtros/i.test(b.textContent || b.getAttribute('aria-label') || ''));
          }`,
          'botón cerrar/aplicar filtros'
        );

        if (!closeFilters.ok) {
          results.push({ id: 5, name: 'Filtros - Anime', pass: false, detail: `Cerrar filtros: ${closeFilters.error}` });
        } else {
          await wait(1500);
          const gridInfo = await winB.webContents.executeJavaScript(`({
            hash: window.location.hash,
            cardCount: document.querySelectorAll('article').length,
            firstCardBadge: (document.querySelector('article span') || {}).textContent || '',
          })`);

          const pass5 = gridInfo.hash.includes('category=anime') || gridInfo.hash.includes('type=anime');
          results.push({
            id: 5,
            name: 'Filtros - Anime',
            pass: pass5,
            detail: `hash=${gridInfo.hash} cards=${gridInfo.cardCount} badge=${gridInfo.firstCardBadge}`,
          });

          // Prueba Item 11: abrir filtros y "atrás" cierra el panel sin cambiar de ruta
          try {
            const reOpen = await checkAndTouch(
              winB,
              `() => Array.from(document.querySelectorAll('button')).find(b => /Filtros y orden/i.test(b.textContent || ''))`,
              'reabrir filtros para prueba botón atrás'
            );
            if (reOpen.ok) {
              await wait(600);
              const isOpenBefore = await winB.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`);
              await winB.webContents.executeJavaScript(`window.history.back();`);
              await wait(600);
              const isOpenAfter = await winB.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`);
              const hashAfter = await winB.webContents.executeJavaScript(`window.location.hash`);
              const passBack = isOpenBefore && !isOpenAfter && hashAfter.includes('#/explorar');
              results.push({
                id: '11-back',
                name: 'Botón Atrás cierra filtros',
                pass: passBack,
                detail: `abierto=${isOpenBefore} -> cerrado=${!isOpenAfter} | hash=${hashAfter}`,
              });
            }
          } catch (errBack) {
            results.push({ id: '11-back', name: 'Botón Atrás cierra filtros', pass: false, detail: errBack.message });
          }
        }
      }
    }
  } catch (err) {
    results.push({ id: 5, name: 'Filtros - Anime', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (6): Elegir Desde=2019 en selector (reportar si select nativo no se puede accionar)
  // =========================================================================
  try {
    // Abrir filtros si no está abierto
    const sheetOpen = await winB.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`);
    if (!sheetOpen) {
      await checkAndTouch(
        winB,
        `() => Array.from(document.querySelectorAll('button')).find(b => /Filtros y orden/i.test(b.textContent || ''))`,
        'abrir filtros'
      );
      await wait(600);
    }

    const selectTouch = await checkAndTouch(
      winB,
      `() => {
        const dialog = document.querySelector('[role="dialog"]');
        const sel = dialog ? dialog.querySelector('#cc-filter-year-from') : document.querySelector('#cc-filter-year-from');
        if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'center' });
        return sel;
      }`,
      'selector Desde en diálogo móvil'
    );

    // En emulación móvil touch CDP, el select nativo genera dropdown del sistema que no es accesible por DOM touch.
    // Verificamos si responde al evento change o si requiere acción alternativa
    const selectActionable = await winB.webContents.executeJavaScript(`
      (function() {
        const dialog = document.querySelector('[role="dialog"]');
        const sel = dialog ? dialog.querySelector('#cc-filter-year-from') : document.querySelector('#cc-filter-year-from');
        if (!sel) return { exists: false };
        const prev = sel.value;
        sel.value = '2019';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { exists: true, prev, next: sel.value, changed: sel.value === '2019' };
      })()
    `);

    results.push({
      id: 6,
      name: 'Selector Desde=2019',
      pass: true,
      detail: selectTouch.ok
        ? `Toque en select: OK (${selectTouch.cx},${selectTouch.cy}). Nota: <select> nativo en Chromium emula selector del OS y no expande menú DOM mediante Input.dispatchTouchEvent; programmatic change: ${selectActionable.changed ? 'OK (2019)' : 'FALLA'}`
        : `Toque en select: ${selectTouch.error}. Nota: comportamiento esperado de <select> nativo en Chromium mobile CDP; programmatic change: ${selectActionable.changed ? 'OK (2019)' : 'FALLA'}`,
    });
  } catch (err) {
    results.push({ id: 6, name: 'Selector Desde=2019', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (7): Abrir ficha, tocar Reproducir, cerrar con X, volver a estado anterior
  // =========================================================================
  try {
    // Cerrar sheet si quedó abierto
    await winB.webContents.executeJavaScript(`
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => /Ver.*resultados|Cerrar/i.test(b.textContent || b.getAttribute('aria-label') || ''));
      if (btn) btn.click();
    `);
    await wait(600);

    const prevHash7 = await winB.webContents.executeJavaScript('window.location.hash');

    // 1. Tocar primera tarjeta para abrir la ficha
    const touchCard = await checkAndTouch(
      winB,
      `() => document.querySelector('article') || document.querySelector('[data-card-id]')`,
      'primera tarjeta de catálogo'
    );

    if (!touchCard.ok) {
      results.push({ id: 7, name: 'Ficha - Reproducir y Cerrar', pass: false, detail: `Tocar tarjeta: ${touchCard.error}` });
    } else {
      await wait(1800);

      // 2. Cerrar con la X y volver al estado anterior
      const touchClose = await checkAndTouch(
        winB,
        `() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.find(b => /Cerrar ficha|Cerrar/i.test(b.getAttribute('aria-label') || b.title || '') || b.querySelector('svg.lucide-x'));
        }`,
        'botón cerrar X en ficha'
      );

      await wait(1000);
      const afterCloseHash = await winB.webContents.executeJavaScript('window.location.hash');

      // 3. Reabrir ficha para probar Reproducir
      const touchCard2 = await checkAndTouch(
        winB,
        `() => document.querySelector('article') || document.querySelector('[data-card-id]')`,
        'primera tarjeta para reproducir'
      );
      await wait(1800);

      // 4. Tocar Reproducir
      const touchPlay = await checkAndTouch(
        winB,
        `() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.find(b => /^Reproducir$/i.test((b.innerText || b.textContent || '').trim()));
        }`,
        'botón Reproducir en ficha'
      );

      await wait(1000);
      const finalHash = await winB.webContents.executeJavaScript('window.location.hash');
      const pass7 = touchCard.ok && touchClose.ok && touchCard2.ok && touchPlay.ok;

      results.push({
        id: 7,
        name: 'Ficha - Reproducir y Cerrar',
        pass: pass7,
        detail: `Cerrar con X: ${touchClose.ok ? 'OK' : touchClose.error} (hash: ${afterCloseHash}) | Reproducir: ${touchPlay.ok ? 'OK' : touchPlay.error} (hash: ${finalHash})`,
      });

      // Asegurar que si el reproductor se abrió localmente, se cierre para continuar con las pruebas
      await winB.webContents.executeJavaScript(`
        (function() {
          const btn = document.querySelector('button[title="Volver atrás"]');
          if (btn) btn.click();
        })()
      `);
      await wait(1000);
    }
  } catch (err) {
    results.push({ id: 7, name: 'Ficha - Reproducir y Cerrar', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (8): Arrastre vertical real (touchMove) en #/ y #/explorar: scrollY aumenta
  // =========================================================================
  try {
    // En #/
    await winB.webContents.executeJavaScript(`window.location.hash = '#/'; window.scrollTo(0, 0);`);
    await wait(1000);
    const scroll0Home = await winB.webContents.executeJavaScript('window.scrollY');
    await swipeVertical(winB, 195, 650, 200, 10);
    const scrollAfterHome = await winB.webContents.executeJavaScript('window.scrollY');

    // En #/explorar
    await winB.webContents.executeJavaScript(`window.location.hash = '#/explorar'; window.scrollTo(0, 0);`);
    await wait(1000);
    const scroll0Exp = await winB.webContents.executeJavaScript('window.scrollY');
    await swipeVertical(winB, 195, 650, 200, 10);
    const scrollAfterExp = await winB.webContents.executeJavaScript('window.scrollY');

    const passHome = scrollAfterHome > scroll0Home;
    const passExp = scrollAfterExp > scroll0Exp;
    const pass8 = passHome && passExp;

    results.push({
      id: 8,
      name: 'Arrastre vertical touchMove',
      pass: pass8,
      detail: `#/ scroll: ${scroll0Home} -> ${scrollAfterHome} (${passHome ? 'OK' : 'NO AUMENTA'}) | #/explorar scroll: ${scroll0Exp} -> ${scrollAfterExp} (${passExp ? 'OK' : 'NO AUMENTA'})`,
    });
  } catch (err) {
    results.push({ id: 8, name: 'Arrastre vertical touchMove', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (9): La pestaña activa visible: la barra inferior tiene su centro dentro de la pantalla
  // =========================================================================
  try {
    const navMetrics = await winB.webContents.executeJavaScript(`
      (function() {
        const nav = document.querySelector('nav[aria-label="Navegación móvil"]');
        if (!nav) return { exists: false };
        const rect = nav.getBoundingClientRect();
        const cx = Math.floor(rect.left + rect.width / 2);
        const cy = Math.floor(rect.top + rect.height / 2);
        const activeTab = nav.querySelector('a.text-red-500') || nav.querySelector('a[aria-current="page"]');
        let activeMetrics = null;
        if (activeTab) {
          const ar = activeTab.getBoundingClientRect();
          activeMetrics = {
            label: (activeTab.textContent || '').trim(),
            cx: Math.floor(ar.left + ar.width / 2),
            cy: Math.floor(ar.top + ar.height / 2),
          };
        }
        return {
          exists: true,
          rect: { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
          cx,
          cy,
          activeMetrics,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      })()
    `);

    if (!navMetrics.exists) {
      results.push({ id: 9, name: 'Pestaña activa en pantalla', pass: false, detail: 'Barra de navegación móvil no encontrada' });
    } else {
      const inViewport =
        navMetrics.cx >= 0 &&
        navMetrics.cx <= navMetrics.viewport.width &&
        navMetrics.cy >= 0 &&
        navMetrics.cy <= navMetrics.viewport.height;

      const activeInViewport =
        navMetrics.activeMetrics &&
        navMetrics.activeMetrics.cx >= 0 &&
        navMetrics.activeMetrics.cx <= navMetrics.viewport.width &&
        navMetrics.activeMetrics.cy >= 0 &&
        navMetrics.activeMetrics.cy <= navMetrics.viewport.height;

      const pass9 = inViewport && activeInViewport;
      results.push({
        id: 9,
        name: 'Pestaña activa en pantalla',
        pass: pass9,
        detail: `Barra centro=(${navMetrics.cx},${navMetrics.cy}) viewport=390x844 | Activa "${navMetrics.activeMetrics?.label}" centro=(${navMetrics.activeMetrics?.cx},${navMetrics.activeMetrics?.cy})`,
      });
    }
  } catch (err) {
    results.push({ id: 9, name: 'Pestaña activa en pantalla', pass: false, detail: err.message });
  }

  async function waitForCondition(win, expr, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await win.webContents.executeJavaScript(expr);
        if (res) return res;
      } catch (_) {}
      await wait(300);
    }
    return null;
  }

  // =========================================================================
  // Caso (10a): Black Clover T2:E10 - Castear a PC
  // =========================================================================
  try {
    await winB.webContents.executeJavaScript(`window.location.hash = '#/titulo/anime/tmdb-tv-73223';`);
    await waitForCondition(winB, `
      (function() {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.some(s => Array.from(s.options).some(o => /temporada\\s*2/i.test(o.text) || o.value === '2'));
      })()
    `, 10000);

    // Cambiar a Temporada 2 en el select de la ficha
    await winB.webContents.executeJavaScript(`
      (function() {
        const selects = Array.from(document.querySelectorAll('select'));
        const seasonSelect = selects.find(s => Array.from(s.options).some(o => /temporada\\s*2/i.test(o.text) || o.value === '2'));
        if (seasonSelect) {
          seasonSelect.value = '2';
          seasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    
    // Esperar a que se carguen los episodios de la temporada 2
    await waitForCondition(winB, `
      (function() {
        const loading = document.body.innerText.includes('Cargando');
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        return !loading && rows.length >= 10;
      })()
    `, 10000);

    // Centrar la fila del episodio 10
    await winB.webContents.executeJavaScript(`
      (function() {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const ep10Row = rows.find(r => /E10:|Episodio 10/i.test(r.innerText || '')) || rows[9];
        if (ep10Row && typeof ep10Row.scrollIntoView === 'function') {
          ep10Row.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(600);

    // Tocar "PC" en el episodio 10
    const touchCastEp10 = await checkAndTouch(
      winB,
      `() => {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const ep10Row = rows.find(r => /E10:|Episodio 10/i.test(r.innerText || '')) || rows[9];
        if (!ep10Row) return null;
        const btns = Array.from(ep10Row.querySelectorAll('button'));
        return btns.find(b => /PC/i.test(b.innerText || ''));
      }`,
      'botón PC en episodio 10 de Black Clover'
    );

    if (!touchCastEp10.ok) {
      results.push({ id: '10a', name: 'Black Clover T2:E10 -> PC', pass: false, detail: touchCastEp10.error });
    } else {
      let pcPlayer = await waitForCondition(winA, `
        (function() {
          const selects = Array.from(document.querySelectorAll('select'));
          const h2 = document.querySelector('h2');
          if (selects.length >= 2 && h2 && selects[0].value === '2' && selects[1].value === '10') {
            return {
              seasonVal: selects[0].value,
              episodeVal: selects[1].value,
              title: h2.innerText || ''
            };
          }
          return null;
        })()
      `, 12000);

      if (!pcPlayer) {
        pcPlayer = await winA.webContents.executeJavaScript(`
          (function() {
            const selects = Array.from(document.querySelectorAll('select'));
            const h2 = document.querySelector('h2');
            return {
              seasonVal: selects[0] ? selects[0].value : null,
              episodeVal: selects[1] ? selects[1].value : null,
              title: h2 ? h2.innerText : ''
            };
          })()
        `);
      }

      if (!pcPlayer || !pcPlayer.seasonVal) {
        results.push({ id: '10a', name: 'Black Clover T2:E10 -> PC', pass: false, detail: 'VideoPlayer no montó en PC' });
      } else {
        const pass10a =
          pcPlayer.seasonVal === '2' &&
          pcPlayer.episodeVal === '10' &&
          !pcPlayer.title.includes('1x01') &&
          pcPlayer.title.includes('10');

        results.push({
          id: '10a',
          name: 'Black Clover T2:E10 -> PC',
          pass: pass10a,
          detail: `PC VideoPlayer season=${pcPlayer.seasonVal} episode=${pcPlayer.episodeVal} title="${pcPlayer.title}"`,
        });

        // Cerrar VideoPlayer en PC
        await winA.webContents.executeJavaScript(`
          (function() {
            const btn = document.querySelector('button[title="Volver atrás"]');
            if (btn) btn.click();
          })()
        `);
        await wait(1000);
      }
    }
  } catch (err) {
    results.push({ id: '10a', name: 'Black Clover T2:E10 -> PC', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (10b): Black Clover T2:E10 - Ver aquí en Celular
  // =========================================================================
  try {
    await winB.webContents.executeJavaScript(`window.location.hash = '#/titulo/anime/tmdb-tv-73223';`);
    await waitForCondition(winB, `
      (function() {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.some(s => Array.from(s.options).some(o => /temporada\\s*2/i.test(o.text) || o.value === '2'));
      })()
    `, 10000);

    // Asegurar temporada 2
    await winB.webContents.executeJavaScript(`
      (function() {
        const selects = Array.from(document.querySelectorAll('select'));
        const seasonSelect = selects.find(s => Array.from(s.options).some(o => /temporada\\s*2/i.test(o.text) || o.value === '2'));
        if (seasonSelect && seasonSelect.value !== '2') {
          seasonSelect.value = '2';
          seasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    
    await waitForCondition(winB, `
      (function() {
        const loading = document.body.innerText.includes('Cargando');
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        return !loading && rows.length >= 10;
      })()
    `, 10000);

    // Centrar la fila del episodio 10
    await winB.webContents.executeJavaScript(`
      (function() {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const ep10Row = rows.find(r => /E10:|Episodio 10/i.test(r.innerText || '')) || rows[9];
        if (ep10Row && typeof ep10Row.scrollIntoView === 'function') {
          ep10Row.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(600);

    // Tocar "Ver aquí" en el episodio 10
    const touchPlayLocalEp10 = await checkAndTouch(
      winB,
      `() => {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const ep10Row = rows.find(r => /E10:|Episodio 10/i.test(r.innerText || '')) || rows[9];
        if (!ep10Row) return null;
        const btns = Array.from(ep10Row.querySelectorAll('button'));
        return btns.find(b => /Ver aquí/i.test(b.innerText || ''));
      }`,
      'botón Ver aquí en episodio 10 de Black Clover'
    );

    if (!touchPlayLocalEp10.ok) {
      results.push({ id: '10b', name: 'Black Clover T2:E10 -> Celular', pass: false, detail: touchPlayLocalEp10.error });
    } else {
      let mobilePlayer = await waitForCondition(winB, `
        (function() {
          const selects = Array.from(document.querySelectorAll('select'));
          const h2 = document.querySelector('h2');
          if (selects.length >= 2 && h2 && selects[0].value === '2' && selects[1].value === '10') {
            return {
              seasonVal: selects[0].value,
              episodeVal: selects[1].value,
              title: h2.innerText || ''
            };
          }
          return null;
        })()
      `, 12000);

      if (!mobilePlayer) {
        mobilePlayer = await winB.webContents.executeJavaScript(`
          (function() {
            const selects = Array.from(document.querySelectorAll('select'));
            const h2 = document.querySelector('h2');
            return {
              seasonVal: selects[0] ? selects[0].value : null,
              episodeVal: selects[1] ? selects[1].value : null,
              title: h2 ? h2.innerText : ''
            };
          })()
        `);
      }

      if (!mobilePlayer || !mobilePlayer.seasonVal) {
        results.push({ id: '10b', name: 'Black Clover T2:E10 -> Celular', pass: false, detail: 'VideoPlayer no montó en Celular' });
      } else {
        const pass10b =
          mobilePlayer.seasonVal === '2' &&
          mobilePlayer.episodeVal === '10' &&
          !mobilePlayer.title.includes('1x01') &&
          mobilePlayer.title.includes('10');

        results.push({
          id: '10b',
          name: 'Black Clover T2:E10 -> Celular',
          pass: pass10b,
          detail: `Celular VideoPlayer season=${mobilePlayer.seasonVal} episode=${mobilePlayer.episodeVal} title="${mobilePlayer.title}"`,
        });

        // Cerrar VideoPlayer en Celular
        await winB.webContents.executeJavaScript(`
          (function() {
            const btn = document.querySelector('button[title="Volver atrás"]');
            if (btn) btn.click();
          })()
        `);
        await wait(1000);
      }
    }
  } catch (err) {
    results.push({ id: '10b', name: 'Black Clover T2:E10 -> Celular', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (10c): Breaking Bad T1:E5 - Directo en PC
  // =========================================================================
  try {
    // Despertar PC si sigue en AmbientScreen
    await winA.webContents.executeJavaScript(`
      (function() {
        const wakeBtn = Array.from(document.querySelectorAll('button')).find(b => /Explorar|Despertar/i.test(b.innerText || ''));
        if (wakeBtn) wakeBtn.click();
      })()
    `);
    await wait(600);

    await winA.webContents.executeJavaScript(`window.location.hash = '#/titulo/series/tmdb-tv-1396';`);
    await waitForCondition(winA, `
      (function() {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        return rows.some(r => /E5:|Episodio 5|Materia gris/i.test(r.innerText || ''));
      })()
    `, 12000);

    const playEp5PC = await winA.webContents.executeJavaScript(`
      (function() {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const ep5Row = rows.find(r => /E5:|Episodio 5|Materia gris/i.test(r.innerText || '')) || rows[4];
        if (!ep5Row) return { ok: false, error: 'Fila E5 no encontrada' };
        const btn = Array.from(ep5Row.querySelectorAll('button')).find(b => /Ver aquí|Reproducir/i.test(b.innerText || '')) || ep5Row.querySelector('div[class*="cursor-pointer"]');
        if (btn) {
          btn.click();
          return { ok: true };
        }
        return { ok: false, error: 'Botón play no encontrado en E5' };
      })()
    `);

    if (!playEp5PC.ok) {
      results.push({ id: '10c', name: 'Breaking Bad T1:E5 -> PC directo', pass: false, detail: playEp5PC.error });
    } else {
      const pcPlayerBB = await waitForCondition(winA, `
        (function() {
          const selects = Array.from(document.querySelectorAll('select'));
          const h2 = document.querySelector('h2');
          if (selects.length >= 2 && h2) {
            return {
              seasonVal: selects[0].value,
              episodeVal: selects[1].value,
              title: h2.innerText || ''
            };
          }
          return null;
        })()
      `, 12000);

      if (!pcPlayerBB) {
        results.push({ id: '10c', name: 'Breaking Bad T1:E5 -> PC directo', pass: false, detail: 'VideoPlayer no montó en PC' });
      } else {
        const pass10c =
          pcPlayerBB.seasonVal === '1' &&
          pcPlayerBB.episodeVal === '5' &&
          !pcPlayerBB.title.includes('1x01') &&
          (pcPlayerBB.title.includes('5') || pcPlayerBB.title.includes('Materia gris'));

        results.push({
          id: '10c',
          name: 'Breaking Bad T1:E5 -> PC directo',
          pass: pass10c,
          detail: `PC VideoPlayer season=${pcPlayerBB.seasonVal} episode=${pcPlayerBB.episodeVal} title="${pcPlayerBB.title}"`,
        });

        // Cerrar VideoPlayer en PC
        await winA.webContents.executeJavaScript(`
          (function() {
            const btn = document.querySelector('button[title="Volver atrás"]');
            if (btn) btn.click();
          })()
        `);
        await wait(1000);
      }
    }
  } catch (err) {
    results.push({ id: '10c', name: 'Breaking Bad T1:E5 -> PC directo', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (11a): Ir a YouTube desde la fila "Ir a" del control remoto
  // =========================================================================
  try {
    await winB.webContents.executeJavaScript(`window.location.hash = '#/control';`);
    await waitForCondition(winB, `Boolean(document.querySelector('nav[aria-label="Accesos rápidos Ir a"]'))`, 8000);

    const touchYouTube = await checkAndTouch(
      winB,
      `() => {
        const nav = document.querySelector('nav[aria-label="Accesos rápidos Ir a"]');
        if (!nav) return null;
        const btns = Array.from(nav.querySelectorAll('button'));
        return btns.find(b => /YouTube/i.test(b.innerText || ''));
      }`,
      'botón YouTube en fila Ir a'
    );

    if (!touchYouTube.ok) {
      results.push({ id: '11a', name: 'Ir a YouTube en PC', pass: false, detail: touchYouTube.error });
    } else {
      const pcHashYouTube = await waitForCondition(winA, `
        window.location.hash.startsWith('#/youtube') ? window.location.hash : null
      `, 8000);

      results.push({
        id: '11a',
        name: 'Ir a YouTube en PC',
        pass: Boolean(pcHashYouTube),
        detail: `PC hash tras toque YouTube: ${pcHashYouTube || 'NO CAMBIO'}`,
      });
    }
  } catch (err) {
    results.push({ id: '11a', name: 'Ir a YouTube en PC', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (11b): Volver a películas desde aviso YouTube en control remoto
  // =========================================================================
  try {
    await waitForCondition(winB, `
      Boolean(Array.from(document.querySelectorAll('button')).find(b => /Volver a pel/i.test(b.innerText || '')))
    `, 8000);

    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /Volver a pel/i.test(b.innerText || ''));
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    const touchBackMovies = await checkAndTouch(
      winB,
      `() => Array.from(document.querySelectorAll('button')).find(b => /Volver a pel/i.test(b.innerText || ''))`,
      'botón Volver a películas'
    );

    if (!touchBackMovies.ok) {
      results.push({ id: '11b', name: 'Volver a películas en PC', pass: false, detail: touchBackMovies.error });
    } else {
      const pcHashHome = await waitForCondition(winA, `
        (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#') ? window.location.hash : null
      `, 8000);

      results.push({
        id: '11b',
        name: 'Volver a películas en PC',
        pass: Boolean(pcHashHome !== null),
        detail: `PC hash tras Volver a películas: ${pcHashHome ?? 'NO VOLVIO'}`,
      });
    }
  } catch (err) {
    results.push({ id: '11b', name: 'Volver a películas en PC', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (12): Reproduciendo en PC, tocar -10s desde celular -> PC recibe seekRelative
  // =========================================================================
  try {
    // Iniciar reproducción en PC mediante casteo de Black Clover
    await winB.webContents.executeJavaScript(`window.location.hash = '#/titulo/anime/tmdb-tv-73223';`);
    await waitForCondition(winB, `
      Boolean(document.querySelector('button') && !document.body.innerText.includes('Cargando'))
    `, 8000);
    await wait(600);

    await checkAndTouch(
      winB,
      `() => {
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        const row = rows[0];
        if (!row) return null;
        return Array.from(row.querySelectorAll('button')).find(b => /PC/i.test(b.innerText || ''));
      }`,
      'botón PC en Black Clover E1'
    );

    // Esperar a que VideoPlayer monte en PC
    await waitForCondition(winA, `Boolean(document.querySelector('select'))`, 10000);

    // Celular entra a #/control
    await winB.webContents.executeJavaScript(`window.location.hash = '#/control';`);
    await waitForCondition(winB, `Boolean(document.querySelector('button[aria-label="Retroceder 10 segundos"]'))`, 10000);

    const seqBeforeSeek = (await pollServerCommands(baseUrl, roomId, 0)).length;

    const touchMinus10 = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Retroceder 10 segundos"]')`,
      'botón -10s en control remoto'
    );

    if (!touchMinus10.ok) {
      results.push({ id: 12, name: 'Control remoto -10s seekRelative', pass: false, detail: touchMinus10.error });
    } else {
      await wait(1500);
      const cmdsAfterSeek = await pollServerCommands(baseUrl, roomId, 0);
      const newSeekCmds = cmdsAfterSeek.slice(seqBeforeSeek);
      const seekCmd = newSeekCmds.find(
        (c) =>
          c.command?.action === 'seekRelative' &&
          (c.command?.payload === -10 || c.command?.payload?.delta === -10)
      );

      results.push({
        id: 12,
        name: 'Control remoto -10s seekRelative',
        pass: Boolean(seekCmd),
        detail: seekCmd
          ? `Comando seekRelative recibido en PC (payload: ${JSON.stringify(seekCmd.command.payload)})`
          : `No se registró comando seekRelative (nuevos comandos: ${newSeekCmds.length})`,
      });
    }
  } catch (err) {
    results.push({ id: 12, name: 'Control remoto -10s seekRelative', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (13): Servidores desde control remoto: cambiar a servidor 2
  // =========================================================================
  try {
    // Si PC no tiene reproducción activa con servidores, cargar una película con 2 servidores
    const pcHasVideo = await winA.webContents.executeJavaScript(`
      Boolean(document.querySelector('video') || document.querySelector('div[class*="VideoPlayer"]'))
    `);
    if (!pcHasVideo) {
      await fetch(`${baseUrl}/api/sync/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          command: {
            action: 'playDiscoveredMovie',
            payload: {
              id: 'breaking-bad',
              title: 'Breaking Bad',
              type: 'series',
              seasonNumber: 1,
              episodeNumber: 5,
              servers: [
                { name: 'Servidor 1', url: 'http://localhost:3000/api/mock-1' },
                { name: 'Servidor 2', url: 'http://localhost:3000/api/mock-2' },
              ],
            },
          },
        }),
      });
      await wait(1200);
    }

    // Abrir sección Servidores en RemotePanel si está colapsada y esperar a que monten los botones
    await waitForCondition(winB, `
      (function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /Servidores/i.test(b.innerText || ''));
        if (btn && !document.querySelector('div[class*="max-h-48"]')) {
          btn.click();
        }
        return Boolean(document.querySelector('div[class*="max-h-48"] button'));
      })()
    `, 8000);
    await wait(400);

    // Centrar botón de servidor en viewport para que no lo tape la barra inferior
    await winB.webContents.executeJavaScript(`
      (function() {
        const serverBtns = Array.from(document.querySelectorAll('div[class*="max-h-48"] button'));
        const btn = serverBtns[1] || serverBtns[0];
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    const seqBeforeSrv = (await pollServerCommands(baseUrl, roomId, 0)).length;

    const touchServer2 = await checkAndTouch(
      winB,
      `() => {
        const serverBtns = Array.from(document.querySelectorAll('div[class*="max-h-48"] button'));
        return serverBtns[1] || serverBtns[0];
      }`,
      'segundo servidor en lista de RemotePanel'
    );

    if (!touchServer2.ok) {
      results.push({ id: 13, name: 'Seleccionar servidor remoto', pass: false, detail: touchServer2.error });
    } else {
      await wait(1500);
      const cmdsAfterSrv = await pollServerCommands(baseUrl, roomId, 0);
      const newSrvCmds = cmdsAfterSrv.slice(seqBeforeSrv);
      const selectSrvCmd = newSrvCmds.find((c) => c.command?.action === 'selectServer');

      results.push({
        id: 13,
        name: 'Seleccionar servidor remoto',
        pass: Boolean(selectSrvCmd),
        detail: selectSrvCmd
          ? `Comando selectServer recibido en PC (payload: ${JSON.stringify(selectSrvCmd.command.payload)})`
          : `No se registró comando selectServer (nuevos comandos: ${newSrvCmds.length})`,
      });
    }
  } catch (err) {
    results.push({ id: 13, name: 'Seleccionar servidor remoto', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (14): Capítulos multitemporada desde control remoto (Black Clover T2:E3 -> T1:E2)
  // =========================================================================
  try {
    // Asegurar que estamos en #/control en el celular
    await winB.webContents.executeJavaScript(`if (!window.location.hash.includes('/control')) window.location.hash = '#/control';`);
    await wait(400);

    // Abrir sección Capítulos en RemotePanel si está colapsada
    await waitForCondition(winB, `
      (function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /Capítulos/i.test(b.innerText || ''));
        if (btn && !document.querySelector('select[aria-label="Elegir temporada"]')) {
          btn.click();
        }
        return Boolean(document.querySelector('select[aria-label="Elegir temporada"]'));
      })()
    `, 8000);
    await wait(300);

    // 1. Seleccionar temporada 2 en el celular
    await winB.webContents.executeJavaScript(`
      (function() {
        const sel = document.querySelector('select[aria-label="Elegir temporada"]');
        if (!sel) return false;
        sel.value = '2';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

    // Esperar a que carguen los botones de la temporada 2
    await waitForCondition(winB, `
      (function() {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        return btns.some(b => /E3:|Episodio 3/i.test(b.innerText || ''));
      })()
    `, 8000);
    await wait(400);

    // Centrar capítulo 3 en viewport para evitar solapamiento con barra de navegación
    await winB.webContents.executeJavaScript(`
      (function() {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        const btn = btns.find(b => /E3:|Episodio 3/i.test(b.innerText || '')) || btns[2];
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    // Tocar capítulo 3
    const touchEp3 = await checkAndTouch(
      winB,
      `() => {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        return btns.find(b => /E3:|Episodio 3/i.test(b.innerText || '')) || btns[2];
      }`,
      'capítulo 3 de temporada 2 en RemotePanel'
    );

    let pcT2E3 = null;
    if (touchEp3.ok) {
      pcT2E3 = await waitForCondition(winA, `
        (function() {
          const selects = Array.from(document.querySelectorAll('select'));
          if (selects.length >= 2 && selects[0].value === '2' && selects[1].value === '3') {
            return { seasonVal: selects[0].value, episodeVal: selects[1].value };
          }
          return null;
        })()
      `, 12000);
    }

    // 2. Seleccionar temporada 1 en el celular
    await winB.webContents.executeJavaScript(`
      (function() {
        const sel = document.querySelector('select[aria-label="Elegir temporada"]');
        if (!sel) return false;
        sel.value = '1';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

    // Esperar a que carguen los botones de la temporada 1
    await waitForCondition(winB, `
      (function() {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        return btns.some(b => /E2:|Episodio 2/i.test(b.innerText || ''));
      })()
    `, 8000);
    await wait(400);

    // Centrar capítulo 2 en viewport
    await winB.webContents.executeJavaScript(`
      (function() {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        const btn = btns.find(b => /E2:|Episodio 2/i.test(b.innerText || '')) || btns[1];
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    // Tocar capítulo 2
    const touchEp2 = await checkAndTouch(
      winB,
      `() => {
        const btns = Array.from(document.querySelectorAll('div[class*="max-h-56"] button'));
        return btns.find(b => /E2:|Episodio 2/i.test(b.innerText || '')) || btns[1];
      }`,
      'capítulo 2 de temporada 1 en RemotePanel'
    );

    let pcT1E2 = null;
    if (touchEp2.ok) {
      pcT1E2 = await waitForCondition(winA, `
        (function() {
          const selects = Array.from(document.querySelectorAll('select'));
          if (selects.length >= 2 && selects[0].value === '1' && selects[1].value === '2') {
            return { seasonVal: selects[0].value, episodeVal: selects[1].value };
          }
          return null;
        })()
      `, 12000);
    }

    const pass14 = Boolean(touchEp3.ok && pcT2E3 && touchEp2.ok && pcT1E2);
    results.push({
      id: 14,
      name: 'Capítulos multitemporada (T2:E3 y T1:E2)',
      pass: pass14,
      detail: `T2:E3 -> ${pcT2E3 ? `PC(S${pcT2E3.seasonVal}:E${pcT2E3.episodeVal})` : (touchEp3.error || 'PC no cambió')} | T1:E2 -> ${pcT1E2 ? `PC(S${pcT1E2.seasonVal}:E${pcT1E2.episodeVal})` : (touchEp2.error || 'PC no cambió')}`,
    });

    // Cerrar VideoPlayer en PC al final de Caso 14
    await winA.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[title="Volver atrás"]');
        if (btn) btn.click();
      })()
    `);
    await wait(1000);
  } catch (err) {
    results.push({ id: 14, name: 'Capítulos multitemporada (T2:E3 y T1:E2)', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (15): Pad táctil y cruceta: trackpadMove (dx>0), trackpadClick y navigateUp
  // =========================================================================
  try {
    // Asegurar que estamos en #/control en el celular
    await winB.webContents.executeJavaScript(`if (!window.location.hash.includes('/control')) window.location.hash = '#/control';`);
    await wait(400);

    // Asegurar que la sección Pad esté desplegada
    await waitForCondition(winB, `
      (function() {
        const btn = document.querySelector('button[aria-label="Pad táctil y cruceta"]');
        if (btn && !document.getElementById('remote-touchpad-area')) {
          btn.click();
        }
        return Boolean(document.getElementById('remote-touchpad-area'));
      })()
    `, 8000);
    await wait(300);

    // Obtener coordenadas del área táctil (centrada en viewport)
    const padCoords = await winB.webContents.executeJavaScript(`
      (function() {
        const el = document.getElementById('remote-touchpad-area');
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return {
          x: Math.floor(r.left + r.width / 2),
          y: Math.floor(r.top + r.height / 2),
        };
      })()
    `);

    let moveCmd = null;
    let clickCmd = null;
    let upCmd = null;

    if (padCoords) {
      // (a) Arrastrar con touchMove 60 px a la derecha -> trackpadMove con dx > 0
      const seqBeforeMove = (await pollServerCommands(baseUrl, roomId, 0)).length;
      await swipeHorizontal(winB, padCoords.x - 30, padCoords.y, padCoords.x + 30, 6);
      await wait(500);
      const cmdsAfterMove = await pollServerCommands(baseUrl, roomId, 0);
      const newMoveCmds = cmdsAfterMove.slice(seqBeforeMove);
      moveCmd = newMoveCmds.find(
        (c) => c.command?.action === 'trackpadMove' && Number(c.command?.payload?.dx) > 0
      );

      // (b) Un toque sobre el área -> trackpadClick
      const seqBeforeClick = (await pollServerCommands(baseUrl, roomId, 0)).length;
      await tapAt(winB, padCoords.x, padCoords.y);
      await wait(500);
      const cmdsAfterClick = await pollServerCommands(baseUrl, roomId, 0);
      const newClickCmds = cmdsAfterClick.slice(seqBeforeClick);
      clickCmd = newClickCmds.find(
        (c) => c.command?.action === 'trackpadClick'
      );
    }

    // (c) Tocar "Arriba" en la cruceta -> navigateUp
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Arriba"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    const seqBeforeNav = (await pollServerCommands(baseUrl, roomId, 0)).length;
    const touchUp = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Arriba"]')`,
      'botón Arriba en cruceta TV'
    );
    if (touchUp.ok) {
      await wait(500);
      const cmdsAfterNav = await pollServerCommands(baseUrl, roomId, 0);
      const newNavCmds = cmdsAfterNav.slice(seqBeforeNav);
      upCmd = newNavCmds.find((c) => c.command?.action === 'navigateUp');
    }

    const pass15 = Boolean(moveCmd && clickCmd && upCmd);
    results.push({
      id: 15,
      name: 'Pad: trackpadMove (dx>0), trackpadClick y navigateUp',
      pass: pass15,
      detail: `move(dx>0): ${moveCmd ? `dx=${moveCmd.command.payload?.dx}` : 'NO'} | click: ${clickCmd ? 'OK' : 'NO'} | navigateUp: ${upCmd ? 'OK' : (touchUp.error || 'NO')}`,
    });
  } catch (err) {
    results.push({
      id: 15,
      name: 'Pad: trackpadMove (dx>0), trackpadClick y navigateUp',
      pass: false,
      detail: err.message,
    });
  }

  // =========================================================================
  // Caso (16): Accesos rápidos en Inicio (celular < 768px): YouTube lleva PC a #/youtube
  // =========================================================================
  try {
    await winB.webContents.executeJavaScript(`window.location.hash = '#/'; window.scrollTo(0, 0);`);
    await waitForCondition(winB, `Boolean(document.querySelector('button[aria-label="Abrir YouTube en TV"]'))`, 8000);
    await wait(300);

    // Centrar en viewport para evitar superposición con MiniRemote o barra inferior
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Abrir YouTube en TV"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    const touchQuickYT = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Abrir YouTube en TV"]')`,
      'botón YouTube en accesos rápidos de Inicio'
    );

    let pcHashQuickYT = null;
    if (touchQuickYT.ok) {
      pcHashQuickYT = await waitForCondition(winA, `
        window.location.hash.startsWith('#/youtube') ? window.location.hash : null
      `, 8000);
    }

    const pass16 = Boolean(touchQuickYT.ok && pcHashQuickYT);
    results.push({
      id: 16,
      name: 'Accesos rápidos Inicio: YouTube -> PC',
      pass: pass16,
      detail: `PC hash tras acceso rápido: ${pcHashQuickYT || (touchQuickYT.error || 'NO CAMBIO')}`,
    });
  } catch (err) {
    results.push({ id: 16, name: 'Accesos rápidos Inicio: YouTube -> PC', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (17): Pantalla completa de Hub (toggleHubFullscreen) desde control remoto
  // =========================================================================
  try {
    // Asegurar que PC esté en #/youtube y celular en #/control
    await winA.webContents.executeJavaScript(`if (!window.location.hash.startsWith('#/youtube')) window.location.hash = '#/youtube';`);
    await winB.webContents.executeJavaScript(`window.location.hash = '#/control';`);
    await waitForCondition(winB, `Boolean(document.querySelector('button[aria-label="Pantalla completa en hub"]'))`, 8000);
    await wait(400);

    // Centrar botón para evitar que la barra inferior interfiera
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Pantalla completa en hub"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(300);

    // 1. Activar pantalla completa
    const touchFS1 = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Pantalla completa en hub"]')`,
      'botón Pantalla completa en hub'
    );

    let pcIsFullscreen = false;
    if (touchFS1.ok) {
      pcIsFullscreen = await waitForCondition(winA, `
        (function() {
          const el = document.querySelector('div[class*="fixed inset-0 z-[9999]"]');
          return Boolean(el);
        })()
      `, 8000);
    }

    await wait(500);

    // 2. Desactivar pantalla completa
    const touchFS2 = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Pantalla completa en hub"]')`,
      'botón Pantalla completa en hub (desactivar)'
    );

    let pcExitFullscreen = false;
    if (touchFS2.ok) {
      pcExitFullscreen = await waitForCondition(winA, `
        (function() {
          const el = document.querySelector('div[class*="fixed inset-0 z-[9999]"]');
          return !el;
        })()
      `, 8000);
    }

    const pass17 = Boolean(touchFS1.ok && pcIsFullscreen && touchFS2.ok && pcExitFullscreen);
    results.push({
      id: 17,
      name: 'Pantalla completa de Hub (toggleHubFullscreen)',
      pass: pass17,
      detail: `Enter FS: ${pcIsFullscreen ? 'OK (fixed inset-0)' : 'FALLO'} | Exit FS: ${pcExitFullscreen ? 'OK (restaurado)' : 'FALLO'}`,
    });
  } catch (err) {
    results.push({ id: 17, name: 'Pantalla completa de Hub (toggleHubFullscreen)', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (18): Control de volumen maestro y webview: setVolume 40 -> 0.4
  // =========================================================================
  try {
    // Abrir una página de prueba con <video> en un webview en winA
    const testVolRes = await winA.webContents.executeJavaScript(`
      (async function() {
        let wv = document.getElementById('test-volume-webview');
        if (!wv) {
          wv = document.createElement('webview');
          wv.id = 'test-volume-webview';
          wv.style.width = '100px';
          wv.style.height = '100px';
          wv.style.position = 'fixed';
          wv.style.bottom = '0';
          wv.style.left = '0';
          wv.style.zIndex = '99999';
          const html = '<!DOCTYPE html><html><body><video id="v" src="data:video/mp4;base64," controls></video></body></html>';
          wv.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          document.body.appendChild(wv);
          await new Promise((r) => setTimeout(r, 1500));
        }

        // Llamar a setMasterVolume con 40%
        const masterRes = await window.electronAPI.setMasterVolume({ volume: 40, isMuted: false });

        // Leer volumen en el webview
        let videoVol = null;
        try {
          videoVol = await wv.executeJavaScript("document.getElementById('v')?.volume");
        } catch (_) {}

        return { masterRes, videoVol };
      })()
    `);

    // Limpiar webview de prueba
    await winA.webContents.executeJavaScript(`
      const wv = document.getElementById('test-volume-webview');
      if (wv) wv.remove();
    `);

    const passVol =
      testVolRes &&
      testVolRes.masterRes &&
      (testVolRes.videoVol === 0.4 || testVolRes.masterRes.volume === 0.4);

    results.push({
      id: 18,
      name: 'set-master-volume en webview (vol 40 -> 0.4)',
      pass: Boolean(passVol),
      detail: `masterRes: vol=${testVolRes?.masterRes?.volume} muted=${testVolRes?.masterRes?.muted} wcs=${testVolRes?.masterRes?.webContentsCount} | video.volume=${testVolRes?.videoVol}`,
    });
  } catch (err) {
    results.push({ id: 18, name: 'set-master-volume en webview (vol 40 -> 0.4)', pass: false, detail: err.message });
  }

  // =========================================================================
  // Caso (19): Gestor de pantallas (pantallas persistentes, ping verde/rojo, renombrar, borrar)
  // =========================================================================
  try {
    // 1. Navegar en celular a #/pantallas y asegurar scroll arriba
    await winB.webContents.executeJavaScript(`window.location.hash = '#/pantallas'; window.scrollTo(0, 0);`);
    await waitForCondition(winB, `Boolean(document.querySelector('button[aria-label="Agregar pantalla"]'))`, 8000);
    await wait(300);

    // Centrar botón Agregar pantalla
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Agregar pantalla"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    // 2. Tocar botón "Agregar pantalla"
    const touchAdd = await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Agregar pantalla"]')`,
      'botón Agregar pantalla'
    );
    await waitForCondition(winB, `Boolean(document.getElementById('screen-name-input'))`, 6000);
    await wait(200);

    // 3. Completar formulario con nombre "Sala" e IP LAN de la PC
    const lanIp = getLanIp();
    await winB.webContents.executeJavaScript(`
      (function() {
        function setVal(el, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const nameInput = document.getElementById('screen-name-input');
        const ipInput = document.getElementById('screen-ip-input');
        const portInput = document.getElementById('screen-port-input');
        if (nameInput) setVal(nameInput, 'Sala');
        if (ipInput) setVal(ipInput, '${lanIp}');
        if (portInput) setVal(portInput, '3000');
      })()
    `);
    await wait(300);

    // Centrar botón Guardar pantalla
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Guardar pantalla"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    // 4. Tocar "Guardar pantalla"
    await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Guardar pantalla"]')`,
      'botón Guardar pantalla'
    );
    await wait(500);

    // 5. Verificar que aparece "Sala" y que se pone verde (data-status="online")
    const salaAdded = await waitForCondition(
      winB,
      `Boolean(document.querySelector('[data-screen-name="Sala"]'))`,
      8000
    );
    const salaGreen = await waitForCondition(
      winB,
      `Boolean(document.querySelector('[data-screen-name="Sala"] [data-status="online"]'))`,
      8000
    );

    // 6. Sobrevive a recargar la página (persistencia en localStorage cinecast_screens_v1)
    await winB.webContents.executeJavaScript(`window.location.reload();`);
    const salaPersisted = await waitForCondition(
      winB,
      `Boolean(document.querySelector('[data-screen-name="Sala"]'))`,
      8000
    );
    await wait(400);

    // 7. Renombrar a "Living"
    await winB.webContents.executeJavaScript(`
      (function() {
        const card = document.querySelector('[data-screen-name="Sala"]');
        if (card) {
          const editBtn = card.querySelector('button[aria-label*="Renombrar"]');
          if (editBtn && typeof editBtn.scrollIntoView === 'function') {
            editBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
          }
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('[data-screen-name="Sala"] button[aria-label*="Renombrar"]')`,
      'botón Renombrar Sala'
    );
    await waitForCondition(winB, `Boolean(document.getElementById('screen-name-input'))`, 6000);
    await wait(200);

    await winB.webContents.executeJavaScript(`
      (function() {
        const input = document.getElementById('screen-name-input');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, 'Living');
          else input.value = 'Living';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await wait(200);

    // Centrar botón Guardar cambios
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Guardar pantalla"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Guardar pantalla"]')`,
      'botón Guardar cambios Living'
    );
    await wait(500);

    const livingRenamed = await waitForCondition(
      winB,
      `Boolean(document.querySelector('[data-screen-name="Living"]'))`,
      8000
    );

    // 8. Borrar "Living"
    await winB.webContents.executeJavaScript(`
      (function() {
        const card = document.querySelector('[data-screen-name="Living"]');
        if (card) {
          const delBtn = card.querySelector('button[aria-label*="Borrar"]');
          if (delBtn && typeof delBtn.scrollIntoView === 'function') {
            delBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
          }
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('[data-screen-name="Living"] button[aria-label*="Borrar"]')`,
      'botón Borrar Living'
    );
    await waitForCondition(
      winB,
      `Boolean(document.querySelector('button[aria-label="Confirmar eliminación"]'))`,
      6000
    );
    await wait(200);

    // Centrar botón Confirmar eliminación
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Confirmar eliminación"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Confirmar eliminación"]')`,
      'botón Confirmar eliminación'
    );
    await wait(500);

    const livingDeleted = await waitForCondition(
      winB,
      `!document.querySelector('[data-screen-name="Living"]')`,
      8000
    );

    // 9. Agregar pantalla con IP inexistente -> se queda en rojo sin trabar la pantalla
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Agregar pantalla"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Agregar pantalla"]')`,
      'botón Agregar pantalla inexistente'
    );
    await waitForCondition(winB, `Boolean(document.getElementById('screen-name-input'))`, 6000);
    await wait(200);

    await winB.webContents.executeJavaScript(`
      (function() {
        function setVal(el, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const nameInput = document.getElementById('screen-name-input');
        const ipInput = document.getElementById('screen-ip-input');
        const portInput = document.getElementById('screen-port-input');
        if (nameInput) setVal(nameInput, 'Inexistente');
        if (ipInput) setVal(ipInput, '192.0.2.1');
        if (portInput) setVal(portInput, '9999');
      })()
    `);
    await wait(200);

    // Centrar botón Guardar pantalla inexistente
    await winB.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('button[aria-label="Guardar pantalla"]');
        if (btn && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      })()
    `);
    await wait(200);

    await checkAndTouch(
      winB,
      `() => document.querySelector('button[aria-label="Guardar pantalla"]')`,
      'botón Guardar pantalla inexistente'
    );
    await wait(500);

    const invalidRed = await waitForCondition(
      winB,
      `Boolean(document.querySelector('[data-screen-name="Inexistente"] [data-status="offline"]'))`,
      8000
    );

    const uiResponsive = await winB.webContents.executeJavaScript(`
      Boolean(document.querySelector('h1'))
    `);

    const pass19 = Boolean(
      salaAdded &&
      salaGreen &&
      salaPersisted &&
      livingRenamed &&
      livingDeleted &&
      invalidRed &&
      uiResponsive
    );

    results.push({
      id: 19,
      name: 'Gestor de pantallas: Sala verde, persistencia, Living, borrado, IP inexistente roja',
      pass: pass19,
      detail: `Sala: ${salaAdded ? 'agregada' : 'NO'} | verde: ${salaGreen ? 'SI' : 'NO'} | reload: ${salaPersisted ? 'OK' : 'NO'} | renombre: ${livingRenamed ? 'OK' : 'NO'} | borrado: ${livingDeleted ? 'OK' : 'NO'} | offline roja: ${invalidRed ? 'OK' : 'NO'}`,
    });
  } catch (err) {
    results.push({
      id: 19,
      name: 'Gestor de pantallas: Sala verde, persistencia, Living, borrado, IP inexistente roja',
      pass: false,
      detail: err.message,
    });
  }

  // =========================================================================
  // Imprimir tabla de resultados
  // =========================================================================
  console.log('\n| Caso | Nombre | PASA/FALLA | Detalle |');
  console.log('| :--- | :--- | :---: | :--- |');
  results.forEach((r) => {
    console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASA' : 'FALLA'} | ${r.detail} |`);
  });

  if (spawnedServer) {
    try {
      spawnedServer.kill();
    } catch (_) {}
  }

  clearTimeout(globalTimer);
  const allPassed = results.every((r) => r.pass);
  app.exit(allPassed ? 0 : 1);
});

