import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { DeviceInfo, DeviceType } from '../types';
import { Tv, Smartphone, Monitor, Cast, Check, Copy, RefreshCw, X, Radio, ArrowRight, Wifi } from 'lucide-react';
import { deviceSync } from '../services/deviceSync';

interface CastModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: DeviceInfo[];
  currentDeviceId: string;
  currentRoomId: string;
  currentDeviceType: DeviceType;
  selectedScreenId: string | null;
  onSelectScreen: (deviceId: string) => void;
  onChangeRoom: (newRoomId: string) => void;
  onChangeDeviceType: (type: DeviceType) => void;
  onOpenDualSimulator: () => void;
  isPermanentHome: boolean;
  onTogglePermanentHome: () => void;
}

export const CastModal: React.FC<CastModalProps> = ({
  isOpen,
  onClose,
  devices,
  currentDeviceId,
  currentRoomId,
  currentDeviceType,
  selectedScreenId,
  onSelectScreen,
  onChangeRoom,
  onChangeDeviceType,
  onOpenDualSimulator,
  isPermanentHome,
  onTogglePermanentHome,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [customPinInput, setCustomPinInput] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [pairingUrl, setPairingUrl] = useState<string>(() => deviceSync.getPairingUrl('remote'));
  const [lanIp, setLanIp] = useState<string>(() => deviceSync.getLanIp());

  useEffect(() => {
    if (!isOpen) return;

    deviceSync.fetchLocalIp().then((ip) => {
      setLanIp(ip);
      const url = deviceSync.getPairingUrl('remote');
      setPairingUrl(url);

      QRCode.toDataURL(url, {
        width: 220,
        margin: 1.5,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then(setQrDataUrl)
        .catch(console.error);
    });
  }, [isOpen, currentRoomId]);

  if (!isOpen) return null;

  const screens = devices.filter((d) => d.type === 'screen' || d.type === 'hybrid');
  const remotes = devices.filter((d) => d.type === 'remote');

  const handleCopy = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleJoinPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (customPinInput.trim()) {
      onChangeRoom(customPinInput.trim());
      setCustomPinInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Fijo */}
        <div className="shrink-0 px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-red-600/20 text-red-500 border border-red-500/30">
              <Cast className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Dispositivos en Red & Transmisión</h3>
              <p className="text-[11px] text-zinc-400">
                Sala: <span className="font-mono text-red-400 font-semibold">{currentRoomId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar">
          {/* Quick Dual Mode Promo */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-red-950/50 via-zinc-900 to-zinc-900 border border-red-900/40 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-red-400 bg-red-950/80 px-2 py-0.5 rounded border border-red-800/60">
                  Prueba en vivo
                </span>
                <span className="text-sm font-semibold text-white">Simulador Pantalla + Móvil</span>
              </div>
              <p className="text-xs text-zinc-400">
                Probá el control remoto y la TV en simultáneo en pantalla dividida en esta misma ventana.
              </p>
            </div>
            <button
              onClick={() => {
                onClose();
                onOpenDualSimulator();
              }}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5"
            >
              Abrir Dual
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Vínculo de Hogar Permanente */}
          <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60">
                  Vínculo de Hogar Permanente
                </span>
                {isPermanentHome && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                    <Check className="w-3.5 h-3.5" /> Activado
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-300">
                Guarda esta sala ({currentRoomId}) como tu casa para conectarse solo apenas abras la app en el celular, sin escanear QR ni poner PIN cada vez.
              </p>
            </div>
            <button
              onClick={onTogglePermanentHome}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                isPermanentHome
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
              }`}
            >
              {isPermanentHome ? 'Desvincular Hogar' : 'Fijar como Mi Hogar'}
            </button>
          </div>

          {/* Connected Screens List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Tv className="w-4 h-4 text-red-500" />
                Pantallas disponibles (PC / TV / Monitor)
              </label>
              <span className="text-[11px] text-zinc-500">
                {screens.length} {screens.length === 1 ? 'dispositivo' : 'dispositivos'}
              </span>
            </div>

            <div className="space-y-2">
              {screens.map((device) => {
                const isSelected = selectedScreenId === device.id;
                const isThisDevice = device.id === currentDeviceId;

                return (
                  <div
                    key={device.id}
                    onClick={() => onSelectScreen(device.id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-red-950/30 border-red-500 ring-1 ring-red-500/40'
                        : 'bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                        <Monitor className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-zinc-100">{device.name}</span>
                          {isThisDevice && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                              Esta máquina
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                          <span className="flex items-center gap-1 text-emerald-400">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            En línea y lista
                          </span>
                          <span>•</span>
                          <span>ID: {device.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isSelected ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-950/60 px-2.5 py-1 rounded-full border border-red-800/40">
                          <Check className="w-3.5 h-3.5" />
                          Seleccionada
                        </span>
                      ) : (
                        <button className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition">
                          Transmitir aquí
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {screens.length === 0 && (
                <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/60 text-center">
                  <p className="text-sm text-zinc-400 mb-1">No hay pantallas detectadas en esta sala.</p>
                  <p className="text-xs text-zinc-500">
                    Abrí CineCast en tu PC con el código <span className="font-mono text-zinc-300 font-bold">{currentRoomId}</span> o escaneá el QR abajo.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* QR Code and Pairing Section */}
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <h4 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              Escanear con tu Celular para usar de Control Remoto
            </h4>
            <p className="text-xs text-zinc-400 mb-4">
              Apuntá la cámara de tu teléfono al código QR para vincularte instantáneamente y manejar la PC desde tu cama:
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-5">
              {qrDataUrl && (
                <div className="p-2 bg-white rounded-xl shadow-lg shrink-0">
                  <img src={qrDataUrl} alt="QR Code Vincular" className="w-36 h-36 rounded-lg" />
                </div>
              )}

              <div className="space-y-3 w-full">
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">Código PIN de la Sala:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xl font-bold tracking-widest px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-red-400">
                      {currentRoomId}
                    </span>
                    <button
                      onClick={handleCopy}
                      className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copiedLink ? 'Copiado!' : 'Copiar Link'}
                    </button>
                  </div>
                </div>

                {/* Local LAN IP for Direct Phone Connection */}
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    Dirección WiFi Local:
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {lanIp && lanIp !== '127.0.0.1' ? `${lanIp}:3000` : 'Buscando IP WiFi...'}
                  </span>
                </div>

                {/* Change Room PIN */}
                <form onSubmit={handleJoinPin} className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Ingresar otro código..."
                    value={customPinInput}
                    onChange={(e) => setCustomPinInput(e.target.value)}
                    className="flex-1 bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition"
                  >
                    Unirse
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Current Device Mode Switcher */}
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
              Rol de este dispositivo actual
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onChangeDeviceType('remote')}
                className={`p-2.5 rounded-lg border text-left transition flex items-center gap-2.5 ${
                  currentDeviceType === 'remote'
                    ? 'bg-red-950/40 border-red-500 text-white'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Modo Celular</div>
                  <div className="text-[10px] text-zinc-400">Control Remoto & Catálogo</div>
                </div>
              </button>

              <button
                onClick={() => onChangeDeviceType('screen')}
                className={`p-2.5 rounded-lg border text-left transition flex items-center gap-2.5 ${
                  currentDeviceType === 'screen'
                    ? 'bg-red-950/40 border-red-500 text-white'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <Monitor className="w-4 h-4 text-red-500 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Modo Pantalla PC/TV</div>
                  <div className="text-[10px] text-zinc-400">Reproductor & Reposo</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-zinc-950/90 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
