import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import QRCode from 'qrcode';
import {
  Search as SearchIcon,
  ArrowLeft,
  Smartphone,
  Bookmark,
  Cast,
  Sliders,
  Users,
  Layers,
  Activity,
  Wifi,
  Youtube,
  Music,
  Trophy,
  Tv,
} from 'lucide-react';
import { ConnectionDiagnosticSection } from './ConnectionDiagnosticSection';
import { localCatalogProvider, CatalogProviderError } from '../providers/localCatalogProvider';
import type { CardItem, CatalogSortOption, GenreCountItem, HomeRow } from '../providers/types';
import { watchHistoryService } from '../services/watchHistoryService';
import { deviceSync } from '../services/deviceSync';
import { diagnosticService } from '../services/diagnosticService';
import { MEDIA_CATALOG } from '../data/catalog';
import { DetailModal } from '../components/DetailModal';
import { VideoPlayer } from '../components/VideoPlayer';
import { AmbientScreen } from '../components/AmbientScreen';
import { RemoteControlDrawer } from '../components/RemoteControlDrawer';
import { RemoteControlSheet } from '../components/RemoteControlSheet';
import { AudioSettingsModal } from '../components/AudioSettingsModal';
import { GuestShareModal } from '../components/GuestShareModal';
import { ContinueRow } from './ContinueRow';
import { MiniRemote } from './MiniRemote';
import { RemotePanel } from './RemotePanel';
import { ScreensManagerView } from './ScreensManagerView';
import { SportsMatchesTab } from '../components/SportsMatchesTab';
import { SportsLiveGrid } from '../components/SportsLiveGrid';
import { SpotifyHub } from '../components/SpotifyHub';
import { YouTubeHub } from '../components/YouTubeHub';
import { SPOTIFY_TRACKS } from '../data/spotifyCatalog';
import { YOUTUBE_VIDEOS } from '../data/youtubeCatalog';
import { AppRuntimeProvider, useAppRuntime, type HubType } from '../app/AppRuntime';
import { toMediaItem } from '../app/toMediaItem';
import type { AudioSettings, MediaItem, PlaybackSettings } from '../types';
import { AppShell } from './AppShell';
import { Hero } from './Hero';
import { Row } from './Row';
import { TitleCard } from './TitleCard';
import { FilterBar, type FilterState } from './FilterBar';
import { GridSkeleton, HeroSkeleton } from './Skeleton';
import { useLiteMode, type LiteModePreference } from './liteMode';
import { RemoteSheet } from './RemoteSheet';
import { getTabMemory, saveTabMemory } from './navigationMemory';

export interface NewAppProps {
  onDisableV2?: () => void;
}

function buildTitleRoute(item: CardItem | MediaItem): string {
  const cat = item.category || item.type;
  const typeSeg =
    cat === 'anime'
      ? 'anime'
      : cat === 'series' || item.type === 'series'
      ? 'series'
      : 'movie';
  return `/titulo/${encodeURIComponent(typeSeg)}/${encodeURIComponent(item.id)}`;
}

interface HomeViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem: (item: CardItem) => void;
}

const HomeView: React.FC<HomeViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const navigate = useNavigate();
  const {
    continueWatchingList,
    refreshContinueWatching,
    handlePlayLocal,
    handleCastMediaToScreen,
    triggerNotification,
    connectedScreenName,
    sendRemoteCommand,
  } = useAppRuntime();

  const { isLite } = useLiteMode();
  const [rows, setRows] = useState<HomeRow[]>([]);
  const [heroSynopsis, setHeroSynopsis] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const historyAll = watchHistoryService.getAll();
    const seenIds = Array.from(
      new Set(
        historyAll
          .map((h) => h.mediaId || h.mediaItem?.id || h.id)
          .filter((id): id is string => Boolean(id))
      )
    ).slice(0, 200);

    localCatalogProvider
      .getHome(seenIds.length > 0 ? seenIds : undefined)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error al cargar Inicio');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const heroItem = useMemo<CardItem | null>(() => {
    const trending = rows.find((r) => r.id === 'trending' || r.title === 'Tendencias');
    if (trending && trending.items.length > 0) {
      return trending.items[0] ?? null;
    }
    const firstNonEmpty = rows.find((r) => r.items.length > 0);
    return firstNonEmpty?.items[0] ?? null;
  }, [rows]);

  useEffect(() => {
    if (!heroItem) {
      setHeroSynopsis('');
      return;
    }
    let cancelled = false;
    localCatalogProvider
      .getDetail(heroItem.category || heroItem.type, heroItem.tmdbId || heroItem.id)
      .then((d) => {
        if (!cancelled && d.overview) {
          setHeroSynopsis(d.overview);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [heroItem]);

  if (loading) {
    return (
      <div className="p-4 sm:p-8 space-y-6">
        <HeroSkeleton />
        <GridSkeleton count={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-400 font-semibold text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="py-4 sm:py-6 space-y-2">
      <div className="px-4 sm:px-8">
        <Hero
          item={heroItem}
          overview={heroSynopsis}
          onPlay={onPlayItem}
          onCast={onCastItem}
          connectedScreenName={connectedScreenName}
          onMoreInfo={onSelectItem}
        />
      </div>

      {continueWatchingList.length > 0 && (
        <ContinueRow
          items={continueWatchingList}
          onPlay={(media, episode, initialTime) => {
            handlePlayLocal(media, episode, initialTime);
          }}
          onCast={(media, episode) => {
            handleCastMediaToScreen(media, episode || undefined);
          }}
          onRemove={(id) => {
            watchHistoryService.remove(id);
            refreshContinueWatching();
            triggerNotification('Quitado de Continuar Viendo');
          }}
          connectedScreenName={connectedScreenName}
        />
      )}

      {/* Accesos rápidos en Inicio solo en celular (<768 px) */}
      <div className="px-4 md:hidden py-1">
        <div
          aria-label="Accesos rápidos de inicio"
          className="p-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 grid grid-cols-3 gap-2 shadow"
        >
          <button
            type="button"
            aria-label="Abrir YouTube en TV"
            onClick={() => {
              const isConnected = Boolean(
                connectedScreenName &&
                connectedScreenName.trim() !== '' &&
                connectedScreenName !== 'Sin pantalla' &&
                connectedScreenName !== 'Ninguna'
              );
              if (!isConnected) {
                navigate('/pantallas');
                return;
              }
              sendRemoteCommand({ action: 'switchHub', payload: { hub: 'youtube' } });
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition border border-zinc-700/80 shadow"
          >
            <Youtube className="w-4 h-4 text-red-500 shrink-0" />
            <span>YouTube</span>
          </button>

          <button
            type="button"
            aria-label="Abrir Spotify en TV"
            onClick={() => {
              const isConnected = Boolean(
                connectedScreenName &&
                connectedScreenName.trim() !== '' &&
                connectedScreenName !== 'Sin pantalla' &&
                connectedScreenName !== 'Ninguna'
              );
              if (!isConnected) {
                navigate('/pantallas');
                return;
              }
              sendRemoteCommand({ action: 'switchHub', payload: { hub: 'spotify' } });
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition border border-zinc-700/80 shadow"
          >
            <Music className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Spotify</span>
          </button>

          <button
            type="button"
            aria-label="Abrir Partidos en TV"
            onClick={() => {
              const isConnected = Boolean(
                connectedScreenName &&
                connectedScreenName.trim() !== '' &&
                connectedScreenName !== 'Sin pantalla' &&
                connectedScreenName !== 'Ninguna'
              );
              if (!isConnected) {
                navigate('/pantallas');
                return;
              }
              sendRemoteCommand({ action: 'switchHub', payload: { hub: 'sports' } });
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition border border-zinc-700/80 shadow"
          >
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Partidos</span>
          </button>
        </div>
      </div>

      <Virtuoso
        useWindowScroll
        data={rows}
        overscan={isLite ? 100 : 200}
        defaultItemHeight={310}
        itemContent={(_index, row) => (
          <Row
            key={row.id}
            title={row.title}
            items={row.items}
            onSelectItem={onSelectItem}
            onPlayItem={onPlayItem}
            onCastItem={onCastItem}
            connectedScreenName={connectedScreenName}
            lite={isLite}
            posterWidth={isLite ? 154 : 185}
          />
        )}
      />
    </div>
  );
};

interface ExploreViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem: (item: CardItem) => void;
}

const PAGE_SIZE = 48;
const MAX_EXPLORE_ITEMS = 600;

const ExploreView: React.FC<ExploreViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const { connectedScreenName } = useAppRuntime();
  const { isLite } = useLiteMode();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restaurar estado inicial desde searchParams de la URL o memoria de navegación (< 30 min)
  const initialFilters = useMemo<FilterState>(() => {
    let sp = searchParams;
    const hasParams = Array.from(sp.keys()).length > 0;
    if (!hasParams) {
      const remembered = getTabMemory('explore');
      if (remembered?.search) {
        sp = new URLSearchParams(remembered.search);
      }
    }
    const categoryParam = sp.get('category') || sp.get('type') || 'all';
    const genreParam = sp.get('genre');
    const genres = genreParam
      ? genreParam
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      : [];
    const genreMode = sp.get('genreMode') === 'any' ? 'any' : 'all';
    const yearFromParam = sp.get('yearFrom');
    const yearToParam = sp.get('yearTo');
    const yearFrom = yearFromParam ? parseInt(yearFromParam, 10) || null : null;
    const yearTo = yearToParam ? parseInt(yearToParam, 10) || null : null;
    const ratingParam = sp.get('rating');
    const minRating = ratingParam ? parseFloat(ratingParam) || 0 : 0;
    const sortParam = (sp.get('sort') || 'default') as CatalogSortOption;

    return {
      category: categoryParam,
      genres,
      genreMode,
      yearFrom,
      yearTo,
      minRating,
      sort: sortParam,
    };
  }, []);

  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [lastFilterHint, setLastFilterHint] = useState<{ label: string; revert: (f: FilterState) => FilterState } | null>(null);

  // Sincronizar cambios en los filtros con los parámetros de la URL usando replace: true
  const updateFilters = useCallback(
    (next: FilterState) => {
      setFilters((prev) => {
        if (next.genres.length > prev.genres.length) {
          const added = next.genres.find((g) => !prev.genres.includes(g));
          if (added) {
            setLastFilterHint({
              label: `género "${added}"`,
              revert: (f) => ({ ...f, genres: f.genres.filter((x) => x !== added) }),
            });
          }
        } else if (next.category !== prev.category && next.category !== 'all') {
          setLastFilterHint({
            label: `tipo "${next.category}"`,
            revert: (f) => ({ ...f, category: 'all' }),
          });
        } else if (next.minRating > prev.minRating && next.minRating > 0) {
          setLastFilterHint({
            label: `rating ${next.minRating}+`,
            revert: (f) => ({ ...f, minRating: 0 }),
          });
        } else if (next.yearFrom !== prev.yearFrom || next.yearTo !== prev.yearTo) {
          if (next.yearFrom !== null || next.yearTo !== null) {
            setLastFilterHint({
              label: 'rango de año',
              revert: (f) => ({ ...f, yearFrom: null, yearTo: null, decade: null }),
            });
          }
        }
        return next;
      });
      const params: Record<string, string> = {};
      if (next.category && next.category !== 'all') {
        params.category = next.category;
        params.type = next.category;
      }
      if (next.genres && next.genres.length > 0) params.genre = next.genres.join(',');
      if (next.genreMode === 'any') params.genreMode = 'any';
      if (next.yearFrom !== null && next.yearFrom !== undefined) {
        params.yearFrom = String(next.yearFrom);
      }
      if (next.yearTo !== null && next.yearTo !== undefined) {
        params.yearTo = String(next.yearTo);
      }
      if (next.minRating > 0) params.rating = String(next.minRating);
      if (next.sort && next.sort !== 'default') params.sort = next.sort;

      const qs = new URLSearchParams(params).toString();
      saveTabMemory('explore', {
        fullPath: qs ? `/explorar?${qs}` : '/explorar',
        search: qs,
      });

      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (Array.from(searchParams.keys()).length === 0) {
      const remembered = getTabMemory('explore');
      if (remembered?.search) {
        setSearchParams(new URLSearchParams(remembered.search), { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  // Sincronizar desde la URL hacia los filtros si el usuario navega atrás/adelante
  useEffect(() => {
    const categoryParam = searchParams.get('category') || searchParams.get('type') || 'all';
    const genreParam = searchParams.get('genre');
    const nextGenres = genreParam
      ? genreParam
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      : [];
    const nextGenreMode: 'all' | 'any' = searchParams.get('genreMode') === 'any' ? 'any' : 'all';
    const yearFromParam = searchParams.get('yearFrom');
    const yearToParam = searchParams.get('yearTo');
    const nextYearFrom = yearFromParam ? parseInt(yearFromParam, 10) || null : null;
    const nextYearTo = yearToParam ? parseInt(yearToParam, 10) || null : null;
    const ratingParam = searchParams.get('rating');
    const nextRating = ratingParam ? parseFloat(ratingParam) || 0 : 0;
    const sortParam = (searchParams.get('sort') || 'default') as CatalogSortOption;

    setFilters((prev) => {
      const sameCategory = prev.category === categoryParam;
      const sameGenres = JSON.stringify(prev.genres) === JSON.stringify(nextGenres);
      const sameGenreMode = (prev.genreMode || 'all') === nextGenreMode;
      const sameYearFrom = prev.yearFrom === nextYearFrom;
      const sameYearTo = prev.yearTo === nextYearTo;
      const sameRating = prev.minRating === nextRating;
      const sameSort = prev.sort === sortParam;
      if (sameCategory && sameGenres && sameGenreMode && sameYearFrom && sameYearTo && sameRating && sameSort) return prev;
      return {
        category: categoryParam,
        genres: nextGenres,
        genreMode: nextGenreMode,
        yearFrom: nextYearFrom,
        yearTo: nextYearTo,
        minRating: nextRating,
        sort: sortParam,
      };
    });
  }, [searchParams]);

  const [items, setItems] = useState<CardItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [facetGenres, setFacetGenres] = useState<GenreCountItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const loadingMoreRef = useRef<boolean>(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  const buildQueryParams = useCallback(
    (targetPage: number) => ({
      category: filters.category === 'all' ? undefined : filters.category,
      genre: filters.genres.length > 0 ? filters.genres : undefined,
      genreMode: filters.genreMode === 'any' ? ('any' as const) : ('all' as const),
      yearFrom: filters.yearFrom !== null && filters.yearFrom !== undefined ? filters.yearFrom : undefined,
      yearTo: filters.yearTo !== null && filters.yearTo !== undefined ? filters.yearTo : undefined,
      minRating: filters.minRating > 0 ? filters.minRating : undefined,
      sort: filters.sort,
      page: targetPage,
      limit: PAGE_SIZE,
      facets: true,
    }),
    [filters]
  );

  useEffect(() => {
    const controller = new AbortController();
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
      loadMoreAbortRef.current = null;
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
    let cancelled = false;
    setLoadingInitial(true);
    setPage(1);

    localCatalogProvider
      .query({ ...buildQueryParams(1), signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items.slice(0, MAX_EXPLORE_ITEMS));
        setTotal(res.total);
        setTotalPages(res.totalPages);
        if (res.facets && res.facets.genres) {
          const list: GenreCountItem[] = Object.entries(res.facets.genres)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
          setFacetGenres(list);
        } else {
          setFacetGenres([]);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof CatalogProviderError && err.code === 'ABORTED') return;
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
        loadMoreAbortRef.current = null;
      }
    };
  }, [buildQueryParams]);

  const loadNextPage = useCallback(() => {
    if (
      loadingInitial ||
      loadingMoreRef.current ||
      page >= totalPages ||
      items.length >= MAX_EXPLORE_ITEMS
    ) {
      return;
    }
    const nextPage = page + 1;
    const controller = new AbortController();
    if (loadMoreAbortRef.current) loadMoreAbortRef.current.abort();
    loadMoreAbortRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    localCatalogProvider
      .query({ ...buildQueryParams(nextPage), facets: false, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setItems((prev) => {
          if (prev.length >= MAX_EXPLORE_ITEMS) return prev;
          const existingIds = new Set(prev.map((i) => i.id));
          const fresh = res.items.filter((i) => !existingIds.has(i.id));
          return [...prev, ...fresh].slice(0, MAX_EXPLORE_ITEMS);
        });
        setPage(nextPage);
      })
      .catch((err: unknown) => {
        if (err instanceof CatalogProviderError && err.code === 'ABORTED') return;
      })
      .finally(() => {
        if (loadMoreAbortRef.current === controller) {
          loadMoreAbortRef.current = null;
        }
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [buildQueryParams, items.length, loadingInitial, page, totalPages]);

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl sm:text-2xl font-extrabold text-white">Explorar catálogo</h1>
        <span className="hidden md:inline text-xs text-zinc-400 font-semibold">
          {total.toLocaleString('es-AR')} títulos encontrados
        </span>
      </div>

      <FilterBar
        value={filters}
        onChange={updateFilters}
        availableGenres={facetGenres}
        totalResults={total}
      />

      {loadingInitial ? (
        <GridSkeleton count={12} />
      ) : items.length === 0 ? (
        <div className="py-16 text-center rounded-2xl bg-zinc-900/50 border border-zinc-800 p-8 space-y-4">
          <div>
            <p className="text-base font-bold text-white mb-1">
              No hay títulos que coincidan con estos filtros
            </p>
            <p className="text-xs text-zinc-400">
              Prueba quitando algún filtro o ampliando los criterios seleccionados.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {(() => {
              const fallbackRemove = (() => {
                if (filters.genres.length > 0) {
                  return {
                    label: `género "${filters.genres[filters.genres.length - 1]}"`,
                    revert: (f: FilterState) => ({ ...f, genres: f.genres.slice(0, -1) }),
                  };
                }
                if (filters.yearFrom !== null || filters.yearTo !== null) {
                  return {
                    label: 'rango de año',
                    revert: (f: FilterState) => ({ ...f, yearFrom: null, yearTo: null, decade: null }),
                  };
                }
                if (filters.minRating > 0) {
                  return {
                    label: `rating ${filters.minRating}+`,
                    revert: (f: FilterState) => ({ ...f, minRating: 0 }),
                  };
                }
                if (filters.category !== 'all') {
                  return {
                    label: `tipo "${filters.category}"`,
                    revert: (f: FilterState) => ({ ...f, category: 'all' }),
                  };
                }
                return null;
              })();
              const hint = lastFilterHint ?? fallbackRemove;
              return hint ? (
                <button
                  type="button"
                  onClick={() => updateFilters(hint.revert(filters))}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  Quitar último filtro ({hint.label})
                </button>
              ) : null;
            })()}
            <button
              type="button"
              onClick={() =>
                updateFilters({
                  category: 'all',
                  genres: [],
                  genreMode: 'all',
                  yearFrom: null,
                  yearTo: null,
                  decade: null,
                  minRating: 0,
                  sort: 'default',
                })
              }
              className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold border border-zinc-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Limpiar todo
            </button>
          </div>
        </div>
      ) : (
        <>
          <VirtuosoGrid
            useWindowScroll
            totalCount={items.length}
            endReached={loadNextPage}
            overscan={isLite ? 100 : 200}
            listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
            itemContent={(index) => {
              const item = items[index];
              if (!item) return null;
              return (
                <TitleCard
                  item={item}
                  onSelect={onSelectItem}
                  onPlay={onPlayItem}
                  onCast={onCastItem}
                  connectedScreenName={connectedScreenName}
                  posterWidth={isLite ? 154 : 185}
                />
              );
            }}
          />
          {loadingMore && (
            <div className="py-6 text-center text-xs text-zinc-400 font-medium">
              Cargando más títulos...
            </div>
          )}
          {!loadingMore && items.length >= MAX_EXPLORE_ITEMS && total > MAX_EXPLORE_ITEMS && (
            <div className="py-6 text-center text-xs text-zinc-400">
              Mostrando los primeros {MAX_EXPLORE_ITEMS} de {total.toLocaleString('es-AR')} títulos.
              Usá los filtros o el buscador para acotar la lista.
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface SearchViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem: (item: CardItem) => void;
}

const SearchView: React.FC<SearchViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const { connectedScreenName } = useAppRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = useMemo(() => {
    const fromUrl = searchParams.get('q');
    if (fromUrl !== null && fromUrl !== undefined) return fromUrl;
    const remembered = getTabMemory('search');
    return (remembered?.state?.query || remembered?.search?.replace(/^q=/, '')) ?? '';
  }, [searchParams]);
  const [query, setQuery] = useState<string>(initialQ);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQ.trim());
  const [results, setResults] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!searchParams.get('q')) {
      const remembered = getTabMemory('search');
      const remQ = (remembered?.state?.query || remembered?.search?.replace(/^q=/, ''))?.trim();
      if (remQ) {
        setSearchParams({ q: remQ }, { replace: true });
        setQuery(remQ);
        setDebouncedQuery(remQ);
      }
    }
  }, [searchParams, setSearchParams]);

  // Sincronizar hacia useSearchParams con debounce y replace: true
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = query.trim();
      setDebouncedQuery(trimmed);

      const currentQ = searchParams.get('q') || '';
      if (trimmed !== currentQ) {
        if (trimmed.length > 0) {
          setSearchParams({ q: trimmed }, { replace: true });
        } else {
          setSearchParams({}, { replace: true });
        }
      }
      saveTabMemory('search', {
        fullPath: trimmed ? `/buscar?q=${encodeURIComponent(trimmed)}` : '/buscar',
        search: trimmed ? `q=${encodeURIComponent(trimmed)}` : '',
        state: { query: trimmed },
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchParams, setSearchParams]);

  // Restaurar estado si searchParams cambia por navegación en historial
  useEffect(() => {
    const qFromUrl = searchParams.get('q') || '';
    if (qFromUrl !== query) {
      setQuery(qFromUrl);
      setDebouncedQuery(qFromUrl.trim());
    }
  }, [searchParams]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    localCatalogProvider
      .search(debouncedQuery)
      .then((res) => {
        if (!cancelled) setResults(res);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-xl sm:text-2xl font-extrabold text-white mb-3">Buscar</h1>
        <div className="relative">
          <SearchIcon className="w-5 h-5 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Películas, series, anime..."
            aria-label="Buscar películas, series o anime"
            className="w-full min-h-[48px] pl-12 pr-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          />
        </div>
      </div>

      {debouncedQuery.length < 2 ? (
        <div className="py-20 text-center rounded-2xl bg-zinc-900/40 border border-zinc-800/70 p-8">
          <SearchIcon className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-base font-bold text-zinc-200 mb-1">
            Busca en el catálogo y en TMDB
          </p>
          <p className="text-xs text-zinc-400">
            Escribe al menos 2 caracteres para ver resultados instantáneos.
          </p>
        </div>
      ) : loading ? (
        <GridSkeleton count={12} />
      ) : results.length === 0 ? (
        <div className="py-20 text-center rounded-2xl bg-zinc-900/40 border border-zinc-800/70 p-8">
          <p className="text-base font-bold text-white mb-1">
            Sin resultados para "{debouncedQuery}"
          </p>
          <p className="text-xs text-zinc-400">
            Verifica la ortografía o prueba con otro título.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {results.map((item) => (
            <TitleCard
              key={item.id}
              item={item}
              onSelect={onSelectItem}
              onPlay={onPlayItem}
              onCast={onCastItem}
              connectedScreenName={connectedScreenName}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface MyListViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem: (item: CardItem) => void;
}

function isRecordObj(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const MyListView: React.FC<MyListViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const { myListIds, toggleMyList, connectedScreenName, triggerNotification } = useAppRuntime();
  const [items, setItems] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    if (myListIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const base = deviceSync.getApiBase();
    const url = `${base}/api/catalog?ids=${encodeURIComponent(myListIds.join(','))}&fields=card`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((raw: unknown) => {
        if (cancelled) return;
        const serverItems: CardItem[] = [];
        if (isRecordObj(raw) && Array.isArray(raw.items)) {
          for (const entry of raw.items) {
            if (!isRecordObj(entry)) continue;
            serverItems.push({
              id: typeof entry.id === 'string' ? entry.id : '',
              tmdbId: typeof entry.tmdbId === 'number' ? entry.tmdbId : Number(entry.tmdbId) || 0,
              title: typeof entry.title === 'string' ? entry.title : 'Sin Título',
              posterUrl: typeof entry.posterUrl === 'string' ? entry.posterUrl : '',
              backdropUrl: typeof entry.backdropUrl === 'string' ? entry.backdropUrl : '',
              year: typeof entry.year === 'number' ? entry.year : 2024,
              rating: typeof entry.rating === 'number' ? entry.rating : 7.5,
              genres: Array.isArray(entry.genres)
                ? entry.genres.filter((g): g is string => typeof g === 'string')
                : [],
              category: typeof entry.category === 'string' ? entry.category : 'movie',
              type: typeof entry.type === 'string' ? entry.type : 'movie',
              quality: typeof entry.quality === 'string' ? entry.quality : '1080p',
              upcoming: Boolean(entry.upcoming),
            });
          }
        }

        // Complementar con MEDIA_CATALOG local para IDs tipo slug ('deadpool-wolverine', etc.)
        const foundIds = new Set(serverItems.map((i) => i.id));
        for (const id of myListIds) {
          if (foundIds.has(id)) continue;
          const localMatch = MEDIA_CATALOG.find(
            (m) => m.id === id || String(m.tmdbId) === id
          );
          if (localMatch && !foundIds.has(localMatch.id)) {
            foundIds.add(localMatch.id);
            serverItems.push({
              id: localMatch.id,
              tmdbId: localMatch.tmdbId ?? 0,
              title: localMatch.title,
              posterUrl: localMatch.posterUrl,
              backdropUrl: localMatch.backdropUrl || localMatch.posterUrl,
              year: localMatch.year,
              rating: Number(((localMatch.matchScore || 80) / 10).toFixed(1)),
              genres: localMatch.genres,
              category: localMatch.category || localMatch.type,
              type: localMatch.type,
              quality: localMatch.qualityBadge || '1080p',
              upcoming: false,
            });
          }
        }

        setItems(serverItems);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [myListIds]);

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">Mi lista</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Tus películas, series y anime guardados para ver más tarde.
          </p>
        </div>
        <span className="text-xs font-semibold text-zinc-400">
          {items.length} {items.length === 1 ? 'título' : 'títulos'}
        </span>
      </div>

      {loading ? (
        <GridSkeleton count={6} />
      ) : items.length === 0 ? (
        <div className="py-20 text-center rounded-2xl bg-zinc-900/40 border border-zinc-800 p-8 max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
            <Bookmark className="w-6 h-6" />
          </div>
          <div>
            <p className="text-base font-bold text-white mb-1">Tu lista está vacía</p>
            <p className="text-xs text-zinc-400">
              Agrega películas o series desde la ficha de cualquier título para tenerlas a mano aquí.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/explorar')}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-lg"
          >
            Explorar catálogo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <TitleCard
              key={item.id}
              item={item}
              onSelect={onSelectItem}
              onPlay={onPlayItem}
              onCast={onCastItem}
              connectedScreenName={connectedScreenName}
              onRemove={(target) => {
                if (myListIds.includes(target.id)) {
                  toggleMyList(target.id);
                } else if (myListIds.includes(String(target.tmdbId))) {
                  toggleMyList(String(target.tmdbId));
                } else {
                  toggleMyList(target.id);
                }
                triggerNotification(`Quitado de Mi lista: ${target.title}`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TitleDetailRouteView: React.FC = () => {
  const { type = 'movie', id = '' } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const {
    handlePlayLocal,
    handleCastMediaToScreen,
    myListIds,
    toggleMyList,
    connectedScreenName,
  } = useAppRuntime();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // 1. Buscar coincidencia rápida en MEDIA_CATALOG o consultar servidor
    const localFound = MEDIA_CATALOG.find(
      (m) => m.id === id || String(m.tmdbId) === id
    );

    const loadMedia = async () => {
      try {
        // Consultar /api/catalog?ids= para obtener CardItem real del catálogo de 10.119 títulos
        const base = deviceSync.getApiBase();
        const catRes = await fetch(
          `${base}/api/catalog?ids=${encodeURIComponent(id)}&fields=card`
        );
        let card: CardItem | null = null;
        if (catRes.ok) {
          const catJson: unknown = await catRes.json();
          if (
            isRecordObj(catJson) &&
            Array.isArray(catJson.items) &&
            catJson.items.length > 0 &&
            isRecordObj(catJson.items[0])
          ) {
            const raw = catJson.items[0];
            card = {
              id: typeof raw.id === 'string' ? raw.id : id,
              tmdbId: typeof raw.tmdbId === 'number' ? raw.tmdbId : Number(raw.tmdbId) || 0,
              title: typeof raw.title === 'string' ? raw.title : localFound?.title || id,
              posterUrl: typeof raw.posterUrl === 'string' ? raw.posterUrl : localFound?.posterUrl || '',
              backdropUrl:
                typeof raw.backdropUrl === 'string'
                  ? raw.backdropUrl
                  : localFound?.backdropUrl || '',
              year: typeof raw.year === 'number' ? raw.year : localFound?.year || 2024,
              rating: typeof raw.rating === 'number' ? raw.rating : 7.5,
              genres: Array.isArray(raw.genres)
                ? raw.genres.filter((g): g is string => typeof g === 'string')
                : localFound?.genres || [],
              category:
                typeof raw.category === 'string' ? raw.category : localFound?.category || type,
              type:
                typeof raw.type === 'string'
                  ? raw.type
                  : type === 'series' || type === 'anime'
                  ? 'series'
                  : 'movie',
              quality: typeof raw.quality === 'string' ? raw.quality : '1080p',
              upcoming: Boolean(raw.upcoming),
            };
          }
        }

        if (!card && localFound) {
          card = {
            id: localFound.id,
            tmdbId: localFound.tmdbId ?? 0,
            title: localFound.title,
            posterUrl: localFound.posterUrl,
            backdropUrl: localFound.backdropUrl || localFound.posterUrl,
            year: localFound.year,
            rating: Number(((localFound.matchScore || 80) / 10).toFixed(1)),
            genres: localFound.genres,
            category: localFound.category || localFound.type,
            type: localFound.type,
            quality: localFound.qualityBadge || '1080p',
            upcoming: false,
          };
        }

        const lookupId = card?.tmdbId || localFound?.tmdbId || id;
        let detail = null;
        try {
          detail = await localCatalogProvider.getDetail(type, lookupId);
        } catch (_) {}

        if (cancelled) return;

        if (!card && detail) {
          card = detail;
        }

        if (card) {
          const built = toMediaItem(card, detail);
          if (localFound?.episodes && (!built.episodes || built.episodes.length === 0)) {
            built.episodes = localFound.episodes;
          }
          setMedia(built);
        } else if (localFound) {
          setMedia(localFound);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadMedia();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  if (loading && !media) {
    return (
      <div className="p-8">
        <HeroSkeleton />
      </div>
    );
  }

  return (
    <DetailModal
      media={media}
      onClose={() => navigate(-1)}
      onPlayLocal={(m, ep) => {
        const enrichedEp = ep
          ? {
              ...ep,
              seasonNumber:
                Number(
                  ep.seasonNumber ??
                    (ep as any).season ??
                    (ep as any).season_number ??
                    1
                ) || 1,
              episodeNumber:
                Number(
                  ep.episodeNumber ??
                    (ep as any).episode ??
                    (ep as any).episode_number ??
                    1
                ) || 1,
            }
          : undefined;
        handlePlayLocal(m, enrichedEp, 0, true);
      }}
      onCastToScreen={(m, ep) => {
        const enrichedEp = ep
          ? {
              ...ep,
              seasonNumber:
                Number(
                  ep.seasonNumber ??
                    (ep as any).season ??
                    (ep as any).season_number ??
                    1
                ) || 1,
              episodeNumber:
                Number(
                  ep.episodeNumber ??
                    (ep as any).episode ??
                    (ep as any).episode_number ??
                    1
                ) || 1,
            }
          : undefined;
        handleCastMediaToScreen(m, enrichedEp);
      }}
      isMyList={Boolean(media && myListIds.includes(media.id))}
      onToggleMyList={(mediaId) => toggleMyList(mediaId)}
      connectedScreenName={connectedScreenName}
      allCatalog={MEDIA_CATALOG}
      onSelectSimilar={(similar) => {
        navigate(buildTitleRoute(similar));
      }}
    />
  );
};

const ControlView: React.FC = () => {
  const navigate = useNavigate();
  const {
    remotePlaybackState,
    remoteMediaItem,
    remoteEpisodeItem,
    connectedScreenName,
    sendRemoteCommand,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
  } = useAppRuntime();

  return (
    <div className="p-2 sm:p-6 pb-40 max-w-xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-extrabold text-white mb-1 px-2">Control Remoto</h1>
      <p className="text-xs text-zinc-400 mb-4 px-2">
        Controlando pantalla: <strong className="text-zinc-200">{connectedScreenName}</strong>
      </p>
      <RemotePanel
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        connectedScreenName={connectedScreenName}
        onSendCommand={sendRemoteCommand}
        onOpenAudioModal={() => setIsAudioModalOpen(true)}
        onOpenCastModal={() => navigate('/pantallas')}
        onOpenGuestModal={() => setIsGuestModalOpen(true)}
        onNavigateToCatalog={() => navigate('/explorar')}
      />
    </div>
  );
};

interface SettingsViewProps {
  onSwitchToClassic: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onSwitchToClassic }) => {
  const navigate = useNavigate();
  const {
    roomId,
    connectedScreenName,
    devices,
    deviceRole,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
  } = useAppRuntime();

  const { isLite, preference: litePref, urlForced: liteUrlForced, setPreference: setLitePref } =
    useLiteMode();
  const [diagEnabled, setDiagEnabled] = useState<boolean>(() => diagnosticService.isEnabled());
  const [localIp, setLocalIp] = useState<string>('127.0.0.1');
  const [port, setPort] = useState<number>(3000);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    return diagnosticService.onChange((enabled) => {
      setDiagEnabled(enabled);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const base = deviceSync.getApiBase();
    fetch(`${base}/api/local-ip`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || !isRecordObj(data)) return;
        const ip = typeof data.ip === 'string' && data.ip ? data.ip : '127.0.0.1';
        const p = typeof data.port === 'number' ? data.port : 3000;
        setLocalIp(ip);
        setPort(p);
        const pairingUrl = `http://${ip}:${p}/?role=remote&room=${encodeURIComponent(roomId)}`;
        QRCode.toDataURL(pairingUrl, {
          width: 180,
          margin: 1.5,
          color: { dark: '#000000', light: '#ffffff' },
        })
          .then((url) => {
            if (!cancelled) setQrDataUrl(url);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const handleToggleDiag = async () => {
    const next = await diagnosticService.toggle();
    setDiagEnabled(next);
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-white">Ajustes</h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Dispositivos, sala, audio, red local y herramientas de diagnóstico.
        </p>
      </div>

      {/* Botones de configuración y gestión */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <button
          type="button"
          onClick={() => navigate('/pantallas')}
          aria-label="Gestionar pantallas"
          className="min-h-[64px] p-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-left flex items-center justify-between gap-3 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
              <Cast className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Dispositivos y sala</div>
              <div className="text-xs text-zinc-400">
                Sala {roomId} • Rol: {deviceRole} ({devices.length} conectados)
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setIsAudioModalOpen(true)}
          aria-label="Audio y reproducción"
          className="min-h-[64px] p-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-left flex items-center justify-between gap-3 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Audio y reproducción</div>
              <div className="text-xs text-zinc-400">
                Ecualizador, volumen maestro y salto automático
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setIsGuestModalOpen(true)}
          aria-label="Invitados"
          className="min-h-[64px] p-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-left flex items-center justify-between gap-3 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Invitados</div>
              <div className="text-xs text-zinc-400">
                Compartir acceso QR a {connectedScreenName}
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/pantallas')}
          aria-label="Mis pantallas"
          className="min-h-[64px] p-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-left flex items-center justify-between gap-3 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Mis pantallas y TV</div>
              <div className="text-xs text-zinc-400">
                Conectar a TV, Living o agregar nuevas pantallas
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Modo ligero (Lite) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">
              Modo ligero (Lite) {isLite ? '• Activo' : ''}
            </div>
            <div className="text-xs text-zinc-400">
              Reduce animaciones, sombras e imágenes para televisores y celulares de baja potencia.
              {liteUrlForced ? ' (Forzado por URL ?lite=...)' : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-zinc-950/70 border border-zinc-800 rounded-xl p-1 shrink-0">
          {(
            [
              { value: 'auto', label: 'Auto' },
              { value: 'on', label: 'Activado' },
              { value: 'off', label: 'Desactivado' },
            ] as { value: LiteModePreference; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLitePref(opt.value)}
              aria-pressed={litePref === opt.value}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                litePref === opt.value
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interruptor de Modo diagnóstico */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Modo diagnóstico</div>
            <div className="text-xs text-zinc-400">
              Desactiva filtros de red/anuncios temporalmente para depurar reproductores.
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={diagEnabled}
          onClick={handleToggleDiag}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border transition ${
            diagEnabled
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
          }`}
        >
          {diagEnabled ? 'Activado' : 'Desactivado'}
        </button>
      </div>

      {/* IP y QR (/api/local-ip) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1.5 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400">
            <Wifi className="w-4 h-4" />
            <span>Red Local WiFi (/api/local-ip)</span>
          </div>
          <div className="font-mono text-lg font-extrabold text-white">
            http://{localIp}:{port}
          </div>
          <p className="text-xs text-zinc-400">
            Código de sala: <strong className="text-red-400 font-mono">{roomId}</strong> — Escanea el QR con tu celular para abrir el control remoto.
          </p>
        </div>
        {qrDataUrl && (
          <div className="p-2 bg-white rounded-xl shrink-0 shadow">
            <img src={qrDataUrl} alt="QR Red Local" className="w-28 h-28 rounded" />
          </div>
        )}
      </div>

      {/* Diagnóstico de conexión */}
      <ConnectionDiagnosticSection />

      {/* Volver a la vista clásica */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onSwitchToClassic}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-bold inline-flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a la vista clásica</span>
        </button>
      </div>
    </div>
  );
};

const HubRouteSynchronizer: React.FC = () => {
  const { activeHub, setActiveHub } = useAppRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const prevHubRef = useRef<HubType>(activeHub);
  const prevPathRef = useRef<string>(location.pathname);
  // Hub pedido por la navegacion que aun no se refleja en activeHub (evita rebote de ruta)
  const pendingHubFromRouteRef = useRef<HubType | null>(null);

  // Cuando cambia la ruta por navegación del usuario -> actualizar activeHub
  // Nota: /deportes y /canales mantienen activeHub === 'cinecast' para que
  // al elegir un partido o canal en vivo, VideoPlayer se abra a pantalla completa.
  useEffect(() => {
    if (location.pathname === prevPathRef.current) return;
    prevPathRef.current = location.pathname;

    let targetHub: HubType = 'cinecast';
    if (location.pathname.startsWith('/musica')) {
      targetHub = 'spotify';
    } else if (location.pathname.startsWith('/youtube')) {
      targetHub = 'youtube';
    }

    if (activeHub !== targetHub) {
      pendingHubFromRouteRef.current = targetHub;
      setActiveHub(targetHub);
    }
  }, [location.pathname, activeHub, setActiveHub]);

  // Cuando un comando remoto cambia activeHub -> navegar a /musica, /youtube, /deportes o /
  useEffect(() => {
    // Un cambio de hub pedido por la propia ruta no debe disparar navegacion de vuelta
    if (pendingHubFromRouteRef.current !== null) {
      if (activeHub === pendingHubFromRouteRef.current) {
        pendingHubFromRouteRef.current = null;
        prevHubRef.current = activeHub;
      }
      return;
    }
    if (activeHub === prevHubRef.current) return;
    prevHubRef.current = activeHub;

    if (activeHub === 'spotify' && !location.pathname.startsWith('/musica')) {
      prevPathRef.current = '/musica';
      navigate('/musica');
    } else if (activeHub === 'youtube' && !location.pathname.startsWith('/youtube')) {
      prevPathRef.current = '/youtube';
      navigate('/youtube');
    } else if (activeHub === 'sports' && !location.pathname.startsWith('/deportes')) {
      prevPathRef.current = '/deportes';
      navigate('/deportes');
    } else if (
      activeHub === 'cinecast' &&
      (location.pathname.startsWith('/musica') || location.pathname.startsWith('/youtube'))
    ) {
      prevPathRef.current = '/';
      navigate('/');
    }
  }, [activeHub, location.pathname, navigate]);

  return null;
};

const SpotifyView: React.FC = () => {
  const {
    deviceRole,
    connectedScreenName,
    activeSpotifyTrack,
    setActiveSpotifyTrack,
    isSpotifyPlaying,
    setIsSpotifyPlaying,
    audioSettings,
    sendRemoteCommand,
    triggerNotification,
  } = useAppRuntime();

  return (
    <SpotifyHub
      currentTrack={activeSpotifyTrack}
      isPlaying={isSpotifyPlaying}
      volume={audioSettings.volume}
      isMuted={audioSettings.isMuted}
      isScreenMode={deviceRole !== 'remote'}
      onSelectTrack={(track) => {
        setActiveSpotifyTrack(track);
        setIsSpotifyPlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({
            action: 'playSpotifyTrack',
            payload: { track },
          });
          triggerNotification(`🎵 Enviado a ${connectedScreenName}: ${track.title}`);
        }
      }}
      onTogglePlay={() => {
        setIsSpotifyPlaying((p) => !p);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: isSpotifyPlaying ? 'pause' : 'play' });
        }
      }}
      onNextTrack={() => {
        const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
        const next = SPOTIFY_TRACKS[(idx + 1) % SPOTIFY_TRACKS.length]!;
        setActiveSpotifyTrack(next);
        setIsSpotifyPlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: 'playSpotifyTrack', payload: { track: next } });
        }
      }}
      onPrevTrack={() => {
        const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
        const prev =
          SPOTIFY_TRACKS[(idx - 1 + SPOTIFY_TRACKS.length) % SPOTIFY_TRACKS.length]!;
        setActiveSpotifyTrack(prev);
        setIsSpotifyPlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: 'playSpotifyTrack', payload: { track: prev } });
        }
      }}
      onCastTrackToScreen={(track) => {
        setActiveSpotifyTrack(track);
        setIsSpotifyPlaying(true);
        sendRemoteCommand({
          action: 'playSpotifyTrack',
          payload: { track },
        });
        triggerNotification(`🎵 Reproduciendo "${track.title}" en ${connectedScreenName}`);
      }}
      connectedScreenName={connectedScreenName}
    />
  );
};

const YouTubeView: React.FC = () => {
  const {
    deviceRole,
    connectedScreenName,
    activeYouTubeVideo,
    setActiveYouTubeVideo,
    isYouTubePlaying,
    setIsYouTubePlaying,
    audioSettings,
    lastRemoteCommand,
    sendRemoteCommand,
    triggerNotification,
  } = useAppRuntime();

  return (
    <YouTubeHub
      currentVideo={activeYouTubeVideo}
      isPlaying={isYouTubePlaying}
      volume={audioSettings.volume}
      isMuted={audioSettings.isMuted}
      isScreenMode={deviceRole !== 'remote'}
      remoteCommandTrigger={lastRemoteCommand}
      onSelectVideo={(video) => {
        setActiveYouTubeVideo(video);
        setIsYouTubePlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({
            action: 'playYouTubeVideo',
            payload: { video },
          });
          triggerNotification(`▶️ Enviado a ${connectedScreenName}: ${video.title}`);
        }
      }}
      onTogglePlay={() => {
        setIsYouTubePlaying((p) => !p);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: isYouTubePlaying ? 'pause' : 'play' });
        }
      }}
      onNextVideo={() => {
        const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
        const next = YOUTUBE_VIDEOS[(idx + 1) % YOUTUBE_VIDEOS.length]!;
        setActiveYouTubeVideo(next);
        setIsYouTubePlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: 'playYouTubeVideo', payload: { video: next } });
        }
      }}
      onPrevVideo={() => {
        const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
        const prev =
          YOUTUBE_VIDEOS[(idx - 1 + YOUTUBE_VIDEOS.length) % YOUTUBE_VIDEOS.length]!;
        setActiveYouTubeVideo(prev);
        setIsYouTubePlaying(true);
        if (deviceRole === 'remote') {
          sendRemoteCommand({ action: 'playYouTubeVideo', payload: { video: prev } });
        }
      }}
      onSeekRelative={(seconds) => {
        sendRemoteCommand({
          action: 'seekRelative',
          payload: { seconds },
        });
      }}
      onCastVideoToScreen={(video) => {
        setActiveYouTubeVideo(video);
        setIsYouTubePlaying(true);
        sendRemoteCommand({
          action: 'playYouTubeVideo',
          payload: { video },
        });
        triggerNotification(`📺 Reproduciendo "${video.title}" en ${connectedScreenName}`);
      }}
      connectedScreenName={connectedScreenName}
    />
  );
};

interface NewAppContentProps {
  onSwitchToClassic: () => void;
}

const NewAppContent: React.FC<NewAppContentProps> = ({ onSwitchToClassic }) => {
  useLiteMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRemoteSheetOpen, setIsRemoteSheetOpen] = useState<boolean>(false);
  const {
    deviceRole,
    setDeviceRole,
    roomId,
    setRoomId,
    devices,
    selectedScreenId,
    setSelectedScreenId,
    isPermanentHomeLinked,
    handleTogglePermanentHome,
    connectedScreenName,
    activeHub,
    isScreenInStandby,
    setIsScreenInStandby,
    remoteNotification,
    audioSettings,
    setAudioSettings,
    playbackSettings,
    setPlaybackSettings,
    activeMedia,
    setActiveMedia,
    activeEpisode,
    setActiveEpisode,
    isPlayingLocally,
    setIsPlayingLocally,
    playerInitialTime,
    lastRemoteCommand,
    remotePlaybackState,
    remoteMediaItem,
    remoteEpisodeItem,
    handlePlayLocal,
    handleCastMediaToScreen,
    handlePlayNextEpisode,
    handlePlayPrevEpisode,
    handleBroadcastPlayerState,
    sendRemoteCommand,
    refreshContinueWatching,
    isAudioModalOpen,
    setIsAudioModalOpen,
    isGuestModalOpen,
    setIsGuestModalOpen,
  } = useAppRuntime();

  const handleSelectCard = useCallback(
    (card: CardItem) => {
      navigate(buildTitleRoute(card));
    },
    [navigate]
  );

  const handlePlayCard = useCallback(
    (card: CardItem) => {
      const item = toMediaItem(card);
      handlePlayLocal(item);
    },
    [handlePlayLocal]
  );

  const handleCastCard = useCallback(
    (card: CardItem) => {
      const item = toMediaItem(card);
      handleCastMediaToScreen(item);
    },
    [handleCastMediaToScreen]
  );

  return (
    <>
      <HubRouteSynchronizer />

      {/* 11. Rol 'screen' en reposo: <AmbientScreen> con las props de App.tsx L1132-1157 */}
      {isScreenInStandby && deviceRole === 'screen' ? (
        <div className="relative">
          <AmbientScreen
            deviceName={deviceSync.getDeviceName()}
            roomId={roomId}
            recentMedia={MEDIA_CATALOG}
            onWakeScreen={() => setIsScreenInStandby(false)}
            onPlayDirectly={(media) => {
              handlePlayLocal(media);
            }}
          />
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
            <button
              onClick={() => {
                setDeviceRole('remote');
                deviceSync.setDeviceType('remote');
              }}
              className="px-3 py-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold border border-zinc-700/60 backdrop-blur-md flex items-center gap-1.5 transition"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              Cambiar a Modo Celular
            </button>
          </div>
        </div>
      ) : isPlayingLocally && activeMedia && activeHub === 'cinecast' ? (
        /* 9. Reproductor a pantalla completa sobre todo con las props de App.tsx L1158-1188 */
        <VideoPlayer
          key={`${activeMedia.id}_s${activeEpisode?.seasonNumber || 1}_e${activeEpisode?.episodeNumber || 1}`}
          media={activeMedia}
          episode={activeEpisode}
          audioSettings={audioSettings}
          playbackSettings={playbackSettings}
          remoteCommandTrigger={lastRemoteCommand}
          initialTime={playerInitialTime}
          onUpdateAudio={(newSettings) => {
            setAudioSettings((prev) => ({ ...prev, ...newSettings }));
            deviceSync.broadcastPlaybackState({
              ...remotePlaybackState,
              audioSettings: { ...audioSettings, ...newSettings },
            });
          }}
          onClose={() => {
            setIsPlayingLocally(false);
            setIsScreenInStandby(false);
            setActiveMedia(null);
            setActiveEpisode(null);
            refreshContinueWatching();
          }}
          onNextEpisode={handlePlayNextEpisode}
          onPrevEpisode={handlePlayPrevEpisode}
          hasNextEpisode={true}
          onBroadcastState={handleBroadcastPlayerState}
          remoteCommandNotification={remoteNotification}
          onOpenAudioSettings={() => setIsAudioModalOpen(true)}
        />
      ) : (
        <AppShell
          extraBottomPadding={deviceRole === 'remote'}
          hasMiniRemote={deviceRole === 'remote' && location.pathname !== '/control'}
          onOpenControl={() => setIsRemoteSheetOpen((p) => !p)}
          isControlOpen={isRemoteSheetOpen}
          bottomSlot={
            deviceRole === 'remote' ? (
              <>
                <div className="hidden md:block">
                  <RemoteControlDrawer
                    playbackState={remotePlaybackState}
                    currentMedia={remoteMediaItem}
                    currentEpisode={remoteEpisodeItem}
                    connectedScreenName={connectedScreenName}
                    onSendCommand={sendRemoteCommand}
                    onOpenAudioModal={() => setIsAudioModalOpen(true)}
                    onOpenCastModal={() => navigate('/pantallas')}
                    onOpenGuestModal={() => setIsGuestModalOpen(true)}
                  />
                </div>
                {location.pathname !== '/control' && (
                  <MiniRemote
                    connectedScreenName={connectedScreenName}
                    playbackState={remotePlaybackState}
                    currentMedia={remoteMediaItem}
                    onSendCommand={sendRemoteCommand}
                    onNavigateToControl={() => setIsRemoteSheetOpen(true)}
                    onNavigateToSettings={() => navigate('/ajustes')}
                  />
                )}
              </>
            ) : undefined
          }
        >
          <Routes>
            <Route
              path="/"
              element={
                <HomeView
                  onSelectItem={handleSelectCard}
                  onPlayItem={handlePlayCard}
                  onCastItem={handleCastCard}
                />
              }
            />
            <Route
              path="/explorar"
              element={
                <ExploreView
                  onSelectItem={handleSelectCard}
                  onPlayItem={handlePlayCard}
                  onCastItem={handleCastCard}
                />
              }
            />
            <Route
              path="/buscar"
              element={
                <SearchView
                  onSelectItem={handleSelectCard}
                  onPlayItem={handlePlayCard}
                  onCastItem={handleCastCard}
                />
              }
            />
            <Route
              path="/lista"
              element={
                <MyListView
                  onSelectItem={handleSelectCard}
                  onPlayItem={handlePlayCard}
                  onCastItem={handleCastCard}
                />
              }
            />
            <Route path="/titulo/:type/:id" element={<TitleDetailRouteView />} />
            <Route
              path="/deportes"
              element={
                <div className="p-4 sm:p-8">
                  <SportsMatchesTab
                    onPlayChannel={(mediaItem) => handlePlayLocal(mediaItem)}
                    onCastChannel={(mediaItem) => handleCastMediaToScreen(mediaItem)}
                  />
                </div>
              }
            />
            <Route
              path="/canales"
              element={
                <div className="p-4 sm:p-8">
                  <SportsLiveGrid
                    onPlayChannel={(mediaItem) => handlePlayLocal(mediaItem)}
                    onCastChannel={(mediaItem) => handleCastMediaToScreen(mediaItem)}
                    connectedScreenName={connectedScreenName}
                  />
                </div>
              }
            />
            <Route path="/musica" element={<SpotifyView />} />
            <Route path="/youtube" element={<YouTubeView />} />
            <Route
              path="/ajustes"
              element={<SettingsView onSwitchToClassic={onSwitchToClassic} />}
            />
            <Route path="/control" element={<ControlView />} />
            <Route path="/pantallas" element={<ScreensManagerView />} />
          </Routes>
        </AppShell>
      )}

      {/* Panel superpuesto de Control Remoto (en móvil sheet 92%, en escritorio columna derecha) */}
      <RemoteSheet
        isOpen={isRemoteSheetOpen}
        onClose={() => setIsRemoteSheetOpen(false)}
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        connectedScreenName={connectedScreenName}
        onSendCommand={sendRemoteCommand}
        onOpenCastModal={() => navigate('/pantallas')}
        onOpenAudioModal={() => setIsAudioModalOpen(true)}
        onOpenGuestModal={() => setIsGuestModalOpen(true)}
        onNavigateToCatalog={() => navigate('/explorar')}
      />

      {/* Modales clásicos con las mismas props de App.tsx L1675-1746 */}
      <AudioSettingsModal
        isOpen={isAudioModalOpen}
        onClose={() => setIsAudioModalOpen(false)}
        audioSettings={audioSettings}
        playbackSettings={playbackSettings}
        onUpdateAudio={(newAudio: Partial<AudioSettings>) => {
          setAudioSettings((prev) => ({ ...prev, ...newAudio }));
          sendRemoteCommand({
            action: 'setAudioSettings',
            payload: newAudio,
          });
        }}
        onUpdatePlayback={(newPlayback: Partial<PlaybackSettings>) => {
          setPlaybackSettings((prev) => ({ ...prev, ...newPlayback }));
          sendRemoteCommand({
            action: 'setPlaybackSettings',
            payload: newPlayback,
          });
        }}
      />

      <GuestShareModal
        isOpen={isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        roomId={roomId}
        screenName={connectedScreenName}
      />
    </>
  );
};

export const NewApp: React.FC<NewAppProps> = ({ onDisableV2 }) => {
  const handleSwitchToClassic = useCallback(() => {
    try {
      localStorage.setItem('cinecast_ui_v2', '0');
    } catch (_) {}
    if (onDisableV2) {
      onDisableV2();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('ui', 'clasico');
    window.location.href = url.toString();
  }, [onDisableV2]);

  return (
    <HashRouter>
      <AppRuntimeProvider>
        <NewAppContent onSwitchToClassic={handleSwitchToClassic} />
      </AppRuntimeProvider>
    </HashRouter>
  );
};
export default NewApp;
