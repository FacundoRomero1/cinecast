import { getEpisode, searchAnime } from 'animeav1-api';
import type { AnimeServer } from './types.js';

export async function getServers(title: string, episode: number): Promise<AnimeServer[]> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return [];

  const results: AnimeServer[] = [];

  try {
    let slug: string | null = null;
    try {
      const items = await searchAnime(cleanTitle);
      if (Array.isArray(items) && items.length > 0) {
        slug = items[0]?.slug || null;
      }
    } catch (err: any) {
      console.warn('[animeav1] searchAnime error:', err?.message);
    }

    if (!slug) {
      slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    if (slug) {
      const epData = await getEpisode(slug, episode);
      if (epData && epData.embeds) {
        const variants: Array<'SUB' | 'DUB'> = ['SUB', 'DUB'];
        for (const variant of variants) {
          const mirrors = epData.embeds[variant] || [];
          for (const m of mirrors) {
            if (m.url && typeof m.url === 'string') {
              const isHls = m.url.includes('.m3u8');
              results.push({
                provider: 'animeav1',
                name: `AnimeAV1 (${m.server || 'Mirror'})`,
                url: m.url,
                type: isHls ? 'hls' : 'iframe',
                language: variant === 'DUB' ? 'latino' : 'sub',
              });
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[animeav1] Error en getServers:', err?.message);
  }

  // Fallback por si animeav1-api falló pero la página responde
  if (results.length === 0) {
    try {
      const directSlug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const url = `https://animeav1.com/media/${directSlug}/${episode}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const html = await r.text();
        const kitStartIdx = html.indexOf('kit.start');
        if (kitStartIdx !== -1) {
          const dataIdx = html.indexOf('data: [', kitStartIdx);
          if (dataIdx !== -1) {
            const arrayStart = dataIdx + 6;
            let depth = 0;
            let arrayEnd = -1;
            for (let i = arrayStart; i < html.length; i++) {
              if (html[i] === '[') depth++;
              else if (html[i] === ']') {
                depth--;
                if (depth === 0) {
                  arrayEnd = i;
                  break;
                }
              }
            }
            if (arrayEnd !== -1) {
              const dataArray = html.slice(arrayStart, arrayEnd + 1);
              const jsonArray = dataArray
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')
                .replace(/,"uses":\{"[^}]*"}"/g, '')
                .replace(/,"form":null/g, '')
                .replace(/,"error":null/g, '')
                .replace(/void 0/g, 'null');
              const data = JSON.parse(jsonArray);
              for (const slot of data) {
                if (slot?.data?.episode) {
                  const embeds = slot.data.embeds || {};
                  for (const variant of ['SUB', 'DUB'] as const) {
                    const links = embeds[variant] || [];
                    for (const link of links) {
                      if (link.url) {
                        let finalUrl = link.url;
                        const zillaMatch = finalUrl.match(/^https?:\/\/player\.zilla-networks\.com\/play\/([a-f0-9]{32})\/?$/i);
                        if (zillaMatch && zillaMatch[1]) {
                          finalUrl = `https://player.zilla-networks.com/m3u8/${zillaMatch[1]}`;
                        }
                        const isHls = finalUrl.includes('.m3u8') || (link.server || '').toLowerCase() === 'hls';
                        results.push({
                          provider: 'animeav1',
                          name: `AnimeAV1 (${link.server || 'Player'})`,
                          url: finalUrl,
                          type: isHls ? 'hls' : 'iframe',
                          language: variant === 'DUB' ? 'latino' : 'sub',
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  return results;
}
