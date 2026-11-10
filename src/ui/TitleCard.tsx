import React from 'react';
import { Star } from 'lucide-react';
import type { CardItem } from '../providers/types';

export interface TitleCardProps {
  item: CardItem;
  onSelect: (item: CardItem) => void;
  className?: string | undefined;
}

export const TitleCard: React.FC<TitleCardProps> = ({ item, onSelect, className = '' }) => {
  const isSeries =
    item.type === 'series' || item.category === 'series' || item.category === 'anime';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.title} (${item.year}), ${isSeries ? 'Serie' : 'Película'}, puntuación ${item.rating}`}
      onClick={() => onSelect(item)}
      onKeyDown={handleKeyDown}
      className={`group relative flex flex-col rounded-xl bg-zinc-900/80 border border-zinc-800/80 overflow-hidden cursor-pointer select-none transition-transform duration-200 hover:scale-[1.03] hover:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 min-h-[44px] min-w-[44px] ${className}`}
    >
      <div className="relative aspect-[2/3] w-full bg-zinc-900 overflow-hidden">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs text-zinc-400 font-medium">
            {item.title}
          </div>
        )}
      </div>

      <div className="p-2.5 flex flex-col gap-1 bg-zinc-950/90 flex-1 justify-between">
        <h3 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate" title={item.title}>
          {item.title}
        </h3>

        <div className="flex items-center justify-between gap-1.5 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5 min-w-0">
            <span>{item.year}</span>
            <span>•</span>
            <span className="inline-flex items-center gap-0.5 text-amber-400 font-semibold">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {item.rating.toFixed(1)}
            </span>
          </div>

          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 ${
              isSeries
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
            }`}
          >
            {isSeries ? 'SERIE' : 'PELÍCULA'}
          </span>
        </div>
      </div>
    </div>
  );
};
