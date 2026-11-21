#!/usr/bin/env node
/**
 * scripts/probe-web-degradation.cjs
 * Verificación de paridad web (Chromium sin Electron):
 *  - window.electronAPI === undefined
 *  - Cero errores no capturados (pageerror)
 *  - isResolving no queda colgado ni el iframe tapado (elementFromPoint === IFRAME)
 *  - Nuestro pill de escape ("Iniciar reproducción") queda OCULTO en web (no duplica botón)
 *  - Tap real sobre el botón nativo del proveedor (#go) reproduce el capítulo real (duration > 300s)
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
      const mounted = await page.evaluate(() => Boolean(document.querySelector('iframe[data-embed]')));
      if (mounted) break;
    }

    // Esperar 8.5s para confirmar que nuestro pill de escape NO aparece en web (sin duplicar botones)
    await wait(8500);
    const preTapState = await page.evaluate(() => {
      const bodyTxt = document.body ? document.body.innerText : '';
      const iframe = document.querySelector('iframe[data-embed]');
      const pill = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').toLowerCase().includes('iniciar reproducción')
      );
      const rect = iframe ? iframe.getBoundingClientRect() : null;
      const centerEl = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      return {
        hasSpinner: bodyTxt.includes('Resolviendo mejores servidores'),
        hasIframe: Boolean(iframe),
        iframeSrc: iframe ? iframe.getAttribute('src') : '',
        ourEscapePillVisible: Boolean(pill),
        hitAtCenterTag: centerEl ? centerEl.tagName : null,
        serverName: window.__videoPlayerState?.activeServerName || '',
      };
    });

    // Tap real sobre el botón del proveedor dentro del iframe
    const iframeBox = await page.locator('iframe[data-embed]').boundingBox();
    const mmFrame = page.frames().find((f) => f.url().includes('moviemaster.lat'));
    let clickedTarget = 'iframe-center';
    if (mmFrame) {
      const goBox = await mmFrame.locator('#go').boundingBox().catch(() => null);
      if (goBox) {
        await page.mouse.click(goBox.x + goBox.width / 2, goBox.y + goBox.height / 2);
        clickedTarget = 'provider-#go';
      } else {
        await page.mouse.click(iframeBox.x + iframeBox.width / 2, iframeBox.y + iframeBox.height / 2);
      }
    } else {
      await page.mouse.click(iframeBox.x + iframeBox.width / 2, iframeBox.y + iframeBox.height / 2);
    }

    const tTap = Date.now();
    let bestVideo = null;
    let sawPreroll = false;
    while (Date.now() - tTap < 40000) {
      await wait(800);
      const f = page.frames().find((fr) => fr.url().includes('moviemaster.lat'));
      if (!f) continue;
      const vInfo = await f
        .evaluate(() => {
          const vids = Array.from(document.querySelectorAll('video'));
          let best = null;
          for (const v of vids) {
            const dur = Number.isFinite(v.duration) ? Math.round(v.duration) : 0;
            const cur = Number.isFinite(v.currentTime) ? Number(v.currentTime.toFixed(2)) : 0;
            if (!best || dur > best.duration || (dur === best.duration && v.readyState > best.readyState)) {
              best = { readyState: v.readyState, currentTime: cur, duration: dur, currentSrc: v.currentSrc || v.src || '' };
            }
          }
          return best;
        })
        .catch(() => null);
      if (vInfo) {
        bestVideo = vInfo;
        if (!sawPreroll && vInfo.duration > 0 && vInfo.duration <= 300) sawPreroll = true;
        if (vInfo.readyState >= 2 && vInfo.currentTime > 0.5 && vInfo.duration > 300) break;
      }
    }
    const tapToContentSec = Number(((Date.now() - tTap) / 1000).toFixed(1));

    const pass =
      envCheck.electronAPI === 'undefined' &&
      pageErrors.length === 0 &&
      !preTapState.hasSpinner &&
      preTapState.hasIframe &&
      !preTapState.ourEscapePillVisible &&
      preTapState.hitAtCenterTag === 'IFRAME' &&
      Boolean(bestVideo && bestVideo.readyState >= 2 && bestVideo.currentTime > 0.5 && bestVideo.duration > 300);

    console.log('\n=== RESULTADO P2.11 + PARIDAD WEB (TAP REAL EN CHROMIUM SIN ELECTRON) ===');
    console.log(
      JSON.stringify(
        {
          electronAPI: envCheck.electronAPI,
          build: envCheck.build,
          pageErrors,
          preTapState,
          clickedTarget,
          sawPreroll,
          tapToContentSec,
          bestVideo,
          adLogs,
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
    console.error('[probe-web-degradation] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
