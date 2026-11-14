import fs from 'fs';
import path from 'path';

const DEFAULT_TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
export const TMDB_URL = 'https://api.themoviedb.org/3';

let configuredUserDataPath: string | null = null;

export function setTmdbConfigDir(userDataDir: string): void {
  if (userDataDir && typeof userDataDir === 'string') {
    configuredUserDataPath = userDataDir;
  }
}

export function getTmdbConfigFilePath(overrideUserDataDir?: string): string {
  const dir =
    overrideUserDataDir ||
    configuredUserDataPath ||
    process.env.CINECAST_USER_DATA_DIR ||
    path.join(process.cwd(), '.cinecast-data');
  return path.join(dir, 'cinecast-config.json');
}

export function getSavedTmdbKey(overrideUserDataDir?: string): string | null {
  try {
    const filePath = getTmdbConfigFilePath(overrideUserDataDir);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const key =
      typeof parsed?.tmdbKey === 'string' && parsed.tmdbKey.trim()
        ? parsed.tmdbKey.trim()
        : typeof parsed?.tmdbApiKey === 'string' && parsed.tmdbApiKey.trim()
        ? parsed.tmdbApiKey.trim()
        : null;
    return key;
  } catch (_) {
    return null;
  }
}

export function saveTmdbKeyToConfig(newKey: string, overrideUserDataDir?: string): void {
  const filePath = getTmdbConfigFilePath(overrideUserDataDir);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  let existing: Record<string, any> = {};
  try {
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    }
  } catch (_) {
    existing = {};
  }
  const trimmed = (newKey || '').trim();
  if (trimmed) {
    existing.tmdbKey = trimmed;
  } else {
    delete existing.tmdbKey;
    delete existing.tmdbApiKey;
  }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
}

export function getTmdbKey(overrideUserDataDir?: string): string {
  if (process.env.TMDB_API_KEY && process.env.TMDB_API_KEY.trim()) {
    return process.env.TMDB_API_KEY.trim();
  }
  const fromFile = getSavedTmdbKey(overrideUserDataDir);
  if (fromFile) {
    return fromFile;
  }
  return DEFAULT_TMDB_KEY;
}

export interface MediaServerEntry {
  name?: string;
  url?: string;
  type?: string;
  language?: string;
}

export interface SearchableMediaItem {
  id?: string;
  tmdbId?: number;
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
  mediaType?: string;
  notInCatalog?: boolean;
  servers?: MediaServerEntry[];
}

export function extractTmdbId(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return String(val);
  const str = String(val ?? '').trim();
  const tmdbMatch = str.match(/tmdb-(?:series|movie|anime)-(\d+)/i);
  if (tmdbMatch && tmdbMatch[1]) return tmdbMatch[1];
  const segMatch = str.match(/(?:movie|series|anime|tv)[-_](\d+)/i);
  if (segMatch && segMatch[1]) return segMatch[1];
  const exactDigits = str.match(/^(\d+)$/);
  if (exactDigits && exactDigits[1]) return exactDigits[1];
  const wordDigits = str.match(/\b\d{3,8}\b/);
  if (wordDigits && wordDigits[0]) return wordDigits[0];
  const anyDigits = str.match(/\d+/);
  return anyDigits && anyDigits[0] ? anyDigits[0] : '';
}

export function normalizeSearch(str: unknown): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const hasCJK = (str: unknown): boolean =>
  typeof str === 'string' && /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(str);

export async function getTypoSuggestion(query: string, userAgent?: string): Promise<string | null> {
  try {
    const u = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
    const headers: Record<string, string> = {};
    if (userAgent) headers['User-Agent'] = userAgent;
    const r = await fetch(u, {
      headers,
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const json: unknown = await r.json();
    if (Array.isArray(json) && Array.isArray(json[1])) {
      const suggestions = json[1] as unknown[];
      if (suggestions.length > 0) {
        const first = suggestions[0];
        if (typeof first === 'string' && normalizeSearch(first) !== normalizeSearch(query)) {
          return first;
        }
      }
    }
  } catch (_) {}
  return null;
}

export function rankAndDeduplicateItems<T extends SearchableMediaItem>(
  rawItems: T[],
  query: string,
  originalQuery: string = ''
): T[] {
  const qNorm = (query || '').trim().toLowerCase();
  const origNorm = (originalQuery || '').trim().toLowerCase();
  const qIsLatin = !hasCJK(qNorm) && !hasCJK(origNorm);

  const byTmdbId = new Map<string, T>();

  for (const item of rawItems) {
    const cat = item.category || item.type || (item.mediaType === 'tv' ? 'series' : 'movie');
    const idKey = item.tmdbId ? `tmdb-${cat}-${item.tmdbId}` : (item.id || '');
    if (!idKey) continue;

    const existing = byTmdbId.get(idKey);
    if (!existing) {
      byTmdbId.set(idKey, item);
    } else {
      // Si hay colisión entre idiomas/alfabetos, preferir título latino frente a CJK
      const existingHasCJK = hasCJK(existing.title);
      const newHasCJK = hasCJK(item.title);
      if (existingHasCJK && !newHasCJK) {
        byTmdbId.set(idKey, {
          ...item,
          servers:
            existing.servers && existing.servers.length > (item.servers?.length || 0)
              ? existing.servers
              : item.servers,
        });
      }
    }
  }

  const items = Array.from(byTmdbId.values());

  return items
    .map((item) => {
      let score = 0;
      const t = (item.title || '').trim().toLowerCase();
      const ot = (item.originalTitle || '').trim().toLowerCase();

      // 1. Coincidencia exacta (+1000)
      if (t === qNorm || (origNorm && t === origNorm) || ot === qNorm) {
        score += 1000;
      } else if (t.startsWith(qNorm) || (origNorm && t.startsWith(origNorm))) {
        // 2. Prefijo (+500)
        score += 500;
      } else if (t.includes(qNorm) || (origNorm && t.includes(origNorm)) || ot.includes(qNorm)) {
        // 3. Contiene (+200)
        score += 200;
      }

      // Si la query es latina, penalizar fuerte títulos 100% CJK (-400)
      if (qIsLatin && hasCJK(item.title)) {
        score -= 400;
      }

      // Desempate por valoración/popularidad
      score += (Number(item.voteAverage) || 7.0) * 5;

      return { item, _searchScore: score };
    })
    .sort((a, b) => b._searchScore - a._searchScore)
    .map((entry) => entry.item);
}
