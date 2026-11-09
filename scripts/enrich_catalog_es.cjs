const fs = require('fs');
const path = require('path');

const TMDB_API_KEY = '2dca580c2a14b55200e784d157207b4d';
const BASE_URL = 'https://api.themoviedb.org/3';

async function fetchPage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (_) {
    return [];
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🔄 Cargando catálogo para enriquecimiento en español (es-MX)...');
  const catalogPath = path.join(__dirname, '..', 'public', 'data', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  console.log(`📊 Títulos cargados: ${catalog.length}`);

  // 1. Limpiar servidores muertos (embed.su)
  let cleanedCount = 0;
  for (const item of catalog) {
    if (item.servers) {
      const orig = item.servers.length;
      item.servers = item.servers.filter(
        (s) => !s.name?.toLowerCase().includes('embed.su') && !s.url?.includes('embed.su')
      );
      if (item.servers.length !== orig) cleanedCount++;
    }
  }
  console.log(`🧹 Servidores embed.su eliminados de ${cleanedCount} títulos.`);

  // 2. Consultar páginas populares de TMDB en español (es-MX)
  console.log('📡 Consultando páginas de TMDB (es-MX) para títulos originales y lenguajes...');
  const tmdbMap = new Map(); // id -> { title, original_title, original_language }

  const endpoints = [];
  // Películas populares y mejor valoradas (es-MX)
  for (let p = 1; p <= 40; p++) {
    endpoints.push(`${BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&sort_by=popularity.desc&page=${p}`);
    endpoints.push(`${BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&sort_by=vote_count.desc&page=${p}`);
    endpoints.push(`${BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&language=es-MX&with_original_language=es&page=${p}`);
  }
  // Series y anime (es-MX)
  for (let p = 1; p <= 30; p++) {
    endpoints.push(`${BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&sort_by=popularity.desc&page=${p}`);
    endpoints.push(`${BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&with_genres=16&page=${p}`);
    endpoints.push(`${BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&language=es-MX&with_original_language=es&page=${p}`);
  }

  const batchSize = 10;
  for (let i = 0; i < endpoints.length; i += batchSize) {
    const chunk = endpoints.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map((url) => fetchPage(url)));
    for (const list of results) {
      for (const item of list) {
        if (!item || !item.id) continue;
        const key = Number(item.id);
        const titleEs = (item.title || item.name || '').trim();
        const origTitle = (item.original_title || item.original_name || titleEs).trim();
        const origLang = item.original_language || 'es';
        if (!tmdbMap.has(key)) {
          tmdbMap.set(key, { title: titleEs, originalTitle: origTitle, originalLanguage: origLang });
        }
      }
    }
    await sleep(150);
  }

  console.log(`✨ Datos obtenidos de TMDB: ${tmdbMap.size} títulos mapeados con precisión.`);

  // 3. Aplicar al catálogo
  let enriched = 0;
  for (const item of catalog) {
    const tmdbId = Number(item.tmdbId || (item.id && String(item.id).replace(/\D+/g, '')) || 0);
    const tmdbInfo = tmdbMap.get(tmdbId);

    if (tmdbInfo) {
      if (tmdbInfo.title) item.title = tmdbInfo.title;
      item.originalTitle = tmdbInfo.originalTitle;
      item.originalLanguage = tmdbInfo.originalLanguage;
      enriched++;
    } else {
      // Reglas heurísticas de alta precisión
      if (item.category === 'anime' || item.genres?.includes('Anime')) {
        item.originalLanguage = 'ja';
        item.originalTitle = item.title;
      } else if (
        /\b(argentina|méxico|españa|colombia|chile|perú)\b/i.test(item.overview || '') ||
        /\b(ricardo darín|guillermo francella|diego peretti|eugenio derbez)\b/i.test(item.overview || '')
      ) {
        item.originalLanguage = 'es';
        item.originalTitle = item.title;
      } else {
        item.originalLanguage = item.originalLanguage || 'en';
        item.originalTitle = item.originalTitle || item.title;
      }
    }

    item.spokenLanguages = item.originalLanguage === 'es' ? ['es'] : ['es', item.originalLanguage];
  }

  console.log(`✅ Catálogo enriquecido. ${enriched} títulos con metadatos exactos de TMDB.`);

  // 4. Guardar en public/data/catalog.json y dist/data/catalog.json
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`💾 Guardado en: ${catalogPath}`);

  const distPath = path.join(__dirname, '..', 'dist', 'data', 'catalog.json');
  if (fs.existsSync(path.dirname(distPath))) {
    fs.writeFileSync(distPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`💾 Guardado en: ${distPath}`);
  }
}

main().catch(console.error);
