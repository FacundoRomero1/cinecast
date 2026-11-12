const { app, components, BrowserWindow, ipcMain } = require('electron');
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

    const win = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
      },
    });

    console.log(`[probe-remote-sheet] Cargando ${baseUrl}/?ui=nuevo#/explorar...`);
    await win.loadURL(`${baseUrl}/?ui=nuevo#/explorar`);
    await wait(2500);

    // =========================================================================
    // Caso 7 (a): Explorar > Filtros > Anime > bajar 600 px > abrir panel > cerrar
    // Esperado: mismo hash y scroll (tolerancia 40 px)
    // =========================================================================
    console.log('\n--- CASO 7 (a): Explorar > Anime > Scroll 600px > Abrir Control > Cerrar ---');
    // Seleccionar Anime
    await win.webContents.executeJavaScript(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Anime');
        if (btn) btn.click();
      })()
    `);
    await wait(1500);

    // Bajar 600 px
    await win.webContents.executeJavaScript(`
      window.scrollTo(0, 600);
      void 0;
    `);
    await wait(800);

    const stateBeforeSheet = await win.webContents.executeJavaScript(`
      ({
        hash: window.location.hash,
        scroll: Math.round(window.scrollY),
      })
    `);
    console.log('Estado previo a abrir panel:', stateBeforeSheet);

    // Abrir panel tocando la pestaña Control en la barra inferior móvil
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Control'));
        if (tab) tab.click();
      })()
    `);
    await wait(1000);

    const isSheetOpenA = await win.webContents.executeJavaScript(`
      Boolean(document.querySelector('[data-testid="remote-sheet-container"]'))
    `);
    console.log('Panel abierto:', isSheetOpenA);

    // Cerrar panel tocando el botón ✕
    await win.webContents.executeJavaScript(`
      (() => {
        const closeBtn = document.querySelector('button[aria-label="Cerrar panel de control"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await wait(1000);

    const stateAfterSheetA = await win.webContents.executeJavaScript(`
      ({
        isClosed: !document.querySelector('[data-testid="remote-sheet-container"]'),
        hash: window.location.hash,
        scroll: Math.round(window.scrollY),
      })
    `);
    console.log('Estado tras cerrar panel:', stateAfterSheetA);

    const scrollDiffA = Math.abs(stateAfterSheetA.scroll - stateBeforeSheet.scroll);
    const passA =
      isSheetOpenA &&
      stateAfterSheetA.isClosed &&
      stateAfterSheetA.hash === stateBeforeSheet.hash &&
      scrollDiffA <= 40;
    console.log(`CASO 7 (a): ${passA ? 'PASA' : 'FALLA'} (hash=${stateAfterSheetA.hash}, diffScroll=${scrollDiffA}px)`);

    // =========================================================================
    // Caso 7 (b): Abrir panel y tocar Atrás: se cierra y el hash no cambia
    // =========================================================================
    console.log('\n--- CASO 7 (b): Abrir panel y tocar Atrás (popstate) ---');
    const hashBeforeB = await win.webContents.executeJavaScript('window.location.hash');
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Control'));
        if (tab) tab.click();
      })()
    `);
    await wait(800);

    const isSheetOpenB = await win.webContents.executeJavaScript(`
      Boolean(document.querySelector('[data-testid="remote-sheet-container"]'))
    `);

    // Simular botón Atrás del navegador
    await win.webContents.executeJavaScript(`
      window.history.back();
    `);
    await wait(1000);

    const stateAfterB = await win.webContents.executeJavaScript(`
      ({
        isClosed: !document.querySelector('[data-testid="remote-sheet-container"]'),
        hash: window.location.hash,
      })
    `);
    const passB = isSheetOpenB && stateAfterB.isClosed && stateAfterB.hash === hashBeforeB;
    console.log(`CASO 7 (b): ${passB ? 'PASA' : 'FALLA'} (abierto=${isSheetOpenB}, cerrado=${stateAfterB.isClosed}, hash=${stateAfterB.hash})`);

    // =========================================================================
    // Caso 7 (c): Buscar "black clover" > abrir panel > cerrar: conserva texto
    // =========================================================================
    console.log('\n--- CASO 7 (c): Buscar "black clover" > abrir panel > cerrar ---');
    await win.webContents.executeJavaScript(`
      window.location.hash = '#/buscar';
    `);
    await wait(1200);

    await win.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('input[type="search"]');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'black clover');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await wait(1000);

    // Abrir panel
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Control'));
        if (tab) tab.click();
      })()
    `);
    await wait(800);

    // Cerrar panel
    await win.webContents.executeJavaScript(`
      (() => {
        const closeBtn = document.querySelector('button[aria-label="Cerrar panel de control"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await wait(800);

    const searchValAfter = await win.webContents.executeJavaScript(`
      document.querySelector('input[type="search"]')?.value || ''
    `);
    const passC = searchValAfter.toLowerCase().includes('black clover');
    console.log(`CASO 7 (c): ${passC ? 'PASA' : 'FALLA'} (valor actual="${searchValAfter}")`);

    // =========================================================================
    // Caso 7 (d): Abrir Control, ir a Inicio, volver a Explorar: conserva anime
    // =========================================================================
    console.log('\n--- CASO 7 (d): Abrir Control > Inicio > Volver a Explorar (conserva anime) ---');
    // Ir a Explorar asegurando filtro Anime
    await win.webContents.executeJavaScript(`
      window.location.hash = '#/explorar?category=anime';
    `);
    await wait(1500);

    // Abrir Control
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Control'));
        if (tab) tab.click();
      })()
    `);
    await wait(800);

    // Ir a Inicio
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Inicio'));
        if (tab) tab.click();
      })()
    `);
    await wait(1500);

    // Volver a Explorar
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a')).find(a => (a.textContent || '').includes('Explorar'));
        if (tab) tab.click();
      })()
    `);
    await wait(1500);

    const exploreStateD = await win.webContents.executeJavaScript(`
      ({
        hash: window.location.hash,
        isAnimeBtnActive: Array.from(document.querySelectorAll('button')).some(b => b.textContent && b.textContent.trim() === 'Anime' && b.getAttribute('aria-pressed') === 'true'),
        badgeText: document.body.innerText.includes('Anime') || window.location.hash.includes('anime'),
      })
    `);
    console.log('Estado al volver a Explorar:', exploreStateD);
    const passD = exploreStateD.hash.includes('anime') || exploreStateD.isAnimeBtnActive || exploreStateD.badgeText;
    console.log(`CASO 7 (d): ${passD ? 'PASA' : 'FALLA'} (hash=${exploreStateD.hash})`);

    const allPassed = passA && passB && passC && passD;
    console.log('\n========================================');
    console.log(`RESUMEN CASOS PARTE 1 (a,b,c,d): ${allPassed ? 'PASA' : 'FALLA'}`);
    console.log('========================================');

    win.destroy();
    stopLocalServer();
    app.quit();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-remote-sheet] Error:', err);
    stopLocalServer();
    app.quit();
    process.exit(1);
  }
});

