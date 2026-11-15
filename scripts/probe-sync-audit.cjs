#!/usr/bin/env node
/**
 * scripts/probe-sync-audit.cjs
 * Auditor de sincronía entre PC y Celular durante 3 minutos.
 *
 * Ejecuta:
 * - Acciones aleatorias desde celular cada 0.5 a 4 s (play, pause, seek, vol, subs, prox/ant cap, server, marathon).
 * - Cortes de red periódicos (2 s cada 30 s).
 * - Saltos manuales en la PC.
 * - Muestreo cada 500 ms de PC y Celular:
 *   { hora, playing, tiempo, duracion, capitulo, titulo, servidor, vol, mute, subs, marathon, stateSeq, age }
 * - Cálculo de divergencias: diferencia media, máxima, desincronías > 2s, desglose de campos y top 10 peores momentos.
 */

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const { startTestEnv } = require('./lib/testenv.cjs');

let testEnv = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAllFrames() {
  const frames = [];
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (wc.mainFrame && Array.isArray(wc.mainFrame.framesInSubtree)) {
        frames.push(...wc.mainFrame.framesInSubtree);
      }
    } catch (_) {}
  }
  return frames;
}

// Timeout de seguridad amplio (220 s)
const globalTimeout = setTimeout(() => {
  console.error('[probe-sync-audit] TIMEOUT GLOBAL ALCANZADO');
  app.exit(1);
}, 220000);

async function run() {
  const args = process.argv.slice(2);
  let durationSec = 180; // 3 minutos por defecto
  for (const arg of args) {
    if (arg.startsWith('--duration=')) {
      durationSec = parseInt(arg.split('=')[1], 10) || 180;
    }
  }

  console.log(`[probe-sync-audit] Iniciando auditoría de sincronía por ${durationSec}s...`);

  testEnv = await startTestEnv({
    name: 'probe-sync-audit',
    useLanIp: true,
    env: {
      CINECAST_TEST: '1',
      CINECAST_DEBUG_SYNC: '1',
    },
  });

  const baseUrl = testEnv.lanBase;
  const roomId = testEnv.room;
  console.log(`[probe-sync-audit] TestEnv listo: ${baseUrl} (sala: ${roomId})`);

  const safeHandle = (channel, fn) => {
    try { ipcMain.removeHandler(channel); } catch (_) {}
    try { ipcMain.handle(channel, fn); } catch (_) {}
  };

  let simulatedVideoTime = 120;
  let simulatedPlaying = true;
  let simulatedDuration = 1420;

  safeHandle('get-local-ip', () => ({ ip: testEnv.lanIp, port: testEnv.port }));
  safeHandle('get-diagnostic-mode', () => false);
  safeHandle('set-diagnostic-mode', () => false);
  safeHandle('get-real-media-state', async () => {
    const frames = getAllFrames();
    for (const frame of frames) {
      try {
        const res = await frame.executeJavaScript(`(() => {
          const v = window.__v || (window.location.href.includes('embed-slow') ? document.querySelector('video') : null);
          if (!v) return null;
          return {
            found: true,
            currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
            duration: Number.isFinite(v.duration) ? v.duration : 0,
            readyState: typeof v.readyState === 'number' ? v.readyState : 0,
            isPlaying: !v.paused,
            buffered: 1420,
            title: document.title || '',
          };
        })()`);
        if (res && res.found) return res;
      } catch (_) {}
    }
    return {
      found: true,
      currentTime: simulatedVideoTime,
      duration: simulatedDuration,
      readyState: 4,
      isPlaying: simulatedPlaying,
      buffered: simulatedDuration,
      title: 'Breaking Bad - Episodio 1',
    };
  });

  safeHandle('control-active-media', async (_event, { action, value }) => {
    if (action === 'seek') {
      simulatedVideoTime = Number(value) || 0;
    } else if (action === 'play') {
      simulatedPlaying = true;
    } else if (action === 'pause') {
      simulatedPlaying = false;
    } else if (action === 'togglePlay') {
      simulatedPlaying = !simulatedPlaying;
    }
    return { ok: true, acted: true, hasMedia: true, currentTime: simulatedVideoTime, isPlaying: simulatedPlaying };
  });

  safeHandle('get-detected-tracks', () => null);
  safeHandle('set-master-volume', () => ({ ok: true }));
  safeHandle('get-no-cors-fix', () => false);
  safeHandle('check-embed-providers', () => []);
  safeHandle('focus-window', () => true);
  safeHandle('get-embed-status', () => ({ ok: true, video: null, cloudflare: false, contentUnavailable: false }));
  safeHandle('simulate-play-click', () => true);
  safeHandle('set-player-servers', () => true);
  safeHandle('start-load-trace', () => ({ ok: true }));
  safeHandle('end-load-trace', () => true);
  safeHandle('record-load-trace-event', () => true);

  const preloadPath = path.resolve(__dirname, '../electron/preload.cjs');

  const winScreen = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    title: 'PC',
    webPreferences: {
      partition: 'persist:sync-audit-screen-' + Date.now(),
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const winPhone = new BrowserWindow({
    width: 412,
    height: 915,
    show: false,
    title: 'Phone',
    webPreferences: {
      partition: 'persist:sync-audit-phone-' + Date.now(),
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const screenUrl = `${baseUrl}/?role=screen&ui=nuevo&room=${roomId}#/`;
  const phoneUrl = `${baseUrl}/?role=remote&ui=nuevo&room=${roomId}#/control`;

  await winScreen.loadURL(screenUrl);
  await winPhone.loadURL(phoneUrl);
  await wait(3000);

  // Esperar a que ambas conecten
  for (let i = 0; i < 30; i++) {
    const screenConn = await winScreen.webContents.executeJavaScript(`
      Boolean(window.cinecastDeviceSync && window.cinecastDeviceSync.isConnected())
    `).catch(() => false);
    const phoneConn = await winPhone.webContents.executeJavaScript(`
      Boolean(window.cinecastDeviceSync && window.cinecastDeviceSync.isConnected())
    `).catch(() => false);
    if (screenConn && phoneConn) break;
    await wait(300);
  }

  console.log('[probe-sync-audit] Ambas ventanas conectadas. Iniciando reproducción base...');

  const embedUrl = `${baseUrl}/__test/embed-slow.html?dur=1420`;

  // Lanzar contenido episódico para auditar
  await winPhone.webContents.executeJavaScript(`
    if (window.cinecastDeviceSync) {
      window.cinecastDeviceSync.sendCommand({
        action: 'playDiscoveredMovie',
        payload: {
          id: 'tmdb-series-1396',
          tmdbId: 1396,
          title: 'Breaking Bad',
          type: 'series',
          category: 'series',
          seasonNumber: 1,
          episodeNumber: 1,
          episodeTitle: 'Piloto',
          initialTime: 120,
          currentTime: 120,
          duration: 1420,
          servers: [
            { name: 'Servidor Alpha', type: 'iframe', url: ${JSON.stringify(embedUrl)} },
            { name: 'Servidor Beta', type: 'iframe', url: ${JSON.stringify(embedUrl)} }
          ]
        }
      });
    }
  `);

  await wait(3500);

  const pcSamples = [];
  const phoneSamples = [];

  let isAuditRunning = true;

  const sleepWhile = async (ms) => {
    const end = Date.now() + ms;
    while (isAuditRunning && Date.now() < end) {
      await wait(200);
    }
  };

  // Tarea en segundo plano: Acciones aleatorias desde celular cada 0.5 a 4 s
  const actionsPromise = (async () => {
    let nextActionDelay = 1000;
    while (isAuditRunning) {
      await sleepWhile(nextActionDelay);
      if (!isAuditRunning) break;

      const actionTypes = [
        'play',
        'pause',
        'seek',
        'volume',
        'subs',
        'nextEpisode',
        'prevEpisode',
        'changeServer',
        'marathon',
      ];
      const act = actionTypes[Math.floor(Math.random() * actionTypes.length)];

      try {
        await winPhone.webContents.executeJavaScript(`(() => {
          if (!window.cinecastDeviceSync) return;
          const a = ${JSON.stringify(act)};
          if (a === 'play') window.cinecastDeviceSync.sendCommand({ action: 'play' });
          else if (a === 'pause') window.cinecastDeviceSync.sendCommand({ action: 'pause' });
          else if (a === 'seek') window.cinecastDeviceSync.sendCommand({ action: 'seek', payload: Math.floor(Math.random() * 1200) + 10 });
          else if (a === 'volume') window.cinecastDeviceSync.sendCommand({ action: 'setVolume', payload: Math.floor(Math.random() * 100) });
          else if (a === 'subs') window.cinecastDeviceSync.sendCommand({ action: 'toggleSubtitles' });
          else if (a === 'nextEpisode') window.cinecastDeviceSync.sendCommand({ action: 'nextEpisode' });
          else if (a === 'prevEpisode') window.cinecastDeviceSync.sendCommand({ action: 'prevEpisode' });
          else if (a === 'changeServer') window.cinecastDeviceSync.sendCommand({ action: 'changeServer', payload: Math.random() > 0.5 ? 1 : 0 });
          else if (a === 'marathon') {
            const cur = localStorage.getItem('cinecast_marathon_mode') === 'true';
            localStorage.setItem('cinecast_marathon_mode', cur ? 'false' : 'true');
            window.cinecastDeviceSync.sendCommand({ action: 'setMarathon', payload: !cur });
          }
        })()`);
      } catch (_) {}

      // Siguiente acción en 500ms a 3500ms
      nextActionDelay = Math.floor(Math.random() * 3000) + 500;
    }
  })();

  // Tarea en segundo plano: Cortes de red periódicos (2 s cada 30 s)
  const cutsPromise = (async () => {
    while (isAuditRunning) {
      await sleepWhile(30000);
      if (!isAuditRunning) break;
      console.log('[probe-sync-audit] Simulando corte de red en celular (2s)...');
      try {
        await winPhone.webContents.executeJavaScript(`
          if (window.cinecastDeviceSync && window.cinecastDeviceSync.ws) {
            window.cinecastDeviceSync.ws.close(3001, 'corte-simulado');
          }
        `);
      } catch (_) {}
      await sleepWhile(2000);
      // Forzar reconexión
      try {
        await winPhone.webContents.executeJavaScript(`
          if (window.cinecastDeviceSync) {
            window.cinecastDeviceSync.connect();
          }
        `);
      } catch (_) {}
    }
  })();

  // Tarea en segundo plano: Saltos manuales en la PC (cada 45s)
  const pcManualSeeksPromise = (async () => {
    while (isAuditRunning) {
      await sleepWhile(45000);
      if (!isAuditRunning) break;
      console.log('[probe-sync-audit] Simulando salto manual directo en PC...');
      try {
        await winScreen.webContents.executeJavaScript(`(() => {
          const v = document.querySelector('video');
          if (v) {
            v.currentTime = Math.floor(Math.random() * 900) + 50;
          }
        })()`);
      } catch (_) {}
    }
  })();

  // Bucle de muestreo cada 500 ms
  const totalTicks = Math.round((durationSec * 1000) / 500);
  const startAuditTime = Date.now();

  for (let tick = 0; tick < totalTicks; tick++) {
    await wait(500);

    const now = Date.now();
    const hora = new Date(now).toLocaleTimeString();

    // Muestreo PC
    let pcSample = null;
    try {
      pcSample = await winScreen.webContents.executeJavaScript(`(() => {
        const runtime = window.__cinecastRuntime;
        const st = runtime?.remotePlaybackState || {};
        const v = document.querySelector('video');
        const curTime = v ? v.currentTime : (st.currentTime || 0);
        const isPlay = v ? !v.paused : Boolean(st.isPlaying);
        return {
          hora: ${JSON.stringify(hora)},
          timestamp: ${now},
          role: 'screen',
          playing: isPlay,
          tiempo: Number(curTime.toFixed(1)),
          duracion: Math.round(st.duration || 1420),
          capitulo: { season: st.seasonNumber || 1, episode: st.episodeNumber || 1 },
          titulo: st.mediaTitle || 'Breaking Bad',
          servidor: st.activeServerName || 'Servidor Alpha',
          vol: st.audioSettings?.volume ?? 100,
          mute: Boolean(st.audioSettings?.isMuted),
          subs: Boolean(st.subtitlesEnabled),
          marathon: Boolean(st.marathon),
          stateSeq: st.stateSeq || 0,
          age: 0,
        };
      })()`);
    } catch (_) {}

    // Muestreo Celular
    let phoneSample = null;
    try {
      phoneSample = await winPhone.webContents.executeJavaScript(`(() => {
        const runtime = window.__cinecastRuntime;
        const st = runtime?.remotePlaybackState || {};
        const lastRx = window.cinecastDeviceSync ? window.cinecastDeviceSync.getLastStateReceivedTime() : ${now};
        const age = Math.max(0, ${now} - lastRx);
        return {
          hora: ${JSON.stringify(hora)},
          timestamp: ${now},
          role: 'remote',
          playing: Boolean(st.isPlaying),
          tiempo: Number((st.currentTime || 0).toFixed(1)),
          duracion: Math.round(st.duration || 1420),
          capitulo: { season: st.seasonNumber || 1, episode: st.episodeNumber || 1 },
          titulo: st.mediaTitle || 'Breaking Bad',
          servidor: st.activeServerName || 'Servidor Alpha',
          vol: st.audioSettings?.volume ?? 100,
          mute: Boolean(st.audioSettings?.isMuted),
          subs: Boolean(st.subtitlesEnabled),
          marathon: Boolean(st.marathon),
          stateSeq: st.stateSeq || 0,
          age,
        };
      })()`);
    } catch (_) {}

    if (pcSample) pcSamples.push(pcSample);
    if (phoneSample) phoneSamples.push(phoneSample);

    if (tick % 20 === 0) {
      const elapsed = Math.round((Date.now() - startAuditTime) / 1000);
      console.log(`[probe-sync-audit] Progreso: ${elapsed}s / ${durationSec}s (${pcSamples.length} muestras)`);
    }
  }

  isAuditRunning = false;
  await Promise.all([actionsPromise, cutsPromise, pcManualSeeksPromise]);

  console.log('\n[probe-sync-audit] Procesando resultados y calculando divergencias...');

  // Emparejar y calcular divergencias
  let totalTimeDiff = 0;
  let maxTimeDiff = 0;
  let divergencesOver2s = 0;

  const paired = [];
  for (const pc of pcSamples) {
    let closest = null;
    let minDiff = Infinity;
    for (const ph of phoneSamples) {
      const diff = Math.abs(pc.timestamp - ph.timestamp);
      if (diff < minDiff && diff < 450) {
        minDiff = diff;
        closest = ph;
      }
    }
    if (closest) {
      paired.push({ pc, phone: closest });
    }
  }

  const fieldKeys = ['playing', 'capitulo', 'titulo', 'servidor', 'vol', 'mute', 'subs', 'marathon'];
  const fieldStats = {};
  for (const f of fieldKeys) {
    fieldStats[f] = { count: 0, totalMs: 0, maxMs: 0, inStreak: false, streakStart: 0 };
  }

  const moments = [];

  for (const pair of paired) {
    const { pc, phone } = pair;
    const sameMedia = pc.titulo === phone.titulo;
    const timeDiff = sameMedia ? Math.abs(pc.tiempo - phone.tiempo) : 0;
    totalTimeDiff += timeDiff;
    if (timeDiff > maxTimeDiff) maxTimeDiff = timeDiff;

    if (timeDiff > 2.0) {
      divergencesOver2s++;
    }

    const divergentFields = [];
    if (pc.playing !== phone.playing) divergentFields.push('playing');
    if (pc.capitulo.season !== phone.capitulo.season || pc.capitulo.episode !== phone.capitulo.episode) divergentFields.push('capitulo');
    if (pc.titulo !== phone.titulo) divergentFields.push('titulo');
    if (pc.servidor !== phone.servidor) divergentFields.push('servidor');
    if (Math.abs(pc.vol - phone.vol) > 5) divergentFields.push('vol');
    if (pc.mute !== phone.mute) divergentFields.push('mute');
    if (pc.subs !== phone.subs) divergentFields.push('subs');
    if (pc.marathon !== phone.marathon) divergentFields.push('marathon');

    for (const f of fieldKeys) {
      const isDiv = divergentFields.includes(f);
      const st = fieldStats[f];
      if (isDiv) {
        if (!st.inStreak) {
          st.inStreak = true;
          st.streakStart = pc.timestamp;
          st.count++;
        }
      } else {
        if (st.inStreak) {
          st.inStreak = false;
          const dur = pc.timestamp - st.streakStart;
          st.totalMs += dur;
          if (dur > st.maxMs) st.maxMs = dur;
        }
      }
    }

    if (timeDiff > 1.5 || divergentFields.length > 0) {
      let probableCause = 'Propagación normal de comando';
      if (phone.age > 3000) {
        probableCause = `Corte o retardo de red (antigüedad ${phone.age}ms > 3s)`;
      } else if (divergentFields.includes('playing')) {
        probableCause = 'Acción optimista de reproducción pendiente de confirmación';
      } else if (divergentFields.includes('capitulo') || divergentFields.includes('titulo')) {
        probableCause = 'Transición de episodio no propagada';
      } else if (timeDiff > 3.0) {
        probableCause = 'Salto temporal (seek) manual o desfase';
      }

      moments.push({
        hora: pc.hora,
        timestamp: pc.timestamp,
        timeDiff: Number(timeDiff.toFixed(2)),
        divergentFields,
        probableCause,
        pcState: { playing: pc.playing, tiempo: pc.tiempo, cap: `S${pc.capitulo.season}E${pc.capitulo.episode}`, vol: pc.vol },
        phoneState: { playing: phone.playing, tiempo: phone.tiempo, cap: `S${phone.capitulo.season}E${phone.capitulo.episode}`, vol: phone.vol, age: phone.age },
      });
    }
  }

  const meanTimeDiff = paired.length > 0 ? Number((totalTimeDiff / paired.length).toFixed(2)) : 0;

  console.log('\n================================================================================');
  console.log('TABLA DE DIVERGENCIAS - PROBE-SYNC-AUDIT (Auditoría 3 minutos)');
  console.log('================================================================================');
  console.log(`Duración: ${durationSec}s | Muestras emparejadas: ${paired.length}`);
  console.log(`Diferencia de tiempo media: ${meanTimeDiff}s | Máxima: ${maxTimeDiff.toFixed(2)}s`);
  console.log(`Muestras con divergencia > 2s: ${divergencesOver2s}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('| Campo | Desincronías | Duración Total (ms) | Duración Máx (ms) |');
  console.log('| :--- | :---: | :---: | :---: |');
  for (const f of fieldKeys) {
    const st = fieldStats[f];
    console.log(`| ${f} | ${st.count} | ${st.totalMs}ms | ${st.maxMs}ms |`);
  }
  console.log('--------------------------------------------------------------------------------');

  moments.sort((a, b) => b.timeDiff - a.timeDiff);
  const top10 = moments.slice(0, 10);
  console.log('\nTOP 10 PEORES MOMENTOS DE DESINCRONÍA:');
  console.log('| # | Hora | Dif Tiempo | Campos Desfasados | Causa Probable |');
  console.log('| :-: | :---: | :---: | :--- | :--- |');
  top10.forEach((m, idx) => {
    console.log(`| ${idx + 1} | ${m.hora} | ${m.timeDiff}s | ${m.divergentFields.join(', ') || 'tiempo'} | ${m.probableCause} |`);
  });
  console.log('================================================================================\n');

  const pass = divergencesOver2s === 0 && meanTimeDiff < 2.0;
  console.log(`Resultado global probe-sync-audit: ${pass ? 'PASA' : 'FALLA'}`);

  clearTimeout(globalTimeout);
  try { winScreen.destroy(); } catch (_) {}
  try { winPhone.destroy(); } catch (_) {}
  if (testEnv) {
    await testEnv.stop();
  }

  process.exit(pass ? 0 : 1);
}

run().catch(async (err) => {
  console.error('[probe-sync-audit] Error fatal:', err);
  if (testEnv) {
    try { await testEnv.stop(); } catch (_) {}
  }
  app.exit(1);
});
