const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const express = require('express');
const { createApp, attachWebSocket } = require('../electron/core.cjs');

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
  attachWebSocket(internalServer);
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
let simulatedSec = 0;
ipcMain.handle('get-real-media-state', () => {
  simulatedSec++;
  console.log(`[IPC] get-real-media-state called: sec=${simulatedSec}`);
  return {
    found: true,
    isPlaying: true,
    currentTime: simulatedSec,
    duration: 1400,
  };
});
ipcMain.handle('focus-window', () => true);
ipcMain.handle('send-native-key', () => true);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    await ensureServerReady();
    console.log(`[probe-history-diagnostic] Servidor en ${baseUrl}`);

    const winPC = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: 'persist:pc_tester_hist',
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    });

    winPC.webContents.on('console-message', (_e, _lvl, msg) => {
      console.log('[PC LOG]', msg);
    });

    const winMobile = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        partition: 'persist:mobile_tester_hist',
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    });

    console.log('[probe-history-diagnostic] Inicializando PC...');
    await winPC.loadURL(`${baseUrl}/?ui=nuevo&role=screen#/`);
    await winPC.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_device_id', 'dev_pc_screen_hist');
    `);
    await wait(2000);

    console.log('[probe-history-diagnostic] Inicializando Móvil...');
    await winMobile.loadURL(`${baseUrl}/?ui=nuevo&role=remote#/control`);
    await winMobile.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_device_id', 'dev_mobile_remote_hist');
    `);
    await wait(2000);

    // =========================================================================
    // Prueba diagnóstica: Celular transmite a PC Black Clover T2E10 -> esperar 25s
    // =========================================================================
    console.log('\n--- Transmitiendo Black Clover T2E10 desde Móvil a PC ---');
    await winMobile.webContents.executeJavaScript(`
      fetch('/api/sync/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: 'cine-home-1',
          fromDevice: 'dev_mobile_remote_hist',
          command: {
            action: 'playDiscoveredMovie',
            payload: {
              id: 'black-clover-73223',
              tmdbId: 73223,
              title: 'Black Clover',
              type: 'series',
              category: 'anime',
              seasonNumber: 2,
              episodeNumber: 10,
              episode: {
                id: 'ep-black-clover-s2-e10',
                seasonNumber: 2,
                episodeNumber: 10,
                title: 'Desesperación contra esperanza'
              },
              posterUrl: 'https://image.tmdb.org/t/p/w500/test.jpg'
            }
          }
        })
      });
    `);

    await wait(3000);
    const pcCheck = await winPC.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        return {
          textSnippet: text.slice(0, 300).replace(/\\s+/g, ' '),
          hasVideoPlayer: Boolean(document.querySelector('iframe, video')),
        };
      })()
    `);
    console.log('PC tras playDiscoveredMovie:', pcCheck);

    console.log('Esperando 25 segundos para acumular progreso en VideoPlayer (guarda cada 4s tras t>15s)...');
    for (let sec = 5; sec <= 25; sec += 5) {
      await wait(5000);
      process.stdout.write(`...${sec}s `);
    }
    console.log('\n25 segundos completados.');

    // 1. Leer /api/watch-history desde el servidor
    const serverHistoryRes = await fetch(`${baseUrl}/api/watch-history`);
    const serverData = await serverHistoryRes.json();
    const serverItems = Array.isArray(serverData.items) ? serverData.items : [];
    const serverBlackClover = serverItems.filter(
      (it) => (it.title && it.title.includes('Black Clover')) || it.mediaId === 'black-clover-73223' || (it.id && it.id.includes('73223'))
    );

    console.log('\n--- RESULTADOS DEL SERVIDOR (/api/watch-history) ---');
    console.log(`Total ítems en servidor: ${serverItems.length}`);
    console.log(`Total entradas Black Clover en servidor: ${serverBlackClover.length}`);
    console.log('Detalle entradas Black Clover servidor:');
    serverBlackClover.forEach((it, idx) => {
      console.log(`  [${idx + 1}] id: ${it.id}, s:${it.seasonNumber}, e:${it.episodeNumber}, time:${it.currentTime}s, last:${it.lastWatchedAt}`);
    });

    // 2. Leer localStorage en PC
    const pcStorage = await winPC.webContents.executeJavaScript(`
      (() => {
        try {
          const raw = localStorage.getItem('cinecast_watch_progress_v2');
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })()
    `);
    const pcBlackClover = pcStorage.filter(
      (it) => (it.title && it.title.includes('Black Clover')) || it.mediaId === 'black-clover-73223' || (it.id && it.id.includes('73223'))
    );

    console.log('\n--- RESULTADOS EN PC (localStorage cinecast_watch_progress_v2) ---');
    console.log(`Total ítems en PC: ${pcStorage.length}`);
    console.log(`Total entradas Black Clover en PC: ${pcBlackClover.length}`);
    pcBlackClover.forEach((it, idx) => {
      console.log(`  [${idx + 1}] id: ${it.id}, s:${it.seasonNumber}, e:${it.episodeNumber}, time:${it.currentTime}s, last:${it.lastWatchedAt}`);
    });

    // 3. Leer localStorage en Móvil
    const mobileStorage = await winMobile.webContents.executeJavaScript(`
      (() => {
        try {
          const raw = localStorage.getItem('cinecast_watch_progress_v2');
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })()
    `);
    const mobileBlackClover = mobileStorage.filter(
      (it) => (it.title && it.title.includes('Black Clover')) || it.mediaId === 'black-clover-73223' || (it.id && it.id.includes('73223'))
    );

    console.log('\n--- RESULTADOS EN MÓVIL (localStorage cinecast_watch_progress_v2) ---');
    console.log(`Total ítems en Móvil: ${mobileStorage.length}`);
    console.log(`Total entradas Black Clover en Móvil: ${mobileBlackClover.length}`);
    mobileBlackClover.forEach((it, idx) => {
      console.log(`  [${idx + 1}] id: ${it.id}, s:${it.seasonNumber}, e:${it.episodeNumber}, time:${it.currentTime}s, last:${it.lastWatchedAt}`);
    });

    console.log('\n--- DIAGNÓSTICO FINAL ---');
    const hasDuplicatesServer = serverBlackClover.length > 1;
    const hasDuplicatesPC = pcBlackClover.length > 1;
    const latestBC = serverBlackClover[0] || pcBlackClover[0];
    const correctTmdb = latestBC && (latestBC.mediaItem?.tmdbId === 73223 || latestBC.id?.includes('73223') || latestBC.mediaId?.includes('73223'));
    const hasUnsplash = JSON.stringify(serverItems).includes('unsplash.com');
    const correctSeasonEp = latestBC && latestBC.seasonNumber === 2 && (latestBC.episodeNumber === 7 || latestBC.episodeNumber === 10);

    console.log(`¿Duplicados en servidor?: ${hasDuplicatesServer ? 'SÍ ⚠️' : 'NO ✅'}`);
    console.log(`¿Duplicados en PC?: ${hasDuplicatesPC ? 'SÍ ⚠️' : 'NO ✅'}`);
    console.log(`¿TMDB ID correcto (73223)?: ${correctTmdb ? 'SÍ ✅' : 'NO ❌'}`);
    console.log(`¿Temporada y episodio más avanzado retenido (T2E7/T2E10)?: ${correctSeasonEp ? 'SÍ ✅' : 'NO ❌'}`);
    console.log(`¿Imágenes Unsplash eliminadas?: ${!hasUnsplash ? 'SÍ ✅' : 'NO ❌'}`);

  } catch (err) {
    console.error('[probe-history-diagnostic] Error:', err);
    exitCode = 1;
  } finally {
    stopLocalServer();
    app.exit(exitCode);
  }
});

