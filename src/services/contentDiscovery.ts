import { Movie } from '../types';

export const contentDiscovery = {
  // Descubrir películas de Archive.org (dominio público) a través del proxy anti-CORS del servidor
  async discoverFromArchiveOrg(query: string): Promise<Movie[]> {
    try {
      const response = await fetch(
        `/api/archive/search?q=${encodeURIComponent(query || 'classic')}&rows=12`
      );
      if (!response.ok) return [];
      const data = await response.json();
      const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];

      return docs
        .filter((item: any) => item && item.identifier && item.title)
        .map((item: any, idx: number) => {
          const cleanDesc =
            typeof item.description === 'string'
              ? item.description.replace(/<[^>]*>/g, '').slice(0, 260)
              : Array.isArray(item.description)
              ? String(item.description[0] || '').replace(/<[^>]*>/g, '').slice(0, 260)
              : 'Película de dominio público disponible en Internet Archive.';

          return {
            id: `archive-${item.identifier}`,
            tmdbId: 90000 + idx,
            title: Array.isArray(item.title) ? item.title[0] : String(item.title),
            overview: cleanDesc,
            posterPath: `https://archive.org/services/img/${item.identifier}`,
            backdropPath: `https://archive.org/services/img/${item.identifier}`,
            releaseDate: item.year ? `${item.year}-01-01` : '1960-01-01',
            genres: ['Dominio Público', 'Cine Clásico'],
            runtime: 90,
            voteAverage: 7.5,
            streamUrl: `https://archive.org/download/${item.identifier}/${item.identifier}_512kb.mp4`,
            quality: '720p',
            source: 'archive.org',
            addedAt: new Date().toISOString(),
          };
        });
    } catch (err) {
      console.warn('Error discovering from Archive.org:', err);
      return [];
    }
  },

  // Resolver el archivo .mp4 exacto de un item de Archive.org
  async resolveArchiveStreamUrl(movie: Movie): Promise<string> {
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

  // Verificar si un enlace de video funciona
  async verifyStreamUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  },
};
