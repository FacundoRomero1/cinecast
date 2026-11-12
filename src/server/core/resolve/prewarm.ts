import { resolve, type MediaResolveType } from './index.js';
import { httpRequestFollowingRedirects } from './http.js';

export interface PrewarmOptions {
  baseUrl: string;
  baseDir?: string | undefined;
  intervalMs?: number | undefined;
  providerId?: string | undefined;
  limit?: number | undefined;
}

interface CatalogApiItem {
  id?: string;
  tmdbId?: number;
  type?: string;
  category?: string;
}

const DEFAULT_PREWARM_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const DEFAULT_PREWARM_LIMIT = 50;

export interface PrewarmController {
  stop: () => void;
  runNow: () => Promise<void>;
  isRunning: () => boolean;
}

export function startResolvePrewarm(options: PrewarmOptions): PrewarmController {
  const intervalMs = options.intervalMs ?? DEFAULT_PREWARM_INTERVAL_MS;
  const providerId = options.providerId ?? 'tukiplay';
  const limit = options.limit ?? DEFAULT_PREWARM_LIMIT;
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runCycle(): Promise<void> {
    if (running || stopped) return;
    running = true;

    try {
      const url = `${options.baseUrl.replace(/\/$/, '')}/api/catalog?page=1&limit=${limit}`;
      const resp = await httpRequestFollowingRedirects(url, {
        method: 'GET',
        timeoutMs: 10_000,
      });
      if (resp.status < 200 || resp.status >= 300) {
        console.warn(`[resolve:prewarm] Falló /api/catalog (${resp.status})`);
        return;
      }

      const data = JSON.parse(resp.body) as { items?: CatalogApiItem[] };
      const items = Array.isArray(data?.items) ? data.items.slice(0, limit) : [];

      let readyCount = 0;
      let processed = 0;

      // Concurrencia 1 estricta: itera secuencialmente para no saturar el proveedor
      for (const item of items) {
        if (stopped) break;
        const tmdbId = Number(item?.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;

        let type: MediaResolveType = 'movie';
        if (item.category === 'anime') {
          type = 'anime';
        } else if (item.type === 'series' || item.category === 'series') {
          type = 'series';
        }

        const r = await resolve(
          providerId,
          {
            tmdbId: Math.floor(tmdbId),
            type,
            season: type === 'movie' ? undefined : 1,
            episode: type === 'movie' ? undefined : 1,
          },
          options.baseDir
        );

        processed += 1;
        if (r.status === 'ready') readyCount += 1;
      }

      console.log(
        `[resolve:prewarm] Ciclo finalizado (${providerId}): ${readyCount}/${processed} ready`
      );
    } catch (err) {
      console.warn('[resolve:prewarm] Error en ciclo:', err);
    } finally {
      running = false;
    }
  }

  // Corre al arrancar y cada 30 min
  const bootTimer = setTimeout(() => {
    if (!stopped) {
      void runCycle();
    }
  }, 500);
  if (typeof bootTimer.unref === 'function') {
    bootTimer.unref();
  }

  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => {
      stopped = true;
      clearTimeout(bootTimer);
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow: runCycle,
    isRunning: () => running,
  };
}

