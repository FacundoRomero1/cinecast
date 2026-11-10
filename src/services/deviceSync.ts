import { DeviceInfo, DeviceType, PlaybackState, RemoteCommand } from '../types';

export type CommandHandler = (command: RemoteCommand, fromDevice?: string) => void;
export type StateSyncHandler = (state: PlaybackState, fromDevice?: string) => void;
export type DevicesUpdateHandler = (devices: DeviceInfo[]) => void;

class DeviceSyncService {
  private ws: WebSocket | null = null;
  private roomId: string = 'cine-home-1';
  private deviceId: string = '';
  private deviceName: string = '';
  private deviceType: DeviceType = 'hybrid';
  private broadcastChannel: BroadcastChannel | null = null;
  private isConnected: boolean = false;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private httpPollTimer: any = null;
  private lastSeq: number = 0;
  private executedCommandIds: Set<string> = new Set();

  private commandListeners: Set<CommandHandler> = new Set();
  private stateListeners: Set<StateSyncHandler> = new Set();
  private devicesListeners: Set<DevicesUpdateHandler> = new Set();
  private remoteConnectedListeners: Set<(deviceName: string) => void> = new Set();
  private watchHistoryListeners: Set<(items: any[]) => void> = new Set();
  private knownDevices: Map<string, DeviceInfo> = new Map();
  private lanIp: string = '';
  private lanPort: number = 3000;
  private wakeLockSentinel: any = null;

  constructor() {
    this.initDeviceId();
    this.initBroadcastChannel();
    this.fetchLocalIp();
    this.initLifecycleListeners();
  }

  public getApiBase(): string {
    if (typeof window !== 'undefined' && window.location.protocol !== 'file:' && window.location.host) {
      return '';
    }
    if (typeof window !== 'undefined') {
      const savedHost = localStorage.getItem('cinecast_last_server_host');
      if (savedHost) return `http://${savedHost}`;
    }
    return 'http://localhost:3000';
  }

  public async fetchLocalIp(): Promise<string> {
    if (this.lanIp && this.lanIp !== '127.0.0.1' && this.lanIp !== 'localhost') {
      return this.lanIp;
    }

    // 1. Prioridad absoluta: Electron IPC directo (acceso a adaptadores nativos del SO)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getLocalIp) {
      try {
        const electronIp = await (window as any).electronAPI.getLocalIp();
        if (electronIp && electronIp !== '127.0.0.1' && electronIp !== 'localhost') {
          this.lanIp = electronIp;
          return electronIp;
        }
      } catch (_) {}
    }

    // 2. Endpoint REST del servidor local / embebido
    try {
      const res = await fetch(`${this.getApiBase()}/api/local-ip`);
      if (res.ok) {
        const data = await res.json();
        if (data.ip && data.ip !== '127.0.0.1' && data.ip !== 'localhost') {
          this.lanIp = data.ip;
          if (data.port) this.lanPort = data.port;
          return data.ip;
        }
      }
    } catch (_) {}

    // 3. Fallback al hostname si no es localhost ni 127.0.0.1
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        this.lanIp = hostname;
        return hostname;
      }
    }

    return '';
  }

  public getLanIp(): string {
    if (this.lanIp && this.lanIp !== '127.0.0.1' && this.lanIp !== 'localhost') {
      return this.lanIp;
    }
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return hostname;
      }
    }
    return '';
  }

  public getPairingUrl(role = 'remote'): string {
    const ip = this.getLanIp();
    const port = this.lanPort || 3000;
    if (ip) {
      return `http://${ip}:${port}/?role=${role}&room=${this.roomId}`;
    }
    if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return `${window.location.origin}/?role=${role}&room=${this.roomId}`;
    }
    return `http://192.168.1.100:${port}/?role=${role}&room=${this.roomId}`;
  }

  private initDeviceId() {
    let id = localStorage.getItem('cinecast_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('cinecast_device_id', id);
    }
    this.deviceId = id;

    // Check URL parameters for room or role
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      this.roomId = roomFromUrl;
      localStorage.setItem('cinecast_room_id', roomFromUrl);
    } else {
      const savedRoom = localStorage.getItem('cinecast_room_id');
      if (savedRoom) this.roomId = savedRoom;
    }

    const roleFromUrl = params.get('role');
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    if (roleFromUrl === 'remote') {
      this.deviceType = 'remote';
      this.deviceName = 'Celular Control';
    } else if (roleFromUrl === 'screen') {
      this.deviceType = 'screen';
      this.deviceName = 'PC / Pantalla Principal';
    } else if (isMobileUA) {
      this.deviceType = 'remote';
      this.deviceName = 'Celular Control';
    } else {
      this.deviceType = 'screen';
      this.deviceName = 'PC / Pantalla Principal';
    }

    localStorage.setItem('cinecast_device_type', this.deviceType);
    localStorage.setItem('cinecast_device_name', this.deviceName);
  }

  private initBroadcastChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel('cinecast_local_bus_' + this.roomId);
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingRawMessage(event.data);
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported:', e);
    }

    // Storage fallback for cross-tab sync
    window.addEventListener('storage', (e) => {
      if (e.key === 'cinecast_cross_event_' + this.roomId && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          this.handleIncomingRawMessage(parsed);
        } catch (_) {}
      }
    });
  }

  private initLifecycleListeners() {
    if (typeof window === 'undefined') return;

    // Reconexión instantánea al desbloquear el teléfono o volver a la pestaña
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.connect();
        } else {
          this.sendHttpJoin();
          this.sendJoin();
        }
      }
    });

    // Reconexión inmediata si el teléfono recupera señal WiFi
    window.addEventListener('online', () => {
      this.connect();
    });

    // Reconexión al recuperar foco de la ventana
    window.addEventListener('focus', () => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
      }
    });
  }

  public async requestWakeLock() {
    try {
      if (
        typeof navigator !== 'undefined' &&
        'wakeLock' in navigator &&
        (navigator as any).wakeLock &&
        typeof (navigator as any).wakeLock.request === 'function'
      ) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      }
    } catch (_) {}
  }

  public releaseWakeLock() {
    try {
      if (this.wakeLockSentinel && typeof this.wakeLockSentinel.release === 'function') {
        this.wakeLockSentinel.release();
      }
    } catch (_) {}
    this.wakeLockSentinel = null;
  }

  public getCachedPlaybackState(): PlaybackState | null {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem('cinecast_last_playback_state_' + this.roomId);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }

  public connect(roomId?: string, deviceName?: string, deviceType?: DeviceType) {
    if (roomId) {
      this.roomId = roomId;
      localStorage.setItem('cinecast_room_id', roomId);
      this.initBroadcastChannel();
    }
    if (deviceName) {
      this.deviceName = deviceName;
      localStorage.setItem('cinecast_device_name', deviceName);
    }
    if (deviceType) {
      this.deviceType = deviceType;
      localStorage.setItem('cinecast_device_type', deviceType);
    }

    // 1. Register immediately over HTTP so it works even if WS is blocked by Brave/Proxy
    this.sendHttpJoin();
    this.startHttpPolling();

    // 2. Also open WebSocket for instant push
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host;
    if (!host || host === 'null' || window.location.protocol === 'file:') {
      const ip = this.getLanIp() || 'localhost';
      host = `${ip}:${this.lanPort || 3000}`;
    }
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.sendJoin();
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingRawMessage(msg);
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (_) {
      this.scheduleReconnect();
    }

    this.broadcastLocalPresence();
  }

  private async sendHttpJoin() {
    try {
      const res = await fetch(`${this.getApiBase()}/api/sync/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          deviceType: this.deviceType,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.seq === 'number' && data.seq > this.lastSeq) {
          this.lastSeq = data.seq;
        }
        if (Array.isArray(data.devices)) {
          this.handleIncomingRawMessage({ type: 'device_list', devices: data.devices });
        }
        if (data.state) {
          this.handleIncomingRawMessage({ type: 'sync_state', state: data.state });
        }
      }
    } catch (_) {}
  }

  private startHttpPolling() {
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
    }
    this.httpPollTimer = setInterval(async () => {
      try {
        const q = new URLSearchParams({
          roomId: this.roomId,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          deviceType: this.deviceType,
          since: String(this.lastSeq),
        });
        const res = await fetch(`${this.getApiBase()}/api/sync/poll?${q.toString()}`);
        if (!res.ok) return;
        const data = await res.json();

        if (Array.isArray(data.devices)) {
          this.handleIncomingRawMessage({ type: 'device_list', devices: data.devices });
        }

        if (data.remoteJoined && data.remoteJoined.deviceId !== this.deviceId) {
          this.handleIncomingRawMessage({
            type: 'remote_connected',
            fromDevice: data.remoteJoined.deviceId,
            deviceName: data.remoteJoined.deviceName,
          });
        }

        if (Array.isArray(data.commands) && data.commands.length > 0) {
          for (const item of data.commands) {
            if (item.seq > this.lastSeq) {
              this.lastSeq = item.seq;
            }
            this.handleIncomingRawMessage({
              type: 'command',
              id: item.id,
              seq: item.seq,
              fromDevice: item.fromDevice,
              command: item.command,
            });
          }
        }

        if (typeof data.seq === 'number' && data.seq > this.lastSeq) {
          this.lastSeq = data.seq;
        }

        if (data.state && this.deviceType === 'remote') {
          this.handleIncomingRawMessage({
            type: 'sync_state',
            state: data.state,
          });
        }
      } catch (_) {}
    }, 800);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected) {
        this.connect();
      }
    }, 4000);
  }

  private sendJoin() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'join',
          roomId: this.roomId,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          deviceType: this.deviceType,
        })
      );
    }
  }

  private broadcastLocalPresence() {
    const info: DeviceInfo = {
      id: this.deviceId,
      name: this.deviceName,
      type: this.deviceType,
      lastSeen: Date.now(),
      isCurrent: true,
    };
    this.knownDevices.set(this.deviceId, info);
    this.notifyDevicesListeners();
  }

  private markCommandExecuted(cmdId?: string): boolean {
    if (!cmdId) return true;
    if (this.executedCommandIds.has(cmdId)) {
      return false;
    }
    this.executedCommandIds.add(cmdId);
    if (this.executedCommandIds.size > 300) {
      const oldest = this.executedCommandIds.values().next().value;
      if (oldest) this.executedCommandIds.delete(oldest);
    }
    return true;
  }

  private handleIncomingRawMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;

    if (typeof msg.seq === 'number' && msg.seq > this.lastSeq) {
      this.lastSeq = msg.seq;
    }

    if (msg.type === 'device_list' && Array.isArray(msg.devices)) {
      this.knownDevices.clear();
      msg.devices.forEach((d: DeviceInfo) => {
        this.knownDevices.set(d.id, {
          ...d,
          isCurrent: d.id === this.deviceId,
        });
      });
      this.broadcastLocalPresence();
      this.notifyDevicesListeners();
    } else if (msg.type === 'remote_connected') {
      if (msg.fromDevice !== this.deviceId) {
        this.remoteConnectedListeners.forEach((fn) => fn(msg.deviceName || 'Celular'));
      }
    } else if (msg.type === 'command' && msg.command) {
      if (msg.fromDevice !== this.deviceId) {
        if (this.markCommandExecuted(msg.id)) {
          this.commandListeners.forEach((fn) => fn(msg.command, msg.fromDevice));
        }
      }
    } else if (msg.type === 'sync_state' && msg.state) {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('cinecast_last_playback_state_' + this.roomId, JSON.stringify(msg.state));
        } catch (_) {}
      }
      if (msg.fromDevice !== this.deviceId) {
        this.stateListeners.forEach((fn) => fn(msg.state, msg.fromDevice));
      }
    } else if (msg.type === 'watchHistoryUpdated' && Array.isArray(msg.items)) {
      this.watchHistoryListeners.forEach((fn) => {
        try { fn(msg.items); } catch (_) {}
      });
    }
  }

  public sendCommand(command: RemoteCommand, targetDeviceId?: string) {
    const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.markCommandExecuted(cmdId);

    const payload = {
      type: 'command',
      id: cmdId,
      roomId: this.roomId,
      fromDevice: this.deviceId,
      targetDeviceId,
      command,
    };

    // 1. Send via WebSocket if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (_) {}
    }

    // 2. Always send via HTTP POST to guarantee delivery even if WS is blocked
    fetch(`${this.getApiBase()}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});

    // 3. Broadcast via BroadcastChannel and localStorage for same-origin tabs/windows
    try {
      this.broadcastChannel?.postMessage(payload);
      localStorage.setItem(
        'cinecast_cross_event_' + this.roomId,
        JSON.stringify({
          ...payload,
          _time: Date.now(),
        })
      );
    } catch (_) {}
  }

  public broadcastPlaybackState(state: PlaybackState) {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('cinecast_last_playback_state_' + this.roomId, JSON.stringify(state));
      } catch (_) {}
    }

    const payload = {
      type: 'sync_state',
      roomId: this.roomId,
      fromDevice: this.deviceId,
      state,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (_) {}
    }

    fetch(`${this.getApiBase()}/api/sync/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});

    try {
      this.broadcastChannel?.postMessage(payload);
      localStorage.setItem(
        'cinecast_cross_event_' + this.roomId,
        JSON.stringify({
          ...payload,
          _time: Date.now(),
        })
      );
    } catch (_) {}
  }

  public onCommand(handler: CommandHandler) {
    this.commandListeners.add(handler);
    return () => {
      this.commandListeners.delete(handler);
    };
  }

  public onStateSync(handler: StateSyncHandler) {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  public onDevicesUpdate(handler: DevicesUpdateHandler) {
    this.devicesListeners.add(handler);
    handler(this.getDevices());
    return () => {
      this.devicesListeners.delete(handler);
    };
  }

  public onRemoteConnected(handler: (deviceName: string) => void) {
    this.remoteConnectedListeners.add(handler);
    return () => {
      this.remoteConnectedListeners.delete(handler);
    };
  }

  public onWatchHistory(handler: (items: any[]) => void) {
    this.watchHistoryListeners.add(handler);
    return () => {
      this.watchHistoryListeners.delete(handler);
    };
  }

  private notifyDevicesListeners() {
    const list = this.getDevices();
    this.devicesListeners.forEach((fn) => fn(list));
  }

  public getDevices(): DeviceInfo[] {
    return Array.from(this.knownDevices.values());
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getDeviceName(): string {
    return this.deviceName;
  }

  public getDeviceType(): DeviceType {
    return this.deviceType;
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public setDeviceName(name: string) {
    this.deviceName = name;
    localStorage.setItem('cinecast_device_name', name);
    this.sendJoin();
    this.sendHttpJoin();
    this.broadcastLocalPresence();
  }

  public setDeviceType(type: DeviceType) {
    this.deviceType = type;
    localStorage.setItem('cinecast_device_type', type);
    this.sendJoin();
    this.sendHttpJoin();
    this.broadcastLocalPresence();
  }

  public setRoomId(roomId: string) {
    this.roomId = roomId;
    localStorage.setItem('cinecast_room_id', roomId);
    this.connect(roomId);
  }
}

export const deviceSync = new DeviceSyncService();
