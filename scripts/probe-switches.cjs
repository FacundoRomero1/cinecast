#!/usr/bin/env node
/**
 * scripts/probe-switches.cjs
 * Verificación geométrica y visual de todos los interruptores Switch.tsx en src/ui.
 * Verifica getBoundingClientRect de pista vs bolita (tolerancia 1px), colores de estado,
 * y guarda capturas en scratch/shots/.
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
const fs = require('fs');
const net = require('net');
const cp = require('child_process');

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
ipcMain.handle('probe-streams', (_e, urls) => (Array.isArray(urls) ? urls.map((u) => ({ url: u, alive: true, status: 200 })) : []));
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('clear-partition-session', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('control-active-media', () => true);

const globalTimer = setTimeout(() => {
  console.error('[probe-switches] Timeout global alcanzado');
  app.exit(1);
}, 120000);

let serverProcess = null;

async function ensureServer() {
  const url = `http://127.0.0.1:3000`;
  const portUsed = await isPortInUse(3000);
  if (!portUsed) {
    console.log('[probe-switches] Iniciando servidor local...');
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

  const ok = await waitForHealth(url, 35000);
  if (!ok) {
    console.error(`[probe-switches] Servidor no responde en ${url}`);
    if (serverProcess) serverProcess.kill();
    app.exit(1);
  }
  return url;
}

app.whenReady().then(async () => {
  const baseUrl = await ensureServer();
  const rootDir = path.resolve(__dirname, '..');
  const shotsDir = path.join(rootDir, 'scratch', 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const win = new BrowserWindow({
    show: false,
    width: 600,
    height: 900,
    webPreferences: {
      preload: path.join(rootDir, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const testSwitchGeometry = async (switchSelector, switchName) => {
    // Helper to evaluate geometry
    const evalGeo = async () => {
      return await win.webContents.executeJavaScript(`
        (() => {
          const btn = document.querySelector(${JSON.stringify(switchSelector)});
          if (!btn) return { exists: false };
          const track = btn.querySelector('[data-testid="switch-track"]');
          const thumb = btn.querySelector('[data-testid="switch-thumb"]');
          if (!track || !thumb) return { exists: false, error: 'no_track_or_thumb' };

          const btnRect = btn.getBoundingClientRect();
          const trackRect = track.getBoundingClientRect();
          const thumbRect = thumb.getBoundingClientRect();
          const trackStyle = window.getComputedStyle(track);
          const checked = btn.getAttribute('aria-checked') === 'true';

          const inside = (
            thumbRect.left >= trackRect.left - 1 &&
            thumbRect.right <= trackRect.right + 1 &&
            thumbRect.top >= trackRect.top - 1 &&
            thumbRect.bottom <= trackRect.bottom + 1
          );

          return {
            exists: true,
            checked,
            btnRect: { w: btnRect.width, h: btnRect.height },
            trackRect: { w: trackRect.width, h: trackRect.height, left: trackRect.left, top: trackRect.top },
            thumbRect: { w: thumbRect.width, h: thumbRect.height, left: thumbRect.left, top: thumbRect.top },
            inside,
            bgColor: trackStyle.backgroundColor,
          };
        })()
      `);
    };

    // 1. Estado inicial
    let g1 = await evalGeo();
    if (!g1.exists) throw new Error(`Interruptor no encontrado: ${switchName}`);

    // Capturar recorte del botón
    const cap1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, `${switchName}-${g1.checked ? 'active' : 'inactive'}.png`), cap1.toPNG());

    // 2. Click para alternar estado
    await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector(${JSON.stringify(switchSelector)});
        if (btn) btn.click();
      })()
    `);
    await wait(300);

    let g2 = await evalGeo();
    if (!g2.exists) throw new Error(`Interruptor no encontrado tras toggle: ${switchName}`);
    const cap2 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, `${switchName}-${g2.checked ? 'active' : 'inactive'}.png`), cap2.toPNG());

    return { g1, g2 };
  };

  const results = [];

  try {
    // 1. Test Modo Diagnóstico en Ajustes
    console.log('[probe-switches] Evaluando Modo Diagnóstico en #/ajustes...');
    await win.loadURL(`${baseUrl}/#/ajustes`);
    await wait(1500);

    const diagRes = await testSwitchGeometry(
      'button[role="switch"][aria-label="Alternar Modo diagnóstico"]',
      'switch-diagnostico'
    );
    results.push({
      name: 'Modo Diagnóstico (Ajustes)',
      res: diagRes,
    });

    // 2. Test Interruptores en Control Remoto
    console.log('[probe-switches] Transmitiendo estado de reproducción activo...');
    await fetch(`${baseUrl}/api/sync/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'cine-home-1',
        fromDevice: 'screen-probe',
        state: {
          isPlaying: true,
          title: 'Película de Prueba',
          mediaTitle: 'Película de Prueba',
          mediaId: 'm1',
          category: 'movie',
          type: 'movie',
          currentTime: 30,
          duration: 120,
          marathon: false,
          playbackSettings: { autoSkipIntro: false, autoPlayNext: true },
        },
      }),
    });
    await wait(500);

    console.log('[probe-switches] Evaluando Interruptores en #/control...');
    await win.loadURL(`${baseUrl}/?role=remote&room=cine-home-1#/control`);
    await wait(2000);

    const marathonRes = await testSwitchGeometry(
      'button[role="switch"][aria-label="Alternar Modo Maratón"]',
      'switch-maraton'
    );
    results.push({
      name: 'Modo Maratón (Control)',
      res: marathonRes,
    });

    const skipIntroRes = await testSwitchGeometry(
      'button[role="switch"][aria-label="Alternar salto de intro automático"]',
      'switch-saltar-intro'
    );
    results.push({
      name: 'Saltar intro auto (Control)',
      res: skipIntroRes,
    });

    const autoPlayNextRes = await testSwitchGeometry(
      'button[role="switch"][aria-label="Alternar reproducción automática del siguiente capítulo"]',
      'switch-auto-play-next'
    );
    results.push({
      name: 'Siguiente capítulo auto (Control)',
      res: autoPlayNextRes,
    });

    // Reporte
    console.log('\n====================================================================================================');
    console.log('REPORTE GEOMÉTRICO Y VISUAL DE SWITCH.TSX:');
    console.log('----------------------------------------------------------------------------------------------------');
    let allPassed = true;
    for (const r of results) {
      const g1 = r.res.g1;
      const g2 = r.res.g2;
      const passInside = g1.inside && g2.inside;
      const passTouchArea = g1.btnRect.h >= 44 && g1.btnRect.w >= 44;
      const passColor =
        (g1.checked ? g1.bgColor.includes('220') : g1.bgColor.includes('63')) &&
        (g2.checked ? g2.bgColor.includes('220') : g2.bgColor.includes('63'));
      const pass = passInside && passTouchArea && passColor;
      if (!pass) allPassed = false;

      console.log(`- ${r.name}:`);
      console.log(`  Área táctil: ${g1.btnRect.w}x${g1.btnRect.h}px (>=44px: ${passTouchArea})`);
      console.log(`  Estado A (${g1.checked ? 'activo' : 'inactivo'}): bolita adentro: ${g1.inside}, color: ${g1.bgColor}`);
      console.log(`  Estado B (${g2.checked ? 'activo' : 'inactivo'}): bolita adentro: ${g2.inside}, color: ${g2.bgColor}`);
      console.log(`  PASA: ${pass ? 'SI' : 'NO'}`);
    }
    console.log('====================================================================================================\n');

    const files = fs.readdirSync(shotsDir);
    console.log(`Capturas guardadas en scratch/shots/: ${files.length} archivos`);

    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    clearTimeout(globalTimer);
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-switches] Error:', err);
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    clearTimeout(globalTimer);
    app.exit(1);
  }
});
