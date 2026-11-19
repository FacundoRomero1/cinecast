import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = '39125';
const ARTIFACT_DIR = 'C:/Users/fachu/.gemini/antigravity/brain/a1c3771c-9c01-45f1-af92-8408d9a029ea';

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPlayerState(page) {
  return await page.evaluate(() => {
    const video = document.querySelector('video');
    const playerEl = document.querySelector('[data-testid="video-player"]');
    const h2Title = document.querySelector('h2');
    const epSelect = document.querySelector('[data-testid="episode-select"]');
    const available = window.__availableServers || [];
    const serverNames = available.map((s) => s.name);
    
    return {
      hasVideo: Boolean(video),
      currentTime: video ? video.currentTime : 0,
      duration: video ? video.duration : 0,
      paused: video ? video.paused : true,
      season: playerEl ? playerEl.getAttribute('data-season') : (epSelect ? '1' : null),
      episode: playerEl ? playerEl.getAttribute('data-episode') : (epSelect ? epSelect.value : null),
      title: h2Title ? h2Title.innerText : '',
      serversCount: available.length,
      serverNames,
      hasDuplicates: new Set(serverNames).size !== serverNames.length,
    };
  });
}

async function waitForRealPlayback(page, maxWaitMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const st = await getPlayerState(page);
    if (st.hasVideo && st.currentTime > 0.5) {
      return st;
    }
    // Also check via electron API getRealMediaState if webview/iframe
    const realState = await page.evaluate(async () => {
      try {
        return await window.electronAPI?.getRealMediaState?.();
      } catch {
        return null;
      }
    });
    if (realState && realState.found && realState.currentTime > 0.5) {
      st.currentTime = realState.currentTime;
      return st;
    }
    await wait(500);
  }
  return await getPlayerState(page);
}

async function runGate1() {
  console.log('='.repeat(80));
  console.log('VERIFICACIÓN GATE 1: CICLO DE VIDA DEL EPISODIO');
  console.log('='.repeat(80));

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  cleanEnv.PORT = PORT;
  cleanEnv.CINECAST_PORT = PORT;
  cleanEnv.NODE_ENV = 'production';
  cleanEnv.CINECAST_DISABLE_PREWARM = '1';

  let electronApp = null;
  const gateReport = [];

  try {
    console.log(`[Gate1] Iniciando Electron en puerto ${PORT}...`);
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: ROOT_DIR,
      env: cleanEnv,
    });

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('[Gate1] Ventana cargada:', await page.title());

    page.on('console', (msg) => {
      const txt = msg.text();
      if (
        txt.includes('[VideoPlayer]') ||
        txt.includes('[PlaybackTiming]') ||
        txt.includes('[Direct HLS]') ||
        txt.includes('[FAV_PERSIST]') ||
        txt.includes('[SWAP]')
      ) {
        console.log(`    [Console]: ${txt}`);
      }
    });

    await page.waitForLoadState('domcontentloaded');
    await wait(2000);

    // 1. Navegar a serie Breaking Bad (tmdb-series-1396)
    console.log('\n--- PASO 1: Reproducir E1 y esperar currentTime > 0.5 ---');
    await page.evaluate(() => {
      window.location.hash = '#/titulo/series/tmdb-series-1396';
    });
    await wait(1000);

    const playBtn = page.locator('button:has-text("Reproducir")').first();
    await playBtn.waitFor({ state: 'visible', timeout: 15000 });
    await playBtn.click();

    let stE1 = await waitForRealPlayback(page, 30000);
    console.log(`[E1] currentTime: ${stE1.currentTime.toFixed(2)}s, Episodio: ${stE1.episode}, Título: "${stE1.title}"`);
    console.log(`[E1] availableServers (${stE1.serversCount}):`, stE1.serverNames);
    console.log(`[E1] Duplicados en E1: ${stE1.hasDuplicates ? 'SÍ ❌' : 'NO ✅'}`);

    gateReport.push({
      paso: '1. Reproducir E1',
      episodio: stE1.episode,
      currentTime: stE1.currentTime.toFixed(2),
      cantidad: stE1.serversCount,
      servidores: stE1.serverNames,
      duplicados: stE1.hasDuplicates,
      pasa: stE1.currentTime > 0.5 && !stE1.hasDuplicates,
    });

    // 2. Avanzar a E2
    console.log('\n--- PASO 2: Avanzar a E2 ---');
    await page.evaluate(() => {
      const epSelect = document.querySelector('[data-testid="episode-select"]');
      if (epSelect) {
        epSelect.value = '2';
        epSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await wait(1500);
    let stE2 = await waitForRealPlayback(page, 30000);
    console.log(`[E2] currentTime: ${stE2.currentTime.toFixed(2)}s, Episodio: ${stE2.episode}, Título: "${stE2.title}"`);
    console.log(`[E2] availableServers (${stE2.serversCount}):`, stE2.serverNames);
    console.log(`[E2] Duplicados en E2: ${stE2.hasDuplicates ? 'SÍ ❌' : 'NO ✅'}`);
    const grewE2 = stE2.serversCount > stE1.serversCount;
    console.log(`[E2] Cantidad creció vs E1 (${stE1.serversCount} -> ${stE2.serversCount}): ${grewE2 ? 'SÍ ❌' : 'NO ✅'}`);

    gateReport.push({
      paso: '2. Avanzar a E2',
      episodio: stE2.episode,
      currentTime: stE2.currentTime.toFixed(2),
      cantidad: stE2.serversCount,
      servidores: stE2.serverNames,
      duplicados: stE2.hasDuplicates,
      pasa: stE2.currentTime > 0.5 && !stE2.hasDuplicates && !grewE2,
    });

    // 3. Avanzar a E3
    console.log('\n--- PASO 3: Avanzar a E3 ---');
    await page.evaluate(() => {
      const epSelect = document.querySelector('[data-testid="episode-select"]');
      if (epSelect) {
        epSelect.value = '3';
        epSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await wait(1500);
    let stE3 = await waitForRealPlayback(page, 30000);
    console.log(`[E3] currentTime: ${stE3.currentTime.toFixed(2)}s, Episodio: ${stE3.episode}, Título: "${stE3.title}"`);
    console.log(`[E3] availableServers (${stE3.serversCount}):`, stE3.serverNames);
    console.log(`[E3] Duplicados en E3: ${stE3.hasDuplicates ? 'SÍ ❌' : 'NO ✅'}`);
    const grewE3 = stE3.serversCount > stE2.serversCount;
    console.log(`[E3] Cantidad creció vs E2 (${stE2.serversCount} -> ${stE3.serversCount}): ${grewE3 ? 'SÍ ❌' : 'NO ✅'}`);

    gateReport.push({
      paso: '3. Avanzar a E3',
      episodio: stE3.episode,
      currentTime: stE3.currentTime.toFixed(2),
      cantidad: stE3.serversCount,
      servidores: stE3.serverNames,
      duplicados: stE3.hasDuplicates,
      pasa: stE3.currentTime > 0.5 && !stE3.hasDuplicates && !grewE3,
    });

    // 4. Activar maratón, dejar correr el final de un capítulo (dos veces seguidas: E3->E4 y E4->E5)
    console.log('\n--- PASO 4: Activar maratón y avance automático (Maratón 1: E3 -> E4) ---');
    await page.evaluate(() => {
      localStorage.setItem('cinecast_marathon_mode', 'true');
      window.dispatchEvent(new CustomEvent('cinecast:marathon', { detail: { enabled: true } }));
      // Buscar el video y adelantar a 1 s del final
      const v = document.querySelector('video');
      if (v && v.duration > 0) {
        v.currentTime = v.duration - 1;
      }
    });

    // Esperar a que el capítulo avance a E4
    console.log('Esperando avance automático a E4 por maratón...');
    let stM1 = null;
    const startM1 = Date.now();
    while (Date.now() - startM1 < 25000) {
      const cur = await getPlayerState(page);
      if (cur.episode === '4') {
        stM1 = cur;
        break;
      }
      await wait(500);
    }
    if (!stM1) {
      // Si el video de prueba no terminó solo, forzar salto o verificar
      console.log('Forzando evento timeupdate/ended para maratón...');
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) {
          v.dispatchEvent(new Event('ended'));
        }
      });
      await wait(2000);
      stM1 = await getPlayerState(page);
    }

    let stM1Playback = await waitForRealPlayback(page, 20000);
    console.log(`[Maratón 1] Episodio: ${stM1Playback.episode}, Título: "${stM1Playback.title}", currentTime: ${stM1Playback.currentTime.toFixed(2)}s`);
    const passM1 = (stM1Playback.episode === '4' || stM1Playback.episode === 4) && stM1Playback.currentTime > 0.5 && stM1Playback.title !== stE3.title;
    console.log(`[Maratón 1] Resultado: ${passM1 ? 'PASA ✅' : 'FALLA ❌'}`);

    gateReport.push({
      paso: '4. Maratón E3 -> E4',
      episodio: stM1Playback.episode,
      currentTime: stM1Playback.currentTime.toFixed(2),
      cantidad: stM1Playback.serversCount,
      servidores: stM1Playback.serverNames,
      duplicados: stM1Playback.hasDuplicates,
      pasa: passM1,
    });

    console.log('\n--- PASO 5: Segundo avance automático (Maratón 2: E4 -> E5) ---');
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v && v.duration > 0) {
        v.currentTime = v.duration - 1;
      } else if (v) {
        v.dispatchEvent(new Event('ended'));
      }
    });

    let stM2 = null;
    const startM2 = Date.now();
    while (Date.now() - startM2 < 25000) {
      const cur = await getPlayerState(page);
      if (cur.episode === '5') {
        stM2 = cur;
        break;
      }
      await wait(500);
    }
    if (!stM2) {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) v.dispatchEvent(new Event('ended'));
      });
      await wait(2000);
      stM2 = await getPlayerState(page);
    }

    let stM2Playback = await waitForRealPlayback(page, 20000);
    console.log(`[Maratón 2] Episodio: ${stM2Playback.episode}, Título: "${stM2Playback.title}", currentTime: ${stM2Playback.currentTime.toFixed(2)}s`);
    const passM2 = (stM2Playback.episode === '5' || stM2Playback.episode === 5) && stM2Playback.currentTime > 0.5 && stM2Playback.title !== stM1Playback.title;
    console.log(`[Maratón 2] Resultado: ${passM2 ? 'PASA ✅' : 'FALLA ❌'}`);

    gateReport.push({
      paso: '5. Maratón E4 -> E5',
      episodio: stM2Playback.episode,
      currentTime: stM2Playback.currentTime.toFixed(2),
      cantidad: stM2Playback.serversCount,
      servidores: stM2Playback.serverNames,
      duplicados: stM2Playback.hasDuplicates,
      pasa: passM2,
    });

    // 5. Volver atrás un capítulo (E5 -> E4)
    console.log('\n--- PASO 6: Volver atrás un capítulo (E5 -> E4) ---');
    await page.evaluate(() => {
      const epSelect = document.querySelector('[data-testid="episode-select"]');
      if (epSelect) {
        epSelect.value = '4';
        epSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await wait(1500);
    let stBack = await waitForRealPlayback(page, 25000);
    const overlayVisible = await page.evaluate(() => {
      // Comprobar si hay un botón rojo gigante tapando o overlay bloqueante
      const btn = document.querySelector('button.bg-red-600.rounded-full');
      return Boolean(btn && btn.offsetParent !== null);
    });

    console.log(`[Atrás] Episodio: ${stBack.episode}, Título: "${stBack.title}", Overlay visible: ${overlayVisible ? 'SÍ ❌' : 'NO ✅'}`);
    console.log(`[Atrás] availableServers (${stBack.serversCount}):`, stBack.serverNames);

    gateReport.push({
      paso: '6. Volver atrás a E4',
      episodio: stBack.episode,
      currentTime: stBack.currentTime.toFixed(2),
      cantidad: stBack.serversCount,
      servidores: stBack.serverNames,
      duplicados: stBack.hasDuplicates,
      pasa: (stBack.episode === '4' || stBack.episode === 4) && !overlayVisible && !stBack.hasDuplicates,
    });

    // Capturar screenshot para Gate 1
    const screenshotPath = path.join(ARTIFACT_DIR, 'gate-1.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`\n📸 Captura guardada en: ${screenshotPath}`);

  } catch (err) {
    console.error('❌ Error ejecutando Gate 1:', err);
  } finally {
    if (electronApp) {
      console.log('\n[Gate1] Cerrando Electron...');
      try {
        await electronApp.close();
      } catch (_) {}
    }
  }

  // Resumen
  console.log('\n' + '='.repeat(100));
  console.log('TABLA DE VERIFICACIÓN GATE 1');
  console.log('='.repeat(100));
  console.table(gateReport.map((r) => ({
    Paso: r.paso,
    Episodio: r.episodio,
    'CurrentTime (s)': r.currentTime,
    'Cant. Servidores': r.cantidad,
    'Duplicados?': r.duplicados ? 'SÍ (ERROR)' : 'NO (OK)',
    'Pasa Gate 1': r.pasa ? 'PASÓ' : 'FALLÓ',
  })));

  const allPass = gateReport.every((r) => r.pasa);
  console.log(`\nRESULTADO GLOBAL GATE 1: ${allPass ? 'APROBADO ✅' : 'FALLÓ ❌'}`);
  return allPass;
}

runGate1();
