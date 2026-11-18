export type ResolveStatus = 'ready' | 'empty' | 'degraded';
export type ServerPlayable = 'hls' | 'iframe';

export interface ResolveResult {
  status: ResolveStatus;
  url: string;
  serverCount: number;
  waitedMs: number;
}

export interface CachedServerMetadata {
  id: number | string;
  name: string;
  lang?: string | undefined;
  popular: number;
  picks: number;
  link?: string | undefined;
  play?: string | undefined;
  original?: string | undefined;
  stream_url?: string | undefined;
  cdn_url?: string | undefined;
  playable?: ServerPlayable | undefined;
  speedMs?: number | undefined;
  audioLangs?: string[] | undefined;
}

export interface ResolvedServerEntry {
  id: number | string;
  name: string;
  lang: string;
  popular: number;
  picks: number;
  url?: string;
  playable?: ServerPlayable;
  validated?: boolean;
  acao?: string | null | undefined;
  link?: string | undefined;
  speedMs?: number | undefined;
  audioLangs?: string[] | undefined;
}

export interface CachedServerList {
  servers: (CachedServerMetadata | ResolvedServerEntry)[];
  total: number;
  hasHls?: boolean;
  token?: { validtime: string; token: string } | undefined;
  edgeUrl?: string | undefined;
  embedUrl?: string | undefined;
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

export interface MappingCacheEntry {
  contentId: number | string;
  contentType: string;
  edgeUrl?: string;
  embedUrl?: string;
  createdAt: number;
  ttlMs: number;
}

const mappingCache = new Map<string, MappingCacheEntry>();
export const MAPPING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function setMappingCache(
  key: string,
  contentId: number | string,
  contentType: string,
  edgeUrl?: string,
  embedUrl?: string,
  ttlMs = MAPPING_CACHE_TTL_MS,
  now = Date.now()
): void {
  mappingCache.set(key, {
    contentId,
    contentType,
    edgeUrl,
    embedUrl,
    createdAt: now,
    ttlMs: Math.max(1, ttlMs),
  });
}

export function getMappingCache(
  key: string,
  now = Date.now()
): { contentId: number | string; contentType: string; edgeUrl?: string; embedUrl?: string } | null {
  const entry = mappingCache.get(key);
  if (!entry) return null;
  const ageMs = now - entry.createdAt;
  if (ageMs <= entry.ttlMs) {
    return {
      contentId: entry.contentId,
      contentType: entry.contentType,
      edgeUrl: entry.edgeUrl,
      embedUrl: entry.embedUrl,
    };
  }
  mappingCache.delete(key);
  return null;
}

export function invalidateMappingCache(key: string): void {
  mappingCache.delete(key);
}

export function getNegativeCacheEntry(
  key: string,
  now = Date.now()
): { value: ResolveResult; remainingTtlMs: number } | null {
  const entry = negativeCache.get(key);
  if (!entry) return null;
  const ageMs = now - entry.createdAt;
  if (ageMs <= entry.ttlMs) {
    return {
      value: entry.value,
      remainingTtlMs: entry.ttlMs - ageMs,
    };
  }
  negativeCache.delete(key);
  return null;
}

const DEFAULT_POSITIVE_TTL_MS = 21_600_000; // 6h
const DEFAULT_NEGATIVE_TTL_MS = 1_800_000; // 30m
export const SERVER_LIST_TTL_MS = 15 * 60 * 1000; // 15 min TTL de lista (sin URLs definitivas)
export const SERVER_LIST_HLS_TTL_MS = SERVER_LIST_TTL_MS;
export const SERVER_LIST_IFRAME_TTL_MS = SERVER_LIST_TTL_MS;

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
  ttlMs = SERVER_LIST_TTL_MS,
  now = Date.now()
): void {
  serverListCache.set(key, {
    value: {
      servers: value.servers.map((s) => ({ ...s })),
      total: value.total,
      hasHls: Boolean(value.hasHls),
      token: value.token ? { ...value.token } : undefined,
      edgeUrl: value.edgeUrl,
      embedUrl: value.embedUrl,
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
        token: entry.value.token ? { ...entry.value.token } : undefined,
        edgeUrl: entry.value.edgeUrl,
        embedUrl: entry.value.embedUrl,
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
  mappingCache.clear();
}

export function getResolveCacheStats(): {
  positiveCount: number;
  negativeCount: number;
  serverListCount: number;
  mappingCount: number;
} {
  return {
    positiveCount: positiveCache.size,
    negativeCount: negativeCache.size,
    serverListCount: serverListCache.size,
    mappingCount: mappingCache.size,
  };
}

