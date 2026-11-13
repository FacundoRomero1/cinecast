import { DeviceInfo, DeviceType, PlaybackState, RemoteCommand } from '../types';

export type CommandHandler = (command: RemoteCommand, fromDevice?: string) => void;
export type StateSyncHandler = (state: PlaybackState, fromDevice?: string) => void;
export type DevicesUpdateHandler = (devices: DeviceInfo[]) => void;

export interface CommandDiagnosticEntry {
  id: string;
  action: string;
  timestamp: number;
  status: 'confirmed' | 'retrying' | 'failed';
  rttMs?: number;
  reason?: string;
  retries: number;
}

export interface SyncTelemetry {
  enviados: number;
  acks: number;
  reintentos: number;
  fallos: number;
  reconexiones: number;
  rttP50: number;
  rttP95: number;
  transporte: 'ws' | 'http' | 'none';
  visibilidad: string;
}

export interface ConnectionStatusInfo {
  state: 'connected' | 'reconnecting' | 'disconnected';
  latencyMs: number;
  transport: 'ws' | 'http' | 'none';
  hasData: boolean;
}

export class DeviceSyncService {
  private ws: WebSocket | null = null;
  private roomId: string = 'cine-home-1';
  private deviceId: string = '';
  private deviceName: string = '';
  private deviceType: DeviceType = 'hybrid';
  private broadcastChannel: BroadcastChannel | null = null;
  public isConnected: boolean = false;
  private reconnectTimer: any = null;
  private reconnectDelay: number = 500; // 0.5s -> 8s backoff
  private wsConnectingFallbackTimer: any = null;
  private pingTimer: any = null;
  private httpPollTimer: any = null;
  private lastSeq: number = 0;
  private executedCommandIds: Set<string> = new Set();

  private commandListeners: Set<CommandHandler> = new Set();
  private stateListeners: Set<StateSyncHandler> = new Set();
  private devicesListeners: Set<DevicesUpdateHandler> = new Set();
  private remoteConnectedListeners: Set<(deviceName: string) => void> = new Set();
  private watchHistoryListeners: Set<(items: any[]) => void> = new Set();
  private connectionStatusListeners: Set<(info: ConnectionStatusInfo) => void> = new Set();
  private commandStatusListeners: Set<(info: { id: string; status: 'confirmed' | 'retrying' | 'failed'; rttMs?: number; reason?: string }) => void> = new Set();

  private knownDevices: Map<string, DeviceInfo> = new Map();
  private lanIp: string = '';
  private lanPort: number = 3000;
  private wakeLockSentinel: any = null;

  // Entrega garantizada y reintentos
  private pendingCommands: Map<
    string,
    {
      id: string;
      command: RemoteCommand;
      targetDeviceId?: string;
      sentAt: number;
      retries: number;
      retryTimer: any;
      expireTimer: any;
    }
  > = new Map();

  // Cola de reenvío para los últimos 3 comandos de navegación/transporte
  private offlineCommandQueue: Array<{
    id: string;
    command: RemoteCommand;
    targetDeviceId?: string;
    sentAt: number;
  }> = [];

  // Diagnósticos y telemetría
  private commandDiagnostics: CommandDiagnosticEntry[] = [];
  private rttHistory: number[] = [];
  private currentLatencyMs: number = 0;
  private lastPingSentAt: number = 0;
  private telemetryCounters = {
    enviados: 0,
    acks: 0,
    reintentos: 0,
    fallos: 0,
    reconexiones: 0,
  };
  private telemetryTimer: any = null;

  // Vigilancia de estado en celular (alerta si pasan >3s sin estado)
  private lastStateReceivedTime: number = Date.now();
  private hasReceivedState: boolean = false;
  private stateWatchdogTimer: any = null;

  constructor() {
    this.initDeviceId();
    this.initBroadcastChannel();
    this.fetchLocalIp();
    this.initLifecycleListeners();
    this.startStateWatchdog();
    this.startTelemetryReporting();
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

    if (typeof window !== 'undefined' && (window as any).electronAPI?.getLocalIp) {
      try {
        const electronIp = await (window as any).electronAPI.getLocalIp();
        if (electronIp && electronIp !== '127.0.0.1' && electronIp !== 'localhost') {
          this.lanIp = electronIp;
          return electronIp;
        }
      } catch (_) {}
    }

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
    if (
      typeof window !== 'undefined' &&
      window.location.hostname &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
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

    const triggerImmediateReconnect = () => {
      this.reconnectDelay = 500;
      if (this.ws) {
        try {
          this.ws.close();
        } catch (_) {}
        this.ws = null;
      }
      this.scheduleReconnect(true);
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerImmediateReconnect();
      }
    });

    window.addEventListener('online', triggerImmediateReconnect);
    window.addEventListener('pageshow', triggerImmediateReconnect);
    window.addEventListener('focus', triggerImmediateReconnect);
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

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Regla de un solo transporte por vez: apagar HTTP polling previo
    this.stopHttpPolling();
    if (this.wsConnectingFallbackTimer) {
      clearTimeout(this.wsConnectingFallbackTimer);
      this.wsConnectingFallbackTimer = null;
    }

    // Si WebSocket no logra conectar en 5 s, encender HTTP polling como respaldo
    this.wsConnectingFallbackTimer = setTimeout(() => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.sendHttpJoin();
        this.startHttpPolling();
        this.notifyConnectionStatus('reconnecting', 'http');
      }
    }, 5000);

    // Conectar WebSocket principal
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
        this.reconnectDelay = 500; // Reset backoff
        if (this.wsConnectingFallbackTimer) {
          clearTimeout(this.wsConnectingFallbackTimer);
          this.wsConnectingFallbackTimer = null;
        }
        this.stopHttpPolling(); // Apagar polling HTTP apenas vuelve el WebSocket
        this.sendJoin();
        this.startHeartbeat();
        this.flushOfflineCommandQueue(); // Reenviar cola offline
        this.notifyConnectionStatus('connected', 'ws');
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
        this.notifyConnectionStatus('reconnecting', 'none');
        this.scheduleReconnect(false);
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (_) {
      this.scheduleReconnect(false);
    }

    this.broadcastLocalPresence();
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.wsConnectingFallbackTimer) {
      clearTimeout(this.wsConnectingFallbackTimer);
      this.wsConnectingFallbackTimer = null;
    }
    this.stopHeartbeat();
    this.stopHttpPolling();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.notifyConnectionStatus('disconnected', 'none');
  }

  private scheduleReconnect(immediate = false) {
    if (this.reconnectTimer) {
      if (immediate) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      } else {
        return;
      }
    }

    const delay = immediate ? 0 : this.reconnectDelay;
    this.notifyConnectionStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!immediate) {
        this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2);
      }
      this.telemetryCounters.reconexiones++;
      this.connect();
    }, delay);
  }

  private sendHttpJoin() {
    fetch(`${this.getApiBase()}/api/sync/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: this.roomId,
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        deviceType: this.deviceType,
        lastSeq: this.lastSeq,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data?.seq === 'number' && data.seq > this.lastSeq) {
          this.lastSeq = data.seq;
        }
        if (Array.isArray(data?.devices)) {
          this.handleIncomingRawMessage({ type: 'device_list', devices: data.devices });
        }
        if (data?.state) {
          this.handleIncomingRawMessage({ type: 'sync_state', state: data.state });
        }
      })
      .catch(() => {});
  }

  private startHttpPolling() {
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
    }
    this.httpPollTimer = setInterval(async () => {
      // Si el WebSocket ya está abierto, apagar polling HTTP inmediatamente
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.stopHttpPolling();
        return;
      }

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
    }, 1000);
  }

  private stopHttpPolling() {
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: this.lastPingSentAt }));
      }
    }, 10000);
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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
          lastSeq: this.lastSeq,
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
    if (this.executedCommandIds.size > 500) {
      const oldest = this.executedCommandIds.values().next().value;
      if (oldest) this.executedCommandIds.delete(oldest);
    }
    return true;
  }

  private isTransportOrNavAction(action: string): boolean {
    const set = new Set([
      'seekRelative',
      'seek',
      'togglePlay',
      'play',
      'pause',
      'navigateUp',
      'navigateDown',
      'navigateLeft',
      'navigateRight',
      'select',
      'enter',
      'back',
      'nextEpisode',
      'prevEpisode',
      'jumpToEpisode',
    ]);
    return set.has(action);
  }

  private handleAck(cmdId: string, ackPayload?: any) {
    const pending = this.pendingCommands.get(cmdId);
    if (pending) {
      clearInterval(pending.retryTimer);
      clearTimeout(pending.expireTimer);
      this.pendingCommands.delete(cmdId);
    }
    const rtt = pending ? Math.max(0, Date.now() - pending.sentAt) : 0;
    this.telemetryCounters.acks++;
    if (rtt > 0) {
      this.rttHistory.push(rtt);
      if (this.rttHistory.length > 50) this.rttHistory.shift();
      this.currentLatencyMs = rtt;
      this.notifyConnectionStatus(this.isConnected ? 'connected' : 'reconnecting');
    }
    const entry = this.commandDiagnostics.find((c) => c.id === cmdId);
    if (entry) {
      entry.status = 'confirmed';
      entry.rttMs = rtt;
    }
    this.notifyCommandStatus({ id: cmdId, status: 'confirmed', rttMs: rtt });
  }

  private handleNack(cmdId: string, nackPayload?: any) {
    const reason = nackPayload?.reason || 'sin-pantalla';
    const entry = this.commandDiagnostics.find((c) => c.id === cmdId);
    if (entry) {
      entry.reason = reason;
    }
    this.notifyCommandStatus({ id: cmdId, status: 'retrying', reason });
  }

  private recordCommandDiagnostic(entry: CommandDiagnosticEntry) {
    this.commandDiagnostics.unshift(entry);
    if (this.commandDiagnostics.length > 50) {
      this.commandDiagnostics.pop();
    }
  }

  private notifyCommandStatus(info: {
    id: string;
    status: 'confirmed' | 'retrying' | 'failed';
    rttMs?: number;
    reason?: string;
  }) {
    this.commandStatusListeners.forEach((fn) => {
      try {
        fn(info);
      } catch (_) {}
    });
  }

  private notifyConnectionStatus(
    stateOverride?: 'connected' | 'reconnecting' | 'disconnected',
    transportOverride?: 'ws' | 'http' | 'none'
  ) {
    const transport =
      transportOverride ||
      (this.ws && this.ws.readyState === WebSocket.OPEN
        ? 'ws'
        : this.httpPollTimer
        ? 'http'
        : 'none');
    const state =
      stateOverride ||
      (this.isConnected && this.ws?.readyState === WebSocket.OPEN
        ? 'connected'
        : this.httpPollTimer
        ? 'reconnecting'
        : 'disconnected');

    const info: ConnectionStatusInfo = {
      state,
      latencyMs: this.currentLatencyMs,
      transport,
      hasData: Date.now() - this.lastStateReceivedTime <= 3000,
    };

    this.connectionStatusListeners.forEach((fn) => {
      try {
        fn(info);
      } catch (_) {}
    });
  }

  private flushOfflineCommandQueue() {
    const now = Date.now();
    const toSend = this.offlineCommandQueue.filter((item) => now - item.sentAt <= 8000);
    this.offlineCommandQueue = [];
    for (const item of toSend) {
      this.sendCommand(item.command, item.targetDeviceId);
    }
  }

  private startStateWatchdog() {
    if (this.stateWatchdogTimer) clearInterval(this.stateWatchdogTimer);
    this.stateWatchdogTimer = setInterval(() => {
      if (this.deviceType === 'remote' && this.isConnected) {
        const elapsed = Date.now() - this.lastStateReceivedTime;
        if (elapsed > 3000 && this.hasReceivedState) {
          this.notifyConnectionStatus(this.isConnected ? 'connected' : 'reconnecting');
          // Forzar resincronización de estado
          this.sendJoin();
          if (this.httpPollTimer) {
            this.sendHttpJoin();
          }
        }
      }
    }, 1500);
  }

  private startTelemetryReporting() {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = setInterval(() => {
      if (typeof window === 'undefined') return;
      const sortedRtt = [...this.rttHistory].sort((a, b) => a - b);
      const rttP50 = sortedRtt.length > 0 ? sortedRtt[Math.floor(sortedRtt.length * 0.5)] : 0;
      const rttP95 = sortedRtt.length > 0 ? sortedRtt[Math.floor(sortedRtt.length * 0.95)] : 0;

      const summary: SyncTelemetry = {
        enviados: this.telemetryCounters.enviados,
        acks: this.telemetryCounters.acks,
        reintentos: this.telemetryCounters.reintentos,
        fallos: this.telemetryCounters.fallos,
        reconexiones: this.telemetryCounters.reconexiones,
        rttP50,
        rttP95,
        transporte:
          this.ws && this.ws.readyState === WebSocket.OPEN
            ? 'ws'
            : this.httpPollTimer
            ? 'http'
            : 'none',
        visibilidad: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      };

      fetch(`${this.getApiBase()}/api/client-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'sync_telemetry',
          level: 'info',
          source: 'deviceSync',
          ...summary,
        }),
      }).catch(() => {});
    }, 30000);

    if (typeof this.telemetryTimer?.unref === 'function') {
      this.telemetryTimer.unref();
    }
  }

  private handleIncomingRawMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;

    if (typeof msg.seq === 'number' && msg.seq > this.lastSeq) {
      this.lastSeq = msg.seq;
    }

    if (msg.type === 'ack' && msg.id) {
      this.handleAck(msg.id, msg);
    } else if (msg.type === 'nack' && msg.id) {
      this.handleNack(msg.id, msg);
    } else if (msg.type === 'pong') {
      if (this.lastPingSentAt > 0) {
        this.currentLatencyMs = Math.max(1, Date.now() - this.lastPingSentAt);
        this.notifyConnectionStatus('connected', 'ws');
      }
    } else if (msg.type === 'device_list' && Array.isArray(msg.devices)) {
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
      this.lastStateReceivedTime = Date.now();
      this.hasReceivedState = true;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'cinecast_last_playback_state_' + this.roomId,
            JSON.stringify(msg.state)
          );
        } catch (_) {}
      }
      if (msg.fromDevice !== this.deviceId) {
        this.stateListeners.forEach((fn) => fn(msg.state, msg.fromDevice));
      }
      this.notifyConnectionStatus();
    } else if (msg.type === 'watchHistoryUpdated' && Array.isArray(msg.items)) {
      this.watchHistoryListeners.forEach((fn) => {
        try {
          fn(msg.items);
        } catch (_) {}
      });
    }
  }

  public sendCommand(command: RemoteCommand, targetDeviceId?: string) {
    const cmdId =
      (command as any)?.__chaosId ||
      `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.markCommandExecuted(cmdId);
    this.telemetryCounters.enviados++;

    const entry: CommandDiagnosticEntry = {
      id: cmdId,
      action: command.action,
      timestamp: Date.now(),
      status: 'retrying',
      retries: 0,
    };
    this.recordCommandDiagnostic(entry);

    const payload = {
      type: 'command',
      id: cmdId,
      roomId: this.roomId,
      fromDevice: this.deviceId,
      targetDeviceId,
      command,
    };

    const doSend = (): boolean => {
      // 1. WebSocket si está OPEN
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(payload));
          return true;
        } catch (_) {}
      } else if (this.httpPollTimer) {
        // 2. Solo HTTP si está en fallback activo
        fetch(`${this.getApiBase()}/api/sync/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data?.ack) {
              this.handleAck(cmdId, data.ack);
            } else if (data?.nack) {
              this.handleNack(cmdId, data.nack);
            }
          })
          .catch(() => {});
        return true;
      }
      return false;
    };

    doSend();

    // Reintentos cada 700 ms hasta 5 s
    const sentAt = Date.now();
    let retries = 0;
    const retryTimer = setInterval(() => {
      const elapsed = Date.now() - sentAt;
      if (elapsed >= 5000) {
        clearInterval(retryTimer);
        return;
      }
      retries++;
      this.telemetryCounters.reintentos++;
      entry.retries = retries;
      this.notifyCommandStatus({ id: cmdId, status: 'retrying' });
      doSend();
    }, 700);

    const expireTimer = setTimeout(() => {
      clearInterval(retryTimer);
      if (this.pendingCommands.has(cmdId)) {
        this.pendingCommands.delete(cmdId);
        this.telemetryCounters.fallos++;
        entry.status = 'failed';
        entry.reason = 'timeout-5s';
        this.notifyCommandStatus({
          id: cmdId,
          status: 'failed',
          reason: 'No llegó. Reintentá',
        });

        // Encolar si es comando de navegación o transporte (máximo 3)
        if (this.isTransportOrNavAction(command.action)) {
          this.offlineCommandQueue.push({ id: cmdId, command, targetDeviceId, sentAt });
          if (this.offlineCommandQueue.length > 3) {
            this.offlineCommandQueue.shift();
          }
        }
      }
    }, 5000);

    this.pendingCommands.set(cmdId, {
      id: cmdId,
      command,
      targetDeviceId,
      sentAt,
      retries: 0,
      retryTimer,
      expireTimer,
    });

    // 3. BroadcastChannel para sincronización misma máquina
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

  private lastStateBroadcastTime: number = 0;
  private pendingBroadcastTimer: any = null;
  private lastBroadcastedStateSummary: string = '';

  private sendBroadcastStatePayload(state: PlaybackState) {
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
    } else {
      fetch(`${this.getApiBase()}/api/sync/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }

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
    const now = Date.now();
    const summary = `${state.isPlaying}:${state.mediaId}:${state.episodeId}:${state.isStandby}`;
    const isDiscreteChange = summary !== this.lastBroadcastedStateSummary;

    // Si cambió el estado general (play/pause/media/standby) o pasaron >= 1000ms
    if (isDiscreteChange || now - this.lastStateBroadcastTime >= 1000) {
      if (this.pendingBroadcastTimer) {
        clearTimeout(this.pendingBroadcastTimer);
        this.pendingBroadcastTimer = null;
      }
      this.lastStateBroadcastTime = now;
      this.lastBroadcastedStateSummary = summary;
      this.sendBroadcastStatePayload(state);
      return;
    }

    // Debounce de 100ms para actualizaciones continuas de tiempo
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer);
    }
    this.pendingBroadcastTimer = setTimeout(() => {
      this.pendingBroadcastTimer = null;
      this.lastStateBroadcastTime = Date.now();
      this.lastBroadcastedStateSummary = summary;
      this.sendBroadcastStatePayload(state);
    }, 100);
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

  public onConnectionStatus(handler: (info: ConnectionStatusInfo) => void) {
    this.connectionStatusListeners.add(handler);
    this.notifyConnectionStatus();
    return () => {
      this.connectionStatusListeners.delete(handler);
    };
  }

  public onCommandStatus(
    handler: (info: {
      id: string;
      status: 'confirmed' | 'retrying' | 'failed';
      rttMs?: number;
      reason?: string;
    }) => void
  ) {
    this.commandStatusListeners.add(handler);
    return () => {
      this.commandStatusListeners.delete(handler);
    };
  }

  public getRecentCommandsDiagnostics(): CommandDiagnosticEntry[] {
    return [...this.commandDiagnostics];
  }

  public getSyncTelemetrySummary(): SyncTelemetry {
    const sortedRtt = [...this.rttHistory].sort((a, b) => a - b);
    const rttP50 = sortedRtt.length > 0 ? sortedRtt[Math.floor(sortedRtt.length * 0.5)] : 0;
    const rttP95 = sortedRtt.length > 0 ? sortedRtt[Math.floor(sortedRtt.length * 0.95)] : 0;
    return {
      enviados: this.telemetryCounters.enviados,
      acks: this.telemetryCounters.acks,
      reintentos: this.telemetryCounters.reintentos,
      fallos: this.telemetryCounters.fallos,
      reconexiones: this.telemetryCounters.reconexiones,
      rttP50,
      rttP95,
      transporte:
        this.ws && this.ws.readyState === WebSocket.OPEN
          ? 'ws'
          : this.httpPollTimer
          ? 'http'
          : 'none',
      visibilidad: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    };
  }

  public forceResync() {
    this.sendJoin();
    this.sendHttpJoin();
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
if (typeof window !== 'undefined') {
  (window as any).cinecastDeviceSync = deviceSync;
}
