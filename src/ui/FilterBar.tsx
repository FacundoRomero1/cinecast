import React, { useMemo, useState, useEffect } from 'react';
import { SlidersHorizontal, X, RotateCcw } from 'lucide-react';
import { lockScroll } from './scrollLock';
import type { CatalogSortOption, GenreCountItem } from '../providers/types';

export interface FilterState {
  category: string;
  genres: string[];
  genreMode?: 'all' | 'any';
  yearFrom: number | null;
  yearTo: number | null;
  decade?: number | null;
  minRating: number;
  sort: CatalogSortOption;
}

export interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  availableGenres: GenreCountItem[];
  totalResults: number;
  minYear?: number;
  maxYear?: number;
}

const DECADES = [2020, 2010, 2000, 1990, 1980, 1970];
const RATINGS = [0, 6, 7, 8];
const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'movie', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
];
const SORTS: Array<{ id: CatalogSortOption; label: string }> = [
  { id: 'default', label: 'Destacados' },
  { id: 'rating', label: 'Mejor puntuación' },
  { id: 'year', label: 'Más recientes' },
  { id: 'title', label: 'Título (A-Z)' },
  { id: 'added', label: 'Recién agregados' },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  value,
  onChange,
  availableGenres,
  totalResults,
  minYear = 1926,
  maxYear = 2026,
}) => {
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!mobileSheetOpen) return;
    const unlock = lockScroll();

    // Manejo de historia: botón Atrás cierra primero el panel sin cambiar de ruta
    window.history.pushState({ ccFilterOpen: true }, '');
    const handlePopState = () => {
      setMobileSheetOpen(false);
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      unlock();
      window.removeEventListener('popstate', handlePopState);
    };
  }, [mobileSheetOpen]);

  const closeMobileSheet = () => {
    if (window.history.state && window.history.state.ccFilterOpen) {
      window.history.back();
    } else {
      setMobileSheetOpen(false);
    }
  };

  const allYears = useMemo(() => {
    const list: number[] = [];
    for (let y = maxYear; y >= minYear; y--) {
      list.push(y);
    }
    return list;
  }, [minYear, maxYear]);

  const toggleGenre = (genreName: string) => {
    const exists = value.genres.includes(genreName);
    const nextGenres = exists
      ? value.genres.filter((g) => g !== genreName)
      : [...value.genres, genreName];
    onChange({ ...value, genres: nextGenres });
  };

  const resetFilters = () => {
    onChange({
      category: 'all',
      genres: [],
      genreMode: 'all',
      yearFrom: null,
      yearTo: null,
      decade: null,
      minRating: 0,
      sort: 'default',
    });
  };

  const genreMode: 'all' | 'any' = value.genreMode === 'any' ? 'any' : 'all';

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (value.category !== 'all') {
      const catLabel = CATEGORIES.find((c) => c.id === value.category)?.label || value.category;
      chips.push({
        key: `cat-${value.category}`,
        label: `Tipo: ${catLabel}`,
        onRemove: () => onChange({ ...value, category: 'all' }),
      });
    }
    for (const g of value.genres) {
      chips.push({
        key: `genre-${g}`,
        label: g,
        onRemove: () => onChange({ ...value, genres: value.genres.filter((x) => x !== g) }),
      });
    }
    if (value.yearFrom !== null && value.yearTo !== null && value.yearFrom === value.yearTo) {
      chips.push({
        key: 'year-exact',
        label: `Año: ${value.yearFrom}`,
        onRemove: () => onChange({ ...value, yearFrom: null, yearTo: null, decade: null }),
      });
    } else {
      if (value.yearFrom !== null) {
        chips.push({
          key: 'year-from',
          label: `Desde: ${value.yearFrom}`,
          onRemove: () => onChange({ ...value, yearFrom: null, decade: null }),
        });
      }
      if (value.yearTo !== null) {
        chips.push({
          key: 'year-to',
          label: `Hasta: ${value.yearTo}`,
          onRemove: () => onChange({ ...value, yearTo: null, decade: null }),
        });
      }
    }
    if (value.minRating > 0) {
      chips.push({
        key: 'rating',
        label: `Rating: ${value.minRating}+ ★`,
        onRemove: () => onChange({ ...value, minRating: 0 }),
      });
    }
    if (value.sort !== 'default') {
      const sortLabel = SORTS.find((s) => s.id === value.sort)?.label || value.sort;
      chips.push({
        key: 'sort',
        label: `Orden: ${sortLabel}`,
        onRemove: () => onChange({ ...value, sort: 'default' }),
      });
    }
    return chips;
  }, [value, onChange]);

  const activeFiltersCount = activeChips.length;

  const renderControls = () => (
    <div className="space-y-4">
      {/* Fila 1: Tipo, Rango de Años (Desde/Hasta/Este año), Puntuación mínima, Orden */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Tipo */}
        <div className="flex items-center gap-1.5 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          {CATEGORIES.map((cat) => {
            const active = value.category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                tabIndex={0}
                onClick={() => onChange({ ...value, category: cat.id })}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  active
                    ? 'bg-red-600 text-white shadow'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800/80'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Filtro por Año: Desde, Hasta, Este año */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Selector Desde */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="cc-filter-year-from" className="text-xs text-zinc-400 font-medium">
              Desde:
            </label>
            <select
              id="cc-filter-year-from"
              aria-label="Año desde"
              tabIndex={0}
              value={value.yearFrom ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : null;
                let nextTo = value.yearTo;
                if (val !== null && nextTo !== null && val > nextTo) {
                  nextTo = val;
                }
                onChange({ ...value, yearFrom: val, yearTo: nextTo, decade: null });
              }}
              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <option value="">Todos</option>
              {allYears.map((y) => (
                <option key={`from-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Selector Hasta */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="cc-filter-year-to" className="text-xs text-zinc-400 font-medium">
              Hasta:
            </label>
            <select
              id="cc-filter-year-to"
              aria-label="Año hasta"
              tabIndex={0}
              value={value.yearTo ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : null;
                let nextFrom = value.yearFrom;
                if (val !== null && nextFrom !== null && val < nextFrom) {
                  nextFrom = val;
                }
                onChange({ ...value, yearFrom: nextFrom, yearTo: val, decade: null });
              }}
              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <option value="">Todos</option>
              {allYears.map((y) => (
                <option key={`to-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Botón Este año */}
          <button
            type="button"
            tabIndex={0}
            onClick={() => {
              const active = value.yearFrom === currentYear && value.yearTo === currentYear;
              onChange({
                ...value,
                yearFrom: active ? null : currentYear,
                yearTo: active ? null : currentYear,
                decade: null,
              });
            }}
            className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
              value.yearFrom === currentYear && value.yearTo === currentYear
                ? 'bg-red-600/20 text-red-300 border-red-500/60'
                : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            Este año
          </button>
        </div>

        {/* Puntuación mínima */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400 font-medium px-1">Rating:</span>
          {RATINGS.map((r) => {
            const active = value.minRating === r;
            return (
              <button
                key={r}
                type="button"
                tabIndex={0}
                onClick={() => onChange({ ...value, minRating: r })}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                    : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                {r === 0 ? 'Todos' : `${r}+ ★`}
              </button>
            );
          })}
        </div>

        {/* Orden */}
        <div className="flex items-center gap-2 ml-auto">
          <label htmlFor="cc-filter-sort" className="text-xs text-zinc-400 font-medium">
            Ordenar:
          </label>
          <select
            id="cc-filter-sort"
            tabIndex={0}
            value={value.sort}
            onChange={(e) => onChange({ ...value, sort: e.target.value as CatalogSortOption })}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              tabIndex={0}
              onClick={resetFilters}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 inline-flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Fila 2: Géneros con resultados (selección múltiple + modo Todos / Cualquiera) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400 font-medium mr-1">Géneros:</span>
        <div
          role="group"
          aria-label="Modo de combinación de géneros"
          className="inline-flex items-center rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 mr-1"
        >
          <button
            type="button"
            tabIndex={0}
            aria-pressed={genreMode === 'all'}
            onClick={() => onChange({ ...value, genreMode: 'all' })}
            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
              genreMode === 'all'
                ? 'bg-red-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            tabIndex={0}
            aria-pressed={genreMode === 'any'}
            onClick={() => onChange({ ...value, genreMode: 'any' })}
            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
              genreMode === 'any'
                ? 'bg-red-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Cualquiera
          </button>
        </div>

        {availableGenres.map((g) => {
          const selected = value.genres.includes(g.name);
          const isDisabled = g.count === 0 && !selected;
          return (
            <button
              key={g.name}
              type="button"
              tabIndex={isDisabled ? -1 : 0}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              data-genre-name={g.name}
              onClick={() => {
                if (!isDisabled) toggleGenre(g.name);
              }}
              className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                selected
                  ? 'bg-red-600 text-white border-red-500 shadow'
                  : isDisabled
                  ? 'bg-zinc-950/60 text-zinc-600 border-zinc-900 opacity-45 cursor-not-allowed'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <span>{g.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                  selected
                    ? 'bg-black/30 text-white'
                    : isDisabled
                    ? 'bg-zinc-900 text-zinc-600'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {g.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="mb-6">
      {/* Barra en escritorio (>= md) */}
      <div className="hidden md:block p-4 rounded-2xl bg-zinc-950/90 border border-zinc-800/80">
        {renderControls()}
      </div>

      {/* Botón disparador en móvil (< md) */}
      <div className="flex md:hidden items-center justify-between gap-3">
        <button
          type="button"
          tabIndex={0}
          onClick={() => setMobileSheetOpen(true)}
          className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs font-bold inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <SlidersHorizontal className="w-4 h-4 text-red-500" />
          <span>Filtros y orden</span>
          {activeFiltersCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px]">
              {activeFiltersCount}
            </span>
          )}
        </button>

        <span className="text-xs text-zinc-400 font-medium">
          {totalResults.toLocaleString('es-AR')} títulos
        </span>
      </div>

      {/* Chips de filtros activos + Limpiar todo */}
      {activeChips.length > 0 && (
        <div
          data-testid="active-filter-chips"
          className="flex flex-wrap items-center gap-2 mt-3"
        >
          <span className="text-[11px] text-zinc-500 font-semibold">Activos:</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              tabIndex={0}
              aria-label={`Quitar filtro ${chip.label}`}
              onClick={chip.onRemove}
              className="min-h-[44px] md:min-h-[36px] px-3 py-1 rounded-full bg-red-600/15 hover:bg-red-600/25 border border-red-500/40 text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 touch-manipulation"
            >
              <span>{chip.label}</span>
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            tabIndex={0}
            onClick={resetFilters}
            className="min-h-[44px] md:min-h-[36px] px-3 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 touch-manipulation"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Limpiar todo</span>
          </button>
        </div>
      )}

      {/* Panel inferior en móvil */}
      {mobileSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de catálogo"
          className="fixed inset-0 z-cc-panel md:hidden flex flex-col justify-end bg-black/80 backdrop-blur-sm"
        >
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-zinc-950 border-t border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">Filtros ({totalResults})</h3>
              <button
                type="button"
                tabIndex={0}
                aria-label="Cerrar filtros"
                onClick={closeMobileSheet}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 touch-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {renderControls()}

            {/* Pie fijo con "Ver N resultados" y "Limpiar" de al menos 44 px */}
            <div className="sticky bottom-0 inset-x-0 pt-3 pb-2 bg-zinc-950 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                tabIndex={0}
                onClick={resetFilters}
                className="min-h-[44px] min-w-[80px] px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white font-bold text-xs border border-zinc-800 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 touch-manipulation"
              >
                Limpiar
              </button>
              <button
                type="button"
                tabIndex={0}
                onClick={closeMobileSheet}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 touch-manipulation text-center"
              >
                Ver {totalResults.toLocaleString('es-AR')} resultados
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
