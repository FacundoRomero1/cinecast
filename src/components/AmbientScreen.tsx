import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { MediaItem } from '../types';
import { Tv, Smartphone, Clock, Sparkles, Volume2, ArrowRight } from 'lucide-react';

interface AmbientScreenProps {
  deviceName: string;
  roomId: string;
  recentMedia: MediaItem[];
  onWakeScreen: () => void;
  onPlayDirectly: (media: MediaItem) => void;
}

export const AmbientScreen: React.FC<AmbientScreenProps> = ({
  deviceName,
  roomId,
  recentMedia,
  onWakeScreen,
  onPlayDirectly,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [backgroundIndex, setBackgroundIndex] = useState(0);

  // Update clock every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setCurrentDate(
        now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cycle ambient background poster every 12 seconds
  useEffect(() => {
    if (recentMedia.length <= 1) return;
    const interval = setInterval(() => {
      setBackgroundIndex((prev) => (prev + 1) % recentMedia.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [recentMedia]);

  // Generate QR code for mobile connection
  useEffect(() => {
    const mobileUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?role=remote`
      : '';
    QRCode.toDataURL(mobileUrl, {
      width: 180,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then(setQrCodeUrl)
      .catch(console.error);
  }, [roomId]);

  const activePoster = recentMedia[backgroundIndex] || recentMedia[0];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black text-white select-none flex flex-col justify-between p-8 sm:p-12">
      {/* Background Cinematic Backdrop with slow zoom */}
      {activePoster && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-1000 transform scale-105 filter brightness-40"
          style={{
            backgroundImage: `url(${activePoster.backdropUrl})`,
          }}
        />
      )}

      {/* Vignette Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/70 pointer-events-none" />
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none opacity-60" />

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-red-600 font-extrabold text-3xl sm:text-4xl tracking-tighter font-display">
              CINECAST
            </span>
          </div>
          <div className="h-6 w-px bg-zinc-700 hidden sm:block" />
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-700/60 backdrop-blur-md">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-xs font-semibold text-zinc-200">{deviceName}</span>
            <span className="text-[10px] text-zinc-400 font-mono">EN REPOSO</span>
          </div>
        </div>

        {/* Digital Clock */}
        <div className="text-right">
          <div className="font-mono text-3xl sm:text-5xl font-extralight tracking-wider text-zinc-100 drop-shadow-md">
            {currentTime}
          </div>
          <div className="text-xs sm:text-sm text-zinc-400 capitalize font-medium">
            {currentDate}
          </div>
        </div>
      </div>

      {/* Center Notice: Ready for Mobile Cast */}
      <div className="relative z-10 max-w-3xl mx-auto text-center space-y-6 my-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-950/70 border border-red-700/50 text-red-300 text-xs sm:text-sm font-medium backdrop-blur-md animate-pulse">
          <Sparkles className="w-4 h-4 text-red-400" />
          Pantalla lista para recibir reproducción desde tu celular
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg leading-tight">
          Estás acostado? <br />
          <span className="bg-gradient-to-r from-red-500 via-rose-400 to-amber-400 bg-clip-text text-transparent">
            Elegí qué ver desde tu cama.
          </span>
        </h1>

        <p className="text-sm sm:text-lg text-zinc-300 max-w-xl mx-auto leading-relaxed">
          Abrí CineCast en tu teléfono, seleccioná tu película o serie favorita y comenzará a reproducirse aquí al instante con tu volumen y efectos preferidos.
        </p>

        {/* Featured Backdrop Details */}
        {activePoster && (
          <div className="pt-2">
            <div className="inline-block p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-md text-left max-w-md shadow-2xl">
              <div className="text-xs uppercase tracking-wider text-red-400 font-semibold mb-1">
                Destacado en el catálogo
              </div>
              <h2 className="text-xl font-bold text-white mb-1">{activePoster.title}</h2>
              <p className="text-xs text-zinc-300 line-clamp-2 mb-3">{activePoster.overview}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPlayDirectly(activePoster)}
                  className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center gap-1.5"
                >
                  Reproducir aquí ahora
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onWakeScreen}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition"
                >
                  Explorar catálogo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Bar with Room PIN & QR */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-4">
          {qrCodeUrl && (
            <div className="p-1.5 bg-white rounded-xl shadow-md shrink-0">
              <img src={qrCodeUrl} alt="Vincular Celular" className="w-16 h-16 sm:w-20 sm:h-20 rounded" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span className="text-xs uppercase tracking-wider text-zinc-400 font-bold">
                Conectar control remoto
              </span>
            </div>
            <p className="text-xs text-zinc-300 mt-0.5">
              Escaneá el QR con tu cámara o ingresá el código PIN:
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="font-mono text-xl sm:text-2xl font-black text-red-500 tracking-widest bg-zinc-900 px-3 py-0.5 rounded-lg border border-zinc-700">
                {roomId}
              </span>
              <span className="text-[11px] text-zinc-400">Sala local</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={onWakeScreen}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2"
          >
            <Tv className="w-4 h-4" />
            Usar teclado / mouse en PC
          </button>
        </div>
      </div>
    </div>
  );
};
