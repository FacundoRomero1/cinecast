#!/usr/bin/env node
/**
 * scripts/probe-server-latency.cjs
 * Verifica PARTE 4 ("Medir servidores"):
 *  - Lista de servidores en VideoPlayer [Slow 1.2s, Timeout >8s, Fast 200] en orden intencionalmente no-óptimo.
 *  - Botón "Medir servidores" en Ajustes > Diagnóstico ejecuta net.request EN SERIE con timeout de 8 s.
 *  - Verifica tabla copiable + botón "Copiar tabla" y que NO cambia ni reordena la lista del reproductor.
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, session, webContents, net } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { startTestEnv } = require('./lib/testenv.cjs');
const { createLoadDiagnosticsManager } = require('../electron/loadDiagnostics.cjs');

let testEnv = null;
let mockServer = null;
let mainWin = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});

const globalTimer = setTimeout(() => {
  console.error('[probe-server-latency] TIMEOUT GLOBAL (145s)');
  if (mockServer) try { mockServer.close(); } catch (_) {}
  if (testEnv) try { testEnv.stop(); } catch (_) {}
  app.exit(1);
}, 145000);

async function run() {
  try {
    // Servidor HTTP local mock con 3 comportamiento distintos (lento 1.2s, cuelga >8s, rápido 200)
    mockServer = http.createServer((req, res) => {
      if (req.url.startsWith('/slow')) {
        setTimeout(() => {
          if (!res.destroyed) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>slow ok</body></html>');
          }
        }, 1200);
        return;
      }
      if (req.url.startsWith('/hang')) {
        // Nunca responde headers antes del timeout de 8s (cierra a los 15s para no colgar exit)
        const hangTimer = setTimeout(() => {
          try { if (!res.destroyed) res.end(); } catch (_) {}
        }, 15000);
        req.on('close', () => clearTimeout(hangTimer));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>fast ok</body></html>');
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const mockPort = mockServer.address().port;
    const mockBase = `http://127.0.0.1:${mockPort}`;

    testEnv = await startTestEnv('probe-server-latency');
    const baseUrl = `http://127.0.0.1:${testEnv.port}`;
    const room = testEnv.room;

    await app.whenReady();

    const loadDiag = createLoadDiagnosticsManager({
      app,
      session,
      webContents,
      net,
      getMainWindow: () => mainWin,
    });
    loadDiag.registerIpcHandlers(ipcMain);

    // Handlers mínimos esperados por NewApp/VideoPlayer
    const mockHandlers = {
      'get-local-ip': () => ({ ip: testEnv.lanIp || '127.0.0.1', port: testEnv.port }),
      'get-diagnostic-mode': () => false,
      'set-diagnostic-mode': () => false,
      'get-no-cors-fix': () => false,
      'set-no-cors-fix': () => false,
      'get-compatibility-mode': () => false,
      'set-compatibility-mode': () => false,
      'get-saved-accounts': () => ({ accounts: [], playlists: [], favorites: [] }),
      'get-detected-tracks': () => null,
      'get-real-media-state': () => null,
      'control-active-media': () => ({ ok: true }),
      'send-native-key': () => true,
      'send-key-to-webview': () => true,
      'set-master-volume': () => ({ ok: true }),
      'check-embed-providers': () => [],
      'probe-streams': () => ({}),
      'set-stream-headers': () => true,
      'simulate-play-click': () => true,
      'set-resume-active': () => true,
      'focus-window': () => true,
      'get-perf-snapshot': () => ({ counters: {}, config: {} }),
      'set-perf-config': () => ({}),
    };
    for (const [ch, fn] of Object.entries(mockHandlers)) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, fn);
    }

    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    mainWin = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    await mainWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(room)}`);
    await wait(2500);

    const expectedOrder = ['Mock Slow 1.2s', 'Mock Timeout >8s', 'Mock Fast 200'];
    const customMedia = {
      id: 'movie-latency-probe',
      tmdbId: 551,
      title: 'Película Prueba Servidores',
      type: 'movie',
      category: 'movie',
      streamType: 'iframe',
      servers: [
        { name: expectedOrder[0], url: `${mockBase}/slow`, type: 'iframe', language: 'Latino' },
        { name: expectedOrder[1], url: `${mockBase}/hang`, type: 'iframe', language: 'Latino' },
        { name: expectedOrder[2], url: `${mockBase}/fast`, type: 'iframe', language: 'Sub' },
      ],
    };

    // Lanzar reproducción desde el comando remoto para poblar VideoPlayer y su lista de servidores
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room,
        command: {
          id: `cmd-latency-${Date.now()}`,
          action: 'playDiscoveredMovie',
          payload: customMedia,
          issuedAt: Date.now(),
        },
      }),
    });

    // Esperar a que VideoPlayer se monte y sincronice su lista exacta de servidores
    let playerButtonsBefore = [];
    for (let i = 0; i < 30; i++) {
      await wait(250);
      const info = await mainWin.webContents.executeJavaScript(`
        (() => {
          const btns = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
          return btns.filter((t) => t.includes('Mock Slow') || t.includes('Mock Timeout') || t.includes('Mock Fast'));
        })()
      `).catch(() => []);
      if (info && info.length >= 3) {
        playerButtonsBefore = info;
        break;
      }
    }

    const storedServersBefore = loadDiag.getPlayerServers().servers;
    const orderMatchesBefore =
      storedServersBefore.length === 3 &&
      storedServersBefore.map((s) => s.name).join('|') === expectedOrder.join('|');

    // Salir del reproductor hacia #/ajustes (preservando la instantánea de servidores) y clickear "Medir servidores"
    await mainWin.webContents.executeJavaScript(`
      (() => {
        const backBtn = document.querySelector('button[title="Volver atrás"]');
        if (backBtn) backBtn.click();
      })()
    `);
    await wait(500);

    await mainWin.webContents.executeJavaScript(`
      (() => {
        const link = document.querySelector('a[href="#/ajustes"]');
        if (link) link.click();
        else window.location.hash = '#/ajustes';
      })()
    `);

    let diagReady = false;
    for (let i = 0; i < 20; i++) {
      await wait(250);
      diagReady = await mainWin.webContents.executeJavaScript(`
        Boolean(document.querySelector('[data-testid="btn-measure-servers"]'))
      `).catch(() => false);
      if (diagReady) break;
    }

    const measureStartAt = Date.now();
    const clicked = await mainWin.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-measure-servers"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);

    if (!clicked) {
      throw new Error('No se encontró el botón [data-testid="btn-measure-servers"] en Ajustes > Diagnóstico');
    }

    // Esperar hasta que termine la medición serializada (~1.2s + 8.0s + 0.01s = ~9.2s)
    let tableValue = '';
    for (let i = 0; i < 60; i++) {
      await wait(400);
      const state = await mainWin.webContents.executeJavaScript(`
        (() => {
          const ta = document.querySelector('[data-testid="server-latency-table"]');
          const btn = document.querySelector('[data-testid="btn-measure-servers"]');
          return {
            table: ta ? ta.value : '',
            disabled: btn ? btn.disabled : false,
          };
        })()
      `).catch(() => ({ table: '', disabled: true }));
      if (state.table && !state.disabled) {
        tableValue = state.table;
        break;
      }
    }
    const elapsedTotalMs = Date.now() - measureStartAt;

    // Probar botón "Copiar tabla" sin bloquear por alert()
    await mainWin.webContents.executeJavaScript(`
      (() => {
        const copyBtn = document.querySelector('[data-testid="btn-copy-server-latency"]');
        if (copyBtn) copyBtn.click();
      })()
    `);
    await wait(150);
    const copyLabel = await mainWin.webContents.executeJavaScript(`
      document.querySelector('[data-testid="btn-copy-server-latency"]')?.textContent || ''
    `).catch(() => '');

    // Reabrir película y confirmar que VideoPlayer conserva EXACTAMENTE el mismo orden y lista sin reordenar
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room,
        command: {
          id: `cmd-latency-after-${Date.now()}`,
          action: 'playDiscoveredMovie',
          payload: customMedia,
          issuedAt: Date.now(),
        },
      }),
    });

    let playerButtonsAfter = [];
    for (let i = 0; i < 30; i++) {
      await wait(250);
      const info = await mainWin.webContents.executeJavaScript(`
        (() => {
          const btns = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
          return btns.filter((t) => t.includes('Mock Slow') || t.includes('Mock Timeout') || t.includes('Mock Fast'));
        })()
      `).catch(() => []);
      if (info && info.length >= 3) {
        playerButtonsAfter = info;
        break;
      }
    }

    const storedServersAfter = loadDiag.getPlayerServers().servers;
    const orderPreservedAfter =
      storedServersAfter.length === 3 &&
      storedServersAfter.map((s) => s.name).join('|') === expectedOrder.join('|') &&
      playerButtonsAfter.slice(0, 3).map((s) => expectedOrder.find((n) => s.includes(n))).join('|') === expectedOrder.join('|');

    const lines = tableValue.split('\n').filter((l) => /^\d+\s+\|/.test(l));
    const hasSlow = lines[0] && lines[0].includes('Mock Slow 1.2s') && lines[0].includes('OK (200)');
    const hasTimeout = lines[1] && lines[1].includes('Mock Timeout >8s') && lines[1].includes('timeout_8000ms');
    const hasFast = lines[2] && lines[2].includes('Mock Fast 200') && lines[2].includes('OK (200)');
    const serializedTimingOk = elapsedTotalMs >= 9000 && elapsedTotalMs <= 13500;

    const pass =
      orderMatchesBefore &&
      Boolean(hasSlow) &&
      Boolean(hasTimeout) &&
      Boolean(hasFast) &&
      serializedTimingOk &&
      orderPreservedAfter &&
      !tableValue.includes('[object Object]');

    const report = [
      '=== PROBE SERVER LATENCY (Medir servidores - net.request en serie, 8 s timeout) ===',
      `orderMatchesBefore=${orderMatchesBefore} playerButtonsBefore=${JSON.stringify(playerButtonsBefore)}`,
      `elapsedTotalMs=${elapsedTotalMs} serializedTimingOk=${serializedTimingOk}`,
      `hasSlow=${Boolean(hasSlow)} hasTimeout=${Boolean(hasTimeout)} hasFast=${Boolean(hasFast)}`,
      `orderPreservedAfter=${orderPreservedAfter} copyBtn="${copyLabel}"`,
      '',
      tableValue || '(sin tabla)',
      '',
      `RESULTADO: ${pass ? 'PASA' : 'FALLA'}`,
    ].join('\n');

    console.log(report);
    const logDir = path.join(__dirname, '..', 'scratch', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'probe-server-latency.log'), report + '\n', 'utf8');

    clearTimeout(globalTimer);
    mainWin.destroy();
    if (mockServer) mockServer.close();
    await testEnv.stop();
    app.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-server-latency] Error:', err);
    clearTimeout(globalTimer);
    if (mockServer) try { mockServer.close(); } catch (_) {}
    if (testEnv) await testEnv.stop().catch(() => {});
    app.exit(1);
  }
}

run();
