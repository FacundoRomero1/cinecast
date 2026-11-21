#!/usr/bin/env node
/**
 * scripts/probe-web-degradation.cjs
 * Verificación de P2.11 — Degradación web (Chromium sin Electron):
 *  - window.electronAPI === undefined
 *  - Cero errores no capturados (pageerror)
 *  - isResolving no queda colgado ni la pantalla en negro (iframe montado)
 *  - El pill de escape ("Iniciar reproducción") aparece a los 8 s
 */

const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv('probe-web-degradation');
    const { base: baseUrl, room: activeRoomId } = testEnv;

    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const pageErrors = [];
    const adLogs = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      const txt = msg.text();
      if (txt.includes('[AD] iframe montado en')) adLogs.push(txt);
    });

    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2500);

    const envCheck = await page.evaluate(() => ({
      electronAPI: typeof window.electronAPI,
      build: window.__cinecastBuild || '',
    }));
    console.log(`[WEB_CHECK] typeof window.electronAPI = "${envCheck.electronAPI}", window.__cinecastBuild = "${envCheck.build}"`);

    // Lanzar Breaking Bad S01E01 sin Electron
    for (let attempt = 0; attempt < 3; attempt++) {
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
      await wait(1000);
      const mounted = await page.evaluate(() => Boolean(document.querySelector('[data-testid="video-player"]')));
      if (mounted) break;
    }

    const tStart = Date.now();
    await wait(2000);
    const earlyState = await page.evaluate(() => {
      const bodyTxt = document.body ? document.body.innerText : '';
      const iframe = document.querySelector('iframe[data-embed]');
      const pill = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').toLowerCase().includes('iniciar reproducción')
      );
      return {
        hasSpinner: bodyTxt.includes('Resolviendo mejores servidores'),
        hasIframe: Boolean(iframe),
        iframeSrc: iframe ? iframe.getAttribute('src') : '',
        pillVisibleEarly: Boolean(pill),
        serverName: window.__videoPlayerState?.activeServerName || '',
      };
    });

    let pillAppearedAtSec = null;
    while (Date.now() - tStart < 12000) {
      await wait(500);
      const pillVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).some((b) =>
          (b.textContent || '').toLowerCase().includes('iniciar reproducción')
        )
      );
      if (pillVisible) {
        pillAppearedAtSec = Number(((Date.now() - tStart) / 1000).toFixed(1));
        break;
      }
    }

    const finalState = await page.evaluate(() => {
      const bodyTxt = document.body ? document.body.innerText : '';
      const iframe = document.querySelector('iframe[data-embed]');
      return {
        hasSpinner: bodyTxt.includes('Resolviendo mejores servidores'),
        hasIframe: Boolean(iframe),
        serverName: window.__videoPlayerState?.activeServerName || '',
      };
    });

    const pass =
      envCheck.electronAPI === 'undefined' &&
      pageErrors.length === 0 &&
      !earlyState.hasSpinner &&
      earlyState.hasIframe &&
      !earlyState.pillVisibleEarly &&
      pillAppearedAtSec !== null &&
      pillAppearedAtSec >= 6.5 &&
      pillAppearedAtSec <= 11.5 &&
      !finalState.hasSpinner &&
      finalState.hasIframe;

    console.log('\n=== RESULTADO P2.11 DEGRADACIÓN WEB (CHROMIUM SIN ELECTRON) ===');
    console.log(JSON.stringify({
      electronAPI: envCheck.electronAPI,
      build: envCheck.build,
      pageErrors,
      earlyState,
      pillAppearedAtSec,
      finalState,
      adLogs,
      resultado: pass ? 'PASA' : 'FALLA',
    }, null, 2));

    await browser.close();
    await testEnv.stop();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-web-degradation] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
