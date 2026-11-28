import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
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
  RefreshCw,
  Clock,
} from 'lucide-react';
import { ConnectionDiagnosticSection } from './ConnectionDiagnosticSection';
import { localCatalogProvider, CatalogProviderError } from '../providers/localCatalogProvider';
import type { CardItem, CatalogSortOption, GenreCountItem, HomeRow } from '../providers/types';
import { watchHistoryService } from '../services/watchHistoryService';
import { deviceSync } from '../services/deviceSync';
import { diagnosticService } from '../services/diagnosticService';
import { MEDIA_CATALOG } from '../data/catalog';
const DetailModal = React.lazy(() => import('../components/DetailModal').then((m) => ({ default: m.DetailModal })));
const VideoPlayer = React.lazy(() => import('../components/VideoPlayer').then((m) => ({ default: m.VideoPlayer })));
const AmbientScreen = React.lazy(() => import('../components/AmbientScreen').then((m) => ({ default: m.AmbientScreen })));
import { RemoteControlDrawer } from '../components/RemoteControlDrawer';
import { RemoteControlSheet } from '../components/RemoteControlSheet';
const AudioSettingsModal = React.lazy(() => import('../components/AudioSettingsModal').then((m) => ({ default: m.AudioSettingsModal })));
const GuestShareModal = React.lazy(() => import('../components/GuestShareModal').then((m) => ({ default: m.GuestShareModal })));
import { ContinueRow } from './ContinueRow';
import { MiniRemote } from './MiniRemote';
import { RemotePanel } from './RemotePanel';
const ScreensManagerView = React.lazy(() => import('./ScreensManagerView').then((m) => ({ default: m.ScreensManagerView })));
const SportsMatchesTab = React.lazy(() => import('../components/SportsMatchesTab').then((m) => ({ default: m.SportsMatchesTab })));
const SportsLiveGrid = React.lazy(() => import('../components/SportsLiveGrid').then((m) => ({ default: m.SportsLiveGrid })));
const SpotifyHub = React.lazy(() => import('../components/SpotifyHub').then((m) => ({ default: m.SpotifyHub })));
import { SpotifyDevice, SpotifySettingsSection } from './SpotifyDevice';
import { BackendServerSettings } from './BackendServerSettings';
import { BrokenReportsPanel } from './BrokenReportsPanel';
const YouTubeHub = React.lazy(() => import('../components/YouTubeHub').then((m) => ({ default: m.YouTubeHub })));
import { SPOTIFY_TRACKS } from '../data/spotifyCatalog';
import { YOUTUBE_VIDEOS } from '../data/youtubeCatalog';
import { AppRuntimeProvider, useAppRuntime, type HubType } from '../app/AppRuntime';
import { toMediaItem } from '../app/toMediaItem';
import type { AudioSettings, MediaItem, PlaybackSettings } from '../types';
import { AppShell } from './AppShell';
import { Hero } from './Hero';
import { Row } from './Row';
import { TitleCard } from './TitleCard';
import { Switch } from './Switch';
import { FilterBar, type FilterState } from './FilterBar';
import { GridSkeleton, HeroSkeleton } from './Skeleton';
import { useLiteMode, type LiteModePreference } from './liteMode';
import { RemoteSheet } from './RemoteSheet';
import { getTabMemory, saveTabMemory } from './navigationMemory';
import { saveScrollSnapshot } from './useScrollRestoration';

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let homeRowsCache: { rows: HomeRow[]; heroSynopsis: string; ts: number } | null = null;
const exploreViewCache = new Map<
  string,
  {
    items: CardItem[];
    total: number;
    page: number;
    totalPages: number;
    facetGenres: GenreCountItem[];
    ts: number;
  }
>();
const searchViewCache = new Map<string, { results: CardItem[]; ts: number }>();

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
  const cleanId = String(item.id || '').replace(/_s\d+_e\d+$/, '');
  return `/titulo/${encodeURIComponent(typeSeg)}/${encodeURIComponent(cleanId)}`;
}

interface HomeViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem?: ((item: CardItem) => void) | undefined;
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
  const hasFreshHomeCache = Boolean(
    homeRowsCache && Date.now() - homeRowsCache.ts < CATALOG_CACHE_TTL_MS && homeRowsCache.rows.length > 0
  );
  const [rows, setRows] = useState<HomeRow[]>(() => (hasFreshHomeCache ? homeRowsCache!.rows : []));
  const [heroSynopsis, setHeroSynopsis] = useState<string>(() =>
    hasFreshHomeCache ? homeRowsCache!.heroSynopsis : ''
  );
  const [loading, setLoading] = useState<boolean>(() => !hasFreshHomeCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached =
      homeRowsCache && Date.now() - homeRowsCache.ts < CATALOG_CACHE_TTL_MS && homeRowsCache.rows.length > 0
        ? homeRowsCache
        : null;
    if (!cached) {
      setLoading(true);
    }
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
        homeRowsCache = {
          rows: res.rows,
          heroSynopsis: homeRowsCache?.heroSynopsis || '',
          ts: Date.now(),
        };
      })
      .catch((err: unknown) => {
        if (cancelled || cached) return;
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
          if (homeRowsCache) {
            homeRowsCache = { ...homeRowsCache, heroSynopsis: d.overview };
          }
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
      {/* Barra visible de navegación principal por categorías del catálogo */}
      <nav
        aria-label="Categorías del catálogo"
        data-testid="catalog-category-nav"
        className="px-4 sm:px-8 pb-2 flex items-center gap-2 overflow-x-auto no-scrollbar"
      >
        <button
          type="button"
          onClick={() => navigate('/explorar')}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white whitespace-nowrap transition shrink-0"
        >
          Todo el catálogo
        </button>
        <button
          type="button"
          onClick={() => navigate('/explorar?category=movie&type=movie')}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white whitespace-nowrap transition shrink-0"
        >
          Películas
        </button>
        <button
          type="button"
          onClick={() => navigate('/explorar?category=series&type=series')}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white whitespace-nowrap transition shrink-0"
        >
          Series
        </button>
        <button
          type="button"
          onClick={() => navigate('/explorar?category=anime&type=anime')}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white whitespace-nowrap transition shrink-0"
        >
          Anime
        </button>
        <button
          type="button"
          data-testid="catalog-nav-sports"
          onClick={() => navigate('/canales')}
          className="px-3.5 py-2 rounded-xl bg-red-950/70 hover:bg-red-600 border border-red-500/40 text-xs font-extrabold text-red-200 hover:text-white whitespace-nowrap flex items-center gap-1.5 transition shadow-sm shrink-0"
        >
          <Tv className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>Deportes / TV en vivo</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      </nav>

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
          onCast={onCastItem ? (media, episode, initialTime) => {
            handleCastMediaToScreen(media, episode || undefined, initialTime);
          } : undefined}
          onOpenDetail={(media) => {
            saveScrollSnapshot('/inicio', '/inicio', window.scrollY);
            navigate(buildTitleRoute(media));
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
            aria-label="Abrir Deportes"
            onClick={() => {
              // Navegar a Deportes en este dispositivo sin cortar lo que se reproduce en la TV/PC
              navigate('/deportes');
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition border border-zinc-700/80 shadow"
          >
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Deportes</span>
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
  onCastItem?: ((item: CardItem) => void) | undefined;
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
  const navigate = useNavigate();

  // Sincronizar cambios en los filtros con los parámetros de la URL usando replace: true
  const updateFilters = useCallback(
    (next: FilterState) => {
      if (next.category === 'live_tv') {
        navigate('/canales');
        return;
      }
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
    [navigate, setSearchParams]
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

  const filterCacheKey = useMemo(
    () =>
      [
        filters.category || 'all',
        filters.genres.join(','),
        filters.genreMode || 'all',
        filters.yearFrom ?? '',
        filters.yearTo ?? '',
        filters.minRating ?? 0,
        filters.sort || 'default',
      ].join('|'),
    [filters]
  );

  const initialCachedExplore = useMemo(() => {
    const c = exploreViewCache.get(filterCacheKey);
    if (c && Date.now() - c.ts < CATALOG_CACHE_TTL_MS && c.items.length > 0) {
      return c;
    }
    return null;
  }, [filterCacheKey]);

  const [items, setItems] = useState<CardItem[]>(() => initialCachedExplore?.items ?? []);
  const [total, setTotal] = useState<number>(() => initialCachedExplore?.total ?? 0);
  const [page, setPage] = useState<number>(() => initialCachedExplore?.page ?? 1);
  const [totalPages, setTotalPages] = useState<number>(() => initialCachedExplore?.totalPages ?? 1);
  const [facetGenres, setFacetGenres] = useState<GenreCountItem[]>(
    () => initialCachedExplore?.facetGenres ?? []
  );
  const [loadingInitial, setLoadingInitial] = useState<boolean>(() => !initialCachedExplore);
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
    const cached = exploreViewCache.get(filterCacheKey);
    if (cached && Date.now() - cached.ts < CATALOG_CACHE_TTL_MS && cached.items.length > 0) {
      setItems(cached.items);
      setTotal(cached.total);
      setPage(cached.page);
      setTotalPages(cached.totalPages);
      setFacetGenres(cached.facetGenres);
      setLoadingInitial(false);
      return;
    }

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
        const firstItems = res.items.slice(0, MAX_EXPLORE_ITEMS);
        const list: GenreCountItem[] =
          res.facets && res.facets.genres
            ? Object.entries(res.facets.genres)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
            : [];
        setItems(firstItems);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setFacetGenres(list);
        exploreViewCache.set(filterCacheKey, {
          items: firstItems,
          total: res.total,
          page: 1,
          totalPages: res.totalPages,
          facetGenres: list,
          ts: Date.now(),
        });
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
  }, [buildQueryParams, filterCacheKey]);

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
          const merged = [...prev, ...fresh].slice(0, MAX_EXPLORE_ITEMS);
          exploreViewCache.set(filterCacheKey, {
            items: merged,
            total: res.total || total,
            page: nextPage,
            totalPages: res.totalPages || totalPages,
            facetGenres,
            ts: Date.now(),
          });
          return merged;
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
  }, [buildQueryParams, facetGenres, filterCacheKey, items.length, loadingInitial, page, total, totalPages]);

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
  onCastItem?: ((item: CardItem) => void) | undefined;
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

    const cached = searchViewCache.get(debouncedQuery);
    if (cached && Date.now() - cached.ts < CATALOG_CACHE_TTL_MS) {
      setResults(cached.results);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    localCatalogProvider
      .search(debouncedQuery)
      .then((res) => {
        if (!cancelled) {
          setResults(res);
          searchViewCache.set(debouncedQuery, { results: res, ts: Date.now() });
        }
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
  onCastItem?: ((item: CardItem) => void) | undefined;
}

function isRecordObj(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const MyListView: React.FC<MyListViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const {
    myListIds,
    myListItems,
    toggleMyList,
    connectedScreenName,
    triggerNotification,
    continueWatchingList,
    handlePlayLocal,
    handleCastMediaToScreen,
    refreshContinueWatching,
  } = useAppRuntime();
  const [items, setItems] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    if (myListIds.length === 0 && myListItems.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // 1. Construir primero desde los snapshots guardados (funciona offline y para títulos de búsqueda/TMDB)
    const snapshotCards: CardItem[] = [];
    const missingIds: string[] = [];
    const seenIds = new Set<string>();

    for (const snap of myListItems) {
      if (!snap || !snap.id) continue;
      const id = String(snap.id);
      if (seenIds.has(id)) continue;
      if (snap.posterUrl || (snap.title && snap.title !== id)) {
        seenIds.add(id);
        snapshotCards.push({
          id,
          tmdbId: Number(snap.tmdbId || 0) || 0,
          title: snap.title || snap.titleEs || snap.originalTitle || id,
          titleEs: snap.titleEs,
          originalTitle: snap.originalTitle,
          posterUrl: snap.posterUrl || '',
          backdropUrl: snap.backdropUrl || snap.posterUrl || '',
          year: Number(snap.year || 2024) || 2024,
          rating: Number(snap.rating || 7.5) || 7.5,
          genres: Array.isArray(snap.genres) ? snap.genres : [],
          category: snap.category || snap.type || 'movie',
          type: snap.type || snap.category || 'movie',
          quality: snap.quality || '1080p',
          upcoming: Boolean(snap.upcoming),
        });
      } else {
        missingIds.push(id);
      }
    }

    for (const id of myListIds) {
      if (!seenIds.has(id) && !missingIds.includes(id)) {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) {
      setItems(snapshotCards);
      setLoading(false);
      return;
    }

    setLoading(snapshotCards.length === 0);
    setItems(snapshotCards);
    const base = deviceSync.getApiBase();
    const url = `${base}/api/catalog?ids=${encodeURIComponent(missingIds.join(','))}&fields=card`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((raw: unknown) => {
        if (cancelled) return;
        const merged: CardItem[] = [...snapshotCards];
        const foundIds = new Set(merged.map((i) => i.id));
        if (isRecordObj(raw) && Array.isArray(raw.items)) {
          for (const entry of raw.items) {
            if (!isRecordObj(entry)) continue;
            const entryId = typeof entry.id === 'string' ? entry.id : '';
            if (!entryId || foundIds.has(entryId)) continue;
            foundIds.add(entryId);
            const safeTitleEs = typeof entry.titleEs === 'string' ? entry.titleEs.trim() : undefined;
            const safeOrigTitle = typeof entry.originalTitle === 'string' ? entry.originalTitle.trim() : undefined;
            const rawTitle = typeof entry.title === 'string' ? entry.title.trim() : '';
            const safeTitle =
              rawTitle && rawTitle.toLowerCase() !== 'sin título'
                ? rawTitle
                : safeTitleEs || safeOrigTitle || '';
            merged.push({
              id: entryId,
              tmdbId: typeof entry.tmdbId === 'number' ? entry.tmdbId : Number(entry.tmdbId) || 0,
              title: safeTitle,
              titleEs: safeTitleEs,
              originalTitle: safeOrigTitle,
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

        // Complementar con MEDIA_CATALOG local para IDs tipo slug
        for (const id of missingIds) {
          if (foundIds.has(id)) continue;
          const localMatch = MEDIA_CATALOG.find(
            (m) => m.id === id || String(m.tmdbId) === id
          );
          if (localMatch && !foundIds.has(localMatch.id)) {
            foundIds.add(localMatch.id);
            merged.push({
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

        setItems(merged);
      })
      .catch(() => {
        if (!cancelled) setItems(snapshotCards);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [myListIds, myListItems]);

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Historial reciente / Seguir viendo (sincronizado con PC) */}
      {continueWatchingList.length > 0 && (
        <div className="pb-2 border-b border-zinc-900">
          <ContinueRow
            items={continueWatchingList}
            onPlay={(media, episode, initialTime) => {
              handlePlayLocal(media, episode, initialTime);
            }}
            onCast={onCastItem ? (media, episode, initialTime) => {
              handleCastMediaToScreen(media, episode || undefined, initialTime);
            } : undefined}
            onOpenDetail={(media) => {
              navigate(buildTitleRoute(media));
            }}
            onRemove={(id) => {
              watchHistoryService.remove(id);
              refreshContinueWatching();
              triggerNotification('Quitado del historial');
            }}
          />
        </div>
      )}

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
    triggerNotification,
    connectedScreenName,
  } = useAppRuntime();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // 1. Buscar coincidencia rápida en MEDIA_CATALOG o consultar servidor (respetando movie vs series)
    const wantSeries = type === 'series' || type === 'anime' || type === 'tv';
    const localFound =
      MEDIA_CATALOG.find((m) => m.id === id) ||
      MEDIA_CATALOG.find((m) => {
        if (String(m.tmdbId) !== id) return false;
        const mSeries = m.type !== 'movie' && (m.category === 'series' || m.category === 'anime' || m.type === 'series');
        return mSeries === wantSeries;
      });

    const loadMedia = async () => {
      try {
        // Consultar /api/catalog?ids= para obtener CardItem real del catálogo de 10.119 títulos
        const base = deviceSync.getApiBase();
        const candidateIds = id.startsWith('tmdb-')
          ? [id]
          : type === 'anime'
            ? [`tmdb-anime-${id}`, `tmdb-series-${id}`]
            : wantSeries
              ? [`tmdb-series-${id}`, `tmdb-anime-${id}`]
              : [`tmdb-movie-${id}`, `tmdb-anime-${id}`];
        const idsToFetch = candidateIds.map((c) => encodeURIComponent(c)).join(',');
        const catRes = await fetch(
          `${base}/api/catalog?ids=${idsToFetch}&fields=card`
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
              titleEs: typeof raw.titleEs === 'string' ? raw.titleEs : undefined,
              originalTitle: typeof raw.originalTitle === 'string' ? raw.originalTitle : undefined,
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
        handlePlayLocal(m, enrichedEp, 0, false);
      }}
      onCastToScreen={
        connectedScreenName &&
        connectedScreenName !== 'Sin pantalla' &&
        connectedScreenName !== 'Ninguna' &&
        (typeof localStorage === 'undefined' || localStorage.getItem('cinecast_mobile_play_target') === 'pc')
          ? (m, ep) => {
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
            }
          : undefined
      }
      isMyList={Boolean(media && (myListIds.includes(media.id) || (media.tmdbId && myListIds.includes(String(media.tmdbId)))))}
      onToggleMyList={(mediaId) => {
        const adding = !myListIds.includes(mediaId);
        toggleMyList(mediaId, media);
        triggerNotification(adding ? `Guardado en Mi lista: ${media?.title || ''}` : `Quitado de Mi lista`);
      }}
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
    isScreenReconnecting,
    sendRemoteCommand,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
  } = useAppRuntime();

  return (
    <div className="p-2 sm:p-6 pb-40 max-w-xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-extrabold text-white mb-1 px-2">Control Remoto</h1>
      <p className="text-xs text-zinc-400 mb-4 px-2">
        Controlando pantalla:{' '}
        <strong className={`transition-colors ${isScreenReconnecting ? 'text-amber-400' : 'text-zinc-200'}`}>
          {connectedScreenName} {isScreenReconnecting && '(Reconectando...)'}
        </strong>
      </p>
      <RemotePanel
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        connectedScreenName={connectedScreenName}
        isScreenReconnecting={isScreenReconnecting}
        onSendCommand={sendRemoteCommand}
        onOpenAudioModal={() => setIsAudioModalOpen(true)}
        onOpenCastModal={() => navigate('/pantallas')}
        onOpenGuestModal={() => setIsGuestModalOpen(true)}
        onNavigateToCatalog={() => navigate('/explorar')}
        onNavigateToPartidos={() => navigate('/deportes')}
      />
    </div>
  );
};

interface SettingsViewProps {
  onSwitchToClassic?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onSwitchToClassic }) => {
  const navigate = useNavigate();
  const {
    roomId,
    connectedScreenName,
    devices,
    deviceRole,
    setDeviceRole,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
    triggerNotification,
  } = useAppRuntime();

  const [isRepairingHistory, setIsRepairingHistory] = useState(false);

  const handleRepairHistory = async () => {
    setIsRepairingHistory(true);
    try {
      const base = deviceSync.getApiBase();
      const res = await fetch(`${base}/api/repair-history`, { method: 'POST' });
      const data = await res.json();
      if (data && data.ok) {
        triggerNotification(`Historial reparado: ${data.duplicatesRemoved || 0} duplicados eliminados`);
      } else {
        triggerNotification('No se pudo reparar el historial');
      }
    } catch {
      triggerNotification('Error de conexión al reparar historial');
    } finally {
      setIsRepairingHistory(false);
    }
  };

  const { isLite, preference: litePref, urlForced: liteUrlForced, setPreference: setLitePref } =
    useLiteMode();
  const [diagEnabled, setDiagEnabled] = useState<boolean>(() => diagnosticService.isEnabled());
  const [localIp, setLocalIp] = useState<string>('127.0.0.1');
  const [port, setPort] = useState<number>(3000);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [tmdbKeyInput, setTmdbKeyInput] = useState<string>('');
  const [tmdbKeyMasked, setTmdbKeyMasked] = useState<string>('');
  const [tmdbKeyStatus, setTmdbKeyStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isTestingTmdbKey, setIsTestingTmdbKey] = useState<boolean>(false);
  const [isSavingTmdbKey, setIsSavingTmdbKey] = useState<boolean>(false);
  const [compatMode, setCompatMode] = useState<boolean>(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getCompatibilityMode) {
      api.getCompatibilityMode().then((res: any) => {
        if (typeof res?.enabled === 'boolean') setCompatMode(res.enabled);
      }).catch(() => {});
    }
    if (api?.onCompatibilityModeChanged) {
      return api.onCompatibilityModeChanged((val: boolean) => setCompatMode(Boolean(val)));
    }
  }, []);

  const handleToggleCompatMode = async () => {
    const next = !compatMode;
    setCompatMode(next);
    try {
      const res = await (window as any).electronAPI?.setCompatibilityMode?.(next);
      if (typeof res?.enabled === 'boolean') setCompatMode(res.enabled);
    } catch (_) {}
  };

  useEffect(() => {
    fetch('/api/config/tmdb-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.masked) {
          setTmdbKeyMasked(d.masked);
        }
      })
      .catch(() => {});
  }, []);

  const handleTestTmdbKey = async () => {
    const key = tmdbKeyInput.trim();
    if (!key) {
      setTmdbKeyStatus({ ok: false, msg: 'Ingresá una clave de TMDB para probar.' });
      return;
    }
    setIsTestingTmdbKey(true);
    setTmdbKeyStatus(null);
    try {
      const isBearer = key.startsWith('eyJ') && key.length > 40;
      const url = isBearer
        ? 'https://api.themoviedb.org/3/configuration'
        : `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (isBearer) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.images) {
          setTmdbKeyStatus({ ok: true, msg: '✓ Clave de TMDB válida (conexión verificada).' });
        } else {
          setTmdbKeyStatus({ ok: false, msg: '✗ Respuesta inesperada de TMDB.' });
        }
      } else {
        setTmdbKeyStatus({ ok: false, msg: `✗ Clave inválida (HTTP ${res.status}).` });
      }
    } catch (_) {
      setTmdbKeyStatus({ ok: false, msg: '✗ No se pudo conectar con api.themoviedb.org.' });
    }
    setIsTestingTmdbKey(false);
  };

  const handleSaveTmdbKey = async () => {
    const key = tmdbKeyInput.trim();
    setIsSavingTmdbKey(true);
    setTmdbKeyStatus(null);
    try {
      const res = await fetch('/api/config/tmdb-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setTmdbKeyMasked(data.masked || '');
        setTmdbKeyInput('');
        setTmdbKeyStatus({
          ok: true,
          msg: key ? `✓ Clave guardada (${data.masked}).` : '✓ Clave personalizada eliminada (usando valor por defecto).',
        });
      } else {
        setTmdbKeyStatus({
          ok: false,
          msg: data?.error || `✗ Error al guardar clave (HTTP ${res.status}).`,
        });
      }
    } catch (_) {
      setTmdbKeyStatus({ ok: false, msg: '✗ Error de red al guardar la clave.' });
    }
    setIsSavingTmdbKey(false);
  };

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
        <Switch
          checked={diagEnabled}
          ariaLabel="Alternar Modo diagnóstico"
          onChange={handleToggleDiag}
        />
      </div>

      {/* PARTE 4 (Paso 12): Modo compatibilidad (Reproductor) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Reproductor: Modo compatibilidad</div>
            <div className="text-xs text-amber-300/90">
              Desactiva el sandbox del reproductor embebido y permite contenido mixto (menor aislamiento de seguridad; aplica a los reproductores que se abran después).
            </div>
          </div>
        </div>
        <Switch
          checked={compatMode}
          ariaLabel="Alternar Modo compatibilidad"
          onChange={handleToggleCompatMode}
        />
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

      {/* Mantenimiento del historial */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <RefreshCw className={`w-5 h-5 ${isRepairingHistory ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Mantenimiento del historial</div>
            <div className="text-xs text-zinc-400">
              Deduplica series repetidas, preserva el último capítulo y limpia carátulas inválidas.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRepairHistory}
          disabled={isRepairingHistory}
          className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border border-blue-500/50 bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 transition disabled:opacity-50 shrink-0"
        >
          {isRepairingHistory ? 'Reparando...' : 'Reparar historial'}
        </button>
      </div>

      {/* PARTE 4 (Paso 10): Clave de TMDB configurable */}
      <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-white">Clave de TMDB</div>
            <div className="text-xs text-zinc-400">
              Personalizá tu API Key de The Movie Database (guardada en userData/cinecast-config.json).
              {tmdbKeyMasked ? ` Actual: ${tmdbKeyMasked}` : ' Usando clave por defecto.'}
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <input
            type="password"
            value={tmdbKeyInput}
            onChange={(e) => setTmdbKeyInput(e.target.value)}
            placeholder={tmdbKeyMasked ? `Guardada: ${tmdbKeyMasked}` : 'Ingresar clave de TMDB...'}
            aria-label="Clave de TMDB"
            autoComplete="off"
            className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 font-mono focus:outline-none focus:border-emerald-500"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestTmdbKey}
              disabled={isTestingTmdbKey}
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition disabled:opacity-50"
            >
              {isTestingTmdbKey ? 'Probando...' : 'Probar'}
            </button>
            <button
              type="button"
              onClick={handleSaveTmdbKey}
              disabled={isSavingTmdbKey}
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
            >
              {isSavingTmdbKey ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
        {tmdbKeyStatus && (
          <div
            className={`text-xs font-semibold ${
              tmdbKeyStatus.ok ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {tmdbKeyStatus.msg}
          </div>
        )}
      </div>

      {/* Modo del dispositivo (Independiente / Control Remoto / TV) y Servidor Híbrido */}
      <BackendServerSettings deviceRole={deviceRole} setDeviceRole={setDeviceRole} />

      {/* Gestión de reportes de canales, películas, series y anime caídos */}
      <BrokenReportsPanel />

      {/* Sección Spotify (dispositivo CineCast) */}
      <SpotifySettingsSection isScreen={deviceRole === 'screen' || deviceRole === 'hybrid'} />

      {/* Diagnóstico de conexión */}
      <ConnectionDiagnosticSection />

      {/* Volver a la vista clásica (si está habilitado) */}
      {onSwitchToClassic && (
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
      )}
    </div>
  );
};

const HubRouteSynchronizer: React.FC = () => {
  const { activeHub, setActiveHub } = useAppRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const prevHubRef = useRef<HubType>(activeHub);
  const prevPathRef = useRef<string>('');
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
    setDeviceRole,
    connectedScreenName,
    activeSpotifyTrack,
    setActiveSpotifyTrack,
    isSpotifyPlaying,
    setIsSpotifyPlaying,
    audioSettings,
    sendRemoteCommand,
    triggerNotification,
  } = useAppRuntime();

  const [activeTab, setActiveTab] = useState<'device' | 'webplayer'>('device');

  return (
    <div className="w-full flex flex-col h-full">
      {/* Selector de modo: Dispositivo CineCast vs Web Player */}
      <div className="flex items-center justify-center gap-2 p-2 bg-zinc-950/80 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('device')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'device'
              ? 'bg-emerald-600 text-white shadow'
              : 'bg-zinc-900 text-zinc-400 hover:text-white'
          }`}
        >
          <span>Spotify Connect</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('webplayer')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'webplayer'
              ? 'bg-emerald-600 text-white shadow'
              : 'bg-zinc-900 text-zinc-400 hover:text-white'
          }`}
        >
          <span>Web Player Oficial</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'device' ? (
          <SpotifyDevice deviceName="CineCast TV" />
        ) : (
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
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('cinecast:spotify-next', {
                    detail: { origin: 'SpotifyView.onNextTrack' },
                  })
                );
              }
            }}
            onPrevTrack={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('cinecast:spotify-prev', {
                    detail: { origin: 'SpotifyView.onPrevTrack' },
                  })
                );
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
          />
        )}
      </div>
    </div>
  );
};

const YouTubeView: React.FC = () => {
  const {
    deviceRole,
    setDeviceRole,
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
  onSwitchToClassic?: () => void;
}

const NewAppContent: React.FC<NewAppContentProps> = ({ onSwitchToClassic }) => {
  useLiteMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRemoteSheetOpen, setIsRemoteSheetOpen] = useState<boolean>(false);
  const [preferLocalPlay, setPreferLocalPlay] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cinecast_mobile_play_target');
      if (saved === 'pc') return false;
      if (saved === 'local') return true;
      localStorage.setItem('cinecast_mobile_play_target', 'local');
      return true;
    } catch {
      return true;
    }
  });
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
    hasConnectedRemote,
    connectedScreenName,
    isScreenReconnecting,
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
    advanceToSameSeriesEpisode,
    handleBroadcastPlayerState,
    sendRemoteCommand,
    refreshContinueWatching,
    myListIds,
    toggleMyList,
    triggerNotification,
    isAudioModalOpen,
    setIsAudioModalOpen,
    isGuestModalOpen,
    setIsGuestModalOpen,
    areYouStillThere,
    areYouStillThereCause,
    countdownRemaining,
    handleConfirmActiveWatching,
    notifyUserActivity,
    handleBeforeAutoAdvance,
  } = useAppRuntime();

  const [playerDetailMedia, setPlayerDetailMedia] = useState<MediaItem | null>(null);
  const savedScrollBeforePlayerRef = useRef<number>(0);
  const prevPlayerVisibleRef = useRef<boolean>(false);
  const isLocalPlayerVisible = Boolean(
    isPlayingLocally && activeMedia && (activeHub === 'cinecast' || activeHub === 'sports')
  );

  useEffect(() => {
    if (isLocalPlayerVisible && !prevPlayerVisibleRef.current) {
      savedScrollBeforePlayerRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
    } else if (!isLocalPlayerVisible && prevPlayerVisibleRef.current) {
      const targetY = savedScrollBeforePlayerRef.current;
      requestAnimationFrame(() => {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
      });
    }
    prevPlayerVisibleRef.current = isLocalPlayerVisible;
  }, [isLocalPlayerVisible]);

  const hasConnectedScreen = Boolean(
    connectedScreenName &&
      connectedScreenName.trim() !== '' &&
      connectedScreenName !== 'Sin pantalla' &&
      connectedScreenName !== 'Ninguna'
  );

  const togglePlayTarget = () => {
    setPreferLocalPlay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinecast_mobile_play_target', next ? 'local' : 'pc');
      } catch (_) {}
      if (!next && !hasConnectedScreen) {
        triggerNotification('⚠️ No hay ninguna pantalla conectada. Vinculá tu TV/PC en Pantallas.');
      }
      return next;
    });
  };

  // Manejar botón físico / gesto Atrás en Android APK sin cerrar la app inesperadamente
  useEffect(() => {
    (window as any).__cinecastHandleBack = (): boolean => {
      if (playerDetailMedia) {
        setPlayerDetailMedia(null);
        return true;
      }
      if (isPlayingLocally && activeMedia) {
        setPlayerDetailMedia(null);
        setIsPlayingLocally(false);
        setIsScreenInStandby(false);
        setActiveMedia(null);
        setActiveEpisode(null);
        refreshContinueWatching();
        return true;
      }
      if (isRemoteSheetOpen) {
        setIsRemoteSheetOpen(false);
        return true;
      }
      if (isAudioModalOpen) {
        setIsAudioModalOpen(false);
        return true;
      }
      if (isGuestModalOpen) {
        setIsGuestModalOpen(false);
        return true;
      }
      if (location.pathname !== '/') {
        navigate(-1);
        return true;
      }
      return false;
    };
    return () => {
      delete (window as any).__cinecastHandleBack;
    };
  }, [
    playerDetailMedia,
    isPlayingLocally,
    activeMedia,
    isRemoteSheetOpen,
    isAudioModalOpen,
    isGuestModalOpen,
    location.pathname,
    navigate,
    setIsPlayingLocally,
    setIsScreenInStandby,
    setActiveMedia,
    setActiveEpisode,
    refreshContinueWatching,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
  ]);

  useEffect(() => {
    if (!isPlayingLocally) {
      setPlayerDetailMedia(null);
    }
  }, [isPlayingLocally]);

  useEffect(() => {
    if (!playerDetailMedia) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPlayerDetailMedia(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [playerDetailMedia]);

  const handleSelectCard = useCallback(
    (card: CardItem) => {
      saveScrollSnapshot(`${location.pathname}${location.search}`, location.pathname, window.scrollY);
      navigate(buildTitleRoute(card));
    },
    [location.pathname, location.search, navigate]
  );

  const handlePlayCard = useCallback(
    (card: CardItem) => {
      saveScrollSnapshot(`${location.pathname}${location.search}`, location.pathname, window.scrollY);
      const item = toMediaItem(card);
      handlePlayLocal(item);
    },
    [handlePlayLocal, location.pathname, location.search]
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
        <div className="relative" data-testid="screen-standby-view">
          <Suspense fallback={<div className="w-full h-screen bg-black flex items-center justify-center text-white">Cargando...</div>}>
            <AmbientScreen
              deviceName={deviceSync.getDeviceName()}
              roomId={roomId}
              recentMedia={MEDIA_CATALOG}
              onWakeScreen={() => setIsScreenInStandby(false)}
              onPlayDirectly={(media) => {
                handlePlayLocal(media);
              }}
            />
          </Suspense>
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
      ) : (
        <>
          {isLocalPlayerVisible && activeMedia && (
            /* 9. Reproductor a pantalla completa como overlay (mantiene AppShell y el scroll intactos al cerrar) */
            <div
              className="fixed inset-0 z-[200] bg-black"
              onPointerDownCapture={() => notifyUserActivity('player_pointer')}
              onKeyDownCapture={() => notifyUserActivity('player_key')}
            >
              <Suspense fallback={<div className="w-full h-screen bg-black flex items-center justify-center text-white">Cargando...</div>}>
                <VideoPlayer
              key={
                activeMedia.category === 'live_tv'
                  ? 'live-tv-player'
                  : `${activeMedia.id}:${activeEpisode?.id ?? ''}`
              }
              media={activeMedia}
              episode={activeEpisode}
              audioSettings={audioSettings}
              playbackSettings={playbackSettings}
              remoteCommandTrigger={lastRemoteCommand}
              initialTime={playerInitialTime}
              onSwitchLiveChannel={(channelMedia) => {
                handlePlayLocal(channelMedia);
              }}
              onBeforeAutoAdvance={handleBeforeAutoAdvance}
              onRequestEpisodeChange={(targetSeason, targetEpNum) => {
                advanceToSameSeriesEpisode(targetSeason, targetEpNum);
              }}
              onUpdateAudio={(newSettings) => {
                let vol01: number | undefined;
                if (typeof newSettings.volume === 'number' && Number.isFinite(newSettings.volume)) {
                  vol01 = newSettings.volume > 1
                    ? Math.max(0, Math.min(1, newSettings.volume / 100))
                    : Math.max(0, Math.min(1, newSettings.volume));
                  try { localStorage.setItem('cinecast_volume_v1', String(vol01)); } catch (_) {}
                }
                if (typeof newSettings.isMuted === 'boolean') {
                  try { localStorage.setItem('cinecast_muted_v1', String(newSettings.isMuted)); } catch (_) {}
                }
                const nextAudio = {
                  ...audioSettings,
                  ...newSettings,
                  ...(vol01 !== undefined ? { volume: Math.round(vol01 * 100) } : {}),
                };
                const nextPlayback =
                  vol01 !== undefined ? { ...playbackSettings, volume: vol01 } : playbackSettings;
                setAudioSettings(nextAudio);
                if (vol01 !== undefined) setPlaybackSettings(nextPlayback);
                deviceSync.broadcastPlaybackState({
                  ...remotePlaybackState,
                  audioSettings: nextAudio,
                  playbackSettings: nextPlayback,
                });
              }}
              onClose={() => {
                setPlayerDetailMedia(null);
                setIsPlayingLocally(false);
                setIsScreenInStandby(false);
                setActiveMedia(null);
                setActiveEpisode(null);
                refreshContinueWatching();
              }}
              onOpenDetail={(m) => setPlayerDetailMedia(m)}
              isDetailOpen={Boolean(playerDetailMedia)}
              onNextEpisode={handlePlayNextEpisode}
              onPrevEpisode={handlePlayPrevEpisode}
              hasNextEpisode={true}
              onBroadcastState={handleBroadcastPlayerState}
              remoteCommandNotification={remoteNotification}
              onOpenAudioSettings={() => setIsAudioModalOpen(true)}
            />
          </Suspense>
          {playerDetailMedia && (
            <Suspense fallback={null}>
              <div className="fixed inset-0 z-[120]">
                <DetailModal
                  media={playerDetailMedia}
                  onClose={() => setPlayerDetailMedia(null)}
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
                    setPlayerDetailMedia(null);
                    handlePlayLocal(m, enrichedEp, 0, false);
                  }}
                  onCastToScreen={
                    hasConnectedScreen && !preferLocalPlay
                      ? (m, ep) => {
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
                          setPlayerDetailMedia(null);
                          handleCastMediaToScreen(m, enrichedEp);
                        }
                      : undefined
                  }
                  isMyList={myListIds.includes(playerDetailMedia.id) || Boolean(playerDetailMedia.tmdbId && myListIds.includes(String(playerDetailMedia.tmdbId)))}
                  onToggleMyList={(mediaId) => {
                    const adding = !myListIds.includes(mediaId);
                    toggleMyList(mediaId, playerDetailMedia);
                    triggerNotification(adding ? `Guardado en Mi lista: ${playerDetailMedia.title}` : 'Quitado de Mi lista');
                  }}
                  connectedScreenName={connectedScreenName}
                  allCatalog={MEDIA_CATALOG}
                  onSelectSimilar={(similar) => {
                    setPlayerDetailMedia(null);
                    setIsPlayingLocally(false);
                    setIsScreenInStandby(false);
                    setActiveMedia(null);
                    setActiveEpisode(null);
                    refreshContinueWatching();
                    navigate(buildTitleRoute(similar));
                  }}
                />
              </div>
            </Suspense>
          )}
        </div>
          )}
          <div className={isLocalPlayerVisible ? 'hidden' : 'contents'}>
        <AppShell
          extraBottomPadding={deviceRole === 'remote'}
          hasMiniRemote={deviceRole === 'remote' && location.pathname !== '/control'}
          hasConnectedRemote={deviceRole !== 'remote' && hasConnectedRemote}
          onOpenControl={() => setIsRemoteSheetOpen((p) => !p)}
          isControlOpen={isRemoteSheetOpen}
          preferLocalPlay={preferLocalPlay}
          hasConnectedScreen={hasConnectedScreen}
          onToggleQuickRole={togglePlayTarget}
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
          <Suspense fallback={<div className="w-full h-screen bg-black flex items-center justify-center text-white">Cargando...</div>}>
            <Routes>
              <Route
                path="/"
                element={
                  <HomeView
                    onSelectItem={handleSelectCard}
                    onPlayItem={handlePlayCard}
                    onCastItem={hasConnectedScreen && !preferLocalPlay ? handleCastCard : undefined}
                  />
                }
              />
              <Route
                path="/explorar"
                element={
                  <ExploreView
                    onSelectItem={handleSelectCard}
                    onPlayItem={handlePlayCard}
                    onCastItem={hasConnectedScreen && !preferLocalPlay ? handleCastCard : undefined}
                  />
                }
              />
              <Route
                path="/buscar"
                element={
                  <SearchView
                    onSelectItem={handleSelectCard}
                    onPlayItem={handlePlayCard}
                    onCastItem={hasConnectedScreen && !preferLocalPlay ? handleCastCard : undefined}
                  />
                }
              />
              <Route
                path="/lista"
                element={
                  <MyListView
                    onSelectItem={handleSelectCard}
                    onPlayItem={handlePlayCard}
                    onCastItem={hasConnectedScreen && !preferLocalPlay ? handleCastCard : undefined}
                  />
                }
              />
              <Route path="/titulo/:type/:id" element={<TitleDetailRouteView />} />
              <Route
                path="/deportes"
                element={
                  <div className="p-4 sm:p-8 space-y-5">
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 pb-3">
                      <button
                        type="button"
                        onClick={() => navigate('/canales')}
                        className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white flex items-center gap-1.5 transition"
                      >
                        <Tv className="w-4 h-4 text-red-400" />
                        <span>Canales en vivo (TV & Fútbol)</span>
                      </button>
                      <span className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center gap-1.5 shadow">
                        <Trophy className="w-4 h-4" />
                        <span>Agenda y Partidos</span>
                      </span>
                    </div>
                    <SportsMatchesTab
                      preferLocalPlay={preferLocalPlay}
                      onTogglePlayTarget={togglePlayTarget}
                      onPlayChannel={(mediaItem) => {
                        if (!preferLocalPlay) {
                          handleCastMediaToScreen(mediaItem);
                        } else {
                          handlePlayLocal(mediaItem, undefined, 0, true);
                        }
                      }}
                      onCastChannel={(mediaItem) => handleCastMediaToScreen(mediaItem)}
                    />
                  </div>
                }
              />
              <Route
                path="/partidos"
                element={<Navigate to="/deportes" replace />}
              />
              <Route
                path="/canales"
                element={
                  <div className="p-4 sm:p-8 space-y-5">
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 pb-3">
                      <span className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center gap-1.5 shadow">
                        <Tv className="w-4 h-4" />
                        <span>Canales en vivo (TV & Fútbol)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate('/deportes')}
                        className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 hover:text-white flex items-center gap-1.5 transition"
                      >
                        <Trophy className="w-4 h-4 text-amber-400" />
                        <span>Agenda y Partidos</span>
                      </button>
                    </div>
                    <SportsLiveGrid
                      preferLocalPlay={preferLocalPlay}
                      showCastButton={hasConnectedScreen && !preferLocalPlay}
                      onPlayChannel={(mediaItem) => handlePlayLocal(mediaItem, undefined, 0, true)}
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
          </Suspense>
        </AppShell>
          </div>
        </>
      )}

      {/* Modal a pantalla completa en PC: "¿Seguís ahí?" */}
      {areYouStillThere && (
        <div
          role="dialog"
          aria-label="¿Seguís ahí?"
          className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none"
        >
          <div className="max-w-md w-full p-8 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
              <Clock className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                ¿Seguís ahí?
              </h2>
              {areYouStillThereCause && (
                <p
                  data-testid="are-you-still-there-cause"
                  className="text-sm font-bold text-amber-300"
                >
                  {areYouStillThereCause}
                </p>
              )}
              <p className="text-sm text-zinc-400">
                La pantalla entrará en reposo en{' '}
                <strong className="text-amber-400 font-mono text-base">{countdownRemaining}</strong> s si no respondes.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConfirmActiveWatching}
              className="w-full min-h-[52px] px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-sm transition shadow-lg shadow-amber-950/40 active:scale-95 cursor-pointer"
            >
              Sí, seguir
            </button>
          </div>
        </div>
      )}

      {/* Panel superpuesto de Control Remoto (en móvil sheet 92%, en escritorio columna derecha) */}
      <RemoteSheet
        isOpen={isRemoteSheetOpen}
        onClose={() => setIsRemoteSheetOpen(false)}
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        connectedScreenName={connectedScreenName}
        isScreenReconnecting={isScreenReconnecting}
        onSendCommand={sendRemoteCommand}
        onOpenCastModal={() => {
          setIsRemoteSheetOpen(false);
          navigate('/pantallas');
        }}
        onOpenAudioModal={() => {
          setIsRemoteSheetOpen(false);
          setIsAudioModalOpen(true);
        }}
        onOpenGuestModal={() => {
          setIsRemoteSheetOpen(false);
          setIsGuestModalOpen(true);
        }}
        onNavigateToCatalog={() => {
          setIsRemoteSheetOpen(false);
          navigate('/explorar');
        }}
      />

      {/* Modales clásicos con las mismas props de App.tsx L1675-1746 */}
      <Suspense fallback={null}>
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
      </Suspense>
    </>
  );
};

export const NewApp: React.FC<NewAppProps> = ({ onDisableV2 }) => {
  const handleSwitchToClassic = useMemo(() => {
    if (!onDisableV2) return undefined;
    return () => {
      try {
        localStorage.setItem('cinecast_ui_v2', '0');
      } catch (_) {}
      onDisableV2();
    };
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
