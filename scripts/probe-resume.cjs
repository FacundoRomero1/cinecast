#!/usr/bin/env node
/**
 * scripts/probe-resume.cjs
 * Verificación de reanudación exacta a los 10 minutos (600s) con reproductor de terceros / embebido.
 * Evalúa 4 variantes de embed-slow.html:
 *  (a) ready=6000 early=reset (metadatos tardíos y reseteo si salta antes)
 *  (b) buffer=2000 black=1 (espera de 2s tras seek y 5s en negro)
 *  (c) noseek=1 (reproductor que ignora saltos)
 *  (d) normal
 *
 * Mide cada 500 ms:
 *  - currentTime REAL del video
 *  - Tiempo mostrado en el control del celular
 *  - Banners ("Reanudando...", "Este reproductor no permite saltar")
 *  - Historial guardado a los 20s
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

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await wait(500);
  }
  return false;
}

// IPC mocks
ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: 3000 }));
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
ipcMain.handle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
ipcMain.handle('simulate-play-click', () => true);

ipcMain.handle('get-real-media-state', async () => {
  const frames = getAllFrames();
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__v || document.querySelector('video');
        if (!v) return null;
        const dur = Number.isFinite(v.duration) ? v.duration : 0;
        const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
        return {
          found: true,
          currentTime: cur,
          duration: dur,
          readyState: v.readyState || 0,
          isPlaying: !v.paused,
          title: document.title || ''
        };
      })()`);
      if (res && res.found) return res;
    } catch (_) {}
  }
  return null;
});

ipcMain.handle('control-active-media', async (_event, { action, value }) => {
  const frames = getAllFrames();
  let acted = false;
  let curTime = 0;
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__v || document.querySelector('video');
        if (!v) return { acted: false };
        if (${JSON.stringify(action)} === 'seek') {
          v.currentTime = Number(${JSON.stringify(value)}) || 0;
          return { acted: true, hasMedia: true, currentTime: v.currentTime };
        }
        if (${JSON.stringify(action)} === 'play') {
          if (v.play) v.play();
          return { acted: true, hasMedia: true, isPlaying: true };
        }
        if (${JSON.stringify(action)} === 'pause') {
          if (v.pause) v.pause();
          return { acted: true, hasMedia: true, isPlaying: false };
        }
        return { acted: false };
      })()`);
      if (res && res.acted) {
        acted = true;
        curTime = res.currentTime || 0;
        break;
      }
    } catch (_) {}
  }
  return { ok: acted, acted, hasMedia: acted, currentTime: curTime };
});

let spawnedServer = null;
const globalTimeout = setTimeout(() => {
  console.error('[probe-resume] TIMEOUT GLOBAL ALCANZADO (140s)');
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }
  app.exit(1);
}, 140000);

async function runVariant(key, queryParams, baseUrl, roomId, winScreen, winPhone) {
  console.log(`\n================================================================================`);
  console.log(`[probe-resume] Iniciando Variante (${key}): ${queryParams}`);
  console.log(`================================================================================`);

  // Resetear estados en pantalla y celular
  await winScreen.webContents.executeJavaScript(`
    window.location.hash = '#/';
    if (window.cinecastDeviceSync) {
      window.cinecastDeviceSync.sendCommand({ action: 'setStandby' });
    }
  `).catch(() => {});
  await winPhone.webContents.executeJavaScript(`
    window.location.hash = '#/control';
  `).catch(() => {});
  await wait(1500);

  // Inyectar reproducción en PC con el embed correspondiente
  const embedUrl = `${baseUrl}/__test/embed-slow.html?${queryParams}`;
  console.log(`[probe-resume] Transmitiendo a PC: initialTime=600s en ${embedUrl}`);

  let targetScreenId = null;
  for (let w = 0; w < 15; w++) {
    targetScreenId = await winPhone.webContents.executeJavaScript(`
      window.__cinecastRuntime?.selectedScreenId || null
    `);
    if (targetScreenId) break;
    await wait(300);
  }
  console.log(`[probe-resume] targetScreenId en celular: ${targetScreenId}`);

  await winPhone.webContents.executeJavaScript(`
    if (window.cinecastDeviceSync) {
      const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
      window.cinecastDeviceSync.sendCommand({
        action: 'playDiscoveredMovie',
        payload: {
          id: 'tmdb-movie-687163-${key}',
          tmdbId: 687163,
          title: 'Prueba Reanudar ${key}',
          type: 'movie',
          initialTime: 600,
          currentTime: 600,
          duration: 1420,
          servers: [
            { name: 'Embed Slow', type: 'iframe', url: ${JSON.stringify(embedUrl)} }
          ]
        }
      }, targetId);
    }
  `);

  // Muestreo cada 500 ms durante 22 segundos
  const samples = [];
  const start = Date.now();

  for (let step = 0; step < 40; step++) {
    await wait(500);
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

    // Leer estado real de la PC recorriendo todos los frames (incluyendo webviews)
    let realCur = null;
    let realReadyState = 0;
    const allFrames = getAllFrames();
    for (const frame of allFrames) {
      try {
        const res = await frame.executeJavaScript(`(() => {
          const v = window.__v || document.querySelector('video');
          if (!v) return null;
          return {
            currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
            readyState: typeof v.readyState === 'number' ? v.readyState : 0,
            duration: Number.isFinite(v.duration) ? v.duration : 0,
            paused: Boolean(v.paused)
          };
        })()`);
        if (res) {
          realCur = res.currentTime;
          realReadyState = res.readyState;
          break;
        }
      } catch (_) {}
    }

    // Leer lo que muestra el celular
    const phoneDisplay = await winPhone.webContents.executeJavaScript(`
      (() => {
        const rt = window.__cinecastRuntime || {};
        const pState = rt.remotePlaybackState || {};
        const textElements = Array.from(document.querySelectorAll('span, p, div'));
        const resumeBanner = textElements.find(el => el.textContent && (el.textContent.includes('Reanudando') || el.textContent.includes('no permite saltar')));
        const timeDisplay = textElements.find(el => el.textContent && /~?\\d+:\\d+/.test(el.textContent));
        
        return {
          bannerText: resumeBanner ? resumeBanner.textContent.trim() : null,
          timeText: timeDisplay ? timeDisplay.textContent.trim() : null,
          currentTime: pState.currentTime,
          estimated: Boolean(pState.estimated),
          resumeStatus: pState.resume?.status,
        };
      })()
    `).catch(() => ({}));

    // Leer historial guardado en PC si llegamos a los 20s (step 38)
    let savedHistoryAt20 = null;
    if (step === 38) {
      savedHistoryAt20 = await winScreen.webContents.executeJavaScript(`
        (() => {
          try {
            const raw = localStorage.getItem('cinecast_watch_history_v1') || '[]';
            const arr = JSON.parse(raw);
            const found = arr.find(i => i.id === 'tmdb-movie-687163-${key}' || i.id === 'tmdb-movie-687163' || i.title?.includes('Prueba Reanudar'));
            return found ? found.currentTime : null;
          } catch (_) { return null; }
        })()
      `).catch(() => null);
    }

    samples.push({
      step,
      elapsedSec,
      realTime: realCur ?? null,
      phoneTime: phoneDisplay.currentTime ?? null,
      phoneDisplayTime: phoneDisplay.timeText ?? '',
      phoneBanner: phoneDisplay.bannerText ?? '',
      estimated: phoneDisplay.estimated ?? false,
      savedHistoryAt20,
    });
  }

  // Evaluación de criterios
  const lastSample = samples[samples.length - 1];
  const finalReal = lastSample?.realTime;
  const sampleAt20 = samples.find(s => parseFloat(s.elapsedSec) >= 19.0);
  const savedHist = sampleAt20?.savedHistoryAt20 ?? null;

  let pass = false;
  let detail = '';

  if (key === 'a' || key === 'b' || key === 'd') {
    const minExpected = 597;
    const isRealNear600 = typeof finalReal === 'number' && finalReal >= minExpected;
    const phoneMatchesReal = typeof lastSample.phoneTime === 'number' && Math.abs(lastSample.phoneTime - (finalReal || 0)) <= 3;
    pass = Boolean(isRealNear600 && phoneMatchesReal);
    detail = `finalReal=${finalReal !== null && finalReal !== undefined ? finalReal.toFixed(1) : 'null'}s (esperado >=${minExpected}s) | phoneTime=${lastSample.phoneTime !== null && lastSample.phoneTime !== undefined ? lastSample.phoneTime.toFixed(1) : 'null'}s`;
  } else if (key === 'c') {
    const hasNoSeekMsg = samples.some(s => s.phoneBanner && (s.phoneBanner.includes('no permite saltar') || s.phoneBanner.includes('usá la barra')));
    const hasTilde = samples.some(s => s.phoneDisplayTime && s.phoneDisplayTime.includes('~')) || lastSample.estimated;
    const historyClean = savedHist === null || (typeof finalReal === 'number' && Math.abs(savedHist - finalReal) <= 3);
    pass = Boolean(hasNoSeekMsg && hasTilde && historyClean);
    detail = `hasNoSeekMsg=${hasNoSeekMsg} | hasTilde=${hasTilde} | savedHist=${savedHist} (finalReal=${finalReal !== null && finalReal !== undefined ? finalReal.toFixed(1) : 'null'}s)`;
  }

  console.log(`[probe-resume] Variante (${key}) -> ${pass ? 'PASA' : 'FALLA'}: ${detail}`);
  return {
    key,
    pass,
    detail,
    samples,
  };
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.on('console-message', (_e, level, msg) => {
      console.log('[webview guest console]', msg);
    });
  }
});

app.whenReady().then(async () => {
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const roomId = 'room_resume_test_' + Date.now();

  const isHealthy = await waitForHealth(baseUrl, 3000);
  if (!isHealthy) {
    console.log('[probe-resume] Iniciando servidor local...');
    const rootDir = path.resolve(__dirname, '..');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_BROWSER: '1',
      CINECAST_DISABLE_PREWARM: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });
    const ready = await waitForHealth(baseUrl, 25000);
    if (!ready) {
      console.error('[probe-resume] No se pudo levantar el servidor.');
      app.exit(1);
      return;
    }
  }

  const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');
  const winScreen = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    title: 'PC',
    webPreferences: {
      partition: 'persist:resume-screen-' + Date.now(),
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const winPhone = new BrowserWindow({
    width: 390,
    height: 844,
    show: false,
    title: 'Phone',
    webPreferences: {
      partition: 'persist:resume-phone-' + Date.now(),
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  activeWindows = [winScreen, winPhone];

  winScreen.webContents.on('console-message', (_e, level, msg) => {
    if (msg.includes('VideoPlayer') || msg.includes('ResumeController') || msg.includes('playDiscoveredMovie') || msg.includes('embed')) {
      console.log('[winScreen console]', msg);
    }
  });

  winPhone.webContents.on('console-message', (_e, level, msg) => {
    if (msg.includes('Resume') || msg.includes('Remote') || msg.includes('send')) {
      console.log('[winPhone console]', msg);
    }
  });

  const screenUrl = `${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`;
  const phoneUrl = `${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`;

  await winScreen.loadURL(screenUrl);
  await winPhone.loadURL(phoneUrl);
  await wait(3000);

  const devsRes = await fetch(`${baseUrl}/api/rooms/${roomId}/devices`);
  console.log('[probe-resume] Dispositivos en el servidor tras carga inicial:', await devsRes.json());

  const screenInfo = await winScreen.webContents.executeJavaScript(`({
    href: window.location.href,
    syncRoom: window.cinecastDeviceSync?.getRoomId?.(),
    syncType: window.cinecastDeviceSync?.getDeviceType?.(),
    syncId: window.cinecastDeviceSync?.getDeviceId?.()
  })`);
  console.log('[probe-resume] winScreen info:', screenInfo);

  const phoneInfo = await winPhone.webContents.executeJavaScript(`({
    href: window.location.href,
    syncRoom: window.cinecastDeviceSync?.getRoomId?.(),
    syncType: window.cinecastDeviceSync?.getDeviceType?.(),
    syncId: window.cinecastDeviceSync?.getDeviceId?.(),
    devs: window.cinecastDeviceSync?.getDevices?.(),
    selectedId: window.__cinecastRuntime?.selectedScreenId
  })`);
  console.log('[probe-resume] winPhone info:', phoneInfo);

  const results = [];

  // (a) ready=6000 early=reset
  const resA = await runVariant('a', 'ready=6000&early=reset&dur=1420', baseUrl, roomId, winScreen, winPhone);
  results.push(resA);

  // (b) buffer=2000 black=1
  const resB = await runVariant('b', 'buffer=2000&black=1&dur=1420', baseUrl, roomId, winScreen, winPhone);
  results.push(resB);

  // (c) noseek=1
  const resC = await runVariant('c', 'noseek=1&dur=1420', baseUrl, roomId, winScreen, winPhone);
  results.push(resC);

  // (d) normal
  const resD = await runVariant('d', 'dur=1420', baseUrl, roomId, winScreen, winPhone);
  results.push(resD);

  console.log('\n================================================================================');
  console.log('REPORTE FINAL PROBE-RESUME (scripts/probe-resume.cjs)');
  console.log('================================================================================');
  const summaryTable = results.map(r => ({
    Variante: r.key,
    Resultado: r.pass ? 'PASA' : 'FALLA',
    Detalles: r.detail
  }));
  console.table(summaryTable);

  const allPassed = results.every(r => r.pass);
  console.log(`\nResultado global: ${allPassed ? 'PASA' : 'FALLA'}`);

  clearTimeout(globalTimeout);
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }

  app.exit(allPassed ? 0 : 1);
});

