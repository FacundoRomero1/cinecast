#!/usr/bin/env node
/**
 * scripts/probe-gates-real.cjs
 * Verificación de Bloque 2-bis — Gates reales (sin simulador):
 *  - window.__CINECAST_TEST_SERVERS = undefined
 *  - Gate 2R: Sin tap, con embed (Breaking Bad S01E01 en MovieMaster + Los Simpsons T37:E4 con fallback obligatorio)
 *  - Gate 3R: Fallo forzado sobre proveedor real con CDP Network.setBlockedURLs a mitad de capítulo (<= 25 s para otro servidor con currentTime > 0.5)
 *  - Gate 4R: Selección manual de capítulo que el proveedor no tiene -> sale solo en < 10 s sin "Reintentar" colgado
 */

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents, session } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-site-isolation-trials');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms = 1500, fallback = null) =>
  Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

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

app.whenReady().then(async () => {
  let testEnv = null;
  try {
    testEnv = await startTestEnv('probe-gates-real');
    const { base: baseUrl, room: activeRoomId, port } = testEnv;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

    let screenWin = null;
    const realProviderRequests = [];

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: '127.0.0.1', port }));
    safeHandle('get-diagnostic-mode', () => false);
    safeHandle('set-diagnostic-mode', () => false);
    safeHandle('get-no-cors-fix', () => false);
    safeHandle('check-embed-providers', () => []);
    safeHandle('focus-window', () => true);
    safeHandle('get-detected-tracks', () => null);
    safeHandle('set-master-volume', () => ({ ok: true }));
    safeHandle('simulate-play-click', () => true);
    safeHandle('set-player-servers', () => true);
    safeHandle('start-load-trace', () => ({ ok: true }));
    safeHandle('record-load-trace-event', () => ({ ok: true }));
    safeHandle('end-load-trace', () => true);
    safeHandle('stop-ghost-extraction', () => true);
    safeHandle('set-stream-headers', () => true);

    safeHandle('get-real-media-state', async () => {
      const frames = getAllFrames();
      let best = null;
      for (const frame of frames) {
        try {
          const res = await withTimeout(frame.executeJavaScript(`(() => {
            const els = Array.from(document.querySelectorAll('video, audio'));
            for (const el of els) {
              const dur = Number.isFinite(el.duration) ? el.duration : 0;
              const cur = Number.isFinite(el.currentTime) ? el.currentTime : 0;
              if (dur > 0 || cur > 0 || !el.paused || el.readyState >= 2) {
                return {
                  found: true,
                  currentTime: cur,
                  duration: dur,
                  readyState: el.readyState || 0,
                  currentSrc: el.currentSrc || el.src || '',
                  frameUrl: location.href || '',
                  ended: Boolean(el.ended || (dur > 0 && cur >= dur - 0.15)),
                  isPlaying: !el.paused && !el.ended,
                  title: document.title || ''
                };
              }
            }
            return null;
          })()`), 900, null);
          if (res && res.found) {
            if (!best || res.isPlaying || res.currentTime > best.currentTime) {
              best = res;
            }
          }
        } catch (_) {}
      }
      return best;
    });

    safeHandle('get-embed-status', async () => {
      if (!screenWin || screenWin.isDestroyed()) return null;
      try {
        const root = screenWin.webContents.mainFrame;
        const frames = root.framesInSubtree.filter((f) => f !== root);
        if (!frames.length) return { ok: false, reason: 'no-frame' };

        let contentUnavailable = false;
        let cf = false;
        let mainTitle = '';
        const lastFrame = frames[frames.length - 1];

        for (const frame of frames) {
          try {
            const frameTitle = await withTimeout(frame.executeJavaScript('document.title || ""', false), 700, '');
            const frameText = await withTimeout(frame.executeJavaScript('document.body ? (document.body.innerText || "").slice(0, 2000) : ""', false), 700, '');
            const lower = `${frameTitle} ${frameText}`.toLowerCase();
            if (
              lower.includes('aún no está disponible') ||
              lower.includes('aun no esta disponible') ||
              lower.includes('no está disponible') ||
              lower.includes('no esta disponible') ||
              lower.includes('aún no hay opciones') ||
              lower.includes('aun no hay opciones') ||
              lower.includes('no hay opciones para este título') ||
              lower.includes('no hay opciones para este titulo') ||
              lower.includes('contenido no disponible') ||
              lower.includes('no disponible') ||
              lower.includes('video not found') ||
              lower.includes('file not found') ||
              lower.includes('stream not found') ||
              lower.includes('media is not available') ||
              lower.includes('no source available') ||
              lower.includes('404 not found')
            ) {
              contentUnavailable = true;
            }
            if (/just a moment|attention required|checking your browser|verify|cloudflare/i.test(frameTitle)) {
              cf = true;
            }
            if (frameTitle && !mainTitle) mainTitle = frameTitle;
          } catch (_) {}
        }

        let currentTime = null;
        let duration = null;
        let readyState = 0;
        let currentSrc = '';
        for (const frame of root.framesInSubtree) {
          try {
            const mediaInfo = await withTimeout(frame.executeJavaScript(`(() => {
              const vids = Array.from(document.querySelectorAll('video'));
              for (const v of vids) {
                if (v.readyState >= 2 || v.currentTime > 0 || (!isNaN(v.duration) && v.duration > 0)) {
                  return {
                    currentTime: Number(v.currentTime.toFixed(2)),
                    duration: Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
                    readyState: v.readyState || 0,
                    currentSrc: v.currentSrc || v.src || ''
                  };
                }
              }
              return null;
            })()`, false), 700, null);
            if (mediaInfo) {
              currentTime = mediaInfo.currentTime;
              duration = mediaInfo.duration;
              readyState = mediaInfo.readyState;
              currentSrc = mediaInfo.currentSrc;
              break;
            }
          } catch (_) {}
        }

        return { ok: true, title: mainTitle, cloudflare: cf, contentUnavailable, src: lastFrame.url, currentTime, duration, readyState, currentSrc };
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    });

    safeHandle('control-active-media', async (_event, { action }) => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await withTimeout(frame.executeJavaScript(`(async () => {
            const action = ${JSON.stringify(action)};
            if (action === 'autoCommitPlay') {
              if (location.href.startsWith('http://localhost') || location.href.startsWith('http://127.0.0.1') || location.href === 'about:blank') {
                return { acted: false };
              }
              const bodyTxt = (document.body ? (document.body.innerText || '') : '').toLowerCase();
              if (
                bodyTxt.includes('aún no está disponible') ||
                bodyTxt.includes('aun no esta disponible') ||
                bodyTxt.includes('no está disponible') ||
                bodyTxt.includes('no esta disponible') ||
                bodyTxt.includes('aún no hay opciones') ||
                bodyTxt.includes('aun no hay opciones') ||
                bodyTxt.includes('no hay opciones para este título') ||
                bodyTxt.includes('no hay opciones para este titulo') ||
                bodyTxt.includes('contenido no disponible')
              ) {
                return { acted: false, unavailable: true };
              }
              if (location.hostname.includes('moviemaster.lat')) {
                if (bodyTxt.includes('cargando') || bodyTxt.includes('anuncio') || bodyTxt.includes('saltar en')) {
                  window.__cinecastAutoCommitted = true;
                  return { acted: true, alreadyCommitted: true };
                }
                const serversReady =
                  bodyTxt.includes('disponible en') ||
                  bodyTxt.includes('opción 1') ||
                  bodyTxt.includes('opcion 1');
                if (!serversReady) {
                  return { acted: false, pending: true };
                }
              }
              if (window.__cinecastAutoCommitted) {
                return { acted: true, alreadyCommitted: true };
              }
              const goBtn = document.getElementById('go') ||
                Array.from(document.querySelectorAll('button, [role="button"], .jw-icon-display, .plyr__control--overlaid, .vjs-big-play-button, .play-button, #play')).find((el) => {
                  const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
                  return (t === 'reproducir' || t.startsWith('reproducir') || t === 'play' || el.id === 'go') && !el.disabled && el.offsetParent !== null;
                });
              if (goBtn && !goBtn.disabled && goBtn.offsetParent !== null) {
                goBtn.click();
                const afterTxt = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                const transitioned = !location.hostname.includes('moviemaster.lat') || afterTxt.includes('cargando') || afterTxt.includes('anuncio') || goBtn.offsetParent === null;
                if (transitioned) {
                  window.__cinecastAutoCommitted = true;
                  return { acted: true, hasMedia: true, isPlaying: true, currentTime: 0 };
                }
                return { acted: false, pending: true };
              }
            }
            return { acted: false };
          })()`), 900, { acted: false });
          if (res && (res.acted || res.unavailable)) return res;
        } catch (_) {}
      }
      return { acted: false };
    });

    const partName = 'persist:probe-real-gates-' + Date.now();
    const ses = session.fromPartition(partName);
    const videoSes = session.fromPartition('persist:videosession');

    const recordCompletedReq = (details) => {
      const u = details.url || '';
      if (
        !u.startsWith('http://127.0.0.1') &&
        !u.startsWith('http://localhost') &&
        !u.startsWith('data:') &&
        (details.resourceType === 'subFrame' || details.resourceType === 'mainFrame' || details.resourceType === 'media' || u.includes('.m3u8') || u.includes('moviemaster.lat/e/'))
      ) {
        let host = '';
        try { host = new URL(u).hostname; } catch (_) {}
        const entry = { url: u, host, status: details.statusCode, time: Date.now() };
        realProviderRequests.push(entry);
        if (screenWin && !screenWin.isDestroyed()) {
          screenWin.webContents.executeJavaScript(`
            window.__req = window.__req || [];
            window.__req.push(${JSON.stringify(entry)});
          `).catch(() => {});
        }
      }
    };
    ses.webRequest.onCompleted(recordCompletedReq);
    videoSes.webRequest.onCompleted(recordCompletedReq);

    ses.webRequest.onErrorOccurred((details) => {
      if (!details || !details.url || !screenWin || screenWin.isDestroyed()) return;
      const err = String(details.error || '');
      if (
        err === 'net::ERR_BLOCKED_BY_CLIENT' ||
        err === 'net::ERR_CONNECTION_REFUSED' ||
        err === 'net::ERR_NAME_NOT_RESOLVED'
      ) {
        if (details.url.startsWith('http://127.0.0.1') || details.url.startsWith('http://localhost')) return;
        screenWin.webContents.send('embed-failed', {
          code: -20,
          desc: err,
          url: details.url,
        });
      }
    });

    screenWin = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        partition: partName,
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    screenWin.webContents.on('console-message', (ev, level, msg) => {
      const text = typeof msg === 'string' ? msg : (ev && typeof ev.message === 'string' ? ev.message : '');
      const lvl = typeof level === 'number' ? level : (ev && typeof ev.level === 'number' ? ev.level : 0);
      if (
        lvl >= 2 ||
        text.includes('[AD]') ||
        text.includes('[P2.5') ||
        text.includes('[WATCHDOG]') ||
        text.includes('[AutoAdvance]') ||
        text.includes('[PENALIZACIÓN]') ||
        text.includes('[Embed]') ||
        text.includes('[Direct HLS]') ||
        text.includes('[VideoPlayer]')
      ) {
        console.log('[screen]', text);
      }
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`);
    await wait(2500);

    // Asegurar explícitamente que NO hay simulador activo
    const testServersVal = await screenWin.webContents.executeJavaScript(`(() => {
      delete window.__CINECAST_TEST;
      window.__CINECAST_TEST_SERVERS = undefined;
      window.__req = [];
      return window.__CINECAST_TEST_SERVERS;
    })()`);
    const buildMarker = await screenWin.webContents.executeJavaScript('window.__cinecastBuild');
    console.log(`[BUILD_MARKER] window.__cinecastBuild = "${buildMarker}"`);
    console.log(`window.__CINECAST_TEST_SERVERS = ${testServersVal}`);

    const getPlayerSnapshot = async () => {
      const ui = await screenWin.webContents.executeJavaScript(`(() => {
        const vp = window.__videoPlayerState || {};
        const h2 = document.querySelector('h2');
        const iframe = document.querySelector('iframe[data-embed]');
        const video = document.querySelector('video');
        const bodyText = document.body ? document.body.innerText : '';
        return {
          title: h2 ? h2.textContent.trim() : '',
          activeServerName: vp.activeServerName || '',
          activeServerUrl: vp.activeServerUrl || '',
          selectedSeason: vp.selectedSeason,
          selectedEpisode: vp.selectedEpisode,
          iframeSrc: iframe ? iframe.src : '',
          directVideoReady: video ? video.readyState : -1,
          directVideoTime: video ? Number(video.currentTime.toFixed(2)) : -1,
          directVideoSrc: video ? (video.currentSrc || video.src || '') : '',
          hasRetryHang: bodyText.includes('Ningún servidor respondió'),
          reqs: Array.isArray(window.__req) ? window.__req.slice(-5) : []
        };
      })()`);

      let embedReady = -1;
      let embedTime = -1;
      let embedSrc = '';
      let embedHost = '';
      let embedHasRetryBtn = false;
      const frames = getAllFrames();
      for (const f of frames) {
        if (f === screenWin.webContents.mainFrame) continue;
        try {
          const fInfo = await withTimeout(f.executeJavaScript(`(() => {
            if (location.href.startsWith('http://127.0.0.1') || location.href.startsWith('http://localhost') || location.href === 'about:blank') return null;
            const vids = Array.from(document.querySelectorAll('video'));
            let bestV = null;
            for (const v of vids) {
              if (!bestV || v.readyState > bestV.readyState || v.currentTime > bestV.currentTime) {
                bestV = v;
              }
            }
            const txt = (document.body ? document.body.innerText : '') || '';
            const sr = document.getElementById('sr');
            const retryVisible = Boolean(sr && sr.offsetParent !== null) || txt.includes('Aún no está disponible');
            return {
              url: location.href,
              host: location.hostname,
              readyState: bestV ? bestV.readyState : -1,
              currentTime: bestV ? Number(bestV.currentTime.toFixed(2)) : -1,
              currentSrc: bestV ? (bestV.currentSrc || bestV.src || '') : '',
              retryVisible
            };
          })()`), 700, null);
          if (fInfo && fInfo.host) {
            if (fInfo.readyState > embedReady || !embedHost) {
              embedReady = fInfo.readyState;
              embedTime = fInfo.currentTime;
              embedSrc = fInfo.currentSrc || fInfo.url;
              embedHost = fInfo.host;
            }
            if (fInfo.retryVisible) embedHasRetryBtn = true;
          }
        } catch (_) {}
      }

      const effectiveReady = ui.directVideoReady >= 2 ? ui.directVideoReady : embedReady;
      const effectiveTime = ui.directVideoReady >= 2 ? ui.directVideoTime : embedTime;
      const effectiveSrc = ui.directVideoReady >= 2 ? ui.directVideoSrc : embedSrc;
      let providerHost = embedHost;
      if (!providerHost && effectiveSrc) {
        try { providerHost = new URL(effectiveSrc).hostname; } catch (_) {}
      }
      if (!providerHost && ui.activeServerUrl) {
        try { providerHost = new URL(ui.activeServerUrl).hostname; } catch (_) {}
      }

      return {
        ...ui,
        effectiveReady,
        effectiveTime,
        effectiveSrc,
        providerHost,
        embedHasRetryBtn,
      };
    };

    const isRealProviderStream = (snap) => {
      if (!snap || !snap.effectiveSrc) return false;
      if (snap.effectiveSrc.includes('/__test/') || (snap.activeServerUrl && snap.activeServerUrl.includes('/__test/'))) {
        return false;
      }
      if (snap.effectiveSrc.startsWith('blob:http://127.0.0.1') || snap.effectiveSrc.startsWith('blob:http://localhost')) {
        return Boolean(
          snap.activeServerUrl &&
          snap.activeServerUrl.startsWith('https://') &&
          !snap.activeServerUrl.includes('127.0.0.1') &&
          !snap.activeServerUrl.includes('localhost')
        );
      }
      return !snap.effectiveSrc.includes('127.0.0.1') && !snap.effectiveSrc.includes('localhost');
    };

    const formatDisplaySrc = (snap) => {
      if (!snap) return '';
      const raw = snap.effectiveSrc || snap.activeServerUrl || '';
      if ((raw.startsWith('blob:http://127.0.0.1') || raw.startsWith('blob:http://localhost')) && snap.activeServerUrl) {
        return `${snap.activeServerUrl.slice(0, 65)} (MSE blob)`;
      }
      return raw.slice(0, 85);
    };

    const sendPlayCommandReliable = async (payload) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await fetch(`${baseUrl}/api/sync/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: activeRoomId,
            command: {
              action: 'playDiscoveredMovie',
              payload,
            },
          }),
        });
        await wait(900);
        const snap = await getPlayerSnapshot();
        if (snap && snap.selectedSeason === payload.season && snap.selectedEpisode === payload.episode && snap.activeServerName) {
          return;
        }
      }
    };

    const gateResults = [];

    // =========================================================================
    // GATE 2R — Caso 1: Breaking Bad S01E01 (MovieMaster disponible, sin tap)
    // =========================================================================
    console.log('\n--- Gate 2R (Caso 1): Breaking Bad S01E01 (MovieMaster disponible, sin tap) ---');
    const t2R1Start = Date.now();
    await sendPlayCommandReliable({
      id: 'tmdb-series-1396',
      tmdbId: 1396,
      title: 'Breaking Bad',
      type: 'series',
      category: 'series',
      season: 1,
      episode: 1,
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: 'Piloto',
    });

    let snap2R1 = null;
    let pass2R1 = false;
    let elapsed2R1 = 0;
    while (Date.now() - t2R1Start < 20000) {
      await wait(800);
      snap2R1 = await getPlayerSnapshot();
      const isRealSrc = isRealProviderStream(snap2R1);
      if (snap2R1.effectiveReady >= 2 && snap2R1.effectiveTime > 0.5 && isRealSrc) {
        pass2R1 = true;
        elapsed2R1 = Number(((Date.now() - t2R1Start) / 1000).toFixed(1));
        break;
      }
    }
    if (!elapsed2R1) elapsed2R1 = Number(((Date.now() - t2R1Start) / 1000).toFixed(1));
    const lastReq2R1 = snap2R1?.reqs?.[snap2R1.reqs.length - 1];
    gateResults.push({
      gate: 'Gate 2R-1 (Breaking Bad S01E01 sin tap)',
      servidorActivo: snap2R1?.activeServerName || 'N/A',
      hostReq: lastReq2R1 ? `${lastReq2R1.host} (${lastReq2R1.status})` : (snap2R1?.providerHost || 'N/A'),
      readyState: snap2R1?.effectiveReady ?? -1,
      currentTime: `${snap2R1?.effectiveTime ?? 0}s`,
      elapsed: `${elapsed2R1}s (<=20s)`,
      currentSrc: formatDisplaySrc(snap2R1),
      resultado: pass2R1 ? 'PASA' : 'FALLA',
    });

    // =========================================================================
    // GATE 3R — Fallo forzado con CDP a mitad de capítulo sobre proveedor real
    // =========================================================================
    console.log('\n--- Gate 3R: Bloqueo CDP del host del proveedor activo a mitad de capítulo ---');
    const initialHost3R = snap2R1?.providerHost || 'api.moviemaster.lat';
    const initialServer3R = snap2R1?.activeServerName || 'MovieMaster (Latino)';
    const t3RStart = Date.now();

    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      try {
        if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Network.enable');
        await wc.debugger.sendCommand('Network.setBlockedURLs', {
          urls: [
            '*://*.moviemaster.lat/*',
            '*://moviemaster.lat/*',
            '*://*.quickcore.fun/*',
            '*://*.latgw.fun/*',
          ],
        });
      } catch (_) {}
    }
    // También bloquear en la sesión de Electron para que webRequest.onErrorOccurred emita ERR_BLOCKED_BY_CLIENT
    let blockMovieMasterInGate3R = true;
    ses.webRequest.onBeforeRequest({ urls: ['*://*.moviemaster.lat/*', '*://moviemaster.lat/*', '*://*.quickcore.fun/*'] }, (details, cb) => {
      if (blockMovieMasterInGate3R) {
        cb({ cancel: true });
      } else {
        cb({ cancel: false });
      }
    });
    // Forzar una petición en el frame de MovieMaster para que dispare ERR_BLOCKED_BY_CLIENT de inmediato
    for (const f of getAllFrames()) {
      if (f.url && f.url.includes('moviemaster.lat')) {
        f.executeJavaScript(`fetch('https://api.moviemaster.lat/ev').catch(() => {})`).catch(() => {});
      }
    }

    let snap3R = null;
    let pass3R = false;
    let elapsed3R = 0;
    while (Date.now() - t3RStart < 25000) {
      await wait(800);
      snap3R = await getPlayerSnapshot();
      const switchedServer = snap3R.activeServerName && snap3R.activeServerName !== initialServer3R;
      const isRealSrc = isRealProviderStream(snap3R);
      if (switchedServer && snap3R.effectiveReady >= 2 && snap3R.effectiveTime > 0.5 && isRealSrc) {
        pass3R = true;
        elapsed3R = Number(((Date.now() - t3RStart) / 1000).toFixed(1));
        break;
      }
    }
    if (!elapsed3R) elapsed3R = Number(((Date.now() - t3RStart) / 1000).toFixed(1));

    // Levantar bloqueo CDP de MovieMaster para las pruebas de Los Simpsons (Gate 2R-2 y Gate 4R)
    blockMovieMasterInGate3R = false;
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      try {
        if (wc.debugger.isAttached()) {
          await wc.debugger.sendCommand('Network.setBlockedURLs', { urls: [] });
        }
      } catch (_) {}
    }

    const lastReq3R = snap3R?.reqs?.[snap3R.reqs.length - 1];
    gateResults.push({
      gate: `Gate 3R (CDP block ${initialHost3R} -> fallback)`,
      servidorActivo: `${initialServer3R} -> ${snap3R?.activeServerName || 'N/A'}`,
      hostReq: lastReq3R ? `${lastReq3R.host} (${lastReq3R.status})` : (snap3R?.providerHost || 'N/A'),
      readyState: snap3R?.effectiveReady ?? -1,
      currentTime: `${snap3R?.effectiveTime ?? 0}s`,
      elapsed: `${elapsed3R}s (<=25s)`,
      currentSrc: formatDisplaySrc(snap3R),
      resultado: pass3R ? 'PASA' : 'FALLA',
    });

    // =========================================================================
    // GATE 2R — Caso 2: Los Simpsons T37:E4 (falta en MovieMaster -> fallback obligatorio)
    // =========================================================================
    console.log('\n--- Gate 2R (Caso 2): Los Simpsons T37:E4 (falta en MovieMaster -> fallback obligatorio) ---');
    const t2R2Start = Date.now();
    await sendPlayCommandReliable({
      id: 'tmdb-series-456',
      tmdbId: 456,
      title: 'Los Simpson',
      type: 'series',
      category: 'series',
      seasonsCount: 37,
      season: 37,
      episode: 4,
      seasonNumber: 37,
      episodeNumber: 4,
      episodeTitle: 'Episodio 4',
    });

    let snap2R2 = null;
    let pass2R2 = false;
    let elapsed2R2 = 0;
    while (Date.now() - t2R2Start < 20000) {
      await wait(800);
      snap2R2 = await getPlayerSnapshot();
      const isFallbackServer =
        snap2R2.activeServerName &&
        !snap2R2.activeServerName.toLowerCase().includes('moviemaster');
      const isRealSrc = isRealProviderStream(snap2R2);
      if (isFallbackServer && snap2R2.effectiveReady >= 2 && snap2R2.effectiveTime > 0.5 && isRealSrc) {
        pass2R2 = true;
        elapsed2R2 = Number(((Date.now() - t2R2Start) / 1000).toFixed(1));
        break;
      }
    }
    if (!elapsed2R2) elapsed2R2 = Number(((Date.now() - t2R2Start) / 1000).toFixed(1));
    const lastReq2R2 = snap2R2?.reqs?.[snap2R2.reqs.length - 1];
    gateResults.push({
      gate: 'Gate 2R-2 (Simpsons T37:E4 fallback obligatorio)',
      servidorActivo: snap2R2?.activeServerName || 'N/A',
      hostReq: lastReq2R2 ? `${lastReq2R2.host} (${lastReq2R2.status})` : (snap2R2?.providerHost || 'N/A'),
      readyState: snap2R2?.effectiveReady ?? -1,
      currentTime: `${snap2R2?.effectiveTime ?? 0}s`,
      elapsed: `${elapsed2R2}s (<=20s)`,
      currentSrc: formatDisplaySrc(snap2R2),
      resultado: pass2R2 ? 'PASA' : 'FALLA',
    });

    // =========================================================================
    // GATE 4R — Elegir a mano un capítulo que el proveedor no tiene (Captura 3: T37:E4 desde el selector) -> sale solo en < 10 s sin "Reintentar" colgado
    // =========================================================================
    console.log('\n--- Gate 4R: Selección manual en selector de capítulo inexistente en MovieMaster (T37:E4) ---');
    // Primero pasar a E5 (que sí existe en MovieMaster) y luego seleccionar manualmente E4 en el dropdown
    await screenWin.webContents.executeJavaScript(`(() => {
      const epSelect = document.querySelector('select[data-testid="episode-select"]');
      if (epSelect) {
        epSelect.value = '5';
        epSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await wait(1500);

    const t4RStart = Date.now();
    await screenWin.webContents.executeJavaScript(`(() => {
      const epSelect = document.querySelector('select[data-testid="episode-select"]');
      if (epSelect) {
        epSelect.value = '4';
        epSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);

    let snap4R = null;
    let pass4R = false;
    let elapsed4R = 0;
    while (Date.now() - t4RStart < 10000) {
      await wait(600);
      snap4R = await getPlayerSnapshot();
      const leftMovieMaster =
        snap4R.selectedEpisode === 4 &&
        snap4R.activeServerName &&
        !snap4R.activeServerName.toLowerCase().includes('moviemaster') &&
        !snap4R.embedHasRetryBtn &&
        !snap4R.hasRetryHang;
      if (leftMovieMaster) {
        pass4R = true;
        elapsed4R = Number(((Date.now() - t4RStart) / 1000).toFixed(1));
        break;
      }
    }
    if (!elapsed4R) elapsed4R = Number(((Date.now() - t4RStart) / 1000).toFixed(1));
    const lastReq4R = snap4R?.reqs?.[snap4R.reqs.length - 1];
    gateResults.push({
      gate: 'Gate 4R (Selección manual T37:E4 sale <10s sin Reintentar)',
      servidorActivo: snap4R?.activeServerName || 'N/A',
      hostReq: lastReq4R ? `${lastReq4R.host} (${lastReq4R.status})` : (snap4R?.providerHost || 'N/A'),
      readyState: snap4R?.effectiveReady ?? -1,
      currentTime: `${snap4R?.effectiveTime ?? 0}s`,
      elapsed: `${elapsed4R}s (<10s)`,
      currentSrc: (snap4R?.effectiveSrc || snap4R?.activeServerUrl || '').slice(0, 85),
      resultado: pass4R ? 'PASA' : 'FALLA',
    });

    console.log('\n=== RESULTADOS GATES REALES (2R, 3R, 4R) ===');
    console.log('| Gate | Servidor Final | Host en window.__req | readyState | currentTime | Tiempo | currentSrc | Resultado |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of gateResults) {
      console.log(`| ${r.gate} | ${r.servidorActivo} | ${r.hostReq} | ${r.readyState} | ${r.currentTime} | ${r.elapsed} | ${r.currentSrc} | **${r.resultado}** |`);
    }

    const allPass = gateResults.every((r) => r.resultado === 'PASA');
    console.log(`\nRESULTADO GLOBAL GATES REALES: ${allPass ? 'PASA' : 'FALLA'}`);
    await testEnv.stop();
    app.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-gates-real] Error fatal:', err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
