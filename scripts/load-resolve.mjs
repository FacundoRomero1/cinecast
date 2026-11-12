#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    url: null,
    port: 3099,
    providerId: 'tukiplay',
    maxConcurrent: null,
    distinctOnly: false,
    offset: 120,
  };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) opts.url = arg.slice('--url='.length).replace(/\/$/, '');
    if (arg.startsWith('--port=')) opts.port = Number(arg.split('=')[1]) || 3099;
    if (arg.startsWith('--provider=')) opts.providerId = arg.slice('--provider='.length).trim() || 'tukiplay';
    if (arg.startsWith('--maxConcurrent=')) {
      const n = Number(arg.split('=')[1]);
      if (Number.isFinite(n) && n >= 1) opts.maxConcurrent = Math.floor(n);
    }
    if (arg === '--distinct-only') opts.distinctOnly = true;
    if (arg.startsWith('--offset=')) {
      const o = Number(arg.split('=')[1]);
      if (Number.isFinite(o) && o >= 0) opts.offset = Math.floor(o);
    }
  }
  return opts;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // ignore already exited
  }
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/resolve/status`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error(`El servidor en ${baseUrl} no respondió dentro de ${timeoutMs}ms`);
}

async function fetchStatus(baseUrl) {
  const res = await fetch(`${baseUrl}/api/resolve/status`);
  if (!res.ok) throw new Error(`/api/resolve/status HTTP ${res.status}`);
  return res.json();
}

function connectWsTracker(baseUrl) {
  const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/ws';
  const recordsByJob = new Map();
  const pendingWaiters = new Map();

  function getOrCreate(jobId) {
    let rec = recordsByJob.get(jobId);
    if (!rec) {
      rec = { events: [] };
      recordsByJob.set(jobId, rec);
    }
    return rec;
  }

  function isFinalEvent(ev, rec) {
    if (!ev) return false;
    // 'ready' y 'empty' siempre son definitivos. Un segundo evento también es definitivo.
    return ev.status !== 'degraded' || rec.events.length >= 2;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      rejectPromise(new Error(`Timeout conectando WS ${wsUrl}`));
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timer);
      resolvePromise({
        waitForJobEvents: (jobId, timeoutMs = 180000) => {
          const rec = getOrCreate(jobId);
          if (rec.events.length > 0 && isFinalEvent(rec.events[rec.events.length - 1].msg, rec)) {
            return Promise.resolve({
              first: rec.events[0],
              final: rec.events[rec.events.length - 1],
            });
          }

          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              pendingWaiters.delete(jobId);
              rej(new Error(`Timeout esperando eventos WS finales para job ${jobId}`));
            }, timeoutMs);

            pendingWaiters.set(jobId, (result) => {
              clearTimeout(t);
              res(result);
            });
          });
        },
        close: () => {
          try {
            ws.close();
          } catch {}
        },
      });
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === 'resolve' && msg.jobId) {
          const rec = getOrCreate(msg.jobId);
          rec.events.push({ msg, receivedAtPerf: performance.now() });
          const latest = rec.events[rec.events.length - 1];
          if (isFinalEvent(latest.msg, rec)) {
            const cb = pendingWaiters.get(msg.jobId);
            if (cb) {
              pendingWaiters.delete(msg.jobId);
              cb({
                first: rec.events[0],
                final: latest,
              });
            }
          }
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
  });
}

async function dispatchBatch(baseUrl, wsTracker, requests) {
  const batchStart = performance.now();

  const promises = requests.map(async (payload) => {
    const startedPerf = performance.now();
    const postResp = await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!postResp.ok) {
      throw new Error(`POST /api/resolve HTTP ${postResp.status}`);
    }
    const postData = await postResp.json();
    const jobId = postData.jobId;

    if (postData.cached) {
      const nowPerf = performance.now();
      const ms = Math.round(nowPerf - startedPerf);
      return {
        jobId,
        tmdbId: payload.tmdbId,
        fromCache: true,
        coalescedFlag: false,
        firstStatus: postData.status,
        firstResponseMs: ms,
        finalStatus: postData.status,
        finalMs: ms,
        serverCount: postData.serverCount ?? 0,
      };
    }

    const evs = await wsTracker.waitForJobEvents(jobId, 180000);
    const firstMs = Math.round(evs.first.receivedAtPerf - startedPerf);
    const finalMs = Math.round(evs.final.receivedAtPerf - startedPerf);

    return {
      jobId,
      tmdbId: payload.tmdbId,
      fromCache: false,
      coalescedFlag: Boolean(postData.coalesced),
      firstStatus: evs.first.msg.status,
      firstResponseMs: firstMs,
      finalStatus: evs.final.msg.status,
      finalMs,
      serverCount: evs.final.msg.serverCount ?? 0,
    };
  });

  const settled = await Promise.all(promises);
  const wallMs = Math.round(performance.now() - batchStart);
  return { wallMs, settled };
}

function summarizeBatch(title, batchResult, beforeStatus, afterStatus, providerId) {
  const items = batchResult.settled;
  const firstLatencies = items.map((i) => i.firstResponseMs);
  const readyItems = items.filter((i) => i.finalStatus === 'ready');
  const readyLatencies = readyItems.map((i) => i.finalMs);

  const firstDegraded = items.filter((i) => i.firstStatus === 'degraded');
  const bgReadyFromDegraded = firstDegraded.filter((i) => i.finalStatus === 'ready');

  const firstCounts = { ready: 0, degraded: 0, empty: 0 };
  const finalCounts = { ready: 0, degraded: 0, empty: 0 };
  for (const it of items) {
    if (it.firstStatus in firstCounts) firstCounts[it.firstStatus] += 1;
    if (it.finalStatus in finalCounts) finalCounts[it.finalStatus] += 1;
  }

  const executionsDelta =
    afterStatus.metrics.resolve.probeExecutions - beforeStatus.metrics.resolve.probeExecutions;
  const outboundHttpDelta =
    afterStatus.metrics.resolve.outboundHttpRequests - beforeStatus.metrics.resolve.outboundHttpRequests;
  const coalescedDelta =
    afterStatus.metrics.queue.coalescedHits - beforeStatus.metrics.queue.coalescedHits;
  const timeoutsDelta =
    afterStatus.metrics.resolve.timeouts - beforeStatus.metrics.resolve.timeouts;
  const breaker = afterStatus.metrics.breakers[providerId];

  const readyPct = Number(((readyItems.length / items.length) * 100).toFixed(1));
  const firstP50 = percentile(firstLatencies, 50);
  const firstP95 = percentile(firstLatencies, 95);
  const readyP50 = readyLatencies.length > 0 ? percentile(readyLatencies, 50) : null;
  const readyP95 = readyLatencies.length > 0 ? percentile(readyLatencies, 95) : null;

  console.log(`\n--- ${title} ---`);
  console.log(
    `1ra respuesta (${JSON.stringify(firstCounts)}) | Definitivo (${JSON.stringify(finalCounts)}) | Pared=${batchResult.wallMs}ms`
  );
  console.log(
    'Columna                          | p50        | p95        | Detalle'
  );
  console.log('-'.repeat(78));
  console.log(
    `Latencia 1ra respuesta (rdy/deg) | ${String(firstP50 + 'ms').padEnd(10)} | ${String(firstP95 + 'ms').padEnd(10)} | softDeadline=${breaker?.softDeadlineMs ?? 4000}ms`
  );
  console.log(
    `Tiempo a ready definitivo        | ${String(readyP50 !== null ? readyP50 + 'ms' : '-').padEnd(10)} | ${String(readyP95 !== null ? readyP95 + 'ms' : '-').padEnd(10)} | ready=${readyItems.length}/${items.length} (${readyPct}%, en bg=${bgReadyFromDegraded.length}/${firstDegraded.length})`
  );
  console.log(
    `Llamadas reales salidas a ${providerId}: executions=${executionsDelta} | http_requests=${outboundHttpDelta} | coalescing=${coalescedDelta}/${items.length}`
  );
  console.log(
    `Breaker [${providerId}]: state=${breaker?.state} | errorPct=${breaker?.errorPct}% | slowPct=${breaker?.slowPct}% | timeouts=${timeoutsDelta} | jobs_huérfanos=${afterStatus.jobsTracked}`
  );

  return {
    firstP50,
    firstP95,
    readyP50,
    readyP95,
    readyPct,
    bgReadyCount: bgReadyFromDegraded.length,
    bgTotal: firstDegraded.length,
    executionsDelta,
    outboundHttpDelta,
    coalescedDelta,
    timeoutsDelta,
    errorPct: breaker?.errorPct ?? 0,
    slowPct: breaker?.slowPct ?? 0,
    jobsTracked: afterStatus.jobsTracked,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let baseUrl = opts.url;
  let serverChild = null;

  if (!baseUrl) {
    baseUrl = `http://127.0.0.1:${opts.port}`;
    const env = {
      ...process.env,
      PORT: String(opts.port),
      CINECAST_DISABLE_PREWARM: '1',
    };
    if (opts.maxConcurrent !== null) {
      env.CINECAST_RESOLVE_MAX_CONCURRENT = String(opts.maxConcurrent);
    }
    serverChild = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(baseUrl, 30000);
  } else {
    await waitForServer(baseUrl, 10000);
  }

  const wsTracker = await connectWsTracker(baseUrl);

  try {
    const catalogPath = path.join(ROOT_DIR, 'public', 'data', 'catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).filter(
      (item) => item && item.id && Number(item.tmdbId) > 0
    );

    const distinctItems = [];
    const seenTmdb = new Set([550]);
    for (const item of catalog.slice(opts.offset)) {
      const tmdbId = Math.floor(Number(item.tmdbId));
      if (!seenTmdb.has(tmdbId)) {
        seenTmdb.add(tmdbId);
        distinctItems.push({
          providerId: opts.providerId,
          tmdbId,
          type: item.category === 'anime' ? 'anime' : item.type === 'series' ? 'series' : 'movie',
          season: item.type === 'series' ? 1 : undefined,
          episode: item.type === 'series' ? 1 : undefined,
        });
        if (distinctItems.length >= 20) break;
      }
    }

    const concLabel = opts.maxConcurrent !== null ? String(opts.maxConcurrent) : 'config';
    console.log(`\n=== Prueba de carga resolve (${baseUrl}, proveedor=${opts.providerId}, maxConcurrent=${concLabel}) ===`);

    let sameSummary = null;
    if (!opts.distinctOnly) {
      const beforeSame = await fetchStatus(baseUrl);
      const sameBatch = Array.from({ length: 20 }, () => ({
        providerId: opts.providerId,
        tmdbId: 550,
        type: 'movie',
      }));
      const resSame = await dispatchBatch(baseUrl, wsTracker, sameBatch);
      await sleep(50);
      const afterSame = await fetchStatus(baseUrl);

      sameSummary = summarizeBatch(
        '1) 20 resoluciones simultáneas del MISMO título (movie tmdbId=550)',
        resSame,
        beforeSame,
        afterSame,
        opts.providerId
      );

      // Verificación rápida de caché SWR en el acto
      const beforeCached = await fetchStatus(baseUrl);
      const cachedCheck = await dispatchBatch(baseUrl, wsTracker, [
        { providerId: opts.providerId, tmdbId: 550, type: 'movie' },
      ]);
      const afterCached = await fetchStatus(baseUrl);
      const cachedOutbound =
        afterCached.metrics.resolve.outboundHttpRequests -
        beforeCached.metrics.resolve.outboundHttpRequests;
      const cItem = cachedCheck.settled[0];
      console.log(
        `Verificación caché en el acto -> cached=${cItem?.fromCache} | status=${cItem?.firstStatus} | serverCount=${cItem?.serverCount} | nuevas_llamadas=${cachedOutbound} | jobs_huérfanos=${afterCached.jobsTracked}`
      );
    }

    const beforeDistinct = await fetchStatus(baseUrl);
    const resDistinct = await dispatchBatch(baseUrl, wsTracker, distinctItems);
    await sleep(50);
    const afterDistinct = await fetchStatus(baseUrl);

    const distinctSummary = summarizeBatch(
      `${opts.distinctOnly ? '1' : '2'}) 20 resoluciones simultáneas de 20 TÍTULOS DISTINTOS (offset=${opts.offset})`,
      resDistinct,
      beforeDistinct,
      afterDistinct,
      opts.providerId
    );

    const passJobs =
      (sameSummary === null || sameSummary.jobsTracked === 0) &&
      distinctSummary.jobsTracked === 0;
    const passSame =
      sameSummary === null ||
      (sameSummary.executionsDelta === 1 &&
        sameSummary.outboundHttpDelta === 1 &&
        sameSummary.coalescedDelta === 19);
    const passDistinct =
      distinctSummary.executionsDelta === 20 && distinctSummary.coalescedDelta === 0;

    console.log(`\nResultado verificación: ${passJobs && passSame && passDistinct ? 'PASA' : 'FALLA'}`);
    if (!passJobs || !passSame || !passDistinct) {
      process.exitCode = 1;
    }
  } finally {
    wsTracker.close();
    killProcessTree(serverChild);
  }
}

main().catch((err) => {
  console.error('[load-resolve] Error:', err);
  process.exit(1);
});
