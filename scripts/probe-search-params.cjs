const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
      partition: 'persist:probe-searchparams',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let allPassed = true;

  console.log('\n=== PARTE 4: Prueba Automática de SearchParams y Preservación de Estado ===');

  // --- TEST A: Búsqueda ---
  console.log('\n--- 1. Probando /buscar ---');
  await win.loadURL(`${baseUrl}/?ui=nuevo#/buscar`);
  await wait(2000);

  // Escribir "black clover" en el input usando el setter nativo de React
  const searchInputRes = await win.webContents.executeJavaScript(`
    (function() {
      const input = document.querySelector('input[type="search"]') || document.querySelector('input');
      if (!input) return { found: false };
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, 'black clover');
      } else {
        input.value = 'black clover';
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, val: input.value };
    })()
  `);
  console.log('Escribiendo en input de búsqueda:', searchInputRes);

  console.log('Esperando resultados de búsqueda (3 s)...');
  await wait(3000);

  const searchAfterType = await win.webContents.executeJavaScript(`
    (function() {
      const input = document.querySelector('input[type="search"]') || document.querySelector('input');
      const hash = window.location.hash;
      const cards = Array.from(document.querySelectorAll('img[alt]')).map(img => img.alt);
      return {
        hash,
        inputValue: input ? input.value : null,
        cardsCount: cards.length,
        firstCards: cards.slice(0, 3),
      };
    })()
  `);
  console.log('Estado tras escribir y esperar:', searchAfterType);

  const urlHasQuery = searchAfterType.hash.toLowerCase().includes('black') && searchAfterType.hash.includes('q=');
  const hasResults = searchAfterType.cardsCount > 0;
  console.log(`URL contiene ?q=black...: ${urlHasQuery ? 'SI' : 'NO'}`);
  console.log(`Hay resultados en pantalla: ${hasResults ? 'SI' : 'NO'} (${searchAfterType.cardsCount} tarjetas)`);

  // Abrir la primera ficha
  console.log('Abriendo primera ficha...');
  await win.webContents.executeJavaScript(`
    (function() {
      // Hacer clic en la primera tarjeta de título
      const firstCard = document.querySelector('.group.cursor-pointer') || document.querySelector('img[alt]')?.closest('div');
      if (firstCard) firstCard.click();
    })()
  `);
  await wait(2500);

  const modalOpenCheck = await win.webContents.executeJavaScript(`
    (function() {
      return {
        hash: window.location.hash,
        isDetailOpen: window.location.hash.includes('/titulo/'),
      };
    })()
  `);
  console.log('Ficha abierta:', modalOpenCheck);

  // Cerrar la ficha con el botón de volver / cerrar
  console.log('Cerrando la ficha...');
  await win.webContents.executeJavaScript(`
    (function() {
      // Buscar botón de cerrar en DetailModal
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => 
        (b.title && /cerrar|volver/i.test(b.title)) || 
        b.getAttribute('aria-label') === 'Cerrar' ||
        b.querySelector('svg.lucide-x') ||
        /volver|cerrar/i.test(b.textContent || '')
      );
      if (closeBtn) {
        closeBtn.click();
      } else {
        window.history.back();
      }
    })()
  `);
  await wait(2000);

  const searchRestoredCheck = await win.webContents.executeJavaScript(`
    (function() {
      const input = document.querySelector('input[type="search"]') || document.querySelector('input');
      const hash = window.location.hash;
      const cards = Array.from(document.querySelectorAll('img[alt]')).map(img => img.alt);
      return {
        hash,
        inputValue: input ? input.value : null,
        cardsCount: cards.length,
        firstCards: cards.slice(0, 3),
      };
    })()
  `);
  console.log('Estado tras cerrar ficha:', searchRestoredCheck);

  const passInputPreserved = searchRestoredCheck.inputValue === 'black clover';
  const passResultsPreserved = searchRestoredCheck.cardsCount > 0;
  const passSearch = urlHasQuery && hasResults && passInputPreserved && passResultsPreserved;
  if (!passSearch) allPassed = false;
  console.log(`[Búsqueda] Input conserva 'black clover': ${passInputPreserved ? 'SI' : 'NO'}`);
  console.log(`[Búsqueda] Resultados persisten: ${passResultsPreserved ? 'SI' : 'NO'} (${searchRestoredCheck.cardsCount} tarjetas)`);
  console.log(`[Búsqueda] Resultado general: ${passSearch ? 'PASA' : 'FALLA'}`);

  // --- TEST B: Explorar ---
  console.log('\n--- 2. Probando /explorar ---');
  await win.loadURL(`${baseUrl}/?ui=nuevo#/explorar`);
  await wait(2000);

  // Seleccionar un filtro (por ejemplo categoría Anime o Películas)
  const clickFilterRes = await win.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const animeBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Anime');
      if (animeBtn) {
        animeBtn.click();
        return { clicked: 'Anime' };
      }
      const seriesBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Series');
      if (seriesBtn) {
        seriesBtn.click();
        return { clicked: 'Series' };
      }
      return { clicked: null };
    })()
  `);
  console.log('Seleccionando filtro en Explorar:', clickFilterRes);
  await wait(2500);

  const exploreAfterFilter = await win.webContents.executeJavaScript(`
    (function() {
      const hash = window.location.hash;
      const cards = Array.from(document.querySelectorAll('img[alt]')).map(img => img.alt);
      return {
        hash,
        cardsCount: cards.length,
        firstCards: cards.slice(0, 3),
      };
    })()
  `);
  console.log('Estado tras filtrar en Explorar:', exploreAfterFilter);

  const exploreUrlHasFilter = exploreAfterFilter.hash.includes('type=');
  const exploreHasResults = exploreAfterFilter.cardsCount > 0;

  // Abrir la primera ficha en Explorar
  console.log('Abriendo primera ficha en Explorar...');
  await win.webContents.executeJavaScript(`
    (function() {
      const firstCard = document.querySelector('.group.cursor-pointer') || document.querySelector('img[alt]')?.closest('div');
      if (firstCard) firstCard.click();
    })()
  `);
  await wait(2500);

  // Cerrar la ficha
  console.log('Cerrando ficha en Explorar...');
  await win.webContents.executeJavaScript(`
    (function() {
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => 
        (b.title && /cerrar|volver/i.test(b.title)) || 
        b.getAttribute('aria-label') === 'Cerrar' ||
        b.querySelector('svg.lucide-x') ||
        /volver|cerrar/i.test(b.textContent || '')
      );
      if (closeBtn) {
        closeBtn.click();
      } else {
        window.history.back();
      }
    })()
  `);
  await wait(2000);

  const exploreRestoredCheck = await win.webContents.executeJavaScript(`
    (function() {
      const hash = window.location.hash;
      const cards = Array.from(document.querySelectorAll('img[alt]')).map(img => img.alt);
      return {
        hash,
        cardsCount: cards.length,
        firstCards: cards.slice(0, 3),
      };
    })()
  `);
  console.log('Estado tras cerrar ficha en Explorar:', exploreRestoredCheck);

  const passExploreFilterPreserved = exploreRestoredCheck.hash.includes('type=');
  const passExploreResultsPreserved = exploreRestoredCheck.cardsCount > 0;
  const passExplore = exploreUrlHasFilter && exploreHasResults && passExploreFilterPreserved && passExploreResultsPreserved;
  if (!passExplore) allPassed = false;
  console.log(`[Explorar] Filtro type= preservado en hash: ${passExploreFilterPreserved ? 'SI' : 'NO'}`);
  console.log(`[Explorar] Resultados persisten: ${passExploreResultsPreserved ? 'SI' : 'NO'} (${exploreRestoredCheck.cardsCount} tarjetas)`);
  console.log(`[Explorar] Resultado general: ${passExplore ? 'PASA' : 'FALLA'}`);

  console.log('\n========================================');
  console.log(`RESUMEN SEARCHPARAMS Y ESTADO: ${allPassed ? 'PASA' : 'FALLA'}`);
  console.log('========================================');

  app.quit();
  process.exit(allPassed ? 0 : 1);
});
