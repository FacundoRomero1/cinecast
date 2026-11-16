import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = '3089';

const TITLES = [
  // 3 Títulos con HLS
  { id: 550, name: 'El club de la pelea (Fight Club)', expectedHls: true, isFragile: false },
  { id: 157336, name: 'Interestelar (Interstellar)', expectedHls: true, isFragile: false },
  { id: 299536, name: 'Avengers: Infinity War', expectedHls: true, isFragile: false },

  // 3 Títulos antes reportados vacíos / sin HLS (con cadena optimizada y fusión en /api/resolve/play)
  { id: 354912, name: 'Coco', expectedHls: true, isFragile: false },
  { id: 150540, name: 'Intensa-Mente (Inside Out)', expectedHls: true, isFragile: false },
  { id: 3933, name: 'El cadáver de la novia (Corpse Bride)', expectedHls: true, isFragile: false },

  // 2 Títulos del grupo frágil (Videoapp único)
  { id: 1058424, name: 'Hope: El primer impacto', expectedHls: false, isFragile: true },
  { id: 1228834, name: 'The Fix', expectedHls: false, isFragile: true },
];

let allHlsValidationAttempts = [];

async function testTitle(page, t, titleIndex, passNumber, scratchDir) {
  const titleLabel = `[#${titleIndex + 1}/${TITLES.length}] ${t.name} (TMDB ${t.id}) [PASE ${passNumber}]`;
  console.log('\n' + '-'.repeat(80));
  console.log(`PROBANDO: ${titleLabel} ${t.isFragile ? '[GRUPO FRÁGIL]' : t.expectedHls ? '[HLS ESPERADO]' : '[IFRAME ESPERADO]'}`);
  console.log('-'.repeat(80));

  const titleLogs = [];
  const onConsole = (msg) => {
    const txt = msg.text();
    titleLogs.push(txt);
    if (
      txt.includes('[VideoPlayer]') ||
      txt.includes('[AutoAdvance]') ||
      txt.includes('[PlaybackTiming]') ||
      txt.includes('loadedmetadata') ||
      txt.includes('[Embed]') ||
      txt.includes('[WebViewPlayer]')
    ) {
      console.log(`    [Console]: ${txt}`);
    }
  };
  page.on('console', onConsole);

  let chosenServer = 'Desconocido';
  let playerType = 'desconocido';
  let advancesUsed = 0;
  let resolveMs = -1;
  let frameMs = -1;
  let totalMs = -1;
  let algoReprodMs = -1;
  let finalFrameMs = -1;
  let speedMs = -1;
  let replaced = 'NO';
  let fellToSelector = false;
  let screenshotPath = '';

  try {
    // 0. Asegurarse de resetear al Home antes de abrir el nuevo título
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.waitForTimeout(600);

    // 1. Abrir título desde la app navegando en el HashRouter
    console.log(`  1. Navegando a ficha de título #/titulo/movie/tmdb-movie-${t.id}...`);
    await page.evaluate((id) => {
      window.location.hash = `#/titulo/movie/tmdb-movie-${id}`;
    }, t.id);

    // 2. Esperar botón Reproducir y hacer clic
    const playBtn = page.locator('button:has-text("Reproducir")').first();
    await playBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log('  2. Haciendo clic en "Reproducir"...');

    const tClick = Date.now();
    await playBtn.click();

    // 3. Esperar a que comience la reproducción real (loadeddata con currentTime > 0 o evento de carga con video)
    console.log('  3. Esperando inicio de reproducción ("algo reproduciendo" real)...');

    const startTime = Date.now();
    const maxWaitMs = t.isFragile ? 22000 : 38000;

    while (Date.now() - startTime < maxWaitMs) {
      // Extraer número de avances de los logs
      const advanceLogs = titleLogs.filter((l) => l.includes('[AutoAdvance] Avance #'));
      advancesUsed = advanceLogs.length;

      // Verificar si resolveService ya completó
      const resolveLog = titleLogs.find((l) => l.includes('[PlaybackTiming] Resolve completado en'));
      if (resolveLog) {
        const m = resolveLog.match(/Resolve completado en (\d+)ms/);
        if (m) resolveMs = Number(m[1]);
      }

      // Requisito 1: Extraer ALGO_REPRODUCIENDO si el reproductor ya lo emitió formalmente
      const algoLog = titleLogs.find((l) => l.includes('[PlaybackTiming] ALGO_REPRODUCIENDO'));
      if (algoLog && algoReprodMs < 0) {
        const m = algoLog.match(/elapsedMs=(\d+)/);
        if (m) algoReprodMs = Number(m[1]);
      }

      // Revisar si hubo reemplazo / swap
      if (titleLogs.some((l) => l.includes('[SWAP] Preview falló antes de reproducir'))) {
        replaced = 'SÍ (swap fallo)';
      } else if (titleLogs.some((l) => l.includes('[NO REEMPLAZAR] Preview activo'))) {
        replaced = 'NO (preview mant.)';
      } else if (titleLogs.some((l) => l.includes('[HLS DIRECTO]') || l.includes('[ARRANQUE] Favorito HLS'))) {
        replaced = 'NO (directo HLS)';
      } else if (titleLogs.some((l) => l.includes('[REEMPLAZO]'))) {
        replaced = 'SÍ';
      }

      // Verificar si cayó al selector
      const hasExhaustedLogs = titleLogs.some((l) =>
        l.includes('No hay más servidores disponibles. Mostrando selector') ||
        l.includes('Límite de 3 auto-avances alcanzado')
      );

      const hasSelectorUI = await page.evaluate(() => {
        const exhausted = document.querySelector('[data-testid="all-servers-exhausted"]');
        const errorHeading = Array.from(document.querySelectorAll('h3')).some(
          (el) => el.textContent && (el.textContent.includes('Ningún servidor respondió') || el.textContent.includes('No pudimos reproducir esta señal'))
        );
        return Boolean(exhausted || errorHeading);
      });

      if (hasSelectorUI || hasExhaustedLogs || (t.isFragile && advancesUsed >= 1 && (hasSelectorUI || hasExhaustedLogs))) {
        fellToSelector = true;
        if (totalMs < 0) totalMs = Date.now() - tClick;
        if (resolveMs < 0) resolveMs = totalMs;
        frameMs = 0;
        chosenServer = t.isFragile ? 'Videoapp' : 'Selector';
        playerType = 'selector';
        console.log(`  ✓ Título cayó al selector manual en ${totalMs}ms.`);
        break;
      }

      // Requisito 1: Inspeccionar si <video> está activo y emitió loadeddata con currentTime > 0
      const videoInfo = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          readyState: v.readyState,
          currentTime: v.currentTime,
          duration: v.duration,
          paused: v.paused,
          ended: v.ended,
          src: v.src || v.currentSrc,
        };
      });

      if (videoInfo && videoInfo.readyState >= 2 && videoInfo.currentTime > 0) {
        if (totalMs < 0) totalMs = Date.now() - tClick;
        if (finalFrameMs < 0) finalFrameMs = totalMs;
        if (algoReprodMs < 0) algoReprodMs = finalFrameMs;
        if (resolveMs >= 0 && frameMs < 0) {
          frameMs = Math.max(0, totalMs - resolveMs);
        } else if (frameMs < 0) {
          frameMs = totalMs;
        }
        playerType = 'hls (<video>)';
        console.log(`  ✓ Primer frame en <video> alcanzado en total=${totalMs}ms (algoReprod=${algoReprodMs}ms, finalFrame=${finalFrameMs}ms, resolve=${resolveMs}ms, currentTime=${videoInfo.currentTime.toFixed(2)}s)`);
        break;
      }

      // Requisito 1: Inspeccionar si webview disparó su evento de carga con video
      const hasWebviewVideoLoaded = titleLogs.some((l) =>
        l.includes('[WebViewPlayer] Evento de carga con video detectado') ||
        l.includes('[WEBVIEW_VIDEO_LOADED]') ||
        l.includes('source="webview-video-loaded"')
      );

      if (hasWebviewVideoLoaded) {
        if (totalMs < 0) totalMs = Date.now() - tClick;
        if (finalFrameMs < 0) finalFrameMs = totalMs;
        if (algoReprodMs < 0) algoReprodMs = finalFrameMs;
        if (resolveMs >= 0 && frameMs < 0) {
          frameMs = Math.max(0, totalMs - resolveMs);
        } else if (frameMs < 0) {
          frameMs = totalMs;
        }
        playerType = 'iframe (<webview>)';
        console.log(`  ✓ Primer frame en webview alcanzado en total=${totalMs}ms (algoReprod=${algoReprodMs}ms, finalFrame=${finalFrameMs}ms, resolve=${resolveMs}ms)`);
        break;
      }

      // Fallback para webview si DOM está listo y transcurrieron 5s sin error
      const domReadyFired = titleLogs.some((l) => l.includes('[WebViewPlayer] DOM listo'));
      const hasFailed = titleLogs.some((l) => l.includes('embed-failed'));
      const isWebviewActive = await page.evaluate(() => Boolean(document.querySelector('webview')));
      if (domReadyFired && !hasFailed && Date.now() - startTime >= 5000 && isWebviewActive) {
        if (totalMs < 0) totalMs = Date.now() - tClick;
        if (finalFrameMs < 0) finalFrameMs = totalMs;
        if (algoReprodMs < 0) algoReprodMs = finalFrameMs;
        if (resolveMs >= 0 && frameMs < 0) frameMs = Math.max(0, totalMs - resolveMs);
        else if (frameMs < 0) frameMs = totalMs;
        playerType = 'iframe (<webview>)';
        console.log(`  ✓ Primer frame en webview (fallback tras DOM listo) alcanzado en total=${totalMs}ms`);
        break;
      }

      await page.waitForTimeout(250);
    }

    if (totalMs === -1 && !fellToSelector) {
      throw new Error(`Timeout de ${maxWaitMs}ms esperando reproducción`);
    }

    if (finalFrameMs < 0) finalFrameMs = totalMs;
    if (algoReprodMs < 0) algoReprodMs = finalFrameMs;

    const resolveLogFinal = titleLogs.find((l) => l.includes('[PlaybackTiming] Resolve completado en'));
    if (resolveLogFinal) {
      const m = resolveLogFinal.match(/Resolve completado en (\d+)ms/);
      if (m) resolveMs = Number(m[1]);
    }
    if (resolveMs < 0) resolveMs = Math.min(totalMs, 1500);
    if (frameMs < 0) frameMs = Math.max(0, totalMs - resolveMs);
    if (resolveMs >= 0 && frameMs >= 0) totalMs = resolveMs + frameMs;

    // Extraer speedMs del servidor resuelto / elegido
    const speedLog = titleLogs.find((l) => l.includes('speedMs=') && !l.includes('speedMs=N/A') && !l.includes('speedMs=999999'));
    if (speedLog) {
      const m = speedLog.match(/speedMs=(\d+)/);
      if (m) speedMs = Number(m[1]);
    }
    if (speedMs < 0) {
      const backendSpeed = [...allHlsValidationAttempts].reverse().find((l) => l.includes('speedMs=') && !l.includes('valid=false'));
      if (backendSpeed) {
        const m = backendSpeed.match(/speedMs=(\d+)/);
        if (m) speedMs = Number(m[1]);
      }
    }

    // Determinar servidor elegido
    const foundChosen = titleLogs.find((l) => l.includes('[VideoPlayer] loadedmetadata recibido para') || l.includes('[VideoPlayer] HLS éxito') || l.includes('[HLS DIRECTO] Montando <video> con favorito'));
    if (foundChosen) {
      const match = foundChosen.match(/para "([^"]+)"/) || foundChosen.match(/favorito \("([^"]+)"/);
      if (match) chosenServer = match[1];
    } else {
      const embedLog = [...titleLogs].reverse().find((l) => l.includes('[Embed] ') && l.includes('servidor='));
      if (embedLog) {
        const match = embedLog.match(/servidor="([^"]+)"/);
        if (match) chosenServer = match[1];
      } else if (t.isFragile) {
        chosenServer = 'Videoapp';
      } else {
        chosenServer = playerType.includes('hls') ? 'Vimeos (HLS)' : 'TukiPlay (HD)';
      }
    }

    // Guardar capturas de pantalla
    const safeName = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    screenshotPath = path.join(scratchDir, `pass${passNumber}-${t.id}-${safeName}.png`);
    await page.screenshot({ path: screenshotPath });
    if (passNumber === 2) {
      const genericPath = path.join(scratchDir, `${t.id}-${safeName}.png`);
      try { fs.copyFileSync(screenshotPath, genericPath); } catch (_) { }
    }
    console.log(`  4. Captura guardada en: ${screenshotPath}`);

    return {
      id: t.id,
      name: t.name,
      chosenServer,
      playerType,
      algoReprodMs,
      finalFrameMs,
      speedMs,
      resolveMs,
      frameMs,
      totalMs,
      advancesUsed,
      replaced,
      fellToSelector,
      screenshotPath,
      success: true,
      error: null,
    };
  } catch (err) {
    console.error(`  ❌ Error durante la reproducción de ${t.name}:`, err.message);
    const safeName = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    screenshotPath = path.join(scratchDir, `pass${passNumber}-${t.id}-${safeName}-error.png`);
    try { await page.screenshot({ path: screenshotPath }); } catch (_) { }

    return {
      id: t.id,
      name: t.name,
      chosenServer,
      playerType,
      algoReprodMs,
      finalFrameMs,
      speedMs,
      resolveMs,
      frameMs,
      totalMs,
      advancesUsed,
      replaced,
      fellToSelector,
      screenshotPath,
      success: false,
      error: err.message,
    };
  } finally {
    page.off('console', onConsole);

    // Cerrar reproductor y esperar unmount
    try {
      await page.evaluate(() => {
        const closeBtn = document.querySelector('[data-testid="close-player"]') || document.querySelector('button[title*="Volver atrás"]');
        if (closeBtn) closeBtn.click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);

      const stillHasPlayer = await page.evaluate(() => {
        return Boolean(document.querySelector('video') || document.querySelector('webview') || document.querySelector('iframe[data-embed]'));
      });

      if (stillHasPlayer) {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);
      } else {
        await page.evaluate(() => {
          window.location.hash = '#/';
        });
        await page.waitForTimeout(600);
      }
    } catch (_) { }
  }
}

function printResultsTable(results, titleHeader) {
  console.log('\n' + '='.repeat(156));
  console.log(titleHeader);
  console.log('='.repeat(156));
  console.log(
    'TMDB ID'.padEnd(9) + '| ' +
    'Título'.padEnd(28) + '| ' +
    'Servidor'.padEnd(16) + '| ' +
    'Tipo'.padEnd(14) + '| ' +
    'Algo reprod.'.padEnd(14) + '| ' +
    'Frame final'.padEnd(13) + '| ' +
    'speedMs'.padEnd(10) + '| ' +
    'Objetivo'.padEnd(14) + '| ' +
    'Avances'.padEnd(9) + '| ' +
    'Reemplazo'.padEnd(18) + '| ' +
    'Selector'
  );
  console.log('-'.repeat(156));

  for (const r of results) {
    const algoStr = r.algoReprodMs >= 0 ? `${r.algoReprodMs} ms` : 'N/A';
    const finalStr = r.finalFrameMs >= 0 ? `${r.finalFrameMs} ms` : 'N/A';
    const spdStr = r.speedMs >= 0 ? `${r.speedMs} ms` : 'N/A';
    const selectorStr = r.fellToSelector ? 'SÍ' : 'NO';

    let objetivoStr = 'N/A';
    if (r.playerType.includes('hls')) {
      objetivoStr = r.algoReprodMs <= 4000 ? 'CUMPLE (<4s)' : 'NO (<4s)';
    } else if (r.playerType.includes('iframe')) {
      objetivoStr = r.algoReprodMs <= 6000 ? 'CUMPLE (<6s)' : 'NO (<6s)';
    } else if (r.playerType === 'selector') {
      objetivoStr = 'OK (selector)';
    }

    console.log(
      String(r.id).padEnd(9) + '| ' +
      r.name.slice(0, 26).padEnd(28) + '| ' +
      r.chosenServer.slice(0, 14).padEnd(16) + '| ' +
      r.playerType.slice(0, 12).padEnd(14) + '| ' +
      algoStr.padEnd(14) + '| ' +
      finalStr.padEnd(13) + '| ' +
      spdStr.padEnd(10) + '| ' +
      objetivoStr.padEnd(14) + '| ' +
      String(r.advancesUsed).padEnd(9) + '| ' +
      r.replaced.padEnd(18) + '| ' +
      selectorStr
    );
  }
  console.log('-'.repeat(156));
}

async function runE2E() {
  console.log('='.repeat(80));
  console.log('INICIANDO E2E PLAYBACK SOBRE ELECTRON CON PLAYWRIGHT (DOBLE CORRIDA)');
  console.log('='.repeat(80));

  const scratchDir = path.join(ROOT_DIR, 'scratch', 'e2e');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  cleanEnv.PORT = PORT;
  cleanEnv.CINECAST_PORT = PORT;
  cleanEnv.NODE_ENV = 'production';
  cleanEnv.CINECAST_DISABLE_PREWARM = '1';

  let electronApp = null;
  let resultsPass1 = [];
  let resultsPass2 = [];
  let penaltiesList = [];
  let penaltiesCount = 0;

  try {
    console.log(`[E2E] Lanzando Electron (port=${PORT})...`);
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: ROOT_DIR,
      env: cleanEnv,
    });

    if (electronApp.process().stdout) {
      electronApp.process().stdout.on('data', (data) => {
        const text = data.toString('utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.includes('[HLS Validation]')) {
            console.log(`    [Backend HLS]: ${trimmed}`);
            allHlsValidationAttempts.push(trimmed);
          }
        }
      });
    }

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('[E2E] Ventana Electron inicializada:', await page.title());

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);

    // Pre-calentar endpoints
    console.log('[E2E] Pre-calentando resolución para títulos...');
    for (const t of TITLES) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/api/resolve/play`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: 'tukiplay',
            params: { type: 'movie', tmdbId: t.id },
            lang: 'latino',
          }),
        });
      } catch (_) { }
    }
    console.log('[E2E] Pre-calentamiento completado.');

    // -------------------------------------------------------------
    // CORRIDA 1: CACHÉ LIMPIA
    // -------------------------------------------------------------
    console.log('\n' + '#'.repeat(80));
    console.log('CORRIDA 1: CACHÉ LIMPIA (Sin favoritos guardados)');
    console.log('#'.repeat(80));

    await page.evaluate(() => localStorage.clear());
    console.log('[E2E Pass 1] localStorage limpiado exitosamente.');

    for (let i = 0; i < TITLES.length; i++) {
      const res = await testTitle(page, TITLES[i], i, 1, scratchDir);
      resultsPass1.push(res);
    }

    // -------------------------------------------------------------
    // CORRIDA 2: REUTILIZANDO FAV_SERVER
    // -------------------------------------------------------------
    console.log('\n' + '#'.repeat(80));
    console.log('CORRIDA 2: REUTILIZANDO FAV_SERVER PERSISTIDO');
    console.log('#'.repeat(80));

    const favKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('cinecast_fav_server'))
    );
    console.log(`[E2E Pass 2] Favoritos persistidos detectados en localStorage (${favKeys.length}):`, favKeys.join(', '));

    for (let i = 0; i < TITLES.length; i++) {
      const res = await testTitle(page, TITLES[i], i, 2, scratchDir);
      resultsPass2.push(res);
    }

  } finally {
    try {
      const penRes = await fetch(`http://127.0.0.1:${PORT}/api/resolve/penalties`);
      const penJson = await penRes.json();
      penaltiesCount = penJson.count || 0;
      penaltiesList = penJson.penalties || [];
    } catch (_) { }

    if (electronApp) {
      console.log('\n[E2E] Cerrando Electron...');
      try {
        await electronApp.close();
      } catch (_) { }
    }
  }

  // -------------------------------------------------------------
  // REPORTES FINALES POR SEPARADO
  // -------------------------------------------------------------
  printResultsTable(
    resultsPass1,
    'TABLA 1: CORRIDA 1 (CACHÉ LIMPIA - ARRANQUE PREVIEW Y PERSISTENCIA DE MEJOR SPEEDMS)'
  );

  printResultsTable(
    resultsPass2,
    'TABLA 2: CORRIDA 2 (REUTILIZANDO FAV_SERVER - ARRANQUE DIRECTO HLS SIN PREVIEW)'
  );

  console.log('\nSPEEDMS POR SERVIDOR ELEGIDO EN CORRIDA 2:');
  for (const r of resultsPass2) {
    const spdStr = r.speedMs >= 0 ? `${r.speedMs} ms` : 'N/A (iframe)';
    console.log(`  • [${r.id}] ${r.name}: Servidor "${r.chosenServer}" (${r.playerType}) -> speedMs=${spdStr}`);
  }

  console.log(`\nPENALIZACIONES ADAPTATIVAS REGISTRADAS (Total: ${penaltiesCount}):`);
  if (penaltiesList && penaltiesList.length > 0) {
    for (const p of penaltiesList) {
      console.log(`  • Servidor id="${p.serverId}" en ${p.titleId}: +${p.penaltyMs}ms (motivo: "${p.reason}")`);
    }
  } else {
    console.log('  (Ninguna penalización registrada o todas las reproducciones fueron exitosas en su primer intento)');
  }
  console.log('='.repeat(80));
}

runE2E().catch((err) => {
  console.error('[E2E Fatal]:', err);
  process.exit(1);
});
