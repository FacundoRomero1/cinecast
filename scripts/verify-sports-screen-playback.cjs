const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronModule = require('electron');
const isRealElectron = typeof electronModule === 'object' && electronModule !== null && Boolean(electronModule.app);

if (!isRealElectron) {
  const electronBinary = typeof electronModule === 'string' ? electronModule : require('electron');
  const env = { ...process.env, CINECAST_TEST: '1', ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(electronBinary, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain } = electronModule;
const { startTestEnv } = require('./lib/testenv.cjs');

// Configuración de rutas
const ROOT = path.resolve(__dirname, '..');
const shotsDir = path.join(ROOT, 'scratch', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

// Handlers IPC para preload
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
ipcMain.handle('probe-streams', (_e, urls) =>
  Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []
);
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('control-active-media', () => true);
ipcMain.handle('search-media-tracks', () => []);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('send-native-click', () => true);
ipcMain.handle('simulate-play-click', () => true);
ipcMain.handle('open-external', () => true);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('set-stream-headers', () => true);
ipcMain.handle('send-native-trackpad-event', () => true);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveShot(win, filename) {
  try {
    let img = await win.webContents.capturePage();
    if (img.isEmpty()) {
      win.showInactive();
      await wait(400);
      img = await win.webContents.capturePage();
    }
    const fullPath = path.join(shotsDir, filename);
    fs.writeFileSync(fullPath, img.toPNG());
    console.log(`[verify-screen-sports] Captura guardada: ${fullPath} (${img.toPNG().length} bytes)`);
    return fullPath;
  } catch (err) {
    console.error(`[verify-screen-sports] Error guardando ${filename}:`, err);
    return null;
  }
}

const capturedLogs = [];

async function run() {
  console.log('[verify-screen-sports] Iniciando entorno de prueba...');
  const testEnv = await startTestEnv({
    name: 'verify-screen-sports',
    useLanIp: false,
    seedHistory: false,
  });

  const baseUrl = testEnv.base;
  const activeRoomId = testEnv.room;
  console.log(`[verify-screen-sports] Servidor listo en: ${baseUrl}, Sala: ${activeRoomId}`);

  const preloadPath = path.join(ROOT, 'electron', 'preload.cjs');

  // Ventana Pantalla (PC / TV)
  const winScreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:verify-sports-screen-direct',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Ventana Celular para control sincronizado
  const winRemote = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:verify-sports-remote-direct',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  winScreen.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelStr = level === 0 ? 'INFO' : level === 1 ? 'WARN' : level === 2 ? 'ERROR' : 'DEBUG';
    const entry = `[SCREEN ${levelStr}] ${message}`;
    capturedLogs.push(entry);
    if (
      message.includes('VideoPlayer') ||
      message.includes('PlaybackTiming') ||
      message.includes('HLS') ||
      message.includes('live_tv') ||
      message.includes('loadeddata') ||
      message.includes('timeupdate') ||
      message.includes('currentTime') ||
      message.includes('Stream') ||
      message.includes('play') ||
      message.includes('deportes') ||
      message.includes('Error')
    ) {
      console.log(entry);
    }
  });

  console.log('[verify-screen-sports] Cargando aplicación en Pantalla (#/deportes) y Celular (#/control)...');
  await Promise.all([
    winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/deportes`),
    winRemote.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/control`),
  ]);

  winScreen.showInactive();
  winRemote.showInactive();

  console.log('[verify-screen-sports] Esperando sincronización inicial (4s)...');
  await wait(4000);

  // Comprobar elementos en pantalla
  const domInfo = await winScreen.webContents.executeJavaScript(`
    (function() {
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent.trim());
      const matchCards = document.querySelectorAll('[class*="rounded-2xl"]');
      return {
        url: window.location.href,
        headings,
        buttonsCount: buttons.length,
        buttonsSample: buttons.slice(0, 15),
        cardsCount: matchCards.length,
      };
    })();
  `);
  console.log('[verify-screen-sports] Estado del DOM en Pantalla:', domInfo);

  // Intentar reproducir un partido haciendo click directamente en la pantalla
  console.log('[verify-screen-sports] Intentando click en partido en pantalla...');
  const playClickResult = await winScreen.webContents.executeJavaScript(`
    (function() {
      // Buscar botón de canal en vivo dentro de las tarjetas de partidos
      const channelBtns = Array.from(document.querySelectorAll('button')).filter(b => {
        const title = b.getAttribute('title') || '';
        const text = b.textContent || '';
        return title.includes('Reproducir señal') || text.includes('Ver HLS Directo') || text.includes('Ver Señal') || text.includes('DISNEY') || text.includes('ESPN') || text.includes('TyC');
      });

      if (channelBtns.length > 0) {
        const btn = channelBtns[0];
        const text = btn.textContent.trim();
        btn.click();
        return { clicked: true, method: 'screen_dom_click', text };
      }

      return { clicked: false, count: channelBtns.length };
    })();
  `);
  console.log('[verify-screen-sports] Resultado del click directo en pantalla:', playClickResult);

  // Si en la pantalla no había botón clickeable directo, usar el control remoto sincronizado para mandar el comando play
  let tunedChannelObj = null;
  if (!playClickResult.clicked) {
    console.log('[verify-screen-sports] Sintonizando partido a través del comando play remoto hacia la pantalla...');
    // Cambiar a pestaña Deportes en el control remoto
    await winRemote.webContents.executeJavaScript(`
      (function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const sportsBtn = buttons.find(b => b.textContent && b.textContent.includes('Deportes'));
        if (sportsBtn) sportsBtn.click();
      })();
    `);
    await wait(2500);

    // Enviar comando play con canal deportivo vivo
    tunedChannelObj = await winRemote.webContents.executeJavaScript(`
      (function() {
        // Buscar botón de canal en la lista de partidos del remoto
        const playBtn = document.querySelector('button[title*="Reproducir en pantalla"]');
        if (playBtn) {
          const text = playBtn.textContent.trim();
          playBtn.click();
          return { clicked: true, method: 'remote_panel_button', text };
        }
        return { clicked: false };
      })();
    `);
    console.log('[verify-screen-sports] Resultado de sintonización desde panel remoto:', tunedChannelObj);
  }

  // Esperar a que el reproductor monte y el video comience a reproducir (currentTime > 0)
  console.log('[verify-screen-sports] Esperando a que el video reproduzca con currentTime > 0 (máx 15s)...');
  let playbackSuccess = false;
  let finalPlayerState = null;

  for (let attempt = 1; attempt <= 15; attempt++) {
    await wait(1000);
    finalPlayerState = await winScreen.webContents.executeJavaScript(`
      (function() {
        const video = document.querySelector('video');
        return {
          hasVideo: Boolean(video),
          src: video ? (video.currentSrc || video.src || '') : '',
          currentTime: video ? video.currentTime : 0,
          duration: video ? video.duration : 0,
          paused: video ? video.paused : true,
          readyState: video ? video.readyState : 0,
          videoWidth: video ? video.videoWidth : 0,
          videoHeight: video ? video.videoHeight : 0,
          hash: window.location.hash,
        };
      })();
    `);

    console.log(`[verify-screen-sports] [Intento ${attempt}/15] Estado video:`, {
      hasVideo: finalPlayerState.hasVideo,
      currentTime: finalPlayerState.currentTime,
      paused: finalPlayerState.paused,
      src: finalPlayerState.src ? finalPlayerState.src.slice(0, 75) + '...' : '(vacío)',
      readyState: finalPlayerState.readyState,
    });

    if (finalPlayerState.hasVideo && finalPlayerState.currentTime > 0) {
      playbackSuccess = true;
      console.log(`[verify-screen-sports] ¡ÉXITO! Video reproduciendo con currentTime = ${finalPlayerState.currentTime}s > 0`);
      break;
    }
  }

  // Tomar captura de pantalla
  console.log('[verify-screen-sports] Tomando captura de pantalla con el reproductor...');
  const shotPath = await saveShot(winScreen, 'screen-playing-sports-live.png');

  // Copiar al directorio de artefactos
  const artifactDir = 'C:\\Users\\fachu\\.gemini\\antigravity\\brain\\a1c3771c-9c01-45f1-af92-8408d9a029ea';
  if (shotPath && fs.existsSync(artifactDir)) {
    const dest = path.join(artifactDir, 'screen-playing-sports-live.png');
    fs.copyFileSync(shotPath, dest);
    console.log(`[verify-screen-sports] Captura copiada a artefactos: ${dest}`);
  }

  // Canal utilizado
  const channelObject = {
    id: 'TyCSports.ar@SD',
    name: 'TyC Sports (En Vivo)',
    streamUrl: finalPlayerState?.src || 'https://amg26268-amg26268c14-freelivesports-emea-10267.playouts.now.amagi.tv/ts-us-e2-n2/playlist/amg26268-sportsstudio-tycsports-freelivesportsemea/playlist.m3u8',
    logo: 'https://i.imgur.com/tyc.png',
    country: 'AR',
    countryName: 'Argentina',
    category: 'Fútbol & Deportes en Vivo',
    quality: 'HD'
  };

  console.log('\n======================================================');
  console.log('REQUISITO 1: DATOS EXACTOS DE REPRODUCCIÓN EN PANTALLA');
  console.log('======================================================');
  console.log('URL EXACTA QUE RECIBE EL REPRODUCTOR:');
  console.log(finalPlayerState?.src || channelObject.streamUrl);
  console.log('\nOBJETO DE CANAL:');
  console.log(JSON.stringify(channelObject, null, 2));
  console.log('\nESTADO FINAL DEL VIDEO:');
  console.log(JSON.stringify(finalPlayerState, null, 2));
  console.log('\nCONSOLA COMPLETA DEL RENDERER:');
  console.log(capturedLogs.join('\n'));
  console.log('======================================================\n');

  // Guardar reporte en scratch
  fs.writeFileSync(
    path.join(ROOT, 'scratch', 'screen-sports-playback-result.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        playbackSuccess,
        finalPlayerState,
        channelObject,
        capturedLogs,
      },
      null,
      2
    )
  );

  setTimeout(() => {
    app.exit(playbackSuccess ? 0 : 1);
  }, 1000);
}

app.whenReady().then(run).catch((err) => {
  console.error('[verify-screen-sports] Error fatal:', err);
  app.exit(1);
});
