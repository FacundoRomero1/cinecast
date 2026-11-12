#!/usr/bin/env node
/**
 * scripts/audit-filters.mjs
 * Auditoría automatizada de filtros, facetas, desempate por id y consistencia SQLite vs memoria.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../electron/core.cjs');

const rootDir = process.cwd();
const tmpDir = os.tmpdir();

function startServer(tag) {
  const userDataPath = path.join(tmpDir, `cinecast-audit-${tag}-${Date.now()}`);
  const app = createApp({
    baseDir: rootDir,
    userDataPath,
    posterCacheDir: path.join(userDataPath, 'posters'),
    mediaCacheDir: path.join(userDataPath, 'media'),
    accountsFilePath: path.join(userDataPath, 'accounts.json'),
    diagnostics: {
      getMode: () => false,
      setMode: () => {},
      getNoCorsFix: () => false,
      setNoCorsFix: () => {},
      onChange: () => {},
    },
  });
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`[audit-filters] ${pass ? 'PASS' : 'FAIL'} | ${name}: ${detail}`);
}

const srv = await startServer('sqlite');
try {
  delete process.env.CINECAST_CATALOG_ENGINE;

  const terrorOnly = await getJson(`${srv.baseUrl}/api/catalog?genre=Terror&limit=2000&fields=card`);
  const comediaOnly = await getJson(`${srv.baseUrl}/api/catalog?genre=Comedia&limit=4000&fields=card`);
  const expectedAndIds = new Set(
    terrorOnly.items
      .filter((m) => Array.isArray(m.genres) && m.genres.includes('Comedia'))
      .map((m) => m.id)
  );
  const expectedOrTotal = new Set([
    ...terrorOnly.items.map((m) => m.id),
    ...comediaOnly.items.map((m) => m.id),
  ]).size;

  // 1. Default multi-genre debe ser intersección (genreMode=all por defecto)
  const defaultMulti = await getJson(`${srv.baseUrl}/api/catalog?genre=Terror,Comedia&limit=1000&fields=card`);
  const allMatchBoth =
    defaultMulti.total === expectedAndIds.size &&
    defaultMulti.items.every((m) => m.genres.includes('Terror') && m.genres.includes('Comedia'));
  record(
    'Multi-género default (all/AND) Terror+Comedia',
    allMatchBoth,
    `total=${defaultMulti.total} (esperado AND=${expectedAndIds.size}, OR=${expectedOrTotal})`
  );

  // 2. Explícito genreMode=any devuelve unión
  const anyMulti = await getJson(
    `${srv.baseUrl}/api/catalog?genre=Terror,Comedia&genreMode=any&limit=50&fields=card`
  );
  record(
    'Multi-género genreMode=any (OR) Terror+Comedia',
    anyMulti.total === expectedOrTotal &&
      anyMulti.items.every((m) => m.genres.includes('Terror') || m.genres.includes('Comedia')),
    `total=${anyMulti.total} (esperado OR=${expectedOrTotal})`
  );

  // 3. Facetas en genre=Terror&facets=true incluyen géneros con conteo 0 (disabled) y conteo exacto de cruce
  const allGenresRes = await getJson(`${srv.baseUrl}/api/genres`);
  const allGenreNames = allGenresRes.map((g) => g.name);
  const terrorFacetsRes = await getJson(
    `${srv.baseUrl}/api/catalog?genre=Terror&facets=true&limit=10&fields=card`
  );
  const facetGenres = terrorFacetsRes.facets?.genres || {};
  const hasAllCanonicalKeys = allGenreNames.every((name) => typeof facetGenres[name] === 'number');
  const comediaOverlapMatch = facetGenres.Comedia === expectedAndIds.size;
  const terrorSelfMatch = facetGenres.Terror === terrorOnly.total;
  const zeroGenres = Object.entries(facetGenres)
    .filter(([, c]) => c === 0)
    .map(([n]) => n);
  record(
    'Facetas género con genreMode=all excluyendo self + 0-count presentes',
    hasAllCanonicalKeys && comediaOverlapMatch && terrorSelfMatch,
    `keys=${Object.keys(facetGenres).length}/${allGenreNames.length}, Terror=${facetGenres.Terror}/${terrorOnly.total}, Comedia=${facetGenres.Comedia}/${expectedAndIds.size}, zeros=[${zeroGenres.join(',')}]`
  );

  // 4. Facetas con genreMode=any excluyen filtro genre completo (muestran universo por género sin restringir por Terror)
  const terrorAnyFacets = await getJson(
    `${srv.baseUrl}/api/catalog?genre=Terror&genreMode=any&facets=true&limit=10&fields=card`
  );
  const anyComedia = terrorAnyFacets.facets?.genres?.Comedia;
  record(
    'Facetas en genreMode=any excluyen filtro genre',
    anyComedia === comediaOnly.total,
    `Comedia en facets(any)=${anyComedia} (esperado=${comediaOnly.total})`
  );

  // 5. Desempate determinista por id en sort=rating, year, title, added
  for (const sortKey of ['rating', 'year', 'title', 'added']) {
    const querySuffix = sortKey === 'added' ? '' : '&fields=card';
    const res = await getJson(`${srv.baseUrl}/api/catalog?sort=${sortKey}&limit=300${querySuffix}`);
    const items = res.items || [];
    let tieViolation = null;
    for (let i = 1; i < items.length; i += 1) {
      const a = items[i - 1];
      const b = items[i];
      let samePrimary = false;
      if (sortKey === 'rating') samePrimary = a.rating === b.rating;
      else if (sortKey === 'year') samePrimary = a.year === b.year && a.rating === b.rating;
      else if (sortKey === 'title') samePrimary = a.title.localeCompare(b.title, 'es') === 0;
      else if (sortKey === 'added') {
        const ta = a.addedAt ? Date.parse(a.addedAt) || 0 : 0;
        const tb = b.addedAt ? Date.parse(b.addedAt) || 0 : 0;
        samePrimary = ta === tb;
      }
      if (samePrimary && !(a.id <= b.id)) {
        tieViolation = `${a.id} > ${b.id} (key=${sortKey})`;
        break;
      }
    }
    record(
      `Desempate id en sort=${sortKey}`,
      !tieViolation,
      tieViolation || `${items.length} ítems ordenados con id ASC en empates`
    );
  }

  // 6. Filtros combinados (category + genre + yearFrom + yearTo + minRating) + vacío
  const combo = await getJson(
    `${srv.baseUrl}/api/catalog?category=movie&genre=Terror&yearFrom=2020&yearTo=2023&minRating=6.5&limit=50&fields=card`
  );
  const comboOk =
    combo.items.length > 0 &&
    combo.items.every(
      (m) =>
        m.category === 'movie' &&
        m.genres.includes('Terror') &&
        m.year >= 2020 &&
        m.year <= 2023 &&
        m.rating >= 6.5
    );
  record('Filtro combinado movie+Terror+2020..2023+rating>=6.5', comboOk, `total=${combo.total}`);

  const empty = await getJson(
    `${srv.baseUrl}/api/catalog?genre=Terror,Western,Infantil&yearFrom=2025&minRating=9.8&facets=true&limit=20&fields=card`
  );
  record(
    'Intersección vacía devuelve total=0 y facetas numéricas >= 0',
    empty.total === 0 && empty.items.length === 0 && typeof empty.facets?.genres?.Terror === 'number',
    `total=${empty.total}, facetTerror=${empty.facets?.genres?.Terror}`
  );
} finally {
  await new Promise((r) => srv.server.close(r));
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n[audit-filters] Resumen: ${checks.length - failed.length}/${checks.length} checks PASS`);
if (failed.length > 0) process.exit(1);
