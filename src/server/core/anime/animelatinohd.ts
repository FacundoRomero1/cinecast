import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { AnimeServer } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface AnimeLatinoSlugEntry {
  tmdbId: number;
  title: string;
  year?: number;
  slug: string;
  posterPath?: string;
  matchedAt: string;
  matchMethod: string;
}

let cachedSlugs: AnimeLatinoSlugEntry[] | null = null;

export function loadSlugs(): AnimeLatinoSlugEntry[] {
  if (cachedSlugs) return cachedSlugs;
  try {
    const localDir = typeof __dirname !== 'undefined' ? __dirname : '';
    const candidates = [
      path.join(process.cwd(), 'src', 'data', 'animeLatinoSlugs.json'),
      path.join(process.cwd(), 'cinecast', 'src', 'data', 'animeLatinoSlugs.json'),
      path.join(process.cwd(), 'data', 'animeLatinoSlugs.json'),
      localDir ? path.resolve(localDir, '../../data/animeLatinoSlugs.json') : '',
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedSlugs = Array.isArray(parsed) ? parsed : Object.values(parsed);
        return cachedSlugs;
      }
    }
  } catch (err: any) {
    console.warn('[animelatinohd] Error cargando animeLatinoSlugs.json:', err?.message);
  }
  return [];
}

export function getSlugForAnime(title: string, tmdbId?: number | string): string {
  const slugs = loadSlugs();
  if (tmdbId) {
    const numId = Number(tmdbId);
    const match = slugs.find((s) => s.tmdbId === numId);
    if (match?.slug) return match.slug;
  }

  const clean = (title || '').toLowerCase().trim();
  const matchTitle = slugs.find((s) => s.title.toLowerCase().trim() === clean);
  if (matchTitle?.slug) return matchTitle.slug;

  // Fallback slugify
  return clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parser de HTML de /ver/{slug}/{episode} de AnimeLatinoHD
 * - Lee la línea "Idioma:" y "Servidor:"
 * - Si Idioma contiene Latino -> audioLangs ['latino']
 * - Si Castellano -> audioLangs ['es']
 * - Si Subtitulado -> audioLangs ['sub']
 * - Extrae la URL del player Byse por código (el bloque "XXXX | Byse")
 * - Mapea "Delta" y "Epsilon" como dos entradas distintas
 */
export function parseEpisodeHtml(html: string): AnimeServer[] {
  if (!html || typeof html !== 'string') return [];

  // 1. Detección de Idioma: "Idioma: ..."
  let detectedAudio: 'latino' | 'es' | 'sub' = 'latino';
  let audioLangs: string[] = ['latino'];

  const idiomaPatterns = [
    /Idioma:\s*([^\r\n<]+)/i,
    /<strong>\s*Idioma:\s*<\/strong>\s*([^<]+)/i,
    /<b>\s*Idioma:\s*<\/b>\s*([^<]+)/i,
    /<span[^>]*class=["'][^"']*idioma[^"']*["'][^>]*>([^<]+)<\/span>/i,
    /data-language=["']([^"']+)["']/i,
    /data-lang=["']([^"']+)["']/i,
    /"(?:lang|idioma)"\s*:\s*"([^"]+)"/i,
  ];

  for (const pat of idiomaPatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      const raw = m[1].trim().toLowerCase();
      if (raw.includes('latino') || raw.includes('lat')) {
        detectedAudio = 'latino';
        audioLangs = ['latino'];
        break;
      } else if (raw.includes('castellano') || raw.includes('esp') || raw.includes('es-es')) {
        detectedAudio = 'es';
        audioLangs = ['es'];
        break;
      } else if (raw.includes('subtitulado') || raw.includes('sub') || raw.includes('japones') || raw.includes('jap')) {
        detectedAudio = 'sub';
        audioLangs = ['sub'];
        break;
      }
    }
  }

  const results: AnimeServer[] = [];
  let deltaCode: string | null = null;
  let epsilonCode: string | null = null;
  const otherByseCodes = new Map<string, string>();

  // 2. Uso de cheerio para extraer con precisión elementos con "Byse"
  try {
    const $ = cheerio.load(html);

    // Revisar texto completo en busca de "Idioma:"
    const bodyText = $('body').text() || html;
    const bodyLangMatch = bodyText.match(/Idioma:\s*([^\r\n]+)/i);
    if (bodyLangMatch && bodyLangMatch[1]) {
      const raw = bodyLangMatch[1].trim().toLowerCase();
      if (raw.includes('latino')) {
        detectedAudio = 'latino';
        audioLangs = ['latino'];
      } else if (raw.includes('castellano')) {
        detectedAudio = 'es';
        audioLangs = ['es'];
      } else if (raw.includes('subtitulado') || raw.includes('sub')) {
        detectedAudio = 'sub';
        audioLangs = ['sub'];
      }
    }

    $('button, a, li, option, div, span').each((_, el) => {
      const text = $(el).text().trim();
      if (/byse/i.test(text)) {
        // Bloque del estilo "XXXX | Byse" o "Delta | Byse" o "Epsilon | Byse"
        const byseMatch = text.match(/([A-Za-z0-9_\-\s]+)\|\s*Byse/i);
        const prefix = byseMatch ? byseMatch[1].trim() : text;

        const code =
          $(el).attr('data-code') ||
          $(el).attr('data-url') ||
          $(el).attr('data-id') ||
          $(el).attr('value') ||
          $(el).attr('href') ||
          $(el).find('[data-code]').attr('data-code') ||
          (prefix.length >= 6 && !/^(delta|epsilon|servidor|opcion)$/i.test(prefix) ? prefix : '');

        if (code) {
          const lower = prefix.toLowerCase();
          if (lower.includes('delta')) {
            if (!deltaCode) deltaCode = code;
          } else if (lower.includes('epsilon')) {
            if (!epsilonCode) epsilonCode = code;
          } else {
            otherByseCodes.set(prefix, code);
          }
        }
      }
    });
  } catch (_) {}

  // 3. Parser estructurado de JSON embebido (var servers = [...], players = [...])
  const jsDataPatterns = [
    /(?:var|let|const)\s+(?:servers|players|opt|reproductores)\s*=\s*(\[.*?\]|\{.*?\});/s,
    /window\.servers\s*=\s*(\[.*?\]|\{.*?\});/s,
  ];

  for (const jsPat of jsDataPatterns) {
    const jsMatch = html.match(jsPat);
    if (jsMatch && jsMatch[1]) {
      try {
        const parsed = JSON.parse(jsMatch[1]);
        const list = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
        for (const item of list as any[]) {
          if (!item) continue;
          const serverName = String(item.server || item.name || item.title || '').trim();
          const player = String(item.player || item.name || item.title || '').trim();
          const code = String(item.code || item.url || item.id || '').trim();
          const isByse = /byse/i.test(player) || /byse/i.test(serverName) || (code && code.includes('byse.sx'));

          if (isByse && code) {
            if (/delta/i.test(serverName)) {
              if (!deltaCode) deltaCode = code;
            } else if (/epsilon/i.test(serverName)) {
              if (!epsilonCode) epsilonCode = code;
            } else {
              otherByseCodes.set(serverName || 'Byse', code);
            }
          }
        }
      } catch (_) {}
    }
  }

  // 4. Búsqueda regex directa para Servidor: Delta / Servidor: Epsilon con código Byse
  if (!deltaCode) {
    const deltaMatch = html.match(
      /Servidor:\s*Delta[\s\S]{0,120}?(?:data-code=["']([^"']+)["']|byse\.sx\/[ed]\/([A-Za-z0-9_-]+))/i
    );
    if (deltaMatch) deltaCode = deltaMatch[1] || deltaMatch[2];
  }
  if (!epsilonCode) {
    const epsilonMatch = html.match(
      /Servidor:\s*Epsilon[\s\S]{0,120}?(?:data-code=["']([^"']+)["']|byse\.sx\/[ed]\/([A-Za-z0-9_-]+))/i
    );
    if (epsilonMatch) epsilonCode = epsilonMatch[1] || epsilonMatch[2];
  }

  // Si aún no se encontró pero hay bloques planos "Delta | Byse" o "Epsilon | Byse"
  if (!deltaCode || !epsilonCode) {
    const rawBlocks = [...html.matchAll(/([A-Za-z0-9_\-]+)\s*\|\s*Byse/gi)];
    for (const b of rawBlocks) {
      const codeOrName = b[1].trim();
      const codeOrNameLower = codeOrName.toLowerCase();
      if (codeOrNameLower.includes('delta')) {
        // Buscar código en las proximidades inmediatas
        const idx = b.index ?? 0;
        const sub = html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 100));
        const cMatch = sub.match(/data-code=["']([^"']+)["']/i);
        if (cMatch && !deltaCode) deltaCode = cMatch[1];
      } else if (codeOrNameLower.includes('epsilon')) {
        const idx = b.index ?? 0;
        const sub = html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 100));
        const cMatch = sub.match(/data-code=["']([^"']+)["']/i);
        if (cMatch && !epsilonCode) epsilonCode = cMatch[1];
      } else if (codeOrName.length >= 6) {
        otherByseCodes.set(codeOrName, codeOrName);
      }
    }
  }

  const serverLanguage: 'latino' | 'es' | 'sub' =
    detectedAudio === 'latino' ? 'latino' : detectedAudio === 'es' ? 'es' : 'sub';

  const toEmbedUrl = (c: string): { primary: string; fallback: string } => {
    if (c.startsWith('http')) {
      const isFilemoon = c.includes('filemoon');
      return {
        primary: isFilemoon ? c : c.replace('byse.sx', 'filemoon.sx'),
        fallback: isFilemoon ? c.replace('filemoon.sx', 'byse.sx') : c,
      };
    }
    return {
      primary: `https://filemoon.sx/e/${c}`,
      fallback: `https://byse.sx/e/${c}`,
    };
  };

  // Construir entrada Delta (mapeada como entrada distinta)
  if (deltaCode) {
    const urls = toEmbedUrl(deltaCode);
    results.push({
      provider: 'animelatinohd',
      name: 'AnimeLatinoHD (Delta)',
      url: urls.primary,
      type: 'iframe',
      language: serverLanguage,
      audioLangs,
    });
    // Fallback Byse
    if (urls.fallback !== urls.primary) {
      results.push({
        provider: 'animelatinohd',
        name: 'AnimeLatinoHD (Delta - Byse)',
        url: urls.fallback,
        type: 'iframe',
        language: serverLanguage,
        audioLangs,
      });
    }
  }

  // Construir entrada Epsilon (mapeada como entrada distinta)
  if (epsilonCode) {
    const urls = toEmbedUrl(epsilonCode);
    results.push({
      provider: 'animelatinohd',
      name: 'AnimeLatinoHD (Epsilon)',
      url: urls.primary,
      type: 'iframe',
      language: serverLanguage,
      audioLangs,
    });
    // Fallback Byse
    if (urls.fallback !== urls.primary) {
      results.push({
        provider: 'animelatinohd',
        name: 'AnimeLatinoHD (Epsilon - Byse)',
        url: urls.fallback,
        type: 'iframe',
        language: serverLanguage,
        audioLangs,
      });
    }
  }

  // Fallback si hay otros reproductores Byse
  if (results.length === 0) {
    for (const [sName, sCode] of otherByseCodes.entries()) {
      const urls = toEmbedUrl(sCode);
      results.push({
        provider: 'animelatinohd',
        name: `AnimeLatinoHD (${sName || 'Filemoon'})`,
        url: urls.primary,
        type: 'iframe',
        language: serverLanguage,
        audioLangs,
      });
    }
  }

  return results;
}

/**
 * Obtener servidores de un episodio de anime en AnimeLatinoHD
 */
export async function getServers(
  title: string,
  episode: number,
  tmdbId?: number | string
): Promise<AnimeServer[]> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return [];

  const slug = getSlugForAnime(cleanTitle, tmdbId);
  const epUrl = `https://animelatinohd.com/ver/${slug}/${episode}`;

  try {
    const res = await fetch(epUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (res.status === 403 || res.headers.get('cf-mitigated') === 'challenge') {
      console.warn(`[animelatinohd] Cloudflare Challenge (403) en ${epUrl}`);
      return [];
    }

    if (!res.ok) {
      console.warn(`[animelatinohd] HTTP ${res.status} en ${epUrl}`);
      return [];
    }

    const html = await res.text();
    return parseEpisodeHtml(html);
  } catch (err: any) {
    console.warn(`[animelatinohd] Error consultando ${epUrl}:`, err?.message);
    return [];
  }
}
