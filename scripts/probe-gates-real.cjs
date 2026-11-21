#!/usr/bin/env node
/**
 * scripts/probe-gates-real.cjs
 * Verificación aislada de Gates Reales (sin simulador):
 *  - Cada gate (2R1, 3R, 2R2, 4R) corre en un PROCESO ELECTRON NUEVO con testEnv y partición limpios (arranque en frío).
 *  - window.__CINECAST_TEST_SERVERS = undefined
 *  - Gate 2R-1: Breaking Bad S01E01 sin tap -> contenido real duration > 300s (techo 35 s, baseline 27.7 s)
 *  - Gate 3R: Fallo forzado CDP (Network.setBlockedURLs) a mitad de capítulo -> otro servidor real con duration > 300s (<= 25 s)
 *  - Gate 2R-2: Los Simpsons T37:E4 en frío -> fallback obligatorio con duration > 300s (<= 20 s)
 *  - Gate 4R: Selección manual T37:E4 en frío (sin caché previa de 456/37/4) -> frame real duration > 300s (<= 15 s)
 */

const gateArg = process.argv.find((a) => a.startsWith('--gate='));
const singleGate = gateArg ? gateArg.split('=')[1].toUpperCase() : null;

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (singleGate) {
    const res = spawnSync(electronPath, [__filename, `--gate=${singleGate}`], { stdio: 'inherit', env });
    process.exit(res.status ?? 1);
  }

  // Orquestador: lanza cada gate en un proceso Electron completamente aislado (sin caché ni penalizaciones compartidas)
  const gates = ['2R1', '3R', '2R2', '4R'];
  const results = [];
  const allAdLogs = [];
  let buildMarker = '';
  let testServersStr = '';

  for (const g of gates) {
    console.log(`\n==================== PROCESO AISLADO: GATE ${g} ====================`);
    const res = spawnSync(electronPath, [__filename, `--gate=${g}`], {
      encoding: 'utf8',
      env,
      maxBuffer: 20 * 1024 * 1024,
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('GATE_JSON:')) {
        try {
          const parsed = JSON.parse(line.slice('GATE_JSON:'.length));
          if (parsed.result) results.push(parsed.result);
          if (Array.isArray(parsed.adLogs)) allAdLogs.push(...parsed.adLogs);
          if (parsed.buildMarker) buildMarker = parsed.buildMarker;
          if (parsed.testServersVal !== undefined) testServersStr = String(parsed.testServersVal);
        } catch (_) {}
      } else if (
        line.includes('[BUILD_MARKER]') ||
        line.includes('window.__CINECAST_TEST_SERVERS') ||
        line.includes('[Gate ') ||
        line.includes('[AD]') ||
        line.includes('[P2.5') ||
        line.includes('[AutoAdvance]') ||
        line.includes('[PENALIZACIÓN]') ||
        line.includes('[Embed]') ||
        line.includes('[Direct HLS]') ||
        line.includes('HLS éxito') ||
        line.includes('[DUR]')
      ) {
        console.log(line);
      }
    }
  }

  console.log(`\n[BUILD_MARKER] window.__cinecastBuild = "${buildMarker}"`);
  console.log(`window.__CINECAST_TEST_SERVERS = ${testServersStr || 'undefined'}`);
  console.log('\n=== RESULTADOS GATES REALES AISLADOS EN FRÍO (2R, 3R, 4R) ===');
  console.log('| Gate | Servidor Final | Host en window.__req | readyState | currentTime | duration | Tiempo | currentSrc | Resultado |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.gate} | ${r.servidorActivo} | ${r.hostReq} | ${r.readyState} | ${r.currentTime} | ${r.duration} | ${r.elapsed} | ${r.currentSrc} | **${r.resultado}** |`);
  }
  console.log('\n=== LOGS [AD] MEDIDOS (P2.12) ===');
  for (const l of allAdLogs) console.log(l);

  const allPass = results.length === gates.length && results.every((r) => r.resultado === 'PASA');
  console.log(`\nRESULTADO GLOBAL GATES REALES AISLADOS: ${allPass ? 'PASA' : 'FALLA'}`);
  process.exit(allPass ? 0 : 1);
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
    const gateName = singleGate || '2R1';
    testEnv = await startTestEnv(`probe-gate-${gateName.toLowerCase()}`);
    const { base: baseUrl, room: activeRoomId, port } = testEnv;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

    let screenWin = null;
    const adMountLogs = [];

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
            if (!best || res.duration > best.duration || (res.duration === best.duration && res.currentTime > best.currentTime)) {
              best = res;
            }
          }
        } catch (_) {}
      }
      return best;
    });

    const readEmbedStatus = async () => {
      if (!screenWin || screenWin.isDestroyed()) return null;
      try {
        const allFrames = getAllFrames();
        const root = screenWin.webContents.mainFrame;
        const frames = allFrames.filter((f) => f !== root);
        if (!allFrames.length) return { ok: false, reason: 'no-frame' };

        let contentUnavailable = false;
        let cf = false;
        let mainTitle = '';
        let embedHasRetryBtn = false;
        const lastFrame = frames.length ? frames[frames.length - 1] : root;

        for (const frame of frames) {
          try {
            const frameInfo = await withTimeout(frame.executeJavaScript(`(() => {
              const title = document.title || '';
              const text = document.body ? (document.body.innerText || '').slice(0, 2000) : '';
              const sr = document.getElementById('sr');
              const retryVisible = Boolean(sr && sr.offsetParent !== null) || text.includes('Aún no está disponible');
              return { title, text, retryVisible };
            })()`, false), 700, null);
            if (!frameInfo) continue;
            const lower = `${frameInfo.title} ${frameInfo.text}`.toLowerCase();
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
            if (/just a moment|attention required|checking your browser|verify|cloudflare/i.test(frameInfo.title)) {
              cf = true;
            }
            if (frameInfo.retryVisible) embedHasRetryBtn = true;
            if (frameInfo.title && !mainTitle) mainTitle = frameInfo.title;
          } catch (_) {}
        }

        let bestVideo = null;
        for (const frame of allFrames) {
          try {
            const mediaInfo = await withTimeout(frame.executeJavaScript(`(() => {
              const vids = Array.from(document.querySelectorAll('video'));
              let best = null;
              for (const v of vids) {
                const dur = Number.isFinite(v.duration) ? Math.round(v.duration) : 0;
                const cur = Number.isFinite(v.currentTime) ? Number(v.currentTime.toFixed(2)) : 0;
                const rs = v.readyState || 0;
                const src = v.currentSrc || v.src || '';
                if (rs >= 2 || cur > 0 || dur > 0 || src) {
                  if (
                    !best ||
                    (dur > 300 && best.duration <= 300) ||
                    (dur > best.duration) ||
                    (dur === best.duration && rs > best.readyState) ||
                    (dur === best.duration && rs === best.readyState && cur > best.currentTime)
                  ) {
                    best = { currentTime: cur, duration: dur, readyState: rs, currentSrc: src, frameUrl: location.href || '', host: location.hostname || '' };
                  }
                }
              }
              return best;
            })()`, false), 700, null);
            if (mediaInfo) {
              if (
                !bestVideo ||
                (mediaInfo.duration > 300 && bestVideo.duration <= 300) ||
                (mediaInfo.duration > bestVideo.duration) ||
                (mediaInfo.duration === bestVideo.duration && mediaInfo.readyState > bestVideo.readyState) ||
                (mediaInfo.duration === bestVideo.duration && mediaInfo.readyState === bestVideo.readyState && mediaInfo.currentTime > bestVideo.currentTime)
              ) {
                bestVideo = mediaInfo;
              }
            }
          } catch (_) {}
        }

        return {
          ok: true,
          title: mainTitle,
          cloudflare: cf,
          contentUnavailable,
          embedHasRetryBtn,
          src: lastFrame.url,
          currentTime: bestVideo ? bestVideo.currentTime : -1,
          duration: bestVideo ? bestVideo.duration : -1,
          readyState: bestVideo ? bestVideo.readyState : -1,
          currentSrc: bestVideo ? bestVideo.currentSrc : '',
          videoFrameUrl: bestVideo ? bestVideo.frameUrl : '',
          videoHost: bestVideo ? bestVideo.host : '',
        };
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    };

    safeHandle('get-embed-status', readEmbedStatus);

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
                if (!serversReady) return { acted: false, pending: true };
              }
              if (window.__cinecastAutoCommitted) return { acted: true, alreadyCommitted: true };
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
            if (action === 'autoSkipEmbedAd') {
              if (location.href.startsWith('http://localhost') || location.href.startsWith('http://127.0.0.1') || location.href === 'about:blank') {
                return { skipped: false };
              }
              if (window.__cinecastAdSkipped) {
                return { skipped: true, alreadySkipped: true };
              }
              const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span')).filter((el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const rect = el.getBoundingClientRect();
                if (rect.width < 20 || rect.height < 14 || rect.width > 420 || rect.height > 120) return false;
                const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
                if (!t || t.length > 40) return false;
                return t.includes('saltar') || t.includes('skip') || t.includes('omitir');
              });
              const leafCandidates = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
              const target = leafCandidates[0] || candidates[0];
              if (!target) return { skipped: false, notFound: true };
              const txt = (target.innerText || target.textContent || '').trim().toLowerCase();
              if (target.disabled || /en\\s+\\d+|in\\s+\\d+/.test(txt)) {
                return { skipped: false, countdown: true, text: txt };
              }
              window.__cinecastAdSkipped = true;
              target.click();
              return { skipped: true, text: txt };
            }
            return { acted: false };
          })()`), 900, { acted: false });
          if (res && (res.acted || res.unavailable || res.skipped || res.countdown)) return res;
        } catch (_) {}
      }
      return { acted: false };
    });

    const partName = `persist:probe-isolated-${gateName}-${Date.now()}`;
    const ses = session.fromPartition(partName);
    const videoSes = session.fromPartition(`persist:videosession`);

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
      if (err === 'net::ERR_BLOCKED_BY_CLIENT' || err === 'net::ERR_CONNECTION_REFUSED' || err === 'net::ERR_NAME_NOT_RESOLVED') {
        if (details.url.startsWith('http://127.0.0.1') || details.url.startsWith('http://localhost')) return;
        screenWin.webContents.send('embed-failed', { code: -20, desc: err, url: details.url });
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
      if (text.includes('[AD] iframe montado en')) adMountLogs.push(text);
      if (
        lvl >= 2 ||
        text.includes('[AD]') ||
        text.includes('[P2.5') ||
        text.includes('[WATCHDOG]') ||
        text.includes('[AutoAdvance]') ||
        text.includes('[PENALIZACIÓN]') ||
        text.includes('[Embed]') ||
        text.includes('[Direct HLS]') ||
        text.includes('[VideoPlayer]') ||
        text.includes('[DUR]')
      ) {
        console.log('[screen]', text);
      }
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`);
    await wait(2500);

    const testServersVal = await screenWin.webContents.executeJavaScript(`(() => {
      delete window.__CINECAST_TEST;
      window.__CINECAST_TEST_SERVERS = undefined;
      window.__req = [];
      return window.__CINECAST_TEST_SERVERS;
    })()`);
    const buildMarker = await screenWin.webContents.executeJavaScript('window.__cinecastBuild');

    const getPlayerSnapshot = async () => {
      const ui = await screenWin.webContents.executeJavaScript(`(() => {
        const vp = window.__videoPlayerState || {};
        const h2 = document.querySelector('h2');
        const bodyText = document.body ? document.body.innerText : '';
        return {
          title: h2 ? h2.textContent.trim() : '',
          activeServerName: vp.activeServerName || '',
          activeServerUrl: vp.activeServerUrl || '',
          selectedSeason: vp.selectedSeason,
          selectedEpisode: vp.selectedEpisode,
          hasRetryHang: bodyText.includes('Ningún servidor respondió'),
          reqs: Array.isArray(window.__req) ? window.__req.slice(-5) : []
        };
      })()`);
      const st = await readEmbedStatus();
      const effectiveReady = st && typeof st.readyState === 'number' ? st.readyState : -1;
      const effectiveTime = st && typeof st.currentTime === 'number' ? st.currentTime : -1;
      const effectiveDuration = st && typeof st.duration === 'number' ? st.duration : -1;
      const effectiveSrc = st && typeof st.currentSrc === 'string' ? st.currentSrc : '';
      let providerHost = (st && st.videoHost) || '';
      if ((!providerHost || providerHost === '127.0.0.1' || providerHost === 'localhost') && ui.activeServerUrl) {
        try { providerHost = new URL(ui.activeServerUrl).hostname; } catch (_) {}
      }
      return {
        ...ui,
        effectiveReady,
        effectiveTime,
        effectiveDuration,
        effectiveSrc,
        providerHost,
        embedHasRetryBtn: Boolean(st && st.embedHasRetryBtn),
      };
    };

    const isRealProviderStream = (snap) => {
      if (!snap || !snap.effectiveSrc) return false;
      if (snap.effectiveSrc.includes('/__test/') || (snap.activeServerUrl && snap.activeServerUrl.includes('/__test/'))) return false;
      if (snap.effectiveSrc.startsWith('blob:http://127.0.0.1') || snap.effectiveSrc.startsWith('blob:http://localhost')) {
        return Boolean(snap.activeServerUrl && snap.activeServerUrl.startsWith('https://') && !snap.activeServerUrl.includes('127.0.0.1'));
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

    const MIN_SERIES_DURATION = 300;
    const isRealContentFrame = (snap, minDuration = MIN_SERIES_DURATION) =>
      Boolean(snap && snap.effectiveReady >= 2 && snap.effectiveTime > 0.5 && snap.effectiveDuration > minDuration && isRealProviderStream(snap));

    const sendPlayCommandReliable = async (payload) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await fetch(`${baseUrl}/api/sync/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: activeRoomId, command: { action: 'playDiscoveredMovie', payload } }),
        });
        await wait(900);
        const snap = await getPlayerSnapshot();
        if (snap && snap.selectedSeason === payload.season && snap.selectedEpisode === payload.episode && snap.activeServerName) {
          return;
        }
      }
    };

    let result = null;

    if (gateName === '2R1') {
      const tStart = Date.now();
      await sendPlayCommandReliable({
        id: 'tmdb-series-1396', tmdbId: 1396, title: 'Breaking Bad', type: 'series', category: 'series',
        season: 1, episode: 1, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Piloto',
      });
      let snap = null; let pass = false; let elapsed = 0; let sawPreroll = false;
      while (Date.now() - tStart < 35000) {
        await wait(800);
        snap = await getPlayerSnapshot();
        if (!sawPreroll && snap.effectiveReady >= 2 && snap.effectiveDuration > 0 && snap.effectiveDuration <= MIN_SERIES_DURATION) {
          sawPreroll = true;
          console.log(`[Gate 2R-1] Pre-roll detectado (duration=${snap.effectiveDuration}s <= ${MIN_SERIES_DURATION}s) — siguiendo espera por contenido real...`);
        }
        if (isRealContentFrame(snap, MIN_SERIES_DURATION)) {
          pass = true;
          elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
          break;
        }
      }
      if (!elapsed) elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
      const lastReq = snap?.reqs?.[snap.reqs.length - 1];
      result = {
        gate: 'Gate 2R-1 (Breaking Bad S01E01 frío, techo 35s)',
        servidorActivo: snap?.activeServerName || 'N/A',
        hostReq: lastReq ? `${lastReq.host} (${lastReq.status})` : (snap?.providerHost || 'N/A'),
        readyState: snap?.effectiveReady ?? -1,
        currentTime: `${snap?.effectiveTime ?? -1}s`,
        duration: `${snap?.effectiveDuration ?? -1}s (>300s)`,
        elapsed: `${elapsed}s (<=35s)`,
        currentSrc: formatDisplaySrc(snap),
        resultado: pass && elapsed <= 35 ? 'PASA' : 'FALLA',
      };
    } else if (gateName === '3R') {
      // Arranque en frío de Breaking Bad S01E01 hasta contenido real, luego bloqueo CDP a mitad de capítulo
      await sendPlayCommandReliable({
        id: 'tmdb-series-1396', tmdbId: 1396, title: 'Breaking Bad', type: 'series', category: 'series',
        season: 1, episode: 1, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Piloto',
      });
      let snapInit = null;
      const tWarm = Date.now();
      while (Date.now() - tWarm < 35000) {
        await wait(800);
        snapInit = await getPlayerSnapshot();
        if (isRealContentFrame(snapInit, MIN_SERIES_DURATION)) break;
      }
      const initialHost = snapInit?.providerHost || 'api.moviemaster.lat';
      const initialServer = snapInit?.activeServerName || 'MovieMaster (Latino)';
      const tStart = Date.now();

      const cdpUrlByRequestId = new Map();
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed()) continue;
        try {
          if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
          wc.debugger.on('message', (_ev, method, params) => {
            if (method === 'Network.requestWillBeSent' && params?.requestId && params?.request?.url) {
              cdpUrlByRequestId.set(params.requestId, params.request.url);
            } else if (
              method === 'Network.loadingFailed' &&
              (params?.blockedReason === 'inspector' || String(params?.errorText || '').includes('ERR_BLOCKED_BY_CLIENT') || String(params?.errorText || '').includes('ERR_FAILED'))
            ) {
              const failedUrl = cdpUrlByRequestId.get(params.requestId) || '';
              if (failedUrl.includes('moviemaster.lat') || failedUrl.includes('quickcore.fun')) {
                if (screenWin && !screenWin.isDestroyed()) {
                  screenWin.webContents.send('embed-failed', { code: -20, desc: params.errorText || 'net::ERR_BLOCKED_BY_CLIENT', url: failedUrl });
                }
              }
            }
          });
          await wc.debugger.sendCommand('Network.enable');
          await wc.debugger.sendCommand('Network.setBlockedURLs', {
            urls: ['*://*.moviemaster.lat/*', '*://moviemaster.lat/*', '*://*.quickcore.fun/*', '*://*.latgw.fun/*'],
          });
        } catch (_) {}
      }
      for (const f of getAllFrames()) {
        if (f.url && f.url.includes('moviemaster.lat')) {
          f.executeJavaScript(`fetch('https://api.moviemaster.lat/ev').catch(() => {})`).catch(() => {});
        }
      }

      let snap = null; let pass = false; let elapsed = 0;
      while (Date.now() - tStart < 25000) {
        await wait(800);
        snap = await getPlayerSnapshot();
        const switched = snap.activeServerName && snap.activeServerName !== initialServer;
        if (switched && isRealContentFrame(snap, MIN_SERIES_DURATION)) {
          pass = true;
          elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
          break;
        }
      }
      if (!elapsed) elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
      const lastReq = snap?.reqs?.[snap.reqs.length - 1];
      result = {
        gate: `Gate 3R (CDP block ${initialHost} frío -> fallback)`,
        servidorActivo: `${initialServer} -> ${snap?.activeServerName || 'N/A'}`,
        hostReq: lastReq ? `${lastReq.host} (${lastReq.status})` : (snap?.providerHost || 'N/A'),
        readyState: snap?.effectiveReady ?? -1,
        currentTime: `${snap?.effectiveTime ?? -1}s`,
        duration: `${snap?.effectiveDuration ?? -1}s (>300s)`,
        elapsed: `${elapsed}s (<=25s)`,
        currentSrc: formatDisplaySrc(snap),
        resultado: pass ? 'PASA' : 'FALLA',
      };
    } else if (gateName === '2R2') {
      const tStart = Date.now();
      await sendPlayCommandReliable({
        id: 'tmdb-series-456', tmdbId: 456, title: 'Los Simpson', type: 'series', category: 'series',
        seasonsCount: 37, season: 37, episode: 4, seasonNumber: 37, episodeNumber: 4, episodeTitle: 'Episodio 4',
      });
      let snap = null; let pass = false; let elapsed = 0;
      while (Date.now() - tStart < 20000) {
        await wait(800);
        snap = await getPlayerSnapshot();
        const isFallback = snap.activeServerName && !snap.activeServerName.toLowerCase().includes('moviemaster');
        if (isFallback && isRealContentFrame(snap, MIN_SERIES_DURATION)) {
          pass = true;
          elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
          break;
        }
      }
      if (!elapsed) elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
      const lastReq = snap?.reqs?.[snap.reqs.length - 1];
      result = {
        gate: 'Gate 2R-2 (Simpsons T37:E4 frío -> fallback)',
        servidorActivo: snap?.activeServerName || 'N/A',
        hostReq: lastReq ? `${lastReq.host} (${lastReq.status})` : (snap?.providerHost || 'N/A'),
        readyState: snap?.effectiveReady ?? -1,
        currentTime: `${snap?.effectiveTime ?? -1}s`,
        duration: `${snap?.effectiveDuration ?? -1}s (>300s)`,
        elapsed: `${elapsed}s (<=20s)`,
        currentSrc: formatDisplaySrc(snap),
        resultado: pass ? 'PASA' : 'FALLA',
      };
    } else if (gateName === '4R') {
      // Proceso completamente limpio: arranca en T37:E5 (nunca tocó T37:E4) y elige T37:E4 a mano en el selector
      await sendPlayCommandReliable({
        id: 'tmdb-series-456', tmdbId: 456, title: 'Los Simpson', type: 'series', category: 'series',
        seasonsCount: 37, season: 37, episode: 5, seasonNumber: 37, episodeNumber: 5, episodeTitle: 'Episodio 5',
      });
      // Esperar a que carguen los episodios reales de T37 en el <select>
      for (let i = 0; i < 15; i++) {
        await wait(400);
        const hasOpt4 = await screenWin.webContents.executeJavaScript(`(() => {
          const s = document.querySelector('select[data-testid="episode-select"]');
          return Boolean(s && Array.from(s.options).some(o => o.value === '4'));
        })()`);
        if (hasOpt4) break;
      }

      const tStart = Date.now();
      await screenWin.webContents.executeJavaScript(`(() => {
        const epSelect = document.querySelector('select[data-testid="episode-select"]');
        if (epSelect) {
          epSelect.value = '4';
          epSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);

      let snap = null; let pass = false; let elapsed = 0;
      while (Date.now() - tStart < 15000) {
        await wait(600);
        snap = await getPlayerSnapshot();
        const leftMovieMaster =
          snap.selectedEpisode === 4 &&
          snap.activeServerName &&
          !snap.activeServerName.toLowerCase().includes('moviemaster') &&
          !snap.embedHasRetryBtn &&
          !snap.hasRetryHang;
        if (leftMovieMaster && isRealContentFrame(snap, MIN_SERIES_DURATION)) {
          pass = true;
          elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
          break;
        }
      }
      if (!elapsed) elapsed = Number(((Date.now() - tStart) / 1000).toFixed(1));
      const lastReq = snap?.reqs?.[snap.reqs.length - 1];
      result = {
        gate: 'Gate 4R (Selección manual T37:E4 en frío <=15s)',
        servidorActivo: snap?.activeServerName || 'N/A',
        hostReq: lastReq ? `${lastReq.host} (${lastReq.status})` : (snap?.providerHost || 'N/A'),
        readyState: snap?.effectiveReady ?? -1,
        currentTime: `${snap?.effectiveTime ?? -1}s`,
        duration: `${snap?.effectiveDuration ?? -1}s (>300s)`,
        elapsed: `${elapsed}s (<=15s)`,
        currentSrc: formatDisplaySrc(snap),
        resultado: pass ? 'PASA' : 'FALLA',
      };
    }

    console.log('GATE_JSON:' + JSON.stringify({ result, adLogs: adMountLogs, buildMarker, testServersVal }));
    await testEnv.stop();
    app.exit(result && result.resultado === 'PASA' ? 0 : 1);
  } catch (err) {
    console.error(`[probe-gates-real:${singleGate}] Error fatal:`, err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
