import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getServers,
  resetResolveRuntimeForTest,
} from '../src/server/core/resolve/index.js';
import {
  getCachedServerList,
  SERVER_LIST_HLS_TTL_MS,
  SERVER_LIST_IFRAME_TTL_MS,
} from '../src/server/core/resolve/cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function resolveCatalogType(item) {
  if (item.category === 'anime') return 'anime';
  if (item.type === 'series' || item.category === 'series') return 'series';
  return 'movie';
}

function assertOrderingAndLimit(res, label) {
  if (res.servers.length > 6) {
    throw new Error(`[${label}] devolvió ${res.servers.length} > 6 servidores`);
  }
  if (res.total < res.servers.length) {
    throw new Error(`[${label}] total (${res.total}) < servers.length (${res.servers.length})`);
  }
  let seenUnvalidated = false;
  for (let i = 0; i < res.servers.length; i += 1) {
    const cur = res.servers[i];
    if (typeof cur.validated !== 'boolean') {
      throw new Error(`[${label}] servidor en posición ${i} sin campo boolean validated`);
    }
    if (!cur.validated) seenUnvalidated = true;
    if (cur.validated && seenUnvalidated) {
      throw new Error(`[${label}] servidor validado apareció después de no validado en posición ${i}`);
    }
    if (i > 0) {
      const prev = res.servers[i - 1];
      if (prev.validated === cur.validated) {
        if (prev.playable === 'iframe' && cur.playable === 'hls') {
          throw new Error(
            `[${label}] iframe apareció antes que hls dentro del grupo validated=${cur.validated} en posición ${i}`
          );
        }
        if (prev.playable === cur.playable && cur.popular > prev.popular) {
          throw new Error(
            `[${label}] orden popular descendente roto en grupo validated=${cur.validated}: ${prev.popular} < ${cur.popular}`
          );
        }
      }
    }
  }
}

async function main() {
  resetResolveRuntimeForTest();

  const offset = Number(process.argv.find((a) => a.startsWith('--offset='))?.split('=')[1] ?? 0);
  const catalogPath = path.join(ROOT_DIR, 'public', 'data', 'catalog.json');
  const rawCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  const picked = [];
  const seenKeys = new Set();
  for (const item of rawCatalog.slice(offset)) {
    const tmdbId = Math.floor(Number(item?.tmdbId));
    if (!item || !Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const type = resolveCatalogType(item);
    const key = `${type}:${tmdbId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    picked.push({
      title: item.title || item.name || item.id,
      tmdbId,
      type,
      season: type === 'movie' ? undefined : 1,
      episode: type === 'movie' ? undefined : 1,
    });
    if (picked.length >= 20) break;
  }

  console.log(`\n=== Verificación getServers() sobre ${picked.length} títulos (lang=latino, offset=${offset}) ===`);
  console.log('tmdbId   | Tipo   | Estado   | Tot | Top | Val | HLS | Ifr | Reqs | ms    | Trunc | Top 1                  | Título');
  console.log('-'.repeat(126));

  const results = [];
  for (let start = 0; start < picked.length; start += 3) {
    const chunk = picked.slice(start, start + 3);
    const chunkRes = await Promise.all(
      chunk.map((item) =>
        getServers(
          'tukiplay',
          {
            tmdbId: item.tmdbId,
            type: item.type,
            season: item.season,
            episode: item.episode,
            lang: 'latino',
          },
          ROOT_DIR
        )
      )
    );
    results.push(...chunkRes);
  }

  const rows = [];
  for (let idx = 0; idx < picked.length; idx += 1) {
    const item = picked[idx];
    const res = results[idx];

    assertOrderingAndLimit(res, `${item.type}:${item.tmdbId}`);

    const valTop = res.servers.filter((s) => s.validated).length;
    const hlsTop = res.servers.filter((s) => s.validated && s.playable === 'hls').length;
    const iframeTop = res.servers.filter((s) => s.playable === 'iframe').length;

    let bucket = 'ninguno';
    if (res.hasHls) bucket = 'hls';
    else if (res.total > 0) bucket = 'solo_iframe';

    const top1 = res.servers[0]
      ? `${res.servers[0].playable}:${res.servers[0].name}(${res.servers[0].popular})${res.servers[0].validated ? '' : '*'}`
      : '-';

    const truncStr = res.truncated ? 'si   ' : 'no   ';
    console.log(
      `${String(item.tmdbId).padEnd(8)} | ${item.type.padEnd(6)} | ${res.status.padEnd(8)} | ${String(res.total).padStart(3)} | ${String(res.servers.length).padStart(3)} | ${String(valTop).padStart(3)} | ${String(hlsTop).padStart(3)} | ${String(iframeTop).padStart(3)} | ${String(res.httpRequests).padStart(4)} | ${String(res.waitedMs).padStart(5)} | ${truncStr} | ${top1.padEnd(22)} | ${String(item.title).slice(0, 28)}`
    );

    if (res.status !== 'degraded' && (!res.truncated || res.total > 0)) {
      const s = item.type === 'movie' ? 0 : 1;
      const e = item.type === 'movie' ? 0 : 1;
      const cacheKey = `servers:tukiplay:${item.type}:${item.tmdbId}:${s}:${e}:latino`;
      const cachedEntry = getCachedServerList(cacheKey);
      const expectedTtl = res.truncated
        ? SERVER_LIST_IFRAME_TTL_MS
        : res.hasHls
          ? SERVER_LIST_HLS_TTL_MS
          : SERVER_LIST_IFRAME_TTL_MS;
      if (!cachedEntry || cachedEntry.ttlMs !== expectedTtl) {
        throw new Error(
          `Cache TTL inválido para ${cacheKey}: esperado=${expectedTtl}, real=${cachedEntry?.ttlMs}`
        );
      }
    }

    rows.push({ ...item, res, bucket });
  }

  // Verificar cache hit sin HTTP requests y alternativa lang='sub' en primer título cacheado
  const firstCached = rows.find((r) => !r.res.truncated || r.res.total > 0) || rows[0];
  const cachedHit = await getServers(
    'tukiplay',
    {
      tmdbId: firstCached.tmdbId,
      type: firstCached.type,
      season: firstCached.season,
      episode: firstCached.episode,
      lang: 'latino',
    },
    ROOT_DIR
  );
  if (!cachedHit.cached || cachedHit.httpRequests !== 0) {
    throw new Error(`Cache hit falló: cached=${cachedHit.cached}, reqs=${cachedHit.httpRequests}`);
  }

  const subCheck = await getServers(
    'tukiplay',
    { tmdbId: 550, type: 'movie', lang: 'sub' },
    ROOT_DIR
  );
  assertOrderingAndLimit(subCheck, 'movie:550:sub');

  const hlsCount = rows.filter((r) => r.bucket === 'hls').length;
  const iframeOnlyCount = rows.filter((r) => r.bucket === 'solo_iframe').length;
  const emptyCount = rows.filter((r) => r.bucket === 'ninguno').length;
  const truncatedCount = rows.filter((r) => r.res.truncated).length;
  const hlsPct = Number(((hlsCount / rows.length) * 100).toFixed(1));
  const iframePct = Number(((iframeOnlyCount / rows.length) * 100).toFixed(1));
  const emptyPct = Number(((emptyCount / rows.length) * 100).toFixed(1));

  const reqCounts = rows.map((r) => r.res.httpRequests);
  const totalReqs = reqCounts.reduce((a, b) => a + b, 0);
  const avgReqs = Number((totalReqs / rows.length).toFixed(2));
  const minReqs = Math.min(...reqCounts);
  const maxReqs = Math.max(...reqCounts);

  const msSorted = rows.map((r) => r.res.waitedMs).sort((a, b) => a - b);
  const avgMs = Math.round(msSorted.reduce((a, b) => a + b, 0) / msSorted.length);
  const minMs = msSorted[0];
  const p50Ms = msSorted[Math.floor((msSorted.length - 1) * 0.5)];
  const p95Ms = msSorted[Math.floor((msSorted.length - 1) * 0.95)];
  const maxMs = msSorted[msSorted.length - 1];
  const over30s = rows.filter((r) => r.res.waitedMs > 30000).length;

  console.log('\n--- Distribución en 20 títulos (lang=latino) ---');
  console.log(`hls (al menos 1 HLS válido): ${hlsCount}/${rows.length} (${hlsPct}%)`);
  console.log(`solo iframe                : ${iframeOnlyCount}/${rows.length} (${iframePct}%)`);
  console.log(`ninguno (total=0)          : ${emptyCount}/${rows.length} (${emptyPct}%)`);
  console.log(`truncated (hardTimeout)    : ${truncatedCount}/${rows.length}`);
  console.log(`Requests HTTP por título   : promedio=${avgReqs} | min=${minReqs} | max=${maxReqs} | total=${totalReqs}`);
  console.log(`Latencia ms                : promedio=${avgMs} | min=${minMs} | p50=${p50Ms} | p95=${p95Ms} | max=${maxMs} | >30s=${over30s}`);
  const firstExpectedTtl = firstCached.res.truncated
    ? SERVER_LIST_IFRAME_TTL_MS
    : firstCached.res.hasHls
      ? SERVER_LIST_HLS_TTL_MS
      : SERVER_LIST_IFRAME_TTL_MS;
  console.log(
    `Verificación caché (${firstCached.tmdbId} latino): cached=${cachedHit.cached}, reqs=${cachedHit.httpRequests}, total=${cachedHit.total}, ttlMs=${firstExpectedTtl}`
  );
  console.log(
    `Verificación lang='sub' (movie 550)   : status=${subCheck.status}, total=${subCheck.total}, top=${subCheck.servers.length}, hasHls=${subCheck.hasHls}, reqs=${subCheck.httpRequests}`
  );

  const fragile = rows.filter((r) => r.res.total <= 1);
  console.log(`\n--- Títulos frágiles (total <= 1): ${fragile.length} ---`);
  if (fragile.length === 0) {
    console.log('(ninguno)');
  } else {
    for (const r of fragile) {
      const srv = r.res.servers[0];
      const srvInfo = srv ? `${srv.name} (${srv.playable})` : 'ninguno (-)';
      console.log(
        `${String(r.tmdbId).padEnd(8)} | ${r.type.padEnd(6)} | total=${r.res.total} | ${srvInfo.padEnd(24)} | ${r.title}`
      );
    }
  }

  const v4Path = path.join(ROOT_DIR, 'scratch', 'logs', 'verify-servers-v4.log');
  if (offset === 0 && fs.existsSync(v4Path)) {
    const v4Lines = fs.readFileSync(v4Path, 'utf8').split(/\r?\n/);
    const v4ById = new Map();
    for (const line of v4Lines) {
      const m = line.match(/^\s*(\d+)\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
      if (m) {
        v4ById.set(Number(m[1]), {
          status: m[3],
          tot: Number(m[4]),
          hls: Number(m[6]),
        });
      }
    }
    if (v4ById.size > 0) {
      let recovered = 0;
      let lost = 0;
      console.log('\n--- Comparación HLS vs v4 (título por título) ---');
      console.log('tmdbId   | v4 HLS | v5 HLS | Cambio          | Título');
      console.log('-'.repeat(84));
      for (const r of rows) {
        const prev = v4ById.get(r.tmdbId);
        const v4Hls = prev ? prev.hls > 0 : false;
        const v5Hls = r.res.hasHls;
        const v5HlsCount = r.res.servers.filter((s) => s.validated && s.playable === 'hls').length;
        let diffLabel = 'igual';
        if (!v4Hls && v5Hls) {
          diffLabel = 'RECUPERA HLS';
          recovered += 1;
        } else if (v4Hls && !v5Hls) {
          diffLabel = 'PIERDE HLS';
          lost += 1;
        }
        console.log(
          `${String(r.tmdbId).padEnd(8)} | ${String(prev ? prev.hls : '-').padStart(6)} | ${String(v5HlsCount).padStart(6)} | ${diffLabel.padEnd(15)} | ${String(r.title).slice(0, 32)}`
        );
      }
      console.log(`Resumen HLS vs v4: recuperan HLS=${recovered}, pierden HLS=${lost}`);
    }
  }
}

main().catch((err) => {
  console.error('[verify-servers] Error:', err);
  process.exit(1);
});
