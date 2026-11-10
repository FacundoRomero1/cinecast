const { app, BrowserWindow, session, ipcMain, shell, webContents, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createApp, attachWebSocket, getLocalIpAddress } = require('./core.cjs');

// =========================================================================
// 0. SSL: Node queda ESTRICTO. Los errores de certificado de Chromium (IPTV/embeds)
// se aceptan solo vía app.on('certificate-error') más abajo.
// =========================================================================

// =========================================================================
// 1. CONFIGURACIÓN CRÍTICA DE CHROMIUM (AUTOPLAY TOTAL Y USER-AGENT REAL)
// =========================================================================
const CHROME_VER = process.versions.chrome; // e.g. "128.x.x.x" o superior
const CHROME_MAJOR = CHROME_VER ? CHROME_VER.split('.')[0] : '131';
// User-Agent estándar limpio e idéntico a Chrome real (evita que Cloudflare Turnstile lo marque como bot)
const REAL_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VER || '131.0.0.0'} Safari/537.36`;
const REAL_CHROME_USER_AGENT = REAL_UA;
const SMART_TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.0 Chrome/76.0.3809.146 TV Safari/537.36';

app.userAgentFallback = REAL_UA;

// TAREA 2 & D: Variables de Estado para Modo Diagnóstico
let isDiagnosticMode = false;
let isNoCorsFix = false;

function printDiagLog() {
  console.log(`[DIAG] adblock=${isDiagnosticMode ? 'OFF' : 'ON'} popups=${isDiagnosticMode ? 'ALLOW' : 'BLOCK'} shields=${isDiagnosticMode ? 'OFF' : 'ON'} ua=${isDiagnosticMode ? 'OFF' : 'ON'} corsFix=${isNoCorsFix ? 'OFF' : 'ON'}`);
}

const requestOriginMap = new Map();

// Instancia única: dos procesos sobre el mismo perfil rompen cache/quota/cookies de Cloudflare
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[SingleInstance] Ya hay una instancia con el lock. Cerrando este proceso.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Flags de Chromium para reproducción multimedia confiable
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies,BlockInsecurePrivateNetworkRequests');
app.commandLine.appendSwitch('disable-webrtc');

// Esquema privilegiado cine:// (debe registrarse ANTES de app.whenReady). Se usa para responder
// 200 OK vacío a los anuncios en lugar de cancelarlos (los reproductores detectan ERR_BLOCKED_BY_CLIENT).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cine',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

// Servidores embed conocidos que requieren Referer y Origin del propio host para evitar pantallas negras o 403
const EMBED_HOSTS = [
  'tukiplay.com',
  'vidlink.pro',
  'videasy.net',
  'autoembed.co',
  'moviesapi.club',
  'smashystream.com',
  'vidcore.org',
  'vidsrc.cc',
  'vidsrc.me',
  'vidsrc.xyz',
  'vidsrc.to',
  'multiembed.mov',
  'superembed.stream',
  'cloudstream.to',
  'streamtape.com',
  'doodstream.com',
  'filelions.to',
  'latanime.org',
  'ok.ru',
  'filemoon.sx',
];

// Redes de anuncios agresivas y popups a bloquear
const AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'adsterra.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'trafficjunky.net',
  'exoclick.com',
  'adcolony.com',
  'bet365.com',
  '1xbet.com',
  'onclickbright.com',
  'histats.com',
  'adnxs.com',
  'cpmstar.com',
  'adtrue.com',
  'monetag.com',
  'hilltopads.com',
  'richpush.co',
  'unmailpomolo.cyou',
  'ay267.com',
  '071kk.com',
  'bblaa.com',
  'koalapocket.com',
  'interlinecustomroofingllc.com',
  'shein.com',
  'wps.com',
];

// Lista blanca MUY corta de popups permitidos (todo lo demás se deniega)
const POPUP_ALLOW = /^https?:\/\/[^/]*(tukiplay|vidcore|vidsrc|2embed|multiembed|vidlink|videasy|moviesapi|smashy|superembed|streamtape|filemoon)/i;

// Patrones de red para el filtro "camaleón" (dominio exacto + subdominios)
const AD_FILTER_PATTERNS = AD_HOSTS.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);

// Escudo inyectado en TODOS los iframes: window.open devuelve una ventana falsa "abierta"
// (closed:false) para que el reproductor crea que el anuncio se mostró y arranque el video.
const AD_SHIELD = `(function(){
  if (window.__cineShield) return;
  window.__cineShield = true;

  function fakeDoc(){
    var noop = function(){};
    var el = function(){ return { style:{}, appendChild:noop, setAttribute:noop, addEventListener:noop, remove:noop }; };
    return { write:noop, writeln:noop, open:function(){ return this; }, close:noop, title:'',
      body:{ appendChild:noop, innerHTML:'', style:{} }, head:{ appendChild:noop },
      createElement:el, createTextNode:function(){ return {}; }, getElementById:function(){ return null; },
      querySelector:function(){ return null; }, addEventListener:noop, removeEventListener:noop };
  }

  function fakeWin(url){
    var w = {
      closed: false,
      location: { href: url || 'about:blank', replace: function(u){ this.href = u; }, assign: function(u){ this.href = u; } },
      document: fakeDoc(),
      focus: function(){}, blur: function(){},
      close: function(){ this.closed = true; },
      postMessage: function(){}, addEventListener: function(){}, removeEventListener: function(){},
      opener: window, name: ''
    };
    w.self = w; w.window = w; w.top = window.top;
    return w;
  }

  window.open = function(url){ return fakeWin(url ? String(url) : 'about:blank'); };
  window.focus = window.focus || function(){};
})();`;

// Escudo de Huella Digital Real (FP_SHIELD): Coincidencia exacta con versión real de Chromium de Electron
// TAREA F: No spoofear navigator.userAgentData en challenges.cloudflare.com o turnstile (evita error 600010 + No available adapters)
const FP_SHIELD = `(function(){
  if (window.__cineFP) return;
  if (/challenges\\.cloudflare\\.com|turnstile/i.test(window.location.href)) return;
  window.__cineFP = true;
  try {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({
      brands: [
        { brand: 'Google Chrome', version: '${CHROME_MAJOR}' },
        { brand: 'Chromium',      version: '${CHROME_MAJOR}' },
        { brand: 'Not_A Brand',   version: '24' }
      ],
      mobile: false, platform: 'Windows',
      getHighEntropyValues: async () => ({
        platform: 'Windows', platformVersion: '10.0.0',
        architecture: 'x86', bitness: '64', model: '', uaFullVersion: '${CHROME_VER || '130.0.0.0'}'
      })
    })});
    Object.defineProperty(navigator, 'languages', { get: () => ['es-AR','es','en'] });
  } catch(e){}
})();`;

// Se aplican solo selectores de publicidad específicos para no ocultar controles del reproductor
const AD_CSS = `
  ins.adsbygoogle, iframe[id^="aswift"], iframe[id^="google_ads"],
  iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
  div[id*="banner"], div[class~="ad"], div[class^="ad-"], div[class*=" ad-"], .adsbygoogle,
  a[target="_blank"][style*="z-index"],
  div[style*="z-index: 2147483647"]:not(:has(video, iframe)) {
    display: none !important;
    pointer-events: none !important;
    opacity: 0 !important;
  }
`;

// Proveedores embed configurados en embedService.ts (para el chequeo de salud)
const EMBED_PROVIDER_CHECKS = [
  { name: 'TukiPlay (HD)', url: 'https://tukiplay.com/embed/movie/550' },
  { name: 'VidLink Pro (Multi / Sub ES)', url: 'https://vidlink.pro/movie/550' },
  { name: 'VidEasy (Multi)', url: 'https://player.videasy.net/movie/550' },
  { name: 'AutoEmbed (HD)', url: 'https://player.autoembed.co/embed/movie/550' },
];

// =========================================================================
// SERVIDOR HTTP + WEBSOCKET EMBEBIDO PARA CONTROL REMOTO LAN
// =========================================================================
let embeddedHttpServer = null;
let embeddedWss = null;

async function saveSecureAuth(provider, data) {
  const dir = path.join(app.getPath('userData'), 'tokens');
  await fs.promises.mkdir(dir, { recursive: true });
  const raw = JSON.stringify({ ...data, savedAt: Date.now() });
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(raw);
    await fs.promises.writeFile(path.join(dir, `${provider}.bin`), enc);
  } else {
    await fs.promises.writeFile(path.join(dir, `${provider}.json`), raw, 'utf8');
  }
}

async function loadSecureAuth(provider) {
  const dir = path.join(app.getPath('userData'), 'tokens');
  try {
    const binPath = path.join(dir, `${provider}.bin`);
    if (fs.existsSync(binPath) && safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = await fs.promises.readFile(binPath);
      return JSON.parse(safeStorage.decryptString(buf));
    }
    const jsonPath = path.join(dir, `${provider}.json`);
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    }
  } catch (_) {}
  return null;
}

const m3u8TracksCache = new Map();

function detectTracks(masterBody) {
  const audio = new Set();
  const subs = new Set();
  let hasAudioMediaTags = false;

  if (typeof masterBody !== 'string') return { audio: [], subs: [], isSingleTrack: true, hasSpanishAudio: false };

  for (const m of masterBody.matchAll(/#EXT-X-MEDIA:TYPE=(AUDIO|SUBTITLES),([^\n]*)/gi)) {
    const [, type, attrs] = m;
    const isAudio = type.toUpperCase() === 'AUDIO';
    if (isAudio) hasAudioMediaTags = true;

    const lang = /LANGUAGE="([^"]+)"/i.exec(attrs)?.[1];
    const name = /NAME="([^"]+)"/i.exec(attrs)?.[1] || '';
    const bucket = isAudio ? audio : subs;

    if (lang) {
      const lowerLang = lang.toLowerCase();
      bucket.add(lowerLang);
      if (lowerLang.startsWith('es') || lowerLang === 'spa') bucket.add('es');
      if (lowerLang.startsWith('ja') || lowerLang === 'jpn') bucket.add('ja');
      if (lowerLang.startsWith('en') || lowerLang === 'eng') bucket.add('en');
    }
    if (/latino|español|spanish|castellano|spa\b|mex|es-419/i.test(name)) bucket.add('es');
    if (/jap|jpn|japanese|original/i.test(name)) bucket.add('ja');
    if (/eng|english|ingl/i.test(name)) bucket.add('en');
  }

  // Si no hay líneas EXT-X-MEDIA:TYPE=AUDIO en un .m3u8 con variantes #EXT-X-STREAM-INF,
  // el stream es de pista única con audio embebido en japonés/original (no conmutable)
  const isSingleTrack = !hasAudioMediaTags && masterBody.includes('#EXT-X-STREAM-INF');
  if (isSingleTrack) {
    audio.add('original');
  }

  return {
    audio: [...audio],
    subs: [...subs],
    isSingleTrack,
    hasSpanishAudio: audio.has('es'),
  };
}

let lastDetectedTracks = null;

async function analyzeM3u8Url(url, headers = {}) {
  try {
    if (m3u8TracksCache.has(url)) {
      lastDetectedTracks = m3u8TracksCache.get(url);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tracks-detected', lastDetectedTracks);
      }
      return;
    }

    const referer = headers['Referer'] || headers['referer'] || '';
    const userAgent = headers['User-Agent'] || headers['user-agent'] || REAL_UA;

    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Referer': referer,
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('#EXTM3U')) {
        const detected = detectTracks(text);
        lastDetectedTracks = { url, ...detected };
        m3u8TracksCache.set(url, lastDetectedTracks);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tracks-detected', lastDetectedTracks);
        }
      }
    }
  } catch (_) {}
}

function getAccountsFilePath() {
  return path.join(app.getPath('userData'), 'cinecast-accounts.json');
}

function loadAccountsFromDisk() {
  try {
    const fp = getAccountsFilePath();
    if (fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[Accounts] Error al leer cinecast-accounts.json:', err);
  }
  return { accounts: [], playlists: [], favorites: [] };
}

function saveAccountsToDisk(data) {
  try {
    const fp = getAccountsFilePath();
    const current = loadAccountsFromDisk();
    const updated = { ...current, ...(data || {}) };
    fs.writeFileSync(fp, JSON.stringify(updated, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn('[Accounts] Error al guardar cinecast-accounts.json:', err);
    return false;
  }
}

async function searchYouTubeTracks(query) {
  if (!query || typeof query !== 'string') return [];
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const items = [];
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    for (const section of contents) {
      const itemSection = section?.itemSectionRenderer?.contents || [];
      for (const item of itemSection) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        const videoId = v.videoId;
        const title = v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '';
        const channel = v.ownerText?.runs?.map((r) => r.text).join('') || '';
        const duration = v.lengthText?.simpleText || '';
        const thumbnails = v.thumbnail?.thumbnails || [];
        const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        items.push({ videoId, title, channel, duration, thumbnail });
        if (items.length >= 20) break;
      }
      if (items.length >= 20) break;
    }
    return items;
  } catch (err) {
    console.warn('[searchYouTubeTracks] Error:', err);
    return [];
  }
}

function startEmbeddedServer() {
  try {
    const express = require('express');
    const http = require('http');

    const PORT = 3000;
    const baseDir = path.join(__dirname, '..');
    const userDataPath = app.getPath('userData');
    const posterCacheDir = path.join(userDataPath, 'poster_cache');
    const mediaCacheDir = path.join(userDataPath, 'media_cache');
    const accountsFilePath = getAccountsFilePath();

    const appExpress = createApp({
      baseDir,
      userDataPath,
      posterCacheDir,
      mediaCacheDir,
      accountsFilePath,
      userAgent: REAL_CHROME_USER_AGENT,
      port: PORT,
      diagnostics: {
        getMode: () => isDiagnosticMode,
        setMode: (val) => {
          isDiagnosticMode = Boolean(val);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.setUserAgent(isDiagnosticMode ? '' : REAL_CHROME_USER_AGENT);
            mainWindow.webContents.send('diagnostic-mode-changed', isDiagnosticMode);
          }
        },
        getNoCorsFix: () => isNoCorsFix,
        setNoCorsFix: (val) => {
          isNoCorsFix = Boolean(val);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('no-cors-fix-changed', isNoCorsFix);
          }
        },
        onChange: () => {
          printDiagLog();
        },
      },
      auth: {
        userDataPath,
        accountsFilePath,
        saveSecureAuth,
        loadSecureAuth,
        onAuthUpdated: (payload) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:updated', payload);
          }
        },
      },
      onHistoryUpdated: (merged) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('watchHistoryUpdated', merged);
        }
      },
    });

    const distPath = path.join(baseDir, 'dist');
    appExpress.use(express.static(distPath));

    appExpress.get('*', (_req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send('CineCast TV embedded server active');
      }
    });

    const server = http.createServer(appExpress);
    embeddedWss = attachWebSocket(server);

    let retriedAfterKill = false;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Tenemos el lock de instancia única: quien ocupa el 3000 NO es otra CineCast viva.
        let ownerPid = null;
        let ownerName = '';
        try {
          const { execSync } = require('child_process');
          const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
          const line = out.split(/\r?\n/).find((l) => /:3000\s/.test(l) && /LISTENING/i.test(l));
          ownerPid = line ? parseInt(line.trim().split(/\s+/).pop(), 10) : null;
          if (ownerPid) {
            ownerName = execSync(`tasklist /FI "PID eq ${ownerPid}" /FO CSV /NH`, { encoding: 'utf8' }).split(',')[0].replace(/"/g, '');
          }
        } catch (_) {}
        const isZombie = ownerPid && ownerPid !== process.pid && /electron|cinecast/i.test(ownerName);
        if (isZombie && !retriedAfterKill) {
          console.warn(`🧟 [SyncServer] Puerto 3000 ocupado por zombi ${ownerName} PID ${ownerPid}. Matándolo y reintentando.`);
          try { process.kill(ownerPid, 'SIGKILL'); } catch (_) {}
          retriedAfterKill = true;
          setTimeout(() => { try { server.listen(PORT, '0.0.0.0'); } catch (_) {} }, 1200);
        } else {
          console.warn(`📡 [SyncServer] Puerto 3000 en uso por ${ownerName || 'desconocido'} PID ${ownerPid || '?'} (no es zombi CineCast: dev server). Reutilizando.`);
        }
      } else {
        console.error('❌ [SyncServer] Error en servidor embebido:', err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      const localIp = getLocalIpAddress();
      console.log('====================================================');
      console.log('🎬 CineCast Servidor Embebido Activo en 0.0.0.0:3000:');
      console.log(`   ➜ Local:    http://localhost:${PORT}`);
      console.log(`   ➜ Red WiFi: http://${localIp || '127.0.0.1'}:${PORT}`);
      console.log('====================================================');
    });

    embeddedHttpServer = server;
  } catch (err) {
    console.error('⚠️ [SyncServer] No se pudo levantar el servidor embebido:', err);
  }
}

let mainWindow = null;

// Cabeceras (Referer / User-Agent) requeridas por streams IPTV, indexadas por HOSTNAME con 30 min TTL
const streamHeadersByHost = new Map();
const STREAM_HEADERS_TTL = 30 * 60 * 1000; // 30 minutos

function registerStreamHeaders(rawUrl, { referrer, userAgent }) {
  if (!rawUrl) return;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    streamHeadersByHost.set(host, {
      referrer: referrer || '',
      userAgent: userAgent || REAL_UA,
      timestamp: Date.now(),
    });
  } catch (_) {}
}

function findStreamHeaders(rawUrl) {
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const entry = streamHeadersByHost.get(host);
    if (entry) {
      if (Date.now() - entry.timestamp > STREAM_HEADERS_TTL) {
        streamHeadersByHost.delete(host);
        return null;
      }
      return entry;
    }
  } catch (_) {}
  return null;
}


// Respuestas 200 OK "falsas" para el esquema cine:// (una vez por sesión)
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const CINE_OK_HEADERS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=604800' };
const cineHandledSessions = new WeakSet();

function registerCineProtocol(sess) {
  if (cineHandledSessions.has(sess)) return;
  cineHandledSessions.add(sess);
  try {
    sess.protocol.handle('cine', (req) => {
      const p = new URL(req.url).pathname;
      if (p.endsWith('.js')) {
        return new Response('/*cine-ok*/', { headers: { ...CINE_OK_HEADERS, 'content-type': 'application/javascript' } });
      }
      if (p.endsWith('.css')) {
        return new Response('', { headers: { ...CINE_OK_HEADERS, 'content-type': 'text/css' } });
      }
      if (p.endsWith('.gif')) {
        return new Response(PIXEL_GIF, { headers: { ...CINE_OK_HEADERS, 'content-type': 'image/gif' } });
      }
      return new Response('', { headers: { ...CINE_OK_HEADERS, 'content-type': 'text/html' } });
    });
  } catch (err) {
    console.warn('[cine://] no se pudo registrar el handler:', err);
  }
}

function createWindow() {
  // Configurar sesión persistente en disco (guarda cookies, storage y credenciales)
  const customSession = session.fromPartition('persist:cinecast-session', { cache: true });
  customSession.setUserAgent(REAL_CHROME_USER_AGENT);

  // Sesión persistente para YouTube TV (Leanback UI para Smart TV)
  const ytSession = session.fromPartition('persist:youtube-tv', { cache: true });
  ytSession.setUserAgent(SMART_TV_UA);

  // Sesión persistente para Spotify Web Player
  const spotifySession = session.fromPartition('persist:spotify', { cache: true });
  spotifySession.setUserAgent(REAL_UA);

  // =========================================================================
  // 2. BYPASS DE REFERER / ORIGIN PARA EVITAR PANTALLAS NEGRAS EN IFRAMES
  // =========================================================================
  customSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // TAREA 2: En Modo Diagnóstico, apagar reescritura de headers y spoof de User-Agent
    if (isDiagnosticMode) {
      return callback({ cancel: false, requestHeaders: details.requestHeaders });
    }

    const headers = { ...details.requestHeaders };
    const url = details.url || '';

    // Guardar Origin de la petición para cotejo CORS estricto en onHeadersReceived
    const origin = details.requestHeaders?.Origin || details.requestHeaders?.origin;
    if (origin && details.id) {
      requestOriginMap.set(details.id, origin);
      if (requestOriginMap.size > 2000) {
        const first = requestOriginMap.keys().next().value;
        requestOriginMap.delete(first);
      }
    }

    if (/accounts\.google\.com|youtube\.com/i.test(url)) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
      delete headers['sec-ch-ua'];
      delete headers['sec-ch-ua-mobile'];
      delete headers['sec-ch-ua-platform'];
    } else {
      headers['User-Agent'] = REAL_UA;
      headers['sec-ch-ua'] = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`;
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';
    }

    // Cabeceras específicas del stream IPTV (referrer / user_agent de iptv-org)
    const sh = findStreamHeaders(details.url);
    if (sh) {
      if (sh.referrer) headers['Referer'] = sh.referrer;
      if (sh.userAgent) headers['User-Agent'] = sh.userAgent;
    }

    try {
      const urlObj = new URL(details.url);
      const isEmbedHost = EMBED_HOSTS.some((host) => urlObj.hostname.includes(host));

      if (isEmbedHost) {
        // Asignar el propio host como Referer y Origin para pasar verificaciones anti-hotlinking
        headers['Referer'] = `${urlObj.protocol}//${urlObj.hostname}/`;
        headers['Origin'] = `${urlObj.protocol}//${urlObj.hostname}`;
        headers['Sec-Fetch-Site'] = 'same-origin';
      }
    } catch (_) {}

    // Detectar peticiones HLS (.m3u8) para análisis en tiempo real de pistas de audio y subtítulos
    if (details.url && details.url.includes('.m3u8')) {
      const ref = details.referrer || headers['Referer'] || '';
      analyzeM3u8Url(details.url, { ...headers, Referer: ref });
    }

    callback({ cancel: false, requestHeaders: headers });
  });

  // =========================================================================
  // 3. REMOCIÓN DE CABECERAS BLOQUEADORAS DE FRAMES (X-Frame-Options & CSP) Y CORS INTELIGENTE
  // =========================================================================
  customSession.webRequest.onHeadersReceived((details, callback) => {
    // TAREA D: El fix de CORS NUNCA se apaga en Modo Diagnóstico salvo que 'Sin fix CORS' (isNoCorsFix) esté activo
    if (isNoCorsFix) {
      return callback({ cancel: false, responseHeaders: details.responseHeaders });
    }

    const responseHeaders = { ...details.responseHeaders };

    const get = (name) => {
      const lower = name.toLowerCase();
      for (const k of Object.keys(responseHeaders)) {
        if (k.toLowerCase() === lower) {
          const v = responseHeaders[k];
          return Array.isArray(v) ? v[0] : v;
        }
      }
      return null;
    };

    const set = (name, value) => {
      const lower = name.toLowerCase();
      for (const k of Object.keys(responseHeaders)) {
        if (k.toLowerCase() === lower) delete responseHeaders[k];
      }
      responseHeaders[lower] = Array.isArray(value) ? value : [String(value)];
    };

    // TAREA 1 (CORS): Setear el header solo si falta. Si el request trae Origin, hacer eco de Origin + credentials: true + Vary: Origin. Nunca '*' cuando hay credenciales.
    const origin = details.requestHeaders?.Origin || details.requestHeaders?.origin || (details.id ? requestOriginMap.get(details.id) : null);
    if (details.id) requestOriginMap.delete(details.id);

    const curAcao = get('access-control-allow-origin');
    if (!curAcao) {
      if (origin) {
        set('access-control-allow-origin', origin);
        set('access-control-allow-credentials', 'true');
        set('vary', 'Origin');
      } else {
        set('access-control-allow-origin', '*');
      }
    } else if (origin && (curAcao === '*' || curAcao.includes('*'))) {
      // Si el backend/CDN respondió con wildcard '*' pero el iframe usó credentials 'include', Chromium aborta por CORS spec:
      // hacer eco del Origin específico para permitir credenciales sin errores de red.
      set('access-control-allow-origin', origin);
      set('access-control-allow-credentials', 'true');
      set('vary', 'Origin');
    }

    if (!get('access-control-allow-methods')) {
      set('access-control-allow-methods', 'GET, HEAD, OPTIONS, POST');
    }
    if (!get('access-control-allow-headers')) {
      set('access-control-allow-headers', '*');
    }

    try {
      const urlObj = new URL(details.url);
      const isEmbedHost = EMBED_HOSTS.some((host) => urlObj.hostname.includes(host));

      if (isEmbedHost) {
        // Eliminar cabeceras que causan pantallas negras dentro de iframes
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['Content-Security-Policy'];
      }
    } catch (_) {}

    callback({ cancel: false, responseHeaders });
  });

  // =========================================================================
  // 4. FILTRO DE RED (BLOQUEO DE ANUNCIOS Y TRACKERS A NIVEL RED)
  // =========================================================================

  // Dominios de verificación legítimos (Cloudflare Turnstile, hCaptcha, Google reCAPTCHA)
  // NUNCA deben ser redirigidos ni bloqueados por el filtro camaleón
  const CAPTCHA_WHITELIST = [
    'challenges.cloudflare.com',
    'hcaptcha.com',
    'recaptcha.net',
    'google.com/recaptcha',
    'gstatic.com',
    'cloudflare.com',
    'jsdelivr.net',
    'unpkg.com',
  ];

  let adBlockCount = 0;

  // En lugar de cancelar (ERR_BLOCKED_BY_CLIENT => el reproductor detecta AdBlock), se redirige
  // en silencio a cine://, que responde 200 OK con contenido vacío del mismo tipo.
  const fakeAdResponse = (details, callback) => {
    // TAREA 2: En Modo Diagnóstico, apagar bloqueo de anuncios
    if (isDiagnosticMode) {
      return callback({ cancel: false });
    }
    const u = details.url || '';
    if (CAPTCHA_WHITELIST.some((cw) => u.includes(cw))) {
      callback({ cancel: false });
      return;
    }
    adBlockCount++;
    if (adBlockCount % 100 === 0) {
      console.log(`[AdBlock] Bloqueados: ${adBlockCount}`);
    }
    let target = 'cine://blank/index.html';
    if (/\.js(\?|$)/i.test(u)) target = 'cine://blank/noop.js';
    else if (/\.css(\?|$)/i.test(u)) target = 'cine://blank/noop.css';
    else if (/\.(png|gif|jpe?g|webp|svg)(\?|$)/i.test(u)) target = 'cine://blank/pixel.gif';
    callback({ redirectURL: target });
  };
  customSession.webRequest.onBeforeRequest({ urls: AD_FILTER_PATTERNS }, fakeAdResponse);
  session.defaultSession.webRequest.onBeforeRequest({ urls: AD_FILTER_PATTERNS }, fakeAdResponse);
  registerCineProtocol(customSession);
  registerCineProtocol(session.defaultSession);

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'CineCast TV',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:cinecast-session',
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setUserAgent(REAL_CHROME_USER_AGENT);

  // Inyecta el escudo anti-popup (window.open falso) y el CSS anti-anuncios en todos los iframes
  // del reproductor. Se omite el frame de la propia app (localhost) para no alterar la UI.
  const AD_CSS_INJECTOR = `(function(){
    if (document.getElementById('cine-ad-css')) return;
    var s = document.createElement('style');
    s.id = 'cine-ad-css';
    s.textContent = ${JSON.stringify(AD_CSS)};
    (document.head || document.documentElement).appendChild(s);
  })();`;
  const injectShieldAndCss = async () => {
    // TAREA 2 & D: En Modo Diagnóstico, apagar inyección de escudos anti-popup, CSS y spoofing
    if (isDiagnosticMode) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    let frames = [];
    try {
      frames = mainWindow.webContents.mainFrame.framesInSubtree;
    } catch (_) {
      return;
    }
    for (const f of frames) {
      try {
        const url = f.url || '';
        if (!url || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') || url.startsWith('file:')) continue;
        if (/youtube\.com|google\.com|accounts\.google\.com|gstatic\.com|spotify\.com/i.test(url)) continue;
        // TAREA F: No spoofear navigator.userAgentData en frames de challenges.cloudflare.com ni turnstile
        if (!/challenges\.cloudflare\.com|turnstile/i.test(url)) {
          await f.executeJavaScript(FP_SHIELD, false);
        }
        await f.executeJavaScript(AD_SHIELD, false);
        await f.executeJavaScript(AD_CSS_INJECTOR, false);
      } catch (_) {}
    }
  };
  mainWindow.webContents.on('did-frame-finish-load', injectShieldAndCss);
  mainWindow.webContents.on('did-frame-navigate', injectShieldAndCss);
  mainWindow.webContents.on('did-navigate-in-page', injectShieldAndCss);

  // Evitar que iframes publicitarios redirijan la ventana principal de la app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname !== 'localhost' && urlObj.hostname !== '127.0.0.1') {
        event.preventDefault();
        console.log('🛡️ [Anti-Redirect] Bloqueado intento de redirección del frame principal a:', url);
      }
    } catch (_) {}
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return; // ERR_ABORTED, normal
    console.warn(`⚠️ [did-fail-load] main=${isMainFrame} ${code} ${desc} -> ${url}`);
    if (!isMainFrame && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('embed-failed', { code, desc, url });
    }
  });

  // =========================================================================
  // 5. CONTROL INTELIGENTE DE VENTANAS Y POP-UPS (ANTI-AD SYSTEM)
  // =========================================================================
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // TAREA D: En Modo Diagnóstico, apagar el bloqueador de popups por completo
    if (isDiagnosticMode) {
      return { action: 'allow' };
    }
    if (POPUP_ALLOW.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#000',
          webPreferences: {
            partition: 'persist:cinecast-session',
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
          },
        },
      };
    }
    console.log('🛡️ [Anti-Popup] denegado:', url);
    return { action: 'deny' };
  });

  // =========================================================================
  // 5.1 CONTROL DE WEBVIEWS GUEST (PASO 2 - CENSURA)
  // =========================================================================
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (isDiagnosticMode) return { action: 'allow' };
        if (
          POPUP_ALLOW.test(url) ||
          url.includes('videasy') ||
          url.includes('embed') ||
          url.includes('tukiplay') ||
          url.includes('vidlink') ||
          url.includes('autoembed')
        ) {
          return { action: 'allow' };
        }
        console.log('🛡️ [Webview Anti-Popup] Bloqueado popup publicitario:', url);
        return { action: 'deny' };
      });
    }
  });

// Función de ventana auxiliar para reproductor específico si se requiere
function createPlayerWindow(url) {
  const playerWin = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      partition: 'persist:cinecast-session',
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });
  playerWin.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isDiagnosticMode) return { action: 'allow' };
    if (
      POPUP_ALLOW.test(targetUrl) ||
      targetUrl.includes('videasy') ||
      targetUrl.includes('embed') ||
      targetUrl.includes('tukiplay') ||
      targetUrl.includes('vidlink') ||
      targetUrl.includes('autoembed')
    ) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });
  if (url) playerWin.loadURL(url);
  return playerWin;
}

  // =========================================================================
  // 6. CARGA DE LA APLICACIÓN
  // =========================================================================
  const port = process.env.PORT || 3000;
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

  // Cargar siempre vía servidor HTTP local (0.0.0.0:3000) para habilitar WebSocket nativo,
  // con fallback automático a loadFile si aún no estuviera escuchando
  mainWindow.loadURL(`http://localhost:${port}/?role=screen`).catch(() => {
    setTimeout(() => {
      mainWindow?.loadURL(`http://localhost:${port}/?role=screen`).catch(() => {
        console.log('[Electron] Cargando index.html local directo como fallback');
        mainWindow?.loadFile(indexPath, { query: { role: 'screen' } });
      });
    }, 1000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =========================================================================
// 7. CANALES IPC PARA CONTROL NATIVO Y GESTIÓN DE EMBEDS
// =========================================================================
// Simular pulsación de tecla nativa con secuencia completa (keyDown + char + keyUp)
ipcMain.handle('send-native-key', (_event, keyCode) => {
  if (!mainWindow) return false;
  try {
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    mainWindow.webContents.sendInputEvent({ type: 'char', keyCode });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });

    // También reenviar a webviews invitados (YouTube TV, Spotify) si están activos
    const allWcs = webContents.getAllWebContents();
    for (const wc of allWcs) {
      if (wc.id !== mainWindow.webContents.id) {
        try {
          wc.sendInputEvent({ type: 'keyDown', keyCode });
          wc.sendInputEvent({ type: 'char', keyCode });
          wc.sendInputEvent({ type: 'keyUp', keyCode });
        } catch (_) {}
      }
    }
    return true;
  } catch (_) {
    return false;
  }
});

// Enviar tecla directamente al webview (guest webContents) para navegación en YouTube TV / Spotify
ipcMain.handle('send-key-to-webview', (_event, keyPayload) => {
  const keyCode = typeof keyPayload === 'string' ? keyPayload : (keyPayload?.keyCode || keyPayload?.key);
  if (!keyCode) return false;
  let sent = false;
  try {
    const allWcs = webContents.getAllWebContents();
    for (const wc of allWcs) {
      if (mainWindow && wc.id === mainWindow.webContents.id) continue;
      const u = wc.getURL() || '';
      if (u.includes('youtube.com') || u.includes('spotify.com') || u.includes('tv')) {
        wc.sendInputEvent({ type: 'keyDown', keyCode });
        wc.sendInputEvent({ type: 'char', keyCode });
        wc.sendInputEvent({ type: 'keyUp', keyCode });
        sent = true;
      }
    }
  } catch (err) {
    console.warn('[send-key-to-webview] Error enviando tecla a webview:', err);
  }
  return sent;
});

// Simular clic nativo en coordenadas
ipcMain.handle('send-native-click', (_event, { x, y }) => {
  if (!mainWindow) return false;
  try {
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return true;
  } catch (_) {
    return false;
  }
});

// Control Modo Trackpad Remoto (mueve cursor, clic y scroll en pantalla y webviews)
let virtualCursorX = 683;
let virtualCursorY = 384;
ipcMain.handle('send-native-trackpad-event', (_event, payload) => {
  if (!mainWindow) return false;
  const bounds = mainWindow.getContentBounds();
  const { type, dx, dy, button } = payload || {};

  try {
    if (type === 'move') {
      const sensitivity = 1.45;
      virtualCursorX = Math.max(10, Math.min(bounds.width - 10, virtualCursorX + (dx || 0) * sensitivity));
      virtualCursorY = Math.max(10, Math.min(bounds.height - 10, virtualCursorY + (dy || 0) * sensitivity));

      const x = Math.round(virtualCursorX);
      const y = Math.round(virtualCursorY);

      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });

      const allWcs = webContents.getAllWebContents();
      for (const wc of allWcs) {
        if (wc.id !== mainWindow.webContents.id) {
          try { wc.sendInputEvent({ type: 'mouseMove', x, y }); } catch (_) {}
        }
      }

      mainWindow.webContents.send('virtual-cursor-position', { x, y, visible: true });
      return true;
    }

    if (type === 'click') {
      const x = Math.round(virtualCursorX);
      const y = Math.round(virtualCursorY);
      const btn = button === 'right' ? 'right' : 'left';

      mainWindow.focus();
      mainWindow.webContents.focus();
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 1 });
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 1 });

      const allWcs = webContents.getAllWebContents();
      for (const wc of allWcs) {
        if (wc.id !== mainWindow.webContents.id) {
          try {
            wc.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 1 });
          } catch (_) {}
        }
      }
      return true;
    }

    if (type === 'scroll') {
      const x = Math.round(virtualCursorX);
      const y = Math.round(virtualCursorY);
      mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaY: (dy || 0) * 2 });
      return true;
    }
  } catch (err) {
    console.warn('[Trackpad] Error dispatching input event:', err);
  }
  return false;
});

// Simular clic nativo forzado seguro (con throttle de 400ms)
let lastSimulatedClickTime = 0;
ipcMain.handle('simulate-play-click', (_event, coords) => {
  if (!mainWindow) return false;

  const now = Date.now();
  if (now - lastSimulatedClickTime < 400) {
    return false;
  }
  lastSimulatedClickTime = now;

  let x, y;
  if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
    x = Math.round(coords.x);
    y = Math.round(coords.y);
  } else {
    const bounds = mainWindow.getContentBounds();
    x = Math.round(bounds.width / 2);
    y = Math.round(bounds.height / 2);
  }
  try {
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return true;
  } catch (_) {
    return false;
  }
});

// Función auxiliar que recorre TODOS los frames de la ventana principal y de cualquier webview
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

// Control de volumen maestro en Electron (incluso en iframes, YouTube y Spotify)
ipcMain.handle('set-master-volume', async (_event, { volume, isMuted }) => {
  if (!mainWindow) return false;
  const muted = Boolean(isMuted || volume <= 0);
  mainWindow.webContents.setAudioMuted(muted);
  const vol01 = Math.max(0, Math.min(1, Number(volume ?? 100) / 100));
  // Inyecta el volumen en todos los frames/iframes/webviews que tengan etiquetas <video> o <audio>
  for (const frame of getAllFrames()) {
    frame.executeJavaScript(`
      document.querySelectorAll('video, audio').forEach(el => {
        el.volume = ${vol01};
        el.muted = ${muted};
      });
    `).catch(() => {});
  }
  return true;
});

// Lector universal de estado y tiempo REAL de reproducción
ipcMain.handle('get-real-media-state', async () => {
  const frames = getAllFrames();
  let best = null;
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(() => {
        const els = Array.from(document.querySelectorAll('video, audio'));
        for (const el of els) {
          const dur = Number.isFinite(el.duration) ? el.duration : 0;
          const cur = Number.isFinite(el.currentTime) ? el.currentTime : 0;
          if (dur > 0 || cur > 0 || !el.paused || el.readyState >= 2) {
            return {
              found: true,
              currentTime: cur,
              duration: dur,
              isPlaying: !el.paused && !el.ended,
              isLive: !Number.isFinite(el.duration) && el.readyState >= 2,
              title: document.title || ''
            };
          }
        }
        return null;
      })()`);
      if (res && res.found) {
        if (!best || res.isPlaying || res.currentTime > best.currentTime) {
          best = res;
        }
      }
    } catch (_) {}
  }
  if (best) {
    return { ...best, detectedTracks: lastDetectedTracks };
  }
  if (lastDetectedTracks) {
    return { found: false, detectedTracks: lastDetectedTracks };
  }
  return null;
});

// Control universal de reproducción (+10s/-10s, seek, play/pause, subtítulos)
let subtitlesEnabled = true;
ipcMain.handle('control-active-media', async (_event, { action, value }) => {
  const frames = getAllFrames();
  let handledByMediaEl = false;
  let anyFrameHadMedia = false;
  let currentPlayingState = false;
  let newTime = 0;

  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(`(async () => {
        const action = ${JSON.stringify(action)};
        const value = ${JSON.stringify(value)};

        if (action === 'toggleSubtitles') {
          const enable = Boolean(value);
          let styleEl = document.getElementById('cinecast-sub-hide');
          if (!enable) {
            if (!styleEl) {
              styleEl = document.createElement('style');
              styleEl.id = 'cinecast-sub-hide';
              document.head?.appendChild(styleEl);
            }
            styleEl.textContent = '.jw-captions, .jw-text-track-container, .plyr__captions, .vjs-text-track-display, .ytp-caption-window-container, [class*="captions"], [class*="subtitle"], video::cue { display: none !important; opacity: 0 !important; visibility: hidden !important; }';
          } else if (styleEl) {
            styleEl.remove();
          }
          document.querySelectorAll('video').forEach(v => {
            if (v.textTracks) {
              for (let i = 0; i < v.textTracks.length; i++) {
                v.textTracks[i].mode = enable ? (i === 0 ? 'showing' : 'disabled') : 'disabled';
              }
            }
          });
          return { acted: true, hasMedia: true, isPlaying: true, currentTime: 0 };
        }

        const els = Array.from(document.querySelectorAll('video, audio'));
        let acted = false;
        let hasMedia = false;
        let isPlaying = false;
        let curTime = 0;

        for (const el of els) {
          const dur = Number.isFinite(el.duration) ? el.duration : 0;
          const cur = Number.isFinite(el.currentTime) ? el.currentTime : 0;
          if (dur > 0 || cur > 0 || !el.paused || el.readyState >= 1) {
            hasMedia = true;
          }

          if (el.readyState < 1 && dur === 0 && cur === 0 && el.paused) continue;

          const wasPaused = el.paused;
          if (action === 'play') {
            if (wasPaused) {
              try { await el.play(); } catch (_) {}
            }
            acted = true;
          } else if (action === 'pause') {
            if (!wasPaused) {
              el.pause();
            }
            acted = true;
          } else if (action === 'togglePlay') {
            if (wasPaused) {
              try { await el.play(); } catch (_) {}
            } else {
              el.pause();
            }
            acted = true;
          } else if (action === 'seekRelative') {
            const delta = Number(value) || 10;
            const target = Math.max(0, el.currentTime + delta);
            el.currentTime = target;
            try { el.dispatchEvent(new Event('seeking')); el.dispatchEvent(new Event('seeked')); } catch (_) {}
            acted = true;
          } else if (action === 'seek') {
            const target = Math.max(0, Number(value) || 0);
            el.currentTime = target;
            try { el.dispatchEvent(new Event('seeking')); el.dispatchEvent(new Event('seeked')); } catch (_) {}
            acted = true;
          }

          isPlaying = !el.paused && !el.ended;
          curTime = el.currentTime;
          if (acted) break;
        }

        // Soporte de frameworks de video populares en embeds (Artplayer, JWPlayer, etc.)
        if (!acted && (action === 'seek' || action === 'seekRelative')) {
          try {
            if (window.art) {
              const cur = window.art.currentTime || 0;
              const target = action === 'seekRelative' ? Math.max(0, cur + (Number(value) || 10)) : Math.max(0, Number(value) || 0);
              window.art.seek = target;
              acted = true;
              hasMedia = true;
              curTime = target;
              isPlaying = true;
            }
            if (window.jwplayer) {
              const jw = window.jwplayer();
              if (jw && typeof jw.seek === 'function') {
                const cur = jw.getPosition ? jw.getPosition() : 0;
                const target = action === 'seekRelative' ? Math.max(0, cur + (Number(value) || 10)) : Math.max(0, Number(value) || 0);
                jw.seek(target);
                acted = true;
                hasMedia = true;
                curTime = target;
                isPlaying = true;
              }
            }
          } catch (_) {}
        }

        if (!acted && (action === 'play' || action === 'togglePlay')) {
          const playBtn = document.querySelector('.jw-icon-display, .plyr__control--overlaid, .vjs-big-play-button, [aria-label*="Play" i], .play-button, #play, button[class*="play" i]');
          if (playBtn) { playBtn.click(); acted = true; hasMedia = true; isPlaying = true; }
        }

        return { acted, hasMedia, isPlaying, currentTime: curTime };
      })()`);

      if (res) {
        if (res.hasMedia) anyFrameHadMedia = true;
        if (res.acted) {
          handledByMediaEl = true;
          currentPlayingState = res.isPlaying;
          newTime = res.currentTime;
          break;
        }
      }
    } catch (_) {}
  }

  // Solo enviar el clic físico en el centro de la ventana si ningún frame tenía un <video> con duration > 0 o readyState >= 1
  if (!handledByMediaEl && !anyFrameHadMedia && (action === 'play' || action === 'togglePlay') && mainWindow) {
    try {
      const bounds = mainWindow.getContentBounds();
      const x = Math.round(bounds.width / 2);
      const y = Math.round(bounds.height / 2);
      mainWindow.focus();
      mainWindow.webContents.focus();
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      handledByMediaEl = true;
      currentPlayingState = true;
    } catch (_) {}
  }

  if (action === 'toggleSubtitles') {
    subtitlesEnabled = typeof value === 'boolean' ? value : !subtitlesEnabled;
    return { ok: true, isPlaying: currentPlayingState, currentTime: newTime, subtitlesEnabled };
  }
  return { ok: handledByMediaEl, isPlaying: currentPlayingState, currentTime: newTime, subtitlesEnabled };
});

// Pantalla completa nativa
ipcMain.handle('toggle-fullscreen', (_event, forceState) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = typeof forceState === 'boolean' ? forceState : !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

// Búsqueda de pistas multimedia sin DRM
ipcMain.handle('search-media-tracks', async (_event, query) => {
  return await searchYouTubeTracks(query);
});

// Cuentas y playlists guardadas en disco
ipcMain.handle('get-saved-accounts', () => {
  return loadAccountsFromDisk();
});

ipcMain.handle('save-accounts', (_event, data) => {
  return saveAccountsToDisk(data);
});

// Pistas detectadas reales (.m3u8)
ipcMain.handle('get-detected-tracks', () => {
  return lastDetectedTracks;
});

// Verificación y sondeo de señales de video / IPTV
ipcMain.handle('probe-streams', async (_event, urls) => {
  if (!Array.isArray(urls)) return {};
  const results = {};
  await Promise.allSettled(urls.slice(0, 60).map(async (u) => {
    try {
      const sh = findStreamHeaders(u);
      const res = await fetch(u, {
        method: 'GET',
        headers: {
          'User-Agent': sh?.userAgent || REAL_CHROME_USER_AGENT,
          'Referer': sh?.referrer || '',
          'Accept': '*/*',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok && res.status !== 206) {
        results[u] = false;
        return;
      }
      const text = await res.text();
      results[u] = text.trimStart().startsWith('#EXTM3U');
    } catch {
      results[u] = false;
    }
  }));
  return results;
});

// Chequeo de salud de proveedores embed: devuelve {name, ok, ms, status} por proveedor
ipcMain.handle('check-embed-providers', async () => {
  const results = await Promise.all(
    EMBED_PROVIDER_CHECKS.map(async (p) => {
      const started = Date.now();
      try {
        const res = await fetch(p.url, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': REAL_CHROME_USER_AGENT, Accept: 'text/html,*/*' },
          signal: AbortSignal.timeout(6000),
        });
        return { name: p.name, ok: res.status < 400, ms: Date.now() - started, status: res.status };
      } catch (_) {
        return { name: p.name, ok: false, ms: Date.now() - started, status: 0 };
      }
    })
  );
  return results;
});

// Control de errores de certificados SSL con lista blanca explícita (CERT_ALLOWLIST)
const CERT_ALLOWLIST = new Set([]);
const loggedCertErrors = new Set();

app.on('certificate-error', (event, _wc, url, error, _cert, cb) => {
  let host = 'unknown';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_) {}
  const logKey = `${host}|${error}`;
  if (!loggedCertErrors.has(logKey)) {
    loggedCertErrors.add(logKey);
    console.warn(`[cert-error] ${host} ${error}`);
  }
  if (CERT_ALLOWLIST.has(host)) {
    event.preventDefault();
    cb(true);
  } else {
    cb(false);
  }
});

// Cabeceras (Referer / User-Agent) por stream IPTV indexadas por HOSTNAME
ipcMain.handle('set-stream-headers', (_e, { url, referrer, userAgent }) => {
  if (url) registerStreamHeaders(url, { referrer, userAgent });
  return true;
});

// Inspección del iframe embed (detección de Cloudflare, contenido no disponible y lectura de tiempo de video)
ipcMain.handle('get-embed-status', async () => {
  if (!mainWindow) return null;
  try {
    const root = mainWindow.webContents.mainFrame;
    const frames = root.framesInSubtree.filter((f) => f !== root);
    if (!frames.length) return { ok: false, reason: 'no-frame' };

    let contentUnavailable = false;
    let cf = false;
    let mainTitle = '';
    const lastFrame = frames[frames.length - 1];

    for (const frame of frames) {
      try {
        const frameTitle = await frame.executeJavaScript('document.title || ""', false);
        const frameText = await frame.executeJavaScript('document.body ? (document.body.innerText || "").slice(0, 2000) : ""', false);
        const lower = `${frameTitle} ${frameText}`.toLowerCase();
        if (
          lower.includes('contenido no disponible') ||
          lower.includes('no disponible') ||
          lower.includes('video not found') ||
          lower.includes('file not found') ||
          lower.includes('stream not found') ||
          lower.includes('file was deleted') ||
          lower.includes('media is not available') ||
          lower.includes('no source available') ||
          lower.includes('404 not found') ||
          lower.includes('error 404') ||
          lower.includes('404 error')
        ) {
          contentUnavailable = true;
        }
        if (/just a moment|attention required|checking your browser|verify|cloudflare/i.test(frameTitle)) {
          cf = true;
        }
        if (frameTitle && !mainTitle) mainTitle = frameTitle;
      } catch (_) {
        // frame cross-origin or navigating
      }
    }

    let currentTime = null;
    let duration = null;
    for (const frame of root.framesInSubtree) {
      try {
        const mediaInfo = await frame.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            if (v && !isNaN(v.duration) && v.duration > 0) {
              return { currentTime: Math.round(v.currentTime), duration: Math.round(v.duration) };
            }
            return null;
          })()
        `, false);
        if (mediaInfo) {
          currentTime = mediaInfo.currentTime;
          duration = mediaInfo.duration;
          break;
        }
      } catch (_) {}
    }

    return { ok: true, title: mainTitle, cloudflare: cf, contentUnavailable, src: lastFrame.url, currentTime, duration };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
});

// Abrir transmisión en navegador externo limpio
ipcMain.handle('open-external', (_event, url) => {
  if (url && typeof url === 'string') {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// Traer ventana principal al frente (cuando llega orden del celular)
ipcMain.handle('focus-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  }
  return false;
});

// Ejecutar código JS en el contexto de la ventana
ipcMain.handle('execute-js', async (_event, code) => {
  if (!mainWindow) return null;
  try {
    return await mainWindow.webContents.executeJavaScript(code);
  } catch (_) {
    return null;
  }
});

// Retornar la IP LAN real de la PC
ipcMain.handle('get-local-ip', () => {
  return getLocalIpAddress();
});

// Limpiar sesión de partición persistente (Spotify / YouTube)
ipcMain.handle('clear-partition-session', async (_event, partition) => {
  if (!partition || typeof partition !== 'string') return false;
  try {
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
    console.log(`[Session] Partición ${partition} limpiada por completo.`);
    return true;
  } catch (err) {
    console.warn(`[Session] Error al limpiar partición ${partition}:`, err);
    return false;
  }
});

// TAREA 2 & D: Control IPC de Modo Diagnóstico
ipcMain.handle('set-diagnostic-mode', (_event, enabled) => {
  isDiagnosticMode = Boolean(enabled);
  printDiagLog();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isDiagnosticMode) {
      mainWindow.webContents.setUserAgent('');
    } else {
      mainWindow.webContents.setUserAgent(REAL_CHROME_USER_AGENT);
    }
    mainWindow.webContents.send('diagnostic-mode-changed', isDiagnosticMode);
  }
  return isDiagnosticMode;
});

ipcMain.handle('get-diagnostic-mode', () => {
  return isDiagnosticMode;
});

ipcMain.handle('set-no-cors-fix', (_event, enabled) => {
  isNoCorsFix = Boolean(enabled);
  printDiagLog();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('no-cors-fix-changed', isNoCorsFix);
  }
  return isNoCorsFix;
});

ipcMain.handle('get-no-cors-fix', () => {
  return isNoCorsFix;
});

// Ciclo de vida de la aplicación
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  // 0. userData debe ser escribible (cache/quota/cookies viven ahí)
  try {
    const ud = app.getPath('userData');
    fs.mkdirSync(ud, { recursive: true });
    const probe = path.join(ud, '.write-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    console.log(`[userData] OK escribible: ${ud}`);
  } catch (err) {
    console.error(`[userData] NO ESCRIBIBLE: ${app.getPath('userData')} -> ${err.message}`);
  }

  // 1. Levantar servidor embebido HTTP + WebSocket en 0.0.0.0:3000
  startEmbeddedServer();

  // 2. DNS-over-HTTPS: salta filtros DNS locales (Pi-hole, ISP, etc.)
  try {
    app.configureHostResolver({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'],
    });
  } catch (err) {
    console.warn('[DoH] configureHostResolver falló:', err);
  }

  // 3. Crear ventana principal
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (embeddedHttpServer) {
    try {
      embeddedHttpServer.close();
    } catch (_) {}
  }
});
