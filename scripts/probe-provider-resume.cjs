#!/usr/bin/env node
/**
 * scripts/probe-provider-resume.cjs
 * Evaluación de reanudación con proveedor simulado lento:
 * ttfb=8000, vtag=500, firstframe=25000 y 600s guardados.
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
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const globalTimeout = setTimeout(() => {
  console.error('[probe-provider-resume] TIMEOUT GLOBAL ALCANZADO (145s)');
  app.exit(1);
}, 145000);

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.on('console-message', (_e, level, msg) => {
      console.log('[webview guest console]', msg);
    });
  }
});

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

const withTimeout = (p, ms = 1200, fallback = null) =>
  Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);

async function getFrameVideoData() {
  const allFrames = getAllFrames();
  for (const frame of allFrames) {
    try {
      const res = await withTimeout(frame.executeJavaScript(`(() => {
        const v = window.__testVideo || window.__v || document.querySelector('video');
        if (!v) return null;
        return {
          currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
          duration: Number.isFinite(v.duration) ? v.duration : 0,
          readyState: typeof v.readyState === 'number' ? v.readyState : 0,
          paused: Boolean(v.paused),
          seekCount: typeof window.__seekCount === 'number' ? window.__seekCount : 0,
        };
      })()`), 1000, null);
      if (res) return res;
    } catch (_) {}
  }
  return null;
}

async function getPhoneBannerText(winPhone) {
  try {
    const text = await withTimeout(winPhone.webContents.executeJavaScript(`(() => {
      const banners = Array.from(document.querySelectorAll('div[class*="rounded-xl"]'))
        .map(el => (el.innerText || el.textContent || '').trim())
        .filter(t => t.length > 0);
      const resumeBanner = banners.find(t =>
        t.includes('Reanudando') ||
        t.includes('Cargando el reproductor') ||
        t.includes('no permite saltar') ||
        t.includes('No se pudo reanudar') ||
        t.includes('tardó demasiado')
      );
      return resumeBanner || 'Ninguno';
    })()`), 1000, 'Ninguno');
    return text || 'Ninguno';
  } catch (_) {
    return 'Error';
  }
}

async function getResumeControllerState(winScreen) {
  try {
    const st = await withTimeout(winScreen.webContents.executeJavaScript(`(() => {
      if (window.__cinecastResumeState) {
        return window.__cinecastResumeState;
      }
      const isAct = Boolean(window.__cinecastResumeActive);
      return {
        status: isAct ? 'esperando' : 'idle',
        objetivo: 0
      };
    })()`), 1000, null);
    return st;
  } catch (_) {
    return null;
  }
}

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv({
      prefix: 'probe-provider-resume',
      env: {
        CINECAST_DISABLE_PREWARM: '1',
        CINECAST_TEST: '1',
      },
    });

    const { base: baseUrl, room: roomId, lanIp, port } = testEnv;
    const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: lanIp, port: port }));
    safeHandle('get-diagnostic-mode', () => false);
    safeHandle('set-diagnostic-mode', () => false);
    safeHandle('get-no-cors-fix', () => false);
    safeHandle('check-embed-providers', () => []);
    safeHandle('focus-window', () => true);
    safeHandle('get-detected-tracks', () => null);
    safeHandle('set-master-volume', () => ({ ok: true }));
    safeHandle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
    safeHandle('simulate-play-click', () => true);
    safeHandle('set-player-servers', () => true);
    safeHandle('start-load-trace', () => ({ ok: true }));
    safeHandle('end-load-trace', () => true);

    safeHandle('get-real-media-state', async () => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await frame.executeJavaScript(`(() => {
            const v = window.__testVideo || window.__v || document.querySelector('video');
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
            const v = window.__testVideo || window.__v || document.querySelector('video');
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

    const winScreen = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        partition: 'persist:probe-resume-screen-' + Date.now(),
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    const winPhone = new BrowserWindow({
      width: 390,
      height: 844,
      show: false,
      webPreferences: {
        partition: 'persist:probe-resume-phone-' + Date.now(),
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    winScreen.webContents.on('console-message', (_e, level, msg) => {
      if (msg.includes('ResumeController') || msg.includes('provider') || msg.includes('VideoPlayer')) {
        console.log(`[winScreen] ${msg}`);
      }
    });

    console.log('[probe-provider-resume] Cargando pantallas...');
    await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
    await winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);

    // Esperar a que ambas conecten
    for (let i = 0; i < 30; i++) {
      const sc = await winScreen.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected())').catch(() => false);
      const pc = await winPhone.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected())').catch(() => false);
      if (sc && pc) break;
      await wait(200);
    }

    const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'baseline';
    console.log(`[probe-provider-resume] Modo seleccionado: ${mode}`);

    let queryParams = 'ttfb=8000&vtag=500&firstframe=25000&dur=1420&label=Servidor%20A';
    if (mode === 'noseek') {
      queryParams = 'ttfb=8000&vtag=500&firstframe=25000&dur=1420&noseek=1&label=Servidor%20A';
    } else if (mode === 'timeout90') {
      queryParams = 'ttfb=8000&vtag=500&firstframe=100000&dur=1420&label=Servidor%20A';
    }

    const providerUrl = `${baseUrl}/__test/provider/tv/1396/1/5?${queryParams}`;
    const targetSeconds = 600;

    console.log(`[probe-provider-resume] Lanzando reproducción con initialTime=${targetSeconds}s: ${providerUrl}`);

    await winPhone.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync) {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'playDiscoveredMovie',
          payload: {
            id: 'tmdb-series-1396',
            tmdbId: 1396,
            title: 'Breaking Bad',
            type: 'series',
            season: 1,
            episode: 5,
            seasonNumber: 1,
            episodeNumber: 5,
            episodeTitle: 'Episodio 5',
            initialTime: ${targetSeconds},
            currentTime: ${targetSeconds},
            duration: 1420,
            servers: [
              { name: 'Servidor A', type: 'iframe', url: ${JSON.stringify(providerUrl)} }
            ]
          }
        }, targetId);
      }
    `);

    const samples = {};
    const t0 = Date.now();
    const maxDurSec = mode === 'timeout90' ? 95 : 62;

    while (true) {
      const elapsedSec = Math.floor((Date.now() - t0) / 1000);
      if (elapsedSec > maxDurSec) break;

      const videoData = await getFrameVideoData();
      const phoneText = await getPhoneBannerText(winPhone);
      const resumeCtrl = await getResumeControllerState(winScreen);

      samples[elapsedSec] = {
        sec: elapsedSec,
        realTime: videoData ? videoData.currentTime : 0,
        readyState: videoData ? videoData.readyState : 0,
        seekCount: videoData ? videoData.seekCount : 0,
        phoneText: phoneText,
        resumeState: resumeCtrl,
      };

      if ([10, 20, 30, 40, 45, 50, 60, 90, 92].includes(elapsedSec) && !samples[`recorded_${elapsedSec}`]) {
        samples[`recorded_${elapsedSec}`] = true;
        console.log(`[probe-provider-resume @${elapsedSec}s] realTime=${videoData?.currentTime?.toFixed(1) || 0}s, readyState=${videoData?.readyState || 0}, seekCount=${videoData?.seekCount || 0}, phoneText="${phoneText}", ctrlState=${resumeCtrl?.status}`);
      }

      await wait(500);
    }

    const s10 = samples[10] || {};
    const s20 = samples[20] || {};
    const s30 = samples[30] || {};
    const s40 = samples[40] || {};
    const s45 = samples[45] || {};
    const s50 = samples[50] || {};
    const s60 = samples[60] || {};
    const s90 = samples[92] || samples[91] || samples[90] || {};

    const hasNoSeekBannerAt40 = (s40.phoneText || '').includes('no permite saltar') || (s40.phoneText || '').includes('No se pudo reanudar');
    const hasNoSeekBannerAt45 = (s45.phoneText || '').includes('no permite saltar') || (s45.phoneText || '').includes('No se pudo reanudar');
    const hasNoSeekBannerAt50 = (s50.phoneText || '').includes('no permite saltar') || (s50.phoneText || '').includes('No se pudo reanudar');
    const hasNoSeekBannerAt60 = (s60.phoneText || '').includes('no permite saltar') || (s60.phoneText || '').includes('No se pudo reanudar');

    console.log('\n================================================================================');
    console.log(`REPORTE PROBE-PROVIDER-RESUME (Modo: ${mode})`);
    console.log('================================================================================');
    console.log(`| Segundo | Estado ResumeController | Tiempo Real Video | Texto Mostrado Celular | Cartel de Error |`);
    console.log(`| :---: | :--- | :---: | :--- | :---: |`);
    console.log(`| 10 s | ${s10.resumeState?.status || 'esperando'} | ${s10.realTime?.toFixed(1) || 0} s | ${s10.phoneText || '-'} | NO |`);
    console.log(`| 20 s | ${s20.resumeState?.status || 'esperando'} | ${s20.realTime?.toFixed(1) || 0} s | ${s20.phoneText || '-'} | NO |`);
    console.log(`| 30 s | ${s30.resumeState?.status || 'fallo'} | ${s30.realTime?.toFixed(1) || 0} s | ${s30.phoneText || '-'} | ${(s30.phoneText || '').includes('no permite') ? 'SI' : 'NO'} |`);
    console.log(`| 40 s | ${s40.resumeState?.status || '-'} | ${s40.realTime?.toFixed(1) || 0} s | ${s40.phoneText || '-'} | ${hasNoSeekBannerAt40 ? 'SI' : 'NO'} |`);
    console.log(`| 45 s | ${s45.resumeState?.status || 'fallo'} | ${s45.realTime?.toFixed(1) || 0} s | ${s45.phoneText || '-'} | ${hasNoSeekBannerAt45 ? 'SI' : 'NO'} |`);
    console.log(`| 50 s | ${s50.resumeState?.status || 'fallo'} | ${s50.realTime?.toFixed(1) || 0} s | ${s50.phoneText || '-'} | ${hasNoSeekBannerAt50 ? 'SI' : 'NO'} |`);
    console.log(`| 60 s | ${s60.resumeState?.status || '-'} | ${s60.realTime?.toFixed(1) || 0} s | ${s60.phoneText || '-'} | ${hasNoSeekBannerAt60 ? 'SI' : 'NO'} |`);
    if (mode === 'timeout90') {
      console.log(`| 90 s | ${s90.resumeState?.status || '-'} | ${s90.realTime?.toFixed(1) || 0} s | ${s90.phoneText || '-'} | ${(s90.phoneText || '').includes('tardó') ? 'TIMEOUT' : 'NO'} |`);
    }
    console.log('================================================================================\n');

    clearTimeout(globalTimeout);
    if (testEnv) await testEnv.stop();
    app.exit(0);
  } catch (err) {
    console.error('[probe-provider-resume] Error:', err);
    clearTimeout(globalTimeout);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
