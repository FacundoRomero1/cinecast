import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Allow CORS so downloaded portable HTML apps or ais-pre / ais-dev cross-origins can always reach the sync API
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

interface ConnectedClient {
  ws?: WebSocket;
  roomId: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'screen' | 'remote' | 'hybrid';
  lastSeen: number;
}

interface QueuedCommand {
  seq: number;
  id: string;
  roomId: string;
  fromDevice: string;
  targetDeviceId?: string;
  command: any;
  timestamp: number;
}

// Map of roomId -> Map<deviceId, ConnectedClient>
const rooms = new Map<string, Map<string, ConnectedClient>>();

// Also keep a global registry of all active devices on this server so phone & PC always find each other
const globalDevices = new Map<string, ConnectedClient>();

// Store latest playback state per room + global latest state
const roomPlaybackStates = new Map<string, any>();
let globalLatestPlaybackState: any = null;
let globalStateSeq = 0;

// Circular buffer of recent commands for HTTP polling fallback
let commandSeqCounter = 0;
const commandHistory: QueuedCommand[] = [];
const seenCommandIds = new Set<string>();

// Track latest remote connection event so screens polling via HTTP also wake up from standby
let latestRemoteJoinEvent: { seq: number; deviceId: string; deviceName: string; timestamp: number } | null = null;

function getOrCreateRoom(roomId: string) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId)!;
}

function getAllActiveDevicesList(): Array<{ id: string; name: string; type: string; lastSeen: number; roomId: string }> {
  const now = Date.now();
  const active: Array<{ id: string; name: string; type: string; lastSeen: number; roomId: string }> = [];
  globalDevices.forEach((client, id) => {
    // Prune devices inactive for more than 45 seconds if they don't have an open WS
    const wsOpen = client.ws && client.ws.readyState === WebSocket.OPEN;
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

function broadcastRoomDevices(roomId: string) {
  const deviceList = getAllActiveDevicesList();
  const payload = JSON.stringify({
    type: 'device_list',
    roomId,
    devices: deviceList,
  });

  // Broadcast to all connected WS clients so phone and PC always see each other
  globalDevices.forEach((client) => {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

function recordAndBroadcastCommand(roomId: string, fromDevice: string, command: any, targetDeviceId?: string, msgId?: string) {
  const uniqueId = msgId || `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  if (seenCommandIds.has(uniqueId)) {
    return;
  }
  seenCommandIds.add(uniqueId);
  if (seenCommandIds.size > 500) {
    const first = seenCommandIds.values().next().value;
    if (first) seenCommandIds.delete(first);
  }

  commandSeqCounter += 1;
  const queued: QueuedCommand = {
    seq: commandSeqCounter,
    id: uniqueId,
    roomId,
    fromDevice,
    targetDeviceId,
    command,
    timestamp: Date.now(),
  };
  commandHistory.push(queued);
  if (commandHistory.length > 100) {
    commandHistory.shift();
  }

  const forwardPayload = JSON.stringify({
    type: 'command',
    id: uniqueId,
    seq: commandSeqCounter,
    fromDevice,
    command,
  });

  // Broadcast to all other connected devices on this personal server so room mismatches never block remote control
  globalDevices.forEach((client) => {
    if (client.deviceId !== fromDevice && client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(forwardPayload);
    }
  });
}

function recordAndBroadcastState(roomId: string, fromDevice: string, state: any) {
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
    if (client.deviceId !== fromDevice && client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(statePayload);
    }
  });
}

// Set up WebSocket server with noServer to avoid clashing with other upgrade requests
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url && request.url.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws: WebSocket) => {
  let clientInfo: ConnectedClient | null = null;

  ws.on('message', (data: string) => {
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
              if (c.deviceId !== deviceId && c.ws && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(joinAlert);
              }
            });
          }

          const existingState = roomPlaybackStates.get(roomId) || globalLatestPlaybackState;
          if (existingState) {
            ws.send(
              JSON.stringify({
                type: 'sync_state',
                state: existingState,
              })
            );
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
          if (clientInfo) {
            clientInfo.lastSeen = Date.now();
          }
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    if (clientInfo) {
      const room = rooms.get(clientInfo.roomId);
      if (room) {
        room.delete(clientInfo.deviceId);
      }
      globalDevices.delete(clientInfo.deviceId);
      broadcastRoomDevices(clientInfo.roomId);
    }
  });
});

// REST API + HTTP SYNC FALLBACK (Guarantees 100% remote control delivery even if WebSockets are blocked)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    roomsCount: rooms.size,
    devicesCount: globalDevices.size,
    commandSeq: commandSeqCounter,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/sync/join', (req, res) => {
  const { roomId = 'cine-home-1', deviceId, deviceName, deviceType } = req.body || {};
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }

  const room = getOrCreateRoom(roomId);
  const existing = globalDevices.get(deviceId);
  const client: ConnectedClient = {
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
      if (c.deviceId !== deviceId && c.ws && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(joinAlert);
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

app.post('/api/sync/command', (req, res) => {
  const { roomId = 'cine-home-1', fromDevice, targetDeviceId, command, id } = req.body || {};
  if (!command) {
    res.status(400).json({ error: 'command required' });
    return;
  }
  const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
  if (existing) existing.lastSeen = Date.now();

  recordAndBroadcastCommand(roomId, fromDevice || 'remote_http', command, targetDeviceId, id);
  res.json({ ok: true, seq: commandSeqCounter });
});

app.post('/api/sync/state', (req, res) => {
  const { roomId = 'cine-home-1', fromDevice, state } = req.body || {};
  if (!state) {
    res.status(400).json({ error: 'state required' });
    return;
  }
  const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
  if (existing) existing.lastSeen = Date.now();

  recordAndBroadcastState(roomId, fromDevice || 'screen_http', state);
  res.json({ ok: true, stateSeq: globalStateSeq });
});

app.get('/api/sync/poll', (req, res) => {
  const roomId = (req.query.roomId as string) || 'cine-home-1';
  const deviceId = (req.query.deviceId as string) || '';
  const deviceName = (req.query.deviceName as string) || '';
  const deviceType = (req.query.deviceType as 'screen' | 'remote' | 'hybrid') || 'hybrid';
  const sinceSeq = parseInt((req.query.since as string) || '0', 10) || 0;

  if (deviceId) {
    const existing = globalDevices.get(deviceId);
    if (existing) {
      existing.lastSeen = Date.now();
      if (deviceName) existing.deviceName = deviceName;
      if (deviceType) existing.deviceType = deviceType;
    } else {
      const room = getOrCreateRoom(roomId);
      const client: ConnectedClient = {
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

app.get('/api/rooms/:roomId/devices', (_req, res) => {
  res.json({ devices: getAllActiveDevicesList() });
});

function isVirtualOrIgnored(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return /virtual|vmware|vbox|wsl|hyper-v|vethernet|tap|tun|tailscale|zerotier|loopback|docker|npcap|pseudo|teredo|radmin|hamachi|wireguard/i.test(lower);
}

export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  const validCandidates: { name: string; address: string }[] = [];

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
  const fallbackCandidates: string[] = [];
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

// REST endpoint to discover the PC's actual LAN IP address (for QR codes and phone pairing)
app.get('/api/local-ip', (_req, res) => {
  const localIp = getLocalIpAddress();
  res.json({
    ip: localIp,
    port: PORT,
    url: `http://${localIp}:${PORT}`,
    allIps: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i?.address),
  });
});

const DEFAULT_CLOUD_ORIGIN =
  process.env.APP_URL ||
  'https://ais-dev-7koztc4kh5wd5ixb7glzsd-522866689378.us-east1.run.app';

function resolveAppOrigin(req: express.Request): string {
  const localIp = getLocalIpAddress();
  const queryOrigin = req.query.origin as string | undefined;
  if (
    queryOrigin &&
    queryOrigin.startsWith('http') &&
    !queryOrigin.includes('localhost') &&
    !queryOrigin.includes('127.0.0.1')
  ) {
    return queryOrigin.replace(/\/$/, '');
  }
  const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
  if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
    return `https://${forwardedHost}`;
  }
  if (
    req.headers.host &&
    !req.headers.host.includes('localhost') &&
    !req.headers.host.includes('127.0.0.1')
  ) {
    return `http://${req.headers.host}`;
  }
  // En local, devolvemos la IP LAN real para que el celular se conecte directo por WiFi
  return `http://${localIp}:${PORT}`;
}

// DOWNLOADABLE INSTALLERS FOR PC & MOBILE
app.get('/api/download/pc-windows', (req, res) => {
  const origin = resolveAppOrigin(req);
  // Single query parameter without '&' so Windows CMD never chokes on '&'
  const targetUrl = `${origin}/?role=screen`;

  const batContent = [
    '@echo off',
    'title CineCast TV - Instalador y Lanzador PC',
    'color 0C',
    'echo ========================================================',
    'echo          CINECAST TV - ABRIENDO PANTALLA PC             ',
    'echo ========================================================',
    `set "APP_URL=${targetUrl}"`,
    'set "BRAVE_1=%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
    'set "BRAVE_2=%ProgramFiles(x86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
    'set "BRAVE_3=%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
    'set "CHROME_1=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'set "CHROME_2=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    'set "EDGE_1=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    '',
    'REM Crear acceso directo real en el Escritorio (compatible con OneDrive / Windows en Espanol)',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath(\'Desktop\'); $s = (New-Object -COM WScript.Shell).CreateShortcut((Join-Path $d \'CineCast TV.lnk\')); $s.TargetPath = \'%~f0\'; $s.Description = \'CineCast TV\'; $s.Save()" >nul 2>&1',
    '',
    'if exist "%BRAVE_1%" (',
    '  start "" "%BRAVE_1%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'if exist "%BRAVE_2%" (',
    '  start "" "%BRAVE_2%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'if exist "%BRAVE_3%" (',
    '  start "" "%BRAVE_3%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'if exist "%CHROME_1%" (',
    '  start "" "%CHROME_1%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'if exist "%CHROME_2%" (',
    '  start "" "%CHROME_2%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'if exist "%EDGE_1%" (',
    '  start "" "%EDGE_1%" --app="%APP_URL%" --start-maximized --autoplay-policy=no-user-gesture-required',
    '  exit',
    ')',
    'start "" "%APP_URL%"',
    'exit',
  ].join('\r\n');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="Instalar-CineCast-PC.bat"');
  res.send(batContent);
});

app.get('/api/download/mobile-remote', (req, res) => {
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

app.get('/manifest.webmanifest', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(__dirname, 'public', 'manifest.webmanifest'));
});

app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(__dirname, 'public', 'sw.js'));
});

// ARCHIVE.ORG CORS PROXY & MP4 STREAM RESOLVER
app.get('/api/archive/search', async (req, res) => {
  try {
    const query = ((req.query.q as string) || 'classic').trim();
    const rows = Math.min(24, parseInt((req.query.rows as string) || '12', 10) || 12);
    const searchQ = `(${query}) AND mediatype:(movies) AND collection:(feature_films OR moviesandfilms)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      searchQ
    )}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&page=1&output=json`;

    const response = await fetch(url);
    if (!response.ok) {
      res.json({ docs: [] });
      return;
    }
    const data = (await response.json()) as any;
    const docs = data?.response?.docs || [];
    res.json({ docs });
  } catch (err) {
    console.error('Archive.org search proxy error:', err);
    res.json({ docs: [] });
  }
});

app.get('/api/archive/resolve/:identifier', async (req, res) => {
  const { identifier } = req.params;
  try {
    const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (!metaRes.ok) {
      res.json({
        streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
      });
      return;
    }
    const meta = (await metaRes.json()) as any;
    const files: any[] = Array.isArray(meta?.files) ? meta.files : [];
    const mp4File =
      files.find((f) => typeof f.name === 'string' && f.name.endsWith('.mp4') && !f.name.includes('_ia')) ||
      files.find((f) => typeof f.name === 'string' && f.name.endsWith('.mp4'));

    if (mp4File && mp4File.name) {
      res.json({
        streamUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(mp4File.name)}`,
      });
      return;
    }
    res.json({
      streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
    });
  } catch (_) {
    res.json({
      streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
    });
  }
});

// TMDB & SERVER CATALOG
const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
const TMDB_URL = 'https://api.themoviedb.org/3';

let serverCatalogCache: any[] | null = null;
function loadServerCatalog(): any[] {
  if (serverCatalogCache && serverCatalogCache.length > 0) return serverCatalogCache;
  const candidates = [
    path.join(__dirname, 'public', 'data', 'catalog.json'),
    path.join(__dirname, 'dist', 'data', 'catalog.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          serverCatalogCache = parsed;
          return serverCatalogCache;
        }
      }
    } catch (_) {}
  }
  return [];
}

function normalizeSearch(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function getTypoSuggestion(query: string): Promise<string | null> {
  try {
    const u = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const json = (await r.json()) as any;
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

function extractTmdbId(val: any): string {
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

// Detalle de serie y temporadas reales
app.get('/api/tv/:id', async (req, res) => {
  const tmdbId = extractTmdbId(req.params.id);
  if (!tmdbId) {
    res.status(400).json({ error: 'ID inválido' });
    return;
  }

  try {
    const url = `${TMDB_URL}/tv/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) {
      res.status(404).json({ error: 'Serie no encontrada' });
      return;
    }

    const d = (await r.json()) as any;
    const seasons = (d.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({
        seasonNumber: s.season_number,
        name: s.name || `Temporada ${s.season_number}`,
        episodeCount: s.episode_count || 10,
        posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
      }));

    res.json({
      id: Number(tmdbId),
      tmdbId: Number(tmdbId),
      title: d.name || d.original_name || 'Serie',
      numberOfSeasons: seasons.length,
      numberOfEpisodes: d.number_of_episodes || 0,
      seasons,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Episodios de temporada
app.get('/api/tv/:id/season/:seasonNumber', async (req, res) => {
  const tmdbId = extractTmdbId(req.params.id);
  const sNum = parseInt(req.params.seasonNumber, 10) || 1;

  try {
    const url = `${TMDB_URL}/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_KEY}&language=es-MX`;
    const epRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!epRes.ok) {
      res.status(404).json({ error: 'Temporada no encontrada' });
      return;
    }

    const data = (await epRes.json()) as any;
    const episodes = (data.episodes || []).map((e: any) => ({
      id: e.id,
      season: e.season_number,
      episode: e.episode_number,
      title: e.name || `Episodio ${e.episode_number}`,
      overview: e.overview || '',
      duration: e.runtime ? `${e.runtime}m` : '24m',
      stillUrl: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null,
      voteAverage: Number((e.vote_average || 7.0).toFixed(1)),
    }));

    res.json({ seasonNumber: sNum, episodes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const hasCJK = (str: string) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(str || '');

function rankAndDeduplicateItems(rawItems: any[], query: string, originalQuery: string = ''): any[] {
  const qNorm = (query || '').trim().toLowerCase();
  const origNorm = (originalQuery || '').trim().toLowerCase();
  const qIsLatin = !hasCJK(qNorm) && !hasCJK(origNorm);

  const byTmdbId = new Map<string, any>();

  for (const item of rawItems) {
    const idKey = item.tmdbId ? `tmdb-${item.tmdbId}` : (item.id || '');
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

// Historial sincronizado central en disco
const watchHistoryDir = path.join(__dirname, 'public', 'data');
const watchHistoryFilePath = path.join(watchHistoryDir, 'watch_history.json');
try { fs.mkdirSync(watchHistoryDir, { recursive: true }); } catch (_) {}

function loadWatchHistoryFromDisk(): any[] {
  try {
    if (fs.existsSync(watchHistoryFilePath)) {
      const raw = fs.readFileSync(watchHistoryFilePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return [];
}

function saveWatchHistoryToDisk(items: any[]): boolean {
  try {
    fs.writeFileSync(watchHistoryFilePath, JSON.stringify(items.slice(0, 50)), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

app.get('/api/watch-history', (_req, res) => {
  res.json({ items: loadWatchHistoryFromDisk() });
});

app.post('/api/watch-history', (req, res) => {
  const incoming = req.body?.items || (req.body ? [req.body] : []);
  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.json({ ok: false });
    return;
  }

  const current = loadWatchHistoryFromDisk();
  const map = new Map<string, any>();
  for (const it of current) map.set(it.id, it);
  for (const it of incoming) {
    if (!it.id) continue;
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
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(wsMsg); } catch (_) {}
    }
  });

  res.json({ ok: true, items: merged });
});

let devDiagnosticMode = false;
let devNoCorsFix = false;
app.get('/api/diagnostic-mode', (req, res) => {
  if (req.query.enabled !== undefined) {
    devDiagnosticMode = req.query.enabled === 'true';
  }
  if (req.query.noCorsFix !== undefined) {
    devNoCorsFix = req.query.noCorsFix === 'true';
  }
  res.json({ diagnosticMode: devDiagnosticMode, noCorsFix: devNoCorsFix });
});

app.post('/api/diagnostic-mode', (req, res) => {
  if (req.body?.enabled !== undefined) {
    devDiagnosticMode = Boolean(req.body.enabled);
  }
  if (req.body?.noCorsFix !== undefined) {
    devNoCorsFix = Boolean(req.body.noCorsFix);
  }
  res.json({ diagnosticMode: devDiagnosticMode, noCorsFix: devNoCorsFix });
});

// Motor de búsqueda con deduplicación por tmdbId, ranking y penalización CJK
app.get('/api/search', async (req, res) => {
  const rawQ = ((req.query.q as string) || '').trim();
  if (!rawQ || rawQ.length < 2) {
    res.json({ query: rawQ, total: 0, items: [] });
    return;
  }

  const qNorm = normalizeSearch(rawQ);
  const catalog = loadServerCatalog();

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

  const tmdbRawItems: any[] = [];

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

          tmdbRawItems.push({
            id: `tmdb-${isTV ? 'series' : 'movie'}-${item.id}`,
            tmdbId: item.id,
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
              { name: 'TukiPlay (HD)', url: isTV ? `https://tukiplay.com/embed/tv/${item.id}/1/1` : `https://tukiplay.com/embed/movie/${item.id}`, type: 'iframe', language: 'Audio según servidor' },
              { name: 'VidLink Pro (Multi / Sub ES)', url: isTV ? `https://vidlink.pro/tv/${item.id}/1/1?autoplay=true` : `https://vidlink.pro/movie/${item.id}?autoplay=true`, type: 'iframe', language: '🌐 Multi / Sub ES' },
              { name: 'VidEasy (Multi)', url: isTV ? `https://player.videasy.net/tv/${item.id}/1/1` : `https://player.videasy.net/movie/${item.id}`, type: 'iframe', language: '🌐 Multi / Original' },
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

  res.json({
    query: rawQ,
    correctedQuery: corrected,
    total: ranked.length,
    items: itemsSlice,
    results: itemsSlice,
  });
});

// Partidos de fútbol
let devSportsCache: any = null;
let devSportsTime = 0;

app.get('/api/sports/matches', async (_req, res) => {
  const now = Date.now();
  if (devSportsCache && now - devSportsTime < 45000) {
    res.json(devSportsCache);
    return;
  }

  const leagues = [
    { slug: 'arg.1', name: 'Liga Profesional Argentina' },
    { slug: 'arg.copa', name: 'Copa Argentina' },
    { slug: 'conmebol.libertadores', name: 'Copa Libertadores' },
    { slug: 'conmebol.sudamericana', name: 'Copa Sudamericana' },
  ];

  let compChannels: any = {};
  try {
    const fp = path.join(__dirname, 'data', 'competition-channels.json');
    if (fs.existsSync(fp)) compChannels = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {}

  try {
    const allMatches: any[] = [];
    const seenEventIds = new Set<string>();

    await Promise.allSettled(
      leagues.map(async (l) => {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${l.slug}/scoreboard`;
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return;
          const data = (await r.json()) as any;
          const events = Array.isArray(data.events) ? data.events : [];

          for (const ev of events) {
            if (!ev.id || seenEventIds.has(ev.id)) continue;
            seenEventIds.add(ev.id);
            const comp = ev.competitions?.[0];
            const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
            const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
            const statusState = ev.status?.type?.state;
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

    devSportsCache = result;
    devSportsTime = now;
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err), matches: [] });
  }
});

// Serve frontend with Vite in dev, or static in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(Number(PORT), '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log(`====================================================`);
    console.log(`🎬 CineCast Server Activo en Red Local (LAN):`);
    console.log(`   ➜ Local:    http://localhost:${PORT}`);
    console.log(`   ➜ Red WiFi: http://${localIp}:${PORT}`);
    console.log(`====================================================`);
  });
}

startServer();
