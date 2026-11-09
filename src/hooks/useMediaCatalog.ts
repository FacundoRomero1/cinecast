import { useState, useEffect, useCallback, useRef } from 'react';
import { mediaCatalog, sampleMovies } from '../data/mediaCatalog';
import { tmdbService, fetchMoreByCategory } from '../services/tmdbService';
import { getCachedCatalog, setCachedCatalog, compactMovie } from '../services/catalogCache';
import { Movie } from '../types';

const AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

export const useMediaCatalog = () => {
  const [allMovies, setAllMovies] = useState<Movie[]>(() => {
    return mediaCatalog.movies.length >= 10
      ? mediaCatalog.movies
      : [...sampleMovies];
  });
  const [movies, setMovies] = useState<Movie[]>(() => {
    return mediaCatalog.movies.length >= 10
      ? mediaCatalog.movies
      : [...sampleMovies];
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLiveSearchActive, setIsLiveSearchActive] = useState(false);
  const pageMapRef = useRef<Record<string, number>>({ all: 1, movies: 1, series: 1, anime: 1 });
  const hasInitializedRef = useRef(false);

  // Carga inicial híbrida y asíncrona respaldada en IndexedDB
  const loadCatalog = useCallback(async () => {
    setError(null);
    try {
      // 1. Intentar cargar desde IndexedDB (rápido, asíncrono, sin bloquear hilo de UI)
      const cached = await getCachedCatalog();
      if (cached && cached.length >= 50) {
        mediaCatalog.movies = cached;
        setAllMovies(cached);
        setMovies(cached);
        return;
      }

      setLoading(true);

      // 2. Si no hay caché en IndexedDB, cargar desde el servidor local (public/data/catalog.json o /api/catalog)
      const localMass = await tmdbService.getLocalCatalog();
      const mergedMap = new Map<string, Movie>();

      for (const m of localMass) {
        mergedMap.set(m.id, compactMovie(m));
      }

      for (const cur of sampleMovies) {
        mergedMap.set(cur.id, compactMovie(cur));
      }

      const mergedList = Array.from(mergedMap.values());
      mediaCatalog.movies = mergedList;
      setAllMovies(mergedList);
      setMovies(mergedList);

      // Guardar en IndexedDB en segundo plano
      await setCachedCatalog(mergedList);
    } catch (e) {
      console.warn('[useMediaCatalog] Error durante la carga:', e);
      setAllMovies([...sampleMovies]);
      setMovies([...sampleMovies]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-actualización ligera: consulta nuevos estrenos sin duplicar IDs
  const refreshTrendsAndPremieres = useCallback(async () => {
    try {
      const [trends, premieres] = await Promise.all([
        fetchMoreByCategory('all', 1),
        fetchMoreByCategory('movies', 1),
      ]);
      const incoming = [...trends, ...premieres].map(compactMovie) as unknown as Movie[];
      setAllMovies((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newUnseen = incoming.filter((m) => !existingIds.has(m.id));
        if (newUnseen.length === 0) return prev;
        const updated = [...newUnseen, ...prev];
        mediaCatalog.movies = updated;
        setCachedCatalog(updated);
        return updated;
      });
    } catch (e) {
      console.warn('[useMediaCatalog] Auto-update failed:', e);
    }
  }, []);

  // Cargar más títulos desde TMDB según categoría activa (Scroll infinito)
  const loadMore = useCallback(async (category?: string) => {
    if (loadingMore) return;
    const cat = (category || 'all').toLowerCase();
    const nextPage = (pageMapRef.current[cat] || 1) + 1;
    pageMapRef.current[cat] = nextPage;
    setLoadingMore(true);

    try {
      const items = await fetchMoreByCategory(cat, nextPage);
      const incomingMovies = items as unknown as Movie[];
      setAllMovies((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newItems = incomingMovies.filter((m) => !existingIds.has(m.id));
        if (newItems.length === 0) return prev;
        const updated = [...prev, ...newItems];
        mediaCatalog.movies = updated;
        setCachedCatalog(updated);
        return updated;
      });
    } catch (err) {
      console.warn(`[useMediaCatalog] Error cargando más items (${cat}, pág ${nextPage}):`, err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // Búsqueda en vivo en TMDB API
  const searchTmdb = async (query: string) => {
    const q = query.trim();
    if (!q) {
      setIsLiveSearchActive(false);
      setMovies([...allMovies]);
      return;
    }

    setIsLiveSearchActive(true);
    setLoading(true);
    try {
      const searchRes = await tmdbService.searchMulti(q, 1);
      if (searchRes.results.length > 0) {
        setMovies(searchRes.results);
      } else {
        const lower = q.toLowerCase();
        const localMatches = allMovies.filter(
          (m) => m.title.toLowerCase().includes(lower) || m.overview.toLowerCase().includes(lower)
        );
        setMovies(localMatches);
      }
    } catch {
      const lower = q.toLowerCase();
      const localMatches = allMovies.filter(
        (m) => m.title.toLowerCase().includes(lower) || m.overview.toLowerCase().includes(lower)
      );
      setMovies(localMatches);
    } finally {
      setLoading(false);
    }
  };

  const refreshCatalog = async () => {
    await loadCatalog();
  };

  // Filtrado en tiempo real local
  const filterLocal = useCallback(
    (query: string, categoryId: string) => {
      const q = query.trim().toLowerCase();
      const filtered = allMovies.filter((m) => {
        const matchesQuery =
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.overview.toLowerCase().includes(q) ||
          (m.genres || []).some((g) => g.toLowerCase().includes(q)) ||
          String(m.year || m.releaseDate || '').includes(q);

        if (!matchesQuery) return false;
        if (!categoryId || categoryId === 'all') return true;

        if (categoryId === 'movies') {
          return (m.category === 'movie' || !m.category) && m.type !== 'series';
        }

        if (categoryId === 'anime') {
          return (
            m.category === 'anime' ||
            (m.genres || []).some(
              (g) =>
                g.toLowerCase().includes('anime') ||
                g.toLowerCase().includes('animación')
            )
          );
        }

        if (categoryId === 'series') {
          const isAnime =
            m.category === 'anime' ||
            (m.genres || []).some((g) => g.toLowerCase().includes('anime'));
          return (
            !isAnime &&
            (m.category === 'series' ||
              m.type === 'series' ||
              (m.genres || []).some((g) => g.toLowerCase().includes('serie')))
          );
        }

        return true;
      });
      setMovies(filtered);
    },
    [allMovies]
  );

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Intervalo de auto-actualización cada 60 minutos
  useEffect(() => {
    refreshTrendsAndPremieres();
    const interval = setInterval(refreshTrendsAndPremieres, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshTrendsAndPremieres]);

  return {
    movies,
    allMovies,
    loading,
    loadingMore,
    isLoadingMore: loadingMore,
    hasMore: true,
    loadMore,
    searchTmdb,
    isLiveSearchActive,
    error,
    refreshCatalog,
    filterLocal,
  };
};
