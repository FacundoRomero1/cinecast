import { deviceSync } from '../services/deviceSync';
import { DeviceInfo } from '../types';

declare global {
  const __BUILD_ID__: string;
}

export interface CommandLogEntry {
  timestamp: string;
  action: string;
}

export interface ConnectionTestStep {
  name: string;
  ok: boolean;
  message: string;
}

let lastSentCommand: CommandLogEntry | null = null;
let lastReceivedCommand: CommandLogEntry | null = null;

// Escuchar comandos entrantes directamente desde el servicio público
try {
  deviceSync.onCommand((cmd) => {
    if (cmd && cmd.action) {
      recordReceivedCommand(cmd.action);
    }
  });
} catch (_) {}

export function recordSentCommand(action: string): void {
  lastSentCommand = {
    timestamp: new Date().toLocaleTimeString(),
    action,
  };
}

export function recordReceivedCommand(action: string): void {
  lastReceivedCommand = {
    timestamp: new Date().toLocaleTimeString(),
    action,
  };
}

export function getLastSentCommand(): CommandLogEntry | null {
  return lastSentCommand;
}

export function getLastReceivedCommand(): CommandLogEntry | null {
  return lastReceivedCommand;
}

export function getClientBuildId(): string {
  if (typeof __BUILD_ID__ !== 'undefined') {
    return __BUILD_ID__;
  }
  return 'desconocido';
}

export async function fetchServerHealth(): Promise<{ buildId: string; status: string }> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { buildId: 'desconocido', status: `Error HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      buildId: typeof data?.buildId === 'string' ? data.buildId : 'desconocido',
      status: 'ok',
    };
  } catch (err: any) {
    return { buildId: 'desconocido', status: err?.message || 'Error de red' };
  }
}

export function getWebSocketStatus(): string {
  try {
    const ws = (deviceSync as any).ws as WebSocket | null;
    if (ws) {
      switch (ws.readyState) {
        case 0:
          return 'Conectando (CONNECTING)';
        case 1:
          return 'Conectado (OPEN)';
        case 2:
          return 'Cerrando (CLOSING)';
        case 3:
          return 'Cerrado (CLOSED)';
      }
    }
    if ((deviceSync as any).isConnected) {
      return 'Conectado';
    }
  } catch (_) {}
  return 'Desconectado';
}

export async function checkServiceWorkerRegistered(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg);
    } catch (_) {}
  }
  return false;
}

export async function clearCacheAndReload(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  } catch (_) {}
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export async function runConnectionTest(options: {
  roomId: string;
  deviceId: string;
  deviceName: string;
  deviceType: string;
}): Promise<ConnectionTestStep[]> {
  const steps: ConnectionTestStep[] = [];

  // 1. health
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      steps.push({
        name: 'health',
        ok: true,
        message: `HTTP 200 (buildId: ${data?.buildId || 'ok'})`,
      });
    } else {
      steps.push({
        name: 'health',
        ok: false,
        message: `HTTP ${res.status}: ${res.statusText || 'Error'}`,
      });
    }
  } catch (err: any) {
    steps.push({
      name: 'health',
      ok: false,
      message: err?.message || 'Error de conexión',
    });
  }

  // 2. sync/join
  try {
    const res = await fetch('/api/sync/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: options.roomId,
        deviceId: options.deviceId,
        deviceName: options.deviceName,
        deviceType: options.deviceType,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      steps.push({
        name: 'sync/join',
        ok: true,
        message: 'HTTP 200 (registro en sala correcto)',
      });
    } else {
      const txt = await res.text().catch(() => '');
      steps.push({
        name: 'sync/join',
        ok: false,
        message: `HTTP ${res.status}: ${txt || res.statusText}`,
      });
    }
  } catch (err: any) {
    steps.push({
      name: 'sync/join',
      ok: false,
      message: err?.message || 'Error de conexión',
    });
  }

  // 3. sync/poll
  try {
    const q = new URLSearchParams({
      roomId: options.roomId,
      deviceId: options.deviceId,
      since: '0',
    });
    const res = await fetch(`/api/sync/poll?${q.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      steps.push({
        name: 'sync/poll',
        ok: true,
        message: 'HTTP 200 (polling HTTP operativo)',
      });
    } else {
      const txt = await res.text().catch(() => '');
      steps.push({
        name: 'sync/poll',
        ok: false,
        message: `HTTP ${res.status}: ${txt || res.statusText}`,
      });
    }
  } catch (err: any) {
    steps.push({
      name: 'sync/poll',
      ok: false,
      message: err?.message || 'Error de conexión',
    });
  }

  return steps;
}
