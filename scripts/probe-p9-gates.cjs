#!/usr/bin/env node
/**
 * scripts/probe-p9-gates.cjs
 * Verificación de los Gates del Bloque 9 (G9-1 a G9-4):
 *  - G9-1: caché de ui borrada + MM_IMPRESSION_PING=0 -> frame < 8 s con duration > 300,
 *          cosecha HTTP fast-path (sin ping).
 *  - G9-2: caché de ui borrada + MM_IMPRESSION_PING=1 -> frame < 8 s con duration > 300 y
 *          [MM] impression ping s=1e=1 ms=... aparece en log DESPUÉS del frame, nunca antes.
 *  - G9-3: Shetland (46923, solo SUB) -> overlay "Sin audio Latino ni Castellano" + botón
 *          "Ver igual (subtitulado)" -> reproduce (duration > 300, currentTime > 0.5).
 *  - G9-4: /canales en Chromium sin Electron con /api/sports/channels caído ->
 *          grilla NO vacía, marcada "sin verificar". También reporta el caso con endpoint sano.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const UI_CACHE_FILE = path.join(os.tmpdir(), 'cinecast-mm-ui-cache-v1.json');

function clearUiDiskCache() {
  try {
    if (fs.existsSync(UI_CACHE_FILE)) fs.unlinkSync(UI_CACHE_FILE);
  } catch (_) { }
}

async function runColdPlayGate(browser, { name, impressionPing }) {
  clearUiDiskCache();
  const serverLines = [];
  const pingEvents = [];
  const env = {
    NODE_ENV: 'production',
    MM_IMPRESSION_PING: impressionPing ? '1' : '0',
    ...(impressionPing ? { MM_IMPRESSION_MAX_PER_SESSION: '1' } : {}),
  };
  const testEnv = await startTestEnv({
    name,
    env,
    onStdoutLine: (l) => {
      const ts = Date.now();
      serverLines.push({ ts, line: l });
      if (l.includes('[MM] impression ping')) {
        pingEvents.push({ ts, line: l });
      }
    },
  });

  try {
    const { base: baseUrl, room } = testEnv;
    const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(room)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2000);

    const tStart = Date.now();
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'tmdb-series-1396', tmdbId: 1396, title: 'Breaking Bad', type: 'series', category: 'series',
            season: 1, episode: 1, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Piloto',
          },
        },
      }),
    });

    let frameAt = 0;
    let state = null;
    for (let i = 0; i < 100; i++) {
      await wait(100);
      state = await page.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          buildMarker: window.__cinecastBuild || null,
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          activeServerName: vp.activeServerName || '',
          iframeCount: document.querySelectorAll('iframe').length,
        };
      });
      if (state.duration > 300 && state.currentTime > 0.5) {
        frameAt = Date.now();
        break;
      }
    }
    const elapsedMs = (frameAt || Date.now()) - tStart;

    let concurrencyDropSkipped = null;
    let sessionCapSkipped = null;
    if (impressionPing) {
      // Esperar ~2.2 s post-frame (el cliente dispara a 1200 ms) y probar drop de concurrencia 1
      await wait(2200);
      try {
        const rBusy = await fetch(`${baseUrl}/api/mm/impression`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdb: 1396, type: 'tv', season: 1, episode: 2 }),
        });
        const jBusy = await rBusy.json();
        concurrencyDropSkipped = jBusy?.skipped || null;
      } catch (_) {}

      // Esperar hasta 24 s a que termine el ping y aparezca [MM] impression ping ... ads=N
      for (let i = 0; i < 120; i++) {
        if (pingEvents.length > 0) break;
        await wait(200);
      }

      // Tras terminar el primer ping, verificar tope de sesión (solo 1er episodio)
      try {
        const rCap = await fetch(`${baseUrl}/api/mm/impression`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdb: 1396, type: 'tv', season: 1, episode: 3 }),
        });
        const jCap = await rCap.json();
        sessionCapSkipped = jCap?.skipped || null;
      } catch (_) {}
    } else {
      await wait(1200);
    }

    await ctx.close();
    const harvestLine = serverLines.find((e) => e.line.includes('[MM] harvest ms='))?.line || null;
    const harvestMsMatch = harvestLine ? harvestLine.match(/ms=(\d+)/) : null;
    const harvestMs = harvestMsMatch ? Number(harvestMsMatch[1]) : null;
    const firstPing = pingEvents[0] || null;
    const pingAfterFrame = Boolean(firstPing && frameAt > 0 && firstPing.ts > frameAt);
    const adsMatch = firstPing ? firstPing.line.match(/ads=(\d+)/) : null;
    const pingAdRequests = adsMatch ? Number(adsMatch[1]) : 0;

    const pass = impressionPing
      ? Boolean(
          frameAt > 0 &&
          elapsedMs < 8000 &&
          state?.duration > 300 &&
          pingEvents.length === 1 &&
          pingAdRequests >= 1 &&
          pingAfterFrame &&
          concurrencyDropSkipped === 'busy' &&
          sessionCapSkipped === 'session_cap'
        )
      : Boolean(frameAt > 0 && elapsedMs < 8000 && state?.duration > 300 && pingEvents.length === 0);

    return {
      pass,
      buildMarker: state?.buildMarker,
      elapsedMs,
      harvestLine,
      harvestMs,
      duration: state?.duration,
      currentTime: state?.currentTime,
      iframeCount: state?.iframeCount,
      pingCount: pingEvents.length,
      pingAdRequests: impressionPing ? pingAdRequests : undefined,
      pingLine: firstPing?.line || null,
      pingAfterFrame: impressionPing ? pingAfterFrame : undefined,
      pingDeltaAfterFrameMs: firstPing && frameAt > 0 ? firstPing.ts - frameAt : null,
      concurrencyDropSkipped: impressionPing ? concurrencyDropSkipped : undefined,
      sessionCapSkipped: impressionPing ? sessionCapSkipped : undefined,
    };
  } finally {
    await testEnv.stop();
  }
}

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    // ---------------- G9-1 y G9-2 ----------------
    const g1 = await runColdPlayGate(browser, { name: 'probe-g9-1', impressionPing: false });
    const g2 = await runColdPlayGate(browser, { name: 'probe-g9-2', impressionPing: true });

    // ---------------- G9-3 y G9-4 ----------------
    testEnv = await startTestEnv({
      name: 'probe-p9-gates',
      env: { NODE_ENV: 'production', MM_IMPRESSION_PING: '0' },
    });
    const { base: baseUrl, room } = testEnv;

    const ctx3 = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const p3 = await ctx3.newPage();
    const logs3 = [];
    p3.on('console', (m) => logs3.push(m.text()));
    await p3.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(room)}#/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await wait(2200);
    const t3 = Date.now();
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room,
        command: {
          action: 'playDiscoveredMovie',
          payload: {
            id: 'tmdb-series-46923', tmdbId: 46923, title: 'Shetland', type: 'series', category: 'series',
            season: 1, episode: 1, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Episodio 1',
          },
        },
      }),
    });

    let sawOverlay = false;
    let clickedAt = 0;
    let g3State = null;
    for (let i = 0; i < 160; i++) {
      await wait(150);
      const btn = p3.getByRole('button', { name: 'Ver igual (subtitulado)' });
      if (!sawOverlay && (await btn.count()) > 0) {
        sawOverlay = true;
        await btn.first().click();
        clickedAt = Date.now() - t3;
      }
      g3State = await p3.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
          activeServerName: vp.activeServerName || '',
          activeServerLanguage: vp.activeServerLanguage || '',
          overlayVisible: /Sin audio Latino ni Castellano/.test(document.body.innerText || ''),
          iframeCount: document.querySelectorAll('iframe').length,
        };
      });
      if (g3State.duration > 300 && g3State.currentTime > 0.5) break;
    }
    const g3Elapsed = Date.now() - t3;
    const g3Pass = Boolean(
      g3State && g3State.duration > 300 && g3State.currentTime > 0.5 &&
      /subtitulado/i.test(g3State.activeServerLanguage) && !g3State.overlayVisible
    );
    await ctx3.close();

    async function sportsRun(blockEndpoint) {
      const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const logs = [];
      p.on('console', (m) => { if (m.text().includes('[Sports]')) logs.push(m.text()); });
      if (blockEndpoint) {
        await p.route('**/api/sports/channels*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }));
      }
      await p.addInitScript(() => { try { localStorage.clear(); } catch (_) { } });
      await p.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(room)}#/canales`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      let res = null;
      for (let i = 0; i < 100; i++) {
        await wait(200);
        res = await p.evaluate(() => ({
          hasElectron: typeof window.electronAPI !== 'undefined',
          cards: document.querySelectorAll('.grid > div.group').length,
          unverifiedNote: Boolean(document.querySelector('[data-testid="sports-unverified-note"]')),
          sinVerificarBadges: (document.body.innerText.match(/SIN VERIFICAR/g) || []).length,
          emptyDegraded: Boolean(document.querySelector('[data-testid="sports-empty-degraded"]')),
        }));
        if (res.cards > 0 || res.emptyDegraded) break;
      }
      await ctx.close();
      return { ...res, logs };
    }
    const g4Down = await sportsRun(true);
    const g4Healthy = await sportsRun(false);
    const g4Pass = Boolean(
      !g4Down.hasElectron && g4Down.cards > 0 && g4Down.unverifiedNote && !g4Down.emptyDegraded
    );

    const allPass = g1.pass && g2.pass && g3Pass && g4Pass;
    console.log('\n=== RESULTADO GATES P9 (G9-1 a G9-4) ===');
    console.log(JSON.stringify({
      'G9-1': g1,
      'G9-2': g2,
      'G9-3': {
        pass: g3Pass, elapsedMs: g3Elapsed, overlayShown: sawOverlay, clickedAtMs: clickedAt, state: g3State,
        mmLogs: logs3.filter((l) => l.includes('[MM]')).slice(0, 6),
      },
      'G9-4 (endpoint caido, web)': { pass: g4Pass, ...g4Down },
      'G9-4 (informativo: endpoint sano)': g4Healthy,
      resultado: allPass ? 'PASA' : 'FALLA',
    }, null, 2));
    await browser.close();
    await testEnv.stop();
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-p9-gates] Error:', err);
    if (browser) await browser.close().catch(() => { });
    if (testEnv) await testEnv.stop().catch(() => { });
    process.exit(1);
  }
})();
