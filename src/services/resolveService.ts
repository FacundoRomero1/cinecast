import { deviceSync } from './deviceSync';

export interface RequestServersOptions {
  type?: 'movie' | 'series' | 'anime' | string;
  tmdbId: number;
  season?: number;
  episode?: number;
  lang?: string;
  signal?: AbortSignal;
}

export interface ResolvedServer {
  id: number | string;
  name: string;
  lang: string;
  popular: number;
  picks: number;
  url?: string;
  playable?: 'hls' | 'iframe';
  validated?: boolean;
  link?: string;
  acao?: string | null;
  speedMs?: number;
  audioLangs?: string[];
}

export interface ResolveServersResult {
  status: 'ready' | 'empty' | 'degraded';
  servers: ResolvedServer[];
  jobId?: string;
  cached?: boolean;
}

export interface ResolvePlayOptions {
  providerId?: string;
  serverId?: number | string;
  preferredServerId?: number | string;
  preferredServerName?: string;
  params: {
    type?: string;
    tmdbId: number;
    season?: number;
    episode?: number;
  };
  lang?: string;
  signal?: AbortSignal;
}

export interface ResolvePlayResult {
  success: boolean;
  serverId: number | string;
  name: string;
  url: string;
  playable: 'hls' | 'iframe';
  acao?: string | null;
  speedMs?: number;
  audioLangs?: string[];
  error?: string;
  servers?: ResolvedServer[];
}

export function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.CINECAST_API_BASE) {
    return process.env.CINECAST_API_BASE;
  }
  if (typeof window !== 'undefined') {
    return deviceSync?.getApiBase?.() || window.location?.origin || '';
  }
  return '';
}

/**
 * Acuña la URL fresca y playable definitivo llamando a POST /api/resolve/play justo antes de montar el reproductor.
 * Sin caché de URL: siempre resuelve o valida en tiempo real.
 */
export async function resolveServerPlay(
  options: ResolvePlayOptions
): Promise<ResolvePlayResult> {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/resolve/play`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerId: options.providerId || 'vidlink.pro',
        serverId: options.serverId,
        preferredServerId: options.preferredServerId,
        preferredServerName: options.preferredServerName,
        params: options.params,
        lang: options.lang || 'latino',
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      return {
        success: false,
        serverId: options.serverId ?? 0,
        name: 'Desconocido',
        url: '',
        playable: 'iframe',
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      success: Boolean(data.success),
      serverId: data.serverId ?? options.serverId ?? 0,
      name: data.name || 'Desconocido',
      url: data.url || '',
      playable: data.playable === 'hls' ? 'hls' : 'iframe',
      acao: data.acao ?? null,
      speedMs: typeof data.speedMs === 'number' ? data.speedMs : undefined,
      audioLangs: Array.isArray(data.audioLangs) ? data.audioLangs : undefined,
      error: data.error,
      servers: Array.isArray(data.servers) ? data.servers : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      serverId: options.serverId ?? 0,
      name: 'Desconocido',
      url: '',
      playable: 'iframe',
      error: err?.message || 'Error al acuñar servidor',
    };
  }
}

/**
 * Reporta una falla o timeout de 12s para registrar penalización adaptativa (memoria, TTL 1h).
 */
export async function reportServerPlaybackPenalty(params: {
  providerId?: string;
  tmdbId: number;
  type?: string;
  serverId: number | string;
  penaltyMs?: number;
  reason?: string;
}): Promise<void> {
  const apiBase = getApiBaseUrl();
  try {
    await fetch(`${apiBase}/api/resolve/penalty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: params.providerId || 'vidlink.pro',
        tmdbId: params.tmdbId,
        type: params.type || 'movie',
        serverId: params.serverId,
        penaltyMs: params.penaltyMs || 15000,
        reason: params.reason || 'desconocido',
      }),
    });
  } catch (_) { }
}

/**
 * Solicita los servidores disponibles para un título con TMDB ID.
 * - POST /api/resolve
 * - Si trae resultado inmediato lo devuelve
 * - Si no, se suscribe al evento WS 'resolve' filtrando por jobId
 * - Timeout de 30s con fallback a GET /api/resolve/:jobId cada 2s
 * - Nunca lanza: en error devuelve { status: 'degraded', servers: [] }
 * - Cancela suscripción y polling al resolverse o al desmontar (via signal o cancel)
 */
export function requestServers(
  options: RequestServersOptions
): Promise<ResolveServersResult> & { cancel: () => void } {
  let isSettled = false;
  let cancelFn = () => { };

  const promise = new Promise<ResolveServersResult>(async (resolvePromise) => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubWs: (() => void) | null = null;
    let standaloneWs: WebSocket | null = null;

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (unsubWs) {
        unsubWs();
        unsubWs = null;
      }
      if (standaloneWs) {
        try {
          standaloneWs.close();
        } catch (_) { }
        standaloneWs = null;
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (result: ResolveServersResult) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolvePromise(result);
    };

    const onAbort = () => {
      finish({ status: 'degraded', servers: [] });
    };

    cancelFn = () => {
      finish({ status: 'degraded', servers: [] });
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finish({ status: 'degraded', servers: [] });
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const tmdbId = Math.floor(Number(options.tmdbId));
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
        finish({ status: 'degraded', servers: [] });
        return;
      }

      const rawType = typeof options.type === 'string' ? options.type.trim().toLowerCase() : 'movie';
      let type: 'movie' | 'series' | 'anime' = 'movie';
      if (rawType === 'series' || rawType === 'tv') {
        type = 'series';
      } else if (rawType === 'anime') {
        type = 'anime';
      }

      const lang = options.lang ? String(options.lang).trim() : 'latino';
      const season =
        options.season !== undefined && Number.isFinite(Number(options.season))
          ? Math.floor(Number(options.season))
          : undefined;
      const episode =
        options.episode !== undefined && Number.isFinite(Number(options.episode))
          ? Math.floor(Number(options.episode))
          : undefined;

      const apiBase =
        (typeof process !== 'undefined' && process.env?.CINECAST_API_BASE)
          ? process.env.CINECAST_API_BASE
          : typeof window !== 'undefined'
            ? (deviceSync?.getApiBase?.() || window.location?.origin || '')
            : '';

      // Helper para obtener lista completa de servidores validados/HLS via GET /api/resolve/servers
      const fetchFullServers = async (): Promise<ResolvedServer[]> => {
        try {
          const q = new URLSearchParams({
            providerId: 'vidlink.pro',
            type,
            tmdbId: String(tmdbId),
            lang,
          });
          if (season !== undefined) q.set('season', String(season));
          if (episode !== undefined) q.set('episode', String(episode));

          const res = await fetch(`${apiBase}/api/resolve/servers?${q.toString()}`, {
            signal: options.signal,
          });
          if (!res.ok) return [];
          const data = await res.json();
          if (Array.isArray(data?.servers)) {
            return data.servers;
          }
          return [];
        } catch {
          return [];
        }
      };

      // 1. POST /api/resolve
      const postBody: Record<string, unknown> = {
        providerId: 'vidlink.pro',
        type,
        tmdbId,
        lang,
      };
      if (season !== undefined) postBody.season = season;
      if (episode !== undefined) postBody.episode = episode;

      let postRes: Response;
      try {
        postRes = await fetch(`${apiBase}/api/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
          signal: options.signal,
        });
      } catch {
        finish({ status: 'degraded', servers: [] });
        return;
      }

      if (!postRes.ok) {
        finish({ status: 'degraded', servers: [] });
        return;
      }

      let postData: any;
      try {
        postData = await postRes.json();
      } catch {
        finish({ status: 'degraded', servers: [] });
        return;
      }

      // Si trae resultado inmediato (status !== 'pending' o 200 con servers/ready)
      if (postData && postData.status && postData.status !== 'pending') {
        let servers: ResolvedServer[] = [];
        if (Array.isArray(postData.servers) && postData.servers.length > 0) {
          servers = postData.servers;
        } else if (postData.status === 'ready') {
          servers = await fetchFullServers();
        }
        if (postData.status === 'ready' || postData.status === 'empty' || servers.length > 0) {
          finish({
            status: servers.length > 0 ? 'ready' : postData.status,
            servers,
            jobId: postData.jobId,
            cached: Boolean(postData.cached),
          });
          return;
        }
      }

      const jobId = postData?.jobId;
      if (!jobId || typeof jobId !== 'string') {
        finish({ status: 'degraded', servers: [] });
        return;
      }

      // Función que procesa el desenlace del job (sea de WS o de polling)
      const handleJobOutcome = async (payload: any) => {
        if (isSettled) return;
        const status = payload?.status;
        if (!status || status === 'pending') return;

        let servers: ResolvedServer[] = [];
        if (Array.isArray(payload?.servers) && payload.servers.length > 0) {
          servers = payload.servers;
        } else if (status === 'ready' || Number(payload?.serverCount) > 0 || status === 'degraded') {
          servers = await fetchFullServers();
        }

        if (status === 'ready' || servers.length > 0) {
          finish({
            status: 'ready',
            servers,
            jobId,
            cached: Boolean(payload?.cached),
          });
          return;
        }

        if (status === 'empty') {
          finish({
            status: 'empty',
            servers: [],
            jobId,
            cached: Boolean(payload?.cached),
          });
          return;
        }

        // Si status === 'degraded' pero servers aún no está listo, permitir que el polling siga
        // hasta el timeout de 30s o hasta que completionPromise termine.
      };

      // 2. Suscripción al evento WS 'resolve' filtrando por jobId
      const onWsMessage = (msg: any) => {
        if (msg && msg.type === 'resolve' && msg.jobId === jobId) {
          void handleJobOutcome(msg);
        }
      };

      // Intentar suscripción vía deviceSync
      if (typeof deviceSync?.onResolve === 'function') {
        unsubWs = deviceSync.onResolve(onWsMessage);
      }

      // Fallback a WebSocket nativo directo si deviceSync no está conectado o en entorno sin deviceSync
      if (typeof window !== 'undefined' && (!deviceSync?.isConnected || !unsubWs)) {
        try {
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const host = window.location.host;
          if (host) {
            const ws = new WebSocket(`${proto}//${host}/ws`);
            standaloneWs = ws;
            ws.onmessage = (event) => {
              try {
                const parsed = JSON.parse(event.data);
                onWsMessage(parsed);
              } catch (_) { }
            };
            ws.onerror = () => {
              try { ws.close(); } catch (_) { }
            };
          }
        } catch (_) { }
      }

      // 3. Fallback a GET /api/resolve/:jobId cada 2s
      pollInterval = setInterval(async () => {
        if (isSettled) return;
        try {
          const pollRes = await fetch(`${apiBase}/api/resolve/${jobId}`, {
            signal: options.signal,
          });
          if (!pollRes.ok) {
            if (pollRes.status === 404) {
              // El job terminó y fue purgado del servidor; consultar servidores finales
              const servers = await fetchFullServers();
              finish({
                status: servers.length > 0 ? 'ready' : 'degraded',
                servers,
                jobId,
              });
            }
            return;
          }
          const pollData = await pollRes.json();
          if (pollData && pollData.status && pollData.status !== 'pending') {
            void handleJobOutcome(pollData);
          }
        } catch {
          // Error de red temporal en el polling: no lanzar, continuar reintentando
        }
      }, 2000);

      // 4. Timeout de 30s
      timeoutTimer = setTimeout(async () => {
        if (isSettled) return;
        try {
          const fallbackServers = await fetchFullServers();
          if (fallbackServers.length > 0) {
            finish({ status: 'ready', servers: fallbackServers, jobId });
            return;
          }
        } catch (_) { }
        finish({ status: 'degraded', servers: [] });
      }, 30000);
    } catch {
      finish({ status: 'degraded', servers: [] });
    }
  });

  (promise as any).cancel = cancelFn;
  return promise as Promise<ResolveServersResult> & { cancel: () => void };
}
