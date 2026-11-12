import fs from 'node:fs';
import path from 'node:path';
import {
  type CatalogCardItem,
  type CatalogItem,
  type SqliteDatabaseLike,
  computeCatalogSourceHash,
  getSqliteModule,
  isDatabaseFresh,
  rebuildCatalogDatabase,
  resolveCatalogDbPath,
  resolveCatalogJsonPaths,
} from './catalogSchema.js';

interface CachedDbEntry {
  db: SqliteDatabaseLike;
  dbPath: string;
  basePath: string;
  extPath: string | null;
  baseMtimeMs: number;
  baseSize: number;
  extMtimeMs: number;
  extSize: number;
  sourceHash: string;
  itemCount: number;
}

const dbCache = new Map<string, CachedDbEntry>();

export interface OpenCatalogDbResult {
  db: SqliteDatabaseLike;
  dbPath: string;
  sourceHash: string;
  itemCount: number;
  rebuilt: boolean;
}

export interface CatalogQueryParams {
  page: number;
  limit: number;
  q: string;
  category: string;
  requestedGenres: string[];
  genreMode: 'all' | 'any';
  yearFrom: number;
  yearTo: number;
  minRating: number;
  sort: string;
  includeUpcoming: boolean;
  onlySpanish: boolean;
  includeFacets: boolean;
  fields: string;
}

function statSignature(filePath: string | null): { mtimeMs: number; size: number } {
  if (!filePath) return { mtimeMs: 0, size: 0 };
  try {
    const st = fs.statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
}

export function closeAllCatalogDbs(): void {
  for (const entry of dbCache.values()) {
    try {
      entry.db.close();
    } catch {}
  }
  dbCache.clear();
}

export function openCatalogDb(baseDir: string, userDataPath?: string): OpenCatalogDbResult | null {
  const { basePath, extPath } = resolveCatalogJsonPaths(baseDir);
  if (!basePath) return null;

  const dbPath = resolveCatalogDbPath(baseDir, userDataPath);
  const baseStat = statSignature(basePath);
  const extStat = statSignature(extPath);

  const cached = dbCache.get(dbPath);
  if (
    cached &&
    cached.basePath === basePath &&
    cached.extPath === extPath &&
    cached.baseMtimeMs === baseStat.mtimeMs &&
    cached.baseSize === baseStat.size &&
    cached.extMtimeMs === extStat.mtimeMs &&
    cached.extSize === extStat.size &&
    fs.existsSync(dbPath)
  ) {
    return {
      db: cached.db,
      dbPath,
      sourceHash: cached.sourceHash,
      itemCount: cached.itemCount,
      rebuilt: false,
    };
  }

  if (cached) {
    try {
      cached.db.close();
    } catch {}
    dbCache.delete(dbPath);
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = getSqliteModule();
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -4096; PRAGMA mmap_size = 0; PRAGMA temp_store = FILE; PRAGMA busy_timeout = 5000;');

  const sourceHash = computeCatalogSourceHash(basePath, extPath);
  let rebuilt = false;
  let itemCount = 0;

  if (!isDatabaseFresh(db, sourceHash)) {
    itemCount = rebuildCatalogDatabase(db, basePath, extPath, sourceHash);
    rebuilt = true;
  } else {
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM items').get();
    itemCount = Number(countRow?.cnt ?? 0);
  }

  dbCache.set(dbPath, {
    db,
    dbPath,
    basePath,
    extPath,
    baseMtimeMs: baseStat.mtimeMs,
    baseSize: baseStat.size,
    extMtimeMs: extStat.mtimeMs,
    extSize: extStat.size,
    sourceHash,
    itemCount,
  });

  return { db, dbPath, sourceHash, itemCount, rebuilt };
}

function rowToCard(row: Record<string, unknown>): CatalogCardItem {
  return {
    id: String(row.id ?? ''),
    tmdbId: Number(row.tmdb_id ?? 0),
    title: String(row.title ?? ''),
    posterUrl: String(row.poster_url ?? ''),
    backdropUrl: String(row.backdrop_url ?? ''),
    year: Number(row.year ?? 0),
    rating: Number(row.rating ?? 0),
    genres: JSON.parse(String(row.genres_json ?? '[]')) as string[],
    category: String(row.category ?? 'movie'),
    type: String(row.type ?? 'movie'),
    quality: String(row.quality ?? '1080p'),
    upcoming: Number(row.upcoming ?? 0) === 1,
  };
}

function rowToItem(row: Record<string, unknown>): CatalogItem {
  return JSON.parse(String(row.detail_json)) as CatalogItem;
}

const CARD_COLUMNS =
  'id, tmdb_id, title, poster_url, backdrop_url, year, rating, genres_json, category, type, quality, upcoming';

export function queryCatalogByIds(
  db: SqliteDatabaseLike,
  requestedIds: string[],
  fields: string
): Array<CatalogCardItem | CatalogItem> {
  const selectCols = fields === 'card' || !fields ? CARD_COLUMNS : 'detail_json';
  const stmtExact = db.prepare(`SELECT ${selectCols} FROM items WHERE id = ? ORDER BY seq DESC LIMIT 1`);
  const stmtNumeric = db.prepare(
    `SELECT ${selectCols} FROM items WHERE id = ? OR tmdb_id = ? ORDER BY seq DESC LIMIT 1`
  );

  const matched: Array<CatalogCardItem | CatalogItem> = [];
  const seen = new Set<string>();

  for (const rawId of requestedIds) {
    let row: Record<string, unknown> | undefined;
    if (/^\d+$/.test(rawId)) {
      const numId = Number(rawId);
      row = numId > 0 ? stmtNumeric.get(rawId, numId) : stmtExact.get(rawId);
    } else {
      row = stmtExact.get(rawId);
    }
    if (!row) continue;
    const item = fields === 'card' || !fields ? rowToCard(row) : rowToItem(row);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      matched.push(item);
    }
  }

  return matched;
}

export function queryCatalogPage(db: SqliteDatabaseLike, params: CatalogQueryParams): Record<string, unknown> {
  const baseConditions: string[] = [];
  const baseSqlParams: unknown[] = [];

  if (!params.includeUpcoming) {
    baseConditions.push('upcoming = 0');
  }

  if (params.category && params.category !== 'all') {
    let targetCat = params.category;
    if (params.category === 'movies' || params.category === 'movie') targetCat = 'movie';
    else if (params.category === 'series' || params.category === 'tv') targetCat = 'series';
    else if (params.category === 'anime') targetCat = 'anime';
    baseConditions.push('category = ?');
    baseSqlParams.push(targetCat);
  }

  if (params.onlySpanish) {
    baseConditions.push("original_language = 'es'");
  }

  if (!Number.isNaN(params.yearFrom)) {
    baseConditions.push('year >= ?');
    baseSqlParams.push(params.yearFrom);
  }
  if (!Number.isNaN(params.yearTo)) {
    baseConditions.push('year <= ?');
    baseSqlParams.push(params.yearTo);
  }
  if (!Number.isNaN(params.minRating)) {
    baseConditions.push('rating >= ?');
    baseSqlParams.push(params.minRating);
  }

  if (params.q) {
    baseConditions.push(
      '(INSTR(title_lower, ?) > 0 OR INSTR(original_title_lower, ?) > 0 OR INSTR(overview_lower, ?) > 0)'
    );
    baseSqlParams.push(params.q, params.q, params.q);
  }

  const conditions = [...baseConditions];
  const sqlParams = [...baseSqlParams];
  const uniqueGenres = Array.from(new Set(params.requestedGenres));

  if (uniqueGenres.length > 0) {
    if (params.genreMode === 'any') {
      const placeholders = uniqueGenres.map(() => '?').join(', ');
      conditions.push(
        `EXISTS (SELECT 1 FROM item_genres ig WHERE ig.item_seq = items.seq AND ig.genre_lower IN (${placeholders}))`
      );
      sqlParams.push(...uniqueGenres);
    } else {
      for (const g of uniqueGenres) {
        conditions.push(
          'EXISTS (SELECT 1 FROM item_genres ig WHERE ig.item_seq = items.seq AND ig.genre_lower = ?)'
        );
        sqlParams.push(g);
      }
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseWhereClause = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';

  let orderBy = 'ORDER BY seq ASC';
  if (params.sort === 'rating') orderBy = 'ORDER BY rating DESC, id ASC, seq ASC';
  else if (params.sort === 'year') orderBy = 'ORDER BY year DESC, rating DESC, id ASC, seq ASC';
  else if (params.sort === 'title') orderBy = 'ORDER BY title_rank ASC, id ASC, seq ASC';
  else if (params.sort === 'added') orderBy = 'ORDER BY added_at_ms DESC, id ASC, seq ASC';

  let total = 0;
  let countRow: Record<string, unknown> | undefined;

  if (!params.includeFacets && conditions.length === 1 && conditions[0] === 'upcoming = 0') {
    const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'available_count'").get();
    total = Number(metaRow?.value ?? 0);
  } else if (!params.includeFacets && conditions.length === 0) {
    const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'item_count'").get();
    total = Number(metaRow?.value ?? 0);
  } else {
    countRow = db
      .prepare(
        params.includeFacets
          ? `SELECT COUNT(*) AS cnt, MIN(year) AS minYear, MAX(year) AS maxYear FROM items ${whereClause}`
          : `SELECT COUNT(*) AS cnt FROM items ${whereClause}`
      )
      .get(...sqlParams);
    total = Number(countRow?.cnt ?? 0);
  }
  const totalPages = Math.ceil(total / params.limit) || 1;
  const offset = (params.page - 1) * params.limit;

  const isCard = params.fields === 'card';
  const selectCols = isCard ? CARD_COLUMNS : 'detail_json';
  const rows = db
    .prepare(`SELECT ${selectCols} FROM items ${whereClause} ${orderBy} LIMIT ? OFFSET ?`)
    .all(...sqlParams, params.limit, offset);

  const items = isCard ? rows.map(rowToCard) : rows.map(rowToItem);

  const responseBody: Record<string, unknown> = {
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
    items,
  };

  if (params.includeFacets) {
    const genreCounts: Record<string, number> = {};
    const allSummaryRows = db.prepare('SELECT name FROM genres_summary ORDER BY name_rank ASC').all();
    for (const sr of allSummaryRows) {
      genreCounts[String(sr.name)] = 0;
    }

    const facetWhere = params.genreMode === 'any' ? baseWhereClause : whereClause;
    const facetParams = params.genreMode === 'any' ? baseSqlParams : sqlParams;
    const genreRows = db
      .prepare(
        `SELECT g.genre AS genre, COUNT(*) AS cnt
         FROM item_genres g
         WHERE g.item_seq IN (SELECT seq FROM items ${facetWhere})
         GROUP BY g.genre`
      )
      .all(...facetParams);

    for (const r of genreRows) {
      genreCounts[String(r.genre)] = Number(r.cnt ?? 0);
    }

    const minYear = total > 0 && countRow?.minYear != null ? Number(countRow.minYear) : null;
    const maxYear = total > 0 && countRow?.maxYear != null ? Number(countRow.maxYear) : null;

    responseBody.facets = {
      genres: genreCounts,
      yearRange: { min: minYear, max: maxYear },
      minYear,
      maxYear,
    };
  }

  return responseBody;
}

export function queryGenresList(db: SqliteDatabaseLike): Array<{ name: string; count: number }> {
  const rows = db
    .prepare('SELECT name, count FROM genres_summary ORDER BY count DESC, name_rank ASC')
    .all();
  return rows.map((r) => ({ name: String(r.name), count: Number(r.count) }));
}

function genreSlug(name: string): string {
  return `genre-${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')}`;
}

export function queryHomeRows(
  db: SqliteDatabaseLike,
  rawSeen: string
): Array<{ id: string; title: string; items: CatalogCardItem[] }> {
  const currentYear = new Date().getFullYear();
  const rows: Array<{ id: string; title: string; items: CatalogCardItem[] }> = [];

  if (rawSeen) {
    const seenIds = rawSeen
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);

    if (seenIds.length > 0) {
      const seenPlaceholders = seenIds.map(() => '?').join(', ');
      const foundSeen = db
        .prepare(
          `SELECT id, genres_json FROM items WHERE id IN (${seenPlaceholders}) ORDER BY seq DESC`
        )
        .all(...seenIds);

      const seenSet = new Set<string>();
      const seenGenreCounts = new Map<string, number>();

      for (const r of foundSeen) {
        const fid = String(r.id);
        if (seenSet.has(fid)) continue;
        seenSet.add(fid);
        const genres = JSON.parse(String(r.genres_json ?? '[]')) as string[];
        for (const g of genres) {
          seenGenreCounts.set(g, (seenGenreCounts.get(g) ?? 0) + 1);
        }
      }

      const top3Genres = Array.from(seenGenreCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
        .slice(0, 3)
        .map(([name]) => name);

      if (top3Genres.length > 0) {
        const gPh = top3Genres.map(() => '?').join(', ');
        const seenArr = Array.from(seenSet);
        const sPh = seenArr.map(() => '?').join(', ');
        const recRows = db
          .prepare(
            `SELECT ${CARD_COLUMNS} FROM items
             WHERE upcoming = 0
               AND id NOT IN (${sPh})
               AND EXISTS (SELECT 1 FROM item_genres ig WHERE ig.item_seq = items.seq AND ig.genre IN (${gPh}))
             ORDER BY rating DESC, seq ASC
             LIMIT 20`
          )
          .all(...seenArr, ...top3Genres);

        if (recRows.length > 0) {
          rows.push({
            id: 'recommended',
            title: 'Recomendados para vos',
            items: recRows.map(rowToCard),
          });
        }
      }
    }
  }

  rows.push({
    id: 'trending',
    title: 'Tendencias',
    items: db
      .prepare(`SELECT ${CARD_COLUMNS} FROM items WHERE upcoming = 0 ORDER BY seq ASC LIMIT 20`)
      .all()
      .map(rowToCard),
  });

  rows.push({
    id: 'new-releases',
    title: 'Estrenos',
    items: db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM items WHERE upcoming = 0 AND year = ? ORDER BY rating DESC, seq ASC LIMIT 20`
      )
      .all(currentYear)
      .map(rowToCard),
  });

  rows.push({
    id: 'featured-anime',
    title: 'Anime destacado',
    items: db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM items WHERE upcoming = 0 AND category = 'anime' ORDER BY rating DESC, seq ASC LIMIT 20`
      )
      .all()
      .map(rowToCard),
  });

  rows.push({
    id: 'featured-series',
    title: 'Series destacadas',
    items: db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM items WHERE upcoming = 0 AND category = 'series' ORDER BY rating DESC, seq ASC LIMIT 20`
      )
      .all()
      .map(rowToCard),
  });

  const top5Genres = db
    .prepare('SELECT name, count FROM available_genres_summary ORDER BY count DESC, name_rank ASC LIMIT 5')
    .all()
    .map((r) => ({ name: String(r.name), count: Number(r.count) }));

  const stmtGenreRow = db.prepare(
    `SELECT ${CARD_COLUMNS} FROM items
     WHERE upcoming = 0
       AND rating >= 7
       AND EXISTS (SELECT 1 FROM item_genres ig WHERE ig.item_seq = items.seq AND ig.genre = ?)
     ORDER BY rating DESC, seq ASC
     LIMIT 20`
  );

  for (const g of top5Genres) {
    rows.push({
      id: genreSlug(g.name),
      title: g.name,
      items: stmtGenreRow.all(g.name).map(rowToCard),
    });
  }

  return rows;
}

export function searchLocalCatalogFts(
  db: SqliteDatabaseLike,
  rawQuery: string,
  limit = 20
): CatalogItem[] {
  const tokens = rawQuery.trim().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return [];

  const ftsQuery = tokens.map((t) => `"${t}"*`).join(' ');
  try {
    const rows = db
      .prepare(
        `SELECT items.detail_json
         FROM items_fts
         JOIN items ON items.seq = items_fts.rowid
         WHERE items_fts MATCH ?
         ORDER BY bm25(items_fts) ASC, items.seq ASC
         LIMIT ?`
      )
      .all(ftsQuery, limit);
    return rows.map(rowToItem);
  } catch {
    return [];
  }
}

export function findCatalogItemInDb(
  db: SqliteDatabaseLike,
  tmdbIdStr: string,
  rawIdStr: string
): CatalogItem | null {
  const numTmdb = /^\d+$/.test(tmdbIdStr) ? Number(tmdbIdStr) : -1;
  const row = db
    .prepare('SELECT detail_json FROM items WHERE tmdb_id = ? OR id = ? ORDER BY seq ASC LIMIT 1')
    .get(numTmdb, rawIdStr);
  return row ? rowToItem(row) : null;
}
