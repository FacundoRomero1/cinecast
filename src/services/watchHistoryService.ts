import { MediaItem, Episode } from '../types';

export interface WatchProgressItem {
  id: string; // mediaId or `${mediaId}_s${season}_e${episode}`
  mediaId: string;
  title: string;
  posterUrl: string;
  backdropUrl?: string;
  type: 'movie' | 'series' | 'anime' | 'live_tv';
  category?: 'movie' | 'series' | 'anime' | 'live_tv';
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  currentTime: number; // in seconds
  duration: number; // in seconds
  progressPercentage: number; // 0 to 100
  lastWatchedAt: number; // timestamp
  mediaItem: MediaItem;
  episodeItem?: Episode | null;
}

const STORAGE_KEY = 'cinecast_watch_progress_v2';
const MAX_HISTORY_ITEMS = 30;

class WatchHistoryService {
  /**
   * Obtiene todos los elementos en progreso de visualización, ordenados por última fecha.
   */
  public getAll(): WatchProgressItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list: WatchProgressItem[] = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
    } catch (e) {
      console.error('Error reading watch progress history:', e);
      return [];
    }
  }

  /**
   * Obtiene los títulos que el usuario dejó a medias (más de 15 segundos y menos del 95% completado)
   */
  public getContinueWatchingList(): WatchProgressItem[] {
    const all = this.getAll();
    return all.filter((item) => {
      // Ignorar videos de menos de 15 segundos reproducidos
      if (item.currentTime < 15) return false;
      // Si ya vio más del 95%, se considera terminado
      if (item.duration > 0 && (item.currentTime / item.duration) >= 0.95) return false;
      return true;
    });
  }

  /**
   * Guarda o actualiza el progreso de reproducción en localStorage.
   */
  public saveProgress(params: {
    mediaItem: MediaItem;
    episodeItem?: Episode | null;
    seasonNumber?: number;
    episodeNumber?: number;
    currentTime: number;
    duration: number;
  }): void {
    const { mediaItem, episodeItem, seasonNumber, episodeNumber, currentTime, duration } = params;
    if (!mediaItem || !mediaItem.id || currentTime <= 0) return;

    const sNum = seasonNumber ?? episodeItem?.seasonNumber;
    const eNum = episodeNumber ?? episodeItem?.episodeNumber;
    const isSeries =
      mediaItem.type === 'series' ||
      mediaItem.category === 'series' ||
      mediaItem.category === 'anime' ||
      Boolean(sNum || eNum);

    // Identificador canónico único por serie (sin _sX_eY para que no se creen entradas duplicadas)
    const canonicalMediaId = mediaItem.id.replace(/_s\d+_e\d+$/, '');
    const progressId = canonicalMediaId;

    const safeDuration = duration > 0 ? duration : (episodeItem?.durationSeconds || 5400);
    const progressPercentage = Math.min(100, Math.max(0, Math.round((currentTime / safeDuration) * 100)));

    const rawPoster = episodeItem?.thumbnailUrl || mediaItem.posterUrl || mediaItem.backdropUrl || '';
    const rawBackdrop = mediaItem.backdropUrl || mediaItem.posterUrl || '';
    const safePoster = rawPoster.includes('unsplash.com') ? '' : rawPoster;
    const safeBackdrop = rawBackdrop.includes('unsplash.com') ? '' : rawBackdrop;

    // Buscar nombre real del episodio en el catálogo de episodios si está disponible
    let realEpTitle: string | undefined = undefined;
    if (isSeries && eNum != null) {
      const foundInMedia = mediaItem.episodes?.find(
        (e) => (e.seasonNumber || 1) === (sNum || 1) && e.episodeNumber === eNum
      );
      if (foundInMedia?.title && !/^episodio\s+\d+$/i.test(foundInMedia.title)) {
        realEpTitle = foundInMedia.title;
      } else if (
        episodeItem &&
        (episodeItem.seasonNumber || 1) === (sNum || 1) &&
        episodeItem.episodeNumber === eNum &&
        episodeItem.title &&
        !/^episodio\s+\d+$/i.test(episodeItem.title)
      ) {
        realEpTitle = episodeItem.title;
      } else if (foundInMedia?.title) {
        realEpTitle = foundInMedia.title;
      } else if (
        episodeItem &&
        (episodeItem.seasonNumber || 1) === (sNum || 1) &&
        episodeItem.episodeNumber === eNum &&
        episodeItem.title
      ) {
        realEpTitle = episodeItem.title;
      } else {
        realEpTitle = `Episodio ${eNum}`;
      }
    }

    const effectiveEpisodeItem: Episode | null = isSeries && eNum != null
      ? {
          id:
            (episodeItem && (episodeItem.seasonNumber || 1) === (sNum || 1) && episodeItem.episodeNumber === eNum && episodeItem.id)
              ? episodeItem.id
              : `ep-${canonicalMediaId}-s${sNum || 1}-e${eNum}`,
          title: realEpTitle || `Episodio ${eNum}`,
          overview: episodeItem?.overview || `Temporada ${sNum || 1}, Episodio ${eNum}`,
          seasonNumber: sNum || 1,
          episodeNumber: eNum,
          durationSeconds: safeDuration,
        }
      : (episodeItem || null);

    const newItem: WatchProgressItem = {
      id: progressId,
      mediaId: canonicalMediaId,
      title: mediaItem.title,
      posterUrl: safePoster,
      backdropUrl: safeBackdrop,
      type: mediaItem.type,
      category: mediaItem.category,
      seasonNumber: isSeries ? sNum : undefined,
      episodeNumber: isSeries ? eNum : undefined,
      episodeTitle: isSeries ? realEpTitle : undefined,
      currentTime: Math.floor(currentTime),
      duration: Math.floor(safeDuration),
      progressPercentage,
      lastWatchedAt: Date.now(),
      mediaItem: {
        ...mediaItem,
        posterUrl: safePoster,
        backdropUrl: safeBackdrop,
      },
      episodeItem: effectiveEpisodeItem,
    };

    try {
      const isSameSeriesOrMedia = (item: WatchProgressItem) => {
        if (isSeries) {
          const itemMediaId = String(item.mediaId || item.id || '').replace(/_s\d+_e\d+$/, '').toLowerCase();
          const curMediaId = canonicalMediaId.toLowerCase();
          if (itemMediaId === curMediaId) return true;
          const itemTmdb = item.mediaItem?.tmdbId || itemMediaId.match(/\d+$/)?.[0];
          const curTmdb = mediaItem.tmdbId || curMediaId.match(/\d+$/)?.[0];
          if (itemTmdb && curTmdb && String(itemTmdb) === String(curTmdb)) return true;
          const itemTitle = (item.title || item.mediaItem?.title || '').trim().toLowerCase();
          const curTitle = (mediaItem.title || '').trim().toLowerCase();
          if (itemTitle && curTitle && itemTitle === curTitle) return true;
          return false;
        }
        return item.id === progressId || item.mediaId === progressId;
      };

      const currentList = this.getAll().filter((item) => !isSameSeriesOrMedia(item));

      currentList.unshift(newItem);
      const trimmed = currentList.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      this.notifyListeners();

      // Enviar progreso al servidor en segundo plano para sincronizar entre PC y celular
      fetch('/api/watch-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [newItem] }),
      }).catch(() => {});
    } catch (e) {
      console.error('Error saving watch progress:', e);
    }
  }

  /**
   * Sincroniza el historial local con el servidor central para paridad PC-móvil.
   */
  public async syncWithServer(): Promise<WatchProgressItem[]> {
    try {
      const res = await fetch('/api/watch-history');
      if (!res.ok) return this.getAll();
      const data = await res.json();
      const serverItems: WatchProgressItem[] = Array.isArray(data.items) ? data.items : [];
      if (serverItems.length === 0) return this.getAll();

      const localItems = this.getAll();
      const map = new Map<string, WatchProgressItem>();

      const getCanonicalKey = (it: WatchProgressItem) => {
        const isSeries =
          it.type === 'series' ||
          it.category === 'series' ||
          it.category === 'anime' ||
          Boolean(it.seasonNumber);
        if (!isSeries) return it.mediaId || it.id;
        const tmdb = it.mediaItem?.tmdbId || (it.mediaId || it.id || '').match(/\d+$/)?.[0];
        if (tmdb) return `series_tmdb_${tmdb}`;
        const title = (it.title || it.mediaItem?.title || '').trim().toLowerCase();
        if (title) return `series_title_${title}`;
        return `series_${(it.mediaId || it.id || '').replace(/_s\d+_e\d+$/, '').toLowerCase()}`;
      };

      const shouldReplace = (existing: WatchProgressItem, incoming: WatchProgressItem) => {
        const existingSeason = Number(existing.seasonNumber || 1);
        const incomingSeason = Number(incoming.seasonNumber || 1);
        if (incomingSeason > existingSeason) return true;
        if (incomingSeason < existingSeason) return false;

        const existingEp = Number(existing.episodeNumber || 1);
        const incomingEp = Number(incoming.episodeNumber || 1);
        if (incomingEp > existingEp) return true;
        if (incomingEp < existingEp) return false;

        return (incoming.lastWatchedAt || 0) >= (existing.lastWatchedAt || 0);
      };

      for (const it of serverItems) {
        if (!it || !it.id) continue;
        const key = getCanonicalKey(it);
        const existing = map.get(key);
        if (!existing || shouldReplace(existing, it)) {
          map.set(key, it);
        }
      }
      for (const it of localItems) {
        if (!it || !it.id) continue;
        const key = getCanonicalKey(it);
        const existing = map.get(key);
        if (!existing || shouldReplace(existing, it)) {
          map.set(key, it);
        }
      }

      const merged = Array.from(map.values())
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
        .slice(0, MAX_HISTORY_ITEMS);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      this.notifyListeners();
      return merged;
    } catch (_) {
      return this.getAll();
    }
  }

  private listeners = new Set<() => void>();

  public onUpdate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(): void {
    this.listeners.forEach((cb) => {
      try { cb(); } catch (_) {}
    });
  }

  /**
   * Obtiene el progreso guardado para un medio o episodio específico
   */
  public getProgressFor(mediaId: string, season?: number, episode?: number): WatchProgressItem | null {
    const all = this.getAll();
    if (season && episode) {
      const foundEp = all.find((item) => item.mediaId === mediaId && item.seasonNumber === season && item.episodeNumber === episode);
      if (foundEp) return foundEp;
    }
    return all.find((item) => item.mediaId === mediaId) || null;
  }

  /**
   * Elimina un elemento de la lista de continuar viendo
   */
  public remove(id: string): void {
    try {
      const list = this.getAll().filter((item) => item.id !== id && item.mediaId !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      this.notifyListeners();
    } catch (e) {
      console.error('Error removing watch progress:', e);
    }
  }

  /**
   * Limpia todo el historial
   */
  public clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.notifyListeners();
    } catch (e) {
      console.error('Error clearing watch progress:', e);
    }
  }
}

export const watchHistoryService = new WatchHistoryService();
