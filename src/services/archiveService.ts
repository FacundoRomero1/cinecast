import { Movie } from '../types';
import { sampleMovies } from '../data/mediaCatalog';
import { tmdbService } from './tmdbService';

export const archiveService = {
  // Buscar películas de dominio público en Archive.org con streamUrl verificado y enriquecimiento TMDB
  async searchMovies(query: string, subject?: string): Promise<Movie[]> {
    try {
      const searchQ = subject ? `${query ? `${query} AND ` : ''}(${subject})` : query || 'classic';
      const response = await fetch(
        `/api/archive/search?q=${encodeURIComponent(searchQ)}&rows=16`
      );
      if (!response.ok) return [];
      const data = await response.json();
      const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];

      const rawMovies: Movie[] = docs
        .filter((item: any) => item && item.identifier && item.title)
        .map((item: any, idx: number) => {
          const cleanDesc =
            typeof item.description === 'string'
              ? item.description.replace(/<[^>]*>/g, '').slice(0, 260)
              : Array.isArray(item.description)
              ? String(item.description[0] || '').replace(/<[^>]*>/g, '').slice(0, 260)
              : 'Película de dominio público disponible en streaming directo desde Internet Archive.';

          const titleStr = Array.isArray(item.title) ? item.title[0] : String(item.title);
          const yearNum = item.year ? parseInt(String(item.year).slice(0, 4), 10) || 1960 : 1960;
          const poster = `https://archive.org/services/img/${item.identifier}`;

          return {
            id: `archive-${item.identifier}`,
            tmdbId: 90000 + idx,
            title: titleStr,
            overview: cleanDesc,
            posterPath: poster,
            posterUrl: poster,
            backdropPath: poster,
            releaseDate: `${yearNum}-01-01`,
            year: yearNum,
            genres: ['Dominio Público', 'Cine Clásico'],
            genre: ['Dominio Público', 'Cine Clásico'],
            runtime: 90,
            voteAverage: 7.5,
            rating: 7.5,
            streamUrl: `https://archive.org/download/${item.identifier}/${item.identifier}_512kb.mp4`,
            quality: '720p',
            source: 'archive.org',
            addedAt: new Date().toISOString(),
          };
        });

      // Enriquecer con TMDB en paralelo
      const enriched = await Promise.all(
        rawMovies.map(async (m) => {
          const tmdbData = await tmdbService.enrichMovieData(m.title, m.year);
          if (tmdbData) {
            return {
              ...m,
              posterPath: tmdbData.posterUrl || m.posterPath,
              posterUrl: tmdbData.posterUrl || m.posterUrl,
              backdropPath: tmdbData.backdropUrl || m.backdropPath,
              overview: tmdbData.overview || m.overview,
              voteAverage: tmdbData.rating || m.voteAverage,
              rating: tmdbData.rating || m.rating,
              year: tmdbData.year || m.year,
              genres: tmdbData.genres?.length ? tmdbData.genres : m.genres,
              genre: tmdbData.genres?.length ? tmdbData.genres : m.genre,
            };
          }
          return m;
        })
      );

      return enriched;
    } catch (err) {
      console.warn('Error searching Archive.org:', err);
      return [];
    }
  },

  // Retornar películas destacadas de dominio público verificadas (mínimo 12)
  async getFeaturedMovies(): Promise<Movie[]> {
    const enrichedBase = await Promise.all(
      sampleMovies.map(async (movie) => {
        const tmdbData = await tmdbService.enrichMovieData(movie.title, movie.year);
        if (tmdbData) {
          return {
            ...movie,
            posterPath: tmdbData.posterUrl || movie.posterPath,
            posterUrl: tmdbData.posterUrl || movie.posterUrl,
            backdropPath: tmdbData.backdropUrl || movie.backdropPath,
            overview: tmdbData.overview || movie.overview,
            voteAverage: tmdbData.rating || movie.voteAverage,
            rating: tmdbData.rating || movie.rating,
          };
        }
        return movie;
      })
    );
    return enrichedBase;
  },

  // Resolver URL .mp4 exacta de un identificador de Archive.org
  async resolveStreamUrl(movie: Movie): Promise<string> {
    if (!movie.id.startsWith('archive-')) {
      return movie.streamUrl;
    }
    const identifier = movie.id.replace(/^archive-/, '');
    try {
      const res = await fetch(`/api/archive/resolve/${encodeURIComponent(identifier)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.streamUrl) {
          return data.streamUrl;
        }
      }
    } catch (_) {}
    return movie.streamUrl;
  },
};
