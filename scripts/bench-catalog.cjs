#!/usr/bin/env node
/**
 * scripts/bench-catalog.cjs
 * Benchmark de línea base y post-optimización del servidor de catálogo:
 *  (a) tamaño de public/data/catalog.json
 *  (b) carga con --expose-gc: tiempo, heapUsed y RSS tras gc()
 *  (c) 200 llamadas a /api/catalog?limit=40&fields=card, /api/home, /api/search?q=ba y /api/genres
 *      (p50 y p95 de latencia y bytes con/sin gzip)
 *  (d) repetición con catálogos sintéticos de 50.000 y 100.000 ítems en scratch/
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const realCatalogPath = path.join(rootDir, 'public', 'data', 'catalog.json');
const scratchBase = path.join(rootDir, 'scratch', 'bench-catalog-tmp');

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

function buildSyntheticCatalog(realItems, targetCount, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const ws = fs.createWriteStream(outFile, { encoding: 'utf8' });
  ws.write('[\n');
  for (let i = 0; i < targetCount; i += 1) {
    const src = realItems[i % realItems.length];
    const cloned = {
      ...src,
      id: `syn-${targetCount}-${i}-${src.id || 'item'}`,
      tmdbId: 90000000 + i,
    };
    const prefix = i === 0 ? '' : ',\n';
    ws.write(prefix + JSON.stringify(cloned));
  }
  ws.write('\n]\n');
  return new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
    ws.end();
  });
}

function requestRaw(urlStr, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'Accept-Encoding': acceptEncoding,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const dt = performance.now() - t0;
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            ms: dt,
            wireBytes: buf.length,
            contentEncoding: String(res.headers['content-encoding'] || 'identity'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runWorker(workerTag, workDir, callsPerMode = 100) {
  if (typeof global.gc !== 'function') {
    throw new Error('Worker requiere --expose-gc');
  }

  // Interceptar fetch externo solo en /api/search para evitar 1800 requests a TMDB/Google
  // durante el benchmark de servidor, cacheando en memoria el primer resultado por URL.
  const origFetch = globalThis.fetch;
  const externalFetchCache = new Map();
  globalThis.fetch = async function benchFetch(input, init) {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input?.url || '');
    if (
      urlStr.startsWith('https://api.themoviedb.org/') ||
      urlStr.startsWith('https://suggestqueries.google.com/')
    ) {
      if (externalFetchCache.has(urlStr)) {
        const cached = externalFetchCache.get(urlStr);
        return new Response(cached.body, {
          status: cached.status,
          headers: { 'content-type': cached.contentType },
        });
      }
      try {
        const resp = await origFetch(input, init);
        const bodyText = await resp.text();
        const entry = {
          status: resp.status,
          body: bodyText,
          contentType: resp.headers.get('content-type') || 'application/json',
        };
        externalFetchCache.set(urlStr, entry);
        return new Response(entry.body, {
          status: entry.status,
          headers: { 'content-type': entry.contentType },
        });
      } catch (_) {
        const fallback = { status: 200, body: '{"results":[]}', contentType: 'application/json' };
        externalFetchCache.set(urlStr, fallback);
        return new Response(fallback.body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return origFetch(input, init);
  };

  const { createApp } = await import('../src/server/core/http.js');
  const { loadServerCatalogFromDisk } = await import('../src/server/core/routes/catalog.js');

  global.gc();
  const memBefore = process.memoryUsage();

  let sharedCache = null;
  const tLoad0 = performance.now();
  const loaded = loadServerCatalogFromDisk(
    workDir,
    () => sharedCache,
    (c) => {
      sharedCache = c;
    }
  );
  const loadMs = Number((performance.now() - tLoad0).toFixed(2));

  global.gc();
  const memAfter = process.memoryUsage();

  const app = createApp({
    baseDir: workDir,
    userDataPath: path.join(workDir, '.cinecast-data'),
    getCatalogCache: () => sharedCache,
    setCatalogCache: (c) => {
      sharedCache = c;
    },
    diagnostics: {
      getMode: () => false,
      setMode: () => {},
      getNoCorsFix: () => false,
      setNoCorsFix: () => {},
      onChange: () => {},
    },
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const endpoints = [
    { name: '/api/catalog?limit=40&fields=card', path: '/api/catalog?limit=40&fields=card' },
    { name: '/api/home', path: '/api/home' },
    { name: '/api/search?q=ba', path: '/api/search?q=ba' },
    { name: '/api/genres', path: '/api/genres' },
  ];

  const results = {};
  try {
    // Warm-up 1 llamada a cada endpoint (cachea fetch externo en search)
    for (const ep of endpoints) {
      await requestRaw(`${baseUrl}${ep.path}`, 'identity');
    }

    for (const ep of endpoints) {
      const latenciesIdentity = [];
      let bytesIdentity = 0;
      for (let i = 0; i < callsPerMode; i += 1) {
        const r = await requestRaw(`${baseUrl}${ep.path}`, 'identity');
        latenciesIdentity.push(r.ms);
        bytesIdentity = r.wireBytes;
      }

      const latenciesGzip = [];
      let bytesGzip = 0;
      let gzipEncoding = 'identity';
      for (let i = 0; i < callsPerMode; i += 1) {
        const r = await requestRaw(`${baseUrl}${ep.path}`, 'gzip');
        latenciesGzip.push(r.ms);
        bytesGzip = r.wireBytes;
        gzipEncoding = r.contentEncoding;
      }

      latenciesIdentity.sort((a, b) => a - b);
      latenciesGzip.sort((a, b) => a - b);

      results[ep.name] = {
        identity: {
          p50Ms: percentile(latenciesIdentity, 50),
          p95Ms: percentile(latenciesIdentity, 95),
          bytes: bytesIdentity,
        },
        gzip: {
          p50Ms: percentile(latenciesGzip, 50),
          p95Ms: percentile(latenciesGzip, 95),
          bytes: bytesGzip,
          encoding: gzipEncoding,
        },
      };
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const payload = {
    tag: workerTag,
    itemCount: loaded.length,
    catalogJsonBytes: fs.statSync(path.join(workDir, 'public', 'data', 'catalog.json')).size,
    loadMs,
    heapUsedBytes: memAfter.heapUsed,
    heapDeltaBytes: memAfter.heapUsed - memBefore.heapUsed,
    rssBytes: memAfter.rss,
    rssDeltaBytes: memAfter.rss - memBefore.rss,
    endpoints: results,
  };

  console.log('__BENCH_JSON__' + JSON.stringify(payload));
}

function invokeWorker(tag, workDir, callsPerMode) {
  const res = spawnSync(
    process.execPath,
    ['--expose-gc', '--import', 'tsx', __filename, '--worker', tag, workDir, String(callsPerMode)],
    { cwd: rootDir, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  if (res.status !== 0) {
    console.error(`[bench-catalog] Worker "${tag}" falló (${res.status}):\n${res.stderr}\n${res.stdout}`);
    process.exit(res.status || 1);
  }
  const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith('__BENCH_JSON__'));
  if (!line) {
    throw new Error(`No se encontró salida JSON del worker "${tag}"`);
  }
  return JSON.parse(line.slice('__BENCH_JSON__'.length));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') {
    await runWorker(args[1], args[2], Number(args[3]) || 100);
    return;
  }

  const outJsonArg = args.find((a) => a.startsWith('--json='));
  const callsArg = args.find((a) => a.startsWith('--calls='));
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()))
    : new Set(['real', '50k', '100k']);
  const callsPerMode = callsArg ? Math.max(1, Number(callsArg.split('=')[1]) || 100) : 100;
  const realStat = fs.statSync(realCatalogPath);
  const realItems = JSON.parse(fs.readFileSync(realCatalogPath, 'utf8'));

  console.log('=== [bench-catalog] Línea base de servidor ===');
  console.log(`catalog.json real: ${realStat.size.toLocaleString('en-US')} bytes (${formatMiB(realStat.size)}), ${realItems.length.toLocaleString('en-US')} ítems | llamadas/endpoint=${callsPerMode * 2} (${callsPerMode} sin gzip + ${callsPerMode} con gzip)`);

  const dir50k = path.join(scratchBase, 'syn-50k');
  const dir100k = path.join(scratchBase, 'syn-100k');

  const outPath = outJsonArg ? path.resolve(rootDir, outJsonArg.slice('--json='.length)) : null;
  let existingRuns = [];
  if (outPath && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (Array.isArray(prev.runs)) existingRuns = prev.runs;
    } catch (_) {}
  }

  const runs = [];
  try {
    if (onlySet.has('real')) {
      const rReal = invokeWorker(`real-${realItems.length}`, rootDir, callsPerMode);
      runs.push(rReal);
      console.log(`[bench-catalog] ${rReal.tag}: carga=${rReal.loadMs}ms heap=${formatMiB(rReal.heapUsedBytes)} rss=${formatMiB(rReal.rssBytes)}`);
    }

    if (onlySet.has('50k')) {
      console.log('[bench-catalog] Generando catálogo sintético 50,000 en scratch/...');
      await buildSyntheticCatalog(realItems, 50000, path.join(dir50k, 'public', 'data', 'catalog.json'));
      const r50k = invokeWorker('50k', dir50k, callsPerMode);
      runs.push(r50k);
      console.log(`[bench-catalog] ${r50k.tag}: carga=${r50k.loadMs}ms heap=${formatMiB(r50k.heapUsedBytes)} rss=${formatMiB(r50k.rssBytes)}`);
    }

    if (onlySet.has('100k')) {
      console.log('[bench-catalog] Generando catálogo sintético 100,000 en scratch/...');
      await buildSyntheticCatalog(realItems, 100000, path.join(dir100k, 'public', 'data', 'catalog.json'));
      const r100k = invokeWorker('100k', dir100k, callsPerMode);
      runs.push(r100k);
      console.log(`[bench-catalog] ${r100k.tag}: carga=${r100k.loadMs}ms heap=${formatMiB(r100k.heapUsedBytes)} rss=${formatMiB(r100k.rssBytes)}`);
    }
  } finally {
    try {
      fs.rmSync(scratchBase, { recursive: true, force: true });
    } catch (_) {}
  }

  const mergedByTag = new Map();
  for (const prev of existingRuns) mergedByTag.set(prev.tag, prev);
  for (const r of runs) mergedByTag.set(r.tag, r);
  const allRuns = Array.from(mergedByTag.values());

  console.log('\n--- Resumen Carga & Memoria (tras gc) ---');
  console.log('Escenario      | Ítems   | JSON MiB | Carga ms | Heap tras GC | RSS tras GC');
  console.log('-'.repeat(78));
  for (const r of runs) {
    console.log(
      `${r.tag.padEnd(14)} | ${String(r.itemCount).padStart(7)} | ${formatMiB(r.catalogJsonBytes).padStart(8)} | ${String(r.loadMs).padStart(8)} | ${formatMiB(r.heapUsedBytes).padStart(12)} | ${formatMiB(r.rssBytes).padStart(11)}`
    );
  }

  console.log(`\n--- Resumen Endpoints (${callsPerMode} identity + ${callsPerMode} gzip = ${callsPerMode * 2} llamadas c/u) ---`);
  for (const r of runs) {
    console.log(`\n[${r.tag}]`);
    console.log('Endpoint                          | NoGzip p50/p95 ms | Bytes NoGzip | Gzip p50/p95 ms   | Bytes Gzip (enc)');
    console.log('-'.repeat(106));
    for (const [ep, m] of Object.entries(r.endpoints)) {
      const noGzipLat = `${m.identity.p50Ms} / ${m.identity.p95Ms}`;
      const gzipLat = `${m.gzip.p50Ms} / ${m.gzip.p95Ms}`;
      console.log(
        `${ep.padEnd(33)} | ${noGzipLat.padEnd(17)} | ${String(m.identity.bytes).padStart(12)} | ${gzipLat.padEnd(17)} | ${String(m.gzip.bytes).padStart(8)} (${m.gzip.encoding})`
      );
    }
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ realBytes: realStat.size, realItems: realItems.length, runs: allRuns }, null, 2));
  }
}

main().catch((err) => {
  console.error('[bench-catalog] Error:', err);
  process.exit(1);
});

