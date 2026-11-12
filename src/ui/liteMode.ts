import { useEffect, useState } from 'react';
import { deviceSync } from '../services/deviceSync';

export type LiteModePreference = 'auto' | 'on' | 'off';
export type PosterWidth = 154 | 185 | 342;

const STORAGE_KEY = 'cc_lite_mode';
const listeners = new Set<() => void>();

function readUrlLiteOverride(): LiteModePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const q = searchParams.get('lite');
    if (q === '1' || q === 'true') return 'on';
    if (q === '0' || q === 'false') return 'off';

    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx !== -1) {
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      const hq = hashParams.get('lite');
      if (hq === '1' || hq === 'true') return 'on';
      if (hq === '0' || hq === 'false') return 'off';
    }
  } catch {}
  return null;
}

export function getLiteModePreference(): LiteModePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'on' || raw === 'off' || raw === 'auto') return raw;
  } catch {}
  return 'auto';
}

export function isLowSpecAutoDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return true;
    const ua = navigator.userAgent || '';
    if (/SmartTV|Tizen|Web0S|AFT[A-Z0-9]+|BRAVIA|GoogleTV|Android TV|MiBOX/i.test(ua)) {
      return true;
    }
    const navExt = navigator as unknown as { deviceMemory?: number };
    if (typeof navExt.deviceMemory === 'number' && navExt.deviceMemory <= 2) {
      return true;
    }
    if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2) {
      return true;
    }
  } catch {}
  return false;
}

export function resolveIsLiteMode(): boolean {
  const urlOverride = readUrlLiteOverride();
  if (urlOverride === 'on') return true;
  if (urlOverride === 'off') return false;
  const pref = getLiteModePreference();
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return isLowSpecAutoDevice();
}

export function syncLiteClassOnDocument(): boolean {
  const active = resolveIsLiteMode();
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('cc-lite', active);
  }
  return active;
}

export function setLiteModePreference(pref: LiteModePreference): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
  }
  syncLiteClassOnDocument();
  listeners.forEach((cb) => cb());
}

export function useLiteMode(): {
  isLite: boolean;
  preference: LiteModePreference;
  urlForced: boolean;
  setPreference: (next: LiteModePreference) => void;
} {
  const [state, setState] = useState(() => ({
    isLite: syncLiteClassOnDocument(),
    preference: getLiteModePreference(),
    urlForced: readUrlLiteOverride() !== null,
  }));

  useEffect(() => {
    const refresh = () => {
      setState({
        isLite: syncLiteClassOnDocument(),
        preference: getLiteModePreference(),
        urlForced: readUrlLiteOverride() !== null,
      });
    };
    listeners.add(refresh);
    window.addEventListener('hashchange', refresh);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener('hashchange', refresh);
    };
  }, []);

  return {
    ...state,
    setPreference: setLiteModePreference,
  };
}

export function getPosterProxyUrl(rawUrl: string | undefined, width: PosterWidth = 185): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.includes('/api/poster?')) {
    return trimmed;
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }
  const base = deviceSync.getApiBase();
  return `${base}/api/poster?url=${encodeURIComponent(trimmed)}&w=${width}`;
}

