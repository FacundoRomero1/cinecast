import { sampleMovies, createMovieServers, createSeriesServers } from '../data/mediaCatalog';
import { Movie, MediaItem, StreamServer } from '../types';

const TMDB_API_KEY =
  (import.meta as any).env?.VITE_TMDB_API_KEY ||
  '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const TMDB_CACHE_KEY = 'cinecast_tmdb_cache_v2';

const GENRE_MAP: Record<number, string> = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  27: 'Terror',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia Ficción',
  53: 'Suspenso',
  10752: 'Bélica',
  37: 'Western',
  10759: 'Acción y Aventura',
  10765: 'Sci-Fi y Fantasía',
};

export interface TMDBEnrichedData {
  posterUrl: string;
  backdropUrl: string;
  overview: string;
  rating: number;
  year: number;
  genres: string[];
}

function loadTmdbCache(): Record<string, TMDBEnrichedData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TMDB_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTmdbCache(cache: Record<string, TMDBEnrichedData>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

export async function asyncPool<T, R>(
  limit: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing = new Set<Promise<any>>();
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

let massCatalogCache: Movie[] | null = null;

// Generador de fuentes de video basado en Api4all / Vidsrc con forzado ?lang=es (Paso 1 - CENSURA)
export function getVideoSources(
  tmdbId: number,
  type: 'movie' | 'series' | 'anime' = 'movie',
  season = 1,
  episode = 1
): StreamServer[] {
  const isTV = type === 'series' || type === 'anime';

  return [
    {
      name: 'Vidsrc CC (Latino / ES)',
      url: isTV
        ? `https://vidsrc.cc/embed/tv/${tmdbId}/${season}-${episode}?lang=es`
        : `https://vidsrc.cc/embed/movie/${tmdbId}?lang=es`,
      type: 'iframe',
      language: '🇲🇽 Latino / Español',
    },
    {
      name: 'Api4all (Multi / ES)',
      url: isTV
        ? `https://api4all.net/embed/tv/${tmdbId}/${season}/${episode}?lang=es`
        : `https://api4all.net/embed/movie/${tmdbId}?lang=es`,
      type: 'iframe',
      language: '🌐 Multi / Español',
    },
    {
      name: 'Vidsrc Pro (HD / ES)',
      url: isTV
        ? `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}?lang=es`
        : `https://vidsrc.pro/embed/movie/${tmdbId}?lang=es`,
      type: 'iframe',
      language: '🌐 Multi / Sub ES',
    },
    {
      name: 'TukiPlay (HD)',
      url: isTV
        ? `https://tukiplay.com/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://tukiplay.com/embed/movie/${tmdbId}`,
      type: 'iframe',
      language: '🇲🇽 Latino',
    },
    {
      name: 'VidEasy (Multi)',
      url: isTV
        ? `https://player.videasy.net/tv/${tmdbId}/${season}/${episode}`
        : `https://player.videasy.net/movie/${tmdbId}`,
      type: 'iframe',
      language: '🌐 Multi / Original',
    },
  ];
}

export const tmdbService = {
  // Carga prioritariamente el catálogo masivo local (10,000+ títulos)
  // Utiliza /api/catalog del servidor LAN como fuente única, o fallback a /data/catalog.json
  async getLocalCatalog(): Promise<Movie[]> {
    if (massCatalogCache && massCatalogCache.length > 0) {
      return massCatalogCache;
    }
    try {
      // 1. Probar endpoint /api/catalog del servidor Express (una sola fuente de verdad para PC y móvil)
      const res = await fetch('/api/catalog?limit=12000');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          massCatalogCache = data.items;
          return data.items;
        }
      }
    } catch (_) {}

    try {
      // 2. Fallback estático a /data/catalog.json
      const staticRes = await fetch('/data/catalog.json');
      if (staticRes.ok) {
        const data = await staticRes.json();
        if (Array.isArray(data) && data.length > 0) {
          massCatalogCache = data;
          return data;
        }
      }
    } catch (e) {
      console.warn('[tmdbService] No se pudo cargar catálogo masivo local /data/catalog.json:', e);
    }
    return sampleMovies;
  },

  getApiKey(): string {
    return (
      (import.meta as any).env?.VITE_TMDB_API_KEY ||
      localStorage.getItem('cinecast_tmdb_api_key') ||
      '2dca580c2a14b55200e784d157207b4d'
    );
  },

  setApiKey(key: string) {
    localStorage.setItem('cinecast_tmdb_api_key', key.trim());
  },

  // Construir URL de imagen (soporta rutas relativas de TMDB y URLs completas con soporte dinámico w200/w500)
  getImageUrl(path: string | null | undefined, size: 'w200' | 'w500' | 'original' = 'w200'): string {
    if (!path) {
      return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=300&auto=format&fit=crop';
    }
    if (path.startsWith('http://') || path.startsWith('https://')) {
      if (size === 'w200' && path.includes('/w500/')) {
        return path.replace('/w500/', '/w200/');
      }
      if (size === 'w500' && path.includes('/w200/')) {
        return path.replace('/w200/', '/w500/');
      }
      return path;
    }
    const clean = path.replace(/^\//, '');
    return `${IMAGE_BASE_URL}/${size}/${clean}`;
  },

  // Mapear IDs de género de TMDB a nombres legibles en español
  mapGenreIds(ids?: number[]): string[] {
    if (!Array.isArray(ids) || ids.length === 0) return ['Película'];
    return ids.map((id) => GENRE_MAP[id] || 'Cine').slice(0, 3);
  },

  // Convertir item crudo de TMDB a interfaz Movie
  createMovieFromTmdbItem(item: any, forceType?: 'movie' | 'series' | 'anime'): Movie {
    const tmdbId = Number(item.id);
    const isTV =
      forceType === 'series' ||
      forceType === 'anime' ||
      item.media_type === 'tv' ||
      Boolean(item.first_air_date && !item.release_date);

    const isAnime =
      forceType === 'anime' ||
      (item.genre_ids && item.genre_ids.includes(16) && (item.original_language === 'ja' || item.origin_country?.includes('JP')));

    const finalCategory: 'movie' | 'series' | 'anime' = isAnime ? 'anime' : isTV ? 'series' : 'movie';
    const title = item.title || item.name || 'Título Sin Nombre';
    const releaseDate = item.release_date || item.first_air_date || '2024-01-01';
    const year = parseInt(releaseDate.slice(0, 4), 10) || new Date().getFullYear();
    const posterPath = item.poster_path;
    const posterUrl = posterPath
      ? (posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w500${posterPath.startsWith('/') ? '' : '/'}${posterPath}`)
      : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500';
    const backdropPath = item.backdrop_path || item.poster_path;
    const backdropUrl = backdropPath
      ? (backdropPath.startsWith('http') ? backdropPath : `https://image.tmdb.org/t/p/original${backdropPath.startsWith('/') ? '' : '/'}${backdropPath}`)
      : posterUrl;
    const overview = item.overview || 'Sinopsis no disponible en este momento.';
    const voteAverage = Number((item.vote_average || 7.5).toFixed(1));

    const servers = getVideoSources(tmdbId, finalCategory, 1, 1);

    const mappedGenres = this.mapGenreIds(item.genre_ids);
    const genres = isAnime && !mappedGenres.includes('Anime') ? ['Anime', ...mappedGenres] : mappedGenres;

    return {
      id: `tmdb-${finalCategory}-${tmdbId}`,
      tmdbId,
      title,
      overview,
      posterPath: posterUrl,
      posterUrl,
      backdropPath: backdropUrl,
      backdropUrl,
      releaseDate,
      year,
      genres,
      genre: genres,
      runtime: isTV ? undefined : 120,
      seasonsCount: isTV ? 1 : undefined,
      voteAverage,
      rating: voteAverage,
      streamUrl: servers[0]?.url || `https://vidsrc.cc/embed/${isTV ? 'tv' : 'movie'}/${tmdbId}${isTV ? '/1-1' : ''}?lang=es`,
      streamType: 'iframe',
      quality: voteAverage > 8.0 ? '4K Ultra HD' : '1080p',
      source: 'tmdb',
      category: finalCategory,
      type: isTV ? 'series' : 'movie',
      addedAt: new Date().toISOString(),
      servers,
    };
  },

  // Expansión controlada de catálogo Anime (Pool de concurrencia 4)
  async fetchAnimeCatalog(maxPages = 8): Promise<Movie[]> {
    const key = this.getApiKey();
    try {
      const pageNumbers = Array.from({ length: maxPages }, (_, i) => i + 1);
      const responses = await asyncPool(4, pageNumbers, async (p) => {
        try {
          const res = await fetch(
            `${TMDB_BASE_URL}/discover/tv?api_key=${key}&with_original_language=ja&with_genres=16&sort_by=popularity.desc&language=es-ES&page=${p}`
          );
          if (!res.ok) return [];
          const data = await res.json();
          return data.results || [];
        } catch {
          return [];
        }
      });

      const flatResults = responses.flat();
      const animeMovies: Movie[] = flatResults
        .filter((item: any) => item && item.poster_path)
        .map((item: any) => {
          const m = this.createMovieFromTmdbItem(item, 'anime');
          m.category = 'anime';
          m.type = 'series';
          if (!m.genres.includes('Anime')) {
            m.genres = ['Anime', ...m.genres];
          }
          return m;
        });

      return animeMovies;
    } catch (err) {
      console.warn('Error fetching massive anime catalog from TMDB:', err);
      return [];
    }
  },

  // Obtener catálogo infinito de Tendencias (Trending All / Movie / TV)
  async getTrending(page = 1, type: 'all' | 'movie' | 'tv' = 'all'): Promise<{ results: Movie[]; totalPages: number; page: number }> {
    const key = this.getApiKey();
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/trending/${type}/day?api_key=${key}&language=es-ES&page=${page}`
      );
      if (!response.ok) {
        throw new Error(`TMDB Trending HTTP ${response.status}`);
      }
      const data = await response.json();
      const rawResults = data.results || [];
      const movies = rawResults
        .filter((item: any) => item.poster_path) // Filtrar elementos sin póster
        .map((item: any) => this.createMovieFromTmdbItem(item));

      return {
        results: movies,
        totalPages: data.total_pages || 1,
        page: data.page || page,
      };
    } catch (err) {
      console.warn('Error fetching TMDB trending, falling back to local catalog:', err);
      return {
        results: sampleMovies.slice(0, 30),
        totalPages: 1,
        page: 1,
      };
    }
  },

  // Limpieza explícita de caché TMDB
  clearCache(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(TMDB_CACHE_KEY);
        localStorage.removeItem('cinecast_tmdb_cache');
        localStorage.removeItem('cinecast_tmdb_cache_v2');
      }
      massCatalogCache = null;
      console.log('[tmdbService] Caché de TMDB limpiado con éxito');
    } catch (e) {
      console.warn('[tmdbService] Error limpiando caché TMDB:', e);
    }
  },

  // Búsqueda estricta segregada por media_type para evitar confusiones de ID (ej. Big Bang Theory vs Big Sky)
  async searchMedia(
    query: string,
    options?: { cleanCache?: boolean }
  ): Promise<{ movies: Movie[]; tv_shows: Movie[]; all: Movie[] }> {
    const q = query.trim();
    if (!q) return { movies: [], tv_shows: [], all: [] };

    // 1. Opcionalmente forzamos limpieza si hay conflicto de ID
    if (options?.cleanCache) {
      this.clearCache();
    }

    const key = this.getApiKey();
    const lowerQuery = q.toLowerCase();

    try {
      // 2. Buscamos explícitamente por tipo en paralelo para evitar cruces
      const [movieRes, tvRes] = await Promise.all([
        fetch(`${TMDB_BASE_URL}/search/movie?api_key=${key}&query=${encodeURIComponent(q)}&language=es-ES`)
          .then((r) => (r.ok ? r.json() : { results: [] }))
          .catch(() => ({ results: [] })),
        fetch(`${TMDB_BASE_URL}/search/tv?api_key=${key}&query=${encodeURIComponent(q)}&language=es-ES`)
          .then((r) => (r.ok ? r.json() : { results: [] }))
          .catch(() => ({ results: [] })),
      ]);

      // 3. Filtramos resultados duplicados o ambiguos con validación estricta de ID no corrupto
      const isValidId = (item: any) => {
        if (!item || item.id === undefined || item.id === null) return false;
        const num = Number(item.id);
        return Number.isInteger(num) && num > 0;
      };

      const movieResults: any[] = (movieRes.results || []).filter(isValidId);
      const tvResults: any[] = (tvRes.results || []).filter(isValidId);

      const movies = movieResults
        .filter((m: any) => m.poster_path && (m.title?.toLowerCase().includes(lowerQuery) || lowerQuery.includes((m.title || '').toLowerCase())))
        .map((m: any) => this.createMovieFromTmdbItem(m, 'movie'));

      const tvShows = tvResults
        .filter((t: any) => t.poster_path && ((t.name || t.title)?.toLowerCase().includes(lowerQuery) || lowerQuery.includes((t.name || t.title || '').toLowerCase())))
        .map((t: any) => this.createMovieFromTmdbItem(t, 'series'));

      // Si el usuario busca "Big Bang Theory" o series similares, priorizar TV estrictamente
      const isTvBiased = /big bang|theory|temporada|season|serie|show/i.test(lowerQuery);
      const all = isTvBiased ? [...tvShows, ...movies] : [...tvShows, ...movies];

      return {
        movies,
        tv_shows: tvShows,
        all,
      };
    } catch (err) {
      console.warn('[tmdbService] Error en searchMedia, usando fallback local:', err);
      const localMatches = sampleMovies.filter(
        (m) => m.title.toLowerCase().includes(lowerQuery) || m.overview.toLowerCase().includes(lowerQuery)
      );
      const movies = localMatches.filter((m) => m.type === 'movie' || m.category === 'movie');
      const tvShows = localMatches.filter((m) => m.type === 'series' || m.category === 'series' || m.category === 'anime');
      return {
        movies,
        tv_shows: tvShows,
        all: localMatches,
      };
    }
  },

  // Búsqueda en vivo en la API de TMDB (Search Multi segregado)
  async searchMulti(query: string, page = 1): Promise<{ results: Movie[]; totalPages: number; page: number }> {
    const q = query.trim();
    if (!q) return { results: [], totalPages: 0, page: 1 };

    const key = this.getApiKey();
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/search/multi?api_key=${key}&query=${encodeURIComponent(q)}&language=es-ES&page=${page}`
      );
      if (!response.ok) {
        throw new Error(`TMDB Search HTTP ${response.status}`);
      }
      const data = await response.json();
      const rawResults = data.results || [];
      const movies = rawResults
        .filter((item: any) => {
          if (!item || !item.id || isNaN(Number(item.id)) || Number(item.id) <= 0) return false;
          return item.poster_path && (item.media_type === 'movie' || item.media_type === 'tv');
        })
        .map((item: any) => this.createMovieFromTmdbItem(item, item.media_type === 'tv' ? 'series' : 'movie'));

      return {
        results: movies,
        totalPages: data.total_pages || 1,
        page: data.page || page,
      };
    } catch (err) {
      console.warn('Error searching TMDB API, falling back to local filter:', err);
      const lower = q.toLowerCase();
      const localMatches = sampleMovies.filter(
        (m) => m.title.toLowerCase().includes(lower) || m.overview.toLowerCase().includes(lower)
      );
      return {
        results: localMatches,
        totalPages: 1,
        page: 1,
      };
    }
  },

  // Alias para compatibilidad con modales y llamadas anteriores
  async searchMovies(query: string, page = 1): Promise<{ results: any[]; totalPages: number; page: number }> {
    return this.searchMulti(query, page);
  },

  // Enriquecer datos buscando en TMDB con soporte estricto de tipo (movie vs series)
  async enrichMovieData(
    title: string,
    year?: number,
    type?: 'movie' | 'series' | 'tv' | 'anime'
  ): Promise<TMDBEnrichedData | null> {
    const isTV = type === 'series' || type === 'tv' || type === 'anime';
    const cacheKey = `${isTV ? 'tv' : 'movie'}_${title.toLowerCase().trim()}_${year || ''}`;
    const cache = loadTmdbCache();
    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    const cleanTitle = title.replace(/\s*\([^)]*\)/g, '').trim();
    const key = this.getApiKey();

    if (key) {
      try {
        const yearParam = year ? (isTV ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
        const endpoint = isTV ? 'tv' : 'movie';
        const response = await fetch(
          `${TMDB_BASE_URL}/search/${endpoint}?api_key=${key}&query=${encodeURIComponent(
            cleanTitle
          )}${yearParam}&language=es-ES`
        );
        if (response.ok) {
          const data = await response.json();
          // Aseguramos coincidencia por título para no tomar el primer resultado arbitrario
          const lowerClean = cleanTitle.toLowerCase();
          const results: any[] = data?.results || [];
          const hit =
            results.find((r: any) => {
              const name = (r.title || r.name || '').toLowerCase();
              return name.includes(lowerClean) || lowerClean.includes(name);
            }) || results[0];

          if (hit) {
            const release = hit.release_date || hit.first_air_date || '';
            const enriched: TMDBEnrichedData = {
              posterUrl: hit.poster_path ? `${IMAGE_BASE_URL}/w500${hit.poster_path}` : '',
              backdropUrl: hit.backdrop_path ? `${IMAGE_BASE_URL}/original${hit.backdrop_path}` : '',
              overview: hit.overview || '',
              rating: hit.vote_average || 7.5,
              year: release ? parseInt(release.slice(0, 4), 10) || year || 1960 : year || 1960,
              genres: this.mapGenreIds(hit.genre_ids),
            };
            cache[cacheKey] = enriched;
            saveTmdbCache(cache);
            return enriched;
          }
        }
      } catch (_) {}
    }

    // Fallback local
    const localHit = sampleMovies.find(
      (m) =>
        m.title.toLowerCase().includes(cleanTitle.toLowerCase()) ||
        cleanTitle.toLowerCase().includes(m.title.split('(')[0].trim().toLowerCase())
    );

    if (localHit) {
      const enriched: TMDBEnrichedData = {
        posterUrl: localHit.posterUrl || localHit.posterPath,
        backdropUrl: localHit.backdropPath || localHit.posterPath,
        overview: localHit.overview,
        rating: localHit.rating || localHit.voteAverage,
        year: localHit.year || parseInt(localHit.releaseDate.slice(0, 4), 10) || 1960,
        genres: localHit.genres,
      };
      cache[cacheKey] = enriched;
      saveTmdbCache(cache);
      return enriched;
    }

    return null;
  },

  // Obtener detalles completos
  async getMovieDetails(tmdbId: number) {
    const key = this.getApiKey();
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${key}&language=es-ES&append_to_response=credits`
      );
      if (!response.ok) return null;
      return response.json();
    } catch {
      return sampleMovies.find((m) => m.tmdbId === tmdbId) || null;
    }
  },

  async fetchMoreByCategory(category: string, page: number): Promise<MediaItem[]> {
    return fetchMoreByCategory(category, page);
  },
};

export async function fetchMoreByCategory(category: string, page: number): Promise<MediaItem[]> {
  const key = tmdbService.getApiKey();
  const cat = (category || 'all').toLowerCase();
  let endpoint = '';
  let forceType: 'movie' | 'series' | 'anime' | undefined = undefined;

  const movieEndpoints = [
    `/movie/popular?api_key=${key}&language=es-MX&page=${page}`,
    `/movie/now_playing?api_key=${key}&language=es-MX&page=${page}`,
    `/movie/top_rated?api_key=${key}&language=es-MX&page=${page}`,
    `/discover/movie?api_key=${key}&language=es-MX&sort_by=popularity.desc&with_genres=28&page=${page}`,
    `/discover/movie?api_key=${key}&language=es-MX&sort_by=popularity.desc&with_genres=878&page=${page}`,
    `/discover/movie?api_key=${key}&language=es-MX&sort_by=popularity.desc&with_genres=27&page=${page}`,
    `/discover/movie?api_key=${key}&language=es-MX&sort_by=popularity.desc&with_genres=35&page=${page}`,
    `/discover/movie?api_key=${key}&language=es-MX&sort_by=popularity.desc&with_genres=53&page=${page}`,
  ];

  const seriesEndpoints = [
    `/tv/popular?api_key=${key}&language=es-MX&page=${page}`,
    `/tv/top_rated?api_key=${key}&language=es-MX&page=${page}`,
    `/tv/on_the_air?api_key=${key}&language=es-MX&page=${page}`,
  ];

  const allEndpoints = [
    `/trending/all/day?api_key=${key}&language=es-MX&page=${page}`,
    `/trending/all/week?api_key=${key}&language=es-MX&page=${page}`,
    `/movie/now_playing?api_key=${key}&language=es-MX&page=${page}`,
    `/tv/popular?api_key=${key}&language=es-MX&page=${page}`,
  ];

  if (cat === 'movies' || cat === 'movie') {
    forceType = 'movie';
    endpoint = movieEndpoints[(page - 1) % movieEndpoints.length];
  } else if (cat === 'series' || cat === 'tv') {
    forceType = 'series';
    endpoint = seriesEndpoints[(page - 1) % seriesEndpoints.length];
  } else if (cat === 'anime') {
    forceType = 'anime';
    endpoint = `/discover/tv?api_key=${key}&with_original_language=ja&with_genres=16&sort_by=popularity.desc&language=es-MX&page=${page}`;
  } else {
    endpoint = allEndpoints[(page - 1) % allEndpoints.length];
  }

  try {
    const res = await fetch(`${TMDB_BASE_URL}${endpoint}`);
    if (!res.ok) return [];
    const data = await res.json();
    const rawResults = data.results || [];

    return rawResults
      .filter((item: any) => item && (item.poster_path || item.backdrop_path))
      .map((item: any) => {
        const movie = tmdbService.createMovieFromTmdbItem(item, forceType);
        const ratingVal = Number((item.vote_average || 7.5).toFixed(1));
        const isTV = movie.category === 'series' || movie.category === 'anime' || movie.type === 'series';
        const servers = movie.servers || (isTV ? createSeriesServers(movie.tmdbId, 1, 1) : createMovieServers(movie.tmdbId));
        const mediaItem: MediaItem = {
          id: movie.id,
          tmdbId: movie.tmdbId,
          title: movie.title,
          type: isTV ? 'series' : 'movie',
          overview: movie.overview,
          year: movie.year || new Date().getFullYear(),
          ratingBadge: movie.category === 'anime' ? 'ANIME' : isTV ? 'SERIE' : 'ATP',
          matchScore: Math.min(99, Math.round(ratingVal * 12)),
          qualityBadge: ratingVal > 8.0 ? '4K Ultra HD' : 'HD 1080p',
          genres: movie.genres,
          cast: ['CineCast TMDB'],
          creatorOrDirector: `TMDB ${movie.category?.toUpperCase() || 'CINE'}`,
          posterUrl: movie.posterUrl || movie.posterPath,
          backdropUrl: movie.backdropUrl || movie.backdropPath,
          videoUrl: servers[0]?.url || `https://vidsrc.cc/v2/embed/${isTV ? 'tv' : 'movie'}/${movie.tmdbId}`,
          streamType: 'iframe',
          servers,
          category: movie.category as any,
          seasonsCount: isTV ? 1 : undefined,
          activeServerIndex: 0,
        };
        return mediaItem;
      });
  } catch (err) {
    console.warn(`[TMDB] Error fetching page ${page} for category ${category}:`, err);
    return [];
  }
}
