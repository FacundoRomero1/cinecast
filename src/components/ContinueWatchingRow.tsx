import React, { useRef, useMemo } from 'react';
import { Play, Cast, X, ChevronLeft, ChevronRight, Clock, Tv } from 'lucide-react';
import { WatchProgressItem, watchHistoryService } from '../services/watchHistoryService';
import { MediaItem, Episode } from '../types';
import { createStyledPosterFallback } from '../utils/imageUtils';

interface ContinueWatchingRowProps {
  items: WatchProgressItem[];
  onPlay: (media: MediaItem, episode?: Episode | null, initialTime?: number) => void;
  onCast?: (media: MediaItem, episode?: Episode | null) => void;
  onRemove: (id: string) => void;
  connectedScreenName?: string;
}

export const ContinueWatchingRow: React.FC<ContinueWatchingRowProps> = ({
  items,
  onPlay,
  onCast,
  onRemove,
  connectedScreenName = 'TV',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return (items || []).filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [items]);

  if (!uniqueItems || uniqueItems.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -420 : 420;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const formatRemainingTime = (current: number, duration: number) => {
    const remainingSecs = Math.max(0, duration - current);
    const mins = Math.round(remainingSecs / 60);
    if (mins <= 1) return 'Casi terminado';
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const m = mins % 60;
      return `${hours}h ${m}m restantes`;
    }
    return `${mins} min restantes`;
  };

  return (
    <section className="relative px-4 sm:px-8 py-4 z-20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-600/20 text-red-500 border border-red-500/30">
            <Clock size={18} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Continuar Viendo
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                {uniqueItems.length}
              </span>
            </h2>
            <p className="text-xs text-zinc-400">Reanuda exactamente donde lo dejaste</p>
          </div>
        </div>

        {/* Scroll Controls */}
        <div className="hidden sm:flex items-center gap-1.5">
          <button
            onClick={() => scroll('left')}
            className="p-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
            title="Desplazar a la izquierda"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
            title="Desplazar a la derecha"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 pt-1 no-scrollbar scroll-smooth"
      >
        {uniqueItems.map((item) => {
          const episodeLabel = item.seasonNumber && item.episodeNumber
            ? `T${item.seasonNumber}:E${item.episodeNumber}${item.episodeTitle ? ` - ${item.episodeTitle}` : ''}`
            : null;

          return (
            <div
              key={`cw-${item.id}`}
              className="group relative flex-none w-64 sm:w-72 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-red-600/60 transition-all duration-300 shadow-xl hover:scale-[1.02]"
            >
              {/* Media Image / Backdrop Thumbnail */}
              <div className="relative aspect-video bg-zinc-950 overflow-hidden cursor-pointer" onClick={() => onPlay(item.mediaItem, item.episodeItem, item.currentTime)}>
                <img
                  src={item.backdropUrl || item.posterUrl}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(item.title, item.type || item.category || 'Cine');
                  }}
                />

                {/* Dark Overlay with Play Icon */}
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-red-500 transition-transform">
                    <Play size={22} fill="white" className="translate-x-0.5" />
                  </div>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/70 hover:bg-red-600 text-zinc-300 hover:text-white transition backdrop-blur-sm opacity-0 group-hover:opacity-100"
                  title="Quitar de Continuar Viendo"
                >
                  <X size={14} />
                </button>

                {/* Category Badge */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wider text-white border border-white/10">
                  {item.category === 'anime' ? 'ANIME' : item.type === 'series' ? 'SERIE' : 'PELÍCULA'}
                </div>

                {/* Red Netflix-style Progress Bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800">
                  <div
                    className="h-full bg-red-600 rounded-r-full shadow-[0_0_8px_rgba(220,38,38,0.8)]"
                    style={{ width: `${item.progressPercentage}%` }}
                  />
                </div>
              </div>

              {/* Card Meta Content */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white truncate" title={item.title}>
                      {item.title}
                    </h3>
                    {episodeLabel && (
                      <p className="text-xs text-red-400 font-medium truncate mt-0.5">
                        {episodeLabel}
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                      <Clock size={11} className="text-zinc-500" />
                      {formatRemainingTime(item.currentTime, item.duration)}
                    </p>
                  </div>

                  {/* Cast button */}
                  {onCast && (
                    <button
                      type="button"
                      onClick={() => onCast(item.mediaItem, item.episodeItem)}
                      className="p-2 rounded-xl bg-zinc-800/80 hover:bg-red-600 text-zinc-300 hover:text-white border border-zinc-700/60 transition shrink-0"
                      title={`Enviar a ${connectedScreenName}`}
                    >
                      <Cast size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
