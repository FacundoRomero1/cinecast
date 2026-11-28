/**
 * Capa de resolución híbrida de servidor para CineCast (PC / APK Teléfono / APK Android TV).
 *
 * - En Electron o web servida desde el propio backend (`http://localhost:3000`, `http://192.168.x.x:3000`):
 *   devuelve '' (mismo origen).
 * - En APK Capacitor (`https://localhost` sin puerto o `capacitor://localhost`):
 *   1. Prueba primero el servidor local de la PC en WiFi (`lanServerUrl`, timeout 1.8 s).
 *   2. Si la PC está apagada o estás en 4G/5G, hace fallback automático al servidor en la nube (`cloudServerUrl`).
 */

const LAN_SERVER_KEY = 'cinecast_lan_server_url';
const CLOUD_SERVER_KEY = 'cinecast_cloud_server_url';
const LEGACY_HOST_KEY = 'cinecast_last_server_host';
const DEFAULT_LAN_FALLBACK = 'http://192.168.18.39:3000';

export type BackendMode = 'same-origin' | 'lan' | 'cloud' | 'unconfigured';

export interface BackendConnectionState {
  mode: BackendMode;
  activeUrl: string;
  lanUrl: string;
  cloudUrl: string;
  isNativeApp: boolean;
  isAndroidTv: boolean;
  lastCheckedAt: number;
}

const listeners = new Set<(state: BackendConnectionState) => void>();

export function normalizeServerUrl(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let out = trimmed.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(out)) {
    // IPs locales -> http://, dominios públicos -> https://
    const isLocalIp = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$|^localhost(?::\d+)?$/i.test(out);
    out = `${isLocalIp ? 'http' : 'https'}://${out}`;
  }
  try {
    const u = new URL(out);
    const h = u.hostname.toLowerCase();
    // En Android APK, localhost / 127.0.0.1 apunta al propio teléfono (WebView de Capacitor), nunca a la PC
    if (isCapacitorNative() && (h === 'localhost' || h === '127.0.0.1')) {
      return '';
    }
    // Si es una IP privada LAN sin puerto explícito (ej. 192.168.18.39), agregar :3000 por defecto
    const isPrivateIpv4 =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
    if (isPrivateIpv4 && !u.port) {
      u.port = '3000';
      return u.origin;
    }
    return u.origin;
  } catch {
    return out;
  }
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') {
    try {
      return Boolean(cap.isNativePlatform());
    } catch (_) {}
  }
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  const port = window.location?.port || '';
  if (proto === 'capacitor:') return true;
  // Capacitor Android usa http://localhost o https://localhost (sin puerto)
  if ((proto === 'https:' || proto === 'http:') && host === 'localhost' && !port && !(window as any).electronAPI?.isElectron) {
    return true;
  }
  return false;
}

export function isAndroidTvDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__cinecastTvMode === true) return true;
  try {
    const params = new URLSearchParams(window.location?.search || '');
    if (params.get('tv') === '1') return true;
  } catch (_) {}
  const ua = navigator.userAgent || '';
  if (/Android TV|GoogleTV|AFT[A-Z0-9]|BRAVIA|SmartTV|MIBOX|SHIELD|Leanback|TV Safari|Tizen|Web0S/i.test(ua)) {
    return true;
  }
  return false;
}

export function getSavedLanServerUrl(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_LAN_FALLBACK;
  const direct = normalizeServerUrl(localStorage.getItem(LAN_SERVER_KEY));
  if (direct) return direct;
  const legacy = normalizeServerUrl(localStorage.getItem(LEGACY_HOST_KEY));
  if (legacy) return legacy;
  const envLan = normalizeServerUrl((import.meta as any).env?.VITE_DEFAULT_LAN_URL);
  return envLan || DEFAULT_LAN_FALLBACK;
}

export function getSavedCloudServerUrl(): string {
  if (typeof localStorage === 'undefined') return '';
  const saved = normalizeServerUrl(localStorage.getItem(CLOUD_SERVER_KEY));
  if (saved) return saved;
  const envCloud = normalizeServerUrl((import.meta as any).env?.VITE_CLOUD_SERVER_URL);
  return envCloud;
}

let currentState: BackendConnectionState = {
  mode: isCapacitorNative() ? 'unconfigured' : 'same-origin',
  activeUrl: '',
  lanUrl: getSavedLanServerUrl(),
  cloudUrl: getSavedCloudServerUrl(),
  isNativeApp: isCapacitorNative(),
  isAndroidTv: isAndroidTvDevice(),
  lastCheckedAt: 0,
};

// Inicializar activeUrl de forma síncrona con el último conocido para que el primer fetch no espere
if (currentState.isNativeApp) {
  if (currentState.lanUrl) {
    currentState.activeUrl = currentState.lanUrl;
    currentState.mode = 'lan';
  } else if (currentState.cloudUrl) {
    currentState.activeUrl = currentState.cloudUrl;
    currentState.mode = 'cloud';
  }
}

function notify() {
  const snapshot = { ...currentState };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (_) {}
  });
}

export function subscribeBackendState(fn: (state: BackendConnectionState) => void): () => void {
  listeners.add(fn);
  fn({ ...currentState });
  return () => {
    listeners.delete(fn);
  };
}

export function getBackendState(): BackendConnectionState {
  return { ...currentState };
}

export function getActiveApiBase(): string {
  if (!currentState.isNativeApp) return '';
  return currentState.activeUrl || currentState.lanUrl || currentState.cloudUrl || '';
}

export function getActiveWsUrl(): string {
  const base = getActiveApiBase();
  if (base) {
    try {
      const u = new URL(base);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}/ws`;
    } catch (_) {}
  }
  if (typeof window !== 'undefined' && window.location?.host) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/ws`;
  }
  return 'ws://localhost:3000/ws';
}

export function setLanServerUrl(rawUrl: string): void {
  const clean = normalizeServerUrl(rawUrl);
  if (typeof localStorage !== 'undefined') {
    if (clean) {
      localStorage.setItem(LAN_SERVER_KEY, clean);
      try {
        localStorage.setItem(LEGACY_HOST_KEY, new URL(clean).host);
      } catch (_) {}
    } else {
      localStorage.removeItem(LAN_SERVER_KEY);
    }
  }
  currentState = {
    ...currentState,
    lanUrl: clean,
    activeUrl: currentState.isNativeApp ? clean || currentState.cloudUrl : '',
    mode: currentState.isNativeApp ? (clean ? 'lan' : currentState.cloudUrl ? 'cloud' : 'unconfigured') : 'same-origin',
  };
  notify();
}

export function setCloudServerUrl(rawUrl: string): void {
  const clean = normalizeServerUrl(rawUrl);
  if (typeof localStorage !== 'undefined') {
    if (clean) localStorage.setItem(CLOUD_SERVER_KEY, clean);
    else localStorage.removeItem(CLOUD_SERVER_KEY);
  }
  currentState = {
    ...currentState,
    cloudUrl: clean,
    activeUrl: currentState.isNativeApp ? currentState.lanUrl || clean : '',
    mode: currentState.isNativeApp
      ? currentState.lanUrl
        ? currentState.mode
        : clean
          ? 'cloud'
          : 'unconfigured'
      : 'same-origin',
  };
  notify();
}

let rawFetchRef: typeof window.fetch | null = null;

async function probeServer(baseUrl: string, timeoutMs = 1800): Promise<boolean> {
  if (!baseUrl) return false;
  const fn = rawFetchRef || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
  try {
    const res = await fn(`${baseUrl}/api/local-ip`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sondeo híbrido: en APK prueba LAN (PC en WiFi) primero; si no responde, conmuta automáticamente a Nube.
 */
export async function probeAndSelectBackend(): Promise<BackendConnectionState> {
  const lan = getSavedLanServerUrl();
  const cloud = getSavedCloudServerUrl();

  if (!currentState.isNativeApp) {
    currentState = {
      ...currentState,
      mode: 'same-origin',
      activeUrl: '',
      lanUrl: lan,
      cloudUrl: cloud,
      lastCheckedAt: Date.now(),
    };
    notify();
    return getBackendState();
  }

  if (lan && (await probeServer(lan, 1800))) {
    currentState = {
      ...currentState,
      mode: 'lan',
      activeUrl: lan,
      lanUrl: lan,
      cloudUrl: cloud,
      lastCheckedAt: Date.now(),
    };
    notify();
    return getBackendState();
  }

  if (cloud && (await probeServer(cloud, 3500))) {
    currentState = {
      ...currentState,
      mode: 'cloud',
      activeUrl: cloud,
      lanUrl: lan,
      cloudUrl: cloud,
      lastCheckedAt: Date.now(),
    };
    notify();
    return getBackendState();
  }

  currentState = {
    ...currentState,
    mode: lan ? 'lan' : cloud ? 'cloud' : 'unconfigured',
    activeUrl: lan || cloud || '',
    lanUrl: lan,
    cloudUrl: cloud,
    lastCheckedAt: Date.now(),
  };
  notify();
  return getBackendState();
}

let interceptorInstalled = false;

/**
 * Intercepta `window.fetch` una sola vez para reescribir rutas relativas `/api/*`, `/mm/*`, `/auth/*`
 * al backend activo (LAN o Nube) cuando la app corre empaquetada en APK Capacitor.
 */
export function installApiFetchInterceptor(): void {
  if (typeof window === 'undefined' || interceptorInstalled) return;
  interceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);
  rawFetchRef = originalFetch;

  if (!currentState.isNativeApp) {
    return;
  }

  const wrappedFetch: typeof window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const base = getActiveApiBase();
    if (base) {
      if (typeof input === 'string') {
        if (/^\/(?:api|mm|auth)\//i.test(input)) {
          return originalFetch(`${base}${input}`, init);
        }
        if (/^https?:\/\/localhost\/(?:api|mm|auth)\//i.test(input)) {
          const rel = input.replace(/^https?:\/\/localhost/i, '');
          return originalFetch(`${base}${rel}`, init);
        }
      } else if (input instanceof URL) {
        const href = input.href;
        if (/^https?:\/\/localhost\/(?:api|mm|auth)\//i.test(href)) {
          const rel = href.replace(/^https?:\/\/localhost/i, '');
          return originalFetch(`${base}${rel}`, init);
        }
      } else if (input instanceof Request && /^https?:\/\/localhost\/(?:api|mm|auth)\//i.test(input.url)) {
        const rel = input.url.replace(/^https?:\/\/localhost/i, '');
        return originalFetch(new Request(`${base}${rel}`, input), init);
      }
    }
    return originalFetch(input, init);
  };

  try {
    window.fetch = wrappedFetch;
  } catch (_) {}

  // Sondeo inicial + al recuperar red o volver al frente (cambio WiFi <-> 4G)
  void probeAndSelectBackend();
  window.addEventListener('online', () => {
    void probeAndSelectBackend();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void probeAndSelectBackend();
    }
  });
}
