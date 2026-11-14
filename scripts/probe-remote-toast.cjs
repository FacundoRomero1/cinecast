#!/usr/bin/env node
/**
 * scripts/probe-remote-toast.cjs
 * Verifica PARTE 2:
 *  (a) 10 reconexiones en <60s -> <=1 toast "conectado!" en PC, CINECAST_DEBUG_SYNC=1 logs en servidor
 *      y buffer circular de 30 eventos en cliente.
 *  (b) CDP Page.setWebLifecycleState frozen 20s -> active -> reconecta en <3s sin toast extra.
 *  (c) Un segundo celular (distinct deviceId) sí dispara su propio toast en PC.
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env });
  process.exit(res.status ?? 1);
}

process.env.CINECAST_DEBUG_SYNC = '1';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});

const globalTimer = setTimeout(() => {
  console.error('[probe-remote-toast] TIMEOUT GLOBAL (145s)');
  if (testEnv) try { testEnv.stop(); } catch (_) {}
  app.exit(1);
}, 145000);

ipcMain.handle('get-local-ip', () => ({ ip: testEnv ? testEnv.lanIp : '127.0.0.1', port: testEnv ? testEnv.port : 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('control-active-media', () => ({ ok: true }));
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('send-key-to-webview', () => true);
ipcMain.handle('set-master-volume', () => ({ ok: true }));
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('get-compatibility-mode', () => false);
ipcMain.handle('get-load-recording', () => false);
ipcMain.handle('check-embed-providers', () => []);

async function waitForWsConnected(win, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`(() => {
      const ds = window.cinecastDeviceSync;
      return Boolean(ds && ds.getSyncTelemetrySummary && ds.getSyncTelemetrySummary().transporte === 'ws');
    })()`).catch(() => false);
    if (ok) return true;
    await wait(100);
  }
  return false;
}

async function setupToastObserver(winScreen) {
  await winScreen.webContents.executeJavaScript(`(() => {
    window.__connectToasts = [];
    const seenTexts = new Set();
    const recordText = (text) => {
      const clean = String(text || '').trim();
      if (!clean || !/conectado!/i.test(clean)) return;
      const bucket = Math.floor(Date.now() / 500) + ':' + clean;
      if (seenTexts.has(bucket)) return;
      seenTexts.add(bucket);
      window.__connectToasts.push({ text: clean, at: Date.now() });
    };
    const obs = new MutationObserver(() => {
      const bodyTxt = document.body.innerText || '';
      const lines = bodyTxt.split('\\n').map((l) => l.trim()).filter((l) => /conectado!/i.test(l));
      for (const l of lines) recordText(l);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__dsRemoteToastCount = 0;
    if (window.cinecastDeviceSync?.onRemoteConnected) {
      window.cinecastDeviceSync.onRemoteConnected((name) => {
        window.__dsRemoteToastCount += 1;
        window.__connectToasts.push({ text: 'ds:' + name, at: Date.now() });
      });
    }
    return true;
  })()`);
}

async function getToasts(winScreen) {
  return await winScreen.webContents.executeJavaScript(
    `JSON.stringify({ list: window.__connectToasts || [], dsCount: window.__dsRemoteToastCount || 0 })`
  ).then(JSON.parse);
}

async function run() {
  let winScreen = null;
  let winRemote1 = null;
  let winRemote2 = null;

  try {
    testEnv = await startTestEnv({ name: 'probe-remote-toast', useLanIp: true, seedHistory: false });
    const baseUrl = testEnv.lanBase;
    const roomId = testEnv.room;
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');

    winScreen = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:probe-toast-screen',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await winScreen.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(roomId)}`);
    if (!(await waitForWsConnected(winScreen))) {
      throw new Error('winScreen no conectó');
    }
    await setupToastObserver(winScreen);

    winRemote1 = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        partition: 'persist:probe-toast-remote1',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await winRemote1.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${encodeURIComponent(roomId)}`);
    if (!(await waitForWsConnected(winRemote1))) {
      throw new Error('winRemote1 no conectó');
    }
    await wait(1200);

    const hasSubtleDot = await winScreen.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-testid="pc-remote-dot"]'))`
    );
    const initialToasts = await getToasts(winScreen);
    console.log('[probe-remote-toast] Inicial:', { initialCount: initialToasts.dsCount, hasSubtleDot, toasts: initialToasts.list });

    // (a) 10 reconexiones en < 60 s (mezcla de terminate WS y recargas)
    const remote1Id = await winRemote1.webContents.executeJavaScript(`localStorage.getItem('cinecast_device_id')`);
    for (let i = 1; i <= 10; i++) {
      if (i % 3 === 0) {
        await new Promise((res) => {
          winRemote1.webContents.once('did-finish-load', res);
          winRemote1.reload();
        });
      } else {
        await fetch(`${baseUrl}/api/sync/chaos/terminate-client`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: remote1Id }),
        });
      }
      await waitForWsConnected(winRemote1, 10000);
      await wait(450);
    }

    await wait(1000);
    const after10Toasts = await getToasts(winScreen);
    const eventsRemote1 = await winRemote1.webContents.executeJavaScript(
      `JSON.stringify(window.cinecastDeviceSync?.getConnectionEvents?.() || [])`
    ).then(JSON.parse);

    // Verificar sección Diagnóstico de conexión muestra eventos
    await winScreen.webContents.executeJavaScript(`window.location.hash = '#/ajustes'`);
    await wait(800);
    const settingsShowsEvents = await winScreen.webContents.executeJavaScript(
      `(() => {
        const txt = document.body.innerText || '';
        return /eventos de conexi[oó]n/i.test(txt) && /copiar eventos/i.test(txt);
      })()`
    );
    await winScreen.webContents.executeJavaScript(`window.location.hash = '#/'`);
    await wait(300);

    const pass10Reconnects =
      initialToasts.dsCount === 1 &&
      after10Toasts.dsCount <= 1 &&
      eventsRemote1.length >= 2 &&
      eventsRemote1.length <= 30 &&
      settingsShowsEvents;
    console.log('[probe-remote-toast] (a) 10 reconexiones:', {
      pass: pass10Reconnects,
      toastCount: after10Toasts.dsCount,
      clientEventsCount: eventsRemote1.length,
      settingsShowsEvents,
    });

    // (b) CDP Page.setWebLifecycleState frozen 20 s -> active (< 3 s reconexión, 0 toasts extra)
    if (!winRemote1.webContents.debugger.isAttached()) {
      winRemote1.webContents.debugger.attach('1.3');
    }
    const beforeFreezeToasts = (await getToasts(winScreen)).dsCount;
    console.log('[probe-remote-toast] Congelando winRemote1 durante 20s via CDP...');
    await winRemote1.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
    await wait(20000);

    const tResumeStart = Date.now();
    await winRemote1.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' });
    const reconnectedOk = await waitForWsConnected(winRemote1, 3000);
    const resumeElapsedMs = Date.now() - tResumeStart;
    await wait(800);

    // Verificar comando vivo real funciona inmediatamente
    let gotCmdAfterResume = false;
    await winScreen.webContents.executeJavaScript(`(() => {
      window.__gotResumeCmd = false;
      window.cinecastDeviceSync.onCommand((c) => {
        if (c && c.action === 'seekRelative') window.__gotResumeCmd = true;
      });
    })()`);
    await winRemote1.webContents.executeJavaScript(`window.cinecastDeviceSync.sendCommand({ action: 'seekRelative', payload: 10 })`);
    const cmdWaitStart = Date.now();
    while (Date.now() - cmdWaitStart < 3000) {
      gotCmdAfterResume = await winScreen.webContents.executeJavaScript(`Boolean(window.__gotResumeCmd)`).catch(() => false);
      if (gotCmdAfterResume) break;
      await wait(100);
    }

    const afterFreezeToasts = (await getToasts(winScreen)).dsCount;
    const freezeExtraToasts = afterFreezeToasts - beforeFreezeToasts;
    const passFreeze = reconnectedOk && resumeElapsedMs < 3000 && freezeExtraToasts === 0 && gotCmdAfterResume;
    console.log('[probe-remote-toast] (b) Freeze 20s -> Active:', {
      pass: passFreeze,
      reconnectedOk,
      resumeElapsedMs,
      freezeExtraToasts,
      gotCmdAfterResume,
    });

    // (c) 2do celular distinto SÍ dispara su propio toast
    winRemote2 = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        partition: 'persist:probe-toast-remote2',
        preload: preloadPath,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await winRemote2.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${encodeURIComponent(roomId)}`);
    await waitForWsConnected(winRemote2, 10000);
    await wait(1200);
    const finalToasts = await getToasts(winScreen);
    const phone2ExtraToasts = finalToasts.dsCount - afterFreezeToasts;
    const passPhone2 = phone2ExtraToasts === 1;
    console.log('[probe-remote-toast] (c) 2do celular distinto:', {
      pass: passPhone2,
      phone2ExtraToasts,
      totalToasts: finalToasts.dsCount,
      allToasts: finalToasts.list,
    });

    const summary = {
      pass10Reconnects,
      passFreeze,
      passPhone2,
      hasSubtleDot,
      resumeElapsedMs,
      totalToastsPhone1: afterFreezeToasts,
      phone2ExtraToasts,
    };
    console.log('\n=== RESUMEN PROBE-REMOTE-TOAST ===\n' + JSON.stringify(summary, null, 2));

    if (!pass10Reconnects || !passFreeze || !passPhone2 || !hasSubtleDot) {
      throw new Error('Falló alguna aserción en probe-remote-toast');
    }
    console.log('[probe-remote-toast] PASS');
  } finally {
    clearTimeout(globalTimer);
    if (winRemote2 && !winRemote2.isDestroyed()) try { winRemote2.destroy(); } catch (_) {}
    if (winRemote1 && !winRemote1.isDestroyed()) try { winRemote1.destroy(); } catch (_) {}
    if (winScreen && !winScreen.isDestroyed()) try { winScreen.destroy(); } catch (_) {}
    if (testEnv) try { await testEnv.stop(); } catch (_) {}
  }
}

app.whenReady().then(() => {
  run()
    .then(() => app.exit(0))
    .catch((err) => {
      console.error('[probe-remote-toast] ERROR:', err);
      app.exit(1);
    });
});
