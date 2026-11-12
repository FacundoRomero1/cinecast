import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { MediaItem, Episode, AudioSettings, PlaybackSettings, RemoteCommand, StreamServer } from '../types';
import { generateServersForMedia } from '../services/embedService';
import { globalAudioEngine } from '../services/audioEngine';
import { watchHistoryService } from '../services/watchHistoryService';
import { audioPrefs } from '../services/audioPrefs';
import { diagnosticService } from '../services/diagnosticService';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize, Minimize,
  ArrowLeft, FastForward, Sliders, ChevronRight, X, Server, RefreshCw, Globe, Sparkles, ExternalLink,
  Eye, EyeOff, ChevronUp, Activity
} from 'lucide-react';

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
  onBroadcastState?: (stateUpdate: any) => void;
  remoteCommandNotification?: string | null;
  onOpenAudioSettings?: () => void;
  remoteCommandTrigger?: { cmd: RemoteCommand; timestamp: number } | null;
  initialTime?: number;
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

// ── Componente WebView para Electron con control nativo de ciclo de vida (Paso 2 - CENSURA) ──
interface WebViewPlayerProps {
  src: string;
  reloadKey: number;
  title: string;
  onFailLoad: (errorCode: number, errorDesc: string) => void;
  onDomReady: () => void;
  onTimeout10s?: () => void;
}

const WebViewPlayer: React.FC<WebViewPlayerProps> = ({
  src,
  reloadKey,
  title,
  onFailLoad,
  onDomReady,
  onTimeout10s,
}) => {
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    let hasStarted = false;

    // Detecta si Cloudflare o un error de red bloquea la carga
    const handleFailLoad = (event: any) => {
      if (event.errorCode === -3) return; // ERR_ABORTED normal al navegar
      console.warn('[WebViewPlayer] Fallo de carga (posible Cloudflare):', event.errorCode, event.errorDescription);
      onFailLoad(event.errorCode, event.errorDescription || 'did-fail-load');
    };

    const handleDomReady = () => {
      console.log('[WebViewPlayer] DOM listo, inyectando autoplay');
      try {
        webview.executeJavaScript(`
          try {
            const video = document.querySelector('video');
            if (video) {
              video.autoplay = true;
              video.play().catch(() => {});
            }
          } catch (_) {}
        `);
      } catch (_) {}
      hasStarted = true;
      onDomReady();
    };

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
    webview.addEventListener('page-title-updated', handlePageTitleUpdated);

    return () => {
      clearTimeout(watchdogTimer);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('page-title-updated', handlePageTitleUpdated);
    };
  }, [src, reloadKey, onFailLoad, onDomReady, onTimeout10s]);

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

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media, episode, audioSettings, playbackSettings, onUpdateAudio, onClose,
  onNextEpisode, onPrevEpisode, hasNextEpisode = false, onBroadcastState,
  remoteCommandNotification, onOpenAudioSettings, remoteCommandTrigger, initialTime = 0,
}) => {
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
  const [corsMode, setCorsMode] = useState(true);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [cfWarning, setCfWarning] = useState(false);
  const [unavailableWarning, setUnavailableWarning] = useState(false);
  const skipTimeoutRef = useRef<any>(null);

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
    } catch (_) {}
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

  // Atajo de teclado 'H' para alternar barra superior
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setTopBarHiddenPersisted(!isTopBarHidden);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTopBarHidden, setTopBarHiddenPersisted]);

  const isSeriesOrAnime =
    media.type === 'series' || media.category === 'series' || media.category === 'anime' ||
    Boolean(media.seasons?.length) || Boolean(media.episodes?.length);
  const isEpisodic =
    (media.type === 'series' || media.category === 'series' || media.category === 'anime') &&
    media.category !== 'live_tv';

  // Tarea A: Extracción robusta de TMDB ID que soporta tmdb-series-1418_s1_e15, slugs y números
  const tmdbIdToUse = useMemo(() => {
    const direct = Number((media as any).tmdbId);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return extractTmdbId(media.id);
  }, [media.id, (media as any).tmdbId]);

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

  const availableServers: StreamServer[] = useMemo(() => {
    // 1. IPTV / en vivo: el item ya trae su única señal
    if (media.category === 'live_tv' || media.streamType === 'hls') {
      if (episode?.servers?.length) return episode.servers;
      if (media.servers?.length) return media.servers;
    }

    // 2. Pelis Y series: generar los espejos por TMDB
    if (tmdbIdToUse > 0) {
      return generateServersForMedia({
        tmdbId: tmdbIdToUse,
        type: isSeriesOrAnime ? 'series' : 'movie',
        season: selectedSeason,
        episode: selectedEpisode,
      });
    }

    // 3. Fallbacks
    if (episode?.servers?.length) return episode.servers;
    if (media.servers?.length) return media.servers;

    const isEmbed =
      media.streamType === 'iframe' || currentVideoUrl.includes('vidsrc') ||
      currentVideoUrl.includes('embed') || currentVideoUrl.includes('multiembed');

    return [{
      name: isEmbed ? 'Servidor Embed 1' : 'Servidor Principal',
      url: currentVideoUrl || 'https://vjs.zencdn.net/v/oceans.mp4',
      type: isEmbed ? 'iframe' : 'mp4',
      language: 'Principal',
    }];
  }, [media, episode, currentVideoUrl, isSeriesOrAnime, tmdbIdToUse, selectedSeason, selectedEpisode]);

  const PREFERRED_SERVER_STORAGE_KEY = 'cinecast_preferred_server';

  const mediaKey = (media as any).tmdbId || media.id;
  const [selectedServerName, setSelectedServerName] = useState<string>(() => {
    const pref = audioPrefs.getForMedia(mediaKey, selectedSeason, selectedEpisode);
    if (pref?.serverName) return pref.serverName;
    try {
      const saved = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
      if (saved && !saved.toLowerCase().includes('autoembed')) return saved;
    } catch (_) {}
    return 'TukiPlay (HD)';
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

  // Al cambiar temporada o episodio, sincronizar preferencia guardada específica para este título
  useEffect(() => {
    const pref = audioPrefs.getForMedia(mediaKey, selectedSeason, selectedEpisode);
    if (pref?.serverName) {
      setSelectedServerName(pref.serverName);
    }
  }, [mediaKey, selectedSeason, selectedEpisode]);

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

  const hasNoSpanishAudio = Boolean(detectedTracks && !detectedTracks.audio.includes('es'));

  const [tvSignalDown, setTvSignalDown] = useState<boolean>(false);
  const [allServersExhausted, setAllServersExhausted] = useState<boolean>(false);
  const autoSkipCountRef = useRef<number>(0);
  const consecutiveUnavailableCountRef = useRef<number>(0);
  const iframeLoadedAtRef = useRef<number>(Date.now());

  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [seekUnsupported, setSeekUnsupported] = useState<boolean>(false);

  const [signalToast, setSignalToast] = useState<string | null>(null);
  const signalToastTimerRef = useRef<any>(null);

  const triggerSignalToast = useCallback((serverName: string) => {
    if (signalToastTimerRef.current) clearTimeout(signalToastTimerRef.current);
    setSignalToast(`Optimizando señal... cambiando a ${serverName}`);
    signalToastTimerRef.current = setTimeout(() => {
      setSignalToast(null);
    }, 3500);
  }, []);

  const activeServerIndex = useMemo(() => {
    if (!availableServers || availableServers.length === 0) return 0;
    // 1. Coincidencia con preferencia guardada específica para este título
    const pref = audioPrefs.getForMedia(mediaKey, selectedSeason, selectedEpisode);
    if (pref?.serverName) {
      const idx = availableServers.findIndex((s) => s.name.toLowerCase() === pref.serverName.toLowerCase());
      if (idx !== -1) return idx;
    }

    // 2. Coincidencia con el seleccionado actual
    let matchIdx = availableServers.findIndex(
      (s) => s.name.toLowerCase() === selectedServerName.toLowerCase()
    );
    if (matchIdx !== -1) return matchIdx;

    // 3. Coincidencia con el servidor favorito guardado en localStorage
    try {
      const saved = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
      if (saved) {
        matchIdx = availableServers.findIndex(
          (s) => s.name.toLowerCase() === saved.toLowerCase()
        );
        if (matchIdx !== -1) return matchIdx;
      }
    } catch (_) {}

    return 0;
  }, [availableServers, selectedServerName, mediaKey, selectedSeason, selectedEpisode]);

  const activeServer: StreamServer = availableServers[activeServerIndex] || availableServers[0] || {
    name: 'VidSrc ME (Principal HD)', url: currentVideoUrl, type: 'iframe', language: 'Multi-Audio',
  };

  const isIframeMode = activeServer.type === 'iframe';
  const [videoSrc, setVideoSrc] = useState<string>(activeServer.url);

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
      } catch (_) {}
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

  // Referencias sincronizadas para evitar valores viejos por closures en broadcastImmediate
  const subtitlesEnabledRef = useRef(subtitlesEnabled);
  const availableServersRef = useRef(availableServers);
  const activeServerIndexRef = useRef(activeServerIndex);
  const selectedSeasonRef = useRef(selectedSeason);
  const selectedEpisodeRef = useRef(selectedEpisode);

  useEffect(() => { subtitlesEnabledRef.current = subtitlesEnabled; }, [subtitlesEnabled]);
  useEffect(() => { availableServersRef.current = availableServers; }, [availableServers]);
  useEffect(() => { activeServerIndexRef.current = activeServerIndex; }, [activeServerIndex]);
  useEffect(() => { selectedSeasonRef.current = selectedSeason; }, [selectedSeason]);
  useEffect(() => { selectedEpisodeRef.current = selectedEpisode; }, [selectedEpisode]);

  const activeEmbedUrl = useMemo(() => {
    if (!activeServer?.url) return '';
    // PASO 1 (CENSURA): Validación estricta de ID limpio
    const cleanId = String(tmdbIdToUse || '').replace(/[^0-9]/g, '');
    if (!cleanId || isNaN(Number(cleanId)) || Number(cleanId) <= 0) {
      console.error(`[VideoPlayer] ID inválido detectado para: "${currentTitle}" (cleanId=${cleanId})`);
      return ''; // Detiene la carga si el ID está corrupto
    }
    const url = activeServer.url;
    if (url.includes('autoplay=')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}autoplay=1`;
  }, [activeServer, tmdbIdToUse, currentTitle]);

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
    } catch (_) {}

    if (availableServers.length > 1) {
      const nextSrv = availableServers[(activeServerIndex + 1) % availableServers.length];
      if (nextSrv?.url) {
        try {
          const nextOrigin = new URL(nextSrv.url).origin;
          if (nextOrigin.startsWith('http')) origins.add(nextOrigin);
        } catch (_) {}
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
    setCurrentTime(0);
    setHasAutoSkippedIntro(false);
    setCountdownToNext(null);
    setFallbackActive(false);
    setCfWarning(false);
    setUnavailableWarning(false);
    consecutiveUnavailableCountRef.current = 0;
    autoSkipCountRef.current = 0;
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
  }, [audioSettings, isIframeMode]);

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
    if (index < 0 || index >= availableServers.length) return;
    const srv = availableServers[index];
    if (!opts?.auto) {
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
    setSelectedServerName(srv.name);
    setDetectedTracks(null);
    setTvSignalDown(false);
    iframeLoadedAtRef.current = Date.now();
    try {
      localStorage.setItem(PREFERRED_SERVER_STORAGE_KEY, srv.name);
    } catch (_) {}
    const isLat = srv.language?.toLowerCase().includes('latino') || srv.name.toLowerCase().includes('latino');
    audioPrefs.setForMedia(mediaKey, srv.name, isLat ? 'latino' : 'sub', selectedSeason, selectedEpisode);
    setIframeReloadKey((k) => k + 1);
    setCfWarning(false);
    setUnavailableWarning(false);
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
    if (srv.type !== 'iframe') {
      setCorsMode(true);
      corsRetryRef.current = 0;
      setVideoSrc(srv.url);
    }
    onBroadcastState?.({
      activeServerIndex: index,
      activeServerName: srv.name,
      activeServerType: srv.type,
      servers: availableServers,
      detectedTracks: null,
    });
  }, [availableServers, onBroadcastState, mediaKey, selectedSeason, selectedEpisode]);

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

  // ── PASO 2 (CENSURA): Rotación inmediata al siguiente servidor espejo ──
  const rotateToNextServer = useCallback((reason = 'Fallo de carga o timeout en webview') => {
    if (availableServersRef.current.length <= 1) return;
    const nextIdx = (activeServerIndexRef.current + 1) % availableServersRef.current.length;
    const nextSrv = availableServersRef.current[nextIdx];
    console.warn(`[rotateToNextServer] Motivo: ${reason} | ${activeServer?.name} -> Siguiente: ${nextSrv?.name}`);
    if (nextSrv) {
      triggerSignalToast(`Cambiando a ${nextSrv.name}...`);
      handleSelectServer(nextIdx, { auto: true });
    }
  }, [handleSelectServer, triggerSignalToast, activeServer?.name]);

  // ── Error de vídeo: reintento sin CORS y luego fallback / auto-rotación ──
  const handleVideoError = useCallback(() => {
    // Para deportes / IPTV (Paso 4 - CENSURA): Probar el siguiente servidor mirror en lugar de caer directo
    if (media.category === 'live_tv' || activeServer.type === 'hls') {
      if (availableServers.length > 1 && cfAttemptRef.current < availableServers.length - 1) {
        cfAttemptRef.current += 1;
        const nextIdx = (activeServerIndex + 1) % availableServers.length;
        const nextSrv = availableServers[nextIdx];
        console.warn(`[VideoPlayer] Error en canal de deportes (${activeServer.name}) -> rotando a mirror: ${nextSrv.name}...`);
        triggerSignalToast(`Señal falló -> Conectando a ${nextSrv.name}...`);
        handleSelectServer(nextIdx, { auto: true });
        return;
      }
      setTvSignalDown(true);
      return;
    }
    if (corsMode && !videoSrc.includes('.m3u8') && corsRetryRef.current === 0) {
      corsRetryRef.current += 1;
      console.warn('[VideoPlayer] Host sin CORS -> reintento sin crossOrigin');
      setCorsMode(false);
      return;
    }
    if (availableServers.length > 1 && cfAttemptRef.current < availableServers.length - 1) {
      cfAttemptRef.current += 1;
      const nextIdx = (activeServerIndex + 1) % availableServers.length;
      const nextSrv = availableServers[nextIdx];
      console.warn(`[VideoPlayer] Error en servidor actual (${activeServer.name}) -> rotando a ${nextSrv.name}...`);
      triggerSignalToast(nextSrv.name);
      handleSelectServer(nextIdx, { auto: true });
      return;
    }
    if (videoSrc !== FALLBACK_SRC) {
      console.warn('[VideoPlayer] Fuente inaccesible -> clip de prueba');
      setFallbackActive(true);
      setVideoSrc(FALLBACK_SRC);
    }
  }, [corsMode, videoSrc, availableServers, activeServerIndex, activeServer, media.category, handleSelectServer, triggerSignalToast]);

  // ── PASO 3 (CENSURA): Watchdog proactivo "Anti-Bloqueo" (buffer stalls & auto-rotate) ──
  useEffect(() => {
    if (isIframeMode || !videoRef.current) return;
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
        const srv = activeServer as any;
        try {
          await api.setStreamHeaders({
            url: videoSrc,
            referrer: srv?.referrer ?? media.streamReferrer ?? (media as any)?.referrer ?? null,
            userAgent: srv?.userAgent ?? media.streamUserAgent ?? (media as any)?.userAgent ?? null,
          });
        } catch (_) {}
      }

      if (isCancelled || !videoRef.current) return;

      const isLiveStream = media.category === 'live_tv' || activeServer.type === 'hls';

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
            if (availableServers.length > 1 && cfAttemptRef.current < availableServers.length - 1) {
              cfAttemptRef.current += 1;
              const nextIdx = (activeServerIndex + 1) % availableServers.length;
              const nextSrv = availableServers[nextIdx];
              triggerSignalToast(`Señal caída -> Conectando a ${nextSrv.name}...`);
              handleSelectServer(nextIdx, { auto: true });
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

      if (videoSrc.includes('.m3u8')) {
        if (Hls.isSupported()) {
          let fragErrorCount = 0;
          hlsInstance = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            liveSyncDurationCount: 3,
          });
          hlsInstance.attachMedia(videoRef.current);
          hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
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
            isHlsLoadingManifest = false;
            isHlsBuffering = false;
            if (videoRef.current && !isCancelled) {
              setTvSignalDown(false);
              videoRef.current.muted = false;
              videoRef.current.play().then(() => {
                setIsPlaying(true);
                onBroadcastState?.({ isPlaying: true });
              }).catch(() => {
                window.electronAPI?.simulatePlayClick?.();
                videoRef.current?.play().catch(() => {});
              });
            }
          });
          hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
            if (isCancelled) return;
            // TAREA 4: En error de fragmento reintentar startLoad(), y si falla 3 veces recargar fuente
            if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR) {
              fragErrorCount += 1;
              console.warn('[VideoPlayer] Falló carga de fragmento HLS (reintento ' + fragErrorCount + '):', data.frag?.url);
              if (fragErrorCount >= 3) {
                console.warn('[VideoPlayer] 3 fragmentos consecutivos fallidos -> recargando fuente');
                fragErrorCount = 0;
                hlsInstance?.loadSource(videoSrc);
                hlsInstance?.startLoad();
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
            hlsInstance?.destroy();

            if (media.category === 'live_tv' || activeServer.type === 'hls') {
              if (availableServers.length > 1 && cfAttemptRef.current < availableServers.length - 1) {
                cfAttemptRef.current += 1;
                const nextIdx = (activeServerIndex + 1) % availableServers.length;
                const nextSrv = availableServers[nextIdx];
                triggerSignalToast(`Señal caída -> Conectando a ${nextSrv.name}...`);
                handleSelectServer(nextIdx, { auto: true });
              } else {
                setTvSignalDown(true);
              }
              return;
            }

            if (availableServers.length > 1 && cfAttemptRef.current < availableServers.length - 1) {
              cfAttemptRef.current += 1;
              const nextIdx = (activeServerIndex + 1) % availableServers.length;
              const nextSrv = availableServers[nextIdx];
              triggerSignalToast(`Señal caída -> Conectando a ${nextSrv.name}...`);
              handleSelectServer(nextIdx, { auto: true });
            } else {
              triggerSignalToast('⚠️ Señal inaccesible');
              handleVideoError();
            }
          });
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = videoSrc;
          videoRef.current.play().catch(() => {});
        }
      } else {
        videoRef.current.src = videoSrc;
      }
    };

    initHlsStream();

    return () => {
      isCancelled = true;
      if (liveWatchdogTimer) clearTimeout(liveWatchdogTimer);
      vEl.removeEventListener('waiting', onWaiting);
      vEl.removeEventListener('canplay', onCanPlay);
      hlsInstance?.destroy();
    };
  }, [videoSrc, isIframeMode, corsMode, availableServers, activeServerIndex, activeServer, media, handleSelectServer, triggerSignalToast, handleVideoError, onBroadcastState]);

  const handleOpenExternalStream = useCallback(() => {
    const url = activeServer?.url || activeEmbedUrl;
    if (!url) return;
    const api = window.electronAPI;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }, [activeServer, activeEmbedUrl]);

  // ── Detección de "Contenido no disponible" o Cloudflare + auto-salto controlado con backoff ───
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

    // Sondeo de estado cada 2000ms en modo iframe
    const interval = setInterval(async () => {
      const api = window.electronAPI;
      if (!api?.getEmbedStatus || cancelled) return;

      // 1. Esperar 10000ms tras el load del iframe antes de evaluar errores de disponibilidad
      if (Date.now() - iframeLoadedAtRef.current < 10000) return;

      const st = await api.getEmbedStatus();
      if (cancelled || !st?.ok) return;

      // 2. Contenido no disponible: exige 3 detecciones consecutivas
      if (st.contentUnavailable) {
        consecutiveUnavailableCountRef.current += 1;
        if (consecutiveUnavailableCountRef.current >= 3) {
          setUnavailableWarning(true);
          consecutiveUnavailableCountRef.current = 0;
          rotateWithBackoff('Contenido reportado no disponible (3 detecciones consecutivas tras 10s)');
        }
      } else {
        consecutiveUnavailableCountRef.current = 0;
      }

      // Desafío / Bloqueo de Cloudflare: salta con back-off
      if (st.cloudflare) {
        setCfWarning(true);
        rotateWithBackoff('Desafío Cloudflare persistente en frame');
      }
    }, 2000);

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
  }, [activeEmbedUrl, iframeReloadKey, isIframeMode, rotateWithBackoff]);

  // ── Auto-salto cuando un espejo falla la carga de red con backoff ───
  useEffect(() => {
    if (!isIframeMode) return;
    const api = window.electronAPI;
    if (!api?.onEmbedFailed) return;
    const off = api.onEmbedFailed((err: any) => {
      const reason = `Fallo crítico de red did-fail-load (código: ${err?.code || 'ERR'}, url: ${err?.url || 'n/a'})`;
      rotateWithBackoff(reason);
    });
    return () => off?.();
  }, [isIframeMode, rotateWithBackoff]);

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

    onBroadcastState({
      currentTime: time,
      duration: dur,
      isPlaying: playing,
      seekUnsupported: extraOverrides?.seekUnsupported ?? (isIframeMode ? seekUnsupported : false),
      marathon: marathonMode,
      hasIntroTimings: introStart !== undefined && introEnd !== undefined,
      isIntroActive: introStart !== undefined && introEnd !== undefined && time >= introStart && time <= introEnd,
      isRecapActive: recapStart !== undefined && recapEnd !== undefined && time >= recapStart && time <= recapEnd,
      servers: availableServersRef.current.map((s) => ({ name: s.name, language: s.language })),
      activeServerIndex: activeServerIndexRef.current,
      serversExhausted: fallbackActive,
      activeServerName: activeServer?.name || '',
      activeServerType: activeServer?.type || 'iframe',
      subtitlesEnabled: subtitlesEnabledRef.current,
      mediaTitle: currentTitle,
      mediaPoster: media.posterUrl || media.backdropUrl || '',
      seasonNumber: selectedSeasonRef.current,
      episodeNumber: selectedEpisodeRef.current,
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

    if (delta > 0 && selectedEpisodeRef.current >= currentSeasonEpisodes && marathonMode) {
      // TAREA 5: Al terminar la temporada, salta a la primera del siguiente
      const nextSeason = selectedSeasonRef.current + 1;
      setSelectedSeason(nextSeason);
      setSelectedEpisode(1);
      selectedSeasonRef.current = nextSeason;
      selectedEpisodeRef.current = 1;
      triggerSignalToast(`🏃 Maratón: Avanzando a Temporada ${nextSeason}, Capítulo 1`);
    } else {
      setSelectedEpisode((prev) => {
        const nextEp = Math.max(1, prev + delta);
        selectedEpisodeRef.current = nextEp;
        return nextEp;
      });
    }
    simulatedTimeRef.current = 0;
    setCurrentTime(0);
    setIframeReloadKey((k) => k + 1);
    broadcastImmediate();
  }, [isEpisodic, broadcastImmediate, media, marathonMode, triggerSignalToast]);

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
      setSeekUnsupported(true);
      broadcastImmediate(undefined, { seekUnsupported: true });
      return;
    }
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(videoRef.current.duration || 3600, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = next;
    setCurrentTime(next);
    broadcastImmediate();
  };

  const handleSeek = async (time: number) => {
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
      setSeekUnsupported(true);
      broadcastImmediate(undefined, { seekUnsupported: true });
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
      } catch {}
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
          setSelectedSeason(s);
          setSelectedEpisode(e);
          selectedSeasonRef.current = s;
          selectedEpisodeRef.current = e;
          simulatedTimeRef.current = 0;
          setCurrentTime(0);
          setIframeReloadKey((k) => k + 1);
          broadcastImmediate();
        }
        break;
      }
      case 'toggleFullscreen': toggleFullscreen(); break;
      case 'selectServer': {
        const idx = typeof cmd.payload === 'number' ? cmd.payload : Number(cmd.payload?.index);
        if (Number.isFinite(idx) && availableServersRef.current[idx]) {
          handleSelectServer(idx);
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
        if (realState.duration > 0) {
          setDuration(realState.duration);
        }
        setIsPlaying(realState.isPlaying);
        broadcastImmediate(realState.isPlaying);

        if (realState.currentTime > 15 && Math.round(realState.currentTime) % 4 === 0) {
          watchHistoryService.saveProgress({
            mediaItem: media, episodeItem: episode,
            seasonNumber: selectedSeason, episodeNumber: selectedEpisode,
            currentTime: realState.currentTime, duration: realState.duration > 0 ? realState.duration : 5400,
          });
        }
      } else if (isIframeMode && isPlaying) {
        simulatedTimeRef.current += 1;
        const t = simulatedTimeRef.current;
        setCurrentTime(t);
        if (t % 2 === 0) {
          broadcastImmediate();
        }
        if (t > 15 && t % 4 === 0) {
          watchHistoryService.saveProgress({
            mediaItem: media, episodeItem: episode,
            seasonNumber: selectedSeason, episodeNumber: selectedEpisode,
            currentTime: t, duration: duration > 0 ? duration : 5400,
          });
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isIframeMode, isPlaying, media, episode, selectedSeason, selectedEpisode, broadcastImmediate, duration]);

  useEffect(() => () => {
    const finalTime = isIframeMode ? simulatedTimeRef.current : (videoRef.current?.currentTime || 0);
    if (finalTime > 15) {
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

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying || isIframeMode) setShowControls(false);
    }, 3000);
  }, [isPlaying, isIframeMode]);

  const startNextEpisodeCountdown = () => {
    if (marathonMode) {
      // TAREA 5: No muestra cuenta atrás, pasa directo al siguiente capítulo
      handleAdvanceEpisode(1);
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
        handleAdvanceEpisode(1);
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
    <div ref={containerRef} onMouseMove={handleMouseMove}
      className="relative w-full h-screen bg-black overflow-hidden select-none flex items-center justify-center font-sans">

      {/* Franjas invisibles de detección de mouse para cuando el iframe captura el cursor */}
      <div onMouseEnter={handleMouseMove} onMouseMove={handleMouseMove} className="absolute top-0 inset-x-0 h-6 z-50 pointer-events-auto" />
      <div onMouseEnter={handleMouseMove} onMouseMove={handleMouseMove} className="absolute bottom-0 inset-x-0 h-6 z-50 pointer-events-auto" />

      {isIframeMode ? (
        <div className="w-full h-full relative bg-black">
          {typeof window !== 'undefined' && Boolean(window.electronAPI) ? (
            <WebViewPlayer
              src={activeEmbedUrl}
              reloadKey={iframeReloadKey}
              title={currentTitle}
              onFailLoad={(code, desc) => {
                rotateToNextServer(`Fallo de red en webview (${code}: ${desc})`);
              }}
              onTimeout10s={() => {
                rotateToNextServer('Timeout de 10s sin respuesta en webview');
              }}
              onDomReady={() => {
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
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              referrerPolicy="origin"
              {...({ allowpopups: 'true' } as any)}
              onLoad={(e) => {
                const iframeEl = e.currentTarget;
                setTimeout(() => {
                  if (!iframeEl) return;
                  const rect = iframeEl.getBoundingClientRect();
                  const centerX = Math.round(rect.left + rect.width / 2);
                  const centerY = Math.round(rect.top + rect.height / 2);
                  window.electronAPI?.simulatePlayClick?.({ x: centerX, y: centerY });
                }, 1800);
              }}
            />
          )}
        </div>
      ) : (
        <video
          ref={videoRef}
          key={corsMode ? 'cors' : 'nocors'}
          src={videoSrc.includes('.m3u8') ? undefined : videoSrc}
          className="w-full h-full object-contain"
          crossOrigin={corsMode ? 'anonymous' : undefined}
          muted={false}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current) setDuration(videoRef.current.duration);
            globalAudioEngine.applySettings(audioSettings);
          }}
          onError={handleVideoError}
          onEnded={() => {
            if (isEpisodic && hasNextEpisode && playbackSettings.autoPlayNext) handleAdvanceEpisode(1);
            else setIsPlaying(false);
          }}
          onClick={togglePlay}
        />
      )}

      {(unavailableWarning || cfWarning) && (
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

      {tvSignalDown && (
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

      {allServersExhausted && (
        <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-6 text-center z-50 animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-amber-950/80 border border-amber-700/80 flex items-center justify-center mb-4 text-3xl shadow-xl">
            ⚠️
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Ningún servidor respondió</h3>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            Se probaron 3 servidores de streaming pero ninguno entregó una señal activa en este momento.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => {
                autoSkipCountRef.current = 0;
                consecutiveUnavailableCountRef.current = 0;
                setAllServersExhausted(false);
                setIframeReloadKey((k) => k + 1);
              }}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition"
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
        className={`absolute inset-x-0 top-0 z-40 transition-all duration-300 ${
          isIframeMode ? 'h-14 sm:h-16 px-3 sm:px-6 py-2 bg-gradient-to-b from-black/95 via-black/80 to-transparent' : 'p-4 sm:p-6 bg-gradient-to-b from-black/95 via-black/80 to-transparent'
        } ${
          isTopBarHidden
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
                    value={selectedSeason}
                    onChange={(e) => {
                      const newS = Number(e.target.value);
                      setSelectedSeason(newS);
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
                    value={selectedEpisode}
                    onChange={(e) => {
                      const newEp = Number(e.target.value);
                      setSelectedEpisode(newEp);
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
                </div>
              )}

              {isEpisodic && (
                <button
                  type="button"
                  onClick={toggleMarathonMode}
                  className={`px-2 py-0.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1 border shadow-lg shrink-0 ${
                    marathonMode
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
                    const latIdx = availableServers.findIndex(
                      (s) => s.language?.toLowerCase().includes('latino') || s.name.toLowerCase().includes('latino'));
                    if (latIdx !== -1) {
                      handleSelectServer(latIdx);
                      audioPrefs.setForMedia(mediaKey, availableServers[latIdx].name, 'latino', selectedSeason, selectedEpisode);
                    } else if (availableServers.length > 0) {
                      handleSelectServer(0);
                      audioPrefs.setForMedia(mediaKey, availableServers[0].name, 'latino', selectedSeason, selectedEpisode);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                    activeServer.name.toLowerCase().includes('latino') || activeServer.language?.toLowerCase().includes('latino')
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
                    const subIdx = availableServers.findIndex(
                      (s) => s.language?.toLowerCase().includes('sub') || s.name.toLowerCase().includes('sub'));
                    if (subIdx !== -1) {
                      handleSelectServer(subIdx);
                      audioPrefs.setForMedia(mediaKey, availableServers[subIdx].name, 'sub', selectedSeason, selectedEpisode);
                    } else if (availableServers.length > 1) {
                      handleSelectServer(1);
                      audioPrefs.setForMedia(mediaKey, availableServers[1].name, 'sub', selectedSeason, selectedEpisode);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                    activeServer.name.toLowerCase().includes('sub') || activeServer.language?.toLowerCase().includes('sub')
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
            {/* Botón Subtítulos (solo modo nativo) */}
            {!isIframeMode && (
              <button
                type="button"
                onClick={async () => {
                  const nextSub = !subtitlesEnabled;
                  setSubtitlesEnabled(nextSub);
                  await window.electronAPI?.controlActiveMedia?.({ action: 'toggleSubtitles', value: nextSub });
                  onBroadcastState?.({ subtitlesEnabled: nextSub });
                }}
                className={`px-2 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 border shadow-lg ${
                  subtitlesEnabled
                    ? 'bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:text-white'
                    : 'bg-red-950/80 border-red-700/80 text-red-300'
                }`}
                title="Activar / Desactivar Subtítulos"
              >
                <span>💬</span>
                <span className="hidden sm:inline">Subs: {subtitlesEnabled ? 'ON' : 'OFF'}</span>
              </button>
            )}

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
              className="px-2.5 py-1 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/60 transition backdrop-blur-md flex items-center gap-1.5 text-xs font-bold shadow-md"
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

      {/* BARRA INFERIOR FLOTANTE DE SERVIDORES (libera la barra superior para nunca tapar el embed) */}
      {availableServers.length > 1 && (
        <div
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-zinc-950/90 border border-zinc-700/80 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-2xl flex items-center gap-1.5 max-w-[92vw] overflow-x-auto no-scrollbar transition-opacity duration-300 ${
            showControls && !isTopBarHidden ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
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
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 border shrink-0 ${
                  isSelected
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
            {!isPlaying && (
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
