#!/usr/bin/env node
/**
 * scripts/probe-b8-gates.cjs
 * Verificación de los Gates G8-1 a G8-5 para B8 (MovieMaster HLS directo con snapshot de manifiesto):
 *  - G8-1: Breaking Bad S01E01 (1396/1/1): <video> top, duration === 3502, currentTime > 0.5,
 *          0 requests a quickcore.fun, 0 requests a api-encrypted después de servir manifiesto,
 *          0 iframes en DOM, en < 3 s.
 *  - G8-2: Shetland (46923, solo SUB): reproduce y el badge dice Subtitulado; no se queda intentando LAT.
 *  - G8-3: Servidor con 502: forzar el primero de la lista a fallar (simulateFirstServer502) y verificar
 *          que acuña desde el siguiente del mismo idioma sin devolver un manifiesto muerto.
 *  - G8-4: Pausa larga: reproducir, pausar (simulando >20 min e incluso expirando snapshot en backend),
 *          reanudar -> sigue sin re-mint porque el manifiesto VOD ya está servido; y si el cliente pide un
 *          snapshot expirado (410), hace un solo re-mint con reseek a currentTime.
 *  - G8-5: Web: G8-1 en Chromium puro sin Electron (window.electronAPI === undefined).
 */
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv('probe-b8-gates');
    const { base: baseUrl, room: activeRoomId } = testEnv;

    // Pre-cosechar ui para 1396 y 46923 (el ui dura 6h por serie; medimos el arranque real del capítulo)
    await fetch(`${baseUrl}/api/mm/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': REAL_UA },
      body: JSON.stringify({ tmdb: 1396, type: 'tv', season: 1, episode: 1 }),
    }).catch(() => {});
    await fetch(`${baseUrl}/api/mm/servers?tmdb=46923&type=tv&season=1&episode=1`).catch(() => {});

    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    // =========================================================================
    // G8-1: Breaking Bad S01E01 (con bridge Electron simulado + [BUILD_MARKER])
    // =========================================================================
    const ctx1 = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const page1 = await ctx1.newPage();

    const g81Logs = [];
    let g81Quickcore = 0;
    let g81ApiEncrypted = 0;
    let g81ManifestServed = false;
    let g81AutoCommitCalls = 0;
    let g81AutoSkipCalls = 0;

    page1.on('console', (msg) => g81Logs.push(msg.text()));
    page1.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/mm/manifest/')) g81ManifestServed = true;
      if (u.includes('quickcore.fun')) g81Quickcore++;
      if (g81ManifestServed && u.includes('api-encrypted.moviemaster.lat')) g81ApiEncrypted++;
    });

    await page1.addInitScript(() => {
      window.__mmBridgeCalls = { autoCommit: 0, autoSkip: 0 };
      window.electronAPI = {
        autoCommitEmbedPlay: async () => { window.__mmBridgeCalls.autoCommit++; return { acted: false }; },
        autoSkipEmbedAd: async () => { window.__mmBridgeCalls.autoSkip++; return { skipped: false }; },
        controlActiveMedia: async (p) => {
          if (p?.action === 'autoCommitPlay') window.__mmBridgeCalls.autoCommit++;
          if (p?.action === 'autoSkipEmbedAd') window.__mmBridgeCalls.autoSkip++;
          return { ok: true };
        },
        setPlayerServers: () => {},
        startLoadTrace: () => {},
        endLoadTrace: () => {},
        recordLoadTraceEvent: () => {},
        stopGhostExtraction: () => {},
        setStreamHeaders: async () => true,
      };
    });

    await page1.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2200);

    const tG81Start = Date.now();
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
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
          },
        },
      }),
    });

    let g81State = null;
    for (let i = 0; i < 60; i++) {
      await wait(50);
      g81State = await page1.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          buildMarker: window.__cinecastBuild || null,
          hasVideoTop: Boolean(v),
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          iframeCount: document.querySelectorAll('iframe').length,
          badgeText: document.querySelector('[data-testid="active-audio-badge"]')?.textContent?.trim() || '',
          activeServerName: vp.activeServerName || '',
          activeServerType: vp.activeServerType || '',
          bridgeCalls: window.__mmBridgeCalls || { autoCommit: 0, autoSkip: 0 },
        };
      });
      if (g81State.duration === 3502 && g81State.currentTime > 0.5) break;
    }
    const g81ElapsedMs = Date.now() - tG81Start;
    g81AutoCommitCalls = g81State?.bridgeCalls?.autoCommit || 0;
    g81AutoSkipCalls = g81State?.bridgeCalls?.autoSkip || 0;
    const g81AdLogs = g81Logs.filter((l) => l.includes('[AD]'));
    const g81MmLogs = g81Logs.filter((l) => l.includes('[MM]'));

    const g81Pass = Boolean(
      g81State?.buildMarker &&
      g81State?.hasVideoTop &&
      g81State?.duration === 3502 &&
      g81State?.currentTime > 0.5 &&
      g81ElapsedMs < 3000 &&
      g81Quickcore === 0 &&
      g81ApiEncrypted === 0 &&
      g81AdLogs.length === 0 &&
      g81State?.iframeCount === 0 &&
      g81AutoCommitCalls === 0 &&
      g81AutoSkipCalls === 0 &&
      g81MmLogs.length > 0
    );

    // =========================================================================
    // G8-4 (sobre page1 ya reproduciendo 1396/1/1):
    // Parte A: pausar, expirar snapshot en backend (simulando >20 min), reanudar -> 0 re-mints y sigue reproduciendo.
    // Parte B: forzar recarga de manifiesto contra snapshot expirado (410) -> 1 re-mint con reseek a currentTime.
    // =========================================================================
    let mmPlayCallsDuringPauseResume = 0;
    let mmPlayCallsDuring410Remint = 0;
    let trackingPhase = 'none';
    page1.on('request', (req) => {
      if (req.url().includes('/api/mm/play') && req.method() === 'POST') {
        if (trackingPhase === 'pauseA') mmPlayCallsDuringPauseResume++;
        if (trackingPhase === 'remintB') mmPlayCallsDuring410Remint++;
      }
    });

    const currentManifestKey = await page1.evaluate(() => {
      const u = window.__videoPlayerState?.activeServerUrl || '';
      const parts = u.split('/api/mm/manifest/');
      return parts[1] || '';
    });

    // Avanzar a t=45s, pausar, expirar el snapshot en backend (como si hubieran pasado >20 min / >4h)
    await page1.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 45;
        v.pause();
      }
    });
    await wait(400);
    await fetch(`${baseUrl}/api/mm/expire/${encodeURIComponent(currentManifestKey)}`, { method: 'POST' });

    // Confirmar que el snapshot viejo ahora da 410 en el backend
    const expiredCheckResp = await fetch(`${baseUrl}/api/mm/manifest/${encodeURIComponent(currentManifestKey)}`);
    const expiredStatus = expiredCheckResp.status;

    // Parte A: reanudar después de la pausa larga -> como el manifiesto VOD ya fue servido y los segmentos duran 77d, sigue sin re-mint
    trackingPhase = 'pauseA';
    const partAResult = await page1.evaluate(async () => {
      const v = document.querySelector('video');
      const beforeTime = v ? v.currentTime : 0;
      await v.play();
      await new Promise((r) => setTimeout(r, 900));
      return {
        beforeTime: Number(beforeTime.toFixed(2)),
        afterTime: v ? Number(v.currentTime.toFixed(2)) : 0,
        advanced: v ? v.currentTime > beforeTime + 0.3 : false,
      };
    });

    // Parte B: si el cliente pide el snapshot expirado (410), hace 1 solo re-mint con reseek a currentTime
    await page1.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 62;
    });
    await wait(250);
    trackingPhase = 'remintB';
    await page1.evaluate((expiredUrl) => {
      const hls = window.__hlsInstance;
      if (hls) {
        hls.loadSource(expiredUrl);
      }
    }, `/api/mm/manifest/${currentManifestKey}`);

    let partBResult = null;
    for (let i = 0; i < 40; i++) {
      await wait(150);
      partBResult = await page1.evaluate(() => {
        const v = document.querySelector('video');
        return {
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          paused: v ? v.paused : true,
        };
      });
      if (mmPlayCallsDuring410Remint === 1 && partBResult.currentTime >= 61 && !partBResult.paused) {
        break;
      }
    }
    trackingPhase = 'none';

    const g84Pass = Boolean(
      expiredStatus === 410 &&
      partAResult.advanced &&
      mmPlayCallsDuringPauseResume === 0 &&
      mmPlayCallsDuring410Remint === 1 &&
      partBResult &&
      partBResult.currentTime >= 61 &&
      partBResult.duration === 3502
    );

    await ctx1.close();

    // =========================================================================
    // G8-2: Shetland (46923, solo SUB): reproduce y el badge dice Subtitulado; no intenta LAT
    // =========================================================================
    const ctx2 = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const page2 = await ctx2.newPage();

    let g82MmPlayRequests = 0;
    page2.on('request', (req) => {
      if (req.url().includes('/api/mm/play') && req.method() === 'POST') {
        g82MmPlayRequests++;
      }
    });

    await page2.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2200);

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'tmdb-series-46923',
            tmdbId: 46923,
            title: 'Shetland',
            type: 'series',
            category: 'series',
            season: 1,
            episode: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            episodeTitle: 'Episodio 1',
          },
        },
      }),
    });

    let g82State = null;
    for (let i = 0; i < 80; i++) {
      await wait(100);
      g82State = await page2.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          badgeText: document.querySelector('[data-testid="active-audio-badge"]')?.textContent?.trim() || '',
          activeServerLanguage: vp.activeServerLanguage || '',
          activeServerName: vp.activeServerName || '',
          iframeCount: document.querySelectorAll('iframe').length,
        };
      });
      if (g82State.duration > 300 && g82State.currentTime > 0.5) break;
    }

    const g82Pass = Boolean(
      g82State &&
      g82State.duration > 300 &&
      g82State.currentTime > 0.5 &&
      g82State.badgeText.toLowerCase() === 'subtitulado' &&
      g82State.activeServerLanguage.toLowerCase() === 'subtitulado' &&
      g82State.iframeCount === 0 &&
      g82MmPlayRequests === 1
    );

    await ctx2.close();

    // =========================================================================
    // G8-3: Servidor con 502 -> forzar el primero de la lista a fallar y verificar que acuña desde el siguiente del mismo idioma
    // =========================================================================
    const g83Resp = await fetch(`${baseUrl}/api/mm/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdb: 1396,
        type: 'tv',
        season: 1,
        episode: 1,
        simulateFirstServer502: true,
      }),
    });
    const g83Json = await g83Resp.json();
    const g83ManResp = g83Json?.manifestUrl ? await fetch(`${baseUrl}${g83Json.manifestUrl}`) : null;
    const g83ManText = g83ManResp ? await g83ManResp.text() : '';
    const g83Pass = Boolean(
      g83Resp.status === 200 &&
      g83Json.lang === 'latino' &&
      g83Json.serverName &&
      g83Json.serverName !== 'Servidor 1' &&
      g83Json.durationSec > 300 &&
      g83ManResp &&
      g83ManResp.status === 200 &&
      g83ManText.trimStart().startsWith('#EXTM3U')
    );

    // =========================================================================
    // G8-5: Web (G8-1 en Chromium puro sin Electron: window.electronAPI === undefined)
    // =========================================================================
    const ctxWeb = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const pageWeb = await ctxWeb.newPage();

    let g85Quickcore = 0;
    let g85ApiEncrypted = 0;
    let g85ManifestServed = false;
    pageWeb.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/mm/manifest/')) g85ManifestServed = true;
      if (u.includes('quickcore.fun')) g85Quickcore++;
      if (g85ManifestServed && u.includes('api-encrypted.moviemaster.lat')) g85ApiEncrypted++;
    });

    await pageWeb.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2200);

    const tG85Start = Date.now();
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
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
          },
        },
      }),
    });

    let g85State = null;
    for (let i = 0; i < 60; i++) {
      await wait(50);
      g85State = await pageWeb.evaluate(() => {
        const v = document.querySelector('video');
        return {
          hasElectronApi: typeof window.electronAPI !== 'undefined',
          hasVideoTop: Boolean(v),
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          iframeCount: document.querySelectorAll('iframe').length,
        };
      });
      if (g85State.duration === 3502 && g85State.currentTime > 0.5) break;
    }
    const g85ElapsedMs = Date.now() - tG85Start;
    await ctxWeb.close();

    const g85Pass = Boolean(
      g85State &&
      !g85State.hasElectronApi &&
      g85State.hasVideoTop &&
      g85State.duration === 3502 &&
      g85State.currentTime > 0.5 &&
      g85ElapsedMs < 3000 &&
      g85Quickcore === 0 &&
      g85ApiEncrypted === 0 &&
      g85State.iframeCount === 0
    );

    const allPass = g81Pass && g82Pass && g83Pass && g84Pass && g85Pass;
    console.log('\n=== RESULTADO GATES B8 (G8-1 a G8-5) ===');
    console.log(
      JSON.stringify(
        {
          gates: {
            'G8-1': {
              pass: g81Pass,
              elapsedMs: g81ElapsedMs,
              duration: g81State?.duration,
              currentTime: g81State?.currentTime,
              quickcoreRequests: g81Quickcore,
              apiEncryptedAfterManifest: g81ApiEncrypted,
              adLogsCount: g81AdLogs.length,
              iframeCount: g81State?.iframeCount,
              mmLog: g81MmLogs[0] || null,
              buildMarker: g81State?.buildMarker,
            },
            'G8-2': {
              pass: g82Pass,
              duration: g82State?.duration,
              currentTime: g82State?.currentTime,
              badgeText: g82State?.badgeText,
              activeServerLanguage: g82State?.activeServerLanguage,
              activeServerName: g82State?.activeServerName,
              mmPlayRequests: g82MmPlayRequests,
            },
            'G8-3': {
              pass: g83Pass,
              lang: g83Json?.lang,
              serverName: g83Json?.serverName,
              durationSec: g83Json?.durationSec,
              manifestUrl: g83Json?.manifestUrl,
            },
            'G8-4': {
              pass: g84Pass,
              expiredStatus,
              pauseResumeWithoutRemint: {
                ...partAResult,
                mmPlayCalls: mmPlayCallsDuringPauseResume,
              },
              expired410RemintWithReseek: {
                ...partBResult,
                mmPlayCalls: mmPlayCallsDuring410Remint,
              },
            },
            'G8-5': {
              pass: g85Pass,
              elapsedMs: g85ElapsedMs,
              hasElectronApi: g85State?.hasElectronApi,
              duration: g85State?.duration,
              currentTime: g85State?.currentTime,
              quickcoreRequests: g85Quickcore,
              apiEncryptedAfterManifest: g85ApiEncrypted,
              iframeCount: g85State?.iframeCount,
            },
          },
          resultado: allPass ? 'PASA' : 'FALLA',
        },
        null,
        2
      )
    );

    await browser.close();
    await testEnv.stop();
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-b8-gates] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
