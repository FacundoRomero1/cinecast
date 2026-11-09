/**
 * Servicio de resolución y caché de Anime en Español Latino oficial.
 * Mapea títulos de TMDB a slugs de sitios especializados (Latanime)
 * y genera URLs de episodios verificados.
 */

const SLUG_CACHE_KEY = 'cinecast_anime_latino_slugs_v1';

function getLocalSlugCache(): Record<string, string> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(SLUG_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalSlugCache(cache: Record<string, string>): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SLUG_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * Consulta el buscador de anime latino con el título y resuelve el slug del anime.
 * Prioriza los slugs que contienen "-latino".
 */
export async function resolveAnimeLatinoSlug(title: string): Promise<string | null> {
  if (!title) return null;
  const cleanTitle = title.replace(/\s*\([^)]*\)/g, '').trim();
  const cache = getLocalSlugCache();
  const cacheKey = cleanTitle.toLowerCase();
  if (cache[cacheKey]) return cache[cacheKey];

  try {
    // Si estamos en Electron, podemos llamar a la API de búsqueda de anime latino o hacer fetch
    const searchUrl = `https://latanime.org/buscar?q=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const matches = [...html.matchAll(/href="https:\/\/latanime\.org\/anime\/([^"]+)"/g)].map(m => m[1]);
    if (!matches || matches.length === 0) return null;

    // Priorizar coincidencia que contenga 'latino'
    const latinoMatch = matches.find(s => s.toLowerCase().includes('latino'));
    const resolvedSlug = latinoMatch || matches[0];

    cache[cacheKey] = resolvedSlug;
    saveLocalSlugCache(cache);
    return resolvedSlug;
  } catch (err) {
    console.warn('[animeLatinoService] Error resolviendo slug para:', cleanTitle, err);
    return null;
  }
}

/**
 * Genera la URL del episodio para el slug resuelto.
 */
export function getAnimeLatinoEpisodeUrl(slug: string, episode: number = 1): string {
  return `https://latanime.org/ver/${slug}-episodio-${episode}`;
}
