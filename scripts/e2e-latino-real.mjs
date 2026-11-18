import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = '3099';

const TITLES = [
  // 3 de FuegoCine
  {
    id: 1368337,
    name: 'La Odisea',
    mediaType: 'movie',
    routeType: 'movie',
    provider: 'fuegocine',
    targetServerName: 'FuegoCine (Latino)',
    targetUrl: 'https://fuegocine.com/movies/watch/la-odisea/227',
  },
  {
    id: 1377237,
    name: 'Entrega al límite',
    mediaType: 'movie',
    routeType: 'movie',
    provider: 'fuegocine',
    targetServerName: 'FuegoCine (Latino)',
    targetUrl: 'https://fuegocine.com/movies/watch/entrega-al-límite/151',
  },
  {
    id: 1423191,
    name: 'Resident Evil: Noche cero',
    mediaType: 'movie',
    routeType: 'movie',
    provider: 'fuegocine',
    targetServerName: 'FuegoCine (Latino)',
    targetUrl: 'https://fuegocine.com/movies/watch/resident-evil-noche-cero/222',
  },
  // 3 de Latanime
  {
    id: 37854,
    name: 'One Piece',
    mediaType: 'series',
    routeType: 'series',
    catalogId: 'tmdb-anime-37854',
    provider: 'latanime',
    targetServerName: 'Latanime',
    targetUrl: 'https://latanime.org/ver/one-piece-latino-episodio-1',
  },
  {
    id: 46260,
    name: 'Naruto',
    mediaType: 'series',
    routeType: 'series',
    catalogId: 'tmdb-anime-46260',
    provider: 'latanime',
    targetServerName: 'Latanime',
    targetUrl: 'https://latanime.org/ver/naruto-latino-episodio-1',
  },
  {
    id: 73223,
    name: 'Black Clover',
    mediaType: 'series',
    routeType: 'series',
    catalogId: 'tmdb-anime-73223',
    provider: 'latanime',
    targetServerName: 'Latanime',
    targetUrl: 'https://latanime.org/ver/black-clover-latino-episodio-1',
  },
];

async function testTitle(page, t, titleIndex, scratchDir) {
  const titleLabel = `[#${titleIndex + 1}/${TITLES.length}] ${t.name} (TMDB ${t.id}) [${t.provider.toUpperCase()}]`;
  console.log('\n' + '='.repeat(80));
  console.log(`PROBANDO: ${titleLabel}`);
  console.log(`Objetivo: Probar reproducción en servidor "${t.targetServerName}" (${t.targetUrl})`);
  console.log('='.repeat(80));

  const titleLogs = [];
  const onConsole = (msg) => {
    const txt = msg.text();
    titleLogs.push(txt);
    if (
      txt.includes('[VideoPlayer]') ||
      txt.includes('[AutoAdvance]') ||
      txt.includes('[PlaybackTiming]') ||
      txt.includes('[WebViewPlayer]') ||
      txt.includes('[Embed]') ||
      txt.includes('webview') ||
      txt.includes('FuegoCine') ||
      txt.includes('Latanime')
    ) {
      console.log(`    [Console]: ${txt}`);
    }
  };
  page.on('console', onConsole);

  let chosenServer = 'Desconocido';
  let playerType = 'desconocido';
  let advancesUsed = 0;
  let totalMs = -1;
  let videoAppeared = false;
  let screenshotPath = '';
  const safeName = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    // 0. Resetear hash a Home
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.waitForTimeout(600);

    // 1. Configurar fav_server en localStorage para apuntar a la fuente destino
    await page.evaluate(({ t }) => {
      const favEntry = {
        name: t.targetServerName,
        url: t.targetUrl,
        type: 'iframe',
        timestamp: Date.now(),
      };
      // Setear variantes de keys
      localStorage.setItem(`cinecast_fav_server:${t.mediaType}:${t.id}`, JSON.stringify(favEntry));
      localStorage.setItem(`cinecast_fav_server:movie:${t.id}`, JSON.stringify(favEntry));
      localStorage.setItem(`cinecast_fav_server:series:${t.id}`, JSON.stringify(favEntry));
      localStorage.setItem(`cinecast_fav_server:anime:${t.id}`, JSON.stringify(favEntry));
      if (t.catalogId) {
        localStorage.setItem(`cinecast_fav_server:${t.mediaType}:${t.catalogId}`, JSON.stringify(favEntry));
      }
    }, { t });

    // 2. Navegar a la ficha
    const navId = t.catalogId || `tmdb-movie-${t.id}`;
    const hashUrl = `#/titulo/${t.routeType}/${navId}`;
    console.log(`  1. Navegando a ${hashUrl}...`);
    await page.evaluate((url) => {
      window.location.hash = url;
    }, hashUrl);

    // 3. Esperar botón Reproducir y hacer clic
    const playBtn = page.locator('button:has-text("Reproducir")').first();
    await playBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log('  2. Haciendo clic en "Reproducir"...');

    const tClick = Date.now();
    await playBtn.click();

    // 4. Esperar inicio de reproducción en WebViewPlayer o Video
    console.log('  3. Esperando carga del reproductor y reproducción de video...');
    const maxWaitMs = 25000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      // Extraer avances
      const advanceLogs = titleLogs.filter((l) => l.includes('[AutoAdvance] Avance #'));
      advancesUsed = advanceLogs.length;

      // Si aún no está seleccionado el servidor objetivo, verificar la barra de servidores
      const serverBtnFound = await page.evaluate((target) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find((b) => b.textContent && b.textContent.includes(target));
        if (btn && !btn.className.includes('bg-red-600')) {
          btn.click();
          return true;
        }
        return false;
      }, t.targetServerName);

      if (serverBtnFound) {
        console.log(`  -> Click en botón selector para forzar servidor objetivo: "${t.targetServerName}"`);
      }

      // Detectar si webview disparó evento de carga con video o dom ready
      const hasWebviewVideoLoaded = titleLogs.some((l) =>
        l.includes('[WebViewPlayer] Evento de carga con video detectado') ||
        l.includes('[WEBVIEW_VIDEO_LOADED]') ||
        l.includes('source="webview-video-loaded"')
      );

      const hasDomReady = titleLogs.some((l) => l.includes('[WebViewPlayer] DOM listo'));
      const isWebviewActive = await page.evaluate(() => Boolean(document.querySelector('webview')));

      // Verificar si hay video tag dentro del DOM principal (o dentro de webview)
      const videoInfo = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          readyState: v.readyState,
          currentTime: v.currentTime,
          paused: v.paused,
        };
      });

      if (videoInfo && videoInfo.readyState >= 2) {
        totalMs = Date.now() - tClick;
        videoAppeared = true;
        playerType = 'hls (<video>)';
        chosenServer = t.targetServerName;
        console.log(`  ✓ Video detectado en <video> tag en ${totalMs}ms`);
        break;
      }

      if (hasWebviewVideoLoaded) {
        totalMs = Date.now() - tClick;
        videoAppeared = true;
        playerType = 'iframe (<webview>)';
        chosenServer = t.targetServerName;
        console.log(`  ✓ Video detectado en <webview> en ${totalMs}ms`);
        break;
      }

      // Si el webview está activo y ya pasaron al menos 4 segundos tras DOM listo
      if (isWebviewActive && hasDomReady && Date.now() - startTime >= 4000) {
        totalMs = Date.now() - tClick;
        videoAppeared = true;
        playerType = 'iframe (<webview>)';
        chosenServer = t.targetServerName;
        console.log(`  ✓ Webview activo y DOM listo en ${totalMs}ms`);
        break;
      }

      await page.waitForTimeout(300);
    }

    if (!videoAppeared) {
      totalMs = Date.now() - tClick;
      console.warn(`  ⚠️ No se confirmó evento de video en los primeros ${maxWaitMs}ms`);
    }

    // Esperar 2 segundos para dar tiempo al render visual antes del screenshot
    await page.waitForTimeout(2000);

    // 5. Captura de pantalla
    screenshotPath = path.join(scratchDir, `${t.provider}-${t.id}-${safeName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`  4. Captura guardada en: ${screenshotPath}`);

    return {
      id: t.id,
      name: t.name,
      provider: t.provider,
      chosenServer: chosenServer || t.targetServerName,
      playerType,
      videoAppeared: videoAppeared ? 'SÍ' : 'NO',
      totalMs: totalMs > 0 ? totalMs : maxWaitMs,
      advancesUsed,
      audio: 'desconocido (sin pistas HLS)',
      screenshotPath,
      success: videoAppeared,
    };
  } catch (err) {
    console.error(`  ❌ Error durante la prueba de ${t.name}:`, err.message);
    screenshotPath = path.join(scratchDir, `${t.provider}-${t.id}-${safeName}-error.png`);
    try {
      await page.screenshot({ path: screenshotPath });
    } catch (_) {}

    return {
      id: t.id,
      name: t.name,
      provider: t.provider,
      chosenServer: t.targetServerName,
      playerType: 'error',
      videoAppeared: 'NO',
      totalMs: -1,
      advancesUsed,
      audio: 'desconocido',
      screenshotPath,
      success: false,
      error: err.message,
    };
  } finally {
    page.off('console', onConsole);

    // Cerrar reproductor con Escape
    try {
      await page.evaluate(() => {
        const closeBtn =
          document.querySelector('[data-testid="close-player"]') ||
          document.querySelector('button[title*="Volver atrás"]');
        if (closeBtn) closeBtn.click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const stillHasPlayer = await page.evaluate(() => {
        return Boolean(document.querySelector('video') || document.querySelector('webview'));
      });

      if (stillHasPlayer) {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);
      } else {
        await page.evaluate(() => {
          window.location.hash = '#/';
        });
        await page.waitForTimeout(500);
      }
    } catch (_) {}
  }
}

async function runE2E() {
  console.log('='.repeat(80));
  console.log('INICIANDO E2E REAL: 3 TÍTULOS FUEGOCINE + 3 TÍTULOS LATANIME');
  console.log('='.repeat(80));

  const scratchDir = path.join(ROOT_DIR, 'scratch', 'e2e-latino');
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
  const results = [];

  try {
    console.log(`[E2E] Lanzando Electron en puerto ${PORT}...`);
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: ROOT_DIR,
      env: cleanEnv,
    });

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('[E2E] Ventana Electron cargada:', await page.title());

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    for (let i = 0; i < TITLES.length; i++) {
      const res = await testTitle(page, TITLES[i], i, scratchDir);
      results.push(res);
    }
  } finally {
    if (electronApp) {
      console.log('\n[E2E] Cerrando Electron...');
      try {
        await electronApp.close();
      } catch (_) {}
    }
  }

  // Imprimir tabla final
  console.log('\n' + '='.repeat(130));
  console.log('RESULTADO FINAL E2E - FUEGOCINE Y LATANIME (6 TÍTULOS)');
  console.log('='.repeat(130));
  console.log(
    'TMDB ID'.padEnd(9) + '| ' +
    'Proveedor'.padEnd(12) + '| ' +
    'Título'.padEnd(28) + '| ' +
    'Servidor'.padEnd(20) + '| ' +
    'Video?'.padEnd(8) + '| ' +
    'Tiempo (ms)'.padEnd(14) + '| ' +
    'Avances'.padEnd(9) + '| ' +
    'Audio'.padEnd(22) + '| ' +
    'Veredicto'
  );
  console.log('-'.repeat(130));

  for (const r of results) {
    const tStr = r.totalMs > 0 ? `${r.totalMs} ms` : 'N/A';
    const veredicto = r.success ? 'REPRODUCIDO' : 'FALLO';
    console.log(
      String(r.id).padEnd(9) + '| ' +
      r.provider.padEnd(12) + '| ' +
      r.name.slice(0, 26).padEnd(28) + '| ' +
      r.chosenServer.slice(0, 18).padEnd(20) + '| ' +
      r.videoAppeared.padEnd(8) + '| ' +
      tStr.padEnd(14) + '| ' +
      String(r.advancesUsed).padEnd(9) + '| ' +
      r.audio.slice(0, 20).padEnd(22) + '| ' +
      veredicto
    );
  }

  console.log('='.repeat(130));

  const fuegoSuccess = results.filter((r) => r.provider === 'fuegocine' && r.success).length;
  const latanimeSuccess = results.filter((r) => r.provider === 'latanime' && r.success).length;

  console.log(`\nRESUMEN DE CRITERIO (Mínimo 3/3 para mantenerse activo):`);
  console.log(`  • FuegoCine: ${fuegoSuccess}/3 exitosos -> ${fuegoSuccess >= 3 ? 'MANTENER HABILITADO' : 'APAGAR (enabled: false)'}`);
  console.log(`  • Latanime:  ${latanimeSuccess}/3 exitosos -> ${latanimeSuccess >= 3 ? 'MANTENER HABILITADO' : 'APAGAR (enabled: false)'}`);
}

runE2E().catch((err) => {
  console.error('[E2E Fatal]:', err);
  process.exit(1);
});
