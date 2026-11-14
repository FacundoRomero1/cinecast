import { WebSocket } from 'ws';

export interface ConnectedClient {
  ws?: WebSocket | undefined;
  roomId: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'screen' | 'remote' | 'hybrid';
  lastSeen: number;
  isAlive?: boolean | undefined;
  lastPingSent?: number | undefined;
  connected?: boolean | undefined;
  disconnectedAt?: number | undefined;
}

export type PlaybackCommandPayload = Record<string, unknown>;
export type PlaybackStatePayload = Record<string, unknown>;

export interface QueuedCommand {
  seq: number;
  cseq?: number;
  id: string;
  roomId: string;
  fromDevice: string;
  targetDeviceId?: string | undefined;
  command: PlaybackCommandPayload;
  timestamp: number;
}

export interface RemoteJoinEvent {
  seq: number;
  deviceId: string;
  deviceName: string;
  timestamp: number;
}

export interface ActiveDeviceSummary {
  id: string;
  name: string;
  type: string;
  lastSeen: number;
  roomId: string;
  connected: boolean;
  disconnectedAt?: number | undefined;
}

// Map of roomId -> Map<deviceId, ConnectedClient>
export const rooms = new Map<string, Map<string, ConnectedClient>>();

// Also keep a global registry of all active devices on this server so phone & PC always find each other
export const globalDevices = new Map<string, ConnectedClient>();

// Seguimiento por dispositivo del último seq entregado y del seq al unirse de cero
export const lastDeliveredSeqByDevice = new Map<string, number>();
export const firstJoinSeqByDevice = new Map<string, number>();
export const commandSeqById = new Map<string, number>();

// Store latest playback state per room + global latest state
export const roomPlaybackStates = new Map<string, PlaybackStatePayload>();
export let globalLatestPlaybackState: PlaybackStatePayload | null = null;
export let globalStateSeq = 0;

// Circular buffer of recent commands for HTTP polling fallback
export let commandSeqCounter = 0;
export const commandHistory: QueuedCommand[] = [];
export const seenCommandIds = new Set<string>();

// Track latest remote connection event so screens polling via HTTP also wake up from standby
export let latestRemoteJoinEvent: RemoteJoinEvent | null = null;

export function getOrCreateRoom(roomId: string): Map<string, ConnectedClient> {
  let existing = rooms.get(roomId);
  if (!existing) {
    existing = new Map<string, ConnectedClient>();
    rooms.set(roomId, existing);
  }
  return existing;
}

export function getAllActiveDevicesList(): ActiveDeviceSummary[] {
  const now = Date.now();
  const byId = new Map<string, ActiveDeviceSummary>();
  globalDevices.forEach((client) => {
    let isConnected = false;
    let discAt: number | undefined = client.disconnectedAt;

    if (client.ws) {
      if (client.ws.readyState === WebSocket.OPEN && !client.disconnectedAt) {
        isConnected = true;
      } else {
        discAt = client.disconnectedAt || client.lastSeen || now;
        if (now - discAt > 8000) {
          return;
        }
        isConnected = false;
      }
    } else if (client.disconnectedAt) {
      if (now - client.disconnectedAt > 8000) {
        return;
      }
      isConnected = false;
    } else {
      if (now - client.lastSeen > 8000) {
        return;
      }
      isConnected = true;
    }

    byId.set(client.deviceId, {
      id: client.deviceId,
      name: client.deviceName,
      type: client.deviceType,
      lastSeen: client.lastSeen,
      roomId: client.roomId,
      connected: isConnected,
      disconnectedAt: isConnected ? undefined : discAt,
    });
  });
  return Array.from(byId.values());
}

export function prune(): void {
  const now = Date.now();
  const roomsToBroadcast = new Set<string>();
  globalDevices.forEach((client, id) => {
    const wsClosed =
      Boolean(client.disconnectedAt) ||
      Boolean(client.ws && (client.ws.readyState === WebSocket.CLOSED || client.ws.readyState === WebSocket.CLOSING));
    if (wsClosed) {
      if (!client.disconnectedAt) {
        client.disconnectedAt = client.lastSeen || now;
        client.connected = false;
      }
      if (now - client.disconnectedAt > 8000) {
        globalDevices.delete(id);
        const r = rooms.get(client.roomId);
        r?.delete(id);
        roomsToBroadcast.add(client.roomId);
      }
      return;
    }

    const httpExpired = !client.ws && now - client.lastSeen > 8000;
    if (httpExpired) {
      globalDevices.delete(id);
      const r = rooms.get(client.roomId);
      r?.delete(id);
      roomsToBroadcast.add(client.roomId);
    }
  });
  roomsToBroadcast.forEach((roomId) => broadcastRoomDevices(roomId));
}

let activePruneTimer: ReturnType<typeof setInterval> | null = null;

export function startPruneTimer(): () => void {
  if (!activePruneTimer) {
    activePruneTimer = setInterval(prune, 1000);
    if (typeof activePruneTimer.unref === 'function') {
      activePruneTimer.unref();
    }
  }
  return () => {
    if (activePruneTimer) {
      clearInterval(activePruneTimer);
      activePruneTimer = null;
    }
  };
}

export function broadcastRoomDevices(roomId: string): void {
  const deviceList = getAllActiveDevicesList();
  const payload = JSON.stringify({
    type: 'device_list',
    roomId,
    devices: deviceList,
  });

  globalDevices.forEach((client) => {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(payload);
      } catch (_) {}
    }
  });
}

export function recordAndBroadcastCommand(
  roomId: string,
  fromDevice: string,
  command: PlaybackCommandPayload,
  targetDeviceId?: string,
  msgId?: string,
  cseq?: number
): { delivered: boolean; screenCount: number } {
  const uniqueId = msgId || `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const resolvedCseq = typeof cseq === 'number' ? cseq : (typeof (command as any)?.cseq === 'number' ? (command as any).cseq : undefined);
  const isDuplicate = seenCommandIds.has(uniqueId);
  if (!isDuplicate) {
    seenCommandIds.add(uniqueId);
    if (seenCommandIds.size > 500) {
      const first = seenCommandIds.values().next().value;
      if (first) {
        seenCommandIds.delete(first);
        commandSeqById.delete(first);
      }
    }

    commandSeqCounter += 1;
    commandSeqById.set(uniqueId, commandSeqCounter);
    const queued: QueuedCommand = {
      seq: commandSeqCounter,
      cseq: resolvedCseq,
      id: uniqueId,
      roomId,
      fromDevice,
      targetDeviceId,
      command,
      timestamp: Date.now(),
    };
    commandHistory.push(queued);
    if (commandHistory.length > 100) commandHistory.shift();
  }

  const cmdSeq = commandSeqById.get(uniqueId) ?? commandSeqCounter;

  const forwardPayload = JSON.stringify({
    type: 'command',
    id: uniqueId,
    seq: cmdSeq,
    cseq: resolvedCseq,
    fromDevice,
    command,
  });

  let screensReached = 0;
  globalDevices.forEach((client) => {
    const isScreen = client.deviceType === 'screen' || client.deviceType === 'hybrid';
    const matchesTarget = targetDeviceId ? client.deviceId === targetDeviceId : isScreen;
    const minAllowedSeq = firstJoinSeqByDevice.get(client.deviceId) ?? 0;
    if (
      client.deviceId !== fromDevice &&
      matchesTarget &&
      cmdSeq > minAllowedSeq &&
      client.ws &&
      client.ws.readyState === WebSocket.OPEN &&
      !client.disconnectedAt
    ) {
      try {
        client.ws.send(forwardPayload);
        lastDeliveredSeqByDevice.set(
          client.deviceId,
          Math.max(lastDeliveredSeqByDevice.get(client.deviceId) || 0, cmdSeq)
        );
        screensReached++;
      } catch (_) {}
    }
  });

  return { delivered: screensReached > 0, screenCount: screensReached };
}

export function recordAndBroadcastState(
  roomId: string,
  fromDevice: string,
  state: PlaybackStatePayload
): void {
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
      try {
        client.ws.send(statePayload);
      } catch (_) {}
    }
  });
}

export function setLatestRemoteJoin(event: RemoteJoinEvent | null): void {
  latestRemoteJoinEvent = event;
}

export function incrementCommandSeq(): number {
  commandSeqCounter += 1;
  return commandSeqCounter;
}
