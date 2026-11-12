#!/usr/bin/env node
/**
 * scripts/probe-layout.cjs
 * Verificación del anclaje de la barra móvil en viewport 390x844 con emulación táctil por CDP.
 * Casos:
 * (i) tras cargar #/, #/explorar, #/buscar y #/lista: barra existe, rect.bottom entre innerHeight-1 e innerHeight+1, elementFromPoint es la barra.
 * (ii) con setDeviceMetricsOverride cambiando alto 844 -> 784 -> 844 y 844 -> 700: barra visible y anclada tras 400 ms.
 * (iii) abrir y cerrar RemoteSheet y filtro 3 veces: estilos html/body intactos y barra anclada.
 * (iv) scroll de 400 px y repetir verificación.
 * (v) location.reload() y repetir verificación.
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

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name]) {
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        return netInfo.address;
      }
    }
  }
  return '127.0.0.1';
}

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

// Handlers IPC para evitar excepciones con preload
ipcMain.handle('get-local-ip', () => ({ ip: getLanIp(), port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('set-no-cors-fix', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('save-accounts', () => true);
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-embed-status', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('probe-streams', (_e, urls) => (Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []));
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('control-active-media', () => true);
ipcMain.handle('send-native-click', () => true);

const globalTimer = setTimeout(() => {
  console.error('[probe-layout] Timeout global de 120 s alcanzado');
  app.exit(1);
}, 120000);

let serverProcess = null;

async function ensureServer() {
  const lanIp = getLanIp();
  const url = `http://${lanIp}:3000`;
  const portUsed = await isPortInUse(3000);
  if (!portUsed) {
    console.log('[probe-layout] Iniciando servidor local...');
    const rootDir = path.resolve(__dirname, '..');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: '3000', CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
  }

  const ok = await waitForHealth(`http://127.0.0.1:3000`, 35000);
  if (!ok) {
    console.error(`[probe-layout] Servidor no responde en http://127.0.0.1:3000`);
    if (serverProcess) serverProcess.kill();
    app.exit(1);
  }
  return url;
}

app.whenReady().then(async () => {
  const baseUrl = await ensureServer();
  const results = [];

  const win = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const MOBILE_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  win.webContents.setUserAgent(MOBILE_ANDROID_UA);

  const testUrl = `${baseUrl}/?debug=layout#/`;
  console.log(`[probe-layout] Cargando ${testUrl}`);
  await win.loadURL(testUrl);
  await wait(1500);

  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch (e) {
    console.warn('[probe-layout] Debugger attach error:', e.message);
  }

  const setMetrics = async (w, h) => {
    try {
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 2,
        mobile: true,
      });
    } catch (e) {
      console.warn('[probe-layout] setDeviceMetricsOverride error:', e.message);
    }
  };

  await setMetrics(390, 844);
  try {
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
  } catch (_) {}

  const checkBarStatus = async () => {
    return await win.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('nav[aria-label="Navegación móvil"]');
        if (!bar) return { exists: false, error: 'no_bar' };
        const rect = bar.getBoundingClientRect();
        const ih = window.innerHeight;
        const isBottomAligned = (rect.bottom >= ih - 1 && rect.bottom <= ih + 1);
        const cx = Math.floor(rect.left + rect.width / 2);
        const cy = Math.floor(rect.top + rect.height / 2);
        const centerEl = document.elementFromPoint(cx, cy);
        const isBarCenter = Boolean(centerEl && (centerEl === bar || bar.contains(centerEl)));
        return {
          exists: true,
          innerHeight: ih,
          rectBottom: Math.round(rect.bottom),
          rectTop: Math.round(rect.top),
          rectHeight: Math.round(rect.height),
          isBottomAligned,
          isBarCenter,
          centerTag: centerEl ? centerEl.tagName.toLowerCase() : null
        };
      })()
    `);
  };

  const getDocStyles = async () => {
    return await win.webContents.executeJavaScript(`
      (() => {
        const h = window.getComputedStyle(document.documentElement);
        const b = window.getComputedStyle(document.body);
        return {
          htmlOverflow: h.overflow,
          bodyOverflow: b.overflow,
          htmlPosition: h.position,
          bodyPosition: b.position,
          htmlTop: h.top,
          bodyTop: b.top,
        };
      })()
    `);
  };

  try {
    // =========================================================================
    // Caso (i): #/, #/explorar, #/buscar, #/lista
    // =========================================================================
    const routes = ['#/', '#/explorar', '#/buscar', '#/lista'];
    for (const r of routes) {
      await win.webContents.executeJavaScript(`window.location.hash = '${r}';`);
      await wait(800);
      const st = await checkBarStatus();
      const pass = st.exists && st.isBottomAligned && st.isBarCenter;
      results.push({
        caso: `(i) Ruta ${r}`,
        esperado: `rect.bottom==iH (${st.innerHeight}), bar en centro`,
        obtenido: `iH:${st.innerHeight} bottom:${st.rectBottom} center:${st.isBarCenter} (${st.centerTag})`,
        pasa: pass,
      });
    }

    // =========================================================================
    // Caso (ii): Métricas cambiantes 844 -> 784 -> 844 -> 700
    // =========================================================================
    const metricSteps = [
      { h: 784, name: '844 -> 784' },
      { h: 844, name: '784 -> 844' },
      { h: 700, name: '844 -> 700' },
      { h: 844, name: '700 -> 844' },
    ];

    for (const step of metricSteps) {
      await setMetrics(390, step.h);
      await wait(400);
      const st = await checkBarStatus();
      const pass = st.exists && st.isBottomAligned && st.isBarCenter;
      results.push({
        caso: `(ii) Redimensionar ${step.name}`,
        esperado: `iH:${step.h} bottom:${step.h}`,
        obtenido: `iH:${st.innerHeight} bottom:${st.rectBottom} center:${st.isBarCenter}`,
        pasa: pass,
      });
    }

    // =========================================================================
    // Caso (iii): Abrir y cerrar RemoteSheet y Filtros 3 veces cada uno
    // =========================================================================
    const initialStyles = await getDocStyles();

    // Probar RemoteSheet 3 veces
    for (let i = 1; i <= 3; i++) {
      // Abrir remote sheet tocando el botón Control en la barra
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('nav[aria-label="Navegación móvil"] a, nav[aria-label="Navegación móvil"] button'))
            .find(el => el.textContent && el.textContent.includes('Control'));
          if (btn) btn.click();
        })()
      `);
      await wait(400);
      // Cerrar tocando botón cerrar
      await win.webContents.executeJavaScript(`
        (() => {
          const closeBtn = document.querySelector('aside[aria-label="Control Remoto"] button[aria-label="Cerrar panel"]') ||
            document.querySelector('aside button[aria-label="Cerrar"]') ||
            document.querySelector('aside button');
          if (closeBtn) closeBtn.click();
          else window.history.back();
        })()
      `);
      await wait(400);
    }

    // Probar panel de filtros 3 veces (en #/explorar)
    await win.webContents.executeJavaScript(`window.location.hash = '#/explorar';`);
    await wait(800);
    for (let i = 1; i <= 3; i++) {
      await win.webContents.executeJavaScript(`
        (() => {
          const filterBtn = document.querySelector('button[aria-label*="filtro" i], button[title*="filtro" i]') ||
            Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Filtros'));
          if (filterBtn) filterBtn.click();
        })()
      `);
      await wait(400);
      await win.webContents.executeJavaScript(`
        (() => {
          const closeBtn = document.querySelector('button[aria-label="Cerrar filtros"]') ||
            Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Aplicar') || b.textContent.includes('Cerrar')));
          if (closeBtn) closeBtn.click();
          else window.history.back();
        })()
      `);
      await wait(400);
    }

    const postSheetStyles = await getDocStyles();
    const stSheet = await checkBarStatus();
    const stylesMatch =
      initialStyles.htmlOverflow === postSheetStyles.htmlOverflow &&
      initialStyles.bodyOverflow === postSheetStyles.bodyOverflow;
    const passSheet = stylesMatch && stSheet.exists && stSheet.isBottomAligned && stSheet.isBarCenter;

    results.push({
      caso: `(iii) Abrir/cerrar RemoteSheet y Filtros x3`,
      esperado: `styles html:${initialStyles.htmlOverflow} body:${initialStyles.bodyOverflow}, barra anclada`,
      obtenido: `styles html:${postSheetStyles.htmlOverflow} body:${postSheetStyles.bodyOverflow}, bottom:${stSheet.rectBottom}`,
      pasa: passSheet,
    });

    // =========================================================================
    // Caso (iv): Scroll 400px y repetir verificación
    // =========================================================================
    await win.webContents.executeJavaScript(`window.scrollTo(0, 400);`);
    await wait(400);
    const scrollStyles = await getDocStyles();
    const stScroll = await checkBarStatus();
    const scrollY = await win.webContents.executeJavaScript(`window.scrollY;`);
    const passScroll =
      stScroll.exists &&
      stScroll.isBottomAligned &&
      stScroll.isBarCenter &&
      scrollStyles.htmlOverflow === initialStyles.htmlOverflow;
    results.push({
      caso: `(iv) Scroll 400 px`,
      esperado: `scrollY>=0, bottom:${stScroll.innerHeight}, bar en centro`,
      obtenido: `scrollY:${scrollY} bottom:${stScroll.rectBottom} center:${stScroll.isBarCenter}`,
      pasa: passScroll,
    });

    // =========================================================================
    // Caso (v): location.reload() y repetir
    // =========================================================================
    await win.webContents.executeJavaScript(`window.location.reload();`);
    await wait(1800);
    const stReload = await checkBarStatus();
    const passReload = stReload.exists && stReload.isBottomAligned && stReload.isBarCenter;
    results.push({
      caso: `(v) location.reload()`,
      esperado: `bottom:${stReload.innerHeight}, bar en centro`,
      obtenido: `bottom:${stReload.rectBottom} center:${stReload.isBarCenter}`,
      pasa: passReload,
    });

    // Reporte
    console.log('\n====================================================================================================');
    console.log('TABLA PROBE-LAYOUT:');
    console.log('----------------------------------------------------------------------------------------------------');
    console.log(
      'CASO'.padEnd(35) +
      'RESULTADO'.padEnd(12) +
      'VALORES / DETALLES'
    );
    console.log('----------------------------------------------------------------------------------------------------');
    let allPassed = true;
    for (const r of results) {
      if (!r.pasa) allPassed = false;
      const status = r.pasa ? 'PASA' : 'FALLA';
      console.log(
        r.caso.padEnd(35) +
        status.padEnd(12) +
        `Obtenido: [${r.obtenido}] | Esperado: [${r.esperado}]`
      );
    }
    console.log('====================================================================================================\n');

    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    clearTimeout(globalTimer);
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-layout] Error fatal:', err);
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    clearTimeout(globalTimer);
    app.exit(1);
  }
});

