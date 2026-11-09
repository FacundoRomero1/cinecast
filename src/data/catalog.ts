import { MediaItem } from '../types';
import { sampleMovies, createMovieServers, createSeriesServers } from './mediaCatalog';

export const MEDIA_CATALOG: MediaItem[] = sampleMovies.map((m) => {
  const isSeries = m.type === 'series';
  const isFeatured = m.id === 'deadpool-wolverine';
  const servers = isSeries
    ? createSeriesServers(m.tmdbId, 1, 1)
    : createMovieServers(m.tmdbId);

  return {
    id: m.id,
    tmdbId: m.tmdbId,
    title: m.title,
    type: m.type || (m.category === 'series' || m.category === 'anime' ? 'series' : 'movie'),
    category: m.category || (m.type === 'series' ? 'series' : 'movie'),
    overview: m.overview,
    year: m.year || 2024,
    ratingBadge: m.category === 'anime' ? 'ANIME' : isSeries ? 'SERIE' : '4K',
    matchScore: Math.min(99, Math.round((m.rating || 8.5) * 11.2)),
    qualityBadge: m.quality || '4K Ultra HD',
    genres: m.genres,
    cast: ['CineCast VIP'],
    creatorOrDirector: 'TMDB Oficial',
    posterUrl: m.posterUrl || m.posterPath,
    backdropUrl: m.backdropUrl || m.backdropPath,
    videoUrl: servers[0]?.url || `https://vidsrc.cc/v2/embed/${isSeries ? 'tv' : 'movie'}/${m.tmdbId}`,
    streamType: 'iframe',
    servers,
    featured: isFeatured,
    seasonsCount: m.seasonsCount || (isSeries ? 1 : undefined),
    episodes: isSeries
      ? Array.from({ length: 4 }, (_, i) => ({
          id: `${m.id}-s1-e${i + 1}`,
          seasonNumber: 1,
          episodeNumber: i + 1,
          title: `Episodio ${i + 1}`,
          overview: `Capítulo ${i + 1} de ${m.title}. Disponible en servidores multi-idioma HD.`,
          duration: '45 min',
          durationSeconds: 2700,
          thumbnailUrl: m.backdropUrl || m.posterUrl || '',
          videoUrl: `https://vidsrc.cc/v2/embed/tv/${m.tmdbId}/1/${i + 1}`,
        }))
      : undefined,
  };
});

export const CATEGORIES = [
  { id: 'all', label: 'Inicio' },
  { id: 'series', label: 'Series' },
  { id: 'movies', label: 'Películas' },
  { id: 'scifi', label: 'Ciencia Ficción' },
  { id: 'action', label: 'Acción' },
  { id: 'my-list', label: 'Mi Lista' },
];
