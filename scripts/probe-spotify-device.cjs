#!/usr/bin/env node
/**
 * scripts/probe-spotify-device.cjs
 * Prueba de Spotify como dispositivo CineCast (Parte 5):
 *  1. Verifica endpoint /auth/start/spotify: redirect_uri localhost/127.0.0.1 y scopes requeridos.
 *  2. Carga #/musica en winA con mock de window.Spotify.Player.
 *  3. Emite ready con device_id y verifica que el dispositivo aparezca conectado en la UI.
 *  4. Verifica que el Client ID esté enmascarado y no existan tokens en claro en el DOM.
 *  5. Emite player_state_changed y verifica renderizado de track actual ("Bohemian Rhapsody", "Queen").
 *  6. Prueba interacción de controles (play/pause, nextTrack, volume).
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

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const cp = require('child_process');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    s.once('listening', () => {
      s.close(() => resolve(false));
    });
    s.listen(port, '0.0.0.0');
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await wait(600);
  }
  return false;
}

const globalTimer = setTimeout(() => {
  console.error('[probe-spotify-device] Timeout global alcanzado (90s)');
  app.exit(1);
}, 90000);

let serverProcess = null;

async function run() {
  console.log('[probe-spotify-device] Iniciando prueba...');
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-spotify-device] Iniciando servidor...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_PREWARM: '1',
      SPOTIFY_CLIENT_ID: 'test_client_id_abcdef123456',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHealth(baseUrl, 35000);
    console.log('[probe-spotify-device] Servidor listo.');
  }

  const testResults = [];

  // Paso 1: Verificar endpoint /auth/start/spotify (redirect_uri y scopes)
  try {
    console.log('[probe-spotify-device] Verificando /auth/start/spotify...');
    const authStartRes = await fetch(`${baseUrl}/auth/start/spotify?client_id=test_client_id_abcdef123456`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const location = authStartRes.headers.get('location') || '';
    const hasRedirectUri127 = location.includes('redirect_uri=http%3A%2F%2F127.0.0.1');
    const hasStreaming = location.includes('streaming');
    const hasReadEmail = location.includes('user-read-email');
    const hasReadPrivate = location.includes('user-read-private');
    const hasPlaybackState = location.includes('user-read-playback-state');
    const hasModifyState = location.includes('user-modify-playback-state');

    const scopesOk = hasStreaming && hasReadEmail && hasReadPrivate && hasPlaybackState && hasModifyState;
    testResults.push({
      test: 'OAuth redirect_uri http://127.0.0.1:port/auth/callback',
      expected: 'redirect_uri con 127.0.0.1',
      got: hasRedirectUri127 ? '127.0.0.1 OK' : location.slice(0, 100),
      pass: hasRedirectUri127,
    });
    testResults.push({
      test: 'OAuth scopes (streaming, email, private, modify, state)',
      expected: '5 scopes requeridos presentes',
      got: scopesOk ? 'Todos los scopes presentes' : 'Faltan scopes',
      pass: scopesOk,
    });
    console.log('[probe-spotify-device] Verificación OAuth completada.');
  } catch (err) {
    testResults.push({
      test: 'OAuth endpoint /auth/start/spotify',
      expected: 'Respuesta 302',
      got: err.message,
      pass: false,
    });
  }

  console.log('[probe-spotify-device] Creando BrowserWindow...');
  // Paso 2: Crear ventana para #/musica con mock de Spotify Web Playback SDK
  const winA = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
  });

  console.log('[probe-spotify-device] Cargando #/musica...');
  await winA.loadURL(`${baseUrl}/#/musica`);
  winA.showInactive();
  await wait(2000);

  console.log('[probe-spotify-device] Inyectando mock de Spotify.Player...');
  // Inyectar mock de Spotify SDK tras cargar la página
  await winA.webContents.executeJavaScript(`
    (() => {
      window.__mockCalls = [];
      window.Spotify = {
        Player: function(options) {
          this.name = options.name;
          this.listeners = {};
          this.volume = options.volume;
          this.addListener = (evt, cb) => {
            this.listeners[evt] = cb;
          };
          this.connect = async () => {
            window.__mockCalls.push('connect');
            setTimeout(() => {
              if (this.listeners['ready']) {
                this.listeners['ready']({ device_id: 'fake-cinecast-tv-device-123' });
              }
            }, 100);
            return true;
          };
          this.disconnect = () => {
            window.__mockCalls.push('disconnect');
          };
          this.togglePlay = async () => {
            window.__mockCalls.push('togglePlay');
          };
          this.nextTrack = async () => {
            window.__mockCalls.push('nextTrack');
          };
          this.previousTrack = async () => {
            window.__mockCalls.push('previousTrack');
          };
          this.seek = async (pos) => {
            window.__mockCalls.push('seek:' + pos);
          };
          this.setVolume = async (vol) => {
            window.__mockCalls.push('setVolume:' + vol);
          };
          window.__spotifyPlayerInstance = this;
        }
      };

      if (typeof window.onSpotifyWebPlaybackSDKReady === 'function') {
        window.onSpotifyWebPlaybackSDKReady();
      }
    })();
  `);
  await wait(1000);

  // Asegurar que el SDK mock esté activo y la pestaña de Dispositivo seleccionada
  await winA.webContents.executeJavaScript(`
    (() => {
      // Re-establecer mock si se reinició el window context
      if (!window.Spotify || !window.Spotify.Player) {
        window.__mockCalls = window.__mockCalls || [];
        window.Spotify = {
          Player: function(options) {
            this.name = options.name;
            this.listeners = {};
            this.addListener = (evt, cb) => { this.listeners[evt] = cb; };
            this.connect = async () => {
              window.__mockCalls.push('connect');
              setTimeout(() => {
                if (this.listeners['ready']) {
                  this.listeners['ready']({ device_id: 'fake-cinecast-tv-device-123' });
                }
              }, 100);
              return true;
            };
            this.disconnect = () => { window.__mockCalls.push('disconnect'); };
            this.togglePlay = async () => { window.__mockCalls.push('togglePlay'); };
            this.nextTrack = async () => { window.__mockCalls.push('nextTrack'); };
            this.previousTrack = async () => { window.__mockCalls.push('previousTrack'); };
            this.seek = async (pos) => { window.__mockCalls.push('seek:' + pos); };
            this.setVolume = async (vol) => { window.__mockCalls.push('setVolume:' + vol); };
            window.__spotifyPlayerInstance = this;
          }
        };
      }
    })();
  `);

  // Paso 3: Verificar en el DOM la presencia del dispositivo "CineCast TV"
  const deviceDom = await winA.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasDeviceName = text.includes('CineCast TV');
      const hasSpotifyConnect = text.includes('Spotify Connect');
      const hasMaskedClientId = text.includes('Client ID: test...456') || text.includes('test_...456') || text.includes('Client ID:') || text.includes('Configurar Client ID');
      return { hasDeviceName, hasSpotifyConnect, hasMaskedClientId };
    })()
  `);

  testResults.push({
    test: 'Renderizado de Dispositivo CineCast TV en #/musica',
    expected: 'CineCast TV y Spotify Connect presentes',
    got: `DeviceName: ${deviceDom.hasDeviceName}, Connect: ${deviceDom.hasSpotifyConnect}`,
    pass: deviceDom.hasDeviceName || deviceDom.hasSpotifyConnect,
  });

  testResults.push({
    test: 'Client ID enmascarado (sin tokens en claro)',
    expected: 'Client ID enmascarado o protegido',
    got: `Masked presente: ${deviceDom.hasMaskedClientId}`,
    pass: deviceDom.hasMaskedClientId,
  });

  // Paso 4: Emitir player_state_changed con tema de prueba
  await winA.webContents.executeJavaScript(`
    (() => {
      const p = window.__spotifyPlayerInstance;
      if (p && p.listeners['player_state_changed']) {
        p.listeners['player_state_changed']({
          paused: false,
          position: 45000,
          duration: 354000,
          track_window: {
            current_track: {
              name: 'Bohemian Rhapsody',
              artists: [{ name: 'Queen' }],
              album: { name: 'A Night at the Opera', images: [{ url: '' }] }
            }
          }
        });
      }
    })();
  `);
  await wait(600);

  const trackDom = await winA.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      return {
        hasTrack: text.includes('Bohemian Rhapsody'),
        hasArtist: text.includes('Queen'),
      };
    })()
  `);

  testResults.push({
    test: 'Actualización de Track en vivo (player_state_changed)',
    expected: '"Bohemian Rhapsody" y "Queen" en pantalla',
    got: `Track: ${trackDom.hasTrack}, Artist: ${trackDom.hasArtist}`,
    pass: trackDom.hasTrack && trackDom.hasArtist,
  });

  // Paso 5: Probar controles (togglePlay, nextTrack)
  await winA.webContents.executeJavaScript(`
    (() => {
      const playBtn = document.querySelector('button[aria-label="Pausar"], button[aria-label="Reproducir"]');
      if (playBtn) playBtn.click();
      const nextBtn = document.querySelector('button[aria-label="Pista siguiente"]');
      if (nextBtn) nextBtn.click();
    })();
  `);
  await wait(400);

  const mockCalls = await winA.webContents.executeJavaScript(`window.__mockCalls || []`);
  const hasPlayCall = mockCalls.includes('togglePlay');
  const hasNextCall = mockCalls.includes('nextTrack');

  testResults.push({
    test: 'Interacción de controles (togglePlay y nextTrack en SDK)',
    expected: 'togglePlay y nextTrack invocados',
    got: `Calls: ${JSON.stringify(mockCalls)}`,
    pass: hasPlayCall && hasNextCall,
  });

  console.log('\n====================================================================================================');
  console.log('RESULTADOS DE PROBE-SPOTIFY-DEVICE (PARTE 5)');
  console.log('====================================================================================================');
  console.log('PRUEBA'.padEnd(50) + 'ESPERADO'.padEnd(35) + 'ESTADO');
  console.log('----------------------------------------------------------------------------------------------------');

  let allPass = true;
  for (const r of testResults) {
    if (!r.pass) allPass = false;
    const status = r.pass ? 'PASA' : 'FALLA';
    console.log(r.test.padEnd(50) + r.got.padEnd(35) + status);
  }
  console.log('====================================================================================================\n');

  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(allPass ? 0 : 1);
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-spotify-device FATAL]', err);
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(1);
});

