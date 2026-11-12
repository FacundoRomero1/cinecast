#!/usr/bin/env node
/**
 * scripts/verify-home.mjs
 * Verificación exhaustiva de /api/home:
 * 1. Sin duplicados entre filas (un título aparece como máximo en UNA fila).
 * 2. Mínimo de filas e ítems (al menos 6 filas con 12 ítems o más).
 * 3. Mismo orden el mismo día (estabilidad con fecha inyectable).
 * 4. Orden distinto otro día (rotación entre los top 40 con semilla diaria).
 * 5. Con seen distinto salen filas "Porque viste" distintas.
 * 6. Ningún ítem en filas de mejor puntuadas/géneros tiene menos de 200 votos si hay dato.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const { createApp } = require('../electron/core.cjs');

const tmpDir = os.tmpdir();
const app = createApp({
  baseDir: rootDir,
  userDataPath: path.join(tmpDir, 'cinecast-verify-home-userdata'),
  posterCacheDir: path.join(tmpDir, 'cinecast-verify-home-posters'),
  mediaCacheDir: path.join(tmpDir, 'cinecast-verify-home-media'),
  diagnostics: {
    getMode: () => false,
    setMode: () => {},
    getNoCorsFix: () => false,
    setNoCorsFix: () => {},
    onChange: () => {},
  },
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function getJson(pathUrl) {
  const res = await fetch(`${baseUrl}${pathUrl}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// Cargar popularity.json si existe para verificar votos
let popularityMap = {};
const popPath = path.join(rootDir, 'public', 'data', 'popularity.json');
if (fs.existsSync(popPath)) {
  try {
    popularityMap = JSON.parse(fs.readFileSync(popPath, 'utf8'));
  } catch (_) {}
}

const checks = [];

try {
  console.log('=======================================================');
  console.log('VERIFICACIÓN DE /api/home (INICIO CREÍBLE Y VARIADO)');
  console.log('=======================================================\n');

  // ── 1. Sin duplicados entre filas (Deduplicación estricta) ────────────────
  const testDate = '2026-11-12';
  const homeData = await getJson(`/api/home?date=${testDate}`);
  const rows = Array.isArray(homeData.rows) ? homeData.rows : [];

  const seenIdsGlobal = new Set();
  const duplicateIds = [];
  let totalCards = 0;

  for (const row of rows) {
    for (const item of row.items || []) {
      totalCards++;
      if (seenIdsGlobal.has(item.id)) {
        duplicateIds.push({ id: item.id, title: item.title, row: row.title });
      } else {
        seenIdsGlobal.add(item.id);
      }
    }
  }

  const pass1 = duplicateIds.length === 0;
  checks.push({
    name: '1. Sin duplicados entre filas',
    pass: pass1,
    detail: `Total tarjetas: ${totalCards}, únicas: ${seenIdsGlobal.size}, duplicadas: ${duplicateIds.length}`,
  });
  console.log(`[Check 1] Sin duplicados entre filas: ${pass1 ? 'PASA ✅' : 'FALLA ❌'}`);
  if (!pass1) {
    console.error('  Duplicados encontrados:', duplicateIds.slice(0, 5));
  }

  // ── 2. Mínimo de filas e ítems (>= 6 filas, cada una >= 12 ítems) ────────
  const minRows = rows.length >= 6;
  const invalidRows = rows.filter((r) => !Array.isArray(r.items) || r.items.length < 12);
  const pass2 = minRows && invalidRows.length === 0;
  checks.push({
    name: '2. Mínimo de filas e ítems',
    pass: pass2,
    detail: `Filas devueltas: ${rows.length} (mín 6). Filas con < 12 ítems: ${invalidRows.length}`,
  });
  console.log(`[Check 2] Mínimo de filas e ítems: ${pass2 ? 'PASA ✅' : 'FALLA ❌'}`);
  console.log(`  Filas obtenidas: ${rows.map((r) => `${r.title} (${r.items?.length})`).join(' | ')}`);

  // ── 3. Mismo orden el mismo día (Estabilidad con fecha inyectada) ──────────
  const homeDataRepeat = await getJson(`/api/home?date=${testDate}`);
  const rowsRepeat = homeDataRepeat.rows || [];

  let identicalOrder = true;
  if (rows.length !== rowsRepeat.length) {
    identicalOrder = false;
  } else {
    for (let i = 0; i < rows.length; i++) {
      const itemsA = rows[i].items.map((it) => it.id).join(',');
      const itemsB = rowsRepeat[i].items.map((it) => it.id).join(',');
      if (itemsA !== itemsB) {
        identicalOrder = false;
        break;
      }
    }
  }
  checks.push({
    name: '3. Mismo orden el mismo día',
    pass: identicalOrder,
    detail: `Corridas sucesivas con date=${testDate} devuelven orden 100% idéntico`,
  });
  console.log(`[Check 3] Mismo orden el mismo día: ${identicalOrder ? 'PASA ✅' : 'FALLA ❌'}`);

  // ── 4. Orden distinto otro día (Rotación diaria) ─────────────────────────
  const otherDate = '2026-11-13';
  const homeOtherDay = await getJson(`/api/home?date=${otherDate}`);
  const rowsOtherDay = homeOtherDay.rows || [];

  let hasDifferentRowOrder = false;
  const minLen = Math.min(rows.length, rowsOtherDay.length);
  for (let i = 0; i < minLen; i++) {
    const itemsA = rows[i].items.map((it) => it.id).join(',');
    const itemsB = rowsOtherDay[i].items.map((it) => it.id).join(',');
    if (itemsA !== itemsB) {
      hasDifferentRowOrder = true;
      break;
    }
  }
  checks.push({
    name: '4. Orden distinto otro día',
    pass: hasDifferentRowOrder,
    detail: `date=${testDate} vs date=${otherDate} varían el orden de elementos`,
  });
  console.log(`[Check 4] Orden distinto otro día: ${hasDifferentRowOrder ? 'PASA ✅' : 'FALLA ❌'}`);

  // ── 5. Con seen distinto salen filas "Porque viste" distintas ─────────────
  // Usar IDs reales conocidos del catálogo
  const seenA = 'tmdb-anime-73223'; // Black Clover
  const seenB = 'tmdb-series-1399'; // Juego de Tronos

  const homeSeenA = await getJson(`/api/home?date=${testDate}&seen=${seenA}`);
  const homeSeenB = await getJson(`/api/home?date=${testDate}&seen=${seenB}`);

  const becauseRowsA = (homeSeenA.rows || []).filter((r) => r.id.startsWith('because-you-watched') || r.title.startsWith('Porque viste'));
  const becauseRowsB = (homeSeenB.rows || []).filter((r) => r.id.startsWith('because-you-watched') || r.title.startsWith('Porque viste'));

  const pass5 =
    becauseRowsA.length > 0 &&
    becauseRowsB.length > 0 &&
    becauseRowsA[0]?.title !== becauseRowsB[0]?.title;

  checks.push({
    name: '5. Filas "Porque viste" distintas según historial',
    pass: pass5,
    detail: `seen A: "${becauseRowsA[0]?.title}" vs seen B: "${becauseRowsB[0]?.title}"`,
  });
  console.log(`[Check 5] Filas "Porque viste" distintas con seen distinto: ${pass5 ? 'PASA ✅' : 'FALLA ❌'}`);
  console.log(`  seen=${seenA} -> ${becauseRowsA.map((r) => r.title).join(', ')}`);
  console.log(`  seen=${seenB} -> ${becauseRowsB.map((r) => r.title).join(', ')}`);

  // ── 6. Ningún ítem tiene menos votos que el mínimo cuando hay dato ───────
  // En filas de géneros / mejor puntuadas se exige mín 200 votos si popularity.json tiene votos
  const genreRows = rows.filter((r) => r.id.startsWith('genre-'));
  const belowMinVotes = [];

  for (const r of genreRows) {
    for (const item of r.items || []) {
      const tmdb = item.tmdbId || String(item.id).match(/\d+$/)?.[0];
      if (!tmdb) continue;
      const popEntry =
        popularityMap[`${item.type}:${tmdb}`] ||
        popularityMap[`${item.category}:${tmdb}`] ||
        popularityMap[`movie:${tmdb}`] ||
        popularityMap[`tv:${tmdb}`] ||
        popularityMap[`anime:${tmdb}`];
      if (popEntry && typeof popEntry.votes === 'number' && popEntry.votes > 0) {
        if (popEntry.votes < 200) {
          belowMinVotes.push({
            id: item.id,
            title: item.title,
            votes: popEntry.votes,
            row: r.title,
          });
        }
      }
    }
  }

  const pass6 = belowMinVotes.length === 0;
  checks.push({
    name: '6. Mínimo 200 votos si hay dato en filas puntuadas',
    pass: pass6,
    detail: `Ítems con < 200 votos en filas de géneros: ${belowMinVotes.length}`,
  });
  console.log(`[Check 6] Mínimo de 200 votos cuando hay dato: ${pass6 ? 'PASA ✅' : 'FALLA ❌'}`);
  if (!pass6) {
    console.error('  Ítems con votos insuficientes:', belowMinVotes.slice(0, 5));
  }

  // ── TABLA RESUMEN FINAL ──────────────────────────────────────────────────
  console.log('\n=======================================================');
  console.log('RESUMEN DE PRUEBAS /api/home:');
  console.log('=======================================================');
  console.table(
    checks.map((c) => ({
      Prueba: c.name,
      Resultado: c.pass ? 'PASA' : 'FALLA',
      Detalle: c.detail,
    }))
  );

  const allPassed = checks.every((c) => c.pass);
  if (!allPassed) {
    console.error('\n❌ Al menos una prueba falló.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Todas las pruebas de /api/home PASARON exitosamente.');
  }
} catch (err) {
  console.error('[verify-home] Error fatal:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
