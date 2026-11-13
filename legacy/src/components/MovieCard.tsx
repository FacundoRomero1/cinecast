import React, { useState } from 'react';
import { Play, Info, Star, Cast, Bookmark, Check, Plus, Tv, Film } from 'lucide-react';
import { Movie } from '../types';
import { tmdbService } from '../services/tmdbService';
import { createStyledPosterFallback } from '../utils/imageUtils';

interface MovieCardProps {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onCast?: (movie: Movie) => void;
  onDetails: (movie: Movie) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: (movie: Movie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onPlay,
  onCast,
  onDetails,
  isBookmarked = false,
  onToggleBookmark,
}) => {
  const [imgError, setImgError] = useState(false);
  const posterImage = movie.posterUrl || movie.posterPath;
  const movieYear =
    movie.year ||
    (movie.releaseDate ? parseInt(movie.releaseDate.split('-')[0], 10) || 1968 : 1968);
  const movieRating = movie.rating ?? movie.voteAverage ?? 7.5;
  const movieGenres = movie.genres?.length ? movie.genres : movie.genre || [];

  return (
    <div
      onClick={() => {
        if (movie.category === 'live_tv') {
          onPlay(movie);
        } else {
          onDetails(movie);
        }
      }}
      className="cursor-pointer group relative bg-zinc-900 border border-zinc-800/80 rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.03] hover:border-red-600/60 shadow-lg flex flex-col justify-between"
    >
      {/* Poster */}
      <div className="aspect-[2/3] relative bg-zinc-950 overflow-hidden flex items-center justify-center">
        <img
          src={imgError || !posterImage ? createStyledPosterFallback(movie.title, movie.category) : tmdbService.getImageUrl(posterImage, 'w200')}
          alt={movie.title}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            if (!imgError) {
              setImgError(true);
              (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(movie.title, movie.category);
            }
          }}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
        />

        {/* Source & Category Badge (Paso 3 - CENSURA: TV vs Película explícito con icono) */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
          {movie.category === 'live_tv' ? (
            <div className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-lg animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              <span>EN VIVO</span>
            </div>
          ) : movie.category === 'anime' ? (
            <div className="px-2 py-0.5 rounded-md bg-purple-600 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md">
              <Tv className="w-3 h-3" />
              <span>ANIME</span>
            </div>
          ) : movie.category === 'series' || movie.type === 'series' ? (
            <div className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md">
              <Tv className="w-3 h-3" />
              <span>SERIE</span>
            </div>
          ) : (
            <div className="px-2 py-0.5 rounded-md bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md">
              <Film className="w-3 h-3" />
              <span>PELÍCULA</span>
            </div>
          )}

          {movie.servers && movie.servers.length > 1 && (
            <div className="px-1.5 py-0.5 rounded-md bg-zinc-900/90 text-zinc-300 border border-zinc-700 text-[9px] font-mono font-bold">
              {movie.servers.length} SERVERS
            </div>
          )}

          <div className="px-1.5 py-0.5 rounded-md bg-black/85 backdrop-blur-md border border-zinc-700/80 text-[9px] font-bold text-zinc-200 flex items-center gap-1 shadow-sm">
            {movie.originalLanguage === 'es' ? (
              <span className="text-amber-300">🇪🇸 Español</span>
            ) : (
              <span>🌐 Multi / Sub</span>
            )}
          </div>
        </div>

        {/* Bookmark Quick Action Button */}
        {onToggleBookmark && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark(movie);
            }}
            className={`absolute top-2.5 right-2.5 z-10 p-1.5 rounded-full backdrop-blur-md border transition ${
              isBookmarked
                ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/30'
                : 'bg-black/60 text-zinc-300 border-zinc-700 hover:text-white hover:bg-zinc-800'
            }`}
            title={isBookmarked ? 'Quitar de Mi Lista' : 'Guardar en Mi Lista'}
          >
            <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* Overlay en hover */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center gap-2 p-3.5"
        >
          <button
            onClick={() => onPlay(movie)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 rounded-xl text-xs font-bold text-white hover:bg-red-500 transition shadow-lg"
          >
            <Play size={15} fill="white" />
            <span>Reproducir</span>
          </button>

          {onCast && (
            <button
              onClick={() => onCast(movie)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-xs font-semibold text-zinc-100 hover:bg-red-600 hover:border-red-500 transition"
            >
              <Cast size={14} />
              <span>Enviar a TV</span>
            </button>
          )}

          {onToggleBookmark && (
            <button
              onClick={() => onToggleBookmark(movie)}
              className={`w-full flex items-center justify-center gap-1.5 px-4 py-1.5 border rounded-xl text-xs font-semibold transition ${
                isBookmarked
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
              <span>{isBookmarked ? 'En Mi Lista' : '+ Mi Lista'}</span>
            </button>
          )}

          <button
            onClick={() => onDetails(movie)}
            className="w-full flex items-center justify-center gap-2 px-4 py-1.5 bg-zinc-900/90 border border-zinc-700 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
          >
            <Info size={14} />
            <span>Más info</span>
          </button>
        </div>
      </div>

      {/* Info + Quick Mobile Action */}
      <div className="p-3.5 flex-1 flex flex-col justify-between bg-zinc-900">
        <div>
          <h3 className="font-bold text-sm text-white line-clamp-1" title={movie.title}>
            {movie.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">{movieYear}</span>
            {movieRating > 0 && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  <Star size={12} fill="currentColor" />
                  {movieRating.toFixed(1)}
                </span>
              </>
            )}
            <span>•</span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
              {movie.quality || '720p'}
            </span>
          </div>
          {movieGenres.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {movieGenres.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-400"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Always-visible mobile action row so phones don't need hover */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center gap-1.5 sm:hidden"
        >
          <button
            onClick={() => onPlay(movie)}
            className="flex-1 py-1.5 px-2 rounded-lg bg-red-600 text-white text-[11px] font-bold flex items-center justify-center gap-1"
          >
            <Play size={12} fill="white" />
            <span>Reproducir</span>
          </button>
          <button
            onClick={() => onDetails(movie)}
            className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300"
          >
            <Info size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
