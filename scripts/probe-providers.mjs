#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Headers idénticos a los de electron/main.cjs (líneas 17, 673-695)
const CHROME_MAJOR = '131';
const REAL_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_SAMPLE_SIZE = 200;
const DEFAULT_CONCURRENCY = 10;

const HOST_CONCURRENCY_CAP = {
  tukiplay: 3,
  'vidsrc.cc': 4,
};

function parseArgs(argv) {
  const opts = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    only: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--timeout=')) opts.timeoutMs = Math.max(1000, Number(arg.split('=')[1]) || DEFAULT_TIMEOUT_MS);
    if (arg.startsWith('--limit=')) opts.sampleSize = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_SAMPLE_SIZE);
    if (arg.startsWith('--concurrency=')) opts.concurrency = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_CONCURRENCY);
    if (arg.startsWith('--only=')) {
      const list = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) opts.only = list;
    }
  }
  return opts;
}

function buildHeaders(urlString, requiresReferer) {
  const headers = {
    'User-Agent': REAL_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  if (requiresReferer) {
    try {
      const urlObj = new URL(urlString);
      headers['Referer'] = `${urlObj.protocol}//${urlObj.hostname}/`;
      headers['Origin'] = `${urlObj.protocol}//${urlObj.hostname}`;
      headers['Sec-Fetch-Site'] = 'same-origin';
    } catch (_) {}
  }

  return headers;
}

function buildProviderUrl(provider, { tmdbId, type, season = 1, episode = 1 }) {
  const isTV = type === 'series';
  const template = isTV ? provider.urlTvEpisode || provider.urlTv : provider.urlMovie;

  return String(template || '')
    .replaceAll('{tmdbId}', String(tmdbId))
    .replaceAll('{season}', String(season))
    .replaceAll('{episode}', String(episode));
}

function decompressBody(buffer, contentEncoding) {
  const enc = String(contentEncoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer).toString('utf8');
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer).toString('utf8');
    if (enc.includes('deflate')) return zlib.inflateSync(buffer).toString('utf8');
  } catch (_) {}
  return buffer.toString('utf8');
}

function singleHttpGet(urlString, { requiresReferer, tlsLax, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    // Agente por request únicamente cuando el proveedor tiene tlsLax=true (nunca global)
    const agent = isHttps && tlsLax ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    const headers = buildHeaders(urlString, requiresReferer);

    let settled = false;
    let req;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (agent) {
        try {
          agent.destroy();
        } catch (_) {}
      }
      fn(val);
    };

    const timer = setTimeout(() => {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'TIMEOUT_ERR';
      if (req) {
        try {
          req.destroy(timeoutErr);
        } catch (_) {}
      }
      finish(reject, timeoutErr);
    }, timeoutMs);

    req = transport.request(
      urlObj,
      {
        method: 'GET',
        headers,
        agent,
      },
      (res) => {
        const headersAtMs = performance.now();
        const status = res.statusCode || 0;
        const location = res.headers?.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          finish(resolve, {
            redirectLocation: new URL(location, urlString).toString(),
            status,
            headersAtMs,
            body: '',
          });
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = decompressBody(Buffer.concat(chunks), res.headers?.['content-encoding']);
          finish(resolve, {
            redirectLocation: null,
            status,
            headersAtMs,
            body,
          });
        });
        res.on('error', (err) => finish(reject, err));
      }
    );

    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

async function httpGetFollowingRedirects(urlString, { requiresReferer, tlsLax, timeoutMs, maxRedirects = 5 }) {
  const startedAt = performance.now();
  const deadline = Date.now() + timeoutMs;
  let currentUrl = urlString;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remaining = Math.max(1, deadline - Date.now());
    const res = await singleHttpGet(currentUrl, { requiresReferer, tlsLax, timeoutMs: remaining });
    if (res.redirectLocation && hop < maxRedirects) {
      currentUrl = res.redirectLocation;
      continue;
    }
    return {
      finalUrl: currentUrl,
      status: res.status,
      ttfbMs: Math.round(res.headersAtMs - startedAt),
      totalMs: Math.round(performance.now() - startedAt),
      body: res.body,
    };
  }

  const err = new Error(`Too many redirects (>${maxRedirects})`);
  err.code = 'TOO_MANY_REDIRECTS';
  throw err;
}

const UNAVAILABLE_PHRASES = [
  'contenido no disponible',
  'no disponible',
  'embed no encontrado',
  'video not found',
  'file not found',
  'stream not found',
  'media not found',
  'file was deleted',
  'media is not available',
  'no source available',
  '404 not found',
  'error 404',
  '404 error',
  'origin is unreachable',
  '503 service unavailable',
  'ddos-guard',
];

function analyzeHtmlBody(body, httpStatus) {
  const safeBody = typeof body === 'string' ? body : '';
  const bytes = Buffer.byteLength(safeBody, 'utf8');

  const hasVideoElement = /<video\b/i.test(safeBody);
  const hasPlayerIframe = /<iframe\b[^>]*>/i.test(safeBody);
  const hasPlayerHint = /hls\.js|plyr|jwplayer|videojs|video-js|clappr|artplayer|shaka|dplayer|\.m3u8|<source\b|embed-iframe|fluid-video/i.test(
    safeBody
  );

  // TukiPlay (pelixplay) embebe un bloque estático #unavailable-notice oculto en el HTML
  // y decide disponibilidad real en window.PELIX_CONFIG (langs / servers / content.pending).
  let pelixServerCount = null;
  let pelixPending = null;
  const pelixMatch = safeBody.match(/window\.PELIX_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (pelixMatch) {
    try {
      const cfg = JSON.parse(pelixMatch[1]);
      const langs = cfg?.langs && typeof cfg.langs === 'object' ? Object.values(cfg.langs) : [];
      pelixServerCount = langs.reduce(
        (sum, entry) => sum + (Array.isArray(entry?.servers) ? entry.servers.length : 0),
        0
      );
      pelixPending = Boolean(cfg?.content?.pending);
    } catch (_) {}
  }

  // Extraer texto visible (sin scripts/styles) para buscar mensajes de "no disponible"
  let visibleHtml = safeBody
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  if (pelixServerCount !== null && pelixServerCount > 0 && !pelixPending) {
    // Quitar el bloque estático oculto de pelixplay cuando hay servidores activos
    visibleHtml = visibleHtml.replace(/<div\s+id=["']unavailable-notice["'][\s\S]*?<\/div>\s*<\/div>/i, ' ');
  }

  const visibleText = visibleHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const matchedPhrases = UNAVAILABLE_PHRASES.filter((phrase) => visibleText.includes(phrase));
  const cfChallenge =
    httpStatus === 403 ||
    httpStatus === 503 ||
    httpStatus === 523 ||
    /just a moment|attention required|checking your browser|cf-browser-verification/i.test(visibleText);

  let unavailableReason = null;
  if (pelixServerCount !== null && (pelixServerCount === 0 || pelixPending)) {
    unavailableReason = pelixPending ? 'pelix-pending' : 'pelix-0-servers';
  } else if (matchedPhrases.length > 0) {
    unavailableReason = matchedPhrases[0];
  } else if (cfChallenge) {
    unavailableReason = `challenge/http-${httpStatus}`;
  }

  const unavailableDetected = Boolean(unavailableReason);
  const httpOk = httpStatus >= 200 && httpStatus < 400;
  const looksLikePlayer =
    httpOk &&
    !unavailableDetected &&
    bytes > 250 &&
    (hasVideoElement || hasPlayerIframe || hasPlayerHint);

  return {
    bytes,
    hasVideoElement,
    hasPlayerIframe,
    unavailableDetected,
    unavailableReason,
    pelixServerCount,
    looksLikePlayer,
  };
}

async function probeUrl(url, { requiresReferer, tlsLax, timeoutMs }) {
  const startedAt = performance.now();
  try {
    const res = await httpGetFollowingRedirects(url, { requiresReferer, tlsLax, timeoutMs });
    const analysis = analyzeHtmlBody(res.body, res.status);

    return {
      url,
      finalUrl: res.finalUrl !== url ? res.finalUrl : undefined,
      responded: true,
      httpStatus: res.status,
      httpOk: res.status >= 200 && res.status < 400,
      ttfbMs: res.ttfbMs,
      totalMs: res.totalMs,
      ...analysis,
      error: null,
    };
  } catch (err) {
    const totalMs = Math.round(performance.now() - startedAt);
    const code = err?.code || err?.cause?.code || err?.name || 'REQUEST_ERROR';
    const isTimeout = code === 'TIMEOUT_ERR' || code === 'TimeoutError' || code === 'AbortError';
    return {
      url,
      responded: false,
      httpStatus: 0,
      httpOk: false,
      ttfbMs: null,
      totalMs,
      bytes: 0,
      hasVideoElement: false,
      hasPlayerIframe: false,
      unavailableDetected: false,
      unavailableReason: null,
      pelixServerCount: null,
      looksLikePlayer: false,
      error: isTimeout ? `TIMEOUT (${timeoutMs}ms)` : `${code}: ${err?.message || ''}`.trim(),
    };
  }
}

function sampleRandomItems(items, count) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

function padCell(value, width, alignRight = false) {
  const str = String(value);
  return alignRight ? str.padStart(width) : str.padEnd(width);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const providersPath = path.join(ROOT_DIR, 'src', 'data', 'providers.json');
  const animeMapPath = path.join(ROOT_DIR, 'src', 'data', 'animeLatinoMap.json');
  const catalogPath = path.join(ROOT_DIR, 'public', 'data', 'catalog.json');

  const allProviders = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
  const targetProviders = (
    opts.only
      ? allProviders.filter((p) => opts.only.includes(p.id))
      : allProviders.filter((p) => p.enabled)
  ).sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  const disabledProviders = allProviders.filter((p) => !p.enabled);

  if (targetProviders.length === 0) {
    console.error('[probe-providers] No hay proveedores para probar.');
    process.exit(1);
  }

  const animeLatinoMap = JSON.parse(fs.readFileSync(animeMapPath, 'utf8'));
  const firstAnimeTmdbId = Number(Object.keys(animeLatinoMap)[0] || 73223);
  const firstAnimeTitle = animeLatinoMap[String(firstAnimeTmdbId)]?.title || 'Anime';

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).filter(
    (item) => item && item.id && Number(item.tmdbId) > 0
  );

  const canaries = {
    movie: { label: 'Fight Club (movie 550)', tmdbId: 550, type: 'movie' },
    tv: { label: 'Game of Thrones (tv 1399/1/1)', tmdbId: 1399, type: 'series', season: 1, episode: 1 },
    anime: {
      label: `${firstAnimeTitle} (anime ${firstAnimeTmdbId}/1/1)`,
      tmdbId: firstAnimeTmdbId,
      type: 'series',
      season: 1,
      episode: 1,
    },
  };

  console.log(`\n=== Probe de Proveedores (timeout=${opts.timeoutMs}ms, muestra=${opts.sampleSize}, conc=${opts.concurrency}) ===`);
  console.log(
    `Objetivo (${targetProviders.length}): ${targetProviders
      .map((p) => `${p.id} [p${p.priority}${p.tlsLax ? ', tlsLax' : ''}${p.pendingMs ? `, pendingMs=${p.pendingMs}` : ''}]`)
      .join(', ')}`
  );
  if (disabledProviders.length > 0) {
    console.log(`Deshabilitados en config (${disabledProviders.length}): ${disabledProviders.map((p) => `${p.id} (${p.notes})`).join(' | ')}`);
  }

  // 1. Prueba de 3 canarios por proveedor
  console.log('\n--- Eje 1 & 2: Canarios ---');
  const canaryResults = {};
  for (const prov of targetProviders) {
    canaryResults[prov.id] = {
      providerName: prov.name,
      priority: prov.priority,
      tlsLax: Boolean(prov.tlsLax),
    };

    for (const [key, canary] of Object.entries(canaries)) {
      const url = buildProviderUrl(prov, canary);
      const res = await probeUrl(url, {
        requiresReferer: prov.requiresReferer,
        tlsLax: Boolean(prov.tlsLax),
        timeoutMs: opts.timeoutMs,
      });
      canaryResults[prov.id][key] = res;
      const statusText = res.responded ? `HTTP ${res.httpStatus}` : `ERR (${res.error})`;
      const ttfbText = res.ttfbMs !== null ? `${res.ttfbMs}ms` : '-';
      const reasonText = res.unavailableReason ? ` [${res.unavailableReason}]` : '';
      console.log(
        `  [${prov.id}] ${key.padEnd(5)} -> ${statusText.padEnd(28)} | TTFB=${ttfbText.padEnd(7)} | <video>=${String(res.hasVideoElement).padEnd(5)} | <iframe>=${String(res.hasPlayerIframe).padEnd(5)} | unavail=${String(res.unavailableDetected).padEnd(5)}${reasonText} | player=${res.looksLikePlayer}`
      );
    }
  }

  // 2. Cobertura sobre muestra aleatoria del catálogo
  const sampled = sampleRandomItems(catalog, opts.sampleSize);
  console.log(`\n--- Eje 3: Cobertura sobre ${sampled.length} títulos al azar del catálogo ---`);

  const providerPerItemResults = {};
  await Promise.all(
    targetProviders.map(async (prov) => {
      const cap = HOST_CONCURRENCY_CAP[prov.id] ?? opts.concurrency;
      const perHostConc = Math.min(cap, opts.concurrency);
      let done = 0;

      const list = await runPool(sampled, perHostConc, async (item) => {
        const url = buildProviderUrl(prov, {
          tmdbId: item.tmdbId,
          type: item.type === 'series' ? 'series' : 'movie',
          season: 1,
          episode: 1,
        });
        const r = await probeUrl(url, {
          requiresReferer: prov.requiresReferer,
          tlsLax: Boolean(prov.tlsLax),
          timeoutMs: opts.timeoutMs,
        });
        done++;
        if (done % 50 === 0 || done === sampled.length) {
          console.log(`  [${prov.id}] progreso: ${done}/${sampled.length}`);
        }
        return {
          ...r,
          firstAttemptPlayer: r.looksLikePlayer,
          needsReverify: r.unavailableReason === 'pelix-pending',
          retryResolved: false,
          retryResolveMs: null,
        };
      });

      // Re-verificación diferida para títulos que responden pelix-pending en el primer GET
      const configuredPendingMs = Number(prov.pendingMs) > 0 ? Number(prov.pendingMs) : 15000;
      const retryWaits = [configuredPendingMs, 12000];
      let accumulatedWaitMs = 0;

      for (const waitMs of retryWaits) {
        const pendingIndices = [];
        list.forEach((r, idx) => {
          if (r.unavailableReason === 'pelix-pending') pendingIndices.push(idx);
        });
        if (pendingIndices.length === 0) break;

        console.log(`  [${prov.id}] ${pendingIndices.length} ítems con pelix-pending; esperando ${waitMs / 1000}s para re-verificar...`);
        await new Promise((r) => setTimeout(r, waitMs));
        accumulatedWaitMs += waitMs;

        let retryDone = 0;
        await runPool(pendingIndices, perHostConc, async (idx) => {
          const item = sampled[idx];
          const url = buildProviderUrl(prov, {
            tmdbId: item.tmdbId,
            type: item.type === 'series' ? 'series' : 'movie',
            season: 1,
            episode: 1,
          });
          const initial = list[idx];
          const retry = await probeUrl(url, {
            requiresReferer: prov.requiresReferer,
            tlsLax: Boolean(prov.tlsLax),
            timeoutMs: opts.timeoutMs,
          });

          if (retry.responded) {
            const resolved = retry.looksLikePlayer;
            list[idx] = {
              ...retry,
              ttfbMs: initial.ttfbMs,
              firstAttemptPlayer: initial.firstAttemptPlayer,
              needsReverify: true,
              retryResolved: resolved,
              retryResolveMs: resolved ? retry.ttfbMs : null,
              pendingWaitMs: accumulatedWaitMs,
            };
          } else {
            list[idx] = {
              ...initial,
              needsReverify: true,
              retryResolved: false,
              retryResolveMs: null,
              pendingWaitMs: accumulatedWaitMs,
            };
          }

          retryDone++;
          if (retryDone % 25 === 0 || retryDone === pendingIndices.length) {
            console.log(`  [${prov.id}] re-verificación pending: ${retryDone}/${pendingIndices.length}`);
          }
        });
      }

      providerPerItemResults[prov.id] = list;
    })
  );

  // Construir detalle por título y resumen por proveedor
  const catalogDetails = sampled.map((item, idx) => {
    const results = {};
    let anyAlive = false;
    for (const prov of targetProviders) {
      const r = providerPerItemResults[prov.id][idx];
      results[prov.id] = r;
      if (r.looksLikePlayer) anyAlive = true;
    }
    return {
      id: item.id,
      tmdbId: item.tmdbId,
      title: item.title,
      type: item.type,
      category: item.category,
      anyAlive,
      results,
    };
  });

  const orphanIds = catalogDetails.filter((d) => !d.anyAlive).map((d) => d.id);

  const byProvider = {};
  for (const prov of targetProviders) {
    const list = providerPerItemResults[prov.id];
    const httpRespondedCount = list.filter((r) => r.responded).length;
    const httpOkCount = list.filter((r) => r.httpOk).length;
    const firstAttemptAliveCount = list.filter((r) => r.firstAttemptPlayer).length;
    const playerAliveCount = list.filter((r) => r.looksLikePlayer).length;
    const unavailableCount = list.filter((r) => r.unavailableDetected).length;
    const errorCount = list.filter((r) => !r.responded).length;

    const neededRetryList = list.filter((r) => r.needsReverify);
    const resolvedRetryList = neededRetryList.filter((r) => r.retryResolved);
    const retryMsValues = resolvedRetryList.map((r) => r.retryResolveMs).filter((n) => typeof n === 'number');
    const avgRetryResolveMs =
      retryMsValues.length > 0 ? Math.round(retryMsValues.reduce((a, b) => a + b, 0) / retryMsValues.length) : null;

    const ttfbs = list.map((r) => r.ttfbMs).filter((n) => typeof n === 'number');
    const avgTtfbMs = ttfbs.length > 0 ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;

    const firstAttemptCoveragePct = Number(((firstAttemptAliveCount / list.length) * 100).toFixed(1));
    const afterRetryCoveragePct = Number(((playerAliveCount / list.length) * 100).toFixed(1));

    byProvider[prov.id] = {
      name: prov.name,
      priority: prov.priority,
      tlsLax: Boolean(prov.tlsLax),
      pendingMs: Number(prov.pendingMs) || 0,
      tested: list.length,
      httpRespondedCount,
      httpRespondedPct: Number(((httpRespondedCount / list.length) * 100).toFixed(1)),
      httpOkCount,
      httpOkPct: Number(((httpOkCount / list.length) * 100).toFixed(1)),
      firstAttemptAliveCount,
      firstAttemptCoveragePct,
      afterRetryAliveCount: playerAliveCount,
      afterRetryCoveragePct,
      playerAliveCount,
      coveragePct: afterRetryCoveragePct,
      retryStats: {
        neededCount: neededRetryList.length,
        resolvedCount: resolvedRetryList.length,
        unresolvedCount: neededRetryList.length - resolvedRetryList.length,
        avgResolveTtfbMs: avgRetryResolveMs,
        minResolveTtfbMs: retryMsValues.length > 0 ? Math.min(...retryMsValues) : null,
        maxResolveTtfbMs: retryMsValues.length > 0 ? Math.max(...retryMsValues) : null,
      },
      unavailableCount,
      errorCount,
      avgTtfbMs,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const reportsDir = path.join(ROOT_DIR, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const suffix = opts.only ? `-${opts.only.join('-').replace(/[^a-z0-9._-]+/gi, '_')}` : '';
  const reportPath = path.join(reportsDir, `providers-${today}${suffix}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    timeoutMs: opts.timeoutMs,
    sampleSize: sampled.length,
    only: opts.only,
    providersConfigPath: 'src/data/providers.json',
    disabledProviders: disabledProviders.map((p) => ({
      id: p.id,
      name: p.name,
      notes: p.notes,
    })),
    canaries,
    canaryResults,
    catalogSummary: {
      totalSampled: sampled.length,
      byProvider,
      orphanCount: orphanIds.length,
      orphanIds,
    },
    catalogDetails,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== RESUMEN POR PROVEEDOR ===');
  const header = [
    padCell('Proveedor', 26),
    padCell('Cob. 1er intento', 18),
    padCell('Cob. tras reintento', 20),
    padCell('Re-verif (res/req, ms)', 24),
    padCell('HTTP resp', 15),
    padCell('Err', 5, true),
    padCell('TTFB prom', 9, true),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const prov of targetProviders) {
    const s = byProvider[prov.id];
    const col1 = `${s.firstAttemptCoveragePct}% (${s.firstAttemptAliveCount}/${s.tested})`;
    const col2 = `${s.afterRetryCoveragePct}% (${s.afterRetryAliveCount}/${s.tested})`;
    const rs = s.retryStats;
    const colRetry =
      rs.neededCount > 0
        ? `${rs.resolvedCount}/${rs.neededCount} (${rs.avgResolveTtfbMs ?? '-'}ms)`
        : '0/0 (-)';
    const colHttp = `${s.httpRespondedCount}/${s.tested} (${s.httpRespondedPct}%)`;

    console.log(
      [
        padCell(`${s.name} [${prov.id}]`.slice(0, 26), 26),
        padCell(col1, 18),
        padCell(col2, 20),
        padCell(colRetry, 24),
        padCell(colHttp, 15),
        padCell(s.errorCount, 5, true),
        padCell(`${s.avgTtfbMs ?? '-'}ms`, 9, true),
      ].join(' | ')
    );
  }
  console.log(`\nTotal títulos huérfanos (sin ningún proveedor vivo): ${orphanIds.length}/${sampled.length}`);
  console.log(`Reporte guardado en: ${path.relative(ROOT_DIR, reportPath)}`);
}

main().catch((err) => {
  console.error('[probe-providers] Error fatal:', err);
  process.exit(1);
});
