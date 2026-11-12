export type ResolveStatus = 'ready' | 'empty' | 'degraded';
export type ServerPlayable = 'hls' | 'iframe';

export interface ResolveResult {
  status: ResolveStatus;
  url: string;
  serverCount: number;
  waitedMs: number;
}

export interface ResolvedServerEntry {
  id: number | string;
  name: string;
  lang: string;
  popular: number;
  picks: number;
  url: string;
  playable: ServerPlayable;
  validated: boolean;
}

export interface CachedServerList {
  servers: ResolvedServerEntry[];
  total: number;
  hasHls: boolean;
}

export interface CacheEntry {
  value: ResolveResult;
  createdAt: number;
  ttlMs: number;
}

export interface ServerListCacheEntry {
  value: CachedServerList;
  createdAt: number;
  ttlMs: number;
}

export interface CacheLookupResult {
  value: ResolveResult;
  kind: 'positive' | 'negative';
  fresh: boolean;
  stale: boolean;
  ageMs: number;
}

export interface ServerListLookupResult {
  value: CachedServerList;
  ageMs: number;
  ttlMs: number;
}

// Solo en memoria (sin persistencia en disco): positivas y negativas separadas con TTL propio.
const positiveCache = new Map<string, CacheEntry>();
const negativeCache = new Map<string, CacheEntry>();
const serverListCache = new Map<string, ServerListCacheEntry>();

const DEFAULT_POSITIVE_TTL_MS = 21_600_000; // 6h
const DEFAULT_NEGATIVE_TTL_MS = 1_800_000; // 30m
export const SERVER_LIST_HLS_TTL_MS = 15 * 60 * 1000; // 15 min
export const SERVER_LIST_IFRAME_TTL_MS = 5 * 60 * 1000; // 5 min

export function setPositiveCache(
  key: string,
  value: ResolveResult,
  swrTtlMs = DEFAULT_POSITIVE_TTL_MS,
  now = Date.now()
): void {
  if (value.serverCount <= 0) {
    throw new Error('positive cache requires serverCount > 0');
  }
  negativeCache.delete(key);
  positiveCache.set(key, {
    value: { ...value, status: 'ready', waitedMs: 0 },
    createdAt: now,
    ttlMs: Math.max(1, swrTtlMs),
  });
}

export function setNegativeCache(
  key: string,
  value: ResolveResult,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS,
  now = Date.now()
): void {
  positiveCache.delete(key);
  negativeCache.set(key, {
    value: { ...value, status: 'empty', serverCount: 0, waitedMs: 0 },
    createdAt: now,
    ttlMs: Math.max(1, negativeTtlMs),
  });
}

/**
 * Consulta en caché en memoria.
 * - Entradas positivas (serverCount > 0): frescas hasta `ttlMs`, y SWR stale hasta `ttlMs * 2`.
 * - Entradas negativas (serverCount === 0): frescas hasta `negativeTtlMs`, luego expiran.
 */
export function getCachedResolve(key: string, now = Date.now()): CacheLookupResult | null {
  const pos = positiveCache.get(key);
  if (pos) {
    const ageMs = Math.max(0, now - pos.createdAt);
    if (ageMs <= pos.ttlMs) {
      return {
        value: { ...pos.value },
        kind: 'positive',
        fresh: true,
        stale: false,
        ageMs,
      };
    }
    const maxSwrGraceMs = pos.ttlMs * 2;
    if (ageMs <= maxSwrGraceMs) {
      return {
        value: { ...pos.value },
        kind: 'positive',
        fresh: false,
        stale: true,
        ageMs,
      };
    }
    positiveCache.delete(key);
  }

  const neg = negativeCache.get(key);
  if (neg) {
    const ageMs = Math.max(0, now - neg.createdAt);
    if (ageMs <= neg.ttlMs) {
      return {
        value: { ...neg.value },
        kind: 'negative',
        fresh: true,
        stale: false,
        ageMs,
      };
    }
    negativeCache.delete(key);
  }

  return null;
}

export function setCachedServerList(
  key: string,
  value: CachedServerList,
  ttlMs = value.hasHls ? SERVER_LIST_HLS_TTL_MS : SERVER_LIST_IFRAME_TTL_MS,
  now = Date.now()
): void {
  serverListCache.set(key, {
    value: {
      servers: value.servers.map((s) => ({ ...s })),
      total: value.total,
      hasHls: value.hasHls,
    },
    createdAt: now,
    ttlMs: Math.max(1, ttlMs),
  });
}

export function getCachedServerList(
  key: string,
  now = Date.now()
): ServerListLookupResult | null {
  const entry = serverListCache.get(key);
  if (!entry) return null;
  const ageMs = Math.max(0, now - entry.createdAt);
  if (ageMs <= entry.ttlMs) {
    return {
      value: {
        servers: entry.value.servers.map((s) => ({ ...s })),
        total: entry.value.total,
        hasHls: entry.value.hasHls,
      },
      ageMs,
      ttlMs: entry.ttlMs,
    };
  }
  serverListCache.delete(key);
  return null;
}

export function clearResolveCache(): void {
  positiveCache.clear();
  negativeCache.clear();
  serverListCache.clear();
}

export function getResolveCacheStats(): {
  positiveCount: number;
  negativeCount: number;
  serverListCount: number;
} {
  return {
    positiveCount: positiveCache.size,
    negativeCount: negativeCache.size,
    serverListCount: serverListCache.size,
  };
}

