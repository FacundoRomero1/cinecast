import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { broadcastWsEvent } from '../ws.js';
import type { CachedServerMetadata, ResolvedServerEntry } from './cache.js';
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
import { buildResolveTitleId, getAllPenalties, getPenaltiesCount, recordServerPenalty } from './penalties.js';
import { buildCoalescingKey } from './queue.js';
import { getVidLinkProVideo } from '../extractors/vidlink.js';
import {
  resolveAnimeServers,
  reportAnimeFailure,
  reportAnimeSuccess,
  getAllAnimeQualityScores,
} from '../anime/orchestrator.js';
import { getTmdbKey, TMDB_URL } from '../tmdb.js';

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
    typeof b.providerId === 'string' && b.providerId.trim() && b.providerId.trim() !== 'tukiplay' && b.providerId.trim() !== 'streamhg'
      ? b.providerId.trim()
      : 'vidlink.pro';
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

function isResolvedServerEntry(
  s: CachedServerMetadata | ResolvedServerEntry
): s is ResolvedServerEntry {
  return 'validated' in s;
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
      const first = servers[0];
      let firstUrl = '';
      if (first) {
        if (isResolvedServerEntry(first)) {
          firstUrl = first.url || first.link || '';
        } else {
          firstUrl = first.stream_url || first.cdn_url || first.play || first.original || first.link || '';
        }
      }
      const resVal: ResolveResult = {
        status: 'ready',
        url: firstUrl,
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
    const rawProv = rawBody.providerId;
    const providerId = rawProv && rawProv !== 'tukiplay' && rawProv !== 'streamhg' ? rawProv : 'vidlink.pro';
    const tmdbId = rawBody.tmdbId ?? rawBody.params?.tmdbId;
    const type = rawBody.type ?? rawBody.params?.type ?? 'movie';
    const rawSeason = Number(rawBody.season ?? rawBody.params?.season);
    const rawEpisode = Number(rawBody.episode ?? rawBody.params?.episode);
    const serverId = rawBody.serverId;
    const penaltyMs = Number(rawBody.penaltyMs) || 15_000;
    const reason = rawBody.reason || 'desconocido';

    if (!tmdbId || serverId === undefined || serverId === null) {
      res.status(400).json({ error: 'Faltan parámetros requeridos tmdbId o serverId' });
      return;
    }

    const titleId = buildResolveTitleId(
      type,
      tmdbId,
      Number.isFinite(rawSeason) ? rawSeason : undefined,
      Number.isFinite(rawEpisode) ? rawEpisode : undefined
    );
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

  // GET /api/stream/direct?provider=vidlink&tmdbId=...&type=...&season=...&episode=...
  router.get('/stream/direct', async (req: Request, res: Response) => {
    const provider = String(req.query.provider || 'vidlink').toLowerCase();
    const tmdbId = String(req.query.tmdbId || req.query.id || '').trim();
    const rawType = String(req.query.type || 'movie').toLowerCase();
    const type: 'movie' | 'tv' | 'anime' = (rawType === 'series' || rawType === 'tv') ? 'tv' : rawType === 'anime' ? 'anime' : 'movie';
    const season = Math.max(1, Number(req.query.season) || 1);
    const episode = Math.max(1, Number(req.query.episode) || 1);

    if (!tmdbId) {
      res.status(400).json({ success: false, error: 'tmdbId requerido' });
      return;
    }

    try {
      const framexUrl = type === 'tv'
        ? `https://api.framextv.tech/api/stream?id=${encodeURIComponent(tmdbId)}&type=tv&season=${season}&episode=${episode}`
        : `https://api.framextv.tech/api/stream?id=${encodeURIComponent(tmdbId)}&type=movie`;

      // Consultar VidLink y FrameXTV en paralelo con Promise.allSettled para máxima resiliencia
      const [vidlinkSettled, framexSettled] = await Promise.allSettled([
        getVidLinkProVideo({ id: tmdbId, type, season, episode }).catch((err) => {
          console.warn('[stream/direct] VidLink error:', err?.message);
          return undefined;
        }),
        fetch(framexUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(6000),
        }).then(async (r) => (r.ok ? r.json() : null)).catch((err) => {
          console.warn('[stream/direct] FrameXTV error:', err?.message);
          return null;
        }),
      ]);

      // 1. Priorizar VidLink si respondió con stream playlist .m3u8
      if (vidlinkSettled.status === 'fulfilled' && vidlinkSettled.value?.stream?.playlist) {
        const vl = vidlinkSettled.value;
        res.json({
          success: true,
          provider: 'vidlink',
          url: vl.stream.playlist,
          type: 'hls',
          captions: vl.stream.captions || [],
        });
        return;
      }

      // 2. Si VidLink falló o no tiene stream directo, usar FrameXTV
      if (framexSettled.status === 'fulfilled' && framexSettled.value) {
        const fxJson = framexSettled.value as any;
        const firstSource = fxJson?.sources?.find((s: any) => s.url && s.url.includes('.m3u8')) || fxJson?.sources?.[0];
        if (firstSource?.url) {
          res.json({
            success: true,
            provider: 'framextv',
            url: firstSource.url,
            type: 'hls',
            captions: fxJson.subtitles || [],
          });
          return;
        }
      }

      res.status(404).json({
        success: false,
        error: 'No se encontró stream directo .m3u8 para este contenido',
        url: null,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err?.message || 'Error al obtener stream directo',
        url: null,
      });
    }
  });

  // GET /api/anime/jimov?title=...&episode=...
  router.get('/anime/jimov', async (req: Request, res: Response) => {
    const rawTitle = String(req.query.title || '').trim();
    const episode = Math.max(1, Number(req.query.episode) || 1);

    if (!rawTitle) {
      res.status(400).json({ success: false, error: 'title requerido' });
      return;
    }

    // Normalizar slug para AnimeLatinoHD
    const slug = rawTitle
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const extractedServers: Array<{ name: string; url: string; language?: string }> = [];

    try {
      // 1. Consultar la API de Jimov para obtener id / slug
      const searchUrls = [
        `https://jimov-api.vercel.app/anime/animelatinohd/search/${encodeURIComponent(rawTitle)}`,
        `https://jimov-api.vercel.app/anime/animelatinohd/filter?search=${encodeURIComponent(rawTitle)}`,
        `https://jimov-api.vercel.app/anime/animelatinohd/name/${encodeURIComponent(slug)}`,
      ];

      let animeId = slug;

      for (const searchUrl of searchUrls) {
        try {
          const sRes = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(3500),
          });
          if (sRes.ok) {
            const text = await sRes.text();
            if (text && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
              const data = JSON.parse(text);
              const foundId =
                data?.results?.[0]?.url?.split('/').pop() ||
                data?.data?.[0]?.slug ||
                data?.id ||
                data?.slug;
              if (foundId) {
                animeId = foundId;
                break;
              }
            }
          }
        } catch (_) {}
      }

      // 2. Consultar episodio en Jimov
      const episodeUrls = [
        `https://jimov-api.vercel.app/anime/animelatinohd/episode/${animeId}/${episode}`,
        `https://jimov-api.vercel.app/anime/animelatinohd/episode/${animeId}-${episode}`,
      ];

      for (const epUrl of episodeUrls) {
        try {
          const epRes = await fetch(epUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(3500),
          });
          if (epRes.ok) {
            const text = await epRes.text();
            if (text && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
              const epData = JSON.parse(text);
              const rawServers = epData?.servers || epData?.players || [];
              if (Array.isArray(rawServers) && rawServers.length > 0) {
                for (const s of rawServers) {
                  const sUrl = s?.url || s?.link || s?.code;
                  const sName = s?.name || s?.server || s?.title || 'Latino';
                  if (sUrl && typeof sUrl === 'string') {
                    extractedServers.push({
                      name: `Latino (Jimov - ${sName})`,
                      url: sUrl,
                      language: 'Latino',
                    });
                  }
                }
              }
              if (extractedServers.length > 0) break;
            }
          }
        } catch (_) {}
      }
    } catch (err: any) {
      console.warn('[anime/jimov] Error consultando Jimov API:', err?.message);
    }

    // 3. Fallback inteligente con enlaces funcionales si Jimov API no devolvió reproductores
    if (extractedServers.length === 0) {
      extractedServers.push(
        {
          name: 'Latino (AnimeLatinoHD)',
          url: `https://www.animelatinohd.com/ver/${slug}/${episode}`,
          language: 'Latino',
        },
        {
          name: 'Latino (StreamWish)',
          url: `https://streamwish.to/e/${slug}-ep-${episode}`,
          language: 'Latino',
        }
      );
    }

    // Si la petición proviene de un navegador o iframe directamente (pide text/html sin application/json), redirigir al embed
    const acceptHeader = String(req.headers.accept || '');
    if (acceptHeader.includes('text/html') && !acceptHeader.includes('application/json') && extractedServers[0]?.url) {
      res.redirect(extractedServers[0].url);
      return;
    }

    res.json({
      success: true,
      title: rawTitle,
      episode,
      slug,
      servers: extractedServers,
    });
  });

  // Caché de conteo de episodios por temporada (TMDB) para mapear T>1 a episodio absoluto en anime
  const animeSeasonCountsCache = new Map<string, Array<{ season_number: number; episode_count: number }>>();
  async function resolveAbsoluteAnimeEpisode(tmdbId: string, season: number, episode: number): Promise<number> {
    if (season <= 1) return episode;
    const cleanId = String(tmdbId || '').replace(/[^\d]/g, '');
    if (!cleanId || cleanId === '0') return episode;
    let seasons = animeSeasonCountsCache.get(cleanId);
    if (!seasons) {
      try {
        const key = getTmdbKey();
        const r = await fetch(`${TMDB_URL}/tv/${cleanId}?api_key=${encodeURIComponent(key)}&language=es-MX`, {
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const j = (await r.json()) as { seasons?: Array<{ season_number?: number; episode_count?: number }> };
          if (Array.isArray(j?.seasons)) {
            seasons = j.seasons.map((s) => ({
              season_number: Number(s.season_number || 0),
              episode_count: Number(s.episode_count || 0),
            }));
            animeSeasonCountsCache.set(cleanId, seasons);
          }
        }
      } catch (_) {}
    }
    if (!seasons || seasons.length === 0) return episode;
    let offset = 0;
    for (const s of seasons) {
      if (s.season_number >= 1 && s.season_number < season && s.episode_count > 0) {
        offset += s.episode_count;
      }
    }
    return offset > 0 ? offset + episode : episode;
  }

  // GET /api/anime/servers?tmdbId=...&title=...&season=...&episode=...
  router.get('/anime/servers', async (req: Request, res: Response) => {
    const tmdbId = String(req.query.tmdbId || req.query.id || '').trim();
    const rawTitle = String(req.query.title || '').trim();
    const season = Math.max(1, Number(req.query.season) || 1);
    const episode = Math.max(1, Number(req.query.episode) || 1);
    const explicitAbs = Math.floor(Number(req.query.absoluteEpisode) || 0);
    const runtime = Number(req.query.runtime) || 24;

    if (!rawTitle && !tmdbId) {
      res.status(400).json({ success: false, error: 'Parámetros title o tmdbId requeridos' });
      return;
    }

    try {
      const effectiveEpisode =
        explicitAbs > 0
          ? explicitAbs
          : season > 1
            ? await resolveAbsoluteAnimeEpisode(tmdbId, season, episode)
            : episode;
      if (effectiveEpisode !== episode) {
        console.log(`[anime/servers] Mapeo T${season}E${episode} -> episodio absoluto ${effectiveEpisode} (tmdb=${tmdbId})`);
      }
      const servers = await resolveAnimeServers(tmdbId || '0', rawTitle || tmdbId, effectiveEpisode, runtime);
      res.json({
        success: true,
        tmdbId,
        title: rawTitle,
        season,
        episode,
        effectiveEpisode,
        servers,
      });
    } catch (err: any) {
      console.warn('[anime/servers] Error orquestando servidores de anime:', err?.message);
      res.status(500).json({
        success: false,
        error: err?.message || 'Error orquestando servidores de anime',
        servers: [],
      });
    }
  });

  // POST o GET /api/report-anime-failure
  const handleAnimeFailure = (req: Request, res: Response) => {
    const providerId = String(req.body?.providerId || req.query?.providerId || '').trim();
    const tmdbId = String(req.body?.tmdbId || req.query?.tmdbId || '').trim();
    const episode = Math.max(1, Number(req.body?.episode || req.query?.episode) || 1);

    if (!providerId) {
      res.status(400).json({ success: false, error: 'providerId requerido' });
      return;
    }

    const newScore = reportAnimeFailure(providerId, tmdbId || '0', episode);
    res.json({
      success: true,
      providerId,
      tmdbId,
      episode,
      newScore,
    });
  };

  router.post('/report-anime-failure', handleAnimeFailure);
  router.get('/report-anime-failure', handleAnimeFailure);
  router.post('/anime/report-failure', handleAnimeFailure);
  router.get('/anime/report-failure', handleAnimeFailure);

  // POST o GET /api/report-anime-success
  const handleAnimeSuccess = (req: Request, res: Response) => {
    const providerId = String(req.body?.providerId || req.query?.providerId || '').trim();
    const tmdbId = String(req.body?.tmdbId || req.query?.tmdbId || '').trim();
    const episode = Math.max(1, Number(req.body?.episode || req.query?.episode) || 1);

    if (!providerId) {
      res.status(400).json({ success: false, error: 'providerId requerido' });
      return;
    }

    const newScore = reportAnimeSuccess(providerId, tmdbId || '0', episode);
    res.json({
      success: true,
      providerId,
      tmdbId,
      episode,
      newScore,
    });
  };

  router.post('/report-anime-success', handleAnimeSuccess);
  router.get('/report-anime-success', handleAnimeSuccess);
  router.post('/anime/report-success', handleAnimeSuccess);
  router.get('/anime/report-success', handleAnimeSuccess);

  // GET /api/anime/scores
  router.get('/anime/scores', (_req: Request, res: Response) => {
    res.json({
      success: true,
      scores: getAllAnimeQualityScores(),
    });
  });

  return router;
}
