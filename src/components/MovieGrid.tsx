import React, { useState, useMemo, useRef, useEffect } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useMediaCatalog } from '../hooks/useMediaCatalog';
import { MovieCard } from './MovieCard';
import { CategoryFilter, CategoryOption } from './CategoryFilter';
import { CustomStreamModal } from './CustomStreamModal';
import { SportsLiveGrid } from './SportsLiveGrid';
import { SportsMatchesTab } from './SportsMatchesTab';
import { MediaItem, Movie } from '../types';
import { mediaSync } from '../services/mediaSync';
import { archiveService } from '../services/archiveService';
import { RefreshCw, Search, Film, Sparkles, Globe, X, Plus, Bookmark } from 'lucide-react';

interface MovieGridProps {
  onPlayMovie: (media: MediaItem, rawMovie: Movie) => void;
  onCastMovie: (media: MediaItem, rawMovie: Movie) => void;
  onOpenDetails: (media: MediaItem) => void;
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
  myListIds?: string[];
  onToggleMyList?: (id: string) => void;
  connectedScreenName?: string;
}

const HorizontalCategoryRow: React.FC<{
  title: string;
  items: Movie[];
  onPlay: (movie: Movie) => void;
  onCast: (movie: Movie) => void;
  onDetails: (movie: Movie) => void;
  myListIds: string[];
  onToggleMyList?: (id: string) => void;
}> = ({ title, items, onPlay, onCast, onDetails, myListIds, onToggleMyList }) => {
  const rowSlug = useMemo(() => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'h-row', [title]);
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return (items || []).filter((m) => {
      const idStr = String(m.id || m.tmdbId || '');
      if (!idStr || seen.has(idStr)) return false;
      seen.add(idStr);
      return true;
    });
  }, [items]);

  if (!uniqueItems || uniqueItems.length === 0) return null;
  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
          {title}
        </h3>
        <span className="text-xs text-zinc-500 font-medium">{uniqueItems.length} títulos</span>
      </div>
      <div className="flex gap-3.5 overflow-x-auto pb-3 pt-1 no-scrollbar scroll-smooth">
        {uniqueItems.map((movie) => (
          <div key={`${rowSlug}-${movie.id}`} className="w-36 sm:w-44 shrink-0">
            <MovieCard
              movie={movie}
              onPlay={onPlay}
              onCast={onCast}
              onDetails={onDetails}
              isBookmarked={myListIds.includes(movie.id) || myListIds.includes(String(movie.tmdbId))}
              onToggleBookmark={(m) => onToggleMyList && onToggleMyList(m.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export const MovieGrid: React.FC<MovieGridProps> = ({
  onPlayMovie,
  onCastMovie,
  onOpenDetails,
  selectedCategory: propCategory,
  onSelectCategory: propOnSelectCategory,
  myListIds = [],
  onToggleMyList,
  connectedScreenName,
}) => {
  const {
    allMovies,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    searchTmdb,
    error,
    refreshCatalog,
  } = useMediaCatalog();

  const [searchQuery, setSearchQuery] = useState('');
  const [localCategory, setLocalCategory] = useState<string>('all');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);

  // TAREA 2: Filtro Solo Español
  const [onlySpanish, setOnlySpanish] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_only_spanish') === 'true';
    } catch {
      return false;
    }
  });

  // TAREA 2: Búsqueda server-side con debounce 300ms sobre el índice de 10,119 títulos
  const [serverResults, setServerResults] = useState<Movie[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [isSearchingServer, setIsSearchingServer] = useState<boolean>(false);

  // TAREA 2: Paginación real
  const [visiblePage, setVisiblePage] = useState<number>(1);
  const PAGE_SIZE = 35;

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Categoría activa (prop de App/Navbar o estado local)
  const activeCategory = propCategory !== undefined ? propCategory : localCategory;

  const toggleOnlySpanish = () => {
    setOnlySpanish((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinecast_only_spanish', String(next));
      } catch (_) {}
      return next;
    });
    setVisiblePage(1);
  };

  // TAREA 2: Búsqueda unificada en /api/search con debounce 300ms, min 2 chars, y tolerancia a tipografía
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setServerResults(null);
      setServerTotal(null);
      setIsSearchingServer(false);
      return;
    }

    setIsSearchingServer(true);
    const timer = setTimeout(async () => {
      try {
        const url = `/api/search?q=${encodeURIComponent(q)}${onlySpanish ? '&onlySpanish=true' : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) {
            setServerResults(data.items);
            setServerTotal(data.total);
            return;
          }
        }
      } catch (err) {
        console.warn('Fallo en búsqueda remota, usando filtro local:', err);
      } finally {
        setIsSearchingServer(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, onlySpanish]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && hasMore && activeCategory !== 'my-list' && !searchQuery) {
          loadMore(activeCategory);
        }
      },
      { threshold: 0.1, rootMargin: '300px' }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadingMore, hasMore, activeCategory, loadMore, searchQuery]);

  const handleCategorySelect = (catId: string) => {
    setVisiblePage(1);
    if (propOnSelectCategory) {
      propOnSelectCategory(catId);
    } else {
      setLocalCategory(catId);
    }
  };

  // Filtrado reactivo
  const filteredMovies = useMemo(() => {
    if (serverResults !== null && searchQuery.trim()) {
      return serverResults;
    }

    const q = searchQuery.trim().toLowerCase();
    let list = allMovies;

    // Filtro "Solo Español" (prioriza español)
    if (onlySpanish) {
      list = list.filter((m) => {
        const orig = (m.originalLanguage || '').toLowerCase();
        const spoken = Array.isArray(m.spokenLanguages) ? m.spokenLanguages.map((s) => s.toLowerCase()) : [];
        return orig === 'es' || spoken.includes('es');
      }).sort((a, b) => {
        const aEs = a.originalLanguage === 'es' ? 1 : 0;
        const bEs = b.originalLanguage === 'es' ? 1 : 0;
        return bEs - aEs;
      });
    }

    return list.filter((m) => {
      // 1. Filtro de texto local
      if (q) {
        const titleMatch = (m.title || '').toLowerCase().includes(q);
        const origMatch = (m.originalTitle || '').toLowerCase().includes(q);
        const overviewMatch = (m.overview || '').toLowerCase().includes(q);
        const genreMatch = (m.genres || []).some((g) => g.toLowerCase().includes(q));
        const yearMatch = String(m.year || m.releaseDate || '').includes(q);
        if (!titleMatch && !origMatch && !overviewMatch && !genreMatch && !yearMatch) {
          return false;
        }
      }

      // 2. Filtro por categoría
      if (activeCategory === 'my-list') {
        return myListIds.includes(m.id) || myListIds.includes(String(m.tmdbId));
      }

      const isAnimeItem =
        m.category === 'anime' ||
        (m.genres || []).some((g) => g.toLowerCase().includes('anime')) ||
        ((m.genres || []).some((g) => g.toLowerCase().includes('animación')) &&
          (m.originalLanguage === 'ja' || (m as any).originCountry?.includes('JP')));

      if (activeCategory === 'movies') {
        const isSeriesOrAnime =
          isAnimeItem ||
          m.category === 'series' ||
          m.type === 'series' ||
          (m.genres || []).some((g) => g.toLowerCase().includes('serie'));
        return !isSeriesOrAnime;
      }

      if (activeCategory === 'anime') {
        return isAnimeItem;
      }

      if (activeCategory === 'series') {
        return (
          !isAnimeItem &&
          (m.category === 'series' ||
            m.type === 'series' ||
            (m.genres || []).some((g) => g.toLowerCase().includes('serie')))
        );
      }

      return true;
    });
  }, [allMovies, searchQuery, serverResults, activeCategory, myListIds, onlySpanish]);

  // TAREA 2: Filas horizontales para exploración rápida
  const popularRows = useMemo(() => {
    if (activeCategory !== 'all' || searchQuery.trim()) return null;
    const base = onlySpanish
      ? allMovies.filter((m) => m.originalLanguage === 'es' || m.spokenLanguages?.includes('es'))
      : allMovies;

    return {
      populares: base.slice(0, 14),
      estrenos: [...base].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 14),
      mejorValoradas: [...base].filter((m) => (m.voteAverage || 0) >= 7.8).slice(0, 14),
      animacion: base.filter((m) => m.category === 'anime' || m.genres?.some((g) => g.toLowerCase().includes('anim') || g.toLowerCase().includes('anime'))).slice(0, 14),
      accion: base.filter((m) => m.genres?.some((g) => g.toLowerCase().includes('acción') || g.toLowerCase().includes('aventura'))).slice(0, 14),
      comedia: base.filter((m) => m.genres?.some((g) => g.toLowerCase().includes('comedia'))).slice(0, 14),
      terror: base.filter((m) => m.genres?.some((g) => g.toLowerCase().includes('terror') || g.toLowerCase().includes('suspenso'))).slice(0, 14),
      documentales: base.filter((m) => m.genres?.some((g) => g.toLowerCase().includes('documental') || g.toLowerCase().includes('historia'))).slice(0, 14),
    };
  }, [allMovies, activeCategory, searchQuery, onlySpanish]);

  // Paginación real con deduplicación por id
  const displayedMovies = useMemo(() => {
    const base = searchQuery.trim() ? filteredMovies : filteredMovies.slice(0, visiblePage * PAGE_SIZE);
    const seen = new Set<string>();
    return base.filter((m) => {
      const idStr = String(m.id || m.tmdbId || '');
      if (!idStr || seen.has(idStr)) return false;
      seen.add(idStr);
      return true;
    });
  }, [filteredMovies, visiblePage, searchQuery]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setVisiblePage(1);
  };

  const handleClearQuery = () => {
    setSearchQuery('');
    setServerResults(null);
    setServerTotal(null);
    setVisiblePage(1);
  };

  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (q.length >= 2) {
      setIsSearchingServer(true);
      try {
        const url = `/api/search?q=${encodeURIComponent(q)}&tmdb=true${onlySpanish ? '&onlySpanish=true' : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) {
            setServerResults(data.items);
            setServerTotal(data.total);
            return;
          }
        }
      } catch (_) {
        searchTmdb(q);
      } finally {
        setIsSearchingServer(false);
      }
    }
  };

  const handlePlay = async (movie: Movie, isCast: boolean) => {
    if (movie.source !== 'archive.org' || movie.streamType === 'iframe') {
      const mediaItem = mediaSync.movieToMediaItem(movie);
      if (isCast) {
        onCastMovie(mediaItem, movie);
      } else {
        onPlayMovie(mediaItem, movie);
      }
      return;
    }

    setResolvingId(movie.id);
    try {
      const resolvedUrl = await archiveService.resolveStreamUrl(movie);
      const enrichedMovie: Movie = { ...movie, streamUrl: resolvedUrl };
      const mediaItem = mediaSync.movieToMediaItem(enrichedMovie);
      if (isCast) {
        onCastMovie(mediaItem, enrichedMovie);
      } else {
        onPlayMovie(mediaItem, enrichedMovie);
      }
    } finally {
      setResolvingId(null);
    }
  };

  const handleMediaAdded = (newMovie: Movie, playImmediately = false) => {
    refreshCatalog();
    if (playImmediately) {
      handlePlay(newMovie, false);
    }
  };

  const totalCount = serverTotal !== null ? serverTotal : filteredMovies.length;

  return (
    <section id="archive-catalog" className="px-4 sm:px-12 py-6 max-w-7xl mx-auto scroll-mt-20">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-zinc-900 via-zinc-900/95 to-red-950/40 border border-zinc-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500 shrink-0">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-emerald-400 font-semibold">
                • Mostrando {displayedMovies.length} de {totalCount} títulos disponibles
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
              {activeCategory === 'my-list'
                ? '⭐ Mi Lista de Favoritos'
                : activeCategory === 'movies'
                ? '🎬 Catálogo Oficial de Películas'
                : activeCategory === 'series' || activeCategory === 'series_anime'
                ? '📺 Series & Anime Oficial'
                : 'Catálogo Completo: Estrenos, Series & Anime'}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start md:self-center">
          {/* TAREA 2: Toggle Solo Español */}
          <button
            type="button"
            onClick={toggleOnlySpanish}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition ${
              onlySpanish
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-lg shadow-amber-950/40'
                : 'bg-zinc-800/90 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Filtrar por contenido con audio o doblaje en español"
          >
            <span>🇪🇸</span>
            <span>{onlySpanish ? 'Solo Español (Activo)' : 'Solo Español'}</span>
            {onlySpanish && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          </button>

          <button
            onClick={refreshCatalog}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold rounded-xl border border-zinc-700 transition disabled:opacity-50"
            title="Sincronizar Catálogo TMDB"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-red-500' : 'text-red-500'} />
            <span className="hidden sm:inline">{loading ? 'Sincronizando...' : 'Actualizar'}</span>
          </button>
        </div>
      </div>

      {/* Real-time Controlled Server-Side Search */}
      <form onSubmit={handleSearchSubmit} className="mb-4 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleQueryChange}
            placeholder="Buscar entre 10,119 títulos (ej: Black Clover, Deadpool, Stranger Things)..."
            className="w-full pl-10 pr-16 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 text-xs sm:text-sm focus:outline-none focus:border-red-500 transition"
          />
          {isSearchingServer && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearQuery}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
              title="Borrar búsqueda"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="px-5 py-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold transition flex items-center justify-center gap-2 shrink-0"
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Buscar en TMDB</span>
        </button>
      </form>

      {/* Category Filter Chips */}
      <CategoryFilter
        selectedCategory={activeCategory}
        onSelectCategory={(cat: CategoryOption) => handleCategorySelect(cat.id)}
      />

      {resolvingId && (
        <div className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-500/40 text-xs text-red-200 flex items-center gap-2 animate-pulse">
          <div className="w-4 h-4 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
          <span>Preparando reproducción directa...</span>
        </div>
      )}

      {/* TAREA 2: Filas horizontales por categoría si estamos en 'all' y sin búsqueda */}
      {popularRows && (
        <div className="space-y-4 mb-8">
          <HorizontalCategoryRow
            title="🔥 Populares en Tendencia"
            items={popularRows.populares}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="🆕 Nuevos Estrenos"
            items={popularRows.estrenos}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="⭐ Mejor Valoradas (Top Rated)"
            items={popularRows.mejorValoradas}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="🗡️ Animación & Anime"
            items={popularRows.animacion}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="💥 Acción & Aventura"
            items={popularRows.accion}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="😂 Comedia"
            items={popularRows.comedia}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="👻 Terror & Suspenso"
            items={popularRows.terror}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />
          <HorizontalCategoryRow
            title="🌍 Documentales & Cultura"
            items={popularRows.documentales}
            onPlay={(m) => handlePlay(m, false)}
            onCast={(m) => handlePlay(m, true)}
            onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
            myListIds={myListIds}
            onToggleMyList={onToggleMyList}
          />

          <div className="pt-4 border-t border-zinc-800/80">
            <h3 className="text-lg font-black text-white mb-4">
              📚 Todos los Títulos del Catálogo ({filteredMovies.length})
            </h3>
          </div>
        </div>
      )}

      {/* Movies Responsive Grid, Partidos o Deportes en Vivo */}
      {activeCategory === 'partidos' ? (
        <SportsMatchesTab
          onPlayChannel={(mediaItem) => {
            const rawMovie: any = {
              id: mediaItem.id,
              tmdbId: 0,
              title: mediaItem.title,
              overview: mediaItem.overview,
              posterPath: '',
              posterUrl: mediaItem.posterUrl,
              backdropPath: '',
              backdropUrl: mediaItem.backdropUrl,
              releaseDate: String(mediaItem.year || 2024),
              genres: mediaItem.genres,
              voteAverage: 9.9,
              streamUrl: mediaItem.videoUrl,
              category: 'live_tv',
              streamType: 'hls',
              servers: mediaItem.servers,
            };
            onPlayMovie(mediaItem, rawMovie);
          }}
          onCastChannel={(mediaItem) => {
            const rawMovie: any = {
              id: mediaItem.id,
              tmdbId: 0,
              title: mediaItem.title,
              overview: mediaItem.overview,
              posterPath: '',
              posterUrl: mediaItem.posterUrl,
              backdropPath: '',
              backdropUrl: mediaItem.backdropUrl,
              releaseDate: String(mediaItem.year || 2024),
              genres: mediaItem.genres,
              voteAverage: 9.9,
              streamUrl: mediaItem.videoUrl,
              category: 'live_tv',
              streamType: 'hls',
              servers: mediaItem.servers,
            };
            onCastMovie(mediaItem, rawMovie);
          }}
        />
      ) : activeCategory === 'sports' ? (
        <SportsLiveGrid
          onPlayChannel={(mediaItem) => {
            const rawMovie: any = {
              id: mediaItem.id,
              tmdbId: 0,
              title: mediaItem.title,
              overview: mediaItem.overview,
              posterPath: '',
              posterUrl: mediaItem.posterUrl,
              backdropPath: '',
              backdropUrl: mediaItem.backdropUrl,
              releaseDate: String(mediaItem.year),
              genres: mediaItem.genres,
              voteAverage: 9.9,
              streamUrl: mediaItem.videoUrl,
              category: 'live_tv',
              streamType: 'hls',
              servers: mediaItem.servers,
            };
            onPlayMovie(mediaItem, rawMovie);
          }}
          onCastChannel={(mediaItem) => {
            const rawMovie: any = {
              id: mediaItem.id,
              tmdbId: 0,
              title: mediaItem.title,
              overview: mediaItem.overview,
              posterPath: '',
              posterUrl: mediaItem.posterUrl,
              backdropPath: '',
              backdropUrl: mediaItem.backdropUrl,
              releaseDate: String(mediaItem.year),
              genres: mediaItem.genres,
              voteAverage: 9.9,
              streamUrl: mediaItem.videoUrl,
              category: 'live_tv',
              streamType: 'hls',
              servers: mediaItem.servers,
            };
            onCastMovie(mediaItem, rawMovie);
          }}
          connectedScreenName={connectedScreenName}
        />
      ) : loading && allMovies.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-600" />
          <p className="text-xs text-zinc-400">Cargando catálogo multimedia...</p>
        </div>
      ) : error && allMovies.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button
            onClick={refreshCatalog}
            className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      ) : activeCategory === 'my-list' && filteredMovies.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/40 rounded-3xl border border-zinc-800 p-8 max-w-xl mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4">
            <Bookmark className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Tu lista está vacía</h3>
          <p className="text-zinc-400 text-sm mb-6">
            No has agregado títulos a tu lista todavía. En cualquier tarjeta de película o serie, haz clic en el ícono de marcador para guardarla aquí.
          </p>
          <button
            onClick={() => handleCategorySelect('all')}
            className="px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-xl shadow-red-900/30 transition transform hover:scale-105"
          >
            Explorar todo el catálogo
          </button>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/40 rounded-2xl border border-zinc-800/80">
          <p className="text-zinc-300 text-sm font-medium mb-3">
            {searchQuery
              ? `No encontramos resultados para "${searchQuery}" en el catálogo.`
              : 'No hay títulos disponibles en esta categoría.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            {searchQuery && (
              <button
                onClick={handleClearQuery}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl transition"
              >
                Ver todo el catálogo
              </button>
            )}
            <button
              onClick={() => setIsCustomModalOpen(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
            >
              <Plus size={14} />
              <span>Agregar Link propio</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <VirtuosoGrid
            useWindowScroll
            data={displayedMovies}
            listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
            itemContent={(_index, movie) => {
              const isBookmarked =
                myListIds.includes(movie.id) || myListIds.includes(String(movie.tmdbId));
              return (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  onPlay={(m) => handlePlay(m, false)}
                  onCast={(m) => handlePlay(m, true)}
                  onDetails={(m) => onOpenDetails(mediaSync.movieToMediaItem(m))}
                  isBookmarked={isBookmarked}
                  onToggleBookmark={(m) => onToggleMyList && onToggleMyList(m.id)}
                />
              );
            }}
          />

          <div ref={sentinelRef} className="h-4 w-full pointer-events-none" />

          {/* TAREA 2: Paginación real con contador y botón Cargar más */}
          {displayedMovies.length < totalCount && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-zinc-800/80">
              <div className="text-xs text-zinc-400 font-medium">
                Mostrando <span className="text-white font-bold">{displayedMovies.length}</span> de{' '}
                <span className="text-white font-bold">{totalCount}</span> títulos
              </div>
              <button
                onClick={() => setVisiblePage((p) => p + 1)}
                className="flex items-center gap-2.5 px-8 py-3.5 bg-zinc-900/90 hover:bg-zinc-800 text-white font-bold rounded-2xl border border-zinc-700/80 shadow-2xl transition transform hover:scale-105 text-sm backdrop-blur-md"
              >
                <Sparkles size={16} className="text-amber-400" />
                <span>Cargar más títulos (+{PAGE_SIZE})</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal para agregar links propios */}
      <CustomStreamModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        onMediaAdded={handleMediaAdded}
      />
    </section>
  );
};
