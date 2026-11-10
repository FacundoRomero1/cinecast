import React, { useState } from 'react';
import { SlidersHorizontal, X, RotateCcw } from 'lucide-react';
import type { CatalogSortOption, GenreCountItem } from '../providers/types';

export interface FilterState {
  category: string;
  genres: string[];
  decade: number | null;
  minRating: number;
  sort: CatalogSortOption;
}

export interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  availableGenres: GenreCountItem[];
  totalResults: number;
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
}) => {
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

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
      decade: null,
      minRating: 0,
      sort: 'default',
    });
  };

  const activeFiltersCount =
    (value.category !== 'all' ? 1 : 0) +
    value.genres.length +
    (value.decade !== null ? 1 : 0) +
    (value.minRating > 0 ? 1 : 0) +
    (value.sort !== 'default' ? 1 : 0);

  const renderControls = () => (
    <div className="space-y-4">
      {/* Fila 1: Tipo, Década, Puntuación mínima, Orden */}
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

        {/* Décadas */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-zinc-400 font-medium px-1">Década:</span>
          <button
            type="button"
            tabIndex={0}
            onClick={() => onChange({ ...value, decade: null })}
            className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
              value.decade === null
                ? 'bg-zinc-800 text-white border-zinc-600'
                : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            Todas
          </button>
          {DECADES.map((dec) => {
            const active = value.decade === dec;
            return (
              <button
                key={dec}
                type="button"
                tabIndex={0}
                onClick={() => onChange({ ...value, decade: active ? null : dec })}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  active
                    ? 'bg-red-600/20 text-red-300 border-red-500/60'
                    : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                {dec}s
              </button>
            );
          })}
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

      {/* Fila 2: Géneros con resultados (selección múltiple) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400 font-medium mr-1">Géneros:</span>
        {availableGenres.map((g) => {
          const selected = value.genres.includes(g.name);
          return (
            <button
              key={g.name}
              type="button"
              tabIndex={0}
              onClick={() => toggleGenre(g.name)}
              className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                selected
                  ? 'bg-red-600 text-white border-red-500 shadow'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <span>{g.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                  selected ? 'bg-black/30 text-white' : 'bg-zinc-800 text-zinc-400'
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

      {/* Panel inferior en móvil */}
      {mobileSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de catálogo"
          className="fixed inset-0 z-50 md:hidden flex flex-col justify-end bg-black/75 backdrop-blur-sm"
        >
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-zinc-950 border-t border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">Filtros ({totalResults})</h3>
              <button
                type="button"
                tabIndex={0}
                aria-label="Cerrar filtros"
                onClick={() => setMobileSheetOpen(false)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {renderControls()}

            <div className="pt-3 border-t border-zinc-800 flex gap-3">
              <button
                type="button"
                tabIndex={0}
                onClick={() => setMobileSheetOpen(false)}
                className="w-full min-h-[44px] py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
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
