const { app, components, BrowserWindow } = require('electron');

const globalTimeout = setTimeout(() => {
  console.error('[probe-drm] Timeout global de 40s alcanzado');
  app.exit(1);
}, 40000);

app.whenReady().then(async () => {
  console.log('[probe-drm] Electron version:', process.versions.electron);
  console.log('[probe-drm] Chrome version:', process.versions.chrome);
  console.log('[probe-drm] components disponible:', Boolean(components));

  if (components && typeof components.whenReady === 'function') {
    try {
      console.log('[probe-drm] Esperando components.whenReady()...');
      await components.whenReady();
      if (typeof components.status === 'function') {
        console.log('[probe-drm] components.status():', JSON.stringify(components.status(), null, 2));
      }
    } catch (err) {
      console.error('[probe-drm] Error en components.whenReady():', err && err.message ? err.message : String(err));
    }
  }

  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.once('did-finish-load', async () => {
    console.log('[probe-drm] did-finish-load en:', win.webContents.getURL());
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
              initDataTypes: ['cenc'],
              videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
              audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
            }]);
            const keys = await access.createMediaKeys();
            return { ok: true, keySystem: access.keySystem, hasMediaKeys: Boolean(keys) };
          } catch (err) {
            return { ok: false, name: err && err.name ? err.name : 'Error', message: err && err.message ? err.message : String(err) };
          }
        })()
      `);
      if (result && result.ok) {
        console.log(`[probe-drm] requestMediaKeySystemAccess: OK (keySystem=${result.keySystem}, createMediaKeys=${result.hasMediaKeys})`);
      } else {
        console.log(`[probe-drm] requestMediaKeySystemAccess: ERROR -> ${result?.name}: ${result?.message}`);
      }
    } catch (execErr) {
      console.error('[probe-drm] Error ejecutando JS en la página:', execErr && execErr.message ? execErr.message : String(execErr));
    } finally {
      clearTimeout(globalTimeout);
      app.quit();
    }
  });

  win.webContents.once('did-fail-load', (_e, code, desc, url) => {
    console.error(`[probe-drm] did-fail-load (${code}): ${desc} en ${url}`);
    clearTimeout(globalTimeout);
    app.quit();
  });

  console.log('[probe-drm] Cargando https://open.spotify.com ...');
  win.loadURL('https://open.spotify.com');
});
