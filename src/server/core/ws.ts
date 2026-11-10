import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  rooms,
  globalDevices,
  roomPlaybackStates,
  globalLatestPlaybackState,
  getOrCreateRoom,
  broadcastRoomDevices,
  recordAndBroadcastCommand,
  recordAndBroadcastState,
  setLatestRemoteJoin,
  incrementCommandSeq,
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

export function attachWebSocket(server: HttpServer): WebSocketServer {
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

    ws.on('message', (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as IncomingWsMessage;
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
                  } catch (_) {}
                }
              });
            }

            const existingState = roomPlaybackStates.get(roomId) || globalLatestPlaybackState;
            if (existingState) {
              try {
                ws.send(JSON.stringify({ type: 'sync_state', state: existingState }));
              } catch (_) {}
            }
            break;
          }
          case 'command': {
            const fromId = clientInfo?.deviceId || msg.fromDevice || 'remote_anon';
            const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
            if (clientInfo) clientInfo.lastSeen = Date.now();
            if (msg.command) {
              recordAndBroadcastCommand(rId, fromId, msg.command, msg.targetDeviceId, msg.id);
            }
            break;
          }
          case 'sync_state': {
            const fromId = clientInfo?.deviceId || msg.fromDevice || 'screen_anon';
            const rId = clientInfo?.roomId || msg.roomId || 'cine-home-1';
            if (clientInfo) clientInfo.lastSeen = Date.now();
            if (msg.state) {
              recordAndBroadcastState(rId, fromId, msg.state);
            }
            break;
          }
          case 'ping': {
            if (clientInfo) clientInfo.lastSeen = Date.now();
            try {
              ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            } catch (_) {}
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
