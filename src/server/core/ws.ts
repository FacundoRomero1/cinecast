import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  broadcastRoomDevices,
  commandHistory,
  commandSeqCounter,
  firstJoinSeqByDevice,
  getOrCreateRoom,
  globalDevices,
  globalLatestPlaybackState,
  incrementCommandSeq,
  lastDeliveredSeqByDevice,
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
  cseq?: number;
  lastSeq?: number;
  isReconnect?: boolean;
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
          // No hubo pong en 25 s -> marcar desconectado y cerrar
          try {
            client.ws.terminate();
          } catch (_) { }
          client.disconnectedAt = now;
          client.connected = false;
          broadcastRoomDevices(client.roomId);
          return;
        }
        client.isAlive = false;
        client.lastPingSent = now;
        try {
          client.ws.ping();
        } catch (_) { }
      } else if (client.ws.readyState === WebSocket.CLOSED || client.ws.readyState === WebSocket.CLOSING) {
        if (!client.disconnectedAt) {
          client.disconnectedAt = now;
          client.connected = false;
          broadcastRoomDevices(client.roomId);
        } else if (now - client.disconnectedAt > 8000) {
          globalDevices.delete(id);
          const r = rooms.get(client.roomId);
          r?.delete(id);
          broadcastRoomDevices(client.roomId);
        }
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

            // Si existía un socket previo para este deviceId, avisar 'replaced' y cerrar con 4001 (sin terminate abrupto)
            const existingClient = globalDevices.get(deviceId);
            if (existingClient && existingClient.ws && existingClient.ws !== ws) {
              const oldWs = existingClient.ws;
              existingClient.ws = undefined;
              try {
                if (oldWs.readyState === WebSocket.OPEN) {
                  oldWs.send(JSON.stringify({ type: 'replaced', reason: 'otra-conexion' }));
                }
                oldWs.close(4001, 'otra-conexion');
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
              connected: true,
              disconnectedAt: undefined,
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

            if (deviceType === 'screen' || deviceType === 'hybrid') {
              const hadPriorRecord = lastDeliveredSeqByDevice.has(deviceId);
              const isReconnectJoin = Boolean(msg.isReconnect) && hadPriorRecord;

              if (!isReconnectJoin) {
                // Una pantalla que se une de cero (recién abierta o recargada) NO recibe replay ni reintentos previos
                firstJoinSeqByDevice.set(deviceId, commandSeqCounter);
                lastDeliveredSeqByDevice.set(deviceId, commandSeqCounter);
              } else {
                const lastDelivered = lastDeliveredSeqByDevice.get(deviceId) ?? 0;
                const clientLastSeq = typeof msg.lastSeq === 'number' ? msg.lastSeq : 0;
                const baselineSeq = Math.max(lastDelivered, clientLastSeq);
                const now = Date.now();
                const missed = commandHistory.filter(
                  (q) =>
                    q.roomId === roomId &&
                    q.seq > baselineSeq &&
                    now - q.timestamp < 8000 &&
                    (!q.targetDeviceId || q.targetDeviceId === deviceId)
                );
                let maxDelivered = baselineSeq;
                missed.forEach((q) => {
                  try {
                    ws.send(
                      JSON.stringify({
                        type: 'command',
                        id: q.id,
                        seq: q.seq,
                        cseq: q.cseq,
                        fromDevice: q.fromDevice,
                        command: q.command,
                      })
                    );
                    if (q.seq > maxDelivered) maxDelivered = q.seq;
                  } catch (_) {}
                });
                lastDeliveredSeqByDevice.set(deviceId, Math.max(maxDelivered, commandSeqCounter));
              }
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
              const res = recordAndBroadcastCommand(rId, fromId, msg.command, msg.targetDeviceId, msg.id, msg.cseq);
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
        const currentInGlobal = globalDevices.get(clientInfo.deviceId);
        if (currentInGlobal === clientInfo) {
          clientInfo.disconnectedAt = Date.now();
          clientInfo.connected = false;
          broadcastRoomDevices(clientInfo.roomId);
          const closedId = clientInfo.deviceId;
          const closedRoom = clientInfo.roomId;
          const closedRef = clientInfo;
          const expireTimer = setTimeout(() => {
            const cur = globalDevices.get(closedId);
            if (cur === closedRef && cur.disconnectedAt && Date.now() - cur.disconnectedAt >= 8000) {
              globalDevices.delete(closedId);
              rooms.get(closedRoom)?.delete(closedId);
              broadcastRoomDevices(closedRoom);
            }
          }, 8050);
          if (typeof expireTimer.unref === 'function') expireTimer.unref();
        }
      }
    });
  });

  return wss;
}
