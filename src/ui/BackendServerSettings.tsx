import React, { useEffect, useState } from 'react';
import { Server, Smartphone, Tv, Radio, RefreshCw, CheckCircle2, Wifi, Cloud } from 'lucide-react';
import { DeviceType } from '../types';
import {
  BackendConnectionState,
  probeAndSelectBackend,
  setCloudServerUrl,
  setLanServerUrl,
  subscribeBackendState,
} from '../services/apiOrigin';
import { deviceSync } from '../services/deviceSync';

interface BackendServerSettingsProps {
  deviceRole: DeviceType;
  setDeviceRole: React.Dispatch<React.SetStateAction<DeviceType>>;
}

export const BackendServerSettings: React.FC<BackendServerSettingsProps> = ({
  deviceRole,
  setDeviceRole,
}) => {
  const [backend, setBackend] = useState<BackendConnectionState>(() => ({
    mode: 'same-origin',
    activeUrl: '',
    lanUrl: '',
    cloudUrl: '',
    isNativeApp: false,
    isAndroidTv: false,
    lastCheckedAt: 0,
  }));
  const [lanInput, setLanInput] = useState<string>('');
  const [cloudInput, setCloudInput] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const unsub = subscribeBackendState((st) => {
      setBackend(st);
      setLanInput((prev) => (prev ? prev : st.lanUrl));
      setCloudInput((prev) => (prev ? prev : st.cloudUrl));
    });
    return unsub;
  }, []);

  const handleSelectRole = (nextRole: DeviceType) => {
    setDeviceRole(nextRole);
    deviceSync.setDeviceRole(nextRole);
    setStatusMsg({
      ok: true,
      text:
        nextRole === 'hybrid'
          ? 'Modo Independiente + Control activo: podés ver acá o enviar a tu PC/TV.'
          : nextRole === 'remote'
            ? 'Modo Control Remoto activo: lo que elijas se envía a la pantalla conectada.'
            : 'Modo Pantalla TV activo: este dispositivo recibe reproducción del celular.',
    });
  };

  const handleSaveAndTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTesting(true);
    setStatusMsg(null);
    setLanServerUrl(lanInput);
    setCloudServerUrl(cloudInput);
    const res = await probeAndSelectBackend();
    setIsTesting(false);

    if (res.mode === 'same-origin') {
      setStatusMsg({ ok: true, text: 'URLs guardadas. En este equipo se usa el servidor local embebido.' });
    } else if (res.mode === 'lan' && res.activeUrl) {
      deviceSync.connect();
      setStatusMsg({ ok: true, text: `Conectado a tu PC en WiFi (${res.activeUrl}).` });
    } else if (res.mode === 'cloud' && res.activeUrl) {
      deviceSync.connect();
      setStatusMsg({ ok: true, text: `Conectado al servidor en la nube (${res.activeUrl}).` });
    } else {
      setStatusMsg({
        ok: false,
        text: 'No se pudo conectar todavía. Revisá que la PC esté prendida en el mismo WiFi o ingresá tu URL en la nube.',
      });
    }
  };

  const modeBadge =
    backend.mode === 'same-origin'
      ? { label: 'Servidor local', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80' }
      : backend.mode === 'lan'
        ? { label: 'PC WiFi (LAN)', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80' }
        : backend.mode === 'cloud'
          ? { label: 'Nube (4G/Remoto)', color: 'text-sky-400 bg-sky-950/60 border-sky-800/80' }
          : { label: 'Sin servidor', color: 'text-amber-400 bg-amber-950/60 border-amber-800/80' };

  return (
    <section
      aria-label="Modo del dispositivo y servidor híbrido"
      className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Modo del dispositivo y Servidor Híbrido</div>
            <div className="text-xs text-zinc-400">
              Usá tu celular como reproductor independiente o control remoto, y alterná entre PC WiFi y Nube.
            </div>
          </div>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${modeBadge.color}`}>
          {modeBadge.label}
        </span>
      </div>

      {/* Selector de modo: Independiente vs Control Remoto vs Pantalla TV */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => handleSelectRole('hybrid')}
          className={`p-3 rounded-xl border text-left transition ${
            deviceRole === 'hybrid'
              ? 'bg-emerald-600/20 border-emerald-500 text-white'
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>Ver acá + Control</span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">
            Reproductor independiente en el celular y control opcional.
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleSelectRole('remote')}
          className={`p-3 rounded-xl border text-left transition ${
            deviceRole === 'remote'
              ? 'bg-red-600/20 border-red-500 text-white'
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Radio className="w-4 h-4 text-red-400" />
            <span>Control Remoto</span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">
            Envía películas, series, anime y deportes a tu PC o TV.
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleSelectRole('screen')}
          className={`p-3 rounded-xl border text-left transition ${
            deviceRole === 'screen'
              ? 'bg-sky-600/20 border-sky-500 text-white'
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Tv className="w-4 h-4 text-sky-400" />
            <span>Pantalla TV / PC</span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">
            Reproduce en pantalla grande y recibe comandos del celular.
          </p>
        </button>
      </div>

      {/* Configuración de Servidor Híbrido (LAN PC + Nube 4G) */}
      <form onSubmit={handleSaveAndTest} className="space-y-3 pt-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Servidor PC en WiFi (LAN)</span>
            </span>
            <input
              type="text"
              value={lanInput}
              onChange={(e) => setLanInput(e.target.value)}
              placeholder="http://192.168.18.39:3000"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              <span>Servidor en la Nube (4G / PC apagada)</span>
            </span>
            <input
              type="text"
              value={cloudInput}
              onChange={(e) => setCloudInput(e.target.value)}
              placeholder="https://tu-cinecast.onrender.com"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono outline-none focus:border-sky-500"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="submit"
            disabled={isTesting}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? 'Probando conexión...' : 'Guardar y probar conexión'}</span>
          </button>

          {backend.activeUrl && (
            <span className="text-[11px] font-mono text-zinc-400 truncate max-w-full">
              Activo: {backend.activeUrl}
            </span>
          )}
        </div>
      </form>

      {statusMsg && (
        <div
          className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            statusMsg.ok
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg.text}</span>
        </div>
      )}
    </section>
  );
};
