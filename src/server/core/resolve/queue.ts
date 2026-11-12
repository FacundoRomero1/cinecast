import { getProviderConfig, getProviderHost } from './config.js';

export type MediaResolveType = 'movie' | 'series' | 'anime';

export interface CoalesceKeyParams {
  type: MediaResolveType;
  tmdbId: number;
  season?: number | undefined;
  episode?: number | undefined;
}

interface HostQueueState {
  active: number;
  waiters: Array<() => void>;
}

const hostQueues = new Map<string, HostQueueState>();
const inFlightPromises = new Map<string, Promise<unknown>>();

const queueMetrics = {
  totalEnqueuedOrCoalesced: 0,
  coalescedHits: 0,
  queueExecutions: 0,
};

export function normalizeResolveKeyParams(params: CoalesceKeyParams): {
  type: MediaResolveType;
  tmdbId: number;
  season: number;
  episode: number;
} {
  const isTV = params.type === 'series' || params.type === 'anime';
  const season = isTV ? Math.max(1, Number(params.season) || 1) : 0;
  const episode = isTV ? Math.max(1, Number(params.episode) || 1) : 0;
  return {
    type: params.type,
    tmdbId: Number(params.tmdbId),
    season,
    episode,
  };
}

/**
 * Clave de coalescing exacta: `${providerId}:${type}:${tmdbId}:${season}:${episode}`
 */
export function buildCoalescingKey(providerId: string, params: CoalesceKeyParams): string {
  const norm = normalizeResolveKeyParams(params);
  return `${providerId}:${norm.type}:${norm.tmdbId}:${norm.season}:${norm.episode}`;
}

export function getMaxConcurrentForProvider(providerId: string, baseDir?: string): number {
  const overrideRaw = process.env.CINECAST_RESOLVE_MAX_CONCURRENT;
  if (overrideRaw) {
    const parsed = Number(overrideRaw);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  const cfg = getProviderConfig(providerId, baseDir);
  const configured = cfg?.maxConcurrent;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 1) {
    return Math.floor(configured);
  }
  return 3;
}

export function getHostForProvider(providerId: string, baseDir?: string): string {
  const cfg = getProviderConfig(providerId, baseDir);
  return cfg ? getProviderHost(cfg) : providerId.toLowerCase();
}

function getOrCreateHostQueue(host: string): HostQueueState {
  let state = hostQueues.get(host);
  if (!state) {
    state = { active: 0, waiters: [] };
    hostQueues.set(host, state);
  }
  return state;
}

/**
 * Cola FIFO estricta por host con límite de concurrencia leído de config.
 */
export function enqueueByHost<T>(
  host: string,
  maxConcurrent: number,
  task: () => Promise<T>
): Promise<T> {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  const state = getOrCreateHostQueue(host);

  return new Promise<T>((resolve, reject) => {
    const runTask = () => {
      state.active += 1;
      queueMetrics.queueExecutions += 1;

      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          state.active = Math.max(0, state.active - 1);
          const next = state.waiters.shift();
          if (next) {
            next();
          }
        });
    };

    if (state.active < limit) {
      runTask();
    } else {
      state.waiters.push(runTask);
    }
  });
}

/**
 * Coalescing + cola FIFO por host por clave explícita.
 */
export function runWithQueueAndCoalescingKey<T>(
  providerId: string,
  key: string,
  worker: () => Promise<T>,
  baseDir?: string
): { key: string; promise: Promise<T>; coalesced: boolean } {
  queueMetrics.totalEnqueuedOrCoalesced += 1;

  const existing = inFlightPromises.get(key) as Promise<T> | undefined;
  if (existing) {
    queueMetrics.coalescedHits += 1;
    return { key, promise: existing, coalesced: true };
  }

  const host = getHostForProvider(providerId, baseDir);
  const maxConcurrent = getMaxConcurrentForProvider(providerId, baseDir);

  const created = enqueueByHost(host, maxConcurrent, worker).finally(() => {
    if (inFlightPromises.get(key) === created) {
      inFlightPromises.delete(key);
    }
  });

  inFlightPromises.set(key, created);
  return { key, promise: created, coalesced: false };
}

/**
 * Coalescing + cola FIFO por host: dos llamadas concurrentes con la misma clave
 * comparten exactamente la misma instancia de Promesa mientras está en vuelo.
 */
export function runWithQueueAndCoalescing<T>(
  providerId: string,
  params: CoalesceKeyParams,
  worker: () => Promise<T>,
  baseDir?: string
): { key: string; promise: Promise<T>; coalesced: boolean } {
  const key = buildCoalescingKey(providerId, params);
  return runWithQueueAndCoalescingKey(providerId, key, worker, baseDir);
}

export function getQueueStats(): {
  totalCalls: number;
  coalescedHits: number;
  queueExecutions: number;
  inFlightCount: number;
  hosts: Record<string, { active: number; queued: number }>;
} {
  const hosts: Record<string, { active: number; queued: number }> = {};
  hostQueues.forEach((state, host) => {
    hosts[host] = { active: state.active, queued: state.waiters.length };
  });
  return {
    totalCalls: queueMetrics.totalEnqueuedOrCoalesced,
    coalescedHits: queueMetrics.coalescedHits,
    queueExecutions: queueMetrics.queueExecutions,
    inFlightCount: inFlightPromises.size,
    hosts,
  };
}

export function resetQueueMetricsAndInFlight(): void {
  queueMetrics.totalEnqueuedOrCoalesced = 0;
  queueMetrics.coalescedHits = 0;
  queueMetrics.queueExecutions = 0;
}

