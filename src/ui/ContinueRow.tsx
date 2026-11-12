import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Play, Cast, X, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem, Episode, MediaType } from '../types';
import type { WatchProgressItem } from '../services/watchHistoryService';
import { createStyledPosterFallback } from '../utils/imageUtils';

export interface ContinueRowProps {
  items: WatchProgressItem[];
  onPlay: (mediaItem: MediaItem, episodeItem?: Episode | null, initialTime?: number) => void;
  onCast?: (mediaItem: MediaItem, episodeItem?: Episode | null, initialTime?: number) => void;
  onRemove: (id: string) => void;
  connectedScreenName?: string;
}

export const ContinueRow: React.FC<ContinueRowProps> = ({
  items,
  onPlay,
  onCast,
  onRemove,
  connectedScreenName = 'PC',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [catalogCards, setCatalogCards] = useState<
    Record<string, { posterUrl?: string; backdropUrl?: string }>
  >({});

  if (!items || items.length === 0) return null;

  // Deduplicar: exactamente una sola entrada por serie (la más reciente o de mayor capítulo)
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    const res: WatchProgressItem[] = [];
    for (const item of items) {
      const isSeries =
        item.type === 'series' ||
        item.category === 'series' ||
        item.category === 'anime' ||
        Boolean(item.seasonNumber);
      const key = isSeries
        ? item.mediaItem?.tmdbId
          ? `tmdb_${item.mediaItem.tmdbId}`
          : (item.mediaId || item.id).replace(/_s\d+_e\d+$/, '').toLowerCase()
        : item.mediaId || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        res.push(item);
      }
    }
    return res;
  }, [items]);

  useEffect(() => {
    if (uniqueItems.length === 0) return;
    const ids = Array.from(
      new Set(
        uniqueItems
          .map((i) => i.mediaId || i.mediaItem?.id || i.id)
          .filter(Boolean)
          .map((id) => id.replace(/_s\d+_e\d+$/, ''))
      )
    );
    if (ids.length === 0) return;

    let cancelled = false;
    fetch(`/api/catalog?ids=${encodeURIComponent(ids.join(','))}&fields=card`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.items)) return;
        const map: Record<string, { posterUrl?: string; backdropUrl?: string }> = {};
        for (const it of d.items) {
          if (it.id) {
            map[it.id] = { posterUrl: it.posterUrl, backdropUrl: it.backdropUrl };
          }
          if (it.tmdbId) {
            map[String(it.tmdbId)] = { posterUrl: it.posterUrl, backdropUrl: it.backdropUrl };
            map[`tmdb-movie-${it.tmdbId}`] = { posterUrl: it.posterUrl, backdropUrl: it.backdropUrl };
            map[`tmdb-anime-${it.tmdbId}`] = { posterUrl: it.posterUrl, backdropUrl: it.backdropUrl };
            map[`tmdb-series-${it.tmdbId}`] = { posterUrl: it.posterUrl, backdropUrl: it.backdropUrl };
          }
        }
        setCatalogCards(map);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [uniqueItems]);

  const resolveSafeImage = (item: WatchProgressItem) => {
    const rawId = (item.mediaId || item.id).replace(/_s\d+_e\d+$/, '');
    const fromCat =
      catalogCards[rawId] ||
      catalogCards[item.mediaId] ||
      catalogCards[item.id] ||
      (item.mediaItem?.tmdbId ? catalogCards[String(item.mediaItem.tmdbId)] : undefined);
    const candidateBackdrop = fromCat?.backdropUrl || item.backdropUrl;
    const candidatePoster = fromCat?.posterUrl || item.posterUrl;

    const isSafe = (url?: string) =>
      Boolean(
        url &&
          typeof url === 'string' &&
          !url.includes('unsplash.com') &&
          (url.startsWith('http') || url.startsWith('data:image'))
      );

    if (isSafe(candidateBackdrop)) return candidateBackdrop!;
    if (isSafe(candidatePoster)) return candidatePoster!;
    return createStyledPosterFallback(item.title, item.type || item.category || 'Cine');
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -320 : 320;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const formatRemainingTime = (currentTime: number, duration: number) => {
    if (!duration || duration <= 0) return '';
    const remaining = Math.max(0, duration - currentTime);
    const mins = Math.ceil(remaining / 60);
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h} h ${m} min restantes`;
    }
    return `${mins} min restantes`;
  };

  return (
    <section className="relative px-4 sm:px-8 py-4 z-cc-content">
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

        {/* Controles de desplazamiento para escritorio */}
        <div className="hidden sm:flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition min-w-[36px] min-h-[36px]"
            title="Desplazar a la izquierda"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition min-w-[36px] min-h-[36px]"
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
        {uniqueItems.map((item, idx) => {
          const matchContradict = item.episodeTitle ? String(item.episodeTitle).match(/^episodio\s+(\d+)$/i) : null;
          const isContradictory = matchContradict && Number(matchContradict[1]) !== Number(item.episodeNumber);
          const hasGenericName = Boolean(matchContradict);
          const cleanName = (item.episodeTitle && !hasGenericName && !isContradictory) ? item.episodeTitle.trim() : null;

          let episodeLabel: string | null = null;
          if (item.seasonNumber && item.episodeNumber) {
            episodeLabel = cleanName
              ? `T${item.seasonNumber}:E${item.episodeNumber} · ${cleanName}`
              : `T${item.seasonNumber}:E${item.episodeNumber}`;
          } else if (item.episodeNumber) {
            episodeLabel = cleanName
              ? `Episodio ${item.episodeNumber} · ${cleanName}`
              : `Episodio ${item.episodeNumber}`;
          }

          const isSeries =
            item.type === 'series' ||
            item.category === 'series' ||
            item.category === 'anime' ||
            Boolean(item.seasonNumber) ||
            Boolean(item.episodeNumber);

          const effectiveEp: Episode | null = isSeries && item.episodeNumber != null
            ? {
                id: item.episodeItem?.id || `${item.mediaItem?.id || item.id}-s${item.seasonNumber || 1}-e${item.episodeNumber}`,
                title: cleanName || `Episodio ${item.episodeNumber}`,
                overview: item.episodeItem?.overview || `Temporada ${item.seasonNumber || 1}, Episodio ${item.episodeNumber}`,
                seasonNumber: item.seasonNumber || 1,
                episodeNumber: item.episodeNumber,
                durationSeconds: item.duration,
              }
            : (item.episodeItem || null);

          const baseMedia: MediaItem = item.mediaItem || {
            id: item.mediaId || item.id,
            title: item.title,
            type: ((item.type === 'series' || isSeries) ? 'series' : 'movie') as MediaType,
            category: item.category,
            overview: item.title,
            year: new Date().getFullYear(),
            ratingBadge: '13+',
            matchScore: 98,
            genres: [],
            cast: [],
            creatorOrDirector: '',
            posterUrl: item.posterUrl || '',
            backdropUrl: item.backdropUrl || '',
          };

          const mediaPayload: MediaItem = {
            ...baseMedia,
            id: item.mediaItem?.id || item.mediaId || item.id,
            title: item.title,
            type: ((item.type === 'series' || isSeries) ? 'series' : 'movie') as MediaType,
            category: item.category,
            posterUrl: item.posterUrl || baseMedia.posterUrl,
            backdropUrl: item.backdropUrl || baseMedia.backdropUrl,
          };

          return (
            <div
              key={`cw-${item.id}-${idx}`}
              role="button"
              tabIndex={0}
              onClick={() => onPlay(mediaPayload, effectiveEp, item.currentTime)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPlay(mediaPayload, effectiveEp, item.currentTime);
                }
              }}
              className="group relative flex-none w-64 sm:w-72 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-red-600/60 transition-all duration-300 shadow-xl cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {/* Contenedor de Imagen y Overlay */}
              <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                <img
                  src={resolveSafeImage(item)}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(
                      item.title,
                      item.type || item.category || 'Cine'
                    );
                  }}
                />

                {/* Overlay con Círculo de Play central tocable */}
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-colors flex items-center justify-center">
                  <div
                    data-testid="continue-play"
                    className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-red-500 transition-transform"
                  >
                    <Play size={22} fill="white" className="translate-x-0.5" />
                  </div>
                </div>

                {/* Botón para quitar de la lista (44x44 px) */}
                <button
                  type="button"
                  aria-label="Quitar de Continuar Viendo"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  className="absolute top-1.5 right-1.5 min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-red-600 text-zinc-300 hover:text-white transition backdrop-blur-sm flex items-center justify-center"
                  title="Quitar de Continuar Viendo"
                >
                  <X size={16} />
                </button>

                {/* Badge de Categoría */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wider text-white border border-white/10">
                  {item.category === 'anime' ? 'ANIME' : item.type === 'series' ? 'SERIE' : 'PELÍCULA'}
                </div>

                {/* Barra de Progreso */}
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800">
                  <div
                    className="h-full bg-red-600 rounded-r-full shadow-[0_0_8px_rgba(220,38,38,0.8)]"
                    style={{ width: `${item.progressPercentage}%` }}
                  />
                </div>
              </div>

              {/* Metadatos y Botón Cast */}
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

                  {/* Botón Cast (44x44 px) */}
                  {onCast && (
                    <button
                      type="button"
                      data-testid="continue-cast"
                      aria-label={`Enviar ${item.title} a ${connectedScreenName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCast(mediaPayload, effectiveEp, item.currentTime);
                      }}
                      className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-zinc-800/90 hover:bg-red-600 text-zinc-300 hover:text-white border border-zinc-700/60 transition shrink-0 flex items-center justify-center active:scale-95"
                      title={`Enviar a ${connectedScreenName}`}
                    >
                      <Cast size={18} />
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
