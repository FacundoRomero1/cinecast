import Hls from 'hls.js';
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Eye, EyeOff,
  FastForward,
  Maximize, Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw, RotateCw,
  Server,
  SkipForward,
  Sliders,
  Volume2, VolumeX,
  X
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResumeController, type ResumeState } from '../app/resumeController';
import { globalAudioEngine } from '../services/audioEngine';
import { audioPrefs } from '../services/audioPrefs';
import { diagnosticService } from '../services/diagnosticService';
import { extractCleanRouteAndEp, generateServersForMedia } from '../services/embedService';
import { reportServerPlaybackPenalty, resolveServerPlay } from '../services/resolveService';
import { watchHistoryService } from '../services/watchHistoryService';
import { AudioSettings, Episode, MediaItem, PlaybackSettings, RemoteCommand, StreamServer } from '../types';

interface VideoPlayerProps {
  media: MediaItem;
  episode: Episode | null;
  audioSettings: AudioSettings;
  playbackSettings: PlaybackSettings;
  onUpdateAudio: (settings: Partial<AudioSettings>) => void;
  onClose: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  hasNextEpisode?: boolean;
  onRequestEpisodeChange?: (targetSeason: number, targetEpisode: number) => void;
  onBroadcastState?: (stateUpdate: any) => void;
  remoteCommandNotification?: string | null;
  onOpenAudioSettings?: () => void;
  remoteCommandTrigger?: { cmd: RemoteCommand; timestamp: number } | null;
  initialTime?: number;
  onBeforeAutoAdvance?: (chapterKey: string) => boolean;
}

const FALLBACK_SRC = 'https://vjs.zencdn.net/v/oceans.mp4';

// Helper robusto para extraer TMDB ID sin colisionar con slugs ni años
function extractTmdbId(rawId: any): number {
  if (!rawId) return 0;
  const str = String(rawId).trim();
  if (/^\d{1,8}$/.test(str)) {
    return Number(str);
  }
  const tmdbMatch = str.match(/tmdb-(?:series|movie|anime)-(\d+)/i) || str.match(/tmdb[_-](\d+)/i);
  if (tmdbMatch) return Number(tmdbMatch[1]);
  const prefixMatch = str.match(/(?:movie|series|anime|tv)[_-](\d+)/i);
  if (prefixMatch) return Number(prefixMatch[1]);
  const numMatch = str.match(/\b\d{3,8}\b/);
  if (numMatch) return Number(numMatch[0]);
  const anyNum = str.match(/\d+/);
  return anyNum ? Number(anyNum[0]) : 0;
}

// ── Requisito 2 & 6: Persistencia unificada de preferencia de servidor: cinecast_fav_server:${type}:${id} ──
function getFavServerKey(mediaOrKey: any, fallbackType = 'movie'): string {
  if (typeof mediaOrKey === 'object' && mediaOrKey !== null) {
    const isSeries =
      mediaOrKey.type === 'series' ||
      mediaOrKey.category === 'series' ||
      mediaOrKey.category === 'anime' ||
      mediaOrKey.type === 'anime' ||
      mediaOrKey.type === 'tv';
    const type = isSeries ? 'series' : 'movie';
    const id = mediaOrKey.tmdbId || mediaOrKey.id || '';
    return `cinecast_fav_server:${type}:${id}`;
  }
  return `cinecast_fav_server:${fallbackType}:${mediaOrKey}`;
}

function persistSuccessServer(mediaOrKey: any, server: StreamServer | null, fallbackType = 'movie') {
  if (!mediaOrKey || !server) return;
  try {
    const key = getFavServerKey(mediaOrKey, fallbackType);
    const entry = {
      id: (server as any).id,
      name: server.name,
      url: server.url,
      type: server.type,
      playable: (server as any).playable,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (_) { }
}

function getPersistedSuccessServer(
  mediaOrKey: any,
  fallbackType = 'movie'
): { id?: number | string; name?: string; playable?: string; type?: string; speedMs?: number } | null {
  if (!mediaOrKey) return null;
  try {
    const key = getFavServerKey(mediaOrKey, fallbackType);
    let raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) { }
    return { name: raw };
  } catch (_) {
    return null;
  }
}

// ── Componente WebView para Electron con control nativo de ciclo de vida (Paso 2 - CENSURA) ──
interface WebViewPlayerProps {
  src: string;
  reloadKey: number;
  title: string;
  onFailLoad: (errorCode: number, errorDesc: string) => void;
  onDomReady: () => void;
  onVideoLoaded?: () => void;
  onTimeout10s?: () => void;
}

const WebViewPlayer: React.FC<WebViewPlayerProps> = ({
  src,
  reloadKey,
  title,
  onFailLoad,
  onDomReady,
  onVideoLoaded,
  onTimeout10s,
}) => {
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    let hasStarted = false;
    let hasReportedVideo = false;

    const reportVideo = () => {
      if (hasReportedVideo) return;
      hasReportedVideo = true;
      console.log('[WebViewPlayer] Evento de carga con video detectado en webview');
      onVideoLoaded?.();
    };

    // Detecta si Cloudflare o un error de red bloquea la carga
    const handleFailLoad = (event: any) => {
      if (event.errorCode === -3) return; // ERR_ABORTED normal al navegar
      const desc = String(event.errorDescription || '');
      if (
        desc.includes('GUEST_VIEW_MANAGER_CALL') ||
        desc.includes('Script failed to execute') ||
        desc.includes('findGuest')
      ) {
        return;
      }
      console.warn('[WebViewPlayer] Fallo de carga (posible Cloudflare):', event.errorCode, event.errorDescription);
      onFailLoad(event.errorCode, desc || 'did-fail-load');
    };

    const handleConsoleMessage = (event: any) => {
      const msg = event.message || '';
      if (msg.includes('[WEBVIEW_VIDEO_LOADED]')) {
        reportVideo();
      }
    };

    const handleDomReady = () => {
      console.log('[WebViewPlayer] DOM listo, inyectando autoplay');
      console.log('[WebViewPlayer] DOM listo, inyectando autoplay y detector de video');
      try {
        webview.executeJavaScript(`
          try {
            const video = document.querySelector('video');
            if (video) {
            function attachVideoListeners(video) {
              const checkVideo = () => {
                if (video.readyState >= 2 || video.currentTime > 0) {
                  console.log('[WEBVIEW_VIDEO_LOADED]');
                }
              };
              video.addEventListener('loadeddata', checkVideo);
              video.addEventListener('timeupdate', () => {
                if (video.currentTime > 0) console.log('[WEBVIEW_VIDEO_LOADED]');
              });
              video.addEventListener('playing', checkVideo);
              checkVideo();
              video.autoplay = true;
              video.play().catch(() => {});
            }

            const initialVideo = document.querySelector('video');
            if (initialVideo) {
              attachVideoListeners(initialVideo);
            } else {
              const observer = new MutationObserver(() => {
                const lateVideo = document.querySelector('video');
                if (lateVideo) {
                  observer.disconnect();
                  attachVideoListeners(lateVideo);
                }
              });
              observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
            }
          } catch (_) {}
        `);
      } catch (_) { }
      hasStarted = true;
      onDomReady();
    };

    const pollInterval = setInterval(async () => {
      if (hasReportedVideo) {
        clearInterval(pollInterval);
        return;
      }
      if (!hasStarted || !webviewRef.current) return;
      try {
        const hasVideo = await webview.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            return Boolean(v && (v.readyState >= 2 || v.currentTime > 0));
          })()
        `).catch(() => false);
        if (hasVideo) {
          clearInterval(pollInterval);
          reportVideo();
        }
      } catch (_) { }
    }, 250);

    const handlePageTitleUpdated = (event: any) => {
      const pageTitle = event.title || '';
      if (/Just a moment|Cloudflare|Attention Required|Security Check/i.test(pageTitle)) {
        console.warn('[WebViewPlayer] Pantalla Cloudflare detectada en título webview:', pageTitle);
      }
    };

    // Watchdog de 10s: si el reproductor no arranca tras 10 segundos, rota automáticamente al siguiente mirror
    const watchdogTimer = setTimeout(() => {
      if (!hasStarted) {
        console.warn('[WebViewPlayer] 10 segundos transcurridos sin respuesta en webview -> rotando');
        onTimeout10s?.();
      }
    }, 10000);

    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('console-message', handleConsoleMessage);
    webview.addEventListener('page-title-updated', handlePageTitleUpdated);

    return () => {
      clearTimeout(watchdogTimer);
      clearInterval(pollInterval);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('console-message', handleConsoleMessage);
      webview.removeEventListener('page-title-updated', handlePageTitleUpdated);
    };
  }, [src, reloadKey, onFailLoad, onDomReady, onVideoLoaded, onTimeout10s]);

  return (
    <webview
      ref={webviewRef}
      key={`cinecast_webview_player_${reloadKey}`}
      src={src}
      title={title}
      partition="persist:videosession"
      style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      allowpopups={true}
    />
  );
};

function isSpanishCaption(lang?: string, label?: string): boolean {
  const l = (lang || '').toLowerCase().trim();
  const lbl = (label || '').toLowerCase().trim();
  return (
    l === 'es' ||
    l === 'es-es' ||
    l === 'es-mx' ||
    l === 'es-419' ||
    l.startsWith('es-') ||
    l.startsWith('es_') ||
    lbl.includes('español') ||
    lbl.includes('spanish')
  );
}

function isEnglishCaption(lang?: string, label?: string): boolean {
  const l = (lang || '').toLowerCase().trim();
  const lbl = (label || '').toLowerCase().trim();
  return (
    l === 'en' ||
    l === 'en-us' ||
    l === 'en-gb' ||
    l.startsWith('en-') ||
    l.startsWith('en_') ||
    lbl.includes('english') ||
    lbl.includes('inglés') ||
    lbl.includes('ingles')
  );
}

function isLatinoServerMatch(s?: StreamServer | null): boolean {
  if (!s) return false;
  const text = `${s.name || ''} ${s.language || ''} ${(s as any).providerId || ''} ${s.url || ''}`.toLowerCase();
  return (
    text.includes('latino') ||
    text.includes('moviemaster') ||
    text.includes('playlatin') ||
    /\b(lat|esp|es-419)\b/i.test(text) ||
    /[?&]lang=(?:lat|esp|es)\b/i.test(text)
  );
}

function isSubServerMatch(s?: StreamServer | null): boolean {
  if (!s) return false;
  const text = `${s.name || ''} ${s.language || ''} ${(s as any).providerId || ''} ${s.url || ''}`.toLowerCase();
  return (
    text.includes('sub') ||
    /\bsub\b/i.test(text) ||
    /[?&]lang=sub\b/i.test(text) ||
    text.includes('multi') ||
    text.includes('inglés') ||
    text.includes('ingles') ||
    text.includes('english')
  );
}

function normalizeServerUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function deduplicateServers(servers: StreamServer[], episodeKey: string = ''): StreamServer[] {
  const uniqueMap = new Map<string, StreamServer>();
  for (const srv of servers) {
    if (!srv) continue;
    const provider = (srv as any).providerId || (srv as any).provider || '';
    const normUrl = srv.url ? normalizeServerUrl(srv.url) : '';
    const key = srv.url
      ? (episodeKey ? `${episodeKey}_${normUrl}` : normUrl)
      : `${provider}_${episodeKey}_${srv.name}_${srv.type}`;

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        ...srv,
        id: (srv as any).id || `${provider}_${srv.name}_${normUrl || ''}`.replace(/\s+/g, '_'),
      });
    } else {
      const existing = uniqueMap.get(key)!;
      if (srv.type === 'hls' || (srv as any).validated) {
        uniqueMap.set(key, {
          ...existing,
          ...srv,
          id: (srv as any).id || existing.id || `${provider}_${srv.name}_${normUrl || ''}`.replace(/\s+/g, '_'),
        });
      }
    }
  }
  return Array.from(uniqueMap.values());
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media, episode, audioSettings, playbackSettings, onUpdateAudio, onClose,
  onNextEpisode, onPrevEpisode, hasNextEpisode = false, onRequestEpisodeChange, onBroadcastState,
  remoteCommandNotification, onOpenAudioSettings, remoteCommandTrigger, initialTime = 0,
  onBeforeAutoAdvance,
}) => {
  const autoAdvancedChapterGuardRef = useRef<string | null>(null);
  const tryAutoAdvanceEpisodeRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);
  const simulatedTimeRef = useRef<number>(initialTime || 0);
  const corsRetryRef = useRef(0);
  const cfAttemptRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(initialTime || 0);
  const [duration, setDuration] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isIntroActive, setIsIntroActive] = useState<boolean>(false);
  const [isRecapActive, setIsRecapActive] = useState<boolean>(false);
  const [countdownToNext, setCountdownToNext] = useState<number | null>(null);
  const [hasAutoSkippedIntro, setHasAutoSkippedIntro] = useState<boolean>(false);
  const [iframeReloadKey, setIframeReloadKey] = useState<number>(0);
  const prevEpisodeKeyRef = useRef<string | null>(null);
  const [corsMode, setCorsMode] = useState(true);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [cfWarning, setCfWarning] = useState(false);
  const [unavailableWarning, setUnavailableWarning] = useState(false);
  const [manualRetryCount, setManualRetryCount] = useState<number>(0);
  const [directCaptions, setDirectCaptions] = useState<Array<{
    url: string;
    lang?: string;
    language?: string;
    label?: string;
    isDefault?: boolean;
  }>>([]);

  const defaultCaptionIndex = useMemo(() => {
    if (!directCaptions || directCaptions.length === 0) return -1;
    // 1º: Si la pista es es o es-ES o es-MX (o español), poner default={true}
    const esIdx = directCaptions.findIndex((c) => isSpanishCaption(c.lang || c.language, c.label));
    if (esIdx !== -1) return esIdx;

    // 2º: Si NO hay pistas en español y la pista es en, poner default={true}
    const enIdx = directCaptions.findIndex((c) => isEnglishCaption(c.lang || c.language, c.label));
    if (enIdx !== -1) return enIdx;

    // 3º: Si no es ni español ni inglés, default={false}
    return -1;
  }, [directCaptions]);
  const skipTimeoutRef = useRef<any>(null);
  const iframeLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TAREA 1: Ocultar barra superior con persistencia y tecla 'H'
  const [isTopBarHidden, setIsTopBarHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_topbar_hidden') === 'true';
    } catch (_) {
      return false;
    }
  });

  const setTopBarHiddenPersisted = useCallback((hidden: boolean) => {
    setIsTopBarHidden(hidden);
    try {
      localStorage.setItem('cinecast_topbar_hidden', String(hidden));
    } catch (_) { }
  }, []);

  // TAREA 2: Modo Diagnóstico (apaga adblock, shields, reescritura de headers y spoof UA)
  const [isDiagnosticMode, setIsDiagnosticMode] = useState<boolean>(() => diagnosticService.isEnabled());
  const [isNoCorsFix, setIsNoCorsFix] = useState<boolean>(() => diagnosticService.isNoCorsFixEnabled());

  useEffect(() => {
    const unsubDiag = diagnosticService.onChange((enabled) => {
      setIsDiagnosticMode(enabled);
    });
    const unsubNoCors = diagnosticService.onNoCorsChange((disabled) => {
      setIsNoCorsFix(disabled);
    });
    return () => {
      unsubDiag();
      unsubNoCors();
    };
  }, []);

  const handleToggleDiagnosticMode = async (forceVal?: boolean) => {
    const next = typeof forceVal === 'boolean' ? await diagnosticService.setEnabled(forceVal) : await diagnosticService.toggle();
    setIsDiagnosticMode(next);
    triggerSignalToast(next ? '🛠️ Modo Diagnóstico ON (sin filtros)' : '🛡️ Modo Normal ON');
    setIframeReloadKey((k) => k + 1);
  };

  const handleToggleNoCorsFix = async () => {
    const next = await diagnosticService.toggleNoCorsFix();
    setIsNoCorsFix(next);
    triggerSignalToast(next ? '⚠️ Fix CORS DESACTIVADO' : '🛡️ Fix CORS Activado');
    setIframeReloadKey((k) => k + 1);
  };

  const isSeriesOrAnime =
    media.type === 'series' || media.category === 'series' || media.category === 'anime' ||
    Boolean(media.seasons?.length) || Boolean(media.episodes?.length);
  const isEpisodic =
    (media.type === 'series' || media.category === 'series' || media.category === 'anime') &&
    media.category !== 'live_tv';
  const resolveType = isSeriesOrAnime
    ? (media.category === 'anime' ? 'anime' : 'series')
    : 'movie';

  const [isPointerOverPanel, setIsPointerOverPanel] = useState<boolean>(false);
  const isPointerOverPanelRef = useRef<boolean>(false);
  const panelGracePendingRef = useRef<boolean>(true);
  const showControlsRef = useRef<boolean>(showControls);
  const isTopBarHiddenRef = useRef<boolean>(isTopBarHidden);
  const handleAdvanceEpisodeRef = useRef<(delta: number) => void>(() => {});
  showControlsRef.current = showControls;
  isTopBarHiddenRef.current = isTopBarHidden;

  // B5: Atajos de teclado en window con capture:true (H abre/cierra panel, N siguiente, P anterior, Escape salir)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable) ||
        Boolean(target?.closest?.('[contenteditable="true"]'))
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        const isCurrentlyVisible = !isTopBarHiddenRef.current && showControlsRef.current;
        if (isCurrentlyVisible) {
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
          setTopBarHiddenPersisted(true);
          setShowControls(false);
        } else {
          panelGracePendingRef.current = true;
          setTopBarHiddenPersisted(false);
          setShowControls(true);
        }
      } else if (e.key === 'n' || e.key === 'N') {
        if (isEpisodic) {
          e.preventDefault();
          handleAdvanceEpisodeRef.current?.(1);
        }
      } else if (e.key === 'p' || e.key === 'P') {
        if (isEpisodic) {
          e.preventDefault();
          handleAdvanceEpisodeRef.current?.(-1);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [setTopBarHiddenPersisted, onClose, isEpisodic]);

  // Tarea A: Extracción robusta de TMDB ID que soporta tmdb-series-1418_s1_e15, slugs y números
  const tmdbIdToUse = useMemo(() => {
    if (
      media.category === 'live_tv' ||
      media.type === 'live_tv' ||
      String(media.id).startsWith('sport_') ||
      String(media.id).startsWith('match_') ||
      String(media.id).startsWith('channel_') ||
      String(media.id).startsWith('live_')
    ) {
      return 0;
    }
    const direct = Number((media as any).tmdbId);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return extractTmdbId(media.id);
  }, [media.id, media.category, media.type, (media as any).tmdbId]);

  // Tarea B: Origen único de verdad para temporada y episodio con sincronización
  const [selectedSeason, setSelectedSeason] = useState<number>(episode ? episode.seasonNumber : 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(episode ? episode.episodeNumber : 1);

  useEffect(() => {
    if (episode) {
      if (episode.seasonNumber && episode.seasonNumber !== selectedSeason) {
        setSelectedSeason(episode.seasonNumber);
      }
      if (episode.episodeNumber && episode.episodeNumber !== selectedEpisode) {
        setSelectedEpisode(episode.episodeNumber);
      }
    }
  }, [episode?.seasonNumber, episode?.episodeNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentVideoUrl = (episode ? episode.videoUrl : media.videoUrl) || '';
  const introStart = episode ? episode.introStart : media.introStart;
  const introEnd = episode ? episode.introEnd : media.introEnd;
  const recapStart = episode ? episode.recapStart : media.recapStart;
  const recapEnd = episode ? episode.recapEnd : media.recapEnd;

  const PREFERRED_SERVER_STORAGE_KEY = 'cinecast_preferred_server';
  const mediaKey = (media as any).tmdbId || media.id;

  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [autoCommitDoneAt, setAutoCommitDoneAt] = useState<number>(0);
  const userInteractedRef = useRef<boolean>(false);
  const autoCommittedKeyRef = useRef<string | null>(null);
  const failedServersForEpisodeRef = useRef<Set<string>>(new Set());
  const unavailableServersForEpisodeRef = useRef<Set<string>>(new Set());
  const retryCountByServerEpisodeRef = useRef<Map<string, number>>(new Map());
  const shortDurationLoggedKeyRef = useRef<string | null>(null);
  const iframeStallTicksRef = useRef<number>(0);

  const getServerEpisodeKey = useCallback((srv?: StreamServer | null) => {
    const idPart = (srv as any)?.providerId || (srv as any)?.id || srv?.name || 'unknown';
    return `${media.id}:s${selectedSeasonRef.current}:e${selectedEpisodeRef.current}:${String(idPart).toLowerCase()}`;
  }, [media.id]);
  const serversEpochRef = useRef<number>(0);
  const [serversEpoch, setServersEpoch] = useState<number>(0);
  const [resolvedServers, setResolvedServers] = useState<StreamServer[] | null>(null);
  const [forceShowServerSelector, setForceShowServerSelector] = useState<boolean>(false);
  const [isGhostExtracting, setIsGhostExtracting] = useState<boolean>(false);
  const [captchaRequired, setCaptchaRequired] = useState<boolean>(false);
  const [forceVisibleIframeForCaptcha, setForceVisibleIframeForCaptcha] = useState<boolean>(false);
  const [showIframePlayBanner, setShowIframePlayBanner] = useState<boolean>(false);
  const animeAttemptCountRef = useRef<number>(0);
  const loadDirectStreamRef = useRef<() => void>(() => { });
  const autoAdvanceCountRef = useRef<number>(0);
  const loadedMetadataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Requisitos 1 y 6: Métricas de tiempo y reemplazo
  // Requisitos 1, 2 y 3: Métricas de tiempo, arranque y swap
  const mountTimeRef = useRef<number>(Date.now());
  const resolveTimeRef = useRef<number>(0);
  const firstFrameTimeRef = useRef<number>(0);
  const previewPlayingStartedAtRef = useRef<number>(0);
  const hasStartedWatchingRef = useRef<boolean>(false);
  const replacedAfterWatchingCountRef = useRef<number>(0);
  const hlsSuccessCallbackRef = useRef<((eventSource: string) => void) | null>(null);

  const algoReproduciendoRegisteredRef = useRef<boolean>(false);
  const previewFailedBeforePlayingRef = useRef<boolean>(false);
  const resolvedServerRef = useRef<StreamServer | null>(null);

  const markAlgoReproduciendo = useCallback((source: string, curTime?: number) => {
    if (algoReproduciendoRegisteredRef.current) return;
    algoReproduciendoRegisteredRef.current = true;
    previewPlayingStartedAtRef.current = Date.now();
    const mount = mountTimeRef.current || Date.now();
    const elapsedMs = Date.now() - mount;
    console.log(`[PlaybackTiming] ALGO_REPRODUCIENDO source="${source}" elapsedMs=${elapsedMs} currentTime=${curTime !== undefined ? curTime.toFixed(2) : 'N/A'}`);
  }, []);

  const recordFirstFrame = useCallback((source: string) => {
    hasStartedWatchingRef.current = true;
    if (source.includes('webview') || source.includes('dom-ready') || source.includes('embed')) {
      if (!previewPlayingStartedAtRef.current) {
        previewPlayingStartedAtRef.current = Date.now();
      }
    }
    if (!firstFrameTimeRef.current) {
      firstFrameTimeRef.current = Date.now();
      const mount = mountTimeRef.current || Date.now();
      const resTime = resolveTimeRef.current || mount;
      const resolveMs = Math.max(0, resTime - mount);
      const frameMs = Math.max(0, firstFrameTimeRef.current - resTime);
      const totalMs = Math.max(0, firstFrameTimeRef.current - mount);
      console.log(`[PlaybackTiming] PRIMER_FRAME source="${source}" totalMs=${totalMs} resolveMs=${resolveMs} frameMs=${frameMs} replacedAfterWatching=${replacedAfterWatchingCountRef.current}`);
    }

    // P2.3: Solo persistir servidor tras frame confirmado (currentTime > 0, tiempo de reproducción real o HLS verificado)
    if (
      source.includes('currentTime') ||
      source.includes('loadeddata') ||
      source.includes('hls-') ||
      source.includes('realstate-frame') ||
      source.includes('video-timeupdate')
    ) {
      if (activeServerRef.current) {
        persistSuccessServer(mediaRef.current, activeServerRef.current);
      }
    }
  }, []);

  const hasHlsFav = useMemo(() => {
    if (tmdbIdToUse <= 0) return false;
    const pref = getPersistedSuccessServer(media, isSeriesOrAnime ? 'series' : 'movie');
    return Boolean(pref && (pref.playable === 'hls' || pref.type === 'hls'));
  }, [media, tmdbIdToUse, isSeriesOrAnime]);

  const availableServers: StreamServer[] = useMemo(() => {
    // 0. Si es contenido en vivo (deportes, IPTV, etc.): usar servidores directos de la señal
    const isLive = media.category === 'live_tv' || media.type === 'live_tv' || tmdbIdToUse <= 0;
    if (isLive) {
      if (episode?.servers?.length) return episode.servers;
      if (media.servers?.length) return media.servers;
      if (currentVideoUrl) {
        return [{
          name: media.title || 'Señal en Directo',
          url: currentVideoUrl,
          type: currentVideoUrl.includes('.m3u8') ? 'hls' : 'iframe',
          language: 'En Vivo',
        }];
      }
    }

    const isAnime = media.category === 'anime' || resolveType === 'anime';
    const episodeKey = isSeriesOrAnime
      ? `${media.id}_s${selectedSeason}_e${selectedEpisode}`
      : `${media.id}_movie`;
    // 0. Si hay servidores de prueba explícitos en el episodio (ej. probe-marathon-launch con /__test/embed.html)
    if (episode?.servers?.some((s) => typeof s.url === 'string' && s.url.includes('/__test/'))) {
      return episode.servers;
    }

    // 1. Si resolveService o Direct HLS ya resolvió servidores para este título con TMDB
    if (tmdbIdToUse > 0 && resolvedServers !== null && resolvedServers.length > 0) {
      return deduplicateServers(resolvedServers, episodeKey);
    }

    // 2. Para series o anime con TMDB: regenerar siempre con la temporada y episodio seleccionados
    // para evitar que los servidores cacheados del episodio inicial en media.servers congelen la URL en el episodio 1.
    if (isSeriesOrAnime && tmdbIdToUse > 0) {
      return generateServersForMedia({
        tmdbId: tmdbIdToUse,
        title: media.title,
        type: isAnime ? 'anime' : 'series',
        season: selectedSeason,
        episode: selectedEpisode,
      });
    }

    // 3. Servidores explícitos (IPTV, en vivo o provistos por el llamador)
    if (episode?.servers?.length) return episode.servers;
    if (media.servers?.length) return media.servers;

    // 4. Pelis por TMDB: generar los espejos
    if (tmdbIdToUse > 0) {
      return generateServersForMedia({
        tmdbId: tmdbIdToUse,
        title: media.title,
        type: 'movie',
        season: selectedSeason,
        episode: selectedEpisode,
      });
    }

    const isEmbed =
      media.streamType === 'iframe' || currentVideoUrl.includes('vidsrc') ||
      currentVideoUrl.includes('embed') || currentVideoUrl.includes('multiembed');

    return [{
      name: isEmbed ? 'Servidor Embed 1' : 'Servidor Principal',
      url: currentVideoUrl || 'https://vjs.zencdn.net/v/oceans.mp4',
      type: isEmbed ? 'iframe' : 'mp4',
      language: 'Principal',
    }];
  }, [media, episode, currentVideoUrl, isSeriesOrAnime, tmdbIdToUse, selectedSeason, selectedEpisode, resolvedServers]);

  const [selectedServerName, setSelectedServerName] = useState<string>(() => {
    if (tmdbIdToUse > 0) return '';
    const successPref = getPersistedSuccessServer(media);
    if (successPref?.name) return successPref.name;
    const pref = audioPrefs.getForMedia(mediaKey, selectedSeason, selectedEpisode);
    if (pref?.serverName) return pref.serverName;
    try {
      const saved = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
      if (saved && !saved.toLowerCase().includes('autoembed') && !saved.toLowerCase().includes('tukiplay') && !saved.toLowerCase().includes('streamhg')) return saved;
    } catch (_) { }
    return 'VidLink Pro';
  });

  const [detectedTracks, setDetectedTracks] = useState<{ audio: string[]; subs: string[] } | null>(null);

  // Escuchar pistas de audio y subtítulos reales detectadas en segundo plano
  useEffect(() => {
    if (window.electronAPI?.onTracksDetected) {
      return window.electronAPI.onTracksDetected((tracks) => {
        if (tracks) setDetectedTracks(tracks);
      });
    }
  }, []);

  // Al cambiar temporada o episodio, sincronizar preferencia guardada específica para este título (solo si no usa tmdbId)
  useEffect(() => {
    if (tmdbIdToUse > 0) return;
    const pref = audioPrefs.getForMedia(mediaKey, selectedSeason, selectedEpisode);
    if (pref?.serverName) {
      setSelectedServerName(pref.serverName);
    }
  }, [mediaKey, selectedSeason, selectedEpisode, tmdbIdToUse]);

  // TAREA 1: Temporadas y episodios reales consultados via /api/tv/:id y /api/tv/:id/season/:n con caché en memoria
  interface RealSeasonInfo {
    seasonNumber: number;
    name: string;
    episodeCount: number;
  }
  interface RealEpisodeInfo {
    id?: number;
    season: number;
    episode: number;
    title: string;
    duration?: string;
  }

  const [realSeasons, setRealSeasons] = useState<RealSeasonInfo[]>([]);
  const [realEpisodes, setRealEpisodes] = useState<RealEpisodeInfo[]>([]);
  const [episodeNotExistsWarning, setEpisodeNotExistsWarning] = useState<string | null>(null);
  const tvDataMemoryCache = useRef(new Map<string, any>());

  // Tarea B: Título derivado 100% sincronizado con selectedSeason y selectedEpisode
  const currentEpisodeObj = useMemo(() => {
    return realEpisodes.find((e) => e.episode === selectedEpisode);
  }, [realEpisodes, selectedEpisode]);

  const currentTitle = useMemo(() => {
    if (!isEpisodic) return media.title;
    const epName = currentEpisodeObj?.title || (selectedEpisode === episode?.episodeNumber && episode?.title ? episode.title : `Episodio ${selectedEpisode}`);
    return `${media.title} - ${epName}`;
  }, [isEpisodic, media.title, selectedEpisode, currentEpisodeObj, episode]);

  // 1. Cargar listado real de temporadas para la serie
  useEffect(() => {
    if (!isEpisodic || tmdbIdToUse <= 0) return;
    const cacheKey = `tv_${tmdbIdToUse}`;
    if (tvDataMemoryCache.current.has(cacheKey)) {
      const cached = tvDataMemoryCache.current.get(cacheKey);
      setRealSeasons(cached.seasons || []);
      return;
    }

    let isMounted = true;
    fetch(`/api/tv/${tmdbIdToUse}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!isMounted || !d) return;
        const seasons = Array.isArray(d.seasons) && d.seasons.length > 0
          ? d.seasons
          : [{ seasonNumber: 1, name: 'Temporada 1', episodeCount: 10 }];
        tvDataMemoryCache.current.set(cacheKey, { seasons });
        setRealSeasons(seasons);
      })
      .catch(() => {
        if (!isMounted) return;
        const seasonsCount = media.seasonsCount || (media.seasons ? media.seasons.length : 1);
        const fallback = Array.from({ length: Math.max(1, seasonsCount) }, (_, i) => ({
          seasonNumber: i + 1,
          name: `Temporada ${i + 1}`,
          episodeCount: 12,
        }));
        setRealSeasons(fallback);
      });

    return () => { isMounted = false; };
  }, [isEpisodic, tmdbIdToUse, media.seasonsCount, media.seasons]);

  // 2. Cargar listado real de episodios para la temporada seleccionada y clampear si supera el máximo
  useEffect(() => {
    if (!isEpisodic || tmdbIdToUse <= 0) return;
    const cacheKey = `tv_${tmdbIdToUse}_s_${selectedSeason}`;
    if (tvDataMemoryCache.current.has(cacheKey)) {
      const cached = tvDataMemoryCache.current.get(cacheKey);
      const eps = cached.episodes || [];
      setRealEpisodes(eps);
      const maxAllowed = Math.max(eps.length, (episode?.seasonNumber === selectedSeason && episode?.episodeNumber) ? episode.episodeNumber : 0);
      if (eps.length > 0 && selectedEpisode > maxAllowed) {
        setSelectedEpisode(1);
        setEpisodeNotExistsWarning(`El episodio ${selectedEpisode} no existe en la Temporada ${selectedSeason}. Se volvió al episodio 1.`);
      } else {
        setEpisodeNotExistsWarning(null);
      }
      return;
    }

    let isMounted = true;
    fetch(`/api/tv/${tmdbIdToUse}/season/${selectedSeason}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!isMounted || !d) return;
        const eps = Array.isArray(d.episodes) && d.episodes.length > 0 ? d.episodes : [];
        tvDataMemoryCache.current.set(cacheKey, { episodes: eps });
        setRealEpisodes(eps);

        const maxAllowed = Math.max(eps.length, (episode?.seasonNumber === selectedSeason && episode?.episodeNumber) ? episode.episodeNumber : 0);
        if (eps.length > 0 && selectedEpisode > maxAllowed) {
          setSelectedEpisode(1);
          setEpisodeNotExistsWarning(`El episodio ${selectedEpisode} no existe en la Temporada ${selectedSeason}. Se volvió al episodio 1.`);
        } else {
          setEpisodeNotExistsWarning(null);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        const currentSeasonMeta = realSeasons.find((s) => s.seasonNumber === selectedSeason);
        const count = currentSeasonMeta?.episodeCount || 10;
        const fallback = Array.from({ length: count }, (_, i) => ({
          season: selectedSeason,
          episode: i + 1,
          title: `Episodio ${i + 1}`,
          duration: '24m',
        }));
        setRealEpisodes(fallback);
      });

    return () => { isMounted = false; };
  }, [isEpisodic, tmdbIdToUse, selectedSeason, realSeasons]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Requisitos 2 & 3: Política de arranque y resolución de servidores para títulos con tmdbId ──
  useEffect(() => {
    serversEpochRef.current += 1;
    const epoch = serversEpochRef.current;
    setServersEpoch(epoch);
    setResolvedServers(null);
    autoAdvanceCountRef.current = 0;
    autoAdvancedChapterGuardRef.current = null;
    setForceShowServerSelector(false);
    setIsPlaying(true);
    setCaptchaRequired(false);
    setForceVisibleIframeForCaptcha(false);
    setIsGhostExtracting(false);

    // P1.7 — Guardia de coherencia antes de resolver
    if (isSeriesOrAnime && episode && episode.episodeNumber !== selectedEpisode) {
      console.log(`[VideoPlayer] [P1.7 Guardia] Esperando sincronización de episodio: prop=${episode.episodeNumber} vs selected=${selectedEpisode}`);
      return;
    }

    const hasEpisodeTestServers = Boolean(
      episode?.servers && episode.servers.some((s) => typeof s.url === 'string' && s.url.includes('/__test/'))
    );
    if (hasEpisodeTestServers) {
      console.log(`[VideoPlayer] Servidores de prueba explícitos detectados en episode`);
      setIsResolving(false);
      return;
    }

    // Requisito 5: Títulos sin tmdbId (TV en vivo, mp4 directo) siguen por generateServersForMedia sin pasar por resolveService
    if (tmdbIdToUse <= 0) {
      setIsResolving(false);
      return;
    }

    const isTestMode =
      (typeof window !== 'undefined' && Boolean((window as any).__CINECAST_TEST)) ||
      (typeof window !== 'undefined' && Array.isArray((window as any).__CINECAST_TEST_SERVERS));

    if (isTestMode) {
      const testServers = generateServersForMedia({
        tmdbId: tmdbIdToUse,
        title: media.title,
        type: resolveType === 'anime' ? 'anime' : resolveType,
        season: selectedSeason,
        episode: selectedEpisode,
      });
      if (testServers.length > 0) {
        console.log(`[VideoPlayer] [TEST_MODE] Usando servidores de prueba:`, testServers.map((s) => s.name));
        setResolvedServers(testServers);
        const preferred = (typeof window !== 'undefined' && localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY)) || testServers[0].name;
        const chosen = testServers.find((s) => s.name === preferred) || testServers[0];
        setSelectedServerName(chosen.name);
        if (chosen.type !== 'iframe' && chosen.url) {
          setVideoSrc(chosen.url);
        } else {
          setVideoSrc('');
        }
        setIsResolving(false);
        setIsPlaying(true);
        setForceShowServerSelector(false);
        return;
      }
    }

    let isMounted = true;
    const abortController = new AbortController();
    mountTimeRef.current = Date.now();
    resolveTimeRef.current = 0;
    firstFrameTimeRef.current = 0;
    hasStartedWatchingRef.current = false;
    replacedAfterWatchingCountRef.current = 0;
    previewPlayingStartedAtRef.current = 0;
    algoReproduciendoRegisteredRef.current = false;
    previewFailedBeforePlayingRef.current = false;
    resolvedServerRef.current = null;

    const directType = isSeriesOrAnime ? 'tv' : 'movie';
    const directUrl = `/api/stream/direct?tmdbId=${tmdbIdToUse}&type=${directType}&season=${selectedSeason}&episode=${selectedEpisode}`;
    const episodeKey = isSeriesOrAnime
      ? `${media.id}_s${selectedSeason}_e${selectedEpisode}`
      : `${media.id}_movie`;

    // P2.5: Si el servidor elegido es latino y ya está rankeado primero, arranca directo; si no hay latino, arranca el primero disponible.
    const initialTraditional = generateServersForMedia({
      tmdbId: tmdbIdToUse,
      title: media.title,
      type: resolveType === 'anime' ? 'anime' : resolveType,
      season: selectedSeason,
      episode: selectedEpisode,
    }).filter((s) => s.id !== 'direct-hls');
    const firstIsLatino = initialTraditional.length > 0 && isLatinoServerMatch(initialTraditional[0]);
    const initialChosen = firstIsLatino ? initialTraditional[0] : (initialTraditional.find((s) => isLatinoServerMatch(s)) || initialTraditional[0]);
    if (initialChosen) {
      setSelectedServerName(initialChosen.name);
      if (initialChosen.type !== 'iframe' && initialChosen.url) {
        setVideoSrc(initialChosen.url);
      } else {
        setVideoSrc('');
      }
      setIsResolving(false);
    } else {
      setIsResolving(true);
    }
    console.log(`[VideoPlayer] [Direct HLS] Consultando stream directo nativo en ${directUrl} (initialChosen="${initialChosen?.name || 'ninguno'}")...`);

    const loadTraditionalServers = () => {
      const persisted = getPersistedSuccessServer(media, resolveType);
      const hasHlsFav = Boolean(persisted && (persisted.playable === 'hls' || persisted.type === 'hls'));

      if (hasHlsFav) {
        console.log(`[VideoPlayer] [ARRANQUE] Favorito HLS detectado para "${currentTitle}": "${persisted?.name}" (id=${persisted?.id}). Montando HLS directo sin preview.`);
        setIsResolving(true);
      } else {
        console.log(`[VideoPlayer] [ARRANQUE] Sin favorito HLS para "${currentTitle}". Montando preview tradicional.`);
        const fallbackSrv = generateServersForMedia({
          tmdbId: tmdbIdToUse,
          title: media.title,
          type: resolveType === 'anime' ? 'anime' : resolveType,
          season: selectedSeason,
          episode: selectedEpisode,
        })[0];
        if (fallbackSrv && autoAdvanceCountRef.current === 0 && failedServersForEpisodeRef.current.size === 0 && !userInteractedRef.current) {
          setSelectedServerName(fallbackSrv.name);
          if (fallbackSrv.type !== 'iframe') {
            setVideoSrc(fallbackSrv.url);
          }
        }
        setIsResolving(false);
      }

      console.log(`[VideoPlayer] Solicitando /api/resolve/play para "${currentTitle}" (tmdbId=${tmdbIdToUse}, tipo=${resolveType}, lang=latino, preferredId=${persisted?.id})...`);

      resolveServerPlay({
        providerId: (persisted as any)?.providerId || 'vidlink.pro',
        preferredServerId: persisted?.id,
        preferredServerName: persisted?.name,
        params: {
          type: resolveType,
          tmdbId: tmdbIdToUse,
          season: selectedSeason,
          episode: selectedEpisode,
        },
        lang: 'latino',
        signal: abortController.signal,
      })
        .then((playRes) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          resolveTimeRef.current = Date.now();
          const resolveMs = resolveTimeRef.current - mountTimeRef.current;
          console.log(`[PlaybackTiming] Resolve completado en ${resolveMs}ms (servidores=${playRes.servers?.length || 0})`);

          if (playRes && playRes.success && playRes.url) {
            const mapped: StreamServer[] = (playRes.servers || []).map((s) => ({
              name: s.name,
              url: String(s.id) === String(playRes.serverId) ? playRes.url : s.url,
              type: String(s.id) === String(playRes.serverId)
                ? (playRes.playable === 'hls' ? 'hls' : 'iframe')
                : (s.playable === 'hls' ? 'hls' : 'iframe'),
              language: s.lang || 'Latino',
              id: s.id,
              playable: String(s.id) === String(playRes.serverId) ? playRes.playable : s.playable,
              validated: String(s.id) === String(playRes.serverId) ? true : s.validated,
              popular: s.popular,
              picks: s.picks,
              acao: String(s.id) === String(playRes.serverId) ? playRes.acao : (s as any).acao,
              speedMs: String(s.id) === String(playRes.serverId) ? playRes.speedMs : (s as any).speedMs,
            } as any));

            setResolvedServers((prev) => {
              if (serversEpochRef.current !== epoch) return prev;
              const combined = [...mapped, ...(prev || [])];
              return deduplicateServers(combined, episodeKey);
            });

            const freshlyAcuñado: StreamServer = {
              name: playRes.name,
              url: playRes.url,
              type: playRes.playable === 'hls' ? 'hls' : 'iframe',
              language: 'Latino',
              id: playRes.serverId,
              playable: playRes.playable,
              validated: true,
              acao: playRes.acao,
              speedMs: playRes.speedMs,
            } as any;

            resolvedServerRef.current = freshlyAcuñado;

            if (hasHlsFav) {
              console.log(`[VideoPlayer] [HLS DIRECTO] Montando <video> con favorito ("${freshlyAcuñado.name}", id=${freshlyAcuñado.id})`);
              setSelectedServerName(freshlyAcuñado.name);
              setVideoSrc(freshlyAcuñado.url);
              setIsResolving(false);
            } else {
              if (previewFailedBeforePlayingRef.current) {
                console.log(`[VideoPlayer] [SWAP] Preview falló antes de reproducir -> cambiando a servidor resuelto "${freshlyAcuñado.name}" (playable=${freshlyAcuñado.playable})`);
                setSelectedServerName(freshlyAcuñado.name);
                setVideoSrc(freshlyAcuñado.url);
              } else {
                console.log(`[VideoPlayer] [NO REEMPLAZAR] Preview activo: NO se reemplaza. Se mantiene preview y se usará favorito en la próxima.`);
              }
            }
            setIsPlaying(true);
            setForceShowServerSelector(false);
          } else {
            console.warn(`[VideoPlayer] Falló resolución en /api/resolve/play: ${playRes?.error || 'URL vacía'}.`);
            if (serversEpochRef.current === epoch) {
              setIsResolving(false);
              if (!playRes?.servers?.length) {
                setResolvedServers([]);
              }
            }
          }
        })
        .catch((err) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          setIsResolving(false);
          setResolvedServers([]);
          console.warn(`[VideoPlayer] Excepción en /api/resolve/play:`, err?.message);
        });
    };

    animeAttemptCountRef.current = 0;
    const loadDirectStream = () => {
      console.log(`[VideoPlayer] [Direct HLS Fallback] Consultando stream directo nativo en ${directUrl}...`);
      fetch(directUrl, { signal: abortController.signal })
        .then(async (r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          if (data?.success && data?.url && typeof data.url === 'string' && data.url.includes('.m3u8')) {
            console.log(`[VideoPlayer] [Direct HLS] Stream nativo obtenido con éxito (${data.provider}): ${data.url}`);
            const directSrv: StreamServer = {
              id: `direct-hls-${data.provider}-${data.url}`,
              providerId: data.provider,
              name: `Direct HLS (${data.provider === 'framextv' ? 'FrameX' : 'VidLink'})`,
              url: data.url,
              type: 'hls',
              playable: 'hls',
              language: '🌐 Multi (Sub ES)',
              validated: true,
            };
            setDirectCaptions(Array.isArray(data.captions) ? data.captions : []);
            const traditionalServers = generateServersForMedia({
              tmdbId: tmdbIdToUse,
              title: media.title,
              type: resolveType === 'anime' ? 'anime' : resolveType,
              season: selectedSeason,
              episode: selectedEpisode,
            }).filter((s) => s.id !== 'direct-hls');
            const latinoServers = traditionalServers.filter((s) => isLatinoServerMatch(s));
            const nonLatinoServers = traditionalServers.filter((s) => !isLatinoServerMatch(s));
            const firstLatinoFailed =
              latinoServers.length > 0 &&
              failedServersForEpisodeRef.current.has(getServerEpisodeKey(latinoServers[0]));
            const hasRankedLatinoFirst =
              latinoServers.length > 0 &&
              isLatinoServerMatch(traditionalServers[0]) &&
              !firstLatinoFailed;
            if (!hasRankedLatinoFirst) {
              setSelectedServerName(directSrv.name);
              setVideoSrc(data.url);
            }
            setResolvedServers((prev) => {
              if (serversEpochRef.current !== epoch) return prev;
              const combined = [...latinoServers, directSrv, ...(prev || []), ...nonLatinoServers];
              return deduplicateServers(combined, episodeKey);
            });
            setIsResolving(false);
            setIsPlaying(true);
            setForceShowServerSelector(false);
            return;
          }

          console.log(`[VideoPlayer] [Direct HLS] No disponible -> cargando servidores tradicionales`);
          loadTraditionalServers();
        })
        .catch((err) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          console.warn(`[VideoPlayer] [Direct HLS] Error al obtener stream directo:`, err?.message);
          loadTraditionalServers();
        });
    };
    loadDirectStreamRef.current = loadDirectStream;

    const isAnime = media.category === 'anime' || resolveType === 'anime';

    if (isAnime) {
      const expectedRuntime = media.runtime || 24;
      const animeUrl = `/api/anime/servers?tmdbId=${tmdbIdToUse}&title=${encodeURIComponent(media.title)}&episode=${selectedEpisode}&runtime=${expectedRuntime}`;
      console.log(`[VideoPlayer] [Anime] Consultando Meta-Orquestador de Anime en ${animeUrl}...`);
      fetch(animeUrl, { signal: abortController.signal })
        .then(async (r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          if (data?.success && Array.isArray(data.servers) && data.servers.length > 0) {
            console.log(`[VideoPlayer] [Anime] ${data.servers.length} servidores especializados obtenidos.`);
            const animeServers: StreamServer[] = data.servers.map((s: any, idx: number) => ({
              id: s.id || `anime-${s.provider}-${s.name || idx}-${s.url}`,
              providerId: s.provider,
              name: s.name || `${s.provider.toUpperCase()} (${s.type === 'hls' ? 'HLS' : 'Embed'})`,
              url: s.url,
              type: s.type,
              playable: s.type === 'hls' ? 'hls' : 'iframe',
              language: s.language === 'latino' ? 'Latino' : 'Sub Español',
              validated: true,
              qualityScore: s.qualityScore,
            }));

            const traditionalServers = generateServersForMedia({
              tmdbId: tmdbIdToUse,
              title: media.title,
              type: 'anime',
              season: selectedSeason,
              episode: selectedEpisode,
            }).filter((s) => s.id !== 'direct-hls');

            setResolvedServers((prev) => {
              if (serversEpochRef.current !== epoch) return prev;
              const combined = [...animeServers, ...(prev || []), ...traditionalServers];
              return deduplicateServers(combined, episodeKey);
            });
            const first = animeServers[0];
            if (first) {
              setSelectedServerName(first.name);
              if (first.type !== 'iframe' && first.url) {
                setVideoSrc(first.url);
              }
            }
            setIsResolving(false);
            setIsPlaying(true);
            setForceShowServerSelector(false);
            return;
          }

          console.warn(`[VideoPlayer] [Anime] Ningún servidor de anime respondió o pasó validación.`);
          loadTraditionalServers();
        })
        .catch((err) => {
          if (!isMounted || serversEpochRef.current !== epoch) return;
          console.warn(`[VideoPlayer] [Anime] Error consultando /api/anime/servers:`, err?.message);
          loadTraditionalServers();
        });
    } else {
      loadDirectStream();
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [tmdbIdToUse, selectedSeason, selectedEpisode, isSeriesOrAnime, media.id, mediaKey, episode?.id, episode?.seasonNumber, episode?.episodeNumber]);

  const hasNoSpanishAudio = Boolean(detectedTracks && !detectedTracks.audio.includes('es'));

  const [tvSignalDown, setTvSignalDown] = useState<boolean>(false);
  const [allServersExhausted, setAllServersExhausted] = useState<boolean>(false);
  const autoSkipCountRef = useRef<number>(0);
  const consecutiveUnavailableCountRef = useRef<number>(0);
  const iframeLoadedAtRef = useRef<number>(Date.now());

  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_subtitles_pref') === '1';
    } catch {
      return false;
    }
  });
  const [seekUnsupported, setSeekUnsupported] = useState<boolean>(false);
  const seekUnsupportedRef = useRef<boolean>(false);
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);
  const resumeStateRef = useRef<ResumeState | null>(null);
  const [isEstimatedTime, setIsEstimatedTime] = useState<boolean>(false);
  const isEstimatedTimeRef = useRef<boolean>(false);
  const resumeControllerRef = useRef<ResumeController | null>(null);
  const normalAdvanceStreakRef = useRef<number>(0);
  const lastRealTimeRef = useRef<number>(0);
  useEffect(() => { isEstimatedTimeRef.current = isEstimatedTime; }, [isEstimatedTime]);
  useEffect(() => { seekUnsupportedRef.current = seekUnsupported; }, [seekUnsupported]);
  useEffect(() => { resumeStateRef.current = resumeState; }, [resumeState]);

  // Sincronizar estado de subtítulos nativos en elementos <track>
  useEffect(() => {
    if (!videoRef.current || !videoRef.current.textTracks) return;
    const tracks = videoRef.current.textTracks;

    // Si el usuario ya seleccionó manualmente una pista (mode === 'showing'), respetarla
    let hasUserSelectedTrack = false;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].mode === 'showing') {
        hasUserSelectedTrack = true;
        break;
      }
    }

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (subtitlesEnabled) {
        if (hasUserSelectedTrack) {
          // No pisar la selección manual del usuario
          continue;
        }
        // Prioridad: 1º Español, 2º Inglés, si no ninguna
        track.mode = i === defaultCaptionIndex ? 'showing' : 'hidden';
      } else {
        track.mode = 'disabled';
      }
    }
  }, [subtitlesEnabled, directCaptions, defaultCaptionIndex]);

  const [signalToast, setSignalToast] = useState<string | null>(null);
  const signalToastTimerRef = useRef<any>(null);

  const triggerSignalToast = useCallback((serverName: string) => {
    if (signalToastTimerRef.current) clearTimeout(signalToastTimerRef.current);
    const text =
      serverName.startsWith('Optimizando') ||
        serverName.startsWith('Señal') ||
        serverName.startsWith('Avance') ||
        serverName.startsWith('Buffer') ||
        serverName.startsWith('🏃') ||
        serverName.startsWith('Canal') ||
        serverName.startsWith('🛠️') ||
        serverName.startsWith('🛡️') ||
        serverName.startsWith('⚠️')
        ? serverName
        : `Optimizando señal... cambiando a ${serverName}`;
    setSignalToast(text);
    signalToastTimerRef.current = setTimeout(() => {
      setSignalToast(null);
    }, 3500);
  }, []);

  const activeServerIndex = useMemo(() => {
    if (!availableServers || availableServers.length === 0) return 0;

    // 1. Coincidencia con el seleccionado actual (máxima prioridad para selección manual o auto-avance)
    if (selectedServerName) {
      const matchIdx = availableServers.findIndex(
        (s) => s.name.toLowerCase() === selectedServerName.toLowerCase()
      );
      if (matchIdx !== -1) {
        return matchIdx;
      }
    }

    // 2. P2.5: Si el servidor elegido es latino y ya está rankeado primero, arranca directo
    if (isLatinoServerMatch(availableServers[0])) {
      return 0;
    }

    const firstLatinoIdx = availableServers.findIndex((s) => isLatinoServerMatch(s));
    if (firstLatinoIdx !== -1) {
      return firstLatinoIdx;
    }

    // 3. Si no hay latino, arranca el primero disponible
    return 0;
  }, [availableServers, selectedServerName]);

  const activeServer: StreamServer = availableServers[activeServerIndex] || availableServers[0] || {
    name: 'VidSrc ME (Principal HD)', url: currentVideoUrl, type: 'iframe', language: 'Multi-Audio',
  };

  const isIframeMode = activeServer.type === 'iframe';
  const [videoSrc, setVideoSrc] = useState<string>(activeServer?.url || '');
  const isMovieMasterEmbed = Boolean(
    (activeServer as any)?.providerId === 'moviemaster' ||
    (activeServer?.url && activeServer.url.includes('moviemaster.lat'))
  );

  const activeEmbedUrl = useMemo(() => {
    if (!activeServer?.url) return '';
    // PASO 1 (CENSURA): Validación de ID limpio (salvo en servidores locales/mock o directos)
    const isMockOrLocal = activeServer.url.includes('/api/') || activeServer.url.includes('localhost') || activeServer.url.includes('127.0.0.1') || activeServer.url.includes('192.168.');
    if (!isMockOrLocal) {
      const cleanId = String(tmdbIdToUse || '').replace(/[^0-9]/g, '');
      if (!cleanId || isNaN(Number(cleanId)) || Number(cleanId) <= 0) {
        console.error(`[VideoPlayer] ID inválido detectado para: "${currentTitle}" (cleanId=${cleanId})`);
        return ''; // Detiene la carga si el ID está corrupto
      }
    }
    const url = activeServer.url;
    if (url.includes('autoplay=')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}autoplay=1`;
  }, [activeServer, tmdbIdToUse, currentTitle]);

  // Referencias sincronizadas para evitar valores viejos por closures y evitar recrear HLS
  const subtitlesEnabledRef = useRef(subtitlesEnabled);
  const availableServersRef = useRef(availableServers);
  const activeServerIndexRef = useRef(activeServerIndex);
  const selectedSeasonRef = useRef(selectedSeason);
  const selectedEpisodeRef = useRef(selectedEpisode);
  const mediaRef = useRef(media);
  const activeServerRef = useRef(activeServer);
  const triggerSignalToastRef = useRef(triggerSignalToast);
  const onBroadcastStateRef = useRef(onBroadcastState);
  const handleSelectServerRef = useRef<(idx: number, opts?: { auto?: boolean }) => void>(() => { });
  const advanceToNextServerRef = useRef<(reason: string) => void>(() => { });

  subtitlesEnabledRef.current = subtitlesEnabled;
  availableServersRef.current = availableServers;
  if (typeof window !== 'undefined') {
    (window as any).__availableServers = availableServers;
    (window as any).__activeServerIndex = activeServerIndex;
    (window as any).__activeServerName = activeServer?.name;
    (window as any).__videoPlayerState = {
      selectedSeason,
      selectedEpisode,
      currentTitle,
      availableServers,
      activeServerIndex,
      activeServerName: activeServer?.name,
      activeServerUrl: activeServer?.url,
    };
  }
  activeServerIndexRef.current = activeServerIndex;
  selectedSeasonRef.current = selectedSeason;
  selectedEpisodeRef.current = selectedEpisode;
  mediaRef.current = media;
  activeServerRef.current = activeServer;
  triggerSignalToastRef.current = triggerSignalToast;
  onBroadcastStateRef.current = onBroadcastState;

  // Resolución dinámica de Jimov Latino con auto-fallback
  useEffect(() => {
    if (activeServer && (activeServer.id === 'jimov-latino' || (activeServer.url && activeServer.url.includes('/api/anime/jimov')))) {
      let isCancelled = false;
      fetch(activeServer.url)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (isCancelled) return;
          if (!data?.servers?.length) {
            console.warn('[VideoPlayer] [Jimov] Sin servidores disponibles -> avanzando al siguiente');
            advanceToNextServerRef.current?.('Jimov sin servidores disponibles');
            return;
          }
          const first = data.servers[0];
          if (first?.url && first.url !== videoSrc) {
            console.log(`[VideoPlayer] [Jimov] Servidor resuelto: ${first.name} -> ${first.url}`);
            setVideoSrc(first.url);
          }
        })
        .catch((err) => {
          if (isCancelled) return;
          console.warn('[VideoPlayer] Error resolviendo Jimov Latino:', err?.message);
          advanceToNextServerRef.current?.('Error resolviendo Jimov Latino');
        });
      return () => {
        isCancelled = true;
      };
    }
  }, [activeServer, videoSrc]);

  const isAnimeIframe = Boolean(
    activeServer?.type === 'iframe' &&
    activeServer?.url &&
    (
      (activeServer as any).providerId === 'animeav1' ||
      (activeServer as any).providerId === 'jkanime' ||
      (activeServer as any).providerId === 'animeflv' ||
      String(activeServer.id || '').startsWith('anime-') ||
      media.category === 'anime' ||
      resolveType === 'anime'
    )
  );

  // TAREA C: Desactivada la llamada a startGhostExtraction para contenido de anime
  // El orquestador del backend valida los streams HLS directamente con validator.ts.
  // Si el orquestador devuelve un iframe (ej. Cloudflare en el sitio), se reproduce en modo visible
  // para que el usuario pueda interactuar y resolver el captcha si es necesario.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Si es anime, desactivar extracción fantasma; el reproductor renderiza el iframe visiblemente
    if (isAnimeIframe || media.category === 'anime' || resolveType === 'anime') {
      setIsGhostExtracting(false);
      window.electronAPI?.stopGhostExtraction?.();
      return;
    }

    setIsGhostExtracting(false);
    window.electronAPI?.stopGhostExtraction?.();
  }, [isAnimeIframe, activeServer?.url, activeServer?.id, media.category, resolveType]);

  // Listener del Extractor Fantasma para capturar stream directo .m3u8/.mp4 y retos de seguridad
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onGhostStreamFound) return;

    const unsubFound = window.electronAPI.onGhostStreamFound((payload) => {
      console.log(`[GhostSniffer] ¡Stream .m3u8/.mp4 detectado en ventana invisible! ->`, payload.url);
      setIsGhostExtracting(false);
      setCaptchaRequired(false);
      setForceVisibleIframeForCaptcha(false);

      if (payload.url) {
        setVideoSrc(payload.url);
        // Actualizar el servidor activo a HLS nativo
        setResolvedServers((prev) => {
          if (!prev) return prev;
          const currentEpKey = isSeriesOrAnime
            ? `${media.id}_s${selectedSeasonRef.current}_e${selectedEpisodeRef.current}`
            : `${media.id}_movie`;
          const updated = prev.map((s) => {
            const isMatch = s.name === activeServerRef.current.name || (s as any).id === (activeServerRef.current as any).id;
            if (isMatch) {
              return {
                ...s,
                url: payload.url,
                type: 'hls' as const,
                playable: 'hls' as const,
                name: `${(s as any).providerId ? String((s as any).providerId).toUpperCase() : 'ANIME'} (Directo HLS)`,
              } as StreamServer;
            }
            return s;
          });
          return deduplicateServers(updated, currentEpKey);
        });
      }
    });

    const unsubTimeout = window.electronAPI.onGhostStreamTimeout?.((payload) => {
      console.warn(`[GhostSniffer] Timeout al extraer stream de:`, payload?.originalUrl);
      setIsGhostExtracting(false);
      advanceToNextServerRef.current?.('Ghost sniffer timeout');
    });

    const unsubCaptcha = window.electronAPI.onGhostCaptchaDetected?.((payload) => {
      console.warn(`[GhostSniffer] Desafío de Cloudflare / Captcha detectado en:`, payload?.url);
      setIsGhostExtracting(false);
      setCaptchaRequired(true);
    });

    return () => {
      unsubFound?.();
      unsubTimeout?.();
      unsubCaptcha?.();
    };
  }, []);

  // ── Bloque 3: P3.1 & P2.6 — Watchdog de estados de espera y disponibilidad (6s para no disponible, 8s para embed sin frame en Electron, 20s general) ──
  useEffect(() => {
    const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.electronAPI);
    const waitingForEmbedFrame = hasElectronBridge && isIframeMode && !firstFrameTimeRef.current;
    if (!isGhostExtracting && !captchaRequired && !isResolving && !unavailableWarning && !waitingForEmbedFrame) {
      return;
    }

    const budgetMs = unavailableWarning
      ? 6000
      : waitingForEmbedFrame
        ? 8000
        : 20000;

    const timer = setTimeout(() => {
      if (waitingForEmbedFrame && firstFrameTimeRef.current > 0 && !unavailableWarning && !isGhostExtracting && !captchaRequired && !isResolving) {
        return;
      }
      const causeLabel = unavailableWarning
        ? 'Aún no está disponible (presupuesto 6s agotado)'
        : waitingForEmbedFrame
          ? 'Timeout de embed sin frame (>8s)'
          : 'Timeout de estado de espera (>20s)';
      console.warn(`[VideoPlayer] [WATCHDOG] ${causeLabel}. Liberando estados y rotando servidor...`);
      setIsResolving(false);
      setIsGhostExtracting(false);
      setCaptchaRequired(false);
      setForceVisibleIframeForCaptcha(false);
      setUnavailableWarning(false);
      window.electronAPI?.stopGhostExtraction?.();

      const servers = availableServersRef.current || [];
      const currentIdx = activeServerIndexRef.current;
      const currentSrv = servers[currentIdx];
      if (currentSrv && unavailableWarning) {
        unavailableServersForEpisodeRef.current.add(getServerEpisodeKey(currentSrv));
      }
      advanceToNextServerRef.current?.(causeLabel);
    }, budgetMs);

    return () => clearTimeout(timer);
  }, [isGhostExtracting, captchaRequired, isResolving, unavailableWarning, isIframeMode, activeEmbedUrl, videoSrc, iframeReloadKey, autoCommitDoneAt, tmdbIdToUse, resolveType, triggerSignalToast, getServerEpisodeKey]);

  // TAREA 6: Timeout de 12 segundos para la verificación de audio en embed
  const [audioCheckTimedOut, setAudioCheckTimedOut] = useState<boolean>(false);
  useEffect(() => {
    setAudioCheckTimedOut(false);
    const timer = setTimeout(() => {
      setAudioCheckTimedOut(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, [videoSrc]);

  // TAREA 5: Modo Maratón persistente
  const [marathonMode, setMarathonMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_marathon_mode') === 'true';
    } catch {
      return false;
    }
  });

  const toggleMarathonMode = () => {
    setMarathonMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinecast_marathon_mode', String(next));
      } catch (_) { }
      triggerSignalToast(next ? '🏃 Modo Maratón ACTIVADO' : 'Modo Maratón Desactivado');
      return next;
    });
  };

  useEffect(() => {
    const onMarathon = (e: Event) => {
      const custom = e as CustomEvent<{ enabled?: boolean }>;
      const nextVal =
        typeof custom.detail?.enabled === 'boolean'
          ? custom.detail.enabled
          : typeof window !== 'undefined' && localStorage.getItem('cinecast_marathon_mode') === 'true';
      setMarathonMode(nextVal);
      onBroadcastState?.({ marathon: nextVal });
    };
    window.addEventListener('cinecast:marathon', onMarathon);
    return () => window.removeEventListener('cinecast:marathon', onMarathon);
  }, [onBroadcastState]);

  useEffect(() => {
    (window as any).electronAPI?.setPlayerServers?.(
      availableServers.map((s) => ({
        name: s.name,
        url: s.url,
        type: s.type,
        language: s.language,
      }))
    );
  }, [availableServers]);

  useEffect(() => {
    return () => {
      (window as any).electronAPI?.endLoadTrace?.();
    };
  }, []);

  // Limpieza de estados de error y flags de seguridad al cambiar de servidor activo (P3.2)
  useEffect(() => {
    setCaptchaRequired(false);
    setIsGhostExtracting(false);
    setForceVisibleIframeForCaptcha(false);
    setAllServersExhausted(false);
    setUnavailableWarning(false);
    setTvSignalDown(false);
    setManualRetryCount(0);
  }, [activeServer, activeServerIndex, selectedServerName]);

  // Tarea A: Log diagnóstico obligatorio antes de inyectar iframe src
  useEffect(() => {
    if (isIframeMode && activeEmbedUrl) {
      console.log(
        `[Embed] titulo="${currentTitle}" tmdbId=${tmdbIdToUse} tipo=${isSeriesOrAnime ? 'series' : 'movie'} servidor="${activeServer.name}" url="${activeEmbedUrl}"`
      );
    }
  }, [isIframeMode, activeEmbedUrl, currentTitle, tmdbIdToUse, isSeriesOrAnime, activeServer.name]);

  // ── Pre-conexión rápida (preconnect & dns-prefetch para ahorrar 400-800ms) ───
  useEffect(() => {
    if (!activeServer?.url) return;
    const origins = new Set<string>();
    try {
      const activeOrigin = new URL(activeServer.url).origin;
      if (activeOrigin.startsWith('http')) origins.add(activeOrigin);
    } catch (_) { }

    if (availableServers.length > 1) {
      const nextSrv = availableServers[(activeServerIndex + 1) % availableServers.length];
      if (nextSrv?.url) {
        try {
          const nextOrigin = new URL(nextSrv.url).origin;
          if (nextOrigin.startsWith('http')) origins.add(nextOrigin);
        } catch (_) { }
      }
    }

    const injectedLinks: HTMLElement[] = [];
    origins.forEach((origin) => {
      if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
        const preconn = document.createElement('link');
        preconn.rel = 'preconnect';
        preconn.href = origin;
        preconn.crossOrigin = 'anonymous';
        document.head.appendChild(preconn);
        injectedLinks.push(preconn);

        const dns = document.createElement('link');
        dns.rel = 'dns-prefetch';
        dns.href = origin;
        document.head.appendChild(dns);
        injectedLinks.push(dns);
      }
    });

    return () => {
      injectedLinks.forEach((l) => l.remove());
    };
  }, [activeServer, activeServerIndex, availableServers]);

  // ── Reset al cambiar de título / capítulo ────────────────────────────────
  useEffect(() => {
    const nextEpisodeKey = `${media.id}:${episode?.id || ''}:${selectedSeason}:${selectedEpisode}`;
    if (prevEpisodeKeyRef.current !== null && prevEpisodeKeyRef.current !== nextEpisodeKey) {
      setIframeReloadKey((k) => k + 1);
    }
    prevEpisodeKeyRef.current = nextEpisodeKey;
    setCurrentTime(0);
    setHasAutoSkippedIntro(false);
    setCountdownToNext(null);
    setFallbackActive(false);
    setCfWarning(false);
    setUnavailableWarning(false);
    setManualRetryCount(0);
    consecutiveUnavailableCountRef.current = 0;
    autoSkipCountRef.current = 0;
    autoAdvanceCountRef.current = 0;
    autoAdvancedChapterGuardRef.current = null;
    userInteractedRef.current = false;
    autoCommittedKeyRef.current = null;
    failedServersForEpisodeRef.current.clear();
    unavailableServersForEpisodeRef.current.clear();
    retryCountByServerEpisodeRef.current.clear();
    iframeStallTicksRef.current = 0;
    setForceShowServerSelector(false);
    if (loadedMetadataTimerRef.current) {
      clearTimeout(loadedMetadataTimerRef.current);
      loadedMetadataTimerRef.current = null;
    }
    iframeLoadedAtRef.current = Date.now();
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
    isRotatingRef.current = false;
    setCorsMode(true);
    simulatedTimeRef.current = 0;
    corsRetryRef.current = 0;
    cfAttemptRef.current = 0;
    (window as any).electronAPI?.startLoadTrace?.({
      title: currentTitle,
      firstServerName: activeServer?.name || '',
      firstServerUrl: activeEmbedUrl || activeServer?.url || '',
    });
  }, [media.id, episode?.id, selectedSeason, selectedEpisode]);

  // ── Sincronizar fuente cuando el servidor activo es directo (mp4/hls) ────
  useEffect(() => {
    if (activeServer && activeServer.type !== 'iframe') {
      setVideoSrc(activeServer.url);
    }
  }, [activeServer]);

  // ── Cabeceras del stream IPTV (referrer / user_agent de iptv-org) ────────
  useEffect(() => {
    if (isIframeMode || !videoSrc) return;
    const api = window.electronAPI;
    if (!api?.setStreamHeaders) return;
    const srv = activeServer as any;
    api.setStreamHeaders({
      url: videoSrc,
      referrer: srv.referrer ?? media.streamReferrer ?? null,
      userAgent: srv.userAgent ?? media.streamUserAgent ?? null,
    });
  }, [videoSrc, isIframeMode, activeServer, media]);

  // ── Motor de audio: reset + init (obligatorio en cada cambio de elemento) ─
  useEffect(() => {
    if (isIframeMode) return;
    const v = videoRef.current;
    if (!v) return;
    globalAudioEngine.reset();
    globalAudioEngine.init(v);
    globalAudioEngine.applySettings(audioSettings);
  }, [videoSrc, isIframeMode, corsMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => globalAudioEngine.reset(), []);

  // ── Volumen / mute (una sola vía: el motor decide dónde aplicarlo) ───────
  useEffect(() => {
    if (isIframeMode) return;
    globalAudioEngine.applySettings(audioSettings);
    if (videoRef.current) {
      const vol = Math.max(0, Math.min(1, (audioSettings.volume ?? 100) / 100));
      videoRef.current.volume = vol;
      videoRef.current.muted = Boolean(audioSettings.isMuted);
    }
  }, [audioSettings.volume, audioSettings.isMuted, audioSettings.preset, isIframeMode]);

  // ── Anti pop-ups del iframe (Tarea D: Permite popups si Modo Diagnóstico está ON) ─
  useEffect(() => {
    const originalWindowOpen = window.open;
    window.open = function (url?: string | URL, target?: string, features?: string) {
      if (document.activeElement?.tagName === 'IFRAME') {
        if (diagnosticService.isEnabled()) {
          console.log('[DIAG] window.open permitido en Modo Diagnóstico:', url);
          return originalWindowOpen.call(window, url, target, features);
        }
        console.warn('[CineCast Anti-Popup] Bloqueada:', url);
        return null;
      }
      return originalWindowOpen.call(window, url, target, features);
    };
    const handleCaptureClick = () => {
      if (document.activeElement?.tagName === 'IFRAME') setTimeout(() => window.focus(), 50);
    };
    window.addEventListener('click', handleCaptureClick, true);
    return () => {
      window.removeEventListener('click', handleCaptureClick, true);
      window.open = originalWindowOpen;
    };
  }, []);

  // ── Error de vídeo: reintento sin CORS y luego fallback visible ──────────
  const handleSelectServer = useCallback((index: number, opts?: { auto?: boolean }) => {
    const serversList = availableServersRef.current.length > 0 ? availableServersRef.current : availableServers;
    if (index < 0 || index >= serversList.length) return;
    const srv = serversList[index];
    if (!opts?.auto) {
      userInteractedRef.current = true;
      cfAttemptRef.current = 0;
      autoSkipCountRef.current = 0;
      consecutiveUnavailableCountRef.current = 0;
      setAllServersExhausted(false);
      if (rotateTimerRef.current) {
        clearTimeout(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
      isRotatingRef.current = false;
    }
    activeServerIndexRef.current = index;
    setSelectedServerName(srv.name);
    setCaptchaRequired(false);
    setIsGhostExtracting(false);
    setForceVisibleIframeForCaptcha(false);
    setDetectedTracks(null);
    setTvSignalDown(false);
    iframeLoadedAtRef.current = Date.now();
    (window as any).electronAPI?.recordLoadTraceEvent?.({
      kind: 'server_tried',
      name: srv.name,
      url: srv.url,
    });
    try {
      localStorage.setItem(PREFERRED_SERVER_STORAGE_KEY, srv.name);
    } catch (_) { }
    const isLat = isLatinoServerMatch(srv);
    audioPrefs.setForMedia(mediaKey, srv.name, isLat ? 'latino' : 'sub', selectedSeason, selectedEpisode);
    setIframeReloadKey((k) => k + 1);
    setSeekUnsupported(false);
    setResumeState(null);
    normalAdvanceStreakRef.current = 0;
    setCfWarning(false);
    setUnavailableWarning(false);
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
    if (tmdbIdToUse > 0 && !srv.url) {
      const srvId = (srv as any).id ?? srv.name;
      resolveServerPlay({
        providerId: (srv as any)?.providerId || 'vidlink.pro',
        serverId: srvId,
        params: {
          type: resolveType,
          tmdbId: tmdbIdToUse,
          season: selectedSeason,
          episode: selectedEpisode,
        },
        lang: 'latino',
      })
        .then((playRes) => {
          if (playRes && playRes.success && playRes.url) {
            srv.url = playRes.url;
            srv.type = playRes.playable === 'hls' ? 'hls' : 'iframe';
            (srv as any).playable = playRes.playable;
            (srv as any).acao = playRes.acao;
            (srv as any).validated = true;
            if (srv.type !== 'iframe') {
              setCorsMode(true);
              corsRetryRef.current = 0;
              setVideoSrc(srv.url);
            }
            setIframeReloadKey((k) => k + 1);
          }
        })
        .catch(() => { });
    }

    if (srv.type !== 'iframe' && srv.url) {
      setCorsMode(true);
      corsRetryRef.current = 0;
      setVideoSrc(srv.url);
    }
    const cleanRoute = extractCleanRouteAndEp(srv.url);
    const isIgnoreEp = Boolean(srv.url && srv.url.includes('ignoreep=1'));
    onBroadcastState?.({
      activeServerIndex: index,
      activeServerName: srv.name,
      activeServerType: srv.type,
      servers: availableServers,
      detectedTracks: null,
      loadedUrl: cleanRoute.hostAndPath || undefined,
      loadedSeason: cleanRoute.season,
      loadedEpisode: cleanRoute.episode,
      providerEpisodeMismatchWarning: isIgnoreEp,
    });
    setIsPlaying(true);
    setForceShowServerSelector(false);
  }, [availableServers, onBroadcastState, mediaKey, selectedSeason, selectedEpisode]);
  handleSelectServerRef.current = handleSelectServer;

  // ── Tarea E: Auto-rotate con back-off progresivo (2s / 4s / 8s) y max 3 rotaciones seguidas ──
  const rotateTimerRef = useRef<any>(null);
  const isRotatingRef = useRef<boolean>(false);

  const rotateWithBackoff = useCallback((reason: string) => {
    if (isRotatingRef.current) return;
    if (autoSkipCountRef.current >= 3 || availableServersRef.current.length <= 1) {
      setAllServersExhausted(true);
      return;
    }

    const currentSkip = autoSkipCountRef.current; // 0, 1, 2
    autoSkipCountRef.current += 1;
    const delays = [2000, 4000, 8000];
    const delay = delays[currentSkip] || 8000;

    const nextIdx = (activeServerIndexRef.current + 1) % availableServersRef.current.length;
    const nextSrv = availableServersRef.current[nextIdx];

    console.warn(
      `[Auto-Rotate][${new Date().toISOString()}] (Rotación ${autoSkipCountRef.current}/3, back-off ${delay}ms) Motivo: ${reason} | Servidor: ${activeServer?.name} -> Siguiente: ${nextSrv?.name}`
    );
    (window as any).electronAPI?.recordLoadTraceEvent?.({
      kind: 'rotation',
      method: 'rotateWithBackoff',
      reason,
      elapsedSec: Number(((Date.now() - iframeLoadedAtRef.current) / 1000).toFixed(2)),
    });

    triggerSignalToast(`Rotando servidor en ${delay / 1000}s...`);
    isRotatingRef.current = true;

    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    rotateTimerRef.current = setTimeout(() => {
      isRotatingRef.current = false;
      if (nextSrv) {
        triggerSignalToast(nextSrv.name);
        handleSelectServer(nextIdx, { auto: true });
      }
    }, delay);
  }, [handleSelectServer, triggerSignalToast]);

  // ── Requisito 3: Auto-avance (máximo 3 avances, con logging de id del servidor) ──
  const advanceToNextServer = useCallback((reason: string) => {
    // Si el error proviene de GUEST_VIEW_MANAGER_CALL o Script failed to execute, ignorar por completo
    const lowerReason = (reason || '').toLowerCase();
    if (
      lowerReason.includes('guest_view_manager_call') ||
      lowerReason.includes('script failed to execute') ||
      lowerReason.includes('findguest')
    ) {
      console.warn(`[AutoAdvance] Error interno de Electron ignorado: ${reason}`);
      return;
    }

    if (captchaRequired && !lowerReason.includes('timeout')) {
      console.log(`[AutoAdvance] Pausado por verificación de seguridad / Captcha en curso.`);
      return;
    }

    if (loadedMetadataTimerRef.current) {
      clearTimeout(loadedMetadataTimerRef.current);
      loadedMetadataTimerRef.current = null;
    }

    const servers = availableServersRef.current;
    const currentIdx = activeServerIndexRef.current;
    const currentSrv = servers[currentIdx];
    const currentId = (currentSrv as any)?.id ?? currentSrv?.name ?? 'desconocido';

    // Requisito 3: Si el preview falló antes de reproducir, realizar swap con el servidor resuelto
    const isPreviewServer = !hasHlsFav && (currentSrv?.name === 'VidLink Pro' || (currentSrv as any)?.id === undefined);
    if (!algoReproduciendoRegisteredRef.current && isPreviewServer) {
      previewFailedBeforePlayingRef.current = true;
      if (resolvedServerRef.current && String((resolvedServerRef.current as any).id) !== String(currentId)) {
        console.log(`[VideoPlayer] [SWAP] Preview falló (${reason}) antes de reproducir -> swap inmediato a servidor resuelto "${resolvedServerRef.current.name}"`);
        setSelectedServerName(resolvedServerRef.current.name);
        if (resolvedServerRef.current.playable === 'hls' || resolvedServerRef.current.type !== 'iframe') {
          setVideoSrc(resolvedServerRef.current.url);
        }
        return;
      }
    }

    console.warn(`[AutoAdvance] Falla en servidor id="${currentId}" (${currentSrv?.name}): ${reason}`);

    if (tmdbIdToUse > 0 && currentId) {
      reportServerPlaybackPenalty({
        providerId: (currentSrv as any)?.providerId || 'vidlink.pro',
        tmdbId: tmdbIdToUse,
        type: resolveType,
        serverId: currentId,
        penaltyMs: 15000,
        reason,
      });
      console.log(`[VideoPlayer] [PENALIZACIÓN] Servidor "${currentSrv?.name}" (id=${currentId}) penalizado por auto-avance: ${reason}`);

      const animeProv = (currentSrv as any)?.providerId;
      if (animeProv && (animeProv === 'animeav1' || animeProv === 'jkanime' || animeProv === 'animeflv' || String((currentSrv as any)?.id || '').startsWith('anime-'))) {
        const prov = animeProv || (currentSrv as any)?.id?.split('-')?.[1] || 'anime';
        fetch('/api/report-anime-failure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: prov,
            tmdbId: tmdbIdToUse,
            episode: selectedEpisode,
          }),
        }).catch(() => { });
        console.log(`[VideoPlayer] [Anime Quality] Reportado fallo para proveedor ${prov} (ep=${selectedEpisode})`);

        animeAttemptCountRef.current += 1;
        if (animeAttemptCountRef.current >= 3) {
          console.warn(`[VideoPlayer] [Anime] 3 intentos de servidores de anime fallaron.`);
          triggerSignalToast('Fuentes de anime no disponibles.');
          setAllServersExhausted(true);
          return;
        }
      }
    }

    if (currentSrv) {
      const epSrvKey = getServerEpisodeKey(currentSrv);
      failedServersForEpisodeRef.current.add(epSrvKey);
      if (lowerReason.includes('disponible') || lowerReason.includes('no hay opciones')) {
        unavailableServersForEpisodeRef.current.add(epSrvKey);
      }
    }

    let nextIdx = -1;
    for (let offset = 1; offset <= servers.length; offset++) {
      const candidateIdx = (currentIdx + offset) % servers.length;
      const candidateSrv = servers[candidateIdx];
      const candidateKey = getServerEpisodeKey(candidateSrv);
      if (!failedServersForEpisodeRef.current.has(candidateKey)) {
        nextIdx = candidateIdx;
        break;
      }
    }

    if (nextIdx === -1 || servers.length <= 1) {
      console.warn(`[AutoAdvance] Todos los servidores disponibles probados (${servers.length}) para este capítulo sin repetir servidor fallido. Fin de la lista.`);
      setShowControls(true);
      setForceShowServerSelector(true);
      setAllServersExhausted(true);
      return;
    }

    const nextSrv = servers[nextIdx];
    const nextId = (nextSrv as any)?.id ?? nextSrv?.name ?? 'desconocido';
    activeServerIndexRef.current = nextIdx;
    autoAdvanceCountRef.current += 1;

    console.log(`[AutoAdvance] Avance #${autoAdvanceCountRef.current} al servidor id="${nextId}" (${nextSrv?.name})`);

    triggerSignalToast(`Avance #${autoAdvanceCountRef.current}: Conectando a ${nextSrv.name}...`);

    if (tmdbIdToUse > 0 && !nextSrv.url) {
      console.log(`[AutoAdvance] Acuñando servidor id="${nextId}" (${nextSrv?.name}) en /api/resolve/play...`);
      resolveServerPlay({
        providerId: (nextSrv as any)?.providerId || 'vidlink.pro',
        serverId: nextId,
        params: {
          type: resolveType,
          tmdbId: tmdbIdToUse,
          season: selectedSeason,
          episode: selectedEpisode,
        },
        lang: 'latino',
      })
        .then((playRes) => {
          if (playRes && playRes.success && playRes.url) {
            nextSrv.url = playRes.url;
            nextSrv.type = playRes.playable === 'hls' ? 'hls' : 'iframe';
            (nextSrv as any).playable = playRes.playable;
            (nextSrv as any).acao = playRes.acao;
            (nextSrv as any).validated = true;
            const currentEpKey = isSeriesOrAnime
              ? `${media.id}_s${selectedSeason}_e${selectedEpisode}`
              : `${media.id}_movie`;
            setResolvedServers((prev) =>
              prev ? deduplicateServers(prev.map((s) => (String((s as any).id) === String(nextId) ? { ...s, ...nextSrv } : s)), currentEpKey) : prev
            );
            setIsResolving(false);
            handleSelectServer(nextIdx, { auto: true });
          } else {
            console.warn(`[AutoAdvance] Falló acuñación de id="${nextId}": ${playRes?.error || 'URL vacía'}. Reintentando con siguiente servidor...`);
            advanceToNextServer('Error al acuñar servidor en auto-avance');
          }
        })
        .catch((err) => {
          console.warn(`[AutoAdvance] Excepción acuñando id="${nextId}":`, err?.message);
          advanceToNextServer('Excepción al acuñar servidor');
        });
      return;
    }

    handleSelectServer(nextIdx, { auto: true });
  }, [handleSelectServer, triggerSignalToast, tmdbIdToUse, resolveType, selectedSeason, selectedEpisode]);
  advanceToNextServerRef.current = advanceToNextServer;

  // ── PASO 2 (CENSURA): Rotación inmediata al siguiente servidor espejo ──
  const rotateToNextServer = useCallback((reason = 'Fallo de carga o timeout en webview') => {
    advanceToNextServer(reason);
  }, [advanceToNextServer]);

  // ── Error de vídeo: reintento sin CORS y luego fallback / auto-rotación ──
  const handleVideoError = useCallback((err?: any) => {
    if (isIframeMode) {
      console.warn('[VideoPlayer] Error ignorado en modo iframe (GUEST_VIEW_MANAGER_CALL o fallo webview):', err);
      return;
    }

    const errorStr = (typeof err === 'string' ? err : String(err?.message || err?.error || err?.type || '')).toLowerCase();
    if (
      errorStr.includes('guest_view_manager_call') ||
      errorStr.includes('script failed to execute') ||
      errorStr.includes('findguest')
    ) {
      console.warn('[VideoPlayer] Error interno de Electron ignorado en handleVideoError:', err);
      return;
    }

    const isHls = activeServer.type === 'hls' || Boolean(videoSrc && videoSrc.includes('.m3u8'));

    // TAREA A & C: En modo HLS nativo, si ocurre un error, verificar si el video avanza
    if (isHls) {
      if (hlsErrorTimeoutRef.current) {
        clearTimeout(hlsErrorTimeoutRef.current);
        hlsErrorTimeoutRef.current = null;
      }

      const v = videoRef.current;
      const isFatalVideoError = Boolean(v?.error) || errorStr.includes('fatal') || errorStr.includes('abort') || errorStr.includes('fallo');
      if (isFatalVideoError) {
        console.warn(`[VideoPlayer] Error HLS fatal en video: ${errorStr || v?.error?.message} -> rotando servidor`);
        advanceToNextServer(`Fallo fatal de reproducción HLS (${errorStr || 'video error'})`);
        return;
      }

      const lastTime = v?.currentTime || 0;
      console.log('[VideoPlayer] Error en modo HLS nativo detectado: esperando 3s para verificar si el video avanza...');
      hlsErrorTimeoutRef.current = setTimeout(() => {
        hlsErrorTimeoutRef.current = null;
        const currentV = videoRef.current;
        if (currentV && currentV.currentTime > lastTime) {
          console.log(`[VideoPlayer] Video HLS avanzó (currentTime=${currentV.currentTime}s > ${lastTime}s) tras 3s: ignorando error transitorio.`);
          setAllServersExhausted(false);
          setUnavailableWarning(false);
          setTvSignalDown(false);
          return;
        }

        console.warn('[VideoPlayer] Video HLS no avanzó tras 3s: rotando al siguiente servidor automáticamente...');
        advanceToNextServer('Fallo de reproducción HLS nativo (timeout 3s sin avance)');
      }, 3000);
      return;
    }

    // Para deportes / IPTV sin HLS
    if (media.category === 'live_tv') {
      triggerSignalToast('Canal caído, probando alternativa...');
      advanceToNextServer('Fallo de señal en vivo');
      return;
    }
    if (corsMode && videoSrc && !videoSrc.includes('.m3u8') && corsRetryRef.current === 0) {
      corsRetryRef.current += 1;
      console.warn('[VideoPlayer] Host sin CORS -> reintento sin crossOrigin');
      setCorsMode(false);
      return;
    }
    if (availableServers.length > 1) {
      advanceToNextServer('error de reproducción de video');
      return;
    }
    if (videoSrc !== FALLBACK_SRC) {
      console.warn('[VideoPlayer] Fuente inaccesible -> clip de prueba');
      setFallbackActive(true);
      setVideoSrc(FALLBACK_SRC);
    }
  }, [activeServer.type, activeServer.name, videoSrc, media.category, availableServers, activeServerIndex, corsMode, advanceToNextServer, handleSelectServer, triggerSignalToast]);



  // ── PASO 3 (CENSURA): Watchdog proactivo "Anti-Bloqueo" (buffer stalls & auto-rotate) ──
  useEffect(() => {
    if (isIframeMode || !videoRef.current) return;
    if (isIframeMode || !videoRef.current || activeServer?.type === 'hls' || (activeServer as any)?.playable === 'hls') return;
    const v = videoRef.current;
    let lastTime = -1;
    let stallChecks = 0;

    const checkHealth = () => {
      // Si el usuario pausó voluntariamente o no estamos en reproducción activa, reseteamos
      if (!v || v.paused || !isPlaying) {
        stallChecks = 0;
        return;
      }

      // Si el video está supuestamente reproduciéndose pero currentTime no avanza
      const isTimeStalled = Math.abs(v.currentTime - lastTime) < 0.15;
      if (isTimeStalled) {
        if (v.buffered.length > 0) {
          const end = v.buffered.end(v.buffered.length - 1);
          const start = v.buffered.start(0);
          // Si el buffer no crece o la ventana de búfer es < 1s
          if (end - start < 1 || v.readyState < 3) {
            stallChecks += 1;
          }
        } else {
          stallChecks += 1;
        }
      } else {
        stallChecks = 0;
        lastTime = v.currentTime;
      }

      // Si lleva 3 sondeos consecutivos (6 segundos) estancado
      if (stallChecks >= 3) {
        console.warn(`[Watchdog Proactivo] Servidor estancado >6s (${activeServer?.name}) -> rotando automáticamente`);
        stallChecks = 0;
        if (availableServersRef.current.length > 1) {
          const nextIdx = (activeServerIndexRef.current + 1) % availableServersRef.current.length;
          const nextSrv = availableServersRef.current[nextIdx];
          if (nextSrv) {
            triggerSignalToast(`Buffer estancado -> Conectando a ${nextSrv.name}...`);
            handleSelectServer(nextIdx, { auto: true });
          }
        }
      }
    };

    const healthInterval = setInterval(checkHealth, 2000);
    return () => clearInterval(healthInterval);
  }, [isIframeMode, isPlaying, activeServer?.name, handleSelectServer, triggerSignalToast]);

  // ── HLS (MSE) para .m3u8 con cabeceras registradas previamente ───────────
  useEffect(() => {
    if (isIframeMode || !videoRef.current || !videoSrc) return;
    let hlsInstance: Hls | null = null;
    let isCancelled = false;
    let liveWatchdogTimer: any = null;
    let isHlsLoadingManifest = true;
    let isHlsBuffering = false;

    const vEl = videoRef.current;
    const onWaiting = () => { isHlsBuffering = true; };
    const onCanPlay = () => { isHlsBuffering = false; };
    vEl.addEventListener('waiting', onWaiting);
    vEl.addEventListener('canplay', onCanPlay);

    const initHlsStream = async () => {
      // 1. Await setStreamHeaders ANTES de instanciar y cargar en Hls
      const api = window.electronAPI;
      if (api?.setStreamHeaders) {
        const srv = activeServerRef.current as any;
        const curMedia = mediaRef.current as any;
        try {
          await api.setStreamHeaders({
            url: videoSrc,
            referrer: srv?.referrer ?? curMedia?.streamReferrer ?? curMedia?.referrer ?? null,
            userAgent: srv?.userAgent ?? curMedia?.streamUserAgent ?? curMedia?.userAgent ?? null,
          });
        } catch (_) { }
      }

      if (isCancelled || !videoRef.current) return;

      const isLiveStream = mediaRef.current?.category === 'live_tv' || activeServerRef.current?.type === 'hls';

      // TAREA G: Watchdog IPTV ampliado a 20s (no marca caída si está en buffering o cargando manifiesto)
      if (isLiveStream) {
        liveWatchdogTimer = setTimeout(() => {
          if (isCancelled) return;
          const v = videoRef.current;
          const isActuallyPlaying = v && !v.paused && v.readyState >= 2 && v.currentTime > 0;
          if (!isActuallyPlaying) {
            if (isHlsLoadingManifest || isHlsBuffering || (v && v.readyState === 1)) {
              console.log('[VideoPlayer] Watchdog IPTV: La señal sigue cargando manifiesto o buffering, manteniendo espera');
              return;
            }
            console.warn('[VideoPlayer] Watchdog IPTV: La señal no arrancó en 20s -> marcando señal caída');
            if (mediaRef.current?.category === 'live_tv') {
              triggerSignalToastRef.current('Canal caído, probando alternativa...');
              advanceToNextServerRef.current('Watchdog IPTV timeout 20s');
            } else if (availableServersRef.current.length > 1 && cfAttemptRef.current < availableServersRef.current.length - 1) {
              cfAttemptRef.current += 1;
              const nextIdx = (activeServerIndexRef.current + 1) % availableServersRef.current.length;
              const nextSrv = availableServersRef.current[nextIdx];
              triggerSignalToastRef.current(`Señal caída -> Conectando a ${nextSrv.name}...`);
              handleSelectServerRef.current(nextIdx, { auto: true });
            } else {
              setTvSignalDown(true);
            }
          }
        }, 20000);

        const clearWatchdog = () => {
          if (liveWatchdogTimer) {
            clearTimeout(liveWatchdogTimer);
            liveWatchdogTimer = null;
          }
        };
        videoRef.current.addEventListener('playing', clearWatchdog, { once: true });
        videoRef.current.addEventListener('timeupdate', clearWatchdog, { once: true });
      }

      const curSrv = activeServerRef.current;
      if (videoSrc && (videoSrc.includes('.m3u8') || curSrv?.type === 'hls' || (curSrv as any)?.playable === 'hls')) {
        if (Hls.isSupported()) {
          let fragErrorCount = 0;
          let isHlsSettled = false;
          let manifestTimer: ReturnType<typeof setTimeout> | null = null;
          let hardLimitTimer: ReturnType<typeof setTimeout> | null = null;

          const markHlsSuccess = (source: string) => {
            if (isHlsSettled || isCancelled) return;
            isHlsSettled = true;
            if (hlsErrorTimeoutRef.current) {
              clearTimeout(hlsErrorTimeoutRef.current);
              hlsErrorTimeoutRef.current = null;
            }
            setAllServersExhausted(false);
            setUnavailableWarning(false);
            setTvSignalDown(false);
            if (manifestTimer) { clearTimeout(manifestTimer); manifestTimer = null; }
            if (hardLimitTimer) { clearTimeout(hardLimitTimer); hardLimitTimer = null; }
            const srv = activeServerRef.current;
            console.log(`[VideoPlayer] HLS éxito vía ${source} para "${srv.name}" (id=${(srv as any).id})`);
            persistSuccessServer(mediaRef.current, srv);
            recordFirstFrame(`hls-${source}`);

            const srvProv = (srv as any)?.providerId;
            if (srvProv && (srvProv === 'animeav1' || srvProv === 'jkanime' || srvProv === 'animeflv' || String((srv as any)?.id || '').startsWith('anime-'))) {
              const prov = srvProv || (srv as any)?.id?.split('-')?.[1] || 'anime';
              fetch('/api/report-anime-success', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  providerId: prov,
                  tmdbId: tmdbIdToUse,
                  episode: selectedEpisode,
                }),
              }).catch(() => { });
            }
          };

          const markHlsFailure = (reason: string) => {
            if (isHlsSettled || isCancelled) return;

            // TAREA A: Si ocurre un error en HLS nativo, no mostrar cartel inmediatamente ni abortar.
            // Usar un setTimeout de 5 segundos. Si en 5s currentTime > 0, ignorar el error y quitar cartel.
            if (hlsErrorTimeoutRef.current) {
              clearTimeout(hlsErrorTimeoutRef.current);
              hlsErrorTimeoutRef.current = null;
            }

            const v = videoRef.current;
            if (v && v.currentTime > 0) {
              console.log(`[VideoPlayer] Error HLS (${reason}) ignorado de inmediato porque el video ya está reproduciendo (currentTime=${v.currentTime}s)`);
              setAllServersExhausted(false);
              setUnavailableWarning(false);
              setTvSignalDown(false);
              return;
            }

            console.log(`[VideoPlayer] Error HLS recibido (${reason}). Esperando 5s para verificar si el video avanza...`);
            hlsErrorTimeoutRef.current = setTimeout(() => {
              hlsErrorTimeoutRef.current = null;
              if (isCancelled || isHlsSettled) return;
              const currentVideo = videoRef.current;
              if (currentVideo && currentVideo.currentTime > 0) {
                console.log(`[VideoPlayer] Video HLS avanzó a currentTime=${currentVideo.currentTime}s tras 5s: descartando error (${reason}).`);
                setAllServersExhausted(false);
                setUnavailableWarning(false);
                setTvSignalDown(false);
                return;
              }

              console.warn(`[VideoPlayer] Video HLS no avanzó (currentTime === 0) tras 5s: confirmando fallo por "${reason}".`);
              isHlsSettled = true;
              if (manifestTimer) { clearTimeout(manifestTimer); manifestTimer = null; }
              if (hardLimitTimer) { clearTimeout(hardLimitTimer); hardLimitTimer = null; }

              const srv = activeServerRef.current;
              // Requisito 3: Penalización adaptativa (memoria, TTL 1h)
              if (tmdbIdToUse > 0) {
                reportServerPlaybackPenalty({
                  providerId: (srv as any)?.providerId || 'vidlink.pro',
                  tmdbId: tmdbIdToUse,
                  type: resolveType,
                  serverId: (srv as any).id ?? srv.name,
                  penaltyMs: 15000,
                  reason,
                });
                console.log(`[VideoPlayer] [PENALIZACIÓN] Servidor "${srv.name}" (id=${(srv as any).id}) penalizado con +15000ms por: ${reason}`);
              }

              hlsSuccessCallbackRef.current = null;
              hlsInstance?.destroy();
              if (mediaRef.current?.category === 'live_tv') {
                triggerSignalToastRef.current('Canal caído, probando alternativa...');
              }
              advanceToNextServerRef.current(reason);
            }, 5000);
          };

          // Requisito 3: Fallo si no hubo MANIFEST_PARSED a los 6s
          manifestTimer = setTimeout(() => {
            manifestTimer = null;
            markHlsFailure('sin MANIFEST_PARSED a los 6s');
          }, 6000);

          // Requisito 3: Tope duro de 12s igual
          hardLimitTimer = setTimeout(() => {
            hardLimitTimer = null;
            markHlsFailure('tope duro 12s sin reproducción HLS');
          }, 12000);

          hlsSuccessCallbackRef.current = markHlsSuccess;

          hlsInstance = new Hls({
            enableWorker: false,
            lowLatencyMode: true,
            startLevel: 0,
            maxBufferLength: 15,
            maxMaxBufferLength: 60,
            liveSyncDurationCount: 3,
          });
          hlsInstance.attachMedia(videoRef.current);
          const video = videoRef.current;
          if (video) {
            video.muted = false;
            video.play().catch(e => console.log('Autoplay bloqueado, esperando interacción'));
          }
          hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log(`[VideoPlayer] HLS MEDIA_ATTACHED, loading source: ${videoSrc?.slice(0, 65)}`);
            if (!isCancelled) hlsInstance?.loadSource(videoSrc);
          });
          hlsInstance.on(Hls.Events.MANIFEST_LOADING, () => {
            isHlsLoadingManifest = true;
          });
          hlsInstance.on(Hls.Events.FRAG_LOADED, () => {
            fragErrorCount = 0;
          });
          hlsInstance.on(Hls.Events.BUFFER_APPENDING, () => {
            isHlsBuffering = true;
          });
          hlsInstance.on(Hls.Events.BUFFER_APPENDED, () => {
            isHlsBuffering = false;
          });
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log(`[VideoPlayer] HLS MANIFEST_PARSED recibido con éxito`);
            if (manifestTimer) {
              clearTimeout(manifestTimer);
              manifestTimer = null;
            }
            // Reiniciar el tope duro de 12s para buffering de fragmentos tras el manifiesto
            if (hardLimitTimer) {
              clearTimeout(hardLimitTimer);
              hardLimitTimer = setTimeout(() => {
                hardLimitTimer = null;
                markHlsFailure('tope duro 12s sin reproducción HLS');
              }, 12000);
            }
            isHlsLoadingManifest = false;
            isHlsBuffering = false;
            if (videoRef.current && !isCancelled) {
              setTvSignalDown(false);
              videoRef.current.muted = true;
              videoRef.current.play().then(() => {
                setIsPlaying(true);
                if (videoRef.current) videoRef.current.muted = false;
                onBroadcastStateRef.current?.({ isPlaying: true });
              }).catch(() => {
                window.electronAPI?.simulatePlayClick?.();
                videoRef.current?.play().catch(() => { });
              });
            }
          });
          // Requisito 3: Éxito en FRAG_BUFFERED o en loadedmetadata
          hlsInstance.on(Hls.Events.FRAG_BUFFERED, () => {
            markHlsSuccess('FRAG_BUFFERED');
          });
          // Requisito 3: Fallo en ERROR fatal o fragmentos fallidos
          hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
            if (isCancelled) return;
            console.log(`[VideoPlayer] HLS event error: type=${data.type} details=${data.details} fatal=${data.fatal}`);
            // En error de fragmento reintentar startLoad(), y si falla 3 veces marcar fallo
            if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR) {
              fragErrorCount += 1;
              console.warn('[VideoPlayer] Falló carga de fragmento HLS (reintento ' + fragErrorCount + '):', data.frag?.url);
              if (fragErrorCount >= 3) {
                console.warn('[VideoPlayer] 3 fragmentos consecutivos fallidos -> rotando servidor');
                fragErrorCount = 0;
                hlsSuccessCallbackRef.current = null;
                hlsInstance?.destroy();
                advanceToNextServerRef.current('3 errores de fragmento HLS');
              } else {
                hlsInstance?.startLoad();
              }
              return;
            }
            if (data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
              hlsInstance?.startLoad();
              return;
            }
            if (!data.fatal) return;
            console.warn('[VideoPlayer] Error fatal en Hls.js stream:', data.type, data.details);
            hlsSuccessCallbackRef.current = null;
            hlsInstance?.destroy();
            advanceToNextServerRef.current(`error fatal de hls.js (${data.details})`);
          });
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = videoSrc;
          videoRef.current.play().catch(() => { });
        }
      } else {
        videoRef.current.src = videoSrc;
      }
    };

    initHlsStream();

    return () => {
      isCancelled = true;
      if (liveWatchdogTimer) clearTimeout(liveWatchdogTimer);
      if (hlsErrorTimeoutRef.current) {
        clearTimeout(hlsErrorTimeoutRef.current);
        hlsErrorTimeoutRef.current = null;
      }
      vEl.removeEventListener('waiting', onWaiting);
      vEl.removeEventListener('canplay', onCanPlay);
      hlsSuccessCallbackRef.current = null;
      hlsInstance?.destroy();
    };
  }, [videoSrc, isIframeMode, corsMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenExternalStream = useCallback(() => {
    const url = activeServer?.url || activeEmbedUrl;
    if (!url) return;
    const api = window.electronAPI;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }, [activeServer, activeEmbedUrl]);

  // ── P2.6: Detección rápida de "Aún no está disponible" / "Contenido no disponible" o Cloudflare ───
  useEffect(() => {
    if (!isIframeMode) {
      setCfWarning(false);
      setUnavailableWarning(false);
      setAllServersExhausted(false);
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
      isRotatingRef.current = false;
      return;
    }
    setCfWarning(false);
    setUnavailableWarning(false);
    iframeLoadedAtRef.current = Date.now();
    consecutiveUnavailableCountRef.current = 0;
    if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    isRotatingRef.current = false;
    let cancelled = false;

    // Sondeo de estado cada 1000ms en modo iframe (sin esperar 10s; presupuesto <= 6s para no disponible)
    const interval = setInterval(async () => {
      const api = window.electronAPI;
      if (!api?.getEmbedStatus || cancelled) return;

      if (Date.now() - iframeLoadedAtRef.current < 1000) return;

      const st = await api.getEmbedStatus();
      if (cancelled || !st?.ok) return;

      if ((st as any).readyState >= 2 || (typeof st.currentTime === 'number' && st.currentTime > 0.5)) {
        recordFirstFrame('embed-status-ready');
      }

      if (st.contentUnavailable) {
        setUnavailableWarning(true);
        const curSrv = availableServersRef.current[activeServerIndexRef.current];
        if (curSrv) {
          const k = getServerEpisodeKey(curSrv);
          unavailableServersForEpisodeRef.current.add(k);
          failedServersForEpisodeRef.current.add(k);
        }
        advanceToNextServerRef.current('Aún no está disponible en servidor');
        return;
      }

      if (st.cloudflare) {
        setCfWarning(true);
        advanceToNextServerRef.current('Desafío Cloudflare persistente en frame');
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current);
        skipTimeoutRef.current = null;
      }
      if (rotateTimerRef.current) {
        clearTimeout(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
      isRotatingRef.current = false;
    };
  }, [activeEmbedUrl, iframeReloadKey, isIframeMode, recordFirstFrame, getServerEpisodeKey]);

  // ── Auto-salto inmediato cuando el proveedor activo falla en red o es bloqueado por CDP (Gate 3R) ───
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onEmbedFailed) return;
    const off = api.onEmbedFailed((err: any) => {
      const desc = String(err?.desc || err?.code || '');
      const failedUrl = String(err?.url || '').toLowerCase();
      const curSrv = availableServersRef.current[activeServerIndexRef.current];
      let curHost = '';
      try {
        curHost = curSrv?.url ? new URL(curSrv.url).hostname.toLowerCase() : '';
      } catch (_) { }
      const curRootDomain = curHost.split('.').slice(-2).join('.');
      const matchesActiveHost = Boolean(
        curHost && (failedUrl.includes(curHost) || (curRootDomain && failedUrl.includes(curRootDomain)))
      );
      if (failedUrl && curHost && !matchesActiveHost) {
        return;
      }
      const isBlockedByClient = desc.includes('ERR_BLOCKED_BY_CLIENT');
      if (isBlockedByClient || matchesActiveHost || isIframeMode) {
        const reason = `Fallo crítico de red (${desc}, url: ${err?.url || 'n/a'})`;
        advanceToNextServerRef.current(reason);
      }
    });
    return () => off?.();
  }, [isIframeMode]);

  // Regla de oro: No usar timeouts de 8 segundos para iframes. Dejar que el iframe cargue libremente.
  useEffect(() => {
    if (iframeLoadTimeoutRef.current) {
      clearTimeout(iframeLoadTimeoutRef.current);
      iframeLoadTimeoutRef.current = null;
    }
  }, [isIframeMode, activeEmbedUrl, iframeReloadKey]);

  // P2.5 & Web Parity: El pill de escape solo aplica en Electron (en web se deja el botón nativo del proveedor sin duplicar botones).
  useEffect(() => {
    const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.electronAPI);
    if (!isIframeMode || !hasElectronBridge) {
      setShowIframePlayBanner(false);
      return;
    }
    setShowIframePlayBanner(false);
    const timer = setTimeout(() => {
      if (!firstFrameTimeRef.current && !hasStartedWatchingRef.current) {
        setShowIframePlayBanner(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isIframeMode, activeEmbedUrl, iframeReloadKey]);

  // P2.12: Log cosmético de montaje de iframe en efecto único por activeEmbedUrl
  useEffect(() => {
    if (isIframeMode && activeEmbedUrl) {
      console.log(`[AD] iframe montado en ${Date.now() - mountTimeRef.current}ms`);
    }
  }, [activeEmbedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // P2.5: Auto-commit del servidor elegido una sola vez cuando hay servidor elegido,
  // episode.episodeNumber === selectedEpisode y no hubo interacción previa.
  useEffect(() => {
    if (!isIframeMode || !activeServer?.url || !activeEmbedUrl) return;
    if (typeof window === 'undefined' || (!window.electronAPI?.autoCommitEmbedPlay && !window.electronAPI?.controlActiveMedia)) {
      return;
    }
    const isEpisodeCoherent = !isSeriesOrAnime || !episode || episode.episodeNumber === selectedEpisode;
    if (!isEpisodeCoherent || userInteractedRef.current) return;

    const commitKey = `${media.id}:${selectedSeason}:${selectedEpisode}:${activeServer.name}`;
    if (autoCommittedKeyRef.current === commitKey) return;

    let cancelled = false;
    let attempts = 0;
    const tryAutoCommit = async () => {
      if (cancelled || userInteractedRef.current || autoCommittedKeyRef.current === commitKey) return;
      attempts += 1;
      const res = await (window.electronAPI?.autoCommitEmbedPlay?.() ?? window.electronAPI?.controlActiveMedia?.({ action: 'autoCommitPlay' }));
      if (cancelled) return;
      if (res?.unavailable) {
        autoCommittedKeyRef.current = commitKey;
        setUnavailableWarning(true);
        const curSrv = availableServersRef.current[activeServerIndexRef.current];
        if (curSrv) {
          const k = getServerEpisodeKey(curSrv);
          unavailableServersForEpisodeRef.current.add(k);
          failedServersForEpisodeRef.current.add(k);
        }
        advanceToNextServerRef.current('Aún no está disponible en servidor');
        return;
      }
      if (res?.acted) {
        autoCommittedKeyRef.current = commitKey;
        iframeLoadedAtRef.current = Date.now();
        setAutoCommitDoneAt(Date.now());
        console.log(`[VideoPlayer] [P2.5 AutoCommit] Auto-commit ejecutado en "${activeServer.name}" (key=${commitKey})`);
        // P2.13: Intento único de saltar pre-roll (espera a que termine la cuenta regresiva del botón si existe, 1 solo click)
        const triggerAdSkip = async (countdownRetriesLeft: number) => {
          if (cancelled || userInteractedRef.current) return;
          const skipRes = await (
            (window.electronAPI as any)?.autoSkipEmbedAd?.() ??
            window.electronAPI?.controlActiveMedia?.({ action: 'autoSkipEmbedAd' })
          );
          if (cancelled) return;
          if (skipRes?.skipped) {
            console.log(`[AD] saltado en ${Date.now() - mountTimeRef.current}ms`);
          } else if (skipRes?.countdown && countdownRetriesLeft > 0) {
            setTimeout(() => { triggerAdSkip(countdownRetriesLeft - 1); }, 1200);
          } else {
            console.log(`[AD] botón saltar no apareció (${skipRes?.text || 'sin botón'})`);
          }
        };
        setTimeout(() => { triggerAdSkip(10); }, 5500);
        return;
      }
      if (attempts < 16 && !cancelled) {
        setTimeout(tryAutoCommit, 450);
      }
    };

    const t = setTimeout(tryAutoCommit, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isIframeMode, activeServer?.name, activeServer?.url, activeEmbedUrl, isSeriesOrAnime, episode?.id, episode?.episodeNumber, selectedSeason, selectedEpisode, media.id]);

  const broadcastImmediate = useCallback((playingOverride?: boolean, extraOverrides?: Record<string, any>) => {
    if (!onBroadcastState) return;
    const time = (!isIframeMode && videoRef.current)
      ? videoRef.current.currentTime
      : simulatedTimeRef.current;
    const dur = (!isIframeMode && videoRef.current)
      ? (videoRef.current.duration || 0)
      : (duration > 0 ? duration : 5400);
    const playing = playingOverride !== undefined
      ? playingOverride
      : (!isIframeMode && videoRef.current ? !videoRef.current.paused : isPlaying);

    const currentUrl = activeEmbedUrl || availableServersRef.current[activeServerIndexRef.current]?.url || '';
    const cleanRoute = extractCleanRouteAndEp(currentUrl);
    const isIgnoreEp = Boolean(currentUrl.includes('ignoreep=1') || extraOverrides?.providerEpisodeMismatchWarning);

    onBroadcastState({
      currentTime: time,
      duration: dur,
      isPlaying: playing,
      seekUnsupported: extraOverrides?.seekUnsupported ?? (isIframeMode ? seekUnsupportedRef.current : false),
      serverTimeout: extraOverrides?.serverTimeout ?? (resumeStateRef.current?.errorReason?.includes('tardó demasiado') || false),
      estimated: extraOverrides?.estimated ?? (isIframeMode ? (seekUnsupportedRef.current || isEstimatedTimeRef.current) : false),
      resume: extraOverrides?.resume !== undefined ? extraOverrides.resume : resumeStateRef.current,
      marathon: marathonMode,
      hasIntroTimings: introStart !== undefined && introEnd !== undefined,
      isIntroActive: introStart !== undefined && introEnd !== undefined && time >= introStart && time <= introEnd,
      isRecapActive: recapStart !== undefined && recapEnd !== undefined && time >= recapStart && time <= recapEnd,
      servers: availableServersRef.current.map((s) => ({ name: s.name, language: s.language })),
      activeServerIndex: activeServerIndexRef.current,
      serversExhausted: fallbackActive,
      activeServerName: availableServersRef.current[activeServerIndexRef.current]?.name || activeServer?.name || '',
      activeServerType: availableServersRef.current[activeServerIndexRef.current]?.type || activeServer?.type || 'iframe',
      subtitlesEnabled: subtitlesEnabledRef.current,
      mediaTitle: currentTitle,
      mediaPoster: media.posterUrl || media.backdropUrl || '',
      seasonNumber: selectedSeasonRef.current,
      episodeNumber: selectedEpisodeRef.current,
      loadedUrl: cleanRoute.hostAndPath || undefined,
      loadedSeason: cleanRoute.season,
      loadedEpisode: cleanRoute.episode,
      providerEpisodeMismatchWarning: isIgnoreEp,
      playbackMeta: {
        title: currentTitle,
        currentSeason: selectedSeasonRef.current,
        currentEpisode: selectedEpisodeRef.current,
        totalSeasons: realSeasons.length > 0 ? realSeasons.length : (media.seasonsCount || (media.seasons ? media.seasons.length : 1)),
        episodes: realEpisodes.length > 0
          ? realEpisodes.map((ep) => ({
            season: ep.season,
            episode: ep.episode,
            title: ep.title,
            duration: ep.duration || '24m',
          }))
          : (media.episodes && media.episodes.length > 0)
            ? media.episodes.map((ep) => ({
              season: (ep as any).season || ep.seasonNumber || 1,
              episode: ep.episodeNumber ?? (ep as any).episode ?? 1,
              title: ep.title || `Capítulo ${ep.episodeNumber ?? (ep as any).episode ?? 1}`,
              duration: ep.duration || '24m',
            }))
            : Array.from({ length: Math.max(1, realSeasons.find((s) => s.seasonNumber === selectedSeasonRef.current)?.episodeCount || 8) }, (_, i) => ({
              season: selectedSeasonRef.current,
              episode: i + 1,
              title: `Episodio ${i + 1}`,
              duration: '24m',
            })),
      },
    });
  }, [onBroadcastState, isIframeMode, activeServer, introStart, introEnd, recapStart, recapEnd, duration, isPlaying, currentTitle, media, realSeasons, realEpisodes]);

  const handleAdvanceEpisode = useCallback((delta: number) => {
    if (!isEpisodic) return;
    const currentSeasonEpisodes = realEpisodes.length > 0
      ? realEpisodes.length
      : (media.episodes && media.episodes.length > 0)
        ? media.episodes.filter((e) => (e.seasonNumber || 1) === selectedSeasonRef.current).length
        : (realSeasons.find((s) => s.seasonNumber === selectedSeasonRef.current)?.episodeCount || 8);

    if (delta > 0 && selectedEpisodeRef.current >= currentSeasonEpisodes) {
      const nextSeason = selectedSeasonRef.current + 1;
      const explicitMaxSeason =
        media.seasons && media.seasons.length > 0
          ? Math.max(...media.seasons.map((s: any) => Number(s.seasonNumber ?? s.season_number ?? 0)))
          : Number(media.seasonsCount || (realSeasons.length > 0 ? realSeasons.length : 1));

      if (explicitMaxSeason > 0 && nextSeason > explicitMaxSeason) {
        triggerSignalToast('Fin de la serie');
        setIsPlaying(false);
        onNextEpisode?.();
        return;
      }

      if (marathonMode) {
        triggerSignalToast(`🏃 Maratón: Avanzando a Temporada ${nextSeason}, Capítulo 1`);
        onRequestEpisodeChange?.(nextSeason, 1);
      }
    } else if (delta < 0) {
      if (selectedEpisodeRef.current <= 1) {
        onPrevEpisode?.();
      } else {
        onRequestEpisodeChange?.(selectedSeasonRef.current, selectedEpisodeRef.current - 1);
      }
    } else {
      const nextEp = selectedEpisodeRef.current + delta;
      onRequestEpisodeChange?.(selectedSeasonRef.current, nextEp);
    }
    simulatedTimeRef.current = 0;
    setCurrentTime(0);
    if (!isIframeMode && videoRef.current) {
      try {
        videoRef.current.currentTime = 0;
        if (delta > 0) {
          const p = videoRef.current.play();
          if (p && typeof p.catch === 'function') p.catch(() => { });
        }
      } catch (_) { }
    }
    setIframeReloadKey((k) => k + 1);
    broadcastImmediate();
  }, [isEpisodic, realEpisodes, media.episodes, media.seasons, media.seasonsCount, realSeasons, marathonMode, triggerSignalToast, onRequestEpisodeChange, onNextEpisode, onPrevEpisode, isIframeMode, broadcastImmediate]);
  handleAdvanceEpisodeRef.current = handleAdvanceEpisode;

  const attemptSmartPlay = useCallback((videoEl: HTMLVideoElement | null) => {
    if (!videoEl || isIframeMode) return;
    // Una sola vía de volumen: el motor decide (elemento si no hay grafo, gainNode si lo hay)
    globalAudioEngine.applySettings({ ...audioSettings, isMuted: false });
    const p = videoEl.play();
    if (p !== undefined) {
      p.then(() => { setIsPlaying(true); broadcastImmediate(true); })
        .catch(() => {
          videoEl.play()
            .then(() => { setIsPlaying(true); broadcastImmediate(true); })
            .catch(() => { setIsPlaying(false); broadcastImmediate(false); });
        });
    }
  }, [broadcastImmediate, isIframeMode, audioSettings]);

  const togglePlay = async () => {
    if (isPlaying) {
      resumeControllerRef.current?.cancel();
    }
    if (isIframeMode) {
      const res = await window.electronAPI?.controlActiveMedia?.({ action: 'togglePlay' });
      const nextPlaying = typeof (res as any)?.isPlaying === 'boolean' ? (res as any).isPlaying : !isPlaying;
      setIsPlaying(nextPlaying);
      broadcastImmediate(nextPlaying);
      return;
    }
    if (!videoRef.current) return;
    if (videoRef.current.paused) attemptSmartPlay(videoRef.current);
    else {
      videoRef.current.pause();
      setIsPlaying(false);
      broadcastImmediate(false);
    }
  };

  const seekRelative = async (seconds: number) => {
    resumeControllerRef.current?.cancel();
    if (isIframeMode) {
      const res = await window.electronAPI?.controlActiveMedia?.({ action: 'seekRelative', value: seconds });
      if (res && (res.ok || res.hasMedia || res.acted)) {
        const realCur = typeof res.currentTime === 'number' && Number.isFinite(res.currentTime)
          ? res.currentTime
          : Math.max(0, simulatedTimeRef.current + seconds);
        simulatedTimeRef.current = realCur;
        setCurrentTime(realCur);
        setSeekUnsupported(false);
        broadcastImmediate(undefined, { seekUnsupported: false });
        return;
      }
      // Reloj simulado solo como respaldo cuando NO hay un <video> accesible
      const maxDur = duration > 0 ? duration : 7200;
      const next = Math.max(0, Math.min(maxDur, simulatedTimeRef.current + seconds));
      simulatedTimeRef.current = next;
      setCurrentTime(next);
      const realState = await window.electronAPI?.getRealMediaState?.();
      const hasReadyVideo = Boolean(realState && realState.found && (realState as any).readyState >= 2);
      if (hasReadyVideo) {
        setSeekUnsupported(true);
        broadcastImmediate(undefined, { seekUnsupported: true });
      }
      return;
    }
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(videoRef.current.duration || 3600, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = next;
    setCurrentTime(next);
    broadcastImmediate();
  };

  const handleSeek = async (time: number) => {
    resumeControllerRef.current?.cancel();
    if (isIframeMode) {
      const res = await window.electronAPI?.controlActiveMedia?.({ action: 'seek', value: time });
      if (res && (res.ok || res.hasMedia || res.acted)) {
        const realCur = typeof res.currentTime === 'number' && Number.isFinite(res.currentTime)
          ? res.currentTime
          : Math.max(0, time);
        simulatedTimeRef.current = realCur;
        setCurrentTime(realCur);
        setSeekUnsupported(false);
        broadcastImmediate(undefined, { seekUnsupported: false });
        return;
      }
      const next = Math.max(0, time);
      simulatedTimeRef.current = next;
      setCurrentTime(next);
      const realState = await window.electronAPI?.getRealMediaState?.();
      const hasReadyVideo = Boolean(realState && realState.found && (realState as any).readyState >= 2);
      if (hasReadyVideo) {
        setSeekUnsupported(true);
        broadcastImmediate(undefined, { seekUnsupported: true });
      }
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
    broadcastImmediate();
  };

  const handleSkipIntro = () => {
    if (isIframeMode || !videoRef.current || introEnd === undefined) return;
    videoRef.current.currentTime = introEnd;
    setIsIntroActive(false);
    broadcastImmediate();
  };

  const handleSkipRecap = () => {
    if (isIframeMode || !videoRef.current || recapEnd === undefined) return;
    videoRef.current.currentTime = recapEnd;
    setIsRecapActive(false);
    broadcastImmediate();
  };

  const toggleFullscreen = async () => {
    if (window.electronAPI?.toggleFullscreen) {
      const next = await window.electronAPI.toggleFullscreen();
      setIsFullscreen(next);
      if (next) setShowControls(false);
      return;
    }
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
      setShowControls(false);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  // ── COMANDO REMOTO ÚNICO ─────────────────────────────────────────────────
  const lastProcessedTriggerRef = useRef<number>(remoteCommandTrigger?.timestamp || 0);

  useEffect(() => {
    if (!remoteCommandTrigger) return;
    if (remoteCommandTrigger.timestamp <= lastProcessedTriggerRef.current) return;
    lastProcessedTriggerRef.current = remoteCommandTrigger.timestamp;

    const { cmd } = remoteCommandTrigger;
    const api = window.electronAPI;
    const pressKey = (key: string) => {
      if (api?.sendNativeKey) { api.sendNativeKey(key); return; }
      try {
        const f = document.querySelector('iframe') as HTMLIFrameElement | null;
        f?.contentWindow?.postMessage({ event: 'command', func: key }, '*');
      } catch { }
    };

    switch (cmd.action) {
      case 'changeServer': {
        const idx = typeof cmd.payload === 'number' ? cmd.payload
          : typeof (cmd.payload as any)?.serverIndex === 'number' ? (cmd.payload as any).serverIndex : 0;
        handleSelectServer(idx);
        break;
      }
      case 'togglePlay': {
        togglePlay();
        break;
      }
      case 'play': {
        if (isIframeMode) {
          window.electronAPI?.controlActiveMedia?.({ action: 'play' });
          setIsPlaying(true);
          broadcastImmediate(true);
        } else if (videoRef.current?.paused) {
          attemptSmartPlay(videoRef.current);
        }
        break;
      }
      case 'pause': {
        resumeControllerRef.current?.cancel();
        if (isIframeMode) {
          window.electronAPI?.controlActiveMedia?.({ action: 'pause' });
          setIsPlaying(false);
          broadcastImmediate(false);
        } else if (videoRef.current) {
          videoRef.current.pause();
          setIsPlaying(false);
          broadcastImmediate(false);
        }
        break;
      }
      case 'seek': {
        if (typeof cmd.payload === 'number') {
          handleSeek(cmd.payload);
        }
        break;
      }
      case 'seekRelative': {
        seekRelative(typeof cmd.payload === 'number' ? cmd.payload : 10);
        break;
      }
      case 'toggleSubtitles': {
        const nextSub = typeof cmd.payload === 'boolean' ? cmd.payload : !subtitlesEnabled;
        setSubtitlesEnabled(nextSub);
        subtitlesEnabledRef.current = nextSub;
        try {
          localStorage.setItem('cinecast_subtitles_pref', nextSub ? '1' : '0');
        } catch { }
        window.electronAPI?.controlActiveMedia?.({ action: 'toggleSubtitles', value: nextSub });
        onBroadcastState?.({ subtitlesEnabled: nextSub });
        break;
      }
      case 'skipIntro': handleSkipIntro(); break;
      case 'skipRecap': handleSkipRecap(); break;
      case 'setVolume': {
        if (typeof cmd.payload === 'number') {
          const newVol = Math.max(0, Math.min(100, cmd.payload));
          onUpdateAudio({ volume: newVol, isMuted: false });
          if (!isIframeMode) {
            globalAudioEngine.applySettings({ ...audioSettings, volume: newVol, isMuted: false });
          }
          window.electronAPI?.setMasterVolume?.({ volume: newVol, isMuted: false });
          broadcastImmediate();
        }
        break;
      }
      case 'toggleMute': {
        const nextMuted = !audioSettings.isMuted;
        onUpdateAudio({ isMuted: nextMuted });
        if (!isIframeMode) {
          globalAudioEngine.applySettings({ ...audioSettings, isMuted: nextMuted });
        }
        window.electronAPI?.setMasterVolume?.({ volume: audioSettings.volume, isMuted: nextMuted });
        broadcastImmediate();
        break;
      }
      case 'nextEpisode': {
        handleAdvanceEpisode(1);
        break;
      }
      case 'prevEpisode': {
        handleAdvanceEpisode(-1);
        break;
      }
      case 'jumpToEpisode': {
        if (cmd.payload) {
          const s = Number(cmd.payload.season || selectedSeason);
          const e = Number(cmd.payload.episode || 1);
          onRequestEpisodeChange?.(s, e);
          simulatedTimeRef.current = 0;
          setCurrentTime(0);
          setIframeReloadKey((k) => k + 1);
          broadcastImmediate();
        }
        break;
      }
      case 'toggleFullscreen': toggleFullscreen(); break;
      case 'selectServer': {
        const name = typeof cmd.payload === 'object' && cmd.payload ? (cmd.payload.name || '') : '';
        const url = typeof cmd.payload === 'object' && cmd.payload ? (cmd.payload.url || '') : '';
        let targetIdx = -1;
        if (name) {
          targetIdx = availableServersRef.current.findIndex(
            (s) => s.name.toLowerCase() === String(name).toLowerCase()
          );
        }
        if (targetIdx === -1 && url) {
          targetIdx = availableServersRef.current.findIndex((s) => s.url === url);
        }
        if (targetIdx === -1) {
          const idx = typeof cmd.payload === 'number' ? cmd.payload : Number(cmd.payload?.index);
          if (Number.isFinite(idx) && availableServersRef.current[idx]) {
            targetIdx = idx;
          }
        }
        if (targetIdx >= 0 && availableServersRef.current[targetIdx]) {
          handleSelectServer(targetIdx);
        }
        break;
      }
    }
  }, [remoteCommandTrigger, isIframeMode, isPlaying, audioSettings, broadcastImmediate, isEpisodic, onNextEpisode, onPrevEpisode, handleSelectServer, attemptSmartPlay, subtitlesEnabled, onBroadcastState]);

  // ── Sincronización en vivo de tiempo y estado con el celular ─────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      const realState = await window.electronAPI?.getRealMediaState?.();
      if (realState?.detectedTracks) {
        setDetectedTracks(realState.detectedTracks);
      }
      if (realState && realState.found) {
        simulatedTimeRef.current = realState.currentTime;
        setCurrentTime(realState.currentTime);
        if (!seekUnsupported) {
          setIsEstimatedTime(false);
        }
        if (realState.duration > 0) {
          setDuration(realState.duration);
        }
        setIsPlaying(realState.isPlaying);

        if (realState.isPlaying && (realState.currentTime > 0.5 || (realState as any).readyState >= 2)) {
          recordFirstFrame('iframe-realstate-frame');
        }

        // Si el video está en play y avanza, descartar el cartel pegajoso de "Reanudando en..."
        if (realState.isPlaying && realState.currentTime > (lastRealTimeRef.current || 0) + 0.05) {
          normalAdvanceStreakRef.current = (normalAdvanceStreakRef.current || 0) + 1;
          if (normalAdvanceStreakRef.current >= 2) {
            if (resumeState && (resumeState.status === 'ok' || resumeState.status === 'reanudando' || resumeState.status === 'esperando' || resumeState.status === 'cargando')) {
              setResumeState(null);
              broadcastImmediate(realState.isPlaying, { resume: null });
            }
          }
        } else {
          normalAdvanceStreakRef.current = 0;
        }
        lastRealTimeRef.current = realState.currentTime;

        // Detección de fin de reproducción en modo embebido para Maratón (ignorar pre-roll ads con duration <= 300s en producción)
        const isTestEmbed = Boolean(
          (typeof window !== 'undefined' && (window as any).__CINECAST_TEST) ||
          (activeServerRef.current?.url && activeServerRef.current.url.includes('/__test/'))
        );
        const minRealDuration = isTestEmbed ? 10 : 300;
        const realSrcStr = String((realState as any).currentSrc || '');
        const isKnownPreroll = realSrcStr.includes('quickcore.fun');
        if (!isTestEmbed && !isKnownPreroll && realState.duration > 0 && realState.duration < 300 && realState.currentTime > 2) {
          const shortKey = `${media.id}:s${selectedSeason}:e${selectedEpisode}:${Math.round(realState.duration)}`;
          if (shortDurationLoggedKeyRef.current !== shortKey) {
            shortDurationLoggedKeyRef.current = shortKey;
            console.log('[DUR] capítulo corto', Math.round(realState.duration), media.id);
          }
        }
        if (realState.duration > minRealDuration && realState.currentTime > 0) {
          const timeToEnd = realState.duration - realState.currentTime;
          const isNearEnd = timeToEnd <= 2.5 || (realState.currentTime >= realState.duration - 1);
          if (isNearEnd && isPlaying) {
            const isMarathonOn = Boolean(
              marathonMode ||
              playbackSettings.autoPlayNext ||
              (typeof window !== 'undefined' && localStorage.getItem('cinecast_marathon_mode') === 'true')
            );
            if (isMarathonOn && isEpisodic) {
              tryAutoAdvanceEpisodeRef.current?.();
            }
          }
        }

        broadcastImmediate(realState.isPlaying);

        if (!seekUnsupported && realState.currentTime > 15 && Math.round(realState.currentTime) % 4 === 0) {
          watchHistoryService.saveProgress({
            mediaItem: media, episodeItem: episode,
            seasonNumber: selectedSeason, episodeNumber: selectedEpisode,
            currentTime: realState.currentTime, duration: realState.duration > 0 ? realState.duration : 5400,
          });
        }
      } else if (isIframeMode && isPlaying) {
        setIsEstimatedTime(true);
        simulatedTimeRef.current += 1;
        const t = simulatedTimeRef.current;
        setCurrentTime(t);
        if (t % 2 === 0) {
          broadcastImmediate(undefined, { estimated: true });
        }
        // No se guarda tiempo simulado en historial cuando el video no es accesible
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isIframeMode, isPlaying, media, episode, selectedSeason, selectedEpisode, broadcastImmediate, duration]);

  // Único responsable de reanudar en modo embebido (ResumeController)
  useEffect(() => {
    if (!isIframeMode || !initialTime || initialTime <= 0) return;
    const controller = new ResumeController();
    resumeControllerRef.current = controller;
    const unsub = controller.start(initialTime, (res) => {
      (window as any).__cinecastResumeState = res;
      resumeStateRef.current = res;
      setResumeState(res);
      if (res.status === 'fallo') {
        const isTimeout = res.errorReason?.includes('tardó demasiado');
        if (isTimeout) {
          seekUnsupportedRef.current = false;
          setSeekUnsupported(false);
          broadcastImmediate(undefined, {
            resume: res,
            seekUnsupported: false,
            serverTimeout: true,
            estimated: false,
          });
        } else {
          seekUnsupportedRef.current = true;
          setSeekUnsupported(true);
          setIsEstimatedTime(true);
          broadcastImmediate(undefined, {
            resume: res,
            seekUnsupported: true,
            serverTimeout: false,
            estimated: true,
          });
        }
      } else if (res.status === 'ok') {
        seekUnsupportedRef.current = false;
        setSeekUnsupported(false);
        setIsEstimatedTime(false);
        broadcastImmediate(undefined, {
          resume: res,
          seekUnsupported: false,
          serverTimeout: false,
          estimated: false,
        });
      } else if (res.status === 'cargando' || res.status === 'reanudando') {
        seekUnsupportedRef.current = false;
        setSeekUnsupported(false);
        broadcastImmediate(undefined, {
          resume: res,
          seekUnsupported: false,
          serverTimeout: false,
        });
      } else {
        broadcastImmediate(undefined, { resume: res });
      }
    }, duration);
    return () => {
      unsub();
      resumeControllerRef.current = null;
    };
  }, [isIframeMode, initialTime, activeServerIndex, activeEmbedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSeekUnsupported(false);
    setResumeState(null);
    normalAdvanceStreakRef.current = 0;
  }, [selectedSeason, selectedEpisode, media?.id]);

  useEffect(() => () => {
    const finalTime = isIframeMode
      ? (isEstimatedTimeRef.current ? null : simulatedTimeRef.current)
      : (videoRef.current?.currentTime || 0);
    if (finalTime && finalTime > 15) {
      watchHistoryService.saveProgress({
        mediaItem: media, episodeItem: episode,
        seasonNumber: selectedSeason, episodeNumber: selectedEpisode,
        currentTime: finalTime, duration: duration > 0 ? duration : 5400,
      });
    }
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autoplay al cambiar fuente ───────────────────────────────────────────
  useEffect(() => {
    if (isIframeMode || !videoRef.current) return;
    videoRef.current.currentTime = initialTime && initialTime > 0 ? initialTime : 0;
    attemptSmartPlay(videoRef.current);
  }, [videoSrc, isIframeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // B5: Auto-ocultado del panel a los 4 s sin interacción (6 s de gracia al abrir),
  // pausado mientras el video está pausado o el mouse está sobre el panel, cancelado al desmontar.
  const scheduleAutoHide = useCallback((delayMs: number) => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    if (!isPlaying || isPointerOverPanelRef.current) return;
    controlsTimeoutRef.current = setTimeout(() => {
      if (!isPointerOverPanelRef.current) {
        setShowControls(false);
      }
    }, delayMs);
  }, [isPlaying]);

  useEffect(() => {
    if (!showControls || isTopBarHidden || !isPlaying || isPointerOverPanel) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
      return;
    }
    const delayMs = panelGracePendingRef.current ? 6000 : 4000;
    panelGracePendingRef.current = false;
    scheduleAutoHide(delayMs);
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
    };
  }, [showControls, isTopBarHidden, isPlaying, isPointerOverPanel, scheduleAutoHide]);

  const handleMouseMove = useCallback(() => {
    panelGracePendingRef.current = false;
    setShowControls(true);
    scheduleAutoHide(4000);
  }, [scheduleAutoHide]);

  const tryAutoAdvanceEpisode = useCallback(() => {
    const chapterKey = `${media.id}_s${selectedSeasonRef.current}_e${selectedEpisodeRef.current}`;
    if (autoAdvancedChapterGuardRef.current === chapterKey) return;
    if (onBeforeAutoAdvance && !onBeforeAutoAdvance(chapterKey)) {
      autoAdvancedChapterGuardRef.current = chapterKey;
      try {
        videoRef.current?.pause();
      } catch (_) { }
      setIsPlaying(false);
      return;
    }
    autoAdvancedChapterGuardRef.current = chapterKey;
    handleAdvanceEpisode(1);
  }, [media.id, onBeforeAutoAdvance, handleAdvanceEpisode]);
  tryAutoAdvanceEpisodeRef.current = tryAutoAdvanceEpisode;

  const startNextEpisodeCountdown = () => {
    if (marathonMode) {
      // TAREA 5: No muestra cuenta atrás, pasa directo al siguiente capítulo
      tryAutoAdvanceEpisode();
      return;
    }
    let secondsLeft = playbackSettings.nextEpisodeDelay || 5;
    setCountdownToNext(secondsLeft);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setCountdownToNext(secondsLeft);
      if (secondsLeft <= 0) {
        clearInterval(countdownIntervalRef.current);
        setCountdownToNext(null);
        tryAutoAdvanceEpisode();
      }
    }, 1000);
  };

  const cancelNextCountdown = () => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = null;
    setCountdownToNext(null);
  };

  const handleTimeUpdate = () => {
    if (isIframeMode || !videoRef.current) return;
    const time = videoRef.current.currentTime;
    const dur = videoRef.current.duration || 0;
    setCurrentTime(time);
    setDuration(dur);

    if (time > 0.5) {
      recordFirstFrame('video-currentTime>0.5');
    }
    const isTestDirect = Boolean(
      (typeof window !== 'undefined' && (window as any).__CINECAST_TEST) ||
      (videoSrc && videoSrc.includes('/__test/'))
    );
    if (!isTestDirect && isEpisodic && dur > 0 && dur < 300 && time > 2) {
      const shortKey = `${media.id}:s${selectedSeason}:e${selectedEpisode}:${Math.round(dur)}`;
      if (shortDurationLoggedKeyRef.current !== shortKey) {
        shortDurationLoggedKeyRef.current = shortKey;
        console.log('[DUR] capítulo corto', Math.round(dur), media.id);
      }
    }

    if (introStart !== undefined && introEnd !== undefined) {
      const inRange = time >= introStart && time <= introEnd;
      setIsIntroActive(inRange);
      // TAREA 5: Activa autoSkipIntro si playbackSettings lo tiene o marathonMode está activo
      if (inRange && (playbackSettings.autoSkipIntro || marathonMode) && !hasAutoSkippedIntro) {
        setHasAutoSkippedIntro(true);
        videoRef.current.currentTime = introEnd;
        setIsIntroActive(false);
      }
    }
    if (recapStart !== undefined && recapEnd !== undefined) {
      setIsRecapActive(time >= recapStart && time <= recapEnd);
    }
    if (isEpisodic && hasNextEpisode && dur > 0 && dur - time <= 12 && playbackSettings.autoPlayNext && countdownToNext === null) {
      startNextEpisodeCountdown();
    }
    broadcastImmediate();
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  return (
    <div ref={containerRef} onMouseMove={handleMouseMove} onTouchStart={handleMouseMove}
      data-testid="video-player"
      data-season={selectedSeason}
      data-episode={selectedEpisode}
      data-title={currentTitle}
      className="relative w-full h-screen bg-black overflow-hidden select-none flex items-center justify-center font-sans">

      {/* Franjas invisibles de detección de mouse para cuando el iframe captura el cursor (debajo del panel z-40 cuando está visible) */}
      <div onMouseEnter={handleMouseMove} onMouseMove={handleMouseMove} onTouchStart={handleMouseMove} className={`absolute top-0 inset-x-0 h-6 z-30 ${!isTopBarHidden && showControls ? 'pointer-events-none' : 'pointer-events-auto'}`} />
      <div onMouseEnter={handleMouseMove} onMouseMove={handleMouseMove} onTouchStart={handleMouseMove} className="absolute bottom-0 inset-x-0 h-6 z-30 pointer-events-auto" />

      {/* Requisito 2: Spinner mientras resolveService resuelve los mejores servidores */}
      {isResolving && (
        <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center z-50 animate-fadeIn pointer-events-auto">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4 shadow-lg shadow-red-900/40" />
          <h3 className="text-white text-base font-bold tracking-wide">Resolviendo mejores servidores...</h3>
          <p className="text-zinc-400 text-xs mt-1">Buscando fuentes HLS y alternativas validadas en Latino</p>
        </div>
      )}

      {isResolving ? null : captchaRequired && !forceVisibleIframeForCaptcha ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black/95 z-30 select-none p-6 text-center animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500/60 flex items-center justify-center mb-4 text-3xl shadow-lg shadow-amber-900/30">
            🛡️
          </div>
          <h3 className="text-white text-lg sm:text-xl font-bold tracking-wide mb-2">
            Verificación de Seguridad Requerida
          </h3>
          <p className="text-zinc-400 text-xs sm:text-sm max-w-md mb-6">
            El servidor de video solicita una comprobación de Cloudflare para continuar.
          </p>
          <button
            type="button"
            onClick={() => {
              setForceVisibleIframeForCaptcha(true);
            }}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-xl shadow-red-900/40 transition transform hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <span>Se requiere verificación de seguridad. Haz clic aquí para continuar</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : isGhostExtracting && !forceVisibleIframeForCaptcha ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black/95 z-30 select-none animate-fadeIn">
          <div className="relative w-16 h-16 mb-4 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-red-600/30 animate-ping" />
            <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin shadow-lg shadow-red-900/50" />
          </div>
          <h3 className="text-white text-lg font-bold tracking-wide flex items-center gap-2">
            <span>Conectando al servidor de video...</span>
          </h3>
          <p className="text-zinc-400 text-xs mt-1.5 max-w-sm text-center">
            Extrayendo stream directo en segundo plano sin anuncios ni publicidad
          </p>
        </div>
      ) : isIframeMode ? (
        <div className="w-full h-full relative bg-black">
          {typeof window !== 'undefined' && Boolean(window.electronAPI) && !isMovieMasterEmbed ? (
            <WebViewPlayer
              src={activeEmbedUrl}
              reloadKey={iframeReloadKey}
              title={currentTitle}
              onFailLoad={(code, desc) => {
                if (desc?.includes('GUEST_VIEW_MANAGER_CALL') || desc?.includes('Script failed to execute')) return;
                console.warn(`[WebViewPlayer] onFailLoad en iframe (${code} - ${desc}) -> auto-avance al siguiente servidor`);
                if (media.category === 'live_tv') {
                  triggerSignalToast('Canal caído, probando alternativa...');
                }
                advanceToNextServer('Fallo de carga en iframe');
              }}
              onTimeout10s={() => {
                console.warn('[WebViewPlayer] 10s de inactividad en iframe -> auto-avance al siguiente servidor');
                if (media.category === 'live_tv') {
                  triggerSignalToast('Canal caído, probando alternativa...');
                }
                advanceToNextServer('Inactividad 10s en iframe');
              }}
              onVideoLoaded={() => {
                setCaptchaRequired(false);
                setForceVisibleIframeForCaptcha(false);
                markAlgoReproduciendo('webview-video-loaded');
                recordFirstFrame('webview-video-loaded');
              }}
              onDomReady={() => {
                window.electronAPI?.controlActiveMedia?.({
                  action: 'toggleSubtitles',
                  value: subtitlesEnabledRef.current,
                });
                onBroadcastState?.({ subtitlesEnabled: subtitlesEnabledRef.current });
                setTimeout(() => {
                  const webviewEl = containerRef.current?.querySelector('webview');
                  if (!webviewEl) return;
                  const rect = webviewEl.getBoundingClientRect();
                  const centerX = Math.round(rect.left + rect.width / 2);
                  const centerY = Math.round(rect.top + rect.height / 2);
                  window.electronAPI?.simulatePlayClick?.({ x: centerX, y: centerY });
                }, 1800);
              }}
            />
          ) : (
            <iframe
              data-embed
              key={`cinecast_embed_player_${iframeReloadKey}`}
              src={activeEmbedUrl}
              title={currentTitle}
              className="w-full h-full border-0 bg-black"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              sandbox={isMovieMasterEmbed ? undefined : "allow-scripts allow-same-origin allow-forms allow-presentation"}
              referrerPolicy={isMovieMasterEmbed ? 'no-referrer-when-downgrade' : (activeServer?.referrer ? 'no-referrer' : 'origin')}
              onError={(e: any) => {
                const msg = String(e?.message || '');
                if (msg.includes('GUEST_VIEW_MANAGER_CALL') || msg.includes('Script failed to execute')) return;
                console.warn('[iframe onError] Error en iframe ignorado en modo iframe');
              }}
              onLoad={(e) => {
                if (iframeLoadTimeoutRef.current) {
                  clearTimeout(iframeLoadTimeoutRef.current);
                  iframeLoadTimeoutRef.current = null;
                }
                if (!isMovieMasterEmbed) {
                  const iframeEl = e.currentTarget;
                  setTimeout(() => {
                    if (!iframeEl) return;
                    const rect = iframeEl.getBoundingClientRect();
                    const centerX = Math.round(rect.left + rect.width / 2);
                    const centerY = Math.round(rect.top + rect.height / 2);
                    window.electronAPI?.simulatePlayClick?.({ x: centerX, y: centerY });
                  }, 1800);
                }
              }}
            />
          )}
        </div>
      ) : (
        <video
          ref={videoRef}
          key={corsMode ? 'cors' : 'nocors'}
          src={(!videoSrc || videoSrc.includes('.m3u8') || activeServer?.type === 'hls' || (activeServer as any)?.playable === 'hls') ? undefined : videoSrc}
          className="w-full h-full object-contain"
          crossOrigin={corsMode ? 'anonymous' : undefined}
          muted={false}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            if (v.currentTime > 0) {
              if (hlsErrorTimeoutRef.current) {
                clearTimeout(hlsErrorTimeoutRef.current);
                hlsErrorTimeoutRef.current = null;
              }
              setAllServersExhausted(false);
              setUnavailableWarning(false);
              setTvSignalDown(false);
              markAlgoReproduciendo('video-loadeddata', v.currentTime);
              recordFirstFrame('video-loadeddata');
            }
          }}
          onTimeUpdate={() => {
            handleTimeUpdate();
            const v = videoRef.current;
            if (v && v.currentTime > 0) {
              if (hlsErrorTimeoutRef.current) {
                clearTimeout(hlsErrorTimeoutRef.current);
                hlsErrorTimeoutRef.current = null;
              }
              setAllServersExhausted(false);
              setUnavailableWarning(false);
              setTvSignalDown(false);
              markAlgoReproduciendo('video-timeupdate', v.currentTime);
              recordFirstFrame('video-timeupdate');
            }
          }}
          onLoadedMetadata={() => {
            hlsSuccessCallbackRef.current?.('loadedmetadata');
            recordFirstFrame('loadedmetadata');
            console.log(`[VideoPlayer] loadedmetadata recibido para "${activeServer.name}" (id=${(activeServer as any).id})`);
            if (videoRef.current) setDuration(videoRef.current.duration);
            globalAudioEngine.applySettings(audioSettings);
          }}
          onError={() => {
            handleVideoError();
          }}
          onEnded={() => {
            if (isEpisodic && hasNextEpisode && playbackSettings.autoPlayNext) tryAutoAdvanceEpisode();
            else setIsPlaying(false);
          }}
          onClick={togglePlay}
        >
          {directCaptions.map((cap, i) => (
            <track
              key={`cap_${cap.url || i}_${cap.lang || cap.language || ''}`}
              kind="subtitles"
              src={cap.url}
              srcLang={cap.lang || cap.language || 'es'}
              label={cap.label || cap.language || 'Español'}
              default={i === defaultCaptionIndex}
            />
          ))}
        </video>
      )}

      {!isIframeMode && media?.category !== 'live_tv' && (unavailableWarning || cfWarning) && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-zinc-950/95 border border-amber-500/80 shadow-2xl backdrop-blur-md animate-fadeIn text-xs sm:text-sm font-bold">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
          <span className="text-amber-200">
            {cfWarning ? 'Verificación de Cloudflare requerida' : 'Contenido no disponible en este servidor. Cambiando de espejo...'}
          </span>
          <button
            onClick={() => {
              if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
              const nextIdx = (activeServerIndex + 1) % availableServers.length;
              const nextSrv = availableServers[nextIdx];
              triggerSignalToast(nextSrv.name);
              handleSelectServer(nextIdx, { auto: true });
            }}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition flex items-center gap-1.5 border border-zinc-700"
          >
            <RefreshCw className="w-3.5 h-3.5 text-red-400" />
            <span>Rotar espejo</span>
          </button>
          <button
            onClick={handleOpenExternalStream}
            className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black transition flex items-center gap-1.5 shadow-md shadow-red-950/40"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Abrir en navegador</span>
          </button>
        </div>
      )}

      {!isIframeMode && media?.category !== 'live_tv' && tvSignalDown && (!videoRef.current || videoRef.current.currentTime === 0) && (
        <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-6 text-center z-50 animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-red-950/80 border border-red-700/80 flex items-center justify-center mb-4 text-3xl shadow-xl">
            📡
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Señal caída</h3>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            No se pudo sintonizar la transmisión en vivo de {media.title}. La señal puede estar temporalmente fuera de línea.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-bold text-sm flex items-center gap-2 transition"
            >
              <span>⬅️ Volver</span>
            </button>
            <button
              onClick={() => {
                setTvSignalDown(false);
                cfAttemptRef.current = 0;
                setCorsMode(true);
                setVideoSrc(activeServer.url);
              }}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reintentar señal</span>
            </button>
            {availableServers.length > 1 && (
              <button
                onClick={() => {
                  setTvSignalDown(false);
                  const nextIdx = (activeServerIndex + 1) % availableServers.length;
                  handleSelectServer(nextIdx);
                }}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-sm transition"
              >
                Probar otro servidor
              </button>
            )}
            <button
              onClick={handleOpenExternalStream}
              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-bold text-sm flex items-center gap-2 transition"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Abrir en navegador</span>
            </button>
          </div>
        </div>
      )}

      {allServersExhausted && (!videoRef.current || videoRef.current.currentTime === 0) && (
        <div data-testid="all-servers-exhausted" className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-6 text-center z-50 animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-amber-950/80 border border-amber-700/80 flex items-center justify-center mb-4 text-3xl shadow-xl">
            ⚠️
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Ningún servidor respondió</h3>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            Se probaron servidores de streaming pero ninguno entregó una señal activa en este momento.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-base flex items-center justify-center gap-2.5 shadow-xl shadow-red-950 transition hover:scale-[1.02] active:scale-95"
            >
              <span>⬅️ Volver al catálogo</span>
            </button>
            <button
              onClick={() => {
                const servers = availableServersRef.current || [];
                const curSrv = servers[activeServerIndexRef.current];
                const curKey = getServerEpisodeKey(curSrv);
                const curRetries = retryCountByServerEpisodeRef.current.get(curKey) || 0;
                const isKnownUnavailable = unavailableServersForEpisodeRef.current.has(curKey);

                // P2.6: Un solo reintento por servidor y por episodio; nunca reintentar contra un servidor que ya sabemos que no tiene el capítulo.
                if (!isKnownUnavailable && curRetries < 1) {
                  retryCountByServerEpisodeRef.current.set(curKey, curRetries + 1);
                  setManualRetryCount((prev) => prev + 1);
                  setAllServersExhausted(false);
                  setIframeReloadKey((k) => k + 1);
                  return;
                }

                // Buscar otro servidor que no esté marcado como no disponible y tenga < 1 reintento
                for (let offset = 1; offset <= servers.length; offset++) {
                  const idx = (activeServerIndexRef.current + offset) % servers.length;
                  const candidate = servers[idx];
                  const candKey = getServerEpisodeKey(candidate);
                  const candRetries = retryCountByServerEpisodeRef.current.get(candKey) || 0;
                  if (!unavailableServersForEpisodeRef.current.has(candKey) && candRetries < 1) {
                    retryCountByServerEpisodeRef.current.set(candKey, candRetries + 1);
                    failedServersForEpisodeRef.current.delete(candKey);
                    setManualRetryCount((prev) => prev + 1);
                    setAllServersExhausted(false);
                    handleSelectServer(idx, { auto: true });
                    return;
                  }
                }
                triggerSignalToast('Todos los servidores agotaron su único reintento para este capítulo.');
              }}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reintentar</span>
            </button>
            <button
              onClick={async () => {
                await handleToggleDiagnosticMode(true);
                autoSkipCountRef.current = 0;
                consecutiveUnavailableCountRef.current = 0;
                setAllServersExhausted(false);
                setIframeReloadKey((k) => k + 1);
              }}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-sm flex items-center gap-2 shadow-lg transition"
              title="Apaga adblock, shields, reescritura de headers y spoof de UA para probar directamente"
            >
              <Activity className="w-4 h-4 text-black" />
              <span>{isDiagnosticMode ? 'Reintentar (Diag ON)' : 'Probar en Modo Diagnóstico'}</span>
            </button>
            <button
              onClick={handleOpenExternalStream}
              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-bold text-sm flex items-center gap-2 transition"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Abrir en navegador</span>
            </button>
          </div>

          {/* Requisito 3: Selector de servidores manual tras alcanzar los auto-avances */}
          {availableServers.length > 0 && (
            <div className="mt-5 p-4 bg-zinc-900/90 border border-zinc-700/80 rounded-2xl max-w-lg w-full shadow-2xl backdrop-blur-md">
              <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2.5 flex items-center justify-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-red-500" />
                <span>Selector de servidores:</span>
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 max-h-40 overflow-y-auto">
                {availableServers.map((srv, idx) => (
                  <button
                    key={`all_exhausted_srv_${srv.name}_${idx}`}
                    onClick={() => {
                      autoAdvanceCountRef.current = 0;
                      setAllServersExhausted(false);
                      setForceShowServerSelector(false);
                      handleSelectServer(idx);
                    }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition flex items-center gap-1.5 ${activeServerIndex === idx
                      ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-900/40'
                      : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700 hover:text-white'
                      }`}
                  >
                    <span>{srv.name}</span>
                    {srv.language && (
                      <span className="text-[10px] px-1 py-0.2 rounded bg-black/40 text-zinc-400">
                        {srv.language}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {fallbackActive && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-amber-950/90 border border-amber-600/60 text-amber-200 text-xs font-semibold">
          Fuente caída · reproduciendo clip de prueba
        </div>
      )}

      {remoteCommandNotification && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-zinc-900/90 border border-zinc-700/80 text-white text-xs sm:text-sm font-semibold flex items-center gap-2.5 shadow-2xl backdrop-blur-md animate-bounce pointer-events-none">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
          <span>{remoteCommandNotification}</span>
        </div>
      )}

      {signalToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-zinc-950/95 border border-amber-500/60 shadow-2xl flex items-center gap-2.5 text-amber-300 text-xs sm:text-sm font-bold animate-fadeIn backdrop-blur-md pointer-events-none">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
          <span>{signalToast}</span>
        </div>
      )}

      {!isIframeMode && isIntroActive && (
        <div className="absolute bottom-28 right-8 z-40 animate-fadeIn">
          <button onClick={handleSkipIntro}
            className="px-6 py-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-white border-2 border-white/80 font-bold text-sm sm:text-base flex items-center gap-2 backdrop-blur-md shadow-2xl transition hover:scale-105">
            <FastForward className="w-5 h-5 text-red-500" /> Saltar Intro
          </button>
        </div>
      )}

      {!isIframeMode && isRecapActive && (
        <div className="absolute bottom-28 right-8 z-40 animate-fadeIn">
          <button onClick={handleSkipRecap}
            className="px-6 py-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-white border-2 border-white/80 font-bold text-sm sm:text-base flex items-center gap-2 backdrop-blur-md shadow-2xl transition hover:scale-105">
            <FastForward className="w-5 h-5 text-amber-500" /> Saltar Resumen
          </button>
        </div>
      )}

      {!isIframeMode && isEpisodic && countdownToNext !== null && hasNextEpisode && (
        <div className="absolute bottom-28 right-8 z-40 p-4 rounded-xl bg-zinc-950/95 border border-zinc-700 shadow-2xl backdrop-blur-md text-white max-w-xs animate-slideUp">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-red-400 font-bold">Siguiente episodio</span>
            <button onClick={cancelNextCountdown} className="text-zinc-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm font-semibold text-zinc-100 mb-3">
            Iniciando en <span className="text-red-500 font-bold text-base">{countdownToNext}</span> s...
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => { cancelNextCountdown(); handleAdvanceEpisode(1); }}
              className="flex-1 py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1">
              <Play className="w-3 h-3 fill-current" /> Ver ahora
            </button>
            <button onClick={cancelNextCountdown}
              className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {episodeNotExistsWarning && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 bg-amber-950/95 border border-amber-500 text-amber-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-md animate-fadeIn">
          <span className="text-xl">⚠️</span>
          <span className="text-xs font-bold">{episodeNotExistsWarning}</span>
          <button
            onClick={() => setEpisodeNotExistsWarning(null)}
            className="text-amber-400 hover:text-white text-xs font-extrabold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* ZONA DE ACTIVACIÓN BORDE SUPERIOR SI LA BARRA ESTÁ OCULTA */}
      {isTopBarHidden && (
        <div
          onClick={() => setTopBarHiddenPersisted(false)}
          onTouchStart={() => setTopBarHiddenPersisted(false)}
          className="absolute top-0 inset-x-0 h-4 z-50 cursor-pointer group flex items-center justify-center bg-transparent hover:bg-black/40 transition"
          title="Haz clic o pulsa 'H' para mostrar la barra superior"
        >
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/90 text-white text-[10px] font-bold px-3 py-1 rounded-b-xl border border-t-0 border-zinc-700/80 shadow-lg flex items-center gap-1.5 pointer-events-none">
            <Eye className="w-3 h-3 text-red-500" />
            <span>Mostrar barra superior (H)</span>
          </div>
        </div>
      )}

      {/* BARRA SUPERIOR COMPACTA (<= 64px en modo embed/iframe) */}
      <div
        data-testid="player-top-panel"
        data-panel-visible={String(!isTopBarHidden && showControls)}
        onMouseEnter={() => {
          isPointerOverPanelRef.current = true;
          setIsPointerOverPanel(true);
        }}
        onMouseLeave={() => {
          isPointerOverPanelRef.current = false;
          setIsPointerOverPanel(false);
        }}
        className={`absolute inset-x-0 top-0 z-40 transition-all duration-300 ${isIframeMode ? 'h-14 sm:h-16 px-3 sm:px-6 py-2 bg-gradient-to-b from-black/95 via-black/80 to-transparent' : 'p-4 sm:p-6 bg-gradient-to-b from-black/95 via-black/80 to-transparent'
          } ${isTopBarHidden
            ? 'opacity-0 pointer-events-none -translate-y-4'
            : showControls
              ? 'opacity-100 pointer-events-auto translate-y-0'
              : 'opacity-0 pointer-events-none -translate-y-2'
          }`}
      >
        <div className="flex items-center justify-between gap-2 sm:gap-4 h-full pointer-events-auto">
          {/* Lado Izquierdo: Volver + Título + Capítulos + Idioma + Badges */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-white transition backdrop-blur-md border border-zinc-700/60 shrink-0"
              title="Volver atrás"
              aria-label="Cerrar Reproductor"
              data-testid="close-player"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="min-w-0 flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <h2 className="text-xs sm:text-sm md:text-base font-bold text-white drop-shadow truncate max-w-[130px] sm:max-w-xs md:max-w-md">
                {currentTitle}
              </h2>

              {isEpisodic && (
                <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-700/80 px-2 py-0.5 rounded-xl shadow-lg shrink-0">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden md:inline">Capítulo:</span>
                  <select
                    data-testid="season-select"
                    value={selectedSeason}
                    onChange={(e) => {
                      const newS = Number(e.target.value);
                      onRequestEpisodeChange?.(newS, 1);
                      setIframeReloadKey((k) => k + 1);
                    }}
                    className="bg-zinc-800 text-white rounded-md px-1.5 py-0.5 text-[11px] font-bold border border-zinc-600 outline-none hover:bg-zinc-700 cursor-pointer"
                  >
                    {(realSeasons.length > 0
                      ? (realSeasons.some((s) => s.seasonNumber === selectedSeason)
                        ? realSeasons
                        : [...realSeasons, { seasonNumber: selectedSeason, name: `Temporada ${selectedSeason}`, episodeCount: 10 }].sort((a, b) => a.seasonNumber - b.seasonNumber))
                      : Array.from({ length: Math.max(selectedSeason, media.seasonsCount || (media.seasons ? media.seasons.length : 1)) }, (_, i) => ({
                        seasonNumber: i + 1,
                        name: `Temporada ${i + 1}`,
                        episodeCount: 10,
                      }))
                    ).map((s) => (
                      <option key={s.seasonNumber} value={s.seasonNumber}>
                        T{s.seasonNumber}
                      </option>
                    ))}
                  </select>
                  <select
                    data-testid="episode-select"
                    value={selectedEpisode}
                    onChange={(e) => {
                      const newEp = Number(e.target.value);
                      onRequestEpisodeChange?.(selectedSeason, newEp);
                      setEpisodeNotExistsWarning(null);
                      setIframeReloadKey((k) => k + 1);
                    }}
                    className="bg-zinc-800 text-white rounded-md px-1.5 py-0.5 text-[11px] font-bold border border-zinc-600 outline-none hover:bg-zinc-700 cursor-pointer"
                  >
                    {(realEpisodes.length > 0
                      ? (realEpisodes.some((e) => e.episode === selectedEpisode)
                        ? realEpisodes
                        : [...realEpisodes, { season: selectedSeason, episode: selectedEpisode, title: `Episodio ${selectedEpisode}` }].sort((a, b) => a.episode - b.episode))
                      : Array.from({ length: Math.max(selectedEpisode, realSeasons.find((s) => s.seasonNumber === selectedSeason)?.episodeCount || 8) }, (_, i) => ({
                        season: selectedSeason,
                        episode: i + 1,
                        title: `Episodio ${i + 1}`,
                      }))
                    ).map((e) => (
                      <option key={e.episode} value={e.episode}>
                        E{e.episode}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="player-next-episode-btn"
                    onClick={() => handleAdvanceEpisode(1)}
                    title="Siguiente capítulo (N)"
                    className="ml-0.5 px-2 py-0.5 rounded-md bg-red-600/90 hover:bg-red-500 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer shrink-0"
                  >
                    <span>Siguiente</span>
                    <SkipForward className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isEpisodic && (
                <button
                  type="button"
                  onClick={toggleMarathonMode}
                  className={`px-2 py-0.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1 border shadow-lg shrink-0 ${marathonMode
                    ? 'bg-emerald-600/90 text-white border-emerald-400'
                    : 'bg-zinc-900/90 text-zinc-400 border-zinc-700/80 hover:text-white'
                    }`}
                  title="Modo Maratón: auto-salto directo sin cuenta atrás"
                >
                  <span>🏃</span>
                  <span className="hidden sm:inline">Maratón</span>
                  {marathonMode && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                </button>
              )}

              {/* Selector Rápido Latino / Sub */}
              <div className="flex items-center bg-zinc-900/90 border border-zinc-700/80 p-0.5 rounded-xl shadow-lg shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const latIdx = availableServers.findIndex((s) => isLatinoServerMatch(s));
                    if (latIdx !== -1) {
                      handleSelectServer(latIdx);
                      audioPrefs.setForMedia(mediaKey, availableServers[latIdx].name, 'latino', selectedSeason, selectedEpisode);
                    } else if (availableServers.length > 0) {
                      handleSelectServer(0);
                      audioPrefs.setForMedia(mediaKey, availableServers[0].name, 'latino', selectedSeason, selectedEpisode);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${isLatinoServerMatch(activeServer)
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white bg-zinc-800/80'
                    }`}
                  title="Audio Español Latino"
                >
                  <span>🇲🇽</span><span className="hidden sm:inline">Latino</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const strictSubIdx = availableServers.findIndex((s) => isSubServerMatch(s) && !isLatinoServerMatch(s));
                    const subIdx = strictSubIdx !== -1 ? strictSubIdx : availableServers.findIndex((s) => isSubServerMatch(s));
                    if (subIdx !== -1) {
                      handleSelectServer(subIdx);
                      audioPrefs.setForMedia(mediaKey, availableServers[subIdx].name, 'sub', selectedSeason, selectedEpisode);
                    } else if (availableServers.length > 1) {
                      handleSelectServer(1);
                      audioPrefs.setForMedia(mediaKey, availableServers[1].name, 'sub', selectedSeason, selectedEpisode);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${isSubServerMatch(activeServer) && !isLatinoServerMatch(activeServer)
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white bg-zinc-800/80'
                    }`}
                  title="Audio Original con Subtítulos"
                >
                  <span>💬</span><span className="hidden sm:inline">Sub</span>
                </button>
              </div>

              {/* TAREA 6: Badge de verificación con timeout de 12s */}
              {isIframeMode && (
                <div className="hidden lg:flex items-center shrink-0">
                  {detectedTracks === null ? (
                    audioCheckTimedOut ? (
                      <span className="px-2 py-0.5 rounded-md bg-zinc-800/90 border border-zinc-700/80 text-zinc-400 text-[10px] font-medium shadow-sm">
                        Audio: sin verificar
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-zinc-800/90 border border-zinc-700/80 text-zinc-300 text-[10px] font-medium shadow-sm animate-pulse">
                        🔎 Verificando audio...
                      </span>
                    )
                  ) : detectedTracks.audio.includes('es') ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 text-[10px] font-bold shadow-sm animate-fadeIn">
                      🟢 Audio español
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[10px] font-bold shadow-sm animate-fadeIn">
                      ⚠️ Audio original
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Lado Derecho: Controles + Botón Ocultar Barra + Pantalla Completa */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Botón Subtítulos */}
            <button
              type="button"
              onClick={async () => {
                const nextSub = !subtitlesEnabled;
                setSubtitlesEnabled(nextSub);
                subtitlesEnabledRef.current = nextSub;
                try {
                  localStorage.setItem('cinecast_subtitles_pref', nextSub ? '1' : '0');
                } catch { }
                await window.electronAPI?.controlActiveMedia?.({ action: 'toggleSubtitles', value: nextSub });
                onBroadcastState?.({ subtitlesEnabled: nextSub });
              }}
              className={`px-2 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 border shadow-lg ${subtitlesEnabled
                ? 'bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:text-white'
                : 'bg-red-950/80 border-red-700/80 text-red-300'
                }`}
              title="Activar / Desactivar Subtítulos"
            >
              <span>💬</span>
              <span className="hidden sm:inline">Subs: {subtitlesEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {onOpenAudioSettings && !isIframeMode && (
              <button
                onClick={onOpenAudioSettings}
                className="px-2.5 py-1 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-700/60 transition flex items-center gap-1.5 backdrop-blur-md"
              >
                <Sliders className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden md:inline">Ecualizador</span>
              </button>
            )}

            {/* TAREA 1: Botón Ocultar Barra (icono ojo/chevron) */}
            <button
              type="button"
              onClick={() => setTopBarHiddenPersisted(true)}
              onTouchStart={() => setTopBarHiddenPersisted(true)}
              className="px-2.5 py-1 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/60 transition backdrop-blur-md flex items-center gap-1.5 text-xs font-bold shadow-md cursor-pointer"
              title="Ocultar barra superior (Pulsa tecla 'H' o clic en borde superior para volver a mostrar)"
            >
              <EyeOff className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Ocultar (H)</span>
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 sm:p-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/60 transition backdrop-blur-md"
              title="Pantalla Completa"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Franja fina para iframe si no arrancó en 6 s */}
      {isIframeMode && showIframePlayBanner && !hasStartedWatchingRef.current && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-zinc-950/90 border border-zinc-700/80 backdrop-blur-md px-4 py-1.5 rounded-full shadow-lg flex items-center gap-2 animate-fadeIn">
          <span className="text-xs text-zinc-300 font-medium">¿El reproductor no inició?</span>
          <button
            type="button"
            onClick={() => {
              togglePlay();
              setShowIframePlayBanner(false);
            }}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-full transition flex items-center gap-1 shadow cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" /> Iniciar reproducción
          </button>
        </div>
      )}

      {/* BARRA INFERIOR FLOTANTE DE SERVIDORES (libera la barra superior para nunca tapar el embed) */}
      {availableServers.length > 1 && (
        <div
          style={isFullscreen && !((showControls || forceShowServerSelector) && !isTopBarHidden) ? { zIndex: -1, opacity: 0 } : undefined}
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-950/90 border border-zinc-700/80 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-2xl flex items-center gap-1.5 max-w-[92vw] overflow-x-auto no-scrollbar transition-all duration-300 ${isFullscreen
            ? (showControls || forceShowServerSelector) && !isTopBarHidden
              ? 'z-40 opacity-100 pointer-events-auto'
              : '-z-10 opacity-0 pointer-events-none'
            : (showControls || forceShowServerSelector) && !isTopBarHidden
              ? 'z-40 opacity-100 pointer-events-auto'
              : 'z-40 opacity-0 pointer-events-none'
            }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 shrink-0 flex items-center gap-1 mr-1">
            <Server className="w-3.5 h-3.5 text-red-500" /> Servidores:
          </span>
          {availableServers.map((srv, idx) => {
            const isSelected = activeServerIndex === idx;
            return (
              <button
                key={`${srv.name}_${idx}`}
                type="button"
                onClick={() => handleSelectServer(idx)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 border shrink-0 ${isSelected
                  ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-900/40'
                  : 'bg-zinc-900/90 text-zinc-300 border-zinc-700/70 hover:bg-zinc-800 hover:text-white'
                  }`}
              >
                <span>{srv.name}</span>
                {srv.language && (
                  <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isSelected ? 'bg-black/30 text-amber-200' : 'bg-zinc-800 text-zinc-400'}`}>
                    {srv.language}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!isIframeMode && (
        <div className={`absolute inset-0 z-30 flex flex-col justify-between p-6 sm:p-8 bg-gradient-to-t from-black/95 via-transparent to-transparent transition-opacity duration-300 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-16" />
          <div className="flex items-center justify-center pointer-events-none">
            {!isPlaying && !isIframeMode && (
              <button onClick={togglePlay}
                className="p-6 rounded-full bg-red-600/90 hover:bg-red-600 text-white transition transform hover:scale-110 shadow-2xl pointer-events-auto backdrop-blur-md animate-pulse">
                <Play className="w-12 h-12 fill-current translate-x-1" />
              </button>
            )}
          </div>
          <div className="space-y-3 pointer-events-auto">
            <div className="relative group cursor-pointer flex items-center">
              <input type="range" min="0" max={duration || 100} value={currentTime}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="w-full h-1.5 group-hover:h-2.5 bg-zinc-700/80 rounded-lg appearance-none cursor-pointer accent-red-600 transition-all" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 sm:gap-4">
                <button onClick={togglePlay} className="p-2 text-white hover:text-red-500 transition">
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current" />}
                </button>
                <button onClick={() => seekRelative(-10)} className="p-2 text-zinc-300 hover:text-white transition flex items-center gap-1">
                  <RotateCcw className="w-5 h-5" /><span className="text-[10px] font-mono">10</span>
                </button>
                <button onClick={() => seekRelative(10)} className="p-2 text-zinc-300 hover:text-white transition flex items-center gap-1">
                  <RotateCw className="w-5 h-5" /><span className="text-[10px] font-mono">10</span>
                </button>
                {isEpisodic && hasNextEpisode && onNextEpisode && (
                  <button onClick={onNextEpisode} className="p-2 text-zinc-300 hover:text-white transition">
                    <ChevronRight className="w-6 h-6" />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => onUpdateAudio({ isMuted: !audioSettings.isMuted })} className="p-1 text-zinc-300 hover:text-white transition">
                    {audioSettings.isMuted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <input type="range" min="0" max="100"
                    value={audioSettings.isMuted ? 0 : audioSettings.volume}
                    onChange={(e) => onUpdateAudio({ volume: Number(e.target.value), isMuted: false })}
                    className="w-16 sm:w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-red-600" />
                  <span className="text-xs font-mono text-zinc-400 min-w-8">{audioSettings.volume}%</span>
                </div>
                <div className="text-xs font-mono text-zinc-400">
                  <span>{formatTime(currentTime)}</span><span className="mx-1">/</span><span>{formatTime(duration)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={toggleFullscreen} className="p-2 text-zinc-300 hover:text-white transition">
                  {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
