import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { broadcastWsEvent } from '../ws.js';
import { recordServerPenalty, getPenaltiesCount, getAllPenalties } from './penalties.js';
import {
  getCachedServerList,
  getResolveMetrics,
  getServers,
  peekCachedResolve,
  resolveServerPlay,
  resolveWithBackground,
  type MediaResolveType,
  type ResolveParams,
  type ResolveResult,
} from './index.js';
import { buildCoalescingKey } from './queue.js';

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

    const rawLang = (req.body as any)?.lang;
    const requestedLang = typeof rawLang === 'string' && rawLang.trim() ? rawLang.trim().toLowerCase() : 'latino';
    const serverCacheKey = `servers:${providerId}:${params.type}:${params.tmdbId}:${params.season ?? null}:${params.episode ?? null}:${requestedLang}`;

    // 0. Revisar si la lista de servidores ya está resuelta en caché para este título
    const cachedServerEntry = getCachedServerList(serverCacheKey);
    if (cachedServerEntry && cachedServerEntry.value.servers.length > 0) {
      const servers = cachedServerEntry.value.servers;
      const resVal: ResolveResult = {
        status: 'ready',
        url: servers[0]?.url || '',
        serverCount: servers.length,
        waitedMs: 0,
      };
      broadcastWsEvent({
        type: 'resolve',
        jobId,
        ...resVal,
        servers,
      });

      res.json({
        jobId,
        cached: true,
        ...resVal,
        servers,
      });
      return;
    }

    const cachedHit = peekCachedResolve(providerId, params, baseDir);
    if (cachedHit) {
      const cachedServers = getCachedServerList(serverCacheKey) || getCachedServerList(coalescingKey);
      const servers = cachedServers?.value?.servers || [];
      broadcastWsEvent({
        type: 'resolve',
        jobId,
        ...cachedHit,
        servers,
      });

      res.json({
        jobId,
        cached: true,
        ...cachedHit,
        servers,
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

      const cachedServers = getCachedServerList(serverCacheKey) || getCachedServerList(coalescingKey);
      broadcastWsEvent({
        type: 'resolve',
        jobId,
        ...firstResult,
        servers: cachedServers?.value?.servers || [],
      });
    });

    const pComplete = handle.completionPromise
      .then((finalResult) => {
        record.result = finalResult;
        const cachedServers = getCachedServerList(serverCacheKey) || getCachedServerList(coalescingKey);
        broadcastWsEvent({
          type: 'resolve',
          jobId,
          ...finalResult,
          servers: cachedServers?.value?.servers || [],
        });
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
            servers: [],
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

  // POST /api/resolve/play (Acuña URL fresca bajo demanda, fusiona cadena completa si no hay lista cacheada)
  router.post('/resolve/play', async (req: Request, res: Response) => {
    const rawBody = req.body || {};
    const parsed = parseResolveBody({
      providerId: rawBody.providerId,
      tmdbId: rawBody.tmdbId ?? rawBody.params?.tmdbId,
      type: rawBody.type ?? rawBody.params?.type,
      season: rawBody.season ?? rawBody.params?.season,
      episode: rawBody.episode ?? rawBody.params?.episode,
    });
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const rawServerId =
      rawBody.serverId !== undefined &&
      rawBody.serverId !== null &&
      String(rawBody.serverId).trim() !== '' &&
      String(rawBody.serverId) !== '0'
        ? rawBody.serverId
        : undefined;

    const preferredServerId = rawBody.preferredServerId;
    const preferredServerName = rawBody.preferredServerName;

    const lang = typeof rawBody.lang === 'string' && rawBody.lang.trim()
      ? rawBody.lang.trim()
      : 'latino';

    try {
      const result = await resolveServerPlay(
        parsed.providerId,
        rawServerId,
        parsed.params,
        lang,
        baseDir,
        preferredServerId,
        preferredServerName
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        serverId: rawServerId ?? 0,
        error: err?.message || 'Error al acuñar servidor para reproducción',
      });
    }
  });

  // POST /api/resolve/penalty (Registra penalización adaptativa ante fallo o timeout 12s)
  router.post('/resolve/penalty', (req: Request, res: Response) => {
    const rawBody = req.body || {};
    const providerId = rawBody.providerId || 'tukiplay';
    const tmdbId = rawBody.tmdbId ?? rawBody.params?.tmdbId;
    const type = rawBody.type ?? rawBody.params?.type ?? 'movie';
    const serverId = rawBody.serverId;
    const penaltyMs = Number(rawBody.penaltyMs) || 15_000;
    const reason = rawBody.reason || 'desconocido';

    if (!tmdbId || serverId === undefined || serverId === null) {
      res.status(400).json({ error: 'Faltan parámetros requeridos tmdbId o serverId' });
      return;
    }

    const titleId = `${type}:${tmdbId}`;
    const newPenalty = recordServerPenalty(providerId, titleId, serverId, penaltyMs, reason);
    console.log(`[Penalty] Servidor "${serverId}" penalizado en ${titleId}: +${penaltyMs}ms (total=${newPenalty}ms, motivo="${reason}")`);

    res.json({
      success: true,
      providerId,
      titleId,
      serverId,
      penaltyMs: newPenalty,
      penaltiesCount: getPenaltiesCount(),
    });
  });

  // GET /api/resolve/penalties
  router.get('/resolve/penalties', (_req: Request, res: Response) => {
    res.json({
      count: getPenaltiesCount(),
      penalties: getAllPenalties(),
    });
  });

  // GET /api/resolve/status (registrado antes de :jobId)
  router.get('/resolve/status', (_req: Request, res: Response) => {
    res.json({
      metrics: getResolveMetrics(baseDir),
      jobsTracked: jobs.size,
      penaltiesCount: getPenaltiesCount(),
      penalties: getAllPenalties(),
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

    const fallbackServerKey = `servers:${record.providerId}:${record.coalescingKey.split(':').slice(1).join(':')}:latino`;
    const cachedServers = getCachedServerList(record.coalescingKey) || getCachedServerList(fallbackServerKey);
    res.json({
      jobId: record.jobId,
      cached: record.cached,
      coalesced: record.coalesced,
      ...(record.result || { status: 'degraded', url: '', serverCount: 0, waitedMs: 0 }),
      servers: cachedServers?.value?.servers || [],
    });
  });

  return router;
}
