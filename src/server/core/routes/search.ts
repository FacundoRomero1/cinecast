import { Router } from 'express';
import {
  TMDB_URL,
  getTmdbKey,
  normalizeSearch,
  getTypoSuggestion,
  rankAndDeduplicateItems,
  type SearchableMediaItem,
} from '../tmdb.js';
import { loadServerCatalogFromDisk, type CatalogItem } from './catalog.js';
import { isCatalogMemoryEngine } from '../catalogSchema.js';
import { openCatalogDb, searchLocalCatalogFts } from '../catalogDb.js';

export interface SearchOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  userAgent?: string | undefined;
  getCatalogCache: () => CatalogItem[] | null;
  setCatalogCache: (cache: CatalogItem[]) => void;
}

interface TmdbSearchResultEntry {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

interface TmdbSearchEndpointResponse {
  results?: TmdbSearchResultEntry[];
}

export function getMediaKind(item: {
  type?: string;
  category?: string;
  mediaType?: string;
}): 'series' | 'movie' {
  if (
    item.type === 'series' ||
    item.category === 'series' ||
    item.category === 'anime' ||
    item.mediaType === 'tv'
  ) {
    return 'series';
  }
  return 'movie';
}

export function deduplicateSearchResults(items: SearchableMediaItem[]): SearchableMediaItem[] {
  const result: SearchableMediaItem[] = [];
  const seenByKindAndTmdb = new Map<string, number>();
  const seenById = new Map<string, number>();

  for (const item of items) {
    const kind = getMediaKind(item);
    const tmdbId = typeof item.tmdbId === 'number' && item.tmdbId > 0 ? item.tmdbId : null;
    const tmdbKey = tmdbId ? `${kind}:tmdb:${tmdbId}` : null;
    const idKey = item.id ? `id:${item.id}` : null;

    const isLocal = !item.notInCatalog;

    let existingIdx = -1;
    if (tmdbKey && seenByKindAndTmdb.has(tmdbKey)) {
      existingIdx = seenByKindAndTmdb.get(tmdbKey) ?? -1;
    } else if (idKey && seenById.has(idKey)) {
      existingIdx = seenById.get(idKey) ?? -1;
    }

    if (existingIdx === -1) {
      const newIdx = result.length;
      result.push(item);
      if (tmdbKey) seenByKindAndTmdb.set(tmdbKey, newIdx);
      if (idKey) seenById.set(idKey, newIdx);
    } else {
      const existing = result[existingIdx];
      if (!existing) continue;
      const existingIsLocal = !existing.notInCatalog;

      // Preferir ítem del catálogo local frente a TMDB
      if (!existingIsLocal && isLocal) {
        result[existingIdx] = {
          ...item,
          servers:
            existing.servers && existing.servers.length > (item.servers?.length || 0)
              ? existing.servers
              : item.servers,
        };
      } else if (existingIsLocal && !isLocal) {
        if ((!existing.servers || existing.servers.length === 0) && item.servers) {
          result[existingIdx] = { ...existing, servers: item.servers };
        }
      }
    }
  }

  return result;
}

export function createSearchRouter(options: SearchOptions): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();

  function loadServerCatalog(): CatalogItem[] {
    return loadServerCatalogFromDisk(baseDir, options.getCatalogCache, options.setCatalogCache);
  }

  router.get('/search', async (req, res) => {
    const rawQ = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    if (!rawQ || rawQ.length < 2) {
      res.json({ query: rawQ, total: 0, items: [] });
      return;
    }

    const qNorm = normalizeSearch(rawQ);
    let localMatches: SearchableMediaItem[] | null = null;

    if (!isCatalogMemoryEngine()) {
      try {
        const opened = openCatalogDb(baseDir, options.userDataPath);
        if (opened) {
          localMatches = searchLocalCatalogFts(opened.db, rawQ, 20);
        }
      } catch (e) {
        console.warn('[Search] Error FTS5, fallback a memoria:', e);
      }
    }

    if (!localMatches) {
      const catalog = loadServerCatalog();
      localMatches = catalog
        .filter((m) => {
          const t = normalizeSearch(m.title);
          const ot = normalizeSearch(m.originalTitle);
          const ov = normalizeSearch(m.overview);
          return t.includes(qNorm) || ot.includes(qNorm) || ov.includes(qNorm);
        })
        .slice(0, 20);
    }

    const corrected = await getTypoSuggestion(rawQ, options.userAgent);
    const searchTerms = [rawQ];
    if (corrected && normalizeSearch(corrected) !== qNorm) {
      searchTerms.push(corrected);
    }

    const tmdbRawItems: SearchableMediaItem[] = [];
    const apiKey = getTmdbKey();

    for (const term of searchTerms) {
      try {
        const endpoints = [
          `${TMDB_URL}/search/multi?api_key=${apiKey}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
          `${TMDB_URL}/search/tv?api_key=${apiKey}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
          `${TMDB_URL}/search/movie?api_key=${apiKey}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
        ];

        const responses = await Promise.allSettled(
          endpoints.map(
            (ep) =>
              fetch(ep, { signal: AbortSignal.timeout(4500) }).then(
                (r) => r.json() as Promise<TmdbSearchEndpointResponse>
              )
          )
        );

        for (const resp of responses) {
          if (resp.status !== 'fulfilled' || !Array.isArray(resp.value?.results)) continue;
          for (const item of resp.value.results) {
            if (!item.id) continue;
            const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
            if (mediaType !== 'movie' && mediaType !== 'tv') continue;
            const isTV = mediaType === 'tv';
            const rating = Number((item.vote_average || 7.0).toFixed(1));
            const title = item.title || item.name || 'Sin Título';
            const releaseDate = item.release_date || item.first_air_date || '';
            const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) || 2024 : 2024;
            const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
            const backdrop = item.backdrop_path
              ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
              : poster;

            const vidsrcCcUrl = isTV
              ? `https://vidsrc.cc/embed/tv/${item.id}/1-1?lang=es`
              : `https://vidsrc.cc/embed/movie/${item.id}?lang=es`;
            const vidsrcProUrl = isTV
              ? `https://vidsrc.pro/embed/tv/${item.id}/1/1?lang=es`
              : `https://vidsrc.pro/embed/movie/${item.id}?lang=es`;
            const tukiUrl = isTV
              ? `https://tukiplay.com/embed/tv/${item.id}/1/1`
              : `https://tukiplay.com/embed/movie/${item.id}`;
            const videasyUrl = isTV
              ? `https://player.videasy.net/tv/${item.id}/1/1`
              : `https://player.videasy.net/movie/${item.id}`;

            tmdbRawItems.push({
              id: `tmdb-${isTV ? 'series' : 'movie'}-${item.id}`,
              tmdbId: Number(item.id),
              title,
              originalTitle: item.original_title || item.original_name || title,
              originalLanguage: item.original_language || 'es',
              spokenLanguages: ['es'],
              overview: item.overview || 'Sin descripción disponible.',
              posterPath: poster,
              posterUrl: poster,
              backdropPath: backdrop,
              backdropUrl: backdrop,
              releaseDate,
              year,
              genres: ['Cine & TV'],
              voteAverage: rating,
              rating,
              quality: rating > 7.5 ? '4K Ultra HD' : '1080p HD',
              source: 'tmdb',
              category: isTV ? 'series' : 'movie',
              type: isTV ? 'series' : 'movie',
              mediaType: isTV ? 'tv' : 'movie',
              notInCatalog: true,
              servers: [
                { name: 'Vidsrc CC (Latino / ES)', url: vidsrcCcUrl, type: 'iframe', language: '🇲🇽 Latino / Español' },
                { name: 'Vidsrc Pro (HD / ES)', url: vidsrcProUrl, type: 'iframe', language: '🌐 Multi / Sub ES' },
                { name: 'TukiPlay (HD)', url: tukiUrl, type: 'iframe', language: '🇲🇽 Latino' },
                { name: 'VidEasy (Multi)', url: videasyUrl, type: 'iframe', language: '🌐 Multi / Original' },
              ],
            });
          }
        }
      } catch (_) {}
    }

    // Deduplicar respetando idioma latino y aplicar scoring estricto
    const combinedRaw: SearchableMediaItem[] = [...localMatches, ...tmdbRawItems];
    const deduplicated = deduplicateSearchResults(combinedRaw);
    const ranked = rankAndDeduplicateItems(deduplicated, rawQ, corrected || '');
    const itemsSlice = ranked.slice(0, 30);

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      query: rawQ,
      correctedQuery: corrected,
      total: ranked.length,
      items: itemsSlice,
      results: itemsSlice,
    });
  });

  return router;
}
