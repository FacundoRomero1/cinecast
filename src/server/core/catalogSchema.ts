import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractTmdbId, type MediaServerEntry } from './tmdb.js';
import { normalizeGenres } from './genres.js';

export const CATALOG_SCHEMA_VERSION = '3';

export interface CatalogItem {
  id: string;
  tmdbId: number;
  title: string;
  originalTitle: string;
  originalLanguage: string;
  spokenLanguages: string[];
  overview: string;
  posterPath: string;
  posterUrl: string;
  backdropPath: string;
  backdropUrl: string;
  releaseDate: string;
  year: number;
  genres: string[];
  voteAverage: number;
  rating: number;
  streamUrl: string;
  streamType: string;
  quality: string;
  source: string;
  category: string;
  type: string;
  upcoming: boolean;
  addedAt?: string | undefined;
  servers: MediaServerEntry[];
}

export interface CatalogCardItem {
  id: string;
  tmdbId: number;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  year: number;
  rating: number;
  genres: string[];
  category: string;
  type: string;
  quality: string;
  upcoming: boolean;
}

export interface RawCatalogEntry {
  id?: string;
  tmdbId?: number | string;
  title?: string;
  originalTitle?: string;
  originalLanguage?: string;
  spokenLanguages?: string[];
  overview?: string;
  posterPath?: string;
  posterUrl?: string;
  backdropPath?: string;
  backdropUrl?: string;
  releaseDate?: string;
  year?: number;
  genres?: string[];
  voteAverage?: number;
  rating?: number;
  streamUrl?: string;
  streamType?: string;
  quality?: string;
  source?: string;
  category?: string;
  type?: string;
  addedAt?: string;
  servers?: MediaServerEntry[];
}

export interface SqliteStatementLike {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => { changes?: number | bigint; lastInsertRowid?: number | bigint };
}

export interface SqliteDatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
  close: () => void;
}

interface SqliteModuleLike {
  DatabaseSync: new (location: string) => SqliteDatabaseLike;
}

export function getSqliteModule(): SqliteModuleLike {
  const getter = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod = typeof getter === 'function' ? (getter('node:sqlite') as SqliteModuleLike | undefined) : undefined;
  if (!mod || typeof mod.DatabaseSync !== 'function') {
    throw new Error('[CatalogDB] node:sqlite no está disponible en este runtime de Node/Electron');
  }
  return mod;
}

export function isCatalogMemoryEngine(): boolean {
  return process.env.CINECAST_CATALOG_ENGINE === 'memory';
}

export function resolveCatalogDbPath(baseDir: string, userDataPath?: string): string {
  const override = process.env.CINECAST_CATALOG_DB?.trim();
  if (override) {
    return path.resolve(override);
  }
  const resolvedBase = path.resolve(baseDir || process.cwd());
  const resolvedUserData = userDataPath ? path.resolve(userDataPath) : '';
  const isProd =
    process.env.NODE_ENV === 'production' ||
    resolvedBase.includes('.asar') ||
    (resolvedUserData !== '' &&
      resolvedUserData !== resolvedBase &&
      !resolvedUserData.startsWith(resolvedBase + path.sep));

  if (isProd && resolvedUserData) {
    return path.join(resolvedUserData, 'catalog.sqlite');
  }
  return path.join(resolvedBase, 'data', 'catalog.sqlite');
}

export function resolveCatalogJsonPaths(baseDir: string): { basePath: string | null; extPath: string | null } {
  const dirs = [
    path.join(baseDir, 'public', 'data'),
    path.join(baseDir, 'dist', 'data'),
    path.join(process.cwd(), 'public', 'data'),
  ];
  for (const dir of dirs) {
    const basePath = path.join(dir, 'catalog.json');
    if (fs.existsSync(basePath)) {
      const extPath = path.join(dir, 'catalog.extended.json');
      return { basePath, extPath: fs.existsSync(extPath) ? extPath : null };
    }
  }
  return { basePath: null, extPath: null };
}

function hashFileInto(hash: crypto.Hash, filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function computeCatalogSourceHash(basePath: string, extPath: string | null): string {
  const hash = crypto.createHash('sha256');
  hash.update('base:');
  hashFileInto(hash, basePath);
  if (extPath && fs.existsSync(extPath)) {
    hash.update('\next:');
    hashFileInto(hash, extPath);
  }
  return hash.digest('hex');
}

export function toCatalogCard(item: CatalogItem): CatalogCardItem {
  return {
    id: item.id,
    tmdbId: item.tmdbId,
    title: item.title,
    posterUrl: item.posterUrl,
    backdropUrl: item.backdropUrl,
    year: item.year,
    rating: item.rating,
    genres: item.genres,
    category: item.category,
    type: item.type,
    quality: item.quality,
    upcoming: item.upcoming,
  };
}

export function normalizeRawCatalogEntry(m: RawCatalogEntry, currentYear: number): CatalogItem {
  const isTV = m.category === 'series' || m.category === 'anime' || m.type === 'series';
  const tmdbId = Number(m.tmdbId || extractTmdbId(m.id) || 0);
  const poster = m.posterUrl || m.posterPath || '';
  const backdrop = m.backdropUrl || m.backdropPath || poster;
  const rating = Number((m.rating ?? m.voteAverage ?? 7.5).toFixed(1));
  const origLang = m.originalLanguage || (m.category === 'anime' ? 'ja' : 'es');
  const category = m.category || (isTV ? 'series' : 'movie');
  const year = m.year || (m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) || 2024 : 2024);
  const normalizedGenres = normalizeGenres(Array.isArray(m.genres) ? m.genres : [], category);

  return {
    id: m.id || `tmdb-${category}-${tmdbId}`,
    tmdbId,
    title: m.title || 'Sin Título',
    originalTitle: m.originalTitle || m.title || 'Sin Título',
    originalLanguage: origLang,
    spokenLanguages: m.spokenLanguages || (origLang === 'es' ? ['es'] : ['es', origLang]),
    overview: m.overview || '',
    posterPath: poster,
    posterUrl: poster,
    backdropPath: backdrop,
    backdropUrl: backdrop,
    releaseDate: m.releaseDate || '2024-01-01',
    year,
    genres: normalizedGenres,
    voteAverage: rating,
    rating,
    streamUrl: m.streamUrl || '',
    streamType: m.streamType || 'iframe',
    quality: m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
    source: m.source || 'tmdb',
    category,
    type: isTV ? 'series' : 'movie',
    upcoming: year > currentYear,
    addedAt: m.addedAt,
    servers: (m.servers || []).filter(
      (s) => !s.name?.toLowerCase().includes('embed.su') && !s.url?.includes('embed.su')
    ),
  };
}

export function loadNormalizedCatalogItems(basePath: string, extPath: string | null): CatalogItem[] {
  const currentYear = new Date().getFullYear();
  const baseParsed: unknown = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
  const items: CatalogItem[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(baseParsed)) {
    for (const raw of baseParsed as RawCatalogEntry[]) {
      const item = normalizeRawCatalogEntry(raw, currentYear);
      items.push(item);
      seenIds.add(item.id);
    }
  }

  if (extPath && fs.existsSync(extPath)) {
    const extParsed: unknown = JSON.parse(fs.readFileSync(extPath, 'utf-8'));
    if (Array.isArray(extParsed)) {
      for (const raw of extParsed as RawCatalogEntry[]) {
        const item = normalizeRawCatalogEntry(raw, currentYear);
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          items.push(item);
        }
      }
    }
  }

  return items;
}

function getMetaValue(db: SqliteDatabaseLike, key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row && typeof row.value === 'string' ? row.value : null;
  } catch {
    return null;
  }
}

export function rebuildCatalogDatabase(
  db: SqliteDatabaseLike,
  basePath: string,
  extPath: string | null,
  sourceHash: string
): number {
  const items = loadNormalizedCatalogItems(basePath, extPath);
  const titleRanks = new Int32Array(items.length);
  const orderByTitle = Array.from({ length: items.length }, (_, idx) => idx).sort((a, b) =>
    items[a]!.title.localeCompare(items[b]!.title, 'es')
  );
  let rank = 0;
  for (let pos = 0; pos < orderByTitle.length; pos += 1) {
    const idx = orderByTitle[pos]!;
    if (pos > 0) {
      const prevIdx = orderByTitle[pos - 1]!;
      if (items[prevIdx]!.title.localeCompare(items[idx]!.title, 'es') !== 0) {
        rank += 1;
      }
    }
    titleRanks[idx] = rank;
  }

  const genreCounts = new Map<string, number>();
  const availableGenreCounts = new Map<string, number>();
  let availableCount = 0;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      DROP TABLE IF EXISTS items_fts;
      DROP TABLE IF EXISTS item_genres;
      DROP TABLE IF EXISTS genres_summary;
      DROP TABLE IF EXISTS available_genres_summary;
      DROP TABLE IF EXISTS items;
      DROP TABLE IF EXISTS meta;

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE items (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        category TEXT NOT NULL COLLATE NOCASE,
        type TEXT NOT NULL,
        year INTEGER NOT NULL,
        rating REAL NOT NULL,
        quality TEXT NOT NULL,
        poster_url TEXT NOT NULL,
        backdrop_url TEXT NOT NULL,
        title TEXT NOT NULL,
        original_title TEXT NOT NULL,
        original_language TEXT NOT NULL,
        upcoming INTEGER NOT NULL,
        added_at TEXT,
        added_at_ms INTEGER NOT NULL,
        title_rank INTEGER NOT NULL,
        genres_json TEXT NOT NULL,
        title_lower TEXT NOT NULL,
        original_title_lower TEXT NOT NULL,
        overview_lower TEXT NOT NULL,
        detail_json TEXT NOT NULL
      );

      CREATE TABLE item_genres (
        item_seq INTEGER NOT NULL,
        genre TEXT NOT NULL,
        genre_lower TEXT NOT NULL
      );

      CREATE TABLE genres_summary (
        name TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        name_rank INTEGER NOT NULL
      );

      CREATE TABLE available_genres_summary (
        name TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        name_rank INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE items_fts USING fts5(
        title,
        original_title,
        content='items',
        content_rowid='seq',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);

    const insertItem = db.prepare(`
      INSERT INTO items (
        seq, id, tmdb_id, category, type, year, rating, quality,
        poster_url, backdrop_url, title, original_title, original_language,
        upcoming, added_at, added_at_ms, title_rank, genres_json,
        title_lower, original_title_lower, overview_lower, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGenre = db.prepare(
      'INSERT INTO item_genres (item_seq, genre, genre_lower) VALUES (?, ?, ?)'
    );

    for (let i = 0; i < items.length; i += 1) {
      const m = items[i]!;
      const seq = i + 1;
      const addedAtMs = m.addedAt ? Date.parse(m.addedAt) || 0 : 0;
      const genresJson = JSON.stringify(m.genres);

      insertItem.run(
        seq,
        m.id,
        m.tmdbId,
        m.category,
        m.type,
        m.year,
        m.rating,
        m.quality,
        m.posterUrl,
        m.backdropUrl,
        m.title,
        m.originalTitle,
        m.originalLanguage,
        m.upcoming ? 1 : 0,
        m.addedAt ?? null,
        addedAtMs,
        titleRanks[i] ?? 0,
        genresJson,
        m.title.toLowerCase(),
        m.originalTitle.toLowerCase(),
        m.overview.toLowerCase(),
        JSON.stringify(m)
      );

      if (!m.upcoming) availableCount += 1;

      for (const g of m.genres) {
        insertGenre.run(seq, g, g.toLowerCase());
        genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
        if (!m.upcoming) {
          availableGenreCounts.set(g, (availableGenreCounts.get(g) ?? 0) + 1);
        }
      }
    }

    const sortedGenres = Array.from(genreCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')
    );
    const insertSummary = db.prepare(
      'INSERT INTO genres_summary (name, count, name_rank) VALUES (?, ?, ?)'
    );
    sortedGenres.forEach(([name, count], idx) => {
      insertSummary.run(name, count, idx);
    });

    const sortedAvailableGenres = Array.from(availableGenreCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')
    );
    const insertAvailSummary = db.prepare(
      'INSERT INTO available_genres_summary (name, count, name_rank) VALUES (?, ?, ?)'
    );
    sortedAvailableGenres.forEach(([name, count], idx) => {
      insertAvailSummary.run(name, count, idx);
    });

    db.exec(`
      CREATE INDEX idx_items_id ON items(id);
      CREATE INDEX idx_items_tmdb_id ON items(tmdb_id);
      CREATE INDEX idx_items_upcoming_seq ON items(upcoming, seq);
      CREATE INDEX idx_items_upcoming_cat_rating ON items(upcoming, category, rating DESC, seq ASC);
      CREATE INDEX idx_items_upcoming_year_rating ON items(upcoming, year DESC, rating DESC, seq ASC);
      CREATE INDEX idx_items_upcoming_rating ON items(upcoming, rating DESC, seq ASC);
      CREATE INDEX idx_items_cat_year ON items(category, year);
      CREATE INDEX idx_items_cat_rating ON items(category, rating DESC, seq ASC);
      CREATE INDEX idx_items_rating ON items(rating DESC, seq ASC);
      CREATE INDEX idx_items_year_rating ON items(year DESC, rating DESC, seq ASC);
      CREATE INDEX idx_items_added_ms ON items(added_at_ms DESC, seq ASC);
      CREATE INDEX idx_items_added_at ON items(added_at DESC);
      CREATE INDEX idx_items_title_rank ON items(title_rank ASC, seq ASC);
      CREATE INDEX idx_items_lang ON items(original_language);
      CREATE INDEX idx_item_genres_lower_seq ON item_genres(genre_lower, item_seq);
      CREATE INDEX idx_item_genres_genre_seq ON item_genres(genre, item_seq);
      CREATE INDEX idx_item_genres_seq ON item_genres(item_seq);
      INSERT INTO items_fts(items_fts) VALUES('rebuild');
    `);

    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insertMeta.run('schema_version', CATALOG_SCHEMA_VERSION);
    insertMeta.run('source_hash', sourceHash);
    insertMeta.run('item_count', String(items.length));
    insertMeta.run('available_count', String(availableCount));

    db.exec('COMMIT;');
    return items.length;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    throw err;
  }
}

export function isDatabaseFresh(db: SqliteDatabaseLike, sourceHash: string): boolean {
  return (
    getMetaValue(db, 'schema_version') === CATALOG_SCHEMA_VERSION &&
    getMetaValue(db, 'source_hash') === sourceHash
  );
}

