import { StreamServer } from '../types';
import animeLatinoMap from '../data/animeLatinoMap.json';
import latinoMap from '../data/latino-map.json';

export interface GenerateServersOptions {
  tmdbId?: number;
  imdbId?: string;
  type?: 'movie' | 'series' | 'anime' | 'live_tv';
  season?: number;
  episode?: number;
  directMp4Url?: string;
  customServers?: StreamServer[];
}

const HEALTH_KEY = 'cinecast_provider_health_v1';
const HEALTH_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas
const PRIMARY_PROVIDER = 'TukiPlay (HD)';

interface ProviderHealthEntry {
  ok: boolean;
  ms: number;
}

function readProviderHealth(): Record<string, ProviderHealthEntry> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(HEALTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > HEALTH_TTL_MS) return null;
    return parsed.providers || null;
  } catch (_) {
    return null;
  }
}

/**
 * Pregunta a Electron qué proveedores embed responden hoy (y en cuántos ms) y lo guarda en caché.
 * Se llama al iniciar la app; en navegador/celular no hace nada.
 */
export async function refreshProviderHealth(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.checkEmbedProviders) return;
    const results = await window.electronAPI.checkEmbedProviders();
    if (!Array.isArray(results) || results.length === 0) return;
    const providers: Record<string, ProviderHealthEntry> = {};
    for (const r of results) providers[r.name] = { ok: r.ok, ms: r.ms };
    window.localStorage.setItem(HEALTH_KEY, JSON.stringify({ timestamp: Date.now(), providers }));
  } catch (e) {
    console.warn('No se pudo verificar proveedores embed:', e);
  }
}

/** TukiPlay primero; luego servidores vivos del más rápido al más lento; sin datos al medio; caídos al final. */
function applyProviderRanking(servers: StreamServer[]): StreamServer[] {
  const health = readProviderHealth();
  if (!health) return [...servers];

  const primaryWasFirst = servers[0]?.name === PRIMARY_PROVIDER;
  const slots: number[] = [];
  const rankable: Array<{ s: StreamServer; i: number }> = [];
  servers.forEach((s, i) => {
    if (s.type === 'iframe' && (s.name === PRIMARY_PROVIDER || health[s.name])) {
      slots.push(i);
      rankable.push({ s, i });
    }
  });
  if (rankable.length < 2) return [...servers];

  const score = ({ s }: { s: StreamServer }) => {
    if (s.name === PRIMARY_PROVIDER) return 0;
    const h = health[s.name];
    if (!h) return 5;
    return h.ok ? 1 + Math.min(h.ms, 60000) / 100000 : 10;
  };
  rankable.sort((a, b) => score(a) - score(b) || a.i - b.i);

  const result = [...servers];
  slots.forEach((slot, k) => {
    result[slot] = rankable[k].s;
  });

  if (primaryWasFirst && result[0]?.name !== PRIMARY_PROVIDER) {
    const tukiIdx = result.findIndex((s) => s.name === PRIMARY_PROVIDER);
    if (tukiIdx > 0) {
      const [tuki] = result.splice(tukiIdx, 1);
      result.unshift(tuki);
    }
  }
  return result;
}

/**
 * Genera servidores de streaming de alta disponibilidad estilo Fuegocine y TuDeporte.
 * Diferencia correctamente entre Películas (/movie/) y Series/Anime (/tv/).
 * Servidores verificados y funcionales en 2024-2025.
 */
export function generateServersForMedia(options: GenerateServersOptions): StreamServer[] {
  const { tmdbId, type = 'movie', season = 1, episode = 1, directMp4Url, customServers } = options;

  // Hook para pruebas: con CINECAST_TEST=1 se puede reemplazar por window.__CINECAST_TEST_SERVERS
  const isTest =
    (typeof window !== 'undefined' && Boolean((window as any).__CINECAST_TEST)) ||
    (typeof process !== 'undefined' && process.env?.CINECAST_TEST === '1');
  if (
    isTest &&
    typeof window !== 'undefined' &&
    Array.isArray((window as any).__CINECAST_TEST_SERVERS)
  ) {
    const templates = (window as any).__CINECAST_TEST_SERVERS as Array<{
      name: string;
      urlTemplate: string;
      language?: string;
    }>;
    return templates.map((t) => ({
      name: t.name,
      url: t.urlTemplate
        .replace('{id}', String(tmdbId || ''))
        .replace('{season}', String(season || 1))
        .replace('{episode}', String(episode || 1)),
      type: 'iframe',
      language: t.language || 'Prueba',
    }));
  }

  const servers: StreamServer[] = [];

  // 1. Servidores personalizados (máxima prioridad)
  if (customServers && customServers.length > 0) {
    servers.push(...customServers);
  }

  // 2. URL directa MP4/HLS (Archive.org, CDN, IPTV m3u8)
  const isDirectHls = Boolean(directMp4Url && directMp4Url.includes('.m3u8'));
  if (
    directMp4Url &&
    (directMp4Url.includes('.mp4') ||
      directMp4Url.includes('.m3u8') ||
      directMp4Url.includes('archive.org/download') ||
      directMp4Url.includes('commondatastorage') ||
      directMp4Url.includes('zencdn.net'))
  ) {
    servers.push({
      name: isDirectHls ? 'Señal en Vivo (HLS / IPTV)' : 'Reproducción Directa MP4 (HD)',
      url: directMp4Url,
      type: isDirectHls ? 'hls' : 'mp4',
      language: isDirectHls ? 'En Vivo' : 'Audio Original',
    });
  }

  // 3. Generar servidores Embed automáticos a partir de TMDB ID (Espejos múltiples de alta disponibilidad)
  if (tmdbId && tmdbId > 0) {
    const isTV = type === 'series' || type === 'anime';

    // Verificación de mapa de anime con doblaje latino verificado
    let animeLatinoServer: StreamServer | null = null;
    const animeEntry = type === 'anime' ? (animeLatinoMap as Record<string, any>)[String(tmdbId)] : null;
    if (animeEntry?.hasLatino && animeEntry?.verifiedServer) {
      let epUrl = animeEntry.verifiedServer.url;
      if (animeEntry.verifiedServer.episodePattern && episode) {
        epUrl = animeEntry.verifiedServer.episodePattern.replace('{episode}', String(episode));
      }
      animeLatinoServer = {
        name: animeEntry.verifiedServer.name || 'Anime Latino (verificado)',
        url: epUrl,
        type: 'iframe',
        language: '🇲🇽 Latino verificado',
      };
    }

    // ─── PUESTO #1: TukiPlay (HD) ───
    const tukiPlayUrl = isTV
      ? `https://tukiplay.com/embed/tv/${tmdbId}/${season}/${episode}`
      : `https://tukiplay.com/embed/movie/${tmdbId}`;
    servers.push({
      name: 'TukiPlay (HD)',
      url: tukiPlayUrl,
      type: 'iframe',
      language: type === 'anime' ? 'Audio Original (Sub ES)' : 'Audio según servidor',
    });

    // ─── PUESTO #2: Vidsrc CC (Latino / ES) ───
    const vidsrcCcUrl = isTV
      ? `https://vidsrc.cc/embed/tv/${tmdbId}/${season}-${episode}?lang=es`
      : `https://vidsrc.cc/embed/movie/${tmdbId}?lang=es`;
    servers.push({
      name: 'Vidsrc CC (Latino / ES)',
      url: vidsrcCcUrl,
      type: 'iframe',
      language: '🇲🇽 Latino / Español',
    });

    // ─── PUESTO #3: VidEasy (Multi) ───
    const vidEasyUrl = isTV
      ? `https://player.videasy.net/tv/${tmdbId}/${season}/${episode}`
      : `https://player.videasy.net/movie/${tmdbId}`;
    servers.push({
      name: 'VidEasy (Multi)',
      url: vidEasyUrl,
      type: 'iframe',
      language: '🌐 Multi / Original',
    });

    // Si tiene servidor Latino verificado, arranca DIRECTO en él (puesto #0 absoluto)
    if (animeLatinoServer) {
      servers.unshift(animeLatinoServer);
    } else {
      // TAREA 6: Si hay entrada verificada en latino-map.json, arranca directo en ese proveedor
      const latinoEntry = (latinoMap as Record<string, any>)[String(tmdbId)];
      if (latinoEntry?.provider) {
        const idx = servers.findIndex((s) => s.name.toLowerCase().includes(latinoEntry.provider.toLowerCase()));
        if (idx > 0) {
          const [verifiedSrv] = servers.splice(idx, 1);
          servers.unshift(verifiedSrv);
        }
      }
    }
  }

  // 4. Señal directa embed (live TV, byseraguci, etc.) — se agrega al final, sin desordenar servidores principales
  if (directMp4Url && !servers.some((s) => s.url === directMp4Url)) {
    servers.push({
      name: 'Señal Principal / En Vivo',
      url: directMp4Url,
      type: 'iframe',
      language: 'En Vivo',
    });
  }

  // 5. Fallback absoluto
  if (servers.length === 0) {
    servers.push({
      name: 'Servidor Alternativo (HD)',
      url: 'https://vjs.zencdn.net/v/oceans.mp4',
      type: 'mp4',
      language: 'Audio Original',
    });
  }

  // 6. Orden por salud diaria (TukiPlay primero, vivos más rápidos después, caídos al final)
  const ranked = applyProviderRanking(servers);
  const ordered = [...ranked];

  // 7. Si el usuario tiene un servidor ganador/preferido en localStorage, ubicarlo al frente
  try {
    if (typeof window !== 'undefined' && window.localStorage && tmdbId) {
      const favKey = `cinecast_fav_server:${type}:${tmdbId}`;
      let raw = window.localStorage.getItem(favKey);
      if (!raw && (type === 'anime' || (type as string) === 'tv')) {
        raw = window.localStorage.getItem(`cinecast_fav_server:series:${tmdbId}`);
      }
      if (raw) {
        let preferredName = '';
        let preferredId: string | number | undefined = undefined;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.name) preferredName = parsed.name;
            if (parsed.id !== undefined) preferredId = parsed.id;
          }
        } catch (_) {}
        if (!preferredName && typeof raw === 'string') {
          preferredName = raw;
        }
        if (preferredName || preferredId !== undefined) {
          const prefIdx = ordered.findIndex((s) => {
            if (preferredId !== undefined && (s as any).id !== undefined) {
              return String((s as any).id) === String(preferredId);
            }
            if (preferredName && s.name) {
              return s.name.toLowerCase() === preferredName.toLowerCase();
            }
            return false;
          });
          if (prefIdx > 0) {
            const [fav] = ordered.splice(prefIdx, 1);
            const isFavHls = fav.type === 'hls' || (fav as any).playable === 'hls';
            const hasHls = ordered.some((s) => s.type === 'hls' || (s as any).playable === 'hls');

            // Requisito 5: usá el favorito solo para reordenar dentro del mismo tipo (hls con hls, iframe con iframe).
            // Si hay HLS disponible y el favorito es iframe, gana el HLS.
            if (!isFavHls && hasHls) {
              const lastHlsIdx = ordered.reduce((acc, s, idx) => (s.type === 'hls' || (s as any).playable === 'hls' ? idx : acc), -1);
              ordered.splice(lastHlsIdx + 1, 0, fav);
            } else {
              ordered.unshift(fav);
            }
          }
        }
      }
    }
  } catch (_) {}

  // 8. Sanitización estricta: ninguna URL con doble punto ni dominios muertos
  const DEAD_DOMAINS = ['vidsrc.pro', 'autoembed.cc', 'smashystream.com', 'embed.su'];
  const sanitized = ordered.filter((s) => {
    if (!s || typeof s.url !== 'string') return false;
    const u = s.url.trim();
    if (!u || u.includes('..')) return false;
    if (DEAD_DOMAINS.some((d) => u.toLowerCase().includes(d))) return false;
    return true;
  });

  return sanitized.length > 0 ? sanitized : ordered;
}

/**
 * Genera servidores para un episodio específico de serie/anime,
 * actualizando las URLs con la temporada y episodio correctos.
 */
export function generateServersForEpisode(
  tmdbId: number,
  type: 'series' | 'anime',
  season: number,
  episode: number
): StreamServer[] {
  return generateServersForMedia({ tmdbId, type, season, episode });
}

/**
 * Parsea un enlace o código HTML de iframe pegado por el usuario.
 * Extrae la URL limpia del atributo src="..." si viene en formato HTML.
 */
export function extractStreamUrl(input: string): { url: string; type: 'mp4' | 'iframe' | 'hls' } {
  let cleaned = input.trim();

  // Si pegó un <iframe>...</iframe> o similar
  const srcMatch = cleaned.match(/src=["']([^"']+)["']/i);
  if (srcMatch && srcMatch[1]) {
    cleaned = srcMatch[1];
  }

  // Limpiar posibles comillas sueltas
  cleaned = cleaned.replace(/^["']|["']$/g, '');

  const lower = cleaned.toLowerCase();
  const isMp4 =
    lower.includes('.mp4') ||
    lower.includes('archive.org/download') ||
    lower.includes('commondatastorage') ||
    lower.includes('zencdn.net');
  const isHls = lower.includes('.m3u8');
  return { url: cleaned, type: isHls ? 'hls' : isMp4 ? 'mp4' : 'iframe' };
}

/**
 * Extrae la dirección real (host y ruta, sin parámetros de consulta sensibles)
 * y la temporada y episodio que se desprenden de la ruta si los incluye.
 */
export function extractCleanRouteAndEp(rawUrl?: string): {
  hostAndPath: string;
  season?: number;
  episode?: number;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { hostAndPath: '' };
  }
  let host = '';
  let pathname = '';
  try {
    const u = new URL(rawUrl);
    host = u.host;
    pathname = u.pathname;
  } catch (_) {
    const parts = rawUrl.split('?')[0].replace(/^https?:\/\//, '');
    const slashIdx = parts.indexOf('/');
    if (slashIdx >= 0) {
      host = parts.slice(0, slashIdx);
      pathname = parts.slice(slashIdx);
    } else {
      host = parts;
      pathname = '';
    }
  }

  const hostAndPath = `${host}${pathname}`;
  let season: number | undefined;
  let episode: number | undefined;

  // 1. /tv/:id/:season/:episode (e.g. /tv/258348/1/12 o /__test/provider/tv/258348/1/12)
  const mTvSlash = pathname.match(/\/tv\/[^\/]+\/(\d+)\/(\d+)/i);
  if (mTvSlash) {
    season = parseInt(mTvSlash[1], 10);
    episode = parseInt(mTvSlash[2], 10);
  } else {
    // 2. /tv/:id/:season-:episode (e.g. /embed/tv/258348/1-12)
    const mTvDash = pathname.match(/\/tv\/[^\/]+\/(\d+)-(\d+)/i);
    if (mTvDash) {
      season = parseInt(mTvDash[1], 10);
      episode = parseInt(mTvDash[2], 10);
    } else {
      // 3. /season/:s/episode/:e o /s/:s/e/:e
      const mSeasonEp = pathname.match(/(?:season|s)[\/-]?(\d+)[\/-]?(?:episode|ep|e)[\/-]?(\d+)/i);
      if (mSeasonEp) {
        season = parseInt(mSeasonEp[1], 10);
        episode = parseInt(mSeasonEp[2], 10);
      } else {
        // 4. /episodio-(\d+) o /episode-(\d+)
        const mEpOnly = pathname.match(/(?:episodio|episode|ep)[-_]?(\d+)/i);
        if (mEpOnly) {
          season = 1;
          episode = parseInt(mEpOnly[1], 10);
        } else {
          // 5. 1x12
          const mCross = pathname.match(/(?:^|\/)(\d+)[xX](\d+)(?:$|\/)/);
          if (mCross) {
            season = parseInt(mCross[1], 10);
            episode = parseInt(mCross[2], 10);
          }
        }
      }
    }
  }

  return { hostAndPath, season, episode };
}
