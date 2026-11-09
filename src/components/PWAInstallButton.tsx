import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  Download,
  Smartphone,
  X,
  Check,
  Share2,
  PlusSquare,
  MoreVertical,
  Copy,
  QrCode,
  Shield,
  Monitor,
  ExternalLink,
  Radio,
  Laptop,
} from 'lucide-react';
import { deviceSync } from '../services/deviceSync';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'downloads' | 'brave' | 'ios'>('downloads');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [signalTested, setSignalTested] = useState(false);

  const roomId = deviceSync.getRoomId();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const appInstallUrl = currentOrigin ? `${currentOrigin}/?role=remote` : '';
  const desktopFullUrl = currentOrigin ? `${currentOrigin}/?role=screen` : '';

  const pcInstallerDownloadUrl = `/api/download/pc-windows?room=${encodeURIComponent(roomId)}&origin=${encodeURIComponent(currentOrigin)}`;
  const mobileAppDownloadUrl = `/api/download/mobile-remote?room=${encodeURIComponent(roomId)}&origin=${encodeURIComponent(currentOrigin)}`;

  useEffect(() => {
    if (!showModal || !appInstallUrl) return;
    QRCode.toDataURL(appInstallUrl, {
      width: 190,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then(setQrUrl)
      .catch(() => {});
  }, [showModal, appInstallUrl]);

  const handleCopyUrl = () => {
    if (navigator.clipboard && appInstallUrl) {
      navigator.clipboard.writeText(appInstallUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleTestSignal = () => {
    deviceSync.sendCommand({
      action: 'wakeScreen',
      payload: { testSignal: true },
    });
    setSignalTested(true);
    setTimeout(() => setSignalTested(false), 2500);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-xs font-semibold transition shrink-0"
        title="Descargar Apps (PC y Celular)"
      >
        <Download className="w-3.5 h-3.5 text-red-500 shrink-0" />
        <span className="hidden sm:inline">Apps</span>
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Fijo */}
            <div className="shrink-0 px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Descargar Apps (PC y Celular)</h3>
                  <p className="text-[11px] text-zinc-400">
                    Sala: <span className="text-red-400 font-mono font-bold">{roomId}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cuerpo Scrolleable */}
            <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar">
              {/* Live Signal Test Button */}
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-300">
                  <span className="font-bold text-white block">¿Probar señal de control ahora?</span>
                  <span className="text-zinc-400 text-[11px]">Envía un pulso de prueba a tu pantalla:</span>
                </div>
                <button
                  onClick={handleTestSignal}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow ${
                    signalTested
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500 hover:bg-amber-400 text-black'
                  }`}
                >
                  {signalTested ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>¡Enviada!</span>
                    </>
                  ) : (
                    <>
                      <Radio className="w-3.5 h-3.5" />
                      <span>Probar</span>
                    </>
                  )}
                </button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800">
                <button
                  onClick={() => setSelectedTab('downloads')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition ${
                    selectedTab === 'downloads'
                      ? 'bg-red-600 text-white shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  ⬇ Descarga
                </button>
                <button
                  onClick={() => setSelectedTab('brave')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition ${
                    selectedTab === 'brave'
                      ? 'bg-orange-600 text-white shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  🦁 Brave
                </button>
                <button
                  onClick={() => setSelectedTab('ios')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition ${
                    selectedTab === 'ios'
                      ? 'bg-red-600 text-white shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  🍎 iPhone
                </button>
              </div>

              {selectedTab === 'downloads' && (
                <div className="space-y-3">
                  {/* 1. PC Windows Downloadable Installer */}
                  <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
                        <Laptop className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">1. App para PC (Windows)</h4>
                        <p className="text-[10px] text-zinc-400">
                          Acceso directo en el Escritorio con audio automático habilitado.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 pt-0.5">
                      <a
                        href={pcInstallerDownloadUrl}
                        download="Instalar-CineCast-PC.bat"
                        className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar (.bat)</span>
                      </a>
                      <a
                        href={desktopFullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition flex items-center justify-center gap-1 border border-zinc-700"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                        <span>Abrir Pantalla</span>
                      </a>
                    </div>
                  </div>

                  {/* 2. Mobile Downloadable App + QR */}
                  <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">2. Control Remoto Móvil</h4>
                        <p className="text-[10px] text-zinc-400">
                          Escaneá el QR o descargá la app web para tu celular.
                        </p>
                      </div>
                    </div>

                    {qrUrl && (
                      <div className="text-center py-0.5">
                        <div className="p-2 bg-white rounded-xl inline-block shadow-md">
                          <img src={qrUrl} alt="QR Control Remoto" className="w-32 h-32 rounded-lg mx-auto object-contain" />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <a
                        href={mobileAppDownloadUrl}
                        download="CineCast-Control-Celu.html"
                        className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar (.html)</span>
                      </a>

                      <button
                        onClick={handleCopyUrl}
                        className="py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition flex items-center justify-center gap-1.5 border border-zinc-700"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">¡Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar Link</span>
                          </>
                        )}
                      </button>
                    </div>

                    {isInstallable && !isInstalled && (
                      <button
                        onClick={install}
                        className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Instalar PWA Nativa</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selectedTab === 'brave' && (
                <div className="space-y-2.5 bg-zinc-900 p-3.5 rounded-xl border border-orange-500/30 text-xs text-zinc-300">
                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-orange-950/60 text-orange-400 shrink-0 mt-0.5">
                      <Shield className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">¿Por qué Brave bloquea la instalación?</span> Por privacidad evita la verificación de Google Play.
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-zinc-800 text-emerald-400 shrink-0 mt-0.5">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">En Celular:</span> Tocá <strong>3 puntitos (⋮) → Agregar a la pantalla principal</strong> o descargá la app (.html).
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-zinc-800 text-amber-400 shrink-0 mt-0.5">
                      <Monitor className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">En PC:</span> Descargá el instalador (.bat) en la pestaña Descarga.
                    </div>
                  </div>
                </div>
              )}

              {selectedTab === 'ios' && (
                <div className="space-y-2.5 bg-zinc-900 p-3.5 rounded-xl border border-zinc-800 text-xs text-zinc-300">
                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-zinc-800 text-blue-400 shrink-0 mt-0.5">
                      <Share2 className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">1. Tocá Compartir</span> en Safari.
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-zinc-800 text-emerald-400 shrink-0 mt-0.5">
                      <PlusSquare className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">2. Deslizá y tocá "Agregar a inicio"</span>.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
