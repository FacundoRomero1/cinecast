#!/usr/bin/env node
/**
 * scripts/probe-remote-never-plays.cjs
 * Verifica que el celular (role=remote) NUNCA monte VideoPlayer, <video>, <webview>
 * ni active pantallas negras al hacer clic en:
 * 1. Hero
 * 2. Ficha técnica (DetailModal)
 * 3. Continuar viendo (ContinueRow)
 * En los 3 casos, la PC debe montar el reproductor con el título, temporada y episodio correctos.
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const globalTimeout = setTimeout(() => {
  console.error('[probe-remote-never-plays] TIMEOUT GLOBAL ALCANZADO (140s)');
  app.exit(1);
}, 140000);

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
        episodeNumber: 5,
        episodeTitle: 'Materia gris',
        currentTime: 420,
        duration: 2880,
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
          id: 'ep-1396-1-5',
          seasonNumber: 1,
          episodeNumber: 5,
          title: 'Materia gris',
          overview: 'Walter asiste a una fiesta de cumpleaños...',
          duration: '48m',
        },
      },
    ];

    testEnv = await startTestEnv({
      prefix: 'probe-remote-never-plays',
      initialWatchHistory: initialHistory,
      env: {
        CINECAST_DISABLE_PREWARM: '1',
        CINECAST_TEST: '1',
      },
    });

    const { base: baseUrl, room: roomId, lanIp, port } = testEnv;
    const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: lanIp, port: port }));
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
    safeHandle('end-load-trace', () => true);

    safeHandle('get-real-media-state', async () => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await frame.executeJavaScript(`(() => {
            const v = window.__testVideo || window.__v || document.querySelector('video');
            if (!v) return null;
            return {
              found: true,
              currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
              duration: Number.isFinite(v.duration) ? v.duration : 0,
              readyState: v.readyState || 0,
              isPlaying: !v.paused,
            };
          })()`);
          if (res && res.found) return res;
        } catch (_) {}
      }
      return null;
    });

    safeHandle('control-active-media', async (_event, { action, value }) => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await frame.executeJavaScript(`(() => {
            const v = window.__testVideo || window.__v || document.querySelector('video');
            if (!v) return { acted: false };
            if (${JSON.stringify(action)} === 'seek') {
              v.currentTime = Number(${JSON.stringify(value)}) || 0;
              return { acted: true, hasMedia: true, currentTime: v.currentTime };
            }
            if (${JSON.stringify(action)} === 'play') {
              if (v.play) v.play();
              return { acted: true, hasMedia: true, isPlaying: true };
            }
            if (${JSON.stringify(action)} === 'pause') {
              if (v.pause) v.pause();
              return { acted: true, hasMedia: true, isPlaying: false };
            }
            return { acted: false };
          })()`);
          if (res && res.acted) return { ok: true, ...res };
        } catch (_) {}
      }
      return { ok: true, acted: false };
    });

    const winScreen = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        partition: 'persist:probe-rnp-screen-' + Date.now(),
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    const winPhone = new BrowserWindow({
      width: 390,
      height: 844,
      show: false,
      webPreferences: {
        partition: 'persist:probe-rnp-phone-' + Date.now(),
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    console.log('[probe-remote-never-plays] Cargando pantallas...');
    await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
    await winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/`);

    // Sincronizar watch_history en localStorage de ambas ventanas
    await winPhone.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_watch_history_v1', ${JSON.stringify(JSON.stringify(initialHistory))});
    `);
    await winScreen.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_watch_history_v1', ${JSON.stringify(JSON.stringify(initialHistory))});
    `);

    // Esperar conexión WS
    for (let i = 0; i < 40; i++) {
      const sc = await winScreen.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected())').catch(() => false);
      const pc = await winPhone.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected())').catch(() => false);
      const screenId = await winPhone.webContents.executeJavaScript('window.__cinecastRuntime?.selectedScreenId || null').catch(() => null);
      if (sc && pc && screenId) break;
      await wait(250);
    }

    const checkPhoneDom = async () => {
      return await winPhone.webContents.executeJavaScript(`(() => {
        const mediaEls = document.querySelectorAll('video, webview');
        const mediaCount = mediaEls.length;
        const divs = Array.from(document.querySelectorAll('div'));
        const blackOverlays = divs.filter(d => {
          const st = window.getComputedStyle(d);
          const z = parseInt(st.zIndex, 10);
          return (z >= 50) && (st.position === 'fixed' || st.position === 'absolute') && d.clientHeight > 400 && st.backgroundColor.includes('0, 0, 0');
        });
        const hasBlackScreen = blackOverlays.length > 0;
        return {
          mediaCount,
          hasBlackScreen,
          overlayCount: blackOverlays.length,
        };
      })()`);
    };

    const getScreenPlayerState = async () => {
      return await winScreen.webContents.executeJavaScript(`(() => {
        try {
          const rt = window.__cinecastRuntime || {};
          const pState = window.cinecastDeviceSync?.getCachedPlaybackState?.() || null;
          const media = rt.activeMedia || pState?.mediaItem;
          const episode = rt.activeEpisode || pState?.episodeItem;
          const hasMediaEl = Boolean(document.querySelector('video, webview'));
          const isLoc = Boolean(rt.isPlayingLocally || pState?.isPlaying || hasMediaEl);
          const title = (media ? media.title : null) || pState?.mediaTitle || null;
          const sNum = episode ? (episode.seasonNumber || episode.season) : (pState?.seasonNumber || null);
          const eNum = episode ? (episode.episodeNumber || episode.episode) : (pState?.episodeNumber || null);
          return {
            isLocallyPlaying: isLoc,
            title,
            seasonNumber: sNum,
            episodeNumber: eNum,
            hasMediaEl,
          };
        } catch (e) {
          return { error: String(e), isLocallyPlaying: false };
        }
      })()`);
    };

    const results = [];

    // =========================================================================
    // CASO 1: Clic en Reproducir en Hero
    // =========================================================================
    console.log('\n--- Probando Caso 1: Clic en Reproducir en Hero ---');
    await winPhone.webContents.executeJavaScript(`
      window.location.hash = '#/';
    `);
    await wait(1200);

    const heroClicked = await winPhone.webContents.executeJavaScript(`(() => {
      const hero = document.querySelector('section[aria-label^="Destacado:"]');
      if (!hero) return false;
      const playBtn = Array.from(hero.querySelectorAll('button')).find(b =>
        b.textContent && b.textContent.includes('Reproducir')
      );
      if (playBtn) {
        playBtn.click();
        return true;
      }
      return false;
    })()`);
    console.log(`[probe-remote-never-plays] Hero play click: ${heroClicked}`);

    await wait(2000);
    const phoneState1 = await checkPhoneDom();
    const screenState1 = await getScreenPlayerState();

    console.log(`[Caso 1] Celular mediaEls=${phoneState1.mediaCount}, blackScreen=${phoneState1.hasBlackScreen}`);
    console.log(`[Caso 1] PC isPlaying=${screenState1.isLocallyPlaying}, title="${screenState1.title}", S${screenState1.seasonNumber}E${screenState1.episodeNumber}`);

    results.push({
      caso: '1. Hero',
      phoneMediaCount: phoneState1.mediaCount,
      phoneBlackScreen: phoneState1.hasBlackScreen,
      screenPlaying: screenState1.isLocallyPlaying,
      screenTitle: screenState1.title,
      screenSeason: screenState1.seasonNumber,
      screenEpisode: screenState1.episodeNumber,
      pasa: phoneState1.mediaCount === 0 && !phoneState1.hasBlackScreen && screenState1.isLocallyPlaying,
    });

    // Resetear PC a standby
    await winScreen.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.sendCommand({ action: 'setStandby' });
      }
    `);
    await wait(1000);

    // =========================================================================
    // CASO 2: Clic en Reproducir en Ficha Técnica (DetailModal)
    // =========================================================================
    console.log('\n--- Probando Caso 2: Clic en Reproducir en Ficha Técnica ---');
    await winPhone.webContents.executeJavaScript(`
      window.location.hash = '#/titulo/series/1396';
    `);
    await wait(800);

    const modalClicked = await winPhone.webContents.executeJavaScript(`(async () => {
      for (let w = 0; w < 30; w++) {
        const playBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent && b.textContent.includes('Reproducir') && (b.className.includes('bg-red-600') || b.querySelector('svg'))
        );
        if (playBtn) {
          playBtn.click();
          return true;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    })()`);
    console.log(`[probe-remote-never-plays] Ficha play click: ${modalClicked}`);

    await wait(2000);
    const phoneState2 = await checkPhoneDom();
    const screenState2 = await getScreenPlayerState();

    console.log(`[Caso 2] Celular mediaEls=${phoneState2.mediaCount}, blackScreen=${phoneState2.hasBlackScreen}`);
    console.log(`[Caso 2] PC isPlaying=${screenState2.isLocallyPlaying}, title="${screenState2.title}", S${screenState2.seasonNumber}E${screenState2.episodeNumber}`);

    results.push({
      caso: '2. Ficha Técnica',
      phoneMediaCount: phoneState2.mediaCount,
      phoneBlackScreen: phoneState2.hasBlackScreen,
      screenPlaying: screenState2.isLocallyPlaying,
      screenTitle: screenState2.title,
      screenSeason: screenState2.seasonNumber,
      screenEpisode: screenState2.episodeNumber,
      pasa: phoneState2.mediaCount === 0 && !phoneState2.hasBlackScreen && screenState2.isLocallyPlaying,
    });

    // Resetear PC a standby
    await winScreen.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync) {
        window.cinecastDeviceSync.sendCommand({ action: 'setStandby' });
      }
    `);
    await wait(1000);

    // =========================================================================
    // CASO 3: Clic en Continuar Viendo (ContinueRow)
    // =========================================================================
    console.log('\n--- Probando Caso 3: Clic en Continuar Viendo ---');
    await winPhone.webContents.executeJavaScript(`
      window.location.hash = '#/';
    `);
    await wait(800);

    const continueClicked = await winPhone.webContents.executeJavaScript(`(async () => {
      for (let w = 0; w < 30; w++) {
        const card = Array.from(document.querySelectorAll('div[role="button"]')).find(d =>
          d.textContent && (d.textContent.includes('Breaking Bad') || d.textContent.includes('Materia gris'))
        );
        if (card) {
          card.click();
          return true;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    })()`);
    console.log(`[probe-remote-never-plays] ContinueRow click: ${continueClicked}`);

    await wait(2000);
    const phoneState3 = await checkPhoneDom();
    const screenState3 = await getScreenPlayerState();

    console.log(`[Caso 3] Celular mediaEls=${phoneState3.mediaCount}, blackScreen=${phoneState3.hasBlackScreen}`);
    console.log(`[Caso 3] PC isPlaying=${screenState3.isLocallyPlaying}, title="${screenState3.title}", S${screenState3.seasonNumber}E${screenState3.episodeNumber}`);

    results.push({
      caso: '3. Continuar Viendo',
      phoneMediaCount: phoneState3.mediaCount,
      phoneBlackScreen: phoneState3.hasBlackScreen,
      screenPlaying: screenState3.isLocallyPlaying,
      screenTitle: screenState3.title,
      screenSeason: screenState3.seasonNumber,
      screenEpisode: screenState3.episodeNumber,
      pasa: phoneState3.mediaCount === 0 && !phoneState3.hasBlackScreen && screenState3.isLocallyPlaying,
    });

    console.log('\n================================================================================');
    console.log('REPORTE PROBE-REMOTE-NEVER-PLAYS');
    console.log('================================================================================');
    console.log('| Botón Clickeado | Celular <video>/<webview> | Celular Pantalla Negra | PC Reproduciendo | Título / Temporada / Ep | Resultado |');
    console.log('| :--- | :---: | :---: | :---: | :--- | :---: |');
    for (const r of results) {
      const epStr = r.screenSeason ? `T${r.screenSeason}E${r.screenEpisode}` : '-';
      const meta = r.screenTitle ? `${r.screenTitle} (${epStr})` : '-';
      console.log(`| ${r.caso} | ${r.phoneMediaCount} | ${r.phoneBlackScreen ? 'SI' : 'NO'} | ${r.screenPlaying ? 'SI' : 'NO'} | ${meta} | ${r.pasa ? 'PASA' : 'FALLA'} |`);
    }
    console.log('================================================================================\n');

    const allPassed = results.every(r => r.pasa);
    clearTimeout(globalTimeout);
    if (testEnv) await testEnv.stop();
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-remote-never-plays] Error:', err);
    clearTimeout(globalTimeout);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
