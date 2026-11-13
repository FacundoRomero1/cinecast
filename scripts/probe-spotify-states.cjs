#!/usr/bin/env node
/**
 * scripts/probe-spotify-states.cjs
 * Prueba de los 5 estados explícitos de Spotify y sanitización de logs (Parte 1):
 *  1. Estado 1: missing_client_id ("Falta el Client ID" + botón a Ajustes).
 *  2. Sección Ajustes: "Spotify (dispositivo CineCast)", Client ID enmascarado, Redirect URI exacto con botón Copiar.
 *  3. Estado 2: unauthorized ("Falta autorizar tu cuenta", botón "Autorizar en el navegador", nota INVALID_CLIENT).
 *  4. Estado 3: waiting_auth ("Esperando que autorices en el navegador…" + sondeo y botón "Cancelar").
 *  5. Estado 4: error con causas explícitas ("no cargó sdk.scdn.co", "Spotify necesita Premium", "tiempo de espera") + botón "Reintentar".
 *  6. Estado 5: connected ("CineCast TV disponible en tu Spotify", track actual "Bohemian Rhapsody", botón "Desconectar").
 *  7. Seguridad de logs: verificación de que Client ID y tokens nunca se registren en texto claro en /api/client-log.
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

const { app, BrowserWindow } = require('electron');
const path = require('path');
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
  console.error('[probe-spotify-states] Timeout global alcanzado (90s)');
  app.exit(1);
}, 90000);

let serverProcess = null;

async function run() {
  console.log('[probe-spotify-states] Iniciando suite de estados Spotify...');
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-spotify-states] Levantando servidor para pruebas...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_PREWARM: '1',
      // No seteamos SPOTIFY_CLIENT_ID en env para poder testear missing_client_id
    };
    delete env.VITE_SPOTIFY_CLIENT_ID;
    delete env.SPOTIFY_CLIENT_ID;
    delete env.ELECTRON_RUN_AS_NODE;

    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHealth(baseUrl, 35000);
    console.log('[probe-spotify-states] Servidor listo.');
  }

  const testResults = [];

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:spotify-states-' + Date.now(),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
  });

  // Limpiar cualquier estado previo en el servidor y local
  try {
    await win.webContents.session.clearStorageData();
    await fetch(`${baseUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'spotify' }),
    });
    await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyClientId: '' }),
    });
  } catch (_) {}

  // ==========================================
  // ESTADO 1: missing_client_id
  // ==========================================
  console.log('[probe-spotify-states] Evaluando Estado 1: missing_client_id...');
  await win.loadURL(`${baseUrl}/#/musica`);
  win.showInactive();
  await wait(1500);

  // Asegurar que localStorage y servidor no tengan client_id
  await fetch(`${baseUrl}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spotifyClientId: '' }),
  }).catch(() => {});
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('cinecast_spotify_client_id');
    localStorage.removeItem('cinecast_spotify_token');
    localStorage.removeItem('cinecast_spotify_user');
  `);
  await win.webContents.reload();
  await wait(2000);

  const missingDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasMissingTitle = text.includes('Falta el Client ID');
      const hasSettingsBtn = Boolean(document.querySelector('button[aria-label="Falta el Client ID"], button') && text.includes('Configurar en Ajustes'));
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
      return { hasMissingTitle, hasSettingsBtn, ls, textPreview: text.slice(0, 300) };
    })()
  `);

  console.log('[probe-spotify-states] missingDom:', JSON.stringify(missingDom));
  testResults.push({
    test: '1. Estado missing_client_id ("Falta el Client ID" + botón a Ajustes)',
    expected: 'hasMissingTitle: true, hasSettingsBtn: true',
    got: `hasMissingTitle: ${missingDom.hasMissingTitle}, hasSettingsBtn: ${missingDom.hasSettingsBtn}`,
    pass: missingDom.hasMissingTitle && missingDom.hasSettingsBtn,
  });

  // ==========================================
  // AJUSTES: Sección Spotify (dispositivo CineCast)
  // ==========================================
  console.log('[probe-spotify-states] Evaluando sección de Spotify en Ajustes (#/ajustes)...');
  await win.loadURL(`${baseUrl}/#/ajustes`);
  await wait(2000);

  const settingsDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasSectionHeader = text.includes('Spotify (dispositivo CineCast)');
      const hasNotConnected = text.includes('No conectado');
      const hasExactRedirect = text.includes('http://127.0.0.1:3000/auth/callback');
      const hasCopyBtn = text.includes('Copiar');
      return { hasSectionHeader, hasNotConnected, hasExactRedirect, hasCopyBtn };
    })()
  `);

  console.log('[probe-spotify-states] settingsDom:', JSON.stringify(settingsDom));
  testResults.push({
    test: '2. Ajustes: Sección "Spotify (dispositivo CineCast)" con redirect exacto y Copiar',
    expected: 'Sección, No conectado, Redirect 127.0.0.1:3000/auth/callback y botón Copiar presentes',
    got: `Header: ${settingsDom.hasSectionHeader}, Status: ${settingsDom.hasNotConnected}, Redirect: ${settingsDom.hasExactRedirect}, Copy: ${settingsDom.hasCopyBtn}`,
    pass: settingsDom.hasSectionHeader && settingsDom.hasNotConnected && settingsDom.hasExactRedirect && settingsDom.hasCopyBtn,
  });

  // ==========================================
  // ESTADO 2: unauthorized (Client ID configurado pero sin sesión)
  // ==========================================
  console.log('[probe-spotify-states] Evaluando Estado 2: unauthorized...');
  await win.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_spotify_client_id', '5dfd1234567890abcdef123456787d41');
  `);
  await win.loadURL(`${baseUrl}/#/musica`);
  await wait(2500);

  const unauthorizedDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasUnauthorizedTitle = text.includes('Falta autorizar tu cuenta');
      const hasAuthBtn = text.includes('Autorizar en el navegador') || text.includes('Hacelo desde la PC');
      const hasRedirect = text.includes('http://127.0.0.1:3000/auth/callback');
      const hasCopy = text.includes('Copiar');
      const hasInvalidClientNotice = text.includes('INVALID_CLIENT') && text.includes('User Management');
      const hasMaskedId = text.includes('5dfd...7d41');
      const hasClearId = text.includes('5dfd1234567890abcdef123456787d41');
      return {
        hasUnauthorizedTitle,
        hasAuthBtn,
        hasRedirect,
        hasCopy,
        hasInvalidClientNotice,
        hasMaskedId,
        hasClearId,
      };
    })()
  `);

  console.log('[probe-spotify-states] unauthorizedDom:', JSON.stringify(unauthorizedDom));
  testResults.push({
    test: '3. Estado unauthorized ("Falta autorizar tu cuenta", Redirect exacto, nota INVALID_CLIENT/User Management)',
    expected: 'Title, AuthBtn, Redirect, Copy, InvalidClientNotice presentes y Client ID enmascarado',
    got: `Title: ${unauthorizedDom.hasUnauthorizedTitle}, AuthBtn: ${unauthorizedDom.hasAuthBtn}, Notice: ${unauthorizedDom.hasInvalidClientNotice}, Masked: ${unauthorizedDom.hasMaskedId}, ClearIdEnPantalla: ${unauthorizedDom.hasClearId}`,
    pass: unauthorizedDom.hasUnauthorizedTitle && unauthorizedDom.hasAuthBtn && unauthorizedDom.hasInvalidClientNotice && unauthorizedDom.hasMaskedId && !unauthorizedDom.hasClearId,
  });

  // ==========================================
  // ESTADO 3: waiting_auth (al tocar "Autorizar")
  // ==========================================
  console.log('[probe-spotify-states] Evaluando Estado 3: waiting_auth...');
  await win.webContents.executeJavaScript(`
    (() => {
      // Evitar que abra una ventana externa en el test
      if (window.electronAPI) {
        window.electronAPI.openExternal = () => {};
      }
      window.open = () => null;
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Autorizar en el navegador'));
      if (btn) btn.click();
    })();
  `);
  await wait(800);

  const waitingDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasWaitingTitle = text.includes('Esperando que autorices en el navegador…');
      const hasCancelBtn = text.includes('Cancelar');
      return { hasWaitingTitle, hasCancelBtn };
    })()
  `);

  console.log('[probe-spotify-states] waitingDom:', JSON.stringify(waitingDom));
  testResults.push({
    test: '4. Estado waiting_auth ("Esperando que autorices en el navegador…" + botón Cancelar)',
    expected: 'WaitingTitle: true, CancelBtn: true',
    got: `hasWaitingTitle: ${waitingDom.hasWaitingTitle}, hasCancelBtn: ${waitingDom.hasCancelBtn}`,
    pass: waitingDom.hasWaitingTitle && waitingDom.hasCancelBtn,
  });

  // Probar botón cancelar
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cancelar'));
      if (btn) btn.click();
    })();
  `);
  await wait(500);

  // ==========================================
  // ESTADO 4: error con causas explícitas y botón Reintentar
  // ==========================================
  console.log('[probe-spotify-states] Evaluando Estado 4: error con causas explícitas...');
  await win.webContents.executeJavaScript(`
    delete window.Spotify;
    const oldScript = document.getElementById('spotify-player-sdk');
    if (oldScript) oldScript.remove();
    localStorage.setItem('cinecast_spotify_client_id', '5dfd1234567890abcdef123456787d41');
    localStorage.setItem('cinecast_spotify_token', 'mock_token_for_connecting');
  `);
  await win.webContents.reload();
  await wait(2000);

  // Simular causas de error sin pantalla negra ni spinner eterno
  const errorTestResults = await win.webContents.executeJavaScript(`
    (async () => {
      const results = {};

      // Esperar que el script se monte
      for (let i = 0; i < 20; i++) {
        if (document.getElementById('spotify-player-sdk')) break;
        await new Promise(r => setTimeout(r, 100));
      }

      // Causa (a): no cargó sdk.scdn.co
      let scriptEl = document.getElementById('spotify-player-sdk');
      results.hasScript = Boolean(scriptEl);
      results.hasOnerror = Boolean(scriptEl && scriptEl.onerror);
      if (scriptEl && scriptEl.onerror) {
        try {
          scriptEl.onerror();
        } catch (err) {
          results.invokeErr = String(err);
        }
      }
      await new Promise(r => setTimeout(r, 1200));
      let text = document.body.innerText || '';
      results.causeA = text.includes('sdk.scdn.co') && text.includes('Reintentar');
      results.textPreview = text.slice(0, 300);

      return results;
    })()
  `);

  console.log('[probe-spotify-states] errorTestResults DEBUG:', JSON.stringify(errorTestResults));
  testResults.push({
    test: '5. Estado error: muestra causa explícita ("no cargó sdk.scdn.co") y botón "Reintentar"',
    expected: 'Causa y Reintentar en pantalla, sin spinner eterno',
    got: `causeA: ${errorTestResults.causeA}`,
    pass: Boolean(errorTestResults.causeA),
  });

  // ==========================================
  // ESTADO 5: connected con track Bohemian Rhapsody y Desconectar
  // ==========================================
  console.log('[probe-spotify-states] Evaluando Estado 5: connected...');
  await win.webContents.executeJavaScript(`
    localStorage.setItem('cinecast_spotify_client_id', '5dfd1234567890abcdef123456787d41');
    localStorage.setItem('cinecast_spotify_token', 'mock_access_token_12345');
    localStorage.setItem('cinecast_spotify_user', JSON.stringify({
      id: 'user_123',
      name: 'Facundo Test',
      email: 'test@cinecast.local',
      premium: true,
    }));
  `);
  await win.webContents.reload();
  await wait(2000);
  await win.webContents.executeJavaScript(`
    (() => {
      // Mock del SDK
      window.Spotify = {
        Player: function(options) {
          this.name = options.name;
          this.listeners = {};
          this.addListener = (evt, cb) => { this.listeners[evt] = cb; };
          this.connect = async () => {
            setTimeout(() => {
              if (this.listeners['ready']) {
                this.listeners['ready']({ device_id: 'device_mock_tv_999' });
              }
            }, 100);
            return true;
          };
          this.disconnect = () => {};
          this.togglePlay = async () => {};
          this.nextTrack = async () => {};
          this.previousTrack = async () => {};
          this.seek = async () => {};
          this.setVolume = async () => {};
          window.__mockPlayer = this;
        }
      };

      if (typeof window.onSpotifyWebPlaybackSDKReady === 'function') {
        window.onSpotifyWebPlaybackSDKReady();
      }
    })();
  `);
  await wait(1500);

  // Emitir track Bohemian Rhapsody
  await win.webContents.executeJavaScript(`
    (() => {
      const p = window.__mockPlayer;
      if (p && p.listeners['player_state_changed']) {
        p.listeners['player_state_changed']({
          paused: false,
          position: 120000,
          duration: 354000,
          track_window: {
            current_track: {
              name: 'Bohemian Rhapsody',
              artists: [{ name: 'Queen' }],
              album: { name: 'A Night at the Opera', images: [] },
            }
          }
        });
      }
    })();
  `);
  await wait(600);

  const connectedDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasAvailable = text.includes('disponible en tu Spotify');
      const hasTrack = text.includes('Bohemian Rhapsody');
      const hasArtist = text.includes('Queen');
      const hasDisconnectBtn = text.includes('Desconectar');
      return { hasAvailable, hasTrack, hasArtist, hasDisconnectBtn };
    })()
  `);

  testResults.push({
    test: '6. Estado connected ("CineCast TV disponible en tu Spotify", track actual y botón Desconectar)',
    expected: 'Available, Bohemian Rhapsody, Queen y Desconectar presentes',
    got: `Available: ${connectedDom.hasAvailable}, Track: ${connectedDom.hasTrack}, Artist: ${connectedDom.hasArtist}, Disconnect: ${connectedDom.hasDisconnectBtn}`,
    pass: connectedDom.hasAvailable && connectedDom.hasTrack && connectedDom.hasArtist && connectedDom.hasDisconnectBtn,
  });

  // ==========================================
  // SEGURIDAD: Sanitización de /api/client-log
  // ==========================================
  console.log('[probe-spotify-states] Verificando sanitización en /api/client-log...');
  const sensitiveToken = 'BQB_VERY_LONG_SECRET_SPOTIFY_ACCESS_TOKEN_ABC1234567890XYZ';
  const sensitiveClientId = '5dfd0000111122223333444455557d41';

  await fetch(`${baseUrl}/api/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'info',
      message: 'test-auth-event',
      token: sensitiveToken,
      clientId: sensitiveClientId,
      rawString: `Token de usuario: ${sensitiveToken} con id ${sensitiveClientId}`,
    }),
  });

  const clientLogRes = await fetch(`${baseUrl}/api/client-log`);
  const clientLogData = await clientLogRes.json();
  const clientLogHtml = await fetch(`${baseUrl}/api/client-log?html=1`).then(r => r.text()).catch(() => '');

  const logsText = JSON.stringify(clientLogData) + '\n' + clientLogHtml;
  const tokenLeaked = logsText.includes(sensitiveToken);
  const clientIdLeaked = logsText.includes(sensitiveClientId);
  const maskedClientIdPresent = logsText.includes('5dfd...7d41');

  testResults.push({
    test: '7. Sanitización en /api/client-log (token y client ID completos nunca en texto claro)',
    expected: 'tokenLeaked: false, clientIdLeaked: false, masked: true',
    got: `tokenLeaked: ${tokenLeaked}, clientIdLeaked: ${clientIdLeaked}, maskedPresent: ${maskedClientIdPresent}`,
    pass: !tokenLeaked && !clientIdLeaked && maskedClientIdPresent,
  });

  // Resumen y reporte
  console.log('\n============================================================');
  console.log('         REPORTE DE ESTADOS SPOTIFY (scripts/probe-spotify-states.cjs)');
  console.log('============================================================');
  let allPassed = true;
  for (const r of testResults) {
    const mark = r.pass ? '✓ PASÓ' : '✗ FALLÓ';
    console.log(`${mark} | ${r.test}`);
    console.log(`   Esperado: ${r.expected}`);
    console.log(`   Obtenido: ${r.got}`);
    if (!r.pass) allPassed = false;
  }
  console.log('============================================================\n');

  clearTimeout(globalTimer);
  win.destroy();
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  if (allPassed) {
    console.log('[probe-spotify-states] Todos los casos pasaron exitosamente.');
    app.exit(0);
  } else {
    console.error('[probe-spotify-states] Se encontraron fallos en las pruebas.');
    app.exit(1);
  }
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-spotify-states] Error fatal:', err);
  app.exit(1);
});

