#!/usr/bin/env node
/**
 * scripts/probe-cseq-clock.cjs
 * Verifica:
 *  (a) Recarga en caliente del celular: cseq se reinicia en 1 pero con senderEpoch creciente
 *      (epoch:seq lexicográfico) y los 5 controles absolutos (seek, setVolume, selectServer,
 *      jumpToEpisode, setAudioSettings) se aplican tras recargar. También verifica rechazo
 *      de comandos fuera de orden de un epoch anterior.
 *  (b) Reloj del celular corrido -5 min y +5 min: tanto acciones de lanzamiento como controles
 *      absolutos aplican porque la antigüedad se mide exclusivamente con el reloj del servidor.
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
const http = require('http');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
let mockServer = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});

const globalTimer = setTimeout(() => {
  console.error('[probe-cseq-clock] TIMEOUT GLOBAL (140s)');
  if (mockServer) try { mockServer.close(); } catch (_) {}
  if (testEnv) try { testEnv.stop(); } catch (_) {}
  app.exit(1);
}, 140000);

ipcMain.handle('get-local-ip', () => ({ ip: testEnv ? testEnv.lanIp : '127.0.0.1', port: testEnv ? testEnv.port : 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('control-active-media', () => ({ ok: true }));
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('check-embed-providers', () => []);

function startMockEmbedServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="background:#000;color:#fff">Mock Embed</body></html>');
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

async function waitForConnection(win, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`(() => {
      const ds = window.cinecastDeviceSync;
      return Boolean(ds && ds.getSyncTelemetrySummary && ds.getSyncTelemetrySummary().transporte === 'ws');
    })()`).catch(() => false);
    if (ok) return true;
    await wait(250);
  }
  return false;
}

async function attachScreenRecorder(winScreen) {
  await winScreen.webContents.executeJavaScript(`(() => {
    window.__probeReceived = [];
    window.__lastBroadcastState = null;
    if (window.__probeUnsub) window.__probeUnsub();
    const ds = window.cinecastDeviceSync;
    window.__probeUnsub = ds.onCommand((cmd) => {
      window.__probeReceived.push({
        id: cmd.id,
        action: cmd.action,
        payload: cmd.payload,
        cseq: cmd.cseq,
        senderId: cmd.senderId,
        receivedAt: Date.now(),
      });
    });
    if (!window.__broadcastHooked && typeof ds.broadcastPlaybackState === 'function') {
      const origBroadcast = ds.broadcastPlaybackState.bind(ds);
      ds.broadcastPlaybackState = (st) => {
        window.__lastBroadcastState = st;
        return origBroadcast(st);
      };
      window.__broadcastHooked = true;
    }
    return true;
  })()`);
}

async function sendRemoteCommand(winRemote, action, payload, opts = {}) {
  return await winRemote.webContents.executeJavaScript(`(() => {
    const ds = window.cinecastDeviceSync;
    if (!ds || typeof ds.sendCommand !== 'function') return { invoked: false };
    ds.sendCommand({ action: ${JSON.stringify(action)}, payload: ${JSON.stringify(payload)} }, ${JSON.stringify(opts.targetId || undefined)});
    return { invoked: true };
  })()`);
}

async function waitForReceivedCount(winScreen, action, minCount, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await winScreen.webContents.executeJavaScript(
      `JSON.stringify((window.__probeReceived || []).filter((c) => c.action === ${JSON.stringify(action)}))`
    ).then(JSON.parse).catch(() => []);
    if (list.length >= minCount) return list;
    await wait(150);
  }
  return await winScreen.webContents.executeJavaScript(
    `JSON.stringify((window.__probeReceived || []).filter((c) => c.action === ${JSON.stringify(action)}))`
  ).then(JSON.parse).catch(() => []);
}

async function waitForPlaybackMatch(winScreen, predicateJs, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await winScreen.webContents.executeJavaScript(
      `window.__lastBroadcastState || null`
    ).catch(() => null);
    if (state && predicateJs(state)) return { ok: true, state };
    await wait(200);
  }
  const last = await winScreen.webContents.executeJavaScript(
    `window.__lastBroadcastState || null`
  ).catch(() => null);
  return { ok: false, state: last };
}

async function run() {
  let winScreen = null;
  let winRemote = null;
  try {
    const mock = await startMockEmbedServer();
    mockServer = mock.server;

    testEnv = await startTestEnv({ name: 'probe-cseq-clock', useLanIp: true, seedHistory: false });
    const baseUrl = testEnv.lanBase;
    const roomId = testEnv.room;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

    winScreen = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:probe-cseq-screen',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    winRemote = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        partition: 'persist:probe-cseq-remote',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    await Promise.all([
      winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(roomId)}`),
      winRemote.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${encodeURIComponent(roomId)}`),
    ]);

    const cScreen = await waitForConnection(winScreen);
    const cRemote = await waitForConnection(winRemote);
    if (!cScreen || !cRemote) {
      throw new Error(`No conectaron las ventanas (screen=${cScreen}, remote=${cRemote})`);
    }

    await attachScreenRecorder(winScreen);

    // Abrir reproducción de una serie con múltiples episodios y servidores en PC
    const mkServers = (suffix) => [
      { name: 'TestSrv0', url: `${mock.baseUrl}/embed/${suffix}?s=0`, type: 'iframe', language: 'Latino' },
      { name: 'TestSrv1', url: `${mock.baseUrl}/embed/${suffix}?s=1`, type: 'iframe', language: 'Sub' },
    ];
    const seriesPayload = {
      media: {
        id: 'tmdb-series-1396',
        tmdbId: 1396,
        title: 'Breaking Bad',
        type: 'series',
        category: 'series',
        servers: mkServers('s1e1'),
        embedUrl: `${mock.baseUrl}/embed/s1e1`,
        episodes: [
          { id: 'ep-1', title: 'Piloto', seasonNumber: 1, episodeNumber: 1, servers: mkServers('s1e1'), embedUrl: `${mock.baseUrl}/embed/s1e1` },
          { id: 'ep-2', title: 'S1E2', seasonNumber: 1, episodeNumber: 2, servers: mkServers('s1e2'), embedUrl: `${mock.baseUrl}/embed/s1e2` },
          { id: 'ep-3', title: 'S1E3', seasonNumber: 1, episodeNumber: 3, servers: mkServers('s1e3'), embedUrl: `${mock.baseUrl}/embed/s1e3` },
        ],
      },
      episode: { id: 'ep-1', title: 'Piloto', seasonNumber: 1, episodeNumber: 1, servers: mkServers('s1e1'), embedUrl: `${mock.baseUrl}/embed/s1e1` },
      seasonNumber: 1,
      episodeNumber: 1,
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        command: { action: 'playMedia', mediaId: seriesPayload.media.id, episodeId: 'ep-1', payload: seriesPayload },
      }),
    });
    await waitForPlaybackMatch(winScreen, (s) => s.mediaId === 'tmdb-series-1396', 8000);
    await wait(500);

    // =========================================================================
    // (a) Enviar los 5 controles absolutos antes y después de recargar celular
    // =========================================================================
    const preActions = [
      { action: 'seek', payload: 120 },
      { action: 'setVolume', payload: 40 },
      { action: 'selectServer', payload: { index: 0 } },
      { action: 'jumpToEpisode', payload: { season: 1, episode: 2 } },
      { action: 'setAudioSettings', payload: { volume: 110, clarityBoost: true } },
    ];

    for (const item of preActions) {
      await sendRemoteCommand(winRemote, item.action, item.payload);
      await wait(150);
    }

    const preCounts = {};
    for (const item of preActions) {
      const list = await waitForReceivedCount(winScreen, item.action, 1, 6000);
      preCounts[item.action] = list.length;
    }

    // Guardar senderId y cseq actuales antes de recargar
    const senderInfoBefore = await winRemote.webContents.executeJavaScript(`(() => {
      const ds = window.cinecastDeviceSync;
      return {
        deviceId: localStorage.getItem('cinecast_device_id'),
        epoch: localStorage.getItem('cinecast_sender_epoch'),
        list: window.__probeReceived || null,
      };
    })()`);

    // Recarga en caliente del celular (se resetea seq local en memoria a 0->1, sube epoch)
    await new Promise((res) => {
      winRemote.webContents.once('did-finish-load', res);
      winRemote.reload();
    });
    const reconnected = await waitForConnection(winRemote, 15000);
    if (!reconnected) throw new Error('winRemote no reconectó tras reload');
    await wait(500);

    const postActions = [
      { action: 'seek', payload: 245 },
      { action: 'setAudioSettings', payload: { volume: 135, nightMode: true } },
      { action: 'setVolume', payload: 77 },
      { action: 'selectServer', payload: { index: 1 } },
      { action: 'jumpToEpisode', payload: { season: 1, episode: 3 } },
    ];

    const postResults = {};
    let audioAppliedAfterSend = false;
    for (const item of postActions) {
      const sendRes = await sendRemoteCommand(winRemote, item.action, item.payload);
      const list = await waitForReceivedCount(winScreen, item.action, 2, 6000);
      const latest = list[list.length - 1];
      if (item.action === 'setAudioSettings') {
        const ac = await waitForPlaybackMatch(
          winScreen,
          (s) => Number(s.audioSettings?.volume) === 135 && s.audioSettings?.nightMode === true,
          4000
        );
        audioAppliedAfterSend = ac.ok;
      }
      postResults[item.action] = {
        okSend: Boolean(sendRes?.invoked),
        count: list.length,
        latestCseq: latest?.cseq,
        latestPayload: latest?.payload,
      };
    }

    // Verificar que los cambios de estado aplicaron en AppRuntime (PlaybackState)
    const volCheck = await waitForPlaybackMatch(winScreen, (s) => Number(s.audioSettings?.volume) === 77, 4000);
    const srvCheck = await waitForPlaybackMatch(winScreen, (s) => Number(s.activeServerIndex) === 1, 4000);
    const epCheck = await waitForPlaybackMatch(winScreen, (s) => Number(s.episodeNumber) === 3, 4000);
    const audioCheck = { ok: audioAppliedAfterSend };

    // Probar también que un cseq antiguo de epoch 0 SÍ es descartado por la pantalla
    const staleCmdId = `stale-old-epoch-${Date.now()}`;
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        id: staleCmdId,
        fromDevice: senderInfoBefore.deviceId,
        cseq: '000000000000:000000000999',
        command: {
          id: staleCmdId,
          cseq: '000000000000:000000000999',
          action: 'setVolume',
          payload: 12,
        },
      }),
    });
    await wait(800);
    const staleWasApplied = await winScreen.webContents.executeJavaScript(
      `Boolean((window.__probeReceived || []).find((c) => c.id === ${JSON.stringify(staleCmdId)}))`
    );

    const passA =
      postActions.every((a) => postResults[a.action]?.count >= 2 && postResults[a.action]?.okSend) &&
      volCheck.ok &&
      srvCheck.ok &&
      epCheck.ok &&
      audioCheck.ok &&
      !staleWasApplied;

    console.log(JSON.stringify({
      part: '(a) reload cseq + older-epoch rejection',
      pass: passA,
      postResults,
      stateChecks: { vol: volCheck.ok, srv: srvCheck.ok, ep: epCheck.ok, audio: audioCheck.ok },
      staleWasApplied,
    }, null, 2));

    // =========================================================================
    // (b) Reloj del celular corrido -5 min y +5 min (launch + absolutos)
    // =========================================================================
    const skewResults = [];
    for (const offsetMs of [-300000, 300000]) {
      const label = offsetMs < 0 ? '-5min' : '+5min';
      await winRemote.webContents.executeJavaScript(`(() => {
        if (!window.__origDateNow) window.__origDateNow = Date.now.bind(Date);
        Date.now = () => window.__origDateNow() + (${offsetMs});
        return Date.now();
      })()`);

      const targetVol = offsetMs < 0 ? 33 : 66;
      const targetEp = offsetMs < 0 ? 1 : 2;
      const movieId = offsetMs < 0 ? 550 : 603;

      const beforeVolCount = (await waitForReceivedCount(winScreen, 'setVolume', 0, 500)).length;
      const beforeLaunchCount = (await waitForReceivedCount(winScreen, 'playDiscoveredMovie', 0, 500)).length;

      // Enviar absolutos + lanzamiento con reloj corrido
      const rAud = await sendRemoteCommand(winRemote, 'setAudioSettings', { volume: targetVol + 20, clarityBoost: false });
      const rVol = await sendRemoteCommand(winRemote, 'setVolume', targetVol);
      const rSeek = await sendRemoteCommand(winRemote, 'seek', 90);
      const rSrv = await sendRemoteCommand(winRemote, 'selectServer', { index: 0 });
      const rEp = await sendRemoteCommand(winRemote, 'jumpToEpisode', { season: 1, episode: targetEp });
      const volState = await waitForPlaybackMatch(winScreen, (s) => Number(s.audioSettings?.volume) === targetVol, 4000);
      await wait(150);
      const rLaunch = await sendRemoteCommand(winRemote, 'playDiscoveredMovie', {
        tmdbId: movieId,
        type: 'movie',
        title: `Skew Test ${label}`,
      });

      const gotLaunch = await waitForReceivedCount(winScreen, 'playDiscoveredMovie', beforeLaunchCount + 1, 6000);
      const gotVol = await waitForReceivedCount(winScreen, 'setVolume', beforeVolCount + 1, 6000);

      const okAll =
        Boolean(rLaunch?.invoked) && Boolean(rSeek?.invoked) && Boolean(rVol?.invoked) &&
        Boolean(rSrv?.invoked) && Boolean(rEp?.invoked) && Boolean(rAud?.invoked) &&
        gotLaunch.length >= beforeLaunchCount + 1 &&
        gotVol.length >= beforeVolCount + 1 &&
        volState.ok;

      skewResults.push({
        label,
        ok: okAll,
        rLaunchOk: Boolean(rLaunch?.invoked),
        gotLaunchCount: gotLaunch.length - beforeLaunchCount,
        gotVolCount: gotVol.length - beforeVolCount,
        volApplied: volState.ok,
      });
    }

    await winRemote.webContents.executeJavaScript(`(() => {
      if (window.__origDateNow) Date.now = window.__origDateNow;
    })()`);

    console.log(JSON.stringify({ part: '(b) clock skew +-5min', results: skewResults }, null, 2));

    const allPass = passA && skewResults.every((r) => r.ok);
    if (!allPass) {
      throw new Error('Falló alguna verificación en probe-cseq-clock');
    }
    console.log('[probe-cseq-clock] PASS');
  } finally {
    clearTimeout(globalTimer);
    if (winRemote && !winRemote.isDestroyed()) try { winRemote.destroy(); } catch (_) {}
    if (winScreen && !winScreen.isDestroyed()) try { winScreen.destroy(); } catch (_) {}
    if (mockServer) try { mockServer.close(); } catch (_) {}
    if (testEnv) try { await testEnv.stop(); } catch (_) {}
  }
}

app.whenReady().then(() => {
  run()
    .then(() => app.exit(0))
    .catch((err) => {
      console.error('[probe-cseq-clock] ERROR:', err);
      app.exit(1);
    });
});
