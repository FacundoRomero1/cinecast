import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { extractTmdbId, type MediaServerEntry } from '../tmdb.js';

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
  servers: MediaServerEntry[];
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
  servers?: MediaServerEntry[];
}

export interface CatalogRouterOptions {
  baseDir?: string | undefined;
  posterCacheDir: string;
  userAgent?: string | undefined;
  getCatalogCache?: (() => CatalogItem[] | null) | undefined;
  setCatalogCache?: ((cache: CatalogItem[]) => void) | undefined;
}

const DEFAULT_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function loadServerCatalogFromDisk(
  baseDir: string,
  getCatalogCache?: () => CatalogItem[] | null,
  setCatalogCache?: (cache: CatalogItem[]) => void
): CatalogItem[] {
  if (getCatalogCache) {
    const cached = getCatalogCache();
    if (cached && cached.length > 0) {
      return cached;
    }
  }
  const candidates = [
    path.join(baseDir, 'public', 'data', 'catalog.json'),
    path.join(baseDir, 'dist', 'data', 'catalog.json'),
    path.join(process.cwd(), 'public', 'data', 'catalog.json'),
  ];
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
            return {
              id: m.id || `tmdb-${m.category || (isTV ? 'series' : 'movie')}-${tmdbId}`,
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
              year: m.year || (m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) || 2024 : 2024),
              genres: Array.isArray(m.genres) ? m.genres.slice(0, 3) : ['Película'],
              voteAverage: rating,
              rating,
              streamUrl: m.streamUrl || '',
              streamType: m.streamType || 'iframe',
              quality: m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
              source: m.source || 'tmdb',
              category: m.category || (isTV ? 'series' : 'movie'),
              type: isTV ? 'series' : 'movie',
              servers: (m.servers || []).filter(
                (s) => !s.name?.toLowerCase().includes('embed.su') && !s.url?.includes('embed.su')
              ),
            };
          });
          console.log(`[Catalog Server] Cargados ${mapped.length} títulos compactos en memoria.`);
          if (setCatalogCache) setCatalogCache(mapped);
          return mapped;
        }
      }
    } catch (e) {
      console.warn('[Catalog Server] Error al leer catálogo desde', p, e);
    }
  }
  return [];
}

export function createCatalogRouter(options: CatalogRouterOptions): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();
  const posterCacheDir = options.posterCacheDir;
  const userAgent = options.userAgent || DEFAULT_CHROME_UA;
  let localCache: CatalogItem[] | null = null;

  try {
    fs.mkdirSync(posterCacheDir, { recursive: true });
  } catch (_) {}

  function loadServerCatalog(): CatalogItem[] {
    return loadServerCatalogFromDisk(
      baseDir,
      options.getCatalogCache || (() => localCache),
      options.setCatalogCache ||
        ((c: CatalogItem[]) => {
          localCache = c;
        })
    );
  }

  router.get('/catalog', (req, res) => {
    const catalog = loadServerCatalog();
    const rawPage = typeof req.query.page === 'string' ? req.query.page : '1';
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '40';
    const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
    const rawCategory = typeof req.query.category === 'string' ? req.query.category : '';

    const page = Math.max(1, parseInt(rawPage, 10) || 1);
    const limit = Math.min(20000, Math.max(1, parseInt(rawLimit, 10) || 40));
    const q = rawQ.trim().toLowerCase();
    const category = rawCategory.trim().toLowerCase();
    const onlySpanish = req.query.onlySpanish === 'true' || req.query.es === 'true';

    let filtered = catalog;
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

    if (q) {
      filtered = filtered.filter((m) => {
        return (
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
          (m.overview && m.overview.toLowerCase().includes(q))
        );
      });
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);

    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json({
      page,
      limit,
      total,
      totalPages,
      items,
    });
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
