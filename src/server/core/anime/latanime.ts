import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import type { AnimeServer } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface LatanimeSlugEntry {
  tmdbId: number;
  title: string;
  year?: number;
  slug: string;
  matchMethod?: string;
  matchedAt?: string;
}

let cachedSlugs: LatanimeSlugEntry[] | null = null;

export function loadLatanimeSlugs(): LatanimeSlugEntry[] {
  if (cachedSlugs) return cachedSlugs;
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'data', 'latanimeSlugs.json'),
      path.join(process.cwd(), 'cinecast', 'src', 'data', 'latanimeSlugs.json'),
      path.join(process.cwd(), 'data', 'latanimeSlugs.json'),
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
    console.warn('[latanime] Error cargando latanimeSlugs.json:', err?.message);
  }
  return [];
}

export function getSlugForAnime(title: string, tmdbId?: number | string): string {
  const slugs = loadLatanimeSlugs();
  if (tmdbId) {
    const numId = Number(tmdbId);
    const match = slugs.find((s) => s.tmdbId === numId);
    if (match?.slug) return match.slug;
  }

  const clean = (title || '').toLowerCase().trim();
  const matchTitle = slugs.find((s) => s.title.toLowerCase().trim() === clean);
  if (matchTitle?.slug) return matchTitle.slug;

  // Fallback slugify
  const baseSlug = clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${baseSlug}-latino`;
}

/**
 * Parser de HTML de /ver/{slug}-episodio-{episode} de Latanime
 * - Desofusca data-player en Base64
 * - Orden de servidores por el arreglo del sitio, con Filemoon primero
 * - audioLangs ['latino'] solo si la ficha dice latino
 */
export function parseLatanimeEpisodeHtml(html: string, slug?: string): AnimeServer[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);

  // 1. Detectar si la ficha declara "Latino"
  const bodyText = $('body').text() || html;
  const isLatinoSlug = (slug || '').toLowerCase().includes('latino');
  const isLatinoBadge =
    $('.opacity-75, .badge, .serieinfo, .seriedetails').text().toLowerCase().includes('latino') ||
    /idioma:\s*latino/i.test(bodyText) ||
    /latino/i.test($('title').text());

  const hasLatino = isLatinoSlug || isLatinoBadge;
  // Regla: Para iframes sin pistas HLS declaradas en stream, dejar audioLangs en 'desconocido'
  const audioLangs: string[] = ['desconocido'];
  const serverLang: 'latino' | 'sub' = hasLatino ? 'latino' : 'sub';

  // 2. Extraer y desofuscar reproductores data-player Base64
  const rawServers: Array<{ name: string; url: string; isFilemoon: boolean }> = [];

  $('[data-player]').each((_, el) => {
    const b64 = $(el).attr('data-player') || '';
    const label = $(el).text().trim() || 'Player';
    if (!b64) return;

    let decodedUrl = '';
    try {
      decodedUrl = Buffer.from(b64, 'base64').toString('utf-8').trim();
    } catch (_) { }

    if (decodedUrl && decodedUrl.startsWith('http')) {
      // Filtrar hosts bloqueados o caídos (verystream, fembed)
      const isBlocked = ['verystream', 'fembed'].some((h) => decodedUrl.toLowerCase().includes(h));
      if (isBlocked) return;

      const isFilemoon = decodedUrl.includes('filemoon') || /filemoon/i.test(label);
      rawServers.push({
        name: `Latanime (${label || (isFilemoon ? 'Filemoon' : 'Mirror')})`,
        url: decodedUrl,
        isFilemoon,
      });
    }
  });

  // Si no se extrajeron con data-player en DOM, buscar regex en HTML crudo
  if (rawServers.length === 0) {
    const b64Matches = [...html.matchAll(/data-player="([A-Za-z0-9+/=]{16,})"/gi)].map((m) => m[1]);
    for (const b64 of b64Matches) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8').trim();
        if (decoded.startsWith('http')) {
          const isBlocked = ['verystream', 'fembed'].some((h) => decoded.toLowerCase().includes(h));
          if (!isBlocked) {
            const isFilemoon = decoded.includes('filemoon');
            rawServers.push({
              name: `Latanime (${isFilemoon ? 'Filemoon' : 'Mirror'})`,
              url: decoded,
              isFilemoon,
            });
          }
        }
      } catch (_) { }
    }
  }

  // 3. Ordenar: Filemoon primero, y el resto manteniendo el orden del sitio
  rawServers.sort((a, b) => {
    if (a.isFilemoon && !b.isFilemoon) return -1;
    if (!a.isFilemoon && b.isFilemoon) return 1;
    return 0;
  });

  // 4. Mapear al tipo AnimeServer
  return rawServers.map((s) => ({
    provider: 'latanime',
    name: s.name,
    url: s.url,
    type: s.url.includes('.m3u8') ? 'hls' : 'iframe',
    language: serverLang,
    audioLangs,
  }));
}

/**
 * Obtener servidores de Latanime para un episodio de anime
 */
export async function getServers(
  title: string,
  episode: number,
  tmdbId?: number | string
): Promise<AnimeServer[]> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return [];

  const slug = getSlugForAnime(cleanTitle, tmdbId);
  const epUrl = `https://latanime.org/ver/${slug}-episodio-${episode}`;

  try {
    const res = await fetch(epUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[latanime] HTTP ${res.status} en ${epUrl}`);
      return [];
    }

    const html = await res.text();
    return parseLatanimeEpisodeHtml(html, slug);
  } catch (err: any) {
    console.warn(`[latanime] Error consultando ${epUrl}:`, err?.message);
    return [];
  }
}
