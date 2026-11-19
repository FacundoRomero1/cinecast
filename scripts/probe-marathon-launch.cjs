#!/usr/bin/env node
/**
 * scripts/probe-marathon-launch.cjs
 * PARTE 1 (Paso 7): Pruebas con /__test/embed.html?dur=15 y testenv:
 *  (a) serie en medio de temporada -> avanza a E+1;
 *  (b) último episodio de la última temporada -> "Fin de la serie", no cambia id ni inicia nada;
 *  (c) película con Maratón activo -> al terminar no inicia nada;
 *  (d) serie T23:E12 y luego película: la película no muestra texto de T/E, no tiene selectores de episodio y su título es el propio;
 *  (e) PC recarga 5 s después de un playDiscoveredMovie: no lo repite; un comando de inicio con issuedAt de hace 15 s se ignora.
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

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const os = require('os');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;

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

function getAllFrames() {
  const frames = [];
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (wc.mainFrame && Array.isArray(wc.mainFrame.framesInSubtree)) {
        frames.push(...wc.mainFrame.framesInSubtree);
      }
    } catch (_) {}
  }
  return frames;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// IPC mocks
ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: testEnv ? testEnv.port : 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('set-fast-media-poll', () => true);
ipcMain.handle('get-embed-status', () => ({
  ok: true,
  video: null,
  cloudflare: false,
  contentUnavailable: false,
}));
ipcMain.handle('simulate-play-click', () => true);

ipcMain.handle('get-real-media-state', async () => {
  const frames = getAllFrames();
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__testVideo || (window.location.href.includes('__test/embed') ? document.querySelector('video') : null);
        if (!v) return null;
        const dur = Number.isFinite(v.duration) ? v.duration : 0;
        const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
        return {
          found: true,
          currentTime: cur,
          duration: dur,
          isPlaying: !v.paused && !v.ended,
          ended: Boolean(v.ended || (dur > 0 && cur >= dur - 0.15)),
          isAd: false,
          title: document.title || ''
        };
      })()`);
      if (res && res.found) return res;
    } catch (_) {}
  }
  return { found: false };
});

ipcMain.handle('control-active-media', async (_event, payload = {}) => {
  const { action, value } = payload;
  const frames = getAllFrames();
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__testVideo || (window.location.href.includes('__test/embed') ? document.querySelector('video') : null);
        if (!v) return { hasMedia: false };
        const act = ${JSON.stringify(action)};
        const val = ${JSON.stringify(value)};
        if (act === 'seek' && typeof val === 'number') {
          v.currentTime = Math.max(0, val);
          if (v.paused) v.play().catch(() => {});
        } else if (act === 'seekRelative' && typeof val === 'number') {
          v.currentTime = Math.max(0, (v.currentTime || 0) + val);
        } else if (act === 'play') {
          v.play().catch(() => {});
        } else if (act === 'pause') {
          v.pause();
        } else if (act === 'togglePlay') {
          if (v.paused) v.play().catch(() => {}); else v.pause();
        }
        return {
          ok: true,
          hasMedia: true,
          acted: true,
          currentTime: v.currentTime || 0,
          duration: v.duration || 0,
          isPlaying: !v.paused && !v.ended
        };
      })()`);
      if (res && res.hasMedia) return res;
    } catch (_) {}
  }
  return { ok: false, hasMedia: false };
});

async function fastForwardEmbedVideoToNearEnd(targetTime = 13.8, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const frames = getAllFrames();
    for (const frame of frames) {
      try {
        const jumped = await frame.executeJavaScript(`(() => {
          const v = window.__testVideo || (window.location.href.includes('__test/embed') ? document.querySelector('video') : null);
          if (!v || !Number.isFinite(v.duration) || v.duration < 10) return false;
          v.muted = true;
          v.currentTime = ${targetTime};
          v.play().catch(() => {});
          return true;
        })()`);
        if (jumped) return true;
      } catch (_) {}
    }
    await wait(300);
  }
  return false;
}

async function getRemoteState(remoteWin) {
  return remoteWin.webContents.executeJavaScript(`(() => {
    const bodyText = document.body.innerText || '';
    const h2 = document.querySelector('section[aria-label="Reproducción de catálogo"] h2');
    const teLine = Array.from(document.querySelectorAll('section[aria-label="Reproducción de catálogo"] p'))
      .map(p => (p.textContent || '').trim())
      .find(t => /^T\\d+:E\\d+/.test(t)) || '';
    const selects = document.querySelectorAll('section[aria-label="Reproducción de catálogo"] select').length;
    return {
      title: h2 ? (h2.textContent || '').trim() : '',
      teLine,
      selects,
      bodyText
    };
  })()`);
}

async function getScreenOverlayState(screenWin) {
  return screenWin.webContents.executeJavaScript(`(() => {
    const h2 = document.querySelector('h2');
    const selects = document.querySelectorAll('select').length;
    const bodyText = document.body.innerText || '';
    const hasVideoPlayer = Boolean(document.querySelector('webview') || document.querySelector('video'));
    return {
      title: h2 ? (h2.textContent || '').trim() : '',
      selects,
      hasVideoPlayer,
      bodyText
    };
  })()`);
}

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv('probe-marathon-launch');
    const { base: baseUrl, room: activeRoomId } = testEnv;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    const embedUrl = `${baseUrl}/__test/embed.html?dur=15`;

    const screenWin = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    const remoteWin = new BrowserWindow({
      width: 430,
      height: 900,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:remote-marathon-' + Date.now(),
      },
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(activeRoomId)}`);
    await remoteWin.loadURL(`${baseUrl}/?role=remote&room=${encodeURIComponent(activeRoomId)}#/control`);

    const buildMarker = await screenWin.webContents.executeJavaScript('window.__cinecastBuild').catch((err) => `err: ${err.message}`);
    console.log(`[BUILD_MARKER] window.__cinecastBuild = "${buildMarker}"`);

    await wait(3500);

    // Activar Maratón en PC y Remote
    await screenWin.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_marathon_mode', 'true');
      window.dispatchEvent(new CustomEvent('cinecast:marathon', { detail: { enabled: true } }));
    `);

    const results = [];

    const seriesMedia = {
      id: 'series-test-999991',
      tmdbId: 999991,
      title: 'Serie Prueba Maratón',
      type: 'series',
      category: 'series',
      seasonsCount: 1,
      posterUrl: '',
      backdropUrl: '',
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
      episodes: [
        {
          id: 'ep-999991-s1-e1',
          title: 'Capítulo Uno',
          seasonNumber: 1,
          episodeNumber: 1,
          servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
        },
        {
          id: 'ep-999991-s1-e2',
          title: 'Capítulo Dos',
          seasonNumber: 1,
          episodeNumber: 2,
          servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
        },
        {
          id: 'ep-999991-s1-e3',
          title: 'Capítulo Tres Final',
          seasonNumber: 1,
          episodeNumber: 3,
          servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
        },
      ],
    };

    // -------------------------------------------------------------------------
    // (a) Serie en medio de temporada (S1:E1) -> avanza a E+1 (S1:E2)
    // -------------------------------------------------------------------------
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playMedia',
          mediaId: seriesMedia.id,
          episodeId: seriesMedia.episodes[0].id,
          payload: {
            media: seriesMedia,
            episode: seriesMedia.episodes[0],
            seasonNumber: 1,
            episodeNumber: 1,
          },
        },
      }),
    });
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: { action: 'setMarathon', payload: { value: true } },
      }),
    });

    await wait(2500);
    await fastForwardEmbedVideoToNearEnd(13.8);
    await wait(4000);

    const stateResA = await fetch(`${baseUrl}/api/sync/poll?roomId=${encodeURIComponent(activeRoomId)}&since=0`).then((r) => r.json());
    const pbA = stateResA?.state || {};
    const passA = pbA.mediaId === seriesMedia.id && Number(pbA.seasonNumber) === 1 && Number(pbA.episodeNumber) === 2;
    results.push({
      caso: '(a) Serie mitad de temporada (S1:E1 -> S1:E2)',
      detalle: `mediaId=${pbA.mediaId}, S${pbA.seasonNumber}:E${pbA.episodeNumber}`,
      pasa: passA,
    });

    // -------------------------------------------------------------------------
    // (b) Último episodio de la última temporada (S1:E3) -> "Fin de la serie", no cambia id ni inicia nada
    // -------------------------------------------------------------------------
    let sawFinDeLaSerie = false;
    let pollActiveB = true;
    const checkFinToast = async () => {
      const st = await getScreenOverlayState(screenWin);
      if (st.bodyText.includes('Fin de la serie')) {
        sawFinDeLaSerie = true;
      }
      return sawFinDeLaSerie;
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playMedia',
          mediaId: seriesMedia.id,
          episodeId: seriesMedia.episodes[2].id,
          payload: {
            media: seriesMedia,
            episode: seriesMedia.episodes[2],
            seasonNumber: 1,
            episodeNumber: 3,
          },
        },
      }),
    });

    await wait(2500);

    // Vigilar en paralelo mientras fastForward lleva al fin y durante 6s completos tras disparar ended
    const earlyWatchB = (async () => {
      while (pollActiveB && !sawFinDeLaSerie) {
        await checkFinToast().catch(() => false);
        if (sawFinDeLaSerie || !pollActiveB) break;
        await wait(120);
      }
    })();

    await fastForwardEmbedVideoToNearEnd(13.8);

    const postEndStart = Date.now();
    while (!sawFinDeLaSerie && Date.now() - postEndStart < 6000) {
      if (await checkFinToast().catch(() => false)) break;
      await wait(120);
    }
    pollActiveB = false;
    await earlyWatchB;

    const stateResB = await fetch(`${baseUrl}/api/sync/poll?roomId=${encodeURIComponent(activeRoomId)}&since=0`).then((r) => r.json());
    const pbB = stateResB?.state || {};
    const passB =
      sawFinDeLaSerie &&
      pbB.mediaId === seriesMedia.id &&
      Number(pbB.seasonNumber) === 1 &&
      Number(pbB.episodeNumber) === 3;
    results.push({
      caso: '(b) Último ep de última temp -> "Fin de la serie"',
      detalle: `toastFin=${sawFinDeLaSerie}, mediaId=${pbB.mediaId}, S${pbB.seasonNumber}:E${pbB.episodeNumber}`,
      pasa: passB,
    });

    // -------------------------------------------------------------------------
    // (c) Película con Maratón activo -> al terminar no inicia nada
    // -------------------------------------------------------------------------
    const movieMediaC = {
      id: 'movie-test-550',
      tmdbId: 550,
      title: 'Película Prueba Maratón',
      type: 'movie',
      category: 'movies',
      posterUrl: '',
      backdropUrl: '',
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: movieMediaC,
        },
      }),
    });

    await wait(2500);
    await fastForwardEmbedVideoToNearEnd(13.8);
    await wait(4000);

    const stateResC = await fetch(`${baseUrl}/api/sync/poll?roomId=${encodeURIComponent(activeRoomId)}&since=0`).then((r) => r.json());
    const pbC = stateResC?.state || {};
    const passC = pbC.mediaId === movieMediaC.id && !pbC.episodeNumber && !pbC.seasonNumber;
    results.push({
      caso: '(c) Película con Maratón activo -> no inicia nada al terminar',
      detalle: `mediaId=${pbC.mediaId}, season=${pbC.seasonNumber ?? 'none'}, ep=${pbC.episodeNumber ?? 'none'}`,
      pasa: passC,
    });

    // -------------------------------------------------------------------------
    // (d) Serie T23:E12 y luego película: la película no muestra T/E, sin selectores y título propio
    // -------------------------------------------------------------------------
    const seriesT23 = {
      id: 'series-t23-1434',
      tmdbId: 1434,
      title: 'Padre de Familia',
      type: 'series',
      category: 'series',
      seasonsCount: 23,
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
      episodes: [
        {
          id: 'ep-1434-s23-e12',
          title: 'Capítulo Doce T23',
          seasonNumber: 23,
          episodeNumber: 12,
          servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
        },
      ],
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playMedia',
          mediaId: seriesT23.id,
          episodeId: seriesT23.episodes[0].id,
          payload: {
            media: seriesT23,
            episode: seriesT23.episodes[0],
            seasonNumber: 23,
            episodeNumber: 12,
          },
        },
      }),
    });
    await wait(2500);

    const movieClean = {
      id: 'movie-clean-27205',
      tmdbId: 27205,
      title: 'El Origen',
      type: 'movie',
      category: 'movies',
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: movieClean,
        },
      }),
    });
    await wait(3000);

    const screenD = await getScreenOverlayState(screenWin);
    const remoteD = await getRemoteState(remoteWin);
    const passD =
      screenD.title === 'El Origen' &&
      screenD.selects === 0 &&
      remoteD.title === 'El Origen' &&
      remoteD.teLine === '' &&
      remoteD.selects === 0 &&
      !remoteD.bodyText.includes('T23:E12');

    results.push({
      caso: '(d) Serie T23:E12 -> Película (sin T/E, 0 selects, título propio)',
      detalle: `PC(title="${screenD.title}", selects=${screenD.selects}) | Remote(title="${remoteD.title}", te="${remoteD.teLine}", selects=${remoteD.selects})`,
      pasa: passD,
    });

    // -------------------------------------------------------------------------
    // (e) PC recarga 5 s después de un playDiscoveredMovie: no lo repite; comando con issuedAt de hace 15 s se ignora
    // -------------------------------------------------------------------------
    const movieReload = {
      id: 'movie-reload-999',
      tmdbId: 603,
      title: 'Matrix Recarga Test',
      type: 'movie',
      category: 'movies',
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
    };

    const tLaunch = Date.now();
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: movieReload,
        },
      }),
    });
    await wait(2000);

    // Cerrar reproductor en PC antes de recargar a los 5 s
    await screenWin.webContents.executeJavaScript(`(() => {
      const backBtn = document.querySelector('button[title="Volver atrás"]');
      if (backBtn) backBtn.click();
    })()`);

    const elapsed = Date.now() - tLaunch;
    if (elapsed < 5200) {
      await wait(5200 - elapsed);
    }

    await screenWin.webContents.reload();
    await wait(4000);

    const afterReloadScreen = await getScreenOverlayState(screenWin);
    const notRepeatedAfterReload = !afterReloadScreen.hasVideoPlayer && afterReloadScreen.title !== 'Matrix Recarga Test';

    // Ahora enviar comando de inicio mientras la PC está desconectada y esperar >10s reales en servidor
    const staleMovie = {
      id: 'movie-stale-15s',
      tmdbId: 155,
      title: 'Película Vieja 15s',
      type: 'movie',
      category: 'movies',
      servers: [{ name: 'TestEmbed15', url: embedUrl, type: 'iframe', language: 'Latino' }],
    };
    if (!screenWin.webContents.debugger.isAttached()) {
      screenWin.webContents.debugger.attach('1.3');
    }
    try {
      await screenWin.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
      });
      await fetch(`${baseUrl}/api/sync/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: activeRoomId,
          command: {
            action: 'playDiscoveredMovie',
            payload: staleMovie,
          },
        }),
      });
      await wait(11500);
    } finally {
      await screenWin.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      }).catch(() => {});
    }
    await screenWin.webContents.reload();
    await wait(3500);

    const afterStaleScreen = await getScreenOverlayState(screenWin);
    const staleIgnored = !afterStaleScreen.hasVideoPlayer && afterStaleScreen.title !== 'Película Vieja 15s';

    const passE = notRepeatedAfterReload && staleIgnored;
    results.push({
      caso: '(e) Recarga PC 5s tras playDiscoveredMovie + comando issuedAt -15s',
      detalle: `noRepiteTrasRecarga=${notRepeatedAfterReload}, ignora15s=${staleIgnored}`,
      pasa: passE,
    });

    console.log('\n=== RESULTADOS PROBE-MARATHON-LAUNCH ===');
    console.table(results);

    const allPass = results.every((r) => r.pasa);
    await testEnv.stop();
    app.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-marathon-launch] Error fatal:', err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});

