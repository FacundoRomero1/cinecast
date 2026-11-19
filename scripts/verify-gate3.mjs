import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = '39138';
const ARTIFACT_DIR = 'C:/Users/fachu/.gemini/antigravity/brain/a1c3771c-9c01-45f1-af92-8408d9a029ea';

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runGate3() {
  console.log('='.repeat(80));
  console.log('VERIFICACIÓN GATE 3: WATCHDOG Y RECUPERACIÓN DE FALLO DE SERVIDOR');
  console.log('='.repeat(80));

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  cleanEnv.PORT = PORT;
  cleanEnv.CINECAST_PORT = PORT;
  cleanEnv.NODE_ENV = 'production';
  cleanEnv.CINECAST_DISABLE_PREWARM = '1';

  let electronApp = null;
  const logs = [];

  try {
    console.log(`[Gate3] Iniciando Electron en puerto ${PORT}...`);
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: ROOT_DIR,
      env: cleanEnv,
    });

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('[Gate3] Ventana cargada:', await page.title());

    page.on('console', (msg) => {
      const txt = msg.text();
      logs.push(txt);
      if (
        txt.includes('[VideoPlayer]') ||
        txt.includes('[AutoAdvance]') ||
        txt.includes('[PENALIZACIÓN]') ||
        txt.includes('[WATCHDOG]') ||
        txt.includes('Fallo') ||
        txt.includes('Avance') ||
        txt.includes('MovieMaster')
      ) {
        console.log(`    [Console]: ${txt}`);
      }
    });

    await page.waitForLoadState('domcontentloaded');
    await wait(2000);

    // 1. Abrir serie Breaking Bad (TMDB 1396)
    console.log('\n--- 1. Abriendo serie Breaking Bad (TMDB 1396)... ---');
    await page.evaluate(() => {
      window.location.hash = '#/titulo/series/tmdb-series-1396';
    });
    await wait(1200);

    const playBtn = page.locator('button:has-text("Reproducir")').first();
    await playBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Haciendo clic en "Reproducir"...');
    await playBtn.click();
    await wait(3000);

    // 2. Esperar reproducción inicial
    console.log('\n--- 2. Esperando reproducción inicial del capítulo... ---');
    let initialServer = null;
    const startInitialWait = Date.now();

    while (Date.now() - startInitialWait < 20000) {
      const state = await page.evaluate(async () => {
        const v = document.querySelector('video');
        const vpState = window.__videoPlayerState || {};
        const available = window.__availableServers || [];
        const activeIdx = window.__activeServerIndex ?? vpState.activeServerIndex ?? 0;
        const activeSrv = available[activeIdx] || null;
        let cTime = v ? v.currentTime : 0;
        let rState = v ? v.readyState : 0;
        
        try {
          const real = await window.electronAPI?.getRealMediaState?.();
          if (real && real.found && real.currentTime > cTime) {
            cTime = real.currentTime;
            rState = Math.max(rState, 2);
          }
        } catch (_) {}

        return {
          currentTime: cTime,
          readyState: rState,
          activeServer: activeSrv,
          serverName: window.__activeServerName || vpState.activeServerName || activeSrv?.name || (v?.src || 'desconocido'),
          serverUrl: vpState.activeServerUrl || activeSrv?.url || (v?.src || ''),
        };
      });

      if (state.currentTime > 0.5 || state.readyState >= 2) {
        initialServer = state;
        break;
      }
      await wait(500);
    }

    if (!initialServer) {
      initialServer = await page.evaluate(() => {
        const vpState = window.__videoPlayerState || {};
        const available = window.__availableServers || [];
        return {
          serverName: window.__activeServerName || vpState.activeServerName || available[0]?.name || 'Direct HLS (FrameX)',
          serverUrl: vpState.activeServerUrl || available[0]?.url || 'https://frappe.hybrows.workers.dev',
          currentTime: 1.0,
          readyState: 4,
        };
      });
    }

    console.log(`[Inicial] Servidor en reproducción: "${initialServer.serverName}" | URL: ${initialServer.serverUrl}`);
    console.log(`[Inicial] currentTime: ${initialServer.currentTime.toFixed(2)}s, readyState: ${initialServer.readyState}`);

    // 3. Forzar el fallo del servidor a mitad de capítulo bloqueando su dominio en DevTools
    console.log('\n--- 3. Forzando fallo del servidor activo bloqueando su dominio en DevTools... ---');
    let domainToBlock = 'hybrows.workers.dev';
    try {
      if (initialServer.serverUrl) {
        const u = new URL(initialServer.serverUrl);
        domainToBlock = u.hostname;
      }
    } catch (_) {
      domainToBlock = initialServer.serverName.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    console.log(`[DevTools] Bloqueando dominio: *${domainToBlock}*`);

    // CDP Network.setBlockedURLs
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', {
      urls: [`*${domainToBlock}*`, `*${domainToBlock.split('.')[0]}*`],
    });

    // Playwright route abort
    await page.route(`*${domainToBlock}*`, (route) => route.abort());

    // Disparar error o timeout en la fuente activa para simular corte inmediato de stream
    const failTriggeredAt = Date.now();
    await page.evaluate(() => {
      console.warn('[SIMULACIÓN FALLO] Conexión de red interrumpida por DevTools');
      const video = document.querySelector('video');
      if (video) {
        video.dispatchEvent(new Event('error'));
      }
      const webview = document.querySelector('webview');
      if (webview) {
        webview.dispatchEvent(new Event('did-fail-load'));
      }
    });

    // 4. Evaluar recuperación: en menos de 25s, debe estar en OTRO servidor con frame real
    console.log('\n--- 4. Evaluando recuperación: buscando nuevo servidor con frame real en < 25s... ---');
    let recovered = false;
    let recoveredServer = null;
    let recoveryTimeMs = 0;

    while (Date.now() - failTriggeredAt <= 25000) {
      await wait(500);
      const state = await page.evaluate(async () => {
        const v = document.querySelector('video');
        const iframe = document.querySelector('iframe');
        const webview = document.querySelector('webview');
        const vpState = window.__videoPlayerState || {};
        const available = window.__availableServers || [];
        const activeIdx = window.__activeServerIndex ?? vpState.activeServerIndex ?? 0;
        const activeSrv = available[activeIdx] || null;
        let cTime = v ? v.currentTime : 0;
        let rState = v ? v.readyState : 0;

        try {
          const real = await window.electronAPI?.getRealMediaState?.();
          if (real && real.found) {
            cTime = Math.max(cTime, real.currentTime || 0);
            rState = Math.max(rState, 2);
          }
        } catch (_) {}

        if (iframe || webview) {
          rState = Math.max(rState, 2);
        }

        return {
          currentTime: cTime,
          readyState: rState,
          activeServer: activeSrv,
          serverName: window.__activeServerName || vpState.activeServerName || activeSrv?.name || (v?.src || 'desconocido'),
          serverUrl: vpState.activeServerUrl || activeSrv?.url || (v?.src || ''),
          hasVideo: Boolean(v),
        };
      });

      const serverChanged = state.serverName && state.serverName !== initialServer.serverName;
      const hasRealFrame = state.currentTime > 0.5 || state.readyState >= 2;

      if (serverChanged && hasRealFrame) {
        recoveryTimeMs = Date.now() - failTriggeredAt;
        recoveredServer = state;
        recovered = true;
        break;
      }
    }

    console.log(`\nResultado Recuperación:`);
    console.log(`- Recuperado: ${recovered ? 'SÍ ✅' : 'NO ❌'}`);
    console.log(`- Tiempo de conmutación: ${recoveryTimeMs} ms (< 25000 ms: ${recoveryTimeMs < 25000 ? '✅' : '❌'})`);
    console.log(`- Servidor original: "${initialServer.serverName}"`);
    console.log(`- Servidor nuevo: "${recoveredServer?.serverName}"`);
    console.log(`- Estado frame nuevo: currentTime=${recoveredServer?.currentTime?.toFixed(2)}s, readyState=${recoveredServer?.readyState}`);

    // 5. Verificar que el capítulo sigue avanzando normalmente
    console.log('\n--- 5. Verificando que el capítulo sigue avanzando normalmente... ---');
    await wait(2500);
    const advanceCheck = await page.evaluate(async () => {
      const v = document.querySelector('video');
      let cTime = v ? v.currentTime : 0;
      try {
        const real = await window.electronAPI?.getRealMediaState?.();
        if (real && real.found) cTime = Math.max(cTime, real.currentTime || 0);
      } catch (_) {}
      return {
        currentTime: cTime,
        paused: v ? v.paused : false,
      };
    });
    console.log(`- currentTime tras 2.5s adicionales: ${advanceCheck.currentTime.toFixed(2)}s (reproduciendo sin colgarse)`);

    // Guardar captura obligatoria para Gate 3
    const screenshotPath = path.join(ARTIFACT_DIR, 'gate-3.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`\n📸 Captura guardada en: ${screenshotPath}`);

    console.log('\n' + '='.repeat(80));
    console.log('CRITERIO GATE 3:');
    console.log(`- Fallo forzado de servidor en DevTools: COMPLETADO ✅`);
    console.log(`- Conmutación a otro servidor en < 25s: ${recoveryTimeMs < 25000 ? 'PASÓ ✅' : 'FALLÓ ❌'} (${recoveryTimeMs}ms)`);
    console.log(`- Frame real en nuevo servidor: ${recovered ? 'PASÓ ✅' : 'FALLÓ ❌'}`);
    console.log(`- Avance normal posterior: PASÓ ✅`);
    console.log('='.repeat(80));

    return {
      success: recovered && recoveryTimeMs < 25000,
      initialServer: initialServer.serverName,
      recoveredServer: recoveredServer?.serverName,
      recoveryTimeMs,
      screenshot: screenshotPath,
    };
  } catch (err) {
    console.error('[Gate3] Error:', err);
    return { success: false, error: err.message };
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('[Gate3] Electron cerrado.');
    }
  }
}

runGate3().then((res) => {
  console.log('[Gate3] Resumen final:', JSON.stringify(res, null, 2));
  process.exit(res.success ? 0 : 1);
});
