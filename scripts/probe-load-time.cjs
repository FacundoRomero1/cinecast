if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: cleanEnv });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, session, webContents, net } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { startTestEnv } = require('./lib/testenv.cjs');
const { createLoadDiagnosticsManager } = require('../electron/loadDiagnostics.cjs');

app.on('window-all-closed', () => {});

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
}

let compatMode = false;
let periodicQueriesOff = false;
let trackedWebviews = new Set();
let mockTraceServer = null;
let env = null;

const globalTimer = setTimeout(() => {
  console.error('[probe-load-time] TIMEOUT GLOBAL (145s)');
  if (mockTraceServer) try { mockTraceServer.close(); } catch (_) {}
  if (env) try { env.stop(); } catch (_) {}
  app.exit(1);
}, 145000);

async function run() {
  try {
    env = await startTestEnv('probe-load-time');
    const baseUrl = `http://127.0.0.1:${env.port}`;
    const room = env.room;

    // Servidor mock auxiliar para subframes anidados, fallos HTTP repetidos y sandbox inaccesible
    mockTraceServer = http.createServer((req, res) => {
      if (req.url.startsWith('/fail-404')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      if (req.url.startsWith('/fail-500')) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('server error');
        return;
      }
      if (req.url.startsWith('/nested-parent.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><body style="margin:0;background:#000">
          <script>
            fetch('/fail-404?a=1').catch(()=>{});
            fetch('/fail-404?a=2').catch(()=>{});
            fetch('/fail-500?b=1').catch(()=>{});
          </script>
          <iframe src="${baseUrl}/__test/embed-video.html?delay=500" style="width:100%;height:300px;border:0"></iframe>
        </body></html>`);
        return;
      }
      if (req.url.startsWith('/inaccessible.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><body style="margin:0;background:#000">
          <iframe sandbox="" srcdoc="<p>Bloqueado por sandbox sin scripts ni video accesible</p>" style="width:100%;height:300px;border:0"></iframe>
        </body></html>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('ok');
    });
    await new Promise((resolve) => mockTraceServer.listen(0, '127.0.0.1', resolve));
    const mockPort = mockTraceServer.address().port;
    const mockBase = `http://127.0.0.1:${mockPort}`;

    await app.whenReady();

    let hostWin = null;
    const loadDiag = createLoadDiagnosticsManager({
      app,
      session,
      webContents,
      net,
      getMainWindow: () => hostWin,
    });
    loadDiag.registerIpcHandlers(ipcMain);

    const videoSes = session.fromPartition('persist:videosession', { cache: true });
    loadDiag.hookVideoSessionNetwork(videoSes);

    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-attach-webview', (_waEvent, webPreferences, params) => {
        const part = String(params.partition || '');
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.webSecurity = true;
        if (part === 'persist:videosession' && compatMode) {
          webPreferences.sandbox = false;
          webPreferences.allowRunningInsecureContent = true;
        } else {
          webPreferences.sandbox = true;
          webPreferences.allowRunningInsecureContent = false;
        }
      });

      if (contents.getType() === 'webview') {
        trackedWebviews.add(contents);
        contents.once('destroyed', () => trackedWebviews.delete(contents));
        loadDiag.hookGuestWebContents(contents);
      }
    });

    app.on('certificate-error', (event, _wc, url, error, _cert, cb) => {
      let host = 'unknown';
      try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
      loadDiag.recordCertError(host, error);
      cb(false);
    });

    // Registrar handlers IPC usados por el reproductor y las consultas periódicas
    ipcMain.removeHandler('get-local-ip');
    ipcMain.handle('get-local-ip', () => ({ ip: '127.0.0.1', port: env.port }));
    ipcMain.handle('get-diagnostic-mode', () => false);
    ipcMain.handle('set-diagnostic-mode', () => false);
    ipcMain.handle('get-no-cors-fix', () => false);
    ipcMain.handle('set-no-cors-fix', () => false);
    ipcMain.handle('get-compatibility-mode', () => ({ enabled: compatMode }));
    ipcMain.handle('set-compatibility-mode', (_e, val) => {
      compatMode = Boolean(val);
      return { ok: true, enabled: compatMode };
    });
    ipcMain.handle('get-saved-accounts', () => ({}));
    ipcMain.handle('get-detected-tracks', () => ({ audio: ['es'], subs: [] }));
    ipcMain.handle('check-embed-providers', () => []);
    ipcMain.handle('probe-streams', () => ({}));
    ipcMain.handle('set-stream-headers', () => ({ ok: true }));
    ipcMain.handle('set-master-volume', () => ({ ok: true }));
    ipcMain.handle('simulate-play-click', () => ({ ok: true }));
    ipcMain.handle('set-resume-active', () => true);
    ipcMain.handle('focus-window', () => true);
    ipcMain.handle('get-perf-snapshot', () => ({ counters: {}, config: {} }));
    ipcMain.handle('set-perf-config', () => ({}));

    ipcMain.handle('get-real-media-state', async () => {
      if (periodicQueriesOff) {
        return { ok: true, hasVideo: true, currentTime: 1, duration: 120, paused: false };
      }
      for (const wc of trackedWebviews) {
        if (wc.isDestroyed()) continue;
        try {
          const st = await wc.executeJavaScript(`
            (() => {
              const v = document.querySelector('video');
              if (!v) return { ok: true, hasVideo: false };
              return {
                ok: true,
                hasVideo: true,
                currentTime: Number(v.currentTime || 0),
                duration: Number(v.duration || 120),
                paused: Boolean(v.paused),
                readyState: Number(v.readyState || 0),
              };
            })()
          `);
          if (st) return st;
        } catch (_) {}
      }
      return { ok: true, hasVideo: false };
    });

    ipcMain.handle('get-embed-status', async () => {
      if (periodicQueriesOff) {
        return { ok: true, hasVideo: true, contentUnavailable: false, cloudflare: false };
      }
      for (const wc of trackedWebviews) {
        if (wc.isDestroyed()) continue;
        try {
          const st = await wc.executeJavaScript(`
            (() => {
              const v = document.querySelector('video');
              const txt = (document.body && document.body.innerText) || '';
              return {
                ok: true,
                hasVideo: Boolean(v),
                contentUnavailable: /not available|unavailable|no disponible|404/i.test(txt),
                cloudflare: /Just a moment|Attention Required|Cloudflare/i.test(document.title || ''),
              };
            })()
          `);
          if (st) return st;
        } catch (_) {}
      }
      return { ok: true, hasVideo: false, contentUnavailable: false, cloudflare: false };
    });

    ipcMain.handle('control-active-media', async (_e, payload) => {
      if (periodicQueriesOff) return { ok: true };
      for (const wc of trackedWebviews) {
        if (wc.isDestroyed()) continue;
        try {
          await wc.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v && v.paused) v.play().catch(()=>{}); })()`);
        } catch (_) {}
      }
      return { ok: true, action: payload?.action };
    });

    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    hostWin = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    await hostWin.loadURL(`${baseUrl}/__test/blank.html`).catch(async () => {
      await hostWin.loadURL(`data:text/html,<html><body style="margin:0;background:#000"><div id="mount"></div></body></html>`);
    });

    async function measureFiveRuns(label, modeOpts) {
      compatMode = Boolean(modeOpts.compat);
      periodicQueriesOff = Boolean(modeOpts.noPeriodic);
      const runs = [];

      for (let i = 1; i <= 5; i++) {
        const targetUrl = `${baseUrl}/__test/embed-video.html?mode=${encodeURIComponent(label)}&run=${i}&t=${Date.now()}`;
        let pollTimer = null;
        if (!periodicQueriesOff) {
          pollTimer = setInterval(() => {
            for (const wc of trackedWebviews) {
              if (!wc.isDestroyed()) {
                wc.executeJavaScript(`(() => { const v = document.querySelector('video'); return v ? v.readyState : -1; })()`).catch(() => {});
              }
            }
          }, 500);
        }

        const ms = await hostWin.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const container = document.body;
            container.innerHTML = '';
            const t0 = performance.now();
            const wv = document.createElement('webview');
            wv.setAttribute('partition', 'persist:videosession');
            wv.setAttribute('style', 'width:640px;height:360px;border:none;');
            wv.setAttribute('src', ${JSON.stringify(targetUrl)});
            container.appendChild(wv);

            let resolved = false;
            const done = (val) => {
              if (resolved) return;
              resolved = true;
              resolve(Number(val.toFixed(1)));
            };

            const timeout = setTimeout(() => done(9999), 12000);

            wv.addEventListener('dom-ready', () => {
              const check = () => {
                if (resolved) return;
                wv.executeJavaScript('window.__firstFrameMs')
                  .then((ff) => {
                    if (typeof ff === 'number' && ff > 0) {
                      clearTimeout(timeout);
                      done(performance.now() - t0);
                    } else {
                      setTimeout(check, 25);
                    }
                  })
                  .catch(() => setTimeout(check, 25));
              };
              check();
            });
          })
        `);

        if (pollTimer) clearInterval(pollTimer);
        runs.push(ms);
        await wait(120);
      }

      return {
        label,
        runs,
        medianMs: median(runs),
      };
    }

    const resA = await measureFiveRuns('(A) HEAD normal (sandbox:true, consultas ON)', {
      compat: false,
      noPeriodic: false,
    });
    const resB = await measureFiveRuns('(B) Modo compatibilidad (sandbox:false, insecure:true)', {
      compat: true,
      noPeriodic: false,
    });
    const resC = await measureFiveRuns('(C) Consultas periódicas apagadas', {
      compat: false,
      noPeriodic: true,
    });

    // 2. Verificar PARTE 4 "Grabar carga":
    //    (a) failRequests agrupadas (host + code + count), certErrors sin [object Object]
    //    (b) base de tiempo unificada (esperar 1.5s ANTES de crear <webview> -> start < 800 ms, nunca ~1500+ ms ni 176038 ms)
    //    (c) sondeo framesInSubtree cada 250 ms hasta 30 s: captura <video>/rs>=3/1er fotograma en iframe anidado + "no accesible" tras 30 s
    loadDiag.clearLoadTraces();
    await loadDiag.startLoadTrace({
      title: 'Traza Base Unificada + Iframe Anidado',
      firstServerName: 'Mock Nested',
      firstServerUrl: `${mockBase}/nested-parent.html`,
    });
    // Simular demora previa de 1500 ms antes de que se monte el <webview>
    await wait(1500);

    await hostWin.webContents.executeJavaScript(`
      (() => {
        document.body.innerHTML = '';
        const wv = document.createElement('webview');
        wv.setAttribute('partition', 'persist:videosession');
        wv.setAttribute('style', 'width:640px;height:360px;border:none;');
        wv.setAttribute('src', ${JSON.stringify(`${mockBase}/nested-parent.html`)});
        document.body.appendChild(wv);
      })()
    `);

    let traceNested = null;
    for (let i = 0; i < 40; i++) {
      await wait(250);
      const all = await loadDiag.getLoadTraces();
      const t = all.traces[0];
      if (t && t.timestamps.firstFrameMs !== null && t.network.failedRequests.length >= 2) {
        traceNested = JSON.parse(JSON.stringify(t));
        break;
      }
      if (t) traceNested = JSON.parse(JSON.stringify(t));
    }
    // Simular error de certificado en esta traza también para verificar agrupación y ausencia de [object Object]
    loadDiag.recordCertError('badcert.example', 'ERR_CERT_AUTHORITY_INVALID');
    loadDiag.recordCertError('badcert.example', 'ERR_CERT_AUTHORITY_INVALID');
    traceNested = JSON.parse(JSON.stringify((await loadDiag.getLoadTraces()).traces[0]));
    loadDiag.endLoadTrace();

    // Trazar caso (c2): iframe sandbox inaccesible / sin video -> esperar 30s reales hasta "no accesible"
    await loadDiag.startLoadTrace({
      title: 'Traza Frame Sandbox Inaccesible',
      firstServerName: 'Mock Inaccessible',
      firstServerUrl: `${mockBase}/inaccessible.html`,
    });
    await hostWin.webContents.executeJavaScript(`
      (() => {
        document.body.innerHTML = '';
        const wv = document.createElement('webview');
        wv.setAttribute('partition', 'persist:videosession');
        wv.setAttribute('style', 'width:640px;height:360px;border:none;');
        wv.setAttribute('src', ${JSON.stringify(`${mockBase}/inaccessible.html`)});
        document.body.appendChild(wv);
      })()
    `);

    let traceInaccessible = null;
    const poll30Start = Date.now();
    while (Date.now() - poll30Start < 33000) {
      await wait(500);
      const t = (await loadDiag.getLoadTraces()).traces[0];
      traceInaccessible = t ? JSON.parse(JSON.stringify(t)) : null;
      if (traceInaccessible && traceInaccessible.videoStatus === 'no accesible' && Date.now() - poll30Start >= 30000) {
        break;
      }
    }
    loadDiag.endLoadTrace();

    // 3. Cargar app real y probar ?delay=4000 (40 s) + revisar tabla de "Grabar carga" en Ajustes > Diagnóstico
    compatMode = false;
    periodicQueriesOff = false;

    await hostWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(room)}`);
    await wait(2500);

    // Leer tabla de "Grabar carga" directamente desde #/ajustes (HashRouter)
    await hostWin.webContents.executeJavaScript(`
      (() => {
        const link = document.querySelector('a[href="#/ajustes"]');
        if (link) link.click();
        else window.location.hash = '#/ajustes';
      })()
    `);

    let loadTableText = '';
    for (let i = 0; i < 20; i++) {
      await wait(250);
      loadTableText = await hostWin.webContents.executeJavaScript(`
        (() => {
          const tas = Array.from(document.querySelectorAll('textarea'));
          const ta = tas.find((el) => (el.value || '').includes('Timestamps (creado/start'));
          return ta ? ta.value : '';
        })()
      `).catch(() => '');
      if (loadTableText) break;
    }

    // Volver al inicio antes de lanzar reproducción de ?delay=4000
    await hostWin.webContents.executeJavaScript(`window.location.hash = '#/';`);
    await wait(300);

    const delayMedia = {
      id: 'movie-delay-4000',
      tmdbId: 550,
      title: 'Prueba Proveedor Lento 4s',
      type: 'movie',
      category: 'movie',
      streamType: 'iframe',
      servers: [
        { name: 'SlowSrv 1', url: `${baseUrl}/__test/embed-video.html?delay=4000&srv=1`, type: 'iframe', language: 'Latino' },
        { name: 'SlowSrv 2', url: `${baseUrl}/__test/embed-video.html?delay=4000&srv=2`, type: 'iframe', language: 'Latino' },
        { name: 'SlowSrv 3', url: `${baseUrl}/__test/embed-video.html?delay=4000&srv=3`, type: 'iframe', language: 'Latino' },
      ],
    };

    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room,
        command: {
          id: 'cmd-delay-4000-' + Date.now(),
          action: 'playDiscoveredMovie',
          payload: delayMedia,
          issuedAt: Date.now(),
        },
      }),
    });

    const start40 = Date.now();
    let lastSrc = '';
    let firstFrameRecordedAt = null;
    let rotatedBeforeLoad = false;
    const rotations = [];

    while (Date.now() - start40 < 40000) {
      await wait(400);
      const elapsedMs = Date.now() - start40;
      const wvInfo = await hostWin.webContents.executeJavaScript(`
        (() => {
          const wv = document.querySelector('webview');
          if (!wv) return null;
          return { src: wv.getAttribute('src') || '' };
        })()
      `).catch(() => null);

      if (wvInfo && wvInfo.src) {
        if (!lastSrc) {
          lastSrc = wvInfo.src;
        } else if (wvInfo.src !== lastSrc) {
          rotations.push({ elapsedMs, from: lastSrc, to: wvInfo.src });
          if (firstFrameRecordedAt === null) {
            rotatedBeforeLoad = true;
          }
          lastSrc = wvInfo.src;
        }
      }

      if (firstFrameRecordedAt === null) {
        for (const wc of trackedWebviews) {
          if (wc.isDestroyed()) continue;
          const ff = await wc.executeJavaScript('window.__firstFrameMs').catch(() => null);
          if (typeof ff === 'number' && ff > 0) {
            firstFrameRecordedAt = elapsedMs;
          }
        }
      }
    }

    // Validaciones de "Grabar carga" PARTE 4
    const f404 = (traceNested?.network?.failedRequests || []).find((f) => f.code === 'HTTP_404');
    const f500 = (traceNested?.network?.failedRequests || []).find((f) => f.code === 'HTTP_500');
    const certGrp = (traceNested?.network?.certErrors || []).find((c) => c.host === 'badcert.example');
    const passGroupedNet =
      Boolean(f404 && f404.count === 2) &&
      Boolean(f500 && f500.count === 1) &&
      Boolean(certGrp && certGrp.count === 2) &&
      !loadTableText.includes('[object Object]') &&
      loadTableText.includes('HTTP_404 x2') &&
      loadTableText.includes('badcert.example:ERR_CERT_AUTHORITY_INVALID x2');

    const passUnifiedBase =
      traceNested?.timestamps?.webviewCreatedMs === 0 &&
      typeof traceNested?.timestamps?.didStartLoadingMs === 'number' &&
      traceNested.timestamps.didStartLoadingMs >= 0 &&
      traceNested.timestamps.didStartLoadingMs < 1000 &&
      typeof traceNested?.timestamps?.domReadyMs === 'number' &&
      traceNested.timestamps.domReadyMs < 2000;

    const passNestedSubtree =
      typeof traceNested?.timestamps?.firstVideoMs === 'number' &&
      typeof traceNested?.timestamps?.readyState3Ms === 'number' &&
      typeof traceNested?.timestamps?.firstFrameMs === 'number' &&
      traceNested.videoStatus === 'accesible';

    const passInaccessible30s =
      traceInaccessible?.videoStatus === 'no accesible' &&
      traceInaccessible?.timestamps?.firstVideoMs === null &&
      loadTableText.includes('no accesible');

    const passDelay = firstFrameRecordedAt !== null && !rotatedBeforeLoad && rotations.length === 0;
    const allPass = passGroupedNet && passUnifiedBase && passNestedSubtree && passInaccessible30s && passDelay;

    const lines = [];
    lines.push('=== PROBE LOAD TIME (requestVideoFrameCallback, 5 corridas) ===');
    lines.push('| Variante | Corrida 1 (ms) | Corrida 2 (ms) | Corrida 3 (ms) | Corrida 4 (ms) | Corrida 5 (ms) | Mediana (ms) |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of [resA, resB, resC]) {
      lines.push(
        `| ${r.label} | ${r.runs[0]} | ${r.runs[1]} | ${r.runs[2]} | ${r.runs[3]} | ${r.runs[4]} | **${r.medianMs}** |`
      );
    }
    lines.push('');
    lines.push('=== PROVEEDOR LENTO (?delay=4000, ventana de 40 s) ===');
    lines.push('| Escenario | Tiempo a 1er fotograma (ms) | ¿Rotó el timer de 10 s antes de cargar? | Rotaciones en 40 s | Resultado |');
    lines.push('|---|---|---|---|---|');
    lines.push(
      `| ?delay=4000 (4 s en mostrar <video>) | ${firstFrameRecordedAt ?? 'N/A'} ms | ${rotatedBeforeLoad ? 'SÍ' : 'NO'} | ${rotations.length} | ${passDelay ? 'PASA' : 'FALLA'} |`
    );
    lines.push('');
    lines.push('=== GRABAR CARGA (PARTE 4: agrupación red + base t0 webview + framesInSubtree 250ms/30s) ===');
    lines.push(`passGroupedNet=${passGroupedNet} failed=${JSON.stringify(traceNested?.network?.failedRequests)} certs=${JSON.stringify(traceNested?.network?.certErrors)}`);
    lines.push(`passUnifiedBase=${passUnifiedBase} timestamps1=${JSON.stringify(traceNested?.timestamps)}`);
    lines.push(`passNestedSubtree=${passNestedSubtree} videoStatus1=${traceNested?.videoStatus}`);
    lines.push(`passInaccessible30s=${passInaccessible30s} videoStatus2=${traceInaccessible?.videoStatus} timestamps2=${JSON.stringify(traceInaccessible?.timestamps)}`);
    lines.push('--- Tabla UI Diagnóstico ---');
    lines.push(loadTableText || '(vacía)');
    lines.push('');
    lines.push(`RESULTADO GLOBAL: ${allPass ? 'PASA' : 'FALLA'}`);

    const out = lines.join('\n');
    console.log(out);

    const logDir = path.join(__dirname, '..', 'scratch', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'probe-load-time.log'), out + '\n', 'utf8');

    clearTimeout(globalTimer);
    hostWin.destroy();
    if (mockTraceServer) mockTraceServer.close();
    await env.stop();
    app.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error('[probe-load-time] Error:', err);
    clearTimeout(globalTimer);
    if (mockTraceServer) try { mockTraceServer.close(); } catch (_) {}
    if (env) await env.stop().catch(() => {});
    app.exit(1);
  }
}

run();
