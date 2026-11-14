#!/usr/bin/env node
/**
 * scripts/probe-perf-video.cjs
 * PARTE 3 (Pasos 7, 8 y 9):
 * Mide durante 60 s por configuración con /__test/embed-video.html (1280x720 @ 30fps + tono):
 *  (A) HEAD
 *  (B) HEAD con el celular conectado mandando 5 comandos por segundo
 *  (C) HEAD con el audio embebido desactivado
 *  (D) HEAD con las consultas de tiempo desactivadas
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

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlySet = onlyArg
  ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  : new Set(['A', 'B', 'C', 'D']);

const durationArg = process.argv.find((a) => a.startsWith('--duration='));
const DURATION_SEC = durationArg ? Number(durationArg.slice('--duration='.length)) || 60 : 60;
const isOptimizedMode = process.argv.includes('--optimized');

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

const perfCounters = {
  getRealMediaState: 0,
  controlActiveMedia: 0,
  embedAudioScript: 0,
};
let perfDisableEmbedAudio = false;
let perfDisableTimePoll = false;
let mainWindowRef = null;

app.on('web-contents-created', (_e, wc) => {
  try {
    wc.setBackgroundThrottling(false);
  } catch (_) {}
});

ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
ipcMain.handle('simulate-play-click', () => true);

ipcMain.handle('set-master-volume', async (_event, payload) => {
  const { volume, isMuted, preset, bassGain, midGain, trebleGain, compressorEnabled } = payload || {};
  const muted = Boolean(isMuted || (typeof volume === 'number' && volume <= 0));
  const vol01 = Math.max(0, Math.min(1, Number(volume ?? 100) / 100));

  const isNeutral =
    isOptimizedMode &&
    !muted &&
    Number(volume ?? 100) === 100 &&
    (!preset || preset === 'standard' || preset === 'estandar' || preset === 'normal') &&
    !bassGain &&
    !midGain &&
    !trebleGain &&
    !compressorEnabled;

  if (!perfDisableEmbedAudio && !isNeutral) {
    const frames = getAllFrames();
    for (const frame of frames) {
      if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
      try {
        perfCounters.embedAudioScript++;
        await frame.executeJavaScript(`
          (() => {
            document.querySelectorAll('video, audio').forEach(el => {
              try { el.volume = ${vol01}; el.muted = ${muted}; } catch (_) {}
            });
          })()
        `, false);
      } catch (_) {}
    }
  }
  return { ok: true };
});

ipcMain.handle('get-real-media-state', async () => {
  if (perfDisableTimePoll) return null;
  perfCounters.getRealMediaState++;
  const frames = getAllFrames();
  for (const frame of frames) {
    if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__testVideo || document.querySelector('video');
        if (!v) return null;
        const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3600;
        const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
        return {
          found: true,
          currentTime: cur,
          duration: dur,
          isPlaying: !v.paused && !v.ended,
          title: document.title || 'Embed Test Video'
        };
      })()`, false);
      if (res && res.found) return res;
    } catch (_) {}
  }
  return null;
});

ipcMain.handle('control-active-media', async (_event, { action }) => {
  perfCounters.controlActiveMedia++;
  const frames = getAllFrames();
  for (const frame of frames) {
    if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
    try {
      const res = await frame.executeJavaScript(`(() => {
        const v = window.__testVideo || document.querySelector('video');
        if (!v) return { acted: false };
        if (${JSON.stringify(action)} === 'play' || ${JSON.stringify(action)} === 'togglePlay') {
          if (v.paused) v.play().catch(() => {});
          return { acted: true, isPlaying: !v.paused, currentTime: v.currentTime || 0 };
        }
        return { acted: true, isPlaying: !v.paused, currentTime: v.currentTime || 0 };
      })()`, false);
      if (res && res.acted) return { ok: true, ...res };
    } catch (_) {}
  }
  return { ok: true };
});

let spawnedServer = null;

async function runConfig(cfgKey, baseUrl, roomId, winScreen, winPhone) {
  perfDisableEmbedAudio = cfgKey === 'C';
  perfDisableTimePoll = cfgKey === 'D';

  const queryFlags = [];
  if (cfgKey === 'C') queryFlags.push('noaudio=1');
  if (isOptimizedMode) queryFlags.push('lazyaudio=1');
  const embedUrl = `${baseUrl}/__test/embed-video.html${queryFlags.length ? '?' + queryFlags.join('&') : ''}`;

  console.log(`\n[probe-perf-video] === Iniciando Configuración (${cfgKey}) durante ${DURATION_SEC}s [${embedUrl}] ===`);

  if (cfgKey === 'B') {
    await winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);
    await wait(2000);
  } else {
    await winPhone.loadURL('about:blank');
    await wait(500);
  }

  // Enviar comando playDiscoveredMovie a winScreen vía API de la sala
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId,
      fromDevice: 'perf_launcher',
      id: `cmd_launch_${cfgKey}_${Date.now()}`,
      command: {
        action: 'playDiscoveredMovie',
        payload: {
          id: `tmdb-movie-687163-${cfgKey}`,
          tmdbId: 687163,
          title: `Perf Video 720p30 (${cfgKey})`,
          type: 'movie',
          duration: 3600,
          servers: [{ name: 'Perf 720p30', type: 'iframe', url: embedUrl }],
        },
      },
    }),
  });

  // Esperar a que el <webview> cargue /__test/embed-video.html y empiece a decodificar frames
  for (let w = 0; w < 20; w++) {
    await wait(400);
    let hasVideo = false;
    for (const frame of getAllFrames()) {
      if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
      try {
        const ok = await frame.executeJavaScript(`Boolean(window.__testVideo && window.__testVideo.readyState >= 2)`, false);
        if (ok) {
          hasVideo = true;
          break;
        }
      } catch (_) {}
    }
    if (hasVideo) break;
  }

  // Instalar PerformanceObserver de longtask y reiniciar contadores en winScreen
  perfCounters.getRealMediaState = 0;
  perfCounters.controlActiveMedia = 0;
  perfCounters.embedAudioScript = 0;

  let baseTotalFrames = 0;
  let baseDroppedFrames = 0;
  for (const frame of getAllFrames()) {
    if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
    try {
      const q = await frame.executeJavaScript(`(() => {
        window.__embedAudioCalls = 0;
        const v = window.__testVideo || document.querySelector('video');
        if (!v) return null;
        const qual = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
        return qual ? { total: qual.totalVideoFrames, dropped: qual.droppedVideoFrames } : null;
      })()`, false);
      if (q) {
        baseTotalFrames = q.total;
        baseDroppedFrames = q.dropped;
        break;
      }
    } catch (_) {}
  }

  await winScreen.webContents.executeJavaScript(`
    (() => {
      if (window.cinecastDeviceSync && typeof window.cinecastDeviceSync.resetStatesBroadcastCount === 'function') {
        window.cinecastDeviceSync.resetStatesBroadcastCount();
      }
      window.__longTasks = { count: 0, totalMs: 0 };
      if (!window.__perfObsInstalled && typeof PerformanceObserver !== 'undefined') {
        window.__perfObsInstalled = true;
        try {
          const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              window.__longTasks.count += 1;
              window.__longTasks.totalMs += (e.duration || 0);
            }
          });
          obs.observe({ entryTypes: ['longtask'] });
        } catch (_) {}
      }
    })()
  `);

  let cmdInterval = null;
  if (cfgKey === 'B') {
    let tick = 0;
    cmdInterval = setInterval(() => {
      tick++;
      const mod = tick % 4;
      const cmd =
        mod === 0
          ? { action: 'seekRelative', payload: 5 }
          : mod === 1
          ? { action: 'setVolume', payload: 100 }
          : mod === 2
          ? { action: 'play' }
          : { action: 'seek', payload: 30 };
      winPhone.webContents
        .executeJavaScript(`
          if (window.cinecastDeviceSync) {
            const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
            window.cinecastDeviceSync.sendCommand(${JSON.stringify(cmd)}, targetId);
          }
        `)
        .catch(() => {});
    }, 200); // 5 comandos por segundo
  }

  const samples = [];
  const steps = Math.max(1, Math.floor(DURATION_SEC / 5));

  for (let i = 1; i <= steps; i++) {
    await wait(5000);
    const snap = await (async () => {
      const metrics = app.getAppMetrics();
      const byType = {
        Browser: { cpuPercent: 0, memoryMB: 0 },
        Tab: { cpuPercent: 0, memoryMB: 0 },
        GPU: { cpuPercent: 0, memoryMB: 0 },
        Utility: { cpuPercent: 0, memoryMB: 0 },
      };
      for (const m of metrics) {
        const t = byType[m.type] ? m.type : 'Utility';
        byType[t].cpuPercent += m.cpu?.percentCPUUsage || 0;
        byType[t].memoryMB += (m.memory?.workingSetSize || 0) / 1024;
      }
      let vq = null;
      const frames = getAllFrames();
      for (const frame of frames) {
        if (mainWindowRef && !mainWindowRef.isDestroyed() && frame === mainWindowRef.webContents.mainFrame) continue;
        try {
          const q = await frame.executeJavaScript(`(() => {
            const v = window.__testVideo || document.querySelector('video');
            if (!v) return null;
            const qual = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
            const audioCalls = Number(window.__embedAudioCalls || 0);
            window.__embedAudioCalls = 0;
            return {
              totalVideoFrames: qual ? qual.totalVideoFrames : 0,
              droppedVideoFrames: qual ? qual.droppedVideoFrames : 0,
              paused: Boolean(v.paused),
              readyState: Number(v.readyState || 0),
              audioCalls,
            };
          })()`, false);
          if (q) {
            perfCounters.embedAudioScript += q.audioCalls || 0;
            vq = q;
            break;
          }
        } catch (_) {}
      }
      return { byType, vq };
    })();

    samples.push(snap);
    const curTotal = Math.max(0, (snap.vq?.totalVideoFrames ?? 0) - baseTotalFrames);
    const curDrop = Math.max(0, (snap.vq?.droppedVideoFrames ?? 0) - baseDroppedFrames);
    console.log(
      `[probe-perf-video] (${cfgKey}) t=${i * 5}s | Tab=${snap.byType.Tab.cpuPercent.toFixed(1)}% GPU=${snap.byType.GPU.cpuPercent.toFixed(1)}% Browser=${snap.byType.Browser.cpuPercent.toFixed(1)}% | frames=${curTotal} drop=${curDrop}`
    );
  }

  if (cmdInterval) clearInterval(cmdInterval);

  const rendererStats = await winScreen.webContents.executeJavaScript(`
    (() => ({
      statesBroadcast: window.cinecastDeviceSync?.getStatesBroadcastCount ? window.cinecastDeviceSync.getStatesBroadcastCount() : 0,
      longTasks: window.__longTasks || { count: 0, totalMs: 0 }
    }))()
  `);

  const avg = (arr, fn) => (arr.length ? arr.reduce((a, b) => a + fn(b), 0) / arr.length : 0);
  const tabCpu = avg(samples, (s) => s.byType.Tab.cpuPercent).toFixed(1);
  const gpuCpu = avg(samples, (s) => s.byType.GPU.cpuPercent).toFixed(1);
  const browserCpu = avg(samples, (s) => s.byType.Browser.cpuPercent).toFixed(1);
  const lastVq = samples[samples.length - 1]?.vq || { totalVideoFrames: 0, droppedVideoFrames: 0 };
  const totalFrames = Math.max(0, lastVq.totalVideoFrames - baseTotalFrames);
  const droppedFrames = Math.max(0, lastVq.droppedVideoFrames - baseDroppedFrames);

  return {
    cfgKey,
    tabCpu,
    gpuCpu,
    browserCpu,
    droppedFrames,
    totalFrames,
    longTaskCount: rendererStats.longTasks.count,
    longTaskMs: rendererStats.longTasks.totalMs.toFixed(1),
    getRealPerSec: (perfCounters.getRealMediaState / DURATION_SEC).toFixed(2),
    ctrlPerSec: (perfCounters.controlActiveMedia / DURATION_SEC).toFixed(2),
    audioPerSec: (perfCounters.embedAudioScript / DURATION_SEC).toFixed(2),
    statesPerSec: (rendererStats.statesBroadcast / DURATION_SEC).toFixed(2),
    statesTotal: rendererStats.statesBroadcast,
  };
}

app.whenReady().then(async () => {
  const rootDir = path.resolve(__dirname, '..');
  const lanIp = getLanIp();
  const port = 3000;
  const baseUrl = `http://${lanIp}:${port}`;
  const roomId = 'PERF-ROOM-1';

  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const env = { ...process.env, PORT: String(port), CINECAST_TEST: '1', CINECAST_DISABLE_PREWARM: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  spawnedServer = cp.spawn('node', [tsxCli, 'server.ts'], {
    cwd: rootDir,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  const ready = await waitForHealth(`http://localhost:${port}`, 30000);
  if (!ready) {
    console.error('[probe-perf-video] Servidor no respondió.');
    app.exit(1);
    return;
  }

  const winScreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:perf-screen-' + Date.now(),
      preload: path.join(rootDir, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  mainWindowRef = winScreen;

  const winPhone = new BrowserWindow({
    show: false,
    width: 412,
    height: 915,
    webPreferences: {
      partition: 'persist:perf-phone-' + Date.now(),
      preload: path.join(rootDir, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
  await wait(3000);

  const results = [];
  for (const cfgKey of ['A', 'B', 'C', 'D']) {
    if (!onlySet.has(cfgKey)) continue;
    const r = await runConfig(cfgKey, baseUrl, roomId, winScreen, winPhone);
    results.push(r);
  }

  console.log('\n====================================================================================================');
  console.log('| Config | CPU % (Tab / GPU / Browser) | Cuadros perdidos | Longtasks (cant / ms) | Llamadas/s (get-real / ctrl / audio / estados) |');
  console.log('|--------|-----------------------------|------------------|-----------------------|------------------------------------------------|');
  for (const r of results) {
    console.log(
      `| (${r.cfgKey}) | ${r.tabCpu}% / ${r.gpuCpu}% / ${r.browserCpu}% | ${r.droppedFrames} / ${r.totalFrames} | ${r.longTaskCount} (${r.longTaskMs} ms) | ${r.getRealPerSec} / ${r.ctrlPerSec} / ${r.audioPerSec} / ${r.statesPerSec} (${r.statesTotal}) |`
    );
  }
  console.log('====================================================================================================\n');

  try { winPhone.destroy(); } catch (_) {}
  try { winScreen.destroy(); } catch (_) {}
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch (_) {}
  }
  app.exit(0);
});
