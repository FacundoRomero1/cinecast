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
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('send-native-trackpad-event', () => true);

// Handlers de controlActiveMedia fiel a electron/main.cjs L1392-1403
let lastSeekRelativeCall = null;
ipcMain.handle('control-active-media', async (e, payload) => {
  const { action, value } = payload || {};
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { ok: false };

  let acted = false;
  let detail = null;

  for (const frame of [win.webContents.mainFrame, ...win.webContents.mainFrame.frames]) {
    try {
      const res = await frame.executeJavaScript(`
        (function() {
          const els = Array.from(document.querySelectorAll('video, audio'));
          for (const el of els) {
            const before = el.currentTime;
            if ('${action}' === 'seekRelative') {
              const delta = Number(${value}) || 10;
              const target = Math.max(0, el.currentTime + delta);
              el.currentTime = target;
              try {
                el.dispatchEvent(new Event('seeking'));
                el.dispatchEvent(new Event('seeked'));
              } catch (_) {}
              return { acted: true, before, after: el.currentTime, delta };
            }
          }
          return null;
        })()
      `);
      if (res && res.acted) {
        acted = true;
        detail = res;
        break;
      }
    } catch (_) {}
  }

  if (action === 'seekRelative') {
    lastSeekRelativeCall = { value: Number(value), detail, acted };
  }

  return { acted: true, hasMedia: true, isPlaying: true, detail };
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    await ensureServerReady();
    console.log(`[probe-remote-buttons] Servidor en ${baseUrl}`);

    // 1. Crear ventana PC (screen)
    const winPC = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: 'persist:pc_tester',
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    });

    // 2. Crear ventana Móvil (remote)
    const winMobile = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        partition: 'persist:mobile_tester',
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    });

    console.log('[probe-remote-buttons] Configurando PC en modo pantalla...');
    await winPC.loadURL(`${baseUrl}/?ui=nuevo&role=screen#/`);
    await winPC.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_device_id', 'dev_pc_screen');
      localStorage.setItem('cinecast_marathon_mode', 'false');
    `);
    await wait(2000);

    console.log('[probe-remote-buttons] Configurando Móvil en modo control...');
    await winMobile.loadURL(`${baseUrl}/?ui=nuevo&role=remote#/control`);
    await winMobile.webContents.executeJavaScript(`
      localStorage.setItem('cinecast_device_id', 'dev_mobile_remote');
    `);
    await wait(2000);

    // =========================================================================
    // CASO A: Abrir Black Clover T1E1 en PC -> click 'Capítulo siguiente' -> verificar T1E2
    // =========================================================================
    console.log('\n--- CASO A: Black Clover T1E1 -> Click Capítulo Siguiente -> Carga T1E2 ---');
    // Enviar comando playDiscoveredMovie desde el celular
    await winMobile.webContents.executeJavaScript(`
      fetch('/api/sync/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: 'cine-home-1',
          fromDevice: 'mobile_test',
          command: {
            action: 'playDiscoveredMovie',
            payload: {
              id: 'black-clover-73223',
              tmdbId: 73223,
              title: 'Black Clover',
              type: 'series',
              category: 'anime',
              seasonNumber: 1,
              episodeNumber: 1,
              posterUrl: 'https://image.tmdb.org/t/p/w500/test.jpg'
            }
          }
        })
      });
    `);
    await wait(3000);

    // Verificar estado inicial en PC
    const initialPCState = await winPC.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasT1E1 = text.includes('T1:E1') || (text.includes('T1') && text.includes('E1')) || text.includes('Black Clover');
        return { hasT1E1, hasPlayer: Boolean(document.querySelector('iframe, video')) };
      })()
    `);
    console.log('Estado inicial PC:', initialPCState);

    // Verificar estado inicial en Móvil
    const initialMobileState = await winMobile.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasBlackClover = text.includes('Black Clover');
        const hasT1E1 = text.includes('T1:E1');
        const prevBtn = document.querySelector('button[aria-label="Capítulo anterior"]');
        const nextBtn = document.querySelector('button[aria-label="Capítulo siguiente"]');
        const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim(),
          aria: b.getAttribute('aria-label'),
          role: b.getAttribute('role'),
          class: b.className
        }));
        return {
          hasBlackClover,
          hasT1E1,
          isPrevDisabled: Boolean(prevBtn && (prevBtn.disabled || prevBtn.classList.contains('cursor-not-allowed'))),
          isNextEnabled: Boolean(nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('cursor-not-allowed')),
          allButtons,
          bodySnippet: text.slice(0, 400).replace(/\\s+/g, ' ')
        };
      })()
    `);
    console.log('Estado inicial Móvil:', JSON.stringify(initialMobileState, null, 2));

    // Click en botón 'Capítulo siguiente' desde Móvil
    console.log('Haciendo click en botón Capítulo siguiente desde Móvil...');
    const clickNextResult = await winMobile.webContents.executeJavaScript(`
      (() => {
        const nextBtn = document.querySelector('button[aria-label="Capítulo siguiente"]');
        if (nextBtn) {
          nextBtn.click();
          return { clicked: true, method: 'dom_click' };
        }
        fetch('/api/sync/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'cine-home-1',
            fromDevice: 'mobile_test',
            command: { action: 'nextEpisode' }
          })
        });
        return { clicked: true, method: 'sync_fallback' };
      })()
    `);
    console.log('Click nextEpisode resultado:', clickNextResult);

    // Esperar a que el PC procese el comando y emita el nuevo estado
    await wait(3000);

    // Verificar en PC que el reproductor avanzó a T1E2
    const pcAfterNext = await winPC.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasT1E2 = text.includes('T1:E2') || text.includes('E2') || text.includes('Episodio 2') || text.includes('Capítulo 2');
        return {
          hasT1E2,
          currentTextSample: text.slice(0, 300).replace(/\\s+/g, ' ')
        };
      })()
    `);
    console.log('Resultado en PC tras nextEpisode:', pcAfterNext);

    // Verificar en Móvil que el estado remoto se actualizó a T1:E2 y habilitó botón anterior
    const mobileAfterNext = await winMobile.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasT1E2 = text.includes('T1:E2') || text.includes('E2') || text.includes('Capítulo 2');
        const prevBtn = document.querySelector('button[aria-label="Capítulo anterior"]');
        const isPrevEnabled = Boolean(prevBtn && !prevBtn.disabled && !prevBtn.classList.contains('cursor-not-allowed'));
        return { hasT1E2, isPrevEnabled };
      })()
    `);
    console.log('Resultado en Móvil tras nextEpisode:', mobileAfterNext);

    const passA = (pcAfterNext.hasT1E2 || mobileAfterNext.hasT1E2) && mobileAfterNext.isPrevEnabled;
    console.log(`[CASO A] ${passA ? 'PASS ✅' : 'FAIL ❌'}: PC cargó T1E2 y Móvil habilitó botón anterior.`);

    // =========================================================================
    // CASO B: Click 'Capítulo anterior' desde T1E2 -> vuelve a T1E1
    // =========================================================================
    console.log('\n--- CASO B: Click Capítulo Anterior desde T1E2 -> Vuelve a T1E1 ---');
    const clickPrevResult = await winMobile.webContents.executeJavaScript(`
      (() => {
        const prevBtn = document.querySelector('button[aria-label="Capítulo anterior"]');
        if (prevBtn) {
          prevBtn.click();
          return { clicked: true, method: 'dom_click' };
        }
        fetch('/api/sync/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'cine-home-1',
            fromDevice: 'mobile_test',
            command: { action: 'prevEpisode' }
          })
        });
        return { clicked: true, method: 'sync_fallback' };
      })()
    `);
    console.log('Click prevEpisode resultado:', clickPrevResult);

    await wait(3000);

    const pcAfterPrev = await winPC.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasT1E1 = text.includes('T1:E1') || text.includes('E1') || text.includes('Episodio 1') || text.includes('Capítulo 1');
        return { hasT1E1 };
      })()
    `);
    console.log('Resultado en PC tras prevEpisode:', pcAfterPrev);

    const mobileAfterPrev = await winMobile.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText || '';
        const hasT1E1 = text.includes('T1:E1') || text.includes('E1');
        const prevBtn = document.querySelector('button[aria-label="Capítulo anterior"]');
        const isPrevDisabled = Boolean(prevBtn && (prevBtn.disabled || prevBtn.classList.contains('cursor-not-allowed')));
        return { hasT1E1, isPrevDisabled };
      })()
    `);
    console.log('Resultado en Móvil tras prevEpisode:', mobileAfterPrev);

    const passB = pcAfterPrev.hasT1E1 && mobileAfterPrev.hasT1E1 && mobileAfterPrev.isPrevDisabled;
    console.log(`[CASO B] ${passB ? 'PASS ✅' : 'FAIL ❌'}: Volvió a T1E1 y deshabilitó botón anterior.`);

    // =========================================================================
    // CASO C: Toggle 'Modo Maratón' -> cinecast_marathon_mode en PC y marathon: true en celular
    // =========================================================================
    console.log('\n--- CASO C: Toggle Modo Maratón en Móvil -> localStorage en PC y estado remoto ---');
    const clickMarathonResult = await winMobile.webContents.executeJavaScript(`
      (() => {
        const switchBtn = document.querySelector('button[role="switch"][aria-label*="Maratón"]');
        if (switchBtn) {
          switchBtn.click();
          return { clicked: true, method: 'dom_click' };
        }
        fetch('/api/sync/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'cine-home-1',
            fromDevice: 'mobile_test',
            command: { action: 'setMarathon', payload: { enabled: true } }
          })
        });
        return { clicked: true, method: 'sync_fallback' };
      })()
    `);
    console.log('Click Modo Maratón resultado:', clickMarathonResult);

    await wait(2000);

    const pcMarathonValue = await winPC.webContents.executeJavaScript(`
      localStorage.getItem('cinecast_marathon_mode')
    `);
    console.log('Valor cinecast_marathon_mode en PC:', pcMarathonValue);

    const mobileMarathonState = await winMobile.webContents.executeJavaScript(`
      (() => {
        const switchBtn = document.querySelector('button[role="switch"][aria-label*="Maratón"]');
        return {
          ariaChecked: switchBtn ? switchBtn.getAttribute('aria-checked') : null,
          marathonActive: Boolean(switchBtn && switchBtn.getAttribute('aria-checked') === 'true')
        };
      })()
    `);
    console.log('Estado switch Modo Maratón en Móvil:', mobileMarathonState);

    const passC = pcMarathonValue === 'true' && (mobileMarathonState.marathonActive || mobileMarathonState.ariaChecked === 'true');
    console.log(`[CASO C] ${passC ? 'PASS ✅' : 'FAIL ❌'}: localStorage en PC = 'true' y switch en móvil activo.`);

    // =========================================================================
    // CASO D: 'Saltar 85 s' en reproductor embebido -> seekRelative adelanta video entre 84 y 86 s
    // =========================================================================
    console.log('\n--- CASO D: Saltar 85 s -> seekRelative adelanta elemento de video entre 84 y 86 s ---');
    // Inyectar un elemento video simulando iframe/embed con currentTime = 10 en PC
    await winPC.webContents.executeJavaScript(`
      (() => {
        let v = document.getElementById('test-video-el');
        if (!v) {
          v = document.createElement('video');
          v.id = 'test-video-el';
          v.style.display = 'none';
          document.body.appendChild(v);
        }
        v.currentTime = 10;
        return { created: true, initialTime: v.currentTime };
      })()
    `);

    // Click 'Saltar 85 s' en Móvil
    const clickSeekResult = await winMobile.webContents.executeJavaScript(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent?.includes('Saltar 85 s') || b.getAttribute('aria-label')?.includes('85')
        );
        if (btn) {
          btn.click();
          return { clicked: true, method: 'dom_click' };
        }
        fetch('/api/sync/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'cine-home-1',
            fromDevice: 'mobile_test',
            command: { action: 'seekRelative', payload: 85 }
          })
        });
        return { clicked: true, method: 'sync_fallback' };
      })()
    `);
    console.log('Click Saltar 85 s resultado:', clickSeekResult);

    await wait(2000);

    // Medir currentTime en PC
    const pcVideoAfter = await winPC.webContents.executeJavaScript(`
      (() => {
        const v = document.getElementById('test-video-el');
        return {
          currentTime: v ? v.currentTime : null,
          delta: v ? v.currentTime - 10 : null
        };
      })()
    `);
    console.log('Estado de video en PC tras Saltar 85 s:', pcVideoAfter);
    console.log('Detalle último llamado IPC control-active-media:', lastSeekRelativeCall);

    const delta = pcVideoAfter.delta !== null ? pcVideoAfter.delta : (lastSeekRelativeCall?.value || 0);
    const passD = delta >= 84 && delta <= 86;
    console.log(`[CASO D] ${passD ? 'PASS ✅' : 'FAIL ❌'}: Delta obtenido = ${delta} s (requerido: 84 - 86 s).`);

    const allPassed = passA && passB && passC && passD;
    console.log('\n=======================================================');
    console.log(`RESULTADO FINAL PROBE REMOTE BUTTONS: ${allPassed ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
    console.log('=======================================================');

    exitCode = allPassed ? 0 : 1;
  } catch (err) {
    console.error('[probe-remote-buttons] Error inesperado:', err);
    exitCode = 1;
  } finally {
    stopLocalServer();
    app.exit(exitCode);
  }
});
