import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AudioSettings,
  DeviceInfo,
  DeviceType,
  Episode,
  MediaItem,
  PlaybackSettings,
  PlaybackState,
  RemoteCommand,
} from '../types';
import { MEDIA_CATALOG } from '../data/catalog';
import { SPOTIFY_TRACKS, SpotifyTrack } from '../data/spotifyCatalog';
import { YOUTUBE_VIDEOS, YouTubeVideo } from '../data/youtubeCatalog';
import { deviceSync } from '../services/deviceSync';
import { recordSentCommand, recordReceivedCommand } from './syncDiagnostic';
import { watchHistoryService, WatchProgressItem } from '../services/watchHistoryService';
import { generateServersForMedia, refreshProviderHealth } from '../services/embedService';
import { authService } from '../services/authService';
import { Users } from 'lucide-react';
import { hubFullscreen } from './hubFullscreen';

export type HubType = 'cinecast' | 'spotify' | 'youtube' | 'sports';

export interface AppRuntimeContextValue {
  // Rol, sala y dispositivos
  deviceRole: DeviceType;
  setDeviceRole: React.Dispatch<React.SetStateAction<DeviceType>>;
  roomId: string;
  setRoomId: React.Dispatch<React.SetStateAction<string>>;
  devices: DeviceInfo[];
  selectedScreenId: string | null;
  setSelectedScreenId: React.Dispatch<React.SetStateAction<string | null>>;
  homeRoomId: string | null;
  isPermanentHomeLinked: boolean;
  isGuestMode: boolean;
  setIsGuestMode: React.Dispatch<React.SetStateAction<boolean>>;
  connectedScreenName: string;
  handleTogglePermanentHome: () => void;

  // Hubs
  activeHub: HubType;
  setActiveHub: React.Dispatch<React.SetStateAction<HubType>>;
  activeSpotifyTrack: SpotifyTrack | null;
  setActiveSpotifyTrack: React.Dispatch<React.SetStateAction<SpotifyTrack | null>>;
  isSpotifyPlaying: boolean;
  setIsSpotifyPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  activeYouTubeVideo: YouTubeVideo | null;
  setActiveYouTubeVideo: React.Dispatch<React.SetStateAction<YouTubeVideo | null>>;
  isYouTubePlaying: boolean;
  setIsYouTubePlaying: React.Dispatch<React.SetStateAction<boolean>>;

  // Reposo (Standby) y notificaciones
  isScreenInStandby: boolean;
  setIsScreenInStandby: React.Dispatch<React.SetStateAction<boolean>>;
  remoteNotification: string | null;
  triggerNotification: (text: string) => void;

  // Audio y reproducción
  audioSettings: AudioSettings;
  setAudioSettings: React.Dispatch<React.SetStateAction<AudioSettings>>;
  playbackSettings: PlaybackSettings;
  setPlaybackSettings: React.Dispatch<React.SetStateAction<PlaybackSettings>>;

  // Reproducción local y remota
  activeMedia: MediaItem | null;
  setActiveMedia: React.Dispatch<React.SetStateAction<MediaItem | null>>;
  activeEpisode: Episode | null;
  setActiveEpisode: React.Dispatch<React.SetStateAction<Episode | null>>;
  isPlayingLocally: boolean;
  setIsPlayingLocally: React.Dispatch<React.SetStateAction<boolean>>;
  playerInitialTime: number;
  setPlayerInitialTime: React.Dispatch<React.SetStateAction<number>>;
  lastRemoteCommand: { cmd: RemoteCommand; timestamp: number } | null;
  remotePlaybackState: PlaybackState;
  setRemotePlaybackState: React.Dispatch<React.SetStateAction<PlaybackState>>;
  remoteMediaItem: MediaItem | null;
  remoteEpisodeItem: Episode | null;
  handlePlayLocal: (media: MediaItem, episode?: Episode | null, initialTime?: number, forceLocal?: boolean) => void;
  handleCastMediaToScreen: (media: MediaItem, episode?: Episode, initialTime?: number) => void;
  handlePlayNextEpisode: () => void;
  handlePlayPrevEpisode: () => void;
  handleBroadcastPlayerState: (stateUpdate: Partial<PlaybackState>) => void;
  sendRemoteCommand: (command: RemoteCommand) => void;

  // Historial y Mi lista
  continueWatchingList: WatchProgressItem[];
  refreshContinueWatching: () => void;
  myListIds: string[];
  toggleMyList: (mediaId: string) => void;

  // Modales compartidos
  isAudioModalOpen: boolean;
  setIsAudioModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isGuestModalOpen: boolean;
  setIsGuestModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const AppRuntimeContext = createContext<AppRuntimeContextValue | null>(null);

export const AppRuntimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // COPIA de App.tsx L32-46; borrar al eliminar la UI clásica
  // Check and handle OAuth redirect tokens on mount
  useEffect(() => {
    authService.handleRedirectCallback().then((handled) => {
      if (handled) {
        triggerNotification('✨ ¡Sesión iniciada correctamente con OAuth!');
      }
    });
  }, []);

  // Verificación en segundo plano de los proveedores embed (solo en la PC/Electron)
  useEffect(() => {
    refreshProviderHealth();
    const timer = setInterval(refreshProviderHealth, 3 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // COPIA de App.tsx L48-64; borrar al eliminar la UI clásica
  // Device & Network State
  const [deviceRole, setDeviceRole] = useState<DeviceType>(deviceSync.getDeviceType());
  const [roomId, setRoomId] = useState<string>(deviceSync.getRoomId());
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);

  // Permanent Home Link State
  const [homeRoomId, setHomeRoomId] = useState<string | null>(() => {
    return localStorage.getItem('cinecast_home_room_id');
  });
  const isPermanentHomeLinked = Boolean(homeRoomId && homeRoomId === roomId);

  // Guest detection
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('guest') === '1';
  });

  // COPIA de App.tsx L65-73; borrar al eliminar la UI clásica
  // UI Hub (CineCast, Spotify, YouTube)
  const [activeHub, setActiveHub] = useState<HubType>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const hub = params.get('hub');
      if (hub === 'spotify' || hub === 'youtube') return hub;
    } catch (_) {}
    return 'cinecast';
  });

  // COPIA de App.tsx L138-141; borrar al eliminar la UI clásica
  const [isAudioModalOpen, setIsAudioModalOpen] = useState<boolean>(false);
  const [isGuestModalOpen, setIsGuestModalOpen] = useState<boolean>(false);

  // COPIA de App.tsx L143-150; borrar al eliminar la UI clásica
  const [myListIds, setMyListIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cinecast_my_list');
      return saved ? JSON.parse(saved) : ['deadpool-wolverine', 'stranger-things', 'solo-leveling'];
    } catch {
      return ['deadpool-wolverine'];
    }
  });

  // COPIA de App.tsx L152-154; borrar al eliminar la UI clásica
  // Screen Standby / Sleep state (always false on start so movie catalog is immediately visible)
  const [isScreenInStandby, setIsScreenInStandby] = useState(false);
  const [remoteNotification, setRemoteNotification] = useState<string | null>(null);

  // COPIA de App.tsx L157-172; borrar al eliminar la UI clásica
  // Audio & Playback Configurations (100% volumen sin muteos forzados)
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    volume: 100,
    isMuted: false,
    preset: 'standard',
    bassGain: 0,
    midGain: 0,
    trebleGain: 0,
    compressorEnabled: false,
    dialogueBoost: false,
  });

  const [playbackSettings, setPlaybackSettings] = useState<PlaybackSettings>({
    autoPlayNext: true,
    autoSkipIntro: true,
    nextEpisodeDelay: 5,
  });

  // COPIA de App.tsx L174-202; borrar al eliminar la UI clásica
  // Current Playing Media on this Device (or controlled on Screen)
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null);
  const [isPlayingLocally, setIsPlayingLocally] = useState<boolean>(false);
  const [playerInitialTime, setPlayerInitialTime] = useState<number>(0);
  const [continueWatchingList, setContinueWatchingList] = useState<WatchProgressItem[]>(() => {
    return watchHistoryService.getContinueWatchingList();
  });

  const refreshContinueWatching = useCallback(() => {
    setContinueWatchingList(watchHistoryService.getContinueWatchingList());
  }, []);

  // TAREA 5: Sincronización central de "Continuar Viendo" entre PC y Celular
  useEffect(() => {
    watchHistoryService.syncWithServer().then(() => {
      refreshContinueWatching();
    });

    const unsubLocal = watchHistoryService.onUpdate(refreshContinueWatching);
    const unsubRemote = deviceSync.onWatchHistory(() => {
      watchHistoryService.syncWithServer().then(refreshContinueWatching);
    });

    return () => {
      unsubLocal();
      unsubRemote();
    };
  }, [refreshContinueWatching]);

  // COPIA de App.tsx L205-210; borrar al eliminar la UI clásica
  // Spotify State
  const [activeSpotifyTrack, setActiveSpotifyTrack] = useState<SpotifyTrack | null>(SPOTIFY_TRACKS[0]);
  const [isSpotifyPlaying, setIsSpotifyPlaying] = useState<boolean>(false);

  // YouTube State
  const [activeYouTubeVideo, setActiveYouTubeVideo] = useState<YouTubeVideo | null>(YOUTUBE_VIDEOS[0]);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState<boolean>(false);

  // COPIA de App.tsx L212-234; borrar al eliminar la UI clásica
  // Last Command Received Trigger for VideoPlayer
  const [lastRemoteCommand, setLastRemoteCommand] = useState<{ cmd: RemoteCommand; timestamp: number } | null>(null);

  // Remote Playback State (mirrors Screen playback when in mobile mode)
  const [remotePlaybackState, setRemotePlaybackState] = useState<PlaybackState>(() => {
    const cached = deviceSync.getCachedPlaybackState();
    if (cached) return cached;
    return {
      mediaId: null,
      episodeId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      isStandby: true,
      screenDeviceName: 'PC Sala',
      audioSettings,
      playbackSettings,
      isIntroActive: false,
      isRecapActive: false,
      nextEpisodeCountdown: null,
    };
  });

  // COPIA de App.tsx L236-301; borrar al eliminar la UI clásica
  // Virtual Cursor for Trackpad Mode
  const [virtualCursor, setVirtualCursor] = useState<{ x: number; y: number; visible: boolean } | null>(null);
  const virtualCursorTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (window.electronAPI?.onVirtualCursorPosition) {
      return window.electronAPI.onVirtualCursorPosition((pos) => {
        setVirtualCursor({ x: pos.x, y: pos.y, visible: true });
        if (virtualCursorTimeoutRef.current) clearTimeout(virtualCursorTimeoutRef.current);
        virtualCursorTimeoutRef.current = setTimeout(() => {
          setVirtualCursor((prev) => (prev ? { ...prev, visible: false } : null));
        }, 3500);
      });
    }
  }, []);

  // Keep phone screen awake while using remote control
  useEffect(() => {
    if (deviceRole === 'remote') {
      deviceSync.requestWakeLock();
    }
    return () => {
      deviceSync.releaseWakeLock();
    };
  }, [deviceRole]);

  // Initial connection to sync network + Auto-connect to permanent home if available
  useEffect(() => {
    // If user has a permanent home saved and no room in URL, use home room
    const params = new URLSearchParams(window.location.search);
    const roomInUrl = params.get('room');
    const targetRoom = roomInUrl || homeRoomId || roomId;

    deviceSync.connect(targetRoom);
    setRoomId(targetRoom);

    // When remote connects, immediately close the QR Standby Screen!
    const unsubRemoteConnected = deviceSync.onRemoteConnected((remoteDeviceName) => {
      setIsScreenInStandby(false);
      triggerNotification(`📱 ¡${remoteDeviceName} conectado! Listo para reproducir.`);
    });

    const unsubDevices = deviceSync.onDevicesUpdate((devs) => {
      setDevices(devs);

      // If we are in standby on a screen and a remote device connects, auto-dismiss standby!
      if (isScreenInStandby && deviceRole === 'screen') {
        const hasRemoteJoined = devs.some((d) => d.type === 'remote' && !d.isCurrent);
        if (hasRemoteJoined) {
          setIsScreenInStandby(false);
          triggerNotification('📱 ¡Control conectado! Listo para reproducir.');
        }
      }

      // Automatically select first screen found if none selected
      if (!selectedScreenId) {
        const firstScreen = devs.find((d) => d.type === 'screen' || d.type === 'hybrid');
        if (firstScreen) setSelectedScreenId(firstScreen.id);
      }
    });

    return () => {
      unsubRemoteConnected();
      unsubDevices();
    };
  }, [homeRoomId, isScreenInStandby, deviceRole]);

  // COPIA de App.tsx L303-332; borrar al eliminar la UI clásica
  // Keep a ref to the latest command handler to avoid stale closures
  const remoteCmdHandlerRef = useRef<(cmd: RemoteCommand, from?: string) => void>(() => {});

  // Listen for remote commands (when acting as the Screen / PC / TV)
  useEffect(() => {
    const unsubCmd = deviceSync.onCommand((cmd: RemoteCommand, fromDevice) => {
      remoteCmdHandlerRef.current(cmd, fromDevice);
    });

    const unsubState = deviceSync.onStateSync((state: PlaybackState) => {
      setRemotePlaybackState(state);
      if (state.mediaItem) {
        setActiveMedia(state.mediaItem);
      }
      if (state.episodeItem) {
        setActiveEpisode(state.episodeItem);
      }
      if (state.audioSettings) {
        setAudioSettings(state.audioSettings);
      }
      if (state.playbackSettings) {
        setPlaybackSettings(state.playbackSettings);
      }
    });

    return () => {
      unsubCmd();
      unsubState();
    };
  }, []);

  // COPIA de App.tsx L335-341; borrar al eliminar la UI clásica
  // Save My List changes
  const toggleMyList = (mediaId: string) => {
    setMyListIds((prev) => {
      const next = prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId];
      localStorage.setItem('cinecast_my_list', JSON.stringify(next));
      return next;
    });
  };

  // COPIA de App.tsx L343-369; borrar al eliminar la UI clásica
  // Show temporary toast notification on PC screen when mobile sends a command
  const triggerNotification = (text: string) => {
    setRemoteNotification(text);
    setTimeout(() => {
      setRemoteNotification((current) => (current === text ? null : current));
    }, 3000);
  };

  // Play brief confirmation tone when testing signal from phone
  const playSignalChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  };

  // COPIA de App.tsx L371-382; borrar al eliminar la UI clásica
  // Permanent Home Toggle
  const handleTogglePermanentHome = () => {
    if (isPermanentHomeLinked) {
      localStorage.removeItem('cinecast_home_room_id');
      setHomeRoomId(null);
      triggerNotification('🏠 Hogar permanente desvinculado.');
    } else {
      localStorage.setItem('cinecast_home_room_id', roomId);
      setHomeRoomId(roomId);
      triggerNotification('🏠 ¡Sala fijada como Mi Hogar Permanente!');
    }
  };

  // COPIA de App.tsx L385-838; borrar al eliminar la UI clásica
  // Handle incoming commands sent from mobile
  const handleRemoteCommandReceived = (cmd: RemoteCommand, _from?: string) => {
    recordReceivedCommand(cmd.action);
    // Only execute screen playback actions if this device is a screen (not a remote-only phone)
    if (deviceRole === 'remote') return;

    // ANY incoming remote command exits standby mode immediately!
    setIsScreenInStandby(false);

    // Pass to video player trigger
    setLastRemoteCommand({ cmd, timestamp: Date.now() });

    // Cuando VideoPlayer está abierto en Pelis/Series, él es el ÚNICO que debe ejecutar estas acciones
    if (isPlayingLocally && activeHub === 'cinecast') {
      const playerHandledActions = [
        'togglePlay', 'play', 'pause', 'seek', 'seekRelative',
        'toggleSubtitles', 'changeServer', 'selectServer', 'nextEpisode', 'prevEpisode', 'jumpToEpisode'
      ];
      if (playerHandledActions.includes(cmd.action)) {
        return;
      }
    }

    switch (cmd.action) {
      case 'playMedia': {
        const { mediaId, episodeId, seasonNumber, episodeNumber } = cmd.payload || {};
        const media = MEDIA_CATALOG.find((m) => m.id === mediaId) || (activeMedia?.id === mediaId ? activeMedia : undefined);
        if (media) {
          const sNum = Number(seasonNumber) || 1;
          const eNum = Number(episodeNumber) || 1;
          const episode = (seasonNumber && episodeNumber
            ? media.episodes?.find((e) => (e.seasonNumber || 1) === sNum && e.episodeNumber === eNum)
            : null) || media.episodes?.find((e) => e.id === episodeId) || media.episodes?.[0] || null;
          setActiveMedia(media);
          setActiveEpisode(episode);
          setActiveHub('cinecast');
          setIsScreenInStandby(false);
          setPlayerInitialTime(0);
          setIsPlayingLocally(true);
          triggerNotification(`📱 Reproduciendo desde el celular: ${media.title}`);

          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            (window as any).electronAPI.focusWindow?.();
          }
        }
        break;
      }
      case 'playDiscoveredMovie': {
        const payload = cmd.payload || {};
        const mediaItem: MediaItem | undefined = payload;
        if (mediaItem) {
          const sNum = Number(payload.seasonNumber ?? payload.episode?.seasonNumber ?? payload.selectedEpisode?.seasonNumber ?? 1) || 1;
          const eNum = Number(payload.episodeNumber ?? payload.episode?.episodeNumber ?? payload.selectedEpisode?.episodeNumber ?? 1) || 1;
          const isSeries =
            mediaItem.type === 'series' ||
            mediaItem.category === 'series' ||
            mediaItem.category === 'anime' ||
            Boolean(payload.seasonNumber) ||
            Boolean(payload.episodeNumber) ||
            Boolean(payload.episode);

          let ep: Episode | null = null;
          if (isSeries) {
            const candidate = payload.episode || payload.selectedEpisode || mediaItem.episodes?.find((e) => (e.seasonNumber || 1) === sNum && e.episodeNumber === eNum);
            ep = {
              ...(candidate || {}),
              id: candidate?.id || `ep-${mediaItem.id}-s${sNum}-e${eNum}`,
              title: (candidate && (candidate.seasonNumber || 1) === sNum && candidate.episodeNumber === eNum && candidate.title && !/^episodio\s+\d+$/i.test(candidate.title))
                ? candidate.title
                : (payload.episodeTitle || candidate?.title || `Episodio ${eNum}`),
              seasonNumber: sNum,
              episodeNumber: eNum,
              overview: candidate?.overview || `Temporada ${sNum}, Episodio ${eNum}`,
              duration: candidate?.duration || '24m',
            };
          }

          if (!mediaItem.servers || mediaItem.servers.length === 0) {
            mediaItem.servers = generateServersForMedia({
              tmdbId: mediaItem.tmdbId,
              directMp4Url: mediaItem.videoUrl,
              type: mediaItem.category === 'live_tv' ? 'live_tv' : isSeries ? 'series' : 'movie',
              season: ep?.seasonNumber || sNum,
              episode: ep?.episodeNumber || eNum,
            });
            if (!mediaItem.videoUrl && mediaItem.servers.length > 0) {
              mediaItem.videoUrl = mediaItem.servers[0].url;
            }
          }
          const initTime = Number(payload.initialTime ?? payload.currentTime) || 0;
          setActiveMedia(mediaItem);
          setActiveEpisode(ep);
          setActiveHub('cinecast');
          setIsScreenInStandby(false);
          setPlayerInitialTime(initTime);
          setIsPlayingLocally(true);
          triggerNotification(`🎬 Reproduciendo en Pantalla: ${mediaItem.title}`);

          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            (window as any).electronAPI.focusWindow?.();
          }

          const fullState: PlaybackState = {
            mediaId: mediaItem.id,
            episodeId: ep?.id || null,
            mediaTitle: mediaItem.title,
            mediaPoster: mediaItem.posterUrl,
            mediaYear: mediaItem.year,
            seasonNumber: ep?.seasonNumber || sNum,
            episodeNumber: ep?.episodeNumber || eNum,
            episodeTitle: ep?.title || '',
            mediaItem: mediaItem,
            episodeItem: ep || undefined,
            isPlaying: true,
            currentTime: initTime,
            duration: 0,
            buffered: 0,
            isStandby: false,
            screenDeviceName: deviceSync.getDeviceName(),
            audioSettings,
            playbackSettings,
            isIntroActive: false,
            isRecapActive: false,
            nextEpisodeCountdown: null,
            servers: mediaItem.servers?.map((s) => ({ name: s.name, language: s.language })),
            activeServerIndex: 0,
          };
          deviceSync.broadcastPlaybackState(fullState);
          setRemotePlaybackState(fullState);
        }
        break;
      }
      case 'randomEpisode': {
        const payload = cmd.payload || {};
        let seriesMedia: MediaItem | undefined = payload.mediaItem || activeMedia || undefined;
        if (!seriesMedia && payload.mediaId) {
          seriesMedia = MEDIA_CATALOG.find((m) => m.id === payload.mediaId);
        }
        if (seriesMedia) {
          const seasonsList = (seriesMedia as any).seasons || [];
          let targetSeason = payload.season || 1;
          let targetEpisodeNum = payload.episode || 1;

          if (!payload.season || !payload.episode) {
            if (seasonsList.length > 0) {
              const rSeason = seasonsList[Math.floor(Math.random() * seasonsList.length)];
              targetSeason = rSeason.seasonNumber || 1;
              const count = rSeason.episodeCount || 12;
              targetEpisodeNum = Math.floor(Math.random() * count) + 1;
            } else if (seriesMedia.episodes && seriesMedia.episodes.length > 0) {
              const rEp = seriesMedia.episodes[Math.floor(Math.random() * seriesMedia.episodes.length)];
              targetSeason = rEp.seasonNumber || 1;
              targetEpisodeNum = rEp.episodeNumber || 1;
            } else {
              targetSeason = 1;
              targetEpisodeNum = Math.floor(Math.random() * 12) + 1;
            }
          }

          const randomEp: Episode = payload.episodeItem || {
            id: `ep-${seriesMedia.id}-s${targetSeason}-e${targetEpisodeNum}`,
            title: `Episodio ${targetEpisodeNum}`,
            overview: `Temporada ${targetSeason}, Episodio ${targetEpisodeNum}`,
            duration: '24m',
            thumbnailUrl: seriesMedia.backdropUrl || seriesMedia.posterUrl || '',
            seasonNumber: targetSeason,
            episodeNumber: targetEpisodeNum,
          };

          const enrichedMedia: MediaItem = {
            ...seriesMedia,
            servers: generateServersForMedia({
              tmdbId: seriesMedia.tmdbId,
              type: 'series',
              season: targetSeason,
              episode: targetEpisodeNum,
            }),
          };

          setActiveMedia(enrichedMedia);
          setActiveEpisode(randomEp);
          setActiveHub('cinecast');
          setIsScreenInStandby(false);
          setPlayerInitialTime(0);
          setIsPlayingLocally(true);
          triggerNotification(`🎲 Empezando en T${targetSeason}:E${targetEpisodeNum} (aleatorio)`);

          if (typeof window !== 'undefined' && (window as any).electronAPI) {
            (window as any).electronAPI.focusWindow?.();
          }

          const fullState: PlaybackState = {
            mediaId: enrichedMedia.id,
            episodeId: randomEp.id,
            mediaTitle: enrichedMedia.title,
            mediaPoster: enrichedMedia.posterUrl,
            mediaYear: enrichedMedia.year,
            mediaItem: enrichedMedia,
            episodeItem: randomEp,
            isPlaying: true,
            currentTime: 0,
            duration: 0,
            buffered: 0,
            isStandby: false,
            screenDeviceName: deviceSync.getDeviceName(),
            audioSettings,
            playbackSettings,
            isIntroActive: false,
            isRecapActive: false,
            nextEpisodeCountdown: null,
            seasonNumber: targetSeason,
            episodeNumber: targetEpisodeNum,
          };
          deviceSync.broadcastPlaybackState(fullState);
          setRemotePlaybackState(fullState);
        }
        break;
      }
      case 'changeServer': {
        setLastRemoteCommand({ cmd, timestamp: Date.now() });
        const srvName = cmd.payload?.serverName || `Servidor #${cmd.payload?.serverIndex ?? 0}`;
        triggerNotification(`📡 Cambiando servidor en TV: ${srvName}`);
        break;
      }
      case 'addCustomStream': {
        if (cmd.payload && cmd.payload.id) {
          triggerNotification(`✨ Nuevo contenido agregado: ${cmd.payload.title}`);
        }
        break;
      }
      case 'playSpotifyTrack': {
        setActiveSpotifyTrack(cmd.payload);
        setIsSpotifyPlaying(true);
        setActiveHub('spotify');
        setIsScreenInStandby(false);
        triggerNotification(`🎵 Spotify: ${cmd.payload.title}`);
        break;
      }
      case 'playYouTubeVideo': {
        setActiveYouTubeVideo(cmd.payload);
        setIsYouTubePlaying(true);
        setActiveHub('youtube');
        setIsScreenInStandby(false);
        triggerNotification(`📺 YouTube: ${cmd.payload.title}`);
        break;
      }
      case 'switchTab': {
        setActiveHub(cmd.payload);
        setIsScreenInStandby(false);
        break;
      }
      case 'switchHub': {
        const targetHub = cmd.payload?.hub || 'cinecast';
        setActiveHub(targetHub);
        setIsScreenInStandby(false);
        // Cerrar el reproductor de películas si estaba abierto para pasar al instante a YouTube, Spotify o Fútbol
        if (targetHub === 'youtube' || targetHub === 'spotify' || targetHub === 'sports') {
          setIsPlayingLocally(false);
        }
        const stateUpdate: PlaybackState = {
          ...remotePlaybackState,
          activeHub: targetHub,
          isStandby: false,
          isPlaying: false,
        };
        deviceSync.broadcastPlaybackState(stateUpdate);
        setRemotePlaybackState(stateUpdate);
        const label = targetHub === 'cinecast' ? '🎬 Pelis/Series' : targetHub === 'youtube' ? '▶️ YouTube' : targetHub === 'spotify' ? '🎵 Spotify' : '⚽ Fútbol';
        triggerNotification(`📱 Pantalla cambiada a: ${label}`);
        if (typeof window !== 'undefined' && window.electronAPI) {
          window.electronAPI.focusWindow?.();
        }
        break;
      }
      case 'playYouTube': {
        const payload = cmd.payload;
        const targetHub = payload?.hub === 'spotify' ? 'spotify' : 'youtube';
        setActiveHub(targetHub);
        setIsPlayingLocally(false);
        setIsScreenInStandby(false);

        if (payload?.videoId) {
          if (targetHub === 'spotify') {
            const trackObj: SpotifyTrack = {
              id: payload.videoId,
              title: payload.title || 'Canción',
              artist: payload.author || payload.channel || 'Artista',
              album: 'Single / Stream',
              durationSeconds: 210,
              previewUrl: '',
              genres: ['Música Remota'],
              coverUrl: payload.thumbnail || `https://img.youtube.com/vi/${payload.videoId}/hqdefault.jpg`,
            };
            setActiveSpotifyTrack(trackObj);
            setIsSpotifyPlaying(true);
            triggerNotification(`🎵 Spotify: ${trackObj.title} - ${trackObj.artist}`);
          } else {
            const vidObj: YouTubeVideo = {
              id: `yt-${payload.videoId}`,
              videoId: payload.videoId,
              title: payload.title || 'Video Seleccionado',
              channel: payload.author || payload.channel || 'YouTube',
              duration: payload.duration || 'Online',
              views: 'Reproduciendo',
              thumbnailUrl: payload.thumbnail || `https://img.youtube.com/vi/${payload.videoId}/hqdefault.jpg`,
              category: 'YouTube Cast',
            };
            setActiveYouTubeVideo(vidObj);
            setIsYouTubePlaying(true);
            triggerNotification(`📺 YouTube: ${vidObj.title}`);
          }
        } else if (payload?.video) {
          setActiveYouTubeVideo(payload.video);
          setIsYouTubePlaying(true);
          triggerNotification(`📺 YouTube: ${payload.video.title}`);
        } else if (typeof payload === 'string' || payload?.query) {
          const query = typeof payload === 'string' ? payload : payload.query;
          triggerNotification(`📺 Buscando: "${query}"`);
        }

        if (typeof window !== 'undefined' && window.electronAPI) {
          window.electronAPI.focusWindow?.();
        }
        break;
      }
      case 'controlSpotify': {
        const action = cmd.payload?.action || cmd.payload;
        setActiveHub('spotify');
        setIsScreenInStandby(false);
        if (action === 'togglePlay') {
          setIsSpotifyPlaying((p) => !p);
          window.electronAPI?.sendNativeKey?.('MediaPlayPause');
        } else if (action === 'next') {
          window.electronAPI?.sendNativeKey?.('MediaNextTrack');
        } else if (action === 'prev') {
          window.electronAPI?.sendNativeKey?.('MediaPreviousTrack');
        }
        triggerNotification(`🎵 Spotify: ${action}`);
        break;
      }
      case 'togglePlay': {
        window.electronAPI?.controlActiveMedia?.({ action: 'togglePlay' });
        if (activeHub === 'spotify') {
          setIsSpotifyPlaying((p) => !p);
        } else if (activeHub === 'youtube') {
          setIsYouTubePlaying((p) => !p);
        } else {
          setIsPlayingLocally(true);
        }
        triggerNotification(`📱 Comando: Play / Pausa`);
        break;
      }
      case 'play': {
        window.electronAPI?.controlActiveMedia?.({ action: 'play' });
        if (activeHub === 'spotify') setIsSpotifyPlaying(true);
        else if (activeHub === 'youtube') setIsYouTubePlaying(true);
        else setIsPlayingLocally(true);
        triggerNotification(`📱 Comando: Reproducir ▶`);
        break;
      }
      case 'pause': {
        window.electronAPI?.controlActiveMedia?.({ action: 'pause' });
        if (activeHub === 'spotify') setIsSpotifyPlaying(false);
        else if (activeHub === 'youtube') setIsYouTubePlaying(false);
        triggerNotification(`📱 Comando: Pausa ⏸`);
        break;
      }
      case 'seek': {
        const time = typeof cmd.payload === 'number' ? cmd.payload : 0;
        window.electronAPI?.controlActiveMedia?.({ action: 'seek', value: time });
        triggerNotification(`📱 Saltando a tiempo seleccionado`);
        break;
      }
      case 'seekRelative': {
        const delta = cmd.payload || 10;
        window.electronAPI?.controlActiveMedia?.({ action: 'seekRelative', value: delta });
        triggerNotification(`📱 Salto de ${delta > 0 ? `+${delta}s` : `${delta}s`}`);
        break;
      }
      case 'toggleSubtitles': {
        window.electronAPI?.controlActiveMedia?.({ action: 'toggleSubtitles', value: cmd.payload });
        triggerNotification(`📱 Subtítulos alterados`);
        break;
      }
      case 'setVolume': {
        const newVol = typeof cmd.payload === 'number' ? Math.max(0, Math.min(100, cmd.payload)) : 85;
        setAudioSettings((prev) => ({ ...prev, volume: newVol, isMuted: false }));
        window.electronAPI?.setMasterVolume?.({ volume: newVol, isMuted: false });
        triggerNotification(`📱 Volumen PC: ${newVol}%`);
        break;
      }
      case 'toggleMute': {
        setAudioSettings((prev) => {
          const nextMuted = !prev.isMuted;
          window.electronAPI?.setMasterVolume?.({ volume: prev.volume, isMuted: nextMuted });
          return { ...prev, isMuted: nextMuted };
        });
        triggerNotification(`📱 Silencio alterado`);
        break;
      }
      case 'setAudioSettings': {
        const newSettings = cmd.payload;
        setAudioSettings((prev) => ({ ...prev, ...newSettings }));
        if (newSettings.preset) {
          triggerNotification(`📱 Efecto de audio: ${newSettings.preset.toUpperCase()}`);
        }
        break;
      }
      case 'setPlaybackSettings': {
        const newSettings = cmd.payload;
        setPlaybackSettings((prev) => ({ ...prev, ...newSettings }));
        break;
      }
      case 'setMarathon': {
        const enabled = Boolean(cmd.payload?.enabled);
        try {
          localStorage.setItem('cinecast_marathon_mode', String(enabled));
        } catch {}
        window.dispatchEvent(new CustomEvent('cinecast:marathon', { detail: { enabled } }));
        setRemotePlaybackState((prev) => {
          const nextState = {
            ...prev,
            marathon: enabled,
          };
          deviceSync.broadcastPlaybackState(nextState);
          return nextState;
        });
        triggerNotification(`🏃 Modo Maratón ${enabled ? 'ACTIVADO' : 'Desactivado'}`);
        break;
      }
      case 'skipIntro': {
        triggerNotification('📱 Intro saltada desde el celular ⏩');
        break;
      }
      case 'setStandby': {
        setIsScreenInStandby(true);
        setIsPlayingLocally(false);
        triggerNotification('📱 Pantalla puesta en Reposo 💤');
        break;
      }
      case 'wakeScreen': {
        setIsScreenInStandby(false);
        if (cmd.payload?.testSignal) {
          playSignalChime();
          triggerNotification('🔔 ¡Señal recibida desde tu Celular! Control Remoto 100% Activo');
        } else {
          triggerNotification('📱 Pantalla activada ⚡');
        }
        break;
      }
      case 'nextEpisode': {
        if (!isPlayingLocally) {
          handlePlayNextEpisode();
        }
        break;
      }
      case 'prevEpisode': {
        if (!isPlayingLocally) {
          handlePlayPrevEpisode();
        }
        break;
      }
      case 'jumpToEpisode': {
        const { season, episode } = cmd.payload || {};
        if (activeMedia) {
          triggerNotification(`📱 Saltando a T${season || 1}:E${episode || 1}`);
          const sNum = Number(season) || 1;
          const eNum = Number(episode) || 1;
          const found = activeMedia.episodes?.find(
            (e) => (e.seasonNumber === sNum || (!e.seasonNumber && sNum === 1)) && e.episodeNumber === eNum
          );
          if (found) {
            setActiveEpisode(found);
          } else {
            setActiveEpisode({
              id: `ep-${activeMedia.id}-s${sNum}-e${eNum}`,
              title: `Episodio ${eNum}`,
              episodeNumber: eNum,
              seasonNumber: sNum,
              overview: `Temporada ${sNum}, Episodio ${eNum}`,
              duration: '24m',
              thumbnailUrl: activeMedia.backdropUrl || activeMedia.posterUrl,
              videoUrl: '',
            });
          }
          setIsPlayingLocally(true);
        }
        break;
      }
      case 'trackpadMove':
      case 'trackpadClick':
      case 'trackpadScroll': {
        if (window.electronAPI?.sendNativeTrackpadEvent) {
          window.electronAPI.sendNativeTrackpadEvent(cmd.payload);
        }
        break;
      }
      case 'navigateUp':
      case 'navigateDown':
      case 'navigateLeft':
      case 'navigateRight':
      case 'select':
      case 'enter':
      case 'back': {
        const keyMap: Record<string, string> = {
          navigateUp: 'ArrowUp',
          navigateDown: 'ArrowDown',
          navigateLeft: 'ArrowLeft',
          navigateRight: 'ArrowRight',
          select: 'Enter',
          enter: 'Enter',
          back: 'Escape',
        };
        const keyCode = keyMap[cmd.action];
        if (keyCode) {
          window.electronAPI?.sendNativeKey?.(keyCode);
        }
        break;
      }
      case 'toggleHubFullscreen': {
        hubFullscreen.toggle();
        break;
      }
    }
  };

  remoteCmdHandlerRef.current = handleRemoteCommandReceived;

  // COPIA de App.tsx L840-918; borrar al eliminar la UI clásica
  // Universal Next (works for Series Episodes, Movies, YouTube Videos, and Spotify Tracks)
  const handlePlayNextEpisode = () => {
    if (activeHub === 'youtube') {
      const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
      const nextVid = YOUTUBE_VIDEOS[(idx + 1) % YOUTUBE_VIDEOS.length];
      setActiveYouTubeVideo(nextVid);
      setIsYouTubePlaying(true);
      triggerNotification(`📺 Siguiente video: ${nextVid.title}`);
      return;
    }

    if (activeHub === 'spotify') {
      const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
      const nextTrack = SPOTIFY_TRACKS[(idx + 1) % SPOTIFY_TRACKS.length];
      setActiveSpotifyTrack(nextTrack);
      setIsSpotifyPlaying(true);
      triggerNotification(`🎵 Siguiente canción: ${nextTrack.title}`);
      return;
    }

    if (!activeMedia) return;
    if (activeMedia.episodes && activeMedia.episodes.length > 0) {
      const currentIdx = activeMedia.episodes.findIndex((e) => e.id === activeEpisode?.id);
      if (currentIdx !== -1 && currentIdx + 1 < activeMedia.episodes.length) {
        const nextEp = activeMedia.episodes[currentIdx + 1];
        setActiveEpisode(nextEp);
        setIsPlayingLocally(true);
        triggerNotification(`📱 Siguiente capítulo: ${nextEp.title}`);
        return;
      }
    }

    // If on last episode of series or watching a movie, advance to next title in catalog
    const mediaIdx = MEDIA_CATALOG.findIndex((m) => m.id === activeMedia.id);
    const nextMedia = MEDIA_CATALOG[(mediaIdx + 1) % MEDIA_CATALOG.length];
    setActiveMedia(nextMedia);
    setActiveEpisode(nextMedia.episodes?.[0] || null);
    setIsPlayingLocally(true);
    triggerNotification(`📱 Siguiente título: ${nextMedia.title}`);
  };

  const handlePlayPrevEpisode = () => {
    if (activeHub === 'youtube') {
      const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
      const prevVid = YOUTUBE_VIDEOS[(idx - 1 + YOUTUBE_VIDEOS.length) % YOUTUBE_VIDEOS.length];
      setActiveYouTubeVideo(prevVid);
      setIsYouTubePlaying(true);
      triggerNotification(`📺 Video anterior: ${prevVid.title}`);
      return;
    }

    if (activeHub === 'spotify') {
      const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
      const prevTrack = SPOTIFY_TRACKS[(idx - 1 + SPOTIFY_TRACKS.length) % SPOTIFY_TRACKS.length];
      setActiveSpotifyTrack(prevTrack);
      setIsSpotifyPlaying(true);
      triggerNotification(`🎵 Canción anterior: ${prevTrack.title}`);
      return;
    }

    if (!activeMedia) return;
    if (activeMedia.episodes && activeMedia.episodes.length > 0) {
      const currentIdx = activeMedia.episodes.findIndex((e) => e.id === activeEpisode?.id);
      if (currentIdx > 0) {
        const prevEp = activeMedia.episodes[currentIdx - 1];
        setActiveEpisode(prevEp);
        setIsPlayingLocally(true);
        triggerNotification(`📱 Capítulo anterior: ${prevEp.title}`);
        return;
      }
    }

    const mediaIdx = MEDIA_CATALOG.findIndex((m) => m.id === activeMedia.id);
    const prevMedia = MEDIA_CATALOG[(mediaIdx - 1 + MEDIA_CATALOG.length) % MEDIA_CATALOG.length];
    setActiveMedia(prevMedia);
    setActiveEpisode(prevMedia.episodes?.[0] || null);
    setIsPlayingLocally(true);
    triggerNotification(`📱 Título anterior: ${prevMedia.title}`);
  };

  // COPIA de App.tsx L920-926; borrar al eliminar la UI clásica
  // Transmit command to screen
  const sendRemoteCommand = (command: RemoteCommand) => {
    recordSentCommand(command.action);
    if (deviceRole === 'screen') {
      handleRemoteCommandReceived(command);
    }
    deviceSync.sendCommand(command, selectedScreenId || undefined);
  };

  // COPIA de App.tsx L1098-1110; borrar al eliminar la UI clásica
  // Target connected screen friendly name
  const connectedScreen = devices.find((d) => d.id === selectedScreenId);
  const connectedScreenName = connectedScreen?.name || (devices.length > 0 ? devices[0].name : 'PC Dormitorio');

  // Currently playing item for handheld remote preview (reflects real active title, series, or anime)
  const remoteMediaItem =
    remotePlaybackState.mediaItem ||
    (remotePlaybackState.mediaId ? MEDIA_CATALOG.find((m) => m.id === remotePlaybackState.mediaId) : null) ||
    activeMedia;
  const remoteEpisodeItem =
    remotePlaybackState.episodeItem ||
    remoteMediaItem?.episodes?.find((e) => e.id === remotePlaybackState.episodeId) ||
    activeEpisode;

  // COPIA de App.tsx L928-1064; borrar al eliminar la UI clásica
  // User taps "Transmitir a PC" on a movie/episode
  const handleCastMediaToScreen = (media: MediaItem, episode?: Episode, initialTime?: number) => {
    const rawEp = episode || media.episodes?.[0] || null;
    const targetEp: Episode | null = rawEp
      ? {
          ...rawEp,
          seasonNumber:
            Number(
              rawEp.seasonNumber ??
                (rawEp as any).season ??
                (rawEp as any).season_number ??
                (media as any).seasonNumber ??
                1
            ) || 1,
          episodeNumber:
            Number(
              rawEp.episodeNumber ??
                (rawEp as any).episode ??
                (rawEp as any).episode_number ??
                (media as any).episodeNumber ??
                1
            ) || 1,
        }
      : null;

    setActiveMedia(media);
    setActiveEpisode(targetEp);

    const effectiveTmdbId =
      media.tmdbId ||
      (typeof media.id === 'string' && /^\d+$/.test(media.id)
        ? Number(media.id)
        : typeof media.id === 'string' && media.id.includes('-')
        ? Number(media.id.split('-').pop()) || 0
        : 0);

    const srvs =
      media.servers && media.servers.length > 0
        ? media.servers
        : generateServersForMedia({
            tmdbId: effectiveTmdbId,
            type:
              media.category === 'live_tv'
                ? 'live_tv'
                : media.type === 'series' || media.category === 'anime' || media.category === 'series'
                ? 'series'
                : 'movie',
            season: targetEp?.seasonNumber || 1,
            episode: targetEp?.episodeNumber || 1,
          });

    // Update optimistic state on the phone so remote control bar immediately reflects the cast media
    setRemotePlaybackState((prev) => ({
      ...prev,
      mediaId: media.id,
      episodeId: targetEp?.id || null,
      mediaTitle: media.title,
      mediaPoster: media.posterUrl,
      mediaYear: media.year,
      seasonNumber: targetEp?.seasonNumber || 1,
      episodeNumber: targetEp?.episodeNumber || 1,
      episodeTitle: targetEp?.title || '',
      mediaItem: media,
      episodeItem: targetEp || undefined,
      isPlaying: true,
      currentTime: initialTime || 0,
      isStandby: false,
      servers: srvs.map((s) => ({ name: s.name, language: s.language })),
      activeServerIndex: 0,
      activeHub: 'cinecast',
    }));

    deviceSync.sendCommand({
      action: 'playDiscoveredMovie',
      payload: {
        ...media,
        servers: srvs,
        episode: targetEp || undefined,
        selectedEpisode: targetEp || undefined,
        seasonNumber: targetEp?.seasonNumber || 1,
        episodeNumber: targetEp?.episodeNumber || 1,
        episodeTitle: targetEp?.title || '',
        initialTime: initialTime || 0,
        currentTime: initialTime || 0,
      },
    });

    triggerNotification(`📱 Reproduciendo ${media.title} en ${connectedScreenName}...`);
  };

  // Local Play (or automatically Cast if user is on their phone in remote mode!)
  const handlePlayLocal = (
    media: MediaItem,
    episode?: Episode | null,
    initialTime?: number,
    forceLocal: boolean = false
  ) => {
    if (deviceRole === 'remote' && !forceLocal) {
      handleCastMediaToScreen(media, episode || undefined, initialTime);
      return;
    }
    setActiveMedia(media);
    const rawEp = episode || media.episodes?.[0] || null;
    const ep: Episode | null = rawEp
      ? {
          ...rawEp,
          seasonNumber:
            Number(
              rawEp.seasonNumber ??
                (rawEp as any).season ??
                (rawEp as any).season_number ??
                (media as any).seasonNumber ??
                1
            ) || 1,
          episodeNumber:
            Number(
              rawEp.episodeNumber ??
                (rawEp as any).episode ??
                (rawEp as any).episode_number ??
                (media as any).episodeNumber ??
                1
            ) || 1,
        }
      : null;
    setActiveEpisode(ep);
    setPlayerInitialTime(initialTime || 0);
    setIsPlayingLocally(true);
    setIsScreenInStandby(false);

    // Broadcast full media details to all remotes immediately
    const srvs =
      media.servers && media.servers.length > 0
        ? media.servers
        : generateServersForMedia({
            tmdbId: media.tmdbId,
            type:
              media.category === 'live_tv'
                ? 'live_tv'
                : media.type === 'series'
                ? 'series'
                : 'movie',
            season: ep?.seasonNumber || 1,
            episode: ep?.episodeNumber || 1,
          });

    const fullState: PlaybackState = {
      mediaId: media.id,
      episodeId: ep?.id || null,
      mediaTitle: media.title,
      mediaPoster: media.posterUrl,
      mediaYear: media.year,
      seasonNumber: ep?.seasonNumber || 1,
      episodeNumber: ep?.episodeNumber || 1,
      episodeTitle: ep?.title || '',
      mediaItem: media,
      episodeItem: ep || undefined,
      isPlaying: true,
      currentTime: initialTime || 0,
      duration: 0,
      buffered: 0,
      isStandby: false,
      screenDeviceName: deviceSync.getDeviceName(),
      activeHub: 'cinecast',
      servers: srvs.map((s) => ({ name: s.name, language: s.language })),
      activeServerIndex: 0,
      audioSettings,
      playbackSettings,
      isIntroActive: false,
      isRecapActive: false,
      nextEpisodeCountdown: null,
    };
    deviceSync.broadcastPlaybackState(fullState);
    setRemotePlaybackState(fullState);
  };

  // Broadcast state to mobile remotes when player state changes
  const handleBroadcastPlayerState = useCallback((stateUpdate: Partial<PlaybackState>) => {
    if (deviceRole === 'screen') {
      const effectivePlaying =
        activeHub === 'spotify'
          ? isSpotifyPlaying
          : activeHub === 'youtube'
          ? isYouTubePlaying
          : isPlayingLocally;

      setRemotePlaybackState((prev) => {
        const fullState: PlaybackState = {
          ...prev,
          mediaId: activeMedia?.id || prev.mediaId || null,
          episodeId: activeEpisode?.id || prev.episodeId || null,
          mediaTitle: activeMedia?.title || prev.mediaTitle,
          mediaPoster: activeMedia?.posterUrl || prev.mediaPoster,
          mediaYear: activeMedia?.year || prev.mediaYear,
          seasonNumber: activeEpisode?.seasonNumber || prev.seasonNumber || 1,
          episodeNumber: activeEpisode?.episodeNumber || prev.episodeNumber || 1,
          episodeTitle: activeEpisode?.title || prev.episodeTitle || '',
          mediaItem: activeMedia || prev.mediaItem || undefined,
          episodeItem: activeEpisode || prev.episodeItem || undefined,
          isPlaying: effectivePlaying,
          currentTime: 0,
          duration: 0,
          buffered: 0,
          isStandby: isScreenInStandby,
          screenDeviceName: deviceSync.getDeviceName(),
          activeHub,
          audioSettings,
          playbackSettings,
          marathon:
            typeof stateUpdate.marathon === 'boolean'
              ? stateUpdate.marathon
              : typeof window !== 'undefined' && localStorage.getItem('cinecast_marathon_mode') === 'true',
          hasIntroTimings: Boolean(stateUpdate.hasIntroTimings || stateUpdate.isIntroActive),
          isIntroActive: false,
          isRecapActive: false,
          nextEpisodeCountdown: null,
          ...stateUpdate,
        };
        deviceSync.broadcastPlaybackState(fullState);
        return fullState;
      });
    }
  }, [activeMedia, activeEpisode, isPlayingLocally, isSpotifyPlaying, isYouTubePlaying, activeHub, isScreenInStandby, audioSettings, playbackSettings, deviceRole]);

  // Also broadcast whenever standby, active media, or audio settings change on the PC screen
  useEffect(() => {
    if (deviceRole === 'screen') {
      if (isPlayingLocally && activeHub === 'cinecast') return;
      handleBroadcastPlayerState({});
    }
  }, [deviceRole, isScreenInStandby, isPlayingLocally, isSpotifyPlaying, isYouTubePlaying, activeHub, activeMedia?.id, activeEpisode?.id, audioSettings]);

  // Polling universal de estado real de reproducción en Electron cada 2s para sincronizar YouTube, Spotify o Embeds con el celular
  useEffect(() => {
    if (deviceRole === 'remote') return;
    if (isPlayingLocally && activeHub === 'cinecast') return;
    const interval = setInterval(async () => {
      if (isPlayingLocally && activeHub === 'cinecast') return;
      const realState = await window.electronAPI?.getRealMediaState?.();
      if (realState && realState.found) {
        const title = realState.title || (activeHub === 'spotify' ? activeSpotifyTrack?.title : activeHub === 'youtube' ? activeYouTubeVideo?.title : activeMedia?.title) || 'Reproduciendo en PC';
        handleBroadcastPlayerState({
          currentTime: realState.currentTime,
          duration: realState.duration > 0 ? realState.duration : 0,
          isPlaying: realState.isPlaying,
          mediaTitle: title,
        });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [deviceRole, isPlayingLocally, activeHub, activeSpotifyTrack, activeYouTubeVideo, activeMedia, handleBroadcastPlayerState]);

  const value: AppRuntimeContextValue = {
    deviceRole,
    setDeviceRole,
    roomId,
    setRoomId,
    devices,
    selectedScreenId,
    setSelectedScreenId,
    homeRoomId,
    isPermanentHomeLinked,
    isGuestMode,
    setIsGuestMode,
    connectedScreenName,
    handleTogglePermanentHome,
    activeHub,
    setActiveHub,
    activeSpotifyTrack,
    setActiveSpotifyTrack,
    isSpotifyPlaying,
    setIsSpotifyPlaying,
    activeYouTubeVideo,
    setActiveYouTubeVideo,
    isYouTubePlaying,
    setIsYouTubePlaying,
    isScreenInStandby,
    setIsScreenInStandby,
    remoteNotification,
    triggerNotification,
    audioSettings,
    setAudioSettings,
    playbackSettings,
    setPlaybackSettings,
    activeMedia,
    setActiveMedia,
    activeEpisode,
    setActiveEpisode,
    isPlayingLocally,
    setIsPlayingLocally,
    playerInitialTime,
    setPlayerInitialTime,
    lastRemoteCommand,
    remotePlaybackState,
    setRemotePlaybackState,
    remoteMediaItem,
    remoteEpisodeItem,
    handlePlayLocal,
    handleCastMediaToScreen,
    handlePlayNextEpisode,
    handlePlayPrevEpisode,
    handleBroadcastPlayerState,
    sendRemoteCommand,
    continueWatchingList,
    refreshContinueWatching,
    myListIds,
    toggleMyList,
    isAudioModalOpen,
    setIsAudioModalOpen,
    isGuestModalOpen,
    setIsGuestModalOpen,
  };

  return (
    <AppRuntimeContext.Provider value={value}>
      {/* COPIA de App.tsx L1115-1129; borrar al eliminar la UI clásica */}
      {/* Toast Notification from Remote Commands */}
      {remoteNotification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-zinc-900/95 border border-zinc-700/80 text-white text-xs sm:text-sm font-bold flex items-center gap-3 shadow-2xl backdrop-blur-xl animate-bounce">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
          <span>{remoteNotification}</span>
        </div>
      )}

      {/* Guest Mode Welcome Banner */}
      {isGuestMode && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-bold flex items-center gap-2 shadow-2xl animate-fadeIn">
          <Users className="w-4 h-4" />
          <span>¡Te uniste como Invitado a la sala! Podés poner música o videos en la pantalla.</span>
          <button onClick={() => setIsGuestMode(false)} className="ml-2 text-white/80 hover:text-white">✕</button>
        </div>
      )}

      {children}

      {/* COPIA de App.tsx L1749-1763; borrar al eliminar la UI clásica */}
      {/* Virtual Cursor Indicator (Trackpad Mode) */}
      {virtualCursor && virtualCursor.visible && (
        <div
          className="fixed pointer-events-none z-[99999] transition-all duration-75 ease-out"
          style={{
            left: `${virtualCursor.x}px`,
            top: `${virtualCursor.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="relative">
            <div className="w-6 h-6 rounded-full bg-cyan-400/80 border-2 border-white shadow-[0_0_15px_rgba(6,182,212,0.8)] animate-pulse" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow-sm" />
          </div>
        </div>
      )}
    </AppRuntimeContext.Provider>
  );
};

export function useAppRuntime(): AppRuntimeContextValue {
  const ctx = useContext(AppRuntimeContext);
  if (!ctx) {
    throw new Error('useAppRuntime debe usarse dentro de <AppRuntimeProvider>');
  }
  return ctx;
}
