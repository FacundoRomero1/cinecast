import React, { useEffect, useState } from 'react';
import {
  getClientBuildId,
  fetchServerHealth,
  getWebSocketStatus,
  checkServiceWorkerRegistered,
  clearCacheAndReload,
  runConnectionTest,
  getLastSentCommand,
  getLastReceivedCommand,
  ConnectionTestStep,
} from '../app/syncDiagnostic';
import { deviceSync, type ConnectionEventEntry } from '../services/deviceSync';
import { useAppRuntime } from '../app/AppRuntime';
import { Server, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Cpu } from 'lucide-react';

export const ConnectionDiagnosticSection: React.FC = () => {
  const { deviceRole, roomId, devices } = useAppRuntime();

  const [clientBuildId, setClientBuildId] = useState<string>('');
  const [serverBuildId, setServerBuildId] = useState<string>('cargando...');
  const [wsStatus, setWsStatus] = useState<string>('cargando...');
  const [swRegistered, setSwRegistered] = useState<boolean | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testSteps, setTestSteps] = useState<ConnectionTestStep[] | null>(null);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isRecordingPerf, setIsRecordingPerf] = useState<boolean>(false);
  const [perfElapsedSec, setPerfElapsedSec] = useState<number>(0);
  const [perfReportText, setPerfReportText] = useState<string>('');
  const [isRecordingLoad, setIsRecordingLoad] = useState<boolean>(false);
  const [loadTraces, setLoadTraces] = useState<any[]>([]);
  const [isMeasuringServers, setIsMeasuringServers] = useState<boolean>(false);
  const [serverMeasureResults, setServerMeasureResults] = useState<any[]>([]);
  const [serverMeasureError, setServerMeasureError] = useState<string>('');
  const [copiedLatencyTable, setCopiedLatencyTable] = useState<boolean>(false);
  const [connectionEvents, setConnectionEvents] = useState<ConnectionEventEntry[]>(() =>
    deviceSync.getConnectionEvents()
  );

  const deviceId = deviceSync.getDeviceId();
  const deviceName = deviceSync.getDeviceName();
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const lastSent = getLastSentCommand();
  const lastReceived = getLastReceivedCommand();

  const loadData = async () => {
    setClientBuildId(getClientBuildId());
    setWsStatus(getWebSocketStatus());
    const health = await fetchServerHealth();
    setServerBuildId(health.buildId);
    const sw = await checkServiceWorkerRegistered();
    setSwRegistered(sw);
    try {
      const api = (window as any).electronAPI;
      if (api?.getLoadRecording) {
        const rec = await api.getLoadRecording();
        if (typeof rec === 'boolean') setIsRecordingLoad(rec);
        else if (typeof rec?.enabled === 'boolean') setIsRecordingLoad(rec.enabled);
      }
      if (api?.getLoadTraces) {
        const res = await api.getLoadTraces();
        if (Array.isArray(res?.traces)) setLoadTraces(res.traces);
      }
    } catch (_) {}
  };

  const handleToggleLoadRecording = async () => {
    const next = !isRecordingLoad;
    setIsRecordingLoad(next);
    try {
      const api = (window as any).electronAPI;
      const res = await api?.setLoadRecording?.(next);
      if (typeof res === 'boolean') setIsRecordingLoad(res);
      else if (typeof res?.enabled === 'boolean') setIsRecordingLoad(res.enabled);
      const tr = await api?.getLoadTraces?.();
      if (Array.isArray(tr?.traces)) setLoadTraces(tr.traces);
    } catch (_) {}
  };

  const formatGroupedNetworkEvents = (rawItems: any): { totalCount: number; summary: string } => {
    if (typeof rawItems === 'number') {
      return { totalCount: rawItems, summary: '' };
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return { totalCount: 0, summary: '' };
    }
    const grouped = new Map<string, { host: string; code: string; count: number }>();
    let totalCount = 0;
    for (const item of rawItems) {
      if (item === null || item === undefined) continue;
      if (typeof item === 'string' || typeof item === 'number') {
        const key = `unknown|${String(item)}`;
        const prev = grouped.get(key);
        if (prev) prev.count += 1;
        else grouped.set(key, { host: 'unknown', code: String(item), count: 1 });
        totalCount += 1;
        continue;
      }
      const host = String(item.host || 'unknown');
      const code = String(item.code || item.error || item.statusOrCode || (item.status ? `HTTP_${item.status}` : 'ERR'));
      const count = Math.max(1, Number(item.count || 1));
      const key = `${host}|${code}`;
      const prev = grouped.get(key);
      if (prev) prev.count += count;
      else grouped.set(key, { host, code, count });
      totalCount += count;
    }
    const parts = Array.from(grouped.values()).map((g) => `${g.host}:${g.code} x${g.count}`);
    return {
      totalCount,
      summary: parts.length > 0 ? ` [${parts.join(', ')}]` : '',
    };
  };

  const formatServerLatencyTable = (results: any[]): string => {
    const lines: string[] = [
      '# | Servidor | Host | Estado | DNS (ms) | Connect (ms) | TLS (ms) | TTFB (ms) | Total (ms)',
      '--|----------|------|--------|----------|--------------|----------|-----------|-----------',
    ];
    for (const r of results) {
      const statusText = r.ok ? `OK (${r.statusCode})` : (r.error || `HTTP_${r.statusCode || 0}`);
      lines.push(
        `${(r.index ?? 0) + 1} | ${r.name || '-'} | ${r.host || '-'} | ${statusText} | ${r.dnsMs ?? '-'} | ${r.connectMs ?? r.tcpMs ?? '-'} | ${r.tlsMs ?? '-'} | ${r.ttfbMs ?? '-'} | ${r.totalMs ?? '-'}`
      );
    }
    return lines.join('\n');
  };

  const handleMeasureServers = async () => {
    const api = (window as any).electronAPI;
    if (!api?.measureServers) {
      setServerMeasureError('Medir servidores solo está disponible en la app de escritorio (Electron).');
      return;
    }
    setIsMeasuringServers(true);
    setServerMeasureError('');
    setCopiedLatencyTable(false);
    try {
      const res = await api.measureServers();
      if (Array.isArray(res?.results)) {
        setServerMeasureResults(res.results);
      } else {
        setServerMeasureResults([]);
      }
      if (!res?.ok && res?.error) {
        setServerMeasureError(res.error);
      }
    } catch (err: any) {
      setServerMeasureError(err?.message || 'Error al medir servidores');
    } finally {
      setIsMeasuringServers(false);
    }
  };

  const formatLoadTracesTable = (traces: any[]): string => {
    const lines: string[] = [
      'ID | Título | Hosts probados | Timestamps (creado/start/dom/load/video/rs3/frame ms) | Reqs (tot/fail/ad/cert) | Rotaciones | CPU 5s (Brw/Tab/GPU %) | net.request 1er srv (DNS/TCP/TLS/TTFB ms)',
      '---|--------|----------------|-------------------------------------------------------|-------------------------|------------|------------------------|------------------------------------------',
    ];
    for (const t of traces) {
      const hosts = (t.serversTried || []).map((s: any) => s.host || s.name).join(' -> ') || '-';
      const ts = t.timestamps || {};
      const videoCols =
        ts.firstVideoMs === null && t.videoStatus === 'no accesible'
          ? 'no accesible / no accesible / no accesible'
          : `${ts.firstVideoMs ?? (t.videoStatus === 'no accesible' ? 'no accesible' : '-')} / ${ts.readyState3Ms ?? '-'} / ${ts.firstFrameMs ?? (t.videoStatus === 'no accesible' ? 'no accesible' : '-')}`;
      const tsStr = `${ts.webviewCreatedMs ?? '-'} / ${ts.didStartLoadingMs ?? '-'} / ${ts.domReadyMs ?? '-'} / ${ts.didFinishLoadMs ?? '-'} / ${videoCols}`;
      const nw = t.network || {};
      const failFmt = formatGroupedNetworkEvents(nw.failedRequests);
      const legacyFailDetails =
        Array.isArray(nw.failedDetails) && nw.failedDetails.length > 0 && !failFmt.summary
          ? ` [${nw.failedDetails.map((f: any) => String(f?.statusOrCode || f?.code || f)).join(', ')}]`
          : '';
      const certFmt = formatGroupedNetworkEvents(nw.certErrors);
      const reqStr = `${nw.totalRequests ?? 0}/${failFmt.totalCount}${failFmt.summary || legacyFailDetails}/${nw.adBlockedRequests ?? 0}/${certFmt.totalCount}${certFmt.summary}`;
      const rotStr = (t.rotations || []).map((r: any) => `${r.method}(${r.reason}@${r.elapsedSec}s)`).join('; ') || '0';
      const cpu = t.cpuAt5s || {};
      const cpuStr = `${cpu.Browser ?? '-'}% / ${cpu.Tab ?? '-'}% / ${cpu.GPU ?? '-'}%`;
      const nr = t.firstServerNetProbe || {};
      const nrStr = `${nr.dnsMs ?? '-'} / ${nr.connectMs ?? nr.tcpMs ?? '-'} / ${nr.tlsMs ?? '-'} / ${nr.ttfbMs ?? '-'}`;
      lines.push(`${t.id} | ${t.title || '-'} | ${hosts} | ${tsStr} | ${reqStr} | ${rotStr} | ${cpuStr} | ${nrStr}`);
    }
    return lines.join('\n');
  };

  useEffect(() => {
    loadData();
    const unsubEvents = deviceSync.onConnectionEvents((evts) => {
      setConnectionEvents(evts);
    });
    const interval = setInterval(() => {
      setWsStatus(getWebSocketStatus());
      setConnectionEvents(deviceSync.getConnectionEvents());
    }, 2500);
    return () => {
      clearInterval(interval);
      unsubEvents();
    };
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestSteps(null);
    try {
      const steps = await runConnectionTest({
        roomId,
        deviceId,
        deviceName,
        deviceType: deviceRole,
      });
      setTestSteps(steps);
    } catch (_) {}
    setIsTesting(false);
  };

  const handleClearCache = async () => {
    setIsClearing(true);
    await clearCacheAndReload();
  };

  // PARTE 3 (Paso 7): Grabación de rendimiento cada 5 s durante 2 min (o con CINECAST_DEBUG_PERF=1)
  const startPerfRecording = (durationSec = 120) => {
    if (isRecordingPerf) return;
    setIsRecordingPerf(true);
    setPerfElapsedSec(0);
    const samples: any[] = [];
    let longTaskCount = 0;
    let longTaskTotalMs = 0;
    let obs: PerformanceObserver | null = null;
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount += 1;
            longTaskTotalMs += entry.duration || 0;
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
      }
    } catch (_) {}

    let lastSnap: any = null;
    let lastBroadcastCount = deviceSync.getStatesBroadcastCount();
    let elapsed = 0;

    (window as any).electronAPI?.getPerfSnapshot?.().then((initial: any) => {
      lastSnap = initial;
    }).catch(() => {});

    const timer = setInterval(async () => {
      elapsed += 5;
      setPerfElapsedSec(elapsed);
      try {
        const snap = await (window as any).electronAPI?.getPerfSnapshot?.();
        const curBroadcast = deviceSync.getStatesBroadcastCount();
        const dt = 5;
        const dGetReal = snap && lastSnap ? Math.max(0, snap.counters.getRealMediaState - lastSnap.counters.getRealMediaState) : 0;
        const dCtrl = snap && lastSnap ? Math.max(0, snap.counters.controlActiveMedia - lastSnap.counters.controlActiveMedia) : 0;
        const dAudio = snap && lastSnap ? Math.max(0, snap.counters.embedAudioScript - lastSnap.counters.embedAudioScript) : 0;
        const dStates = Math.max(0, curBroadcast - lastBroadcastCount);
        lastSnap = snap || lastSnap;
        lastBroadcastCount = curBroadcast;

        const row = {
          tSec: elapsed,
          processes: snap?.processes || null,
          video: snap?.videoQuality || null,
          longtasks: { count: longTaskCount, totalMs: Number(longTaskTotalMs.toFixed(1)) },
          callsPerSec: {
            getRealMediaState: Number((dGetReal / dt).toFixed(2)),
            controlActiveMedia: Number((dCtrl / dt).toFixed(2)),
            embedAudioScript: Number((dAudio / dt).toFixed(2)),
            statesBroadcast: Number((dStates / dt).toFixed(2)),
            statesBroadcastTotal: dStates,
          },
        };
        longTaskCount = 0;
        longTaskTotalMs = 0;
        samples.push(row);
        setPerfReportText(JSON.stringify({ generatedAt: new Date().toISOString(), durationSec: elapsed, samples }, null, 2));
      } catch (_) {}

      if (elapsed >= durationSec) {
        clearInterval(timer);
        try { obs?.disconnect(); } catch (_) {}
        setIsRecordingPerf(false);
      }
    }, 5000);
  };

  useEffect(() => {
    if ((window as any).electronAPI?.isDebugPerf?.() || (window as any).CINECAST_DEBUG_PERF) {
      startPerfRecording(120);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const versionsDiffer =
    serverBuildId !== 'cargando...' &&
    serverBuildId !== 'desconocido' &&
    clientBuildId !== 'desconocido' &&
    clientBuildId !== serverBuildId;

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4 text-xs">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Diagnóstico de conexión</h2>
            <p className="text-[11px] text-zinc-400">Estado de red, sincronización y versiones</p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadData}
          title="Actualizar datos"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {versionsDiffer && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold block">Versiones del cliente y servidor difieren</strong>
            <span>El navegador tiene cargada una versión distinta a la del servidor. Usa "Limpiar caché y recargar" si notas inconsistencias.</span>
          </div>
        </div>
      )}

      {/* Grid de parámetros clave */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Versión Cliente (App)</div>
          <div className="font-mono text-zinc-200 break-all text-[11px] mt-0.5">{clientBuildId || 'desconocido'}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Versión Servidor (/api/health)</div>
          <div className="font-mono text-zinc-200 break-all text-[11px] mt-0.5">{serverBuildId}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">URL Base</div>
          <div className="font-mono text-zinc-200 break-all text-[11px] mt-0.5">{baseUrl}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Rol actual</div>
          <div className="font-semibold text-white mt-0.5 capitalize">{deviceRole}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">ID del dispositivo (deviceId)</div>
          <div className="font-mono text-zinc-200 break-all text-[11px] mt-0.5">{deviceId}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Sala (roomId)</div>
          <div className="font-mono font-bold text-red-400 mt-0.5">{roomId}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Estado del WebSocket</div>
          <div className="font-semibold text-emerald-400 mt-0.5">{wsStatus}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
          <div className="text-[11px] text-zinc-400">Service Worker</div>
          <div className="font-semibold text-zinc-200 mt-0.5">
            {swRegistered === null ? 'Verificando...' : swRegistered ? '✓ Registrado' : '✗ No registrado'}
          </div>
        </div>
      </div>

      {/* Comandos y Diagnóstico de últimos 50 */}
      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider">
            Últimos 50 comandos (Estado y RTT)
          </div>
          <button
            type="button"
            onClick={async () => {
              const summary = deviceSync.getSyncTelemetrySummary();
              const history = deviceSync.getRecentCommandsDiagnostics();
              const fullReport = {
                timestamp: new Date().toISOString(),
                deviceId,
                roomId,
                role: deviceRole,
                telemetry: summary,
                commands: history,
                connectionEvents: deviceSync.getConnectionEvents(),
              };
              try {
                await navigator.clipboard.writeText(JSON.stringify(fullReport, null, 2));
                alert('Informe de diagnóstico copiado al portapapeles');
              } catch (_) {
                prompt('Copia el informe:', JSON.stringify(fullReport));
              }
            }}
            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
          >
            Copiar informe
          </button>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-1 pr-1 font-mono text-[11px] divide-y divide-zinc-900">
          {deviceSync.getRecentCommandsDiagnostics().length === 0 ? (
            <div className="text-zinc-500 italic py-1">No hay comandos registrados aún</div>
          ) : (
            deviceSync.getRecentCommandsDiagnostics().map((c) => (
              <div key={c.id} className="py-1 flex items-center justify-between gap-2">
                <span className="text-zinc-300 truncate">
                  <strong className="text-white">{c.action}</strong>{' '}
                  <span className="text-zinc-500 text-[10px]">({c.id})</span>
                </span>
                <span className="shrink-0 flex items-center gap-1">
                  {c.status === 'confirmed' ? (
                    <span className="text-emerald-400 font-bold">✓ {c.rttMs ?? 0}ms</span>
                  ) : c.status === 'retrying' ? (
                    <span className="text-amber-400 font-bold animate-pulse">Reintentando...</span>
                  ) : (
                    <span className="text-red-400 font-bold">⚠ Falló</span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Historial de eventos de conexión (últimos 30) */}
      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider">
            Eventos de conexión (últimos {connectionEvents.length}/30)
          </div>
          <button
            type="button"
            onClick={async () => {
              const payload = JSON.stringify(connectionEvents, null, 2);
              try {
                await navigator.clipboard.writeText(payload);
                alert('Eventos de conexión copiados al portapapeles');
              } catch (_) {
                prompt('Copia los eventos:', payload);
              }
            }}
            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
          >
            Copiar eventos
          </button>
        </div>

        <div className="max-h-44 overflow-y-auto space-y-1 pr-1 font-mono text-[11px] divide-y divide-zinc-900">
          {connectionEvents.length === 0 ? (
            <div className="text-zinc-500 italic py-1">No hay eventos de conexión registrados aún</div>
          ) : (
            [...connectionEvents].reverse().map((ev) => (
              <div key={ev.id} className="py-1 flex items-center justify-between gap-2">
                <span className="text-zinc-300 truncate">
                  <span className="text-zinc-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>{' '}
                  <strong className="text-white uppercase">{ev.event}</strong>{' '}
                  <span className="text-zinc-400">[{ev.transport}]</span>{' '}
                  <span className="text-zinc-400">{ev.reason}</span>
                </span>
                {typeof ev.code === 'number' && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">
                    {ev.code}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Lista de dispositivos */}
      <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
        <div className="text-[11px] text-zinc-400 font-semibold flex items-center justify-between">
          <span>Dispositivos conectados ({devices.length})</span>
        </div>
        {devices.length === 0 ? (
          <div className="text-zinc-500 italic text-[11px]">No hay otros dispositivos en la sala</div>
        ) : (
          <ul className="divide-y divide-zinc-800/60 text-[11px]">
            {devices.map((d) => (
              <li key={d.id} className="py-1 flex items-center justify-between gap-2">
                <span className="text-zinc-200 font-medium">
                  {d.name} {d.id === deviceId && <span className="text-zinc-500 text-[10px]">(este)</span>}
                </span>
                <span className="font-mono text-zinc-400 uppercase text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">
                  {d.type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Resultados de prueba de conexión */}
      {testSteps && (
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
          <div className="text-xs font-bold text-white">Resultado de prueba de conexión:</div>
          <div className="space-y-1">
            {testSteps.map((s) => (
              <div key={s.name} className="flex items-start gap-2 text-xs">
                {s.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="break-all">
                  <strong className="text-white font-mono">{s.name}</strong>:{' '}
                  <span className={s.ok ? 'text-zinc-300' : 'text-red-300'}>{s.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="pt-1 flex flex-col sm:flex-row flex-wrap gap-2.5">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={isTesting}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <Server className="w-4 h-4" />
          <span>{isTesting ? 'Probando endpoints...' : 'Probar conexión'}</span>
        </button>

        <button
          type="button"
          onClick={() => startPerfRecording(120)}
          disabled={isRecordingPerf}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <Cpu className="w-4 h-4" />
          <span>{isRecordingPerf ? `Grabando rendimiento (${perfElapsedSec}s / 120s)...` : 'Grabar rendimiento 2 min'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleLoadRecording}
          className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
            isRecordingLoad
              ? 'bg-amber-600 hover:bg-amber-500 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>{isRecordingLoad ? 'Grabar carga: ACTIVO' : 'Grabar carga'}</span>
        </button>

        <button
          type="button"
          data-testid="btn-measure-servers"
          onClick={handleMeasureServers}
          disabled={isMeasuringServers}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <Server className="w-4 h-4" />
          <span>{isMeasuringServers ? 'Midiendo servidores...' : 'Medir servidores'}</span>
        </button>

        <button
          type="button"
          onClick={handleClearCache}
          disabled={isClearing}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-2 border border-zinc-700 transition disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          <span>{isClearing ? 'Limpiando...' : 'Limpiar caché y recargar'}</span>
        </button>
      </div>

      {perfReportText && (
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-emerald-400">Informe de rendimiento (muestras cada 5 s)</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(perfReportText);
                  alert('Informe de rendimiento copiado al portapapeles');
                } catch (_) {}
              }}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
            >
              Copiar informe de rendimiento
            </button>
          </div>
          <textarea
            readOnly
            value={perfReportText}
            rows={8}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 font-mono text-[11px] text-zinc-300"
          />
        </div>
      )}

      {/* PARTE 4 (Paso 11): Informe de "Grabar carga" */}
      <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-amber-400">
            Grabar carga ({loadTraces.length} inicios registrados)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadData}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={async () => {
                const jsonStr = JSON.stringify(loadTraces, null, 2);
                try {
                  await navigator.clipboard.writeText(jsonStr);
                  alert('Informe de carga (JSON) copiado al portapapeles');
                } catch (_) {}
              }}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
            >
              Copiar JSON
            </button>
            <button
              type="button"
              onClick={async () => {
                const tableStr = formatLoadTracesTable(loadTraces);
                try {
                  await navigator.clipboard.writeText(tableStr);
                  alert('Informe de carga (Tabla) copiado al portapapeles');
                } catch (_) {}
              }}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
            >
              Copiar tabla de texto
            </button>
          </div>
        </div>
        {loadTraces.length > 0 ? (
          <textarea
            readOnly
            value={formatLoadTracesTable(loadTraces)}
            rows={6}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 font-mono text-[11px] text-zinc-300"
          />
        ) : (
          <div className="text-[11px] text-zinc-500 italic">
            Activá "Grabar carga" e iniciá una reproducción para registrar servidores, marcas de tiempo, red, rotaciones, CPU a los 5 s y net.request.
          </div>
        )}
      </div>

      {/* PARTE 4: Medición serializada de latencia de servidores del reproductor actual */}
      {(serverMeasureResults.length > 0 || serverMeasureError || isMeasuringServers) && (
        <div
          data-testid="server-latency-section"
          className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-sky-400">
              Latencia de servidores (net.request en serie, timeout 8 s — sin reordenar reproductor)
            </span>
            {serverMeasureResults.length > 0 && (
              <button
                type="button"
                data-testid="btn-copy-server-latency"
                onClick={async () => {
                  const tableStr = formatServerLatencyTable(serverMeasureResults);
                  try {
                    await navigator.clipboard.writeText(tableStr);
                    setCopiedLatencyTable(true);
                    setTimeout(() => setCopiedLatencyTable(false), 2000);
                  } catch (_) {}
                }}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-zinc-200 border border-zinc-700 transition"
              >
                {copiedLatencyTable ? 'Copiado' : 'Copiar tabla'}
              </button>
            )}
          </div>
          {serverMeasureError && (
            <div className="text-xs text-amber-300" data-testid="server-latency-error">
              {serverMeasureError}
            </div>
          )}
          {serverMeasureResults.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-[11px] text-zinc-300">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="py-1 pr-2">#</th>
                      <th className="py-1 pr-2">Servidor</th>
                      <th className="py-1 pr-2">Host</th>
                      <th className="py-1 pr-2">Estado</th>
                      <th className="py-1 pr-2">DNS</th>
                      <th className="py-1 pr-2">Connect</th>
                      <th className="py-1 pr-2">TLS</th>
                      <th className="py-1 pr-2">TTFB</th>
                      <th className="py-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {serverMeasureResults.map((r, i) => (
                      <tr key={`${r.name}-${i}`}>
                        <td className="py-1 pr-2 text-zinc-500">{(r.index ?? i) + 1}</td>
                        <td className="py-1 pr-2 text-white">{r.name}</td>
                        <td className="py-1 pr-2">{r.host}</td>
                        <td className={`py-1 pr-2 ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.ok ? `OK (${r.statusCode})` : (r.error || `HTTP_${r.statusCode || 0}`)}
                        </td>
                        <td className="py-1 pr-2">{r.dnsMs} ms</td>
                        <td className="py-1 pr-2">{r.connectMs ?? r.tcpMs ?? '-'} ms</td>
                        <td className="py-1 pr-2">{r.tlsMs} ms</td>
                        <td className="py-1 pr-2">{r.ttfbMs} ms</td>
                        <td className="py-1">{r.totalMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <textarea
                data-testid="server-latency-table"
                readOnly
                value={formatServerLatencyTable(serverMeasureResults)}
                rows={Math.min(10, serverMeasureResults.length + 3)}
                className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 font-mono text-[11px] text-zinc-300"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
