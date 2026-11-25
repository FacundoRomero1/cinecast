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
  MonitorSpeaker,
  ListMusic,
} from 'lucide-react';
import { authService, UserProfile, UserPlaylistItem } from '../services/authService';

interface SpotifyConnectDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
}

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

  // Modo Spotify Connect (Web API): evita el límite Widevine VMP de Electron y controla Spotify nativo sin cortes
  const useWebApiConnect = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.isElectron);
  const [connectDevices, setConnectDevices] = useState<SpotifyConnectDevice[]>([]);
  const [activeConnectDevice, setActiveConnectDevice] = useState<SpotifyConnectDevice | null>(null);
  const [playlists, setPlaylists] = useState<UserPlaylistItem[]>([]);
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeConnectDeviceRef = useRef<SpotifyConnectDevice | null>(null);
  activeConnectDeviceRef.current = activeConnectDevice;

  // Helper autenticado para Spotify Web API (con reintento automático de token en 401)
  const spotifyApiFetch = useCallback(
    async (endpoint: string, init: RequestInit = {}): Promise<Response | null> => {
      let token = await authService.getSpotifyAccessToken();
      if (!token) return null;
      const doReq = (t: string) =>
        fetch(`https://api.spotify.com/v1${endpoint}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${t}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers || {}),
          },
        });
      let res = await doReq(token);
      if (res.status === 401) {
        token = await authService.getSpotifyAccessToken();
        if (token) res = await doReq(token);
      }
      return res;
    },
    []
  );

  // Sincronizar estado actual y dispositivos vía Spotify Web API
  const syncConnectState = useCallback(async () => {
    try {
      const [playerRes, devicesRes] = await Promise.all([
        spotifyApiFetch('/me/player'),
        spotifyApiFetch('/me/player/devices'),
      ]);

      if (devicesRes && devicesRes.ok) {
        const dData = await devicesRes.json();
        const devs: SpotifyConnectDevice[] = Array.isArray(dData?.devices) ? dData.devices : [];
        setConnectDevices(devs);
        const active = devs.find((d) => d.is_active) || devs[0] || null;
        setActiveConnectDevice(active);
        if (active?.id) {
          setDeviceId(active.id);
          if (onDeviceReadyRef.current) onDeviceReadyRef.current(active.id);
        }
      }

      if (playerRes) {
        if (playerRes.status === 204) {
          setIsPaused(true);
          setCurrentTrack(null);
          setPosition(0);
          setDuration(0);
        } else if (playerRes.ok) {
          const pData = await playerRes.json();
          const item = pData?.item || null;
          currentTrackRef.current = item;
          setCurrentTrack(item);
          setIsPaused(!pData?.is_playing);
          setPosition(Number(pData?.progress_ms || 0));
          setDuration(Number(item?.duration_ms || 0));
          if (pData?.device) {
            setActiveConnectDevice(pData.device);
            if (typeof pData.device.volume_percent === 'number') {
              setVolume(pData.device.volume_percent);
              setIsMuted(pData.device.volume_percent === 0);
            }
          }
          if (onTrackChangeRef.current && item) onTrackChangeRef.current(item);
        }
      }
    } catch (_) {}
  }, [spotifyApiFetch]);

  const playerRef = useRef<any>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptsRef = useRef<number>(0);

  const onDeviceReadyRef = useRef<SpotifyDeviceProps['onDeviceReady']>(onDeviceReady);
  const onTrackChangeRef = useRef<SpotifyDeviceProps['onTrackChange']>(onTrackChange);
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);
  const currentTrackRef = useRef<any>(currentTrack);
  const isPlayerConnectedRef = useRef<boolean>(false);
  const pendingNextRef = useRef<boolean>(false);
  const sdkInitializedRef = useRef<boolean>(false);

  onDeviceReadyRef.current = onDeviceReady;
  onTrackChangeRef.current = onTrackChange;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  currentTrackRef.current = currentTrack;

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
          playerRef.current = null;
        }
        isPlayerConnectedRef.current = false;

        const player = new (window as any).Spotify.Player({
          name: deviceName,
          getOAuthToken: async (cb: (token: string) => void) => {
            const token = await authService.getSpotifyAccessToken();
            if (token) cb(token);
          },
          volume: isMutedRef.current ? 0 : volumeRef.current / 100,
        });

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          isPlayerConnectedRef.current = true;
          setDeviceId(device_id);
          setIsPlayerConnected(true);
          setStage('connected');
          setErrorCause(null);
          setErrorMessage(null);
          try {
            player.setVolume?.(isMutedRef.current ? 0 : volumeRef.current / 100)?.catch?.(() => {});
          } catch (_) {}
          if (pendingNextRef.current) {
            pendingNextRef.current = false;
            try {
              player.nextTrack?.()?.catch?.(() => {});
            } catch (_) {}
          }
          if (onDeviceReadyRef.current) onDeviceReadyRef.current(device_id);
        });

        player.addListener('not_ready', () => {
          isPlayerConnectedRef.current = false;
          setIsPlayerConnected(false);
        });

        player.addListener('player_state_changed', (state: any) => {
          console.log(
            `[SPOTIFY] player_state_changed position=${state?.position ?? null} duration=${state?.duration ?? null} paused=${state ? Boolean(state.paused) : null} track_window.current_track.id=${state?.track_window?.current_track?.id ?? null}`
          );
          if (!state) return;
          const track = state.track_window?.current_track;
          currentTrackRef.current = track || null;
          setCurrentTrack(track || null);
          setIsPaused(state.paused);
          setPosition(state.position || 0);
          setDuration(state.duration || 0);
          if (onTrackChangeRef.current && track) onTrackChangeRef.current(track);
        });

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          console.error(`[SPOTIFY] initialization_error message=${message}`);
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          isPlayerConnectedRef.current = false;
          setErrorCause('EME no disponible');
          setErrorMessage(`EME / Widevine no disponible o error de inicialización: ${message}`);
          setStage('error');
        });

        player.addListener('authentication_error', (err?: { message?: string }) => {
          console.error(`[SPOTIFY] authentication_error message=${err?.message || 'invalid_or_expired_token'}`);
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          isPlayerConnectedRef.current = false;
          setErrorCause('authentication_error');
          setErrorMessage('Error de autenticación: el token no es válido o expiró.');
          setStage('error');
        });

        player.addListener('account_error', (err?: { message?: string }) => {
          console.error(`[SPOTIFY] account_error message=${err?.message || 'premium_required'}`);
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          isPlayerConnectedRef.current = false;
          setErrorCause('account_error');
          setErrorMessage('Spotify necesita Premium para reproducir mediante Web Playback SDK.');
          setStage('error');
        });

        player.addListener('playback_error', (err?: { message?: string }) => {
          console.error(`[SPOTIFY] playback_error message=${err?.message || 'unknown'}`);
          setErrorMessage(`Error de reproducción de Spotify: ${err?.message || 'no se pudo decodificar el audio'}`);
        });

        player.addListener('autoplay_failed', () => {
          console.warn('[SPOTIFY] autoplay_failed: el navegador pidió interacción del usuario');
          try {
            player.activateElement?.()?.catch?.(() => {});
          } catch (_) {}
        });

        player.connect().catch((err: any) => {
          if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
          isPlayerConnectedRef.current = false;
          setErrorCause('error de conexión');
          setErrorMessage(`Error al conectar SDK: ${err?.message || err}`);
          setStage('error');
        });

        playerRef.current = player;
      } catch (err: any) {
        if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
        isPlayerConnectedRef.current = false;
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
  }, [deviceName]);

  // Disparar conexión al entrar en stage 'connecting'
  useEffect(() => {
    if (stage !== 'connecting') return;
    if (useWebApiConnect) {
      // En Electron usamos Spotify Connect vía Web API (sin Widevine DRM de Electron -> 0 cortes ni saltos)
      let cancelled = false;
      (async () => {
        const token = await authService.getSpotifyAccessToken();
        if (cancelled) return;
        if (!token) {
          setStage('unauthorized');
          return;
        }
        isPlayerConnectedRef.current = true;
        setIsPlayerConnected(true);
        setErrorCause(null);
        setErrorMessage(null);
        setStage('connected');
        await syncConnectState();
        try {
          const pls = await authService.fetchSpotifyPlaylists();
          if (!cancelled) setPlaylists(pls);
        } catch (_) {}
      })();
      return () => {
        cancelled = true;
      };
    }
    initSdkPlayer();
  }, [stage, useWebApiConnect, initSdkPlayer, syncConnectState]);

  // Polling de estado en vivo cada 2.5 s en modo Spotify Connect (Web API)
  useEffect(() => {
    if (!useWebApiConnect || stage !== 'connected') {
      if (connectPollRef.current) {
        clearInterval(connectPollRef.current);
        connectPollRef.current = null;
      }
      return;
    }
    connectPollRef.current = setInterval(() => {
      void syncConnectState();
    }, 2500);
    return () => {
      if (connectPollRef.current) {
        clearInterval(connectPollRef.current);
        connectPollRef.current = null;
      }
    };
  }, [useWebApiConnect, stage, syncConnectState]);

  // Aplicar volumen vía setVolume sin recrear ni desconectar Spotify.Player
  useEffect(() => {
    if (playerRef.current && isPlayerConnected) {
      try {
        playerRef.current.setVolume?.(isMuted ? 0 : volume / 100)?.catch?.(() => {});
      } catch (_) {}
    }
  }, [volume, isMuted, isPlayerConnected]);

  // Limpiar instancia SDK solo al desmontar el componente
  useEffect(() => {
    return () => {
      isPlayerConnectedRef.current = false;
      pendingNextRef.current = false;
      if (playerRef.current) {
        try {
          playerRef.current.disconnect();
        } catch (_) {}
        playerRef.current = null;
      }
    };
  }, []);

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

  const showNotice = useCallback((msg: string) => {
    setConnectNotice(msg);
    setTimeout(() => setConnectNotice((prev) => (prev === msg ? null : prev)), 3500);
  }, []);

  const getTargetDeviceQuery = useCallback((): string => {
    const devId = activeConnectDeviceRef.current?.id;
    return devId ? `?device_id=${encodeURIComponent(devId)}` : '';
  }, []);

  const handleTransferDevice = useCallback(
    async (targetDevice: SpotifyConnectDevice) => {
      if (!useWebApiConnect) return;
      const res = await spotifyApiFetch('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [targetDevice.id], play: true }),
      });
      if (res && (res.ok || res.status === 204)) {
        setActiveConnectDevice(targetDevice);
        showNotice(`Reproduciendo en ${targetDevice.name}`);
        setTimeout(() => void syncConnectState(), 400);
      } else {
        showNotice('No se pudo cambiar de dispositivo. Abrí Spotify en ese equipo primero.');
      }
    },
    [useWebApiConnect, spotifyApiFetch, showNotice, syncConnectState]
  );

  const handlePlayPlaylist = useCallback(
    async (pl: UserPlaylistItem) => {
      if (!pl.uri) return;
      if (useWebApiConnect) {
        const res = await spotifyApiFetch(`/me/player/play${getTargetDeviceQuery()}`, {
          method: 'PUT',
          body: JSON.stringify({ context_uri: pl.uri }),
        });
        if (res && (res.ok || res.status === 204)) {
          setIsPaused(false);
          showNotice(`Reproduciendo: ${pl.title}`);
          setTimeout(() => void syncConnectState(), 450);
        } else {
          showNotice('Abrí la app de Spotify en tu PC o celular para iniciar la playlist.');
        }
      }
    },
    [useWebApiConnect, spotifyApiFetch, getTargetDeviceQuery, showNotice, syncConnectState]
  );

  const handleTogglePlay = async () => {
    if (useWebApiConnect) {
      const endpoint = isPaused ? `/me/player/play${getTargetDeviceQuery()}` : `/me/player/pause${getTargetDeviceQuery()}`;
      const res = await spotifyApiFetch(endpoint, { method: 'PUT' });
      if (res && (res.ok || res.status === 204)) {
        setIsPaused((p) => !p);
        setTimeout(() => void syncConnectState(), 350);
      } else if (res?.status === 404) {
        showNotice('No hay ningún dispositivo Spotify activo. Abrí Spotify en tu PC o celular.');
      }
      return;
    }
    if (playerRef.current) {
      try {
        await playerRef.current.activateElement?.();
      } catch (_) {}
      try {
        await playerRef.current.togglePlay();
      } catch (_) {}
    }
  };

  const handleNext = useCallback(async (origin: string = 'SpotifyDevice.handleNext') => {
    console.log(
      `[SPOTIFY] next triggered origin=${origin} track_window.current_track.id=${currentTrackRef.current?.id ?? null}`
    );
    if (useWebApiConnect) {
      const res = await spotifyApiFetch(`/me/player/next${getTargetDeviceQuery()}`, { method: 'POST' });
      if (res && (res.ok || res.status === 204)) {
        setTimeout(() => void syncConnectState(), 350);
      } else if (res?.status === 404) {
        showNotice('No hay ningún dispositivo Spotify activo.');
      }
      return;
    }
    if (playerRef.current && isPlayerConnectedRef.current) {
      pendingNextRef.current = false;
      try {
        await playerRef.current.activateElement?.();
      } catch (_) {}
      try {
        await playerRef.current.nextTrack();
      } catch (_) {}
      return;
    }
    // Si aún está conectando, encolar a lo sumo 1 comando pendiente (nunca N duplicados)
    pendingNextRef.current = true;
  }, [useWebApiConnect, spotifyApiFetch, getTargetDeviceQuery, syncConnectState, showNotice]);

  const handlePrev = useCallback(async () => {
    if (useWebApiConnect) {
      const res = await spotifyApiFetch(`/me/player/previous${getTargetDeviceQuery()}`, { method: 'POST' });
      if (res && (res.ok || res.status === 204)) {
        setTimeout(() => void syncConnectState(), 350);
      }
      return;
    }
    if (playerRef.current && isPlayerConnectedRef.current) {
      try {
        await playerRef.current.activateElement?.();
      } catch (_) {}
      try {
        await playerRef.current.previousTrack();
      } catch (_) {}
    }
  }, [useWebApiConnect, spotifyApiFetch, getTargetDeviceQuery, syncConnectState]);

  useEffect(() => {
    const onRemoteNext = (e: Event) => {
      const custom = e as CustomEvent<{ origin?: string }>;
      void handleNext(custom.detail?.origin || 'window.cinecast:spotify-next');
    };
    const onRemotePrev = () => {
      void handlePrev();
    };
    window.addEventListener('cinecast:spotify-next', onRemoteNext);
    window.addEventListener('cinecast:spotify-prev', onRemotePrev);
    return () => {
      window.removeEventListener('cinecast:spotify-next', onRemoteNext);
      window.removeEventListener('cinecast:spotify-prev', onRemotePrev);
    };
  }, [handleNext, handlePrev]);

  const handleSeek = async (newPosMs: number) => {
    setPosition(newPosMs);
    if (useWebApiConnect) {
      const devParam = activeConnectDeviceRef.current?.id
        ? `&device_id=${encodeURIComponent(activeConnectDeviceRef.current.id)}`
        : '';
      await spotifyApiFetch(`/me/player/seek?position_ms=${Math.round(newPosMs)}${devParam}`, { method: 'PUT' });
      return;
    }
    if (playerRef.current) {
      try {
        await playerRef.current.seek(newPosMs);
      } catch (_) {}
    }
  };

  const applyConnectVolume = useCallback(
    (volPercent: number) => {
      if (!useWebApiConnect) return;
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
      volumeDebounceRef.current = setTimeout(() => {
        const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
        const devParam = activeConnectDeviceRef.current?.id
          ? `&device_id=${encodeURIComponent(activeConnectDeviceRef.current.id)}`
          : '';
        void spotifyApiFetch(`/me/player/volume?volume_percent=${clamped}${devParam}`, { method: 'PUT' });
      }, 150);
    },
    [useWebApiConnect, spotifyApiFetch]
  );

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    applyConnectVolume(newVol);
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const nextMuted = !prev;
      applyConnectVolume(nextMuted ? 0 : volume);
      return nextMuted;
    });
  };

  const handleDisconnect = async () => {
    isPlayerConnectedRef.current = false;
    pendingNextRef.current = false;
    if (playerRef.current) {
      try {
        playerRef.current.disconnect();
      } catch (_) {}
      playerRef.current = null;
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
                    Client ID: {maskedClientId}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-extrabold text-white">
                      {useWebApiConnect
                        ? 'Control Spotify Connect'
                        : `${deviceName} disponible en tu Spotify`}
                    </h3>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                      {useWebApiConnect ? (activeConnectDevice ? 'Conectado' : 'Esperando dispositivo') : 'Activo'}
                    </span>
                    {maskedClientId && (
                      <span className="font-mono text-[10px] bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 text-zinc-400">
                        Client ID: {maskedClientId}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    {userProfile ? `Conectado como: ${userProfile.name}` : 'Cuenta vinculada'}
                    {useWebApiConnect && activeConnectDevice ? ` · Reproduciendo en: ${activeConnectDevice.name}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {useWebApiConnect && (
                  <button
                    type="button"
                    onClick={() => void syncConnectState()}
                    title="Actualizar dispositivos y canción actual"
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-xs text-zinc-400 hover:text-red-400 font-bold px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:border-red-900/50 transition"
                >
                  Desconectar
                </button>
              </div>
            </div>

            {useWebApiConnect && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-zinc-400 flex items-center gap-1.5">
                    <MonitorSpeaker className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Dispositivos Spotify Connect:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.openExternal?.('spotify:')}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Abrir app Spotify</span>
                  </button>
                </div>
                {connectDevices.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {connectDevices.map((dev) => (
                      <button
                        key={dev.id}
                        type="button"
                        onClick={() => void handleTransferDevice(dev)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                          dev.is_active
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
                        }`}
                      >
                        {dev.is_active ? '● ' : ''}
                        {dev.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    No se detectan dispositivos activos. Abrí Spotify en Windows o en tu celular y tocá actualizar.
                  </p>
                )}
                {connectNotice && (
                  <div className="text-[11px] font-bold text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 px-2.5 py-1.5 rounded-lg">
                    {connectNotice}
                  </div>
                )}
              </div>
            )}
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
                  {useWebApiConnect
                    ? 'Elegí una playlist abajo o dale play en la app de Spotify de tu PC/celular.'
                    : `Abre Spotify en tu celular o PC y selecciona "${deviceName}" en Dispositivos.`}
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
                onClick={() => handleNext('SpotifyDevice.handleNext')}
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

          {/* Tus Playlists (acceso rápido en modo Spotify Connect) */}
          {useWebApiConnect && playlists.length > 0 && (
            <section className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-300">
                <ListMusic className="w-4 h-4 text-emerald-400" />
                <span>Tus Playlists</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
                {playlists.slice(0, 12).map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => void handlePlayPlaylist(pl)}
                    className="flex items-center gap-2.5 p-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/40 text-left transition group"
                  >
                    <img
                      src={pl.thumbnailUrl}
                      alt={pl.title}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate group-hover:text-emerald-400">
                        {pl.title}
                      </div>
                      {typeof pl.trackCount === 'number' && (
                        <div className="text-[10px] text-zinc-500">{pl.trackCount} temas</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
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
