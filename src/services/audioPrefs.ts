const KEY = 'cinecast_audio_prefs_v1';

export type AudioPrefEntry = {
  serverName: string;
  audio: 'latino' | 'sub';
  updatedAt: number;
};

export const audioPrefs = {
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
