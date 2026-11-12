const { app, components, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const http = require('http');
const express = require('express');
const { createApp } = require('../electron/core.cjs');

let baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
let internalServer = null;

async function ensureServerReady() {
  if (baseUrl && !baseUrl.startsWith('internal:')) {
    return;
  }
  const rootDir = path.resolve(__dirname, '..');
  const expressApp = createApp({
    baseDir: rootDir,
    userDataPath: path.join(rootDir, '.cinecast-data'),
    diagnostics: {
      getMode: () => false,
      setMode: () => {},
      getNoCorsFix: () => false,
      setNoCorsFix: () => {},
      onChange: () => {},
    },
  });
  const distDir = path.join(rootDir, 'dist');
  expressApp.use(express.static(distDir));
  expressApp.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  internalServer = http.createServer(expressApp);
  await new Promise((resolve) => internalServer.listen(0, '127.0.0.1', resolve));
  const { port } = internalServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

function stopLocalServer() {
  if (!internalServer) return;
  try {
    internalServer.close();
  } catch {}
  internalServer = null;
}

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
  try {
  await ensureServerReady();
  if (components && typeof components.whenReady === 'function') {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);
    } catch (_) {}
  }

  const ses = session.fromPartition('persist:probe-yearfilter');
  const catalogRequests = [];

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*api/catalog*'] }, (details, callback) => {
    catalogRequests.push(details.url);
    callback({});
  });

  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'persist:probe-yearfilter',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  console.log('\n=== PARTE 5: Prueba Automática del Filtro de Año por Año ===');
  await win.loadURL(`${baseUrl}/?ui=nuevo#/explorar`);
  await wait(2500);

  // Limpiar peticiones iniciales
  catalogRequests.length = 0;

  console.log('Seleccionando Desde=2019 y Hasta=2019...');
  const selectRes = await win.webContents.executeJavaScript(`
    (function() {
      const fromSelect = document.querySelector('select[aria-label="Año desde"]') || document.getElementById('cc-filter-year-from');
      const toSelect = document.querySelector('select[aria-label="Año hasta"]') || document.getElementById('cc-filter-year-to');

      if (!fromSelect || !toSelect) {
        return { success: false, error: 'No se encontraron los selects de año' };
      }

      fromSelect.value = '2019';
      fromSelect.dispatchEvent(new Event('change', { bubbles: true }));

      toSelect.value = '2019';
      toSelect.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        fromVal: fromSelect.value,
        toVal: toSelect.value,
      };
    })()
  `);
  console.log('Resultado de seleccionar años en UI:', selectRes);

  console.log('Esperando petición de catálogo y renderizado (3 s)...');
  await wait(3000);

  const filterState = await win.webContents.executeJavaScript(`
    (function() {
      const hash = window.location.hash;
      const cards = Array.from(document.querySelectorAll('img[alt]')).map(img => img.alt);
      // En TitleCard o en la UI podemos consultar el año de las tarjetas visibles
      const textSnippets = Array.from(document.querySelectorAll('.group')).slice(0, 15).map(el => {
        return (el.textContent || '').replace(/\\s+/g, ' ').trim();
      });

      return {
        hash,
        cardsCount: cards.length,
        firstCards: cards.slice(0, 5),
        sampleCardTexts: textSnippets.slice(0, 5),
      };
    })()
  `);
  console.log('Estado de la UI tras filtrar:', filterState);

  // Verificar peticiones de red
  const targetReq = catalogRequests.find(u => u.includes('yearFrom=2019') && u.includes('yearTo=2019'));
  console.log('Peticiones a /api/catalog registradas:', catalogRequests);

  const passUrlParams = targetReq !== undefined;
  console.log(`Petición /api/catalog con yearFrom=2019&yearTo=2019: ${passUrlParams ? 'PASA' : 'FALLA'}`);

  // Verificar en el servidor que la respuesta directa para yearFrom=2019&yearTo=2019 contiene solo 2019
  const directFetchRes = await fetch(`${baseUrl}/api/catalog?yearFrom=2019&yearTo=2019&limit=50`);
  const directJson = await directFetchRes.json();
  const directItems = directJson.items || [];
  const allYear2019 = directItems.length > 0 && directItems.every(i => i.year === 2019);
  console.log(`Todos los ítems devueltos tienen year === 2019: ${allYear2019 ? 'PASA' : 'FALLA'} (total=${directJson.total}, comprobados=${directItems.length}, años únicos=[${[...new Set(directItems.map(i => i.year))].join(',')}])`);

  // Verificar hash de URL
  const passHash = filterState.hash.includes('yearFrom=2019') && filterState.hash.includes('yearTo=2019');
  console.log(`URL hash contiene yearFrom=2019&yearTo=2019: ${passHash ? 'PASA' : 'FALLA'} (${filterState.hash})`);

  // Parte B: Terror + Comedia (genreMode=all default -> 116, genreMode=any -> 3728, chips X, 0-count disabled)
  console.log('\n=== PARTE B: Prueba Automática Multi-Género Terror + Comedia ===');
  await win.loadURL(`${baseUrl}/?ui=nuevo#/explorar`);
  await wait(2000);
  catalogRequests.length = 0;

  const pickTerror = await win.webContents.executeJavaScript(`
    (function() {
      const btn = document.querySelector('button[data-genre-name="Terror"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  await wait(1000);
  const pickComedia = await win.webContents.executeJavaScript(`
    (function() {
      const btn = document.querySelector('button[data-genre-name="Comedia"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  await wait(1200);

  const multiState = await win.webContents.executeJavaScript(`
    (function() {
      const chips = Array.from(document.querySelectorAll('[data-testid="active-filter-chips"] button[aria-label^="Quitar filtro"]')).map(b => b.getAttribute('aria-label'));
      const disabledBtns = Array.from(document.querySelectorAll('button[data-genre-name][disabled]')).map(b => b.getAttribute('data-genre-name'));
      const headerText = (document.body.innerText.match(/\\d[\\d.,]*\\s*títulos encontrados/i) || [''])[0];
      return {
        hash: window.location.hash,
        chips,
        disabledBtnsCount: disabledBtns.length,
        headerText,
      };
    })()
  `);

  const andReq = catalogRequests.find((u) => u.includes('Terror') && u.includes('Comedia') && u.includes('genreMode=all'));
  const andRes = await (await fetch(`${baseUrl}/api/catalog?genre=Terror,Comedia&fields=card&limit=20`)).json();
  const andUiMatch = pickTerror && pickComedia && Boolean(andReq) && andRes.total >= 116 && multiState.headerText.replace(/\./g, '').includes(String(andRes.total)) && multiState.chips.length >= 2;
  console.log('Multi-género Terror+Comedia (all):', { andUiMatch, total: andRes.total, multiState });

  // Probar Cualquiera (genreMode=any)
  catalogRequests.length = 0;
  await win.webContents.executeJavaScript(`
    (function() {
      const btn = Array.from(document.querySelectorAll('[aria-label="Modo de combinación de géneros"] button')).find(b => b.textContent.trim() === 'Cualquiera');
      if (btn) btn.click();
    })()
  `);
  await wait(1000);
  const anyReq = catalogRequests.find((u) => u.includes('genreMode=any'));
  console.log('Modo Cualquiera (genreMode=any) emitido:', Boolean(anyReq));

  // Probar quitar chip Terror con X
  await win.webContents.executeJavaScript(`
    (function() {
      const chip = document.querySelector('[data-testid="active-filter-chips"] button[aria-label="Quitar filtro Terror"]');
      if (chip) chip.click();
    })()
  `);
  await wait(800);
  const hashAfterChip = await win.webContents.executeJavaScript('window.location.hash');
  const passTerrorComedia = andUiMatch && Boolean(anyReq) && !hashAfterChip.includes('Terror') && hashAfterChip.includes('Comedia');
  console.log(`Terror + Comedia E2E: ${passTerrorComedia ? 'PASA' : 'FALLA'} (hash tras X=${hashAfterChip})`);

  const pass = selectRes.success && passUrlParams && allYear2019 && passHash && passTerrorComedia;

  console.log('\n========================================');
  console.log(`RESUMEN FILTRO AÑO + MULTI-GÉNERO: ${pass ? 'PASA' : 'FALLA'}`);
  console.log('========================================');

  stopLocalServer();
  app.quit();
  process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-year-filter] Error:', err);
    stopLocalServer();
    app.quit();
    process.exit(1);
  }
});
