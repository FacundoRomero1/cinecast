const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { startTestEnv } = require('./lib/testenv.cjs');

if (!process.versions.electron) {
  const electronPath = require('electron');
  const res = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, CINECAST_TEST: '1' },
  });
  process.exit(res.status ?? 1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let testEnv = null;

const globalTimeout = setTimeout(() => {
  console.error('[probe-badge-overlap] TIMEOUT GLOBAL (140s)');
  if (testEnv) try { testEnv.stop(); } catch (_) {}
  app.exit(1);
}, 140000);

app.whenReady().then(async () => {
  try {
    testEnv = await startTestEnv({ name: 'probe-badge-overlap', useLanIp: true, seedHistory: true });
    const baseUrl = testEnv.lanBase;
    const roomId = testEnv.room;
    const preloadPath = path.join(__dirname, '../electron/preload.cjs');

    const safeHandle = (channel, fn) => {
      try { ipcMain.removeHandler(channel); } catch (_) {}
      try { ipcMain.handle(channel, fn); } catch (_) {}
    };

    safeHandle('get-local-ip', () => ({ ip: testEnv.lanIp, port: testEnv.port }));
    safeHandle('get-diagnostic-mode', () => false);
    safeHandle('set-diagnostic-mode', () => false);
    safeHandle('get-no-cors-fix', () => false);
    safeHandle('check-embed-providers', () => []);
    safeHandle('focus-window', () => true);
    safeHandle('set-master-volume', () => ({ ok: true }));
    safeHandle('get-real-media-state', () => null);

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:probe-badge-overlap',
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const initialUrl = `${baseUrl}/?ui=nuevo&room=${encodeURIComponent(roomId)}#/`;
    console.log(`[probe-badge-overlap] Cargando URL inicial: ${initialUrl}`);
    await win.loadURL(initialUrl);
    await wait(2000);

    const dbg = win.webContents.debugger;
    try {
      dbg.attach('1.3');
    } catch (e) {
      console.warn('[probe-badge-overlap] Debugger attach error:', e.message);
    }

    const setMetrics = async (w, h) => {
      try {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: 2,
          mobile: w < 768,
        });
      } catch (err) {
        console.warn(`[probe-badge-overlap] Error setting metrics ${w}x${h}:`, err.message);
      }
    };

    const targetWidths = [320, 360, 390, 412, 768, 1280];
    const routes = [
      { name: 'Inicio', path: '#/' },
      { name: 'Explorar', path: '#/explorar' },
      { name: 'Buscar', path: '#/buscar' },
      { name: 'Mi lista', path: '#/lista' },
    ];

    const scratchDir = path.join(__dirname, '../scratch');
    fs.mkdirSync(scratchDir, { recursive: true });

    const summaryByWidth = [];
    let totalOverlapCount = 0;
    let totalOverflowCount = 0;

    for (const w of targetWidths) {
      console.log(`\n--- Evaluando ancho: ${w} px ---`);
      await setMetrics(w, 800);
      await wait(300);

      let cardsEvaluated = 0;
      let widthOverlaps = 0;
      let widthOverflows = 0;
      let tightestCard = null;

      for (const route of routes) {
        const fullUrl = `${baseUrl}/?ui=nuevo&room=${encodeURIComponent(roomId)}${route.path}`;
        await win.loadURL(fullUrl);
        await wait(1200);

        if (route.name === 'Buscar') {
          // Disparar búsqueda para poblar tarjetas
          await win.webContents.executeJavaScript(`
            (() => {
              const input = document.querySelector('input[type="text"], input[aria-label*="Buscar"]');
              if (input) {
                input.value = 'el';
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            })()
          `);
          await wait(1200);
        }

        // Inspeccionar todas las tarjetas
        const result = await win.webContents.executeJavaScript(`
          (() => {
            const cards = Array.from(document.querySelectorAll('article[data-card-id]'));
            const data = [];
            for (const card of cards) {
              const badge = card.querySelector('[data-card-badge]');
              const rating = card.querySelector('[data-card-rating]');
              const meta = card.querySelector('[data-card-meta]');
              if (!badge || !rating) continue;

              const bRect = badge.getBoundingClientRect();
              const rRect = rating.getBoundingClientRect();
              const cRect = card.getBoundingClientRect();

              // Visible y renderizado
              if (bRect.width === 0 || rRect.width === 0 || cRect.width === 0) continue;

              const overlap = !(
                bRect.right <= rRect.left ||
                bRect.left >= rRect.right ||
                bRect.bottom <= rRect.top ||
                bRect.top >= rRect.bottom
              );

              const overflow = (
                bRect.right > cRect.right + 2 ||
                bRect.left < cRect.left - 2 ||
                rRect.right > cRect.right + 2 ||
                rRect.left < cRect.left - 2
              );

              data.push({
                id: card.getAttribute('data-card-id'),
                cardWidth: cRect.width,
                overlap,
                overflow,
                rect: {
                  x: Math.round(cRect.x),
                  y: Math.round(cRect.y),
                  width: Math.round(cRect.width),
                  height: Math.round(cRect.height),
                },
                bRect: { x: bRect.x, y: bRect.y, w: bRect.width, h: bRect.height },
                rRect: { x: rRect.x, y: rRect.y, w: rRect.width, h: rRect.height },
              });
            }
            return data;
          })()
        `);

        for (const c of result) {
          cardsEvaluated++;
          if (c.overlap) {
            widthOverlaps++;
            console.error(`[OVERLAP DETECTADO] en ${route.name} (${w}px), cardId=${c.id}`);
          }
          if (c.overflow) {
            widthOverflows++;
            console.error(`[DESBORDE DETECTADO] en ${route.name} (${w}px), cardId=${c.id}`);
          }

          if (!tightestCard || c.cardWidth < tightestCard.cardWidth) {
            tightestCard = c;
          }
        }
      }

      totalOverlapCount += widthOverlaps;
      totalOverflowCount += widthOverflows;

      console.log(`[${w}px] Tarjetas evaluadas: ${cardsEvaluated}, Solapamientos: ${widthOverlaps}, Desbordes: ${widthOverflows}`);

      // Captura de pantalla para 320px y 360px
      if ((w === 320 || w === 360) && tightestCard && tightestCard.rect) {
        const shotPath = path.join(scratchDir, `badge-${w}px.png`);
        try {
          const img = await win.webContents.capturePage({
            x: Math.max(0, tightestCard.rect.x),
            y: Math.max(0, tightestCard.rect.y),
            width: Math.max(50, tightestCard.rect.width),
            height: Math.max(50, tightestCard.rect.height),
          });
          fs.writeFileSync(shotPath, img.toPNG());
          console.log(`[probe-badge-overlap] Captura guardada en ${shotPath}`);
        } catch (err) {
          console.warn(`[probe-badge-overlap] No se pudo guardar captura ${w}px:`, err.message);
        }
      }

      summaryByWidth.push({
        width: w,
        cards: cardsEvaluated,
        overlaps: widthOverlaps,
        overflows: widthOverflows,
        pass: widthOverlaps === 0 && widthOverflows === 0 && cardsEvaluated > 0,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TABLA FINAL
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n=== RESULTADOS PARTE 6: INSIGNIA PELÍCULA/SERIE SOBRE ESTRELLAS ===');
    console.log('| Ancho (px) | Vistas verificadas | Tarjetas verificadas | Solapamientos | Desbordes | Estado |');
    console.log('|---|---|---|---|---|---|');
    for (const s of summaryByWidth) {
      console.log(`| ${s.width} px | Inicio, Explorar, Buscar, Mi lista | ${s.cards} | ${s.overlaps} | ${s.overflows} | **${s.pass ? 'PASA' : 'FALLA'}** |`);
    }

    const allPassed = summaryByWidth.every((s) => s.pass);
    console.log(`\nRESULTADO GLOBAL: ${allPassed ? 'PASA' : 'FALLA'}`);

    if (testEnv) await testEnv.stop();
    clearTimeout(globalTimeout);
    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[probe-badge-overlap] Error crítico:', err);
    if (testEnv) try { await testEnv.stop(); } catch (_) {}
    clearTimeout(globalTimeout);
    app.exit(1);
  }
});
