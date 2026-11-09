const { app, BrowserWindow, session, ipcMain, shell, webContents, protocol, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('node:crypto');

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

function extractTmdbId(val) {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return String(val);
  const str = String(val || '').trim();
  const tmdbMatch = str.match(/tmdb-(?:series|movie|anime)-(\d+)/i);
  if (tmdbMatch) return tmdbMatch[1];
  const segMatch = str.match(/(?:movie|series|anime|tv)[-_](\d+)/i);
  if (segMatch) return segMatch[1];
  const exactDigits = str.match(/^(\d+)$/);
  if (exactDigits) return exactDigits[1];
  const wordDigits = str.match(/\b\d{3,8}\b/);
  if (wordDigits) return wordDigits[0];
  const anyDigits = str.match(/\d+/);
  return anyDigits ? anyDigits[0] : '';
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
app.commandLine.appendSwitch('ignore-certificate-errors');
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

function isVirtualOrIgnored(name) {
  const lower = (name || '').toLowerCase();
  return /virtual|vmware|vbox|wsl|hyper-v|vethernet|tap|tun|tailscale|zerotier|loopback|docker|npcap|pseudo|teredo|radmin|hamachi|wireguard/i.test(lower);
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const validCandidates = [];

  for (const name of Object.keys(interfaces)) {
    if (isVirtualOrIgnored(name)) continue;
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const alias of ifaceList) {
      if (
        alias.family === 'IPv4' &&
        !alias.internal &&
        alias.address !== '127.0.0.1' &&
        !alias.address.startsWith('169.254.') &&
        !alias.address.startsWith('0.')
      ) {
        validCandidates.push({ name, address: alias.address });
      }
    }
  }

  // 1. Priorizar 192.168.x.x (WiFi / Ethernet residencial típico)
  const homeWifi = validCandidates.find((c) => c.address.startsWith('192.168.'));
  if (homeWifi) return homeWifi.address;

  // 2. Clase A 10.x.x.x
  const classA = validCandidates.find((c) => c.address.startsWith('10.'));
  if (classA) return classA.address;

  // 3. Clase B 172.16.x.x - 172.31.x.x
  const classB = validCandidates.find((c) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(c.address));
  if (classB) return classB.address;

  // 4. Cualquier otro candidato válido no virtual
  if (validCandidates.length > 0) return validCandidates[0].address;

  // 5. Fallback si solo hubieran adaptadores virtuales
  const fallbackCandidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const alias of interfaces[name] || []) {
      if (
        alias.family === 'IPv4' &&
        !alias.internal &&
        alias.address !== '127.0.0.1' &&
        !alias.address.startsWith('169.254.')
      ) {
        fallbackCandidates.push(alias.address);
      }
    }
  }
  const fallbackHome = fallbackCandidates.find((ip) => ip.startsWith('192.168.'));
  if (fallbackHome) return fallbackHome;
  if (fallbackCandidates[0]) return fallbackCandidates[0];

  return '';
}

// =========================================================================
// SERVIDOR HTTP + WEBSOCKET EMBEBIDO PARA CONTROL REMOTO LAN
// =========================================================================
let embeddedHttpServer = null;
let embeddedWss = null;

const rooms = new Map();
const globalDevices = new Map();
const roomPlaybackStates = new Map();
let globalLatestPlaybackState = null;
let globalStateSeq = 0;
let commandSeqCounter = 0;
const commandHistory = [];
const seenCommandIds = new Set();
let latestRemoteJoinEvent = null;

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

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

function getAllActiveDevicesList() {
  const now = Date.now();
  const active = [];
  globalDevices.forEach((client, id) => {
    const wsOpen = client.ws && client.ws.readyState === 1; // 1 = OPEN
    if (!wsOpen && now - client.lastSeen > 45000) {
      globalDevices.delete(id);
      const r = rooms.get(client.roomId);
      r?.delete(id);
      return;
    }
    active.push({
      id: client.deviceId,
      name: client.deviceName,
      type: client.deviceType,
      lastSeen: client.lastSeen,
      roomId: client.roomId,
    });
  });
  return active;
}

function broadcastRoomDevices(roomId) {
  const deviceList = getAllActiveDevicesList();
  const payload = JSON.stringify({
    type: 'device_list',
    roomId,
    devices: deviceList,
  });
  globalDevices.forEach((client) => {
    if (client.ws && client.ws.readyState === 1) {
      try { client.ws.send(payload); } catch (_) {}
    }
  });
}

function recordAndBroadcastCommand(roomId, fromDevice, command, targetDeviceId, msgId) {
  const uniqueId = msgId || `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  if (seenCommandIds.has(uniqueId)) return;
  seenCommandIds.add(uniqueId);
  if (seenCommandIds.size > 500) {
    const first = seenCommandIds.values().next().value;
    if (first) seenCommandIds.delete(first);
  }

  commandSeqCounter += 1;
  const queued = {
    seq: commandSeqCounter,
    id: uniqueId,
    roomId,
    fromDevice,
    targetDeviceId,
    command,
    timestamp: Date.now(),
  };
  commandHistory.push(queued);
  if (commandHistory.length > 100) commandHistory.shift();

  const forwardPayload = JSON.stringify({
    type: 'command',
    id: uniqueId,
    seq: commandSeqCounter,
    fromDevice,
    command,
  });

  globalDevices.forEach((client) => {
    if (client.deviceId !== fromDevice && client.ws && client.ws.readyState === 1) {
      try { client.ws.send(forwardPayload); } catch (_) {}
    }
  });
}

function recordAndBroadcastState(roomId, fromDevice, state) {
  roomPlaybackStates.set(roomId, state);
  globalLatestPlaybackState = state;
  globalStateSeq += 1;

  const statePayload = JSON.stringify({
    type: 'sync_state',
    fromDevice,
    state,
    stateSeq: globalStateSeq,
  });

  globalDevices.forEach((client) => {
    if (client.deviceId !== fromDevice && client.ws && client.ws.readyState === 1) {
      try { client.ws.send(statePayload); } catch (_) {}
    }
  });
}

function startEmbeddedServer() {
  try {
    const express = require('express');
    const http = require('http');
    const { WebSocketServer } = require('ws');

    const appExpress = express();
    const server = http.createServer(appExpress);
    const PORT = 3000;

    appExpress.use(express.json());

    // CORS Headers para permitir conexiones remotas desde cualquier origen LAN
    appExpress.use((req, res, next) => {
      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    const distPath = path.join(__dirname, '..', 'dist');

    // Servir carpeta dist de forma estática
    appExpress.use(express.static(distPath));

    appExpress.get('/api/health', (_req, res) => {
      res.json({
        status: 'ok',
        embedded: true,
        roomsCount: rooms.size,
        devicesCount: globalDevices.size,
        commandSeq: commandSeqCounter,
        timestamp: new Date().toISOString(),
      });
    });

    appExpress.get('/api/local-ip', (_req, res) => {
      const localIp = getLocalIpAddress();
      res.json({
        ip: localIp,
        port: PORT,
        url: localIp ? `http://${localIp}:${PORT}` : `http://localhost:${PORT}`,
      });
    });

    // =========================================================================
    // CATÁLOGO COMPACTO Y PROXY DE POSTERS (FUENTE ÚNICA PARA PC Y CELULAR)
    // =========================================================================
    let serverCatalogCache = null;

    function loadServerCatalog() {
      if (serverCatalogCache && serverCatalogCache.length > 0) {
        return serverCatalogCache;
      }
      const candidates = [
        path.join(__dirname, '..', 'public', 'data', 'catalog.json'),
        path.join(__dirname, '..', 'dist', 'data', 'catalog.json'),
        path.join(process.cwd(), 'public', 'data', 'catalog.json'),
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              serverCatalogCache = parsed.map((m) => {
                const isTV = m.category === 'series' || m.category === 'anime' || m.type === 'series';
                const tmdbId = Number(m.tmdbId || extractTmdbId(m.id) || 0);
                const poster = m.posterUrl || m.posterPath || '';
                const backdrop = m.backdropUrl || m.backdropPath || poster;
                const rating = Number((m.rating ?? m.voteAverage ?? 7.5).toFixed(1));
                const origLang = m.originalLanguage || (m.category === 'anime' ? 'ja' : 'es');
                return {
                  id: m.id || `tmdb-${m.category || (isTV ? 'series' : 'movie')}-${tmdbId}`,
                  tmdbId,
                  title: m.title || 'Sin Título',
                  originalTitle: m.originalTitle || m.title || 'Sin Título',
                  originalLanguage: origLang,
                  spokenLanguages: m.spokenLanguages || (origLang === 'es' ? ['es'] : ['es', origLang]),
                  overview: m.overview || '',
                  posterPath: poster,
                  posterUrl: poster,
                  backdropPath: backdrop,
                  backdropUrl: backdrop,
                  releaseDate: m.releaseDate || '2024-01-01',
                  year: m.year || (m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) || 2024 : 2024),
                  genres: Array.isArray(m.genres) ? m.genres.slice(0, 3) : ['Película'],
                  voteAverage: rating,
                  rating,
                  streamUrl: m.streamUrl || '',
                  streamType: m.streamType || 'iframe',
                  quality: m.quality || (rating > 8.0 ? '4K Ultra HD' : '1080p'),
                  source: m.source || 'tmdb',
                  category: m.category || (isTV ? 'series' : 'movie'),
                  type: isTV ? 'series' : 'movie',
                  servers: (m.servers || []).filter(
                    (s) => !s.name?.toLowerCase().includes('embed.su') && !s.url?.includes('embed.su')
                  ),
                };
              });
              console.log(`[Catalog Server] Cargados ${serverCatalogCache.length} títulos compactos en memoria.`);
              return serverCatalogCache;
            }
          }
        } catch (e) {
          console.warn('[Catalog Server] Error al leer catálogo desde', p, e);
        }
      }
      return [];
    }

    appExpress.get('/api/catalog', (req, res) => {
      const catalog = loadServerCatalog();
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit || '40', 10) || 40));
      const q = (req.query.q || '').trim().toLowerCase();
      const category = (req.query.category || '').trim().toLowerCase();
      const onlySpanish = req.query.onlySpanish === 'true' || req.query.es === 'true';

      let filtered = catalog;
      if (category && category !== 'all') {
        filtered = filtered.filter((m) => {
          const cat = (m.category || m.type || '').toLowerCase();
          if (category === 'movies' || category === 'movie') return cat === 'movie';
          if (category === 'series' || category === 'tv') return cat === 'series';
          if (category === 'anime') return cat === 'anime';
          return cat === category;
        });
      }

      if (onlySpanish) {
        filtered = filtered.filter((m) => m.originalLanguage === 'es');
      }

      if (q) {
        filtered = filtered.filter((m) => {
          return (m.title && m.title.toLowerCase().includes(q)) ||
                 (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
                 (m.overview && m.overview.toLowerCase().includes(q));
        });
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      const items = filtered.slice(offset, offset + limit);

      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json({
        page,
        limit,
        total,
        totalPages,
        items,
      });
    });

    const posterCacheDir = path.join(app.getPath('userData'), 'poster_cache');
    try { fs.mkdirSync(posterCacheDir, { recursive: true }); } catch (_) {}

    appExpress.get('/api/poster', async (req, res) => {
      let targetUrl = req.query.url || '';
      const tmdbPath = req.query.path || '';
      if (!targetUrl && tmdbPath) {
        targetUrl = `https://image.tmdb.org/t/p/w200${tmdbPath.startsWith('/') ? '' : '/'}${tmdbPath}`;
      }
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
        return res.status(400).send('Parámetro url inválido');
      }

      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      const cacheFile = path.join(posterCacheDir, `${hash}.jpg`);

      if (fs.existsSync(cacheFile)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return fs.createReadStream(cacheFile).pipe(res);
      }

      try {
        const upstream = await fetch(targetUrl, {
          headers: { 'User-Agent': REAL_CHROME_USER_AGENT },
          signal: AbortSignal.timeout(8000),
        });
        if (!upstream.ok) {
          return res.redirect(targetUrl);
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        fs.writeFile(cacheFile, buffer, () => {});
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.send(buffer);
      } catch (_) {
        res.redirect(targetUrl);
      }
    });

    // =========================================================================
    // FICHA DE DETALLE COMPLETA, SAGA, TEMPORADAS Y RECOMENDACIONES (TMDB)
    // =========================================================================
    const mediaCacheDir = path.join(app.getPath('userData'), 'media_cache');
    try { fs.mkdirSync(mediaCacheDir, { recursive: true }); } catch (_) {}

    const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
    const TMDB_URL = 'https://api.themoviedb.org/3';

    appExpress.get('/api/media/:type/:id', async (req, res) => {
      const { type, id } = req.params;
      const cleanType = type === 'series' || type === 'anime' || type === 'tv' ? 'tv' : 'movie';
      const tmdbId = extractTmdbId(id);
      if (!tmdbId) return res.status(400).json({ error: 'ID inválido' });

      const cacheFile = path.join(mediaCacheDir, `${cleanType}_${tmdbId}.json`);
      if (fs.existsSync(cacheFile)) {
        try {
          const stats = fs.statSync(cacheFile);
          if (Date.now() - stats.mtimeMs < 86400000 * 7) { // 7 días de caché en disco
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            return res.json(cached);
          }
        } catch (_) {}
      }

      try {
        const detailUrl = `${TMDB_URL}/${cleanType}/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX&append_to_response=credits,videos,recommendations`;
        const tmdbRes = await fetch(detailUrl, { signal: AbortSignal.timeout(7000) });
        if (!tmdbRes.ok) {
          // Fallback al catálogo local
          const cat = loadServerCatalog().find((m) => String(m.tmdbId) === tmdbId || m.id === id);
          if (cat) return res.json(cat);
          return res.status(404).json({ error: 'Título no encontrado en TMDB' });
        }

        const d = await tmdbRes.json();
        const title = d.title || d.name || 'Sin Título';
        const origTitle = d.original_title || d.original_name || title;
        const releaseDate = d.release_date || d.first_air_date || '';
        const year = parseInt(releaseDate.slice(0, 4), 10) || 2024;
        const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.name) : ['Cine'];
        const rating = Number((d.vote_average || 7.5).toFixed(1));
        const posterUrl = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '';
        const backdropUrl = d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : posterUrl;
        const director = d.credits?.crew?.find((c) => c.job === 'Director')?.name || d.created_by?.[0]?.name || '';
        const cast = (d.credits?.cast || []).slice(0, 10).map((c) => ({
          name: c.name,
          character: c.character || '',
          photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
        }));

        // Tráiler en YouTube (prioriza idioma español o general)
        const videos = d.videos?.results || [];
        const trailer = videos.find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) || videos[0];
        const trailerKey = trailer?.key || null;

        // Saga / Colección si pertenece a una (ej: Avengers, Harry Potter, Spider-Man)
        let collection = null;
        if (d.belongs_to_collection && d.belongs_to_collection.id) {
          try {
            const collRes = await fetch(`${TMDB_URL}/collection/${d.belongs_to_collection.id}?api_key=${TMDB_KEY}&language=es-MX`);
            if (collRes.ok) {
              const collData = await collRes.json();
              collection = {
                id: collData.id,
                name: collData.name,
                posterUrl: collData.poster_path ? `https://image.tmdb.org/t/p/w500${collData.poster_path}` : null,
                parts: (collData.parts || []).map((p) => ({
                  id: `tmdb-movie-${p.id}`,
                  tmdbId: p.id,
                  title: p.title || p.original_title,
                  posterUrl: p.poster_path ? `https://image.tmdb.org/t/p/w300${p.poster_path}` : null,
                  backdropUrl: p.backdrop_path ? `https://image.tmdb.org/t/p/w780${p.backdrop_path}` : null,
                  year: p.release_date ? parseInt(p.release_date.slice(0, 4), 10) || 2024 : 2024,
                  voteAverage: Number((p.vote_average || 7.0).toFixed(1)),
                })),
              };
            }
          } catch (_) {}
        }

        // TAREA 4: Recomendaciones inteligentes (filtro >= 6.0, género/década, 6 a 20 items)
        const primaryGenre = genres[0] || 'Cine';
        const decade = Math.floor(year / 10);
        const collectionIds = new Set(collection?.parts ? collection.parts.map((p) => p.tmdbId) : []);
        collectionIds.add(Number(tmdbId));

        const rawRecs = (d.recommendations?.results || []).filter(
          (r) => r.vote_average >= 6.0 && !collectionIds.has(r.id)
        );

        const tmdbRecs = rawRecs.slice(0, 12).map((r) => ({
          id: `tmdb-${cleanType === 'tv' ? 'series' : 'movie'}-${r.id}`,
          tmdbId: r.id,
          title: r.title || r.name || 'Sin Título',
          posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
          year: r.release_date || r.first_air_date ? parseInt((r.release_date || r.first_air_date).slice(0, 4), 10) : year,
          voteAverage: Number((r.vote_average || 7.0).toFixed(1)),
          category: cleanType === 'tv' ? 'series' : 'movie',
        }));

        // Mezcla con catálogo local del mismo género y década
        const localCatalog = loadServerCatalog();
        const catalogMatching = localCatalog.filter((m) => {
          if (collectionIds.has(m.tmdbId)) return false;
          const sameDecade = Math.floor((m.year || 2024) / 10) === decade;
          const sameGenre = m.genres?.some((g) => g.toLowerCase() === primaryGenre.toLowerCase());
          return sameGenre && sameDecade;
        }).slice(0, 8);

        const combinedMap = new Map();
        for (const item of tmdbRecs) combinedMap.set(item.tmdbId, item);
        for (const item of catalogMatching) {
          if (!combinedMap.has(item.tmdbId)) {
            combinedMap.set(item.tmdbId, {
              id: item.id,
              tmdbId: item.tmdbId,
              title: item.title,
              posterUrl: item.posterUrl,
              year: item.year,
              voteAverage: item.voteAverage,
              category: item.category,
            });
          }
        }

        const recommendations = Array.from(combinedMap.values()).slice(0, 18);

        // Temporadas (si es serie o anime)
        const seasons = cleanType === 'tv'
          ? (d.seasons || [])
              .filter((s) => s.season_number > 0)
              .map((s) => ({
                seasonNumber: s.season_number,
                name: s.name || `Temporada ${s.season_number}`,
                episodeCount: s.episode_count || 10,
                posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
              }))
          : [];

        const payload = {
          id: `tmdb-${type}-${tmdbId}`,
          tmdbId: Number(tmdbId),
          title,
          originalTitle: origTitle,
          overview: d.overview || 'Sinopsis no disponible en español.',
          releaseDate,
          year,
          genres,
          voteAverage: rating,
          runtime: d.runtime || (d.episode_run_time ? d.episode_run_time[0] : 110),
          posterUrl,
          backdropUrl,
          director,
          cast,
          trailerKey,
          collection,
          recommendations,
          seasons,
          category: type,
          type: cleanType === 'tv' ? 'series' : 'movie',
        };

        fs.writeFile(cacheFile, JSON.stringify(payload), () => {});
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(payload);
      } catch (err) {
        console.warn('[Media Detail] Error al consultar TMDB:', err.message);
        const cat = loadServerCatalog().find((m) => String(m.tmdbId) === tmdbId || m.id === id);
        if (cat) return res.json(cat);
        res.status(500).json({ error: 'Error al obtener detalle del título' });
      }
    });

    // Listado de episodios por temporada (con caché en disco)
    appExpress.get('/api/tv/:id/season/:seasonNumber', async (req, res) => {
      const tmdbId = extractTmdbId(req.params.id);
      const sNum = parseInt(req.params.seasonNumber, 10) || 1;
      const cacheFile = path.join(mediaCacheDir, `tv_${tmdbId}_season_${sNum}.json`);

      if (fs.existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          return res.json(cached);
        } catch (_) {}
      }

      try {
        const url = `${TMDB_URL}/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_KEY}&language=es-MX`;
        const epRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!epRes.ok) return res.status(404).json({ error: 'Temporada no encontrada' });

        const data = await epRes.json();
        const episodes = (data.episodes || []).map((e) => ({
          id: e.id,
          season: e.season_number,
          episode: e.episode_number,
          title: e.name || `Episodio ${e.episode_number}`,
          overview: e.overview || '',
          duration: e.runtime ? `${e.runtime}m` : '24m',
          stillUrl: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null,
          voteAverage: Number((e.vote_average || 7.0).toFixed(1)),
        }));

        const result = { seasonNumber: sNum, episodes };
        fs.writeFile(cacheFile, JSON.stringify(result), () => {});
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Detalle de serie y temporadas reales (con caché en disco)
    appExpress.get('/api/tv/:id', async (req, res) => {
      const tmdbId = extractTmdbId(req.params.id);
      if (!tmdbId) return res.status(400).json({ error: 'ID inválido' });

      const cacheFile = path.join(mediaCacheDir, `tv_${tmdbId}_overview.json`);
      if (fs.existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          return res.json(cached);
        } catch (_) {}
      }

      try {
        const url = `${TMDB_URL}/tv/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX`;
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return res.status(404).json({ error: 'Serie no encontrada en TMDB' });

        const d = await r.json();
        const seasons = (d.seasons || [])
          .filter((s) => s.season_number > 0)
          .map((s) => ({
            seasonNumber: s.season_number,
            name: s.name || `Temporada ${s.season_number}`,
            episodeCount: s.episode_count || 10,
            posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
          }));

        const result = {
          id: Number(tmdbId),
          tmdbId: Number(tmdbId),
          title: d.name || d.original_name || 'Serie',
          numberOfSeasons: seasons.length,
          totalSeasons: seasons.length,
          numberOfEpisodes: d.number_of_episodes || 0,
          totalEpisodes: d.number_of_episodes || 0,
          seasons,
        };

        fs.writeFile(cacheFile, JSON.stringify(result), () => {});
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // =========================================================================
    // =========================================================================
    // HISTORIAL SINCRONIZADO CENTRAL EN DISCO (PC <-> MÓVIL)
    // =========================================================================
    function getWatchHistoryFilePath() {
      const candidates = [
        path.join(__dirname, '..', 'public', 'data'),
        path.join(process.cwd(), 'public', 'data'),
        path.join(__dirname, '..', 'dist', 'data'),
      ];
      for (const d of candidates) {
        try {
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
          return path.join(d, 'watch_history.json');
        } catch (_) {}
      }
      return path.join(app.getPath('userData'), 'watch_history.json');
    }

    function loadWatchHistoryFromDisk() {
      try {
        const fp = getWatchHistoryFilePath();
        if (fs.existsSync(fp)) {
          const raw = fs.readFileSync(fp, 'utf8');
          return JSON.parse(raw);
        }
      } catch (_) {}
      return [];
    }

    function saveWatchHistoryToDisk(items) {
      try {
        const fp = getWatchHistoryFilePath();
        fs.writeFileSync(fp, JSON.stringify((items || []).slice(0, 50)), 'utf8');
        return true;
      } catch (_) {
        return false;
      }
    }

    appExpress.get('/api/watch-history', (_req, res) => {
      res.json({ items: loadWatchHistoryFromDisk() });
    });

    appExpress.get('/api/diagnostic-mode', (req, res) => {
      let changed = false;
      if (req.query.enabled !== undefined) {
        isDiagnosticMode = req.query.enabled === 'true';
        changed = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.setUserAgent(isDiagnosticMode ? '' : REAL_CHROME_USER_AGENT);
          mainWindow.webContents.send('diagnostic-mode-changed', isDiagnosticMode);
        }
      }
      if (req.query.noCorsFix !== undefined) {
        isNoCorsFix = req.query.noCorsFix === 'true';
        changed = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('no-cors-fix-changed', isNoCorsFix);
        }
      }
      if (changed) printDiagLog();
      res.json({ diagnosticMode: isDiagnosticMode, noCorsFix: isNoCorsFix });
    });

    appExpress.post('/api/diagnostic-mode', (req, res) => {
      let changed = false;
      if (req.body?.enabled !== undefined) {
        isDiagnosticMode = Boolean(req.body.enabled);
        changed = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.setUserAgent(isDiagnosticMode ? '' : REAL_CHROME_USER_AGENT);
          mainWindow.webContents.send('diagnostic-mode-changed', isDiagnosticMode);
        }
      }
      if (req.body?.noCorsFix !== undefined) {
        isNoCorsFix = Boolean(req.body.noCorsFix);
        changed = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('no-cors-fix-changed', isNoCorsFix);
        }
      }
      if (changed) printDiagLog();
      res.json({ diagnosticMode: isDiagnosticMode, noCorsFix: isNoCorsFix });
    });

    appExpress.post('/api/watch-history', (req, res) => {
      const incoming = req.body?.items || (req.body ? [req.body] : []);
      if (!Array.isArray(incoming) || incoming.length === 0) {
        return res.json({ ok: false });
      }

      const current = loadWatchHistoryFromDisk();
      const map = new Map();
      for (const it of current) {
        if (it && it.id) map.set(it.id, it);
      }
      for (const it of incoming) {
        if (!it || !it.id) continue;
        const existing = map.get(it.id);
        if (!existing || (it.lastWatchedAt || 0) >= (existing.lastWatchedAt || 0)) {
          map.set(it.id, it);
        }
      }

      const merged = Array.from(map.values())
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
        .slice(0, 50);

      saveWatchHistoryToDisk(merged);

      // Broadcast WebSocket a todos los dispositivos conectados
      const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: merged });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === 1) {
          try { client.ws.send(wsMsg); } catch (_) {}
        }
      });

      // Notificar a la app de escritorio Electron si existe
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watchHistoryUpdated', merged);
      }

      res.json({ ok: true, items: merged });
    });

    // =========================================================================
    // MOTOR DE BÚSQUEDA ROBUSTO (NORMALIZACIÓN + DEDUPLICACIÓN + RANKING)
    // =========================================================================
    function normalizeSearch(str) {
      if (!str || typeof str !== 'string') return '';
      return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }

    const hasCJK = (str) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(str || '');

    function rankAndDeduplicateItems(rawItems, query, originalQuery = '') {
      const qNorm = (query || '').trim().toLowerCase();
      const origNorm = (originalQuery || '').trim().toLowerCase();
      const qIsLatin = !hasCJK(qNorm) && !hasCJK(origNorm);

      const byTmdbId = new Map();

      for (const item of rawItems) {
        const cat = item.category || item.type || (item.mediaType === 'tv' ? 'series' : 'movie');
        const idKey = item.tmdbId ? `tmdb-${cat}-${item.tmdbId}` : (item.id || '');
        if (!idKey) continue;

        const existing = byTmdbId.get(idKey);
        if (!existing) {
          byTmdbId.set(idKey, item);
        } else {
          // Si hay colisión entre idiomas/alfabetos, preferir título latino frente a CJK
          const existingHasCJK = hasCJK(existing.title);
          const newHasCJK = hasCJK(item.title);
          if (existingHasCJK && !newHasCJK) {
            byTmdbId.set(idKey, {
              ...item,
              servers: (existing.servers && existing.servers.length > (item.servers?.length || 0))
                ? existing.servers
                : item.servers,
            });
          }
        }
      }

      const items = Array.from(byTmdbId.values());

      return items
        .map((item) => {
          let score = 0;
          const t = (item.title || '').trim().toLowerCase();
          const ot = (item.originalTitle || '').trim().toLowerCase();

          // 1. Coincidencia exacta (+1000)
          if (t === qNorm || (origNorm && t === origNorm) || ot === qNorm) {
            score += 1000;
          } else if (t.startsWith(qNorm) || (origNorm && t.startsWith(origNorm))) {
            // 2. Prefijo (+500)
            score += 500;
          } else if (t.includes(qNorm) || (origNorm && t.includes(origNorm)) || ot.includes(qNorm)) {
            // 3. Contiene (+200)
            score += 200;
          }

          // Si la query es latina, penalizar fuerte títulos 100% CJK (-400)
          if (qIsLatin && hasCJK(item.title)) {
            score -= 400;
          }

          // Desempate por valoración/popularidad
          score += (Number(item.voteAverage) || 7.0) * 5;

          return { ...item, _searchScore: score };
        })
        .sort((a, b) => b._searchScore - a._searchScore)
        .map(({ _searchScore, ...item }) => item);
    }

    async function getTypoSuggestion(query) {
      try {
        const u = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
        const r = await fetch(u, {
          headers: { 'User-Agent': REAL_CHROME_USER_AGENT },
          signal: AbortSignal.timeout(2500),
        });
        if (!r.ok) return null;
        const json = await r.json();
        const suggestions = Array.isArray(json?.[1]) ? json[1] : [];
        if (suggestions.length > 0) {
          const first = suggestions[0];
          if (typeof first === 'string' && normalizeSearch(first) !== normalizeSearch(query)) {
            return first;
          }
        }
      } catch (_) {}
      return null;
    }

    appExpress.get('/api/search', async (req, res) => {
      const rawQ = (req.query.q || '').trim();
      if (!rawQ || rawQ.length < 2) {
        return res.json({ query: rawQ, total: 0, items: [] });
      }

      const qNorm = normalizeSearch(rawQ);
      const catalog = loadServerCatalog();

      // 1. Búsqueda en catálogo local normalizada
      const localMatches = catalog.filter((m) => {
        const t = normalizeSearch(m.title);
        const ot = normalizeSearch(m.originalTitle);
        const ov = normalizeSearch(m.overview);
        return t.includes(qNorm) || ot.includes(qNorm) || ov.includes(qNorm);
      }).slice(0, 20);

      let corrected = await getTypoSuggestion(rawQ);
      const searchTerms = [rawQ];
      if (corrected && normalizeSearch(corrected) !== qNorm) {
        searchTerms.push(corrected);
      }

      const tmdbRawItems = [];

      for (const term of searchTerms) {
        try {
          const endpoints = [
            `${TMDB_URL}/search/multi?api_key=${TMDB_KEY}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
            `${TMDB_URL}/search/tv?api_key=${TMDB_KEY}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
            `${TMDB_URL}/search/movie?api_key=${TMDB_KEY}&language=es-MX&query=${encodeURIComponent(term)}&include_adult=false`,
          ];

          const responses = await Promise.allSettled(
            endpoints.map((ep) => fetch(ep, { signal: AbortSignal.timeout(4500) }).then((r) => r.json()))
          );

          for (const resp of responses) {
            if (resp.status !== 'fulfilled' || !Array.isArray(resp.value?.results)) continue;
            for (const item of resp.value.results) {
              if (!item.id) continue;
              const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
              if (mediaType !== 'movie' && mediaType !== 'tv') continue;
              const isTV = mediaType === 'tv';
              const rating = Number((item.vote_average || 7.0).toFixed(1));
              const title = item.title || item.name || 'Sin Título';
              const releaseDate = item.release_date || item.first_air_date || '';
              const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) || 2024 : 2024;
              const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
              const backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : poster;

              const vidsrcCcUrl = isTV
                ? `https://vidsrc.cc/embed/tv/${item.id}/1-1?lang=es`
                : `https://vidsrc.cc/embed/movie/${item.id}?lang=es`;
              const api4allUrl = isTV
                ? `https://api4all.net/embed/tv/${item.id}/1/1?lang=es`
                : `https://api4all.net/embed/movie/${item.id}?lang=es`;
              const vidsrcProUrl = isTV
                ? `https://vidsrc.pro/embed/tv/${item.id}/1/1?lang=es`
                : `https://vidsrc.pro/embed/movie/${item.id}?lang=es`;
              const tukiUrl = isTV
                ? `https://tukiplay.com/embed/tv/${item.id}/1/1`
                : `https://tukiplay.com/embed/movie/${item.id}`;
              const videasyUrl = isTV
                ? `https://player.videasy.net/tv/${item.id}/1/1`
                : `https://player.videasy.net/movie/${item.id}`;

              tmdbRawItems.push({
                id: `tmdb-${isTV ? 'series' : 'movie'}-${item.id}`,
                tmdbId: Number(item.id),
                title,
                originalTitle: item.original_title || item.original_name || title,
                originalLanguage: item.original_language || 'es',
                spokenLanguages: ['es'],
                overview: item.overview || 'Sin descripción disponible.',
                posterPath: poster,
                posterUrl: poster,
                backdropPath: backdrop,
                backdropUrl: backdrop,
                releaseDate,
                year,
                genres: ['Cine & TV'],
                voteAverage: rating,
                rating,
                quality: rating > 7.5 ? '4K Ultra HD' : '1080p HD',
                source: 'tmdb',
                category: isTV ? 'series' : 'movie',
                type: isTV ? 'series' : 'movie',
                mediaType: isTV ? 'tv' : 'movie',
                notInCatalog: true,
                servers: [
                  { name: 'Vidsrc CC (Latino / ES)', url: vidsrcCcUrl, type: 'iframe', language: '🇲🇽 Latino / Español' },
                  { name: 'Api4all (Multi / ES)', url: api4allUrl, type: 'iframe', language: '🌐 Multi / Español' },
                  { name: 'Vidsrc Pro (HD / ES)', url: vidsrcProUrl, type: 'iframe', language: '🌐 Multi / Sub ES' },
                  { name: 'TukiPlay (HD)', url: tukiUrl, type: 'iframe', language: '🇲🇽 Latino' },
                  { name: 'VidEasy (Multi)', url: videasyUrl, type: 'iframe', language: '🌐 Multi / Original' },
                ],
              });
            }
          }
        } catch (_) {}
      }

      // Deduplicar respetando idioma latino y aplicar scoring estricto
      const combinedRaw = [...localMatches, ...tmdbRawItems];
      const ranked = rankAndDeduplicateItems(combinedRaw, rawQ, corrected || '');
      const itemsSlice = ranked.slice(0, 30);

      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json({
        query: rawQ,
        correctedQuery: corrected,
        total: ranked.length,
        items: itemsSlice,
        results: itemsSlice,
      });
    });

    // =========================================================================
    // PARTIDOS DE FÚTBOL EN VIVO Y PRÓXIMOS 7 DÍAS (ESPN SCOREBOARDS + MAPEO)
    // =========================================================================
    let sportsMatchesCache = null;
    let sportsMatchesCacheTime = 0;

    appExpress.get('/api/sports/matches', async (req, res) => {
      const now = Date.now();
      if (sportsMatchesCache && now - sportsMatchesCacheTime < 45000) {
        return res.json(sportsMatchesCache);
      }

      const leagues = [
        { slug: 'arg.1', name: 'Liga Profesional Argentina', country: 'AR' },
        { slug: 'arg.copa', name: 'Copa Argentina', country: 'AR' },
        { slug: 'conmebol.libertadores', name: 'Copa Libertadores', country: 'CONMEBOL' },
        { slug: 'conmebol.sudamericana', name: 'Copa Sudamericana', country: 'CONMEBOL' },
      ];

      let compChannels = {};
      try {
        const fp = path.join(__dirname, '..', 'data', 'competition-channels.json');
        if (fs.existsSync(fp)) compChannels = JSON.parse(fs.readFileSync(fp, 'utf8'));
      } catch (_) {}

      try {
        const allMatches = [];
        const seenEventIds = new Set();

        await Promise.allSettled(
          leagues.map(async (l) => {
            try {
              const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${l.slug}/scoreboard`;
              const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
              if (!r.ok) return;
              const data = await r.json();
              const events = Array.isArray(data.events) ? data.events : [];

              for (const ev of events) {
                if (!ev.id || seenEventIds.has(ev.id)) continue;
                seenEventIds.add(ev.id);
                const comp = ev.competitions?.[0];
                const home = comp?.competitors?.find((c) => c.homeAway === 'home');
                const away = comp?.competitors?.find((c) => c.homeAway === 'away');
                const statusState = ev.status?.type?.state; // 'pre', 'in', 'post'
                const statusDesc = ev.status?.type?.description || ev.status?.type?.detail || 'Programado';
                const clock = ev.status?.displayClock || '';

                const primaryCh = compChannels[l.slug]?.primaryChannels || ['ESPN', 'Fox Sports', 'TyC Sports'];

                allMatches.push({
                  id: ev.id,
                  name: ev.name,
                  date: ev.date,
                  timestamp: new Date(ev.date).getTime(),
                  league: l.name,
                  leagueSlug: l.slug,
                  isLive: statusState === 'in',
                  isFinished: statusState === 'post',
                  status: statusDesc,
                  clock,
                  channels: primaryCh,
                  homeTeam: {
                    id: home?.team?.id,
                    name: home?.team?.displayName || home?.team?.name || 'Local',
                    shortName: home?.team?.shortDisplayName || home?.team?.abbreviation || 'LOC',
                    logo: home?.team?.logo || null,
                    score: home?.score ?? '-',
                  },
                  awayTeam: {
                    id: away?.team?.id,
                    name: away?.team?.displayName || away?.team?.name || 'Visitante',
                    shortName: away?.team?.shortDisplayName || away?.team?.abbreviation || 'VIS',
                    logo: away?.team?.logo || null,
                    score: away?.score ?? '-',
                  },
                });
              }
            } catch (_) {}
          })
        );

        allMatches.sort((a, b) => {
          if (a.isLive && !b.isLive) return -1;
          if (!a.isLive && b.isLive) return 1;
          return a.timestamp - b.timestamp;
        });

        const result = {
          updatedAt: new Date().toISOString(),
          total: allMatches.length,
          matches: allMatches,
        };

        sportsMatchesCache = result;
        sportsMatchesCacheTime = now;

        res.setHeader('Cache-Control', 'public, max-age=30');
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: String(err), matches: [] });
      }
    });

    appExpress.post('/api/sync/join', (req, res) => {
      const { roomId = 'cine-home-1', deviceId, deviceName, deviceType } = req.body || {};
      if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

      const room = getOrCreateRoom(roomId);
      const existing = globalDevices.get(deviceId);
      const client = {
        ws: existing?.ws,
        roomId,
        deviceId,
        deviceName: deviceName || existing?.deviceName || 'Dispositivo',
        deviceType: deviceType || existing?.deviceType || 'hybrid',
        lastSeen: Date.now(),
      };
      room.set(deviceId, client);
      globalDevices.set(deviceId, client);

      if (deviceType === 'remote') {
        commandSeqCounter += 1;
        latestRemoteJoinEvent = {
          seq: commandSeqCounter,
          deviceId,
          deviceName: client.deviceName,
          timestamp: Date.now(),
        };
        const joinAlert = JSON.stringify({
          type: 'remote_connected',
          fromDevice: deviceId,
          deviceName: client.deviceName,
        });
        globalDevices.forEach((c) => {
          if (c.deviceId !== deviceId && c.ws && c.ws.readyState === 1) {
            try { c.ws.send(joinAlert); } catch (_) {}
          }
        });
      }

      broadcastRoomDevices(roomId);
      res.json({
        ok: true,
        seq: commandSeqCounter,
        devices: getAllActiveDevicesList(),
        state: roomPlaybackStates.get(roomId) || globalLatestPlaybackState,
      });
    });

    appExpress.post('/api/sync/command', (req, res) => {
      const { roomId = 'cine-home-1', fromDevice, targetDeviceId, command, id } = req.body || {};
      if (!command) return res.status(400).json({ error: 'command required' });

      const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
      if (existing) existing.lastSeen = Date.now();

      recordAndBroadcastCommand(roomId, fromDevice || 'remote_http', command, targetDeviceId, id);
      res.json({ ok: true, seq: commandSeqCounter });
    });

    appExpress.post('/api/sync/state', (req, res) => {
      const { roomId = 'cine-home-1', fromDevice, state } = req.body || {};
      if (!state) return res.status(400).json({ error: 'state required' });

      const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
      if (existing) existing.lastSeen = Date.now();

      recordAndBroadcastState(roomId, fromDevice || 'screen_http', state);
      res.json({ ok: true, stateSeq: globalStateSeq });
    });

    appExpress.get('/api/sync/poll', (req, res) => {
      const roomId = req.query.roomId || 'cine-home-1';
      const deviceId = req.query.deviceId || '';
      const deviceName = req.query.deviceName || '';
      const deviceType = req.query.deviceType || 'hybrid';
      const sinceSeq = parseInt(req.query.since || '0', 10) || 0;

      if (deviceId) {
        const existing = globalDevices.get(deviceId);
        if (existing) {
          existing.lastSeen = Date.now();
          if (deviceName) existing.deviceName = deviceName;
          if (deviceType) existing.deviceType = deviceType;
        } else {
          const room = getOrCreateRoom(roomId);
          const client = {
            roomId,
            deviceId,
            deviceName: deviceName || 'Dispositivo',
            deviceType,
            lastSeen: Date.now(),
          };
          room.set(deviceId, client);
          globalDevices.set(deviceId, client);
        }
      }

      const newCommands = commandHistory.filter(
        (c) => c.seq > sinceSeq && c.fromDevice !== deviceId
      );

      const remoteJoined =
        latestRemoteJoinEvent &&
        latestRemoteJoinEvent.seq > sinceSeq &&
        latestRemoteJoinEvent.deviceId !== deviceId
          ? latestRemoteJoinEvent
          : null;

      res.json({
        seq: commandSeqCounter,
        devices: getAllActiveDevicesList(),
        state: roomPlaybackStates.get(roomId) || globalLatestPlaybackState,
        commands: newCommands,
        remoteJoined,
      });
    });

    appExpress.get('/api/rooms/:roomId/devices', (_req, res) => {
      res.json({ devices: getAllActiveDevicesList() });
    });

    function resolveAppOrigin(req) {
      const localIp = getLocalIpAddress();
      const queryOrigin = req.query.origin;
      if (queryOrigin && queryOrigin.startsWith('http') && !queryOrigin.includes('localhost') && !queryOrigin.includes('127.0.0.1')) {
        return queryOrigin.replace(/\/$/, '');
      }
      const forwardedHost = req.headers['x-forwarded-host'];
      if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
        return `https://${forwardedHost}`;
      }
      if (req.headers.host && !req.headers.host.includes('localhost') && !req.headers.host.includes('127.0.0.1')) {
        return `http://${req.headers.host}`;
      }
      return `http://${localIp || '192.168.1.100'}:${PORT}`;
    }

    appExpress.get('/api/download/mobile-remote', (req, res) => {
      const origin = resolveAppOrigin(req);
      const remoteUrl = `${origin}/?role=remote`;
      const htmlApp = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#e50914" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <title>CineCast Control Remoto</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html { width: 100%; height: 100%; background: #09090b; color: #fff; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; }
    .card { max-width: 360px; width: 100%; background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 32px 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .logo { width: 64px; height: 64px; border-radius: 20px; background: #e50914; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 900; margin: 0 auto 16px; box-shadow: 0 10px 25px rgba(229,9,20,0.4); }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: block; width: 100%; background: #e50914; color: #fff; text-decoration: none; padding: 16px; border-radius: 16px; font-size: 15px; font-weight: 800; box-shadow: 0 8px 20px rgba(229,9,20,0.35); }
  </style>
  <script>
    window.location.replace("${remoteUrl}");
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">▶</div>
    <h1>CineCast Control Remoto</h1>
    <p>Conectando con tu pantalla de PC...</p>
    <a class="btn" href="${remoteUrl}">📱 Entrar al Control Remoto</a>
  </div>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="CineCast-Control-Celu.html"');
      res.send(htmlApp);
    });

    appExpress.get('/api/download/pc-windows', (req, res) => {
      const origin = resolveAppOrigin(req);
      const targetUrl = `${origin}/?role=screen`;
      const batContent = [
        '@echo off',
        'title CineCast TV - Lanzador PC',
        'color 0C',
        `set "APP_URL=${targetUrl}"`,
        'start "" "%APP_URL%"',
        'exit',
      ].join('\r\n');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="Instalar-CineCast-PC.bat"');
      res.send(batContent);
    });

    // Motor de búsqueda de música y videos sin DRM
    appExpress.get('/api/media-search', async (req, res) => {
      const q = req.query.q || '';
      try {
        const results = await searchYouTubeTracks(q);
        res.json({ results });
      } catch (err) {
        res.status(500).json({ error: String(err), results: [] });
      }
    });

    // Persistencia permanente de cuentas, playlists y favoritos
    appExpress.get('/api/accounts', (_req, res) => {
      res.json(loadAccountsFromDisk());
    });

    appExpress.post('/api/accounts', (req, res) => {
      const ok = saveAccountsToDisk(req.body);
      res.json({ ok });
    });

    // =========================================================================
    // OAUTH 2.0 PKCE REAL CON SPOTIFY Y ALMACENAMIENTO SEGURO (safeStorage)
    // =========================================================================
    const pkceStates = new Map();

    function generatePKCE() {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      return { verifier, challenge };
    }

    // GET /auth/start/spotify: Flujo PKCE S256 oficial (Client ID dinámico, sin client secret)
    appExpress.get('/auth/start/spotify', async (req, res) => {
      const localIp = getLocalIpAddress() || '127.0.0.1';
      const port = process.env.PORT || 3000;
      const redirectUri = req.query.redirect_uri || `http://${localIp}:${port}/auth/callback`;
      let clientId =
        req.query.client_id ||
        process.env.SPOTIFY_CLIENT_ID ||
        process.env.VITE_SPOTIFY_CLIENT_ID;

      // Si el usuario envió client_id por query o formulario, persistirlo
      if (req.query.client_id) {
        clientId = req.query.client_id.trim();
        process.env.VITE_SPOTIFY_CLIENT_ID = clientId;
        saveAccountsToDisk({ spotifyClientId: clientId });
      } else if (!clientId) {
        const acc = loadAccountsFromDisk();
        if (acc && acc.spotifyClientId) clientId = acc.spotifyClientId;
      }

      // Si no hay Client ID configurado, mostrar pantalla clara de setup en lugar del error de Spotify
      if (!clientId || clientId === 'your_spotify_client_id_here') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configurar Spotify OAuth - CineCast</title>
  <style>
    body { background: #09090b; color: #fff; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 36px 28px; max-width: 460px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0,0,0,0.8); }
    .icon { font-size: 44px; margin-bottom: 12px; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; color: #10b981; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.6; margin-bottom: 22px; }
    .steps { text-align: left; background: #09090b; border: 1px solid #27272a; border-radius: 18px; padding: 18px; margin-bottom: 22px; font-size: 13px; color: #d4d4d8; line-height: 1.6; }
    .steps ol { padding-left: 20px; margin: 0; }
    .steps li { margin-bottom: 10px; }
    .steps li:last-child { margin-bottom: 0; }
    .steps code { background: #27272a; padding: 3px 7px; border-radius: 6px; color: #10b981; font-family: monospace; font-size: 12px; word-break: break-all; display: inline-block; margin-top: 4px; }
    input { width: 100%; box-sizing: border-box; padding: 14px 16px; background: #09090b; border: 1px solid #3f3f46; border-radius: 14px; color: #fff; font-size: 14px; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #10b981; }
    button { width: 100%; padding: 15px; border-radius: 14px; background: #10b981; color: #000; font-weight: 800; font-size: 14px; border: none; cursor: pointer; transition: transform 0.1s, background 0.2s; box-shadow: 0 10px 25px rgba(16,185,129,0.3); }
    button:hover { background: #059669; }
    button:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎵</div>
    <h1>Conectar Spotify OAuth (PKCE)</h1>
    <p>Para escuchar tus playlists y favoritos en tu PC, ingresa tu Client ID público de Spotify Developer:</p>
    <div class="steps">
      <ol>
        <li>Entra a <strong>developer.spotify.com</strong> y crea tu app.</li>
        <li>En <strong>Redirect URIs</strong> agrega:<br><code>http://${localIp}:${port}/auth/callback</code></li>
        <li>Pega tu <strong>Client ID</strong> aquí (no requiere Client Secret):</li>
      </ol>
    </div>
    <form method="GET" action="/auth/start/spotify">
      <input type="text" name="client_id" placeholder="Pega tu Client ID aquí..." required />
      <button type="submit">⚡ Guardar y Conectar Spotify</button>
    </form>
  </div>
</body>
</html>`);
      }

      const { verifier, challenge } = generatePKCE();
      const state = crypto.randomBytes(16).toString('hex');

      pkceStates.set(state, {
        verifier,
        challenge,
        clientId,
        redirectUri,
        provider: 'spotify',
        createdAt: Date.now(),
      });

      const scopes = [
        'user-read-private',
        'user-read-email',
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-modify-playback-state',
        'user-read-playback-state',
        'streaming',
      ].join(' ');

      const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&code_challenge_method=S256&code_challenge=${challenge}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&show_dialog=true`;

      res.redirect(authUrl);
    });

    // Rutas de Vinculación Smart-Bridge por QR en LAN (para YouTube o conexión rápida)
    appExpress.get('/auth/start/:provider', async (req, res) => {
      const provider = (req.params.provider || 'spotify').toLowerCase();
      if (provider === 'spotify' && !req.query.bridge) {
        return res.redirect('/auth/start/spotify');
      }

      const isSpotify = provider === 'spotify';
      const brandColor = isSpotify ? '#10b981' : '#ef4444';
      const brandName = isSpotify ? 'Spotify' : 'YouTube';
      const brandIcon = isSpotify ? '🎵' : '▶️';

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Vincular ${brandName} - CineCast</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 28px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }
    .icon { width: 64px; height: 64px; border-radius: 20px; background: ${brandColor}20; color: ${brandColor}; border: 1px solid ${brandColor}50; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 16px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 22px; }
    .input-group { text-align: left; margin-bottom: 16px; }
    label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; display: block; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; background: #09090b; border: 1px solid #3f3f46; border-radius: 14px; color: #fff; font-size: 14px; outline: none; }
    input:focus { border-color: ${brandColor}; }
    .btn { width: 100%; padding: 14px; border-radius: 14px; font-size: 14px; font-weight: 700; cursor: pointer; border: none; transition: 0.2s; margin-bottom: 10px; }
    .btn-primary { background: ${brandColor}; color: #fff; box-shadow: 0 10px 20px ${brandColor}30; }
    .btn-secondary { background: #27272a; color: #e4e4e7; }
    .success { display: none; margin-top: 10px; }
    .checkmark { font-size: 48px; color: #10b981; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card" id="form-card">
    <div class="icon">${brandIcon}</div>
    <h1>Conectar ${brandName}</h1>
    <p>Vinculá tu cuenta o playlist para reproducir sin límites en la pantalla de tu PC.</p>
    <div class="input-group">
      <label>Usuario o Perfil</label>
      <input type="text" id="username" placeholder="Tu usuario o nombre..." value="Mi Celular" />
    </div>
    <div class="input-group">
      <label>Enlace de Playlist o Canal (Opcional)</label>
      <input type="text" id="playlist" placeholder="https://${isSpotify ? 'open.spotify.com/playlist/...' : 'youtube.com/playlist?list=...'}" />
    </div>
    <button class="btn btn-primary" onclick="submitAuth()">⚡ Conectar con tu PC</button>
    <button class="btn btn-secondary" onclick="quickGuest()">👤 Conexión Rápida Invitado</button>
  </div>

  <div class="card success" id="success-card">
    <div class="checkmark">✓</div>
    <h1 style="color: #10b981;">¡Conectado con Éxito!</h1>
    <p style="margin-top: 8px;">Tu cuenta y playlists ya están sincronizadas en tu PC. Ya podés cerrar esta ventana o abrir el control remoto.</p>
    <a href="/?role=remote&hub=${provider}" class="btn btn-primary" style="text-decoration:none; display:block; margin-top: 16px;">📱 Ir al Control Remoto</a>
  </div>

  <script>
    async function submitAuth() {
      const username = document.getElementById('username').value.trim() || 'Usuario CineCast';
      const playlist = document.getElementById('playlist').value.trim();
      await fetch('/auth/qr-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: '${provider}',
          profile: { name: username },
          playlistUrl: playlist,
          connectedAt: Date.now(),
        })
      });
      document.getElementById('form-card').style.display = 'none';
      document.getElementById('success-card').style.display = 'block';
    }

    function quickGuest() {
      document.getElementById('username').value = 'Invitado VIP';
      submitAuth();
    }
  </script>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });

    appExpress.post('/auth/qr-complete', async (req, res) => {
      const { provider = 'spotify', profile, playlistUrl, tokens } = req.body || {};
      const payload = {
        provider,
        profile: profile || { name: 'Usuario Vinculado' },
        playlistUrl: playlistUrl || '',
        tokens: tokens || null,
        connected: true,
        updatedAt: Date.now(),
      };
      await saveSecureAuth(provider, payload);
      const current = loadAccountsFromDisk();
      const accounts = Array.isArray(current.accounts) ? current.accounts.filter((a) => a.provider !== provider) : [];
      accounts.push(payload);
      saveAccountsToDisk({ accounts });

      const alertPayload = JSON.stringify({
        type: 'auth:updated',
        provider,
        profile: payload.profile,
      });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === 1) {
          try { client.ws.send(alertPayload); } catch (_) {}
        }
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:updated', { provider, profile: payload.profile });
      }

      res.json({ ok: true, provider });
    });

    // GET /auth/callback: Intercambio PKCE por tokens y almacenamiento cifrado con safeStorage
    appExpress.get('/auth/callback', async (req, res) => {
      const { code, state, error } = req.query;
      const pkce = state ? pkceStates.get(state) : null;
      const provider = pkce?.provider || req.query.provider || 'spotify';

      if (error || !code) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body style="background:#09090b;color:#ef4444;font-family:sans-serif;text-align:center;padding:50px;"><h1>❌ Error en la autorización</h1><p style="color:#a1a1aa">${error || 'No se recibió código de autorización.'}</p></body></html>`);
      }

      let tokens = null;
      let profile = { name: 'Usuario Spotify' };

      if (pkce && pkce.verifier) {
        try {
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: String(code),
              redirect_uri: pkce.redirectUri,
              client_id: pkce.clientId,
              code_verifier: pkce.verifier,
            }).toString(),
            signal: AbortSignal.timeout(10000),
          });

          if (tokenRes.ok) {
            tokens = await tokenRes.json();
          } else {
            const errText = await tokenRes.text();
            console.warn('[Spotify PKCE] Token exchange error:', errText);
          }
        } catch (e) {
          console.warn('[Spotify PKCE] Token fetch failed:', e);
        }
      }

      if (tokens && tokens.access_token) {
        tokens.clientId = pkce?.clientId || process.env.VITE_SPOTIFY_CLIENT_ID || '';
        tokens.expiresAt = Date.now() + ((tokens.expires_in || 3600) * 1000);
        try {
          const profileRes = await fetch('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: AbortSignal.timeout(6000),
          });
          if (profileRes.ok) {
            const p = await profileRes.json();
            profile = {
              name: p.display_name || p.id || 'Usuario Spotify',
              id: p.id,
              email: p.email || '',
            };
          }
        } catch (_) {}
      }

      const tokenPayload = {
        provider,
        tokens: tokens || { code },
        profile,
        connected: true,
        updatedAt: Date.now(),
      };

      // Cifrado seguro en disco usando safeStorage (%APPDATA%/userData/tokens/spotify.bin)
      await saveSecureAuth(provider, tokenPayload);

      // Guardar en cinecast-accounts.json
      const current = loadAccountsFromDisk();
      const accounts = Array.isArray(current.accounts) ? current.accounts.filter((a) => a.provider !== provider) : [];
      accounts.push(tokenPayload);
      saveAccountsToDisk({ accounts });

      if (state) pkceStates.delete(state);

      // Notificar al instante a todos los dispositivos por WebSocket
      const alertPayload = JSON.stringify({
        type: 'auth:updated',
        provider,
        profile,
      });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === 1) {
          try { client.ws.send(alertPayload); } catch (_) {}
        }
      });

      // Notificar a la app de escritorio Electron
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:updated', { provider, profile });
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Spotify Conectado - CineCast</title>
  <style>
    body { background: #09090b; color: #10b981; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 24px; padding: 40px 32px; max-width: 440px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.8); }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { color: #a1a1aa; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✔ ¡Spotify conectado con éxito en tu PC!</h1>
    <p>Ya puedes cerrar esta ventana.</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`);
    });

    // Refresco automático de Spotify antes de que expire (3600 segundos)
    appExpress.get('/api/auth/spotify/token', async (_req, res) => {
      try {
        const auth = await loadSecureAuth('spotify');
        if (!auth || !auth.tokens || !auth.tokens.access_token) {
          return res.json({ connected: false, token: null });
        }

        const now = Date.now();
        const expiresAt = auth.tokens.expiresAt || 0;
        const refreshToken = auth.tokens.refresh_token;
        const clientId = auth.tokens.clientId || process.env.VITE_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;

        // Si vence en menos de 5 minutos (o ya venció) y tenemos refresh_token y clientId
        if (now >= expiresAt - 300000 && refreshToken && clientId) {
          try {
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
              }).toString(),
              signal: AbortSignal.timeout(10000),
            });

            if (tokenRes.ok) {
              const fresh = await tokenRes.json();
              auth.tokens.access_token = fresh.access_token;
              if (fresh.refresh_token) auth.tokens.refresh_token = fresh.refresh_token;
              auth.tokens.expires_in = fresh.expires_in || 3600;
              auth.tokens.expiresAt = Date.now() + ((fresh.expires_in || 3600) * 1000);
              auth.updatedAt = Date.now();
              await saveSecureAuth('spotify', auth);
              console.log('[Spotify OAuth] Token refrescado automáticamente con éxito.');
            } else {
              console.warn('[Spotify OAuth] Respuesta de refresco no exitosa:', await tokenRes.text());
            }
          } catch (refErr) {
            console.warn('[Spotify OAuth] Error al refrescar access_token:', refErr);
          }
        }

        res.json({
          connected: true,
          token: auth.tokens.access_token,
          profile: auth.profile,
          expiresAt: auth.tokens.expiresAt,
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    appExpress.get('/api/auth/status', async (_req, res) => {
      const spotify = await loadSecureAuth('spotify');
      const youtube = await loadSecureAuth('youtube');
      res.json({
        spotify: { connected: Boolean(spotify?.connected), profile: spotify?.profile || null },
        youtube: { connected: Boolean(youtube?.connected), profile: youtube?.profile || null },
      });
    });

    appExpress.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send('CineCast TV embedded server active');
      }
    });

    const wss = new WebSocketServer({ noServer: true });
    embeddedWss = wss;

    server.on('upgrade', (request, socket, head) => {
      if (request.url && request.url.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    });

    wss.on('connection', (ws) => {
      let clientInfo = null;
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          switch (msg.type) {
            case 'join': {
              const { roomId = 'cine-home-1', deviceId, deviceName, deviceType } = msg;
              if (!deviceId) return;
              const room = getOrCreateRoom(roomId);
              clientInfo = {
                ws,
                roomId,
                deviceId,
                deviceName: deviceName || 'Dispositivo',
                deviceType: deviceType || 'hybrid',
                lastSeen: Date.now(),
              };
              room.set(deviceId, clientInfo);
              globalDevices.set(deviceId, clientInfo);
              broadcastRoomDevices(roomId);

              if (deviceType === 'remote') {
                commandSeqCounter += 1;
                latestRemoteJoinEvent = {
                  seq: commandSeqCounter,
                  deviceId,
                  deviceName: deviceName || 'Celular',
                  timestamp: Date.now(),
                };
                const joinAlert = JSON.stringify({
                  type: 'remote_connected',
                  fromDevice: deviceId,
                  deviceName: deviceName || 'Celular',
                });
                globalDevices.forEach((c) => {
                  if (c.deviceId !== deviceId && c.ws && c.ws.readyState === 1) {
                    try { c.ws.send(joinAlert); } catch (_) {}
                  }
                });
              }

              const existingState = roomPlaybackStates.get(roomId) || globalLatestPlaybackState;
              if (existingState) {
                try { ws.send(JSON.stringify({ type: 'sync_state', state: existingState })); } catch (_) {}
              }
              break;
            }
            case 'command': {
              const fromId = clientInfo?.deviceId || msg.fromDevice || 'remote_anon';
              const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
              if (clientInfo) clientInfo.lastSeen = Date.now();
              recordAndBroadcastCommand(rId, fromId, msg.command, msg.targetDeviceId, msg.id);
              break;
            }
            case 'sync_state': {
              const fromId = clientInfo?.deviceId || msg.fromDevice || 'screen_anon';
              const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
              if (clientInfo) clientInfo.lastSeen = Date.now();
              recordAndBroadcastState(rId, fromId, msg.state);
              break;
            }
            case 'ping': {
              if (clientInfo) clientInfo.lastSeen = Date.now();
              try { ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() })); } catch (_) {}
              break;
            }
          }
        } catch (err) {
          console.error('[EmbeddedWS] Error procesando mensaje:', err);
        }
      });

      ws.on('close', () => {
        if (clientInfo) {
          const room = rooms.get(clientInfo.roomId);
          if (room) room.delete(clientInfo.deviceId);
          globalDevices.delete(clientInfo.deviceId);
          broadcastRoomDevices(clientInfo.roomId);
        }
      });
    });

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
  ytSession.setCertificateVerifyProc((_req, cb) => cb(0));

  // Sesión persistente para Spotify Web Player
  const spotifySession = session.fromPartition('persist:spotify', { cache: true });
  spotifySession.setUserAgent(REAL_UA);
  spotifySession.setCertificateVerifyProc((_req, cb) => cb(0));

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

  // Aceptar certificados SSL en ambas sesiones para IPTV y reproductores embed
  const allowAllCerts = (_request, callback) => callback(0);
  session.defaultSession.setCertificateVerifyProc(allowAllCerts);
  customSession.setCertificateVerifyProc(allowAllCerts);

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

// Ignorar globalmente errores de certificados SSL
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(true);
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
