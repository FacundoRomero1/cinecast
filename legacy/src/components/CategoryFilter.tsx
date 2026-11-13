import React from 'react';

export interface CategoryOption {
  id: string;
  label: string;
  query: string;
}

export const MAIN_CATEGORIES: CategoryOption[] = [
  { id: 'all', label: '✨ Todo el Catálogo', query: '' },
  { id: 'movies', label: '🎬 Películas', query: 'movie' },
  { id: 'series', label: '📺 Series', query: 'series' },
  { id: 'anime', label: '🗡️ Anime', query: 'anime' },
  { id: 'partidos', label: '⚽ Partidos (Fixture & En Vivo)', query: 'partidos' },
  { id: 'sports', label: '📺 Canales Deportes TV', query: 'sports' },
  { id: 'my-list', label: '⭐ Mi Lista', query: 'my-list' },
];

interface CategoryFilterProps {
  selectedCategory: string;
  onSelectCategory: (category: CategoryOption) => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-5 no-scrollbar">
      {MAIN_CATEGORIES.map((cat) => {
        const isActive = selectedCategory === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat)}
            className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all border ${
              isActive
                ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/40 scale-[1.03]'
                : 'bg-zinc-900/90 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
};
