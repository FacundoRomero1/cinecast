import { WebSocket } from 'ws';

export interface ConnectedClient {
  ws?: WebSocket | undefined;
  roomId: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'screen' | 'remote' | 'hybrid';
  lastSeen: number;
}

export type PlaybackCommandPayload = Record<string, unknown>;
export type PlaybackStatePayload = Record<string, unknown>;

export interface QueuedCommand {
  seq: number;
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
}

// Map of roomId -> Map<deviceId, ConnectedClient>
export const rooms = new Map<string, Map<string, ConnectedClient>>();

// Also keep a global registry of all active devices on this server so phone & PC always find each other
export const globalDevices = new Map<string, ConnectedClient>();

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
  const active: ActiveDeviceSummary[] = [];
  globalDevices.forEach((client, id) => {
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
  msgId?: string
): void {
  const uniqueId = msgId || `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  if (seenCommandIds.has(uniqueId)) return;
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
  if (commandHistory.length > 100) commandHistory.shift();

  const forwardPayload = JSON.stringify({
    type: 'command',
    id: uniqueId,
    seq: commandSeqCounter,
    fromDevice,
    command,
  });

  globalDevices.forEach((client) => {
    if (client.deviceId !== fromDevice && client.ws && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(forwardPayload);
      } catch (_) {}
    }
  });
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

export function prune(): void {
  getAllActiveDevicesList();
}
