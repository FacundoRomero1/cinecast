import { get, set, del } from 'idb-keyval';
import { Movie } from '../types';

export const CATALOG_VERSION = 13;
const IDB_CATALOG_KEY = `cinecast_catalog_v${CATALOG_VERSION}`;
const LEGACY_CATALOG_KEYS = ['cinecast_catalog_v12', 'cinecast_catalog_v11'];

const INVALID_TITLE_LITERALS = new Set([
  '',
  'sin título',
  'sin titulo',
  'undefined',
  'null',
  'nan',
  'untitled',
]);

/**
 * Sanitiza un título evitando literales vacíos, placeholders rotos o URLs/IDs crudos.
 */
export function sanitizeCardTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (INVALID_TITLE_LITERALS.has(trimmed.toLowerCase())) return '';
  if (/^https?:\/\//i.test(trimmed) || /^tmdb-(movie|series|anime)-\d+$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Resuelve el título visible seguro para una card (prioriza español localizado antes que original).
 */
export function resolveSafeCardTitle(item: {
  title?: unknown;
  titleEs?: unknown;
  originalTitle?: unknown;
}): string {
  return (
    sanitizeCardTitle(item.titleEs) ||
    sanitizeCardTitle(item.title) ||
    sanitizeCardTitle(item.originalTitle)
  );
}

/**
 * Detecta si una lista cacheada tiene títulos vacíos/corruptos o colisiones movie vs tv con distinto póster.
 */
export function hasCorruptedCatalogEntries(movies: Movie[]): boolean {
  if (!Array.isArray(movies) || movies.length === 0) return false;
  const byTmdb = new Map<number, Array<{ isTv: boolean; titleLower: string; poster: string }>>();

  for (const m of movies) {
    const safeTitle = resolveSafeCardTitle(m);
    if (!safeTitle) return true;

    const tid = Number(m.tmdbId || (m.id && String(m.id).replace(/\D+/g, '')) || 0);
    if (!tid) continue;
    const isTv = m.type !== 'movie' && (m.category === 'series' || m.category === 'anime' || m.type === 'series');
    const poster = String(m.posterUrl || m.posterPath || '').split('/').pop() || '';
    const titleLower = safeTitle.toLowerCase();

    const list = byTmdb.get(tid);
    if (list) {
      for (const prev of list) {
        if (prev.isTv !== isTv && prev.titleLower === titleLower && prev.poster && poster && prev.poster !== poster) {
          return true;
        }
      }
      list.push({ isTv, titleLower, poster });
    } else {
      byTmdb.set(tid, [{ isTv, titleLower, poster }]);
    }
  }
  return false;
}

export interface LeanCatalogEntry {
  version: number;
  timestamp: number;
  movies: Movie[];
}

/**
 * Limpia y compacta un objeto de película, reteniendo todos los campos
 * estrictamente necesarios para la interfaz y reproducción (evita pérdida de propiedades en la UI).
 */
export function compactMovie(m: any): Movie {
  const isMovieExplicit = m.type === 'movie';
  const isTV = !isMovieExplicit && (m.category === 'series' || m.category === 'anime' || m.type === 'series');
  const tmdbId = Number(m.tmdbId || (m.id && String(m.id).replace(/\D+/g, '')) || 0);
  const poster = m.posterUrl || m.posterPath || '';
  const backdrop = m.backdropUrl || m.backdropPath || poster;
  const rating = Number((m.rating ?? m.voteAverage ?? 7.5).toFixed(1));
  const cleanTitle = resolveSafeCardTitle(m);
  const cleanTitleEs = sanitizeCardTitle(m.titleEs) || cleanTitle;
  const cleanOriginal = sanitizeCardTitle(m.originalTitle) || cleanTitle;

  const compacted: Movie = {
    id: m.id || `tmdb-${m.category || (isTV ? 'series' : 'movie')}-${tmdbId}`,
    tmdbId,
    title: cleanTitle,
    titleEs: cleanTitleEs || undefined,
    originalTitle: cleanOriginal || undefined,
    overview: m.overview || '',
    posterPath: poster,
    posterUrl: poster,
    backdropPath: backdrop,
    backdropUrl: backdrop,
    releaseDate: m.releaseDate || '2024-01-01',
    year: m.year || (m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) || 2024 : 2024),
    genres: Array.isArray(m.genres) ? m.genres.slice(0, 3) : ['Película'],
    voteAverage: rating,
    rating,
    ratingBadge: m.ratingBadge || (m.category === 'anime' ? 'ANIME' : isTV ? 'SERIE' : '4K'),
    qualityBadge: m.qualityBadge || m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
    matchScore: typeof m.matchScore === 'number' ? m.matchScore : Math.min(99, Math.round(rating * 11.2)),
    streamUrl: m.streamUrl || '',
    streamType: m.streamType || 'iframe',
    quality: m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
    cast: Array.isArray(m.cast) && m.cast.length > 0 ? m.cast.slice(0, 5) : ['CineCast VIP'],
    creatorOrDirector: m.creatorOrDirector || 'TMDB Oficial',
    source: m.source || 'tmdb',
    category: m.category || (isTV ? 'series' : 'movie'),
    type: isTV ? 'series' : 'movie',
    servers: Array.isArray(m.servers) ? m.servers : [],
  };

  validateCompactedFields(compacted);
  return compacted;
}

let validationWarningCount = 0;
function validateCompactedFields(item: Movie): void {
  const criticalKeys: (keyof Movie)[] = [
    'ratingBadge',
    'qualityBadge',
    'matchScore',
    'streamType',
    'cast',
    'creatorOrDirector',
    'servers',
  ];
  for (const k of criticalKeys) {
    if (item[k] === undefined && validationWarningCount < 10) {
      validationWarningCount++;
      console.warn(`⚠️ [CatalogCache] Advertencia: item ${item.id} ('${item.title}') tiene campo '${k}' undefined`);
    }
  }
}


/**
 * Lee el catálogo masivo desde IndexedDB de forma completamente asíncrona.
 * Nunca bloquea el hilo principal ni sufre del límite de 5 MB de localStorage.
 */
export async function getCachedCatalog(): Promise<Movie[] | null> {
  if (typeof window === 'undefined') return null;
  try {
    for (const legacyKey of LEGACY_CATALOG_KEYS) {
      del(legacyKey).catch(() => {});
    }
    const data = await get<LeanCatalogEntry>(IDB_CATALOG_KEY);
    if (!data || data.version !== CATALOG_VERSION || !Array.isArray(data.movies)) {
      return null;
    }
    if (hasCorruptedCatalogEntries(data.movies)) {
      console.warn('[CatalogCache] Detectados ítems corruptos o colisionados en IndexedDB. Regenerando catálogo...');
      await del(IDB_CATALOG_KEY).catch(() => {});
      return null;
    }
    return data.movies;
  } catch (err) {
    console.warn('[CatalogCache] Error al leer IndexedDB:', err);
    return null;
  }
}

/**
 * Guarda el catálogo en IndexedDB sin congelar la UI ni el hilo de renderizado.
 */
export async function setCachedCatalog(movies: Movie[]): Promise<void> {
  if (typeof window === 'undefined' || !Array.isArray(movies) || movies.length === 0) return;
  try {
    // Almacena únicamente los primeros 12.000 títulos para no saturar memoria
    const lean = movies.slice(0, 12000).map(compactMovie);
    await set(IDB_CATALOG_KEY, {
      version: CATALOG_VERSION,
      timestamp: Date.now(),
      movies: lean,
    });
  } catch (err) {
    console.warn('[CatalogCache] Error al guardar en IndexedDB:', err);
  }
}

/**
 * Invalida explícitamente la caché si se fuerza actualización
 */
export async function clearCachedCatalog(): Promise<void> {
  try {
    await del(IDB_CATALOG_KEY);
  } catch (_) {}
}

const tmdbTitleHealInFlight = new Map<string, Promise<string>>();

/**
 * Obtiene y cachea en memoria el título oficial desde TMDB (/api/media/:type/:id)
 * cuando una card llega sin título válido o con metadata inconsistente.
 */
export function fetchTmdbTitleForCard(
  mediaType: 'movie' | 'tv',
  tmdbId: number
): Promise<string> {
  if (!tmdbId || tmdbId <= 0 || typeof fetch !== 'function') {
    return Promise.resolve('');
  }
  const cacheKey = `${mediaType}:${tmdbId}`;
  const existing = tmdbTitleHealInFlight.get(cacheKey);
  if (existing) return existing;

  const task = fetch(`/api/media/${mediaType}/${tmdbId}`)
    .then(async (res) => {
      if (!res.ok) return '';
      const data = await res.json();
      return resolveSafeCardTitle({
        titleEs: data?.titleEs,
        title: data?.title || data?.name,
        originalTitle: data?.originalTitle || data?.original_name,
      });
    })
    .catch(() => '');

  tmdbTitleHealInFlight.set(cacheKey, task);
  return task;
}
