#!/usr/bin/env node
/**
 * scripts/probe-b6-volume.cjs
 * Gate B6 — Volumen (única fuente playbackSettings.volume normalizada 0..1):
 *  1. Bajar a 20% -> avanzar capítulo (remontaje de VideoPlayer) -> video.volume === 0.2 sin tocar nada
 *  2. Recargar la app -> lanzar capítulo -> video.volume === 0.2 y playbackSettings.volume === 0.2
 *  3. Mandar volumen desde el celular (setVolume / setAudioSettings) -> video.volume actualizado y se preserva al avanzar capítulo
 */
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv('probe-b6-volume');
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

    // Usar servidor HLS/MP4 directo para tener <video> real en el nivel superior y verificar video.volume al remontar
    const setupTestDirectServer = async () => {
      await page.evaluate((b) => {
        window.__CINECAST_TEST = true;
        window.__CINECAST_TEST_SERVERS = [
          {
            name: 'DirectVideoTest',
            type: 'mp4',
            playable: 'mp4',
            urlTemplate: `${b}/__test/video.mp4?id={id}&s={season}&e={episode}`,
          },
        ];
      }, baseUrl);
    };

    await setupTestDirectServer();

    const sendPlay = async (ep = 1) => {
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
                season: 1, episode: ep, seasonNumber: 1, episodeNumber: ep, episodeTitle: `Ep ${ep}`,
                servers: [{ name: 'DirectVideoTest', url: `${baseUrl}/api/health`, type: 'mp4', language: 'Latino' }],
              },
            },
          }),
        });
        await wait(900);
        if (await page.locator('video').count()) break;
      }
    };

    await sendPlay(1);
    await wait(500);

    const getVolState = () =>
      page.evaluate(() => {
        const v = document.querySelector('video');
        const vp = window.__videoPlayerState || {};
        return {
          ep: vp.selectedEpisode,
          videoVolume: v ? Number(v.volume.toFixed(2)) : null,
          videoMuted: v ? v.muted : null,
          persistedVol01: Number(localStorage.getItem('cinecast_volume_v1') || -1),
        };
      });

    // 1. Bajar a 20% via slider del reproductor (o setVolume) y verificar en E1
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: activeRoomId, command: { action: 'setVolume', payload: 20 } }),
    });
    await wait(1200);
    const ep1At20 = await getVolState();

    // 2. Avanzar capítulo con N (remonta VideoPlayer) -> video.volume === 0.2 sin tocar nada
    await page.keyboard.press('n');
    await wait(1000);
    const ep2AfterAdvance = await getVolState();

    // 3. Recargar la app y lanzar capítulo -> video.volume === 0.2
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(2500);
    await setupTestDirectServer();
    await sendPlay(1);
    await wait(800);
    const afterReload = await getVolState();

    // 4. Mandar setAudioSettings con volume=35 desde el celular y avanzar capítulo -> video.volume === 0.35
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: activeRoomId, command: { action: 'setAudioSettings', payload: { volume: 35 } } }),
    });
    await wait(1200);
    await page.keyboard.press('n');
    await wait(1000);
    const afterRemoteAndAdvance = await getVolState();

    const checks = {
      ep1SetTo02: ep1At20.videoVolume === 0.2 && ep1At20.persistedVol01 === 0.2,
      ep2Preserved02AfterRemount: ep2AfterAdvance.ep === 2 && ep2AfterAdvance.videoVolume === 0.2,
      reloadPreserved02: afterReload.videoVolume === 0.2 && afterReload.persistedVol01 === 0.2,
      remoteCommandAndRemount035: afterRemoteAndAdvance.ep === 2 && afterRemoteAndAdvance.videoVolume === 0.35 && afterRemoteAndAdvance.persistedVol01 === 0.35,
    };
    const pass = Object.values(checks).every(Boolean);

    console.log('\n=== RESULTADO GATE B6 (VOLUMEN AL REMONTAR, RECARGAR Y DESDE CELULAR) ===');
    console.log(JSON.stringify({ checks, snapshots: { ep1At20, ep2AfterAdvance, afterReload, afterRemoteAndAdvance }, resultado: pass ? 'PASA' : 'FALLA' }, null, 2));

    await browser.close();
    await testEnv.stop();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-b6] Error fatal:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
