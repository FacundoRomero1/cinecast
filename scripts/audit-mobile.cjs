const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const baseUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const rootDir = path.resolve(__dirname, '..');
const shotsDir = path.join(rootDir, 'scratch', 'shots');
const reportFile = path.join(rootDir, 'scratch', 'audit-mobile-report.md');
fs.mkdirSync(shotsDir, { recursive: true });

// Handlers IPC para preload.cjs
ipcMain.handle('get-local-ip', () => ({ ip: '127.0.0.1', port: 3000 }));
ipcMain.handle('get-diagnostic-mode', () => false);
ipcMain.handle('set-diagnostic-mode', () => false);
ipcMain.handle('get-no-cors-fix', () => false);
ipcMain.handle('set-no-cors-fix', () => false);
ipcMain.handle('get-saved-accounts', () => ({ accounts: [], playlists: [], favorites: [] }));
ipcMain.handle('save-accounts', () => true);
ipcMain.handle('get-detected-tracks', () => null);
ipcMain.handle('get-embed-status', () => []);
ipcMain.handle('check-embed-providers', () => []);
ipcMain.handle('probe-streams', (_e, urls) => []);
ipcMain.handle('get-real-media-state', () => null);
ipcMain.handle('focus-window', () => true);
ipcMain.handle('send-native-key', () => true);
ipcMain.handle('control-active-media', () => true);
ipcMain.handle('set-master-volume', () => true);
ipcMain.handle('send-native-trackpad-event', () => true);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROUTES = [
  { slug: 'inicio', route: '#/' },
  { slug: 'explorar', route: '#/explorar' },
  { slug: 'buscar', route: '#/buscar' },
  { slug: 'lista', route: '#/lista' },
  { slug: 'deportes', route: '#/deportes' },
  { slug: 'canales', route: '#/canales' },
  { slug: 'musica', route: '#/musica' },
  { slug: 'youtube', route: '#/youtube' },
  { slug: 'ajustes', route: '#/ajustes' },
  { slug: 'control', route: '#/control' },
  { slug: 'movie-969681', route: '#/titulo/movie/tmdb-movie-969681' },
  { slug: 'series-breaking-bad', route: '#/titulo/series/breaking-bad' },
];

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
];

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);
    } catch (_) {}
  }

  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
  const userAgent =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  const rows = [];
  const detailedOcclusions = [];

  const win = new BrowserWindow({
    show: false,
    width: 360,
    height: 640,
    webPreferences: {
      partition: 'persist:audit-mobile',
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setUserAgent(userAgent);

  for (const vp of VIEWPORTS) {
    win.setSize(vp.width, vp.height);

    for (const r of ROUTES) {
      const url = `${baseUrl}/?role=remote&ui=nuevo${r.route}`;
      try {
        await win.loadURL(url);
      } catch (err) {
        console.warn(`Error cargando ${url}:`, err.message);
      }

      try {
        win.webContents.enableDeviceEmulation({
          screenPosition: 'mobile',
          screenSize: { width: vp.width, height: vp.height },
          viewSize: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
        });
      } catch (_) {}

      // Esperar 5 s exactos
      await wait(5000);

      // Medir (a) desborde horizontal, (b) tapados / fuera de pantalla, (c) < 44x44
      const initialMetrics = await win.webContents.executeJavaScript(`
        (function() {
          const docEl = document.documentElement;
          const body = document.body;
          const overflow = (docEl.scrollWidth > window.innerWidth + 2) || (body && body.scrollWidth > window.innerWidth + 2);

          const selectors = 'button, a, input, select, [role="button"], [tabindex]:not([tabindex="-1"])';
          const candidates = Array.from(document.querySelectorAll(selectors));

          let offscreenCount = 0;
          let occludedCount = 0;
          let smallCount = 0;
          const smallExamples = [];
          const occludedItems = [];
          const offscreenItems = [];

          candidates.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) return;

            // Tamaño mínimo 44x44 px
            if (rect.width < 43.5 || rect.height < 43.5) {
              smallCount++;
              if (smallExamples.length < 5) {
                const text = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 35);
                smallExamples.push(\`\${el.tagName.toLowerCase()}[\${Math.round(rect.width)}x\${Math.round(rect.height)}]: "\${text}"\`);
              }
            }

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
              offscreenCount++;
              if (offscreenItems.length < 5) {
                const text = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40);
                offscreenItems.push({ text, pos: \`(\${Math.round(cx)},\${Math.round(cy)})\` });
              }
            } else {
              const topEl = document.elementFromPoint(cx, cy);
              if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                occludedCount++;
                if (occludedItems.length < 5) {
                  const elText = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40);
                  const coverDesc = \`\${topEl.tagName.toLowerCase()}\${topEl.className ? '.' + topEl.className.slice(0, 25).replace(/\\s+/g, '.') : ''}\`;
                  occludedItems.push({ text: elText, coveredBy: coverDesc });
                }
              }
            }
          });

          return {
            overflow,
            scrollWidth: Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0),
            innerWidth: window.innerWidth,
            offscreenCount,
            occludedCount,
            smallCount,
            smallExamples,
            occludedItems,
            offscreenItems,
          };
        })()
      `);

      // (d) Scrollear hasta abajo y repetir medición de tapados por drawer / tabbar
      const bottomMetrics = await win.webContents.executeJavaScript(`
        (function() {
          window.scrollTo(0, document.documentElement.scrollHeight);
          return new Promise((resolve) => {
            setTimeout(() => {
              const selectors = 'button, a, input, select, [role="button"], [tabindex]:not([tabindex="-1"])';
              const candidates = Array.from(document.querySelectorAll(selectors));

              let bottomOccludedCount = 0;
              const bottomOccluded = [];

              candidates.forEach((el) => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) return;

                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                if (cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight) {
                  const topEl = document.elementFromPoint(cx, cy);
                  if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                    bottomOccludedCount++;
                    if (bottomOccluded.length < 5) {
                      const elText = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40);
                      const coverDesc = \`\${topEl.tagName.toLowerCase()}\${topEl.className ? '.' + topEl.className.slice(0, 25).replace(/\\s+/g, '.') : ''}\`;
                      bottomOccluded.push({ text: elText, coveredBy: coverDesc });
                    }
                  }
                }
              });

              resolve({ bottomOccludedCount, bottomOccluded });
            }, 400);
          });
        })()
      `);

      // Volver arriba antes de captura
      await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
      await wait(200);

      // Captura de pantalla
      const shotName = `mobile-${r.slug}-${vp.width}.png`;
      try {
        win.showInactive();
        await wait(200);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(shotsDir, shotName), image.toPNG());
      } catch (e) {
        console.warn(`Error guardando captura ${shotName}:`, e.message);
      }

      const totalOccluded = initialMetrics.occludedCount + bottomMetrics.bottomOccludedCount;

      rows.push({
        ruta: r.route,
        ancho: vp.width,
        desborde: initialMetrics.overflow ? `SI (${initialMetrics.scrollWidth}px)` : 'NO',
        tapados: totalOccluded,
        fueraDePantalla: initialMetrics.offscreenCount,
        chicos: initialMetrics.smallCount,
      });

      if (initialMetrics.occludedItems.length > 0 || bottomMetrics.bottomOccluded.length > 0 || initialMetrics.offscreenItems.length > 0) {
        detailedOcclusions.push({
          ruta: r.route,
          ancho: vp.width,
          occluded: [...initialMetrics.occludedItems, ...bottomMetrics.bottomOccluded],
          offscreen: initialMetrics.offscreenItems,
          smallExamples: initialMetrics.smallExamples,
        });
      }
    }
  }

  win.destroy();

  let out = '# Reporte de Auditoría Móvil (solo medición)\n\n';
  out += '| ruta | ancho | desborde | tapados | fuera de pantalla | chicos |\n';
  out += '| :--- | :---: | :---: | :---: | :---: | :---: |\n';
  for (const row of rows) {
    out += `| \`${row.ruta}\` | ${row.ancho} | ${row.desborde} | ${row.tapados} | ${row.fueraDePantalla} | ${row.chicos} |\n`;
  }

  out += '\n## Detalle de elementos tapados, fuera de pantalla y menores a 44x44 px\n';
  for (const d of detailedOcclusions) {
    out += `\n### \`${d.ruta}\` @ ${d.ancho}px\n`;
    if (d.occluded.length > 0) {
      out += '**Tapados:**\n';
      d.occluded.forEach((o) => {
        out += `- "${o.text}" tapado por \`<${o.coveredBy}>\`\n`;
      });
    }
    if (d.offscreen.length > 0) {
      out += '**Fuera de pantalla:**\n';
      d.offscreen.forEach((o) => {
        out += `- "${o.text}" en ${o.pos}\n`;
      });
    }
    if (d.smallExamples.length > 0) {
      out += '**Primeros ejemplos < 44x44 px:**\n';
      d.smallExamples.forEach((s) => {
        out += `- ${s}\n`;
      });
    }
  }

  fs.writeFileSync(reportFile, out, 'utf8');
  console.log(out);

  app.quit();
});
