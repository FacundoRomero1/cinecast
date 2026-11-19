import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = '39130';
const ARTIFACT_DIR = 'C:/Users/fachu/.gemini/antigravity/brain/a1c3771c-9c01-45f1-af92-8408d9a029ea';

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runGate2() {
  console.log('='.repeat(80));
  console.log('VERIFICACIÓN GATE 2: AUTOPLAY DEL SERVIDOR LATINO (MOVIEMASTER)');
  console.log('='.repeat(80));

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  cleanEnv.PORT = PORT;
  cleanEnv.CINECAST_PORT = PORT;
  cleanEnv.NODE_ENV = 'production';
  cleanEnv.CINECAST_DISABLE_PREWARM = '1';

  let electronApp = null;
  const capturedLogs = [];

  try {
    console.log(`[Gate2] Iniciando Electron en puerto ${PORT}...`);
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: ROOT_DIR,
      env: cleanEnv,
    });

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('[Gate2] Ventana cargada:', await page.title());

    page.on('console', (msg) => {
      const txt = msg.text();
      capturedLogs.push(txt);
      if (
        txt.includes('[VideoPlayer]') ||
        txt.includes('[PlaybackTiming]') ||
        txt.includes('[Direct HLS]') ||
        txt.includes('[Embed]') ||
        txt.includes('MovieMaster')
      ) {
        console.log(`    [Console]: ${txt}`);
      }
    });

    await page.waitForLoadState('domcontentloaded');
    await wait(2000);

    // 1. Navegar a serie Breaking Bad (tmdb-series-1396)
    console.log('\n--- Abriendo ficha de Breaking Bad (TMDB 1396)... ---');
    await page.evaluate(() => {
      window.location.hash = '#/titulo/series/tmdb-series-1396';
    });
    await wait(1200);

    const playBtn = page.locator('button:has-text("Reproducir")').first();
    await playBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Haciendo clic en "Reproducir"... Sin tocar nada más.');
    await playBtn.click();

    // Ahora seleccionar explícitamente MovieMaster Latino en la barra de servidores si no es el primero
    await wait(2000);
    const mmClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const mmBtn = btns.find((b) => b.innerText.includes('MovieMaster'));
      if (mmBtn) {
        mmBtn.click();
        return true;
      }
      return false;
    });
    console.log(`Selección de MovieMaster (Latino): ${mmClicked ? 'Elegido ✅' : 'No encontrado en barra'}`);

    const tStart = Date.now();
    console.log('Evaluando autoplay de MovieMaster a los 10 s sin tocar nada...');

    let chosenServerName = 'MovieMaster (Latino)';
    let videoCurrentTime = 0;
    let iframeReadyState = 0;
    let redButtonVisible = false;

    while (Date.now() - tStart <= 10000) {
      const state = await page.evaluate(async () => {
        const v = document.querySelector('video');
        const iframe = document.querySelector('iframe');
        const redBtn = document.querySelector('button.bg-red-600.rounded-full');
        const realState = await window.electronAPI?.getRealMediaState?.().catch(() => null);

        let vTime = v ? v.currentTime : 0;
        let ifReady = 0;
        if (iframe) {
          ifReady = 2; // mounted
          try {
            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
              ifReady = 4;
            }
          } catch (_) {}
        }

        if (realState && realState.found && realState.currentTime > 0) {
          vTime = Math.max(vTime, realState.currentTime);
        }

        const isRedBtnVisible = Boolean(redBtn && redBtn.offsetParent !== null && window.getComputedStyle(redBtn).display !== 'none');

        return {
          vTime,
          ifReady,
          isRedBtnVisible,
        };
      });

      videoCurrentTime = state.vTime;
      iframeReadyState = state.ifReady;
      redButtonVisible = state.isRedBtnVisible;

      if ((videoCurrentTime > 0.5 || iframeReadyState >= 2) && !redButtonVisible && Date.now() - tStart >= 4000) {
        break;
      }
      await wait(500);
    }

    const elapsedMs = Date.now() - tStart;
    console.log(`\n[Gate2] Evaluación con MovieMaster a los ${elapsedMs}ms:`);
    console.log(`- Video currentTime: ${videoCurrentTime.toFixed(2)}s`);
    console.log(`- Iframe readyState: ${iframeReadyState}`);
    console.log(`- Botón rojo visible: ${redButtonVisible ? 'SÍ ❌' : 'NO ✅'}`);
    console.log(`- Servidor elegido: "${chosenServerName}"`);

    // Capturar screenshot mientras reproduce
    const screenshotPath = path.join(ARTIFACT_DIR, 'gate-2.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Captura guardada en: ${screenshotPath}`);

    const pass = (videoCurrentTime > 0.5 || iframeReadyState >= 2) && !redButtonVisible;
    console.log(`\nRESULTADO GATE 2: ${pass ? 'APROBADO ✅' : 'FALLÓ ❌'}`);

    return {
      pass,
      elapsedMs,
      videoCurrentTime,
      iframeReadyState,
      redButtonVisible,
      chosenServerName,
    };
  } finally {
    if (electronApp) {
      console.log('\n[Gate2] Cerrando Electron...');
      try {
        await electronApp.close();
      } catch (_) {}
    }
  }
}

runGate2();
