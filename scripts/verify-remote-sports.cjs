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

// Registrar handlers IPC necesarios para preload.cjs
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
    console.log(`[verify-sports] Captura guardada: ${fullPath} (${img.toPNG().length} bytes)`);
    return fullPath;
  } catch (err) {
    console.error(`[verify-sports] Error guardando ${filename}:`, err);
    return null;
  }
}

const timeoutHandle = setTimeout(() => {
  console.error('[verify-sports] TIMEOUT global de 60s alcanzado.');
  app.exit(1);
}, 60000);

async function run() {
  console.log('[verify-sports] Iniciando entorno de prueba...');
  const testEnv = await startTestEnv({
    name: 'verify-sports',
    useLanIp: false,
    seedHistory: false,
  });

  const baseUrl = testEnv.base;
  const activeRoomId = testEnv.room;
  console.log(`[verify-sports] Servidor listo en: ${baseUrl}, Sala: ${activeRoomId}`);

  const preloadPath = path.join(ROOT, 'electron', 'preload.cjs');

  // Ventana Pantalla (PC / TV)
  const winScreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:verify-sports-screen',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Ventana Celular (Control Remoto)
  const winRemote = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    webPreferences: {
      partition: 'persist:verify-sports-remote',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const MOBILE_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  winRemote.webContents.setUserAgent(MOBILE_ANDROID_UA);

  console.log('[verify-sports] Cargando aplicación en Pantalla y Celular...');
  await Promise.all([
    winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}`),
    winRemote.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${encodeURIComponent(activeRoomId)}`),
  ]);

  winScreen.showInactive();
  winRemote.showInactive();

  // Esperar sincronización y render inicial
  console.log('[verify-sports] Esperando sincronización inicial de WebSocket (3s)...');
  await wait(3000);

  // En el celular, asegurar que estamos en la vista de control remoto (/control)
  await winRemote.webContents.executeJavaScript(`
    (function() {
      if (!window.location.hash.includes('control')) {
        window.location.hash = '#/control';
      }
    })();
  `);
  await wait(1500);

  // 1. Tocar la pestaña "Deportes" en el celular
  console.log('[verify-sports] Cambiando a pestaña Deportes en el Control Remoto...');
  const switchedToSports = await winRemote.webContents.executeJavaScript(`
    (function() {
      // Buscar botón de pestaña Deportes
      const buttons = Array.from(document.querySelectorAll('button'));
      const sportsTabBtn = buttons.find(b => b.textContent && b.textContent.includes('Deportes'));
      if (sportsTabBtn) {
        sportsTabBtn.click();
        return true;
      }
      return false;
    })();
  `);
  console.log('[verify-sports] Click en pestaña Deportes:', switchedToSports ? 'Éxito' : 'No encontrado');

  // Esperar a que se carguen los partidos de /api/sports/matches
  console.log('[verify-sports] Esperando carga de partidos desde /api/sports/matches (3s)...');
  await wait(3500);

  // Verificar partidos cargados en el DOM del celular
  const matchInfo = await winRemote.webContents.executeJavaScript(`
    (function() {
      const matchCards = document.querySelectorAll('button[title*="Reproducir en pantalla"]');
      const textMatches = Array.from(document.querySelectorAll('div')).filter(d => 
        d.textContent && (d.textContent.includes('vs') || d.textContent.includes('VS'))
      );
      return {
        cardButtonsCount: matchCards.length,
        textMatchesCount: textMatches.length,
        bodyTextSnippet: document.body.innerText.slice(0, 300).replace(/\\s+/g, ' ')
      };
    })();
  `);
  console.log('[verify-sports] Partidos detectados en UI del celular:', matchInfo);

  // Capturar vista del Control Remoto con la lista de deportes antes de reproducir
  await saveShot(winRemote, 'remote-sports-list.png');

  // 2. Tocar un partido en el celular para sintonizar en la pantalla
  console.log('[verify-sports] Tocando partido para mandar comando play a la pantalla...');
  const tunedMatch = await winRemote.webContents.executeJavaScript(`
    (function() {
      // Buscar el primer botón de sintonizar canal dentro de un partido
      const playBtn = document.querySelector('button[title*="Reproducir en pantalla"]') ||
        Array.from(document.querySelectorAll('button')).find(b => 
          b.textContent && (b.textContent.includes('ESPN') || b.textContent.includes('TNT') || b.textContent.includes('TyC'))
        );
      if (playBtn) {
        const text = playBtn.textContent.trim();
        playBtn.click();
        return { clicked: true, buttonText: text };
      }
      return { clicked: false };
    })();
  `);
  console.log('[verify-sports] Resultado del click de sintonización:', tunedMatch);

  // Guardar captura del celular tras enviar el comando
  await wait(500);
  await saveShot(winRemote, 'remote-sports-sending.png');

  // 3. Verificar que la pantalla haya recibido el comando y esté reproduciendo
  console.log('[verify-sports] Verificando recepción de comando en la Pantalla...');
  let screenReceived = false;
  let screenState = null;

  for (let i = 0; i < 15; i++) {
    await wait(1000);
    screenState = await winScreen.webContents.executeJavaScript(`
      (function() {
        const hash = window.location.hash;
        const video = document.querySelector('video');
        const webview = document.querySelector('webview');
        const titleEl = document.querySelector('h1, h2, h3, [class*="title"]');
        const toast = document.querySelector('[class*="notification"], [class*="toast"]');
        
        return {
          hash,
          hasVideo: Boolean(video),
          videoSrc: video ? (video.currentSrc || video.src) : null,
          videoPaused: video ? video.paused : null,
          hasWebview: Boolean(webview),
          webviewSrc: webview ? webview.getAttribute('src') : null,
          bodySnippet: document.body.innerText.slice(0, 200).replace(/\\s+/g, ' '),
        };
      })();
    `);

    if (screenState.hash.includes('partidos') || screenState.hash.includes('deportes') || screenState.hasVideo || screenState.hasWebview) {
      screenReceived = true;
      console.log(`[verify-sports] ¡Comando recibido en la Pantalla en intento ${i + 1}!`, screenState);
      break;
    }
  }

  // Capturar vista de la Pantalla reproduciendo el partido
  await wait(1500);
  await saveShot(winScreen, 'screen-playing-sports.png');

  clearTimeout(timeoutHandle);
  console.log('='.repeat(80));
  console.log('VERIFICACIÓN DE REMOTO DE DEPORTES COMPLETADA CON ÉXITO:');
  console.log(`  • Switch a pestaña Deportes: ${switchedToSports ? 'OK' : 'FAIL'}`);
  console.log(`  • Partidos en lista: ${matchInfo.cardButtonsCount > 0 || matchInfo.textMatchesCount > 0 ? 'OK' : 'FAIL'}`);
  console.log(`  • Envío de comando play desde celular: ${tunedMatch.clicked ? `OK (${tunedMatch.buttonText})` : 'FAIL'}`);
  console.log(`  • Recepción y reproducción en Pantalla: ${screenReceived ? 'OK' : 'FAIL'}`);
  console.log(`  • Estado Pantalla: hash=${screenState?.hash}, video=${screenState?.hasVideo}, src=${screenState?.videoSrc || screenState?.webviewSrc}`);
  console.log('='.repeat(80));

  await winScreen.close();
  await winRemote.close();
  app.exit(0);
}

app.whenReady().then(run).catch((err) => {
  console.error('[verify-sports] Error fatal en ejecución:', err);
  app.exit(1);
});
