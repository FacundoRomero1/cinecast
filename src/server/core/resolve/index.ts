import {
  getProviderConfig,
  loadProvidersConfig,
  type ProviderConfig,
} from './config.js';
import {
  httpGetFirstBytes,
  httpPostForm,
  httpRequestFollowingRedirects,
} from './http.js';
import {
  buildCoalescingKey,
  getQueueStats,
  normalizeResolveKeyParams,
  resetQueueMetricsAndInFlight,
  runWithQueueAndCoalescing,
  runWithQueueAndCoalescingKey,
  type MediaResolveType,
} from './queue.js';
import {
  clearResolveCache,
  getCachedResolve,
  getCachedServerList,
  getResolveCacheStats,
  SERVER_LIST_HLS_TTL_MS,
  SERVER_LIST_IFRAME_TTL_MS,
  setCachedServerList,
  setNegativeCache,
  setPositiveCache,
  type ResolveResult,
  type ResolvedServerEntry,
  type ServerPlayable,
} from './cache.js';
import {
  canExecuteWithBreaker,
  getAllBreakerStates,
  getBreakerState,
  recordBreakerFailure,
  recordBreakerSuccess,
  resetBreaker,
  type BreakerStateSnapshot,
} from './breaker.js';

export type {
  ResolveResult,
  ResolveStatus,
  ResolvedServerEntry,
  ServerPlayable,
} from './cache.js';
export type { MediaResolveType } from './queue.js';
export type { BreakerStateSnapshot } from './breaker.js';

export type ServerLanguage = 'latino' | 'sub' | (string & {});

export interface ResolveParams {
  tmdbId: number;
  type: MediaResolveType;
  season?: number | undefined;
  episode?: number | undefined;
}

export interface GetServersParams extends ResolveParams {
  lang?: ServerLanguage | undefined;
}

export interface GetServersResult {
  providerId: string;
  tmdbId: number;
  type: MediaResolveType;
  lang: string;
  status: 'ready' | 'empty' | 'degraded';
  servers: ResolvedServerEntry[];
  total: number;
  hasHls: boolean;
  truncated: boolean;
  cached: boolean;
  waitedMs: number;
  httpRequests: number;
}

const MAX_PROBE_TOTAL_MS = 45_000;
const SINGLE_REQUEST_TIMEOUT_MS = 12_000;
const SECOND_RETRY_DELAY_MS = 12_000;

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

const resolveMetrics = {
  totalCalls: 0,
  cacheHits: 0,
  staleHits: 0,
  softDeadlineHits: 0,
  breakerShortCircuits: 0,
  probeExecutions: 0,
  outboundHttpRequests: 0,
  timeouts: 0,
  perProvider: {} as Record<
    string,
    {
      calls: number;
      cacheHits: number;
      executions: number;
      outboundHttpRequests: number;
      timeouts: number;
    }
  >,
};

function touchProviderMetric(providerId: string) {
  let entry = resolveMetrics.perProvider[providerId];
  if (!entry) {
    entry = {
      calls: 0,
      cacheHits: 0,
      executions: 0,
      outboundHttpRequests: 0,
      timeouts: 0,
    };
    resolveMetrics.perProvider[providerId] = entry;
  }
  return entry;
}

export function buildProviderUrl(config: ProviderConfig, params: ResolveParams): string {
  const norm = normalizeResolveKeyParams(params);
  const isTV = norm.type === 'series' || norm.type === 'anime';
  const template = isTV ? config.urlTvEpisode || config.urlTv : config.urlMovie;

  return String(template || '')
    .replaceAll('{tmdbId}', String(norm.tmdbId))
    .replaceAll('{season}', String(norm.season))
    .replaceAll('{episode}', String(norm.episode));
}

async function fetchHtmlFollowingRedirects(
  urlString: string,
  options: { requiresReferer: boolean; tlsLax: boolean; timeoutMs: number; maxRedirects?: number }
): Promise<{ status: number; body: string }> {
  const res = await httpRequestFollowingRedirects(urlString, {
    method: 'GET',
    requiresReferer: options.requiresReferer,
    tlsLax: options.tlsLax,
    timeoutMs: options.timeoutMs,
    maxRedirects: options.maxRedirects ?? 5,
    retries: 1,
  });
  return { status: res.status, body: res.body };
}

export interface ParsedPelixState {
  pelixServerCount: number | null;
  pelixPending: boolean;
  looksLikePlayer: boolean;
  unavailableDetected: boolean;
}

export function parseProviderHtml(body: string, httpStatus: number): ParsedPelixState {
  const safeBody = typeof body === 'string' ? body : '';
  const bytes = Buffer.byteLength(safeBody, 'utf8');

  let pelixServerCount: number | null = null;
  let pelixPending = false;

  const pelixMatch = safeBody.match(/window\.PELIX_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (pelixMatch && pelixMatch[1]) {
    try {
      const cfg = JSON.parse(pelixMatch[1]) as {
        langs?: Record<string, { servers?: unknown[] }> | unknown[];
        content?: { pending?: boolean };
      };
      const langs =
        cfg?.langs && typeof cfg.langs === 'object'
          ? Object.values(cfg.langs as Record<string, { servers?: unknown[] }>)
          : [];
      pelixServerCount = langs.reduce(
        (sum, entry) => sum + (Array.isArray(entry?.servers) ? entry.servers.length : 0),
        0
      );
      pelixPending = Boolean(cfg?.content?.pending);
    } catch {
      // invalid PELIX_CONFIG JSON
    }
  }

  let visibleHtml = safeBody
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  if (pelixServerCount !== null && pelixServerCount > 0 && !pelixPending) {
    visibleHtml = visibleHtml.replace(/<div\s+id=["']unavailable-notice["'][\s\S]*?<\/div>\s*<\/div>/i, ' ');
  }

  const visibleText = visibleHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const matchedPhrase = UNAVAILABLE_PHRASES.some((phrase) => visibleText.includes(phrase));
  const httpOk = httpStatus >= 200 && httpStatus < 400;
  const cfChallenge =
    httpStatus === 403 ||
    httpStatus === 503 ||
    httpStatus === 523 ||
    /just a moment|attention required|checking your browser|cf-browser-verification/i.test(visibleText);

  const unavailableDetected =
    (pelixServerCount !== null && (pelixServerCount === 0 || pelixPending)) ||
    matchedPhrase ||
    cfChallenge;

  const hasVideoOrIframe = /<video\b|<iframe\b[^>]*>|hls\.js|plyr|embed-iframe|fluid-video/i.test(safeBody);
  const looksLikePlayer = httpOk && !unavailableDetected && bytes > 250 && hasVideoOrIframe;

  return {
    pelixServerCount,
    pelixPending,
    looksLikePlayer,
    unavailableDetected,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function executeUpstreamProbe(
  provider: ProviderConfig,
  targetUrl: string,
  baseDir?: string
): Promise<{ result: ResolveResult; upstreamError: boolean }> {
  const probeStart = Date.now();
  const deadline = probeStart + MAX_PROBE_TOTAL_MS;
  const pMetric = touchProviderMetric(provider.id);
  const isTukiPlay = provider.id === 'tukiplay';

  const firstDelay =
    typeof provider.pendingMs === 'number' && provider.pendingMs > 0 ? provider.pendingMs : 15_000;
  const retryDelays = isTukiPlay ? [firstDelay, SECOND_RETRY_DELAY_MS] : [];

  let retryStep = 0;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) {
      return {
        result: {
          status: 'empty',
          url: targetUrl,
          serverCount: 0,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: false,
      };
    }

    const reqTimeout = Math.min(SINGLE_REQUEST_TIMEOUT_MS, remaining);
    resolveMetrics.outboundHttpRequests += 1;
    pMetric.outboundHttpRequests += 1;

    let res: { status: number; body: string };
    try {
      res = await fetchHtmlFollowingRedirects(targetUrl, {
        requiresReferer: provider.requiresReferer,
        tlsLax: Boolean(provider.tlsLax),
        timeoutMs: reqTimeout,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'TIMEOUT_ERR') {
        resolveMetrics.timeouts += 1;
        pMetric.timeouts += 1;
      }
      return {
        result: {
          status: 'degraded',
          url: targetUrl,
          serverCount: 0,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: true,
      };
    }

    // Errores de servidor o bloqueo anti-bot -> falla de upstream para circuit breaker
    if (res.status >= 500 || res.status === 403 || res.status === 429) {
      return {
        result: {
          status: 'degraded',
          url: targetUrl,
          serverCount: 0,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: true,
      };
    }

    if (res.status >= 400) {
      return {
        result: {
          status: 'empty',
          url: targetUrl,
          serverCount: 0,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: false,
      };
    }

    const parsed = parseProviderHtml(res.body, res.status);

    if (parsed.pelixServerCount !== null) {
      if (parsed.pelixServerCount > 0) {
        return {
          result: {
            status: 'ready',
            url: targetUrl,
            serverCount: parsed.pelixServerCount,
            waitedMs: Date.now() - probeStart,
          },
          upstreamError: false,
        };
      }

      if (parsed.pelixPending) {
        const nextDelay = retryDelays[retryStep];
        retryStep += 1;
        const leftAfterWait = deadline - (Date.now() + (nextDelay ?? 0));
        if (nextDelay !== undefined && leftAfterWait > 500) {
          await sleep(nextDelay);
          continue;
        }
        // Corta a los 45s con 'empty'
        return {
          result: {
            status: 'empty',
            url: targetUrl,
            serverCount: 0,
            waitedMs: Math.min(MAX_PROBE_TOTAL_MS, Date.now() - probeStart),
          },
          upstreamError: false,
        };
      }

      // pelixServerCount === 0 y !pelixPending (sin servidores reales)
      return {
        result: {
          status: 'empty',
          url: targetUrl,
          serverCount: 0,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: false,
      };
    }

    // Proveedor no-Pelix
    if (parsed.looksLikePlayer) {
      return {
        result: {
          status: 'ready',
          url: targetUrl,
          serverCount: 1,
          waitedMs: Date.now() - probeStart,
        },
        upstreamError: false,
      };
    }

    // baseDir unused here beyond config lookup consistency
    void baseDir;
    return {
      result: {
        status: 'empty',
        url: targetUrl,
        serverCount: 0,
        waitedMs: Date.now() - probeStart,
      },
      upstreamError: false,
    };
  }
}

function triggerQueuedResolve(
  provider: ProviderConfig,
  params: ResolveParams,
  targetUrl: string,
  baseDir?: string
): Promise<ResolveResult> {
  const key = buildCoalescingKey(provider.id, params);

  const { promise } = runWithQueueAndCoalescing<ResolveResult>(
    provider.id,
    params,
    async () => {
      if (!canExecuteWithBreaker(provider.id, provider)) {
        resolveMetrics.breakerShortCircuits += 1;
        return {
          status: 'degraded',
          url: targetUrl,
          serverCount: 0,
          waitedMs: 0,
        };
      }

      resolveMetrics.probeExecutions += 1;
      touchProviderMetric(provider.id).executions += 1;

      try {
        const { result, upstreamError } = await executeUpstreamProbe(provider, targetUrl, baseDir);
        if (upstreamError) {
          recordBreakerFailure(provider.id, provider);
          return result;
        }

        recordBreakerSuccess(provider.id, provider, result.waitedMs);

        if (result.status === 'ready' && result.serverCount > 0) {
          setPositiveCache(key, result, provider.swrTtlMs);
        } else if (result.status === 'empty') {
          setNegativeCache(key, result, provider.negativeTtlMs);
        }

        return result;
      } catch {
        recordBreakerFailure(provider.id, provider);
        return {
          status: 'degraded',
          url: targetUrl,
          serverCount: 0,
          waitedMs: 0,
        };
      }
    },
    baseDir
  );

  return promise;
}

/**
 * Consulta síncrona en caché (sin encolar). Si es SWR stale, dispara revalidación
 * en segundo plano compartiendo cola + coalescing.
 */
export function peekCachedResolve(
  providerId: string,
  params: ResolveParams,
  baseDir?: string
): ResolveResult | null {
  const provider = getProviderConfig(providerId, baseDir);
  if (!provider) return null;

  const key = buildCoalescingKey(providerId, params);
  const cached = getCachedResolve(key);
  if (!cached) return null;

  resolveMetrics.cacheHits += 1;
  touchProviderMetric(providerId).cacheHits += 1;

  if (cached.stale && provider.enabled) {
    resolveMetrics.staleHits += 1;
    const targetUrl = buildProviderUrl(provider, params);
    if (canExecuteWithBreaker(provider.id, provider)) {
      void triggerQueuedResolve(provider, params, targetUrl, baseDir).catch(() => {});
    }
  }

  return {
    ...cached.value,
    waitedMs: 0,
  };
}

export interface ResolveHandle {
  firstPromise: Promise<ResolveResult>;
  completionPromise: Promise<ResolveResult>;
  timedOutSoft: () => boolean;
}

/**
 * Resuelve con deadline blando (softDeadlineMs):
 * - Si el upstream excede `softDeadlineMs`, `firstPromise` responde `'degraded'` con la URL armada
 *   sin cancelar el job en segundo plano (`completionPromise` sigue, llena caché y actualiza breaker).
 */
export function resolveWithBackground(
  providerId: string,
  params: ResolveParams,
  baseDir?: string
): ResolveHandle {
  const callStartedAt = Date.now();
  resolveMetrics.totalCalls += 1;
  touchProviderMetric(providerId).calls += 1;

  const provider = getProviderConfig(providerId, baseDir);
  if (!provider) {
    const imm: ResolveResult = {
      status: 'degraded',
      url: '',
      serverCount: 0,
      waitedMs: 0,
    };
    const p = Promise.resolve(imm);
    return { firstPromise: p, completionPromise: p, timedOutSoft: () => false };
  }

  const targetUrl = buildProviderUrl(provider, params);

  if (!provider.enabled) {
    const imm: ResolveResult = {
      status: 'degraded',
      url: targetUrl,
      serverCount: 0,
      waitedMs: 0,
    };
    const p = Promise.resolve(imm);
    return { firstPromise: p, completionPromise: p, timedOutSoft: () => false };
  }

  // 1. Caché SWR en memoria
  const key = buildCoalescingKey(providerId, params);
  const cached = getCachedResolve(key);
  if (cached) {
    resolveMetrics.cacheHits += 1;
    touchProviderMetric(providerId).cacheHits += 1;

    if (cached.stale && canExecuteWithBreaker(provider.id, provider)) {
      resolveMetrics.staleHits += 1;
      void triggerQueuedResolve(provider, params, targetUrl, baseDir).catch(() => {});
    }

    const hit: ResolveResult = {
      ...cached.value,
      waitedMs: 0,
    };
    const p = Promise.resolve(hit);
    return { firstPromise: p, completionPromise: p, timedOutSoft: () => false };
  }

  // 2. Circuit breaker abierto -> respuesta inmediata 'degraded' con URL armada
  if (!canExecuteWithBreaker(provider.id, provider)) {
    resolveMetrics.breakerShortCircuits += 1;
    const imm: ResolveResult = {
      status: 'degraded',
      url: targetUrl,
      serverCount: 0,
      waitedMs: Date.now() - callStartedAt,
    };
    const p = Promise.resolve(imm);
    return { firstPromise: p, completionPromise: p, timedOutSoft: () => false };
  }

  // 3. Cola FIFO + coalescing con deadline blando no cancelatorio
  const workPromise = triggerQueuedResolve(provider, params, targetUrl, baseDir);
  const completionPromise = workPromise.then((settled) => ({
    ...settled,
    waitedMs: Date.now() - callStartedAt,
  }));

  const softDeadlineMs =
    typeof provider.softDeadlineMs === 'number' &&
    Number.isFinite(provider.softDeadlineMs) &&
    provider.softDeadlineMs > 0
      ? provider.softDeadlineMs
      : 4000;

  let softExpired = false;
  const firstPromise = new Promise<ResolveResult>((resolveFirst) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      softExpired = true;
      resolveMetrics.softDeadlineHits += 1;
      resolveFirst({
        status: 'degraded',
        url: targetUrl,
        serverCount: 0,
        waitedMs: Date.now() - callStartedAt,
      });
    }, softDeadlineMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    void completionPromise.then((finalRes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveFirst(finalRes);
    });
  });

  // Evita unhandled rejection si un caller solo espera firstPromise
  void completionPromise.catch(() => {});

  return {
    firstPromise,
    completionPromise,
    timedOutSoft: () => softExpired,
  };
}

/**
 * Resuelve la disponibilidad real de un título en un proveedor embed usando:
 * - caché SWR en memoria (positivas/negativas con TTL propio)
 * - circuit breaker por ventana deslizante (responde 'degraded' inmediato si está abierto)
 * - cola FIFO por host + coalescing por `${providerId}:${type}:${tmdbId}:${season}:${episode}`
 * - deadline blando (softDeadlineMs): devuelve `'degraded'` con la URL armada sin cancelar el job.
 */
export async function resolve(
  providerId: string,
  params: ResolveParams,
  baseDir?: string
): Promise<ResolveResult> {
  return resolveWithBackground(providerId, params, baseDir).firstPromise;
}

interface PelixRawServerItem {
  id?: number | string;
  link_name?: string;
  server?: string;
  link?: string;
  play?: string;
  original?: string;
  stream_url?: string;
  cdn_url?: string;
  picks?: number | string;
  popular?: number | string;
}

interface PelixLangBlock {
  name?: string;
  servers?: PelixRawServerItem[];
}

interface PelixConfigPayload {
  edge?: string;
  token?: { validtime?: string; token?: string };
  content?: { id?: number | string; type?: string; pending?: boolean };
  langs?: Record<string, PelixLangBlock>;
}

interface EdgeApiResponse {
  codigo?: number;
  url?: string;
  validtime?: string;
  token?: string;
  total?: number;
  empty?: boolean;
  servers?: Record<string, PelixLangBlock>;
  stream_url?: string;
  cdn_url?: string;
  original?: string;
}

function cleanStr(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function normalizeServerLang(lang?: string): string {
  const clean = cleanStr(lang).toLowerCase();
  if (!clean) return 'latino';
  return clean;
}

/**
 * Extrae `window.PELIX_CONFIG = {...}` balanceando llaves dentro de strings.
 */
function extractPelixConfigObject(html: string): PelixConfigPayload | null {
  const marker = 'window.PELIX_CONFIG';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = html.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inStr = false;
  let quote = '';
  let escaped = false;

  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inStr = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1)) as PelixConfigPayload;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isBlockedEarnvidsCdnHost(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return host.includes('acek-cdn') || host.includes('dramiyos');
  } catch {
    return false;
  }
}

function buildOrderedHlsCandidates(streamUrl: string, cdnUrl: string): string[] {
  const out: string[] = [];
  if (streamUrl && !isBlockedEarnvidsCdnHost(streamUrl)) {
    out.push(streamUrl);
  }
  if (cdnUrl && !isBlockedEarnvidsCdnHost(cdnUrl) && !out.includes(cdnUrl)) {
    out.push(cdnUrl);
  }
  return out;
}

async function validateHlsPlaylist(
  urlStr: string,
  tlsLax: boolean,
  counter: { count: number },
  providerId: string,
  deadlineAt: number
): Promise<boolean> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 250) return false;
  try {
    counter.count += 1;
    resolveMetrics.outboundHttpRequests += 1;
    touchProviderMetric(providerId).outboundHttpRequests += 1;

    const timeoutMs = Math.min(6_000, remaining);
    const res = await httpGetFirstBytes(urlStr, 512, {
      tlsLax,
      timeoutMs,
      retries: remaining > 12_000 ? 1 : 0,
      requiresReferer: false,
    });
    return res.status >= 200 && res.status < 400 && res.body.trimStart().startsWith('#EXTM3U');
  } catch {
    return false;
  }
}

async function postEdgeJson(
  edgeUrl: string,
  embedUrl: string,
  fields: Record<string, string>,
  tlsLax: boolean,
  counter: { count: number },
  providerId: string,
  deadlineAt: number,
  maxTimeoutMs = 15_000
): Promise<{ status: number; json: EdgeApiResponse | null }> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 250) {
    const err = new Error('Hard timeout reached before POST /edge-data');
    (err as Error & { code?: string }).code = 'HARD_TIMEOUT_ERR';
    throw err;
  }

  counter.count += 1;
  resolveMetrics.outboundHttpRequests += 1;
  touchProviderMetric(providerId).outboundHttpRequests += 1;

  const timeoutMs = Math.min(maxTimeoutMs, remaining);
  const origin = new URL(edgeUrl).origin;
  const res = await httpPostForm(edgeUrl, fields, {
    tlsLax,
    timeoutMs,
    retries: remaining > timeoutMs * 2 ? 1 : 0,
    headers: {
      Referer: embedUrl,
      Origin: origin,
    },
  });

  if (!res.body) {
    return { status: res.status, json: null };
  }
  try {
    return { status: res.status, json: JSON.parse(res.body) as EdgeApiResponse };
  } catch {
    return { status: res.status, json: null };
  }
}

async function resolveSingleServerEntry(
  srv: PelixRawServerItem,
  requestedLang: string,
  ctx: {
    providerId: string;
    edgeUrl: string;
    embedUrl: string;
    token: { validtime: string; token: string };
    tlsLax: boolean;
    counter: { count: number };
    deadlineAt: number;
  }
): Promise<ResolvedServerEntry | null> {
  if (Date.now() >= ctx.deadlineAt) {
    return null;
  }

  let streamUrl = cleanStr(srv.stream_url);
  let cdnUrl = cleanStr(srv.cdn_url);
  let playUrl = cleanStr(srv.play);
  let originalUrl = cleanStr(srv.original);
  const link = cleanStr(srv.link);

  // Solo si no trae ninguna de las cuatro URLs, POST streaming=<link> una vez
  if (!streamUrl && !cdnUrl && !playUrl && !originalUrl && link) {
    try {
      const streamingRes = await postEdgeJson(
        ctx.edgeUrl,
        ctx.embedUrl,
        {
          streaming: link,
          validtime: ctx.token.validtime,
          token: ctx.token.token,
        },
        ctx.tlsLax,
        ctx.counter,
        ctx.providerId,
        ctx.deadlineAt,
        15_000
      );
      if (streamingRes.json && streamingRes.json.codigo === 200) {
        streamUrl = cleanStr(streamingRes.json.stream_url) || streamUrl;
        cdnUrl = cleanStr(streamingRes.json.cdn_url) || cdnUrl;
        playUrl = cleanStr(streamingRes.json.url) || playUrl;
        originalUrl = cleanStr(streamingRes.json.original) || originalUrl;
      }
    } catch {
      // sigue sin streaming= si falla o vence deadline
    }
  }

  let resolvedUrl = '';
  let playable: ServerPlayable = 'iframe';

  const hlsCandidates = buildOrderedHlsCandidates(streamUrl, cdnUrl);
  if (hlsCandidates.length > 0) {
    let validHls = '';
    for (const candidate of hlsCandidates) {
      if (Date.now() >= ctx.deadlineAt) break;
      const ok = await validateHlsPlaylist(
        candidate,
        ctx.tlsLax,
        ctx.counter,
        ctx.providerId,
        ctx.deadlineAt
      );
      if (ok) {
        validHls = candidate;
        break;
      }
    }
    if (validHls) {
      resolvedUrl = validHls;
      playable = 'hls';
    } else {
      // Degradar a iframe con `original` (o `play` si `original` no vino en el listado)
      resolvedUrl = originalUrl || playUrl;
      playable = 'iframe';
    }
  } else if (playUrl) {
    resolvedUrl = playUrl;
    playable = 'iframe';
  } else if (originalUrl) {
    resolvedUrl = originalUrl;
    playable = 'iframe';
  }

  if (!resolvedUrl) {
    return null;
  }

  const name = cleanStr(srv.link_name || srv.server) || 'Desconocido';
  return {
    id: srv.id ?? name,
    name,
    lang: requestedLang,
    popular: Number(srv.popular) || 0,
    picks: Number(srv.picks) || 0,
    url: resolvedUrl,
    playable,
    validated: true,
  };
}

function buildUnvalidatedServerEntry(
  srv: PelixRawServerItem,
  requestedLang: string
): ResolvedServerEntry | null {
  const streamUrl = cleanStr(srv.stream_url);
  const cdnUrl = cleanStr(srv.cdn_url);
  const playUrl = cleanStr(srv.play);
  const originalUrl = cleanStr(srv.original);

  let resolvedUrl = '';
  let playable: ServerPlayable = 'iframe';

  const hlsCandidates = buildOrderedHlsCandidates(streamUrl, cdnUrl);
  const firstHls = hlsCandidates[0];
  if (firstHls) {
    resolvedUrl = firstHls;
    playable = 'hls';
  } else if (playUrl) {
    resolvedUrl = playUrl;
    playable = 'iframe';
  } else if (originalUrl) {
    resolvedUrl = originalUrl;
    playable = 'iframe';
  }

  if (!resolvedUrl) {
    return null;
  }

  const name = cleanStr(srv.link_name || srv.server) || 'Desconocido';
  return {
    id: srv.id ?? name,
    name,
    lang: requestedLang,
    popular: Number(srv.popular) || 0,
    picks: Number(srv.picks) || 0,
    url: resolvedUrl,
    playable,
    validated: false,
  };
}

const TARGET_VALID_HLS_COUNT = 2;
const MAX_VALIDATIONS_PER_TITLE = 10;
const MAX_RETURNED_SERVERS = 6;

function sortResolvedServerEntries(entries: ResolvedServerEntry[]): ResolvedServerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.validated !== b.validated) {
      return a.validated ? -1 : 1;
    }
    if (a.playable !== b.playable) {
      return a.playable === 'hls' ? -1 : 1;
    }
    if (b.popular !== a.popular) {
      return b.popular - a.popular;
    }
    return b.picks - a.picks;
  });
}

function findLanguageBlock(
  serversMap: Record<string, PelixLangBlock> | undefined,
  lang: string
): PelixLangBlock | null {
  if (!serversMap || typeof serversMap !== 'object') return null;
  if (serversMap[lang]) return serversMap[lang];
  const lower = lang.toLowerCase();
  for (const [k, v] of Object.entries(serversMap)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Resuelve la lista de servidores de un título usando `/edge-data` en dos fases:
 * 1) Ordena por `popular` desc. y valida hasta alcanzar 2 HLS válidos (`#EXTM3U`) o 10 validaciones (`validated: true`).
 * 2) Conserva los restantes que ya tengan URL/playable sin validar (`validated: false`).
 * Ordena (`validated` primero; dentro de cada grupo `hls` antes que `iframe`, luego `popular` desc.),
 * cachea la lista completa (15 min si hay HLS válido, 5 min si solo iframe) y devuelve los primeros 6 + `total`.
 */
export async function getServers(
  providerId: string,
  params: GetServersParams,
  baseDir?: string
): Promise<GetServersResult> {
  const startedAt = Date.now();
  const requestedLang = normalizeServerLang(params.lang);
  const norm = normalizeResolveKeyParams(params);
  const provider = getProviderConfig(providerId, baseDir);

  if (!provider || !provider.enabled) {
    return {
      providerId,
      tmdbId: norm.tmdbId,
      type: norm.type,
      lang: requestedLang,
      status: 'degraded',
      servers: [],
      total: 0,
      hasHls: false,
      truncated: false,
      cached: false,
      waitedMs: Date.now() - startedAt,
      httpRequests: 0,
    };
  }

  const cacheKey = `servers:${providerId}:${norm.type}:${norm.tmdbId}:${norm.season}:${norm.episode}:${requestedLang}`;
  const cached = getCachedServerList(cacheKey);
  if (cached) {
    return {
      providerId,
      tmdbId: norm.tmdbId,
      type: norm.type,
      lang: requestedLang,
      status: cached.value.total > 0 ? 'ready' : 'empty',
      servers: cached.value.servers.slice(0, MAX_RETURNED_SERVERS),
      total: cached.value.total,
      hasHls: cached.value.hasHls,
      truncated: false,
      cached: true,
      waitedMs: 0,
      httpRequests: 0,
    };
  }

  if (!canExecuteWithBreaker(provider.id, provider)) {
    return {
      providerId,
      tmdbId: norm.tmdbId,
      type: norm.type,
      lang: requestedLang,
      status: 'degraded',
      servers: [],
      total: 0,
      hasHls: false,
      truncated: false,
      cached: false,
      waitedMs: Date.now() - startedAt,
      httpRequests: 0,
    };
  }

  const { promise } = runWithQueueAndCoalescingKey<GetServersResult>(
    provider.id,
    cacheKey,
    async () => {
      const workStart = Date.now();
      const hardTimeoutMs =
        typeof provider.hardTimeoutMs === 'number' &&
        Number.isFinite(provider.hardTimeoutMs) &&
        provider.hardTimeoutMs > 0
          ? provider.hardTimeoutMs
          : 25_000;
      const deadlineAt = workStart + hardTimeoutMs;
      const counter = { count: 0 };
      const embedUrl = buildProviderUrl(provider, params);
      const tlsLax = Boolean(provider.tlsLax);
      const pMetric = touchProviderMetric(provider.id);

      const resolvedEntries: ResolvedServerEntry[] = [];
      let baseChainRecorded = false;
      let abortedByHardTimeout = false;

      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      const hardTimeoutPromise = new Promise<'hard_timeout'>((resolveTimeout) => {
        hardTimer = setTimeout(() => {
          abortedByHardTimeout = true;
          resolveTimeout('hard_timeout');
        }, hardTimeoutMs);
        if (typeof hardTimer.unref === 'function') {
          hardTimer.unref();
        }
      });

      const workPromise = (async (): Promise<GetServersResult> => {
        try {
          counter.count += 1;
          resolveMetrics.outboundHttpRequests += 1;
          pMetric.outboundHttpRequests += 1;

          const remEmbed = Math.max(250, deadlineAt - Date.now());
          const embedRes = await httpRequestFollowingRedirects(embedUrl, {
            method: 'GET',
            requiresReferer: provider.requiresReferer,
            tlsLax,
            timeoutMs: Math.min(SINGLE_REQUEST_TIMEOUT_MS, remEmbed),
            retries: remEmbed > SINGLE_REQUEST_TIMEOUT_MS * 2 ? 1 : 0,
          });

          if (embedRes.status >= 500 || embedRes.status === 403 || embedRes.status === 429) {
            baseChainRecorded = true;
            recordBreakerFailure(provider.id, provider);
            return {
              providerId,
              tmdbId: norm.tmdbId,
              type: norm.type,
              lang: requestedLang,
              status: 'degraded',
              servers: [],
              total: 0,
              hasHls: false,
              truncated: false,
              cached: false,
              waitedMs: Date.now() - workStart,
              httpRequests: counter.count,
            };
          }

          const cfg = extractPelixConfigObject(embedRes.body);
          const initToken = cleanStr(cfg?.token?.token);
          const initValidtime = cleanStr(cfg?.token?.validtime);
          const contentId = cfg?.content?.id;
          const contentType =
            cleanStr(cfg?.content?.type) || (norm.type === 'movie' ? 'movie' : 'episode');

          if (!cfg || !initToken || !initValidtime || contentId === undefined || contentId === null) {
            baseChainRecorded = true;
            recordBreakerSuccess(provider.id, provider, Date.now() - workStart);
            setCachedServerList(
              cacheKey,
              { servers: [], total: 0, hasHls: false },
              SERVER_LIST_IFRAME_TTL_MS
            );
            return {
              providerId,
              tmdbId: norm.tmdbId,
              type: norm.type,
              lang: requestedLang,
              status: 'empty',
              servers: [],
              total: 0,
              hasHls: false,
              truncated: false,
              cached: false,
              waitedMs: Date.now() - workStart,
              httpRequests: counter.count,
            };
          }

          const edgeUrl = new URL(cleanStr(cfg.edge) || '/edge-data', embedRes.finalUrl).toString();
          let activeToken = { validtime: initValidtime, token: initToken };

          // b. POST action=token
          const tokenResp = await postEdgeJson(
            edgeUrl,
            embedRes.finalUrl,
            {
              action: 'token',
              validtime: activeToken.validtime,
              token: activeToken.token,
            },
            tlsLax,
            counter,
            provider.id,
            deadlineAt,
            10_000
          );
          if (
            tokenResp.json?.codigo === 200 &&
            cleanStr(tokenResp.json.token) &&
            cleanStr(tokenResp.json.validtime)
          ) {
            activeToken = {
              validtime: cleanStr(tokenResp.json.validtime),
              token: cleanStr(tokenResp.json.token),
            };
          }

          // c. POST action=servers
          const serversResp = await postEdgeJson(
            edgeUrl,
            embedRes.finalUrl,
            {
              action: 'servers',
              id: String(contentId),
              type: String(contentType),
              validtime: activeToken.validtime,
              token: activeToken.token,
            },
            tlsLax,
            counter,
            provider.id,
            deadlineAt,
            10_000
          );

          // Breaker evalúa solo la cadena base (embed + token + servers), nunca el fan-out
          const baseChainMs = Date.now() - workStart;
          baseChainRecorded = true;
          recordBreakerSuccess(provider.id, provider, baseChainMs);

          const langBlock = findLanguageBlock(serversResp.json?.servers, requestedLang);
          const rawList = Array.isArray(langBlock?.servers) ? langBlock.servers : [];

          // 1) Ordenar por popular descendente ANTES de validar en dos fases:
          // Fase 1: validar hasta alcanzar 2 HLS válidos o 10 validaciones (lo que ocurra primero)
          const preSortedCandidates = [...rawList].sort((a, b) => {
            const popDiff = (Number(b.popular) || 0) - (Number(a.popular) || 0);
            if (popDiff !== 0) return popDiff;
            return (Number(b.picks) || 0) - (Number(a.picks) || 0);
          });

          let truncated = false;
          let validHlsCount = 0;
          let validationCount = 0;
          let nextUnvalidatedIdx = 0;

          for (let idx = 0; idx < preSortedCandidates.length; idx += 1) {
            if (
              validHlsCount >= TARGET_VALID_HLS_COUNT ||
              validationCount >= MAX_VALIDATIONS_PER_TITLE
            ) {
              break;
            }
            if (abortedByHardTimeout || Date.now() >= deadlineAt) {
              truncated = true;
              break;
            }

            const srv = preSortedCandidates[idx];
            nextUnvalidatedIdx = idx + 1;
            if (!srv) continue;
            const hasRawOrLink = Boolean(
              cleanStr(srv.stream_url) ||
                cleanStr(srv.cdn_url) ||
                cleanStr(srv.play) ||
                cleanStr(srv.original) ||
                cleanStr(srv.link)
            );
            if (!hasRawOrLink) {
              continue;
            }

            const entry = await resolveSingleServerEntry(srv, requestedLang, {
              providerId: provider.id,
              edgeUrl,
              embedUrl: embedRes.finalUrl,
              token: activeToken,
              tlsLax,
              counter,
              deadlineAt,
            });

            if (abortedByHardTimeout) {
              break;
            }
            validationCount += 1;
            if (entry) {
              resolvedEntries.push(entry);
              if (entry.playable === 'hls') {
                validHlsCount += 1;
              }
            }
            if (
              Date.now() >= deadlineAt &&
              validHlsCount < TARGET_VALID_HLS_COUNT &&
              validationCount < MAX_VALIDATIONS_PER_TITLE &&
              idx + 1 < preSortedCandidates.length
            ) {
              truncated = true;
              break;
            }
          }

          // Fase 2: conservar no validados con URL y playable (validated: false) sin requests HTTP
          if (!truncated && !abortedByHardTimeout) {
            for (let idx = nextUnvalidatedIdx; idx < preSortedCandidates.length; idx += 1) {
              const srv = preSortedCandidates[idx];
              if (!srv) continue;
              const unvalidated = buildUnvalidatedServerEntry(srv, requestedLang);
              if (unvalidated) {
                resolvedEntries.push(unvalidated);
              }
            }
          }

          const finalSorted = sortResolvedServerEntries(resolvedEntries);
          const hasHls = finalSorted.some((s) => s.validated && s.playable === 'hls');

          if (!truncated || finalSorted.length > 0) {
            const ttlMs = truncated
              ? SERVER_LIST_IFRAME_TTL_MS
              : hasHls
                ? SERVER_LIST_HLS_TTL_MS
                : SERVER_LIST_IFRAME_TTL_MS;
            setCachedServerList(
              cacheKey,
              { servers: finalSorted, total: finalSorted.length, hasHls },
              ttlMs
            );
          }

          return {
            providerId,
            tmdbId: norm.tmdbId,
            type: norm.type,
            lang: requestedLang,
            status: finalSorted.length > 0 ? 'ready' : 'empty',
            servers: finalSorted.slice(0, MAX_RETURNED_SERVERS),
            total: finalSorted.length,
            hasHls,
            truncated,
            cached: false,
            waitedMs: Date.now() - workStart,
            httpRequests: counter.count,
          };
        } catch (err) {
          if (abortedByHardTimeout || (err as { code?: string } | null)?.code === 'HARD_TIMEOUT_ERR') {
            if (!baseChainRecorded) {
              baseChainRecorded = true;
              recordBreakerSuccess(provider.id, provider, Date.now() - workStart);
            }
            const partialSorted = sortResolvedServerEntries(resolvedEntries);
            const hasHls = partialSorted.some((s) => s.validated && s.playable === 'hls');
            if (partialSorted.length > 0) {
              setCachedServerList(
                cacheKey,
                { servers: partialSorted, total: partialSorted.length, hasHls },
                SERVER_LIST_IFRAME_TTL_MS
              );
            }
            return {
              providerId,
              tmdbId: norm.tmdbId,
              type: norm.type,
              lang: requestedLang,
              status: partialSorted.length > 0 ? 'ready' : 'empty',
              servers: partialSorted.slice(0, MAX_RETURNED_SERVERS),
              total: partialSorted.length,
              hasHls,
              truncated: true,
              cached: false,
              waitedMs: Date.now() - workStart,
              httpRequests: counter.count,
            };
          }

          const code = (err as { code?: string } | null)?.code;
          if (code === 'TIMEOUT_ERR') {
            resolveMetrics.timeouts += 1;
            pMetric.timeouts += 1;
          }
          if (!baseChainRecorded) {
            baseChainRecorded = true;
            recordBreakerFailure(provider.id, provider);
          }
          return {
            providerId,
            tmdbId: norm.tmdbId,
            type: norm.type,
            lang: requestedLang,
            status: 'degraded',
            servers: [],
            total: 0,
            hasHls: false,
            truncated: false,
            cached: false,
            waitedMs: Date.now() - workStart,
            httpRequests: counter.count,
          };
        }
      })();

      void workPromise.catch(() => {});

      try {
        const raceWinner = await Promise.race([workPromise, hardTimeoutPromise]);
        if (raceWinner === 'hard_timeout') {
          if (!baseChainRecorded) {
            baseChainRecorded = true;
            recordBreakerSuccess(provider.id, provider, Date.now() - workStart);
          }
          const partialSorted = sortResolvedServerEntries(resolvedEntries);
          const hasHls = partialSorted.some((s) => s.validated && s.playable === 'hls');
          if (partialSorted.length > 0) {
            setCachedServerList(
              cacheKey,
              { servers: partialSorted, total: partialSorted.length, hasHls },
              SERVER_LIST_IFRAME_TTL_MS
            );
          }
          return {
            providerId,
            tmdbId: norm.tmdbId,
            type: norm.type,
            lang: requestedLang,
            status: partialSorted.length > 0 ? 'ready' : 'empty',
            servers: partialSorted.slice(0, MAX_RETURNED_SERVERS),
            total: partialSorted.length,
            hasHls,
            truncated: true,
            cached: false,
            waitedMs: Date.now() - workStart,
            httpRequests: counter.count,
          };
        }
        return raceWinner;
      } finally {
        if (hardTimer) {
          clearTimeout(hardTimer);
        }
      }
    },
    baseDir
  );

  return promise;
}

export function getResolveMetrics(baseDir?: string): {
  resolve: typeof resolveMetrics;
  queue: ReturnType<typeof getQueueStats>;
  cache: ReturnType<typeof getResolveCacheStats>;
  breakers: Record<string, BreakerStateSnapshot>;
} {
  const ids = loadProvidersConfig(baseDir).map((p) => p.id);
  return {
    resolve: {
      totalCalls: resolveMetrics.totalCalls,
      cacheHits: resolveMetrics.cacheHits,
      staleHits: resolveMetrics.staleHits,
      softDeadlineHits: resolveMetrics.softDeadlineHits,
      breakerShortCircuits: resolveMetrics.breakerShortCircuits,
      probeExecutions: resolveMetrics.probeExecutions,
      outboundHttpRequests: resolveMetrics.outboundHttpRequests,
      timeouts: resolveMetrics.timeouts,
      perProvider: { ...resolveMetrics.perProvider },
    },
    queue: getQueueStats(),
    cache: getResolveCacheStats(),
    breakers: getAllBreakerStates(ids),
  };
}

export function getProviderBreakerState(providerId: string, baseDir?: string): BreakerStateSnapshot {
  const cfg = getProviderConfig(providerId, baseDir);
  return getBreakerState(providerId, cfg);
}

export function resetResolveRuntimeForTest(): void {
  clearResolveCache();
  resetBreaker();
  resetQueueMetricsAndInFlight();
  resolveMetrics.totalCalls = 0;
  resolveMetrics.cacheHits = 0;
  resolveMetrics.staleHits = 0;
  resolveMetrics.softDeadlineHits = 0;
  resolveMetrics.breakerShortCircuits = 0;
  resolveMetrics.probeExecutions = 0;
  resolveMetrics.outboundHttpRequests = 0;
  resolveMetrics.timeouts = 0;
  resolveMetrics.perProvider = {};
}

