import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { globalDevices } from '../rooms.js';
import { getCanonicalSeriesKey, type WatchHistoryItem } from './history.js';

export interface HistoryRepairOptions {
  baseDir?: string | undefined;
  userDataPath?: string | undefined;
  onHistoryUpdated?: ((items: WatchHistoryItem[]) => void) | undefined;
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

  return (Number(incoming.lastWatchedAt) || 0) >= (Number(existing.lastWatchedAt) || 0);
}

export function repairEpisodeTitles(items: WatchHistoryItem[]): number {
  let titlesFixed = 0;
  for (const item of items) {
    if (!item) continue;
    const epNum = item.episodeNumber ?? (item.episodeItem as any)?.episodeNumber;
    if (epNum != null && item.episodeTitle) {
      const match = String(item.episodeTitle).match(/^Episodio\s+(\d+)$/i);
      if (match && Number(match[1]) !== Number(epNum)) {
        item.episodeTitle = `Episodio ${epNum}`;
        if (item.episodeItem && typeof item.episodeItem === 'object') {
          (item.episodeItem as any).episodeNumber = Number(epNum);
          (item.episodeItem as any).title = `Episodio ${epNum}`;
        }
        titlesFixed++;
      }
    }
  }
  return titlesFixed;
}

export function createHistoryRepairRouter(options: HistoryRepairOptions = {}): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();

  function getWatchHistoryFilePath(): string {
    const candidates = [
      path.join(baseDir, 'public', 'data', 'watch_history.json'),
      path.join(process.cwd(), 'public', 'data', 'watch_history.json'),
      path.join(baseDir, 'dist', 'data', 'watch_history.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    if (options.userDataPath) {
      const u = path.join(options.userDataPath, 'watch_history.json');
      if (fs.existsSync(u)) return u;
    }
    const def: string = candidates[0] || path.join(process.cwd(), 'public', 'data', 'watch_history.json');
    try {
      const d = path.dirname(def);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    } catch (_) {}
    return def;
  }

  function getCatalogMap(): Map<string, any> {
    const map = new Map<string, any>();
    const catalogCandidates = [
      path.join(baseDir, 'public', 'data', 'catalog.json'),
      path.join(process.cwd(), 'public', 'data', 'catalog.json'),
      path.join(baseDir, 'dist', 'data', 'catalog.json'),
    ];
    for (const p of catalogCandidates) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
          const items: any[] = Array.isArray(raw) ? raw : (raw?.items || []);
          for (const it of items) {
            if (it && it.id) map.set(String(it.id), it);
            if (it && it.tmdbId) {
              map.set(String(it.tmdbId), it);
              map.set(`tmdb-movie-${it.tmdbId}`, it);
              map.set(`tmdb-anime-${it.tmdbId}`, it);
              map.set(`tmdb-series-${it.tmdbId}`, it);
            }
          }
          break;
        } catch (_) {}
      }
    }
    return map;
  }

  router.post('/repair-history', (_req, res) => {
    try {
      const fp = getWatchHistoryFilePath();
      let rawItems: WatchHistoryItem[] = [];
      if (fs.existsSync(fp)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
          if (Array.isArray(parsed)) {
            rawItems = parsed;
          }
        } catch (_) {}
      }

      // 1. Respaldo obligatorio con fecha ISO
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:.]/g, '-');
      const backupFilename = `historial-respaldo-${dateStr}.json`;
      const backupPath = path.join(path.dirname(fp), backupFilename);

      fs.writeFileSync(backupPath, JSON.stringify(rawItems, null, 2), 'utf8');

      // Copia adicional en scratch/ si existe
      const scratchDir = path.join(baseDir, 'scratch');
      if (fs.existsSync(scratchDir)) {
        try {
          fs.writeFileSync(path.join(scratchDir, backupFilename), JSON.stringify(rawItems, null, 2), 'utf8');
        } catch (_) {}
      }

      // 2. Cargar catálogo oficial para sustituir carátulas unsplash o inválidas
      const catalogMap = getCatalogMap();

      // 3. Deduplicar por serie
      const seriesMap = new Map<string, WatchHistoryItem>();
      let duplicatesRemoved = 0;

      for (const item of rawItems) {
        if (!item || !item.id) continue;
        const key = getCanonicalSeriesKey(item);
        const existing = seriesMap.get(key);
        if (existing) {
          duplicatesRemoved++;
          if (shouldReplaceSeriesItem(existing, item)) {
            seriesMap.set(key, item);
          }
        } else {
          seriesMap.set(key, item);
        }
      }

      // 4. Limpiar carátulas unsplash o inválidas
      const cleanedList = Array.from(seriesMap.values()).map((item) => {
        const copy: WatchHistoryItem = { ...item };
        const rawId = String(copy.mediaId || copy.id || '').replace(/_s\d+_e\d+$/, '');
        const tmdb = (copy.mediaItem as any)?.tmdbId || (copy as any).tmdbId || rawId.match(/\d+$/)?.[0];
        const catItem = catalogMap.get(rawId) || (tmdb ? catalogMap.get(String(tmdb)) : null);

        const hasUnsplashPoster = typeof copy.posterUrl === 'string' && copy.posterUrl.includes('unsplash.com');
        const hasUnsplashBackdrop = typeof copy.backdropUrl === 'string' && copy.backdropUrl.includes('unsplash.com');

        if (hasUnsplashPoster) {
          copy.posterUrl = catItem?.posterUrl || catItem?.backdropUrl || '';
        }
        if (hasUnsplashBackdrop) {
          copy.backdropUrl = catItem?.backdropUrl || catItem?.posterUrl || '';
        }

        if (copy.mediaItem && typeof copy.mediaItem === 'object') {
          const m = { ...(copy.mediaItem as any) };
          if (typeof m.posterUrl === 'string' && m.posterUrl.includes('unsplash.com')) {
            m.posterUrl = catItem?.posterUrl || catItem?.backdropUrl || '';
          }
          if (typeof m.backdropUrl === 'string' && m.backdropUrl.includes('unsplash.com')) {
            m.backdropUrl = catItem?.backdropUrl || catItem?.posterUrl || '';
          }
          copy.mediaItem = m;
        }

        return copy;
      });

      // 5. Corregir títulos de episodio contradictorios ("Episodio M" con M !== episodeNumber)
      const titlesFixed = repairEpisodeTitles(cleanedList);

      // 6. Ordenar por última reproducción descendente
      const repairedList = cleanedList
        .sort((a, b) => (Number(b.lastWatchedAt) || 0) - (Number(a.lastWatchedAt) || 0))
        .slice(0, 50);

      fs.writeFileSync(fp, JSON.stringify(repairedList, null, 2), 'utf8');

      // 7. Notificar WebSocket broadcast y callback
      const wsMsg = JSON.stringify({ type: 'watchHistoryUpdated', items: repairedList });
      globalDevices.forEach((client) => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(wsMsg);
          } catch (_) {}
        }
      });

      if (options.onHistoryUpdated) {
        try {
          options.onHistoryUpdated(repairedList);
        } catch (_) {}
      }

      res.json({
        ok: true,
        backupFile: backupFilename,
        totalRemaining: repairedList.length,
        duplicatesRemoved,
        titlesFixed,
        items: repairedList,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error al reparar historial' });
    }
  });

  return router;
}
