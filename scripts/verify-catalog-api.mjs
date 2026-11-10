import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../electron/core.cjs');

const tmpDir = os.tmpdir();
const memAuth = {};
const rootDir = process.cwd();

const app = createApp({
  baseDir: rootDir,
  userDataPath: path.join(tmpDir, 'cinecast-verify-cat-userdata'),
  posterCacheDir: path.join(tmpDir, 'cinecast-verify-cat-posters'),
  mediaCacheDir: path.join(tmpDir, 'cinecast-verify-cat-media'),
  accountsFilePath: path.join(tmpDir, 'cinecast-verify-cat-accounts.json'),
  diagnostics: {
    getMode: () => false,
    setMode: () => {},
    getNoCorsFix: () => false,
    setNoCorsFix: () => {},
    onChange: () => {},
  },
  auth: {
    userDataPath: path.join(tmpDir, 'cinecast-verify-cat-userdata'),
    saveSecureAuth: async (provider, data) => {
      memAuth[provider] = data;
    },
    loadSecureAuth: async (provider) => memAuth[provider] || null,
  },
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function getJson(urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${urlPath}`);
  return res.json();
}

try {
  // (a) /api/genres
  const genresList = await getJson('/api/genres');
  const forbiddenGenres = [
    'Cine',
    'Película',
    'Anime',
    'Acción y Aventura',
    'Sci-Fi y Fantasía',
    'Guerra y Política',
  ];
  const foundForbidden = genresList.filter((g) => forbiddenGenres.includes(g.name));
  const sortedDesc = genresList.every(
    (g, i) => i === 0 || genresList[i - 1].count >= g.count
  );
  const passA =
    Array.isArray(genresList) &&
    genresList.length > 0 &&
    foundForbidden.length === 0 &&
    sortedDesc;
  console.log(
    `[Prueba a] /api/genres sin géneros prohibidos y ordenado desc: ${passA ? 'PASA' : 'FALLA'} (total géneros=${genresList.length}, prohibidos encontrados=${foundForbidden.length})`
  );
  console.log(
    `  Conteo por género: ${genresList.map((g) => `${g.name}:${g.count}`).join(', ')}`
  );

  // (b) genre=Terror&yearFrom=2020&sort=rating&limit=10
  const terrorRes = await getJson('/api/catalog?genre=Terror&yearFrom=2020&sort=rating&limit=10');
  const terrorItems = terrorRes.items || [];
  const allTerrorAndYear = terrorItems.every(
    (m) => Array.isArray(m.genres) && m.genres.includes('Terror') && m.year >= 2020
  );
  const sortedByRating = terrorItems.every(
    (m, i) => i === 0 || terrorItems[i - 1].rating >= m.rating
  );
  const passB =
    terrorItems.length === 10 && allTerrorAndYear && sortedByRating;
  console.log(
    `[Prueba b] genre=Terror&yearFrom=2020&sort=rating&limit=10: ${passB ? 'PASA' : 'FALLA'} (total filtrado=${terrorRes.total}, devueltos=${terrorItems.length})`
  );

  // (c) por defecto no aparece ningún upcoming y con includeUpcoming=true sí
  const defaultAll = await getJson('/api/catalog?limit=20000');
  const withUpcomingAll = await getJson('/api/catalog?limit=20000&includeUpcoming=true');
  const upcomingInDefault = (defaultAll.items || []).filter((m) => m.upcoming).length;
  const upcomingInIncluded = (withUpcomingAll.items || []).filter((m) => m.upcoming).length;
  const emptyGenreCount = (withUpcomingAll.items || []).filter(
    (m) => !Array.isArray(m.genres) || m.genres.length === 0
  ).length;
  const passC = upcomingInDefault === 0 && upcomingInIncluded > 0;
  console.log(
    `[Prueba c] upcoming por defecto vs includeUpcoming=true: ${passC ? 'PASA' : 'FALLA'} (sin includeUpcoming: total=${defaultAll.total}, upcoming=${upcomingInDefault} | con includeUpcoming=true: total=${withUpcomingAll.total}, upcoming=${upcomingInIncluded} | ítems sin género tras normalizar=${emptyGenreCount})`
  );

  // (d) facets=true trae facets
  const facetsRes = await getJson('/api/catalog?genre=Terror&yearFrom=2020&facets=true&limit=5');
  const hasFacets =
    facetsRes.facets &&
    typeof facetsRes.facets === 'object' &&
    facetsRes.facets.genres &&
    typeof facetsRes.facets.genres.Terror === 'number' &&
    facetsRes.facets.genres.Terror === terrorRes.total &&
    (facetsRes.facets.minYear >= 2020 || facetsRes.facets.yearRange?.min >= 2020);
  console.log(
    `[Prueba d] facets=true devuelve conteo de géneros y rango de años: ${hasFacets ? 'PASA' : 'FALLA'} (Terror en facets=${facetsRes.facets?.genres?.Terror}, rango años=${facetsRes.facets?.minYear}-${facetsRes.facets?.maxYear})`
  );

  // (e) fields=card no trae overview ni servers
  const cardRes = await getJson('/api/catalog?fields=card&limit=10');
  const cardItems = cardRes.items || [];
  const expectedCardKeys = [
    'id',
    'tmdbId',
    'title',
    'posterUrl',
    'backdropUrl',
    'year',
    'rating',
    'genres',
    'category',
    'type',
    'quality',
    'upcoming',
  ];
  const passE =
    cardItems.length === 10 &&
    cardItems.every(
      (item) =>
        !('overview' in item) &&
        !('servers' in item) &&
        expectedCardKeys.every((k) => k in item)
    );
  console.log(
    `[Prueba e] fields=card sin overview ni servers: ${passE ? 'PASA' : 'FALLA'} (devueltos=${cardItems.length}, keys=${Object.keys(cardItems[0] || {}).join(',')})`
  );

  // (f) /api/home devuelve filas no vacías y, con seen= de 5 ids reales de tipo terror, la primera fila es "Recomendados para vos" sin esos ids
  const homeBase = await getJson('/api/home');
  const baseRows = homeBase.rows || [];
  const baseNonEmpty = baseRows.length >= 9 && baseRows.every((r) => Array.isArray(r.items) && r.items.length > 0);

  const terrorFiveIds = terrorItems.slice(0, 5).map((m) => m.id);
  const homeSeen = await getJson(`/api/home?seen=${encodeURIComponent(terrorFiveIds.join(','))}`);
  const seenRows = homeSeen.rows || [];
  const firstRow = seenRows[0];
  const firstIsRec =
    firstRow &&
    firstRow.title === 'Recomendados para vos' &&
    Array.isArray(firstRow.items) &&
    firstRow.items.length > 0 &&
    firstRow.items.every((item) => !terrorFiveIds.includes(item.id) && !('overview' in item) && !('servers' in item));
  const passF = baseNonEmpty && firstIsRec;
  console.log(
    `[Prueba f] /api/home y Recomendados para vos con seen=(5 ids terror): ${passF ? 'PASA' : 'FALLA'} (filas sin seen=${baseRows.length}, filas con seen=${seenRows.length}, 1ra fila="${firstRow?.title}", items en 1ra fila=${firstRow?.items?.length}, vistos excluidos=${firstIsRec})`
  );
  console.log(
    `  Filas de /api/home?seen=...: ${seenRows.map((r) => `${r.title} (${r.items.length})`).join(' | ')}`
  );

  // (g) page, limit, q, category y onlySpanish siguen igual que antes + comparación contra snapshot HEAD~0
  const snapPath = path.join(rootDir, 'scratch', 'snap-catalog-head0.json');
  const snapHead0 = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : null;

  const curLimit5 = await getJson('/api/catalog?limit=5');
  const curAnime3 = await getJson('/api/catalog?category=anime&limit=3');
  const curPage2 = await getJson('/api/catalog?page=2&limit=5');
  const curQ = await getJson('/api/catalog?q=batman&limit=10');
  const curEs = await getJson('/api/catalog?onlySpanish=true&limit=10');

  // Comparar con HEAD~0 en ids, títulos, total (descontando los 2 upcoming en total general) y orden
  const head0Limit5 = snapHead0 ? snapHead0['/api/catalog?limit=5'] : null;
  const head0Anime3 = snapHead0 ? snapHead0['/api/catalog?category=anime&limit=3'] : null;

  const sameLimit5Ids =
    head0Limit5 &&
    JSON.stringify(curLimit5.items.map((i) => i.id)) ===
      JSON.stringify(head0Limit5.items.map((i) => i.id));
  const sameAnime3Ids =
    head0Anime3 &&
    JSON.stringify(curAnime3.items.map((i) => i.id)) ===
      JSON.stringify(head0Anime3.items.map((i) => i.id)) &&
    curAnime3.total === head0Anime3.total;

  const page2Valid =
    curPage2.page === 2 &&
    curPage2.limit === 5 &&
    curPage2.items.length === 5 &&
    curPage2.items[0].id !== curLimit5.items[0].id;
  const qValid =
    curQ.total > 0 &&
    curQ.items.every(
      (m) =>
        m.title.toLowerCase().includes('batman') ||
        m.originalTitle.toLowerCase().includes('batman') ||
        m.overview.toLowerCase().includes('batman')
    );
  const esValid =
    curEs.total > 0 && curEs.items.every((m) => m.originalLanguage === 'es');

  const passG = Boolean(sameLimit5Ids && sameAnime3Ids && page2Valid && qValid && esValid);
  console.log(
    `[Prueba g] page, limit, q, category, onlySpanish + comparación HEAD~0: ${passG ? 'PASA' : 'FALLA'} (limit=5 ids iguales=${sameLimit5Ids}, category=anime&limit=3 ids/total iguales=${sameAnime3Ids} [total=${curAnime3.total}], page=2 total=${curPage2.total}, q=batman total=${curQ.total}, onlySpanish=true total=${curEs.total})`
  );

  if (!(passA && passB && passC && hasFacets && passE && passF && passG)) {
    process.exitCode = 1;
  }
} finally {
  server.close();
}
