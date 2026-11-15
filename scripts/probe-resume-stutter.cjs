#!/usr/bin/env node
/**
 * scripts/probe-resume-stutter.cjs
 * Evaluación de reanudación fluida a los 600s sin trabas ni bucles de re-seek.
 * Prueba 5 variantes sobre embed-slow.html:
 *  (a) normal: dur=1420
 *  (b) snap=8: dur=1420&snap=8
 *  (c) snap=8 + stall=1500: dur=1420&snap=8&stall=1500
 *  (d) jitter=1: dur=1420&jitter=1
 *  (e) lag=3: dur=1420&lag=3
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let spawnedServer = null;

const globalTimeout = setTimeout(() => {
  console.error('[probe-resume-stutter] TIMEOUT GLOBAL ALCANZADO (145s)');
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }
  app.exit(1);
}, 145000);

async function runVariant(key, queryParams, baseUrl, roomId, winScreen, winPhone) {
  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`[probe-resume-stutter] Iniciando Variante (${key}): ?${queryParams}`);
  console.log(`--------------------------------------------------------------------------------`);

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
  await wait(600);

  const embedUrl = `${baseUrl}/__test/embed-slow.html?${queryParams}`;
  const targetSeconds = 600;

  let targetScreenId = null;
  for (let w = 0; w < 15; w++) {
    targetScreenId = await winPhone.webContents.executeJavaScript(`
      window.__cinecastRuntime?.selectedScreenId || null
    `).catch(() => null);
    if (targetScreenId) break;
    await wait(200);
  }

  // Lanzar reproducción desde el celular apuntando a la PC
  await winPhone.webContents.executeJavaScript(`
    if (window.cinecastDeviceSync) {
      const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
      window.cinecastDeviceSync.sendCommand({
        action: 'playDiscoveredMovie',
        payload: {
          id: 'tmdb-movie-stutter-${key}',
          tmdbId: 789123,
          title: 'Prueba Stutter ${key}',
          type: 'movie',
          initialTime: ${targetSeconds},
          currentTime: ${targetSeconds},
          duration: 1420,
          servers: [
            { name: 'Embed Slow Stutter', type: 'iframe', url: ${JSON.stringify(embedUrl)} }
          ]
        }
      }, targetId);
    }
  `);

  const startTime = Date.now();
  let fluentTimeSec = null;
  let lastRealTime = null;
  let advancingStreak = 0;
  let maxSeekCount = 0;
  let finalRealTime = 0;
  let jumpedPosition = null;

  // Monitorear cada 250 ms durante 12 segundos
  const totalTicks = 48; // 12 segundos
  for (let tick = 0; tick < totalTicks; tick++) {
    await wait(250);

    const allFrames = getAllFrames();
    let frameData = null;
    for (const frame of allFrames) {
      try {
        const res = await frame.executeJavaScript(`(() => {
          const v = window.__v || (window.location.href.includes('embed-slow') ? document.querySelector('video') : null);
          if (!v) return null;
          return {
            currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
            readyState: typeof v.readyState === 'number' ? v.readyState : 0,
            paused: Boolean(v.paused),
            seekCount: typeof window.__seekCount === 'number' ? window.__seekCount : 0,
          };
        })()`);
        if (res) {
          frameData = res;
          break;
        }
      } catch (_) {}
    }

    if (frameData) {
      finalRealTime = frameData.currentTime;
      if (frameData.seekCount > maxSeekCount) {
        maxSeekCount = frameData.seekCount;
      }
      if (frameData.seekCount >= 1 && jumpedPosition === null && frameData.currentTime > 50) {
        jumpedPosition = frameData.currentTime;
      }

      // Detectar si está en reproducción fluida: readyState >= 3 y avanzando sostenidamente
      if (frameData.readyState >= 3 && !frameData.paused) {
        if (lastRealTime !== null && frameData.currentTime > lastRealTime + 0.05) {
          advancingStreak += 1;
        } else {
          advancingStreak = 0;
        }
      } else {
        advancingStreak = 0;
      }
      lastRealTime = frameData.currentTime;

      if (advancingStreak >= 3 && fluentTimeSec === null) {
        fluentTimeSec = Number(((Date.now() - startTime) / 1000).toFixed(1));
      }
    }
  }

  const allowedDiff = queryParams.includes('snap') ? 8.5 : queryParams.includes('lag') ? 6.0 : 2.5;
  const dev = jumpedPosition !== null ? Math.abs(jumpedPosition - targetSeconds) : Math.abs(finalRealTime - targetSeconds);
  const loopDetected = maxSeekCount > 1;
  const pass = maxSeekCount === 1 && dev <= allowedDiff && !loopDetected && fluentTimeSec !== null && finalRealTime >= (targetSeconds - 15);

  return {
    key,
    name: `(${key}) ${queryParams}`,
    saltos: maxSeekCount,
    tiempoFluidaSec: fluentTimeSec !== null ? `${fluentTimeSec}s` : 'timeout',
    posicionFinal: `${finalRealTime.toFixed(1)}s`,
    desviacion: `${dev.toFixed(1)}s`,
    bucleReSeek: loopDetected ? 'SI' : 'NO',
    pasa: pass ? 'PASA' : 'FALLA',
  };
}

async function run() {
  testEnv = await startTestEnv({
    name: 'probe-resume-stutter',
    enablePrewarm: false,
    env: {
      CINECAST_TEST: '1',
      CINECAST_DEBUG_PERF: '1',
    },
  });

  const baseUrl = testEnv.lanBase;
  const roomId = testEnv.room;
  console.log(`[probe-resume-stutter] TestEnv listo: ${baseUrl} (sala: ${roomId})`);

  const safeHandle = (channel, fn) => {
    try { ipcMain.removeHandler(channel); } catch (_) {}
    try { ipcMain.handle(channel, fn); } catch (_) {}
  };

  // IPC Mocks necesarios
  safeHandle('get-local-ip', () => ({ ip: testEnv.lanIp, port: testEnv.port }));
  safeHandle('get-diagnostic-mode', () => false);
  safeHandle('set-diagnostic-mode', () => false);
  safeHandle('get-real-media-state', async () => {
    const frames = getAllFrames();
    for (const frame of frames) {
      try {
        const res = await frame.executeJavaScript(`(() => {
          const v = window.__v || (window.location.href.includes('embed-slow') ? document.querySelector('video') : null);
          if (!v) return null;
          const dur = Number.isFinite(v.duration) ? v.duration : 0;
          const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
          let bufEnd = cur;
          try {
            if (v.buffered && v.buffered.length > 0) bufEnd = v.buffered.end(v.buffered.length - 1);
          } catch (_) {}
          return {
            found: true,
            currentTime: cur,
            duration: dur,
            readyState: v.readyState || 0,
            isPlaying: !v.paused,
            buffered: bufEnd,
            title: document.title || '',
            seekCount: typeof window.__seekCount === 'number' ? window.__seekCount : 0,
          };
        })()`);
        if (res && res.found) return res;
      } catch (_) {}
    }
    return null;
  });

  safeHandle('control-active-media', async (_event, { action, value }) => {
    const frames = getAllFrames();
    let acted = false;
    let curTime = 0;
    for (const frame of frames) {
      try {
        const res = await frame.executeJavaScript(`(() => {
          const v = window.__v || (window.location.href.includes('embed-slow') ? document.querySelector('video') : null);
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
  safeHandle('get-detected-tracks', () => null);
  safeHandle('set-master-volume', () => ({ ok: true }));
  safeHandle('get-no-cors-fix', () => false);
  safeHandle('check-embed-providers', () => []);
  safeHandle('focus-window', () => true);
  safeHandle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
  safeHandle('simulate-play-click', () => true);
  safeHandle('set-player-servers', () => true);
  safeHandle('start-load-trace', () => ({ ok: true }));
  safeHandle('end-load-trace', () => true);

  const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');

  // Ventana PC (Rol Screen)
  const winScreen = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    title: 'PC',
    webPreferences: {
      partition: 'persist:probe-stutter-screen-' + Date.now(),
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // Ventana Celular (Rol Remote)
  const winPhone = new BrowserWindow({
    width: 412,
    height: 915,
    show: false,
    title: 'Phone',
    webPreferences: {
      partition: 'persist:probe-stutter-phone-' + Date.now(),
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  winScreen.webContents.on('console-message', (_e, level, msg) => {
    if (msg.includes('ResumeController') || msg.includes('VideoPlayer') || msg.includes('embed') || msg.includes('Salto')) {
      console.log('[winScreen console]', msg);
    }
  });

  const screenUrl = `${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`;
  const phoneUrl = `${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`;

  await winScreen.loadURL(screenUrl);
  await winPhone.loadURL(phoneUrl);
  await wait(3000);

  // Esperar a que ambas conecten
  console.log('[probe-resume-stutter] Esperando conexión de ambas ventanas...');
  for (let i = 0; i < 30; i++) {
    const screenConn = await winScreen.webContents.executeJavaScript(`
      Boolean(window.cinecastDeviceSync && window.cinecastDeviceSync.isConnected())
    `).catch(() => false);
    const phoneConn = await winPhone.webContents.executeJavaScript(`
      Boolean(window.cinecastDeviceSync && window.cinecastDeviceSync.isConnected())
    `).catch(() => false);
    if (screenConn && phoneConn) break;
    await wait(300);
  }

  const variants = [
    { key: 'a', query: 'dur=1420' },
    { key: 'b', query: 'dur=1420&snap=8' },
    { key: 'c', query: 'dur=1420&snap=8&stall=1500' },
    { key: 'd', query: 'dur=1420&jitter=1' },
    { key: 'e', query: 'dur=1420&lag=3' },
  ];

  const results = [];
  for (const v of variants) {
    const res = await runVariant(v.key, v.query, baseUrl, roomId, winScreen, winPhone);
    results.push(res);
  }

  console.log('\n================================================================================');
  console.log('TABLA PROBE-RESUME-STUTTER (Saltos, Fluidez y Re-seek)');
  console.log('================================================================================');
  console.log('| Variante | Query | Saltos (Exp=1) | Tiempo Fluida | Posición Final | Desv (Max 8s/2s) | Bucle Re-Seek | Estado |');
  console.log('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const r of results) {
    console.log(`| ${r.key} | ${r.name} | ${r.saltos} | ${r.tiempoFluidaSec} | ${r.posicionFinal} | ${r.desviacion} | ${r.bucleReSeek} | ${r.pasa} |`);
  }
  console.log('================================================================================\n');

  const allPassed = results.every((r) => r.pasa === 'PASA');
  console.log(`Resultado global probe-resume-stutter: ${allPassed ? 'PASA' : 'FALLA'}`);

  clearTimeout(globalTimeout);
  try { winScreen.destroy(); } catch (_) {}
  try { winPhone.destroy(); } catch (_) {}
  if (testEnv) {
    await testEnv.stop();
  }
  process.exit(allPassed ? 0 : 1);
}

run().catch(async (err) => {
  console.error('[probe-resume-stutter] Error fatal:', err);
  if (testEnv) {
    try { await testEnv.stop(); } catch (_) {}
  }
  app.exit(1);
});
