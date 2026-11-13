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
  Copy,
  Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { authService, UserProfile } from '../services/authService';

export interface SpotifyDeviceProps {
  onDeviceReady?: (deviceId: string) => void;
  onTrackChange?: (track: any) => void;
  deviceName?: string;
  isScreen?: boolean;
  onNavigateToSettings?: () => void;
}

export type SpotifyDeviceState =
  | 'missing_client_id' // (a) Falta el Client ID
  | 'unauthorized'      // (b) Falta autorizar tu cuenta
  | 'waiting_auth'      // (c) Esperando que autorices en el navegador…
  | 'connecting'        // (d) Conectando con Spotify…
  | 'connected'         // (e) CineCast TV disponible en tu Spotify
  | 'error';            // Error con causa explícita y botón Reintentar

export const EXACT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/auth/callback';

export const SpotifyDevice: React.FC<SpotifyDeviceProps> = ({
  onDeviceReady,
  onTrackChange,
  deviceName = 'CineCast TV',
  isScreen = true,
  onNavigateToSettings,
}) => {
  const [stage, setStage] = useState<SpotifyDeviceState>('connecting');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isPlayerConnected, setIsPlayerConnected] = useState<boolean>(false);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [isPaused, setIsPaused] = useState<boolean>(true);
  const [position, setPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCause, setErrorCause] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [maskedClientId, setMaskedClientId] = useState<string>('');
  const [copiedRedirect, setCopiedRedirect] = useState<boolean>(false);

  const playerRef = useRef<any>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptsRef = useRef<number>(0);

  // Navegar a Ajustes
  const handleGoToSettings = useCallback(() => {
    if (onNavigateToSettings) {
      onNavigateToSettings();
    } else if (typeof window !== 'undefined') {
      window.location.hash = '#/ajustes';
    }
  }, [onNavigateToSettings]);

  // Copiar redirect URI exacto
  const handleCopyRedirect = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(EXACT_SPOTIFY_REDIRECT_URI).catch(() => {});
    }
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2500);
  }, []);

  // Actualizar estado general según autenticación
  const refreshAuthState = useCallback(async () => {
    const rawClientId = authService.getSpotifyClientId();
    const masked = authService.getMaskedSpotifyClientId();
    setMaskedClientId(masked);

    if (!rawClientId) {
      setStage('missing_client_id');
      return;
    }

    const auth = await authService.checkSpotifyStatus();
    setUserProfile(auth.profile);

    if (!auth.connected) {
      setStage((prev) => (prev === 'waiting_auth' ? 'waiting_auth' : 'unauthorized'));
    } else {
      // Conectado a nivel OAuth -> conectar SDK
      setStage((prev) => (prev === 'connected' ? 'connected' : 'connecting'));
    }
  }, []);

  // Inicialización y suscripción a cambios de auth
  useEffect(() => {
    refreshAuthState();
    const unsub = authService.subscribe(() => {
      refreshAuthState();
    });
    return () => {
      unsub();
      if (authPollRef.current) clearInterval(authPollRef.current);
      if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
    };
  }, [refreshAuthState]);

  // Manejo de la inicialización del SDK cuando stage === 'connecting'
  const initSdkPlayer = useCallback(() => {
    if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
    setErrorCause(null);
    setErrorMessage(null);

    // Timeout máximo de 15 segundos para conectar
    connectingTimerRef.current = setTimeout(() => {
      if (!(window as any).Spotify?.Player) {
        setErrorCause('no cargó sdk.scdn.co');
        setErrorMessage('No cargó sdk.scdn.co o la conexión está bloqueada.');
      } else {
        setErrorCause('tiempo de espera');
        setErrorMessage('Tiempo de espera agotado (15 s) al conectar con Spotify.');
      }
      setStage('error');
    }, 15000);

    const setupPlayerInstance = () => {
      if (!(window as any).Spotify?.Player) return;

      try {
        if (playerRef.current) {
          try {
            playerRef.current.disconnect();
          } catch (_) {}
        }

        const player = new (window as any).Spotify.Player({
          name: deviceName,
          getOAuthToken: async (cb: (token: string) => void) => {
            const token = await authService.getSpotifyAccessToken();
            if (token) cb(token);
          },
          volume: volume / 100,
        });

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setDeviceId(device_id);
          setIsPlayerConnected(true);
          setStage('connected');
          setErrorCause(null);
          setErrorMessage(null);
          if (onDeviceReady) onDeviceReady(device_id);
        });

        player.addListener('not_ready', () => {
          setIsPlayerConnected(false);
        });

        player.addListener('player_state_changed', (state: any) => {
          if (!state) return;
          const track = state.track_window?.current_track;
          setCurrentTrack(track || null);
          setIsPaused(state.paused);
          setPosition(state.position || 0);
          setDuration(state.duration || 0);
          if (onTrackChange && track) onTrackChange(track);
        });

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setErrorCause('EME no disponible');
          setErrorMessage(`EME / Widevine no disponible o error de inicialización: ${message}`);
          setStage('error');
        });

        player.addListener('authentication_error', () => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setErrorCause('authentication_error');
          setErrorMessage('Error de autenticación: el token no es válido o expiró.');
          setStage('error');
        });

        player.addListener('account_error', () => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setErrorCause('account_error');
          setErrorMessage('Spotify necesita Premium para reproducir mediante Web Playback SDK.');
          setStage('error');
        });

        player.connect().catch((err: any) => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setErrorCause('error de conexión');
          setErrorMessage(`Error al conectar SDK: ${err?.message || err}`);
          setStage('error');
        });

        playerRef.current = player;
      } catch (err: any) {
        if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
        setErrorCause('error al crear player');
        setErrorMessage(`Error al crear reproductor: ${err?.message || err}`);
        setStage('error');
      }
    };

    if ((window as any).Spotify?.Player) {
      setupPlayerInstance();
    } else {
      (window as any).onSpotifyWebPlaybackSDKReady = setupPlayerInstance;

      const existingScript = document.getElementById('spotify-player-sdk');
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.onerror = () => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          setErrorCause('no cargó sdk.scdn.co');
          setErrorMessage('No cargó sdk.scdn.co: comprueba tu conexión a internet.');
          setStage('error');
        };
        document.body.appendChild(script);
      }
    }
  }, [deviceName, volume, onDeviceReady, onTrackChange]);

  // Disparar conexión al entrar en stage 'connecting'
  useEffect(() => {
    if (stage === 'connecting') {
      initSdkPlayer();
    }
  }, [stage, initSdkPlayer]);

  // Polling para stage 'waiting_auth' (cada 2s hasta 3 min = 90 intentos)
  useEffect(() => {
    if (stage !== 'waiting_auth') {
      if (authPollRef.current) {
        clearInterval(authPollRef.current);
        authPollRef.current = null;
      }
      return;
    }

    let attempts = 0;
    authPollRef.current = setInterval(async () => {
      attempts += 1;
      const status = await authService.checkSpotifyStatus();
      if (status.connected) {
        if (authPollRef.current) clearInterval(authPollRef.current);
        authPollRef.current = null;
        setUserProfile(status.profile);
        setStage('connecting');
      } else if (attempts >= 90) {
        if (authPollRef.current) clearInterval(authPollRef.current);
        authPollRef.current = null;
        setStage('unauthorized');
        setErrorMessage('Tiempo de espera agotado (3 min). Puedes volver a intentarlo.');
      }
    }, 2000);

    return () => {
      if (authPollRef.current) {
        clearInterval(authPollRef.current);
        authPollRef.current = null;
      }
    };
  }, [stage]);

  // Timer de progreso de la pista en reproducción
  useEffect(() => {
    if (!isPaused && duration > 0 && stage === 'connected') {
      progressTimerRef.current = setInterval(() => {
        setPosition((prev) => Math.min(duration, prev + 1000));
      }, 1000);
    } else if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isPaused, duration, stage]);

  // Acciones de usuario
  const handleStartAuthorize = useCallback(() => {
    setErrorMessage(null);
    setStage('waiting_auth');
    authService.loginWithSpotify();
  }, []);

  const handleCancelAuth = useCallback(() => {
    if (authPollRef.current) {
      clearInterval(authPollRef.current);
      authPollRef.current = null;
    }
    setStage('unauthorized');
  }, []);

  const handleRetryConnect = useCallback(() => {
    setStage('connecting');
  }, []);

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

  const handleDisconnect = async () => {
    if (playerRef.current) {
      try {
        playerRef.current.disconnect();
      } catch (_) {}
    }
    await authService.logoutSpotify();
    setDeviceId(null);
    setIsPlayerConnected(false);
    setCurrentTrack(null);
    setStage('unauthorized');
  };

  const formatMs = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4 space-y-4 text-zinc-100 select-none">
      {/* (a) Falta el Client ID */}
      {stage === 'missing_client_id' && (
        <section
          aria-label="Falta el Client ID"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-amber-500/40 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Falta el Client ID</h3>
              <p className="text-xs text-zinc-400">
                Para usar CineCast como reproductor Spotify Connect oficial, necesitas configurar tu Client ID.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleGoToSettings}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-extrabold text-xs transition flex items-center justify-center gap-2 shadow-md"
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Configurar en Ajustes</span>
          </button>
        </section>
      )}

      {/* (b) Falta autorizar tu cuenta */}
      {stage === 'unauthorized' && (
        <section
          aria-label="Falta autorizar tu cuenta"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white">Falta autorizar tu cuenta</h3>
                {maskedClientId && (
                  <span className="font-mono text-[11px] bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 text-zinc-400">
                    ID: {maskedClientId}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Conecta tu cuenta de Spotify para habilitar la reproducción en esta pantalla.
              </p>
            </div>
          </div>

          {/* Botón de autorización */}
          {isScreen ? (
            <button
              type="button"
              onClick={handleStartAuthorize}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-black font-extrabold text-xs transition flex items-center justify-center gap-2 shadow-md active:scale-95"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Autorizar en el navegador</span>
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs text-center text-zinc-400 font-bold">
              Hacelo desde la PC
            </div>
          )}

          {/* Redirect URI exacto con botón Copiar */}
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 font-bold">
              <span>Redirect URI exacto para Spotify Dashboard:</span>
              <button
                type="button"
                onClick={handleCopyRedirect}
                className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
              >
                {copiedRedirect ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedRedirect ? '¡Copiado!' : 'Copiar'}</span>
              </button>
            </div>
            <code className="block font-mono text-[11px] text-zinc-300 select-all truncate bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800/80">
              {EXACT_SPOTIFY_REDIRECT_URI}
            </code>
          </div>

          {/* Nota de diagnóstico para INVALID_CLIENT / redirect */}
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Si Spotify dice <strong>INVALID_CLIENT</strong> o redirect inválido, revisá que en el panel el redirect sea
            exactamente este y que tu cuenta esté en <strong>User Management</strong>.
          </p>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-900/60 text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </section>
      )}

      {/* (c) Esperando que autorices en el navegador… */}
      {stage === 'waiting_auth' && (
        <section
          aria-label="Esperando autorización"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-emerald-500/40 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Esperando que autorices en el navegador…</h3>
              <p className="text-xs text-zinc-400">
                Acepta los permisos en la ventana de Spotify abierta en tu navegador. Consultando estado cada 2 s...
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelAuth}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition"
          >
            Cancelar
          </button>
        </section>
      )}

      {/* (d) Conectando con Spotify… (máx 15 s) */}
      {stage === 'connecting' && (
        <section
          aria-label="Conectando con Spotify"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Conectando con Spotify…</h3>
              <p className="text-xs text-zinc-400">Iniciando Web Playback SDK (máximo 15 s)...</p>
            </div>
          </div>
        </section>
      )}

      {/* Error con causa explícita y botón Reintentar */}
      {stage === 'error' && (
        <section
          aria-label="Error al conectar con Spotify"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-red-500/40 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Error al conectar con Spotify</h3>
              <p className="text-xs text-red-300 mt-0.5">
                {errorMessage || errorCause || 'No se pudo iniciar la conexión con Spotify.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetryConnect}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-extrabold text-xs transition flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reintentar</span>
          </button>
        </section>
      )}

      {/* (e) CineCast TV disponible en tu Spotify + Track actual */}
      {stage === 'connected' && (
        <>
          <section
            aria-label="CineCast TV disponible en tu Spotify"
            className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-white">{deviceName} disponible en tu Spotify</h3>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                      Activo
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {userProfile ? `Conectado como: ${userProfile.name}` : 'Dispositivo activo y listo para reproducir'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-xs text-zinc-400 hover:text-red-400 font-bold px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:border-red-900/50 transition"
              >
                Desconectar
              </button>
            </div>
          </section>

          {/* Tarjeta del Track actual y Controles */}
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
                  <p className="text-[11px] text-zinc-500 truncate">{currentTrack.album?.name || 'Álbum'}</p>
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

            {/* Barra de progreso */}
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

            {/* Control de volumen */}
            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                onClick={handleToggleMute}
                className="text-zinc-400 hover:text-white transition"
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
              <span className="font-mono text-xs text-zinc-400 w-8 text-right">
                {isMuted ? '0%' : `${volume}%`}
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export interface SpotifySettingsSectionProps {
  isScreen?: boolean;
}

export const SpotifySettingsSection: React.FC<SpotifySettingsSectionProps> = ({ isScreen = true }) => {
  const [maskedClientId, setMaskedClientId] = useState<string>('');
  const [inputClientId, setInputClientId] = useState<string>('');
  const [isEditingClientId, setIsEditingClientId] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setMaskedClientId(authService.getMaskedSpotifyClientId());
    const status = await authService.checkSpotifyStatus();
    setIsConnected(status.connected);
    setUserProfile(status.profile);
  }, []);

  useEffect(() => {
    refresh();
    const unsub = authService.subscribe(refresh);
    return unsub;
  }, [refresh]);

  const handleSaveClientId = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputClientId.trim()) {
      authService.setSpotifyClientId(inputClientId.trim());
      setInputClientId('');
      setIsEditingClientId(false);
      refresh();
    }
  };

  const handleCopyRedirect = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(EXACT_SPOTIFY_REDIRECT_URI).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAuthorize = () => {
    authService.loginWithSpotify();
  };

  const handleDisconnect = async () => {
    await authService.logoutSpotify();
    refresh();
  };

  return (
    <section
      aria-label="Spotify (dispositivo CineCast)"
      className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Spotify (dispositivo CineCast)</div>
            <div className="text-xs text-zinc-400">
              Web Playback SDK oficial para reproducir música con Spotify Connect.
            </div>
          </div>
        </div>
        <div className="text-xs font-bold px-2.5 py-1 rounded-full border">
          {isConnected ? (
            <span className="text-emerald-400 border-emerald-800/80 bg-emerald-950/60 px-2 py-0.5 rounded-full">
              Conectado {userProfile?.name ? `(${userProfile.name})` : ''}
            </span>
          ) : (
            <span className="text-zinc-400 border-zinc-800 bg-zinc-950 px-2 py-0.5 rounded-full">
              No conectado
            </span>
          )}
        </div>
      </div>

      {/* Campo Client ID */}
      <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-bold">Client ID de Spotify:</span>
          <button
            type="button"
            onClick={() => setIsEditingClientId((p) => !p)}
            className="text-emerald-400 hover:underline font-bold text-[11px]"
          >
            {isEditingClientId ? 'Cancelar' : maskedClientId ? 'Cambiar Client ID' : '+ Agregar Client ID'}
          </button>
        </div>

        {maskedClientId && !isEditingClientId ? (
          <code className="block font-mono text-xs text-white bg-zinc-900 px-2.5 py-1.5 rounded border border-zinc-800">
            {maskedClientId}
          </code>
        ) : null}

        {isEditingClientId || !maskedClientId ? (
          <form onSubmit={handleSaveClientId} className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="Pega tu Client ID aquí (ej: 5dfd...7d41)..."
              value={inputClientId}
              onChange={(e) => setInputClientId(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-extrabold text-xs transition"
            >
              Guardar
            </button>
          </form>
        ) : null}
      </div>

      {/* Redirect URI exacto con botón Copiar */}
      <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-400 font-bold">
          <span>Redirect URI exacto:</span>
          <button
            type="button"
            onClick={handleCopyRedirect}
            className="text-emerald-400 hover:text-emerald-300 font-bold text-xs flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
          </button>
        </div>
        <code className="block font-mono text-xs text-zinc-300 select-all truncate bg-zinc-900 px-2.5 py-1.5 rounded border border-zinc-800">
          {EXACT_SPOTIFY_REDIRECT_URI}
        </code>
      </div>

      {/* Botones de acción */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {isScreen ? (
          <button
            type="button"
            onClick={handleAuthorize}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-black font-extrabold text-xs transition flex items-center gap-2 shadow-md active:scale-95"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Autorizar en el navegador</span>
          </button>
        ) : (
          <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 font-bold">
            Hacelo desde la PC
          </div>
        )}

        {isConnected && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-red-400 font-bold text-xs border border-zinc-700 transition"
          >
            Desconectar
          </button>
        )}
      </div>
    </section>
  );
};
