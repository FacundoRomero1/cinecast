const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// =========================================================================
// 1. CONFIGURACIÓN CRÍTICA DE CHROMIUM (AUTOPLAY TOTAL Y USER-AGENT REAL)
// =========================================================================
const REAL_CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.userAgentFallback = REAL_CHROME_USER_AGENT;

// Flags de Chromium para reproducción automática garantizada y soporte multimedia completo
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');

// Servidores embed conocidos que requieren Referer y Origin del propio host para evitar pantallas negras o 403
const EMBED_HOSTS = [
  'multiembed.mov',
  'vidsrc.to',
  'vidsrc.me',
  'vidsrc.cc',
  'vidsrc.xyz',
  'embed.su',
  '2embed.cc',
  'autoembed.cc',
  'superembed.stream',
  'cloudstream.to',
  'streamtape.com',
  'doodstream.com',
  'filelions.to',
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
];

// Lista blanca MUY corta de popups permitidos (todo lo demás se deniega)
const POPUP_ALLOW = /^https?:\/\/[^/]*(vidsrc|2embed|multiembed|autoembed|vidlink|videasy|moviesapi|smashy|superembed|streamtape|filemoon)/i;

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

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log('📡 [SyncServer] Puerto 3000 ya en uso (dev server o previo). Reutilizando servidor sin conflicto.');
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

// Cabeceras (Referer / User-Agent) requeridas por streams IPTV, indexadas por URL
const streamHeaders = new Map();

function findStreamHeaders(rawUrl) {
  const direct = streamHeaders.get(rawUrl);
  if (direct) return direct;
  try {
    const host = new URL(rawUrl).hostname;
    for (const [savedUrl, h] of streamHeaders) {
      try {
        if (new URL(savedUrl).hostname === host) return h;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function createWindow() {
  // Configurar sesión persistente en disco (guarda cookies, storage y credenciales)
  const customSession = session.fromPartition('persist:cinecast-session', { cache: true });
  customSession.setUserAgent(REAL_CHROME_USER_AGENT);

  // =========================================================================
  // 2. BYPASS DE REFERER / ORIGIN PARA EVITAR PANTALLAS NEGRAS EN IFRAMES
  // =========================================================================
  customSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['User-Agent'] = REAL_CHROME_USER_AGENT;
    headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';

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

    callback({ cancel: false, requestHeaders: headers });
  });

  // =========================================================================
  // 3. REMOCIÓN DE CABECERAS BLOQUEADORAS DE FRAMES (X-Frame-Options & CSP)
  // =========================================================================
  customSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

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
  const adPatterns = AD_HOSTS.map((h) => `*://*.${h}/*`);
  const blockAdCallback = (details, callback) => {
    callback({ cancel: true });
  };

  session.defaultSession.webRequest.onBeforeRequest({ urls: adPatterns }, blockAdCallback);
  customSession.webRequest.onBeforeRequest({ urls: adPatterns }, blockAdCallback);

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'CineCast TV - Experiencia Nativa',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:cinecast-session',
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setUserAgent(REAL_CHROME_USER_AGENT);

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
    return true;
  } catch (_) {
    return false;
  }
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

// Simular clic nativo forzado seguro (con throttle de 2s)
let lastSimulatedClickTime = 0;
ipcMain.handle('simulate-play-click', (_event, coords) => {
  if (!mainWindow) return false;

  const now = Date.now();
  if (now - lastSimulatedClickTime < 2000) {
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

// Cabeceras (Referer / User-Agent) por stream IPTV
ipcMain.handle('set-stream-headers', (_e, { url, referrer, userAgent }) => {
  if (url) streamHeaders.set(url, { referrer, userAgent });
  return true;
});

// Inspección del iframe embed (detección de Cloudflare)
ipcMain.handle('get-embed-status', async () => {
  if (!mainWindow) return null;
  try {
    const root = mainWindow.webContents.mainFrame;
    const frames = root.framesInSubtree.filter((f) => f !== root);
    if (!frames.length) return { ok: false, reason: 'no-frame' };

    const f = frames[frames.length - 1];
    let title = '';
    try {
      title = await f.executeJavaScript('document.title', false);
    } catch (err) {
      return { ok: false, reason: 'exec-failed', src: f.url };
    }
    const cf = /just a moment|attention required|checking your browser|verify|cloudflare/i.test(title || '');
    return { ok: true, title, cloudflare: cf, src: f.url };
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

// Ciclo de vida de la aplicación
app.whenReady().then(() => {
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
