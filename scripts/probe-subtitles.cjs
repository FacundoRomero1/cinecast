#!/usr/bin/env node
/**
 * scripts/probe-subtitles.cjs
 * PARTE 2 (Paso 8): Pruebas de cinecast_subtitles_pref con testenv:
 *  1) Instalación limpia -> apagados (false, aplica toggleSubtitles=false al embebido, control muestra Subtítulos OFF)
 *  2) Activar, reproducir otro título -> siguen encendidos (cinecast_subtitles_pref='1', aplica true al nuevo embebido, control muestra Subtítulos ON)
 *  3) Apagar -> persiste tras recargar la PC (cinecast_subtitles_pref='0', sigue OFF tras reload y al reproducir)
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
const appliedSubtitleCalls = [];

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
  currentTime: 10,
  duration: 400,
  isPlaying: true,
  ended: false,
  isAd: false,
}));

ipcMain.handle('control-active-media', async (_event, payload = {}) => {
  if (payload && payload.action === 'toggleSubtitles') {
    appliedSubtitleCalls.push({
      value: Boolean(payload.value),
      ts: Date.now(),
    });
  }
  return { ok: true, hasMedia: true, acted: true };
});

async function getRemoteSubsText(remoteWin) {
  return remoteWin.webContents.executeJavaScript(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const subBtn = btns.find(b => (b.textContent || '').includes('Subtítulos'));
    return subBtn ? (subBtn.textContent || '').trim() : '';
  })()`);
}

async function getPcPref(screenWin) {
  return screenWin.webContents.executeJavaScript(`localStorage.getItem('cinecast_subtitles_pref')`);
}

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv('probe-subtitles');
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
        partition: 'persist:screen-subs-' + runId,
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
        partition: 'persist:remote-subs-' + runId,
      },
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(activeRoomId)}`);
    await remoteWin.loadURL(`${baseUrl}/?role=remote&room=${encodeURIComponent(activeRoomId)}#/control`);
    await wait(3500);
    await remoteWin.webContents.executeJavaScript(`window.location.hash = '#/control';`);
    await wait(1000);

    // Garantizar instalación limpia (sin cinecast_subtitles_pref)
    await screenWin.webContents.executeJavaScript(`localStorage.removeItem('cinecast_subtitles_pref')`);

    const results = [];

    // -------------------------------------------------------------------------
    // 1) Instalación limpia -> apagados
    // -------------------------------------------------------------------------
    appliedSubtitleCalls.length = 0;
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'movie-subs-1',
            tmdbId: 550,
            title: 'Película Subs 1',
            type: 'movie',
            category: 'movies',
            servers: [{ name: 'TestEmbed', url: embedUrl, type: 'iframe', language: 'Latino' }],
          },
        },
      }),
    });
    await wait(3000);

    const pref1 = await getPcPref(screenWin);
    const remoteText1 = await getRemoteSubsText(remoteWin);
    const lastApplied1 = appliedSubtitleCalls.length > 0 ? appliedSubtitleCalls[appliedSubtitleCalls.length - 1].value : null;
    const pass1 = (pref1 === null || pref1 === '0') && lastApplied1 === false && remoteText1.includes('OFF');
    results.push({
      caso: '1) Instalación limpia -> apagados',
      detalle: `pref=${JSON.stringify(pref1)}, embedApplied=${lastApplied1}, remote="${remoteText1}"`,
      pasa: pass1,
    });

    // -------------------------------------------------------------------------
    // 2) Activar, reproducir otro título -> siguen encendidos
    // -------------------------------------------------------------------------
    appliedSubtitleCalls.length = 0;
    await remoteWin.webContents.executeJavaScript(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Subtítulos'));
      if (btn) btn.click();
    })()`);
    await wait(2000);

    const prefAfterOn = await getPcPref(screenWin);
    const remoteAfterOn = await getRemoteSubsText(remoteWin);

    appliedSubtitleCalls.length = 0;
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'movie-subs-2',
            tmdbId: 603,
            title: 'Película Subs 2',
            type: 'movie',
            category: 'movies',
            servers: [{ name: 'TestEmbed', url: embedUrl, type: 'iframe', language: 'Latino' }],
          },
        },
      }),
    });
    await wait(3000);

    const pref2 = await getPcPref(screenWin);
    const remoteText2 = await getRemoteSubsText(remoteWin);
    const lastApplied2 = appliedSubtitleCalls.length > 0 ? appliedSubtitleCalls[appliedSubtitleCalls.length - 1].value : null;
    const pass2 =
      prefAfterOn === '1' &&
      remoteAfterOn.includes('ON') &&
      pref2 === '1' &&
      lastApplied2 === true &&
      remoteText2.includes('ON');
    results.push({
      caso: '2) Activar y reproducir otro título -> siguen encendidos',
      detalle: `pref=${JSON.stringify(pref2)}, embedApplied=${lastApplied2}, remote="${remoteText2}"`,
      pasa: pass2,
    });

    // -------------------------------------------------------------------------
    // 3) Apagar -> persiste tras recargar la PC
    // -------------------------------------------------------------------------
    await remoteWin.webContents.executeJavaScript(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Subtítulos'));
      if (btn) btn.click();
    })()`);
    await wait(2000);

    const prefBeforeReload = await getPcPref(screenWin);
    await screenWin.webContents.reload();
    await wait(3500);

    appliedSubtitleCalls.length = 0;
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'movie-subs-3',
            tmdbId: 27205,
            title: 'Película Subs 3 Post-Reload',
            type: 'movie',
            category: 'movies',
            servers: [{ name: 'TestEmbed', url: embedUrl, type: 'iframe', language: 'Latino' }],
          },
        },
      }),
    });
    await wait(3000);

    const pref3 = await getPcPref(screenWin);
    const remoteText3 = await getRemoteSubsText(remoteWin);
    const lastApplied3 = appliedSubtitleCalls.length > 0 ? appliedSubtitleCalls[appliedSubtitleCalls.length - 1].value : null;
    const pass3 =
      prefBeforeReload === '0' &&
      pref3 === '0' &&
      lastApplied3 === false &&
      remoteText3.includes('OFF');
    results.push({
      caso: '3) Apagar -> persiste tras recargar la PC',
      detalle: `pref=${JSON.stringify(pref3)}, embedApplied=${lastApplied3}, remote="${remoteText3}"`,
      pasa: pass3,
    });

    console.log('\n=== RESULTADOS PROBE-SUBTITLES ===');
    console.table(results);

    const allPass = results.every((r) => r.pasa);
    await testEnv.stop();
    app.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-subtitles] Error fatal:', err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});

