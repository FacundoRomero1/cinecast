/**
 * src/server/core/homeCuration.ts
 * Curador inteligente para la pantalla de Inicio (/api/home):
 * - Tendencias esta semana (TMDB + fallback popularity.json)
 * - "Porque viste <título>" (TMDB recommendations)
 * - Estrenos (año actual y anterior)
 * - Anime popular y Series para maratonear
 * - Filas de géneros rotativas diarias priorizando historial
 * - Puntuación Bayesiana (mínimo 200 votos)
 * - Deduplicación estricta entre filas (un ítem = máx 1 fila)
 * - Rotación determinista con semilla diaria entre top 40
 */
import fs from 'node:fs';
import path from 'node:path';
import { getTmdbKey, TMDB_URL } from './tmdb.js';
import { type CatalogItem, type CatalogCardItem, toCatalogCard } from './catalogSchema.js';

export interface PopularityEntry {
  pop: number;
  votes: number;
  avg: number;
  rank: number;
}

export type PopularityMap = Record<string, PopularityEntry>;

// Cache en memoria para popularidad
let memoryPopularityMap: PopularityMap | null = null;
let lastPopularityMtime = 0;

export function loadPopularityMap(baseDir: string): PopularityMap {
  const candidates = [
    path.join(baseDir, 'public', 'data', 'popularity.json'),
    path.join(process.cwd(), 'public', 'data', 'popularity.json'),
    path.join(baseDir, 'dist', 'data', 'popularity.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const st = fs.statSync(p);
        if (memoryPopularityMap && st.mtimeMs === lastPopularityMtime) {
          return memoryPopularityMap;
        }
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw && typeof raw === 'object') {
          memoryPopularityMap = raw as PopularityMap;
          lastPopularityMtime = st.mtimeMs;
          return memoryPopularityMap;
        }
      } catch (_) {}
    }
  }
  return {};
}

export function getItemPopularity(
  item: CatalogItem,
  popMap: PopularityMap
): PopularityEntry {
  const tmdb = item.tmdbId || (item.id && String(item.id).match(/\d+$/)?.[0]);
  if (tmdb) {
    const keys = [
      `${item.type}:${tmdb}`,
      `${item.category}:${tmdb}`,
      `movie:${tmdb}`,
      `tv:${tmdb}`,
      `anime:${tmdb}`,
    ];
    for (const k of keys) {
      if (popMap[k]) return popMap[k];
    }
  }
  // Fallback si no está en popularity.json
  const votes = item.rating >= 8.5 ? 500 : item.rating >= 7 ? 250 : 0;
  return {
    pop: item.rating * 10,
    votes,
    avg: item.rating,
    rank: 99999,
  };
}

export function getBayesianScore(votes: number, avg: number, m = 200, C = 6.5): number {
  if (votes <= 0) return 0;
  return (votes / (votes + m)) * avg + (m / (votes + m)) * C;
}

// ── Caché de red para TMDB (12 horas en disco y memoria) ─────────────────────
const memoryCache = new Map<string, { timestamp: number; data: any }>();
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function getCacheDir(baseDir: string): string {
  const candidates = [
    path.join(baseDir, 'scratch', 'cache'),
    path.join(process.cwd(), 'scratch', 'cache'),
    path.join(baseDir, '.cinecast-data', 'cache'),
  ];
  for (const d of candidates) {
    try {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return d;
    } catch (_) {}
  }
  return path.join(baseDir, 'scratch');
}

async function fetchTmdbCached<T>(
  url: string,
  cacheKey: string,
  baseDir: string
): Promise<T | null> {
  const now = Date.now();
  // 1. Memoria
  const mem = memoryCache.get(cacheKey);
  if (mem && now - mem.timestamp < TWELVE_HOURS_MS) {
    return mem.data as T;
  }

  // 2. Disco
  const cacheDir = getCacheDir(baseDir);
  const safeFilename = `tmdb-${cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  const filePath = path.join(cacheDir, safeFilename);

  if (fs.existsSync(filePath)) {
    try {
      const diskData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (diskData && typeof diskData.timestamp === 'number' && now - diskData.timestamp < TWELVE_HOURS_MS) {
        memoryCache.set(cacheKey, diskData);
        return diskData.data as T;
      }
    } catch (_) {}
  }

  // 3. Fetch de red
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const payload = { timestamp: now, data: json };
    memoryCache.set(cacheKey, payload);
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    } catch (_) {}
    return json as T;
  } catch (_) {
    // Si falla la red, intentar usar disco expirado si existe
    if (fs.existsSync(filePath)) {
      try {
        const diskData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (diskData?.data) return diskData.data as T;
      } catch (_) {}
    }
    return null;
  }
}

// ── Semilla diaria y PRNG Mulberry32 ─────────────────────────────────────────
function getDaySeed(dateStr?: string): number {
  let target = dateStr;
  if (!target || !/^\d{4}-\d{2}-\d{2}/.test(target)) {
    const d = new Date();
    target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < target.length; i++) {
    h ^= target.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  const rand = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }
  return result;
}

function applyDayRotation<T>(items: T[], daySeed: number, rowSalt: number): T[] {
  if (items.length <= 1) return items;
  const topCount = Math.min(40, items.length);
  const topSlice = items.slice(0, topCount);
  const restSlice = items.slice(topCount);
  const shuffledTop = seededShuffle(topSlice, (daySeed ^ rowSalt) >>> 0);
  return [...shuffledTop, ...restSlice];
}

export interface HomeRowResult {
  id: string;
  title: string;
  items: CatalogCardItem[];
}

export interface BuildHomeParams {
  catalog: CatalogItem[];
  seenIds?: string[] | undefined;
  dateStr?: string | undefined;
  baseDir?: string | undefined;
}

export async function buildCuratedHome(params: BuildHomeParams): Promise<HomeRowResult[]> {
  const { catalog, seenIds = [], dateStr, baseDir = process.cwd() } = params;
  const daySeed = getDaySeed(dateStr);
  const popMap = loadPopularityMap(baseDir);
  const apiKey = getTmdbKey();

  const available = catalog.filter((m) => !m.upcoming);
  const byTmdbId = new Map<number, CatalogItem[]>();
  const byId = new Map<string, CatalogItem>();

  for (const item of available) {
    byId.set(item.id, item);
    const tmdb = item.tmdbId || (item.id && String(item.id).match(/\d+$/)?.[0]);
    if (tmdb) {
      const n = Number(tmdb);
      const list = byTmdbId.get(n) || [];
      list.push(item);
      byTmdbId.set(n, list);
    }
  }

  const usedItemIds = new Set<string>();
  const rows: HomeRowResult[] = [];

  // Helper para convertir y registrar en usedItemIds
  function takeUniqueCards(
    candidates: CatalogItem[],
    count: number,
    rowSalt: number,
    minVotesRequired = 0
  ): CatalogCardItem[] {
    const valid = candidates.filter((item) => {
      if (usedItemIds.has(item.id)) return false;
      if (minVotesRequired > 0) {
        const pop = getItemPopularity(item, popMap);
        if (pop && typeof pop.votes === 'number' && pop.votes > 0 && pop.votes < minVotesRequired) {
          return false;
        }
      }
      return true;
    });

    const rotated = applyDayRotation(valid, daySeed, rowSalt);
    const selected = rotated.slice(0, count);
    for (const it of selected) {
      usedItemIds.add(it.id);
    }
    return selected.map(toCatalogCard);
  }

  // ── FILA 1: Tendencias esta semana (TMDB /trending/all/week) ──────────────
  const trendingUrl = `${TMDB_URL}/trending/all/week?api_key=${apiKey}&language=es-MX`;
  const trendingData = await fetchTmdbCached<{ results?: Array<{ id: number; title?: string; name?: string; popularity?: number }> }>(
    trendingUrl,
    'trending_week',
    baseDir
  );

  const trendingCandidates: CatalogItem[] = [];
  const trendingSeen = new Set<string>();

  if (Array.isArray(trendingData?.results)) {
    for (const r of trendingData.results) {
      const matches = byTmdbId.get(r.id) || [];
      for (const m of matches) {
        if (!trendingSeen.has(m.id)) {
          trendingSeen.add(m.id);
          trendingCandidates.push(m);
        }
      }
    }
  }

  // Si faltan para llegar a 40, completar con los más populares según popularity.json
  if (trendingCandidates.length < 40) {
    const sortedByPop = [...available].sort((a, b) => {
      const pA = getItemPopularity(a, popMap);
      const pB = getItemPopularity(b, popMap);
      return pB.pop - pA.pop || b.rating - a.rating;
    });
    for (const it of sortedByPop) {
      if (!trendingSeen.has(it.id)) {
        trendingSeen.add(it.id);
        trendingCandidates.push(it);
        if (trendingCandidates.length >= 50) break;
      }
    }
  }

  // Regla Hero: El hero sale de los 5 primeros de Tendencias con fondo y sinopsis.
  // Aseguramos que los primeros candidatos tengan backdropUrl válido.
  const withBackdrop = trendingCandidates.filter((it) => Boolean(it.backdropUrl && it.backdropUrl.startsWith('http')));
  const withoutBackdrop = trendingCandidates.filter((it) => !it.backdropUrl || !it.backdropUrl.startsWith('http'));
  const heroPrioritizedTrending = [...withBackdrop, ...withoutBackdrop];

  const trendingItems = takeUniqueCards(heroPrioritizedTrending, 20, 101);
  if (trendingItems.length >= 12) {
    rows.push({
      id: 'trending',
      title: 'Tendencias esta semana',
      items: trendingItems,
    });
  }

  // ── FILAS 2 & 3: "Porque viste <título>" (hasta 2 títulos del historial) ──
  const seenCatalogItems: CatalogItem[] = [];
  const seenIdSet = new Set<string>();

  for (const rawId of seenIds) {
    const cleaned = String(rawId).replace(/_s\d+_e\d+$/, '');
    const found = byId.get(cleaned) || byId.get(rawId);
    if (found && !seenIdSet.has(found.id)) {
      seenIdSet.add(found.id);
      seenCatalogItems.push(found);
      if (seenCatalogItems.length >= 2) break;
    }
  }

  for (let sIdx = 0; sIdx < seenCatalogItems.length; sIdx++) {
    const targetItem = seenCatalogItems[sIdx];
    if (!targetItem) continue;
    const tmdbId = targetItem.tmdbId || (targetItem.id && String(targetItem.id).match(/\d+$/)?.[0]);
    if (!tmdbId) continue;

    const mediaType = targetItem.type === 'movie' ? 'movie' : 'tv';
    const recUrl = `${TMDB_URL}/${mediaType}/${tmdbId}/recommendations?api_key=${apiKey}&language=es-MX`;
    const recData = await fetchTmdbCached<{ results?: Array<{ id: number; title?: string; name?: string }> }>(
      recUrl,
      `rec_${mediaType}_${tmdbId}`,
      baseDir
    );

    const recCandidates: CatalogItem[] = [];
    const recSeen = new Set<string>();

    if (Array.isArray(recData?.results)) {
      for (const r of recData.results) {
        const matches = byTmdbId.get(r.id) || [];
        for (const m of matches) {
          if (!recSeen.has(m.id) && !usedItemIds.has(m.id) && m.id !== targetItem.id) {
            recSeen.add(m.id);
            recCandidates.push(m);
          }
        }
      }
    }

    // Fallback: Si TMDB da menos de 16 recomendaciones en catálogo, completar con ítems de sus géneros
    if (recCandidates.length < 20) {
      const targetGenres = new Set(targetItem.genres || []);
      const genreMatches = available
        .filter((it) => it.id !== targetItem.id && !recSeen.has(it.id) && !usedItemIds.has(it.id) && it.genres.some((g) => targetGenres.has(g)))
        .sort((a, b) => {
          const pA = getItemPopularity(a, popMap);
          const pB = getItemPopularity(b, popMap);
          return pB.pop - pA.pop || b.rating - a.rating;
        });
      for (const gm of genreMatches) {
        recSeen.add(gm.id);
        recCandidates.push(gm);
        if (recCandidates.length >= 30) break;
      }
    }

    const recCards = takeUniqueCards(recCandidates, 18, 200 + sIdx * 50);
    if (recCards.length >= 12) {
      rows.push({
        id: `because-you-watched-${tmdbId}`,
        title: `Porque viste ${targetItem.title}`,
        items: recCards,
      });
    }
  }

  // ── FILA 4: Estrenos (año actual y anterior, no upcoming, por popularidad) ─
  const currentYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : new Date().getFullYear();
  const validYears = new Set([currentYear, currentYear - 1]);

  const releasesCandidates = available
    .filter((m) => validYears.has(m.year) && !usedItemIds.has(m.id))
    .sort((a, b) => {
      const pA = getItemPopularity(a, popMap);
      const pB = getItemPopularity(b, popMap);
      return pB.pop - pA.pop || b.rating - a.rating;
    });

  const releasesItems = takeUniqueCards(releasesCandidates, 20, 301);
  if (releasesItems.length >= 12) {
    rows.push({
      id: 'new-releases',
      title: 'Estrenos',
      items: releasesItems,
    });
  }

  // ── FILA 5: Anime popular ─────────────────────────────────────────────────
  const animeCandidates = available
    .filter((m) => m.category === 'anime' && !usedItemIds.has(m.id))
    .sort((a, b) => {
      const pA = getItemPopularity(a, popMap);
      const pB = getItemPopularity(b, popMap);
      return pB.pop - pA.pop || b.rating - a.rating;
    });

  const animeItems = takeUniqueCards(animeCandidates, 20, 401);
  if (animeItems.length >= 12) {
    rows.push({
      id: 'featured-anime',
      title: 'Anime popular',
      items: animeItems,
    });
  }

  // ── FILA 6: Series para maratonear ────────────────────────────────────────
  const seriesCandidates = available
    .filter((m) => (m.category === 'series' || m.type === 'series') && !usedItemIds.has(m.id))
    .sort((a, b) => {
      const pA = getItemPopularity(a, popMap);
      const pB = getItemPopularity(b, popMap);
      return pB.pop - pA.pop || b.rating - a.rating;
    });

  const seriesItems = takeUniqueCards(seriesCandidates, 20, 501);
  if (seriesItems.length >= 12) {
    rows.push({
      id: 'featured-series',
      title: 'Series para maratonear',
      items: seriesItems,
    });
  }

  // ── FILAS 7, 8, 9: 3 filas de géneros por popularidad rotando por día ───────
  // Regla (g): puntuación Bayesiana (mínimo 200 votos si hay dato).
  // Priorizar los géneros del historial
  const historyGenreCounts = new Map<string, number>();
  for (const sItem of seenCatalogItems) {
    for (const g of sItem.genres || []) {
      historyGenreCounts.set(g, (historyGenreCounts.get(g) || 0) + 1);
    }
  }

  // Recolectar todos los géneros que tengan al menos 15 ítems disponibles
  const genreCountMap = new Map<string, CatalogItem[]>();
  for (const item of available) {
    if (usedItemIds.has(item.id)) continue;
    for (const g of item.genres || []) {
      const list = genreCountMap.get(g) || [];
      list.push(item);
      genreCountMap.set(g, list);
    }
  }

  const availableGenreNames = Array.from(genreCountMap.keys()).filter((g) => {
    const list = genreCountMap.get(g) || [];
    return list.length >= 15;
  });

  // Ordenar géneros: primero los más vistos en historial, luego rotados por día
  const historyGenres = availableGenreNames
    .filter((g) => (historyGenreCounts.get(g) || 0) > 0)
    .sort((a, b) => (historyGenreCounts.get(b) || 0) - (historyGenreCounts.get(a) || 0));

  const otherGenres = availableGenreNames.filter((g) => (historyGenreCounts.get(g) || 0) === 0);
  const rotatedOtherGenres = seededShuffle(otherGenres, daySeed ^ 777);

  const prioritizedGenres = [...historyGenres, ...rotatedOtherGenres];

  let genresAdded = 0;
  for (let gIdx = 0; gIdx < prioritizedGenres.length && genresAdded < 3; gIdx++) {
    const genreName = prioritizedGenres[gIdx];
    if (!genreName) continue;
    const rawCandidates = (genreCountMap.get(genreName) || []).filter((it) => !usedItemIds.has(it.id));

    // Ordenar candidatos por puntuación Bayesiana & popularidad
    const sortedGenreItems = rawCandidates.sort((a, b) => {
      const pA = getItemPopularity(a, popMap);
      const pB = getItemPopularity(b, popMap);
      const scoreA = getBayesianScore(pA.votes, pA.avg);
      const scoreB = getBayesianScore(pB.votes, pB.avg);
      return scoreB - scoreA || pB.pop - pA.pop || b.rating - a.rating;
    });

    // Mínimo 200 votos si hay dato
    const genreCards = takeUniqueCards(sortedGenreItems, 18, 600 + gIdx * 33, 200);
    if (genreCards.length >= 12) {
      const slug = `genre-${genreName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}`;
      rows.push({
        id: slug,
        title: genreName,
        items: genreCards,
      });
      genresAdded++;
    }
  }

  return rows;
}
