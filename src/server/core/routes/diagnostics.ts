import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

export interface DiagnosticsOptions {
  getMode: () => boolean;
  setMode: (val: boolean) => void;
  getNoCorsFix: () => boolean;
  setNoCorsFix: (val: boolean) => void;
  onChange: () => void;
}

export interface BrokenMediaReport {
  timestamp: string;
  tmdbId: number | string | null;
  title: string;
  type: string;
  season?: number;
  episode?: number;
  serverName?: string;
  serverUrl?: string;
  reason?: string;
  buildMarker?: string;
}

function getBrokenReportsPath(): string {
  const dir = process.env.CINECAST_DATA_DIR?.trim()
    ? path.resolve(process.env.CINECAST_DATA_DIR.trim())
    : path.join(process.cwd(), '.cinecast-data');
  return path.join(dir, 'broken-media-reports.json');
}

function readBrokenReports(): BrokenMediaReport[] {
  try {
    const p = getBrokenReportsPath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeBrokenReports(list: BrokenMediaReport[]): void {
  const p = getBrokenReportsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
}

export function createDiagnosticsRouter(options: DiagnosticsOptions): Router {
  if (
    !options ||
    typeof options.getMode !== 'function' ||
    typeof options.setMode !== 'function' ||
    typeof options.getNoCorsFix !== 'function' ||
    typeof options.setNoCorsFix !== 'function' ||
    typeof options.onChange !== 'function'
  ) {
    throw new Error(
      'createDiagnosticsRouter requiere inyección obligatoria: { getMode, setMode, getNoCorsFix, setNoCorsFix, onChange }'
    );
  }

  const router = Router();

  router.get('/diagnostic-mode', (req, res) => {
    let changed = false;
    if (req.query.enabled !== undefined) {
      options.setMode(req.query.enabled === 'true');
      changed = true;
    }
    if (req.query.noCorsFix !== undefined) {
      options.setNoCorsFix(req.query.noCorsFix === 'true');
      changed = true;
    }
    if (changed) options.onChange();
    res.json({ diagnosticMode: options.getMode(), noCorsFix: options.getNoCorsFix() });
  });

  router.post('/diagnostic-mode', (req, res) => {
    let changed = false;
    const body = req.body as { enabled?: unknown; noCorsFix?: unknown } | undefined;
    if (body?.enabled !== undefined) {
      options.setMode(Boolean(body.enabled));
      changed = true;
    }
    if (body?.noCorsFix !== undefined) {
      options.setNoCorsFix(Boolean(body.noCorsFix));
      changed = true;
    }
    if (changed) options.onChange();
    res.json({ diagnosticMode: options.getMode(), noCorsFix: options.getNoCorsFix() });
  });

  // Marcar series/episodios/canales que no se ven correctamente (1 click desde el reproductor)
  router.get('/report-broken', (_req, res) => {
    const reports = readBrokenReports();
    res.json({ ok: true, count: reports.length, reports });
  });

  router.post('/report-broken', (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
    const title = String(b.title || '').trim();
    if (!title) {
      res.status(400).json({ ok: false, error: 'title requerido' });
      return;
    }
    const entry: BrokenMediaReport = {
      timestamp: new Date().toISOString(),
      tmdbId: b.tmdbId ?? null,
      title,
      type: String(b.type || 'series'),
      season: b.season !== undefined ? Number(b.season) : undefined,
      episode: b.episode !== undefined ? Number(b.episode) : undefined,
      serverName: b.serverName ? String(b.serverName) : undefined,
      serverUrl: b.serverUrl ? String(b.serverUrl).slice(0, 300) : undefined,
      reason: b.reason ? String(b.reason).slice(0, 200) : 'reportado_por_usuario',
      buildMarker: b.buildMarker ? String(b.buildMarker) : undefined,
    };
    const reports = readBrokenReports();
    const dedupKey = `${entry.tmdbId}|${entry.season ?? ''}|${entry.episode ?? ''}|${entry.serverName ?? ''}`;
    const filtered = reports.filter(
      (r) => `${r.tmdbId}|${r.season ?? ''}|${r.episode ?? ''}|${r.serverName ?? ''}` !== dedupKey
    );
    filtered.unshift(entry);
    writeBrokenReports(filtered.slice(0, 200));
    console.log(
      `[ReportBroken] ${entry.title} (tmdb=${entry.tmdbId} S${entry.season ?? '-'}E${entry.episode ?? '-'}) srv="${entry.serverName || '-'}"`
    );
    res.json({ ok: true, count: filtered.length, entry });
  });

  return router;
}
