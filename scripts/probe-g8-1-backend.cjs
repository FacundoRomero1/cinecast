#!/usr/bin/env node
/**
 * scripts/probe-g8-1-backend.cjs
 * Verificación de moviemaster.ts + POST /api/mm/play + GET /api/mm/manifest/<key>
 * antes de tocar el cliente:
 *  - POST /api/mm/play para Breaking Bad S01E01 (1396/1/1)
 *  - durationSec === 3502 exacto
 *  - GET /api/mm/manifest/<key> con Content-Type application/vnd.apple.mpegurl, ACAO: *, Cache-Control: no-store
 *  - <video> top + hls.js cargando manifestUrl: duration === 3502, currentTime > 0.5 en < 3s,
 *    0 requests a quickcore.fun, 0 requests a api-encrypted, 0 iframes en DOM.
 */
const path = require('path');
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv('probe-g8-1-backend');
    const { base: baseUrl } = testEnv;

    const tMint0 = Date.now();
    const playResp = await fetch(`${baseUrl}/api/mm/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb: 1396, type: 'tv', season: 1, episode: 1 }),
    });
    const playJson = await playResp.json();
    const mintElapsedMs = Date.now() - tMint0;

    const manResp = await fetch(`${baseUrl}${playJson.manifestUrl}`);
    const manText = await manResp.text();
    const manHeaders = {
      status: manResp.status,
      contentType: manResp.headers.get('content-type'),
      acao: manResp.headers.get('access-control-allow-origin'),
      cacheControl: manResp.headers.get('cache-control'),
      hasMediaSeq0: manText.includes('#EXT-X-MEDIA-SEQUENCE:0'),
      hasEndlist: manText.trimEnd().endsWith('#EXT-X-ENDLIST'),
    };

    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    let quickcoreRequests = 0;
    let apiEncryptedRequests = 0;
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('quickcore.fun')) quickcoreRequests++;
      if (u.includes('api-encrypted.moviemaster.lat')) apiEncryptedRequests++;
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    const hlsBundlePath = path.resolve(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js');
    await page.addScriptTag({ path: hlsBundlePath });

    const playerMetrics = await page.evaluate(async (manifestUrl) => {
      document.body.innerHTML = '<video id="v" muted playsinline controls style="width:640px;height:360px"></video>';
      const v = document.getElementById('v');
      const t0 = performance.now();
      const hls = new window.Hls();
      hls.loadSource(manifestUrl);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        v.play().catch(() => {});
      });

      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (v.currentTime > 0.5 && Number.isFinite(v.duration) && v.duration > 0) {
          break;
        }
      }

      return {
        elapsedMs: Math.round(performance.now() - t0),
        videoDuration: Math.round(v.duration || 0),
        currentTime: Number((v.currentTime || 0).toFixed(2)),
        iframeCount: document.querySelectorAll('iframe').length,
      };
    }, `${baseUrl}${playJson.manifestUrl}`);

    const checks = {
      playStatus200: playResp.status === 200,
      durationSecExact3502: playJson.durationSec === 3502,
      videoDurationExact3502: playerMetrics.videoDuration === 3502,
      currentTimeOver05: playerMetrics.currentTime > 0.5,
      playbackUnder3s: playerMetrics.elapsedMs < 3000,
      zeroQuickcore: quickcoreRequests === 0,
      zeroApiEncryptedAfterManifest: apiEncryptedRequests === 0,
      zeroIframesInDom: playerMetrics.iframeCount === 0,
      manifestHeadersOk:
        manHeaders.status === 200 &&
        String(manHeaders.contentType || '').includes('application/vnd.apple.mpegurl') &&
        manHeaders.acao === '*' &&
        manHeaders.cacheControl === 'no-store' &&
        manHeaders.hasMediaSeq0 &&
        manHeaders.hasEndlist,
    };

    const pass = Object.values(checks).every(Boolean);
    console.log('\n=== G8-1 PRE-CLIENTE (moviemaster.ts + POST /api/mm/play + hls.js) ===');
    console.log(
      JSON.stringify(
        {
          checks,
          mintElapsedMs,
          playJson,
          manHeaders,
          playerMetrics,
          quickcoreRequests,
          apiEncryptedRequests,
          resultado: pass ? 'PASA' : 'FALLA',
        },
        null,
        2
      )
    );

    await browser.close();
    await testEnv.stop();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-g8-1-backend] Error:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
