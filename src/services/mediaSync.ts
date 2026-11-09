import { mediaCatalog, sampleMovies } from '../data/mediaCatalog';
import { MediaItem, Movie } from '../types';
import { tmdbService } from './tmdbService';
import { archiveService } from './archiveService';
import { generateServersForMedia } from './embedService';

const STORAGE_KEY = 'cinecast_catalog_v7';

function persistCatalog() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mediaCatalog));
    } catch (_) {}
  }
}

export const mediaSync = {
  // Sincronizar catálogo utilizando las series, anime y películas verificadas
  async syncCatalog() {
    try {
      const mergedMap = new Map<string, Movie>();

      // 1. Cargar todas las series, anime y películas base curadas
      for (const base of sampleMovies) {
        mergedMap.set(base.id, base);
      }

      // 2. Mantener elementos personalizados agregados por el usuario (excluyendo archive.org antiguo)
      for (const item of mediaCatalog.movies) {
        if (!mergedMap.has(item.id) && item.source !== 'archive.org') {
          mergedMap.set(item.id, item);
        }
      }

      mediaCatalog.movies = Array.from(mergedMap.values());
      mediaCatalog.lastUpdated = new Date().toISOString();
      persistCatalog();
      return mediaCatalog;
    } catch (err) {
      console.warn('Error syncing catalog, using curated movies:', err);
      mediaCatalog.movies = [...sampleMovies];
      return mediaCatalog;
    }
  },

  // Buscar películas en vivo en Archive.org y agregarlas al catálogo
  async searchArchiveCatalog(query: string, subject?: string): Promise<Movie[]> {
    const results = await archiveService.searchMovies(query, subject);
    if (results.length > 0) {
      const existingIds = new Set(mediaCatalog.movies.map((m) => m.id));
      for (const r of results) {
        if (!existingIds.has(r.id)) {
          mediaCatalog.movies.push(r);
          existingIds.add(r.id);
        }
      }
      mediaCatalog.lastUpdated = new Date().toISOString();
      persistCatalog();
    }
    return results;
  },

  // Convertir un Movie a MediaItem para usar con el reproductor y control remoto
  movieToMediaItem(movie: Movie): MediaItem {
    const year =
      movie.year ||
      (movie.releaseDate ? parseInt(movie.releaseDate.split('-')[0], 10) || 1968 : 1968);
    const ratingVal = movie.rating || movie.voteAverage || 7.5;
    const poster = movie.posterUrl || movie.posterPath;

    const isTV = movie.category === 'series' || movie.category === 'anime' || movie.type === 'series';

    const streamServers =
      movie.servers && movie.servers.length > 0
        ? movie.servers
        : generateServersForMedia({
            tmdbId: movie.tmdbId,
            directMp4Url: movie.streamUrl,
            type:
              movie.category === 'live_tv'
                ? 'live_tv'
                : isTV
                ? 'series'
                : 'movie',
          });

    const isIframe =
      movie.streamType === 'iframe' ||
      (streamServers.length > 0 && streamServers[0].type === 'iframe') ||
      movie.streamUrl?.includes('vidsrc') ||
      movie.streamUrl?.includes('embed') ||
      movie.streamUrl?.includes('byseraguci') ||
      movie.streamUrl?.includes('multiembed');

    return {
      id: movie.id,
      tmdbId: movie.tmdbId,
      title: movie.title,
      type: movie.type || (isTV ? 'series' : 'movie'),
      overview: movie.overview || 'Disponible en streaming directo y servidores embed.',
      year,
      ratingBadge: movie.category === 'live_tv' ? 'LIVE' : movie.category === 'anime' ? 'ANIME' : isTV ? 'SERIE' : 'ATP',
      matchScore: Math.min(99, Math.round(ratingVal * 12)),
      qualityBadge: movie.quality || 'HD',
      genres: movie.genres?.length ? movie.genres : movie.genre?.length ? movie.genre : ['Cine'],
      cast: [movie.source || 'CineCast'],
      creatorOrDirector: `Fuente: ${movie.source || 'CineCast'}`,
      posterUrl: tmdbService.getImageUrl(poster, 'w500'),
      backdropUrl: tmdbService.getImageUrl(movie.backdropPath || poster, 'original'),
      videoUrl: streamServers[0]?.url || movie.streamUrl,
      streamType: isIframe ? 'iframe' : 'mp4',
      servers: streamServers,
      category: movie.category || (movie.type === 'series' ? 'series' : 'movie'),
      seasons: movie.seasons,
      seasonsCount: movie.seasons?.length || (isTV ? 1 : undefined),
      activeServerIndex: 0,
    };
  },
};

