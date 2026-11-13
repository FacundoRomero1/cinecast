import React, { useRef } from 'react';
import { MediaItem } from '../types';
import { ChevronLeft, ChevronRight, Play, Tv, Plus, Check, Info } from 'lucide-react';
import { createStyledPosterFallback } from '../utils/imageUtils';

interface MovieRowProps {
  title: string;
  items: MediaItem[];
  onPlayLocal: (media: MediaItem) => void;
  onCastToScreen: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  myListIds: string[];
  onToggleMyList: (id: string) => void;
  connectedScreenName?: string;
}

export const MovieRow: React.FC<MovieRowProps> = ({
  title,
  items,
  onPlayLocal,
  onCastToScreen,
  onOpenDetails,
  myListIds,
  onToggleMyList,
  connectedScreenName = 'PC',
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const rowId = React.useMemo(() => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'row', [title]);

  // Tarea C: Deduplicar items por id para evitar colisiones de keys y clicks cruzados
  const uniqueItems = React.useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const idStr = String(item.id || (item as any).tmdbId || '');
      if (!idStr || seen.has(idStr)) return false;
      seen.add(idStr);
      return true;
    });
  }, [items]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, clientWidth } = scrollContainerRef.current;
    const scrollAmount = clientWidth * 0.75;
    scrollContainerRef.current.scrollTo({
      left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
      behavior: 'smooth',
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="relative group/row mb-8 px-4 sm:px-12 select-none">
      <h2 className="text-lg sm:text-xl font-bold text-white mb-3 tracking-wide flex items-center gap-2">
        {title}
        <ChevronRight className="w-4 h-4 text-red-500 opacity-0 group-hover/row:opacity-100 transition" />
      </h2>

      {/* Left Scroll Button */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 h-44 w-10 sm:w-12 bg-black/60 hover:bg-black/90 text-white rounded-r-xl opacity-0 group-hover/row:opacity-100 transition flex items-center justify-center backdrop-blur-sm cursor-pointer"
        aria-label="Desplazar a la izquierda"
      >
        <ChevronLeft className="w-8 h-8" />
      </button>

      {/* Right Scroll Button */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 h-44 w-10 sm:w-12 bg-black/60 hover:bg-black/90 text-white rounded-l-xl opacity-0 group-hover/row:opacity-100 transition flex items-center justify-center backdrop-blur-sm cursor-pointer"
        aria-label="Desplazar a la derecha"
      >
        <ChevronRight className="w-8 h-8" />
      </button>

      {/* Cards Scrollable Container */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-3 sm:gap-4 overflow-x-auto no-scrollbar scroll-smooth py-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {uniqueItems.map((item) => {
          const isFavorited = myListIds.includes(item.id);

          return (
            <div
              key={`${rowId}-${item.id}`}
              className="relative shrink-0 w-44 sm:w-64 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/80 group/card transition-all duration-300 hover:scale-105 hover:z-20 hover:shadow-2xl hover:border-zinc-700 cursor-pointer"
              onClick={() => onOpenDetails(item)}
            >
              {/* Thumbnail Image */}
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-950">
                <img
                  src={item.backdropUrl || item.posterUrl}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover/card:scale-105 transition duration-500"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(item.title, item.category || item.type);
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-80" />

                {item.isOriginal && (
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-black uppercase tracking-wider font-mono">
                    N Original
                  </span>
                )}

                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] text-white font-medium">
                  <span className="truncate max-w-[70%] font-semibold drop-shadow">{item.title}</span>
                  <span className="text-emerald-400 font-bold shrink-0">{item.matchScore}%</span>
                </div>
              </div>

              {/* Hover Details Panel */}
              <div className="p-3 bg-zinc-900/95 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {/* Play locally */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayLocal(item);
                      }}
                      className="p-1.5 rounded-full bg-white hover:bg-zinc-200 text-black transition shadow"
                      title="Ver en este dispositivo"
                    >
                      <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                    </button>

                    {/* Cast to PC screen */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCastToScreen(item);
                      }}
                      className="p-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white transition shadow"
                      title={`Transmitir a ${connectedScreenName}`}
                    >
                      <Tv className="w-3.5 h-3.5" />
                    </button>

                    {/* My List */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMyList(item.id);
                      }}
                      className="p-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                      title={isFavorited ? 'Quitar de mi lista' : 'Agregar a mi lista'}
                    >
                      {isFavorited ? <Check className="w-3.5 h-3.5 text-red-500" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* More info */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetails(item);
                    }}
                    className="p-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                    title="Detalles y episodios"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                  <span className="text-zinc-300 font-bold px-1 rounded border border-zinc-700">
                    {item.ratingBadge}
                  </span>
                  <span>{item.type === 'series' ? `${item.seasonsCount} Temp.` : 'Película'}</span>
                  <span>•</span>
                  <span>{item.qualityBadge.split('•')[0]}</span>
                </div>

                <div className="text-[10px] text-zinc-400 truncate">
                  {item.genres.slice(0, 3).join(' • ')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
