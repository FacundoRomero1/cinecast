import React, { useState } from 'react';
import { MediaItem } from '../types';
import { Play, Info, Tv, Volume2, VolumeX, Sparkles } from 'lucide-react';
import { createStyledPosterFallback } from '../utils/imageUtils';

interface HeroBannerProps {
  media: MediaItem;
  onPlayLocal: (media: MediaItem) => void;
  onCastToScreen: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  connectedScreenName?: string;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media,
  onPlayLocal,
  onCastToScreen,
  onOpenDetails,
  connectedScreenName = 'PC Dormitorio',
}) => {
  return (
    <div className="relative w-full pt-28 sm:pt-32 min-h-[580px] sm:min-h-[640px] h-[78vh] sm:h-[85vh] overflow-hidden select-none">
      {/* Background Backdrop Image */}
      <img
        src={media.backdropUrl}
        alt={media.title}
        className="absolute inset-0 w-full h-full object-cover object-center filter brightness-75 scale-100 transition duration-700 hover:scale-105"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(media.title, media.category);
        }}
      />

      {/* Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/60 to-transparent w-full sm:w-2/3" />

      {/* Content */}
      <div className="absolute bottom-8 sm:bottom-16 left-4 sm:left-12 max-w-2xl space-y-4 z-10 pt-20">
        {/* Original Badge */}
        {media.isOriginal && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600/30 border border-red-500/40 text-red-400 text-xs font-bold tracking-wider uppercase font-mono backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            CineCast Original
          </div>
        )}

        <h1 className="text-3xl sm:text-6xl font-black text-white tracking-tight drop-shadow-xl font-display leading-tight">
          {media.title}
        </h1>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
          <span className="text-emerald-400 font-extrabold">{media.matchScore}% de coincidencia</span>
          <span className="text-zinc-300">{media.year}</span>
          <span className="px-1.5 py-0.5 rounded border border-zinc-500 text-zinc-200 font-bold text-[11px]">
            {media.ratingBadge}
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-900/80 text-zinc-300 font-semibold text-[11px] border border-zinc-800">
            {media.qualityBadge}
          </span>
          <span className="text-zinc-400 hidden sm:inline">•</span>
          <span className="text-zinc-300 hidden sm:inline">{media.genres.slice(0, 3).join(', ')}</span>
        </div>

        <p className="text-xs sm:text-base text-zinc-300 line-clamp-3 leading-relaxed drop-shadow max-w-xl">
          {media.overview}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={() => onPlayLocal(media)}
            className="px-6 py-2.5 sm:py-3 bg-white hover:bg-zinc-200 text-black rounded-xl font-bold text-sm sm:text-base transition flex items-center gap-2 shadow-xl hover:scale-105"
          >
            <Play className="w-5 h-5 fill-current" />
            Reproducir
          </button>

          <button
            onClick={() => onCastToScreen(media)}
            className="px-5 py-2.5 sm:py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm sm:text-base transition flex items-center gap-2 shadow-xl shadow-red-600/30 hover:scale-105"
          >
            <Tv className="w-5 h-5" />
            Enviar a {connectedScreenName}
          </button>

          <button
            onClick={() => onOpenDetails(media)}
            className="px-4 py-2.5 sm:py-3 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-xl font-semibold text-sm sm:text-base transition flex items-center gap-2 border border-zinc-700/80 backdrop-blur-md"
          >
            <Info className="w-5 h-5" />
            Más información
          </button>
        </div>
      </div>
    </div>
  );
};
