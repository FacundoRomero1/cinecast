#!/usr/bin/env node
/**
 * scripts/probe-episode-loaded.cjs
 * Verificación de PARTE 4 (El episodio pedido es el que carga):
 * (b) Con el proveedor simulado: tras cada forma de elegir un capítulo
 *     (selector del reproductor, jumpToEpisode desde el celular, siguiente y anterior,
 *      Maratón, "Continuar viendo"), la ruta que recibe el servidor de prueba (window.__req)
 *     coincide con T y E de los selectores y del título.
 * (c) Con ignoreep=1: la prueba confirma que la app pide el capítulo correcto aunque
 *     el proveedor muestre otro (defecto del proveedor externo) y la app muestra
 *     el aviso en "Grabar carga" y en la tarjeta del control.
 */

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const res = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const globalTimeout = setTimeout(() => {
  console.error('[probe-episode-loaded] TIMEOUT GLOBAL ALCANZADO (145s)');
  app.exit(1);
}, 145000);

function getAllFrames() {
  const frames = [];
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (wc.mainFrame && Array.isArray(wc.mainFrame.framesInSubtree)) {
        frames.push(...wc.mainFrame.framesInSubtree);
      }
    } catch (_) {}
  }
  return frames;
}

const withTimeout = (p, ms = 1500, fallback = null) =>
  Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);

app.whenReady().then(async () => {
  try {
    const initialHistory = [
      {
        id: 'tmdb-series-1396',
        mediaId: 'tmdb-series-1396',
        title: 'Breaking Bad',
        type: 'series',
        category: 'series',
        year: 2008,
        rating: 9.5,
        ratingBadge: 9.5,
        genres: ['Drama', 'Crimen'],
        posterUrl: 'https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeTitle: 'Piloto',
        currentTime: 10,
        duration: 1420,
        lastPlayed: Date.now() - 3600000,
        mediaItem: {
          id: 'tmdb-series-1396',
          tmdbId: 1396,
          title: 'Breaking Bad',
          type: 'series',
          category: 'series',
          year: 2008,
          rating: 9.5,
          genres: ['Drama', 'Crimen'],
          posterUrl: 'https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
        },
        episodeItem: {
          id: 'ep-1396-1-1',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Piloto',
          duration: '58m',
        },
      },
    ];

    testEnv = await startTestEnv('probe-episode-loaded', {
      initialHistory,
      env: { CINECAST_TEST: '1' }
    });

    const port = testEnv.port;
    const roomId = testEnv.roomId;
    const baseUrl = `http://127.0.0.1:${port}`;
    const preloadPath = path.join(__dirname, '../electron/preload.cjs');

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: '127.0.0.1', port }));
    safeHandle('get-diagnostic-mode', () => false);
    safeHandle('set-diagnostic-mode', () => false);
    safeHandle('get-no-cors-fix', () => false);
    safeHandle('check-embed-providers', () => []);
    safeHandle('focus-window', () => true);
    safeHandle('get-detected-tracks', () => null);
    safeHandle('set-master-volume', () => ({ ok: true }));
    safeHandle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
    safeHandle('simulate-play-click', () => true);
    safeHandle('set-player-servers', () => true);
    safeHandle('start-load-trace', () => ({ ok: true }));
    safeHandle('record-load-trace-event', () => ({ ok: true }));
    safeHandle('end-load-trace', () => true);

    safeHandle('get-real-media-state', async () => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await withTimeout(frame.executeJavaScript(`(() => {
            const v = window.__testVideo || window.__v || document.querySelector('video');
            if (!v) return null;
            return {
              found: true,
              currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
              duration: Number.isFinite(v.duration) ? v.duration : 0,
              readyState: v.readyState || 0,
              isPlaying: !v.paused,
              label: window.__req?.label || document.title || '',
            };
          })()`), 800, null);
          if (res && res.found) return res;
        } catch (_) {}
      }
      return null;
    });

    safeHandle('control-active-media', async (_event, { action, value }) => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await withTimeout(frame.executeJavaScript(`(() => {
            const v = window.__testVideo || window.__v || document.querySelector('video');
            if (!v) return { acted: false };
            if (${JSON.stringify(action)} === 'seek') {
              v.currentTime = Number(${JSON.stringify(value)}) || 0;
              return { acted: true, currentTime: v.currentTime };
            }
            if (${JSON.stringify(action)} === 'play') {
              v.play();
              return { acted: true, isPlaying: true };
            }
            if (${JSON.stringify(action)} === 'pause') {
              v.pause();
              return { acted: true, isPlaying: false };
            }
            return { acted: false };
          })()`), 800, { acted: false });
          if (res && res.acted) return res;
        } catch (_) {}
      }
      return { acted: false };
    });

    const testServersNormal = [
      {
        name: 'Servidor Simulado',
        urlTemplate: `${baseUrl}/__test/provider/tv/{id}/{season}/{episode}?label=Servidor+Simulado&dur=1420`
      }
    ];

    const testServersIgnoreEp = [
      {
        name: 'Servidor IgnoraEp',
        urlTemplate: `${baseUrl}/__test/provider/tv/{id}/{season}/{episode}?ignoreep=1&label=Servidor+IgnoraEp&dur=1420`
      }
    ];

    let currentTestServers = testServersNormal;

    const injectSetup = async (win, servers = currentTestServers) => {
      try {
        await win.webContents.executeJavaScript(`
          window.__CINECAST_TEST = true;
          window.__CINECAST_TEST_SERVERS = ${JSON.stringify(servers)};
          try {
            localStorage.setItem('cinecast_preferred_server', 'Servidor Simulado');
          } catch (_) {}
          true;
        `);
      } catch (_) {}
    };

    const screenWin = new BrowserWindow({
      width: 1024,
      height: 768,
      show: false,
      webPreferences: {
        partition: 'persist:probe-ep-screen-' + Date.now(),
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
      },
    });

    const remoteWin = new BrowserWindow({
      width: 420,
      height: 800,
      show: false,
      webPreferences: {
        partition: 'persist:probe-ep-remote-' + Date.now(),
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    screenWin.webContents.on('did-finish-load', () => {
      injectSetup(screenWin, currentTestServers);
    });

    screenWin.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 || msg.includes('Servidor') || msg.includes('stateSeq') || msg.includes('VideoPlayer') || msg.includes('Embed')) {
        console.log('[screen]', msg);
      }
    });

    remoteWin.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 || msg.includes('Servidor') || msg.includes('stateSeq') || msg.includes('selectServer')) {
        console.log('[remote]', msg);
      }
    });

    await screenWin.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
    await remoteWin.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);

    await injectSetup(screenWin, currentTestServers);

    console.log('[probe-episode-loaded] Esperando sincronización inicial...');
    await wait(3000);

    const getFrameReq = async () => {
      const frames = getAllFrames();
      for (const f of frames) {
        try {
          const req = await withTimeout(f.executeJavaScript('window.__req'), 500, null);
          if (req && typeof req.episode === 'number') {
            const reported = await withTimeout(f.executeJavaScript('window.__providerReportedEpisode'), 500, req.episode);
            return { ...req, reportedEpisode: reported };
          }
        } catch (_) {}
      }
      return null;
    };

    const getRemoteState = async () => {
      return await remoteWin.webContents.executeJavaScript(`
        (() => {
          const loadedEl = document.querySelector('[data-testid="remote-loaded-url"]');
          const warnEl = document.querySelector('[data-testid="remote-provider-warning"]');
          const headerEl = document.querySelector('h2');
          const epTextEl = document.querySelector('p.text-xs.font-semibold');
          return {
            title: headerEl ? headerEl.textContent.trim() : '',
            epText: epTextEl ? epTextEl.textContent.trim() : '',
            loadedUrlText: loadedEl ? loadedEl.textContent.trim() : '',
            hasWarning: Boolean(warnEl),
            warningText: warnEl ? warnEl.textContent.trim() : '',
          };
        })()
      `).catch(() => ({}));
    };

    const results = [];

    // ──────────────────────────────────────────────────────────────────────────
    // 1. FORMA 1: "Continuar viendo" (playDiscoveredMovie desde celular a PC)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: Continuar viendo (T1E1) ---');
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'playDiscoveredMovie',
          payload: {
            id: 'tmdb-series-1396',
            tmdbId: 1396,
            title: 'Breaking Bad',
            type: 'series',
            season: 1,
            episode: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            episodeTitle: 'Piloto',
            initialTime: 10,
            currentTime: 10,
            duration: 1420,
          }
        }, targetId);
      })()
    `);

    let t1Pass = false;
    let t1Frame = null;
    let t1Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t1Frame = await getFrameReq();
      t1Remote = await getRemoteState();
      if (
        t1Frame &&
        t1Frame.season === 1 &&
        t1Frame.episode === 1 &&
        t1Remote.epText?.includes('T1:E1') &&
        t1Remote.loadedUrlText?.includes('1/1')
      ) {
        t1Pass = true;
        break;
      }
    }

    results.push({
      forma: '1. Continuar viendo',
      esperado: 'T1:E1',
      frameReq: t1Frame ? `T${t1Frame.season}:E${t1Frame.episode}` : 'N/A',
      remoteCard: t1Remote?.epText || 'N/A',
      remoteLoadedUrl: t1Remote?.loadedUrlText || 'N/A',
      pass: t1Pass,
    });
    console.log(`[Forma 1] Continuar viendo: ${t1Pass ? 'PASA' : 'FALLA'} (Frame: T${t1Frame?.season}:E${t1Frame?.episode}, Remote: ${t1Remote?.epText}, URL: ${t1Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 2. FORMA 2: Selector del reproductor
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Selector del reproductor (cambio a E3) ---');
    await screenWin.webContents.executeJavaScript(`
      (() => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
          if (s.textContent.includes('E1')) {
            s.value = '3';
            s.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      })()
    `);

    let t2Pass = false;
    let t2Frame = null;
    let t2Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t2Frame = await getFrameReq();
      t2Remote = await getRemoteState();
      if (
        t2Frame &&
        t2Frame.season === 1 &&
        t2Frame.episode === 3 &&
        t2Remote.epText?.includes('T1:E3') &&
        t2Remote.loadedUrlText?.includes('1/3')
      ) {
        t2Pass = true;
        break;
      }
    }

    results.push({
      forma: '2. Selector reproductor',
      esperado: 'T1:E3',
      frameReq: t2Frame ? `T${t2Frame.season}:E${t2Frame.episode}` : 'N/A',
      remoteCard: t2Remote?.epText || 'N/A',
      remoteLoadedUrl: t2Remote?.loadedUrlText || 'N/A',
      pass: t2Pass,
    });
    console.log(`[Forma 2] Selector reproductor: ${t2Pass ? 'PASA' : 'FALLA'} (Frame: T${t2Frame?.season}:E${t2Frame?.episode}, Remote: ${t2Remote?.epText}, URL: ${t2Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 3. FORMA 3: jumpToEpisode desde el celular
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: jumpToEpisode desde celular (a T1E5) ---');
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'jumpToEpisode',
          payload: { season: 1, episode: 5 }
        }, targetId);
      })()
    `);

    let t3Pass = false;
    let t3Frame = null;
    let t3Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t3Frame = await getFrameReq();
      t3Remote = await getRemoteState();
      if (
        t3Frame &&
        t3Frame.season === 1 &&
        t3Frame.episode === 5 &&
        t3Remote.epText?.includes('T1:E5') &&
        t3Remote.loadedUrlText?.includes('1/5')
      ) {
        t3Pass = true;
        break;
      }
    }

    results.push({
      forma: '3. jumpToEpisode celular',
      esperado: 'T1:E5',
      frameReq: t3Frame ? `T${t3Frame.season}:E${t3Frame.episode}` : 'N/A',
      remoteCard: t3Remote?.epText || 'N/A',
      remoteLoadedUrl: t3Remote?.loadedUrlText || 'N/A',
      pass: t3Pass,
    });
    console.log(`[Forma 3] jumpToEpisode celular: ${t3Pass ? 'PASA' : 'FALLA'} (Frame: T${t3Frame?.season}:E${t3Frame?.episode}, Remote: ${t3Remote?.epText}, URL: ${t3Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 4. FORMA 4: Siguiente episodio (nextEpisode)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 4: Siguiente episodio (nextEpisode -> E6) ---');
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'nextEpisode'
        }, targetId);
      })()
    `);

    let t4Pass = false;
    let t4Frame = null;
    let t4Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t4Frame = await getFrameReq();
      t4Remote = await getRemoteState();
      if (
        t4Frame &&
        t4Frame.season === 1 &&
        t4Frame.episode === 6 &&
        t4Remote.epText?.includes('T1:E6') &&
        t4Remote.loadedUrlText?.includes('1/6')
      ) {
        t4Pass = true;
        break;
      }
    }

    results.push({
      forma: '4. Siguiente (nextEpisode)',
      esperado: 'T1:E6',
      frameReq: t4Frame ? `T${t4Frame.season}:E${t4Frame.episode}` : 'N/A',
      remoteCard: t4Remote?.epText || 'N/A',
      remoteLoadedUrl: t4Remote?.loadedUrlText || 'N/A',
      pass: t4Pass,
    });
    console.log(`[Forma 4] Siguiente episodio: ${t4Pass ? 'PASA' : 'FALLA'} (Frame: T${t4Frame?.season}:E${t4Frame?.episode}, Remote: ${t4Remote?.epText}, URL: ${t4Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 5. FORMA 5: Anterior episodio (prevEpisode)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Anterior episodio (prevEpisode -> E5) ---');
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'prevEpisode'
        }, targetId);
      })()
    `);

    let t5Pass = false;
    let t5Frame = null;
    let t5Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t5Frame = await getFrameReq();
      t5Remote = await getRemoteState();
      if (
        t5Frame &&
        t5Frame.season === 1 &&
        t5Frame.episode === 5 &&
        t5Remote.epText?.includes('T1:E5') &&
        t5Remote.loadedUrlText?.includes('1/5')
      ) {
        t5Pass = true;
        break;
      }
    }

    results.push({
      forma: '5. Anterior (prevEpisode)',
      esperado: 'T1:E5',
      frameReq: t5Frame ? `T${t5Frame.season}:E${t5Frame.episode}` : 'N/A',
      remoteCard: t5Remote?.epText || 'N/A',
      remoteLoadedUrl: t5Remote?.loadedUrlText || 'N/A',
      pass: t5Pass,
    });
    console.log(`[Forma 5] Anterior episodio: ${t5Pass ? 'PASA' : 'FALLA'} (Frame: T${t5Frame?.season}:E${t5Frame?.episode}, Remote: ${t5Remote?.epText}, URL: ${t5Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 6. FORMA 6: Maratón (avance automático)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: Maratón (avance automático) ---');
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'setMarathon',
          payload: true
        }, targetId);
      })()
    `);
    await wait(400);

    // En la pantalla, avanzamos con Maratón activo
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'nextEpisode'
        }, targetId);
      })()
    `);

    let t6Pass = false;
    let t6Frame = null;
    let t6Remote = null;

    for (let i = 0; i < 20; i++) {
      await wait(500);
      t6Frame = await getFrameReq();
      t6Remote = await getRemoteState();
      if (
        t6Frame &&
        t6Frame.season === 1 &&
        t6Frame.episode === 6 &&
        t6Remote.epText?.includes('T1:E6') &&
        t6Remote.loadedUrlText?.includes('1/6')
      ) {
        t6Pass = true;
        break;
      }
    }

    results.push({
      forma: '6. Maratón',
      esperado: 'T1:E6',
      frameReq: t6Frame ? `T${t6Frame.season}:E${t6Frame.episode}` : 'N/A',
      remoteCard: t6Remote?.epText || 'N/A',
      remoteLoadedUrl: t6Remote?.loadedUrlText || 'N/A',
      pass: t6Pass,
    });
    console.log(`[Forma 6] Maratón: ${t6Pass ? 'PASA' : 'FALLA'} (Frame: T${t6Frame?.season}:E${t6Frame?.episode}, Remote: ${t6Remote?.epText}, URL: ${t6Remote?.loadedUrlText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 7. PARTE 4 (c): Con ignoreep=1
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 7: ignoreep=1 (detección de defecto del proveedor) ---');
    currentTestServers = testServersIgnoreEp;
    await injectSetup(screenWin, testServersIgnoreEp);

    // Saltamos al episodio 4 desde el celular
    await remoteWin.webContents.executeJavaScript(`
      (() => {
        const targetId = window.__cinecastRuntime?.selectedScreenId || undefined;
        window.cinecastDeviceSync.sendCommand({
          action: 'jumpToEpisode',
          payload: { season: 1, episode: 4 }
        }, targetId);
      })()
    `);

    let t7Pass = false;
    let t7Frame = null;
    let t7Remote = null;

    for (let i = 0; i < 25; i++) {
      await wait(500);
      t7Frame = await getFrameReq();
      t7Remote = await getRemoteState();
      // Verificamos que la app pidió el capítulo 4 en la ruta (t7Frame.episode === 4),
      // pero el proveedor reportó 1 (t7Frame.reportedEpisode === 1),
      // y el celular muestra el cartel de advertencia.
      if (
        t7Frame &&
        t7Frame.season === 1 &&
        t7Frame.episode === 4 &&
        t7Frame.reportedEpisode === 1 &&
        t7Remote.hasWarning &&
        t7Remote.warningText?.includes('El proveedor podría no respetar el episodio pedido')
      ) {
        t7Pass = true;
        break;
      }
    }

    results.push({
      forma: '7. Proveedor ignoreep=1',
      esperado: 'Ruta E4 pero proveedor reporta E1 + Cartel advertencia',
      frameReq: t7Frame ? `Pedido: E${t7Frame.episode}, Proveedor: E${t7Frame.reportedEpisode}` : 'N/A',
      remoteCard: t7Remote?.warningText || 'Sin cartel',
      remoteLoadedUrl: t7Remote?.loadedUrlText || 'N/A',
      pass: t7Pass,
    });
    console.log(`[Forma 7] ignoreep=1: ${t7Pass ? 'PASA' : 'FALLA'} (Frame: Pedido E${t7Frame?.episode}/Reportado E${t7Frame?.reportedEpisode}, Aviso: ${t7Remote?.warningText})`);

    // ──────────────────────────────────────────────────────────────────────────
    // TABLA FINAL DE RESULTADOS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n=== RESULTADOS PARTE 4: EL EPISODIO PEDIDO ES EL QUE CARGA ===');
    console.log('| Forma de selección | Esperado | Ruta en proveedor (window.__req) | Celular (En pantalla) | Dirección real (host y ruta) | Resultado |');
    console.log('|---|---|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.forma} | ${r.esperado} | ${r.frameReq} | ${r.remoteCard} | ${r.remoteLoadedUrl} | **${r.pass ? 'PASA' : 'FALLA'}** |`);
    }

    const allPassed = results.every((r) => r.pass);
    console.log(`\nRESULTADO GLOBAL: ${allPassed ? 'PASA' : 'FALLA'}`);

    if (testEnv) await testEnv.stop();
    clearTimeout(globalTimeout);
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-episode-loaded] Error no capturado:', err);
    if (testEnv) await testEnv.stop();
    clearTimeout(globalTimeout);
    app.exit(1);
  }
});
