import express, { type Express, type Request } from 'express';
import compression from 'compression';
import path from 'path';
import { createSyncRouter } from './routes/sync.js';
import { createCatalogRouter, type CatalogItem, type CatalogRouterOptions } from './routes/catalog.js';
import { createTmdbDetailRouter, type TmdbDetailOptions } from './routes/tmdb-detail.js';
import { createSearchRouter, type SearchOptions } from './routes/search.js';
import { createSportsRouter, type SportsOptions } from './routes/sports.js';
import { createHistoryRouter, type HistoryOptions } from './routes/history.js';
import { createDiagnosticsRouter, type DiagnosticsOptions } from './routes/diagnostics.js';
import { createDownloadsRouter, type DownloadsOptions } from './routes/downloads.js';
import { createArchiveRouter } from './routes/archive.js';
import { createAccountsRouter, type AccountsOptions } from './routes/accounts.js';
import { createAuthRouter, type AuthRouterOptions } from './routes/auth.js';
import { createYouTubeRouter } from './routes/youtube.js';
import { createClientLogRouter } from './routes/clientlog.js';

export interface CreateAppOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  posterCacheDir?: string | undefined;
  mediaCacheDir?: string | undefined;
  accountsFilePath?: string | undefined;
  userAgent?: string | undefined;
  port?: number | string | undefined;
  diagnostics: DiagnosticsOptions;
  auth?: AuthRouterOptions | undefined;
  resolveOrigin?: ((req: Request) => string) | undefined;
  getCatalogCache?: (() => CatalogItem[] | null) | undefined;
  setCatalogCache?: ((cache: CatalogItem[]) => void) | undefined;
  onHistoryUpdated?: HistoryOptions['onHistoryUpdated'] | undefined;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.use(compression());
  app.use(express.json());

  // Allow CORS so downloaded portable HTML apps or ais-pre / ais-dev cross-origins can always reach the sync API
  app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  const baseDir = options.baseDir || process.cwd();
  const userDataDir = options.userDataPath || path.join(baseDir, '.cinecast-data');
  const posterCacheDir = options.posterCacheDir || path.join(userDataDir, 'poster_cache');
  const mediaCacheDir = options.mediaCacheDir || path.join(userDataDir, 'media_cache');
  const accountsFilePath =
    options.accountsFilePath || path.join(userDataDir, 'cinecast-accounts.json');

  let sharedCatalogCache: CatalogItem[] | null = null;
  const getCatalogCache = options.getCatalogCache || (() => sharedCatalogCache);
  const setCatalogCache =
    options.setCatalogCache ||
    ((c: CatalogItem[]) => {
      sharedCatalogCache = c;
    });

  const catalogOpts: CatalogRouterOptions = {
    baseDir,
    userDataPath: userDataDir,
    posterCacheDir,
    userAgent: options.userAgent,
    getCatalogCache,
    setCatalogCache,
  };

  const tmdbDetailOpts: TmdbDetailOptions = {
    baseDir,
    userDataPath: userDataDir,
    mediaCacheDir,
    getCatalogCache,
    setCatalogCache,
  };

  const searchOpts: SearchOptions = {
    baseDir,
    userDataPath: userDataDir,
    userAgent: options.userAgent,
    getCatalogCache,
    setCatalogCache,
  };

  const sportsOpts: SportsOptions = {
    baseDir,
  };

  const historyOpts: HistoryOptions = {
    baseDir,
    userDataPath: userDataDir,
    onHistoryUpdated: options.onHistoryUpdated,
  };

  const downloadsOpts: DownloadsOptions = {
    baseDir,
    port: options.port,
    resolveOrigin: options.resolveOrigin,
  };

  const accountsOpts: AccountsOptions = {
    accountsFilePath,
  };

  // Montaje de rutas API
  app.use('/api', createSyncRouter());
  app.use('/api', createCatalogRouter(catalogOpts));
  app.use('/api', createTmdbDetailRouter(tmdbDetailOpts));
  app.use('/api', createSearchRouter(searchOpts));
  app.use('/api', createSportsRouter(sportsOpts));
  app.use('/api', createHistoryRouter(historyOpts));
  app.use('/api', createDiagnosticsRouter(options.diagnostics));
  app.use('/api', createArchiveRouter());
  app.use('/api', createAccountsRouter(accountsOpts));
  app.use('/api', createYouTubeRouter());
  app.use('/api', createClientLogRouter());

  if (options.auth) {
    app.use('/', createAuthRouter(options.auth));
  }

  app.use('/', createDownloadsRouter(downloadsOpts));

  return app;
}
