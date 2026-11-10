import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { extractTmdbId, type MediaServerEntry } from '../tmdb.js';
import { normalizeGenres } from '../genres.js';

export interface CatalogItem {
  id: string;
  tmdbId: number;
  title: string;
  originalTitle: string;
  originalLanguage: string;
  spokenLanguages: string[];
  overview: string;
  posterPath: string;
  posterUrl: string;
  backdropPath: string;
  backdropUrl: string;
  releaseDate: string;
  year: number;
  genres: string[];
  voteAverage: number;
  rating: number;
  streamUrl: string;
  streamType: string;
  quality: string;
  source: string;
  category: string;
  type: string;
  upcoming: boolean;
  addedAt?: string | undefined;
  servers: MediaServerEntry[];
}

export interface CatalogCardItem {
  id: string;
  tmdbId: number;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  year: number;
  rating: number;
  genres: string[];
  category: string;
  type: string;
  quality: string;
  upcoming: boolean;
}

interface RawCatalogEntry {
  id?: string;
  tmdbId?: number | string;
  title?: string;
  originalTitle?: string;
  originalLanguage?: string;
  spokenLanguages?: string[];
  overview?: string;
  posterPath?: string;
  posterUrl?: string;
  backdropPath?: string;
  backdropUrl?: string;
  releaseDate?: string;
  year?: number;
  genres?: string[];
  voteAverage?: number;
  rating?: number;
  streamUrl?: string;
  streamType?: string;
  quality?: string;
  source?: string;
  category?: string;
  type?: string;
  addedAt?: string;
  servers?: MediaServerEntry[];
}

export interface CatalogRouterOptions {
  baseDir?: string | undefined;
  posterCacheDir: string;
  userAgent?: string | undefined;
  getCatalogCache: () => CatalogItem[] | null;
  setCatalogCache: (cache: CatalogItem[]) => void;
}

const DEFAULT_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function toCatalogCard(item: CatalogItem): CatalogCardItem {
  return {
    id: item.id,
    tmdbId: item.tmdbId,
    title: item.title,
    posterUrl: item.posterUrl,
    backdropUrl: item.backdropUrl,
    year: item.year,
    rating: item.rating,
    genres: item.genres,
    category: item.category,
    type: item.type,
    quality: item.quality,
    upcoming: item.upcoming,
  };
}

export function loadServerCatalogFromDisk(
  baseDir: string,
  getCatalogCache: () => CatalogItem[] | null,
  setCatalogCache: (cache: CatalogItem[]) => void
): CatalogItem[] {
  const cached = getCatalogCache();
  if (cached && cached.length > 0) {
    return cached;
  }
  const candidates = [
    path.join(baseDir, 'public', 'data', 'catalog.json'),
    path.join(baseDir, 'dist', 'data', 'catalog.json'),
    path.join(process.cwd(), 'public', 'data', 'catalog.json'),
  ];
  const currentYear = new Date().getFullYear();

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const mapped: CatalogItem[] = (parsed as RawCatalogEntry[]).map((m) => {
            const isTV = m.category === 'series' || m.category === 'anime' || m.type === 'series';
            const tmdbId = Number(m.tmdbId || extractTmdbId(m.id) || 0);
            const poster = m.posterUrl || m.posterPath || '';
            const backdrop = m.backdropUrl || m.backdropPath || poster;
            const rating = Number((m.rating ?? m.voteAverage ?? 7.5).toFixed(1));
            const origLang = m.originalLanguage || (m.category === 'anime' ? 'ja' : 'es');
            const category = m.category || (isTV ? 'series' : 'movie');
            const year =
              m.year || (m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) || 2024 : 2024);
            const normalizedGenres = normalizeGenres(
              Array.isArray(m.genres) ? m.genres : [],
              category
            );

            return {
              id: m.id || `tmdb-${category}-${tmdbId}`,
              tmdbId,
              title: m.title || 'Sin Título',
              originalTitle: m.originalTitle || m.title || 'Sin Título',
              originalLanguage: origLang,
              spokenLanguages: m.spokenLanguages || (origLang === 'es' ? ['es'] : ['es', origLang]),
              overview: m.overview || '',
              posterPath: poster,
              posterUrl: poster,
              backdropPath: backdrop,
              backdropUrl: backdrop,
              releaseDate: m.releaseDate || '2024-01-01',
              year,
              genres: normalizedGenres,
              voteAverage: rating,
              rating,
              streamUrl: m.streamUrl || '',
              streamType: m.streamType || 'iframe',
              quality: m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
              source: m.source || 'tmdb',
              category,
              type: isTV ? 'series' : 'movie',
              upcoming: year > currentYear,
              addedAt: m.addedAt,
              servers: (m.servers || []).filter(
                (s) => !s.name?.toLowerCase().includes('embed.su') && !s.url?.includes('embed.su')
              ),
            };
          });
          console.log(`[Catalog Server] Cargados ${mapped.length} títulos compactos en memoria.`);
          setCatalogCache(mapped);
          return mapped;
        }
      }
    } catch (e) {
      console.warn('[Catalog Server] Error al leer catálogo desde', p, e);
    }
  }
  return [];
}

function computeGenreList(items: CatalogItem[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const g of item.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
}

export function createCatalogRouter(options: CatalogRouterOptions): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();
  const posterCacheDir = options.posterCacheDir;
  const userAgent = options.userAgent || DEFAULT_CHROME_UA;

  try {
    fs.mkdirSync(posterCacheDir, { recursive: true });
  } catch (_) {}

  function loadServerCatalog(): CatalogItem[] {
    return loadServerCatalogFromDisk(baseDir, options.getCatalogCache, options.setCatalogCache);
  }

  router.get('/catalog', (req, res) => {
    const catalog = loadServerCatalog();
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
    const fields = typeof req.query.fields === 'string' ? req.query.fields.trim().toLowerCase() : '';

    if (rawIds) {
      const requestedIds = rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const byId = new Map<string, CatalogItem>();
      for (const item of catalog) {
        byId.set(item.id, item);
        if (item.tmdbId) {
          byId.set(String(item.tmdbId), item);
        }
      }

      const matched: CatalogItem[] = [];
      const seen = new Set<string>();
      for (const id of requestedIds) {
        const found = byId.get(id);
        if (found && !seen.has(found.id)) {
          seen.add(found.id);
          matched.push(found);
        }
      }

      const items = fields === 'card' || !fields ? matched.map(toCatalogCard) : matched;
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json({
        page: 1,
        limit: items.length || 1,
        total: items.length,
        totalPages: 1,
        items,
      });
      return;
    }

    const rawPage = typeof req.query.page === 'string' ? req.query.page : '1';
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '40';
    const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
    const rawCategory = typeof req.query.category === 'string' ? req.query.category : '';
    const rawGenre = typeof req.query.genre === 'string' ? req.query.genre : '';
    const rawYearFrom = typeof req.query.yearFrom === 'string' ? req.query.yearFrom : '';
    const rawYearTo = typeof req.query.yearTo === 'string' ? req.query.yearTo : '';
    const rawMinRating = typeof req.query.minRating === 'string' ? req.query.minRating : '';
    const rawSort = typeof req.query.sort === 'string' ? req.query.sort.trim().toLowerCase() : 'default';
    const includeUpcoming =
      req.query.includeUpcoming === 'true' || req.query.includeUpcoming === '1';
    const includeFacets = req.query.facets === 'true' || req.query.facets === '1';

    const page = Math.max(1, parseInt(rawPage, 10) || 1);
    const limit = Math.min(20000, Math.max(1, parseInt(rawLimit, 10) || 40));
    const q = rawQ.trim().toLowerCase();
    const category = rawCategory.trim().toLowerCase();
    const onlySpanish = req.query.onlySpanish === 'true' || req.query.es === 'true';

    const requestedGenres = rawGenre
      .split(',')
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);
    const yearFrom = rawYearFrom ? parseInt(rawYearFrom, 10) : NaN;
    const yearTo = rawYearTo ? parseInt(rawYearTo, 10) : NaN;
    const minRating = rawMinRating ? parseFloat(rawMinRating) : NaN;

    let filtered = catalog;

    if (!includeUpcoming) {
      filtered = filtered.filter((m) => !m.upcoming);
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((m) => {
        const cat = (m.category || m.type || '').toLowerCase();
        if (category === 'movies' || category === 'movie') return cat === 'movie';
        if (category === 'series' || category === 'tv') return cat === 'series';
        if (category === 'anime') return cat === 'anime';
        return cat === category;
      });
    }

    if (onlySpanish) {
      filtered = filtered.filter((m) => m.originalLanguage === 'es');
    }

    if (requestedGenres.length > 0) {
      const reqSet = new Set(requestedGenres);
      filtered = filtered.filter((m) =>
        m.genres.some((g) => reqSet.has(g.toLowerCase()))
      );
    }

    if (!Number.isNaN(yearFrom)) {
      filtered = filtered.filter((m) => m.year >= yearFrom);
    }

    if (!Number.isNaN(yearTo)) {
      filtered = filtered.filter((m) => m.year <= yearTo);
    }

    if (!Number.isNaN(minRating)) {
      filtered = filtered.filter((m) => m.rating >= minRating);
    }

    if (q) {
      filtered = filtered.filter((m) => {
        return (
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
          (m.overview && m.overview.toLowerCase().includes(q))
        );
      });
    }

    if (rawSort && rawSort !== 'default') {
      filtered = [...filtered];
      if (rawSort === 'rating') {
        filtered.sort((a, b) => b.rating - a.rating);
      } else if (rawSort === 'year') {
        filtered.sort((a, b) => b.year - a.year || b.rating - a.rating);
      } else if (rawSort === 'title') {
        filtered.sort((a, b) => a.title.localeCompare(b.title, 'es'));
      } else if (rawSort === 'added') {
        filtered.sort((a, b) => {
          const ta = a.addedAt ? Date.parse(a.addedAt) || 0 : 0;
          const tb = b.addedAt ? Date.parse(b.addedAt) || 0 : 0;
          return tb - ta;
        });
      }
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const slice = filtered.slice(offset, offset + limit);
    const items = fields === 'card' ? slice.map(toCatalogCard) : slice;

    const responseBody: Record<string, unknown> = {
      page,
      limit,
      total,
      totalPages,
      items,
    };

    if (includeFacets) {
      const genreCounts: Record<string, number> = {};
      let minYear: number | null = null;
      let maxYear: number | null = null;

      for (const item of filtered) {
        for (const g of item.genres) {
          genreCounts[g] = (genreCounts[g] ?? 0) + 1;
        }
        if (typeof item.year === 'number' && Number.isFinite(item.year)) {
          if (minYear === null || item.year < minYear) minYear = item.year;
          if (maxYear === null || item.year > maxYear) maxYear = item.year;
        }
      }

      responseBody.facets = {
        genres: genreCounts,
        yearRange: {
          min: minYear,
          max: maxYear,
        },
        minYear,
        maxYear,
      };
    }

    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(responseBody);
  });

  router.get('/genres', (_req, res) => {
    const catalog = loadServerCatalog();
    const list = computeGenreList(catalog);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(list);
  });

  router.get('/home', (req, res) => {
    const catalog = loadServerCatalog();
    const currentYear = new Date().getFullYear();
    const available = catalog.filter((m) => !m.upcoming);

    const rows: Array<{ id: string; title: string; items: CatalogCardItem[] }> = [];

    // 0. Recomendados para vos (si viene seen=id1,id2,...)
    const rawSeen = typeof req.query.seen === 'string' ? req.query.seen.trim() : '';
    if (rawSeen) {
      const seenIds = rawSeen
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);

      if (seenIds.length > 0) {
        const byId = new Map<string, CatalogItem>();
        for (const item of catalog) {
          byId.set(item.id, item);
        }

        const seenSet = new Set<string>();
        const seenGenreCounts = new Map<string, number>();

        for (const sid of seenIds) {
          const found = byId.get(sid);
          if (!found) continue;
          seenSet.add(found.id);
          for (const g of found.genres) {
            seenGenreCounts.set(g, (seenGenreCounts.get(g) ?? 0) + 1);
          }
        }

        const top3Genres = Array.from(seenGenreCounts.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
          .slice(0, 3)
          .map(([name]) => name);

        if (top3Genres.length > 0) {
          const top3Set = new Set(top3Genres);
          const recommended = available
            .filter(
              (m) => !seenSet.has(m.id) && m.genres.some((g) => top3Set.has(g))
            )
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 20)
            .map(toCatalogCard);

          if (recommended.length > 0) {
            rows.push({
              id: 'recommended',
              title: 'Recomendados para vos',
              items: recommended,
            });
          }
        }
      }
    }

    // 1. Tendencias (20 primeros del orden actual, sin upcoming)
    rows.push({
      id: 'trending',
      title: 'Tendencias',
      items: available.slice(0, 20).map(toCatalogCard),
    });

    // 2. Estrenos (year igual al año actual, no upcoming, por rating descendente, 20)
    const releases = available
      .filter((m) => m.year === currentYear)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 20)
      .map(toCatalogCard);
    rows.push({
      id: 'new-releases',
      title: 'Estrenos',
      items: releases,
    });

    // 3. Anime destacado (category anime, por rating, 20)
    const topAnime = available
      .filter((m) => m.category === 'anime')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 20)
      .map(toCatalogCard);
    rows.push({
      id: 'featured-anime',
      title: 'Anime destacado',
      items: topAnime,
    });

    // 4. Series destacadas (20)
    const topSeries = available
      .filter((m) => m.category === 'series')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 20)
      .map(toCatalogCard);
    rows.push({
      id: 'featured-series',
      title: 'Series destacadas',
      items: topSeries,
    });

    // 5. Los 5 géneros más frecuentes (20 mejor puntuados con rating >= 7)
    const top5Genres = computeGenreList(available).slice(0, 5);
    for (const g of top5Genres) {
      const genreItems = available
        .filter((m) => m.rating >= 7 && m.genres.includes(g.name))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 20)
        .map(toCatalogCard);

      rows.push({
        id: `genre-${g.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}`,
        title: g.name,
        items: genreItems,
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json({ rows });
  });

  router.get('/poster', async (req, res) => {
    let targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const tmdbPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!targetUrl && tmdbPath) {
      targetUrl = `https://image.tmdb.org/t/p/w200${tmdbPath.startsWith('/') ? '' : '/'}${tmdbPath}`;
    }
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
      res.status(400).send('Parámetro url inválido');
      return;
    }

    const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
    const cacheFile = path.join(posterCacheDir, `${hash}.jpg`);

    if (fs.existsSync(cacheFile)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      fs.createReadStream(cacheFile).pipe(res);
      return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) {
        res.redirect(targetUrl);
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      fs.writeFile(cacheFile, buffer, () => {});
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.send(buffer);
    } catch (_) {
      res.redirect(targetUrl);
    }
  });

  return router;
}
