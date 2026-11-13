import express, { type Express, type Request } from 'express';
import compression from 'compression';
import path from 'path';
import { createSyncRouter } from './routes/sync.js';
import { createCatalogRouter, type CatalogItem, type CatalogRouterOptions } from './routes/catalog.js';
import { createTmdbDetailRouter, type TmdbDetailOptions } from './routes/tmdb-detail.js';
import { createSearchRouter, type SearchOptions } from './routes/search.js';
import { createSportsRouter, type SportsOptions } from './routes/sports.js';
import { createHistoryRouter, type HistoryOptions } from './routes/history.js';
import { createHistoryRepairRouter } from './routes/historyRepair.js';
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
  app.use('/api', createHistoryRepairRouter(historyOpts));
  app.use('/api', createDiagnosticsRouter(options.diagnostics));
  app.use('/api', createArchiveRouter());
  app.use('/api', createAccountsRouter(accountsOpts));
  app.use('/api', createYouTubeRouter());
  app.use('/api', createClientLogRouter());

  if (options.auth) {
    app.use('/', createAuthRouter(options.auth));
  }

  app.use('/', createDownloadsRouter(downloadsOpts));

  if (process.env.CINECAST_TEST === '1') {
    app.get('/__test/embed.html', (req, res) => {
      const durParam = Number(req.query.dur) || 400;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Embed Test Player</title></head>
<body style="background:#111; color:#eee; font-family:sans-serif; padding:20px;">
  <h2>Embed Test Player (WAV ${durParam}s)</h2>
  <video id="test-video" controls playsinline style="width:320px; height:180px; background:#000;"></video>
  <div style="margin-top:10px;">
    <span>CurrentTime: </span><span id="time-display">0</span>s
  </div>
  <script>
    function createWavBlob(durationSeconds, sampleRate = 8000) {
      const numSamples = durationSeconds * sampleRate;
      const buffer = new ArrayBuffer(44 + numSamples);
      const view = new DataView(buffer);

      function writeString(offset, string) {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + numSamples, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      writeString(36, 'data');
      view.setUint32(40, numSamples, true);

      for (let i = 0; i < numSamples; i++) {
        const val = Math.floor(128 + 20 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
        view.setUint8(44 + i, val);
      }

      return new Blob([buffer], { type: 'audio/wav' });
    }

    const video = document.getElementById('test-video');
    const display = document.getElementById('time-display');
    const params = new URLSearchParams(window.location.search);
    const dur = Number(params.get('dur')) || ${durParam};
    const wavBlob = createWavBlob(dur);
    video.src = URL.createObjectURL(wavBlob);

    video.addEventListener('timeupdate', () => {
      display.textContent = video.currentTime.toFixed(2);
    });

    window.__testVideo = video;
  </script>
</body>
</html>`);
    });

    app.get('/__test/keys.html', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Key Tester</title>
</head>
<body style="background:#111; color:#eee; font-family:sans-serif; padding:20px;">
  <h2>Key Tester</h2>
  <div id="log">Esperando teclas...</div>
  <script>
    window.__keys = [];
    window.addEventListener('keydown', (e) => {
      const item = { key: e.key, keyCode: e.keyCode, time: Date.now() };
      window.__keys.push(item);
      const log = document.getElementById('log');
      if (log) {
        log.textContent = JSON.stringify(window.__keys);
      }
    });
  </script>
</body>
</html>`);
    });
  }

  return app;
}
