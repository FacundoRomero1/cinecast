#!/usr/bin/env node
/**
 * scripts/probe-sleep-idle.cjs
 * Verifica PARTE 3:
 *  1. Remoto muestra "Temporizador: apagado" inicialmente; sin reproducción activa se desarma solo y loguea en /api/client-log.
 *  2. Con reproducción activa, armar 15 min muestra "XX min restantes" en remoto y persiste última duración;
 *     cerrar el reproductor desarma el temporizador y loguea en /api/client-log.
 *  3. Al reiniciar/recargar la app (incluso con cinecast_sleep_timer_v1 previo), NO se arma al iniciar
 *     mientras la última duración queda guardada en cinecast_sleep_timer_last_v1.
 *  4. Temporizador vencido dispara "¿Seguís ahí?" con mensaje "Temporizador de reposo de 15 min" en PC y remoto.
 *  5. Maratón 3 capítulos seguidos sin tocar nada dispara "¿Seguís ahí?" con "Pasaron 3 capítulos seguidos sin tocar nada"
 *     y frena antes del 4to capítulo; interactuar localmente o enviar comando remoto resetea el contador.
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});

const globalTimer = setTimeout(() => {
  console.error('[probe-sleep-idle] TIMEOUT GLOBAL (145s)');
  if (testEnv) try { testEnv.stop(); } catch (_) {}
  app.exit(1);
}, 145000);

let mockRealMediaState = null;

ipcMain.handle('get-local-ip', () => ({ ip: testEnv ? testEnv.lanIp : '127.0.0.1', port: testEnv ? testEnv.port : 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-real-media-state', () => mockRealMediaState);
ipcMain.handle('control-active-media', () => ({ ok: true }));
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('get-compatibility-mode', () => false);
ipcMain.handle('get-load-recording', () => false);
ipcMain.handle('get-load-traces', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('set-fast-media-poll', () => true);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('start-load-trace', () => ({ ok: true }));
ipcMain.handle('simulate-play-click', () => ({ ok: true }));
ipcMain.handle('get-embed-status', () => ({ ready: true }));

async function waitForWsConnected(win, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`(() => {
      const ds = window.cinecastDeviceSync;
      return Boolean(ds && ds.getSyncTelemetrySummary && ds.getSyncTelemetrySummary().transporte === 'ws');
    })()`).catch(() => false);
    if (ok) return true;
    await wait(100);
  }
  return false;
}

async function waitUntil(fn, timeoutMs = 8000, stepMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await wait(stepMs);
  }
  return null;
}

async function getClientLogs(baseUrl) {
  const res = await fetch(`${baseUrl}/api/client-log`);
  const json = await res.json();
  return Array.isArray(json.entries) ? json.entries.filter((e) => e && e.tag === 'sleep_timer') : [];
}

function makeSeriesMedia(baseUrl) {
  const embedUrl = `${baseUrl}/api/health`;
  const episodes = [1, 2, 3, 4, 5].map((num) => ({
    id: `probe-idle-ep-${num}`,
    seasonNumber: 1,
    episodeNumber: num,
    title: `Capítulo Prueba ${num}`,
    overview: 'Prueba automatizada',
    duration: '24 min',
    streamType: 'iframe',
    servers: [{ name: 'Server Local', url: embedUrl, type: 'iframe' }],
  }));
  return {
    id: 'probe-idle-series-1',
    title: 'Serie Sleep Idle Test',
    type: 'series',
    overview: 'Serie de prueba',
    year: 2025,
    ratingBadge: '13+',
    matchScore: 95,
    qualityBadge: 'HD',
    genres: ['Drama'],
    cast: [],
    creatorOrDirector: 'Test',
    posterUrl: '',
    backdropUrl: '',
    streamType: 'iframe',
    servers: [{ name: 'Server Local', url: embedUrl, type: 'iframe' }],
    episodes,
    seasons: [{ seasonNumber: 1, episodes }],
  };
}

async function run() {
  let winScreen = null;
  let winRemote = null;
  try {
    testEnv = await startTestEnv({ name: 'probe-sleep-idle', useLanIp: true, seedHistory: false });
    const baseUrl = testEnv.lanBase;
    const loopbackBase = `http://127.0.0.1:${testEnv.port}`;
    const roomId = testEnv.room;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

    winScreen = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:probe-idle-screen',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&test=1&room=${encodeURIComponent(roomId)}`);
    if (!(await waitForWsConnected(winScreen))) throw new Error('winScreen no conectó');

    winRemote = new BrowserWindow({
      show: false,
      width: 412,
      height: 915,
      webPreferences: {
        partition: 'persist:probe-idle-remote',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await winRemote.loadURL(`${baseUrl}/?role=remote&ui=nuevo&test=1&room=${encodeURIComponent(roomId)}#/control`);
    if (!(await waitForWsConnected(winRemote))) throw new Error('winRemote no conectó');
    await wait(600);

    await fetch(`${loopbackBase}/api/client-log?clear=1`);

    // 1. Estado inicial apagado y sin reproducción activa se desarma solo
    const statusInit = await waitUntil(async () => {
      const t = await winRemote.webContents.executeJavaScript(
        `document.querySelector('[data-testid="sleep-timer-status"]')?.innerText?.trim() || ''`
      );
      return t || null;
    }, 5000);
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'setSleepTimer', payload: { mode: '15', minutes: 15 } })`
    );
    const logsNoPlay = (await waitUntil(async () => {
      const rows = await getClientLogs(loopbackBase);
      return rows.some((l) => l.event === 'disarmed' && String(l.cause).includes('sin reproducción')) ? rows : null;
    }, 5000)) || (await getClientLogs(loopbackBase));
    const statusNoPlayback = await winRemote.webContents.executeJavaScript(
      `document.querySelector('[data-testid="sleep-timer-status"]')?.innerText?.trim() || ''`
    );
    const passNoPlayback =
      statusInit === 'Temporizador: apagado' &&
      statusNoPlayback === 'Temporizador: apagado' &&
      logsNoPlay.some((l) => l.event === 'disarmed' && String(l.cause).includes('sin reproducción'));
    console.log('[probe-sleep-idle] (1) Sin reproducción:', {
      pass: passNoPlayback,
      statusInit,
      statusNoPlayback,
      logs: logsNoPlay.map((l) => `${l.event}:${l.cause}`),
    });

    // 2. Iniciar reproducción -> armar 15 min -> "15 min restantes" -> cerrar reproductor -> desarma
    const seriesMedia = makeSeriesMedia(baseUrl);
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'playMedia', payload: { media: ${JSON.stringify(seriesMedia)}, season: 1, episode: 1 } })`
    );
    const playerOpened = await waitUntil(
      () => winScreen.webContents.executeJavaScript(`Boolean(document.querySelector('[title="Cerrar Reproductor"]') || document.querySelector('webview'))`).catch(() => false),
      8000
    );
    if (!playerOpened) throw new Error('No se abrió VideoPlayer en PC');

    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'setSleepTimer', payload: { mode: '15', minutes: 15 } })`
    );
    const statusArmed = await waitUntil(async () => {
      const t = await winRemote.webContents.executeJavaScript(
        `document.querySelector('[data-testid="sleep-timer-status"]')?.innerText?.trim() || ''`
      );
      return /min restantes/i.test(t) ? t : null;
    }, 5000);
    const lastDurationStored = await winScreen.webContents.executeJavaScript(
      `localStorage.getItem('cinecast_sleep_timer_last_v1') || ''`
    );

    // Cerrar reproductor en PC -> temporizador debe desarmarse solo
    await winScreen.webContents.executeJavaScript(
      `document.querySelector('[title="Cerrar Reproductor"]')?.click()`
    );
    const statusAfterClose = await waitUntil(async () => {
      const t = await winRemote.webContents.executeJavaScript(
        `document.querySelector('[data-testid="sleep-timer-status"]')?.innerText?.trim() || ''`
      );
      return t === 'Temporizador: apagado' ? t : null;
    }, 5000);
    const logsAfterClose = (await waitUntil(async () => {
      const rows = await getClientLogs(loopbackBase);
      return rows.some((l) => l.event === 'disarmed' && String(l.cause).includes('cierre')) ? rows : null;
    }, 5000)) || (await getClientLogs(loopbackBase));
    const passArmAndCloseDisarm =
      Boolean(statusArmed) &&
      lastDurationStored.includes('"minutes":15') &&
      statusAfterClose === 'Temporizador: apagado' &&
      logsAfterClose.some((l) => l.event === 'armed') &&
      logsAfterClose.some((l) => l.event === 'disarmed' && String(l.cause).includes('cierre'));
    console.log('[probe-sleep-idle] (2) Armado y desarme al cerrar:', {
      pass: passArmAndCloseDisarm,
      statusArmed,
      lastDurationStored,
      statusAfterClose,
    });

    // 3. Simular temporizador vencido en cinecast_sleep_timer_v1 y recargar app -> NO debe auto-armarse ni disparar al iniciar
    await winScreen.webContents.executeJavaScript(
      `localStorage.setItem('cinecast_sleep_timer_v1', JSON.stringify({ endsAt: Date.now() - 5000, mode: '30', minutes: 30 }))`
    );
    await new Promise((res) => {
      winScreen.webContents.once('did-finish-load', res);
      winScreen.reload();
    });
    await waitForWsConnected(winScreen, 10000);
    await wait(1200);
    const promptAfterReload = await winScreen.webContents.executeJavaScript(
      `(document.body.innerText || '').includes('¿Seguís ahí?')`
    );
    const activeTimerCleared = await winScreen.webContents.executeJavaScript(
      `localStorage.getItem('cinecast_sleep_timer_v1') === null`
    );
    const lastStillSaved = await winScreen.webContents.executeJavaScript(
      `Boolean(localStorage.getItem('cinecast_sleep_timer_last_v1'))`
    );
    const passNoAutoArm = !promptAfterReload && activeTimerCleared && lastStillSaved;
    console.log('[probe-sleep-idle] (3) Sin auto-armado al iniciar:', {
      pass: passNoAutoArm,
      promptAfterReload,
      activeTimerCleared,
      lastStillSaved,
    });

    // 4. Disparar por temporizador de reposo -> causa "Temporizador de reposo de 15 min" en PC y remoto
    await fetch(`${loopbackBase}/api/client-log?clear=1`);
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'playMedia', payload: { media: ${JSON.stringify(seriesMedia)}, season: 1, episode: 1 } })`
    );
    await waitUntil(
      () => winScreen.webContents.executeJavaScript(`Boolean(document.querySelector('[title="Cerrar Reproductor"]'))`).catch(() => false),
      8000
    );
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'setSleepTimer', payload: { mode: '15', minutes: 15, seconds: 1.5 } })`
    );
    const timerFiredResult = await waitUntil(async () => {
      const pcCause = await winScreen.webContents.executeJavaScript(
        `document.querySelector('[data-testid="are-you-still-there-cause"]')?.innerText?.trim() || ''`
      );
      const remoteCause = await winRemote.webContents.executeJavaScript(
        `document.querySelector('[data-testid="remote-idle-cause"]')?.innerText?.trim() || ''`
      );
      if (pcCause && remoteCause) return { pcCause, remoteCause };
      return null;
    }, 8000);
    const logsTimerFire = await getClientLogs(loopbackBase);
    const passTimerCause =
      Boolean(timerFiredResult) &&
      timerFiredResult.pcCause.includes('Temporizador de reposo de 15 min') &&
      timerFiredResult.remoteCause.includes('Temporizador de reposo de 15 min') &&
      logsTimerFire.some((l) => l.event === 'fired' && String(l.cause).includes('15 min'));
    console.log('[probe-sleep-idle] (4) Disparo temporizador con causa:', {
      pass: passTimerCause,
      ...timerFiredResult,
    });

    // Confirmar seguir viendo para descartar diálogo antes de probar Maratón
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'confirmActiveWatching' })`
    );
    await waitUntil(async () => {
      const hasDialog = await winScreen.webContents.executeJavaScript(`Boolean(document.querySelector('[aria-label="¿Seguís ahí?"]'))`);
      return !hasDialog;
    }, 5000);

    // 5. Maratón 3 capítulos seguidos sin tocar nada -> "Pasaron 3 capítulos seguidos sin tocar nada" y NO pasa al 4to
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'setMarathon', payload: { enabled: true } })`
    );
    await wait(300);

    // Simular fin de capítulo 1 -> debe avanzar a Ep 2
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    const reachedEp2 = await waitUntil(async () => {
      const st = await winRemote.webContents.executeJavaScript(
        `JSON.stringify(window.cinecastDeviceSync.getCachedPlaybackState())`
      ).then(JSON.parse);
      return st && Number(st.episodeNumber) === 2;
    }, 6000);
    mockRealMediaState = { found: true, currentTime: 5, duration: 100, isPlaying: true, paused: false, ended: false, hasVideo: true };
    await wait(2700);

    // Simular fin de capítulo 2 -> debe avanzar a Ep 3
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    const reachedEp3 = await waitUntil(async () => {
      const st = await winRemote.webContents.executeJavaScript(
        `JSON.stringify(window.cinecastDeviceSync.getCachedPlaybackState())`
      ).then(JSON.parse);
      return st && Number(st.episodeNumber) === 3;
    }, 6000);
    mockRealMediaState = { found: true, currentTime: 5, duration: 100, isPlaying: true, paused: false, ended: false, hasVideo: true };
    await wait(2700);

    // Simular fin de capítulo 3 -> debe disparar "¿Seguís ahí?" con causa Maratón y quedarse en Ep 3 (no pasar a Ep 4)
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    const marathonFired = await waitUntil(async () => {
      const pcCause = await winScreen.webContents.executeJavaScript(
        `document.querySelector('[data-testid="are-you-still-there-cause"]')?.innerText?.trim() || ''`
      );
      const remoteCause = await winRemote.webContents.executeJavaScript(
        `document.querySelector('[data-testid="remote-idle-cause"]')?.innerText?.trim() || ''`
      );
      if (pcCause && remoteCause) return { pcCause, remoteCause };
      return null;
    }, 6000);
    const epAfter3 = await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.getCachedPlaybackState()?.episodeNumber`
    );
    const passMarathon3 =
      Boolean(reachedEp2) &&
      Boolean(reachedEp3) &&
      Boolean(marathonFired) &&
      marathonFired.pcCause === 'Pasaron 3 capítulos seguidos sin tocar nada' &&
      marathonFired.remoteCause === 'Pasaron 3 capítulos seguidos sin tocar nada' &&
      Number(epAfter3) === 3;
    console.log('[probe-sleep-idle] (5) Maratón 3 capítulos sin tocar:', {
      pass: passMarathon3,
      reachedEp2,
      reachedEp3,
      epAfter3,
      ...marathonFired,
    });

    // 6. Confirmar y luego verificar que una interacción resetea el contador de Maratón a 0
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'confirmActiveWatching' })`
    );
    await waitUntil(async () => !(await winScreen.webContents.executeJavaScript(`Boolean(document.querySelector('[aria-label="¿Seguís ahí?"]'))`)), 5000);

    // Reiniciar a Ep 1
    mockRealMediaState = { found: true, currentTime: 5, duration: 100, isPlaying: true, paused: false, ended: false, hasVideo: true };
    await winRemote.webContents.executeJavaScript(
      `window.cinecastDeviceSync.sendCommand({ action: 'jumpToEpisode', payload: { season: 1, episode: 1 } })`
    );
    await waitUntil(async () => (await winRemote.webContents.executeJavaScript(`window.cinecastDeviceSync.getCachedPlaybackState()?.episodeNumber`)) === 1, 6000);
    await wait(2700);
    // Ep 1 -> Ep 2 (count=1)
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    await waitUntil(async () => (await winRemote.webContents.executeJavaScript(`window.cinecastDeviceSync.getCachedPlaybackState()?.episodeNumber`)) === 2, 6000);
    mockRealMediaState = { found: true, currentTime: 5, duration: 100, isPlaying: true, paused: false, ended: false, hasVideo: true };
    await wait(2700);
    // Ep 2 -> Ep 3 (count=2)
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    await waitUntil(async () => (await winRemote.webContents.executeJavaScript(`window.cinecastDeviceSync.getCachedPlaybackState()?.episodeNumber`)) === 3, 6000);
    mockRealMediaState = { found: true, currentTime: 5, duration: 100, isPlaying: true, paused: false, ended: false, hasVideo: true };
    // Interacción del usuario (click/pointerdown en PC player) -> debe resetear contador de 2 a 0
    await winScreen.webContents.executeJavaScript(
      `document.querySelector('[title="Cerrar Reproductor"]')?.parentElement?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
    );
    await wait(2700);
    // Ep 3 -> Ep 4 NO debe disparar "¿Seguís ahí?", debe avanzar a Ep 4 porque count pasó a 1!
    mockRealMediaState = { found: true, currentTime: 99, duration: 100, isPlaying: true, paused: false, ended: true, hasVideo: true };
    const reachedEp4 = await waitUntil(async () => {
      const st = await winRemote.webContents.executeJavaScript(
        `JSON.stringify(window.cinecastDeviceSync.getCachedPlaybackState())`
      ).then(JSON.parse);
      return st && Number(st.episodeNumber) === 4;
    }, 6000);
    const hasFalsePrompt = await winScreen.webContents.executeJavaScript(
      `Boolean(document.querySelector('[aria-label="¿Seguís ahí?"]'))`
    );
    const passInteractionReset = Boolean(reachedEp4) && !hasFalsePrompt;
    console.log('[probe-sleep-idle] (6) Reset de contador por interacción:', {
      pass: passInteractionReset,
      reachedEp4,
      hasFalsePrompt,
    });

    const summary = {
      passNoPlayback,
      passArmAndCloseDisarm,
      passNoAutoArm,
      passTimerCause,
      passMarathon3,
      passInteractionReset,
    };
    console.log('\n=== RESUMEN PROBE-SLEEP-IDLE ===\n' + JSON.stringify(summary, null, 2));
    if (!Object.values(summary).every(Boolean)) {
      throw new Error('Falló alguna aserción en probe-sleep-idle');
    }
    console.log('[probe-sleep-idle] PASS');
  } finally {
    clearTimeout(globalTimer);
    if (winRemote && !winRemote.isDestroyed()) try { winRemote.destroy(); } catch (_) {}
    if (winScreen && !winScreen.isDestroyed()) try { winScreen.destroy(); } catch (_) {}
    if (testEnv) try { await testEnv.stop(); } catch (_) {}
  }
}

app.whenReady().then(() => {
  run()
    .then(() => app.exit(0))
    .catch((err) => {
      console.error('[probe-sleep-idle] ERROR:', err);
      app.exit(1);
    });
});
