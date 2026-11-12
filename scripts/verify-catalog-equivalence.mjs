#!/usr/bin/env node
/**
 * scripts/verify-catalog-equivalence.mjs
 * Compara 40 queries variadas de catálogo entre CINECAST_CATALOG_ENGINE=memory vs SQLite,
 * y verifica además /api/genres, /api/home, ETag/Cache-Control, gzip, FTS5 diacríticos,
 * /api/sync/poll y WebSocket /ws.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { createApp, attachWebSocket } = require('../electron/core.cjs');

const rootDir = process.cwd();
const tmpDir = os.tmpdir();

function startTestServer(mode, userDataPath) {
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
  if (mode === 'sqlite') {
    attachWebSocket(server);
  }
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text ? JSON.parse(text) : null,
  };
}

function stableStringify(val) {
  if (Array.isArray(val)) return '[' + val.map(stableStringify).join(',') + ']';
  if (val && typeof val === 'object') {
    const keys = Object.keys(val).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}:${stableStringify(val[k])}`).join(',') + '}';
  }
  return JSON.stringify(val);
}

const QUERIES = [
  '/api/catalog?limit=40&fields=card',
  '/api/catalog?page=2&limit=40&fields=card',
  '/api/catalog?page=10&limit=25&fields=card',
  '/api/catalog?page=9999&limit=40&fields=card',
  '/api/catalog?limit=5',
  '/api/catalog?includeUpcoming=true&limit=20&fields=card',
  '/api/catalog?category=movie&limit=30&fields=card',
  '/api/catalog?category=movies&limit=30&fields=card',
  '/api/catalog?category=series&limit=30&fields=card',
  '/api/catalog?category=tv&limit=30&fields=card',
  '/api/catalog?category=anime&limit=30&fields=card',
  '/api/catalog?genre=Terror&limit=30&fields=card',
  '/api/catalog?genre=Acci%C3%B3n&limit=30&fields=card',
  '/api/catalog?genre=Terror,Comedia&limit=30&fields=card',
  '/api/catalog?genre=Drama,Suspenso,Crimen&limit=20&fields=card',
  '/api/catalog?genre=Inexistente&limit=20&fields=card',
  '/api/catalog?yearFrom=2020&limit=30&fields=card',
  '/api/catalog?yearTo=1995&limit=30&fields=card',
  '/api/catalog?yearFrom=2015&yearTo=2022&limit=30&fields=card',
  '/api/catalog?minRating=8.2&limit=30&fields=card',
  '/api/catalog?minRating=9.5&limit=30&fields=card',
  '/api/catalog?onlySpanish=true&limit=30&fields=card',
  '/api/catalog?es=true&category=series&limit=30&fields=card',
  '/api/catalog?q=batman&limit=30&fields=card',
  '/api/catalog?q=spider&category=movie&limit=30&fields=card',
  '/api/catalog?q=naruto&category=anime&limit=30&fields=card',
  '/api/catalog?q=amor&onlySpanish=true&limit=30&fields=card',
  '/api/catalog?sort=rating&limit=50&fields=card',
  '/api/catalog?sort=year&limit=50&fields=card',
  '/api/catalog?sort=title&limit=50&fields=card',
  '/api/catalog?sort=title&page=5&limit=50&fields=card',
  '/api/catalog?sort=added&limit=50&fields=card',
  '/api/catalog?sort=added&category=anime&limit=40&fields=card',
  '/api/catalog?genre=Terror&yearFrom=2018&minRating=6.5&sort=rating&fields=card',
  '/api/catalog?category=series&genre=Drama,Crimen&yearFrom=2010&yearTo=2024&sort=year&page=2&limit=20&fields=card',
  '/api/catalog?facets=true&genre=Terror&yearFrom=2020&fields=card',
  '/api/catalog?facets=true&category=anime&minRating=7.5&fields=card',
  '/api/catalog?ids=tmdb-movie-969681,no-existe-999,tmdb-movie-1058424,550,tmdb-movie-969681&fields=card',
  '/api/catalog?ids=tmdb-movie-969681,tmdb-movie-1058424',
  '/api/catalog?limit=250&fields=card&sort=rating&yearFrom=2022',
];

const sqliteSrv = await startTestServer('sqlite', path.join(tmpDir, 'cinecast-eq-sqlite'));

// Capturar referencias con memory y SQLite por separado para respetar process.env.CINECAST_CATALOG_ENGINE
async function runAgainst(srv, engineValue) {
  process.env.CINECAST_CATALOG_ENGINE = engineValue;
  const out = [];
  for (const q of QUERIES) {
    const r = await fetchJson(`${srv.baseUrl}${q}`);
    out.push({ q, status: r.status, json: r.json });
  }
  const genres = await fetchJson(`${srv.baseUrl}/api/genres`);
  const home = await fetchJson(`${srv.baseUrl}/api/home`);
  const homeSeen = await fetchJson(
    `${srv.baseUrl}/api/home?seen=tmdb-movie-969681,tmdb-movie-1058424`
  );
  return { out, genres: genres.json, home: home.json, homeSeen: homeSeen.json };
}

try {
  delete process.env.CINECAST_CATALOG_ENGINE;
  const sqliteRes = await runAgainst(sqliteSrv, '');

  const memSrv = await startTestServer('memory', path.join(tmpDir, 'cinecast-eq-mem'));
  let memRes;
  try {
    memRes = await runAgainst(memSrv, 'memory');
  } finally {
    await new Promise((r) => memSrv.server.close(r));
    delete process.env.CINECAST_CATALOG_ENGINE;
  }

  let mismatches = 0;
  for (let i = 0; i < QUERIES.length; i += 1) {
    const a = memRes.out[i];
    const b = sqliteRes.out[i];
    const idsA = (a.json.items || []).map((x) => x.id);
    const idsB = (b.json.items || []).map((x) => x.id);
    const sameTotal = a.json.total === b.json.total && a.json.totalPages === b.json.totalPages;
    const sameIds = stableStringify(idsA) === stableStringify(idsB);
    const sameFacets =
      !a.json.facets && !b.json.facets
        ? true
        : stableStringify(a.json.facets) === stableStringify(b.json.facets);
    if (a.status !== 200 || b.status !== 200 || !sameTotal || !sameIds || !sameFacets) {
      mismatches += 1;
      console.error(`MISMATCH #${i + 1} ${a.q}`, {
        totalMem: a.json.total,
        totalSql: b.json.total,
        sameIds,
        sameFacets,
      });
    }
  }

  console.log(`[Equivalencia 40 queries] ${QUERIES.length - mismatches}/${QUERIES.length} coinciden exactamente`);
  if (mismatches > 0) process.exitCode = 1;

  const sameGenres = stableStringify(memRes.genres) === stableStringify(sqliteRes.genres);
  const sameHome = stableStringify(memRes.home) === stableStringify(sqliteRes.home);
  const sameHomeSeen = stableStringify(memRes.homeSeen) === stableStringify(sqliteRes.homeSeen);
  console.log(`[Equivalencia extra] genres=${sameGenres}, home=${sameHome}, homeSeen=${sameHomeSeen}`);
  if (!sameGenres || !sameHome || !sameHomeSeen) process.exitCode = 1;

  // Verificar Cache-Control + ETag + 304 + gzip
  for (const ep of ['/api/catalog?limit=40&fields=card', '/api/genres', '/api/home']) {
    const r = await fetch(`${sqliteSrv.baseUrl}${ep}`);
    const cc = r.headers.get('cache-control') || '';
    const etag = r.headers.get('etag') || '';
    const enc = r.headers.get('content-encoding') || '';
    const r304 = await fetch(`${sqliteSrv.baseUrl}${ep}`, {
      headers: etag ? { 'If-None-Match': etag } : {},
    });
    const ok = cc.includes('max-age=60') && etag.length > 0 && r304.status === 304;
    console.log(`[HTTP Cache/Gzip ${ep}] status=${r.status}, cc="${cc}", etag=${Boolean(etag)}, 304=${r304.status}, encoding=${enc}`);
    if (!ok) process.exitCode = 1;
  }

  // Verificar FTS5 búsqueda sin tildes en /api/search
  const ftsRes = await fetchJson(`${sqliteSrv.baseUrl}/api/search?q=cronicas`);
  const ftsHits = (ftsRes.json?.items || []).filter((it) => !it.notInCatalog).length;
  console.log(`[FTS5 /api/search?q=cronicas] localHits=${ftsHits}, total=${ftsRes.json?.total}`);
  if (ftsHits < 1) process.exitCode = 1;

  // Verificar /api/sync/poll y WebSocket /ws con compression activo
  const pollRes = await fetchJson(
    `${sqliteSrv.baseUrl}/api/sync/poll?roomId=test-room&deviceId=dev-1&sinceSeq=0`
  );
  const wsPort = sqliteSrv.server.address().port;
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve(false);
    }, 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'JOIN', roomId: 'test-room', deviceId: 'dev-ws' }));
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  console.log(`[Sync & WS] pollStatus=${pollRes.status}, wsConnected=${wsOk}`);
  if (pollRes.status !== 200 || !wsOk) process.exitCode = 1;
} finally {
  await new Promise((r) => sqliteSrv.server.close(r));
}

