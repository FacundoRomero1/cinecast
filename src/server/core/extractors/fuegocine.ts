import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface FuegoCineSlugEntry {
  tmdbId: number;
  title: string;
  originalTitle?: string;
  year?: number;
  mediaType: 'movie' | 'series';
  fuegoSlug: string;
  fuegoId: string | number;
  fuegoTitle?: string;
  tmdbPoster?: string;
  fuegoPoster?: string;
  matchMethod?: string;
}

export interface FuegoCineServer {
  provider: 'fuegocine';
  name: string;
  url: string;
  type: 'iframe';
  language: string;
  audioLangs: string[];
}

let cachedSlugs: FuegoCineSlugEntry[] | null = null;

export function loadFuegoCineSlugs(): FuegoCineSlugEntry[] {
  if (cachedSlugs) return cachedSlugs;
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'data', 'fuegocineSlugs.json'),
      path.join(process.cwd(), 'cinecast', 'src', 'data', 'fuegocineSlugs.json'),
      path.join(process.cwd(), 'data', 'fuegocineSlugs.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedSlugs = Array.isArray(parsed) ? parsed : Object.values(parsed);
        return cachedSlugs;
      }
    }
  } catch (err: any) {
    console.warn('[fuegocine] Error cargando fuegocineSlugs.json:', err?.message);
  }
  return [];
}

/**
 * Busca o mapea un título en FuegoCine por tmdbId, título o poster_path
 */
export async function getFuegoCineMapping(
  tmdbId: number | string,
  title: string,
  mediaType: 'movie' | 'tv' | 'series' = 'movie',
  posterPath?: string
): Promise<{ slug: string; id: string | number; type: 'movie' | 'show' } | null> {
  const slugs = loadFuegoCineSlugs();
  const numId = Number(tmdbId);

  // 1. Búsqueda directa en slugs precacheados
  if (numId) {
    const hit = slugs.find((s) => s.tmdbId === numId);
    if (hit) {
      return {
        slug: hit.fuegoSlug,
        id: hit.fuegoId,
        type: hit.mediaType === 'movie' ? 'movie' : 'show',
      };
    }
  }

  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;

  const hitTitle = slugs.find(
    (s) =>
      s.title.toLowerCase().trim() === cleanTitle.toLowerCase() ||
      (s.originalTitle && s.originalTitle.toLowerCase().trim() === cleanTitle.toLowerCase())
  );
  if (hitTitle) {
    return {
      slug: hitTitle.fuegoSlug,
      id: hitTitle.fuegoId,
      type: hitTitle.mediaType === 'movie' ? 'movie' : 'show',
    };
  }

  // 2. Búsqueda dinámica en /search_elastic
  try {
    const res = await fetch(`https://fuegocine.com/search_elastic?s=${encodeURIComponent(cleanTitle)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const isMovie = mediaType === 'movie';
    const regex = isMovie
      ? /<a\s+href="https:\/\/fuegocine\.com\/movies\/details\/([^"\/]+)\/(\d+)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"/gi
      : /<a\s+href="https:\/\/fuegocine\.com\/shows\/details\/([^"\/]+)\/(\d+)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"/gi;

    const candidates: Array<{ slug: string; id: string; poster: string; title: string }> = [];
    for (const m of html.matchAll(regex)) {
      candidates.push({ slug: m[1], id: m[2], poster: m[3], title: m[4] });
    }

    if (candidates.length === 0) return null;

    // Confirmar por poster_path de TMDB si está disponible
    const posterBasename = posterPath ? posterPath.split('/').pop()?.replace(/\.[a-z]+$/, '') : '';
    if (posterBasename) {
      const matchPoster = candidates.find((c) => c.poster.includes(posterBasename));
      if (matchPoster) {
        return { slug: matchPoster.slug, id: matchPoster.id, type: isMovie ? 'movie' : 'show' };
      }
    }

    // Fallback al primer candidato devuelto
    return { slug: candidates[0].slug, id: candidates[0].id, type: isMovie ? 'movie' : 'show' };
  } catch (err: any) {
    console.warn('[fuegocine] Error en búsqueda elástica:', err?.message);
    return null;
  }
}

/**
 * Parser de HTML de FuegoCine:
 * - Extrae iframes de abyssplayer y unlimplay (y otros reproductores)
 * - audioLangs ['latino'] con evidencia si el sitio marca el idioma en la ficha; si no, 'desconocido'
 */
export function parseFuegoCineHtml(html: string): FuegoCineServer[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);

  // 1. Evidencia de idioma: el sitio marca el idioma con lang_id o title="Latino"
  const langLinkText = $('a[href*="lang_id"]').text().trim().toLowerCase();
  const hasLatinoBadge =
    langLinkText.includes('latino') ||
    html.includes('title="Latino"') ||
    /lang_id=[^"]*"[^>]*>([^<]*latino[^<]*)</i.test(html) ||
    /<span>\s*Latino\s*<\/span>/i.test(html);

  // Regla: Para los iframes sin pistas de audio HLS declaradas en el stream, dejar audioLangs en 'desconocido'
  const audioLangs: string[] = ['desconocido'];
  const language = hasLatinoBadge ? 'Latino' : 'Desconocido';

  // 2. Extraer todos los iframes
  const iframeUrls: string[] = [];
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && src.startsWith('http') && !iframeUrls.includes(src)) {
      iframeUrls.push(src);
    }
  });

  if (iframeUrls.length === 0) {
    const rawMatches = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
    for (const src of rawMatches) {
      if (src.startsWith('http') && !iframeUrls.includes(src)) {
        iframeUrls.push(src);
      }
    }
  }

  const servers: FuegoCineServer[] = [];

  // Extraer prioritariamente abyssplayer y unlimplay
  for (const url of iframeUrls) {
    let name = 'FuegoCine (Player)';
    if (url.includes('abyssplayer')) {
      name = 'FuegoCine (AbyssPlayer)';
    } else if (url.includes('unlimplay')) {
      name = 'FuegoCine (Unlimplay)';
    } else if (url.includes('videro')) {
      name = 'FuegoCine (Videro)';
    } else if (url.includes('embedorigin')) {
      name = 'FuegoCine (EmbedOrigin)';
    }

    servers.push({
      provider: 'fuegocine',
      name,
      url,
      type: 'iframe',
      language,
      audioLangs,
    });
  }

  // Ordenar priorizando abyssplayer y unlimplay
  servers.sort((a, b) => {
    const isPriorityA = a.url.includes('abyssplayer') || a.url.includes('unlimplay');
    const isPriorityB = b.url.includes('abyssplayer') || b.url.includes('unlimplay');
    if (isPriorityA && !isPriorityB) return -1;
    if (!isPriorityA && isPriorityB) return 1;
    return 0;
  });

  return servers;
}

/**
 * Resuelve reproductores de FuegoCine para películas o series
 */
export async function resolveFuegoCine(
  slug: string,
  id: string | number,
  mediaType: 'movie' | 'tv' | 'series' = 'movie',
  season: number = 1,
  episode: number = 1
): Promise<FuegoCineServer[]> {
  const isMovie = mediaType === 'movie';
  const watchUrl = isMovie
    ? `https://fuegocine.com/movies/watch/${slug}/${id}`
    : `https://fuegocine.com/shows/watch/${slug}/${id}/${season}/${episode}`;

  try {
    let res = await fetch(watchUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(5000),
    });

    // Si es serie y la ruta directa dio 404, buscar la temporada y episodio
    if (!isMovie && (!res.ok || res.status === 404)) {
      const showDetailUrl = `https://fuegocine.com/shows/details/${slug}/${id}`;
      const dRes = await fetch(showDetailUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(4500),
      });
      if (dRes.ok) {
        const dHtml = await dRes.text();
        const seasonLinks = [...dHtml.matchAll(/href="([^"]*shows\/[^"]*seasons\/[^"]*)"/gi)].map((m) => m[1]);
        if (seasonLinks.length > 0) {
          const sRes = await fetch(seasonLinks[0], {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(4500),
          });
          if (sRes.ok) {
            const sHtml = await sRes.text();
            const epPattern = new RegExp(
              `href="([^"]*shows\\/[^"\\/]+\\/${String(season).padStart(2, '0')}x${String(episode).padStart(2, '0')}[^"]*)"`,
              'i'
            );
            const epMatch = sHtml.match(epPattern);
            if (epMatch) {
              res = await fetch(epMatch[1], {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(5000),
              });
            }
          }
        }
      }
    }

    if (!res.ok) {
      console.warn(`[fuegocine] HTTP ${res.status} en ${watchUrl}`);
      return [];
    }

    const html = await res.text();
    return parseFuegoCineHtml(html);
  } catch (err: any) {
    console.warn(`[fuegocine] Error consultando ${watchUrl}:`, err?.message);
    return [];
  }
}
