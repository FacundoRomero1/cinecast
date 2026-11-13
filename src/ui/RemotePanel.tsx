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
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

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
                : connStatus.state === 'reconnecting'
                ? 'bg-amber-500 animate-pulse'
                : 'bg-emerald-500'
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                {!isConnected || connStatus.state === 'disconnected'
                  ? 'Sin conexión'
                  : connStatus.state === 'reconnecting'
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

          {/* Barra de progreso con tiempo transcurrido / total */}
          <div className="space-y-1.5 pt-1">
            {playbackState?.seekUnsupported ? (
              <div className="p-2 rounded-xl bg-zinc-800/80 border border-zinc-700/60 text-center text-xs text-amber-300 font-semibold">
                Este reproductor no permite saltar
              </div>
            ) : (
              <>
                <div className="relative w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
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

          {/* Botón Saltar intro / Atajos rápidos +30/+60/+85/+120s / Marcas de intro */}
          {isEpisodic && (
            <div className="pt-1">
              {hasIntroTimings || playbackState?.introMarks ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    aria-label="Saltar intro"
                    onClick={() => onSendCommand({ action: 'skipIntro' })}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition active:scale-98 cursor-pointer"
                  >
                    <FastForward className="w-4 h-4 fill-current" />
                    <span>Saltar intro</span>
                  </button>
                  {playbackState?.introMarks && (
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
                      <span>
                        Intro: {Math.round(playbackState.introMarks.start)}s - {Math.round(playbackState.introMarks.end)}s
                      </span>
                      <button
                        type="button"
                        onClick={() => onSendCommand({ action: 'clearIntroMarks' })}
                        className="text-[10px] text-red-400 hover:text-red-300 underline"
                      >
                        Borrar marcas
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block text-left">
                      Saltos rápidos de tiempo
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[30, 60, 85, 120].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          aria-label={`Saltar ${sec} segundos`}
                          onClick={() => onSendCommand({ action: 'skipSeconds', payload: { seconds: sec } })}
                          className="min-h-[44px] px-1.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-xs font-extrabold text-zinc-200 border border-zinc-700/80 transition flex items-center justify-center gap-1 active:scale-95"
                        >
                          <FastForward className="w-3.5 h-3.5 text-amber-400" />
                          <span>+{sec}s</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onSendCommand({ action: 'markIntroStart' })}
                      className="flex-1 min-h-[44px] px-2 py-1.5 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-750 text-[11px] font-bold text-zinc-300 flex items-center justify-center gap-1 transition active:scale-95"
                    >
                      <span>Marcar inicio intro</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendCommand({ action: 'markIntroEnd' })}
                      className="flex-1 min-h-[44px] px-2 py-1.5 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-750 text-[11px] font-bold text-zinc-300 flex items-center justify-center gap-1 transition active:scale-95"
                    >
                      <span>Marcar fin intro</span>
                    </button>
                  </div>
                </div>
              )}
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
                onClick={() => onOpenAudioModal?.()}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-200 flex items-center gap-2 transition"
              >
                <Moon className="w-4 h-4 text-purple-400" />
                <span>Modo noche</span>
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
    </div>
  );
};

