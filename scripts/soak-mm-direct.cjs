#!/usr/bin/env node
/**
 * scripts/soak-mm-direct.cjs
 * P9.9 — Soak test de MovieMaster directo:
 *  - 30 títulos TMDB distintos con stock conocido, espaciados 45 s desde la misma IP.
 *  - Borra cinecast-mm-ui-cache-v1.json y cinecast-mm-neg-cache-v1.json antes de arrancar.
 *  - Tabla por reproducción: n, tmdb, status /servers, cantidad de servidores, status /mm/play, frame.
 *  - Criterio de alarma / corte temprano: 3 respuestas vacías (serversCount === 0) o 403 seguidas.
 *
 * Uso:
 *   node scripts/soak-mm-direct.cjs --ping=0 --interval-sec=45 --count=30 [--out=path.json]
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
const NEG_CACHE_FILE = path.join(os.tmpdir(), 'cinecast-mm-neg-cache-v1.json');

// 30 títulos populares y clásicos distintos con stock conocido en MovieMaster
const SOAK_TITLES = [
  { tmdb: 1396, type: 'tv', title: 'Breaking Bad' },
  { tmdb: 66732, type: 'tv', title: 'Stranger Things' },
  { tmdb: 1399, type: 'tv', title: 'Game of Thrones' },
  { tmdb: 1402, type: 'tv', title: 'The Walking Dead' },
  { tmdb: 60059, type: 'tv', title: 'Better Call Saul' },
  { tmdb: 100088, type: 'tv', title: 'The Last of Us' },
  { tmdb: 60625, type: 'tv', title: 'Rick and Morty' },
  { tmdb: 1668, type: 'tv', title: 'Friends' },
  { tmdb: 2316, type: 'tv', title: 'The Office' },
  { tmdb: 60574, type: 'tv', title: 'Peaky Blinders' },
  { tmdb: 71446, type: 'tv', title: 'La Casa de Papel' },
  { tmdb: 63351, type: 'tv', title: 'Narcos' },
  { tmdb: 76479, type: 'tv', title: 'The Boys' },
  { tmdb: 94997, type: 'tv', title: 'House of the Dragon' },
  { tmdb: 119051, type: 'tv', title: 'Wednesday' },
  { tmdb: 550, type: 'movie', title: 'Fight Club' },
  { tmdb: 603, type: 'movie', title: 'The Matrix' },
  { tmdb: 27205, type: 'movie', title: 'Inception' },
  { tmdb: 157336, type: 'movie', title: 'Interstellar' },
  { tmdb: 155, type: 'movie', title: 'The Dark Knight' },
  { tmdb: 680, type: 'movie', title: 'Pulp Fiction' },
  { tmdb: 13, type: 'movie', title: 'Forrest Gump' },
  { tmdb: 19995, type: 'movie', title: 'Avatar' },
  { tmdb: 299534, type: 'movie', title: 'Avengers: Endgame' },
  { tmdb: 634649, type: 'movie', title: 'Spider-Man: No Way Home' },
  { tmdb: 245891, type: 'movie', title: 'John Wick' },
  { tmdb: 872585, type: 'movie', title: 'Oppenheimer' },
  { tmdb: 346698, type: 'movie', title: 'Barbie' },
  { tmdb: 502356, type: 'movie', title: 'Super Mario Bros' },
  { tmdb: 438631, type: 'movie', title: 'Dune' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { ping: 0, count: 30, intervalSec: 45, maxPerSession: '', mode: 'default', outFile: '' };
  for (const a of args) {
    if (a === '--mode=24h') {
      out.mode = '24h';
      out.ping = 0;
      out.count = 200;
      out.intervalSec = 390; // 6.5 min -> ~21.6 h para 200 reproducciones
    } else if (a.startsWith('--ping=')) out.ping = Number(a.split('=')[1]) ? 1 : 0;
    else if (a.startsWith('--count=')) out.count = Math.max(1, Number(a.split('=')[1]) || 30);
    else if (a.startsWith('--interval-sec=')) out.intervalSec = Math.max(0, Number(a.split('=')[1]) || 45);
    else if (a.startsWith('--max-per-session=')) out.maxPerSession = a.split('=')[1];
    else if (a.startsWith('--out=')) out.outFile = a.slice('--out='.length);
  }
  return out;
}

function clearDiskCaches() {
  for (const f of [UI_CACHE_FILE, NEG_CACHE_FILE]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (_) {}
  }
}

(async () => {
  const opts = parseArgs();
  clearDiskCaches();

  const pingLogs = [];
  const harvestLogs = [];
  const envVars = {
    NODE_ENV: 'production',
    MM_IMPRESSION_PING: String(opts.ping),
  };
  if (opts.maxPerSession !== '') {
    envVars.MM_IMPRESSION_MAX_PER_SESSION = String(opts.maxPerSession);
  }
  const testEnv = await startTestEnv({
    name: `soak-mm-ping${opts.ping}`,
    env: envVars,
    onStdoutLine: (l) => {
      if (l.includes('[MM] impression ping')) pingLogs.push(l);
      if (l.includes('[MM] harvest ms=')) harvestLogs.push(l);
    },
  });

  let browser = null;
  const rows = [];
  let consecutiveBad = 0;
  let abortedReason = null;

  try {
    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    const { base: baseUrl, room } = testEnv;
    const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();

    let lastPlayStatus = 0;
    page.on('response', (res) => {
      if (res.url().includes('/api/mm/play')) {
        lastPlayStatus = res.status();
      }
    });

    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(room)}#/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2000);

    console.log(`\n=== SOAK MM DIRECTO (mode=${opts.mode}, MM_IMPRESSION_PING=${opts.ping}, maxPerSession=${opts.maxPerSession || 'default(1)'}, count=${opts.count}, interval=${opts.intervalSec}s) ===`);
    console.log('| n | tmdb | tipo | título | /servers | srvs | /mm/play | frame | ms |');
    console.log('|---:|---:|---|---|---:|---:|---:|---|---:|');

    const titles = Array.from({ length: opts.count }, (_, i) => SOAK_TITLES[i % SOAK_TITLES.length]);
    for (let idx = 0; idx < titles.length; idx++) {
      const item = titles[idx];
      const n = idx + 1;
      const iterStart = Date.now();
      lastPlayStatus = 0;

      // 1. Consultar /api/mm/servers directo
      let serversStatus = 0;
      let serversCount = 0;
      try {
        const sUrl = item.type === 'tv'
          ? `${baseUrl}/api/mm/servers?tmdb=${item.tmdb}&type=tv&s=1&e=1`
          : `${baseUrl}/api/mm/servers?tmdb=${item.tmdb}&type=movie`;
        const sr = await fetch(sUrl, { headers: { 'User-Agent': REAL_UA } });
        serversStatus = sr.status;
        if (sr.ok) {
          const sj = await sr.json().catch(() => ({}));
          serversCount = Array.isArray(sj.servers) ? sj.servers.length : 0;
        }
      } catch (_) {
        serversStatus = 0;
      }

      // 2. Disparar reproducción real en CineCast y verificar frame
      let frameOk = false;
      let duration = 0;
      let currentTime = 0;
      const playStart = Date.now();
      try {
        const isTv = item.type === 'tv';
        await fetch(`${baseUrl}/api/sync/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: room,
            command: {
              action: 'playDiscoveredMovie',
              payload: isTv
                ? {
                    id: `tmdb-series-${item.tmdb}`,
                    tmdbId: item.tmdb,
                    title: item.title,
                    type: 'series',
                    category: 'series',
                    season: 1,
                    episode: 1,
                    seasonNumber: 1,
                    episodeNumber: 1,
                    episodeTitle: 'Episodio 1',
                  }
                : {
                    id: `tmdb-movie-${item.tmdb}`,
                    tmdbId: item.tmdb,
                    title: item.title,
                    type: 'movie',
                    category: 'movie',
                  },
            },
          }),
        });

        for (let i = 0; i < 90; i++) {
          await wait(150);
          // Si aparece overlay de solo subtitulado, clickear "Ver igual (subtitulado)"
          const subBtn = page.getByRole('button', { name: 'Ver igual (subtitulado)' });
          if ((await subBtn.count().catch(() => 0)) > 0) {
            await subBtn.first().click().catch(() => {});
          }
          const st = await page.evaluate(() => {
            const v = document.querySelector('video');
            return {
              d: v && Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
              t: v ? Number((v.currentTime || 0).toFixed(2)) : 0,
            };
          });
          duration = st.d;
          currentTime = st.t;
          if (st.d > 300 && st.t > 0.5) {
            frameOk = true;
            break;
          }
        }
      } catch (_) {}

      const elapsedMs = Date.now() - playStart;
      const row = {
        n,
        tmdb: item.tmdb,
        type: item.type,
        title: item.title,
        serversStatus,
        serversCount,
        playStatus: lastPlayStatus,
        frameOk,
        duration,
        currentTime,
        elapsedMs,
      };
      rows.push(row);
      console.log(
        `| ${n} | ${item.tmdb} | ${item.type} | ${item.title} | ${serversStatus} | ${serversCount} | ${lastPlayStatus} | ${frameOk ? 'SI' : 'NO'} | ${elapsedMs} |`
      );

      // Persistir progreso incremental
      if (opts.outFile) {
        fs.writeFileSync(
          opts.outFile,
          JSON.stringify({ opts, rows, abortedReason, pingLogs, harvestLogsCount: harvestLogs.length }, null, 2)
        );
      }

      // Alarma / corte temprano: 3 respuestas vacías o 403 seguidas
      const isBad = serversStatus === 403 || lastPlayStatus === 403 || serversCount === 0;
      if (isBad) {
        consecutiveBad += 1;
        if (consecutiveBad >= 3) {
          abortedReason = `3_consecutive_empty_or_403_at_n_${n}`;
          console.log(`\n[SOAK ALARMA] Corte temprano en n=${n}: 3 respuestas vacías o 403 seguidas.`);
          break;
        }
      } else {
        consecutiveBad = 0;
      }

      // Espaciar 45 s entre arranques (si quedan más títulos)
      if (idx + 1 < titles.length && opts.intervalSec > 0) {
        const spent = Date.now() - iterStart;
        const remain = Math.max(0, opts.intervalSec * 1000 - spent);
        if (remain > 0) {
          await wait(remain);
        }
      }
    }

    await ctx.close();
    const okFrames = rows.filter((r) => r.frameOk).length;
    const okServers = rows.filter((r) => r.serversStatus === 200 && r.serversCount > 0).length;
    const status403Count = rows.filter((r) => r.serversStatus === 403 || r.playStatus === 403).length;
    const avgServers = rows.length
      ? Number((rows.reduce((acc, r) => acc + (r.serversCount || 0), 0) / rows.length).toFixed(2))
      : 0;
    const summary = {
      mode: opts.mode,
      ping: opts.ping,
      maxPerSession: opts.maxPerSession || 'default(1)',
      attempted: rows.length,
      target: opts.count,
      okServers,
      avgServers,
      status403Count,
      okFrames,
      survivedAll: !abortedReason && rows.length === opts.count,
      abortedReason,
      pingCount: pingLogs.length,
      pingLogs,
      harvestLogsCount: harvestLogs.length,
      firstHarvestLog: harvestLogs[0] || null,
    };
    if (opts.outFile) {
      fs.writeFileSync(opts.outFile, JSON.stringify({ opts, summary, rows }, null, 2));
    }
    console.log('\n=== RESUMEN SOAK ===');
    console.log(JSON.stringify(summary, null, 2));

    await browser.close();
    await testEnv.stop();
    process.exit(abortedReason ? 2 : 0);
  } catch (err) {
    console.error('[soak-mm-direct] Error:', err);
    if (browser) await browser.close().catch(() => {});
    await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
