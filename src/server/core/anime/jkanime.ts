import * as cheerio from 'cheerio';
import type { AnimeServer } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function getServers(title: string, episode: number): Promise<AnimeServer[]> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return [];

  const results: AnimeServer[] = [];
  try {
    // 1. Buscar en JKAnime
    const searchSlug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const searchUrl = `https://jkanime.net/buscar/${encodeURIComponent(searchSlug)}/`;

    const candidateSlugs: string[] = [];
    try {
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(4500),
      });
      if (searchRes.ok) {
        const searchHtml = await searchRes.text();
        const $ = cheerio.load(searchHtml);
        $('.anime__item').each((_, el) => {
          const href = $(el).find('a').first().attr('href') || '';
          const s = href.replace('https://jkanime.net/', '').replace(/\//g, '').trim();
          if (s && !candidateSlugs.includes(s)) {
            candidateSlugs.push(s);
          }
        });
      }
    } catch (err: any) {
      console.warn('[jkanime] Error buscando anime:', err?.message);
    }

    // Slugs alternativos si la búsqueda falló
    const fallbackSlug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!candidateSlugs.includes(fallbackSlug)) {
      candidateSlugs.push(fallbackSlug);
    }
    const tvSlug = `${fallbackSlug}-tv`;
    if (!candidateSlugs.includes(tvSlug)) {
      candidateSlugs.push(tvSlug);
    }

    // 2. Probar los primeros slugs
    for (const slug of candidateSlugs.slice(0, 3)) {
      try {
        const epUrl = `https://jkanime.net/${slug}/${episode}/`;
        const epRes = await fetch(epUrl, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5000),
        });

        if (!epRes.ok) continue;
        const epHtml = await epRes.text();

        // Extraer var servers = [...]
        const srvMatch = epHtml.match(/var servers = (\[.*?\]);/s);
        if (srvMatch && srvMatch[1]) {
          try {
            const rawServers = JSON.parse(srvMatch[1]);
            if (Array.isArray(rawServers)) {
              for (const s of rawServers) {
                let decUrl = '';
                try {
                  if (typeof s.remote === 'string') {
                    decUrl = Buffer.from(s.remote, 'base64').toString('utf-8').trim();
                  }
                } catch (_) {}

                if (decUrl && decUrl.startsWith('http')) {
                  const sName = s.server || 'Stream';
                  results.push({
                    provider: 'jkanime',
                    name: `JKAnime (${sName})`,
                    url: decUrl,
                    type: decUrl.includes('.m3u8') ? 'hls' : 'iframe',
                    language: s.lang === 2 ? 'latino' : 'sub',
                  });
                }
              }
            }
          } catch (_) {}
        }

        // Extraer video[n] = '<iframe src="..."'
        const videoMatches = [...epHtml.matchAll(/video\[\d+\]\s*=\s*'<iframe[^>]+src="([^"]+)"/g)].map((m) => m[1]);
        for (const vUrl of videoMatches) {
          if (vUrl && vUrl.startsWith('http') && !results.some((r) => r.url === vUrl)) {
            results.push({
              provider: 'jkanime',
              name: 'JKAnime (Player)',
              url: vUrl,
              type: vUrl.includes('.m3u8') ? 'hls' : 'iframe',
              language: 'sub',
            });
          }
        }

        if (results.length > 0) break;
      } catch (err: any) {
        console.warn(`[jkanime] Error en episodio para slug ${slug}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.warn('[jkanime] Error general getServers:', err?.message);
  }

  return results;
}
