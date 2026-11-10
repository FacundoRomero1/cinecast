import type { CardItem, MediaDetailItem } from '../providers/types';
import { mediaSync } from '../services/mediaSync';
import type { MediaItem, Movie, StreamServer } from '../types';

function toCategory(
  category: string,
  type: string
): 'movie' | 'series' | 'anime' | 'live_tv' {
  if (category === 'anime') return 'anime';
  if (category === 'live_tv') return 'live_tv';
  if (category === 'series' || type === 'series') return 'series';
  return 'movie';
}

function isStreamType(val: string | undefined): val is 'mp4' | 'iframe' | 'hls' {
  return val === 'mp4' || val === 'iframe' || val === 'hls';
}

function mapDetailServers(
  detail?: MediaDetailItem | null
): StreamServer[] | undefined {
  if (!detail?.servers || detail.servers.length === 0) return undefined;
  const mapped: StreamServer[] = [];
  for (const s of detail.servers) {
    if (!s.url) continue;
    mapped.push({
      name: s.name || 'Servidor',
      url: s.url,
      type: isStreamType(s.type) ? s.type : 'iframe',
      language: s.language,
    });
  }
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Reutiliza la lógica exacta de la UI clásica (`MovieGrid.tsx:473,708` -> `mediaSync.movieToMediaItem`
 * en `src/services/mediaSync.ts:64-118`) para convertir un `CardItem` (y opcionalmente `MediaDetailItem`)
 * en un `MediaItem` completo listo para `<DetailModal>`, `handlePlayLocal` y `handleCastMediaToScreen`.
 */
export function toMediaItem(
  card: CardItem,
  detail?: MediaDetailItem | null
): MediaItem {
  const category = toCategory(
    detail?.category || card.category,
    detail?.type || card.type
  );
  const isSeries = category === 'series' || category === 'anime';
  const overview =
    detail?.overview && detail.overview.trim().length > 0
      ? detail.overview
      : '';
  const servers = mapDetailServers(detail);

  const movie: Movie = {
    id: card.id,
    tmdbId: card.tmdbId,
    title: detail?.title || card.title,
    originalTitle: detail?.originalTitle || card.title,
    overview,
    posterPath: card.posterUrl,
    posterUrl: card.posterUrl,
    backdropPath: card.backdropUrl || card.posterUrl,
    backdropUrl: card.backdropUrl || card.posterUrl,
    releaseDate: detail?.releaseDate || `${card.year}-01-01`,
    year: detail?.year || card.year,
    genres: detail?.genres && detail.genres.length > 0 ? detail.genres : card.genres,
    runtime: typeof detail?.runtime === 'number' ? detail.runtime : undefined,
    voteAverage: detail?.rating ?? card.rating,
    rating: detail?.rating ?? card.rating,
    streamUrl: servers?.[0]?.url || '',
    quality: detail?.quality || card.quality,
    source: 'tmdb',
    streamType: 'iframe',
    servers,
    category,
    type: isSeries ? 'series' : 'movie',
    seasonsCount: detail?.numberOfSeasons,
  };

  const item = mediaSync.movieToMediaItem(movie);

  if (detail?.cast && detail.cast.length > 0) {
    item.cast = detail.cast.map((c) => c.name).filter((n) => n.length > 0);
  }
  if (detail?.director && detail.director.trim().length > 0) {
    item.creatorOrDirector = detail.director;
  }

  // Garantizar que series y anime reciban temporadas y episodios equivalentes al catálogo clásico
  if (isSeries) {
    item.seasonsCount = detail?.numberOfSeasons || movie.seasonsCount || item.seasonsCount || 1;
    if (!item.episodes || item.episodes.length === 0) {
      const tmdbId = item.tmdbId || card.tmdbId || 0;
      item.episodes = Array.from({ length: 4 }, (_, i) => ({
        id: `${item.id}-s1-e${i + 1}`,
        seasonNumber: 1,
        episodeNumber: i + 1,
        title: `Episodio ${i + 1}`,
        overview: `Capítulo ${i + 1} de ${item.title}. Disponible en servidores multi-idioma HD.`,
        duration: '45 min',
        durationSeconds: 2700,
        thumbnailUrl: item.backdropUrl || item.posterUrl || '',
        videoUrl: `https://vidsrc.cc/v2/embed/tv/${tmdbId}/1/${i + 1}`,
      }));
    }
  }

  return item;
}
