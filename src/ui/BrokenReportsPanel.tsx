import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Flag, RefreshCw, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';

export interface BrokenReportItem {
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
}

type FilterKind = 'all' | 'channel' | 'movie' | 'series' | 'anime';

export const BrokenReportsPanel: React.FC = () => {
  const [reports, setReports] = useState<BrokenReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/report-broken');
      if (res.ok) {
        const data = await res.json();
        setReports(Array.isArray(data?.reports) ? data.reports : []);
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const classifyType = (r: BrokenReportItem): FilterKind => {
    const t = String(r.type || '').toLowerCase();
    if (!r.tmdbId || t.includes('channel') || t.includes('live')) return 'channel';
    if (t.includes('anime')) return 'anime';
    if (t.includes('movie') || t.includes('pelic')) return 'movie';
    return 'series';
  };

  const openCount = useMemo(() => reports.filter((r) => r.status !== 'resolved').length, [reports]);
  const resolvedCount = reports.length - openCount;

  const visibleReports = useMemo(() => {
    return reports.filter((r) => {
      if (!showResolved && r.status === 'resolved') return false;
      if (filter !== 'all' && classifyType(r) !== filter) return false;
      return true;
    });
  }, [reports, filter, showResolved]);

  const handleToggle = async (id: string) => {
    try {
      const res = await fetch(`/api/report-broken/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
      if (res.ok) void loadReports();
    } catch (_) {}
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/report-broken/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (_) {}
  };

  const handleClearResolved = async () => {
    try {
      const res = await fetch('/api/report-broken?scope=resolved', { method: 'DELETE' });
      if (res.ok) void loadReports();
    } catch (_) {}
  };

  const handleCopySummary = () => {
    const open = reports.filter((r) => r.status !== 'resolved');
    const lines = open.map((r) => {
      const ep = r.season !== undefined || r.episode !== undefined ? ` T${r.season ?? '-'}E${r.episode ?? '-'}` : '';
      const srv = r.serverName ? ` | srv: ${r.serverName}` : '';
      const url = r.serverUrl ? ` | url: ${r.serverUrl}` : '';
      return `- [${classifyType(r).toUpperCase()}] ${r.title}${ep} (tmdb=${r.tmdbId ?? 'null'}, x${r.count})${srv}${url}`;
    });
    const text = lines.length > 0 ? lines.join('\n') : 'Sin reportes abiertos.';
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <section
      aria-label="Reportes de contenido caído"
      className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Flag className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>Reportes de contenido caído</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-950/70 text-red-300 border border-red-800/70">
                {openCount} abiertos
              </span>
            </div>
            <div className="text-xs text-zinc-400">
              Guardados en <code className="text-zinc-300">.cinecast-data/broken-media-reports.json</code> al tocar 🚩 Reportar.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleCopySummary}
            disabled={openCount === 0}
            className="px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 inline-flex items-center gap-1.5 disabled:opacity-40 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar resumen'}</span>
          </button>
          {resolvedCount > 0 && (
            <button
              type="button"
              onClick={handleClearResolved}
              className="px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-red-950/60 border border-zinc-800 hover:border-red-800/60 text-xs font-bold text-zinc-300 hover:text-red-300 transition"
            >
              Limpiar resueltos ({resolvedCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadReports()}
            className="p-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition"
            title="Actualizar lista"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              ['all', 'Todos'],
              ['channel', 'Canales'],
              ['movie', 'Películas'],
              ['series', 'Series'],
              ['anime', 'Anime'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                filter === id
                  ? 'bg-red-600 border-red-500 text-white'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="accent-emerald-500"
          />
          <span>Mostrar resueltos ({resolvedCount})</span>
        </label>
      </div>

      {/* Lista de reportes */}
      {visibleReports.length === 0 ? (
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 text-center text-xs text-zinc-500">
          No hay reportes {showResolved ? '' : 'abiertos '}en esta categoría.
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {visibleReports.map((r) => {
            const kind = classifyType(r);
            const isResolved = r.status === 'resolved';
            return (
              <div
                key={r.id}
                className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
                  isResolved
                    ? 'bg-zinc-950/50 border-zinc-800/60 opacity-65'
                    : 'bg-zinc-950 border-zinc-800'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      {kind === 'channel' ? 'Canal' : kind === 'movie' ? 'Peli' : kind === 'anime' ? 'Anime' : 'Serie'}
                    </span>
                    <span className="text-xs font-bold text-white truncate">{r.title}</span>
                    {(r.season !== undefined || r.episode !== undefined) && (
                      <span className="text-[11px] font-mono text-amber-300">
                        T{r.season ?? '-'}E{r.episode ?? '-'}
                      </span>
                    )}
                    {r.count > 1 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-800/60">
                        ×{r.count}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate">
                    {r.serverName ? `Servidor: ${r.serverName}` : 'Sin servidor registrado'}
                    {r.tmdbId ? ` · TMDB ${r.tmdbId}` : ''} · {formatDate(r.timestamp)}
                  </div>
                  {r.serverUrl && (
                    <div className="text-[10px] font-mono text-zinc-500 truncate">{r.serverUrl}</div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggle(r.id)}
                    title={isResolved ? 'Reabrir reporte' : 'Marcar como resuelto'}
                    className={`p-1.5 rounded-lg border transition ${
                      isResolved
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                        : 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/60'
                    }`}
                  >
                    {isResolved ? <RotateCcw className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(r.id)}
                    title="Eliminar reporte"
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/70 border border-zinc-800 hover:border-red-800/60 text-zinc-400 hover:text-red-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
