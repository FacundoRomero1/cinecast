import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { globalDevices } from '../rooms.js';

export interface WatchHistoryItem {
  id: string;
  mediaId?: string;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  posterUrl?: string;
  backdropUrl?: string;
  lastWatchedAt?: number;
  [key: string]: unknown;
}

export function getCanonicalSeriesKey(it: WatchHistoryItem): string {
  const mediaItem = it.mediaItem as any;
  const rawId = String(it.mediaId || it.id || '').replace(/_s\d+_e\d+$/, '');
  const tmdb = mediaItem?.tmdbId || (it as any).tmdbId || rawId.match(/\d+$/)?.[0];
  const isSeries =
    it.type === 'series' ||
    it.category === 'series' ||
    it.category === 'anime' ||
    Boolean(it.seasonNumber);
  if (isSeries && tmdb) {
    return `series_tmdb_${tmdb}`;
  }
  const title = String(it.title || mediaItem?.title || '').trim().toLowerCase();
  if (isSeries && title) {
    return `series_title_${title}`;
  }
  return rawId || it.id;
}

function shouldReplaceSeriesItem(existing: WatchHistoryItem, incoming: WatchHistoryItem): boolean {
  const existingSeason = Number(existing.seasonNumber || 1);
  const incomingSeason = Number(incoming.seasonNumber || 1);
  if (incomingSeason > existingSeason) return true;
  if (incomingSeason < existingSeason) return false;

  const existingEp = Number(existing.episodeNumber || 1);
  const incomingEp = Number(incoming.episodeNumber || 1);
  if (incomingEp > existingEp) return true;
  if (incomingEp < existingEp) return false;

  return (incoming.lastWatchedAt || 0) >= (existing.lastWatchedAt || 0);
}

export interface HistoryOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  onHistoryUpdated?: ((items: WatchHistoryItem[]) => void) | undefined;
}

export function createHistoryRouter(options: HistoryOptions = {}): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();

  function getWatchHistoryFilePath(): string {
    const candidates = [
      path.join(baseDir, 'public', 'data'),
      path.join(process.cwd(), 'public', 'data'),
      path.join(baseDir, 'dist', 'data'),
    ];
    for (const d of candidates) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return path.join(d, 'watch_history.json');
      } catch (_) {}
    }
    if (options.userDataPath) {
      return path.join(options.userDataPath, 'watch_history.json');
    }
    return path.join(baseDir, 'watch_history.json');
  }

  function loadWatchHistoryFromDisk(): WatchHistoryItem[] {
    try {
      const fp = getWatchHistoryFilePath();
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const map = new Map<string, WatchHistoryItem>();
          for (const it of parsed) {
            if (it && typeof it === 'object' && (it as any).id) {
              const item = it as WatchHistoryItem;
              const key = getCanonicalSeriesKey(item);
              const existing = map.get(key);
              if (!existing || shouldReplaceSeriesItem(existing, item)) {
                map.set(key, item);
              }
            }
          }
          return Array.from(map.values()).sort(
            (a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0)
          );
        }
      }
    } catch (_) {}
    return [];
  }

  function saveWatchHistoryToDisk(items: WatchHistoryItem[]): boolean {
    try {
      const fp = getWatchHistoryFilePath();
      fs.writeFileSync(fp, JSON.stringify((items || []).slice(0, 50)), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  router.get('/watch-history', (_req, res) => {
    res.json({ items: loadWatchHistoryFromDisk() });
  });

  router.post('/watch-history', (req, res) => {
    const body = req.body as { items?: unknown; id?: string } | undefined;
    const incoming: unknown[] = Array.isArray(body?.items)
      ? body.items
      : body && typeof body === 'object'
        ? [body]
        : [];
    if (!Array.isArray(incoming) || incoming.length === 0) {
      res.json({ ok: false });
      return;
    }

    const current = loadWatchHistoryFromDisk();
    const map = new Map<string, WatchHistoryItem>();
    for (const it of current) {
      if (it && it.id) {
        map.set(getCanonicalSeriesKey(it), it);
      }
    }
    for (const rawIt of incoming) {
      if (!rawIt || typeof rawIt !== 'object') continue;
      const it = rawIt as WatchHistoryItem;
      if (typeof it.id !== 'string' || !it.id) continue;
      const key = getCanonicalSeriesKey(it);
      const existing = map.get(key);
      if (!existing || shouldReplaceSeriesItem(existing, it)) {
        map.set(key, it);
      }
    }

    const merged = Array.from(map.values())
      .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
      .slice(0, 50);

    saveWatchHistoryToDisk(merged);

    // Broadcast WebSocket a todos los dispositivos conectados
    const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: merged });
    globalDevices.forEach((client) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(wsMsg);
        } catch (_) {}
      }
    });

    if (options.onHistoryUpdated) {
      options.onHistoryUpdated(merged);
    }

    res.json({ ok: true, items: merged });
  });

  router.post('/repair-history', (_req, res) => {
    try {
      const fp = getWatchHistoryFilePath();
      let rawItems: WatchHistoryItem[] = [];
      if (fs.existsSync(fp)) {
        try {
          rawItems = JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch (_) {}
      }

      // 1. Respaldo obligatorio con fecha ISO
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `historial-respaldo-${dateStr}.json`;
      const backupPath = path.join(path.dirname(fp), backupFilename);
      fs.writeFileSync(backupPath, JSON.stringify(rawItems, null, 2), 'utf8');

      // 2. Deduplicar por serie
      const map = new Map<string, WatchHistoryItem>();
      let duplicatesCount = 0;
      for (const it of rawItems) {
        if (!it || !it.id) continue;
        const key = getCanonicalSeriesKey(it);
        const existing = map.get(key);
        if (existing) {
          duplicatesCount++;
          if (shouldReplaceSeriesItem(existing, it)) {
            map.set(key, it);
          }
        } else {
          map.set(key, it);
        }
      }

      // 3. Limpiar carátulas unsplash o inválidas
      const cleaned = Array.from(map.values()).map((it) => {
        const itemCopy = { ...it };
        if (typeof itemCopy.posterUrl === 'string' && itemCopy.posterUrl.includes('unsplash.com')) {
          itemCopy.posterUrl = '';
        }
        if (typeof itemCopy.backdropUrl === 'string' && itemCopy.backdropUrl.includes('unsplash.com')) {
          itemCopy.backdropUrl = '';
        }
        if (itemCopy.mediaItem && typeof itemCopy.mediaItem === 'object') {
          const m = { ...(itemCopy.mediaItem as any) };
          if (typeof m.posterUrl === 'string' && m.posterUrl.includes('unsplash.com')) m.posterUrl = '';
          if (typeof m.backdropUrl === 'string' && m.backdropUrl.includes('unsplash.com')) m.backdropUrl = '';
          itemCopy.mediaItem = m;
        }
        return itemCopy;
      });

      const sorted = cleaned
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
        .slice(0, 50);

      saveWatchHistoryToDisk(sorted);

      // WebSocket broadcast
      const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: sorted });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(wsMsg);
          } catch (_) {}
        }
      });

      res.json({
        ok: true,
        backupFile: backupFilename,
        totalRemaining: sorted.length,
        duplicatesRemoved: duplicatesCount,
        items: sorted,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error al reparar historial' });
    }
  });

  return router;
}
