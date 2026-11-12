import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Radio,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { authService, UserProfile } from '../services/authService';

export interface SpotifyDeviceProps {
  onDeviceReady?: (deviceId: string) => void;
  onTrackChange?: (track: any) => void;
  deviceName?: string;
}

export const SpotifyDevice: React.FC<SpotifyDeviceProps> = ({
  onDeviceReady,
  onTrackChange,
  deviceName = 'CineCast TV',
}) => {
  const [isSdkReady, setIsSdkReady] = useState<boolean>(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isPlayerConnected, setIsPlayerConnected] = useState<boolean>(false);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [isPaused, setIsPaused] = useState<boolean>(true);
  const [position, setPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [maskedClientId, setMaskedClientId] = useState<string>('');
  const [inputClientId, setInputClientId] = useState<string>('');
  const [isConfiguringClientId, setIsConfiguringClientId] = useState<boolean>(false);

  const playerRef = useRef<any>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cargar perfil y Client ID enmascarado
  useEffect(() => {
    const auth = authService.getAuthState();
    setUserProfile(auth.spotify.profile);
    setMaskedClientId(authService.getMaskedSpotifyClientId());

    const unsub = authService.subscribe(() => {
      const updated = authService.getAuthState();
      setUserProfile(updated.spotify.profile);
      setMaskedClientId(authService.getMaskedSpotifyClientId());
    });
    return unsub;
  }, []);

  // Inicializar Spotify Web Playback SDK
  useEffect(() => {
    let isCancelled = false;

    const setupPlayer = () => {
      if (isCancelled || !(window as any).Spotify?.Player) return;

      try {
        const player = new (window as any).Spotify.Player({
          name: deviceName,
          getOAuthToken: async (cb: (token: string) => void) => {
            const token = await authService.getSpotifyAccessToken();
            if (token) cb(token);
          },
          volume: volume / 100,
        });

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (isCancelled) return;
          setDeviceId(device_id);
          setIsPlayerConnected(true);
          setErrorMessage(null);
          if (onDeviceReady) onDeviceReady(device_id);
        });

        player.addListener('not_ready', () => {
          if (isCancelled) return;
          setIsPlayerConnected(false);
        });

        player.addListener('player_state_changed', (state: any) => {
          if (isCancelled || !state) return;
          const track = state.track_window?.current_track;
          setCurrentTrack(track || null);
          setIsPaused(state.paused);
          setPosition(state.position || 0);
          setDuration(state.duration || 0);
          if (onTrackChange && track) onTrackChange(track);
        });

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          if (isCancelled) return;
          setErrorMessage(`Error de inicialización: ${message}`);
        });

        player.addListener('authentication_error', ({ message }: { message: string }) => {
          if (isCancelled) return;
          setErrorMessage('Autenticación requerida para reproducir con Web Playback SDK.');
        });

        player.addListener('account_error', () => {
          if (isCancelled) return;
          setErrorMessage('Spotify Web Playback SDK requiere una cuenta Spotify Premium.');
        });

        player.connect().then((success: boolean) => {
          if (success && !isCancelled) {
            setIsSdkReady(true);
          }
        });

        playerRef.current = player;
      } catch (err: any) {
        if (!isCancelled) {
          setErrorMessage(`Error al crear player: ${err?.message || err}`);
        }
      }
    };

    // Si ya existe window.Spotify (o estamos en CINECAST_TEST mock)
    if ((window as any).Spotify?.Player) {
      setupPlayer();
    } else {
      (window as any).onSpotifyWebPlaybackSDKReady = setupPlayer;

      // Cargar script oficial solo si no está en el DOM
      const existingScript = document.getElementById('spotify-player-sdk');
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      isCancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.disconnect();
        } catch (_) {}
      }
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [deviceName]);

  // Actualizar timer de progreso
  useEffect(() => {
    if (!isPaused && duration > 0) {
      progressTimerRef.current = setInterval(() => {
        setPosition((prev) => Math.min(duration, prev + 1000));
      }, 1000);
    } else if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isPaused, duration]);

  const handleTogglePlay = async () => {
    if (playerRef.current) {
      try {
        await playerRef.current.togglePlay();
      } catch (_) {}
    }
  };

  const handleNext = async () => {
    if (playerRef.current) {
      try {
        await playerRef.current.nextTrack();
      } catch (_) {}
    }
  };

  const handlePrev = async () => {
    if (playerRef.current) {
      try {
        await playerRef.current.previousTrack();
      } catch (_) {}
    }
  };

  const handleSeek = async (newPosMs: number) => {
    setPosition(newPosMs);
    if (playerRef.current) {
      try {
        await playerRef.current.seek(newPosMs);
      } catch (_) {}
    }
  };

  const handleVolumeChange = async (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (playerRef.current) {
      try {
        await playerRef.current.setVolume(newVol / 100);
      } catch (_) {}
    }
  };

  const handleToggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (playerRef.current) {
      try {
        await playerRef.current.setVolume(nextMuted ? 0 : volume / 100);
      } catch (_) {}
    }
  };

  const handleTransferPlayback = async () => {
    if (!deviceId) return;
    const token = await authService.getSpotifyAccessToken();
    if (!token) {
      setErrorMessage('Conecta tu cuenta de Spotify para transferir la reproducción.');
      return;
    }
    try {
      const res = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: true,
        }),
      });
      if (res.ok || res.status === 204) {
        setErrorMessage(null);
      } else {
        const txt = await res.text();
        console.warn('[SpotifyDevice] Transfer response:', txt);
      }
    } catch (e: any) {
      setErrorMessage(`No se pudo transferir la reproducción: ${e?.message || e}`);
    }
  };

  const handleSaveClientId = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputClientId.trim()) {
      authService.setSpotifyClientId(inputClientId.trim());
      setInputClientId('');
      setIsConfiguringClientId(false);
    }
  };

  const formatMs = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4 space-y-4 text-zinc-100 select-none">
      {/* 1. Tarjeta de Estado del Dispositivo */}
      <section className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white">{deviceName}</h3>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Spotify Connect
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {isPlayerConnected
                  ? 'Dispositivo activo y listo para reproducir'
                  : 'Iniciando conexión con Spotify...'}
              </p>
            </div>
          </div>

          {deviceId && (
            <button
              type="button"
              onClick={handleTransferPlayback}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-extrabold transition shadow-md flex items-center gap-1.5 active:scale-95"
            >
              <Music className="w-4 h-4 fill-current" />
              <span>Pasar a TV</span>
            </button>
          )}
        </div>

        {/* Info de cuenta y Client ID enmascarado */}
        <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              {userProfile ? `Conectado como: ${userProfile.name}` : 'Sin cuenta conectada'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {maskedClientId ? (
              <span className="font-mono text-[11px] bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                Client ID: {maskedClientId}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfiguringClientId((p) => !p)}
                className="text-[11px] text-emerald-400 hover:underline font-bold"
              >
                + Configurar Client ID
              </button>
            )}
          </div>
        </div>

        {/* Formulario de configuración de Client ID si se solicita */}
        {isConfiguringClientId && (
          <form onSubmit={handleSaveClientId} className="pt-2 flex gap-2">
            <input
              type="text"
              placeholder="Ingresa tu Spotify Client ID..."
              value={inputClientId}
              onChange={(e) => setInputClientId(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-xs text-white outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-600 text-black font-extrabold text-xs"
            >
              Guardar
            </button>
          </form>
        )}

        {/* Mensaje de error o aviso de cuenta */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-900/60 text-xs text-amber-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{errorMessage}</span>
          </div>
        )}
      </section>

      {/* 2. Tarjeta del Track Actual y Controles de Reproducción */}
      <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-xl space-y-4">
        {currentTrack ? (
          <div className="flex items-center gap-4">
            {currentTrack.album?.images?.[0]?.url ? (
              <img
                src={currentTrack.album.images[0].url}
                alt={currentTrack.name}
                className="w-16 h-16 rounded-xl object-cover shadow-md border border-zinc-700/60"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500">
                <Music className="w-8 h-8 text-emerald-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-base font-extrabold text-white truncate">{currentTrack.name}</h4>
              <p className="text-xs text-zinc-300 truncate mt-0.5">
                {currentTrack.artists?.map((a: any) => a.name).join(', ') || 'Artista'}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                {currentTrack.album?.name || 'Álbum'}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 space-y-1">
            <Music className="w-10 h-10 mx-auto text-zinc-600" />
            <p className="text-sm font-bold text-zinc-300">Ningún tema reproduciendo</p>
            <p className="text-xs text-zinc-500">
              Abre Spotify en tu celular o PC y selecciona "{deviceName}" en Dispositivos.
            </p>
          </div>
        )}

        {/* Barra de progreso de la pista */}
        {duration > 0 && (
          <div className="space-y-1">
            <input
              type="range"
              min={0}
              max={duration}
              value={position}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-zinc-400">
              <span>{formatMs(position)}</span>
              <span>{formatMs(duration)}</span>
            </div>
          </div>
        )}

        {/* Controles de reproducción */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            aria-label="Pista anterior"
            onClick={handlePrev}
            className="min-w-[48px] min-h-[48px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center justify-center transition active:scale-95"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            type="button"
            aria-label={isPaused ? 'Reproducir' : 'Pausar'}
            onClick={handleTogglePlay}
            className="min-w-[58px] min-h-[58px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center transition active:scale-95 shadow-lg shadow-emerald-950/50"
          >
            {isPaused ? <Play className="w-6 h-6 fill-current ml-0.5" /> : <Pause className="w-6 h-6 fill-current" />}
          </button>

          <button
            type="button"
            aria-label="Pista siguiente"
            onClick={handleNext}
            className="min-w-[48px] min-h-[48px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center justify-center transition active:scale-95"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Control de volumen del SDK */}
        <div className="flex items-center gap-2.5 pt-2">
          <button
            type="button"
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
            onClick={handleToggleMute}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="flex-1 accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
          />
          <span className="text-xs font-mono text-zinc-400 w-8 text-right">
            {isMuted ? '0%' : `${volume}%`}
          </span>
        </div>
      </section>
    </div>
  );
};

