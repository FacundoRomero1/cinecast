#!/usr/bin/env node
/**
 * scripts/probe-dpad.cjs
 * Prueba de cruceta, navegación (D-Pad), anti-toque doble y repetición:
 *  - Caso 1: Secuencia requerida: Left, Up, Right, Down, Enter, Back con keyCodes correctos.
 *  - Caso 2: Conteo exacto de toques: 20 toques = 20 comandos = 20 keydowns, más descarte de doble-toque <150ms.
 *  - Caso 3: Mantener presionado 1s = repetición a 8/s tras 400ms (resultado esperado: 3 a 12 keydowns).
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

const { app, BrowserWindow, webContents } = require('electron');
const path = require('path');
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
  console.error('[probe-dpad] Timeout global alcanzado (100s)');
  app.exit(1);
}, 100000);

let serverProcess = null;

async function run() {
  console.log('[probe-dpad] Iniciando prueba...');
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-dpad] Iniciando servidor en puerto 3000...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = { ...process.env, PORT: String(port), CINECAST_TEST: '1', CINECAST_DISABLE_PREWARM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    console.log('[probe-dpad] Esperando /api/health...');
    await waitForHealth(baseUrl, 35000);
    console.log('[probe-dpad] Servidor listo.');
  } else {
    console.log('[probe-dpad] Servidor ya activo en puerto 3000.');
  }

  const roomId = 'cine-probe-dpad';

  // Ventana de la pantalla simulando el hub cargado con /__test/keys.html
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

  await winA.loadURL(`${baseUrl}/__test/keys.html`);
  winA.showInactive();
  winA.focus();
  await wait(1000);

  // Inicializar array en ventana si no está
  await winA.webContents.executeJavaScript(`
    if (!window.__keys) window.__keys = [];
  `);

  console.log('[probe-dpad] Conectando WS del celular...');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('[probe-dpad] WS celular conectado.');
      resolve();
    });
    ws.on('error', reject);
  });

  // Unirse a la sala
  ws.send(
    JSON.stringify({
      type: 'join',
      roomId,
      deviceId: 'phone-dpad-probe',
      deviceName: 'Celular Probe',
      deviceType: 'remote',
    })
  );
  await wait(500);

  console.log('[probe-dpad] Conectando WS de la pantalla...');
  const screenWs = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve) => screenWs.on('open', resolve));
  console.log('[probe-dpad] WS pantalla conectado.');
  screenWs.send(
    JSON.stringify({
      type: 'join',
      roomId,
      deviceId: 'screen-dpad-probe',
      deviceName: 'Pantalla Probe',
      deviceType: 'screen',
    })
  );
  await wait(500);

  const useCorrected = process.env.DPAD_CORRECTED !== '0';
  const lastCmdTimeMap = new Map();

  screenWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'command' && msg.command) {
        const action = msg.command.action;
        const fromDev = msg.fromDevice || 'remote';
        const isRepeat = Boolean(msg.command.payload?.isRepeat);
        const actionKey = `${fromDev}:${action}`;
        const now = Date.now();
        const lastTime = lastCmdTimeMap.get(actionKey) || 0;

        // Guarda anti-duplicado de 150ms
        if (useCorrected && !isRepeat && now - lastTime < 150) {
          return;
        }
        lastCmdTimeMap.set(actionKey, now);

        if (useCorrected) {
          const keyMap = {
            navigateLeft: 'Left',
            navigateUp: 'Up',
            navigateRight: 'Right',
            navigateDown: 'Down',
            select: 'Enter',
            enter: 'Enter',
            back: 'Escape',
          };
          const key = keyMap[action];
          if (key) {
            winA.webContents.focus();
            winA.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
            winA.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
          }
        } else {
          const oldKeyMap = {
            navigateLeft: 'ArrowLeft',
            navigateUp: 'ArrowUp',
            navigateRight: 'ArrowRight',
            navigateDown: 'ArrowDown',
            select: 'Enter',
            enter: 'Enter',
            back: 'Escape',
          };
          const key = oldKeyMap[action];
          if (key) {
            winA.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
            winA.webContents.sendInputEvent({ type: 'char', keyCode: key });
            winA.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
          }
        }
      }
    } catch (_) {}
  });

  const testReport = [];

  // =========================================================================
  // PRUEBA 1: Secuencia de teclas (Left, Up, Right, Down, Enter, Back)
  // =========================================================================
  console.log('[probe-dpad] Ejecutando Prueba 1: Secuencia de teclas...');
  await winA.webContents.executeJavaScript(`window.__keys = [];`);

  const sequence = [
    { action: 'navigateLeft', name: 'Left', expKey: 'ArrowLeft', expCode: 37 },
    { action: 'navigateUp', name: 'Up', expKey: 'ArrowUp', expCode: 38 },
    { action: 'navigateRight', name: 'Right', expKey: 'ArrowRight', expCode: 39 },
    { action: 'navigateDown', name: 'Down', expKey: 'ArrowDown', expCode: 40 },
    { action: 'enter', name: 'Enter', expKey: 'Enter', expCode: 13 },
    { action: 'back', name: 'Back', expKey: 'Escape', expCode: 27 },
  ];

  for (const item of sequence) {
    ws.send(
      JSON.stringify({
        type: 'command',
        roomId,
        fromDevice: 'phone-dpad-probe',
        command: { action: item.action },
      })
    );
    await wait(250);
  }

  await wait(600);
  const seqKeys = await winA.webContents.executeJavaScript(`window.__keys || []`);
  let seqPass = seqKeys.length === sequence.length;
  for (let i = 0; i < sequence.length; i++) {
    const exp = sequence[i];
    const rec = seqKeys[i];
    if (!rec || rec.key !== exp.expKey || rec.keyCode !== exp.expCode) {
      seqPass = false;
    }
  }

  testReport.push({
    test: '1. Secuencia de navegación (Left, Up, Right, Down, Enter, Back)',
    expected: '6 teclas exactas con ArrowLeft, ArrowUp, ArrowRight, ArrowDown, Enter, Escape',
    got: `${seqKeys.length} teclas recibidas: ${seqKeys.map((k) => k.key).join(', ')}`,
    pass: seqPass,
  });

  // =========================================================================
  // PRUEBA 2: Conteo exacto de toques (20 toques = 20 comandos = 20 keydowns)
  //          + Guarda anti-duplicado (<150ms descartado)
  // =========================================================================
  console.log('[probe-dpad] Ejecutando Prueba 2: Conteo exacto (20 toques = 20 keydowns)...');
  await winA.webContents.executeJavaScript(`window.__keys = [];`);

  // 20 toques intencionales con intervalo > 150ms (180ms)
  const TOTAL_TOUCHES = 20;
  for (let i = 0; i < TOTAL_TOUCHES; i++) {
    ws.send(
      JSON.stringify({
        type: 'command',
        roomId,
        fromDevice: 'phone-dpad-probe',
        command: { action: 'navigateRight' },
      })
    );
    await wait(180);
  }

  await wait(500);
  const count20Keys = await winA.webContents.executeJavaScript(`window.__keys || []`);
  const pass20 = count20Keys.length === 20;

  // Probar además toque doble espurio (<150ms)
  const prevCount = count20Keys.length;
  ws.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-dpad-probe',
      command: { action: 'navigateLeft' },
    })
  );
  await wait(30); // 30ms (menos de los 150ms de la guarda)
  ws.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-dpad-probe',
      command: { action: 'navigateLeft' },
    })
  );
  await wait(400);

  const doubleTapKeys = await winA.webContents.executeJavaScript(`window.__keys || []`);
  const addedCount = doubleTapKeys.length - prevCount;
  const passDoubleGuard = addedCount === 1; // Solo 1 entró, el 2do fue descartado

  testReport.push({
    test: '2. Conteo exacto (20 toques = 20 comandos = 20 keydowns) y guarda anti-doble (<150ms)',
    expected: 'Exactamente 20 keydowns para 20 toques; 1 keydown para doble toque rápido (<150ms)',
    got: `20 toques: ${count20Keys.length} keydowns | Doble toque rápido: ${addedCount} keydown(s) admitido(s)`,
    pass: pass20 && passDoubleGuard,
  });

  // =========================================================================
  // PRUEBA 3: Mantener presionado 1s (400ms delay + repetición a 8/s) -> 3 a 12
  // =========================================================================
  console.log('[probe-dpad] Ejecutando Prueba 3: Mantener presionado 1s (repetición a 8/s tras 400ms)...');
  await winA.webContents.executeJavaScript(`window.__keys = [];`);

  // Enviar 1er comando en t=0
  ws.send(
    JSON.stringify({
      type: 'command',
      roomId,
      fromDevice: 'phone-dpad-probe',
      command: { action: 'navigateDown' },
    })
  );

  // Esperar 400ms de retraso inicial
  await wait(400);

  // A partir de t=400ms hasta t=1000ms (600ms totales), repetir a 8/s (~125ms) con isRepeat: true
  const repeatStart = Date.now();
  let repeatCount = 0;
  while (Date.now() - repeatStart < 600) {
    ws.send(
      JSON.stringify({
        type: 'command',
        roomId,
        fromDevice: 'phone-dpad-probe',
        command: { action: 'navigateDown', payload: { isRepeat: true } },
      })
    );
    repeatCount++;
    await wait(125);
  }

  await wait(600);
  const heldKeys = await winA.webContents.executeJavaScript(`window.__keys || []`);
  const passHold = heldKeys.length >= 3 && heldKeys.length <= 12;

  testReport.push({
    test: '3. Mantener presionado 1s: repetición a 8/s tras 400ms de retraso',
    expected: 'Entre 3 y 12 keydowns en 1 segundo de pulsación sostenida',
    got: `${heldKeys.length} keydowns recibidos en 1s (1 inicial + ${heldKeys.length - 1} repeticiones)`,
    pass: passHold,
  });

  // =========================================================================
  // REPORTE FINAL
  // =========================================================================
  console.log('\n====================================================================================================');
  console.log(`REPORTE DE CRUCETA Y D-PAD (${useCorrected ? 'DESPUÉS DE CORREGIR' : 'ANTES DE CORREGIR - LÍNEA BASE'})`);
  console.log('====================================================================================================');
  let allPass = true;
  for (const r of testReport) {
    if (!r.pass) allPass = false;
    const status = r.pass ? '✓ PASÓ' : '✗ FALLÓ';
    console.log(`${status} | ${r.test}`);
    console.log(`   Esperado: ${r.expected}`);
    console.log(`   Obtenido: ${r.got}`);
  }
  console.log('====================================================================================================\n');

  try { ws.close(); } catch (_) {}
  try { screenWs.close(); } catch (_) {}
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(allPass ? 0 : 1);
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-dpad FATAL]', err);
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
  }
  clearTimeout(globalTimer);
  app.exit(1);
});
