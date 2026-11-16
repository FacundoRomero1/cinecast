#!/usr/bin/env node
/**
 * scripts/probe-smart-reconnect.cjs
 * Verificación de PARTE 5 (Reconectar solo si hace falta):
 * 1. 10 ciclos de foco/desenfoque con socket sano: 0 reconexiones, 0 joins en el servidor y "chequeo ok" registrado.
 * 2. Página congelada 20 s con CDP y luego activa: 1 sola reconexión en < 3 s.
 * 3. Corte de red de 4 s: 1 reconexión.
 */

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const res = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const globalTimeout = setTimeout(() => {
  console.error('[probe-smart-reconnect] TIMEOUT GLOBAL ALCANZADO (145s)');
  app.exit(1);
}, 145000);

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv('probe-smart-reconnect', {
      env: { CINECAST_TEST: '1' }
    });

    const port = testEnv.port;
    const roomId = testEnv.room;
    const baseUrl = `http://127.0.0.1:${port}`;
    const preloadPath = path.join(__dirname, '../electron/preload.cjs');

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: '127.0.0.1', port }));
    safeHandle('get-diagnostic-mode', () => false);
    safeHandle('set-diagnostic-mode', () => false);
    safeHandle('get-no-cors-fix', () => false);
    safeHandle('check-embed-providers', () => []);
    safeHandle('focus-window', () => true);
    safeHandle('set-master-volume', () => ({ ok: true }));
    safeHandle('get-real-media-state', () => null);

    const screenWin = new BrowserWindow({
      width: 1024,
      height: 768,
      show: false,
      webPreferences: {
        partition: 'persist:probe-sr-screen-' + Date.now(),
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const phoneWin = new BrowserWindow({
      width: 420,
      height: 800,
      show: false,
      webPreferences: {
        partition: 'persist:probe-sr-phone-' + Date.now(),
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    phoneWin.webContents.on('did-start-navigation', (e, url) => console.log('[phoneWin navigation]:', url));
    phoneWin.webContents.on('render-process-gone', (e, details) => console.log('[phoneWin gone]:', details));

    await screenWin.loadURL(`${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`);
    await phoneWin.loadURL(`${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`);

    console.log('[probe-smart-reconnect] Esperando estabilización inicial (5s)...');
    await wait(5000);

    const getPhoneEvents = async () => {
      return await phoneWin.webContents.executeJavaScript(`
        (() => {
          const sync = window.cinecastDeviceSync;
          const tel = sync?.getSyncTelemetrySummary?.() || {};
          return {
            events: sync?.getConnectionEvents() || [],
            reconnectionsCount: tel.reconexiones ?? 0,
            isConnected: Boolean(sync?.isConnected),
          };
        })()
      `).catch(() => ({ events: [], reconnectionsCount: 0, isConnected: false }));
    };

    const results = [];

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: 10 ciclos de foco/desenfoque con socket sano
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: 10 ciclos de foco/desenfoque con socket sano ---');
    const beforeT1 = await getPhoneEvents();
    const joinsBeforeT1 = (beforeT1.events || []).filter((e) => e.event === 'join').length;
    const reconsBeforeT1 = beforeT1.reconnectionsCount;
    console.log('[Test 1 before] joins:', joinsBeforeT1, 'recons:', reconsBeforeT1, 'events count:', beforeT1.events.length);

    for (let i = 1; i <= 10; i++) {
      await phoneWin.webContents.executeJavaScript(`
        window.dispatchEvent(new Event('blur'));
      `);
      await wait(100);
      await phoneWin.webContents.executeJavaScript(`
        window.dispatchEvent(new Event('focus'));
      `);
      await wait(200);
    }

    // Esperar a que el chequeo de 1.5s termine
    console.log('[probe-smart-reconnect] Esperando resolución del chequeo inteligente (2.5s)...');
    await wait(2500);

    const afterT1 = await getPhoneEvents();
    const joinsAfterT1 = (afterT1.events || []).filter((e) => e.event === 'join').length;
    const reconsAfterT1 = afterT1.reconnectionsCount;

    console.log('[Test 1 after] joins:', joinsAfterT1, 'recons:', reconsAfterT1, 'events:', JSON.stringify(afterT1.events));

    const newJoinsT1 = joinsAfterT1 - joinsBeforeT1;
    const newReconsT1 = reconsAfterT1 - reconsBeforeT1;
    const hasChequeoOk = (afterT1.events || []).some((e) => e.reason === 'chequeo ok');

    const t1Pass = newJoinsT1 === 0 && newReconsT1 === 0 && hasChequeoOk && afterT1.isConnected;
    results.push({
      prueba: '1. 10 ciclos foco/desenfoque',
      esperado: '0 reconexiones, 0 joins, chequeo ok',
      obtenido: `${newReconsT1} reconexiones, ${newJoinsT1} joins, chequeo ok=${hasChequeoOk}`,
      pass: t1Pass,
    });
    console.log(`[Test 1] 10 ciclos foco: ${t1Pass ? 'PASA' : 'FALLA'} (Reconexiones: ${newReconsT1}, Joins: ${newJoinsT1}, Chequeo OK: ${hasChequeoOk})`);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Página congelada 20 s con CDP y luego activa
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Página congelada 20 s con CDP y luego activa ---');
    if (!phoneWin.webContents.debugger.isAttached()) {
      phoneWin.webContents.debugger.attach('1.3');
    }
    await phoneWin.webContents.debugger.sendCommand('Page.enable');

    const beforeT2 = await getPhoneEvents();
    const reconsBeforeT2 = beforeT2.reconnectionsCount;
    console.log('[Test 2 before] recons:', reconsBeforeT2);

    console.log('[probe-smart-reconnect] Congelando timers de página 20 s (emulando timer freeze vía CDP Debugger)...');
    await phoneWin.webContents.debugger.sendCommand('Debugger.enable');
    await phoneWin.webContents.debugger.sendCommand('Debugger.pause');
    await wait(20500);

    console.log('[probe-smart-reconnect] Reactivando página y midiendo tiempo de reconexión...');
    const tResume = Date.now();
    await phoneWin.webContents.debugger.sendCommand('Debugger.resume');
    await phoneWin.webContents.executeJavaScript(`
      document.dispatchEvent(new Event('resume'));
    `);

    let t2ReconnectedTimeMs = null;
    for (let i = 0; i < 30; i++) {
      await wait(150);
      const st = await getPhoneEvents();
      if (i < 5 || i % 5 === 0) {
        console.log(`[Test 2 loop ${i}] isConnected=${st.isConnected} recons=${st.reconnectionsCount} (before=${reconsBeforeT2})`);
      }
      if (st.isConnected && st.reconnectionsCount > reconsBeforeT2) {
        t2ReconnectedTimeMs = Date.now() - tResume;
        break;
      }
    }

    const afterT2 = await getPhoneEvents();
    console.log('[Test 2 after events]:', JSON.stringify(afterT2.events));
    const newReconsT2 = afterT2.reconnectionsCount - reconsBeforeT2;
    const t2Pass = newReconsT2 === 1 && typeof t2ReconnectedTimeMs === 'number' && t2ReconnectedTimeMs < 3000;

    results.push({
      prueba: '2. Página congelada 20 s (CDP)',
      esperado: '1 reconexión en < 3 s',
      obtenido: `${newReconsT2} reconexión en ${t2ReconnectedTimeMs ?? '>3000'} ms`,
      pass: t2Pass,
    });
    console.log(`[Test 2] Congelada 20 s: ${t2Pass ? 'PASA' : 'FALLA'} (${newReconsT2} reconexión en ${t2ReconnectedTimeMs} ms)`);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Corte de red de 4 s
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Corte de red de 4 s ---');
    await wait(2000); // Pausa de estabilización
    await phoneWin.webContents.debugger.sendCommand('Network.enable');

    const beforeT3 = await getPhoneEvents();
    const reconsBeforeT3 = beforeT3.reconnectionsCount;

    console.log('[probe-smart-reconnect] Emulando offline durante 4 s...');
    await phoneWin.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await phoneWin.webContents.executeJavaScript(`
      window.dispatchEvent(new Event('offline'));
    `);

    await wait(4200);

    console.log('[probe-smart-reconnect] Restaurando red y disparando online...');
    await phoneWin.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await phoneWin.webContents.executeJavaScript(`
      window.dispatchEvent(new Event('online'));
    `);

    // Esperar a que reconecte
    for (let i = 0; i < 30; i++) {
      await wait(200);
      const st = await getPhoneEvents();
      if (st.isConnected && st.reconnectionsCount > reconsBeforeT3) {
        break;
      }
    }

    const afterT3 = await getPhoneEvents();
    const newReconsT3 = afterT3.reconnectionsCount - reconsBeforeT3;
    const t3Pass = newReconsT3 === 1 && afterT3.isConnected;

    results.push({
      prueba: '3. Corte de red de 4 s',
      esperado: '1 reconexión',
      obtenido: `${newReconsT3} reconexión`,
      pass: t3Pass,
    });
    console.log(`[Test 3] Corte de red 4 s: ${t3Pass ? 'PASA' : 'FALLA'} (${newReconsT3} reconexión)`);

    // ──────────────────────────────────────────────────────────────────────────
    // TABLA FINAL DE RESULTADOS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n=== RESULTADOS PARTE 5: RECONECTAR SOLO SI HACE FALTA ===');
    console.log('| Escenario | Esperado | Resultado obtenido | Estado |');
    console.log('|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.prueba} | ${r.esperado} | ${r.obtenido} | **${r.pass ? 'PASA' : 'FALLA'}** |`);
    }

    const allPassed = results.every((r) => r.pass);
    console.log(`\nRESULTADO GLOBAL: ${allPassed ? 'PASA' : 'FALLA'}`);

    try { phoneWin.webContents.debugger.detach(); } catch (_) {}
    if (testEnv) await testEnv.stop();
    clearTimeout(globalTimeout);
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-smart-reconnect] Error no capturado:', err);
    if (testEnv) await testEnv.stop();
    clearTimeout(globalTimeout);
    app.exit(1);
  }
});
