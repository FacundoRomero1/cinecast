import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Maximize2,
  Sliders,
  Cast,
  Users,
  RefreshCw,
  Search,
  Music,
  Youtube,
  X,
  Tv,
  MousePointer,
  RotateCcw,
  List,
} from 'lucide-react';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { Episode, MediaItem, PlaybackState, RemoteCommand } from '../types';

interface RemoteControlDrawerProps {
  playbackState?: PlaybackState;
  currentMedia?: MediaItem | null;
  currentEpisode?: Episode | null;
  connectedScreenName?: string;
  onSendCommand?: (command: RemoteCommand) => void;
  onOpenAudioModal?: () => void;
  onOpenCastModal?: () => void;
  onOpenGuestModal?: () => void;
}

export const RemoteControlDrawer: React.FC<RemoteControlDrawerProps> = ({
  playbackState,
  currentMedia,
  currentEpisode,
  connectedScreenName = 'PC',
  onSendCommand,
  onOpenAudioModal,
  onOpenCastModal,
  onOpenGuestModal,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [controlMode, setControlMode] = useState<'player' | 'episodes' | 'trackpad' | 'dpad' | 'search'>('player');

  // Estado del Buscador Rápido de Música / YouTube en el Celular
  const [mediaSearchTarget, setMediaSearchTarget] = useState<'spotify' | 'youtube' | null>(null);
  const [mediaQuery, setMediaQuery] = useState<string>('');
  const [mediaSearchResults, setMediaSearchResults] = useState<any[]>([]);
  const [isSearchingMedia, setIsSearchingMedia] = useState<boolean>(false);
  const [lastPlayedTrack, setLastPlayedTrack] = useState<string | null>(null);

  // Modo Trackpad: Coordenadas táctiles relativas
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartTimeRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);

  // Escuchar si viene con parámetro hub de QR
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const hub = p.get('hub');
      if (hub === 'spotify' || hub === 'youtube') {
        setMediaSearchTarget(hub);
        setControlMode('search');
        setIsExpanded(true);
      }
    } catch (_) {}
  }, []);

  // Búsqueda en tiempo real conectada a /api/media-search
  useEffect(() => {
    const q = mediaQuery.trim();
    if (!q) {
      setMediaSearchResults([]);
      setIsSearchingMedia(false);
      return;
    }

    setIsSearchingMedia(true);
    const timer = setTimeout(async () => {
      try {
        let results: any[] = [];
        if (window.electronAPI?.searchMediaTracks) {
          results = await window.electronAPI.searchMediaTracks(q);
        } else {
          const res = await fetch(`/api/media-search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          results = data.results || [];
        }
        setMediaSearchResults(results || []);
      } catch (err) {
        console.warn('Error en búsqueda remota:', err);
      } finally {
        setIsSearchingMedia(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [mediaQuery]);

  const handlePlayRemoteTrack = (item: any) => {
    const hub = mediaSearchTarget || 'youtube';
    setLastPlayedTrack(item.title);
    setTimeout(() => setLastPlayedTrack(null), 3000);
    if (onSendCommand) {
      onSendCommand({
        action: 'playYouTube',
        payload: {
          videoId: item.videoId,
          title: item.title,
          author: item.channel,
          thumbnail: item.thumbnail,
          duration: item.duration,
          hub,
        },
      });
    }
  };

  const playerHook = useVideoPlayer();
  const isPlaying = playbackState ? playbackState.isPlaying : playerHook.isPlaying;
  const currentTime = playbackState ? playbackState.currentTime : playerHook.currentTime;
  const duration =
    playbackState && playbackState.duration > 0
      ? playbackState.duration
      : currentEpisode?.durationSeconds || playerHook.duration || 5400;
  const isMuted = playbackState
    ? playbackState.audioSettings?.isMuted
    : playerHook.isMuted;
  const volume = playbackState
    ? playbackState.audioSettings?.volume ?? 85
    : Math.round(playerHook.volume * 100);

  const currentDevice = connectedScreenName || 'PC';
  const effectiveMedia = playbackState?.mediaItem || currentMedia;
  const effectiveEpisode = playbackState?.episodeItem || currentEpisode;
  const rawTitle = playbackState?.mediaTitle || effectiveMedia?.title;
  const activeTitle = rawTitle
    ? effectiveEpisode
      ? `${rawTitle} • T${effectiveEpisode.seasonNumber || 1}:E${effectiveEpisode.episodeNumber || 1}`
      : playbackState?.seasonNumber
      ? `${rawTitle} • T${playbackState.seasonNumber}:E${playbackState.episodeNumber || 1}`
      : rawTitle
    : 'Listo para reproducir en TV';

  const effectivePoster =
    effectiveEpisode?.thumbnailUrl ||
    playbackState?.mediaPoster ||
    effectiveMedia?.posterUrl ||
    effectiveMedia?.backdropUrl;

  const isEpisodic = Boolean(
    effectiveMedia &&
    (effectiveMedia.type === 'series' || effectiveMedia.category === 'series' || effectiveMedia.category === 'anime') &&
    effectiveMedia.category !== 'live_tv'
  );

  const formatTime = (seconds: number) => {
    const safeSecs = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(safeSecs / 60);
    const secs = Math.floor(safeSecs % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleTogglePlay = () => onSendCommand ? onSendCommand({ action: 'togglePlay' }) : playerHook.togglePlay();
  const handleSkipBack = () => onSendCommand ? onSendCommand({ action: 'seekRelative', payload: -10 }) : playerHook.seek(Math.max(0, currentTime - 10));
  const handleSkipForward = () => onSendCommand ? onSendCommand({ action: 'seekRelative', payload: 10 }) : playerHook.seek(Math.min(duration, currentTime + 10));
  const handleSeek = (newTime: number) => onSendCommand ? onSendCommand({ action: 'seek', payload: newTime }) : playerHook.seek(newTime);
  const handleToggleMute = () => onSendCommand ? onSendCommand({ action: 'toggleMute' }) : playerHook.toggleMute();

  const handleVolumeDelta = (delta: number) => {
    const nextV = Math.max(0, Math.min(100, volume + delta));
    if (onSendCommand) {
      onSendCommand({ action: 'setVolume', payload: nextV });
    } else {
      playerHook.changeVolume(nextV / 100);
    }
  };

  const handleRotateServer = () => {
    const displayServers = (playbackState?.servers && playbackState.servers.length > 0)
      ? playbackState.servers
      : (effectiveMedia?.servers || []);
    if (displayServers.length > 0 && onSendCommand) {
      const currentIdx = playbackState?.activeServerIndex ?? 0;
      const nextIdx = (currentIdx + 1) % displayServers.length;
      onSendCommand({
        action: 'changeServer',
        payload: { serverIndex: nextIdx, serverName: displayServers[nextIdx].name },
      });
    }
  };

  const handlePrevEpisode = () => onSendCommand?.({ action: 'prevEpisode' });
  const handleNextEpisode = () => onSendCommand?.({ action: 'nextEpisode' });
  const handleToggleSubtitles = () => onSendCommand?.({ action: 'toggleSubtitles' });
  const handleToggleFullscreen = () => onSendCommand ? onSendCommand({ action: 'toggleFullscreen' }) : playerHook.toggleFullscreen();

  // Gestión de episodios por temporada
  const playbackMeta = playbackState?.playbackMeta;
  const currentSeason = playbackMeta?.currentSeason ?? playbackState?.seasonNumber ?? 1;
  const [selectedSeasonTab, setSelectedSeasonTab] = useState<number>(currentSeason);

  useEffect(() => {
    if (playbackMeta?.currentSeason) {
      setSelectedSeasonTab(playbackMeta.currentSeason);
    }
  }, [playbackMeta?.currentSeason]);

  const episodesList = playbackMeta?.episodes || (effectiveMedia?.episodes ? effectiveMedia.episodes.map(e => ({
    season: (e as any).season || e.seasonNumber || 1,
    episode: e.episodeNumber ?? (e as any).episode ?? 1,
    title: e.title || `Capítulo ${e.episodeNumber ?? (e as any).episode ?? 1}`,
    duration: e.duration || '24m',
  })) : []);

  const totalSeasons = playbackMeta?.totalSeasons || effectiveMedia?.seasonsCount || 1;
  const filteredEpisodes = episodesList.filter((e) => e.season === selectedSeasonTab);

  // Eventos de Trackpad
  const handleTrackpadTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchStartTimeRef.current = Date.now();
      hasMovedRef.current = false;
    }
  };

  const handleTrackpadTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && lastTouchPosRef.current) {
      const dx = e.touches[0].clientX - lastTouchPosRef.current.x;
      const dy = e.touches[0].clientY - lastTouchPosRef.current.y;
      if (Math.abs(dx) > 0.8 || Math.abs(dy) > 0.8) {
        hasMovedRef.current = true;
        onSendCommand?.({ action: 'trackpadMove', payload: { type: 'move', dx, dy } });
        lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    } else if (e.touches.length === 2 && lastTouchPosRef.current) {
      const dy = e.touches[0].clientY - lastTouchPosRef.current.y;
      if (Math.abs(dy) > 2) {
        onSendCommand?.({ action: 'trackpadScroll', payload: { type: 'scroll', dy: -dy } });
        lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }
  };

  const handleTrackpadTouchEnd = () => {
    const elapsed = Date.now() - touchStartTimeRef.current;
    if (!hasMovedRef.current && elapsed < 250) {
      onSendCommand?.({ action: 'trackpadClick', payload: { type: 'click', button: 'left' } });
    }
    lastTouchPosRef.current = null;
  };

  const sendKey = (action: RemoteCommand['action']) => {
    onSendCommand?.({ action });
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-out ${
        isExpanded ? 'translate-y-0' : 'translate-y-[calc(100%-60px)]'
      }`}
    >
      {/* Handle colapsado (siempre visible, 60px) */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full h-[60px] bg-gray-900/95 backdrop-blur border-t border-gray-700 flex items-center justify-between px-4 sm:px-8 text-white hover:bg-gray-800 transition-colors rounded-t-2xl shadow-2xl"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shrink-0" />
          <span className="text-xs sm:text-sm font-medium truncate">
            {isExpanded
              ? 'Ocultar Control Remoto'
              : `Control Remoto Activo • ${currentDevice} — ${activeTitle}`}
          </span>
        </div>

        <div className="hidden sm:flex w-12 h-1 bg-gray-500 rounded-full shrink-0 mx-4" />

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400 hidden md:inline">
            {isExpanded ? 'Cerrar' : 'Expandir'}
          </span>
          {isExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </div>
      </button>

      {/* Panel expandido */}
      <div className="bg-gray-900/95 backdrop-blur border-t border-gray-800 p-4 max-h-[75vh] overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Barra fija de Selección de Modo de Control */}
          <div className="grid grid-cols-4 gap-1.5 p-1 bg-gray-950/90 border border-gray-800 rounded-xl">
            {[
              { id: 'player' as const, label: '🎬 Player', icon: Play },
              { id: 'episodes' as const, label: '📑 Capítulos', icon: List },
              { id: 'trackpad' as const, label: '🖱️ Mouse', icon: MousePointer },
              { id: 'dpad' as const, label: '📺 Cruzeta', icon: Tv },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setControlMode(tab.id);
                    setMediaSearchTarget(null);
                  }}
                  className={`min-h-[44px] py-1.5 px-1 rounded-lg text-white text-xs font-bold transition-all text-center border shadow active:scale-95 flex items-center justify-center gap-1 ${
                    controlMode === tab.id && !mediaSearchTarget
                      ? 'bg-red-600 border-red-500 shadow-red-900/40'
                      : 'bg-gray-800/90 hover:bg-gray-700 border-gray-700/60'
                  }`}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* VISTA 1: REPRODUCTOR TRADICIONAL */}
          {controlMode === 'player' && !mediaSearchTarget && (
            <div className="space-y-3">
              {/* Header con título y poster */}
              <div className="flex items-center justify-between p-2.5 bg-gray-950/80 border border-gray-800 rounded-xl gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {effectivePoster ? (
                    <img
                      src={effectivePoster}
                      alt={activeTitle}
                      onError={(e) => {
                        e.currentTarget.src = currentMedia?.backdropUrl || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300';
                      }}
                      className="w-14 h-10 object-cover bg-gray-800 rounded shrink-0 border border-gray-700"
                    />
                  ) : (
                    <div className="w-14 h-10 bg-gray-800 rounded flex items-center justify-center text-xl shrink-0">
                      🎬
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate text-sm sm:text-base">{activeTitle}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-green-500 text-xs font-semibold">
                        LIVE • {isPlaying ? `Reproduciendo en ${currentDevice}` : `En pausa en ${currentDevice}`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onOpenAudioModal && (
                    <button
                      type="button"
                      onClick={onOpenAudioModal}
                      title="Audio"
                      className="min-h-[44px] min-w-[44px] rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors flex items-center justify-center"
                    >
                      <Sliders size={18} />
                    </button>
                  )}
                  {onOpenCastModal && (
                    <button
                      type="button"
                      onClick={onOpenCastModal}
                      title="Vincular"
                      className="min-h-[44px] min-w-[44px] rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors flex items-center justify-center"
                    >
                      <Cast size={18} />
                    </button>
                  )}
                </div>
              </div>

              {/* Selector de Servidor Remoto */}
              {(() => {
                const serversList = (playbackState?.servers && playbackState.servers.length > 0)
                  ? playbackState.servers
                  : (currentMedia?.servers || []);

                if (serversList.length <= 1) return null;

                return (
                  <div className="p-2 rounded-xl bg-gray-950/80 border border-gray-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 shrink-0">
                      📡 Servidores:
                    </span>
                    <div className="flex items-center gap-1.5 flex-nowrap">
                      {serversList.map((srv, idx) => {
                        const isCurrent =
                          (playbackState?.activeServerIndex ?? 0) === idx ||
                          playbackState?.activeServerName?.toLowerCase() === srv.name.toLowerCase();

                        return (
                          <button
                            key={`${srv.name}-${idx}`}
                            type="button"
                            onClick={() => {
                              onSendCommand?.({
                                action: 'changeServer',
                                payload: { serverIndex: idx, serverName: srv.name },
                              });
                            }}
                            className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                              isCurrent
                                ? 'bg-red-600 text-white border-red-500 shadow-md'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white'
                            }`}
                          >
                            <span>{srv.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Barra de progreso */}
              <div>
                <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div
                  className="h-2.5 bg-gray-700 rounded-full cursor-pointer overflow-hidden"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    handleSeek(percent * duration);
                  }}
                >
                  <div
                    className="h-full bg-red-600 rounded-full transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* BOTONERA PRINCIPAL CON ÁREA TÁCTIL MÍNIMA 44PX */}
              <div className="space-y-2.5 touch-action-manipulation select-none pt-1">
                {/* 1. Fila de transporte con Capítulo Anterior y Siguiente */}
                <div className="grid grid-cols-5 gap-2 items-center">
                  <button
                    type="button"
                    onClick={handlePrevEpisode}
                    title="Capítulo Anterior"
                    className="min-h-[48px] px-1 rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold text-xs transition-all border border-zinc-700 shadow flex flex-col items-center justify-center gap-0.5"
                  >
                    <span className="text-base">⏮️</span>
                    <span className="text-[10px]">Ant</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSkipBack}
                    title="Retroceder 10s"
                    className="min-h-[48px] px-1 rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold text-xs transition-all border border-zinc-700 shadow flex flex-col items-center justify-center gap-0.5"
                  >
                    <SkipBack size={18} />
                    <span className="text-[10px]">-10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    title={isPlaying ? 'Pausar' : 'Reproducir'}
                    className="min-h-[52px] px-2 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-sm transition-all shadow-xl shadow-red-950/60 border border-red-500 flex flex-col items-center justify-center gap-0.5"
                  >
                    {isPlaying ? <Pause size={22} fill="white" /> : <Play size={22} fill="white" />}
                    <span className="text-[11px] uppercase tracking-wider">{isPlaying ? 'Pausa' : 'Play'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSkipForward}
                    title="Adelantar 10s"
                    className="min-h-[48px] px-1 rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold text-xs transition-all border border-zinc-700 shadow flex flex-col items-center justify-center gap-0.5"
                  >
                    <SkipForward size={18} />
                    <span className="text-[10px]">+10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleNextEpisode}
                    title="Capítulo Siguiente"
                    className="min-h-[48px] px-1 rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold text-xs transition-all border border-zinc-700 shadow flex flex-col items-center justify-center gap-0.5"
                  >
                    <span className="text-base">⏭️</span>
                    <span className="text-[10px]">Sig</span>
                  </button>
                </div>

                {/* 2. Control de Volumen Ergonómico (Mín 44px) */}
                <div className="grid grid-cols-4 gap-2 items-center bg-zinc-950/70 p-2 rounded-2xl border border-zinc-800/80">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    className={`min-h-[44px] px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border ${
                      isMuted
                        ? 'bg-red-950/80 border-red-500 text-red-300'
                        : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
                    }`}
                  >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    <span>{isMuted ? 'Mute' : 'Silencio'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleVolumeDelta(-10)}
                    className="min-h-[44px] px-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 text-xs font-bold transition border border-zinc-700 flex items-center justify-center"
                  >
                    🔉 -10%
                  </button>

                  <div className="min-h-[44px] flex items-center justify-center font-mono text-sm font-bold text-red-400">
                    🔊 {isMuted ? '0%' : `${volume}%`}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleVolumeDelta(10)}
                    className="min-h-[44px] px-2 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white text-xs font-bold transition shadow border border-red-500 flex items-center justify-center"
                  >
                    🔊 +10%
                  </button>
                </div>

                {/* 3. Utilidades: Rotar Servidor, Subtítulos, Pantalla Completa */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handleRotateServer}
                    className="min-h-[44px] py-2 px-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 rounded-xl text-white text-xs font-bold transition flex items-center justify-center gap-1.5 border border-zinc-700"
                  >
                    <RefreshCw size={16} className="text-amber-400" />
                    <span>Rotar Espejo</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="min-h-[44px] py-2 px-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 rounded-xl text-white text-xs font-bold transition flex items-center justify-center gap-1.5 border border-zinc-700"
                  >
                    <Maximize2 size={16} />
                    <span>Pantalla</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleSubtitles}
                    className={`min-h-[44px] py-2 px-2 active:scale-95 rounded-xl text-white text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                      playbackState?.subtitlesEnabled === false
                        ? 'bg-red-950/80 border-red-500 text-red-300'
                        : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700'
                    }`}
                  >
                    <span>💬</span>
                    <span>{playbackState?.subtitlesEnabled === false ? 'Subs OFF' : 'Subs ON'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VISTA 2: SELECTOR Y LISTADO DE CAPÍTULOS */}
          {controlMode === 'episodes' && (
            <div className="space-y-3 p-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                  📑 Lista de Capítulos:
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onSendCommand?.({
                        action: 'randomEpisode',
                        payload: {
                          mediaId: currentMedia?.id || playbackState?.mediaId,
                        },
                      });
                    }}
                    className="py-1 px-2.5 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 shadow border border-amber-400/50"
                    title="Reproducir capítulo aleatorio en PC"
                  >
                    <span>🎲</span>
                    <span>Random</span>
                  </button>
                  {totalSeasons > 1 && (
                    <select
                      value={selectedSeasonTab}
                      onChange={(e) => setSelectedSeasonTab(Number(e.target.value))}
                      className="bg-zinc-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg border border-zinc-700"
                    >
                      {Array.from({ length: totalSeasons }, (_, i) => i + 1).map((s) => (
                        <option key={s} value={s}>
                          T{s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="max-h-[40vh] overflow-y-auto space-y-1.5 pr-1">
                {filteredEpisodes.length > 0 ? (
                  filteredEpisodes.map((ep) => {
                    const isCurrent =
                      (playbackState?.seasonNumber ?? 1) === ep.season &&
                      (playbackState?.episodeNumber ?? 1) === ep.episode;

                    return (
                      <button
                        key={`${ep.season}-${ep.episode}`}
                        type="button"
                        onClick={() => {
                          onSendCommand?.({
                            action: 'jumpToEpisode',
                            payload: { season: ep.season, episode: ep.episode },
                          });
                        }}
                        className={`min-h-[46px] w-full p-2.5 rounded-xl text-left text-xs font-medium transition-all flex items-center justify-between border ${
                          isCurrent
                            ? 'bg-red-600 text-white border-red-500 shadow-md font-bold'
                            : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${isCurrent ? 'bg-black/30' : 'bg-zinc-800'}`}>
                            E{ep.episode}
                          </span>
                          <span className="truncate">{ep.title}</span>
                        </div>
                        {ep.duration && (
                          <span className={`text-[11px] shrink-0 ml-2 font-mono ${isCurrent ? 'text-amber-200' : 'text-zinc-500'}`}>
                            {ep.duration}
                          </span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-zinc-500 text-xs">
                    Cargando listado de episodios desde la pantalla...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VISTA 3: MODO TRACKPAD (CRÍTICO PARA CAPTCHAS Y TV) */}
          {controlMode === 'trackpad' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-bold text-red-400 flex items-center gap-1">
                  <MousePointer size={14} /> Modo Trackpad
                </span>
                <span>Desliza para mover • Toca para clic</span>
              </div>

              {/* Superficie táctil */}
              <div
                onTouchStart={handleTrackpadTouchStart}
                onTouchMove={handleTrackpadTouchMove}
                onTouchEnd={handleTrackpadTouchEnd}
                className="w-full h-44 bg-zinc-950 rounded-2xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center select-none touch-none active:border-red-500/80 shadow-inner"
              >
                <div className="w-12 h-12 rounded-full bg-zinc-900/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400 mb-2">
                  <MousePointer size={20} />
                </div>
                <p className="text-zinc-400 text-xs font-medium">Área táctil de alta precisión</p>
                <p className="text-zinc-600 text-[10px] mt-0.5">Usa dos dedos para hacer scroll</p>
              </div>

              {/* Botones físicos de clic */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSendCommand?.({ action: 'trackpadClick', payload: { type: 'click', button: 'left' } })}
                  className="min-h-[48px] py-3 rounded-xl bg-zinc-800 active:bg-zinc-700 active:scale-95 text-white font-bold text-sm border border-zinc-700 shadow"
                >
                  Clic Izquierdo
                </button>
                <button
                  type="button"
                  onClick={() => onSendCommand?.({ action: 'trackpadClick', payload: { type: 'click', button: 'right' } })}
                  className="min-h-[48px] py-3 rounded-xl bg-zinc-800 active:bg-zinc-700 active:scale-95 text-white font-bold text-sm border border-zinc-700 shadow"
                >
                  Clic Derecho
                </button>
              </div>
            </div>
          )}

          {/* VISTA 4: CRUCETA D-PAD DE NAVEGACIÓN TV */}
          {controlMode === 'dpad' && (
            <div className="space-y-3 py-1 flex flex-col items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                📺 Navegación Smart TV:
              </span>

              {/* Cruzeta D-Pad */}
              <div className="relative w-48 h-48 bg-zinc-950 rounded-full border border-zinc-800 p-2 shadow-2xl flex items-center justify-center">
                {/* Arriba */}
                <button
                  type="button"
                  onClick={() => sendKey('navigateUp')}
                  className="absolute top-1 left-1/2 -translate-x-1/2 min-h-[44px] min-w-[48px] rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-90 text-white font-black flex items-center justify-center border border-zinc-700 shadow"
                >
                  ▲
                </button>

                {/* Izquierda */}
                <button
                  type="button"
                  onClick={() => sendKey('navigateLeft')}
                  className="absolute left-1 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-90 text-white font-black flex items-center justify-center border border-zinc-700 shadow"
                >
                  ◀
                </button>

                {/* Centro OK / Enter */}
                <button
                  type="button"
                  onClick={() => sendKey('select')}
                  className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-90 text-white font-black text-sm flex items-center justify-center shadow-lg shadow-red-950 border border-red-500"
                >
                  OK
                </button>

                {/* Derecha */}
                <button
                  type="button"
                  onClick={() => sendKey('navigateRight')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-90 text-white font-black flex items-center justify-center border border-zinc-700 shadow"
                >
                  ▶
                </button>

                {/* Abajo */}
                <button
                  type="button"
                  onClick={() => sendKey('navigateDown')}
                  className="absolute bottom-1 left-1/2 -translate-x-1/2 min-h-[44px] min-w-[48px] rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-90 text-white font-black flex items-center justify-center border border-zinc-700 shadow"
                >
                  ▼
                </button>
              </div>

              {/* Botones de acción auxiliares */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => sendKey('back')}
                  className="min-h-[44px] py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-300 font-bold text-xs border border-zinc-700 shadow"
                >
                  ↩️ Volver / Atrás
                </button>
                <button
                  type="button"
                  onClick={() => onSendCommand?.({ action: 'togglePlay' })}
                  className="min-h-[44px] py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-300 font-bold text-xs border border-zinc-700 shadow"
                >
                  ⏯️ Espacio / Play
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
