import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { VirtuosoGrid } from 'react-virtuoso';
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
} from 'lucide-react';
import { localCatalogProvider } from '../providers/localCatalogProvider';
import type { CardItem, GenreCountItem, HomeRow } from '../providers/types';
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
import { CastModal } from '../components/CastModal';
import { GuestShareModal } from '../components/GuestShareModal';
import { DualScreenSimulator } from '../components/DualScreenSimulator';
import { ContinueWatchingRow } from '../components/ContinueWatchingRow';
import { SportsMatchesTab } from '../components/SportsMatchesTab';
import { SportsLiveGrid } from '../components/SportsLiveGrid';
import { AppRuntimeProvider, useAppRuntime, type HubType } from '../app/AppRuntime';
import { toMediaItem } from '../app/toMediaItem';
import type { AudioSettings, MediaItem, PlaybackSettings } from '../types';
import { AppShell } from './AppShell';
import { HubsHost } from './HubsHost';
import { Hero } from './Hero';
import { Row } from './Row';
import { TitleCard } from './TitleCard';
import { FilterBar, type FilterState } from './FilterBar';
import { GridSkeleton, HeroSkeleton } from './Skeleton';

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
  const {
    continueWatchingList,
    refreshContinueWatching,
    handlePlayLocal,
    handleCastMediaToScreen,
    triggerNotification,
    connectedScreenName,
  } = useAppRuntime();

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
        <ContinueWatchingRow
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

      {rows.map((row) => (
        <Row
          key={row.id}
          title={row.title}
          items={row.items}
          onSelectItem={onSelectItem}
          onPlayItem={onPlayItem}
          onCastItem={onCastItem}
          connectedScreenName={connectedScreenName}
        />
      ))}
    </div>
  );
};

interface ExploreViewProps {
  onSelectItem: (item: CardItem) => void;
  onPlayItem: (item: CardItem) => void;
  onCastItem: (item: CardItem) => void;
}

const PAGE_SIZE = 48;

const ExploreView: React.FC<ExploreViewProps> = ({
  onSelectItem,
  onPlayItem,
  onCastItem,
}) => {
  const { connectedScreenName } = useAppRuntime();
  const [filters, setFilters] = useState<FilterState>({
    category: 'all',
    genres: [],
    decade: null,
    minRating: 0,
    sort: 'default',
  });

  const [items, setItems] = useState<CardItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [facetGenres, setFacetGenres] = useState<GenreCountItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const loadingMoreRef = useRef<boolean>(false);

  const buildQueryParams = useCallback(
    (targetPage: number) => ({
      category: filters.category === 'all' ? undefined : filters.category,
      genre: filters.genres.length > 0 ? filters.genres : undefined,
      yearFrom: filters.decade !== null ? filters.decade : undefined,
      yearTo: filters.decade !== null ? filters.decade + 9 : undefined,
      minRating: filters.minRating > 0 ? filters.minRating : undefined,
      sort: filters.sort,
      page: targetPage,
      limit: PAGE_SIZE,
      facets: true,
    }),
    [filters]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    setPage(1);

    localCatalogProvider
      .query(buildQueryParams(1))
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        if (res.facets && res.facets.genres) {
          const list: GenreCountItem[] = Object.entries(res.facets.genres)
            .map(([name, count]) => ({ name, count }))
            .filter((g) => g.count > 0)
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
          setFacetGenres(list);
        } else {
          setFacetGenres([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    return () => {
      cancelled = true;
    };
  }, [buildQueryParams]);

  const loadNextPage = useCallback(() => {
    if (loadingInitial || loadingMoreRef.current || page >= totalPages) return;
    const nextPage = page + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    localCatalogProvider
      .query({ ...buildQueryParams(nextPage), facets: false })
      .then((res) => {
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const fresh = res.items.filter((i) => !existingIds.has(i.id));
          return [...prev, ...fresh];
        });
        setPage(nextPage);
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [buildQueryParams, loadingInitial, page, totalPages]);

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
        onChange={setFilters}
        availableGenres={facetGenres}
        totalResults={total}
      />

      {loadingInitial ? (
        <GridSkeleton count={12} />
      ) : items.length === 0 ? (
        <div className="py-20 text-center rounded-2xl bg-zinc-900/50 border border-zinc-800 p-8">
          <p className="text-base font-bold text-white mb-1">
            No hay títulos que coincidan con estos filtros
          </p>
          <p className="text-xs text-zinc-400">
            Prueba quitando algún género o ampliando la década seleccionada.
          </p>
        </div>
      ) : (
        <>
          <VirtuosoGrid
            useWindowScroll
            totalCount={items.length}
            endReached={loadNextPage}
            overscan={400}
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
                />
              );
            }}
          />
          {loadingMore && (
            <div className="py-6 text-center text-xs text-zinc-400 font-medium">
              Cargando más títulos...
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
  const [query, setQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [results, setResults] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

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
      onPlayLocal={(m, ep) => handlePlayLocal(m, ep)}
      onCastToScreen={(m, ep) => handleCastMediaToScreen(m, ep)}
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
  const {
    remotePlaybackState,
    remoteMediaItem,
    remoteEpisodeItem,
    connectedScreenName,
    sendRemoteCommand,
    setIsAudioModalOpen,
    setIsCastModalOpen,
    setIsGuestModalOpen,
  } = useAppRuntime();

  return (
    <div className="p-4 sm:p-8 pb-44">
      <h1 className="text-xl sm:text-2xl font-extrabold text-white mb-2">Control Remoto</h1>
      <p className="text-xs text-zinc-400 mb-4">
        Controlando pantalla: <strong className="text-zinc-200">{connectedScreenName}</strong>
      </p>
      <div className="[&>div]:!static [&>div]:!rounded-2xl [&>div]:!border [&>div]:!border-zinc-800">
        <RemoteControlSheet
          playbackState={remotePlaybackState}
          currentMedia={remoteMediaItem}
          currentEpisode={remoteEpisodeItem}
          connectedScreenName={connectedScreenName}
          onSendCommand={sendRemoteCommand}
          onOpenAudioModal={() => setIsAudioModalOpen(true)}
          onOpenCastModal={() => setIsCastModalOpen(true)}
          onOpenGuestModal={() => setIsGuestModalOpen(true)}
        />
      </div>
    </div>
  );
};

interface SettingsViewProps {
  onSwitchToClassic: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onSwitchToClassic }) => {
  const {
    roomId,
    connectedScreenName,
    devices,
    deviceRole,
    setIsCastModalOpen,
    setIsAudioModalOpen,
    setIsGuestModalOpen,
    setIsDualSimulatorOpen,
  } = useAppRuntime();

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

      {/* Botones que abren los 4 modales clásicos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <button
          type="button"
          onClick={() => setIsCastModalOpen(true)}
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
          onClick={() => setIsDualSimulatorOpen(true)}
          className="min-h-[64px] p-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-left flex items-center justify-between gap-3 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Simulador de pantalla dual</div>
              <div className="text-xs text-zinc-400">
                Probar TV + Celular en simultáneo
              </div>
            </div>
          </div>
        </button>
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
      prevHubRef.current = targetHub;
      setActiveHub(targetHub);
    }
  }, [location.pathname, activeHub, setActiveHub]);

  // Cuando un comando remoto cambia activeHub -> navegar a /musica, /youtube, /deportes o /
  useEffect(() => {
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

interface NewAppContentProps {
  onSwitchToClassic: () => void;
}

const NewAppContent: React.FC<NewAppContentProps> = ({ onSwitchToClassic }) => {
  const navigate = useNavigate();
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
    isCastModalOpen,
    setIsCastModalOpen,
    isGuestModalOpen,
    setIsGuestModalOpen,
    isDualSimulatorOpen,
    setIsDualSimulatorOpen,
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
      ) : isPlayingLocally && activeMedia && activeHub === 'cinecast' && deviceRole !== 'remote' ? (
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
          bottomSlot={
            deviceRole === 'remote' ? (
              <RemoteControlDrawer
                playbackState={remotePlaybackState}
                currentMedia={remoteMediaItem}
                currentEpisode={remoteEpisodeItem}
                connectedScreenName={connectedScreenName}
                onSendCommand={sendRemoteCommand}
                onOpenAudioModal={() => setIsAudioModalOpen(true)}
                onOpenCastModal={() => setIsCastModalOpen(true)}
                onOpenGuestModal={() => setIsGuestModalOpen(true)}
              />
            ) : undefined
          }
        >
          <HubsHost />
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
            <Route path="/musica" element={null} />
            <Route path="/youtube" element={null} />
            <Route
              path="/ajustes"
              element={<SettingsView onSwitchToClassic={onSwitchToClassic} />}
            />
            <Route path="/control" element={<ControlView />} />
          </Routes>
        </AppShell>
      )}

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

      <CastModal
        isOpen={isCastModalOpen}
        onClose={() => setIsCastModalOpen(false)}
        devices={devices}
        currentDeviceId={deviceSync.getDeviceId()}
        currentRoomId={roomId}
        currentDeviceType={deviceRole}
        selectedScreenId={selectedScreenId}
        onSelectScreen={(screenId) => {
          setSelectedScreenId(screenId);
          setIsCastModalOpen(false);
        }}
        onChangeRoom={(newRoomId) => {
          deviceSync.setRoomId(newRoomId);
          setRoomId(newRoomId);
        }}
        onChangeDeviceType={(type) => {
          setDeviceRole(type);
          deviceSync.setDeviceType(type);
          if (type === 'screen') setIsScreenInStandby(true);
        }}
        onOpenDualSimulator={() => setIsDualSimulatorOpen(true)}
        isPermanentHome={isPermanentHomeLinked}
        onTogglePermanentHome={handleTogglePermanentHome}
      />

      <GuestShareModal
        isOpen={isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        roomId={roomId}
        screenName={connectedScreenName}
      />

      <DualScreenSimulator
        isOpen={isDualSimulatorOpen}
        onClose={() => setIsDualSimulatorOpen(false)}
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        catalog={MEDIA_CATALOG}
        onSendCommand={sendRemoteCommand}
        onUpdateAudio={(audio) => setAudioSettings((prev) => ({ ...prev, ...audio }))}
        onUpdatePlayback={(pb) => setPlaybackSettings((prev) => ({ ...prev, ...pb }))}
        onOpenAudioModal={() => setIsAudioModalOpen(true)}
        onOpenCastModal={() => setIsCastModalOpen(true)}
        onPlayMedia={handlePlayLocal}
        onNextEpisode={handlePlayNextEpisode}
      />
    </>
  );
};

export const NewApp: React.FC<NewAppProps> = ({ onDisableV2 }) => {
  const handleSwitchToClassic = useCallback(() => {
    try {
      localStorage.removeItem('cinecast_ui_v2');
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
