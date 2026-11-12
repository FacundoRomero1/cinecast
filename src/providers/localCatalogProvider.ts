import { deviceSync } from '../services/deviceSync';
import type {
  CardItem,
  CatalogFacets,
  CatalogProvider,
  CatalogQuery,
  CatalogQueryResult,
  GenreCountItem,
  HomeResponse,
  HomeRow,
  MediaDetailCastMember,
  MediaDetailItem,
  MediaDetailServer,
} from './types';

export type CatalogProviderErrorCode =
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

export class CatalogProviderError extends Error {
  public readonly code: CatalogProviderErrorCode;
  public readonly status?: number | undefined;
  public readonly endpoint: string;

  constructor(
    message: string,
    code: CatalogProviderErrorCode,
    endpoint: string,
    status?: number
  ) {
    super(message);
    this.name = 'CatalogProviderError';
    this.code = code;
    this.endpoint = endpoint;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringSafe(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNumberSafe(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function normalizeCardItem(raw: unknown): CardItem {
  if (!isRecord(raw)) {
    return {
      id: 'unknown',
      tmdbId: 0,
      title: 'Sin Título',
      posterUrl: '',
      backdropUrl: '',
      year: 2024,
      rating: 7.0,
      genres: [],
      category: 'movie',
      type: 'movie',
      quality: '1080p',
      upcoming: false,
    };
  }
  const poster = toStringSafe(raw.posterUrl) || toStringSafe(raw.posterPath);
  const backdrop = toStringSafe(raw.backdropUrl) || toStringSafe(raw.backdropPath) || poster;
  const rating = toNumberSafe(raw.rating ?? raw.voteAverage, 7.0);
  const category = toStringSafe(raw.category, 'movie');
  const type = toStringSafe(raw.type, category === 'series' || category === 'anime' ? 'series' : 'movie');

  return {
    id: toStringSafe(raw.id, `tmdb-${category}-${toNumberSafe(raw.tmdbId, 0)}`),
    tmdbId: toNumberSafe(raw.tmdbId, 0),
    title: toStringSafe(raw.title, 'Sin Título'),
    posterUrl: poster,
    backdropUrl: backdrop,
    year: toNumberSafe(raw.year, 2024),
    rating,
    genres: toStringArray(raw.genres),
    category,
    type,
    quality: toStringSafe(raw.quality, '1080p'),
    upcoming: Boolean(raw.upcoming),
  };
}

function normalizeFacets(raw: unknown): CatalogFacets | undefined {
  if (!isRecord(raw)) return undefined;
  const genres: Record<string, number> = {};
  if (isRecord(raw.genres)) {
    for (const [k, v] of Object.entries(raw.genres)) {
      genres[k] = toNumberSafe(v, 0);
    }
  }
  const minYear = typeof raw.minYear === 'number' ? raw.minYear : null;
  const maxYear = typeof raw.maxYear === 'number' ? raw.maxYear : null;
  let rangeMin = minYear;
  let rangeMax = maxYear;
  if (isRecord(raw.yearRange)) {
    if (typeof raw.yearRange.min === 'number') rangeMin = raw.yearRange.min;
    if (typeof raw.yearRange.max === 'number') rangeMax = raw.yearRange.max;
  }
  return {
    genres,
    yearRange: {
      min: rangeMin,
      max: rangeMax,
    },
    minYear: rangeMin,
    maxYear: rangeMax,
  };
}

async function fetchJsonWithTimeout(pathAndQuery: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const base = deviceSync.getApiBase();
  const url = `${base}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new CatalogProviderError(
        `Error HTTP ${res.status} en ${pathAndQuery}`,
        'HTTP_ERROR',
        pathAndQuery,
        res.status
      );
    }
    return await res.json();
  } catch (err: unknown) {
    if (err instanceof CatalogProviderError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new CatalogProviderError(
        `Tiempo de espera agotado (${timeoutMs} ms) en ${pathAndQuery}`,
        'TIMEOUT',
        pathAndQuery
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new CatalogProviderError(
      `Error de red en ${pathAndQuery}: ${msg}`,
      'NETWORK_ERROR',
      pathAndQuery
    );
  } finally {
    clearTimeout(timer);
  }
}

export class LocalCatalogProvider implements CatalogProvider {
  public readonly id = 'local-catalog';
  public readonly capabilities = {
    offline: true,
  };

  public async getHome(seen?: string[]): Promise<HomeResponse> {
    const params = new URLSearchParams();
    params.set('fields', 'card');
    if (Array.isArray(seen) && seen.length > 0) {
      params.set('seen', seen.slice(0, 200).join(','));
    }
    const qs = params.toString();
    const raw = await fetchJsonWithTimeout(`/api/home${qs ? `?${qs}` : ''}`);
    if (!isRecord(raw) || !Array.isArray(raw.rows)) {
      throw new CatalogProviderError('Respuesta inválida de /api/home', 'INVALID_RESPONSE', '/api/home');
    }

    const rows: HomeRow[] = raw.rows
      .filter(isRecord)
      .map((r) => ({
        id: toStringSafe(r.id, 'row'),
        title: toStringSafe(r.title, 'Sección'),
        items: Array.isArray(r.items) ? r.items.map(normalizeCardItem) : [],
      }));

    return { rows };
  }

  public async query(q: CatalogQuery): Promise<CatalogQueryResult> {
    const params = new URLSearchParams();
    params.set('fields', 'card');

    if (q.q && q.q.trim()) params.set('q', q.q.trim());
    if (q.category && q.category !== 'all') params.set('category', q.category);
    if (Array.isArray(q.genre) && q.genre.length > 0) {
      params.set('genre', q.genre.join(','));
      if (q.genreMode) params.set('genreMode', q.genreMode);
    } else if (q.genreMode === 'any') {
      params.set('genreMode', 'any');
    }
    if (typeof q.yearFrom === 'number' && Number.isFinite(q.yearFrom)) {
      params.set('yearFrom', String(q.yearFrom));
    }
    if (typeof q.yearTo === 'number' && Number.isFinite(q.yearTo)) {
      params.set('yearTo', String(q.yearTo));
    }
    if (typeof q.minRating === 'number' && Number.isFinite(q.minRating) && q.minRating > 0) {
      params.set('minRating', String(q.minRating));
    }
    if (q.sort && q.sort !== 'default') {
      params.set('sort', q.sort);
    }
    if (typeof q.page === 'number' && q.page >= 1) {
      params.set('page', String(q.page));
    }
    if (typeof q.limit === 'number' && q.limit >= 1) {
      params.set('limit', String(q.limit));
    }
    if (q.includeUpcoming) {
      params.set('includeUpcoming', 'true');
    }
    if (q.facets !== false) {
      params.set('facets', 'true');
    }

    const endpoint = `/api/catalog?${params.toString()}`;
    const raw = await fetchJsonWithTimeout(endpoint);
    if (!isRecord(raw) || !Array.isArray(raw.items)) {
      throw new CatalogProviderError('Respuesta inválida de /api/catalog', 'INVALID_RESPONSE', endpoint);
    }

    return {
      page: toNumberSafe(raw.page, 1),
      limit: toNumberSafe(raw.limit, 40),
      total: toNumberSafe(raw.total, 0),
      totalPages: toNumberSafe(raw.totalPages, 1),
      items: raw.items.map(normalizeCardItem),
      facets: normalizeFacets(raw.facets),
    };
  }

  public async getGenres(): Promise<GenreCountItem[]> {
    const raw = await fetchJsonWithTimeout('/api/genres');
    if (!Array.isArray(raw)) {
      throw new CatalogProviderError('Respuesta inválida de /api/genres', 'INVALID_RESPONSE', '/api/genres');
    }
    return raw
      .filter(isRecord)
      .map((g) => ({
        name: toStringSafe(g.name),
        count: toNumberSafe(g.count, 0),
      }))
      .filter((g) => g.name.length > 0);
  }

  public async search(q: string): Promise<CardItem[]> {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    const endpoint = `/api/search?q=${encodeURIComponent(trimmed)}`;
    const raw = await fetchJsonWithTimeout(endpoint);
    if (!isRecord(raw)) {
      throw new CatalogProviderError('Respuesta inválida de /api/search', 'INVALID_RESPONSE', endpoint);
    }
    const list = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.results) ? raw.results : [];
    return list.map(normalizeCardItem);
  }

  public async getDetail(type: string, id: string | number): Promise<MediaDetailItem> {
    const cleanType = type === 'series' || type === 'anime' || type === 'tv' ? 'series' : 'movie';
    const endpoint = `/api/media/${encodeURIComponent(cleanType)}/${encodeURIComponent(String(id))}`;
    const raw = await fetchJsonWithTimeout(endpoint);
    if (!isRecord(raw)) {
      throw new CatalogProviderError('Respuesta inválida de /api/media', 'INVALID_RESPONSE', endpoint);
    }
    const base = normalizeCardItem(raw);
    const cast: MediaDetailCastMember[] = Array.isArray(raw.cast)
      ? raw.cast.filter(isRecord).map((c) => ({
          name: toStringSafe(c.name),
          character: toStringSafe(c.character),
          photo: typeof c.photo === 'string' ? c.photo : null,
        }))
      : [];

    const servers: MediaDetailServer[] = Array.isArray(raw.servers)
      ? raw.servers.filter(isRecord).map((s) => ({
          name: toStringSafe(s.name),
          url: toStringSafe(s.url),
          type: toStringSafe(s.type, 'iframe'),
          language: toStringSafe(s.language),
        }))
      : [];

    return {
      ...base,
      originalTitle: toStringSafe(raw.originalTitle, base.title),
      overview: toStringSafe(raw.overview),
      releaseDate: toStringSafe(raw.releaseDate),
      runtime: typeof raw.runtime === 'number' ? raw.runtime : null,
      director: toStringSafe(raw.director),
      cast,
      trailerKey: typeof raw.trailerKey === 'string' ? raw.trailerKey : null,
      servers,
      numberOfSeasons: typeof raw.numberOfSeasons === 'number' ? raw.numberOfSeasons : undefined,
      numberOfEpisodes: typeof raw.numberOfEpisodes === 'number' ? raw.numberOfEpisodes : undefined,
    };
  }
}

export const localCatalogProvider = new LocalCatalogProvider();
