import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { VirtuosoGrid } from 'react-virtuoso';
import { Search as SearchIcon, Sparkles, ArrowLeft } from 'lucide-react';
import { localCatalogProvider } from '../providers/localCatalogProvider';
import type { CardItem, GenreCountItem, HomeRow } from '../providers/types';
import { watchHistoryService, type WatchProgressItem } from '../services/watchHistoryService';
import { AppShell } from './AppShell';
import { Hero } from './Hero';
import { Row } from './Row';
import { TitleCard } from './TitleCard';
import { FilterBar, type FilterState } from './FilterBar';
import { GridSkeleton, HeroSkeleton } from './Skeleton';
import { TitleSheet } from './TitleSheet';

export interface NewAppProps {
  onDisableV2?: () => void;
}

function mapWatchProgressToCard(w: WatchProgressItem): CardItem {
  const m = w.mediaItem;
  return {
    id: w.mediaId || m?.id || w.id,
    tmdbId: m?.tmdbId ?? 0,
    title: w.title || m?.title || 'Sin Título',
    posterUrl: w.posterUrl || m?.posterUrl || '',
    backdropUrl: w.backdropUrl || m?.backdropUrl || w.posterUrl || '',
    year: m?.year ?? 2024,
    rating: typeof m?.matchScore === 'number' ? Number((m.matchScore / 10).toFixed(1)) : 7.5,
    genres: Array.isArray(m?.genres) ? m.genres : [],
    category: w.category || m?.category || w.type || 'movie',
    type: w.type === 'series' || w.type === 'anime' ? 'series' : 'movie',
    quality: m?.qualityBadge || '1080p',
    upcoming: false,
  };
}

interface HomeViewProps {
  onSelectItem: (item: CardItem) => void;
}

const HomeView: React.FC<HomeViewProps> = ({ onSelectItem }) => {
  const [rows, setRows] = useState<HomeRow[]>([]);
  const [continueItems, setContinueItems] = useState<CardItem[]>([]);
  const [heroSynopsis, setHeroSynopsis] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const historyAll = watchHistoryService.getAll();
    const continueWatching = watchHistoryService.getContinueWatchingList();
    setContinueItems(continueWatching.map(mapWatchProgressToCard));

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
          onPlay={onSelectItem}
          onMoreInfo={onSelectItem}
        />
      </div>

      {continueItems.length > 0 && (
        <Row title="Continuar viendo" items={continueItems} onSelectItem={onSelectItem} />
      )}

      {rows.map((row) => (
        <Row key={row.id} title={row.title} items={row.items} onSelectItem={onSelectItem} />
      ))}
    </div>
  );
};

interface ExploreViewProps {
  onSelectItem: (item: CardItem) => void;
}

const PAGE_SIZE = 48;

const ExploreView: React.FC<ExploreViewProps> = ({ onSelectItem }) => {
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
              return <TitleCard item={item} onSelect={onSelectItem} />;
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
}

const SearchView: React.FC<SearchViewProps> = ({ onSelectItem }) => {
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
            <TitleCard key={item.id} item={item} onSelect={onSelectItem} />
          ))}
        </div>
      )}
    </div>
  );
};

interface PlaceholderViewProps {
  sectionName: string;
  onSwitchToClassic: () => void;
}

const PlaceholderView: React.FC<PlaceholderViewProps> = ({
  sectionName,
  onSwitchToClassic,
}) => (
  <div className="p-6 sm:p-12 flex items-center justify-center min-h-[70vh]">
    <div className="max-w-md w-full rounded-2xl bg-zinc-900/70 border border-zinc-800 p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-red-600/20 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
        <Sparkles className="w-6 h-6" />
      </div>
      <h1 className="text-xl font-extrabold text-white">{sectionName} — Próximamente</h1>
      <p className="text-xs text-zinc-400 leading-relaxed">
        Esta sección todavía está en migración al nuevo diseño. Puedes abrir la vista clásica en cualquier momento.
      </p>
      <button
        type="button"
        tabIndex={0}
        onClick={onSwitchToClassic}
        className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Abrir vista clásica</span>
      </button>
    </div>
  </div>
);

export const NewApp: React.FC<NewAppProps> = ({ onDisableV2 }) => {
  const [selectedItem, setSelectedItem] = useState<CardItem | null>(null);

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
      <AppShell>
        <Routes>
          <Route path="/" element={<HomeView onSelectItem={setSelectedItem} />} />
          <Route path="/explorar" element={<ExploreView onSelectItem={setSelectedItem} />} />
          <Route path="/buscar" element={<SearchView onSelectItem={setSelectedItem} />} />
          <Route
            path="/lista"
            element={
              <PlaceholderView sectionName="Mi lista" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/deportes"
            element={
              <PlaceholderView sectionName="Deportes" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/canales"
            element={
              <PlaceholderView sectionName="Canales" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/musica"
            element={
              <PlaceholderView sectionName="Música" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/youtube"
            element={
              <PlaceholderView sectionName="YouTube" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/ajustes"
            element={
              <PlaceholderView sectionName="Ajustes" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
          <Route
            path="/control"
            element={
              <PlaceholderView sectionName="Control" onSwitchToClassic={handleSwitchToClassic} />
            }
          />
        </Routes>

        <TitleSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSwitchToClassic={handleSwitchToClassic}
        />
      </AppShell>
    </HashRouter>
  );
};
export default NewApp;
