import { get, set, del } from 'idb-keyval';
import { Movie } from '../types';

export const CATALOG_VERSION = 12;
const IDB_CATALOG_KEY = `cinecast_catalog_v${CATALOG_VERSION}`;

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
  const isTV = m.category === 'series' || m.category === 'anime' || m.type === 'series';
  const tmdbId = Number(m.tmdbId || (m.id && String(m.id).replace(/\D+/g, '')) || 0);
  const poster = m.posterUrl || m.posterPath || '';
  const backdrop = m.backdropUrl || m.backdropPath || poster;
  const rating = Number((m.rating ?? m.voteAverage ?? 7.5).toFixed(1));

  const compacted: Movie = {
    id: m.id || `tmdb-${m.category || (isTV ? 'series' : 'movie')}-${tmdbId}`,
    tmdbId,
    title: m.title || 'Sin Título',
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
    const data = await get<LeanCatalogEntry>(IDB_CATALOG_KEY);
    if (!data || data.version !== CATALOG_VERSION || !Array.isArray(data.movies)) {
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
