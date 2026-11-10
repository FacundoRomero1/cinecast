import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { globalDevices } from '../rooms.js';

export interface WatchHistoryItem {
  id: string;
  lastWatchedAt?: number;
  [key: string]: unknown;
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
          return parsed as WatchHistoryItem[];
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
      if (it && typeof it.id === 'string' && it.id) {
        map.set(it.id, it);
      }
    }
    for (const rawIt of incoming) {
      if (!rawIt || typeof rawIt !== 'object') continue;
      const it = rawIt as WatchHistoryItem;
      if (typeof it.id !== 'string' || !it.id) continue;
      const existing = map.get(it.id);
      if (!existing || (it.lastWatchedAt || 0) >= (existing.lastWatchedAt || 0)) {
        map.set(it.id, it);
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

  return router;
}
