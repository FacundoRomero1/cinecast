import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import {
  rooms,
  globalDevices,
  roomPlaybackStates,
  globalLatestPlaybackState,
  globalStateSeq,
  commandSeqCounter,
  commandHistory,
  latestRemoteJoinEvent,
  getOrCreateRoom,
  getAllActiveDevicesList,
  broadcastRoomDevices,
  recordAndBroadcastCommand,
  recordAndBroadcastState,
  incrementCommandSeq,
  setLatestRemoteJoin,
  type ConnectedClient,
  type PlaybackCommandPayload,
  type PlaybackStatePayload,
} from '../rooms.js';

interface JoinBody {
  roomId?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: 'screen' | 'remote' | 'hybrid';
}

interface CommandBody {
  roomId?: string;
  fromDevice?: string;
  targetDeviceId?: string;
  command?: PlaybackCommandPayload;
  id?: string;
}

interface StateBody {
  roomId?: string;
  fromDevice?: string;
  state?: PlaybackStatePayload;
}

function getBuildIdFromDisk(): string {
  const candidates = [
    path.join(process.cwd(), 'dist', 'build-id.txt'),
    path.join(process.cwd(), 'cinecast', 'dist', 'build-id.txt'),
  ];
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(dir, '../../../../dist/build-id.txt'));
  } catch (_) {}

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8').trim();
        if (text) return text;
      }
    } catch (_) {}
  }
  return 'desconocido';
}

export function createSyncRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      embedded: true,
      buildId: getBuildIdFromDisk(),
      roomsCount: rooms.size,
      devicesCount: globalDevices.size,
      commandSeq: commandSeqCounter,
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/sync/join', (req, res) => {
    const body = (req.body || {}) as JoinBody;
    const { roomId = 'cine-home-1', deviceId, deviceName, deviceType } = body;
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
      const seq = incrementCommandSeq();
      setLatestRemoteJoin({
        seq,
        deviceId,
        deviceName: client.deviceName,
        timestamp: Date.now(),
      });
      const joinAlert = JSON.stringify({
        type: 'remote_connected',
        fromDevice: deviceId,
        deviceName: client.deviceName,
      });
      globalDevices.forEach((c) => {
        if (c.deviceId !== deviceId && c.ws && c.ws.readyState === WebSocket.OPEN) {
          try {
            c.ws.send(joinAlert);
          } catch (_) {}
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

  router.post('/sync/command', (req, res) => {
    const body = (req.body || {}) as CommandBody;
    const { roomId = 'cine-home-1', fromDevice, targetDeviceId, command, id } = body;
    if (!command) {
      res.status(400).json({ error: 'command required' });
      return;
    }

    const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
    if (existing) existing.lastSeen = Date.now();

    const result = recordAndBroadcastCommand(roomId, fromDevice || 'remote_http', command, targetDeviceId, id, (body as any).cseq);
    res.json({
      ok: true,
      seq: commandSeqCounter,
      ack: result.delivered ? { id, delivered: true } : undefined,
      nack: !result.delivered ? { id, reason: 'sin-pantalla' } : undefined,
    });
  });

  router.post('/sync/state', (req, res) => {
    const body = (req.body || {}) as StateBody;
    const { roomId = 'cine-home-1', fromDevice, state } = body;
    if (!state) {
      res.status(400).json({ error: 'state required' });
      return;
    }

    const existing = fromDevice ? globalDevices.get(fromDevice) : undefined;
    if (existing) existing.lastSeen = Date.now();

    recordAndBroadcastState(roomId, fromDevice || 'screen_http', state);
    res.json({ ok: true, stateSeq: globalStateSeq });
  });

  router.get('/sync/poll', (req, res) => {
    const roomId = typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : 'cine-home-1';
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
    const deviceName = typeof req.query.deviceName === 'string' ? req.query.deviceName : '';
    const rawType = typeof req.query.deviceType === 'string' ? req.query.deviceType : '';
    const deviceType: 'screen' | 'remote' | 'hybrid' =
      rawType === 'screen' || rawType === 'remote' || rawType === 'hybrid' ? rawType : 'hybrid';
    const rawSince = typeof req.query.since === 'string' ? req.query.since : '0';
    const sinceSeq = parseInt(rawSince, 10) || 0;

    if (deviceId) {
      const existing = globalDevices.get(deviceId);
      if (existing) {
        existing.lastSeen = Date.now();
        if (deviceName) existing.deviceName = deviceName;
        if (rawType) existing.deviceType = deviceType;
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

  router.get('/rooms/:roomId/devices', (_req, res) => {
    res.json({ devices: getAllActiveDevicesList() });
  });

  router.post('/sync/chaos/terminate-client', (req, res) => {
    const { deviceId, role } = (req.body || {}) as { deviceId?: string; role?: string };
    let terminated = false;
    globalDevices.forEach((client) => {
      if ((deviceId && client.deviceId === deviceId) || (role && client.deviceType === role)) {
        if (client.ws) {
          try {
            client.ws.terminate();
            terminated = true;
          } catch (_) {}
        }
      }
    });
    res.json({ ok: true, terminated });
  });

  return router;
}
