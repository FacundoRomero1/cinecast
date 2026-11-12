import React from 'react';
import { Play, Star, Trash2, Tv } from 'lucide-react';
import type { CardItem } from '../providers/types';
import { getPosterProxyUrl, type PosterWidth } from './liteMode';

export interface TitleCardProps {
  item: CardItem;
  onSelect: (item: CardItem) => void;
  onPlay?: ((item: CardItem) => void) | undefined;
  onCast?: ((item: CardItem) => void) | undefined;
  onRemove?: ((item: CardItem) => void) | undefined;
  connectedScreenName?: string | undefined;
  posterWidth?: PosterWidth | undefined;
  className?: string | undefined;
}

export const TitleCard: React.FC<TitleCardProps> = ({
  item,
  onSelect,
  onPlay,
  onCast,
  onRemove,
  connectedScreenName,
  posterWidth = 185,
  className = '',
}) => {
  const isSeries =
    item.type === 'series' || item.category === 'series' || item.category === 'anime';
  const posterSrc = getPosterProxyUrl(item.posterUrl, posterWidth);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item);
    }
  };

  return (
    <article
      data-card-id={item.id}
      role="button"
      tabIndex={0}
      aria-label={`${item.title} (${item.year}), ${isSeries ? 'Serie' : 'Película'}, puntuación ${item.rating}`}
      onClick={() => onSelect(item)}
      onKeyDown={handleKeyDown}
      className={`group relative flex flex-col rounded-xl bg-zinc-900/80 border border-zinc-800/80 overflow-hidden cursor-pointer select-none transition-transform duration-200 hover:scale-[1.03] hover:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 min-h-[44px] min-w-[44px] touch-manipulation ${className}`}
    >
      <div className="relative cc-poster-placeholder aspect-[2/3] w-full bg-zinc-900 overflow-hidden">
        {posterSrc ? (
          <img
            src={posterSrc}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs text-zinc-400 font-medium">
            {item.title}
          </div>
        )}

        {(onPlay || onCast || onRemove) && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-end justify-between p-2 gap-1.5">
            <div className="flex items-center gap-1.5">
              {onPlay && (
                <button
                  type="button"
                  title="Reproducir"
                  aria-label={`Reproducir ${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-lg flex items-center justify-center transition"
                >
                  <Play className="w-4 h-4 fill-white" />
                </button>
              )}

              {onCast && (
                <button
                  type="button"
                  title={`Enviar a ${connectedScreenName || 'PC'}`}
                  aria-label={`Enviar ${item.title} a ${connectedScreenName || 'PC'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCast(item);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-zinc-900/95 hover:bg-zinc-800 text-white border border-zinc-700 shadow-lg flex items-center justify-center transition"
                >
                  <Tv className="w-4 h-4 text-red-400" />
                </button>
              )}
            </div>

            {onRemove && (
              <button
                type="button"
                title="Quitar de Mi lista"
                aria-label={`Quitar ${item.title} de Mi lista`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item);
                }}
                className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-zinc-900/95 hover:bg-red-600 text-zinc-200 hover:text-white border border-zinc-700 shadow-lg flex items-center justify-center transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
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
    </article>
  );
};
