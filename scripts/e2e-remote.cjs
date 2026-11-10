const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const baseUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const shotsDir = path.join(__dirname, '..', 'scratch', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

// Registrar handlers IPC para que electron/preload.cjs responda sin errores
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
  console.error('[e2e-remote] Timeout global de 150s alcanzado');
  app.exit(1);
}, 150000);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveShot(win, filename) {
  try {
    let img = await win.webContents.capturePage();
    if (img.isEmpty()) {
      win.showInactive();
      await wait(400);
      img = await win.webContents.capturePage();
    }
    const fullPath = path.join(shotsDir, filename);
    fs.writeFileSync(fullPath, img.toPNG());
    return filename;
  } catch (err) {
    console.warn(`[e2e-remote] Error capturando ${filename}:`, err?.message || err);
    return null;
  }
}

function attachWebviewHardening(win) {
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
}

async function pollServer(roomId = 'cine-home-1', since = 0) {
  try {
    const res = await fetch(
      `${baseUrl}/api/sync/poll?roomId=${encodeURIComponent(roomId)}&since=${since}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return null;
}

async function getRoomDevices(roomId = 'cine-home-1') {
  try {
    const res = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}/devices`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.devices) ? data.devices : [];
    }
  } catch (_) {}
  return [];
}

async function checkScreenPlayerMounted(winA) {
  try {
    return await winA.webContents.executeJavaScript(`
      (function() {
        const wv = document.querySelector('webview[partition="persist:videosession"]');
        const video = document.querySelector('video');
        const closeBtn = Array.from(document.querySelectorAll('button')).find(
          (b) => (b.title && /cerrar|volver/i.test(b.title)) || /salir|volver/i.test(b.textContent || '')
        );
        return {
          hasVideoWebview: Boolean(wv),
          webviewSrc: wv ? wv.getAttribute('src') : null,
          hasVideoTag: Boolean(video),
          hasPlayerOverlay: Boolean(wv || video || closeBtn),
          hash: window.location.hash,
          bodySnippet: (document.body.innerText || '').slice(0, 220).replace(/\\s+/g, ' '),
        };
      })();
    `);
  } catch (err) {
    return { hasVideoWebview: false, error: err?.message || String(err) };
  }
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

  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

  // Ventana A "PC": 1280x800, partition persist:e2e-screen
  const winA = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:e2e-screen',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Ventana B "celular": 390x844, partition persist:e2e-remote
  const winB = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:e2e-remote',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  attachWebviewHardening(winA);
  attachWebviewHardening(winB);

  const MOBILE_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  winB.webContents.setUserAgent(MOBILE_ANDROID_UA);

  const logsA = [];
  const logsB = [];
  winA.webContents.on('console-message', (ev) => {
    if (ev?.level === 'error' || ev?.level === 3 || ev?.level === 'warning' || ev?.level === 2) {
      logsA.push(`[A:${ev.level}] ${ev.message}`);
    }
  });
  winB.webContents.on('console-message', (ev) => {
    if (ev?.level === 'error' || ev?.level === 3 || ev?.level === 'warning' || ev?.level === 2) {
      logsB.push(`[B:${ev.level}] ${ev.message}`);
    }
  });

  const savedShots = [];
  const results = [];

  console.log(`[e2e-remote] Base URL: ${baseUrl}`);

  // Cargar A y B. IMPORTANTE: en este build de Electron (castlabs) mostrar la ventana o activar la
  // emulación ANTES de cargar contenido cierra el proceso (crashpad); por eso: cargar -> emular -> mostrar.
  await Promise.all([
    winA.loadURL(`${baseUrl}/?role=screen&ui=nuevo`),
    winB.loadURL(`${baseUrl}/?role=remote&ui=nuevo`),
  ]);

  winB.webContents.enableDeviceEmulation({
    screenPosition: 'mobile',
    screenSize: { width: 390, height: 844 },
    viewSize: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  winA.showInactive();
  winB.showInactive();
  await wait(1500);

  // =========================================================================
  // PASO 2a: Ambas conectan y /api/rooms/cine-home-1/devices lista screen + remote
  // =========================================================================
  let stepAPass = false;
  let devicesFound = [];
  let roomUsed = 'cine-home-1';
  const startA = Date.now();
  while (Date.now() - startA < 12000) {
    roomUsed =
      (await winA.webContents.executeJavaScript(`localStorage.getItem('cinecast_room_id') || 'cine-home-1'`)) ||
      'cine-home-1';
    devicesFound = await getRoomDevices(roomUsed);
    const hasScreen = devicesFound.some((d) => d.type === 'screen');
    const hasRemote = devicesFound.some((d) => d.type === 'remote');
    if (hasScreen && hasRemote) {
      stepAPass = true;
      break;
    }
    await wait(600);
  }

  const stateAInfo = await winA.webContents.executeJavaScript(`({
    deviceId: localStorage.getItem('cinecast_device_id'),
    deviceType: localStorage.getItem('cinecast_device_type'),
    roomId: localStorage.getItem('cinecast_room_id'),
  })`);
  const stateBInfo = await winB.webContents.executeJavaScript(`({
    deviceId: localStorage.getItem('cinecast_device_id'),
    deviceType: localStorage.getItem('cinecast_device_type'),
    roomId: localStorage.getItem('cinecast_room_id'),
  })`);

  const shotA1 = await saveShot(winA, 'e2e-2a-screen.png');
  const shotB1 = await saveShot(winB, 'e2e-2a-remote.png');
  if (shotA1) savedShots.push(shotA1);
  if (shotB1) savedShots.push(shotB1);

  const detail2a = `room=${roomUsed} devices=${JSON.stringify(
    devicesFound.map((d) => ({ id: d.id, type: d.type, name: d.name }))
  )} A=${JSON.stringify(stateAInfo)} B=${JSON.stringify(stateBInfo)}`;
  console.log(`[Paso 2a] ${stepAPass ? 'PASA' : 'FALLA'} — ${detail2a}`);
  results.push({ step: '2a', pass: stepAPass, detail: detail2a });

  // =========================================================================
  // PASO 2b: En B abrir #/titulo/movie/tmdb-movie-969681, clic en botón "PC" o "Enviar"
  // =========================================================================
  const pollBeforeB = await pollServer(roomUsed, 0);
  const seqBeforeB = pollBeforeB?.seq || 0;

  await winB.webContents.executeJavaScript(`window.location.hash = '#/titulo/movie/tmdb-movie-969681';`);
  await wait(3500);

  const shotB2 = await saveShot(winB, 'e2e-2b-remote-detail.png');
  if (shotB2) savedShots.push(shotB2);

  const clickCastBtnResult = await winB.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim();
        return /Ver en|PC|Enviar|Transmitir|Sala/i.test(txt);
      });
      if (!target) {
        return { clicked: false, availableButtons: buttons.map((b) => (b.innerText || b.textContent || '').trim()).filter(Boolean) };
      }
      const label = (target.innerText || target.textContent || '').trim();
      target.click();
      return { clicked: true, label };
    })();
  `);

  let stepBPass = false;
  let playerStateAfterB = null;
  const startB = Date.now();
  while (Date.now() - startB < 15000) {
    playerStateAfterB = await checkScreenPlayerMounted(winA);
    if (playerStateAfterB.hasVideoWebview || playerStateAfterB.hasVideoTag) {
      stepBPass = true;
      break;
    }
    await wait(700);
  }

  const pollAfterB = await pollServer(roomUsed, 0);
  const newCommandsB = (pollAfterB?.commands || []).filter((c) => c.seq > seqBeforeB);

  const shotA2 = await saveShot(winA, 'e2e-2b-screen-after-cast.png');
  if (shotA2) savedShots.push(shotA2);

  const detail2b = `clickB=${JSON.stringify(clickCastBtnResult)} | POST /api/sync/command llegó=${
    newCommandsB.length > 0
  } (cmds=${JSON.stringify(newCommandsB.map((c) => ({ seq: c.seq, action: c.command?.action, title: c.command?.payload?.title })))}) | playerA=${JSON.stringify(
    playerStateAfterB
  )}`;
  console.log(`[Paso 2b] ${stepBPass ? 'PASA' : 'FALLA'} — ${detail2b}`);
  results.push({ step: '2b', pass: stepBPass, detail: detail2b });

  // Cerrar reproductor en A antes de probar 2c para verificar que 2c lo monta de cero
  await winA.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const closeBtn = buttons.find((b) => {
        const t = (b.title || '') + ' ' + (b.innerText || b.textContent || '');
        return /Volver atr.s/i.test(t);
      });
      if (closeBtn) closeBtn.click();
    })();
  `);
  await wait(1200);

  // =========================================================================
  // PASO 2c: En B volver a la ficha y tocar "Reproducir" -> envía a la pantalla A
  // =========================================================================
  const pollBeforeC = await pollServer(roomUsed, 0);
  const seqBeforeC = pollBeforeC?.seq || 0;

  await winB.webContents.executeJavaScript(`window.location.hash = '#/titulo/movie/tmdb-movie-969681';`);
  await wait(3000);

  const clickPlayBtnResult = await winB.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((b) => {
        const txt = (b.innerText || b.textContent || '').trim();
        return /^Reproducir$/i.test(txt) || txt.includes('Reproducir');
      });
      if (!target) {
        return { clicked: false, availableButtons: buttons.map((b) => (b.innerText || b.textContent || '').trim()).filter(Boolean) };
      }
      const label = (target.innerText || target.textContent || '').trim();
      target.click();
      return { clicked: true, label };
    })();
  `);

  let stepCPass = false;
  let playerStateAfterC = null;
  const startC = Date.now();
  while (Date.now() - startC < 15000) {
    playerStateAfterC = await checkScreenPlayerMounted(winA);
    if (playerStateAfterC.hasVideoWebview || playerStateAfterC.hasVideoTag) {
      stepCPass = true;
      break;
    }
    await wait(700);
  }

  const pollAfterC = await pollServer(roomUsed, 0);
  const newCommandsC = (pollAfterC?.commands || []).filter((c) => c.seq > seqBeforeC);

  const shotA3 = await saveShot(winA, 'e2e-2c-screen-after-play.png');
  const shotB3 = await saveShot(winB, 'e2e-2c-remote-after-play.png');
  if (shotA3) savedShots.push(shotA3);
  if (shotB3) savedShots.push(shotB3);

  const detail2c = `clickB=${JSON.stringify(clickPlayBtnResult)} | POST /api/sync/command llegó=${
    newCommandsC.length > 0
  } (cmds=${JSON.stringify(newCommandsC.map((c) => ({ seq: c.seq, action: c.command?.action, title: c.command?.payload?.title })))}) | playerA=${JSON.stringify(
    playerStateAfterC
  )}`;
  console.log(`[Paso 2c] ${stepCPass ? 'PASA' : 'FALLA'} — ${detail2c}`);
  results.push({ step: '2c', pass: stepCPass, detail: detail2c });

  // =========================================================================
  // PASO 2d: En B, con el reproductor activo en A, usar el drawer para pausar/reproducir
  // =========================================================================
  const pollBeforeD = await pollServer(roomUsed, 0);
  const seqBeforeD = pollBeforeD?.seq || 0;

  // Expandir el drawer si está colapsado y luego pulsar el botón Pausa/Play
  const drawerExpandResult = await winB.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const handle = buttons.find((b) => /Control Remoto Activo|Expandir/i.test(b.innerText || b.textContent || ''));
      if (handle) {
        handle.click();
        return { expandedClicked: true, text: (handle.innerText || '').trim() };
      }
      return { expandedClicked: false };
    })();
  `);
  await wait(800);

  const shotB4 = await saveShot(winB, 'e2e-2d-remote-drawer-open.png');
  if (shotB4) savedShots.push(shotB4);

  const drawerToggleResult = await winB.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const playPauseBtn = buttons.find((b) => {
        const t = (b.title || '') + ' ' + (b.innerText || b.textContent || '');
        return /Pausar|Pausa|^Play$/i.test(t.trim());
      });
      if (!playPauseBtn) {
        return { clicked: false, buttons: buttons.map((b) => ((b.title || '') + ':' + (b.innerText || '')).trim()) };
      }
      const label = ((playPauseBtn.title || '') + ' ' + (playPauseBtn.innerText || '')).trim();
      playPauseBtn.click();
      return { clicked: true, label };
    })();
  `);

  let stepDPass = false;
  let newCommandsD = [];
  const startD = Date.now();
  while (Date.now() - startD < 8000) {
    const pollAfterD = await pollServer(roomUsed, 0);
    newCommandsD = (pollAfterD?.commands || []).filter(
      (c) =>
        c.seq > seqBeforeD &&
        (c.command?.action === 'togglePlay' ||
          c.command?.action === 'pause' ||
          c.command?.action === 'play')
    );
    if (newCommandsD.length > 0) {
      stepDPass = true;
      break;
    }
    await wait(500);
  }

  const detail2d = `expand=${JSON.stringify(drawerExpandResult)} toggleClick=${JSON.stringify(
    drawerToggleResult
  )} | cmdsRecibidosEnPoll=${JSON.stringify(
    newCommandsD.map((c) => ({ seq: c.seq, action: c.command?.action, targetDeviceId: c.targetDeviceId }))
  )}`;
  console.log(`[Paso 2d] ${stepDPass ? 'PASA' : 'FALLA'} — ${detail2d}`);
  results.push({ step: '2d', pass: stepDPass, detail: detail2d });

  // =========================================================================
  // PASO 2e: En A cerrar reproductor si está abierto, clic en "Música", esperar 4 s,
  // clic en "Inicio"; repetir con "YouTube". Verificar location.hash y elementFromPoint.
  // =========================================================================
  await winA.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const closeBtn = buttons.find((b) => {
        const t = (b.title || '') + ' ' + (b.innerText || b.textContent || '');
        return /Volver atr.s/i.test(t);
      });
      if (closeBtn) closeBtn.click();
    })();
  `);
  await wait(1200);

  async function clickNavItemAndCheck(label, expectedHash) {
    const clickInfo = await winA.webContents.executeJavaScript(`
      (function() {
        const links = Array.from(document.querySelectorAll('aside a, nav a'));
        const link = links.find((a) => (a.innerText || a.textContent || '').trim() === ${JSON.stringify(label)});
        if (!link) return { found: false };
        const rect = link.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        const isUnobstructed = Boolean(topEl && (topEl === link || link.contains(topEl) || topEl.contains(link)));
        link.click();
        return {
          found: true,
          cx: Math.round(cx),
          cy: Math.round(cy),
          isUnobstructed,
          topElTag: topEl ? topEl.tagName : null,
          topElClass: topEl ? String(topEl.className || '').slice(0, 80) : null,
          hashAfterClick: window.location.hash,
        };
      })();
    `);
    await wait(500);
    const hashNow = await winA.webContents.executeJavaScript('window.location.hash');
    return {
      ...clickInfo,
      hashAfterWait: hashNow,
      hashMatches: hashNow === expectedHash,
    };
  }

  const navMusica = await clickNavItemAndCheck('Música', '#/musica');
  await wait(4000);
  const shotA4 = await saveShot(winA, 'e2e-2e-musica.png');
  if (shotA4) savedShots.push(shotA4);

  const navInicioFromMusica = await clickNavItemAndCheck('Inicio', '#/');
  await wait(1500);
  const shotA5 = await saveShot(winA, 'e2e-2e-inicio-after-musica.png');
  if (shotA5) savedShots.push(shotA5);

  const navYouTube = await clickNavItemAndCheck('YouTube', '#/youtube');
  await wait(4000);
  const shotA6 = await saveShot(winA, 'e2e-2e-youtube.png');
  if (shotA6) savedShots.push(shotA6);

  const navInicioFromYouTube = await clickNavItemAndCheck('Inicio', '#/');
  await wait(1500);
  const shotA7 = await saveShot(winA, 'e2e-2e-inicio-after-youtube.png');
  if (shotA7) savedShots.push(shotA7);

  const stepEPass = Boolean(
    navMusica.found &&
      navMusica.hashMatches &&
      navMusica.isUnobstructed &&
      navInicioFromMusica.found &&
      navInicioFromMusica.hashMatches &&
      navInicioFromMusica.isUnobstructed &&
      navYouTube.found &&
      navYouTube.hashMatches &&
      navYouTube.isUnobstructed &&
      navInicioFromYouTube.found &&
      navInicioFromYouTube.hashMatches &&
      navInicioFromYouTube.isUnobstructed
  );

  const detail2e = `Música=${JSON.stringify(navMusica)} -> Inicio1=${JSON.stringify(
    navInicioFromMusica
  )} -> YouTube=${JSON.stringify(navYouTube)} -> Inicio2=${JSON.stringify(navInicioFromYouTube)}`;
  console.log(`[Paso 2e] ${stepEPass ? 'PASA' : 'FALLA'} — ${detail2e}`);
  results.push({ step: '2e', pass: stepEPass, detail: detail2e });

  console.log('\n[e2e-remote] Capturas guardadas en scratch/shots/:', savedShots.join(', '));
  if (logsA.length > 0) {
    console.log('[e2e-remote] Mensajes de consola Ventana A (primeros 10):');
    logsA.slice(0, 10).forEach((l) => console.log('  ', l));
  } else {
    console.log('[e2e-remote] Mensajes de consola Ventana A: (ninguno)');
  }
  if (logsB.length > 0) {
    console.log('[e2e-remote] Mensajes de consola Ventana B (primeros 10):');
    logsB.slice(0, 10).forEach((l) => console.log('  ', l));
  } else {
    console.log('[e2e-remote] Mensajes de consola Ventana B: (ninguno)');
  }

  const allPass = results.every((r) => r.pass);
  console.log(
    `\n[e2e-remote] Resultado global: ${allPass ? 'PASA (5/5)' : 'FALLA'} (${
      results.filter((r) => r.pass).length
    }/${results.length})`
  );

  clearTimeout(globalTimer);
  winA.destroy();
  winB.destroy();
  app.exit(allPass ? 0 : 1);
});

