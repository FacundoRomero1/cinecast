import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import {
  type CatalogItem,
  type CatalogCardItem,
  toCatalogCard,
  isCatalogMemoryEngine,
  resolveCatalogJsonPaths,
  loadNormalizedCatalogItems,
} from '../catalogSchema.js';
import {
  openCatalogDb,
  queryCatalogByIds,
  queryCatalogPage,
  queryGenresList,
  queryHomeRows,
} from '../catalogDb.js';
import { buildCuratedHome } from '../homeCuration.js';

export type { CatalogItem, CatalogCardItem };
export { toCatalogCard };

export interface CatalogRouterOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  posterCacheDir: string;
  userAgent?: string | undefined;
  getCatalogCache: () => CatalogItem[] | null;
  setCatalogCache: (cache: CatalogItem[]) => void;
}

const DEFAULT_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function loadServerCatalogFromDisk(
  baseDir: string,
  getCatalogCache: () => CatalogItem[] | null,
  setCatalogCache: (cache: CatalogItem[]) => void
): CatalogItem[] {
  const cached = getCatalogCache();
  if (cached && cached.length > 0) {
    return cached;
  }
  const { basePath, extPath } = resolveCatalogJsonPaths(baseDir);
  if (!basePath) return [];

  try {
    const mapped = loadNormalizedCatalogItems(basePath, extPath);
    if (mapped.length > 0) {
      console.log(`[Catalog Server] Cargados ${mapped.length} títulos compactos en memoria.`);
      setCatalogCache(mapped);
      return mapped;
    }
  } catch (e) {
    console.warn('[Catalog Server] Error al leer catálogo desde', basePath, e);
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

  function tryOpenDb() {
    if (isCatalogMemoryEngine()) return null;
    try {
      return openCatalogDb(baseDir, options.userDataPath);
    } catch (e) {
      console.warn('[Catalog Server] SQLite no disponible, usando memoria:', e);
      return null;
    }
  }

  function buildEtag(seed: string, urlKey: string): string {
    const dayYear = new Date().getFullYear();
    const h = crypto
      .createHash('sha1')
      .update(`${seed}|${dayYear}|${urlKey}`)
      .digest('base64url')
      .slice(0, 16);
    return `W/"${h}"`;
  }

  function applyCacheHeadersAndCheck304(
    req: { headers: Record<string, string | string[] | undefined>; originalUrl: string },
    res: { setHeader: (k: string, v: string) => void; status: (code: number) => { end: () => void } },
    seed: string | null
  ): boolean {
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (!seed) return false;
    const etag = buildEtag(seed, req.originalUrl);
    res.setHeader('ETag', etag);
    const inm = req.headers['if-none-match'];
    const rawInm = Array.isArray(inm) ? inm.join(',') : inm || '';
    if (rawInm && (rawInm === '*' || rawInm.split(',').map((s) => s.trim()).includes(etag))) {
      res.status(304).end();
      return true;
    }
    return false;
  }

  router.get('/catalog', (req, res) => {
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
    const fields = typeof req.query.fields === 'string' ? req.query.fields.trim().toLowerCase() : '';
    const dbOpened = tryOpenDb();
    if (applyCacheHeadersAndCheck304(req, res, dbOpened?.sourceHash ?? 'mem')) {
      return;
    }

    if (rawIds) {
      const requestedIds = rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let items: Array<CatalogCardItem | CatalogItem>;
      if (dbOpened) {
        items = queryCatalogByIds(dbOpened.db, requestedIds, fields);
      } else {
        const catalog = loadServerCatalog();
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
        items = fields === 'card' || !fields ? matched.map(toCatalogCard) : matched;
      }

      res.setHeader('Cache-Control', 'public, max-age=60');
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
    const rawGenreMode = typeof req.query.genreMode === 'string' ? req.query.genreMode.trim().toLowerCase() : 'all';
    const genreMode: 'all' | 'any' = rawGenreMode === 'any' ? 'any' : 'all';
    const yearFrom = rawYearFrom ? parseInt(rawYearFrom, 10) : NaN;
    const yearTo = rawYearTo ? parseInt(rawYearTo, 10) : NaN;
    const minRating = rawMinRating ? parseFloat(rawMinRating) : NaN;

    if (dbOpened) {
      const responseBody = queryCatalogPage(dbOpened.db, {
        page,
        limit,
        q,
        category,
        requestedGenres,
        genreMode,
        yearFrom,
        yearTo,
        minRating,
        sort: rawSort,
        includeUpcoming,
        onlySpanish,
        includeFacets,
        fields,
      });
      res.json(responseBody);
      return;
    }

    const catalog = loadServerCatalog();
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

    const facetBaseBeforeGenres = filtered;
    const uniqueReqGenres = Array.from(new Set(requestedGenres));
    if (uniqueReqGenres.length > 0) {
      if (genreMode === 'any') {
        const reqSet = new Set(uniqueReqGenres);
        filtered = filtered.filter((m) => m.genres.some((g) => reqSet.has(g.toLowerCase())));
      } else {
        filtered = filtered.filter((m) => {
          const itemGenres = new Set(m.genres.map((g) => g.toLowerCase()));
          return uniqueReqGenres.every((g) => itemGenres.has(g));
        });
      }
    }

    const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    if (rawSort && rawSort !== 'default') {
      filtered = [...filtered];
      if (rawSort === 'rating') {
        filtered.sort((a, b) => b.rating - a.rating || cmpId(a.id, b.id));
      } else if (rawSort === 'year') {
        filtered.sort((a, b) => b.year - a.year || b.rating - a.rating || cmpId(a.id, b.id));
      } else if (rawSort === 'title') {
        filtered.sort((a, b) => a.title.localeCompare(b.title, 'es') || cmpId(a.id, b.id));
      } else if (rawSort === 'added') {
        filtered.sort((a, b) => {
          const ta = a.addedAt ? Date.parse(a.addedAt) || 0 : 0;
          const tb = b.addedAt ? Date.parse(b.addedAt) || 0 : 0;
          return tb - ta || cmpId(a.id, b.id);
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
      for (const g of computeGenreList(catalog)) {
        genreCounts[g.name] = 0;
      }
      const facetSource = genreMode === 'any' ? facetBaseBeforeGenres : filtered;
      for (const item of facetSource) {
        for (const g of item.genres) {
          genreCounts[g] = (genreCounts[g] ?? 0) + 1;
        }
      }

      let minYear: number | null = null;
      let maxYear: number | null = null;
      for (const item of filtered) {
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

    res.json(responseBody);
  });

  router.get('/genres', (req, res) => {
    const dbOpened = tryOpenDb();
    if (applyCacheHeadersAndCheck304(req, res, dbOpened?.sourceHash ?? 'mem')) {
      return;
    }
    const list = dbOpened ? queryGenresList(dbOpened.db) : computeGenreList(loadServerCatalog());
    res.json(list);
  });

  router.get('/home', async (req, res) => {
    const rawSeen = typeof req.query.seen === 'string' ? req.query.seen.trim() : '';
    const isLegacyV1 = req.query.v === '1';
    const dbOpened = tryOpenDb();

    if (applyCacheHeadersAndCheck304(req, res, dbOpened?.sourceHash ?? 'mem')) {
      return;
    }

    if (!isLegacyV1) {
      try {
        const catalog = loadServerCatalog();
        const seenIds = rawSeen
          ? rawSeen.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
        const dateStr = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
        const rows = await buildCuratedHome({ catalog, seenIds, dateStr, baseDir });
        res.json({ rows });
        return;
      } catch (err) {
        console.error('[Catalog Server] Error generando home curado, cayendo a legacy:', err);
        if (dbOpened) {
          const rows = queryHomeRows(dbOpened.db, rawSeen);
          res.json({ rows });
          return;
        }
      }
    }

    if (dbOpened) {
      const rows = queryHomeRows(dbOpened.db, rawSeen);
      res.json({ rows });
      return;
    }

    const catalog = loadServerCatalog();
    const currentYear = new Date().getFullYear();
    const available = catalog.filter((m) => !m.upcoming);

    const rows: Array<{ id: string; title: string; items: CatalogCardItem[] }> = [];

    // 0. Recomendados para vos (si viene seen=id1,id2,...)
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

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ rows });
  });

  const posterCacheMaxBytes = Math.max(
    16 * 1024 * 1024,
    (Number(process.env.CINECAST_POSTER_CACHE_MB) || 500) * 1024 * 1024
  );
  let posterPruneRunning = false;
  let lastPosterPruneMs = 0;

  function schedulePosterCachePrune(): void {
    const now = Date.now();
    if (posterPruneRunning || now - lastPosterPruneMs < 30_000) return;
    posterPruneRunning = true;
    lastPosterPruneMs = now;
    setImmediate(() => {
      try {
        const entries = fs.readdirSync(posterCacheDir);
        const files: Array<{ filePath: string; size: number; atimeMs: number }> = [];
        let totalSize = 0;
        for (const name of entries) {
          if (!name.endsWith('.jpg')) continue;
          const filePath = path.join(posterCacheDir, name);
          try {
            const st = fs.statSync(filePath);
            if (!st.isFile()) continue;
            totalSize += st.size;
            files.push({ filePath, size: st.size, atimeMs: st.atimeMs || st.mtimeMs });
          } catch {}
        }
        if (totalSize > posterCacheMaxBytes) {
          const targetBytes = Math.floor(posterCacheMaxBytes * 0.9);
          files.sort((a, b) => a.atimeMs - b.atimeMs);
          for (const f of files) {
            if (totalSize <= targetBytes) break;
            try {
              fs.unlinkSync(f.filePath);
              totalSize -= f.size;
            } catch {}
          }
        }
      } catch {} finally {
        posterPruneRunning = false;
      }
    });
  }

  router.get('/poster', async (req, res) => {
    const rawW = typeof req.query.w === 'string' ? parseInt(req.query.w, 10) : NaN;
    const width: 154 | 185 | 342 =
      rawW === 154 ? 154 : rawW === 342 ? 342 : 185;

    let targetUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const tmdbPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!targetUrl && tmdbPath) {
      targetUrl = `https://image.tmdb.org/t/p/w${width}${tmdbPath.startsWith('/') ? '' : '/'}${tmdbPath}`;
    }
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
      res.status(400).send('Parámetro url inválido');
      return;
    }

    if (/^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i.test(targetUrl)) {
      targetUrl = targetUrl.replace(/(\/t\/p\/)(?:w\d+|original)(\/)/i, `$1w${width}$2`);
    }

    const hash = crypto.createHash('md5').update(`${width}|${targetUrl}`).digest('hex');
    const cacheFile = path.join(posterCacheDir, `${hash}.jpg`);

    if (fs.existsSync(cacheFile)) {
      const now = new Date();
      fs.utimes(cacheFile, now, now, () => {});
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
      fs.writeFile(cacheFile, buffer, () => {
        schedulePosterCachePrune();
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.send(buffer);
    } catch (_) {
      res.redirect(targetUrl);
    }
  });

  return router;
}
