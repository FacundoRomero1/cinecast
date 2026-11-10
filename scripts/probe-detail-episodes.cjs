const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const baseUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

// Handlers IPC para preload.cjs
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);
    } catch (_) {}
  }

  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:probe-episodes',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const testCases = [
    {
      name: 'Black Clover (Anime)',
      route: '#/titulo/anime/tmdb-anime-73223',
      expectedKeywords: ['Black Clover'],
    },
    {
      name: 'Breaking Bad (Serie)',
      route: '#/titulo/series/breaking-bad',
      expectedKeywords: ['Breaking Bad'],
    },
  ];

  let allPassed = true;
  const results = [];

  for (const tc of testCases) {
    console.log(`\n--- Probando ${tc.name} (${tc.route}) ---`);
    await win.loadURL(`${baseUrl}/?ui=nuevo${tc.route}`);

    console.log('Esperando 6 segundos para carga completa de ficha y episodios...');
    await wait(6000);

    const inspection = await win.webContents.executeJavaScript(`
      (function() {
        const text = document.body.innerText || '';
        const hasUndefined = /undefined/i.test(text);
        const hasSinCapitulos = /sin cap[ií]tulos|sin episodios/i.test(text);

        // Buscar títulos de episodios renderizados
        // En DetailModal se renderizan en h4 dentro de la lista de episodios
        const h4Elements = Array.from(document.querySelectorAll('h4')).map(h => (h.textContent || '').trim());
        const episodeTitles = h4Elements.filter(t => t.length > 0 && !/reparto|similares|temporada/i.test(t));

        // Chequear si hay elementos de episodio
        const epCards = Array.from(document.querySelectorAll('.group')).filter(el => {
          const t = el.textContent || '';
          return /min|cap[ií]tulo|episodio/i.test(t);
        });

        return {
          titleOnPage: document.title,
          textSnippet: text.slice(0, 500).replace(/\\s+/g, ' '),
          hasUndefined,
          hasSinCapitulos,
          episodeTitlesCount: episodeTitles.length,
          firstEpisodeTitles: episodeTitles.slice(0, 5),
          epCardsCount: epCards.length,
          containsExpected: text.includes('${tc.expectedKeywords[0]}'),
        };
      })()
    `);

    console.log('Inspección:', JSON.stringify(inspection, null, 2));

    const undefinedPass = !inspection.hasUndefined;
    const sinCapitulosPass = !inspection.hasSinCapitulos;
    const hasEpisodesPass = inspection.episodeTitlesCount >= 1 || inspection.epCardsCount >= 1;

    const pass = undefinedPass && sinCapitulosPass && hasEpisodesPass;
    if (!pass) allPassed = false;

    console.log(`[${tc.name}] Sin 'undefined': ${undefinedPass ? 'SI' : 'NO'}`);
    console.log(`[${tc.name}] Sin 'Sin capítulos': ${sinCapitulosPass ? 'SI' : 'NO'}`);
    console.log(`[${tc.name}] Episodios con título: ${inspection.episodeTitlesCount} (primeros: ${inspection.firstEpisodeTitles.join(', ')})`);
    console.log(`[${tc.name}] Resultado: ${pass ? 'PASA' : 'FALLA'}`);

    results.push({ name: tc.name, pass, inspection });
  }

  console.log('\n========================================');
  console.log(`RESUMEN PRUEBA EPISODIOS: ${allPassed ? 'PASA' : 'FALLA'}`);
  console.log('========================================');

  app.quit();
  process.exit(allPassed ? 0 : 1);
});
