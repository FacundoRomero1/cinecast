import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  broadcastRoomDevices,
  getOrCreateRoom,
  globalDevices,
  globalLatestPlaybackState,
  incrementCommandSeq,
  recordAndBroadcastCommand,
  recordAndBroadcastState,
  roomPlaybackStates,
  rooms,
  setLatestRemoteJoin,
  startPruneTimer,
  type ConnectedClient,
  type PlaybackCommandPayload,
  type PlaybackStatePayload,
} from './rooms.js';

interface IncomingWsMessage {
  type?: string;
  roomId?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: 'screen' | 'remote' | 'hybrid';
  fromDevice?: string;
  targetDeviceId?: string;
  id?: string;
  command?: PlaybackCommandPayload;
  state?: PlaybackStatePayload;
}

let pruneTimerStarted = false;
let activeWss: WebSocketServer | null = null;
let serverHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startServerHeartbeat(): void {
  if (serverHeartbeatTimer) return;
  serverHeartbeatTimer = setInterval(() => {
    const now = Date.now();
    globalDevices.forEach((client, id) => {
      if (!client.ws) return;
      if (client.ws.readyState === WebSocket.OPEN) {
        if (client.isAlive === false && now - (client.lastPingSent || 0) >= 25000) {
          // No hubo pong en 25 s -> terminate()
          try {
            client.ws.terminate();
          } catch (_) { }
          globalDevices.delete(id);
          const r = rooms.get(client.roomId);
          r?.delete(id);
          broadcastRoomDevices(client.roomId);
          return;
        }
        client.isAlive = false;
        client.lastPingSent = now;
        try {
          client.ws.ping();
        } catch (_) { }
      } else if (client.ws.readyState === WebSocket.CLOSED || client.ws.readyState === WebSocket.CLOSING) {
        globalDevices.delete(id);
        const r = rooms.get(client.roomId);
        r?.delete(id);
        broadcastRoomDevices(client.roomId);
      }
    });
  }, 10000);

  if (typeof serverHeartbeatTimer.unref === 'function') {
    serverHeartbeatTimer.unref();
  }
}

export function broadcastWsEvent(payload: Record<string, unknown>): void {
  if (!activeWss) return;
  const serialized = JSON.stringify(payload);
  activeWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(serialized);
      } catch (_) { }
    }
  });
}

export function attachWebSocket(server: HttpServer): WebSocketServer {
  if (!pruneTimerStarted) {
    startPruneTimer();
    startServerHeartbeat();
    pruneTimerStarted = true;
  }

  const wss = new WebSocketServer({ noServer: true });
  activeWss = wss;

  server.on('upgrade', (request, socket, head) => {
    if (request.url && request.url.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let clientInfo: ConnectedClient | null = null;

    ws.on('pong', () => {
      if (clientInfo) {
        clientInfo.isAlive = true;
        clientInfo.lastSeen = Date.now();
      }
    });

    ws.on('message', (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as IncomingWsMessage;
        switch (msg.type) {
          case 'join': {
            const { roomId = 'cine-home-1', deviceId, deviceName, deviceType } = msg;
            if (!deviceId) return;

            // Reemplazo limpio: si existía un socket previo para este deviceId, terminarlo
            const existingClient = globalDevices.get(deviceId);
            if (existingClient && existingClient.ws && existingClient.ws !== ws) {
              try {
                existingClient.ws.terminate();
              } catch (_) {}
            }

            const room = getOrCreateRoom(roomId);
            clientInfo = {
              ws,
              roomId,
              deviceId,
              deviceName: deviceName || 'Dispositivo',
              deviceType: deviceType || 'hybrid',
              lastSeen: Date.now(),
              isAlive: true,
              lastPingSent: Date.now(),
            };
            room.set(deviceId, clientInfo);
            globalDevices.set(deviceId, clientInfo);
            broadcastRoomDevices(roomId);

            if (deviceType === 'remote') {
              const seq = incrementCommandSeq();
              setLatestRemoteJoin({
                seq,
                deviceId,
                deviceName: deviceName || 'Celular',
                timestamp: Date.now(),
              });
              const joinAlert = JSON.stringify({
                type: 'remote_connected',
                fromDevice: deviceId,
                deviceName: deviceName || 'Celular',
              });
              globalDevices.forEach((c) => {
                if (c.deviceId !== deviceId && c.ws && c.ws.readyState === WebSocket.OPEN) {
                  try {
                    c.ws.send(joinAlert);
                  } catch (_) { }
                }
              });
            }

            const existingState = roomPlaybackStates.get(roomId) || globalLatestPlaybackState;
            if (existingState) {
              try {
                ws.send(JSON.stringify({ type: 'sync_state', state: existingState }));
              } catch (_) { }
            }
            break;
          }
          case 'command': {
            const fromId = clientInfo?.deviceId || msg.fromDevice || 'remote_anon';
            const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
            if (clientInfo) {
              clientInfo.lastSeen = Date.now();
              clientInfo.isAlive = true;
            }
            if (msg.command) {
              const res = recordAndBroadcastCommand(rId, fromId, msg.command, msg.targetDeviceId, msg.id);
              if (msg.id) {
                if (res.delivered) {
                  try {
                    ws.send(JSON.stringify({ type: 'ack', id: msg.id, delivered: true, timestamp: Date.now() }));
                  } catch (_) { }
                } else {
                  try {
                    ws.send(JSON.stringify({ type: 'nack', id: msg.id, reason: 'sin-pantalla', timestamp: Date.now() }));
                  } catch (_) { }
                }
              }
            }
            break;
          }
          case 'sync_state': {
            const fromId = clientInfo?.deviceId || msg.fromDevice || 'screen_anon';
            const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
            if (clientInfo) {
              clientInfo.lastSeen = Date.now();
              clientInfo.isAlive = true;
            }
            if (msg.state) {
              recordAndBroadcastState(rId, fromId, msg.state);
            }
            break;
          }
          case 'ping': {
            if (clientInfo) {
              clientInfo.lastSeen = Date.now();
              clientInfo.isAlive = true;
            }
            try {
              ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            } catch (_) { }
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

  return wss;
}
