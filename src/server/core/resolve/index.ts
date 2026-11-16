import {
  canExecuteWithBreaker,
  getAllBreakerStates,
  getBreakerState,
  recordBreakerFailure,
  recordBreakerSuccess,
  resetBreaker,
  type BreakerStateSnapshot,
} from './breaker.js';
import {
  clearResolveCache,
  getCachedResolve,
  getCachedServerList,
  getMappingCache,
  getNegativeCacheEntry,
  getResolveCacheStats,
  invalidateMappingCache,
  SERVER_LIST_HLS_TTL_MS,
  SERVER_LIST_IFRAME_TTL_MS,
  SERVER_LIST_TTL_MS,
  setCachedServerList,
  setMappingCache,
  setNegativeCache,
  setPositiveCache,
  type CachedServerMetadata,
  type ResolvedServerEntry,
  type ResolveResult,
  type ServerPlayable,
} from './cache.js';
import {
  getServerPenalty,
  recordServerPenalty,
  getPenaltiesCount,
  getAllPenalties,
} from './penalties.js';
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

export type { BreakerStateSnapshot } from './breaker.js';
export { getCachedServerList, SERVER_LIST_TTL_MS } from './cache.js';
export type {
  CachedServerMetadata,
  ResolvedServerEntry, ResolveResult,
  ResolveStatus, ServerPlayable
} from './cache.js';
export type { MediaResolveType } from './queue.js';

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
      void triggerQueuedResolve(provider, params, targetUrl, baseDir).catch(() => { });
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
      void triggerQueuedResolve(provider, params, targetUrl, baseDir).catch(() => { });
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
  void completionPromise.catch(() => { });

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

function normalizeHlsCandidateUrl(u: string): string {
  const clean = cleanStr(u);
  if (clean.includes('/clean-player/stream/') && !clean.includes('raw=1')) {
    return clean.includes('?') ? `${clean}&raw=1` : `${clean}?raw=1`;
  }
  return clean;
}

function buildOrderedHlsCandidates(cdnUrl: string, streamUrl: string): string[] {
  const out: string[] = [];
  const normCdn = normalizeHlsCandidateUrl(cdnUrl);
  const normStream = normalizeHlsCandidateUrl(streamUrl);

  if (normCdn && !isBlockedEarnvidsCdnHost(normCdn)) {
    out.push(normCdn);
  }
  if (normStream && !isBlockedEarnvidsCdnHost(normStream) && !out.includes(normStream)) {
    out.push(normStream);
  }
  return out;
}

interface HlsValidationResult {
  valid: boolean;
  status: number;
  acao: string | null;
  isExtM3u: boolean;
  speedMs: number;
}

async function validateHlsPlaylist(
  urlStr: string,
  embedUrl: string,
  tlsLax: boolean,
  counter: { count: number },
  providerId: string,
  deadlineAt: number
): Promise<HlsValidationResult> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 250) {
    return { valid: false, status: 0, acao: null, isExtM3u: false, speedMs: 999_999 };
  }
  const start = Date.now();
  try {
    counter.count += 1;
    resolveMetrics.outboundHttpRequests += 1;
    touchProviderMetric(providerId).outboundHttpRequests += 1;

    const timeoutMs = Math.min(1_500, remaining);
    const originHeader = 'https://tukiplay.com';
    const refererHeader = embedUrl || 'https://tukiplay.com/';

    const res = await httpGetFirstBytes(urlStr, 512, {
      tlsLax,
      timeoutMs,
      retries: 0,
      requiresReferer: false,
      headers: {
        Origin: originHeader,
        Referer: refererHeader,
      },
    });

    const speedMs = Date.now() - start;
    const status2xx = res.status >= 200 && res.status < 300;
    const isExtM3u = res.body.trimStart().startsWith('#EXTM3U');
    const rawAcao =
      res.headers?.['access-control-allow-origin'] ||
      (res.headers as any)?.['Access-Control-Allow-Origin'] ||
      null;
    const acaoStr = rawAcao ? String(rawAcao).trim() : null;
    const hasValidAcao = Boolean(
      acaoStr &&
      (acaoStr === '*' || acaoStr.toLowerCase() === originHeader.toLowerCase())
    );

    const valid = status2xx && isExtM3u && hasValidAcao;
    console.log(
      `[HLS Validation] url="${urlStr}" status=${res.status} isExtM3u=${isExtM3u} ACAO="${acaoStr || '<ninguno>'}" speedMs=${speedMs} valid=${valid}`
    );
    return { valid, status: res.status, acao: acaoStr, isExtM3u, speedMs };
  } catch (err: any) {
    const speedMs = Date.now() - start;
    console.warn(`[HLS Validation] Error validando "${urlStr}" (${speedMs}ms):`, err?.message || err);
    return { valid: false, status: 0, acao: null, isExtM3u: false, speedMs };
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
  let matchedHlsAcao: string | null = null;
  let matchedSpeedMs: number | undefined = undefined;

  // 1. buildOrderedHlsCandidates: cdnUrl primero, streamUrl segundo
  const hlsCandidates = buildOrderedHlsCandidates(cdnUrl, streamUrl);
  for (const candUrl of hlsCandidates) {
    if (Date.now() >= ctx.deadlineAt) break;
    const val = await validateHlsPlaylist(
      candUrl,
      ctx.embedUrl,
      ctx.tlsLax,
      ctx.counter,
      ctx.providerId,
      ctx.deadlineAt
    );
    if (val.valid) {
      resolvedUrl = candUrl;
      playable = 'hls';
      matchedHlsAcao = val.acao;
      matchedSpeedMs = val.speedMs;
      break;
    }
  }

  // 2. Degradado: playUrl || originalUrl como iframe si no hubo HLS con ACAO válido
  if (!resolvedUrl) {
    if (playUrl) {
      resolvedUrl = playUrl;
      playable = 'iframe';
    } else if (originalUrl) {
      resolvedUrl = originalUrl;
      playable = 'iframe';
    }
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
    acao: matchedHlsAcao,
    speedMs: matchedSpeedMs,
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

  const hlsCandidates = buildOrderedHlsCandidates(cdnUrl, streamUrl);
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

export function getEffectiveServerSpeed(
  providerId: string,
  titleId: string,
  srv: { id: string | number; speedMs?: number }
): number {
  const penalty = getServerPenalty(providerId, titleId, srv.id);
  const baseSpeed = typeof srv.speedMs === 'number' && srv.speedMs > 0 ? srv.speedMs : 999_999;
  return baseSpeed + penalty;
}

export function sortServersBySpeedAndPenalties<T extends CachedServerMetadata | ResolvedServerEntry>(
  entries: T[],
  providerId: string,
  titleId: string
): T[] {
  return [...entries].sort((a, b) => {
    const aIsHls = a.playable === 'hls';
    const bIsHls = b.playable === 'hls';

    // 1. HLS antes que iframe
    if (aIsHls && !bIsHls) return -1;
    if (!aIsHls && bIsHls) return 1;

    // 2. Si ambos son HLS:
    if (aIsHls && bIsHls) {
      const aVal = Boolean((a as any).validated);
      const bVal = Boolean((b as any).validated);
      if (aVal && !bVal) return -1;
      if (!aVal && bVal) return 1;

      // Entre hls validados: speedMs ascendente (+ penalización)
      const speedA = getEffectiveServerSpeed(providerId, titleId, a);
      const speedB = getEffectiveServerSpeed(providerId, titleId, b);
      if (speedA !== speedB) {
        return speedA - speedB;
      }

      // Popular solo como desempate
      const popDiff = (Number(b.popular) || 0) - (Number(a.popular) || 0);
      if (popDiff !== 0) return popDiff;
      return (Number(b.picks) || 0) - (Number(a.picks) || 0);
    }

    // 3. Si ambos son iframe (o ninguno HLS):
    const popDiff = (Number(b.popular) || 0) - (Number(a.popular) || 0);
    if (popDiff !== 0) return popDiff;
    return (Number(b.picks) || 0) - (Number(a.picks) || 0);
  });
}

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

export interface ResolvePlayResult {
  success: boolean;
  serverId: number | string;
  name: string;
  url: string;
  playable: ServerPlayable;
  speedMs?: number | undefined;
  acao?: string | null | undefined;
  error?: string | undefined;
  servers?: (CachedServerMetadata | ResolvedServerEntry)[];
}

interface SharedActiveSession {
  token: { validtime: string; token: string };
  edgeUrl: string;
  embedUrl: string;
  updatedAt: number;
}
let sharedActiveSession: SharedActiveSession | null = null;

async function acuñarServerEntry(
  srv: CachedServerMetadata | ResolvedServerEntry,
  ctx: {
    edgeUrl: string;
    embedUrl: string;
    activeToken: { validtime: string; token: string } | undefined;
    tlsLax: boolean;
    counter: { count: number };
    providerId: string;
    deadlineAt: number;
    baseDir?: string;
    norm: any;
    requestedLang: string;
    cacheKey: string;
  }
): Promise<{
  url: string;
  playable: ServerPlayable;
  speedMs: number;
  acao: string | null;
  validated: boolean;
}> {
  if ((srv as any).url && typeof (srv as any).speedMs === 'number' && (srv as any).speedMs > 0) {
    return {
      url: (srv as any).url,
      playable: srv.playable || 'iframe',
      speedMs: (srv as any).speedMs,
      acao: (srv as any).acao || null,
      validated: Boolean((srv as any).validated),
    };
  }

  let streamUrl = cleanStr(srv.stream_url);
  let cdnUrl = cleanStr(srv.cdn_url);
  let playUrl = cleanStr(srv.play);
  let originalUrl = cleanStr(srv.original);
  const link = cleanStr(srv.link);
  const serverName = srv.name || 'Desconocido';

  if (link && ctx.activeToken) {
    try {
      let streamingRes = await postEdgeJson(
        ctx.edgeUrl,
        ctx.embedUrl,
        {
          streaming: link,
          validtime: ctx.activeToken.validtime,
          token: ctx.activeToken.token,
        },
        ctx.tlsLax,
        ctx.counter,
        ctx.providerId,
        ctx.deadlineAt,
        12_000
      );

      // Si el token falló o expiró (codigo !== 200), refrescar la lista/token y reintentar una vez
      if (!streamingRes.json || streamingRes.json.codigo !== 200) {
        await getServers(ctx.providerId, { ...ctx.norm, lang: ctx.requestedLang }, ctx.baseDir);
        const refreshedCached = getCachedServerList(ctx.cacheKey);
        if (refreshedCached && refreshedCached.value.token) {
          ctx.activeToken = refreshedCached.value.token;
          const freshTarget = refreshedCached.value.servers.find(
            (s) => String(s.id) === String(srv.id) || s.name.toLowerCase() === String(srv.name).toLowerCase()
          );
          const freshLink = cleanStr(freshTarget?.link) || link;
          streamingRes = await postEdgeJson(
            refreshedCached.value.edgeUrl || ctx.edgeUrl,
            refreshedCached.value.embedUrl || ctx.embedUrl,
            {
              streaming: freshLink,
              validtime: ctx.activeToken.validtime,
              token: ctx.activeToken.token,
            },
            ctx.tlsLax,
            ctx.counter,
            ctx.providerId,
            ctx.deadlineAt,
            12_000
          );
        }
      }

      if (streamingRes.json && streamingRes.json.codigo === 200) {
        streamUrl = cleanStr(streamingRes.json.stream_url) || streamUrl;
        cdnUrl = cleanStr(streamingRes.json.cdn_url) || cdnUrl;
        playUrl = cleanStr(streamingRes.json.url) || playUrl;
        originalUrl = cleanStr(streamingRes.json.original) || originalUrl;
      }
    } catch (err: any) {
      console.warn(`[ResolvePlay] Error en POST streaming para servidor "${serverName}":`, err?.message);
    }
  }

  let resolvedUrl = '';
  let playable: ServerPlayable = 'iframe';
  let matchedHlsAcao: string | null = null;
  let matchedSpeedMs = 999_999;
  let isValidated = false;

  // 1. buildOrderedHlsCandidates: cdnUrl primero, streamUrl segundo
  const hlsCandidates = buildOrderedHlsCandidates(cdnUrl, streamUrl);
  for (const candUrl of hlsCandidates) {
    if (Date.now() >= ctx.deadlineAt) break;
    const val = await validateHlsPlaylist(
      candUrl,
      ctx.embedUrl,
      ctx.tlsLax,
      ctx.counter,
      ctx.providerId,
      ctx.deadlineAt
    );
    if (val.valid) {
      resolvedUrl = candUrl;
      playable = 'hls';
      matchedHlsAcao = val.acao;
      matchedSpeedMs = val.speedMs;
      isValidated = true;
      break;
    }
  }

  // 2. Degradado: playUrl || originalUrl como iframe si no hubo HLS con ACAO válido
  if (!resolvedUrl) {
    if (playUrl) {
      resolvedUrl = playUrl;
      playable = 'iframe';
    } else if (originalUrl) {
      resolvedUrl = originalUrl;
      playable = 'iframe';
    }
  }

  if (!resolvedUrl) {
    resolvedUrl = ctx.embedUrl;
    playable = 'iframe';
  }

  return {
    url: resolvedUrl,
    playable,
    speedMs: matchedSpeedMs,
    acao: matchedHlsAcao,
    validated: isValidated,
  };
}

export async function resolveServerPlay(
  providerId: string,
  serverId: number | string | undefined,
  params: ResolveParams,
  lang = 'latino',
  baseDir?: string,
  preferredServerId?: number | string,
  preferredServerName?: string
): Promise<ResolvePlayResult> {
  const workStart = Date.now();
  const norm = normalizeResolveKeyParams(params);
  const requestedLang = (lang || 'latino').trim().toLowerCase();
  const cacheKey = `servers:${providerId}:${norm.type}:${norm.tmdbId}:${norm.season ?? null}:${norm.episode ?? null}:${requestedLang}`;

  let cached = getCachedServerList(cacheKey);
  // Requisito 3: "si no hay lista cacheada, /api/resolve/play hace la cadena completa y devuelve la URL en una sola llamada."
  if (!cached || cached.value.servers.length === 0) {
    await getServers(providerId, { ...norm, lang: requestedLang }, baseDir);
    cached = getCachedServerList(cacheKey);
  }

  if (!cached || cached.value.servers.length === 0) {
    return {
      success: false,
      serverId: serverId ?? 0,
      name: 'Desconocido',
      url: '',
      playable: 'iframe',
      error: 'No se encontraron servidores para este título',
      servers: [],
    };
  }

  const srvList = cached.value.servers;
  const titleId = `${norm.type}:${norm.tmdbId}`;
  const counter = { count: 0 };
  const provider = getProviderConfig(providerId, baseDir);
  const tlsLax = Boolean(provider.tlsLax);
  const edgeUrl = cached.value.edgeUrl || provider.edgeUrl || 'https://tukiplay.com/edge-data';
  const embedUrl = cached.value.embedUrl || 'https://tukiplay.com/';
  let activeToken = cached.value.token || (sharedActiveSession?.token ? { ...sharedActiveSession.token } : undefined);
  const deadlineAt = Date.now() + 15_000;

  const ctx = {
    edgeUrl,
    embedUrl,
    activeToken,
    tlsLax,
    counter,
    providerId,
    deadlineAt,
    baseDir,
    norm,
    requestedLang,
    cacheKey,
  };

  // CASO 1: Si serverId vino especificado y es válido (no 0 / no vacío):
  if (serverId !== undefined && serverId !== null && String(serverId).trim() !== '' && String(serverId) !== '0') {
    let target = srvList.find(
      (s) => String(s.id) === String(serverId) || s.name.toLowerCase() === String(serverId).toLowerCase()
    );
    if (!target) {
      return {
        success: false,
        serverId,
        name: 'Desconocido',
        url: '',
        playable: 'iframe',
        error: 'Servidor no encontrado en la lista',
        servers: srvList,
      };
    }

    const acuñado = await acuñarServerEntry(target, ctx);
    (target as any).url = acuñado.url;
    target.playable = acuñado.playable;
    (target as any).speedMs = acuñado.speedMs;
    (target as any).acao = acuñado.acao;
    (target as any).validated = acuñado.validated;

    const sortedServers = sortServersBySpeedAndPenalties(srvList, providerId, titleId);
    cached.value.servers = sortedServers;
    setCachedServerList(cacheKey, cached.value, SERVER_LIST_TTL_MS);

    console.log(
      `[ResolvePlay] Servidor específico acuñado: name="${target.name}" (id=${target.id}) playable=${target.playable} speedMs=${acuñado.speedMs} ACAO="${acuñado.acao || 'N/A'}" ms=${Date.now() - workStart}`
    );

    return {
      success: true,
      serverId: target.id,
      name: target.name,
      url: acuñado.url,
      playable: target.playable || 'iframe',
      speedMs: acuñado.speedMs,
      acao: acuñado.acao,
      servers: sortedServers,
    };
  }

  // CASO 2: serverId NO especificado -> ranking por velocidad observada y penalizaciones adaptativas
  // a) Identificar candidatos HLS
  const hlsCandidates = srvList.filter(
    (s) => s.playable === 'hls' || s.name.toLowerCase().includes('vimeo') || s.name.toLowerCase().includes('earnvids')
  );

  // b) Validar candidatos HLS no acuñados (hasta 2 en paralelo) para medir su speedMs
  const unvalidatedHls = hlsCandidates.filter((s) => !(s as any).validated || typeof (s as any).speedMs !== 'number');
  if (unvalidatedHls.length > 0) {
    const toValidate = unvalidatedHls.slice(0, 2);
    await Promise.all(
      toValidate.map(async (candidate) => {
        try {
          const res = await acuñarServerEntry(candidate, ctx);
          (candidate as any).url = res.url;
          candidate.playable = res.playable;
          (candidate as any).speedMs = res.speedMs;
          (candidate as any).acao = res.acao;
          (candidate as any).validated = res.validated;
        } catch (_) {}
      })
    );
  }

  // c) Ordenar toda la lista por velocidad observada y penalizaciones:
  // "Orden: entre hls validados, speedMs ascendente; popular solo como desempate. Los iframe siguen después."
  const sortedServers = sortServersBySpeedAndPenalties(srvList, providerId, titleId);
  cached.value.servers = sortedServers;
  setCachedServerList(cacheKey, cached.value, SERVER_LIST_TTL_MS);

  // d) Seleccionar el mejor servidor
  let target = sortedServers[0];

  // Si el target seleccionado no tiene URL todavía (por ejemplo, si era un iframe que no pasó por acuñarServerEntry):
  if (!(target as any).url) {
    const acuñado = await acuñarServerEntry(target, ctx);
    (target as any).url = acuñado.url;
    target.playable = acuñado.playable;
    (target as any).speedMs = acuñado.speedMs;
    (target as any).acao = acuñado.acao;
    (target as any).validated = acuñado.validated;
  }

  console.log(
    `[ResolvePlay] Servidor seleccionado por ranking de velocidad: name="${target.name}" (id=${target.id}) playable=${target.playable} speedMs=${(target as any).speedMs} penalización=${getServerPenalty(providerId, titleId, target.id)}ms ACAO="${(target as any).acao || 'N/A'}" ms=${Date.now() - workStart}`
  );

  return {
    success: true,
    serverId: target.id,
    name: target.name,
    url: (target as any).url || embedUrl,
    playable: target.playable || 'iframe',
    speedMs: (target as any).speedMs,
    acao: (target as any).acao || null,
    servers: sortedServers,
  };
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
          const mappingKey = `${provider.id}:${norm.type}:${norm.tmdbId}:${norm.season ?? null}:${norm.episode ?? null}`;
          let cachedMapping = getMappingCache(mappingKey);
          let edgeUrl = cachedMapping?.edgeUrl || sharedActiveSession?.edgeUrl || provider.edgeUrl || 'https://tukiplay.com/edge-data';
          let finalEmbedUrl = cachedMapping?.embedUrl || sharedActiveSession?.embedUrl || embedUrl;
          let activeToken = sharedActiveSession?.token ? { ...sharedActiveSession.token } : null;
          let contentId = cachedMapping?.contentId;
          let contentType = cachedMapping?.contentType;
          let serversResp: { status: number; json: EdgeApiResponse | null } | null = null;

          // 1. Si hay mapeo cacheado Y token previo activo:
          // "Si hay mapeo, la cadena saltea el GET del embed y va directo a token + servers. Si el POST servers falla con el id cacheado, invalidá el mapeo y reintentá una vez con el GET."
          if (cachedMapping && activeToken) {
            try {
              console.log(`[GetServers] Mapeo cacheado tmdbId=${norm.tmdbId} -> contentId=${contentId}, contentType=${contentType}. Saltando GET del embed...`);

              // Refrescar token
              const tokenResp = await postEdgeJson(
                edgeUrl,
                finalEmbedUrl,
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
                sharedActiveSession = {
                  token: { ...activeToken },
                  edgeUrl,
                  embedUrl: finalEmbedUrl,
                  updatedAt: Date.now(),
                };
              }

              // Llamar a action: 'servers' con el contentId cacheado
              serversResp = await postEdgeJson(
                edgeUrl,
                finalEmbedUrl,
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

              // Si falló serversResp (codigo !== 200 o sin servers), invalidar mapeo y forzar reintento con GET
              if (!serversResp.json || serversResp.json.codigo !== 200 || !serversResp.json.servers) {
                console.warn(`[GetServers] POST servers falló con id cacheado (${contentId}): codigo=${serversResp.json?.codigo}. Invalidando mapeo y reintentando con GET...`);
                invalidateMappingCache(mappingKey);
                serversResp = null;
              }
            } catch (err: any) {
              console.warn(`[GetServers] Error con mapeo cacheado: ${err?.message}. Invalidando mapeo y reintentando con GET...`);
              invalidateMappingCache(mappingKey);
              serversResp = null;
            }
          }

          // 2. Si no se usó mapeo o si falló y toca reintentar una vez con GET:
          if (!serversResp) {
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

            finalEmbedUrl = embedRes.finalUrl;
            const cfg = extractPelixConfigObject(embedRes.body);
            const initToken = cleanStr(cfg?.token?.token);
            const initValidtime = cleanStr(cfg?.token?.validtime);
            contentId = cfg?.content?.id;
            contentType = cleanStr(cfg?.content?.type) || (norm.type === 'movie' ? 'movie' : 'episode');

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

            edgeUrl = new URL(cleanStr(cfg.edge) || '/edge-data', finalEmbedUrl).toString();
            activeToken = { validtime: initValidtime, token: initToken };

            // Guardar mapeo con TTL 24h
            setMappingCache(mappingKey, contentId, contentType, edgeUrl, finalEmbedUrl);

            // Guardar sesión activa compartida
            sharedActiveSession = {
              token: { ...activeToken },
              edgeUrl,
              embedUrl: finalEmbedUrl,
              updatedAt: Date.now(),
            };

            // b. POST action=token
            const tokenResp = await postEdgeJson(
              edgeUrl,
              finalEmbedUrl,
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
              sharedActiveSession.token = { ...activeToken };
            }

            // c. POST action=servers
            serversResp = await postEdgeJson(
              edgeUrl,
              finalEmbedUrl,
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
          }

          // Breaker evalúa solo la cadena base (embed + token + servers), nunca el fan-out
          const baseChainMs = Date.now() - workStart;
          baseChainRecorded = true;
          recordBreakerSuccess(provider.id, provider, baseChainMs);

          const langBlock = findLanguageBlock(serversResp.json?.servers, requestedLang);
          const rawList = Array.isArray(langBlock?.servers) ? langBlock.servers : [];

          // 1) Ordenar por popular descendente, luego picks descendente
          const preSortedCandidates = [...rawList].sort((a, b) => {
            const popDiff = (Number(b.popular) || 0) - (Number(a.popular) || 0);
            if (popDiff !== 0) return popDiff;
            return (Number(b.picks) || 0) - (Number(a.picks) || 0);
          });

          // Requisito 3: "en cache.ts, la lista cacheada guarda solo id, name, popular, picks y link — sin url ni playable definitivos. TTL de lista: 15 min. Sin caché de URL."
          const serverListEntries: CachedServerMetadata[] = preSortedCandidates.map((srv) => {
            const isHlsCandidate =
              cleanStr(srv.link_name || srv.server).toLowerCase().includes('vimeo') ||
              cleanStr(srv.link_name || srv.server).toLowerCase().includes('earnvids') ||
              Boolean(cleanStr(srv.stream_url) || cleanStr(srv.cdn_url));
            return {
              id: srv.id ?? (cleanStr(srv.link_name || srv.server) || 'Desconocido'),
              name: cleanStr(srv.link_name || srv.server) || 'Desconocido',
              lang: requestedLang,
              popular: Number(srv.popular) || 0,
              picks: Number(srv.picks) || 0,
              link: cleanStr(srv.link),
              play: cleanStr(srv.play),
              original: cleanStr(srv.original),
              stream_url: cleanStr(srv.stream_url),
              cdn_url: cleanStr(srv.cdn_url),
              playable: isHlsCandidate ? ('hls' as const) : ('iframe' as const),
            };
          });

          const hasPotentialHls = serverListEntries.some((s) => (s as any).playable === 'hls');

          setCachedServerList(
            cacheKey,
            {
              servers: serverListEntries,
              total: serverListEntries.length,
              hasHls: hasPotentialHls,
              token: activeToken,
              edgeUrl,
              embedUrl: finalEmbedUrl,
            },
            SERVER_LIST_TTL_MS
          );

          const publicServers = serverListEntries.map((s) => ({
            id: s.id,
            name: s.name,
            lang: requestedLang,
            popular: s.popular,
            picks: s.picks,
            link: s.link,
            url: '',
            playable: (s.name.toLowerCase().includes('vimeo') || s.name.toLowerCase().includes('earnvids')) ? ('hls' as const) : ('iframe' as const),
            validated: false,
          }));

          return {
            providerId,
            tmdbId: norm.tmdbId,
            type: norm.type,
            lang: requestedLang,
            status: publicServers.length > 0 ? 'ready' : 'empty',
            servers: publicServers.slice(0, MAX_RETURNED_SERVERS),
            total: publicServers.length,
            hasHls: hasPotentialHls,
            truncated: false,
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

      void workPromise.catch(() => { });

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

export {
  getMappingCache,
  setMappingCache,
  invalidateMappingCache,
  getNegativeCacheEntry,
};

