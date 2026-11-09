import React, { useState, useEffect } from 'react';
import { MediaItem, Episode, PlaybackState, RemoteCommand } from '../types';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  FastForward,
  ChevronRight,
  Volume2,
  VolumeX,
  Sliders,
  Moon,
  Mic,
  Disc,
  Tv,
  ChevronUp,
  ChevronDown,
  Power,
  Cast,
  Layers,
  Radio,
  Check,
  RefreshCw,
  Maximize2,
  Search,
  Music,
  Youtube,
  X,
  Loader2,
} from 'lucide-react';

interface RemoteControlSheetProps {
  playbackState: PlaybackState;
  currentMedia: MediaItem | null;
  currentEpisode: Episode | null;
  connectedScreenName: string;
  onSendCommand: (command: RemoteCommand) => void;
  onOpenAudioModal: () => void;
  onOpenCastModal: () => void;
  onOpenGuestModal?: () => void;
}

export const RemoteControlSheet: React.FC<RemoteControlSheetProps> = ({
  playbackState,
  currentMedia,
  currentEpisode,
  connectedScreenName,
  onSendCommand,
  onOpenAudioModal,
  onOpenCastModal,
  onOpenGuestModal,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [localPlaying, setLocalPlaying] = useState<boolean | null>(null);
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [lastSentLabel, setLastSentLabel] = useState<string | null>(null);

  // Estado del Buscador Rápido de Música / YouTube en el Celular
  const [mediaSearchTarget, setMediaSearchTarget] = useState<'spotify' | 'youtube' | null>(null);
  const [mediaQuery, setMediaQuery] = useState<string>('');
  const [mediaSearchResults, setMediaSearchResults] = useState<any[]>([]);
  const [isSearchingMedia, setIsSearchingMedia] = useState<boolean>(false);
  const [lastPlayedTrack, setLastPlayedTrack] = useState<string | null>(null);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const hub = p.get('hub');
      if (hub === 'spotify' || hub === 'youtube') {
        setMediaSearchTarget(hub);
        setIsExpanded(true);
      }
    } catch (_) {}
  }, []);

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
    triggerCommand(
      {
        action: 'playYouTube',
        payload: {
          videoId: item.videoId,
          title: item.title,
          author: item.channel,
          thumbnail: item.thumbnail,
          duration: item.duration,
          hub,
        },
      },
      `▶️ ${item.title}`
    );
  };

  const { isPlaying, currentTime, duration, audioSettings, isIntroActive, isStandby } = playbackState;

  const effectivePlaying = localPlaying !== null ? localPlaying : isPlaying;
  const effectiveVolume = localVolume !== null ? localVolume : audioSettings.volume;

  const effectiveMedia = playbackState?.mediaItem || currentMedia;
  const effectiveEpisode = playbackState?.episodeItem || currentEpisode;
  const rawTitle = playbackState?.mediaTitle || effectiveMedia?.title;

  const isEpisodic = Boolean(
    effectiveMedia &&
    (effectiveMedia.type === 'series' || effectiveMedia.category === 'series' || effectiveMedia.category === 'anime') &&
    effectiveMedia.category !== 'live_tv'
  );

  const currentTitle = rawTitle
    ? effectiveEpisode
      ? `${rawTitle} • ${effectiveEpisode.title || `T${effectiveEpisode.seasonNumber || 1}:E${effectiveEpisode.episodeNumber || 1}`}`
      : playbackState?.seasonNumber
      ? `${rawTitle} • T${playbackState.seasonNumber}:E${playbackState.episodeNumber || 1}`
      : rawTitle
    : 'Listo para reproducir en TV';

  const currentCover =
    effectiveEpisode?.thumbnailUrl ||
    playbackState?.mediaPoster ||
    effectiveMedia?.posterUrl ||
    effectiveMedia?.backdropUrl;

  const flashCommandFeedback = (label: string) => {
    setLastSentLabel(label);
    setTimeout(() => {
      setLastSentLabel((prev) => (prev === label ? null : prev));
    }, 1500);
  };

  const triggerCommand = (command: RemoteCommand, feedbackLabel: string) => {
    flashCommandFeedback(feedbackLabel);
    onSendCommand(command);
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    triggerCommand({ action: 'seek', payload: newTime }, `Saltar a ${formatTime(newTime)}`);
  };

  const handleVolumeChange = (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, newVol));
    setLocalVolume(clamped);
    onSendCommand({ action: 'setVolume', payload: clamped });
    setTimeout(() => setLocalVolume(null), 1500);
  };

  const handleRotateServer = () => {
    const serversList = (playbackState?.servers && playbackState.servers.length > 0)
      ? playbackState.servers
      : (effectiveMedia?.servers || []);
    if (serversList.length > 0) {
      const currentIdx = playbackState?.activeServerIndex ?? 0;
      const nextIdx = (currentIdx + 1) % serversList.length;
      triggerCommand(
        { action: 'changeServer', payload: { serverIndex: nextIdx, serverName: serversList[nextIdx].name } },
        `📡 Cambiando a ${serversList[nextIdx].name}`
      );
    } else {
      triggerCommand({ action: 'changeServer', payload: { serverIndex: 0 } }, '🔄 Rotando Servidor');
    }
  };

  const handlePresetChange = (preset: any, label: string) => {
    triggerCommand(
      {
        action: 'setAudioSettings',
        payload: { ...audioSettings, preset },
      },
      `Audio: ${label}`
    );
  };

  const handleTogglePlay = () => {
    const nextState = !effectivePlaying;
    setLocalPlaying(nextState);
    triggerCommand(
      { action: 'togglePlay' },
      nextState ? '▶ Reproduciendo en PC' : '⏸ Pausado en PC'
    );
    setTimeout(() => setLocalPlaying(null), 1800);
  };

  const handleSwitchHub = (hub: 'cinecast' | 'youtube' | 'spotify' | 'sports') => {
    const label = hub === 'cinecast' ? '🎬 Pelis/Series' : hub === 'youtube' ? '▶️ YouTube' : hub === 'spotify' ? '🎵 Spotify' : '⚽ Fútbol';
    triggerCommand({ action: 'switchHub', payload: { hub } }, label);
    if (hub === 'youtube' || hub === 'spotify') {
      setMediaSearchTarget(hub);
    } else {
      setMediaSearchTarget(null);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 border-t border-zinc-800 shadow-2xl backdrop-blur-xl transition-all duration-300">
      {/* Minimized / Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-2.5 flex items-center justify-between cursor-pointer border-b border-zinc-900/50 hover:bg-zinc-900/40 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            {currentCover ? (
              <img
                src={currentCover}
                alt="Carátula"
                onError={(e) => {
                  e.currentTarget.src = currentMedia?.backdropUrl || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300';
                }}
                className="w-10 h-10 rounded-lg object-cover border border-zinc-800 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400">
                <Tv className="w-5 h-5" />
              </div>
            )}
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-950/80 px-1.5 py-0.5 rounded border border-red-900/50">
                Control Remoto Activo
              </span>
              <span className="text-xs text-zinc-400 truncate flex items-center gap-1">
                <Tv className="w-3 h-3 text-emerald-400" />
                {connectedScreenName}
              </span>
            </div>
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {lastSentLabel ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> {lastSentLabel}
                </span>
              ) : (
                currentTitle
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePlay();
            }}
            className="p-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white transition shadow-md active:scale-90"
          >
            {effectivePlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 fill-current translate-x-0.5" />
            )}
          </button>

          <button className="p-1.5 text-zinc-400 hover:text-white rounded-lg">
            {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Expanded Handheld Remote View */}
      {isExpanded && (
        <div className="p-4 sm:p-5 max-w-xl mx-auto space-y-3.5 animate-fadeIn">
          {/* Barra fija de Cambio de Modo en Vivo */}
          <div className="grid grid-cols-4 gap-1.5 p-1 bg-zinc-900/90 border border-zinc-800 rounded-xl">
            {[
              { hub: 'cinecast' as const, label: '🎬 Pelis' },
              { hub: 'youtube' as const, label: '▶️ YouTube' },
              { hub: 'spotify' as const, label: '🎵 Spotify' },
              { hub: 'sports' as const, label: '⚽ Fútbol' },
            ].map((item) => (
              <button
                key={item.hub}
                type="button"
                onClick={() => handleSwitchHub(item.hub)}
                className={`py-1.5 px-1 rounded-lg text-white text-xs font-bold transition-all text-center border shadow active:scale-95 ${
                  mediaSearchTarget === item.hub
                    ? 'bg-red-600 border-red-500 shadow-red-900/40'
                    : 'bg-zinc-800/90 hover:bg-zinc-700 border-zinc-700/60'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Panel de Búsqueda Rápida de Música / YouTube en el Celular */}
          {mediaSearchTarget && (
            <div className="bg-zinc-950/95 border border-zinc-800 rounded-2xl p-3 space-y-2.5 animate-fadeIn shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white ${
                    mediaSearchTarget === 'spotify' ? 'bg-emerald-600' : 'bg-red-600'
                  }`}>
                    {mediaSearchTarget === 'spotify' ? <Music className="w-3.5 h-3.5" /> : <Youtube className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-xs font-bold text-white">
                    {mediaSearchTarget === 'spotify' ? '🎵 Buscador de Música (Spotify sin DRM)' : '▶️ Buscador de YouTube'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMediaSearchTarget(null)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white bg-zinc-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {lastPlayedTrack && (
                <div className="bg-emerald-950/80 border border-emerald-500/50 py-1.5 px-3 rounded-xl text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="truncate">Enviado a la pantalla: {lastPlayedTrack}</span>
                </div>
              )}

              {/* Input de búsqueda */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder={
                    mediaSearchTarget === 'spotify'
                      ? 'Buscar canción, artista o álbum...'
                      : 'Buscar video o canción en YouTube...'
                  }
                  value={mediaQuery}
                  onChange={(e) => setMediaQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-red-500"
                />
                {isSearchingMedia ? (
                  <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 animate-spin" />
                ) : mediaQuery ? (
                  <button
                    type="button"
                    onClick={() => setMediaQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Presets rápidos si no hay búsqueda */}
              {!mediaQuery && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    mediaSearchTarget === 'spotify' ? 'Cuarteto' : 'Noticias en Vivo',
                    mediaSearchTarget === 'spotify' ? 'Rock Nacional' : 'Resúmenes de Fútbol',
                    mediaSearchTarget === 'spotify' ? 'Top 50 Argentina' : 'Música en Vivo',
                    mediaSearchTarget === 'spotify' ? 'Lofi Hip Hop' : 'Tráilers de Películas',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMediaQuery(preset)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[11px] font-semibold border border-zinc-800 transition"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}

              {/* Resultados de búsqueda */}
              {mediaSearchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 divide-y divide-zinc-900">
                  {mediaSearchResults.slice(0, 10).map((res) => (
                    <div
                      key={res.videoId}
                      onClick={() => handlePlayRemoteTrack(res)}
                      className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-zinc-800/80 cursor-pointer transition group"
                    >
                      <img
                        src={res.thumbnail}
                        alt={res.title}
                        className="w-12 h-9 rounded object-cover shrink-0 bg-zinc-800"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate group-hover:text-red-400 transition">
                          {res.title}
                        </p>
                        <p className="text-[10px] text-zinc-400 truncate">
                          {res.channel} {res.duration ? `• ${res.duration}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="p-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white shrink-0 shadow"
                        title="Reproducir en PC"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick Bar: Despertar/Reposo + Probar Señal + Dispositivos */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-zinc-900">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  triggerCommand(
                    { action: isStandby ? 'wakeScreen' : 'setStandby' },
                    isStandby ? '⚡ Pantalla Activada' : '💤 Pantalla en Reposo'
                  )
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  isStandby
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{isStandby ? 'Despertar PC' : 'Reposo PC'}</span>
              </button>

              <button
                onClick={() =>
                  triggerCommand(
                    { action: 'wakeScreen', payload: { testSignal: true } },
                    '🔔 ¡Señal enviada a la PC!'
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-zinc-800 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Probar Señal</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={onOpenCastModal}
                className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold transition flex items-center gap-1"
              >
                <Cast className="w-3.5 h-3.5 text-red-500" />
                <span>Sala</span>
              </button>
              {onOpenGuestModal && (
                <button
                  onClick={onOpenGuestModal}
                  className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                >
                  <Layers className="w-3.5 h-3.5 text-rose-400" />
                  <span>QR</span>
                </button>
              )}
            </div>
          </div>

          {/* Scrubber Progress Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration || 120)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeekChange}
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-600"
            />
          </div>

          {/* TAREA 5: Botonera ergonómica fija (touch-action-manipulation select-none) */}
          <div className="space-y-2.5 touch-action-manipulation select-none">
            {/* 1. Fila principal de reproducción: Botón grande ⏪ -10s, Botón central gigante ⏯ Play / Pausa, Botón grande ⏩ +10s */}
            <div className="grid grid-cols-3 gap-3 items-center">
              <button
                onClick={() =>
                  triggerCommand({ action: 'seekRelative', payload: -10 }, '⏪ Retroceder 10s')
                }
                className="py-3.5 px-2 rounded-2xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 active:scale-95 text-zinc-200 hover:text-white transition flex items-center justify-center gap-1.5 shadow-lg font-bold text-sm"
                title="Retroceder 10s"
              >
                <RotateCcw className="w-5 h-5" />
                <span>-10s</span>
              </button>

              <button
                onClick={handleTogglePlay}
                className="py-4 px-3 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95 text-white transition shadow-xl shadow-red-900/50 flex items-center justify-center gap-2 border border-red-500 font-black text-base"
                title={effectivePlaying ? 'Pausa' : 'Reproducir'}
              >
                {effectivePlaying ? (
                  <Pause className="w-7 h-7 fill-white" />
                ) : (
                  <Play className="w-7 h-7 fill-white translate-x-0.5" />
                )}
                <span>{effectivePlaying ? 'Pausa' : 'Play'}</span>
              </button>

              <button
                onClick={() =>
                  triggerCommand({ action: 'seekRelative', payload: 10 }, '⏩ Adelantar 10s')
                }
                className="py-3.5 px-2 rounded-2xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 active:scale-95 text-zinc-200 hover:text-white transition flex items-center justify-center gap-1.5 shadow-lg font-bold text-sm"
                title="Adelantar 10s"
              >
                <span>+10s</span>
                <RotateCw className="w-5 h-5" />
              </button>
            </div>

            {/* 2. Fila dedicada de Volumen cómoda: 🔇 Mute, 🔉 Vol -10%, indicador central claro 🔊 {volume}%, 🔊 Vol +10% */}
            <div className="grid grid-cols-4 gap-2 items-center bg-zinc-900/80 p-2.5 rounded-2xl border border-zinc-800">
              <button
                onClick={() =>
                  triggerCommand({ action: 'toggleMute' }, '🔇 Silencio Alternado')
                }
                className={`py-2 px-1 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border ${
                  audioSettings.isMuted
                    ? 'bg-red-950/80 border-red-500 text-red-300'
                    : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
                }`}
              >
                {audioSettings.isMuted ? (
                  <VolumeX className="w-4 h-4 text-red-500" />
                ) : (
                  <Volume2 className="w-4 h-4 text-zinc-300" />
                )}
                <span>{audioSettings.isMuted ? 'Mute' : 'Silencio'}</span>
              </button>

              <button
                onClick={() => {
                  const nextV = Math.max(0, effectiveVolume - 10);
                  handleVolumeChange(nextV);
                  flashCommandFeedback(`🔉 Volumen: ${nextV}%`);
                }}
                className="py-2 px-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold active:scale-95 transition border border-zinc-700"
              >
                🔉 -10%
              </button>

              <div className="text-center font-mono text-xs sm:text-sm font-bold text-red-400">
                🔊 {audioSettings.isMuted ? '0%' : `${effectiveVolume}%`}
              </div>

              <button
                onClick={() => {
                  const nextV = Math.min(100, effectiveVolume + 10);
                  handleVolumeChange(nextV);
                  flashCommandFeedback(`🔊 Volumen: ${nextV}%`);
                }}
                className="py-2 px-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold active:scale-95 transition shadow border border-red-500"
              >
                🔊 +10%
              </button>
            </div>

            {/* 3. Fila de utilidades: Botón 🔄 Rotar Servidor, Botón ⛶ Pantalla, Botón 💬 Subtítulos ON/OFF, y (solo si es Serie o Anime) Botón ⏭️ Siguiente Cap */}
            <div className={`grid gap-2 ${isEpisodic ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <button
                onClick={handleRotateServer}
                className="py-2.5 px-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Rotar</span>
              </button>

              <button
                onClick={() => triggerCommand({ action: 'toggleFullscreen' }, '⛶ Pantalla Completa')}
                className="py-2.5 px-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 active:scale-95"
              >
                <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Pantalla</span>
              </button>

              <button
                onClick={() => triggerCommand({ action: 'toggleSubtitles' }, '💬 Subtítulos')}
                className={`py-2.5 px-1.5 border rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 active:scale-95 ${
                  playbackState?.subtitlesEnabled === false
                    ? 'bg-red-950/80 border-red-500 text-red-300'
                    : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200'
                }`}
                title="Activar / Desactivar Subtítulos"
              >
                <span>💬</span>
                <span className="truncate">{playbackState?.subtitlesEnabled === false ? 'Subs OFF' : 'Subs ON'}</span>
              </button>

              {isEpisodic && (
                <button
                  onClick={() => triggerCommand({ action: 'nextEpisode' }, '⏭ Siguiente Episodio')}
                  className="py-2.5 px-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 active:scale-95 shadow border border-red-500"
                >
                  <span>⏭️</span>
                  <span className="truncate">Sig. Cap</span>
                </button>
              )}
            </div>

            {/* Atajos extras: Saltar Intro, Modo Noche, EQ */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                onClick={() => triggerCommand({ action: 'skipIntro' }, '⏩ Intro Saltada')}
                className={`py-2 px-2 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1 active:scale-95 ${
                  isIntroActive
                    ? 'bg-red-600 text-white border-red-500 shadow animate-pulse'
                    : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                }`}
              >
                <FastForward className="w-3.5 h-3.5 text-amber-400" />
                <span>Saltar Intro</span>
              </button>

              <button
                onClick={() =>
                  triggerCommand({ action: 'setStandby', payload: true }, '💤 PC en Reposo')
                }
                className="py-2 px-2 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-semibold transition flex items-center justify-center gap-1 active:scale-95"
              >
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
                <span>Modo Noche</span>
              </button>

              <button
                onClick={onOpenAudioModal}
                className="py-2 px-2 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-800 text-red-400 hover:text-red-300 text-xs font-semibold transition flex items-center justify-center gap-1 active:scale-95"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Ecualizador</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
