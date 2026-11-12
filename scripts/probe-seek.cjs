#!/usr/bin/env node
/**
 * scripts/probe-seek.cjs
 * Verificación de salto real (seek/seekRelative) en reproductores incrustados con CINECAST_TEST=1.
 * Carga /__test/embed.html en <webview>/iframe (audio WAV 400s en <video>).
 * Envía seekRelative +85 y -10, play y pause, y lee currentTime real dentro del iframe/video.
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

// IPC Handlers requeridos
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
ipcMain.handle('probe-streams', (_e, urls) => (Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []));
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('system-volume', () => ({ ok: true }));
ipcMain.handle('simulate-play-click', () => true);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('open-external', () => true);
ipcMain.handle('send-native-click', () => true);
ipcMain.handle('send-native-key', () => true);

// Lógica universal de control-active-media idéntica a main.cjs
ipcMain.handle('control-active-media', async (_event, { action, value }) => {
  const frames = getAllFrames();
  let handledByMediaEl = false;
  let anyFrameHadMedia = false;
  let currentPlayingState = false;
  let newTime = 0;

  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(async () => {
        const action = ${JSON.stringify(action)};
        const value = ${JSON.stringify(value)};

        const els = Array.from(document.querySelectorAll('video, audio'));
        let acted = false;
        let hasMedia = false;
        let isPlaying = false;
        let curTime = 0;

        for (const el of els) {
          const dur = Number.isFinite(el.duration) ? el.duration : 0;
          const cur = Number.isFinite(el.currentTime) ? el.currentTime : 0;
          if (dur > 0 || cur > 0 || !el.paused || el.readyState >= 1) {
            hasMedia = true;
          }

          if (el.readyState < 1 && dur === 0 && cur === 0 && el.paused) continue;

          const wasPaused = el.paused;
          if (action === 'play') {
            if (wasPaused) {
              try { await el.play(); } catch (_) {}
            }
            acted = true;
          } else if (action === 'pause') {
            if (!wasPaused) {
              el.pause();
            }
            acted = true;
          } else if (action === 'togglePlay') {
            if (wasPaused) {
              try { await el.play(); } catch (_) {}
            } else {
              el.pause();
            }
            acted = true;
          } else if (action === 'seekRelative') {
            const delta = Number(value) || 10;
            const target = Math.max(0, el.currentTime + delta);
            el.currentTime = target;
            try { el.dispatchEvent(new Event('seeking')); el.dispatchEvent(new Event('seeked')); } catch (_) {}
            acted = true;
          } else if (action === 'seek') {
            const target = Math.max(0, Number(value) || 0);
            el.currentTime = target;
            try { el.dispatchEvent(new Event('seeking')); el.dispatchEvent(new Event('seeked')); } catch (_) {}
            acted = true;
          }

          isPlaying = !el.paused && !el.ended;
          curTime = el.currentTime;
          if (acted) break;
        }

        return { acted, hasMedia, isPlaying, currentTime: curTime };
      })()`);

      if (res) {
        if (res.hasMedia) anyFrameHadMedia = true;
        if (res.acted) {
          handledByMediaEl = true;
          currentPlayingState = res.isPlaying;
          newTime = res.currentTime;
          break;
        }
      }
    } catch (_) {}
  }

  return { ok: handledByMediaEl, isPlaying: currentPlayingState, currentTime: newTime, subtitlesEnabled: true };
});

ipcMain.handle('get-real-media-state', async () => {
  const frames = getAllFrames();
  for (const f of frames) {
    try {
      const res = await f.executeJavaScript(`(() => {
        const el = document.querySelector('video, audio');
        if (!el) return null;
        return {
          currentTime: el.currentTime,
          duration: el.duration,
          paused: el.paused
        };
      })()`);
      if (res) return res;
    } catch (_) {}
  }
  return null;
});

const globalTimer = setTimeout(() => {
  console.error('[probe-seek] Timeout global alcanzado (120s)');
  app.exit(1);
}, 120000);

let serverProcess = null;

app.whenReady().then(async () => {
  const port = 3000;
  const baseUrl = `http://localhost:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  // Asegurar servidor con CINECAST_TEST=1
  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-seek] Iniciando servidor con CINECAST_TEST=1...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_DISABLE_PREWARM: '1', CINECAST_TEST: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    const ready = await waitForHealth(baseUrl, 30000);
    if (!ready) {
      console.error('[probe-seek] No se pudo levantar el servidor en el puerto 3000.');
      app.exit(1);
      return;
    }
  } else {
    // Si ya corre, verificar si responde /__test/embed.html
    try {
      const chk = await fetch(`${baseUrl}/__test/embed.html`, { signal: AbortSignal.timeout(2000) });
      if (!chk.ok) {
        console.log('[probe-seek] Servidor activo no tiene CINECAST_TEST=1. Reiniciando...');
        try {
          const { execSync } = require('child_process');
          execSync(`node "${path.join(__dirname, 'cleanup.cjs')}" ${port}`, { stdio: 'ignore' });
        } catch (_) {}
        await wait(1000);
        const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const env = { ...process.env, PORT: String(port), CINECAST_DISABLE_PREWARM: '1', CINECAST_TEST: '1' };
        delete env.ELECTRON_RUN_AS_NODE;
        serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
          cwd: rootDir,
          env,
          stdio: 'ignore',
          windowsHide: true,
        });
        await waitForHealth(baseUrl, 30000);
      }
    } catch (_) {}
  }

  const preloadPath = path.join(rootDir, 'electron', 'preload.cjs');

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:probe-seek-session',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const roomId = 'cine-probe-seek';
  // Cargar con rol screen y room explícito en query params
  await win.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}`);
  await wait(1500);

  // Enviar comando para reproducir el embed de prueba
  console.log('[probe-seek] Cargando embed de prueba en pantalla...');
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId,
      command: {
        action: 'playDiscoveredMovie',
        payload: {
          id: 'tmdb-movie-550',
          tmdbId: 550,
          title: 'Embed Test Movie',
          type: 'movie',
          category: 'movie',
          videoUrl: `${baseUrl}/__test/embed.html`,
          servers: [
            {
              name: 'Embed Test Player',
              url: `${baseUrl}/__test/embed.html`,
              type: 'iframe',
            },
          ],
        },
      },
    }),
  });

  // Esperar a que el frame del embed esté montado
  let targetFrame = null;
  const startWait = Date.now();
  while (Date.now() - startWait < 20000) {
    const frames = getAllFrames();
    for (const f of frames) {
      try {
        const frameUrl = f.url || (await f.executeJavaScript('window.location.href').catch(() => ''));
        if (frameUrl && frameUrl.includes('/__test/embed.html')) {
          targetFrame = f;
          break;
        }
      } catch (_) {}
    }
    if (targetFrame) break;
    await wait(400);
  }

  if (!targetFrame) {
    console.error('[probe-seek] ERROR: No se encontró el frame con el reproductor embed.');
    if (serverProcess) { try { serverProcess.kill(); } catch (_) {} }
    clearTimeout(globalTimer);
    app.exit(1);
    return;
  }

  console.log('[probe-seek] Frame de embed detectado exitosamente.');

  // Esperar a que el video cargue su duración
  const startDurWait = Date.now();
  while (Date.now() - startDurWait < 15000) {
    const dur = await targetFrame.executeJavaScript(`(() => {
      const v = document.getElementById('test-video');
      return (v && Number.isFinite(v.duration)) ? v.duration : 0;
    })()`).catch(() => 0);
    if (dur > 0) break;
    await wait(300);
  }

  async function getEmbedState() {
    return await targetFrame.executeJavaScript(`(() => {
      const v = document.getElementById('test-video');
      return {
        currentTime: v ? v.currentTime : -1,
        paused: v ? v.paused : true,
        duration: v ? v.duration : 0
      };
    })()`);
  }

  const results = [];

  // Estado inicial
  const st0 = await getEmbedState();
  results.push({
    paso: '0. Inicial',
    accion: 'Carga embed',
    esperado: 'currentTime ~0s, dur ~400s',
    obtenido: `currentTime=${st0.currentTime.toFixed(2)}s, paused=${st0.paused}, dur=${st0.duration.toFixed(0)}s`,
    pasa: st0.currentTime >= 0 && st0.currentTime < 5 && Math.round(st0.duration) === 400,
  });

  // 1. Play
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, command: { action: 'play' } }),
  });
  await wait(800);
  const st1 = await getEmbedState();
  results.push({
    paso: '1. Play',
    accion: 'play',
    esperado: 'paused = false',
    obtenido: `paused=${st1.paused}, currentTime=${st1.currentTime.toFixed(2)}s`,
    pasa: st1.paused === false,
  });

  // 2. Salto relativo +85s
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, command: { action: 'seekRelative', payload: 85 } }),
  });
  await wait(800);
  const st2 = await getEmbedState();
  results.push({
    paso: '2. Seek +85s',
    accion: 'seekRelative +85',
    esperado: 'currentTime ~85s (±3s)',
    obtenido: `currentTime=${st2.currentTime.toFixed(2)}s, paused=${st2.paused}`,
    pasa: st2.currentTime >= 84 && st2.currentTime <= 88,
  });

  // 3. Salto relativo -10s
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, command: { action: 'seekRelative', payload: -10 } }),
  });
  await wait(800);
  const st3 = await getEmbedState();
  results.push({
    paso: '3. Seek -10s',
    accion: 'seekRelative -10',
    esperado: 'currentTime ~75s (±3s)',
    obtenido: `currentTime=${st3.currentTime.toFixed(2)}s, paused=${st3.paused}`,
    pasa: st3.currentTime >= 74 && st3.currentTime <= 78,
  });

  // 4. Pause
  await fetch(`${baseUrl}/api/sync/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, command: { action: 'pause' } }),
  });
  await wait(800);
  const st4 = await getEmbedState();
  results.push({
    paso: '4. Pause',
    accion: 'pause',
    esperado: 'paused = true',
    obtenido: `paused=${st4.paused}, currentTime=${st4.currentTime.toFixed(2)}s`,
    pasa: st4.paused === true,
  });

  // Verificar estado broadcast / sync
  let syncState = null;
  try {
    const sRes = await fetch(`${baseUrl}/api/sync/state?roomId=${roomId}`);
    if (sRes.ok) syncState = await sRes.json();
  } catch (_) {}

  const seekUnsupported = Boolean(syncState?.playbackState?.seekUnsupported);
  results.push({
    paso: '5. seekUnsupported',
    accion: 'Verificar soporte reportado',
    esperado: 'seekUnsupported = false',
    obtenido: `seekUnsupported=${seekUnsupported}`,
    pasa: seekUnsupported === false,
  });

  console.log('\n====================================================================================================');
  console.log('RESULTADOS DE PROBE-SEEK (SALTO REAL EN EMBEDS)');
  console.log('====================================================================================================');
  console.log('PASO'.padEnd(20) + 'ESTADO'.padEnd(10) + 'ESPERADO'.padEnd(30) + 'OBTENIDO');
  console.log('----------------------------------------------------------------------------------------------------');
  let allPassed = true;
  for (const r of results) {
    if (!r.pasa) allPassed = false;
    const status = r.pasa ? 'PASA' : 'FALLA';
    console.log(r.paso.padEnd(20) + status.padEnd(10) + r.esperado.padEnd(30) + r.obtenido);
  }
  console.log('====================================================================================================\n');

  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(allPassed ? 0 : 1);
});
