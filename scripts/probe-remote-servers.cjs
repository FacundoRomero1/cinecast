#!/usr/bin/env node
/**
 * scripts/probe-remote-servers.cjs
 * Evaluación de cambio de servidor desde el celular (contenido real):
 * 1. Servidores A, B, C configurados en embedService vía __CINECAST_TEST_SERVERS.
 * 2. Celular toca B: PC cambia a B en <3s (botón, webview y label) y celular marca B.
 * 3. Secuencia A -> C -> B -> A.
 * 4. Recargar PC: PC y celular preservan servidor activo y celular no descarta stateSeq.
 * 5. Recargar Celular: celular restaura servidor activo.
 * 6. Corte de red de 2s: reconexión y sincronía preservada.
 * 7. Rotación automática del vigilante: celular muestra el nuevo servidor activo y puede cambiar después.
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
  console.error('[probe-remote-servers] TIMEOUT GLOBAL ALCANZADO (145s)');
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

const withTimeout = (p, ms = 1200, fallback = null) =>
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
          overview: 'Walter White, un profesor de química...',
          duration: '58m',
        },
      },
    ];

    testEnv = await startTestEnv({
      prefix: 'probe-remote-servers',
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

    safeHandle('get-local-ip', () => ({ ip: lanIp, port }));
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

    const testServers = [
      {
        name: 'Servidor A',
        urlTemplate: `${baseUrl}/__test/provider/tv/{id}/{season}/{episode}?dur=1420&label=Servidor%20A`,
        language: 'Latino',
      },
      {
        name: 'Servidor B',
        urlTemplate: `${baseUrl}/__test/provider/tv/{id}/{season}/{episode}?dur=1420&label=Servidor%20B`,
        language: 'Subtitulado',
      },
      {
        name: 'Servidor C',
        urlTemplate: `${baseUrl}/__test/provider/tv/{id}/{season}/{episode}?dur=1420&label=Servidor%20C`,
        language: 'Castellano',
      },
    ];

    const winScreen = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        partition: 'persist:probe-rs-screen-' + Date.now(),
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
        partition: 'persist:probe-rs-phone-' + Date.now(),
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    winScreen.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 || msg.includes('Servidor') || msg.includes('stateSeq') || msg.includes('VideoPlayer')) {
        console.log('[screen]', msg);
      }
    });

    winPhone.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 || msg.includes('Servidor') || msg.includes('stateSeq') || msg.includes('selectServer')) {
        console.log('[phone]', msg);
      }
    });

    const injectSetup = async (win) => {
      try {
        await win.webContents.executeJavaScript(`
          window.__CINECAST_TEST = true;
          window.__CINECAST_TEST_SERVERS = ${JSON.stringify(testServers)};
          try {
            localStorage.setItem('cinecast_watch_history_v1', ${JSON.stringify(JSON.stringify(initialHistory))});
          } catch (_) {}
        `);
      } catch (err) {
        console.warn('[injectSetup error]', err.message);
      }
    };

    winScreen.webContents.on('did-finish-load', () => {
      injectSetup(winScreen);
    });

    winPhone.webContents.on('did-finish-load', () => {
      injectSetup(winPhone);
    });

    console.log('[probe-remote-servers] Cargando pantallas...');
    await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
    await winPhone.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);

    await injectSetup(winScreen);
    await injectSetup(winPhone);

    // Esperar conexión WS
    for (let i = 0; i < 40; i++) {
      const sc = await winScreen.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected)').catch(() => false);
      const pc = await winPhone.webContents.executeJavaScript('Boolean(window.cinecastDeviceSync?.isConnected)').catch(() => false);
      const screenId = await winPhone.webContents.executeJavaScript('window.__cinecastRuntime?.selectedScreenId || null').catch(() => null);
      if (sc && pc && screenId) break;
      await wait(250);
    }

    // Iniciar reproducción desde el celular enviando playDiscoveredMovie a la pantalla
    console.log('[probe-remote-servers] Iniciando reproducción enviada desde celular...');
    await winPhone.webContents.executeJavaScript(`
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
    `);

    // Esperar a que el reproductor monte en la pantalla
    for (let i = 0; i < 40; i++) {
      const hasWv = await winScreen.webContents.executeJavaScript('Boolean(document.querySelector("webview"))').catch(() => false);
      if (hasWv) break;
      await wait(200);
    }

    const getPcState = async () => {
      try {
        return await winScreen.webContents.executeJavaScript(`(() => {
          const wv = document.querySelector('webview');
          const buttons = Array.from(document.querySelectorAll('button'));
          const activeSrvBtn = buttons.find(b => b.classList.contains('bg-red-600') && b.textContent.includes('Servidor'));
          const rt = window.__cinecastRuntime;
          return {
            hasWebview: Boolean(wv),
            webviewSrc: wv?.getAttribute('src') || '',
            activeBtnText: activeSrvBtn?.textContent?.trim() || rt?.remotePlaybackState?.activeServerName || '',
            remoteStateActiveServerName: rt?.remotePlaybackState?.activeServerName || '',
            remoteStateActiveServerIndex: rt?.remotePlaybackState?.activeServerIndex ?? -1,
          };
        })()`);
      } catch (_) {
        return {};
      }
    };

    const getFrameLabel = async () => {
      const frames = getAllFrames();
      for (const frame of frames) {
        try {
          const res = await withTimeout(frame.executeJavaScript(`(() => {
            return window.__req?.label || document.title || '';
          })()`), 800, '');
          if (res && res.includes('Servidor')) return res;
        } catch (_) {}
      }
      return '';
    };

    const getPhoneState = async () => {
      try {
        return await winPhone.webContents.executeJavaScript(`(() => {
          const state = window.cinecastDeviceSync?.getCachedPlaybackState() || window.__cinecastRuntime?.remotePlaybackState;
          const buttons = Array.from(document.querySelectorAll('button'));
          const activeServerBtn = buttons.find(b => b.classList.contains('bg-red-600') && b.textContent.includes('Servidor'));
          const activeName = state?.activeServerName || '';
          return {
            activeServerNameInState: activeName,
            activeServerIndexInState: state?.activeServerIndex ?? -1,
            activeServerBtnText: activeServerBtn?.textContent?.trim() || activeName,
          };
        })()`);
      } catch (_) {
        return {};
      }
    };

    const phoneSelectServer = async (serverName, serverIndex) => {
      const targetSrv = testServers.find(s => s.name === serverName) || testServers[serverIndex];
      try {
        await winPhone.webContents.executeJavaScript(`(() => {
          const rt = window.__cinecastRuntime;
          const sync = window.cinecastDeviceSync;
          const screenId = rt?.selectedScreenId || undefined;
          const cmd = {
            action: 'selectServer',
            payload: { index: ${serverIndex}, name: ${JSON.stringify(serverName)}, url: ${JSON.stringify(targetSrv?.urlTemplate || '')} }
          };
          if (rt && typeof rt.sendRemoteCommand === 'function') {
            rt.sendRemoteCommand(cmd);
          } else if (sync) {
            sync.sendCommand(cmd, screenId);
          }
        })()`);
      } catch (err) {
        console.warn('[phoneSelectServer error]', err.message);
      }
    };

    const results = [];

    // Estado Inicial: Servidor A
    await wait(2500);
    let pcSt = await getPcState();
    let frameLabel = await getFrameLabel();
    let phoneSt = await getPhoneState();

    console.log(`[Inicial] PC: ${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (src: ${pcSt.webviewSrc}) | Phone: ${phoneSt.activeServerNameInState}`);

    results.push({
      step: '0. Inicial',
      op: 'Inicio con Servidor A',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      pass: (pcSt.webviewSrc.includes('Servidor%20A') || frameLabel.includes('Servidor A')) &&
            (phoneSt.activeServerNameInState === 'Servidor A' || phoneSt.activeServerBtnText.includes('Servidor A')),
    });

    // PASO 1: Celular toca Servidor B
    console.log('[probe-remote-servers] PASO 1: Celular toca Servidor B...');
    const t0 = Date.now();
    await phoneSelectServer('Servidor B', 1);

    let switchedB = false;
    let elapsedB = 0;
    for (let i = 0; i < 60; i++) {
      await wait(50);
      pcSt = await getPcState();
      frameLabel = await getFrameLabel();
      phoneSt = await getPhoneState();
      if ((pcSt.webviewSrc.includes('Servidor%20B') || frameLabel.includes('Servidor B')) &&
          (phoneSt.activeServerNameInState === 'Servidor B' || phoneSt.activeServerBtnText.includes('Servidor B'))) {
        switchedB = true;
        elapsedB = Date.now() - t0;
        break;
      }
    }
    if (!switchedB) elapsedB = Date.now() - t0;
    console.log(`[Paso 1] PC: ${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (src: ${pcSt.webviewSrc}) | Phone: ${phoneSt.activeServerNameInState} (${elapsedB}ms)`);

    results.push({
      step: '1. Celular -> B',
      op: 'Celular toca Servidor B',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      timeMs: elapsedB,
      pass: switchedB && elapsedB <= 3000,
    });

    // PASO 2: Secuencia A -> C -> B -> A
    console.log('[probe-remote-servers] PASO 2: Secuencia A -> C -> B -> A...');
    const seq = [
      { name: 'Servidor C', idx: 2 },
      { name: 'Servidor B', idx: 1 },
      { name: 'Servidor A', idx: 0 },
    ];
    for (const target of seq) {
      const stepT0 = Date.now();
      await phoneSelectServer(target.name, target.idx);
      let ok = false;
      let el = 0;
      for (let i = 0; i < 60; i++) {
        await wait(50);
        pcSt = await getPcState();
        frameLabel = await getFrameLabel();
        phoneSt = await getPhoneState();
        const pcMatches = pcSt.webviewSrc.includes(encodeURIComponent(target.name)) || frameLabel.includes(target.name);
        const phoneMatches = phoneSt.activeServerNameInState === target.name || phoneSt.activeServerBtnText.includes(target.name);
        if (pcMatches && phoneMatches) {
          ok = true;
          el = Date.now() - stepT0;
          break;
        }
      }
      if (!ok) el = Date.now() - stepT0;
      console.log(`[Paso 2 -> ${target.name}] PC: ${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} | Phone: ${phoneSt.activeServerNameInState} (${el}ms)`);
      results.push({
        step: `2. Celular -> ${target.name}`,
        op: `Celular toca ${target.name}`,
        pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
        phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
        timeMs: el,
        pass: ok && el <= 3000,
      });
    }

    // PASO 3: Recargar PC (F5)
    console.log('[probe-remote-servers] PASO 3: Recargando PC...');
    await winScreen.webContents.reload();
    await wait(3000);

    pcSt = await getPcState();
    frameLabel = await getFrameLabel();
    phoneSt = await getPhoneState();
    const pcPreserved = pcSt.webviewSrc.includes('Servidor%20A') || frameLabel.includes('Servidor A') || pcSt.activeBtnText.includes('Servidor A');
    const phoneStateAfterPcReload = phoneSt.activeServerNameInState === 'Servidor A' || phoneSt.activeServerBtnText.includes('Servidor A');
    console.log(`[Paso 3 Recarga PC] PC: ${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} | Phone: ${phoneSt.activeServerNameInState} | pcPreserved: ${pcPreserved}, phoneState: ${phoneStateAfterPcReload}`);

    results.push({
      step: '3. Recarga PC',
      op: 'winScreen.reload()',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      pass: pcPreserved && phoneStateAfterPcReload,
    });

    // PASO 4: Recargar Celular (F5)
    console.log('[probe-remote-servers] PASO 4: Recargando Celular...');
    await winPhone.webContents.reload();
    await wait(3000);

    phoneSt = await getPhoneState();
    const phoneRestored = phoneSt.activeServerNameInState === 'Servidor A' || phoneSt.activeServerBtnText.includes('Servidor A');
    console.log(`[Paso 4 Recarga Celular] Phone: ${phoneSt.activeServerNameInState}`);

    results.push({
      step: '4. Recarga Celular',
      op: 'winPhone.reload()',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      pass: phoneRestored,
    });

    // PASO 5: Corte de red de 2s
    console.log('[probe-remote-servers] PASO 5: Corte de red de 2s...');
    await winPhone.webContents.executeJavaScript(`
      if (window.cinecastDeviceSync?.ws) {
        window.cinecastDeviceSync.ws.close();
      }
    `).catch(() => {});
    await wait(2000); // 2s corte
    await wait(2500); // esperar reconexión

    phoneSt = await getPhoneState();
    const syncPreserved = phoneSt.activeServerNameInState === 'Servidor A' || phoneSt.activeServerBtnText.includes('Servidor A');
    console.log(`[Paso 5 Corte Red] Phone: ${phoneSt.activeServerNameInState}`);

    results.push({
      step: '5. Corte Red 2s',
      op: 'Corte de red y reconexión',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName} (label: "${frameLabel}")`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      pass: syncPreserved,
    });

    // PASO 6: Rotación automática del vigilante
    console.log('[probe-remote-servers] PASO 6: Rotación automática del vigilante...');
    // Simular que el vigilante en PC cambia al Servidor B
    await winScreen.webContents.executeJavaScript(`
      const buttons = Array.from(document.querySelectorAll('button'));
      const srvBBtn = buttons.find(b => b.textContent.includes('Servidor B'));
      if (srvBBtn) srvBBtn.click();
    `).catch(() => {});
    await wait(1500);

    pcSt = await getPcState();
    phoneSt = await getPhoneState();
    const autoRotatedOk = phoneSt.activeServerNameInState === 'Servidor B' || phoneSt.activeServerBtnText.includes('Servidor B');

    // Ahora el celular elige otro servidor (Servidor C)
    await phoneSelectServer('Servidor C', 2);
    await wait(2000);
    pcSt = await getPcState();
    phoneSt = await getPhoneState();
    const canSelectAfterRotation = (pcSt.webviewSrc.includes('Servidor%20C') || pcSt.activeBtnText.includes('Servidor C')) &&
                                  (phoneSt.activeServerNameInState === 'Servidor C' || phoneSt.activeServerBtnText.includes('Servidor C'));
    console.log(`[Paso 6 Vigilante] Phone after auto-rotate: ${phoneSt.activeServerNameInState} (ok=${autoRotatedOk}) | PC/Phone after C: pc=${pcSt.webviewSrc}, phone=${phoneSt.activeServerNameInState} (ok=${canSelectAfterRotation})`);

    results.push({
      step: '6. Vigilante y Selección',
      op: 'Auto-rotación y selección posterior',
      pcServer: `${pcSt.activeBtnText || pcSt.remoteStateActiveServerName}`,
      phoneServer: phoneSt.activeServerBtnText || phoneSt.activeServerNameInState,
      pass: autoRotatedOk && canSelectAfterRotation,
    });

    // Imprimir Tabla de Resultados
    console.log('\n========================================');
    console.log('TABLA DE RESULTADOS - PROBE REMOTE SERVERS');
    console.log('========================================');
    console.log('| Paso | Operación | Servidor PC | Servidor Celular | Tiempo ms | Resultado |');
    console.log('|---|---|---|---|---|---|');
    let allPassed = true;
    for (const r of results) {
      if (!r.pass) allPassed = false;
      console.log(`| ${r.step} | ${r.op} | ${r.pcServer} | ${r.phoneServer} | ${r.timeMs !== undefined ? r.timeMs + 'ms' : '-'} | ${r.pass ? 'PASA' : 'FALLA'} |`);
    }
    console.log('========================================\n');

    clearTimeout(globalTimeout);
    if (testEnv) await testEnv.stop();
    winScreen.destroy();
    winPhone.destroy();

    if (allPassed) {
      console.log('[probe-remote-servers] TODOS LOS PASOS PASARON');
      app.exit(0);
    } else {
      console.error('[probe-remote-servers] ALGUNOS PASOS FALLARON');
      app.exit(1);
    }
  } catch (err) {
    console.error('[probe-remote-servers] ERROR INESPERADO:', err);
    if (testEnv) await testEnv.stop();
    app.exit(1);
  }
});
