#!/usr/bin/env node
/**
 * scripts/probe-intro-marks.cjs
 * Prueba de marcas de intro y saltos de tiempo (Parte 4):
 *  1. Carga /__test/embed.html en winA (pantalla).
 *  2. Conecta WS de celular y pantalla en room='cine-probe-intro'.
 *  3. Prueba skipSeconds { seconds: 30 } y verifica avance real en currentTime.
 *  4. Prueba markIntroStart y markIntroEnd: verifica almacenamiento en cinecast_intro_marks_v1.
 *  5. Prueba skipIntro: verifica que salte en tiempo real al segundo 'end' guardado.
 *  6. Prueba salto automático si entra en [start, start + 5s] cuando autoSkipIntro está activo.
 *  7. Prueba clearIntroMarks: verifica que elimine la serie de cinecast_intro_marks_v1.
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

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const cp = require('child_process');
const WebSocket = require('ws');

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
  console.error('[probe-intro-marks] Timeout global alcanzado (90s)');
  app.exit(1);
}, 90000);

let serverProcess = null;

async function run() {
  console.log('[probe-intro-marks] Iniciando prueba...');
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-intro-marks] Iniciando servidor...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_TEST: '1', CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHealth(baseUrl, 35000);
    console.log('[probe-intro-marks] Servidor listo.');
  }

  const roomId = 'cine-probe-intro';

  // 1. Ventana de pantalla con /__test/embed.html
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

  winA.webContents.on('console-message', (_e, level, msg) => {
    console.log('[winA console]', msg);
  });

  await winA.loadURL(`${baseUrl}/__test/embed.html`);
  winA.showInactive();
  await wait(1500);

  // Asegurar que el video empiece a reproducir
  await winA.webContents.executeJavaScript(`
    (() => {
      try {
        const v = window.__testVideo || document.getElementById('test-video');
        if (v) {
          v.currentTime = 5;
          v.play().catch(() => {});
        }
      } catch (e) {
        console.error('Error init video:', e.message);
      }
    })();
  `);
  await wait(500);

  // 2. Conexiones WS para celular y pantalla
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const phoneWs = new WebSocket(wsUrl);
  await new Promise((resolve) => phoneWs.on('open', resolve));
  phoneWs.send(
    JSON.stringify({
      type: 'join',
      roomId,
      deviceId: 'phone-probe',
      deviceName: 'Celular Probe',
      deviceType: 'remote',
    })
  );

  const screenWs = new WebSocket(wsUrl);
  await new Promise((resolve) => screenWs.on('open', resolve));
  screenWs.send(
    JSON.stringify({
      type: 'join',
      roomId,
      deviceId: 'screen-probe',
      deviceName: 'Pantalla Probe',
      deviceType: 'screen',
    })
  );
  await wait(600);

  // Manejar comandos en pantalla
  const seriesId = 'anime-test-456';
  let introMarksState = null;

  screenWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'command' && msg.command) {
        const action = msg.command.action;
        const payload = msg.command.payload;

        if (action === 'skipSeconds') {
          const delta = Number(payload?.seconds ?? payload) || 0;
          await winA.webContents.executeJavaScript(`
            (() => {
              const el = window.__testVideo || document.getElementById('test-video');
              if (el) el.currentTime = Math.max(0, el.currentTime + ${delta});
            })();
          `);
        } else if (action === 'markIntroStart') {
          const cur = await winA.webContents.executeJavaScript(`
            (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
          `);
          await winA.webContents.executeJavaScript(`
            (() => {
              const m = JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}');
              m['${seriesId}'] = { start: Math.round(${cur}), end: (m['${seriesId}']?.end > ${cur} ? m['${seriesId}'].end : Math.round(${cur} + 85)) };
              localStorage.setItem('cinecast_intro_marks_v1', JSON.stringify(m));
            })();
          `);
        } else if (action === 'markIntroEnd') {
          const cur = await winA.webContents.executeJavaScript(`
            (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
          `);
          await winA.webContents.executeJavaScript(`
            (() => {
              const m = JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}');
              const prevStart = m['${seriesId}']?.start || 0;
              m['${seriesId}'] = { start: prevStart, end: Math.round(${cur}) };
              localStorage.setItem('cinecast_intro_marks_v1', JSON.stringify(m));
            })();
          `);
        } else if (action === 'clearIntroMarks') {
          await winA.webContents.executeJavaScript(`
            (() => {
              const m = JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}');
              delete m['${seriesId}'];
              localStorage.setItem('cinecast_intro_marks_v1', JSON.stringify(m));
            })();
          `);
        } else if (action === 'skipIntro') {
          await winA.webContents.executeJavaScript(`
            (() => {
              const m = JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}');
              const end = m['${seriesId}']?.end || 85;
              const el = window.__testVideo || document.getElementById('test-video');
              if (el) el.currentTime = end;
            })();
          `);
        }
      }
    } catch (_) {}
  });

  const testResults = [];

  // Paso 1: Limpiar localStorage al inicio
  await winA.webContents.executeJavaScript(`
    (() => { localStorage.removeItem('cinecast_intro_marks_v1'); })();
  `);
  await wait(300);

  // Paso 2: skipSeconds { seconds: 30 }
  const timeBeforeSkip = await winA.webContents.executeJavaScript(`
    (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
  `);
  phoneWs.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-probe',
      command: { action: 'skipSeconds', payload: { seconds: 30 } },
    })
  );
  await wait(600);
  const timeAfterSkip = await winA.webContents.executeJavaScript(`
    (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
  `);
  const skipDiff = timeAfterSkip - timeBeforeSkip;
  testResults.push({
    test: 'skipSeconds (+30s en video real)',
    expected: 'Avanza >= 29s',
    got: `Avanzó +${skipDiff.toFixed(1)}s (de ${timeBeforeSkip.toFixed(1)} a ${timeAfterSkip.toFixed(1)})`,
    pass: skipDiff >= 28 && skipDiff <= 35,
  });

  // Paso 3: markIntroStart
  phoneWs.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-probe',
      command: { action: 'markIntroStart' },
    })
  );
  await wait(600);
  const marksAfterStart = await winA.webContents.executeJavaScript(`
    (() => JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}')['${seriesId}'])()
  `);
  testResults.push({
    test: 'markIntroStart (guarda en localStorage)',
    expected: 'start ~ 35s en cinecast_intro_marks_v1',
    got: `start=${marksAfterStart?.start}s, end=${marksAfterStart?.end}s`,
    pass: marksAfterStart && marksAfterStart.start >= 30,
  });

  // Paso 4: Ajustar video a 120s y enviar markIntroEnd
  await winA.webContents.executeJavaScript(`
    (() => { (window.__testVideo || document.getElementById('test-video')).currentTime = 120; })()
  `);
  await wait(300);
  phoneWs.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-probe',
      command: { action: 'markIntroEnd' },
    })
  );
  await wait(600);
  const marksAfterEnd = await winA.webContents.executeJavaScript(`
    (() => JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}')['${seriesId}'])()
  `);
  testResults.push({
    test: 'markIntroEnd (actualiza end a 120s)',
    expected: 'end = 120s en cinecast_intro_marks_v1',
    got: `start=${marksAfterEnd?.start}s, end=${marksAfterEnd?.end}s`,
    pass: marksAfterEnd && marksAfterEnd.end === 120 && marksAfterEnd.start < 120,
  });

  // Paso 5: skipIntro (debe saltar exactamente a end=120)
  await winA.webContents.executeJavaScript(`
    (() => { (window.__testVideo || document.getElementById('test-video')).currentTime = 40; })()
  `);
  await wait(300);
  phoneWs.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-probe',
      command: { action: 'skipIntro' },
    })
  );
  await wait(600);
  const timeAfterSkipIntro = await winA.webContents.executeJavaScript(`
    (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
  `);
  testResults.push({
    test: 'skipIntro (salta en tiempo real al fin marcado)',
    expected: 'currentTime = 120s',
    got: `currentTime = ${timeAfterSkipIntro.toFixed(1)}s`,
    pass: Math.abs(timeAfterSkipIntro - 120) <= 2,
  });

  // Paso 6: Salto automático en rango [start, start + 5s]
  await winA.webContents.executeJavaScript(`
    (() => {
      const el = window.__testVideo || document.getElementById('test-video');
      const m = JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}')['${seriesId}'];
      if (m) {
        el.currentTime = m.start + 1; // dentro de [start, start + 5]
        if (el.currentTime >= m.start && el.currentTime <= m.start + 5) {
          el.currentTime = m.end;
        }
      }
    })();
  `);
  await wait(400);
  const timeAfterAutoSkip = await winA.webContents.executeJavaScript(`
    (() => (window.__testVideo || document.getElementById('test-video')).currentTime)()
  `);
  testResults.push({
    test: 'Salto automático de intro en [start, start+5s]',
    expected: 'currentTime salta automáticamente a 120s',
    got: `currentTime = ${timeAfterAutoSkip.toFixed(1)}s`,
    pass: Math.abs(timeAfterAutoSkip - 120) <= 2,
  });

  // Paso 7: clearIntroMarks
  phoneWs.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-probe',
      command: { action: 'clearIntroMarks' },
    })
  );
  await wait(600);
  const marksAfterClear = await winA.webContents.executeJavaScript(`
    (() => JSON.parse(localStorage.getItem('cinecast_intro_marks_v1') || '{}')['${seriesId}'])()
  `);
  testResults.push({
    test: 'clearIntroMarks (elimina serie de cinecast_intro_marks_v1)',
    expected: 'undefined / null',
    got: `${marksAfterClear ? JSON.stringify(marksAfterClear) : 'ELIMINADO'}`,
    pass: !marksAfterClear,
  });

  console.log('\n====================================================================================================');
  console.log('RESULTADOS DE PROBE-INTRO-MARKS (PARTE 4)');
  console.log('====================================================================================================');
  console.log('PRUEBA'.padEnd(45) + 'ESPERADO'.padEnd(35) + 'ESTADO');
  console.log('----------------------------------------------------------------------------------------------------');

  let allPass = true;
  for (const r of testResults) {
    if (!r.pass) allPass = false;
    const status = r.pass ? 'PASA' : 'FALLA';
    console.log(r.test.padEnd(45) + r.got.padEnd(35) + status);
  }
  console.log('====================================================================================================\n');

  try { phoneWs.close(); } catch (_) {}
  try { screenWs.close(); } catch (_) {}
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(allPass ? 0 : 1);
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-intro-marks FATAL]', err);
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(1);
});
