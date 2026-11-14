const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { startTestEnv } = require('./lib/testenv.cjs');

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

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_waEvent, webPreferences, params) => {
    const part = String(params.partition || '');
    webPreferences.nodeIntegration = false;
    webPreferences. nodeIntegrationInSubFrames = false;
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
  }
});

async function run() {
  let env = null;
  try {
    env = await startTestEnv('probe-load-time');
    const baseUrl = env.base;
    const room = env.room;

    await app.whenReady();

    // Registrar handlers IPC usados por el reproductor y las consultas periódicas
    ipcMain.removeHandler('get-local-ip');
    ipcMain.handle('get-local-ip', () => ({ ip: '127.0.0.1', port: env.port }));
    ipcMain.handle('get-diagnostic-mode', () => false);
    ipcMain.handle('get-no-cors-fix', () => false);
    ipcMain.handle('get-compatibility-mode', () => ({ enabled: compatMode }));
    ipcMain.handle('set-compatibility-mode', (_e, val) => {
      compatMode = Boolean(val);
      return { ok: true, enabled: compatMode };
    });
    ipcMain.handle('get-saved-accounts', () => ({}));
    ipcMain.handle('get-detected-tracks', () => ({ audio: ['es'], subs: [] }));
    ipcMain.handle('check-embed-providers', () => []);
    ipcMain.handle('set-stream-headers', () => ({ ok: true }));
    ipcMain.handle('set-master-volume', () => ({ ok: true }));
    ipcMain.handle('simulate-play-click', () => ({ ok: true }));
    ipcMain.handle('start-load-trace', () => ({ ok: true }));
    ipcMain.handle('record-load-trace-event', () => ({ ok: true }));
    ipcMain.handle('get-load-recording', () => ({ enabled: false }));
    ipcMain.handle('get-load-traces', () => ({ traces: [] }));

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
    const hostWin = new BrowserWindow({
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

        // Si las consultas periódicas están encendidas, simular el sondeo periódico de estado/tiempo durante la carga
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
        await wait(150);
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

    // Ahora probar ?delay=4000 en el reproductor real durante 40 s
    compatMode = false;
    periodicQueriesOff = false;

    await hostWin.loadURL(`${baseUrl}/?role=screen&room=${encodeURIComponent(room)}`);
    await wait(3000);

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

    // Lanzar reproducción en la pantalla e instrumentar cambios de servidor y primer fotograma
    await hostWin.webContents.executeJavaScript(`
      window.__delayProbe = {
        startedAt: performance.now(),
        initialServer: 'SlowSrv 1',
        serverChanges: [],
        firstFrameAtMs: null,
        rotatedBeforeLoad: false,
      };
    `);

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
    const passDelay = firstFrameRecordedAt !== null && !rotatedBeforeLoad && rotations.length === 0;
    lines.push(
      `| ?delay=4000 (4 s en mostrar <video>) | ${firstFrameRecordedAt ?? 'N/A'} ms | ${rotatedBeforeLoad ? 'SÍ' : 'NO'} | ${rotations.length} | ${passDelay ? 'PASA' : 'OBSERVADO'} |`
    );

    const out = lines.join('\n');
    console.log(out);

    const logDir = path.join(__dirname, '..', 'scratch', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'probe-load-time.log'), out + '\n', 'utf8');

    hostWin.destroy();
    await env.stop();
    app.exit(0);
  } catch (err) {
    console.error('[probe-load-time] Error:', err);
    if (env) await env.stop().catch(() => {});
    app.exit(1);
  }
}

run();
