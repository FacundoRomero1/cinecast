#!/usr/bin/env node
/**
 * Extiende el catálogo de TMDB de forma aditiva y reanudable en
 * `public/data/catalog.extended.json`, SIN modificar `public/data/catalog.json`.
 *
 * Uso:
 *   node scripts/extend-catalog.mjs --limit 2000
 *   node scripts/extend-catalog.mjs --limit 15000 --batch-size 8 --delay-ms 250
 *   node scripts/extend-catalog.mjs --limit 5000 --reset
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const TMDB_API_KEY =
  process.env.TMDB_API_KEY ||
  process.env.VITE_TMDB_API_KEY ||
  '2dca580c2a14b55200e784d157207b4d';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const GENRE_MAP = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  27: 'Terror',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia Ficción',
  53: 'Suspenso',
  10752: 'Bélica',
  37: 'Western',
  10759: 'Acción y Aventura',
  10762: 'Infantil',
  10765: 'Sci-Fi y Fantasía',
  10768: 'Guerra y Política',
};

function parseArgs(argv) {
  const opts = {
    limit: 5000,
    outPath: path.join(rootDir, 'public', 'data', 'catalog.extended.json'),
    batchSize: 8,
    delayMs: 250,
    reset: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--reset') {
      opts.reset = true;
    } else if (a.startsWith('--limit=')) {
      opts.limit = Math.max(1, Number(a.slice('--limit='.length)) || opts.limit);
    } else if (a === '--limit' && argv[i + 1]) {
      opts.limit = Math.max(1, Number(argv[++i]) || opts.limit);
    } else if (a.startsWith('--out=')) {
      opts.outPath = path.resolve(rootDir, a.slice('--out='.length));
    } else if (a === '--out' && argv[i + 1]) {
      opts.outPath = path.resolve(rootDir, argv[++i]);
    } else if (a.startsWith('--batch-size=')) {
      opts.batchSize = Math.max(1, Math.min(20, Number(a.slice('--batch-size='.length)) || opts.batchSize));
    } else if (a === '--batch-size' && argv[i + 1]) {
      opts.batchSize = Math.max(1, Math.min(20, Number(argv[++i]) || opts.batchSize));
    } else if (a.startsWith('--delay-ms=')) {
      opts.delayMs = Math.max(0, Number(a.slice('--delay-ms='.length)) || 0);
    } else if (a === '--delay-ms' && argv[i + 1]) {
      opts.delayMs = Math.max(0, Number(argv[++i]) || 0);
    }
  }
  return opts;
}

function mapGenres(genreIds) {
  if (!Array.isArray(genreIds) || genreIds.length === 0) return ['Película'];
  return genreIds.map((id) => GENRE_MAP[id] || 'Cine').slice(0, 3);
}

function buildServers(tmdbId, isTV, isAnime) {
  const s = 1;
  const e = 1;
  return [
    {
      name: 'TukiPlay (Latino HD)',
      url: isTV
        ? `https://tukiplay.com/embed/tv/${tmdbId}/${s}/${e}`
        : `https://tukiplay.com/embed/movie/${tmdbId}`,
      type: 'iframe',
      language: '🇲🇽 Latino Garantizado',
    },
    {
      name: 'VidLink Pro (Multi / Sub ES)',
      url: isTV
        ? `https://vidlink.pro/tv/${tmdbId}/${s}/${e}?autoplay=true`
        : `https://vidlink.pro/movie/${tmdbId}?autoplay=true`,
      type: 'iframe',
      language: '🌐 Multi / Sub ES',
    },
    {
      name: 'VidEasy (Latino & Multi)',
      url: isTV
        ? `https://player.videasy.net/tv/${tmdbId}/${s}/${e}`
        : `https://player.videasy.net/movie/${tmdbId}`,
      type: 'iframe',
      language: '🇲🇽 Latino & Multi',
    },
    {
      name: 'AutoEmbed (HD)',
      url: isTV
        ? `https://player.autoembed.co/embed/tv/${tmdbId}/${s}/${e}`
        : `https://player.autoembed.co/embed/movie/${tmdbId}`,
      type: 'iframe',
      language: isAnime ? '🎌 Anime (Sub/Latino)' : '🌐 Multi-Audio',
    },
  ];
}

function convertTmdbItem(item, forceCategory) {
  const tmdbId = Number(item.id);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  const isTV =
    forceCategory === 'series' ||
    forceCategory === 'anime' ||
    item.media_type === 'tv' ||
    Boolean(item.first_air_date && !item.release_date);

  const isAnime =
    forceCategory === 'anime' ||
    (Array.isArray(item.genre_ids) &&
      item.genre_ids.includes(16) &&
      (item.original_language === 'ja' || item.origin_country?.includes('JP')));

  const finalCategory = isAnime ? 'anime' : isTV ? 'series' : 'movie';
  const title = (item.title || item.name || '').trim();
  if (!title) return null;

  const releaseDate = item.release_date || item.first_air_date || '2024-01-01';
  const year = parseInt(releaseDate.slice(0, 4), 10) || new Date().getFullYear();

  const posterPath = item.poster_path;
  if (!posterPath) return null;

  const posterUrl = posterPath.startsWith('http')
    ? posterPath
    : `https://image.tmdb.org/t/p/w500${posterPath.startsWith('/') ? '' : '/'}${posterPath}`;

  const backdropPath = item.backdrop_path || item.poster_path;
  const backdropUrl = backdropPath.startsWith('http')
    ? backdropPath
    : `https://image.tmdb.org/t/p/original${backdropPath.startsWith('/') ? '' : '/'}${backdropPath}`;

  const overview =
    (item.overview && item.overview.trim()) ||
    'Disfruta de esta producción completa en CineCast con servidores de alta velocidad.';

  const voteAverage = Number((item.vote_average || 7.2).toFixed(1));
  const mappedGenres = mapGenres(item.genre_ids);
  const genres =
    isAnime && !mappedGenres.includes('Anime') ? ['Anime', ...mappedGenres] : mappedGenres;

  const servers = buildServers(tmdbId, isTV, isAnime);

  return {
    id: `tmdb-${finalCategory}-${tmdbId}`,
    tmdbId,
    title,
    originalTitle: (item.original_title || item.original_name || title).trim(),
    originalLanguage: item.original_language || (isAnime ? 'ja' : 'en'),
    overview,
    posterPath: posterUrl,
    posterUrl,
    backdropPath: backdropUrl,
    backdropUrl,
    releaseDate,
    year,
    genres,
    genre: genres,
    runtime: isTV ? undefined : 105,
    seasonsCount: isTV ? 1 : undefined,
    voteAverage,
    rating: voteAverage,
    streamUrl: servers[0].url,
    streamType: 'iframe',
    quality: voteAverage > 8.0 ? '4K Ultra HD' : '1080p',
    source: 'tmdb',
    category: finalCategory,
    type: isTV ? 'series' : 'movie',
    addedAt: new Date().toISOString(),
    servers,
  };
}

function buildDiscoveryQueue() {
  const endpoints = [];
  const push = (url, category) => endpoints.push({ url, category });

  // 1. Películas por año (1975..2025) con distintas ordenaciones para superar el tope de 500 páginas únicas
  for (let year = 2025; year >= 1975; year -= 1) {
    for (const sortBy of ['popularity.desc', 'vote_count.desc', 'revenue.desc']) {
      for (let page = 1; page <= 10; page += 1) {
        push(
          `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&primary_release_year=${year}&sort_by=${sortBy}&vote_count.gte=15&page=${page}`,
          'movie'
        );
      }
    }
  }

  // 2. Series por año (1995..2025)
  for (let year = 2025; year >= 1995; year -= 1) {
    for (const sortBy of ['popularity.desc', 'vote_count.desc']) {
      for (let page = 1; page <= 8; page += 1) {
        push(
          `${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&first_air_date_year=${year}&sort_by=${sortBy}&vote_count.gte=8&page=${page}`,
          'series'
        );
      }
    }
  }

  // 3. Catálogo amplio por idioma original y género
  for (const lang of ['es', 'en', 'ko', 'fr', 'pt', 'it']) {
    for (let page = 1; page <= 25; page += 1) {
      push(
        `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&with_original_language=${lang}&sort_by=vote_count.desc&vote_count.gte=20&page=${page}`,
        'movie'
      );
      push(
        `${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&with_original_language=${lang}&sort_by=vote_count.desc&vote_count.gte=10&page=${page}`,
        'series'
      );
    }
  }

  // 4. Anime adicional por año y votación
  for (let year = 2025; year >= 1990; year -= 1) {
    for (let page = 1; page <= 6; page += 1) {
      push(
        `${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&with_original_language=ja&with_genres=16&first_air_date_year=${year}&sort_by=popularity.desc&vote_count.gte=5&page=${page}`,
        'anime'
      );
    }
  }

  return endpoints;
}

async function fetchJsonWithRetry(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

function writeAtomicJson(targetPath, data) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseCatalogPath = path.join(rootDir, 'public', 'data', 'catalog.json');
  const statePath = path.join(rootDir, 'scratch', 'extend-catalog.state.json');

  if (!fs.existsSync(baseCatalogPath)) {
    throw new Error(`No existe catálogo base en ${baseCatalogPath}`);
  }

  // Leer catalog.json solo en modo lectura para deduplicar
  const baseItems = JSON.parse(fs.readFileSync(baseCatalogPath, 'utf8'));
  const baseIds = new Set();
  if (Array.isArray(baseItems)) {
    for (const item of baseItems) {
      if (item && item.id) baseIds.add(String(item.id));
    }
  }

  const extMap = new Map();
  let startCursor = 0;

  if (!opts.reset && fs.existsSync(opts.outPath)) {
    try {
      const prevExt = JSON.parse(fs.readFileSync(opts.outPath, 'utf8'));
      if (Array.isArray(prevExt)) {
        for (const item of prevExt) {
          if (item && item.id && !baseIds.has(item.id)) {
            extMap.set(item.id, item);
          }
        }
      }
    } catch {}
  }

  if (!opts.reset && fs.existsSync(statePath)) {
    try {
      const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (typeof st.cursor === 'number' && st.cursor >= 0) {
        startCursor = st.cursor;
      }
    } catch {}
  }

  console.log(
    `[extend-catalog] Base read-only: ${baseIds.size} ítems | Extendidos previos: ${extMap.size} | Objetivo extendido: ${opts.limit} | cursor=${startCursor}`
  );

  if (extMap.size >= opts.limit) {
    console.log(`[extend-catalog] Ya se alcanzó el límite (${extMap.size} >= ${opts.limit}). Sin cambios.`);
    return;
  }

  const queue = buildDiscoveryQueue();
  let cursor = Math.min(startCursor, queue.length);
  let batchesDone = 0;

  while (cursor < queue.length && extMap.size < opts.limit) {
    const slice = queue.slice(cursor, cursor + opts.batchSize);
    cursor += slice.length;

    const results = await Promise.all(
      slice.map(async (task) => ({
        category: task.category,
        data: await fetchJsonWithRetry(task.url),
      }))
    );

    for (const { data, category } of results) {
      if (!data || !Array.isArray(data.results)) continue;
      for (const raw of data.results) {
        if (extMap.size >= opts.limit) break;
        const normalized = convertTmdbItem(raw, category);
        if (!normalized) continue;
        if (baseIds.has(normalized.id) || extMap.has(normalized.id)) continue;
        extMap.set(normalized.id, normalized);
      }
      if (extMap.size >= opts.limit) break;
    }

    batchesDone += 1;
    if (batchesDone % 5 === 0 || extMap.size >= opts.limit) {
      writeAtomicJson(opts.outPath, Array.from(extMap.values()));
      writeAtomicJson(statePath, { cursor, extendedCount: extMap.size, updatedAt: new Date().toISOString() });
      console.log(
        `[extend-catalog] Lote ${batchesDone} (cursor=${cursor}/${queue.length}) → +extendidos=${extMap.size}/${opts.limit}`
      );
    }

    if (opts.delayMs > 0 && extMap.size < opts.limit && cursor < queue.length) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }

  const finalList = Array.from(extMap.values());
  writeAtomicJson(opts.outPath, finalList);
  writeAtomicJson(statePath, { cursor, extendedCount: finalList.length, updatedAt: new Date().toISOString() });

  const outBytes = fs.statSync(opts.outPath).size;
  console.log(
    `[extend-catalog] Listo: ${finalList.length} ítems en ${path.relative(rootDir, opts.outPath)} (${(outBytes / 1024 / 1024).toFixed(2)} MiB).`
  );
}

main().catch((err) => {
  console.error('[extend-catalog] Error:', err);
  process.exit(1);
});

