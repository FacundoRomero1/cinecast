#!/usr/bin/env node
/**
 * scripts/probe-b4-season.cjs
 * Gate B4 — Temporada:
 *  - Log [SEASON] canHaveNextSeason=... numberOfSeasons=... currentSeasonEpisodes=... tmdb=... en el rollover
 *  - Al terminar temporada (Breaking Bad S1E7, último episodio de Temporada 1, incluso sin seasonsCount explícito),
 *    consulta /api/tv/1396/season/2, si no está vacía salta a S2E1 y verifica que S2E1 arranca con currentTime > 0.5.
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
    testEnv = await startTestEnv('probe-b4-season');
    const { base: baseUrl, room: activeRoomId } = testEnv;

    // Pre-cosechar ui para 1396
    await fetch(`${baseUrl}/api/mm/servers?tmdb=1396&type=tv&season=1&episode=7`).catch(() => {});

    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();

    const seasonLogs = [];
    const allConsole = [];
    page.on('console', (msg) => {
      const txt = msg.text();
      allConsole.push(txt);
      if (txt.includes('[SEASON]') || txt.includes('[MM]')) {
        seasonLogs.push(txt);
      }
    });
    page.on('pageerror', (err) => {
      allConsole.push(`PAGEERROR: ${err.message}`);
    });

    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2200);

    // Lanzar Breaking Bad S01E07 (último episodio de la Temporada 1; Season 1 tiene 7 episodios)
    // deliberadamente SIN seasonsCount ni seasons[] para probar que decide por la lista de /api/tv/1396/season/2
    for (let attempt = 0; attempt < 4; attempt++) {
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
              episode: 7,
              seasonNumber: 1,
              episodeNumber: 7,
              episodeTitle: 'Acuerdo no violento',
            },
          },
        }),
      });
      await wait(900);
      if (await page.locator('[data-testid="video-player"]').count()) break;
    }

    // Esperar a que cargue S01E07 y su listado de 7 episodios de T1
    let stBeforeN = null;
    for (let i = 0; i < 80; i++) {
      await wait(100);
      stBeforeN = await page.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          season: vp.selectedSeason,
          episode: vp.selectedEpisode,
          currentTime: v ? v.currentTime : 0,
          epOptionsCount: document.querySelectorAll('[data-testid="episode-select"] option').length,
        };
      });
      if (stBeforeN.season === 1 && stBeforeN.episode === 7 && stBeforeN.epOptionsCount === 7 && stBeforeN.currentTime > 0.1) {
        break;
      }
    }

    // Disparar fin de temporada (avanzar desde S1E7 -> debe saltar a S2E1)
    await page.keyboard.press('n');

    let s2e1State = null;
    for (let i = 0; i < 80; i++) {
      await wait(100);
      s2e1State = await page.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          season: vp.selectedSeason,
          episode: vp.selectedEpisode,
          title: vp.currentTitle || '',
          duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
          currentTime: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
        };
      });
      if (s2e1State.season === 2 && s2e1State.episode === 1 && s2e1State.currentTime > 0.5) {
        break;
      }
    }

    const seasonRolloverLog = seasonLogs.find((l) => l.includes('[SEASON]')) || null;
    const checks = {
      hasSeasonLog: Boolean(seasonRolloverLog),
      jumpedToS2E1: s2e1State?.season === 2 && s2e1State?.episode === 1,
      s2e1PlayingOver05: (s2e1State?.currentTime || 0) > 0.5,
      s2e1ValidDuration: (s2e1State?.duration || 0) > 300,
    };
    const pass = Object.values(checks).every(Boolean);

    console.log('\n=== RESULTADO GATE B4 (CAMBIO DE TEMPORADA S1E7 -> S2E1) ===');
    console.log(
      JSON.stringify(
        {
          checks,
          stBeforeN,
          seasonRolloverLog,
          allLogs: seasonLogs,
          recentConsole: allConsole.slice(-25),
          s2e1State,
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
    console.error('[probe-b4-season] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
