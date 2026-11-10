import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

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

  // (h) ids=a,b,c devuelve esos ítems en formato card e ignora los desconocidos
  const realTwoIds = curLimit5.items.slice(0, 2).map((i) => i.id);
  const idsQuery = [realTwoIds[0], 'id-inexistente-xyz-999', realTwoIds[1]].join(',');
  const idsRes = await getJson(`/api/catalog?ids=${encodeURIComponent(idsQuery)}&fields=card`);
  const idsItems = idsRes.items || [];
  const passH =
    idsItems.length === 2 &&
    idsItems[0].id === realTwoIds[0] &&
    idsItems[1].id === realTwoIds[1] &&
    idsItems.every(
      (item) =>
        !('overview' in item) &&
        !('servers' in item) &&
        expectedCardKeys.every((k) => k in item)
    );
  console.log(
    `[Prueba h] /api/catalog?ids=a,desconocido,b&fields=card devuelve ítems en card e ignora desconocidos: ${passH ? 'PASA' : 'FALLA'} (pedidos=3 [2 reales + 1 desconocido], devueltos=${idsItems.length}, ids=[${idsItems.map((i) => i.id).join(', ')}])`
  );

  // (i) deduplicateSearchResults (función de unificación aislada con datos fijos)
  const searchCompiled = buildSync({
    entryPoints: [path.join(rootDir, 'src/server/core/routes/search.ts')],
    write: false,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    bundle: true,
    external: ['express'],
  });
  const searchMod = { exports: {} };
  const searchFn = new Function('module', 'exports', 'require', searchCompiled.outputFiles[0].text);
  searchFn(searchMod, searchMod.exports, require);
  const { deduplicateSearchResults, getMediaKind } = searchMod.exports;

  // Caso 1: Mismo tmdbId y mismo tipo (series/anime) -> debe quedar 1 solo, prefiriendo catálogo local
  const mockDuplicatedSeries = [
    {
      id: 'tmdb-series-73223',
      tmdbId: 73223,
      title: 'Black Clover',
      category: 'series',
      type: 'series',
      notInCatalog: true,
      servers: [{ name: 'Vidsrc', url: 'https://vidsrc.cc' }],
    },
    {
      id: 'tmdb-anime-73223',
      tmdbId: 73223,
      title: 'Black Clover',
      category: 'anime',
      type: 'series',
      notInCatalog: false,
      servers: [{ name: 'TukiPlay', url: 'https://tukiplay.com' }],
    },
  ];
  const dedupSeries = deduplicateSearchResults(mockDuplicatedSeries);
  const passI1 =
    dedupSeries.length === 1 &&
    dedupSeries[0].id === 'tmdb-anime-73223' &&
    dedupSeries[0].notInCatalog === false;

  // Caso 2: Mismo tmdbId pero tipos distintos (película vs serie/anime) -> NO deben unificarse
  const mockDifferentTypes = [
    {
      id: 'tmdb-anime-812225',
      tmdbId: 812225,
      title: 'Black Clover: La espada del rey mago',
      category: 'anime',
      type: 'series',
      notInCatalog: false,
    },
    {
      id: 'tmdb-movie-812225',
      tmdbId: 812225,
      title: 'Black Clover: La espada del rey mago',
      category: 'movie',
      type: 'movie',
      notInCatalog: true,
    },
  ];
  const dedupDiffTypes = deduplicateSearchResults(mockDifferentTypes);
  const passI2 =
    dedupDiffTypes.length === 2 &&
    dedupDiffTypes.some((i) => getMediaKind(i) === 'series') &&
    dedupDiffTypes.some((i) => getMediaKind(i) === 'movie');

  // Caso 3: Mismo id duplicado -> debe deduplicarse
  const mockSameId = [
    { id: 'custom-123', title: 'Test 1', notInCatalog: true },
    { id: 'custom-123', title: 'Test 1 Local', notInCatalog: false },
  ];
  const dedupSameId = deduplicateSearchResults(mockSameId);
  const passI3 =
    dedupSameId.length === 1 &&
    dedupSameId[0].title === 'Test 1 Local';

  const passI = passI1 && passI2 && passI3;
  console.log(
    `[Prueba i] deduplicateSearchResults (unificación aislada): ${passI ? 'PASA' : 'FALLA'} (caso 1 series/anime local preferido=${passI1}, caso 2 tipos distintos preservados=${passI2}, caso 3 id idéntico=${passI3})`
  );

  // (j) formatSeasonEpisodes (normalización en origen para DetailModal y servidor clásico)
  const tmdbCompiled = buildSync({
    entryPoints: [path.join(rootDir, 'src/server/core/routes/tmdb-detail.ts')],
    write: false,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    bundle: true,
    external: ['express', 'fs', 'path', 'url'],
  });
  const tmdbMod = { exports: {} };
  const tmdbFn = new Function('module', 'exports', 'require', tmdbCompiled.outputFiles[0].text);
  tmdbFn(tmdbMod, tmdbMod.exports, require);
  const { formatSeasonEpisodes } = tmdbMod.exports;

  const mockRawEpisodes = [
    {
      id: 101,
      name: 'Asta y Yuno',
      season_number: 1,
      episode_number: 1,
      overview: 'Inicio de la aventura mágica',
      runtime: 24,
      still_path: '/path_asta.jpg',
      vote_average: 8.4,
    },
    {
      id: 102,
      title: 'El juramento del muchacho',
      season: 1,
      episode: 2,
      stillUrl: 'https://image.tmdb.org/t/p/w300/path_yuno.jpg',
    },
  ];

  const formatted = formatSeasonEpisodes(mockRawEpisodes, 1);
  const passJ1 =
    formatted.length === 2 &&
    formatted[0].name === 'Asta y Yuno' &&
    formatted[0].title === 'Asta y Yuno' &&
    formatted[0].episode_number === 1 &&
    formatted[0].episode === 1 &&
    formatted[0].still_path === '/path_asta.jpg' &&
    formatted[0].stillUrl === 'https://image.tmdb.org/t/p/w300/path_asta.jpg';

  const passJ2 =
    formatted[1].name === 'El juramento del muchacho' &&
    formatted[1].title === 'El juramento del muchacho' &&
    formatted[1].episode_number === 2 &&
    formatted[1].episode === 2 &&
    formatted[1].still_path === '/path_yuno.jpg' &&
    formatted[1].stillUrl === 'https://image.tmdb.org/t/p/w300/path_yuno.jpg';

  const passJ = passJ1 && passJ2;
  console.log(
    `[Prueba j] formatSeasonEpisodes (normalización en origen para DetailModal y servidor clásico): ${passJ ? 'PASA' : 'FALLA'} (caso 1 TMDB original=${passJ1}, caso 2 legacy augmented=${passJ2})`
  );

  // (k) routes/clientlog.ts: POST /api/client-log y GET /api/client-log
  // 1. POST con datos de prueba desde IP local (privada)
  const postLogRes = await fetch(`${baseUrl}/api/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { type: 'env', userAgent: 'test-agent', isSecureContext: true },
      { type: 'touch', event: 'touchstart', x: 100, y: 200 },
    ]),
  });
  const postLogData = postLogRes.ok ? await postLogRes.json() : null;
  const passK1 = postLogRes.status === 200 && postLogData?.ok === true && postLogData?.added === 2;

  // 2. GET /api/client-log (desde loopback)
  const getLogRes = await fetch(`${baseUrl}/api/client-log`);
  const getLogData = getLogRes.ok ? await getLogRes.json() : null;
  const passK2 = getLogRes.status === 200 && Array.isArray(getLogData?.entries) && getLogData.entries.some((e) => e.type === 'env');

  // 3. GET /api/client-log?html=1
  const getHtmlRes = await fetch(`${baseUrl}/api/client-log?html=1`);
  const htmlText = getHtmlRes.ok ? await getHtmlRes.text() : '';
  const passK3 = getHtmlRes.status === 200 && htmlText.includes('<!DOCTYPE html>') && htmlText.includes('test-agent');

  // 4. POST con IP pública simulada -> debe rechazar con 403
  const publicIpRes = await fetch(`${baseUrl}/api/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
    body: JSON.stringify([{ type: 'test' }]),
  });
  const passK4 = publicIpRes.status === 403;

  // 5. GET /api/client-log?clear=1 -> vacía registros
  const clearRes = await fetch(`${baseUrl}/api/client-log?clear=1`);
  const clearData = clearRes.ok ? await clearRes.json() : null;
  const passK5 = clearRes.status === 200 && clearData?.cleared === true && clearData?.total === 0;

  const passK = passK1 && passK2 && passK3 && passK4 && passK5;
  console.log(
    `[Prueba k] clientlog (POST/GET /api/client-log, IP privada, HTML y clear): ${passK ? 'PASA' : 'FALLA'} (post=${passK1}, get=${passK2}, html=${passK3}, rejectPublic=${passK4}, clear=${passK5})`
  );

  if (!(passA && passB && passC && hasFacets && passE && passF && passG && passH && passI && passJ && passK)) {
    process.exitCode = 1;
  }
} finally {
  server.close();
}
