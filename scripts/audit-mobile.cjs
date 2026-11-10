const { app, components, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const baseUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const rootDir = path.resolve(__dirname, '..');
const shotsDir = path.join(rootDir, 'scratch', 'shots');
const docsDir = path.join(rootDir, 'docs');
const reportFile = path.join(docsDir, 'AUDIT_MOVIL.md');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

// Pre-cargar archivos fuente para búsqueda rápida de origen probable
const sourceFiles = [];
function collectSources(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== 'dist' && ent.name !== 'scratch') {
      collectSources(full);
    } else if (ent.isFile() && (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts'))) {
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      sourceFiles.push({ file: rel, lines });
    }
  }
}
collectSources(path.join(rootDir, 'src'));

function findProbableSource(text, className = '') {
  const cleanText = (text || '').trim();
  const searchKeywords = [];
  if (cleanText.length >= 3 && !/^(button|div|span|select|a|input)$/i.test(cleanText)) {
    const words = cleanText.split(/[\s:()•]+/g).filter((w) => w.length >= 3);
    if (words.length > 0) searchKeywords.push(words[0]);
    if (words.length > 1) searchKeywords.push(words.slice(0, 2).join(' '));
  }

  const classTokens = (className || '')
    .split(/\s+/g)
    .filter((c) => c.length >= 5 && !/^(flex|items|justify|text|bg|border|rounded|p-|m-)/.test(c));

  for (const sf of sourceFiles) {
    for (let idx = 0; idx < sf.lines.length; idx++) {
      const line = sf.lines[idx];
      for (const kw of searchKeywords) {
        if (line.includes(kw)) {
          return `${sf.file}:${idx + 1}`;
        }
      }
      for (const ct of classTokens) {
        if (line.includes(ct)) {
          return `${sf.file}:${idx + 1}`;
        }
      }
    }
  }

  return 'src/ui/ (no determinado)';
}

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
  const detailedRouteData = [];

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

      // Esperar 4 s para render
      await wait(4000);

      const metrics = await win.webContents.executeJavaScript(`
        (function() {
          const docEl = document.documentElement;
          const body = document.body;
          const overflow = (docEl.scrollWidth > window.innerWidth + 2) || (body && body.scrollWidth > window.innerWidth + 2);

          const selectors = 'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
          const allElements = Array.from(document.querySelectorAll(selectors));

          // (a) Solo cuenta elementos interactivos visibles que NO sean descendientes de otro interactivo
          const candidates = allElements.filter((el) => {
            let p = el.parentElement;
            while (p && p !== document.body) {
              if (p.matches && p.matches(selectors)) {
                return false;
              }
              p = p.parentElement;
            }
            return true;
          });

          // (b) Helper para descartar elementos fuera de pantalla por scroll horizontal en carruseles
          function isInHorizontalScrollContainer(el) {
            let p = el.parentElement;
            while (p && p !== document.body) {
              const style = window.getComputedStyle(p);
              const ox = style.overflowX;
              if (ox === 'auto' || ox === 'scroll' || p.scrollWidth > p.clientWidth + 2) {
                return true;
              }
              p = p.parentElement;
            }
            return false;
          }

          let occludedCount = 0;
          let smallCount = 0;
          const smallMap = {};
          const occludedItems = [];

          candidates.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) return;

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            // (b) Descarta los que quedan fuera por scroll horizontal dentro de un contenedor con overflow-x
            if ((cx < 0 || cx > window.innerWidth) && isInHorizontalScrollContainer(el)) {
              return;
            }

            // (d) "chico" = alto o ancho menor a 44 px
            if (rect.width < 43.5 || rect.height < 43.5) {
              smallCount++;
              const text = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 45);
              const tag = el.tagName.toLowerCase();
              const key = \`\${tag}[\${Math.round(rect.width)}x\${Math.round(rect.height)}]: "\${text}"\`;
              const elClass = typeof el.className === 'string' ? el.className.slice(0, 50) : '';
              if (!smallMap[key]) {
                smallMap[key] = { count: 0, text, tag, width: Math.round(rect.width), height: Math.round(rect.height), className: elClass };
              }
              smallMap[key].count++;
            }

            // (c) "tapado" = su centro, dentro de la pantalla, queda cubierto por un elemento que no es él, ni descendiente ni ancestro
            if (cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight) {
              const topEl = document.elementFromPoint(cx, cy);
              if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                occludedCount++;
                const elText = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 45);
                const coverDesc = \`\${topEl.tagName.toLowerCase()}\${topEl.className ? '.' + topEl.className.slice(0, 30).replace(/\\s+/g, '.') : ''}\`;
                const elClass = typeof el.className === 'string' ? el.className.slice(0, 50) : '';
                occludedItems.push({ text: elText, coveredBy: coverDesc, className: elClass });
              }
            }
          });

          return {
            overflow,
            scrollWidth: Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0),
            occludedCount,
            smallCount,
            smallMap,
            occludedItems,
          };
        })()
      `);

      // Medición al final del scroll para verificar si el drawer o barra inferior tapa contenido al final
      const bottomMetrics = await win.webContents.executeJavaScript(`
        (function() {
          window.scrollTo(0, document.documentElement.scrollHeight);
          return new Promise((resolve) => {
            setTimeout(() => {
              const selectors = 'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
              const allElements = Array.from(document.querySelectorAll(selectors));

              const candidates = allElements.filter((el) => {
                let p = el.parentElement;
                while (p && p !== document.body) {
                  if (p.matches && p.matches(selectors)) {
                    return false;
                  }
                  p = p.parentElement;
                }
                return true;
              });

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
                    const elText = (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 45);
                    const coverDesc = \`\${topEl.tagName.toLowerCase()}\${topEl.className ? '.' + topEl.className.slice(0, 30).replace(/\\s+/g, '.') : ''}\`;
                    const elClass = typeof el.className === 'string' ? el.className.slice(0, 50) : '';
                    bottomOccluded.push({ text: elText, coveredBy: coverDesc, className: elClass });
                  }
                }
              });

              resolve({ bottomOccludedCount, bottomOccluded });
            }, 300);
          });
        })()
      `);

      // Volver arriba para la captura
      await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
      await wait(150);

      // Captura
      const shotName = `mobile-${r.slug}-${vp.width}.png`;
      try {
        win.showInactive();
        await wait(100);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(shotsDir, shotName), image.toPNG());
      } catch (e) {
        console.warn(`Error guardando captura ${shotName}:`, e.message);
      }

      // Unir elementos tapados iniciales y del final (sin duplicados exactos)
      const occludedAll = [...metrics.occludedItems];
      for (const bo of bottomMetrics.bottomOccluded) {
        if (!occludedAll.some((o) => o.text === bo.text && o.coveredBy === bo.coveredBy)) {
          occludedAll.push(bo);
        }
      }

      // Agrupar elementos chicos y ordenar por frecuencia descendente (top 15)
      const smallList = Object.entries(metrics.smallMap)
        .map(([key, val]) => ({ key, ...val }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      rows.push({
        ruta: r.route,
        ancho: vp.width,
        desborde: metrics.overflow ? `SI (${metrics.scrollWidth}px)` : 'NO',
        tapados: occludedAll.length,
        chicos: metrics.smallCount,
      });

      detailedRouteData.push({
        ruta: r.route,
        ancho: vp.width,
        occluded: occludedAll,
        smallList,
      });
    }
  }

  win.destroy();

  // Generar reporte en Markdown
  let out = '# Reporte de Auditoría Móvil Confiable\n\n';
  out += '| ruta | ancho | desborde | tapados | chicos |\n';
  out += '| :--- | :---: | :---: | :---: | :---: |\n';
  for (const row of rows) {
    out += `| \`${row.ruta}\` | ${row.ancho} | ${row.desborde} | ${row.tapados} | ${row.chicos} |\n`;
  }

  out += '\n## Detalle de Elementos Tapados y Menores a 44x44 px\n';
  for (const d of detailedRouteData) {
    out += `\n### \`${d.ruta}\` @ ${d.ancho}px\n`;
    if (d.occluded.length === 0 && d.smallList.length === 0) {
      out += '✓ Sin elementos tapados ni menores a 44x44 px.\n';
      continue;
    }

    if (d.occluded.length > 0) {
      out += '**Elementos Tapados:**\n';
      for (const o of d.occluded) {
        const source = findProbableSource(o.text, o.className);
        out += `- "${o.text}" | Archivo: \`${source}\` | Tapado por: \`<${o.coveredBy}>\`\n`;
      }
    }

    if (d.smallList.length > 0) {
      out += '**Elementos menores a 44x44 px (Top más frecuentes):**\n';
      for (const s of d.smallList) {
        const source = findProbableSource(s.text, s.className);
        out += `- (${s.count}x) \`${s.tag}\` [${s.width}x${s.height}px] "${s.text}" | Archivo: \`${source}\`\n`;
      }
    }
  }

  out += '\n## Componentes Clásicos Prohibidos (No Modificados)\n';
  out += 'Los elementos dentro de componentes clásicos no se modificaron respetando las reglas de la consigna:\n';
  out += '- `src/components/DetailModal.tsx`: Botones de acción y controles internos de ficha modal (ej: botón cerrar 42x42px, selector de temporada).\n';
  out += '- `src/components/RemoteControlDrawer.tsx`: Mini-control remoto fijo y controles de transporte en vista dedicada `#/control`.\n';

  fs.writeFileSync(reportFile, out, 'utf8');
  console.log(out);

  app.exit(0);
});
