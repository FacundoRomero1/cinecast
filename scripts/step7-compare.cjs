const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const logFile = path.join(__dirname, 'step7-log.txt');
fs.writeFileSync(logFile, 'Script started: ' + new Date().toISOString() + '\n', 'utf8');

ipcMain.handle('get-local-ip', () => ({ ip: '127.0.0.1', port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('set-no-cors-fix', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('save-accounts', () => true);
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-embed-status', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('probe-streams', (_e, urls) => []);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('control-active-media', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('send-native-trackpad-event', () => true);

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);
    } catch (_) {}
  }

  try {
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:step7',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.webContents.on('console-message', (_e, level, msg) => {
      fs.appendFileSync(logFile, 'Console [' + level + ']: ' + msg + '\n', 'utf8');
    });

    await win.loadURL('http://localhost:3000/?ui=nuevo');
    fs.appendFileSync(logFile, 'Loaded http://localhost:3000/?ui=nuevo\n', 'utf8');

    await new Promise((r) => setTimeout(r, 2000));

    const result = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const { mediaSync } = await import('/src/services/mediaSync.ts');
          const { toMediaItem } = await import('/src/app/toMediaItem.ts');
          const { MEDIA_CATALOG } = await import('/src/data/catalog.ts');
          const { sampleMovies } = await import('/src/data/mediaCatalog.ts');

          const bbMovie = sampleMovies.find(m => m.tmdbId === 1396);
          const movieMovie = sampleMovies.find(m => m.type === 'movie' || m.category === 'movie');
          const bcMovie = sampleMovies.find(m => m.tmdbId === 70881 || (m.title && m.title.toLowerCase().includes('black clover')));

          const bbClassic = bbMovie ? mediaSync.movieToMediaItem(bbMovie) : null;
          const movieClassic = movieMovie ? mediaSync.movieToMediaItem(movieMovie) : null;
          const bcClassic = bcMovie ? mediaSync.movieToMediaItem(bcMovie) : null;

          const catRes = await fetch('/api/catalog?ids=breaking-bad,tmdb-series-1396,tmdb-anime-70881,tmdb-movie-969681,spiderman-across');
          const catJson = await catRes.json();
          const items = catJson.items || [];

          const findCard = (tmdbId, titleSub) => items.find(i => i.tmdbId === tmdbId || (i.title && i.title.toLowerCase().includes(titleSub)));
          
          const bbCard = findCard(1396, 'breaking bad') || { id: 'tmdb-series-1396', tmdbId: 1396, title: 'Breaking Bad', type: 'series', category: 'series', year: 2008, rating: 9.5, genres: ['Drama'], posterUrl: '', backdropUrl: '', quality: 'HD', upcoming: false };
          const bcCard = findCard(70881, 'black clover') || { id: 'tmdb-anime-70881', tmdbId: 70881, title: 'Black Clover', type: 'series', category: 'anime', year: 2017, rating: 8.5, genres: ['Anime'], posterUrl: '', backdropUrl: '', quality: 'HD', upcoming: false };
          const movieCard = findCard(movieMovie?.tmdbId || 969681, 'spider') || items.find(i => i.type === 'movie') || { id: 'tmdb-movie-969681', tmdbId: 969681, title: 'Spider-Man', type: 'movie', category: 'movie', year: 2023, rating: 8.4, genres: ['Acción'], posterUrl: '', backdropUrl: '', quality: 'HD', upcoming: false };

          const bbNew = toMediaItem(bbCard, null);
          const bcNew = toMediaItem(bcCard, null);
          const movieNew = toMediaItem(movieCard, null);

          const bbMediaCatalog = MEDIA_CATALOG.find(m => m.tmdbId === 1396);
          const bcMediaCatalog = MEDIA_CATALOG.find(m => m.tmdbId === 70881);
          const movieMediaCatalog = MEDIA_CATALOG.find(m => m.tmdbId === (movieMovie?.tmdbId || 969681));

          return {
            mediaCatalog: {
              bb: bbMediaCatalog ? { id: bbMediaCatalog.id, tmdbId: bbMediaCatalog.tmdbId, type: bbMediaCatalog.type, category: bbMediaCatalog.category, seasons: bbMediaCatalog.seasonsCount || bbMediaCatalog.seasons?.length, episodes: bbMediaCatalog.episodes?.length } : null,
              bc: bcMediaCatalog ? { id: bcMediaCatalog.id, tmdbId: bcMediaCatalog.tmdbId, type: bcMediaCatalog.type, category: bcMediaCatalog.category, seasons: bcMediaCatalog.seasonsCount || bcMediaCatalog.seasons?.length, episodes: bcMediaCatalog.episodes?.length } : null,
              movie: movieMediaCatalog ? { id: movieMediaCatalog.id, tmdbId: movieMediaCatalog.tmdbId, type: movieMediaCatalog.type, category: movieMediaCatalog.category, seasons: movieMediaCatalog.seasonsCount || movieMediaCatalog.seasons?.length, episodes: movieMediaCatalog.episodes?.length } : null,
            },
            classicMovieToMediaItem: {
              bb: bbClassic ? { id: bbClassic.id, tmdbId: bbClassic.tmdbId, type: bbClassic.type, category: bbClassic.category, seasons: bbClassic.seasonsCount || bbClassic.seasons?.length, episodes: bbClassic.episodes?.length } : null,
              bc: bcClassic ? { id: bcClassic.id, tmdbId: bcClassic.tmdbId, type: bcClassic.type, category: bcClassic.category, seasons: bcClassic.seasonsCount || bcClassic.seasons?.length, episodes: bcClassic.episodes?.length } : null,
              movie: movieClassic ? { id: movieClassic.id, tmdbId: movieClassic.tmdbId, type: movieClassic.type, category: movieClassic.category, seasons: movieClassic.seasonsCount || movieClassic.seasons?.length, episodes: movieClassic.episodes?.length } : null,
            },
            newToMediaItem: {
              bb: { id: bbNew.id, tmdbId: bbNew.tmdbId, type: bbNew.type, category: bbNew.category, seasons: bbNew.seasonsCount || bbNew.seasons?.length, episodes: bbNew.episodes?.length },
              bc: { id: bcNew.id, tmdbId: bcNew.tmdbId, type: bcNew.type, category: bcNew.category, seasons: bcNew.seasonsCount || bcNew.seasons?.length, episodes: bcNew.episodes?.length },
              movie: { id: movieNew.id, tmdbId: movieNew.tmdbId, type: movieNew.type, category: movieNew.category, seasons: movieNew.seasonsCount || movieNew.seasons?.length, episodes: movieNew.episodes?.length },
            }
          };
        } catch (innerErr) {
          return { innerError: innerErr.stack || String(innerErr) };
        }
      })()
    `);

    fs.writeFileSync(path.join(__dirname, 'step7-result.json'), JSON.stringify(result, null, 2), 'utf8');
    fs.appendFileSync(logFile, 'Written step7-result.json successfully\n', 'utf8');
    app.quit();
  } catch (err) {
    fs.appendFileSync(logFile, 'Error: ' + (err.stack || err) + '\n', 'utf8');
    app.exit(1);
  }
});
