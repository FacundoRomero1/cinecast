#!/usr/bin/env node
/**
 * scripts/build-popularity.mjs
 * Recorre discover/movie, discover/tv y animation en TMDB (ordenados por popularidad desc)
 * y genera public/data/popularity.json para enriquecer el catálogo y ordenar el Inicio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
export function getTmdbKey() {
  return process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || DEFAULT_TMDB_KEY;
}

// 1. Argumentos CLI
const args = process.argv.slice(2);
let limitPages = 150;
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  limitPages = Math.max(1, parseInt(args[limitIdx + 1], 10) || 150);
}

console.log(`[build-popularity] Límite por tipo: ${limitPages} páginas (concurrencia 6)`);

const apiKey = getTmdbKey();
const TMDB_BASE = 'https://api.themoviedb.org/3';

const scratchDir = path.join(rootDir, 'scratch');
if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}
const checkpointPath = path.join(scratchDir, 'popularity-checkpoint.json');

// Cargar checkpoint si existe
let checkpoint = {
  completedPages: { movie: [], tv: [], anime: [] },
  entries: {},
};
if (fs.existsSync(checkpointPath)) {
  try {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    checkpoint.completedPages = checkpoint.completedPages || { movie: [], tv: [], anime: [] };
    checkpoint.entries = checkpoint.entries || {};
    console.log(`[build-popularity] Reanudando desde checkpoint: ${Object.keys(checkpoint.entries).length} entradas existentes.`);
  } catch (err) {
    console.warn('[build-popularity] Checkpoint corrupto, iniciando limpio.');
  }
}

const sources = [
  {
    type: 'movie',
    buildUrl: (p) =>
      `${TMDB_BASE}/discover/movie?api_key=${apiKey}&region=AR&sort_by=popularity.desc&page=${p}&language=es-MX`,
  },
  {
    type: 'tv',
    buildUrl: (p) =>
      `${TMDB_BASE}/discover/tv?api_key=${apiKey}&region=AR&sort_by=popularity.desc&page=${p}&language=es-MX`,
  },
  {
    type: 'anime',
    buildUrl: (p) =>
      `${TMDB_BASE}/discover/tv?api_key=${apiKey}&with_original_language=ja&with_genres=16&sort_by=popularity.desc&page=${p}&language=es-MX`,
  },
];

async function fetchWithRetry(url, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000 * attempt;
        console.warn(`[build-popularity] 429 Too Many Requests. Esperando ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const waitMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return null;
}

// Pool de concurrencia 6
async function runConcurrentPool(tasks, concurrency = 6) {
  let index = 0;
  const running = [];
  const results = [];

  async function next() {
    if (index >= tasks.length) return;
    const curIdx = index++;
    const task = tasks[curIdx];
    const p = Promise.resolve().then(() => task()).then((res) => {
      results[curIdx] = res;
    });
    running.push(p);
    p.finally(() => {
      const i = running.indexOf(p);
      if (i !== -1) running.splice(i, 1);
    });
    if (running.length < concurrency && index < tasks.length) {
      next();
    }
    await p;
    if (index < tasks.length) {
      await next();
    }
  }

  const initialBatch = [];
  for (let c = 0; c < concurrency && c < tasks.length; c++) {
    initialBatch.push(next());
  }
  await Promise.all(initialBatch);
  return results;
}

let saveCheckpointTimer = null;
function scheduleCheckpointSave() {
  if (saveCheckpointTimer) return;
  saveCheckpointTimer = setTimeout(() => {
    saveCheckpointTimer = null;
    try {
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    } catch (_) {}
  }, 2000);
}

async function main() {
  const startTime = Date.now();

  for (const src of sources) {
    console.log(`\n--- Extrayendo ${src.type} (hasta ${limitPages} páginas) ---`);
    const completedSet = new Set(checkpoint.completedPages[src.type] || []);
    const pendingPages = [];
    for (let p = 1; p <= limitPages; p++) {
      if (!completedSet.has(p)) {
        pendingPages.push(p);
      }
    }

    console.log(`Páginas pendientes para ${src.type}: ${pendingPages.length} de ${limitPages}`);

    const tasks = pendingPages.map((page) => async () => {
      const url = src.buildUrl(page);
      try {
        const data = await fetchWithRetry(url);
        const results = Array.isArray(data?.results) ? data.results : [];
        results.forEach((item, itemIdx) => {
          if (!item || !item.id) return;
          const key = `${src.type}:${item.id}`;
          const rank = (page - 1) * 20 + itemIdx + 1;
          checkpoint.entries[key] = {
            pop: item.popularity ?? 0,
            votes: item.vote_count ?? 0,
            avg: item.vote_average ?? 0,
            rank,
          };
        });
        checkpoint.completedPages[src.type].push(page);
        scheduleCheckpointSave();
        process.stdout.write(`[${src.type} p${page}] `);
      } catch (err) {
        console.error(`\nError en ${src.type} p${page}:`, err.message);
      }
    });

    await runConcurrentPool(tasks, 6);
    console.log(`\nCompletado ${src.type}.`);
  }

  // Guardar checkpoint final
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');

  // Escribir archivo de salida final
  const outDir = path.join(rootDir, 'public', 'data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, 'popularity.json');
  fs.writeFileSync(outPath, JSON.stringify(checkpoint.entries, null, 2), 'utf8');
  console.log(`\n[build-popularity] Guardado: ${outPath} (${Object.keys(checkpoint.entries).length} entradas)`);

  // Calcular cobertura sobre el catálogo oficial
  const catPath = path.join(outDir, 'catalog.json');
  if (fs.existsSync(catPath)) {
    try {
      const catRaw = JSON.parse(fs.readFileSync(catPath, 'utf8'));
      const catItems = Array.isArray(catRaw) ? catRaw : (catRaw.items || []);
      let matchedCount = 0;
      for (const item of catItems) {
        const tmdb = item.tmdbId || (item.id && String(item.id).match(/\d+$/)?.[0]);
        if (!tmdb) continue;
        const keyMovie = `movie:${tmdb}`;
        const keyTv = `tv:${tmdb}`;
        const keyAnime = `anime:${tmdb}`;
        if (
          checkpoint.entries[keyMovie] ||
          checkpoint.entries[keyTv] ||
          checkpoint.entries[keyAnime]
        ) {
          matchedCount++;
        }
      }
      const pct = catItems.length > 0 ? ((matchedCount / catItems.length) * 100).toFixed(2) : '0';
      console.log('\n=======================================================');
      console.log('COBERTURA DE POPULARIDAD SOBRE EL CATÁLOGO:');
      console.log(`- Total ítems catálogo: ${catItems.length}`);
      console.log(`- Ítems con datos de popularidad: ${matchedCount}`);
      console.log(`- Porcentaje de cobertura: ${pct}%`);
      console.log(`- Tiempo total: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log('=======================================================');
    } catch (e) {
      console.warn('Error calculando cobertura sobre catálogo:', e.message);
    }
  }
}

main().catch((err) => {
  console.error('[build-popularity] Error fatal:', err);
  process.exit(1);
});
