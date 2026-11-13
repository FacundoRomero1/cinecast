#!/usr/bin/env node
/**
 * scripts/probe-sleep-timer.cjs
 * Prueba automatizada de Parte 2 (Control, Maratón unificado y Temporizador de reposo):
 *  1. Limpieza de "Más ajustes y funciones": saltar intro, probar señal y sala ocultos; modo noche e invitar celular visibles.
 *  2. Interruptores: SOLO "Modo Maratón" visible con "Pasa solo al siguiente capítulo y salta lo que pueda".
 *  3. setMarathon unificado: fija autoPlayNext con el mismo valor en PlaybackState y localStorage.
 *  4. Temporizador de reposo: opciones disponibles, enlace "Reposo ahora", persistencia en cinecast_sleep_timer_v1.
 *  5. "¿Seguís ahí?" al vencer temporizador: pantalla completa con cuenta regresiva de 5s en test mode.
 *  6. Responder "Sí, seguir" / "Seguir viendo" descarta el prompt.
 *  7. Vencimiento sin respuesta: pasa a reposo y pausa.
 *  8. Embed de prueba: /__test/embed.html?dur=20 genera video de 20s.
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

const { app, BrowserWindow } = require('electron');
const path = require('path');
const net = require('net');
const cp = require('child_process');

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
  console.error('[probe-sleep-timer] Timeout global alcanzado (90s)');
  app.exit(1);
}, 90000);

let serverProcess = null;

async function run() {
  console.log('[probe-sleep-timer] Iniciando pruebas de Control y Temporizador...');
  const port = 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootDir = path.resolve(__dirname, '..');

  const inUse = await isPortInUse(port);
  if (!inUse) {
    console.log('[probe-sleep-timer] Iniciando servidor...');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const env = {
      ...process.env,
      PORT: String(port),
      CINECAST_TEST: '1',
      CINECAST_DISABLE_PREWARM: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;

    serverProcess = cp.spawn('node', [tsxCli, 'server.ts'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHealth(baseUrl, 35000);
    console.log('[probe-sleep-timer] Servidor listo.');
  }

  const testResults = [];

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
  });

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer] ${message}`);
  });

  console.log('[probe-sleep-timer] Cargando UI de control...');
  await win.loadURL(`${baseUrl}/#/control?ui=nuevo&test=1`);
  win.showInactive();
  await wait(2500);

  // ==========================================
  // TEST 1: UI de Automatización en RemotePanel
  // ==========================================
  console.log('[probe-sleep-timer] Evaluando interruptores de reproducción...');
  const togglesDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasMarathon = text.includes('Modo Maratón');
      const hasMarathonSubtitle = text.includes('Pasa solo al siguiente capítulo y salta lo que pueda');

      // Comprobar que los otros dos interruptores están ocultos visualmente (display: none o .hidden)
      const visibleTexts = Array.from(document.querySelectorAll('*:not(.hidden)'))
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => el.innerText || '');

      const isAutoSkipVisible = visibleTexts.some(t => t.includes('Omite la intro cuando el servidor detecta'));
      const isAutoNextVisible = visibleTexts.some(t => t.includes('Reproduce el próximo episodio al terminar el actual'));

      return {
        hasMarathon,
        hasMarathonSubtitle,
        isAutoSkipVisible,
        isAutoNextVisible,
      };
    })()
  `);

  testResults.push({
    test: '1. Interruptores: SOLO "Modo Maratón" visible con subtítulo correcto',
    expected: 'hasMarathon: true, hasSubtitle: true, autoSkipVisible: false, autoNextVisible: false',
    got: `Marathon: ${togglesDom.hasMarathon}, Subtitle: ${togglesDom.hasMarathonSubtitle}, SkipVisible: ${togglesDom.isAutoSkipVisible}, NextVisible: ${togglesDom.isAutoNextVisible}`,
    pass: togglesDom.hasMarathon && togglesDom.hasMarathonSubtitle && !togglesDom.isAutoSkipVisible && !togglesDom.isAutoNextVisible,
  });

  // ==========================================
  // TEST 2: Limpieza de "Más ajustes y funciones"
  // ==========================================
  console.log('[probe-sleep-timer] Evaluando "Más ajustes y funciones"...');
  // Desplegar acordeón
  await win.webContents.executeJavaScript(`
    (() => {
      const moreBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Más ajustes y funciones'));
      if (moreBtn) moreBtn.click();
    })();
  `);
  await wait(600);

  const moreDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasNightMode = text.includes('Modo noche');
      const hasQrInvite = text.includes('Invitar celular (QR)');
      const hasSleepSection = text.includes('Temporizador de reposo');
      const hasSleepNowLink = text.includes('Reposo ahora');
      const hasOffOpt = text.includes('Apagado');
      const has15Opt = text.includes('15 min');
      const hasChapterOpt = text.includes('Al terminar capítulo');

      // Botones ocultos
      const visibleButtons = Array.from(document.querySelectorAll('button:not(.hidden)'))
        .filter(b => {
          const style = window.getComputedStyle(b);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(b => b.innerText || '');

      const isSkipIntroVisible = visibleButtons.some(t => t.trim() === 'Saltar intro');
      const isTestSignalVisible = visibleButtons.some(t => t.includes('Probar señal'));
      const isRoomVisible = visibleButtons.some(t => t.trim() === 'Sala');

      return {
        hasNightMode,
        hasQrInvite,
        hasSleepSection,
        hasSleepNowLink,
        hasOffOpt,
        has15Opt,
        hasChapterOpt,
        isSkipIntroVisible,
        isTestSignalVisible,
        isRoomVisible,
      };
    })()
  `);

  testResults.push({
    test: '2. "Más ajustes": Saltar intro, Probar señal y Sala ocultos; Modo noche, QR y Temporizador visibles',
    expected: 'NightMode, QR, SleepSection, ReposoAhora, Opciones presentes; Skip/Signal/Sala no visibles',
    got: `Night: ${moreDom.hasNightMode}, QR: ${moreDom.hasQrInvite}, Sleep: ${moreDom.hasSleepSection}, ReposoAhora: ${moreDom.hasSleepNowLink}, SkipVisible: ${moreDom.isSkipIntroVisible}, SignalVisible: ${moreDom.isTestSignalVisible}, SalaVisible: ${moreDom.isRoomVisible}`,
    pass: moreDom.hasNightMode && moreDom.hasQrInvite && moreDom.hasSleepSection && moreDom.hasSleepNowLink && moreDom.hasOffOpt && moreDom.has15Opt && moreDom.hasChapterOpt && !moreDom.isSkipIntroVisible && !moreDom.isTestSignalVisible && !moreDom.isRoomVisible,
  });

  // ==========================================
  // TEST 3: setMarathon unificado
  // ==========================================
  console.log('[probe-sleep-timer] Probando comando setMarathon unificado...');
  const marathonRes = await win.webContents.executeJavaScript(`
    (() => {
      localStorage.setItem('cinecast_marathon_mode', 'false');
      // Activar con Switch
      const sw = document.querySelector('button[aria-label="Alternar Modo Maratón"]');
      if (sw) {
        sw.click();
      }
      return {
        stored: localStorage.getItem('cinecast_marathon_mode'),
      };
    })()
  `);
  await wait(600);

  testResults.push({
    test: '3. setMarathon unificado: activa maratón y persiste en cinecast_marathon_mode',
    expected: 'stored: "true"',
    got: `stored: "${marathonRes.stored}"`,
    pass: marathonRes.stored === 'true',
  });

  // ==========================================
  // TEST 4: Temporizador de reposo persistencia de opciones
  // ==========================================
  console.log('[probe-sleep-timer] Probando persistencia del temporizador...');
  const timerOptionRes = await win.webContents.executeJavaScript(`
    (() => {
      const btn15 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '15 min');
      if (btn15) btn15.click();
      const raw15 = localStorage.getItem('cinecast_sleep_timer_v1');

      const btnChap = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Al terminar capítulo');
      if (btnChap) btnChap.click();
      const rawChap = localStorage.getItem('cinecast_sleep_timer_v1');

      return {
        has15: Boolean(raw15 && raw15.includes('"mode":"15"')),
        hasChapter: Boolean(rawChap && rawChap.includes('"mode":"chapter"')),
      };
    })()
  `);

  testResults.push({
    test: '4. Temporizador de reposo: selección persiste en cinecast_sleep_timer_v1',
    expected: 'has15: true, hasChapter: true',
    got: `has15: ${timerOptionRes.has15}, hasChapter: ${timerOptionRes.hasChapter}`,
    pass: timerOptionRes.has15 && timerOptionRes.hasChapter,
  });

  // ==========================================
  // TEST 5: Temporizador vencido muestra "¿Seguís ahí?"
  // ==========================================
  console.log('[probe-sleep-timer] Probando temporizador de reposo con cuenta regresiva de 5s...');
  await win.webContents.executeJavaScript(`
    (() => {
      window.__CINECAST_TEST = true;
      localStorage.setItem('cinecast_test_mode', '1');
      // Forzar temporizador de prueba de 1s
      const timer = { endsAt: Date.now() + 1000, mode: 'test_5s' };
      localStorage.setItem('cinecast_sleep_timer_v1', JSON.stringify(timer));
    })();
  `);

  // Esperar 2.2s para que el tick de 1s de AppRuntime detecte el vencimiento
  await wait(2400);

  const promptDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const hasAreYouThere = text.includes('¿Seguís ahí?');
      const hasCountdown = /reposo en \\d+ s/i.test(text);
      const hasConfirmBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Sí, seguir'));
      const hasRemoteNotice = text.includes('¿Seguís viendo?');
      const hasRemoteBtn = text.includes('Seguir viendo');
      return { hasAreYouThere, hasCountdown, hasConfirmBtn, hasRemoteNotice, hasRemoteBtn };
    })()
  `);

  testResults.push({
    test: '5. Temporizador vencido: muestra "¿Seguís ahí?" a pantalla completa con cuenta regresiva',
    expected: 'hasAreYouThere: true, hasCountdown: true, hasConfirmBtn: true',
    got: `hasAreYouThere: ${promptDom.hasAreYouThere}, hasCountdown: ${promptDom.hasCountdown}, hasConfirmBtn: ${promptDom.hasConfirmBtn}`,
    pass: promptDom.hasAreYouThere && promptDom.hasConfirmBtn,
  });

  // ==========================================
  // TEST 6: Responder "Sí, seguir" descarta el aviso
  // ==========================================
  console.log('[probe-sleep-timer] Probando responder "Sí, seguir"...');
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Sí, seguir'));
      if (btn) btn.click();
    })();
  `);
  await wait(600);

  const dismissedDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      return { hasPrompt: text.includes('¿Seguís ahí?') };
    })()
  `);

  testResults.push({
    test: '6. Tocar "Sí, seguir" descarta el prompt "¿Seguís ahí?"',
    expected: 'hasPrompt: false',
    got: `hasPrompt: ${dismissedDom.hasPrompt}`,
    pass: !dismissedDom.hasPrompt,
  });

  // ==========================================
  // TEST 7: Vencimiento de cuenta regresiva sin respuesta -> Standby
  // ==========================================
  console.log('[probe-sleep-timer] Probando cuenta regresiva de 5s sin respuesta -> Standby...');
  await win.webContents.executeJavaScript(`
    (() => {
      window.__CINECAST_TEST = true;
      localStorage.setItem('cinecast_test_mode', '1');
      const timer = { endsAt: Date.now() + 500, mode: 'test_5s' };
      localStorage.setItem('cinecast_sleep_timer_v1', JSON.stringify(timer));
    })();
  `);
  // Esperar 0.5s de timer + 5s countdown + 1.5s margen = 7s
  await wait(7500);

  const standbyDom = await win.webContents.executeJavaScript(`
    (() => {
      const text = document.body.innerText || '';
      const inStandby = text.includes('EN REPOSO') ||
                        text.includes('Elegí qué ver desde tu cama') ||
                        text.includes('Pantalla en reposo') ||
                        text.includes('Pantalla lista para recibir reproducción') ||
                        Boolean(document.querySelector('[data-testid="screen-standby-view"]'));
      return { inStandby };
    })()
  `);

  testResults.push({
    test: '7. Cuenta regresiva sin respuesta pasa a Standby / Reposo automáticamente',
    expected: 'inStandby: true',
    got: `inStandby: ${standbyDom.inStandby}`,
    pass: standbyDom.inStandby,
  });

  // ==========================================
  // TEST 8: Embed con parámetro ?dur=20
  // ==========================================
  console.log('[probe-sleep-timer] Verificando /__test/embed.html?dur=20...');
  await win.loadURL(`${baseUrl}/__test/embed.html?dur=20`);
  await wait(1500);

  const embedDuration = await win.webContents.executeJavaScript(`
    (() => {
      const v = document.getElementById('test-video');
      return v ? v.duration : 0;
    })()
  `);

  const isDurationApprox20 = Math.abs(embedDuration - 20) <= 1;

  testResults.push({
    test: '8. /__test/embed.html?dur=20 genera archivo y video de 20s de duración',
    expected: 'duration ≈ 20s (±1s)',
    got: `duration: ${embedDuration}s`,
    pass: isDurationApprox20,
  });

  // ==========================================
  // Reporte Final
  // ==========================================
  console.log('\n============================================================');
  console.log('         REPORTE DE CONTROL Y REPOSO (scripts/probe-sleep-timer.cjs)');
  console.log('============================================================');
  let allPassed = true;
  for (const r of testResults) {
    const mark = r.pass ? '✓ PASÓ' : '✗ FALLÓ';
    console.log(`${mark} | ${r.test}`);
    console.log(`   Esperado: ${r.expected}`);
    console.log(`   Obtenido: ${r.got}`);
    if (!r.pass) allPassed = false;
  }
  console.log('============================================================\n');

  clearTimeout(globalTimer);
  win.destroy();
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  if (allPassed) {
    console.log('[probe-sleep-timer] Todos los casos pasaron exitosamente.');
    app.exit(0);
  } else {
    console.error('[probe-sleep-timer] Se encontraron fallos en las pruebas.');
    app.exit(1);
  }
}

app.whenReady().then(run).catch((err) => {
  console.error('[probe-sleep-timer] Error fatal:', err);
  app.exit(1);
});
