#!/usr/bin/env node
/**
 * scripts/probe-transport-row.cjs
 * PARTE 3 (Paso 9): Verifica en RemotePanel (#/control):
 *  - Eliminados los botones circulares ±10 s junto a Play
 *  - Fila principal: capítulo anterior, play/pausa y capítulo siguiente (solo en series; ocultos en películas)
 *  - 4 botones de salto (-60, -10, +10, +60) y barra de progreso (role="slider")
 *  - Exactamente 1 botón para seekRelative -10 y 1 para +10
 *  - Ningún aria-label duplicado
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

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
ipcMain.handle('get-real-media-state', async () => ({
  found: true,
  currentTime: 30,
  duration: 400,
  isPlaying: true,
  ended: false,
  isAd: false,
}));
ipcMain.handle('control-active-media', async () => ({ ok: true, hasMedia: true, acted: true }));

async function inspectRemoteTransport(remoteWin) {
  return remoteWin.webContents.executeJavaScript(`(() => {
    const section = document.querySelector('section[aria-label="Reproducción de catálogo"]');
    if (!section) return { found: false };
    const buttons = Array.from(section.querySelectorAll('button')).filter(b => !b.classList.contains('hidden'));
    const minus10Btns = buttons.filter(b => {
      const txt = (b.textContent || '').trim();
      const lbl = (b.getAttribute('aria-label') || '').trim();
      return txt === '-10s' || /(-10s|Retroceder 10 segundos)/i.test(lbl);
    });
    const plus10Btns = buttons.filter(b => {
      const txt = (b.textContent || '').trim();
      const lbl = (b.getAttribute('aria-label') || '').trim();
      return txt === '+10s' || /(\\+10s|Adelantar 10 segundos)/i.test(lbl);
    });
    const minus60Btns = buttons.filter(b => (b.textContent || '').trim() === '-60s');
    const plus60Btns = buttons.filter(b => (b.textContent || '').trim() === '+60s');
    const hasPrevEp = Boolean(section.querySelector('button[aria-label="Capítulo anterior"]'));
    const hasNextEp = Boolean(section.querySelector('button[aria-label="Capítulo siguiente"]'));
    const hasPlayPause = Boolean(section.querySelector('button[aria-label="Pausar"], button[aria-label="Reproducir"]'));
    const hasSlider = Boolean(section.querySelector('[role="slider"]'));

    const allAriaEls = Array.from(document.querySelectorAll('[aria-label]')).filter(el => !el.classList.contains('hidden'));
    const counts = {};
    for (const el of allAriaEls) {
      const l = (el.getAttribute('aria-label') || '').trim();
      if (!l) continue;
      counts[l] = (counts[l] || 0) + 1;
    }
    const duplicateAriaLabels = Object.entries(counts)
      .filter(([, c]) => c > 1)
      .map(([k, c]) => k + '(' + c + ')');

    return {
      found: true,
      minus10Count: minus10Btns.length,
      plus10Count: plus10Btns.length,
      minus60Count: minus60Btns.length,
      plus60Count: plus60Btns.length,
      hasPrevEp,
      hasNextEp,
      hasPlayPause,
      hasSlider,
      duplicateAriaLabels
    };
  })()`);
}

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv('probe-transport-row');
    const { base: baseUrl, room: activeRoomId } = testEnv;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    const embedUrl = `${baseUrl}/__test/embed.html?dur=400`;
    const runId = Date.now();

    const screenWin = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        partition: 'persist:screen-transport-' + runId,
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
        partition: 'persist:remote-transport-' + runId,
      },
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(activeRoomId)}`);
    await remoteWin.loadURL(`${baseUrl}/?role=remote&room=${encodeURIComponent(activeRoomId)}#/control`);
    await wait(3500);
    await remoteWin.webContents.executeJavaScript(`window.location.hash = '#/control';`);
    await wait(1000);

    const results = [];

    // 1) Reproduciendo Serie
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playMedia',
          payload: {
            media: {
              id: 'series-transport-1',
              tmdbId: 1399,
              title: 'Serie Transporte Test',
              type: 'series',
              category: 'series',
              seasonsCount: 1,
              servers: [{ name: 'TestEmbed', url: embedUrl, type: 'iframe', language: 'Latino' }],
              episodes: [
                { id: 'ep-1', title: 'Ep 1', seasonNumber: 1, episodeNumber: 1 },
                { id: 'ep-2', title: 'Ep 2', seasonNumber: 1, episodeNumber: 2 },
              ],
            },
            seasonNumber: 1,
            episodeNumber: 1,
          },
        },
      }),
    });
    await wait(2500);

    const seriesInfo = await inspectRemoteTransport(remoteWin);
    const passSeries =
      seriesInfo.found &&
      seriesInfo.minus10Count === 1 &&
      seriesInfo.plus10Count === 1 &&
      seriesInfo.minus60Count === 1 &&
      seriesInfo.plus60Count === 1 &&
      seriesInfo.hasPrevEp === true &&
      seriesInfo.hasNextEp === true &&
      seriesInfo.hasPlayPause === true &&
      seriesInfo.hasSlider === true &&
      seriesInfo.duplicateAriaLabels.length === 0;

    results.push({
      caso: '1) Serie: Cap Ant/Play/Cap Sig + 4 saltos (-60,-10,+10,+60) + slider + 0 aria-label dup',
      detalle: `-10=${seriesInfo.minus10Count}, +10=${seriesInfo.plus10Count}, prev=${seriesInfo.hasPrevEp}, next=${seriesInfo.hasNextEp}, dups=[${(seriesInfo.duplicateAriaLabels || []).join(', ')}]`,
      pasa: passSeries,
    });

    // 2) Reproduciendo Película
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'movie-transport-1',
            tmdbId: 550,
            title: 'Película Transporte Test',
            type: 'movie',
            category: 'movies',
            servers: [{ name: 'TestEmbed', url: embedUrl, type: 'iframe', language: 'Latino' }],
          },
        },
      }),
    });
    await wait(2500);

    const movieInfo = await inspectRemoteTransport(remoteWin);
    const passMovie =
      movieInfo.found &&
      movieInfo.minus10Count === 1 &&
      movieInfo.plus10Count === 1 &&
      movieInfo.minus60Count === 1 &&
      movieInfo.plus60Count === 1 &&
      movieInfo.hasPrevEp === false &&
      movieInfo.hasNextEp === false &&
      movieInfo.hasPlayPause === true &&
      movieInfo.hasSlider === true &&
      movieInfo.duplicateAriaLabels.length === 0;

    results.push({
      caso: '2) Película: sin Cap Ant/Sig + Play + 4 saltos (-60,-10,+10,+60) + slider + 0 aria-label dup',
      detalle: `-10=${movieInfo.minus10Count}, +10=${movieInfo.plus10Count}, prev=${movieInfo.hasPrevEp}, next=${movieInfo.hasNextEp}, dups=[${(movieInfo.duplicateAriaLabels || []).join(', ')}]`,
      pasa: passMovie,
    });

    console.log('\n=== RESULTADOS PROBE-TRANSPORT-ROW ===');
    console.table(results);

    const allPass = results.every((r) => r.pasa);
    await testEnv.stop();
    app.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-transport-row] Error fatal:', err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
