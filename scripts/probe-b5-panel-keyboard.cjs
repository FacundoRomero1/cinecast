#!/usr/bin/env node
/**
 * scripts/probe-b5-panel-keyboard.cjs
 * Gate B5 — Panel y teclado:
 *  1. H abre desde estado cerrado
 *  2. H cierra
 *  3. El panel se oculta solo a los 4 s sin interacción
 *  4. No se oculta mientras el mouse está encima del panel
 *  5. N avanza capítulo (E1 -> E2) y P retrocede (E2 -> E1)
 *  6. Botón visible "Siguiente" avanza capítulo (E1 -> E2)
 */
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv('probe-b5-panel');
    const { base: baseUrl, room: activeRoomId } = testEnv;

    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();

    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2500);

    await page.evaluate((b) => {
      window.__CINECAST_TEST = true;
      window.__CINECAST_TEST_SERVERS = [
        { name: 'TestEmbed', urlTemplate: `${b}/__test/provider/tv/{id}/{season}/{episode}?label=TestEmbed&dur=1420` },
      ];
    }, baseUrl);

    for (let a = 0; a < 3; a++) {
      await fetch(`${baseUrl}/api/sync/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: activeRoomId,
          command: {
            action: 'playDiscoveredMovie',
            payload: {
              id: 'tmdb-series-1396', tmdbId: 1396, title: 'Breaking Bad',
              type: 'series', category: 'series',
              season: 1, episode: 1, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Piloto',
            },
          },
        }),
      });
      await wait(900);
      if (await page.locator('[data-testid="player-top-panel"]').count()) break;
    }

    const getState = () =>
      page.evaluate(() => {
        const panel = document.querySelector('[data-testid="player-top-panel"]');
        const vp = window.__videoPlayerState || {};
        return {
          visible: panel ? panel.getAttribute('data-panel-visible') === 'true' : null,
          ep: vp.selectedEpisode,
          season: vp.selectedSeason,
          hasNextBtn: Boolean(document.querySelector('[data-testid="player-next-episode-btn"]')),
        };
      });

    // 1. Cerrar con H -> debe quedar cerrado
    await page.keyboard.press('h');
    await wait(250);
    const afterHClose = await getState();

    // 2. Abrir con H desde estado cerrado -> debe abrir
    await page.keyboard.press('H');
    await wait(250);
    const afterHOpen = await getState();

    // 3. Mover mouse al panel y esperar 4.8 s -> NO debe ocultarse mientras el mouse está encima
    await page.mouse.move(300, 24);
    await wait(4800);
    const whileHovering = await getState();

    // 4. Sacar mouse del panel (al centro) y esperar 4.6 s -> debe ocultarse solo a los 4 s
    await page.mouse.move(640, 420);
    await wait(4600);
    const afterAutoHide4s = await getState();

    // 5. N avanza capítulo (E1 -> E2) y P retrocede (E2 -> E1)
    await page.keyboard.press('n');
    await wait(600);
    const afterN = await getState();

    await page.keyboard.press('p');
    await wait(600);
    const afterP = await getState();

    // 6. Abrir panel con H y clickear botón visible "Siguiente" -> E1 -> E2
    await page.keyboard.press('h');
    await wait(250);
    await page.locator('[data-testid="player-next-episode-btn"]').click();
    await wait(600);
    const afterNextBtn = await getState();

    const checks = {
      hCloses: afterHClose.visible === false,
      hOpensFromClosed: afterHOpen.visible === true,
      staysOpenOnHover: whileHovering.visible === true,
      autoHidesAt4s: afterAutoHide4s.visible === false,
      nAdvances: afterN.ep === 2,
      pGoesBack: afterP.ep === 1,
      nextBtnVisibleAndWorks: afterHOpen.hasNextBtn && afterNextBtn.ep === 2,
    };
    const pass = Object.values(checks).every(Boolean);

    console.log('\n=== RESULTADO GATE B5 (PANEL Y TECLADO) ===');
    console.log(JSON.stringify({ checks, snapshots: { afterHClose, afterHOpen, whileHovering, afterAutoHide4s, afterN, afterP, afterNextBtn }, resultado: pass ? 'PASA' : 'FALLA' }, null, 2));

    await browser.close();
    await testEnv.stop();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-b5] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
