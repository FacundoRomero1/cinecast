#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
if (!process.env.__CINECAST_TSX_LOADED) {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', __filename, ...args],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, __CINECAST_TSX_LOADED: '1' },
    }
  );
  process.exit(res.status ?? 1);
}

const { closeAllCatalogDbs, openCatalogDb } = await import('../src/server/core/catalogDb.js');
const { resolveCatalogDbPath } = await import('../src/server/core/catalogSchema.js');

const force = args.includes('--force');
const baseIdx = args.indexOf('--base');
const baseDir = baseIdx !== -1 && args[baseIdx + 1] ? path.resolve(args[baseIdx + 1]) : rootDir;
const dbIdx = args.indexOf('--db');
if (dbIdx !== -1 && args[dbIdx + 1]) {
  process.env.CINECAST_CATALOG_DB = path.resolve(args[dbIdx + 1]);
}

const targetDbPath = resolveCatalogDbPath(baseDir);
if (force && fs.existsSync(targetDbPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${targetDbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

const t0 = performance.now();
const opened = openCatalogDb(baseDir);
const elapsedMs = Number((performance.now() - t0).toFixed(2));

if (!opened) {
  console.error('[build-catalog-db] No se encontró catalog.json en', baseDir);
  process.exit(1);
}

const sizeBytes = fs.existsSync(opened.dbPath) ? fs.statSync(opened.dbPath).size : 0;
console.log(
  `✓ SQLite catálogo listo: ${opened.dbPath} (${opened.itemCount} ítems, rebuilt=${opened.rebuilt}, ${(
    sizeBytes /
    (1024 * 1024)
  ).toFixed(2)} MiB, ${elapsedMs} ms, hash=${opened.sourceHash.slice(0, 12)})`
);

closeAllCatalogDbs();

