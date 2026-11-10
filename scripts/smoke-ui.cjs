// Si el entorno tiene ELECTRON_RUN_AS_NODE=1 (por ejemplo, heredado de un IDE basado en Electron),
// relanzar automáticamente sin esa variable para que require('electron') cargue el runtime real.
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

const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const baseUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

// Registrar handlers IPC benignos para que electron/preload.cjs no lance errores de canal inexistente
ipcMain.handle('get-local-ip', () => ({ ip: '127.0.0.1', port: 3000 }));
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
ipcMain.handle('set-master-volume', () => true);
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
  console.error('[smoke-ui] Timeout total de 150 s alcanzado');
  app.exit(1);
}, 150000);

function isIgnoredError(msg) {
  if (!msg) return true;
  const lower = String(msg).toLowerCase();
  if (lower.includes('bluetooth')) return true;
  if (lower.includes('background-sync')) return true;
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveRealMovieId() {
  try {
    const res = await fetch(`${baseUrl}/api/home?fields=card`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      for (const row of rows) {
        const items = Array.isArray(row?.items) ? row.items : [];
        const movie = items.find((i) => (i.category || i.type) === 'movie' && i.id);
        if (movie) return String(movie.id);
      }
      for (const row of rows) {
        const items = Array.isArray(row?.items) ? row.items : [];
        if (items[0]?.id) return String(items[0].id);
      }
    }
  } catch (_) {}
  return 'm1';
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

  const realMovieId = await resolveRealMovieId();

  const routes = [
    '#/',
    '#/explorar',
    '#/buscar',
    '#/lista',
    '#/deportes',
    '#/canales',
    '#/musica',
    '#/youtube',
    '#/ajustes',
    '#/control',
    `#/titulo/movie/${realMovieId}`,
  ];

  const win = new BrowserWindow({
    show: false,
    width: 1366,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });

  // endurecer will-attach-webview igual que en electron/main.cjs
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    const src = params && typeof params.src === 'string' ? params.src : '';
    try {
      const parsed = new URL(src);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        event.preventDefault();
      }
    } catch (_) {
      event.preventDefault();
    }
  });

  let activeCollector = [];

  win.webContents.on('console-message', (event) => {
    const level = event?.level;
    const isErrLevel = level === 'error' || level === 3;
    if (!isErrLevel) return;
    const text = typeof event?.message === 'string' ? event.message : '';
    const src = typeof event?.sourceId === 'string' ? event.sourceId : '';
    const line = event?.lineNumber || 0;
    // Solo recolectar errores del frame de nuestra app (o sin sourceId externo de anuncios/terceros), ignorando Bluetooth y background-sync
    if (isIgnoredError(text) || isIgnoredError(src)) return;
    if (
      src &&
      !src.startsWith(baseUrl) &&
      !src.startsWith('http://localhost') &&
      !src.startsWith('http://127.0.0.1') &&
      !src.startsWith('file:')
    ) {
      return;
    }
    activeCollector.push(`console.error: ${text}${src ? ` (${src}:${line})` : ''}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    activeCollector.push(
      `render-process-gone: reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode ?? ''}`
    );
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return; // ERR_ABORTED
    if (isMainFrame) {
      activeCollector.push(`did-fail-load: (${errorCode}) ${errorDescription} -> ${validatedURL}`);
    }
  });

  const installUncaughtHook = async () => {
    try {
      await win.webContents.executeJavaScript(`
        (function() {
          if (window.__smokeHookInstalled) return;
          window.__smokeHookInstalled = true;
          window.__smokeUncaught = window.__smokeUncaught || [];
          window.addEventListener('error', function(e) {
            window.__smokeUncaught.push('uncaught error: ' + (e && e.message ? e.message : String(e)));
          });
          window.addEventListener('unhandledrejection', function(e) {
            var reason = e && e.reason ? (e.reason.message || String(e.reason)) : 'unknown';
            window.__smokeUncaught.push('unhandledrejection: ' + reason);
          });
        })();
      `);
    } catch (_) {}
  };

  const drainUncaughtHook = async () => {
    try {
      const items = await win.webContents.executeJavaScript(`
        (function() {
          var list = window.__smokeUncaught || [];
          window.__smokeUncaught = [];
          return list;
        })();
      `);
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!isIgnoredError(item)) {
            activeCollector.push(String(item));
          }
        }
      }
    } catch (_) {}
  };

  let totalErrors = 0;

  console.log(`[smoke-ui] Base URL: ${baseUrl}`);
  console.log(`[smoke-ui] Probando ${routes.length} rutas individuales (6 s por ruta)...`);

  for (const route of routes) {
    activeCollector = [];
    const targetUrl = `${baseUrl}/?role=screen&ui=nuevo${route}`;
    try {
      await win.loadURL(targetUrl);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (!msg.includes('ERR_ABORTED')) {
        activeCollector.push(`loadURL exception: ${msg}`);
      }
    }
    await installUncaughtHook();
    await wait(6000);
    await drainUncaughtHook();

    if (activeCollector.length === 0) {
      console.log(`[smoke-ui] ${route.padEnd(22)} -> OK`);
    } else {
      totalErrors += activeCollector.length;
      console.log(`[smoke-ui] ${route.padEnd(22)} -> ${activeCollector.length} errores`);
      for (const errText of activeCollector.slice(0, 3)) {
        console.log(`   - ${errText}`);
      }
    }
  }

  // Navegación in-page cambiando location.hash sin recargar: #/ -> #/musica -> #/ -> #/youtube -> #/
  const hopSequence = ['#/', '#/musica', '#/', '#/youtube', '#/'];
  console.log(
    `\n[smoke-ui] Probando secuencia en la misma ventana sin recargar: ${hopSequence.join(' -> ')}`
  );
  activeCollector = [];

  try {
    await win.loadURL(`${baseUrl}/?role=screen&ui=nuevo#/`);
    await installUncaughtHook();
    await wait(2500);

    for (let i = 1; i < hopSequence.length; i++) {
      const nextHash = hopSequence[i];
      await win.webContents.executeJavaScript(
        `window.location.hash = ${JSON.stringify(nextHash)};`
      );
      await wait(3000);
      await drainUncaughtHook();
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    activeCollector.push(`hash-sequence exception: ${msg}`);
  }

  const seqLabel = hopSequence.join(' -> ');
  if (activeCollector.length === 0) {
    console.log(`[smoke-ui] ${seqLabel} -> OK`);
  } else {
    totalErrors += activeCollector.length;
    console.log(`[smoke-ui] ${seqLabel} -> ${activeCollector.length} errores`);
    for (const errText of activeCollector.slice(0, 3)) {
      console.log(`   - ${errText}`);
    }
  }

  clearTimeout(globalTimer);
  console.log(`\n[smoke-ui] Resumen final: ${totalErrors} errores de render.`);
  win.destroy();
  app.exit(totalErrors === 0 ? 0 : 1);
});

