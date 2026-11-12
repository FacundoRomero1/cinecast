import React from 'react';
import { Info, Play, Star, Tv } from 'lucide-react';
import type { CardItem } from '../providers/types';
import { getPosterProxyUrl } from './liteMode';

export interface HeroProps {
  item: CardItem | null;
  overview?: string | undefined;
  onPlay: (item: CardItem) => void;
  onCast?: ((item: CardItem) => void) | undefined;
  connectedScreenName?: string | undefined;
  onMoreInfo: (item: CardItem) => void;
}

export const Hero: React.FC<HeroProps> = ({
  item,
  overview,
  onPlay,
  onCast,
  connectedScreenName,
  onMoreInfo,
}) => {
  if (!item) return null;

  const isSeries =
    item.type === 'series' || item.category === 'series' || item.category === 'anime';
  const coverUrl = getPosterProxyUrl(item.backdropUrl || item.posterUrl, 342);
  const shortSynopsis =
    overview && overview.trim().length > 0
      ? overview
      : `${item.title} (${item.year}) • ${item.genres.join(', ') || 'Destacado en CineCast'} • Calidad ${item.quality}`;

  return (
    <section
      aria-label={`Destacado: ${item.title}`}
      className="relative w-full min-h-[380px] sm:min-h-[460px] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800/80 mb-6 flex items-end"
    >
      {coverUrl && (
        <img
          src={coverUrl}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover object-center opacity-55"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/75 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/50 to-transparent" />

      <div className="relative z-10 p-5 sm:p-8 md:p-10 max-w-2xl flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span
            className={`px-2 py-0.5 rounded uppercase tracking-wider ${
              isSeries
                ? 'bg-blue-600/90 text-white'
                : 'bg-emerald-600/90 text-white'
            }`}
          >
            {isSeries ? 'SERIE' : 'PELÍCULA'}
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-800/90 text-zinc-200">{item.year}</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800/90 text-amber-400">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            {item.rating.toFixed(1)}
          </span>
          {item.genres.slice(0, 3).map((g) => (
            <span key={g} className="text-zinc-300 font-medium">
              • {g}
            </span>
          ))}
        </div>

        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-tight">
          {item.title}
        </h1>

        <p className="text-xs sm:text-sm text-zinc-300 line-clamp-3 leading-relaxed">
          {shortSynopsis}
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            tabIndex={0}
            onClick={() => onPlay(item)}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm inline-flex items-center justify-center gap-2 shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Reproducir</span>
          </button>

          {onCast && (
            <button
              type="button"
              tabIndex={0}
              onClick={() => onCast(item)}
              className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-red-500/40 font-bold text-sm inline-flex items-center justify-center gap-2 shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <Tv className="w-4 h-4 text-red-500" />
              <span>Enviar a {connectedScreenName || 'PC'}</span>
            </button>
          )}

          <button
            type="button"
            tabIndex={0}
            onClick={() => onMoreInfo(item)}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 font-semibold text-sm inline-flex items-center justify-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <Info className="w-4 h-4" />
            <span>Más info</span>
          </button>
        </div>
      </div>
    </section>
  );
};
