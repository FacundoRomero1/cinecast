import React, { useEffect, useState } from 'react';
import { X, Star, ExternalLink, Film, Tv } from 'lucide-react';
import type { CardItem, MediaDetailItem } from '../providers/types';
import { localCatalogProvider } from '../providers/localCatalogProvider';

export interface TitleSheetProps {
  item: CardItem | null;
  onClose: () => void;
  onSwitchToClassic: () => void;
}

export const TitleSheet: React.FC<TitleSheetProps> = ({
  item,
  onClose,
  onSwitchToClassic,
}) => {
  const [detail, setDetail] = useState<MediaDetailItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    localCatalogProvider
      .getDetail(item.category || item.type, item.tmdbId || item.id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  const isSeries =
    item.type === 'series' || item.category === 'series' || item.category === 'anime';
  const synopsis =
    detail?.overview && detail.overview.trim().length > 0
      ? detail.overview
      : loading
      ? 'Cargando sinopsis y detalles...'
      : 'Sin descripción disponible para este título.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ficha de ${item.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-56 sm:h-64 bg-zinc-900">
          {(item.backdropUrl || item.posterUrl) && (
            <img
              src={item.backdropUrl || item.posterUrl}
              alt={item.title}
              className="w-full h-full object-cover opacity-60"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

          <button
            type="button"
            tabIndex={0}
            aria-label="Cerrar ficha"
            onClick={onClose}
            className="absolute top-3 right-3 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="absolute bottom-4 left-5 right-5 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span
                className={`px-2 py-0.5 rounded inline-flex items-center gap-1 uppercase ${
                  isSeries ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {isSeries ? <Tv className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                {isSeries ? 'SERIE' : 'PELÍCULA'}
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200">{item.year}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-amber-400">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {item.rating.toFixed(1)}
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{item.quality}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white">{item.title}</h2>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          {item.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.genres.map((g) => (
                <span
                  key={g}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-medium"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          <p className="text-sm text-zinc-300 leading-relaxed">{synopsis}</p>

          {detail?.director && (
            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">Dirección:</strong> {detail.director}
            </p>
          )}

          <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              tabIndex={0}
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Cerrar
            </button>
            <button
              type="button"
              tabIndex={0}
              onClick={onSwitchToClassic}
              className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-2 shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Abrir en vista clásica</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
