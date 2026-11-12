import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  getResolveMetrics,
  getServers,
  peekCachedResolve,
  resolveWithBackground,
  type MediaResolveType,
  type ResolveParams,
  type ResolveResult,
} from './index.js';
import { buildCoalescingKey } from './queue.js';
import { broadcastWsEvent } from '../ws.js';

export interface ResolveRouterOptions {
  baseDir?: string | undefined;
}

interface ResolveJobRecord {
  jobId: string;
  jobStatus: 'pending' | 'degraded';
  providerId: string;
  coalescingKey: string;
  cached: boolean;
  coalesced: boolean;
  createdAt: number;
  result?: ResolveResult | undefined;
}

const jobs = new Map<string, ResolveJobRecord>();
const inFlightJobCountPerKey = new Map<string, number>();

function parseResolveBody(body: unknown): {
  providerId: string;
  params: ResolveParams;
} | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const providerId =
    typeof b.providerId === 'string' && b.providerId.trim() ? b.providerId.trim() : 'tukiplay';
  const tmdbId = Number(b.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return { error: 'tmdbId válido es obligatorio' };
  }

  const rawType = typeof b.type === 'string' ? b.type.trim().toLowerCase() : 'movie';
  let type: MediaResolveType = 'movie';
  if (rawType === 'series' || rawType === 'tv') {
    type = 'series';
  } else if (rawType === 'anime') {
    type = 'anime';
  } else if (rawType !== 'movie') {
    return { error: 'type inválido (usar movie, series o anime)' };
  }

  const season = b.season !== undefined ? Number(b.season) : undefined;
  const episode = b.episode !== undefined ? Number(b.episode) : undefined;

  return {
    providerId,
    params: {
      tmdbId: Math.floor(tmdbId),
      type,
      season: season !== undefined && Number.isFinite(season) ? Math.floor(season) : undefined,
      episode: episode !== undefined && Number.isFinite(episode) ? Math.floor(episode) : undefined,
    },
  };
}

export function createResolveRouter(options: ResolveRouterOptions = {}): Router {
  const router = Router();
  const baseDir = options.baseDir;

  // POST /api/resolve
  router.post('/resolve', (req: Request, res: Response) => {
    const parsed = parseResolveBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { providerId, params } = parsed;
    const jobId = crypto.randomUUID();
    const coalescingKey = buildCoalescingKey(providerId, params);

    const cachedHit = peekCachedResolve(providerId, params, baseDir);
    if (cachedHit) {
      broadcastWsEvent({
        type: 'resolve',
        jobId,
        ...cachedHit,
      });

      res.json({
        jobId,
        cached: true,
        ...cachedHit,
      });
      return;
    }

    const activeOnKeyBefore = inFlightJobCountPerKey.get(coalescingKey) || 0;
    inFlightJobCountPerKey.set(coalescingKey, activeOnKeyBefore + 1);
    const wasCoalesced = activeOnKeyBefore > 0;

    const record: ResolveJobRecord = {
      jobId,
      jobStatus: 'pending',
      providerId,
      coalescingKey,
      cached: false,
      coalesced: wasCoalesced,
      createdAt: Date.now(),
    };
    jobs.set(jobId, record);

    const handle = resolveWithBackground(providerId, params, baseDir);

    const pFirst = handle.firstPromise.then((firstResult) => {
      if (handle.timedOutSoft()) {
        record.jobStatus = 'degraded';
      }
      record.result = firstResult;

      broadcastWsEvent({
        type: 'resolve',
        jobId,
        ...firstResult,
      });
    });

    const pComplete = handle.completionPromise
      .then((finalResult) => {
        if (handle.timedOutSoft()) {
          broadcastWsEvent({
            type: 'resolve',
            jobId,
            ...finalResult,
          });
        }
      })
      .catch(() => {
        if (handle.timedOutSoft()) {
          const fallbackResult: ResolveResult = {
            status: 'degraded',
            url: record.result?.url || '',
            serverCount: 0,
            waitedMs: Date.now() - record.createdAt,
          };
          broadcastWsEvent({
            type: 'resolve',
            jobId,
            ...fallbackResult,
          });
        }
      });

    // Al terminar el trabajo completo, el job se descarta del registro para no dejar huérfanos
    void Promise.allSettled([pFirst, pComplete]).finally(() => {
      jobs.delete(jobId);
      const current = inFlightJobCountPerKey.get(coalescingKey) || 1;
      if (current <= 1) {
        inFlightJobCountPerKey.delete(coalescingKey);
      } else {
        inFlightJobCountPerKey.set(coalescingKey, current - 1);
      }
    });

    res.status(202).json({
      jobId,
      cached: false,
      coalesced: wasCoalesced,
      status: 'pending',
    });
  });

  // GET /api/resolve/servers (registrado antes de :jobId)
  router.get('/resolve/servers', async (req: Request, res: Response) => {
    const parsed = parseResolveBody({
      providerId: req.query.providerId,
      tmdbId: req.query.tmdbId,
      type: req.query.type,
      season: req.query.season,
      episode: req.query.episode,
    });
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    const result = await getServers(
      parsed.providerId,
      { ...parsed.params, lang },
      baseDir
    );
    res.json(result);
  });

  // GET /api/resolve/status (registrado antes de :jobId)
  router.get('/resolve/status', (_req: Request, res: Response) => {
    res.json({
      metrics: getResolveMetrics(baseDir),
      jobsTracked: jobs.size,
    });
  });

  // GET /api/resolve/:jobId
  router.get('/resolve/:jobId', (req: Request, res: Response) => {
    const rawJobId = req.params.jobId;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
    const record = jobId ? jobs.get(jobId) : undefined;
    if (!record) {
      res.status(404).json({ error: 'Job no encontrado' });
      return;
    }

    if (record.jobStatus === 'pending' && !record.result) {
      res.json({
        jobId: record.jobId,
        cached: record.cached,
        coalesced: record.coalesced,
        status: 'pending',
      });
      return;
    }

    res.json({
      jobId: record.jobId,
      cached: record.cached,
      coalesced: record.coalesced,
      ...(record.result || { status: 'degraded', url: '', serverCount: 0, waitedMs: 0 }),
    });
  });

  return router;
}
