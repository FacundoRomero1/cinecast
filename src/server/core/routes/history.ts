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
  const tmdb = mediaItem?.tmdbId || (it as any).tmdbId || rawId.match(/\d{2,}$/)?.[0];
  const isSeries =
    it.type === 'series' ||
    it.category === 'series' ||
    it.category === 'anime' ||
    Boolean(it.seasonNumber);
  const kind = isSeries ? 'tv' : 'movie';
  if (tmdb) {
    return `${kind}_tmdb_${tmdb}`;
  }
  const title = String(it.title || mediaItem?.title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (title) {
    return `${kind}_title_${title}`;
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

  function sanitizeRoom(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return /^[a-z0-9_-]{3,40}$/.test(s) ? s : '';
  }

  function getWatchHistoryFilePath(room?: string): string {
    const safeRoom = sanitizeRoom(room);
    const filename = safeRoom ? `watch_history_${safeRoom}.json` : 'watch_history.json';
    const envDataDir = process.env.CINECAST_DATA_DIR?.trim();
    if (envDataDir) {
      const d = path.resolve(envDataDir);
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      } catch (_) {}
      return path.join(d, filename);
    }
    const candidates = [
      path.join(baseDir, 'public', 'data'),
      path.join(process.cwd(), 'public', 'data'),
      path.join(baseDir, 'dist', 'data'),
    ];
    for (const d of candidates) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return path.join(d, filename);
      } catch (_) {}
    }
    if (options.userDataPath) {
      return path.join(options.userDataPath, filename);
    }
    return path.join(baseDir, filename);
  }

  function loadWatchHistoryFromDisk(room?: string): WatchHistoryItem[] {
    try {
      const fp = getWatchHistoryFilePath(room);
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

  function saveWatchHistoryToDisk(items: WatchHistoryItem[], room?: string): boolean {
    try {
      const fp = getWatchHistoryFilePath(room);
      fs.writeFileSync(fp, JSON.stringify((items || []).slice(0, 50)), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  router.get('/watch-history', (req, res) => {
    const room = sanitizeRoom(req.query.room);
    res.json({ items: loadWatchHistoryFromDisk(room) });
  });

  router.delete('/watch-history/:id', (req, res) => {
    try {
      const room = sanitizeRoom(req.query.room);
      const targetId = decodeURIComponent(String(req.params.id || '')).trim();
      if (!targetId) {
        res.json({ ok: false });
        return;
      }
      const current = loadWatchHistoryFromDisk(room);
      const filtered = current.filter(
        (it) => it.id !== targetId && it.mediaId !== targetId && getCanonicalSeriesKey(it) !== targetId
      );
      saveWatchHistoryToDisk(filtered, room);
      const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: filtered });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN && (!room || client.roomId === room)) {
          try { client.ws.send(wsMsg); } catch (_) {}
        }
      });
      res.json({ ok: true, items: filtered });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error deleting history item' });
    }
  });

  // ── Mi Lista (persistida en disco y sincronizada por sala entre PC y celular) ──────
  function getMyListFilePath(room?: string): string {
    const safeRoom = sanitizeRoom(room);
    const histPath = getWatchHistoryFilePath();
    return path.join(path.dirname(histPath), safeRoom ? `my_list_${safeRoom}.json` : 'my_list.json');
  }

  function loadMyListFromDisk(room?: string): any[] {
    try {
      const fp = getMyListFilePath(room);
      if (fs.existsSync(fp)) {
        const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function saveMyListToDisk(items: any[], room?: string): boolean {
    try {
      const fp = getMyListFilePath(room);
      fs.writeFileSync(fp, JSON.stringify((items || []).slice(0, 200)), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  router.get('/my-list', (req, res) => {
    const room = sanitizeRoom(req.query.room);
    res.json({ items: loadMyListFromDisk(room) });
  });

  router.post('/my-list', (req, res) => {
    try {
      const room = sanitizeRoom(req.query.room);
      const body = req.body as { items?: unknown } | undefined;
      if (!body || !Array.isArray(body.items)) {
        res.status(400).json({ ok: false, error: 'items array required' });
        return;
      }
      const seen = new Set<string>();
      const cleaned: any[] = [];
      for (const raw of body.items) {
        if (!raw || typeof raw !== 'object') continue;
        const it = raw as any;
        const id = String(it.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        cleaned.push(it);
      }
      saveMyListToDisk(cleaned, room);
      const wsMsg = JSON.stringify({ type: 'myListUpdated', items: cleaned });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN && (!room || client.roomId === room)) {
          try { client.ws.send(wsMsg); } catch (_) {}
        }
      });
      res.json({ ok: true, items: cleaned });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error saving my list' });
    }
  });

  router.post('/watch-history', (req, res) => {
    const room = sanitizeRoom(req.query.room);
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

    const current = loadWatchHistoryFromDisk(room);
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

    saveWatchHistoryToDisk(merged, room);

    // Broadcast WebSocket solo a dispositivos de la misma sala
    const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: merged });
    globalDevices.forEach((client) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN && (!room || client.roomId === room)) {
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
