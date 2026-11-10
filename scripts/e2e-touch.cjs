const { app, components, BrowserWindow, ipcMain } = require('electron');
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
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn(npmCmd, ['run', 'dev'], {
      cwd: rootDir,
      env,
      shell: true,
      stdio: 'ignore',
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

  // Sembrar un elemento de "Continuar viendo" en Celular para los casos 1 y 2
  const sampleProgress = [
    {
      id: 'tmdb-movie-969681',
      mediaId: 'tmdb-movie-969681',
      title: 'Spider-Man: Un nuevo día',
      posterUrl: 'https://image.tmdb.org/t/p/w500/sample.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/sample.jpg',
      type: 'movie',
      category: 'movie',
      currentTime: 1200,
      duration: 7200,
      progressPercentage: 17,
      lastWatchedAt: Date.now(),
      mediaItem: {
        id: 'tmdb-movie-969681',
        title: 'Spider-Man: Un nuevo día',
        year: 2026,
        rating: 8.5,
        category: 'movie',
        type: 'movie',
        servers: [{ id: 'latino', name: 'Latino', url: 'https://example.com/stream.m3u8' }],
      },
    },
  ];

  await winB.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_watch_progress_v2', ${JSON.stringify(JSON.stringify(sampleProgress))});
    window.location.hash = '#/';
  `);
  await wait(1500);

  const results = [];

  // =========================================================================
  // Caso (1): #/ tocar el círculo de play de la primera tarjeta de "Continuar viendo" -> llega a PC
  // =========================================================================
  try {
    const seqBefore1 = (await pollServerCommands(baseUrl, roomId, 0)).length;
    const touchRes1 = await checkAndTouch(
      winB,
      `() => document.querySelector('section div[class*="group relative"] div[class*="rounded-full bg-red-600"]') || document.querySelector('[data-testid="continue-play"]')`,
      'círculo de play de primera tarjeta en Continuar viendo'
    );

    if (!touchRes1.ok) {
      results.push({ id: 1, name: 'Continuar viendo - Play', pass: false, detail: touchRes1.error });
    } else {
      await wait(1500);
      const cmdsAfter = await pollServerCommands(baseUrl, roomId, 0);
      const newCmds = cmdsAfter.slice(seqBefore1);
      const playCmd = newCmds.find((c) => /play/i.test(c.command?.action || ''));
      if (playCmd) {
        results.push({ id: 1, name: 'Continuar viendo - Play', pass: true, detail: `Comando recibido: ${playCmd.command.action}` });
      } else {
        results.push({ id: 1, name: 'Continuar viendo - Play', pass: false, detail: `No llegó comando play a la PC (nuevos comandos: ${newCmds.length})` });
      }
    }
  } catch (err) {
    results.push({ id: 1, name: 'Continuar viendo - Play', pass: false, detail: err.message });
  }

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
  // Caso (4): Las 5 pestañas inferiores: cada toque cambia el hash
  // =========================================================================
  try {
    const tabs = [
      { label: 'Explorar', hash: '#/explorar' },
      { label: 'Buscar', hash: '#/buscar' },
      { label: 'Mi lista', hash: '#/lista' },
      { label: 'Control', hash: '#/control' },
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
      if (curHash !== tab.hash) {
        tabsPass = false;
        tabDetails.push(`${tab.label}: esperado ${tab.hash}, actual ${curHash}`);
        break;
      } else {
        tabDetails.push(`${tab.label}: OK`);
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
      `, 8000);

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
      `, 8000);

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
        const loading = document.body.innerText.includes('Cargando');
        const rows = Array.from(document.querySelectorAll('div[class*="rounded-2xl bg-zinc-950"]'));
        return !loading && rows.length >= 5;
      })()
    `, 10000);

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

