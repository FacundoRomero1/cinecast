import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  MediaItem, Episode, DeviceInfo, DeviceType, AudioSettings, 
  PlaybackSettings, PlaybackState, RemoteCommand 
} from './types';
import { MEDIA_CATALOG, CATEGORIES } from './data/catalog';
import { SPOTIFY_TRACKS, SpotifyTrack } from './data/spotifyCatalog';
import { YOUTUBE_VIDEOS, YouTubeVideo } from './data/youtubeCatalog';
import { deviceSync } from './services/deviceSync';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { MovieRow } from './components/MovieRow';
import { DetailModal } from './components/DetailModal';
import { VideoPlayer } from './components/VideoPlayer';
import { AmbientScreen } from './components/AmbientScreen';
import { RemoteControlDrawer } from './components/RemoteControlDrawer';
import { AudioSettingsModal } from './components/AudioSettingsModal';
import { CastModal } from './components/CastModal';
import { DualScreenSimulator } from './components/DualScreenSimulator';
import { GuestShareModal } from './components/GuestShareModal';
import { SpotifyHub } from './components/SpotifyHub';
import { YouTubeHub } from './components/YouTubeHub';
import { MovieGrid } from './components/MovieGrid';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { watchHistoryService, WatchProgressItem } from './services/watchHistoryService';
import { generateServersForMedia, refreshProviderHealth } from './services/embedService';
import { authService } from './services/authService';
import { createStyledPosterFallback } from './utils/imageUtils';
import { Tv, Film, Smartphone, Moon, Power, Cast, Layers, Check, Users, Sparkles, Home } from 'lucide-react';

export default function App() {
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

  // UI Hub (CineCast, Spotify, YouTube)
  const [activeHub, setActiveHub] = useState<'cinecast' | 'spotify' | 'youtube'>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const hub = params.get('hub');
      if (hub === 'spotify' || hub === 'youtube') return hub;
    } catch (_) {}
    return 'cinecast';
  });

  // UI Modals & Navigation
  const [currentCategory, setCurrentCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [globalSearchResults, setGlobalSearchResults] = useState<MediaItem[] | null>(null);
  const [isGlobalSearching, setIsGlobalSearching] = useState<boolean>(false);
  const [suggestedTypo, setSuggestedTypo] = useState<string | null>(null);

  // TAREA 2: Búsqueda unificada en /api/search con 300ms debounce y sugerencia ortográfica
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setGlobalSearchResults(null);
      setSuggestedTypo(null);
      setIsGlobalSearching(false);
      return;
    }

    setIsGlobalSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) {
            setGlobalSearchResults(
              data.items.map((m: any) => ({
                id: m.id,
                tmdbId: m.tmdbId,
                title: m.title,
                originalTitle: m.originalTitle || m.title,
                overview: m.overview || '',
                description: m.overview || '',
                posterUrl: m.posterUrl || m.posterPath || '',
                backdropUrl: m.backdropUrl || m.backdropPath || '',
                year: m.year || 2024,
                ratingBadge: m.rating ? `${m.rating} ★` : '7.5 ★',
                qualityBadge: m.quality || '1080p HD',
                genres: m.genres || ['Cine'],
                type: m.type || (m.category === 'series' ? 'series' : 'movie'),
                category: m.category || (m.type === 'series' ? 'series' : 'movie'),
                cast: m.cast || ['Reparto Oficial'],
                director: m.director || 'Director',
                matchScore: 98,
                servers: m.servers || [],
                streamType: m.streamType || 'iframe',
                notInCatalog: m.notInCatalog,
              }))
            );
            setSuggestedTypo(data.correctedQuery || null);
            return;
          }
        }
      } catch (e) {
        console.warn('[GlobalSearch] Fallo al consultar /api/search:', e);
      } finally {
        setIsGlobalSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [selectedMediaForDetails, setSelectedMediaForDetails] = useState<MediaItem | null>(null);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState<boolean>(false);
  const [isCastModalOpen, setIsCastModalOpen] = useState<boolean>(false);
  const [isGuestModalOpen, setIsGuestModalOpen] = useState<boolean>(false);
  const [isDualSimulatorOpen, setIsDualSimulatorOpen] = useState<boolean>(false);
  
  const [myListIds, setMyListIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cinecast_my_list');
      return saved ? JSON.parse(saved) : ['deadpool-wolverine', 'stranger-things', 'solo-leveling'];
    } catch {
      return ['deadpool-wolverine'];
    }
  });

  // Screen Standby / Sleep state (always false on start so movie catalog is immediately visible)
  const [isScreenInStandby, setIsScreenInStandby] = useState(false);
  const [remoteNotification, setRemoteNotification] = useState<string | null>(null);

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

  // Spotify State
  const [activeSpotifyTrack, setActiveSpotifyTrack] = useState<SpotifyTrack | null>(SPOTIFY_TRACKS[0]);
  const [isSpotifyPlaying, setIsSpotifyPlaying] = useState<boolean>(false);

  // YouTube State
  const [activeYouTubeVideo, setActiveYouTubeVideo] = useState<YouTubeVideo | null>(YOUTUBE_VIDEOS[0]);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState<boolean>(false);

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

  // Save My List changes
  const toggleMyList = (mediaId: string) => {
    setMyListIds((prev) => {
      const next = prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId];
      localStorage.setItem('cinecast_my_list', JSON.stringify(next));
      return next;
    });
  };

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

  // Handle incoming commands sent from mobile
  const handleRemoteCommandReceived = (cmd: RemoteCommand, _from?: string) => {
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
        'toggleSubtitles', 'changeServer', 'nextEpisode', 'prevEpisode', 'jumpToEpisode'
      ];
      if (playerHandledActions.includes(cmd.action)) {
        return;
      }
    }

    switch (cmd.action) {
      case 'playMedia': {
        const { mediaId, episodeId } = cmd.payload || {};
        const media = MEDIA_CATALOG.find((m) => m.id === mediaId);
        if (media) {
          const episode = media.episodes?.find((e) => e.id === episodeId) || media.episodes?.[0] || null;
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
        const mediaItem: MediaItem | undefined = cmd.payload;
        if (mediaItem) {
          if (!mediaItem.servers || mediaItem.servers.length === 0) {
            mediaItem.servers = generateServersForMedia({
              tmdbId: mediaItem.tmdbId,
              directMp4Url: mediaItem.videoUrl,
              type: mediaItem.category === 'live_tv' ? 'live_tv' : mediaItem.type === 'series' ? 'series' : 'movie',
            });
            if (!mediaItem.videoUrl && mediaItem.servers.length > 0) {
              mediaItem.videoUrl = mediaItem.servers[0].url;
            }
          }
          const ep = mediaItem.episodes?.[0] || null;
          setActiveMedia(mediaItem);
          setActiveEpisode(ep);
          setActiveHub('cinecast');
          setIsScreenInStandby(false);
          setPlayerInitialTime(0);
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
            mediaItem: mediaItem,
            episodeItem: ep || undefined,
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
        handlePlayNextEpisode();
        break;
      }
      case 'prevEpisode': {
        handlePlayPrevEpisode();
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
    }
  };

  remoteCmdHandlerRef.current = handleRemoteCommandReceived;

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

  // Transmit command to screen
  const sendRemoteCommand = (command: RemoteCommand) => {
    if (deviceRole === 'screen') {
      handleRemoteCommandReceived(command);
    }
    deviceSync.sendCommand(command, selectedScreenId || undefined);
  };

  // User taps "Transmitir a PC" on a movie/episode
  const handleCastMediaToScreen = (media: MediaItem, episode?: Episode) => {
    const targetEp = episode || media.episodes?.[0] || null;
    setActiveMedia(media);
    setActiveEpisode(targetEp);

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
      isStandby: false,
    }));

    deviceSync.sendCommand({
      action: 'playDiscoveredMovie',
      payload: media,
    });

    triggerNotification(`📱 Reproduciendo ${media.title} en ${connectedScreenName}...`);
  };

  // Local Play (or automatically Cast if user is on their phone in remote mode!)
  const handlePlayLocal = (media: MediaItem, episode?: Episode | null, initialTime?: number) => {
    if (deviceRole === 'remote') {
      handleCastMediaToScreen(media, episode || undefined);
      return;
    }
    setActiveMedia(media);
    const ep = episode || media.episodes?.[0] || null;
    setActiveEpisode(ep);
    setPlayerInitialTime(initialTime || 0);
    setIsPlayingLocally(true);
    setIsScreenInStandby(false);

    // Broadcast full media details to all remotes immediately
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

      const fullState: PlaybackState = {
        mediaId: activeMedia?.id || null,
        episodeId: activeEpisode?.id || null,
        mediaTitle: activeMedia?.title,
        mediaPoster: activeMedia?.posterUrl,
        mediaYear: activeMedia?.year,
        seasonNumber: activeEpisode?.seasonNumber || 1,
        episodeNumber: activeEpisode?.episodeNumber || 1,
        episodeTitle: activeEpisode?.title || '',
        mediaItem: activeMedia || undefined,
        episodeItem: activeEpisode || undefined,
        isPlaying: effectivePlaying,
        currentTime: 0,
        duration: 0,
        buffered: 0,
        isStandby: isScreenInStandby,
        screenDeviceName: deviceSync.getDeviceName(),
        audioSettings,
        playbackSettings,
        isIntroActive: false,
        isRecapActive: false,
        nextEpisodeCountdown: null,
        ...stateUpdate,
      };
      deviceSync.broadcastPlaybackState(fullState);
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

  // Catalog filtered by category and search query
  const filteredCatalog = useMemo(() => {
    return MEDIA_CATALOG.filter((item) => {
      const isAnime =
        item.category === 'anime' ||
        item.genres.some((g) => g.toLowerCase().includes('anime'));

      const matchesCategory =
        currentCategory === 'all' ||
        (currentCategory === 'anime' && isAnime) ||
        (currentCategory === 'series' && item.type === 'series' && !isAnime) ||
        (currentCategory === 'movies' && item.type === 'movie') ||
        (currentCategory === 'my-list' && myListIds.includes(item.id)) ||
        item.genres.some((g) => g.toLowerCase().includes(currentCategory.toLowerCase()));

      const matchesSearch =
        !searchQuery ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.originalTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase())) ||
        item.cast.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesCategory && matchesSearch;
    });
  }, [currentCategory, searchQuery, myListIds]);

  const featuredMedia = MEDIA_CATALOG.find((m) => m.featured) || MEDIA_CATALOG[0];
  const seriesList = MEDIA_CATALOG.filter((m) => m.type === 'series');
  const moviesList = MEDIA_CATALOG.filter((m) => m.type === 'movie');
  const sciFiList = MEDIA_CATALOG.filter((m) => m.genres.includes('Ciencia Ficción') || m.genres.includes('Acción'));
  const actionList = MEDIA_CATALOG.filter((m) => m.genres.includes('Suspenso') || m.genres.includes('Misterio'));

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

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-red-600 selection:text-white overflow-x-hidden">
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

      {/* VIEWPORT ROUTING */}
      {isScreenInStandby && deviceRole === 'screen' ? (
        /* Standby Ambient Screen (Shows Clock, Room PIN & QR to connect mobile) */
        <div className="relative">
          <AmbientScreen
            deviceName={deviceSync.getDeviceName()}
            roomId={roomId}
            recentMedia={MEDIA_CATALOG}
            onWakeScreen={() => setIsScreenInStandby(false)}
            onPlayDirectly={(media) => {
              handlePlayLocal(media);
            }}
          />
          {/* Quick toggle to mobile if opened on phone */}
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
            <button
              onClick={() => {
                setDeviceRole('remote');
                deviceSync.setDeviceType('remote');
              }}
              className="px-3 py-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold border border-zinc-700/60 backdrop-blur-md flex items-center gap-1.5 transition"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              Cambiar a Modo Celular
            </button>
          </div>
        </div>
      ) : isPlayingLocally && activeMedia && activeHub === 'cinecast' ? (
        /* Active Video Player Screen */
        <VideoPlayer
          key={`${activeMedia.id}_s${activeEpisode?.seasonNumber || 1}_e${activeEpisode?.episodeNumber || 1}`}
          media={activeMedia}
          episode={activeEpisode}
          audioSettings={audioSettings}
          playbackSettings={playbackSettings}
          remoteCommandTrigger={lastRemoteCommand}
          initialTime={playerInitialTime}
          onUpdateAudio={(newSettings) => {
            setAudioSettings((prev) => ({ ...prev, ...newSettings }));
            deviceSync.broadcastPlaybackState({
              ...remotePlaybackState,
              audioSettings: { ...audioSettings, ...newSettings },
            });
          }}
          onClose={() => {
            setIsPlayingLocally(false);
            setIsScreenInStandby(false);
            setActiveMedia(null);
            setActiveEpisode(null);
            refreshContinueWatching();
          }}
          onNextEpisode={handlePlayNextEpisode}
          onPrevEpisode={handlePlayPrevEpisode}
          hasNextEpisode={true}
          onBroadcastState={handleBroadcastPlayerState}
          remoteCommandNotification={remoteNotification}
          onOpenAudioSettings={() => setIsAudioModalOpen(true)}
        />
      ) : (
        /* Main Catalog & Hubs Screen */
        <div className="pb-[60px]">
          {/* Top Navbar */}
          <Navbar
            currentCategory={currentCategory}
            onSelectCategory={setCurrentCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenCastModal={() => setIsCastModalOpen(true)}
            onOpenAudioModal={() => setIsAudioModalOpen(true)}
            onOpenGuestModal={() => setIsGuestModalOpen(true)}
            connectedScreenName={connectedScreenName}
            isCastConnected={devices.length > 0}
            deviceRole={deviceRole}
            onChangeDeviceRole={(role) => {
              setDeviceRole(role);
              deviceSync.setDeviceType(role);
              if (role === 'screen') setIsScreenInStandby(true);
            }}
            onOpenDualSimulator={() => setIsDualSimulatorOpen(true)}
            activeHub={activeHub}
            onSelectHub={(hub) => {
              setActiveHub(hub);
              sendRemoteCommand({ action: 'switchTab', payload: hub });
            }}
            isPermanentHomeLinked={isPermanentHomeLinked}
          />

          {/* HUB CONTENT */}
          {activeHub === 'spotify' ? (
            <SpotifyHub
              currentTrack={activeSpotifyTrack}
              isPlaying={isSpotifyPlaying}
              volume={audioSettings.volume}
              isMuted={audioSettings.isMuted}
              isScreenMode={deviceRole !== 'remote'}
              onSelectTrack={(track) => {
                setActiveSpotifyTrack(track);
                setIsSpotifyPlaying(true);
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: track });
              }}
              onTogglePlay={() => {
                setIsSpotifyPlaying((p) => !p);
                sendRemoteCommand({ action: 'togglePlay' });
              }}
              onNextTrack={() => {
                if (!activeSpotifyTrack) return;
                const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack.id);
                const nextTrack = SPOTIFY_TRACKS[(idx + 1) % SPOTIFY_TRACKS.length];
                setActiveSpotifyTrack(nextTrack);
                setIsSpotifyPlaying(true);
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: nextTrack });
              }}
              onPrevTrack={() => {
                if (!activeSpotifyTrack) return;
                const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack.id);
                const prevTrack = SPOTIFY_TRACKS[(idx - 1 + SPOTIFY_TRACKS.length) % SPOTIFY_TRACKS.length];
                setActiveSpotifyTrack(prevTrack);
                setIsSpotifyPlaying(true);
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: prevTrack });
              }}
              onCastTrackToScreen={(track) => {
                setActiveSpotifyTrack(track);
                setIsSpotifyPlaying(true);
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: track });
                triggerNotification(`🎵 Transmitiendo ${track.title} a la pantalla...`);
              }}
              connectedScreenName={connectedScreenName}
            />
          ) : activeHub === 'youtube' ? (
            <YouTubeHub
              currentVideo={activeYouTubeVideo}
              isPlaying={isYouTubePlaying}
              volume={audioSettings.volume}
              isMuted={audioSettings.isMuted}
              isScreenMode={deviceRole !== 'remote'}
              remoteCommandTrigger={lastRemoteCommand}
              onSelectVideo={(video) => {
                setActiveYouTubeVideo(video);
                setIsYouTubePlaying(true);
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: video });
              }}
              onTogglePlay={() => {
                setIsYouTubePlaying((p) => !p);
                sendRemoteCommand({ action: 'togglePlay' });
              }}
              onNextVideo={() => {
                if (!activeYouTubeVideo) return;
                const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo.id);
                const nextVid = YOUTUBE_VIDEOS[(idx + 1) % YOUTUBE_VIDEOS.length];
                setActiveYouTubeVideo(nextVid);
                setIsYouTubePlaying(true);
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: nextVid });
              }}
              onPrevVideo={() => {
                if (!activeYouTubeVideo) return;
                const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo.id);
                const prevVid = YOUTUBE_VIDEOS[(idx - 1 + YOUTUBE_VIDEOS.length) % YOUTUBE_VIDEOS.length];
                setActiveYouTubeVideo(prevVid);
                setIsYouTubePlaying(true);
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: prevVid });
              }}
              onSeekRelative={(secs) => {
                sendRemoteCommand({ action: 'seekRelative', payload: secs });
              }}
              onCastVideoToScreen={(video) => {
                setActiveYouTubeVideo(video);
                setIsYouTubePlaying(true);
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: video });
                triggerNotification(`📺 Transmitiendo ${video.title} a la pantalla...`);
              }}
              connectedScreenName={connectedScreenName}
            />
          ) : searchQuery ? (
            <div className="pt-24 px-4 sm:px-12">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Resultados para: <span className="text-red-500">"{searchQuery}"</span>{' '}
                    <span className="text-sm text-zinc-400 font-normal">
                      ({(globalSearchResults !== null ? globalSearchResults : filteredCatalog).length} títulos)
                    </span>
                  </h2>
                  {suggestedTypo && (
                    <div className="mt-2 flex items-center gap-2 text-xs sm:text-sm text-zinc-300">
                      <span>¿Quisiste decir:</span>
                      <button
                        onClick={() => setSearchQuery(suggestedTypo)}
                        className="font-bold text-amber-400 hover:text-amber-300 underline underline-offset-2"
                      >
                        "{suggestedTypo}"
                      </button>
                      <span>?</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={async () => {
                    setIsGlobalSearching(true);
                    try {
                      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&tmdb=true`);
                      if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data.items)) {
                          setGlobalSearchResults(
                            data.items.map((m: any) => ({
                              id: m.id,
                              tmdbId: m.tmdbId,
                              title: m.title,
                              originalTitle: m.originalTitle || m.title,
                              overview: m.overview || '',
                              description: m.overview || '',
                              posterUrl: m.posterUrl || m.posterPath || '',
                              backdropUrl: m.backdropUrl || m.backdropPath || '',
                              year: m.year || 2024,
                              ratingBadge: m.rating ? `${m.rating} ★` : '7.5 ★',
                              qualityBadge: m.quality || '1080p HD',
                              genres: m.genres || ['Cine'],
                              type: m.type || (m.category === 'series' ? 'series' : 'movie'),
                              category: m.category || (m.type === 'series' ? 'series' : 'movie'),
                              cast: m.cast || ['Reparto Oficial'],
                              director: m.director || 'Director',
                              matchScore: 98,
                              servers: m.servers || [],
                              streamType: m.streamType || 'iframe',
                              notInCatalog: m.notInCatalog,
                            }))
                          );
                        }
                      }
                    } catch (_) {}
                    finally {
                      setIsGlobalSearching(false);
                    }
                  }}
                  disabled={isGlobalSearching}
                  className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-xs font-bold text-zinc-200 hover:text-white transition flex items-center gap-2 shrink-0 self-start sm:self-auto shadow-lg"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>{isGlobalSearching ? 'Buscando en TMDB...' : 'Buscar en TMDB Completo'}</span>
                </button>
              </div>

              {isGlobalSearching && (
                <div className="py-6 flex items-center gap-2 text-zinc-400 text-xs">
                  <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <span>Consultando base de datos y espejos...</span>
                </div>
              )}

              {(() => {
                const rawList = globalSearchResults !== null ? globalSearchResults : filteredCatalog;
                const seen = new Set<string>();
                const uniqueSearchList = rawList.filter((item) => {
                  if (!item.id || seen.has(item.id)) return false;
                  seen.add(item.id);
                  return true;
                });
                return uniqueSearchList.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {uniqueSearchList.map((item) => (
                      <div
                        key={`search-${item.id}`}
                        onClick={() => setSelectedMediaForDetails(item)}
                        className="cursor-pointer group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 transition transform hover:scale-105 shadow-xl relative"
                      >
                        <div className="relative aspect-[2/3] bg-zinc-800">
                          {item.posterUrl ? (
                            <img
                              src={item.posterUrl}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src = createStyledPosterFallback(item.title, item.category || item.type);
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs p-2 text-center">
                              Sin póster
                            </div>
                          )}
                          {(item as any).notInCatalog && (
                            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-black uppercase tracking-wider shadow">
                              TMDB Instantáneo
                            </span>
                          )}
                          {/* Badge de Tipo: TV vs Película (Paso 3 - CENSURA) */}
                          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                            {item.type === 'series' || item.category === 'series' || item.category === 'anime' ? (
                              <span className="px-2 py-0.5 rounded-md bg-blue-600/95 text-white text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-lg backdrop-blur-sm border border-blue-400/30">
                                <Tv className="w-2.5 h-2.5" />
                                <span>SERIE</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-600/95 text-white text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-lg backdrop-blur-sm border border-emerald-400/30">
                                <Film className="w-2.5 h-2.5" />
                                <span>PELÍCULA</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="p-3">
                          <div className="text-xs text-emerald-400 font-bold mb-0.5">{item.ratingBadge}</div>
                          <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>
                          <p className="text-[11px] text-zinc-400">{item.year} • {item.qualityBadge}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-20 text-center text-zinc-400 bg-zinc-900/40 rounded-3xl border border-zinc-800/60 p-8">
                    <p className="text-lg font-bold text-white mb-2">No encontramos resultados para "{searchQuery}"</p>
                    <p className="text-xs text-zinc-400 mb-6">Prueba con el botón de búsqueda profunda en TMDB para encontrarlo al instante.</p>
                    <button
                      onClick={async () => {
                        setIsGlobalSearching(true);
                        try {
                          const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&tmdb=true`);
                          if (res.ok) {
                            const data = await res.json();
                            if (Array.isArray(data.items)) {
                            setGlobalSearchResults(
                              data.items.map((m: any) => ({
                                id: m.id,
                                tmdbId: m.tmdbId,
                                title: m.title,
                                originalTitle: m.originalTitle || m.title,
                                overview: m.overview || '',
                                description: m.overview || '',
                                posterUrl: m.posterUrl || m.posterPath || '',
                                backdropUrl: m.backdropUrl || m.backdropPath || '',
                                year: m.year || 2024,
                                ratingBadge: m.rating ? `${m.rating} ★` : '7.5 ★',
                                qualityBadge: m.quality || '1080p HD',
                                genres: m.genres || ['Cine'],
                                type: m.type || (m.category === 'series' ? 'series' : 'movie'),
                                category: m.category || (m.type === 'series' ? 'series' : 'movie'),
                                cast: m.cast || ['Reparto Oficial'],
                                director: m.director || 'Director',
                                matchScore: 98,
                                servers: m.servers || [],
                                streamType: m.streamType || 'iframe',
                                notInCatalog: m.notInCatalog,
                              }))
                            );
                          }
                        }
                      } catch (_) {}
                      finally {
                        setIsGlobalSearching(false);
                      }
                    }}
                    className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition inline-flex items-center gap-2 shadow-lg"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Buscar "{searchQuery}" en TMDB</span>
                  </button>
                </div>
              );
            })()}
            </div>
          ) : (
            <>
              {/* Hero Billboard Banner */}
              <HeroBanner
                media={featuredMedia}
                onPlayLocal={handlePlayLocal}
                onCastToScreen={handleCastMediaToScreen}
                onOpenDetails={setSelectedMediaForDetails}
                connectedScreenName={connectedScreenName}
              />

              {/* Continuar Viendo (Historial Real Persistido en localStorage) */}
              {continueWatchingList.length > 0 && (
                <div className="relative -mt-6 sm:-mt-12 z-25">
                  <ContinueWatchingRow
                    items={continueWatchingList}
                    onPlay={(media, episode, initialTime) => {
                      handlePlayLocal(media, episode, initialTime);
                    }}
                    onCast={(media, episode) => {
                      handleCastMediaToScreen(media, episode || undefined);
                    }}
                    onRemove={(id) => {
                      watchHistoryService.remove(id);
                      refreshContinueWatching();
                      triggerNotification('Quitado de Continuar Viendo');
                    }}
                    connectedScreenName={connectedScreenName}
                  />
                </div>
              )}

              {/* Horizontal Movie & Series Rows + Archive.org + TMDB Video Catalog */}
              <div className="relative -mt-12 sm:-mt-20 z-20 space-y-2">
                {/* Dynamic Archive.org + TMDB Video Catalog (First & Prominent) */}
                <MovieGrid
                  selectedCategory={currentCategory}
                  onSelectCategory={setCurrentCategory}
                  myListIds={myListIds}
                  onToggleMyList={toggleMyList}
                  connectedScreenName={connectedScreenName}
                  onPlayMovie={(mediaItem) => {
                    if (deviceRole === 'remote') {
                      setActiveMedia(mediaItem);
                      setActiveEpisode(null);
                      setRemotePlaybackState((prev) => ({
                        ...prev,
                        mediaId: mediaItem.id,
                        episodeId: null,
                        mediaTitle: mediaItem.title,
                        mediaPoster: mediaItem.posterUrl,
                        mediaYear: mediaItem.year,
                        mediaItem: mediaItem,
                        episodeItem: undefined,
                        isPlaying: true,
                        isStandby: false,
                      }));
                      deviceSync.sendCommand({
                        action: 'playDiscoveredMovie',
                        payload: mediaItem,
                      });
                      triggerNotification(`📱 Enviando ${mediaItem.title} a ${connectedScreenName}...`);
                    } else {
                      handlePlayLocal(mediaItem);
                    }
                  }}
                  onCastMovie={(mediaItem) => {
                    setActiveMedia(mediaItem);
                    setActiveEpisode(null);
                    setRemotePlaybackState((prev) => ({
                      ...prev,
                      mediaId: mediaItem.id,
                      episodeId: null,
                      mediaTitle: mediaItem.title,
                      mediaPoster: mediaItem.posterUrl,
                      mediaYear: mediaItem.year,
                      mediaItem: mediaItem,
                      episodeItem: undefined,
                      isPlaying: true,
                      isStandby: false,
                    }));
                    deviceSync.sendCommand({
                      action: 'playDiscoveredMovie',
                      payload: mediaItem,
                    });
                    triggerNotification(`📱 Enviando ${mediaItem.title} a ${connectedScreenName}...`);
                  }}
                  onOpenDetails={setSelectedMediaForDetails}
                />

                {myListIds.length > 0 && (
                  <MovieRow
                    title="⭐ Mi Lista de Favoritos"
                    items={MEDIA_CATALOG.filter((m) => myListIds.includes(m.id))}
                    onPlayLocal={handlePlayLocal}
                    onCastToScreen={handleCastMediaToScreen}
                    onOpenDetails={setSelectedMediaForDetails}
                    myListIds={myListIds}
                    onToggleMyList={toggleMyList}
                    connectedScreenName={connectedScreenName}
                  />
                )}

                <MovieRow
                  title="Series Más Vistas y Tendencias"
                  items={seriesList}
                  onPlayLocal={handlePlayLocal}
                  onCastToScreen={handleCastMediaToScreen}
                  onOpenDetails={setSelectedMediaForDetails}
                  myListIds={myListIds}
                  onToggleMyList={toggleMyList}
                  connectedScreenName={connectedScreenName}
                />

                <MovieRow
                  title="Acción, Ciencia Ficción & Adrenalina"
                  items={sciFiList}
                  onPlayLocal={handlePlayLocal}
                  onCastToScreen={handleCastMediaToScreen}
                  onOpenDetails={setSelectedMediaForDetails}
                  myListIds={myListIds}
                  onToggleMyList={toggleMyList}
                  connectedScreenName={connectedScreenName}
                />

                <MovieRow
                  title="Películas Destacadas en 4K Ultra HD"
                  items={moviesList}
                  onPlayLocal={handlePlayLocal}
                  onCastToScreen={handleCastMediaToScreen}
                  onOpenDetails={setSelectedMediaForDetails}
                  myListIds={myListIds}
                  onToggleMyList={toggleMyList}
                  connectedScreenName={connectedScreenName}
                />

                <MovieRow
                  title="Suspenso, Misterio & Terror Psicológico"
                  items={actionList}
                  onPlayLocal={handlePlayLocal}
                  onCastToScreen={handleCastMediaToScreen}
                  onOpenDetails={setSelectedMediaForDetails}
                  myListIds={myListIds}
                  onToggleMyList={toggleMyList}
                  connectedScreenName={connectedScreenName}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Collapsible Remote Control Drawer at bottom (Solo para dispositivo móvil / rol de control remoto) */}
      {deviceRole === 'remote' && (
        <RemoteControlDrawer
          playbackState={remotePlaybackState}
          currentMedia={remoteMediaItem}
          currentEpisode={remoteEpisodeItem}
          connectedScreenName={connectedScreenName}
          onSendCommand={sendRemoteCommand}
          onOpenAudioModal={() => setIsAudioModalOpen(true)}
          onOpenCastModal={() => setIsCastModalOpen(true)}
          onOpenGuestModal={() => setIsGuestModalOpen(true)}
        />
      )}

      {/* Detail Modal with Episodes */}
      {selectedMediaForDetails && (
        <DetailModal
          media={selectedMediaForDetails}
          onClose={() => setSelectedMediaForDetails(null)}
          onPlayLocal={handlePlayLocal}
          onCastToScreen={handleCastMediaToScreen}
          isMyList={myListIds.includes(selectedMediaForDetails.id)}
          onToggleMyList={() => toggleMyList(selectedMediaForDetails.id)}
          connectedScreenName={connectedScreenName}
          allCatalog={MEDIA_CATALOG}
          onSelectSimilar={setSelectedMediaForDetails}
        />
      )}

      {/* Audio FX & Equalizer Modal */}
      <AudioSettingsModal
        isOpen={isAudioModalOpen}
        onClose={() => setIsAudioModalOpen(false)}
        audioSettings={audioSettings}
        playbackSettings={playbackSettings}
        onUpdateAudio={(newAudio: Partial<AudioSettings>) => {
          setAudioSettings((prev) => ({ ...prev, ...newAudio }));
          sendRemoteCommand({
            action: 'setAudioSettings',
            payload: newAudio,
          });
        }}
        onUpdatePlayback={(newPlayback: Partial<PlaybackSettings>) => {
          setPlaybackSettings((prev) => ({ ...prev, ...newPlayback }));
          sendRemoteCommand({
            action: 'setPlaybackSettings',
            payload: newPlayback,
          });
        }}
      />

      {/* Devices, Pairing & Permanent Home Modal */}
      <CastModal
        isOpen={isCastModalOpen}
        onClose={() => setIsCastModalOpen(false)}
        devices={devices}
        currentDeviceId={deviceSync.getDeviceId()}
        currentRoomId={roomId}
        currentDeviceType={deviceRole}
        selectedScreenId={selectedScreenId}
        onSelectScreen={(screenId) => {
          setSelectedScreenId(screenId);
          setIsCastModalOpen(false);
        }}
        onChangeRoom={(newRoomId) => {
          deviceSync.setRoomId(newRoomId);
          setRoomId(newRoomId);
        }}
        onChangeDeviceType={(type) => {
          setDeviceRole(type);
          deviceSync.setDeviceType(type);
          if (type === 'screen') setIsScreenInStandby(true);
        }}
        onOpenDualSimulator={() => setIsDualSimulatorOpen(true)}
        isPermanentHome={isPermanentHomeLinked}
        onTogglePermanentHome={handleTogglePermanentHome}
      />

      {/* Guest Share QR Modal */}
      <GuestShareModal
        isOpen={isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        roomId={roomId}
        screenName={connectedScreenName}
      />

      {/* Live Dual Screen Simulator Modal */}
      <DualScreenSimulator
        isOpen={isDualSimulatorOpen}
        onClose={() => setIsDualSimulatorOpen(false)}
        playbackState={remotePlaybackState}
        currentMedia={remoteMediaItem}
        currentEpisode={remoteEpisodeItem}
        catalog={MEDIA_CATALOG}
        onSendCommand={sendRemoteCommand}
        onUpdateAudio={(audio) => setAudioSettings((prev) => ({ ...prev, ...audio }))}
        onUpdatePlayback={(pb) => setPlaybackSettings((prev) => ({ ...prev, ...pb }))}
        onOpenAudioModal={() => setIsAudioModalOpen(true)}
        onOpenCastModal={() => setIsCastModalOpen(true)}
        onPlayMedia={handlePlayLocal}
        onNextEpisode={handlePlayNextEpisode}
      />

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
    </div>
  );
}
