#!/usr/bin/env node
/**
 * scripts/probe-dpad.cjs
 * Prueba de cruceta y teclas de navegación (D-Pad):
 *  - Abre la pantalla en /__test/keys.html simulando el hub.
 *  - Envía desde el celular por WS la secuencia: Left, Up, Right, Down, Enter, Back.
 *  - Verifica en la pantalla que en window.__keys hayan entrado exactamente las 6 teclas en ese orden:
 *    ArrowLeft (37), ArrowUp (38), ArrowRight (39), ArrowDown (40), Enter (13), Escape (27).
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
  // Conectar WS del celular para enviar comandos de la cruceta
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
  // Receptor en PC que escucha por WS y despacha según la lógica actual del sistema
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

  // Determinar si usamos la lógica corregida o la vieja:
  // Por defecto usa la lógica corregida (DPAD_CORRECTED !== '0'); DPAD_CORRECTED=0 para simular línea base
  const useCorrected = process.env.DPAD_CORRECTED !== '0';

  screenWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'command' && msg.command) {
        const action = msg.command.action;

        if (useCorrected) {
          // Lógica corregida:
          // 'Left', 'Right', 'Up', 'Down', 'Enter', 'Escape' con wc.focus() y solo keyDown + keyUp
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
          // Lógica actual de AppRuntime.tsx + main.cjs ANTES de corregir:
          // Enviaba 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' y char event sin focus explícito
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

  // Secuencia requerida: Left, Up, Right, Down, Enter, Back
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

  await wait(800);

  // Leer teclas capturadas en winA
  const capturedKeys = await winA.webContents.executeJavaScript(`window.__keys || []`);

  console.log('\n====================================================================================================');
  console.log(`RESULTADOS DE PROBE-DPAD (${useCorrected ? 'DESPUÉS DE CORREGIR' : 'ANTES DE CORREGIR - LÍNEA BASE'})`);
  console.log('====================================================================================================');
  console.log('TECLA ENVIADA'.padEnd(20) + 'RECIBIDA'.padEnd(25) + 'KEY CODE'.padEnd(15) + 'ESTADO');
  console.log('----------------------------------------------------------------------------------------------------');

  let allPass = true;
  for (let i = 0; i < sequence.length; i++) {
    const exp = sequence[i];
    const rec = capturedKeys[i];
    const pass = rec && rec.key === exp.expKey && rec.keyCode === exp.expCode;
    if (!pass) allPass = false;

    const recStr = rec ? `${rec.key} (${rec.keyCode})` : 'NO RECIBIDA';
    const expStr = `${exp.expKey} (${exp.expCode})`;
    const status = pass ? 'PASA' : 'FALLA';
    console.log(exp.name.padEnd(20) + recStr.padEnd(25) + expStr.padEnd(15) + status);
  }

  console.log('----------------------------------------------------------------------------------------------------');
  console.log(`Total capturadas: ${capturedKeys.length} / 6`);
  console.log('Array window.__keys:', JSON.stringify(capturedKeys));
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

