#!/usr/bin/env node
/**
 * scripts/probe-p9-gates.cjs
 *  - G9-3: Shetland (46923, solo SUB) -> overlay "Sin audio Latino ni Castellano" + boton
 *          "Ver igual (subtitulado)" -> reproduce (duration > 300, currentTime > 0.5).
 *  - G9-4: /canales en Chromium sin Electron con /api/sports/channels caido ->
 *          grilla NO vacia, marcada "sin verificar". Tambien se reporta el caso con endpoint sano.
 * El ping de impresion (P9.3) NO se implementa ni se prueba aqui.
 */
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

(async () => {
  let testEnv = null;
  let browser = null;
  const serverLines = [];
  try {
    testEnv = await startTestEnv({
      name: 'probe-p9-gates',
      env: { NODE_ENV: 'production' },
      onStdoutLine: (l) => serverLines.push(l),
    });
    const { base: baseUrl, room } = testEnv;
    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    // ---------------- G9-3 ----------------
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

    // ---------------- G9-4 ----------------
    async function sportsRun(blockEndpoint) {
      const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const logs = [];
      p.on('console', (m) => { if (m.text().includes('[Sports]')) logs.push(m.text()); });
      if (blockEndpoint) {
        await p.route('**/api/sports/channels*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }));
      }
      await p.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
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

    console.log('\n=== RESULTADO GATES P9 ===');
    console.log(JSON.stringify({
      'G9-3': { pass: g3Pass, elapsedMs: g3Elapsed, overlayShown: sawOverlay, clickedAtMs: clickedAt, state: g3State,
        mmLogs: logs3.filter((l) => l.includes('[MM]')).slice(0, 6) },
      'G9-4 (endpoint caido, web)': { pass: g4Pass, ...g4Down },
      'G9-4 (informativo: endpoint sano)': g4Healthy,
      resultado: g3Pass && g4Pass ? 'PASA' : 'FALLA',
    }, null, 2));
    await browser.close();
    await testEnv.stop();
    process.exit(g3Pass && g4Pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-p9-gates] Error:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
