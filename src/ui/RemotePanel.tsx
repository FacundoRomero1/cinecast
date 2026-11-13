import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Cast,
  ChevronDown,
  ChevronUp,
  Film,
  Gamepad2,
  HelpCircle,
  ListVideo,
  Maximize2,
  Moon,
  MousePointer,
  Music,
  Pause,
  Play,
  Power,
  QrCode,
  Radio,
  RotateCcw,
  RotateCw,
  Server,
  SkipBack,
  SkipForward,
  FastForward,
  Sliders,
  Subtitles,
  Trophy,
  Tv,
  Volume2,
  VolumeX,
  Wifi,
  Youtube,
  Clock,
} from 'lucide-react';
import type { Episode, MediaItem, PlaybackState, RemoteCommand } from '../types';
import { createStyledPosterFallback } from '../utils/imageUtils';
import { deviceSync } from '../services/deviceSync';
import { Switch } from './Switch';
import { generateServersForMedia } from '../services/embedService';
import { PadSection } from './PadSection';

export interface RemotePanelProps {
  playbackState?: PlaybackState | null;
  currentMedia?: MediaItem | null;
  currentEpisode?: Episode | null;
  connectedScreenName?: string;
  isScreenReconnecting?: boolean;
  onSendCommand: (command: RemoteCommand) => void;
  onOpenCastModal: () => void;
  onOpenAudioModal?: () => void;
  onOpenGuestModal?: () => void;
  onNavigateToCatalog?: () => void;
  onOpenBigPad?: (mode?: 'pad' | 'cruceta') => void;
}

function formatTime(seconds: number = 0): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const RemotePanel: React.FC<RemotePanelProps> = ({
  playbackState,
  currentMedia,
  currentEpisode,
  connectedScreenName,
  isScreenReconnecting = false,
  onSendCommand,
  onOpenCastModal,
  onOpenAudioModal,
  onOpenGuestModal,
  onNavigateToCatalog,
  onOpenBigPad,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isChaptersOpen, setIsChaptersOpen] = useState(false);
  const [isServersOpen, setIsServersOpen] = useState(false);
  const [pingSuccess, setPingSuccess] = useState(false);
  const [isAudioSheetOpen, setIsAudioSheetOpen] = useState(false);
  const [showFineTuning, setShowFineTuning] = useState(false);

  const [audioOpts, setAudioOpts] = useState<{
    volume: number;
    preset: 'dialogos' | 'nocturno' | 'estandar';
    bassDb: number;
    midDb: number;
    trebleDb: number;
    compressorEnabled: boolean;
  }>({
    volume: playbackState?.audioSettings?.volume ?? 100,
    preset: 'estandar',
    bassDb: playbackState?.audioSettings?.bassGain ?? 0,
    midDb: playbackState?.audioSettings?.midGain ?? 0,
    trebleDb: playbackState?.audioSettings?.trebleGain ?? 0,
    compressorEnabled: false,
  });

  const handleUpdateAudioOpts = (changes: Partial<typeof audioOpts>) => {
    const updated = { ...audioOpts, ...changes };
    if (changes.preset === 'dialogos') {
      updated.bassDb = -6;
      updated.midDb = 6;
      updated.trebleDb = 2;
      updated.compressorEnabled = true;
    } else if (changes.preset === 'nocturno') {
      updated.bassDb = -4;
      updated.midDb = 3;
      updated.trebleDb = 0;
      updated.compressorEnabled = true;
    } else if (changes.preset === 'estandar') {
      updated.bassDb = 0;
      updated.midDb = 0;
      updated.trebleDb = 0;
      updated.compressorEnabled = false;
    }
    setAudioOpts(updated);
    onSendCommand({
      action: 'setAudioSettings',
      payload: {
        volume: updated.volume,
        preset: updated.preset,
        bassGain: updated.bassDb,
        midGain: updated.midDb,
        trebleGain: updated.trebleDb,
        compressorEnabled: updated.compressorEnabled,
      },
    });
  };

  const handleResetAudioOpts = () => {
    const resetValues = {
      volume: 100,
      preset: 'estandar' as const,
      bassDb: 0,
      midDb: 0,
      trebleDb: 0,
      compressorEnabled: false,
    };
    setAudioOpts(resetValues);
    onSendCommand({
      action: 'setAudioSettings',
      payload: {
        volume: 100,
        preset: 'estandar',
        bassGain: 0,
        midGain: 0,
        trebleGain: 0,
        compressorEnabled: false,
      },
    });
  };

  const isConnected = Boolean(
    connectedScreenName &&
    connectedScreenName.trim() !== '' &&
    connectedScreenName !== 'Sin pantalla' &&
    connectedScreenName !== 'Ninguna'
  );

  const [connStatus, setConnStatus] = useState<{
    state: 'connected' | 'reconnecting' | 'disconnected';
    latencyMs: number;
  }>({
    state: isConnected ? 'connected' : 'disconnected',
    latencyMs: 0,
  });

  const [lastCommandFeedback, setLastCommandFeedback] = useState<{
    status: 'confirmed' | 'failed' | 'retrying';
    message?: string;
  } | null>(null);

  useEffect(() => {
    const unsubConn = deviceSync.onConnectionStatus((info) => {
      setConnStatus({
        state: info.state,
        latencyMs: info.latencyMs,
      });
    });

    const unsubCmd = deviceSync.onCommandStatus((info) => {
      setLastCommandFeedback({
        status: info.status,
        message: info.status === 'failed' ? (info.reason || 'No llegó. Reintentá') : undefined,
      });
      if (info.status === 'confirmed') {
        const timer = setTimeout(() => {
          setLastCommandFeedback((prev) => (prev?.status === 'confirmed' ? null : prev));
        }, 2000);
        return () => clearTimeout(timer);
      }
    });

    return () => {
      unsubConn();
      unsubCmd();
    };
  }, []);

  const activeHub = (playbackState as any)?.activeHub || 'cinecast';
  const isStandby = Boolean(playbackState?.isStandby);
  const isPlaying = Boolean(playbackState?.isPlaying);

  const isYouTube = activeHub === 'youtube';
  const isSpotify = activeHub === 'spotify';

  // Pad y Cruceta plegados por defecto (null) según especificación
  const [padMode, setPadMode] = useState<'touchpad' | 'cruceta' | null>(null);

  const title =
    playbackState?.mediaTitle ||
    currentMedia?.title ||
    (playbackState as any)?.title ||
    '';

  const posterUrl =
    playbackState?.mediaPoster ||
    currentMedia?.posterUrl ||
    currentMedia?.backdropUrl ||
    '';

  const seasonNum = playbackState?.seasonNumber || currentEpisode?.seasonNumber;
  const episodeNum = playbackState?.episodeNumber || currentEpisode?.episodeNumber;
  const episodeTitle = playbackState?.episodeTitle || currentEpisode?.title;

  const currentTime = playbackState?.currentTime || 0;
  const duration = playbackState?.duration || 0;

  // Estados de barra de tiempo deslizable (role="slider")
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [lastSeekReleasedAt, setLastSeekReleasedAt] = useState(0);
  const [lastSeekTime, setLastSeekTime] = useState(0);
  const sliderTrackRef = useRef<HTMLDivElement>(null);

  const rawDuration = playbackState?.duration ?? duration;
  const isDurationValid = typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0;
  const effectiveDuration = isDurationValid ? rawDuration : 0;

  // Mientras se arrastra y durante 1.2s después de soltar, se ignoran los estados entrantes para evitar rebote
  const nowTs = Date.now();
  const isIgnoringSliderUpdates = isDraggingSlider || (nowTs - lastSeekReleasedAt < 1200);
  const displayTime = isDraggingSlider
    ? dragTime
    : (isIgnoringSliderUpdates ? lastSeekTime : currentTime);

  const displayPercent = effectiveDuration > 0
    ? Math.min(100, Math.max(0, (displayTime / effectiveDuration) * 100))
    : 0;

  const getTimeFromPointer = (clientX: number): number => {
    if (!sliderTrackRef.current || !isDurationValid) return 0;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * effectiveDuration);
  };

  const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDurationValid || playbackState?.seekUnsupported) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}
    setIsDraggingSlider(true);
    const t = getTimeFromPointer(e.clientX);
    setDragTime(t);
  };

  const handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSlider || !isDurationValid) return;
    const t = getTimeFromPointer(e.clientX);
    setDragTime(t);
  };

  const handleSliderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSlider) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
    setIsDraggingSlider(false);
    const target = getTimeFromPointer(e.clientX);
    setLastSeekReleasedAt(Date.now());
    setLastSeekTime(target);
    onSendCommand({ action: 'seek', payload: target });
  };

  const handleSliderPointerCancel = () => {
    if (!isDraggingSlider) return;
    setIsDraggingSlider(false);
    setLastSeekReleasedAt(Date.now());
  };

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDurationValid || playbackState?.seekUnsupported) return;
    if (Date.now() - lastSeekReleasedAt < 200) return;
    const target = getTimeFromPointer(e.clientX);
    setLastSeekReleasedAt(Date.now());
    setLastSeekTime(target);
    onSendCommand({ action: 'seek', payload: target });
  };

  const currentVolume = playbackState?.audioSettings?.volume ?? 100;
  const isMuted = playbackState?.audioSettings?.isMuted ?? false;
  const subsEnabled = playbackState?.subtitlesEnabled ?? false;

  const serversList = playbackState?.servers || currentMedia?.servers || [];
  const activeServerIdx = playbackState?.activeServerIndex ?? 0;
  const serversExhausted = Boolean(playbackState?.serversExhausted);

  // Detección de contenido episódico y TMDB ID
  const rawId = playbackState?.mediaId || currentMedia?.id || '';
  const tmdbId =
    currentMedia?.tmdbId ||
    playbackState?.mediaItem?.tmdbId ||
    (typeof rawId === 'string' && /^\d+$/.test(rawId)
      ? Number(rawId)
      : typeof rawId === 'string' && rawId.includes('-')
      ? Number(rawId.split('-').pop()) || 0
      : 0);

  const fallbackServers = useMemo(() => {
    if (serversList.length > 0) return serversList;
    if (tmdbId > 0) {
      return generateServersForMedia({
        tmdbId,
        type:
          currentMedia?.type === 'series' ||
          (currentMedia?.type as any) === 'anime' ||
          currentMedia?.category === 'anime' ||
          currentMedia?.category === 'series'
            ? 'series'
            : 'movie',
        season: seasonNum || 1,
        episode: episodeNum || 1,
      }).map((s) => ({ name: s.name, language: s.language }));
    }
    return [];
  }, [serversList, tmdbId, currentMedia?.type, currentMedia?.category, seasonNum, episodeNum]);

  const effectiveServersList = serversList.length > 0 ? serversList : fallbackServers;

  const isEpisodic = Boolean(
    seasonNum ||
    currentEpisode?.seasonNumber ||
    currentMedia?.type === 'series' ||
    (currentMedia?.type as any) === 'anime' ||
    currentMedia?.category === 'series' ||
    currentMedia?.category === 'anime' ||
    (currentMedia?.seasons && currentMedia.seasons.length > 0) ||
    (currentMedia?.episodes && currentMedia.episodes.length > 0) ||
    (playbackState?.playbackMeta && (playbackState.playbackMeta.totalSeasons ?? 0) > 0)
  );

  const [seasons, setSeasons] = useState<Array<{ seasonNumber: number; name: string }>>(() => {
    if (currentMedia?.seasons && currentMedia.seasons.length > 0) {
      return currentMedia.seasons.map((s) => ({
        seasonNumber: s.seasonNumber,
        name: s.title || `Temporada ${s.seasonNumber}`,
      }));
    }
    const total = playbackState?.playbackMeta?.totalSeasons;
    if (total && total > 0) {
      return Array.from({ length: total }, (_, i) => ({
        seasonNumber: i + 1,
        name: `Temporada ${i + 1}`,
      }));
    }
    return [];
  });

  const [selectedSeason, setSelectedSeason] = useState<number>(seasonNum || 1);
  const [episodes, setEpisodes] = useState<
    Array<{ season: number; episode: number; title: string; duration?: string }>
  >([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState<boolean>(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const episodesCacheRef = useRef<
    Record<number, Array<{ season: number; episode: number; title: string; duration?: string }>>
  >({});

  // Sincronizar selectedSeason cuando cambie la temporada en reproducción
  useEffect(() => {
    if (seasonNum && seasonNum > 0) {
      setSelectedSeason(seasonNum);
    }
  }, [seasonNum]);

  // Cargar temporadas si no vinieron en props
  useEffect(() => {
    if (!isEpisodic || !tmdbId) return;
    if (seasons.length > 0) return;

    let cancelled = false;
    const loadSeasons = async () => {
      try {
        const base = deviceSync.getApiBase();
        const res = await fetch(`${base}/api/tv/${tmdbId}`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
          setSeasons(
            data.seasons.map((s: any) => ({
              seasonNumber: Number(s.seasonNumber || 1),
              name: String(s.name || `Temporada ${s.seasonNumber || 1}`),
            }))
          );
        } else if (typeof data.numberOfSeasons === 'number' && data.numberOfSeasons > 0) {
          setSeasons(
            Array.from({ length: data.numberOfSeasons }, (_, i) => ({
              seasonNumber: i + 1,
              name: `Temporada ${i + 1}`,
            }))
          );
        }
      } catch (_) {}
    };

    loadSeasons();
    return () => {
      cancelled = true;
    };
  }, [isEpisodic, tmdbId, seasons.length]);

  // Cargar episodios de la temporada seleccionada
  useEffect(() => {
    if (!isEpisodic) return;

    // 1. Usar caché en memoria si existe
    if (episodesCacheRef.current[selectedSeason] && episodesCacheRef.current[selectedSeason].length > 0) {
      setEpisodes(episodesCacheRef.current[selectedSeason]);
      setEpisodesError(null);
      setIsLoadingEpisodes(false);
      return;
    }

    // 2. Fallback con currentMedia si tiene episodios de esta temporada
    if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
      const matching = currentMedia.episodes
        .filter((e) => (e.seasonNumber || 1) === selectedSeason)
        .map((e) => ({
          season: e.seasonNumber || selectedSeason,
          episode: e.episodeNumber || 1,
          title: e.title || `Episodio ${e.episodeNumber || 1}`,
          duration: e.duration,
        }));
      if (matching.length > 0) {
        episodesCacheRef.current[selectedSeason] = matching;
        setEpisodes(matching);
      }
    }

    if (!tmdbId) return;

    let cancelled = false;
    const fetchEpisodes = async () => {
      setIsLoadingEpisodes(true);
      setEpisodesError(null);
      try {
        const base = deviceSync.getApiBase();
        const res = await fetch(`${base}/api/tv/${tmdbId}/season/${selectedSeason}`, {
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) {
          throw new Error(`Error ${res.status}: no se encontró la temporada`);
        }
        const data = await res.json();
        if (cancelled) return;
        const rawEps = Array.isArray(data.episodes) ? data.episodes : [];
        const formatted = rawEps.map((ep: any, idx: number) => ({
          season: Number(ep.seasonNumber ?? ep.season ?? selectedSeason),
          episode: Number(ep.episodeNumber ?? ep.episode ?? ep.episode_number ?? idx + 1),
          title: String(ep.title || ep.name || `Episodio ${ep.episodeNumber ?? idx + 1}`),
          duration: ep.duration ? String(ep.duration) : undefined,
        }));
        episodesCacheRef.current[selectedSeason] = formatted;
        setEpisodes(formatted);
      } catch (err: any) {
        if (cancelled) return;
        if (!episodesCacheRef.current[selectedSeason] || episodesCacheRef.current[selectedSeason].length === 0) {
          setEpisodesError(err.message || 'Error al cargar capítulos');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEpisodes(false);
        }
      }
    };

    fetchEpisodes();
    return () => {
      cancelled = true;
    };
  }, [isEpisodic, tmdbId, selectedSeason, currentMedia?.episodes]);

  const totalKnownSeasons =
    playbackState?.playbackMeta?.totalSeasons || seasons.length || 1;
  const totalKnownEpisodes =
    episodes.length > 0
      ? episodes.length
      : playbackState?.playbackMeta?.episodes?.length || 0;

  const hasPrevEpisode =
    isEpisodic && ((seasonNum || 1) > 1 || (episodeNum || 1) > 1);

  const hasNextEpisode =
    isEpisodic &&
    (totalKnownEpisodes > 0 && totalKnownSeasons > 0
      ? (seasonNum || 1) < totalKnownSeasons || (episodeNum || 1) < totalKnownEpisodes
      : true);

  const hasIntroTimings = Boolean(
    playbackState?.hasIntroTimings || playbackState?.isIntroActive
  );

  const handleTestSignal = () => {
    setPingSuccess(true);
    onSendCommand({ action: 'trackpadMove', payload: { dx: 0, dy: 0 } });
    setTimeout(() => setPingSuccess(false), 2500);
  };

  return (
    <div className="w-full max-w-md mx-auto px-3.5 py-4 space-y-4 pb-36 select-none text-zinc-100 overflow-x-hidden">
      {/* Aviso de inactividad / temporizador "¿Seguís viendo?" */}
      {playbackState?.areYouStillThere && (
        <section
          aria-label="Aviso de inactividad"
          className="p-4 rounded-2xl bg-amber-950/80 border border-amber-500/50 shadow-xl space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">¿Seguís viendo?</h3>
              <p className="text-xs text-amber-200/80">La reproducción se pausará pronto si no hay actividad.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSendCommand({ action: 'confirmActiveWatching' })}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition flex items-center justify-center gap-2 shadow-md active:scale-95"
          >
            <span>Seguir viendo</span>
          </button>
        </section>
      )}

      {/* 1. Estado de la pantalla */}
      <section
        aria-label="Estado de la pantalla"
        className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-md flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${
              !isConnected || connStatus.state === 'disconnected'
                ? 'bg-rose-500'
                : connStatus.state === 'reconnecting' || isScreenReconnecting
                ? 'bg-amber-500 animate-pulse'
                : 'bg-emerald-500'
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                {!isConnected || connStatus.state === 'disconnected'
                  ? 'Sin conexión'
                  : connStatus.state === 'reconnecting' || isScreenReconnecting
                  ? 'Reconectando...'
                  : connStatus.latencyMs > 0
                  ? `${connStatus.latencyMs} ms`
                  : 'Conectado'}
              </p>
              {lastCommandFeedback && (
                <span
                  className={`text-xs font-bold transition flex items-center gap-1 ${
                    lastCommandFeedback.status === 'confirmed'
                      ? 'text-emerald-400'
                      : lastCommandFeedback.status === 'retrying'
                      ? 'text-amber-400 animate-pulse'
                      : 'text-rose-400'
                  }`}
                  title={lastCommandFeedback.message || ''}
                >
                  <span>{lastCommandFeedback.status === 'confirmed' ? '✓' : '⚠'}</span>
                  {lastCommandFeedback.message && (
                    <span className="text-[10px] font-normal">{lastCommandFeedback.message}</span>
                  )}
                </span>
              )}
            </div>
            <p className="text-sm font-extrabold text-white truncate">
              {isConnected ? connectedScreenName : 'Ninguna pantalla seleccionada'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenCastModal}
          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-200 border border-zinc-700/80 transition flex items-center gap-1.5 shrink-0"
        >
          <Cast className="w-4 h-4 text-emerald-400" />
          <span>Cambiar pantalla</span>
        </button>
      </section>

      {/* 2. Fila 'Ir a' fija con accesos rápidos (altura mínima 44 px) */}
      <nav
        aria-label="Accesos rápidos Ir a"
        className="p-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 grid grid-cols-4 gap-1.5 shadow-md"
      >
        <button
          type="button"
          onClick={() => onSendCommand({ action: 'switchHub', payload: { hub: 'cinecast' } })}
          className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition ${
            activeHub === 'cinecast' && !isStandby
              ? 'bg-red-600 text-white shadow'
              : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300'
          }`}
        >
          <Film className="w-4 h-4" />
          <span className="text-[11px]">Inicio</span>
        </button>

        <button
          type="button"
          onClick={() => onSendCommand({ action: 'switchHub', payload: { hub: 'youtube' } })}
          className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition ${
            isYouTube
              ? 'bg-red-600 text-white shadow'
              : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300'
          }`}
        >
          <Youtube className="w-4 h-4 text-red-400" />
          <span className="text-[11px]">YouTube</span>
        </button>

        <button
          type="button"
          onClick={() => onSendCommand({ action: 'switchHub', payload: { hub: 'spotify' } })}
          className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition ${
            isSpotify
              ? 'bg-emerald-600 text-white shadow'
              : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300'
          }`}
        >
          <Music className="w-4 h-4 text-emerald-400" />
          <span className="text-[11px]">Spotify</span>
        </button>

        <button
          type="button"
          onClick={() => onSendCommand({ action: 'switchHub', payload: { hub: 'sports' } })}
          className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition ${
            activeHub === 'sports'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300'
          }`}
        >
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-[11px]">Partidos</span>
        </button>
      </nav>

      {/* Botones de navegación Pad y Cruceta (>= 44px cada uno) */}
      <section aria-label="Control Pad y Cruceta" className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {/* Botón Pad */}
          <button
            type="button"
            aria-label="Pad"
            onClick={() => {
              if (onOpenBigPad) {
                onOpenBigPad('pad');
              } else {
                setPadMode((prev) => (prev === 'touchpad' ? null : 'touchpad'));
              }
            }}
            className={`min-h-[48px] px-3.5 py-3 rounded-2xl font-extrabold text-xs sm:text-sm transition flex items-center justify-between border shadow-md ${
              padMode === 'touchpad'
                ? 'bg-zinc-800 text-white border-zinc-700 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-red-600/90 text-white flex items-center justify-center shadow shrink-0">
                <MousePointer className="w-4 h-4" />
              </div>
              <div className="text-left">
                <span className="block text-white text-xs sm:text-sm font-extrabold">
                  Pad
                </span>
                <span className="block text-[10px] text-zinc-400 font-normal leading-tight">
                  Táctil, clic, scroll
                </span>
              </div>
            </div>
          </button>

          {/* Botón Cruceta */}
          <button
            type="button"
            aria-label="Cruceta"
            onClick={() => {
              if (onOpenBigPad) {
                onOpenBigPad('cruceta');
              } else {
                setPadMode((prev) => (prev === 'cruceta' ? null : 'cruceta'));
              }
            }}
            className={`min-h-[48px] px-3.5 py-3 rounded-2xl font-extrabold text-xs sm:text-sm transition flex items-center justify-between border shadow-md ${
              padMode === 'cruceta'
                ? 'bg-zinc-800 text-white border-zinc-700 shadow-lg'
                : 'bg-zinc-900/90 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-red-600/90 text-white flex items-center justify-center shadow shrink-0">
                <Gamepad2 className="w-4 h-4" />
              </div>
              <div className="text-left">
                <span className="block text-white text-xs sm:text-sm font-extrabold">
                  Cruceta
                </span>
                <span className="block text-[10px] text-zinc-400 font-normal leading-tight">
                  Flechas, OK, Atrás
                </span>
              </div>
            </div>
          </button>
        </div>

        {padMode && (
          <div className="p-3.5 rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-xl">
            <PadSection onSendCommand={onSendCommand} mode={padMode} hideModeSelector />
          </div>
        )}
      </section>

      {/* 3. Tarjeta de reproducción activa según el estado */}
      {isYouTube || isSpotify ? (
        /* Estado YouTube / Spotify */
        <section
          aria-label="Reproducción externa"
          className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg text-center space-y-4"
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-zinc-800 flex items-center justify-center">
            {isYouTube ? (
              <Youtube className="w-6 h-6 text-red-500" />
            ) : (
              <Music className="w-6 h-6 text-emerald-400" />
            )}
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">
              Reproduciendo en {isYouTube ? 'YouTube' : 'Spotify'} de la TV
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              La pantalla está sintonizada en {isYouTube ? 'YouTube TV' : 'Spotify Web Player'}.
            </p>
          </div>

          {/* (a) Control de volumen en Hub: silencio, -10, barra / porcentaje, +10 */}
          <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3 text-left">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Volumen de la TV
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                onClick={() => onSendCommand({ action: 'toggleMute' })}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
              </button>

              <button
                type="button"
                aria-label="Bajar volumen 10%"
                onClick={() =>
                  onSendCommand({
                    action: 'setVolume',
                    payload: Math.max(0, currentVolume - 10),
                  })
                }
                className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-extrabold text-zinc-200 transition"
              >
                -10
              </button>

              <input
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : currentVolume}
                onChange={(e) =>
                  onSendCommand({ action: 'setVolume', payload: Number(e.target.value) })
                }
                aria-label="Control de volumen"
                className="flex-1 accent-red-600 h-2 bg-zinc-700 rounded-lg cursor-pointer"
              />

              <button
                type="button"
                aria-label="Subir volumen 10%"
                onClick={() =>
                  onSendCommand({
                    action: 'setVolume',
                    payload: Math.min(100, currentVolume + 10),
                  })
                }
                className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-extrabold text-zinc-200 transition"
              >
                +10
              </button>

              <span className="text-xs font-mono font-bold text-zinc-200 w-9 text-right shrink-0">
                {isMuted ? '0%' : `${currentVolume}%`}
              </span>
            </div>

            {/* Botón opcional Volumen del sistema (Windows) */}
            <div className="pt-1 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Volumen de sistema (Windows):</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onSendCommand({ action: 'setVolume', payload: { systemVolume: 'down' } } as any)}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 hover:bg-zinc-800"
                >
                  Bajar (Win)
                </button>
                <button
                  type="button"
                  onClick={() => onSendCommand({ action: 'setVolume', payload: { systemVolume: 'up' } } as any)}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 hover:bg-zinc-800"
                >
                  Subir (Win)
                </button>
              </div>
            </div>
          </div>

          {/* (b) Pantalla completa y (d) Volver a películas */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              aria-label="Pantalla completa en hub"
              onClick={() => onSendCommand({ action: 'toggleHubFullscreen' })}
              className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-extrabold text-xs transition border border-zinc-700 shadow flex items-center justify-center gap-2"
            >
              <Maximize2 className="w-4 h-4 text-emerald-400" />
              <span>Pantalla completa</span>
            </button>

            <button
              type="button"
              onClick={() => onSendCommand({ action: 'switchHub', payload: { hub: 'cinecast' } })}
              className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs transition shadow-lg shadow-red-950/40 flex items-center justify-center gap-2"
            >
              <Film className="w-4 h-4" />
              <span>Volver a películas</span>
            </button>
          </div>
        </section>
      ) : !title || isStandby ? (
        /* Estado Reposo / Libre */
        <section
          aria-label="Pantalla en reposo"
          className="p-6 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-lg text-center space-y-4"
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-400">
            <Tv className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">Pantalla en reposo</h3>
            <p className="text-xs text-zinc-400 mt-1">
              No hay reproducción activa. Elegí una película o serie para comenzar.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                if (onNavigateToCatalog) {
                  onNavigateToCatalog();
                } else {
                  window.location.hash = '#/explorar';
                }
              }}
              className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition shadow"
            >
              Explorar catálogo
            </button>
            <button
              type="button"
              onClick={() => onSendCommand({ action: 'wakeScreen' })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs border border-zinc-700 transition"
            >
              Despertar pantalla
            </button>
          </div>
        </section>
      ) : (
        /* Estado Reproduciendo Catálogo */
        <section
          aria-label="Reproducción de catálogo"
          className="p-4 sm:p-5 rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-xl space-y-4"
        >
          {/* Carátula + Título + T/E */}
          <div className="flex gap-3.5 items-center">
            <div className="w-14 h-20 rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700/80 shrink-0">
              <img
                src={posterUrl}
                alt={title}
                onError={(e) => {
                  e.currentTarget.src = createStyledPosterFallback(title, 'movie');
                }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                En pantalla
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
                {title}
              </h2>
              {seasonNum && episodeNum && (
                <p className="text-xs font-semibold text-zinc-300 truncate mt-0.5">
                  T{seasonNum}:E{episodeNum} {episodeTitle ? `· ${episodeTitle}` : ''}
                </p>
              )}
            </div>
          </div>

          {/* Control táctil deslizable (role="slider") con pista de 8px y área táctil de 44px */}
          <div className="space-y-1.5 pt-1">
            {playbackState?.seekUnsupported ? (
              <div className="p-2 rounded-xl bg-zinc-800/80 border border-zinc-700/60 text-center text-xs text-amber-300 font-semibold">
                Este reproductor no permite saltar
              </div>
            ) : (
              <>
                <div
                  role="slider"
                  aria-label="Posición de reproducción"
                  aria-valuenow={Math.round(displayTime)}
                  aria-valuemin={0}
                  aria-valuemax={effectiveDuration}
                  aria-valuetext={`${formatTime(displayTime)} de ${isDurationValid ? formatTime(effectiveDuration) : 'desconocida'}`}
                  aria-disabled={!isDurationValid}
                  tabIndex={isDurationValid ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!isDurationValid) return;
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const next = Math.max(0, displayTime - 5);
                      setLastSeekReleasedAt(Date.now());
                      setLastSeekTime(next);
                      onSendCommand({ action: 'seek', payload: next });
                    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const next = Math.min(effectiveDuration, displayTime + 5);
                      setLastSeekReleasedAt(Date.now());
                      setLastSeekTime(next);
                      onSendCommand({ action: 'seek', payload: next });
                    }
                  }}
                  onPointerDown={handleSliderPointerDown}
                  onPointerMove={handleSliderPointerMove}
                  onPointerUp={handleSliderPointerUp}
                  onPointerCancel={handleSliderPointerCancel}
                  onClick={handleSliderClick}
                  className={`w-full min-h-[44px] flex items-center relative select-none touch-none ${
                    isDurationValid ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                  }`}
                >
                  {/* Pista visible de 8px */}
                  <div
                    ref={sliderTrackRef}
                    className="w-full h-[8px] rounded-full bg-zinc-800 relative overflow-visible"
                  >
                    {/* Barra de progreso */}
                    <div
                      className="h-full bg-red-600 rounded-full"
                      style={{ width: `${displayPercent}%` }}
                    />

                    {/* Pulgar accesible (thumb) con hora destino flotante */}
                    {isDurationValid && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-red-600 shadow-md flex items-center justify-center transition-transform active:scale-125"
                        style={{ left: `${displayPercent}%` }}
                      >
                        {isDraggingSlider && (
                          <div className="absolute -top-11 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-zinc-950 text-white font-extrabold text-sm border border-zinc-700 shadow-2xl pointer-events-none whitespace-nowrap z-30">
                            {formatTime(dragTime)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Tiempos transcurrido / total y nota discreta si no hay duración */}
                <div className="flex justify-between items-center text-[11px] font-mono text-zinc-400">
                  <span>{formatTime(displayTime)}</span>
                  {!isDurationValid && (
                    <span className="text-[10px] text-zinc-500 italic">
                      Transmisión en vivo o duración desconocida
                    </span>
                  )}
                  <span>{isDurationValid ? formatTime(effectiveDuration) : '--:--'}</span>
                </div>

                {/* 4 botones de salto rápido: -10s, +10s, -60s, +60s (mínimo 44px de alto) */}
                <div className="grid grid-cols-4 gap-2 pt-1">
                  <button
                    type="button"
                    aria-label="Salto rápido -60s"
                    disabled={!isDurationValid}
                    onClick={() => onSendCommand({ action: 'seekRelative', payload: -60 })}
                    className="min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 font-mono font-bold text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    -60s
                  </button>
                  <button
                    type="button"
                    aria-label="Salto rápido -10s"
                    disabled={!isDurationValid}
                    onClick={() => onSendCommand({ action: 'seekRelative', payload: -10 })}
                    className="min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 font-mono font-bold text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    -10s
                  </button>
                  <button
                    type="button"
                    aria-label="Salto rápido +10s"
                    disabled={!isDurationValid}
                    onClick={() => onSendCommand({ action: 'seekRelative', payload: 10 })}
                    className="min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 font-mono font-bold text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +10s
                  </button>
                  <button
                    type="button"
                    aria-label="Salto rápido +60s"
                    disabled={!isDurationValid}
                    onClick={() => onSendCommand({ action: 'seekRelative', payload: 60 })}
                    className="min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 font-mono font-bold text-xs flex items-center justify-center transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +60s
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Fila de controles principales (Cap Ant, -10s, play/pause, +10s, Cap Sig) */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 pt-1">
            {isEpisodic && (
              <button
                type="button"
                aria-label="Capítulo anterior"
                disabled={!hasPrevEpisode}
                title={hasPrevEpisode ? 'Capítulo anterior' : 'Primer capítulo'}
                onClick={() => onSendCommand({ action: 'prevEpisode' })}
                className={`min-w-[44px] min-h-[48px] rounded-2xl flex items-center justify-center transition active:scale-95 shadow border ${
                  hasPrevEpisode
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/80 cursor-pointer'
                    : 'bg-zinc-900/60 text-zinc-600 border-zinc-800/60 cursor-not-allowed opacity-40'
                }`}
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              aria-label="Retroceder 10 segundos"
              onClick={() => onSendCommand({ action: 'seekRelative', payload: -10 })}
              className="min-w-[48px] min-h-[48px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 flex items-center justify-center transition active:scale-95 shadow cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            <button
              type="button"
              aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
              onClick={() => onSendCommand({ action: isPlaying ? 'pause' : 'play' })}
              className="min-w-[58px] min-h-[58px] rounded-2xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition active:scale-95 shadow-lg shadow-red-950/50 cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              aria-label="Adelantar 10 segundos"
              onClick={() => onSendCommand({ action: 'seekRelative', payload: 10 })}
              className="min-w-[48px] min-h-[48px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 flex items-center justify-center transition active:scale-95 shadow cursor-pointer"
            >
              <RotateCw className="w-5 h-5" />
            </button>

            {isEpisodic && (
              <button
                type="button"
                aria-label="Capítulo siguiente"
                disabled={!hasNextEpisode}
                title={hasNextEpisode ? 'Capítulo siguiente' : 'Último capítulo'}
                onClick={() => onSendCommand({ action: 'nextEpisode' })}
                className={`min-w-[44px] min-h-[48px] rounded-2xl flex items-center justify-center transition active:scale-95 shadow border ${
                  hasNextEpisode
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/80 cursor-pointer'
                    : 'bg-zinc-900/60 text-zinc-600 border-zinc-800/60 cursor-not-allowed opacity-40'
                }`}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Botón Saltar intro (exclusivo con hasIntroTimings) */}
          {isEpisodic && hasIntroTimings && (
            <div className="pt-1">
              <button
                type="button"
                aria-label="Saltar intro"
                onClick={() => onSendCommand({ action: 'skipIntro' })}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition active:scale-98 cursor-pointer"
              >
                <FastForward className="w-4 h-4 fill-current" />
                <span>Saltar intro</span>
              </button>
            </div>
          )}

          {/* Fila secundaria: Volumen + Subtítulos + Pantalla Completa */}
          <div className="p-3 rounded-xl bg-zinc-850/80 border border-zinc-800 space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                onClick={() => onSendCommand({ action: 'toggleMute' })}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
              </button>

              <input
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : currentVolume}
                onChange={(e) =>
                  onSendCommand({ action: 'setVolume', payload: Number(e.target.value) })
                }
                aria-label="Control de volumen"
                className="flex-1 accent-red-600 h-2 bg-zinc-700 rounded-lg cursor-pointer"
              />

              <span className="text-xs font-mono text-zinc-300 w-8 text-right shrink-0">
                {isMuted ? '0%' : `${currentVolume}%`}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => onSendCommand({ action: 'toggleSubtitles' })}
                className={`min-h-[44px] flex-1 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  subsEnabled
                    ? 'bg-red-600 text-white shadow'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                <Subtitles className="w-4 h-4" />
                <span>Subtítulos {subsEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                aria-label="Pantalla completa"
                onClick={() => onSendCommand({ action: 'toggleFullscreen' })}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Completa</span>
              </button>
            </div>
          </div>

          {/* Selector de servidores (Parte 3) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsServersOpen((p) => !p)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between text-xs font-bold text-zinc-200 transition"
            >
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>Servidores ({effectiveServersList.length})</span>
                {serversExhausted && (
                  <span className="px-2 py-0.5 rounded-full bg-red-600/80 text-[10px] text-white">
                    Falló servidor
                  </span>
                )}
              </div>
              {isServersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isServersOpen && (
              <div className="p-2 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-1.5 max-h-48 overflow-y-auto">
                {effectiveServersList.length === 0 ? (
                  <p className="text-xs text-zinc-500 p-2 text-center">No hay servidores listados</p>
                ) : (
                  effectiveServersList.map((srv, idx) => {
                    const isActive = idx === activeServerIdx;
                    return (
                      <button
                        key={`${srv.name}-${idx}`}
                        type="button"
                        onClick={() =>
                          onSendCommand({ action: 'selectServer', payload: { index: idx } })
                        }
                        className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-left text-xs font-bold transition flex items-center justify-between ${
                          isActive
                            ? 'bg-red-600 text-white shadow'
                            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                        }`}
                      >
                        <span className="truncate">{srv.name || `Servidor ${idx + 1}`}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {srv.language && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-zinc-300">
                              {srv.language}
                            </span>
                          )}
                          {isActive && <span className="text-[10px] font-extrabold">ACTIVO</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Selector de capítulos (Parte 2: con selector de temporada y jumpToEpisode) */}
          {isEpisodic && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsChaptersOpen((p) => !p)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between text-xs font-bold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <ListVideo className="w-4 h-4 text-red-400" />
                  <span>
                    Capítulos {episodes.length > 0 ? `(${episodes.length})` : ''}
                  </span>
                </div>
                {isChaptersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isChaptersOpen && (
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2.5">
                  {/* Selector de temporadas */}
                  <div className="flex items-center gap-2">
                    <label htmlFor="remote-season-select" className="text-xs font-bold text-zinc-400 shrink-0">
                      Temporada:
                    </label>
                    <select
                      id="remote-season-select"
                      aria-label="Elegir temporada"
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(Number(e.target.value))}
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-bold focus:outline-none focus:border-red-500 cursor-pointer"
                    >
                      {(seasons.length > 0
                        ? seasons
                        : [{ seasonNumber: selectedSeason, name: `Temporada ${selectedSeason}` }]
                      ).map((s) => (
                        <option key={s.seasonNumber} value={s.seasonNumber}>
                          {s.name || `Temporada ${s.seasonNumber}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Estado de carga */}
                  {isLoadingEpisodes && (
                    <div className="p-4 text-center text-xs text-zinc-400 animate-pulse">
                      Cargando capítulos de la temporada {selectedSeason}...
                    </div>
                  )}

                  {/* Estado de error */}
                  {!isLoadingEpisodes && episodesError && (
                    <div className="p-3 text-center text-xs text-red-400 bg-red-950/40 rounded-xl border border-red-900/50 flex flex-col items-center gap-1.5">
                      <span>{episodesError}</span>
                      <button
                        type="button"
                        onClick={() => {
                          delete episodesCacheRef.current[selectedSeason];
                          setSelectedSeason((prev) => prev);
                        }}
                        className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}

                  {/* Lista de episodios */}
                  {!isLoadingEpisodes && !episodesError && (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {episodes.length === 0 ? (
                        <p className="text-xs text-zinc-500 p-2 text-center">
                          No hay capítulos para la temporada {selectedSeason}
                        </p>
                      ) : (
                        episodes.map((ep, idx) => {
                          const isCurrent =
                            selectedSeason === seasonNum && ep.episode === episodeNum;
                          return (
                            <button
                              key={`ch-${ep.season}-${ep.episode}-${idx}`}
                              type="button"
                              onClick={() =>
                                onSendCommand({
                                  action: 'jumpToEpisode',
                                  payload: { season: selectedSeason, episode: ep.episode },
                                })
                              }
                              className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-left text-xs font-semibold transition flex items-center justify-between ${
                                isCurrent
                                  ? 'bg-red-600 text-white font-bold shadow'
                                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                              }`}
                            >
                              <span className="truncate">
                                E{ep.episode}: {ep.title}
                              </span>
                              {isCurrent && (
                                <span className="text-[10px] font-bold uppercase tracking-wider shrink-0 bg-white/20 px-2 py-0.5 rounded">
                                  Viendo
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 4. Toggles / automatización: SOLO Modo Maratón visible */}
      <section
        aria-label="Automatización de reproducción"
        className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-md space-y-2.5"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Automatización de reproducción
        </span>

        {/* Modo Maratón */}
        <div className="flex items-center justify-between min-h-[44px] gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-zinc-200">Modo Maratón</span>
              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-red-600/30 text-red-400 border border-red-500/30">
                Recomendado
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 leading-tight mt-0.5">
              Pasa solo al siguiente capítulo y salta lo que pueda
            </p>
          </div>
          <Switch
            checked={Boolean(playbackState?.marathon)}
            ariaLabel="Alternar Modo Maratón"
            onChange={(enabled) =>
              onSendCommand({
                action: 'setMarathon',
                payload: { enabled },
              })
            }
          />
        </div>

        {/* Saltar intro automático (oculto en UI) */}
        <div className="hidden">
          <Switch
            checked={Boolean(playbackState?.playbackSettings?.autoSkipIntro)}
            ariaLabel="Alternar salto de intro automático"
            onChange={(autoSkipIntro) =>
              onSendCommand({
                action: 'setPlaybackSettings',
                payload: { autoSkipIntro },
              })
            }
          />
        </div>

        {/* Siguiente capítulo automático (oculto en UI) */}
        <div className="hidden">
          <Switch
            checked={playbackState?.playbackSettings?.autoPlayNext ?? true}
            ariaLabel="Alternar reproducción automática del siguiente capítulo"
            onChange={(autoPlayNext) =>
              onSendCommand({
                action: 'setPlaybackSettings',
                payload: { autoPlayNext },
              })
            }
          />
        </div>
      </section>

      {/* 5. Sección 'Más' plegada por defecto (acordeón accesible) */}
      <section
        aria-label="Opciones avanzadas"
        className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden shadow-md"
      >
        <button
          type="button"
          onClick={() => setIsMoreOpen((p) => !p)}
          className="w-full min-h-[48px] px-4 py-3 flex items-center justify-between text-xs font-bold text-zinc-200 hover:bg-zinc-850 transition"
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-zinc-400" />
            <span>Más ajustes y funciones</span>
          </div>
          {isMoreOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {isMoreOpen && (
          <div className="p-3 pt-0 border-t border-zinc-800/80 space-y-2">
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAudioSheetOpen(true)}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 flex items-center gap-2 transition"
              >
                <Sliders className="w-4 h-4 text-purple-400" />
                <span>Opciones de audio</span>
              </button>

              <button
                type="button"
                onClick={onOpenGuestModal}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 flex items-center justify-center gap-2 transition"
              >
                <QrCode className="w-4 h-4 text-emerald-400" />
                <span>Invitar celular (QR)</span>
              </button>

              {/* Botones ocultados sin eliminar código ni comandos */}
              <button
                type="button"
                onClick={() => onSendCommand({ action: 'skipIntro' })}
                className="hidden"
                aria-hidden="true"
              >
                <SkipForward className="w-4 h-4" />
                <span>Saltar intro</span>
              </button>

              <button
                type="button"
                onClick={handleTestSignal}
                className="hidden"
                aria-hidden="true"
              >
                <Wifi className="w-4 h-4" />
                <span>Probar señal</span>
              </button>

              <button
                type="button"
                onClick={onOpenCastModal}
                className="hidden"
                aria-hidden="true"
              >
                <Radio className="w-4 h-4" />
                <span>Sala</span>
              </button>
            </div>

            {/* Temporizador de reposo (reemplaza Reposo TV clásico) */}
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 mt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-zinc-200">Temporizador de reposo</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSendCommand({ action: 'setStandby' })}
                  className="text-[11px] text-zinc-400 hover:text-white underline"
                >
                  Reposo ahora
                </button>
              </div>

              {/* Opciones de temporizador: Apagado, 15, 30, 45, 60, 90, 120 min, "Al terminar el capítulo" */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[
                  { mode: 'off', label: 'Apagado' },
                  { mode: '15', label: '15 min', minutes: 15 },
                  { mode: '30', label: '30 min', minutes: 30 },
                  { mode: '45', label: '45 min', minutes: 45 },
                  { mode: '60', label: '60 min', minutes: 60 },
                  { mode: '90', label: '90 min', minutes: 90 },
                  { mode: '120', label: '120 min', minutes: 120 },
                  { mode: 'chapter', label: 'Al terminar capítulo' },
                ].map((opt) => {
                  const isSelected = (playbackState?.sleepTimer?.mode || 'off') === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() =>
                        onSendCommand({
                          action: 'setSleepTimer',
                          payload: { mode: opt.mode, minutes: opt.minutes },
                        })
                      }
                      className={`min-h-[36px] px-1.5 py-1 rounded-lg text-[10px] font-bold border transition text-center ${
                        isSelected
                          ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                          : 'bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Modal / Panel de Opciones de Audio */}
      {isAudioSheetOpen && (
        <div
          role="dialog"
          aria-label="Panel Opciones de audio"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => setIsAudioSheetOpen(false)}
        >
          <div
            className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden text-zinc-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="shrink-0 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                <h3 className="font-extrabold text-sm text-white">Opciones de audio</h3>
              </div>
              <button
                type="button"
                aria-label="Cerrar opciones de audio"
                onClick={() => setIsAudioSheetOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              {/* 1. Volumen General 0 - 200 % */}
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between font-bold">
                  <span className="text-zinc-200">Volumen general</span>
                  <span className={`font-mono text-sm ${audioOpts.volume > 100 ? 'text-amber-400' : 'text-white'}`}>
                    {audioOpts.volume}% {audioOpts.volume > 100 && '(Boost + Compresor)'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={audioOpts.volume}
                  onChange={(e) => handleUpdateAudioOpts({ volume: Number(e.target.value) })}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>0%</span>
                  <span>100% (Normal)</span>
                  <span className="text-amber-400">200% (Boost)</span>
                </div>
              </div>

              {/* 2. Presets */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">
                  Perfiles de audio
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateAudioOpts({ preset: 'dialogos' })}
                    className={`min-h-[44px] p-2.5 rounded-xl text-left border flex flex-col justify-between transition ${
                      audioOpts.preset === 'dialogos'
                        ? 'bg-purple-950/60 border-purple-500 text-white shadow'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-850'
                    }`}
                  >
                    <span className="font-extrabold text-xs">Diálogos claros</span>
                    <span className="text-[10px] text-zinc-400 mt-1">Realce 1-3kHz</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateAudioOpts({ preset: 'nocturno' })}
                    className={`min-h-[44px] p-2.5 rounded-xl text-left border flex flex-col justify-between transition ${
                      audioOpts.preset === 'nocturno'
                        ? 'bg-purple-950/60 border-purple-500 text-white shadow'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-850'
                    }`}
                  >
                    <span className="font-extrabold text-xs">Nocturno</span>
                    <span className="text-[10px] text-zinc-400 mt-1">Compresión alta</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateAudioOpts({ preset: 'estandar' })}
                    className={`min-h-[44px] p-2.5 rounded-xl text-left border flex flex-col justify-between transition ${
                      audioOpts.preset === 'estandar'
                        ? 'bg-purple-950/60 border-purple-500 text-white shadow'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-850'
                    }`}
                  >
                    <span className="font-extrabold text-xs">Estándar</span>
                    <span className="text-[10px] text-zinc-400 mt-1">Plano original</span>
                  </button>
                </div>
              </div>

              {/* 3. Ajustes finos plegables */}
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowFineTuning(!showFineTuning)}
                  className="w-full flex items-center justify-between text-xs font-bold text-zinc-200"
                >
                  <span>Ajustes finos (Ecualizador & Dinámica)</span>
                  <span>{showFineTuning ? '▲' : '▼'}</span>
                </button>

                {showFineTuning && (
                  <div className="space-y-3 pt-2 border-t border-zinc-800">
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-300 mb-1">
                        <span>Graves (Bass)</span>
                        <span className="font-mono text-zinc-400">{audioOpts.bassDb > 0 ? `+${audioOpts.bassDb}` : audioOpts.bassDb} dB</span>
                      </div>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        value={audioOpts.bassDb}
                        onChange={(e) => handleUpdateAudioOpts({ bassDb: Number(e.target.value) })}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-300 mb-1">
                        <span>Medios / Voces</span>
                        <span className="font-mono text-zinc-400">{audioOpts.midDb > 0 ? `+${audioOpts.midDb}` : audioOpts.midDb} dB</span>
                      </div>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        value={audioOpts.midDb}
                        onChange={(e) => handleUpdateAudioOpts({ midDb: Number(e.target.value) })}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-300 mb-1">
                        <span>Agudos / Claridad</span>
                        <span className="font-mono text-zinc-400">{audioOpts.trebleDb > 0 ? `+${audioOpts.trebleDb}` : audioOpts.trebleDb} dB</span>
                      </div>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        value={audioOpts.trebleDb}
                        onChange={(e) => handleUpdateAudioOpts({ trebleDb: Number(e.target.value) })}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-zinc-300">Compresor dinámico</span>
                      <input
                        type="checkbox"
                        checked={audioOpts.compressorEnabled}
                        onChange={(e) => handleUpdateAudioOpts({ compressorEnabled: e.target.checked })}
                        className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Botón Restablecer audio */}
              <button
                type="button"
                onClick={handleResetAudioOpts}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-zinc-300 transition active:scale-98"
              >
                Restablecer audio
              </button>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-zinc-950 border-t border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsAudioSheetOpen(false)}
                className="min-h-[44px] px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-extrabold transition"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

