const KEY = 'cinecast_audio_prefs_v1';
const VOL_KEY = 'cinecast_volume_v1';
const MUTE_KEY = 'cinecast_muted_v1';

/**
 * Normaliza un valor de volumen en el borde al rango 0..1.
 * Si recibe un porcentaje > 1 (p. ej. 20 o 100 desde UI/remoto), divide por 100.
 */
export function normalizeVolume01(raw: unknown, fallback = 1): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return Math.max(0, Math.min(1, Number((n / 100).toFixed(4))));
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}

export type AudioPrefEntry = {
  serverName: string;
  audio: 'latino' | 'sub';
  updatedAt: number;
};

export const audioPrefs = {
  getVolume(): number {
    try {
      const raw = localStorage.getItem(VOL_KEY);
      if (raw !== null && raw !== '') {
        return normalizeVolume01(Number(raw), 1);
      }
    } catch (_) {}
    return 1;
  },

  setVolume(vol: number): number {
    const norm = normalizeVolume01(vol, 1);
    try {
      localStorage.setItem(VOL_KEY, String(norm));
    } catch (_) {}
    return norm;
  },

  getMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  },

  setMuted(muted: boolean): boolean {
    const val = Boolean(muted);
    try {
      localStorage.setItem(MUTE_KEY, String(val));
    } catch (_) {}
    return val;
  },

  all(): Record<string, AudioPrefEntry> {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  },

  getForMedia(mediaId: string | number, season?: number, episode?: number): AudioPrefEntry | null {
    const map = this.all();
    const epKey = `${mediaId}_${season || 1}_${episode || 1}`;
    const seriesKey = String(mediaId);
    return map[epKey] ?? map[seriesKey] ?? null;
  },

  setForMedia(
    mediaId: string | number,
    serverName: string,
    audio: 'latino' | 'sub',
    season?: number,
    episode?: number
  ) {
    const map = this.all();
    const entry: AudioPrefEntry = {
      serverName,
      audio,
      updatedAt: Date.now(),
    };
    map[String(mediaId)] = entry;
    if (season !== undefined && episode !== undefined) {
      map[`${mediaId}_${season}_${episode}`] = entry;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (_) {}
  },
};
