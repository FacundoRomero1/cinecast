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
  id: string;
  timestamp: string;
  firstTimestamp?: string;
  count: number;
  status: 'open' | 'resolved';
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

function makeReportId(r: {
  tmdbId?: number | string | null;
  title?: string;
  season?: number;
  episode?: number;
  serverName?: string;
}): string {
  const base = `${r.tmdbId ?? r.title ?? 'item'}|${r.season ?? ''}|${r.episode ?? ''}|${r.serverName ?? ''}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return `rep_${Math.abs(hash).toString(36)}`;
}

function readBrokenReports(): BrokenMediaReport[] {
  try {
    const p = getBrokenReportsPath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((raw: any) => ({
      ...raw,
      id: raw.id || makeReportId(raw),
      count: typeof raw.count === 'number' && raw.count > 0 ? raw.count : 1,
      status: raw.status === 'resolved' ? 'resolved' : 'open',
      firstTimestamp: raw.firstTimestamp || raw.timestamp,
    }));
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

  // Listar reportes de canales / pelis / series / anime caídos
  router.get('/report-broken', (_req, res) => {
    const reports = readBrokenReports();
    const openCount = reports.filter((r) => r.status !== 'resolved').length;
    res.json({
      ok: true,
      count: reports.length,
      openCount,
      resolvedCount: reports.length - openCount,
      filePath: getBrokenReportsPath(),
      reports,
    });
  });

  // Marcar series/episodios/canales que no se ven correctamente (1 click desde el reproductor)
  router.post('/report-broken', (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
    const title = String(b.title || '').trim();
    if (!title) {
      res.status(400).json({ ok: false, error: 'title requerido' });
      return;
    }
    const nowIso = new Date().toISOString();
    const rawType = String(b.type || (b.tmdbId ? 'series' : 'channel'));
    const normalizedType =
      !b.tmdbId && /live|tv|channel|sport/i.test(rawType + ' ' + String(b.serverName || ''))
        ? 'channel'
        : rawType;

    const draft = {
      tmdbId: b.tmdbId ?? null,
      title,
      type: normalizedType,
      season: b.season !== undefined ? Number(b.season) : undefined,
      episode: b.episode !== undefined ? Number(b.episode) : undefined,
      serverName: b.serverName ? String(b.serverName) : undefined,
      serverUrl: b.serverUrl ? String(b.serverUrl).slice(0, 300) : undefined,
      reason: b.reason ? String(b.reason).slice(0, 200) : 'reportado_por_usuario',
      buildMarker: b.buildMarker ? String(b.buildMarker) : undefined,
    };

    const id = makeReportId(draft);
    const reports = readBrokenReports();
    const existing = reports.find((r) => r.id === id);
    const entry: BrokenMediaReport = {
      ...draft,
      id,
      timestamp: nowIso,
      firstTimestamp: existing?.firstTimestamp || nowIso,
      count: (existing?.count || 0) + 1,
      status: 'open',
    };

    const filtered = reports.filter((r) => r.id !== id);
    filtered.unshift(entry);
    writeBrokenReports(filtered.slice(0, 250));
    console.log(
      `[ReportBroken] ${entry.title} (tmdb=${entry.tmdbId} S${entry.season ?? '-'}E${entry.episode ?? '-'}) srv="${entry.serverName || '-'}" x${entry.count}`
    );
    res.json({ ok: true, count: filtered.length, entry });
  });

  // Alternar estado abierto / resuelto
  router.post('/report-broken/:id/toggle', (req, res) => {
    const id = String(req.params.id || '').trim();
    const reports = readBrokenReports();
    const idx = reports.findIndex((r) => r.id === id);
    if (idx === -1) {
      res.status(404).json({ ok: false, error: 'Reporte no encontrado' });
      return;
    }
    const cur = reports[idx]!;
    cur.status = cur.status === 'resolved' ? 'open' : 'resolved';
    writeBrokenReports(reports);
    res.json({ ok: true, entry: cur });
  });

  // Eliminar un reporte individual
  router.delete('/report-broken/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    const reports = readBrokenReports();
    const next = reports.filter((r) => r.id !== id);
    writeBrokenReports(next);
    res.json({ ok: true, count: next.length });
  });

  // Limpiar reportes resueltos o todos (?scope=resolved | all)
  router.delete('/report-broken', (req, res) => {
    const scope = String(req.query.scope || 'resolved');
    const reports = readBrokenReports();
    const next = scope === 'all' ? [] : reports.filter((r) => r.status !== 'resolved');
    writeBrokenReports(next);
    res.json({ ok: true, count: next.length });
  });

  return router;
}
