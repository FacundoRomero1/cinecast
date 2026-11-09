#!/usr/bin/env node
/**
 * Script generador de catálogo masivo de TMDB (10,000+ títulos).
 * Recolecta películas, series y anime de Hispanoamérica (AR, MX, ES)
 * con póster, sinopsis, géneros y servidores limpios y actualizados.
 * 
 * Uso:
 *   node scripts/build-catalog.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMDB_API_KEY =
  process.env.TMDB_API_KEY ||
  process.env.VITE_TMDB_API_KEY ||
  '2dca580c2a14b55200e784d157207b4d';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TARGET_TITLES = 10100;
const BATCH_SIZE = 12;
const BATCH_DELAY_MS = 250;

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
      name: 'Embed.su (Ultra HD)',
      url: isTV
        ? `https://embed.su/embed/tv/${tmdbId}/${s}/${e}`
        : `https://embed.su/embed/movie/${tmdbId}`,
      type: 'iframe',
      language: '💎 Ultra HD',
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
  const isTV =
    forceCategory === 'series' ||
    forceCategory === 'anime' ||
    item.media_type === 'tv' ||
    Boolean(item.first_air_date && !item.release_date);

  const isAnime =
    forceCategory === 'anime' ||
    (item.genre_ids &&
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

  const voteAverage = Number((item.vote_average || 7.5).toFixed(1));
  const mappedGenres = mapGenres(item.genre_ids);
  const genres =
    isAnime && !mappedGenres.includes('Anime')
      ? ['Anime', ...mappedGenres]
      : mappedGenres;

  const servers = buildServers(tmdbId, isTV, isAnime);

  return {
    id: `tmdb-${finalCategory}-${tmdbId}`,
    tmdbId,
    title,
    overview,
    posterPath: posterUrl,
    posterUrl,
    backdropPath: backdropUrl,
    backdropUrl,
    releaseDate,
    year,
    genres,
    genre: genres,
    runtime: isTV ? undefined : 110,
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

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Iniciando recolector masivo de TMDB (Objetivo: 10,000+ títulos)...');
  console.log(`🔑 Clave API TMDB: ${TMDB_API_KEY.slice(0, 6)}...`);

  const catalogMap = new Map();
  const outDir = path.join(__dirname, '..', 'public', 'data');
  const finalPath = path.join(outDir, 'catalog.json');

  // Cargar catálogo previo si existe para acumular
  if (fs.existsSync(finalPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
      if (Array.isArray(prev)) {
        for (const item of prev) {
          if (item && item.id) catalogMap.set(item.id, item);
        }
        console.log(`📁 Catálogo base previo cargado: ${catalogMap.size} títulos.`);
      }
    } catch (_) {}
  }

  // Construir lista de tareas paginadas
  const endpoints = [];

  // 1. Películas Populares y Tendencias en México, Argentina y España
  for (const region of ['MX', 'AR', 'ES']) {
    for (const sortBy of ['popularity.desc', 'vote_count.desc', 'primary_release_date.desc']) {
      for (let page = 1; page <= 30; page++) {
        endpoints.push({
          url: `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-${region}&region=${region}&sort_by=${sortBy}&vote_count.gte=5&page=${page}`,
          category: 'movie',
        });
      }
    }
  }

  // 2. Películas por Año de Estreno (1990 - 2026)
  for (let year = 1990; year <= 2026; year += 2) {
    for (let page = 1; page <= 12; page++) {
      endpoints.push({
        url: `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&primary_release_year=${year}&sort_by=popularity.desc&vote_count.gte=5&page=${page}`,
        category: 'movie',
      });
    }
  }

  // 3. Películas por Géneros (Acción, Terror, Sci-Fi, Comedia, Drama, etc.)
  const movieGenres = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 27, 9648, 10749, 878, 53, 10752, 37];
  for (const g of movieGenres) {
    for (let page = 1; page <= 25; page++) {
      endpoints.push({
        url: `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&with_genres=${g}&sort_by=popularity.desc&vote_count.gte=5&page=${page}`,
        category: 'movie',
      });
    }
  }

  // 4. Series por Géneros y Región
  const tvGenres = [10759, 16, 35, 80, 99, 18, 10751, 9648, 10765, 10768, 37];
  for (const g of tvGenres) {
    for (let page = 1; page <= 25; page++) {
      endpoints.push({
        url: `${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&with_genres=${g}&sort_by=popularity.desc&vote_count.gte=5&page=${page}`,
        category: 'series',
      });
    }
  }

  // 5. Catálogo masivo de Anime (Japón, Animación)
  for (let page = 1; page <= 45; page++) {
    endpoints.push({
      url: `${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&with_original_language=ja&with_genres=16&sort_by=popularity.desc&language=es-MX&page=${page}`,
      category: 'anime',
    });
  }

  // 6. Top Rated y Clásicos aclamados
  for (let page = 1; page <= 30; page++) {
    endpoints.push({
      url: `${TMDB_BASE_URL}/movie/top_rated?api_key=${TMDB_API_KEY}&language=es-MX&page=${page}`,
      category: 'movie',
    });
    endpoints.push({
      url: `${TMDB_BASE_URL}/tv/top_rated?api_key=${TMDB_API_KEY}&language=es-MX&page=${page}`,
      category: 'series',
    });
  }

  console.log(`📋 Total de páginas de consulta programadas: ${endpoints.length}`);

  let completedBatches = 0;
  for (let i = 0; i < endpoints.length; i += BATCH_SIZE) {
    if (catalogMap.size >= TARGET_TITLES) {
      console.log(`🎯 Meta alcanzada: ${catalogMap.size} títulos recolectados.`);
      break;
    }

    const batch = endpoints.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (task) => {
        const data = await fetchJson(task.url);
        return { data, category: task.category };
      })
    );

    for (const { data, category } of results) {
      if (!data || !Array.isArray(data.results)) continue;
      for (const item of data.results) {
        const movie = convertTmdbItem(item, category);
        if (movie && !catalogMap.has(movie.id)) {
          catalogMap.set(movie.id, movie);
        }
      }
    }

    completedBatches++;
    if (completedBatches % 5 === 0 || catalogMap.size >= TARGET_TITLES) {
      console.log(
        `📦 Títulos únicos en catálogo: ${catalogMap.size} / ${TARGET_TITLES} (Lote ${completedBatches})`
      );
    }

    await sleep(BATCH_DELAY_MS);
  }

  const catalogList = Array.from(catalogMap.values());
  console.log(`\n✨ Total de películas y series listas: ${catalogList.length}`);

  // Guardar atómicamente en public/data/catalog.json
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const tmpPath = path.join(outDir, 'catalog.json.tmp');

  console.log(`💾 Escribiendo archivo temporal en ${tmpPath}...`);
  fs.writeFileSync(tmpPath, JSON.stringify(catalogList, null, 2), 'utf8');

  console.log(`🔄 Reemplazo atómico hacia ${finalPath}...`);
  fs.renameSync(tmpPath, finalPath);

  const stats = fs.statSync(finalPath);
  console.log(
    `✅ Catálogo masivo guardado exitosamente: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${catalogList.length} títulos)`
  );
}

main().catch((err) => {
  console.error('❌ Error durante la generación del catálogo:', err);
  process.exit(1);
});
