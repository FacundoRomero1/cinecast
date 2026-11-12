import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { TMDB_URL, getTmdbKey, extractTmdbId } from '../tmdb.js';
import { loadServerCatalogFromDisk, type CatalogItem } from './catalog.js';
import { isCatalogMemoryEngine } from '../catalogSchema.js';
import { findCatalogItemInDb, openCatalogDb } from '../catalogDb.js';

export interface TmdbDetailOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  mediaCacheDir: string;
  getCatalogCache: () => CatalogItem[] | null;
  setCatalogCache: (cache: CatalogItem[]) => void;
}

interface TmdbGenre {
  name?: string;
}

interface TmdbCrewMember {
  job?: string;
  name?: string;
}

interface TmdbCastMember {
  name?: string;
  character?: string;
  profile_path?: string | null;
}

interface TmdbVideo {
  site?: string;
  type?: string;
  key?: string;
}

interface TmdbRecommendation {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

interface TmdbSeason {
  season_number?: number;
  name?: string;
  episode_count?: number;
  poster_path?: string | null;
}

interface TmdbEpisode {
  id?: number;
  season_number?: number;
  episode_number?: number;
  name?: string;
  overview?: string;
  runtime?: number;
  still_path?: string | null;
  vote_average?: number;
}

interface TmdbCollectionPart {
  id?: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  vote_average?: number;
}

interface TmdbCollectionResponse {
  id?: number;
  name?: string;
  poster_path?: string | null;
  parts?: TmdbCollectionPart[];
}

interface TmdbDetailResponse {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  genres?: TmdbGenre[];
  vote_average?: number;
  runtime?: number;
  episode_run_time?: number[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  created_by?: Array<{ name?: string }>;
  credits?: {
    crew?: TmdbCrewMember[];
    cast?: TmdbCastMember[];
  };
  videos?: {
    results?: TmdbVideo[];
  };
  belongs_to_collection?: {
    id?: number;
  } | null;
  recommendations?: {
    results?: TmdbRecommendation[];
  };
  seasons?: TmdbSeason[];
  number_of_episodes?: number;
}

interface TmdbSeasonDetailResponse {
  episodes?: TmdbEpisode[];
}

export interface TvEpisodePayload {
  id: number | string;
  season: number;
  season_number: number;
  episode: number;
  episode_number: number;
  title: string;
  name: string;
  overview: string;
  duration: string;
  runtime?: number;
  stillUrl: string | null;
  still_path: string | null;
  voteAverage: number;
}

export function formatSeasonEpisodes(
  rawEpisodes: Array<{
    id?: number | string;
    name?: string;
    title?: string;
    season_number?: number;
    season?: number;
    episode_number?: number;
    episode?: number;
    overview?: string;
    runtime?: number;
    still_path?: string | null;
    stillUrl?: string | null;
    vote_average?: number;
    voteAverage?: number;
  }>,
  seasonNumber: number = 1
): TvEpisodePayload[] {
  return (rawEpisodes || []).map((e) => {
    const sNum = e.season_number ?? e.season ?? seasonNumber;
    const epNum = e.episode_number ?? e.episode ?? 1;
    const epName = e.name || e.title || `Episodio ${epNum}`;
    const still = e.still_path || (e.stillUrl ? e.stillUrl.replace(/^https?:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '') : null);
    const stillUrl = e.stillUrl || (e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null);
    const voteAvg = Number((e.vote_average ?? e.voteAverage ?? 7.0).toFixed(1));

    return {
      id: e.id ?? `ep-${sNum}-${epNum}`,
      season: sNum,
      season_number: sNum,
      episode: epNum,
      episode_number: epNum,
      title: epName,
      name: epName,
      overview: e.overview || '',
      duration: e.runtime ? `${e.runtime}m` : '24m',
      runtime: e.runtime,
      stillUrl,
      still_path: still,
      voteAverage: voteAvg,
    };
  });
}

export function createTmdbDetailRouter(options: TmdbDetailOptions): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();
  const mediaCacheDir = options.mediaCacheDir;

  try {
    fs.mkdirSync(mediaCacheDir, { recursive: true });
  } catch (_) {}

  function loadServerCatalog(): CatalogItem[] {
    return loadServerCatalogFromDisk(baseDir, options.getCatalogCache, options.setCatalogCache);
  }

  router.get('/media/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const cleanType = type === 'series' || type === 'anime' || type === 'tv' ? 'tv' : 'movie';
    const tmdbId = extractTmdbId(id);
    if (!tmdbId) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const cacheFile = path.join(mediaCacheDir, `${cleanType}_${tmdbId}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const stats = fs.statSync(cacheFile);
        if (Date.now() - stats.mtimeMs < 86400000 * 7) {
          const cached: unknown = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          res.json(cached);
          return;
        }
      } catch (_) {}
    }

    try {
      const apiKey = getTmdbKey();
      const detailUrl = `${TMDB_URL}/${cleanType}/${tmdbId}?api_key=${apiKey}&language=es-MX&append_to_response=credits,videos,recommendations`;
      const tmdbRes = await fetch(detailUrl, { signal: AbortSignal.timeout(7000) });
      if (!tmdbRes.ok) {
        let cat: CatalogItem | null = null;
        if (!isCatalogMemoryEngine()) {
          try {
            const opened = openCatalogDb(baseDir, options.userDataPath);
            if (opened) cat = findCatalogItemInDb(opened.db, tmdbId, id);
          } catch {}
        }
        if (!cat) {
          cat = loadServerCatalog().find((m) => String(m.tmdbId) === tmdbId || m.id === id) || null;
        }
        if (cat) {
          res.json(cat);
          return;
        }
        res.status(404).json({ error: 'Título no encontrado en TMDB' });
        return;
      }

      const d = (await tmdbRes.json()) as TmdbDetailResponse;
      const title = d.title || d.name || 'Sin Título';
      const origTitle = d.original_title || d.original_name || title;
      const releaseDate = d.release_date || d.first_air_date || '';
      const year = parseInt(releaseDate.slice(0, 4), 10) || 2024;
      const genres = Array.isArray(d.genres)
        ? d.genres.map((g) => g.name || 'Cine').filter(Boolean)
        : ['Cine'];
      const rating = Number((d.vote_average || 7.5).toFixed(1));
      const posterUrl = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '';
      const backdropUrl = d.backdrop_path
        ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
        : posterUrl;
      const director =
        d.credits?.crew?.find((c) => c.job === 'Director')?.name ||
        d.created_by?.[0]?.name ||
        '';
      const cast = (d.credits?.cast || []).slice(0, 10).map((c) => ({
        name: c.name || '',
        character: c.character || '',
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      }));

      // Tráiler en YouTube (prioriza idioma español o general)
      const videos = d.videos?.results || [];
      const trailer =
        videos.find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) ||
        videos[0];
      const trailerKey = trailer?.key || null;

      // Saga / Colección si pertenece a una
      let collection: {
        id: number | undefined;
        name: string | undefined;
        posterUrl: string | null;
        parts: Array<{
          id: string;
          tmdbId: number | undefined;
          title: string | undefined;
          posterUrl: string | null;
          backdropUrl: string | null;
          year: number;
          voteAverage: number;
        }>;
      } | null = null;

      if (d.belongs_to_collection && d.belongs_to_collection.id) {
        try {
          const collRes = await fetch(
            `${TMDB_URL}/collection/${d.belongs_to_collection.id}?api_key=${apiKey}&language=es-MX`
          );
          if (collRes.ok) {
            const collData = (await collRes.json()) as TmdbCollectionResponse;
            collection = {
              id: collData.id,
              name: collData.name,
              posterUrl: collData.poster_path
                ? `https://image.tmdb.org/t/p/w500${collData.poster_path}`
                : null,
              parts: (collData.parts || []).map((p) => ({
                id: `tmdb-movie-${p.id ?? 0}`,
                tmdbId: p.id,
                title: p.title || p.original_title,
                posterUrl: p.poster_path ? `https://image.tmdb.org/t/p/w300${p.poster_path}` : null,
                backdropUrl: p.backdrop_path
                  ? `https://image.tmdb.org/t/p/w780${p.backdrop_path}`
                  : null,
                year: p.release_date ? parseInt(p.release_date.slice(0, 4), 10) || 2024 : 2024,
                voteAverage: Number((p.vote_average || 7.0).toFixed(1)),
              })),
            };
          }
        } catch (_) {}
      }

      // Recomendaciones inteligentes (filtro >= 6.0, género/década, 6 a 20 items)
      const primaryGenre = genres[0] || 'Cine';
      const decade = Math.floor(year / 10);
      const collectionIds = new Set<number>(
        collection?.parts
          ? collection.parts.map((p) => p.tmdbId).filter((v): v is number => typeof v === 'number')
          : []
      );
      collectionIds.add(Number(tmdbId));

      const rawRecs = (d.recommendations?.results || []).filter(
        (r) => (r.vote_average ?? 0) >= 6.0 && typeof r.id === 'number' && !collectionIds.has(r.id)
      );

      const tmdbRecs = rawRecs.slice(0, 12).map((r) => {
        const recDate = r.release_date || r.first_air_date || '';
        return {
          id: `tmdb-${cleanType === 'tv' ? 'series' : 'movie'}-${r.id ?? 0}`,
          tmdbId: r.id ?? 0,
          title: r.title || r.name || 'Sin Título',
          posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
          year: recDate ? parseInt(recDate.slice(0, 4), 10) : year,
          voteAverage: Number((r.vote_average || 7.0).toFixed(1)),
          category: cleanType === 'tv' ? 'series' : 'movie',
        };
      });

      // Mezcla con catálogo local del mismo género y década
      const localCatalog = loadServerCatalog();
      const catalogMatching = localCatalog
        .filter((m) => {
          if (collectionIds.has(m.tmdbId)) return false;
          const sameDecade = Math.floor((m.year || 2024) / 10) === decade;
          const sameGenre = m.genres?.some((g) => g.toLowerCase() === primaryGenre.toLowerCase());
          return sameGenre && sameDecade;
        })
        .slice(0, 8);

      const combinedMap = new Map<
        number,
        {
          id: string;
          tmdbId: number;
          title: string;
          posterUrl: string | null;
          year: number;
          voteAverage: number;
          category: string;
        }
      >();
      for (const item of tmdbRecs) combinedMap.set(item.tmdbId, item);
      for (const item of catalogMatching) {
        if (!combinedMap.has(item.tmdbId)) {
          combinedMap.set(item.tmdbId, {
            id: item.id,
            tmdbId: item.tmdbId,
            title: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
            voteAverage: item.voteAverage,
            category: item.category,
          });
        }
      }

      const recommendations = Array.from(combinedMap.values()).slice(0, 18);

      // Temporadas (si es serie o anime)
      const seasons =
        cleanType === 'tv'
          ? (d.seasons || [])
              .filter((s) => (s.season_number ?? 0) > 0)
              .map((s) => ({
                seasonNumber: s.season_number ?? 1,
                name: s.name || `Temporada ${s.season_number ?? 1}`,
                episodeCount: s.episode_count || 10,
                posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
              }))
          : [];

      const payload = {
        id: `tmdb-${type}-${tmdbId}`,
        tmdbId: Number(tmdbId),
        title,
        originalTitle: origTitle,
        overview: d.overview || 'Sinopsis no disponible en español.',
        releaseDate,
        year,
        genres,
        voteAverage: rating,
        runtime: d.runtime || (d.episode_run_time ? d.episode_run_time[0] : 110),
        posterUrl,
        backdropUrl,
        director,
        cast,
        trailerKey,
        collection,
        recommendations,
        seasons,
        category: type,
        type: cleanType === 'tv' ? 'series' : 'movie',
      };

      fs.writeFile(cacheFile, JSON.stringify(payload), () => {});
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Media Detail] Error al consultar TMDB:', msg);
      const cat = loadServerCatalog().find((m) => String(m.tmdbId) === tmdbId || m.id === id);
      if (cat) {
        res.json(cat);
        return;
      }
      res.status(500).json({ error: 'Error al obtener detalle del título' });
    }
  });

  // Listado de episodios por temporada (con caché en disco)
  router.get('/tv/:id/season/:seasonNumber', async (req, res) => {
    const tmdbId = extractTmdbId(req.params.id);
    const sNum = parseInt(req.params.seasonNumber, 10) || 1;
    const cacheFile = path.join(mediaCacheDir, `tv_${tmdbId}_season_${sNum}.json`);

    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
          seasonNumber?: number;
          episodes?: any[];
        };
        const normalized = {
          seasonNumber: cached.seasonNumber ?? sNum,
          episodes: formatSeasonEpisodes(cached.episodes || [], cached.seasonNumber ?? sNum),
        };
        res.json(normalized);
        return;
      } catch (_) {}
    }

    try {
      const apiKey = getTmdbKey();
      const url = `${TMDB_URL}/tv/${tmdbId}/season/${sNum}?api_key=${apiKey}&language=es-MX`;
      const epRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!epRes.ok) {
        res.status(404).json({ error: 'Temporada no encontrada' });
        return;
      }

      const data = (await epRes.json()) as TmdbSeasonDetailResponse;
      const episodes = formatSeasonEpisodes(data.episodes || [], sNum);

      const result = { seasonNumber: sNum, episodes };
      fs.writeFile(cacheFile, JSON.stringify(result), () => {});
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Detalle de serie y temporadas reales (con caché en disco)
  router.get('/tv/:id', async (req, res) => {
    const tmdbId = extractTmdbId(req.params.id);
    if (!tmdbId) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const cacheFile = path.join(mediaCacheDir, `tv_${tmdbId}_overview.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const cached: unknown = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        res.json(cached);
        return;
      } catch (_) {}
    }

    try {
      const apiKey = getTmdbKey();
      const url = `${TMDB_URL}/tv/${tmdbId}?api_key=${apiKey}&language=es-MX`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) {
        res.status(404).json({ error: 'Serie no encontrada en TMDB' });
        return;
      }

      const d = (await r.json()) as TmdbDetailResponse;
      const seasons = (d.seasons || [])
        .filter((s) => (s.season_number ?? 0) > 0)
        .map((s) => ({
          seasonNumber: s.season_number ?? 1,
          name: s.name || `Temporada ${s.season_number ?? 1}`,
          episodeCount: s.episode_count || 10,
          posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
        }));

      const result = {
        id: Number(tmdbId),
        tmdbId: Number(tmdbId),
        title: d.name || d.original_name || 'Serie',
        numberOfSeasons: seasons.length,
        totalSeasons: seasons.length,
        numberOfEpisodes: d.number_of_episodes || 0,
        totalEpisodes: d.number_of_episodes || 0,
        seasons,
      };

      fs.writeFile(cacheFile, JSON.stringify(result), () => {});
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
