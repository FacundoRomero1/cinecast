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
import { deviceSync } from '../services/deviceSync';
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
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      setWsStatus(getWebSocketStatus());
    }, 2500);
    return () => clearInterval(interval);
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
      <div className="pt-1 flex flex-col sm:flex-row gap-2.5">
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
          onClick={handleClearCache}
          disabled={isClearing}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-2 border border-zinc-700 transition disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          <span>{isClearing ? 'Limpiando...' : 'Limpiar caché y recargar'}</span>
        </button>
      </div>
    </div>
  );
};
