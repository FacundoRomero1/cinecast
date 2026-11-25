import type { AnimeServer } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function getServers(title: string, episode: number): Promise<AnimeServer[]> {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return [];

  const results: AnimeServer[] = [];

  try {
    // 1. Intentar con animeflv-api si está disponible
    try {
      const flv = await import('animeflv-api');
      if (typeof flv.searchAnime === 'function') {
        const searchRes = await Promise.race([
          flv.searchAnime(cleanTitle),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        if (searchRes && (searchRes as any).data && Array.isArray((searchRes as any).data)) {
          const first = (searchRes as any).data[0];
          const animeId = first?.id || first?.slug;
          if (animeId && typeof flv.getAnimeInfo === 'function') {
            const info = await Promise.race([
              flv.getAnimeInfo(animeId),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (info && Array.isArray(info.episodes)) {
              const ep = info.episodes.find((e: any) => Number(e.number) === episode);
              if (ep && ep.url) {
                const epRes = await fetch(ep.url, {
                  headers: { 'User-Agent': UA },
                  signal: AbortSignal.timeout(2000),
                });
                if (epRes.ok) {
                  const epHtml = await epRes.text();
                  const videosMatch = epHtml.match(/var videos = (\{.*?\});/);
                  if (videosMatch && videosMatch[1]) {
                    const videoData = JSON.parse(videosMatch[1]);
                    for (const langKey of ['SUB', 'LAT'] as const) {
                      const vList = videoData[langKey] || [];
                      for (const v of vList) {
                        const vUrl = v.code || v.url;
                        if (vUrl && typeof vUrl === 'string') {
                          results.push({
                            provider: 'animeflv',
                            name: `AnimeFLV (${v.title || v.server || 'Mirror'})`,
                            url: vUrl,
                            type: vUrl.includes('.m3u8') ? 'hls' : 'iframe',
                            language: langKey === 'LAT' ? 'latino' : 'sub',
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
      }
    } catch (err: any) {
      console.warn('[animeflv] animeflv-api error:', err?.message);
    }

    // 2. Direct scraping fallback si animeflv-api no devolvió servidores
    if (results.length === 0) {
      const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const candidates = [slug, `${slug}-tv`];
      for (const s of candidates) {
        try {
          const epUrl = `https://www3.animeflv.net/ver/${s}-${episode}`;
          const r = await fetch(epUrl, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(3000),
          });
          if (r.ok) {
            const html = await r.text();
            const videosMatch = html.match(/var videos = (\{.*?\});/);
            if (videosMatch && videosMatch[1]) {
              const videoData = JSON.parse(videosMatch[1]);
              for (const langKey of ['SUB', 'LAT'] as const) {
                const vList = videoData[langKey] || [];
                for (const v of vList) {
                  const vUrl = v.code || v.url;
                  if (vUrl && typeof vUrl === 'string') {
                    results.push({
                      provider: 'animeflv',
                      name: `AnimeFLV (${v.title || v.server || 'Mirror'})`,
                      url: vUrl,
                      type: vUrl.includes('.m3u8') ? 'hls' : 'iframe',
                      language: langKey === 'LAT' ? 'latino' : 'sub',
                    });
                  }
                }
              }
            }
            if (results.length > 0) break;
          }
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn('[animeflv] Error en getServers:', err?.message);
  }

  return results;
}
