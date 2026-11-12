#!/usr/bin/env node
/**
 * scripts/repair-history.cjs
 * - Lee el historial actual de watch_history.json
 * - Respalda en historial-respaldo-<fecha>.json
 * - Elimina duplicados por serie (deja el más reciente o de mayor temporada/capítulo)
 * - Reemplaza carátulas inválidas/unsplash por las del catálogo oficial
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 1. Ubicar archivo de historial
const candidates = [
  path.join(rootDir, 'public', 'data', 'watch_history.json'),
  path.join(rootDir, '.cinecast-data', 'watch_history.json'),
  path.join(rootDir, 'watch_history.json'),
];

let historyPath = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    historyPath = p;
    break;
  }
}

if (!historyPath) {
  // Crear en public/data si no existe
  historyPath = candidates[0];
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, '[]', 'utf8');
}

console.log(`[repair-history] Archivo de historial: ${historyPath}`);

let rawHistory = [];
try {
  rawHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(rawHistory)) rawHistory = [];
} catch (err) {
  console.error('[repair-history] Error leyendo JSON:', err.message);
  rawHistory = [];
}

console.log(`[repair-history] Total de ítems antes de reparar: ${rawHistory.length}`);

// 2. Respaldo obligatorio con fecha ISO
const now = new Date();
const dateStr = now.toISOString().replace(/[:.]/g, '-');
const backupFilename = `historial-respaldo-${dateStr}.json`;
const backupPath = path.join(path.dirname(historyPath), backupFilename);

fs.writeFileSync(backupPath, JSON.stringify(rawHistory, null, 2), 'utf8');
console.log(`[repair-history] Respaldo creado en: ${backupPath}`);

// Copia adicional en scratch/ si existe
const scratchDir = path.join(rootDir, 'scratch');
if (fs.existsSync(scratchDir)) {
  fs.writeFileSync(path.join(scratchDir, backupFilename), JSON.stringify(rawHistory, null, 2), 'utf8');
}

// 3. Cargar catálogo oficial para sustituir carátulas unsplash o inválidas
let catalogItems = [];
try {
  const catPath = path.join(rootDir, 'public', 'data', 'catalog.json');
  if (fs.existsSync(catPath)) {
    const raw = JSON.parse(fs.readFileSync(catPath, 'utf8'));
    catalogItems = Array.isArray(raw) ? raw : (raw.items || []);
  }
} catch (_) {}

const catalogMap = new Map();
for (const it of catalogItems) {
  if (it.id) catalogMap.set(String(it.id), it);
  if (it.tmdbId) {
    catalogMap.set(String(it.tmdbId), it);
    catalogMap.set(`tmdb-movie-${it.tmdbId}`, it);
    catalogMap.set(`tmdb-anime-${it.tmdbId}`, it);
    catalogMap.set(`tmdb-series-${it.tmdbId}`, it);
  }
}

function getCanonicalSeriesKey(it) {
  const mediaItem = it.mediaItem || {};
  const rawId = String(it.mediaId || it.id || '').replace(/_s\d+_e\d+$/, '');
  const tmdb = mediaItem?.tmdbId || it.tmdbId || rawId.match(/\d+$/)?.[0];
  const isSeries =
    it.type === 'series' ||
    it.category === 'series' ||
    it.category === 'anime' ||
    Boolean(it.seasonNumber);
  if (isSeries && tmdb) {
    return `series_tmdb_${tmdb}`;
  }
  const title = String(it.title || mediaItem?.title || '').trim().toLowerCase();
  if (isSeries && title) {
    return `series_title_${title}`;
  }
  return rawId || it.id;
}

function shouldReplace(existing, incoming) {
  const existingSeason = Number(existing.seasonNumber || 1);
  const incomingSeason = Number(incoming.seasonNumber || 1);
  if (incomingSeason > existingSeason) return true;
  if (incomingSeason < existingSeason) return false;

  const existingEp = Number(existing.episodeNumber || 1);
  const incomingEp = Number(incoming.episodeNumber || 1);
  if (incomingEp > existingEp) return true;
  if (incomingEp < existingEp) return false;

  return (incoming.lastWatchedAt || 0) >= (existing.lastWatchedAt || 0);
}

// 4. Deduplicar por serie
const seriesMap = new Map();
let duplicatesRemoved = 0;

for (const item of rawHistory) {
  if (!item || !item.id) continue;
  const key = getCanonicalSeriesKey(item);
  const existing = seriesMap.get(key);
  if (existing) {
    duplicatesRemoved++;
    if (shouldReplace(existing, item)) {
      seriesMap.set(key, item);
    }
  } else {
    seriesMap.set(key, item);
  }
}

// 5. Reemplazar carátulas inválidas / unsplash por las del catálogo oficial
let unsplashFixed = 0;
const cleanedList = Array.from(seriesMap.values()).map((item) => {
  const copy = { ...item };
  const rawId = String(copy.mediaId || copy.id || '').replace(/_s\d+_e\d+$/, '');
  const tmdb = copy.mediaItem?.tmdbId || copy.tmdbId || rawId.match(/\d+$/)?.[0];
  const catItem = catalogMap.get(rawId) || (tmdb ? catalogMap.get(String(tmdb)) : null);

  const hasUnsplashPoster = typeof copy.posterUrl === 'string' && copy.posterUrl.includes('unsplash.com');
  const hasUnsplashBackdrop = typeof copy.backdropUrl === 'string' && copy.backdropUrl.includes('unsplash.com');

  if (hasUnsplashPoster || hasUnsplashBackdrop) {
    unsplashFixed++;
  }

  if (hasUnsplashPoster) {
    copy.posterUrl = catItem?.posterUrl || catItem?.backdropUrl || '';
  }
  if (hasUnsplashBackdrop) {
    copy.backdropUrl = catItem?.backdropUrl || catItem?.posterUrl || '';
  }

  if (copy.mediaItem && typeof copy.mediaItem === 'object') {
    const m = { ...copy.mediaItem };
    if (typeof m.posterUrl === 'string' && m.posterUrl.includes('unsplash.com')) {
      m.posterUrl = catItem?.posterUrl || catItem?.backdropUrl || '';
    }
    if (typeof m.backdropUrl === 'string' && m.backdropUrl.includes('unsplash.com')) {
      m.backdropUrl = catItem?.backdropUrl || catItem?.posterUrl || '';
    }
    copy.mediaItem = m;
  }

  return copy;
});

// Ordenar por última reproducción descendente
const repairedList = cleanedList
  .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
  .slice(0, 50);

fs.writeFileSync(historyPath, JSON.stringify(repairedList, null, 2), 'utf8');

console.log('\n=======================================================');
console.log('REPORTE DE REPARACIÓN DE HISTORIAL:');
console.log(`- Ítems originales: ${rawHistory.length}`);
console.log(`- Duplicados eliminados: ${duplicatesRemoved}`);
console.log(`- Carátulas Unsplash corregidas: ${unsplashFixed}`);
console.log(`- Ítems finales únicos: ${repairedList.length}`);
console.log(`- Archivo de respaldo: ${backupFilename}`);
console.log('=======================================================');

