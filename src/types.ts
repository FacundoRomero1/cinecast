export type MediaType = 'movie' | 'series';

export interface StreamCaption {
  id?: string;
  url: string;
  language?: string;
  lang?: string;
  label?: string;
  format?: string;
  isDefault?: boolean;
}

export interface StreamServer {
  name: string;       // Ej: "Server 1 (Byseraguci)", "VidSrc Latino", "Archive MP4"
  url: string;        // Ej: "https://byseraguci.com/e/xxxx" o "https://vidsrc.xyz/embed/movie/{tmdbId}"
  type: 'mp4' | 'iframe' | 'hls';
  language?: string;  // "Latino", "Subtitulado", "Castellano", "Original"
  referrer?: string | null;
  userAgent?: string | null;
  id?: number | string;
  providerId?: string;
  playable?: 'hls' | 'iframe';
  validated?: boolean;
  popular?: number;
  picks?: number;
  acao?: string | null;
  speedMs?: number;
  qualityScore?: number;
  audioLangs?: string[];
  captions?: StreamCaption[];
}

export interface LiveSportsChannel {
  id: string;
  name: string;
  country: string;
  countryName?: string;
  countryFlag?: string;
  logo: string;
  streamUrl: string;
  quality?: string;
  category?: string;
  isOnline?: boolean;
  referrer?: string | null;
  userAgent?: string | null;
  geoBlocked?: boolean;
  lastVerified?: number;
  servers?: StreamServer[];
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string;
  duration?: string; // e.g. "48 min"
  durationSeconds?: number;
  thumbnailUrl?: string;
  videoUrl?: string;
  streamUrl?: string;
  runtime?: number;
  stillPath?: string;
  introStart?: number; // timestamp in seconds where intro begins
  introEnd?: number;   // timestamp in seconds where intro finishes
  recapStart?: number;
  recapEnd?: number;
  streamType?: 'mp4' | 'iframe' | 'hls';
  servers?: StreamServer[];
}

export interface Movie {
  id: string;
  tmdbId: number;
  title: string;
  titleEs?: string;
  originalTitle?: string;
  spokenLanguages?: string[];
  overview: string;
  posterPath: string;
  posterUrl?: string;
  backdropPath: string;
  backdropUrl?: string;
  releaseDate: string;
  year?: number;
  genres: string[];
  genre?: string[];
  runtime?: number;
  voteAverage: number;
  rating?: number;
  streamUrl: string;        // URL directa .mp4 o stream principal
  quality?: '480p' | '720p' | '1080p' | '4K' | '4K Ultra HD' | string;
  ratingBadge?: string;
  qualityBadge?: string;
  matchScore?: number;
  cast?: string[];
  creatorOrDirector?: string;
  source?: string;           // 'archive.org', 'vidsrc', 'byseraguci', 'tudeporte', etc.
  addedAt?: Date | string;
  streamType?: 'mp4' | 'iframe' | 'hls';
  servers?: StreamServer[];
  category?: 'movie' | 'series' | 'anime' | 'live_tv';
  type?: MediaType;
  originalLanguage?: string;
  originCountry?: string[];
  seasonsCount?: number;
  seasons?: Season[];
}

export interface Season {
  seasonNumber: number;
  title?: string;
  name?: string;
  overview?: string;
  episodes: Episode[];
}

export interface TVShow {
  id: string;
  tmdbId: number;
  title: string;
  titleEs?: string;
  overview: string;
  posterPath: string;
  seasons: Season[];
}

export interface MediaCatalog {
  movies: Movie[];
  shows: TVShow[];
  lastUpdated: Date | string;
}

export interface MediaItem {
  id: string;
  tmdbId?: number;
  title: string;
  titleEs?: string;
  originalTitle?: string;
  type: MediaType;
  overview: string;
  year: number;
  ratingBadge: string; // '16+', '18+', 'ATP', '13+'
  matchScore: number; // e.g. 98 (% match)
  qualityBadge: string; // '4K Ultra HD', 'HD', 'Dolby Atmos'
  genres: string[];
  cast: string[];
  creatorOrDirector: string;
  posterUrl: string;
  backdropUrl: string;
  videoUrl?: string; // Preview or main movie video
  duration?: string | number;
  runtime?: number;
  introStart?: number; // for movies or default
  introEnd?: number;
  recapStart?: number;
  recapEnd?: number;
  seasonsCount?: number;
  seasons?: Season[];
  episodes?: Episode[];
  isOriginal?: boolean;
  featured?: boolean;
  streamType?: 'mp4' | 'iframe' | 'hls';
  servers?: StreamServer[];
  category?: 'movie' | 'series' | 'anime' | 'live_tv';
  activeServerIndex?: number;
  streamReferrer?: string | null;
  streamUserAgent?: string | null;
}

export type DeviceType = 'screen' | 'remote' | 'hybrid';

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  lastSeen?: number;
  isCurrent?: boolean;
  connected?: boolean;
  disconnectedAt?: number;
}

export type AudioPreset =
  | 'standard'
  | 'vocal_boost'
  | 'night_mode'
  | 'bass_boost'
  | 'cinematic_surround';

export interface AudioSettings {
  volume: number; // 0 to 150%
  isMuted: boolean;
  preset: AudioPreset;
  bassGain: number;   // -10 to +15 dB
  midGain: number;    // -10 to +15 dB
  trebleGain: number; // -10 to +15 dB
  compressorEnabled: boolean;
  dialogueBoost: boolean;
}

export interface PlaybackSettings {
  autoPlayNext: boolean;
  autoSkipIntro: boolean;
  nextEpisodeDelay: number; // seconds
  /** Volumen maestro normalizado 0..1 (B6: única fuente de verdad) */
  volume: number;
}

export type HubType = 'cinecast' | 'spotify' | 'youtube' | 'sports';

export interface PlaybackState {
  mediaId: string | null;
  episodeId: string | null;
  mediaTitle?: string;
  mediaPoster?: string;
  mediaYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  mediaItem?: MediaItem;
  episodeItem?: Episode;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  isStandby: boolean; // Screen in standby/ambient mode waiting for phone
  screenDeviceName: string;
  activeHub?: HubType;
  audioSettings: AudioSettings;
  playbackSettings: PlaybackSettings;
  marathon?: boolean;
  hasIntroTimings?: boolean;
  isIntroActive: boolean;
  isRecapActive: boolean;
  nextEpisodeCountdown: number | null;
  activeServerIndex?: number;
  activeServerName?: string;
  activeServerType?: 'mp4' | 'iframe' | 'hls';
  servers?: { name: string; language?: string; quality?: string; url?: string }[];
  serversExhausted?: boolean;
  seekUnsupported?: boolean;
  serverTimeout?: boolean;
  estimated?: boolean;
  resume?: {
    status: 'idle' | 'cargando' | 'esperando' | 'reanudando' | 'ok' | 'fallo';
    objetivo: number;
    targetSeconds?: number;
    errorReason?: string;
  } | null;
  spotifyState?: {
    trackName?: string | null;
    isPlaying?: boolean | null;
    artistName?: string | null;
    trackUri?: string | null;
  } | null;
  subtitlesEnabled?: boolean;
  playbackMeta?: {
    title: string;
    currentSeason: number;
    currentEpisode: number;
    totalSeasons: number;
    episodes: Array<{ season: number; episode: number; title: string; duration?: string }>;
  };
  introMarks?: { start: number; end: number } | null;
  stateSeq?: number;
  sleepTimer?: {
    endsAt: number | null;
    mode: string;
    minutes?: number;
  } | null;
  areYouStillThere?: boolean;
  areYouStillThereCause?: string | null;
  loadedUrl?: string;
  loadedSeason?: number;
  loadedEpisode?: number;
  providerEpisodeMismatchWarning?: boolean;
}

export type RemoteCommandAction =
  | 'play'
  | 'pause'
  | 'togglePlay'
  | 'seek'
  | 'seekRelative'
  | 'skipSeconds'
  | 'setVolume'
  | 'toggleMute'
  | 'setAudioSettings'
  | 'setPlaybackSettings'
  | 'setMarathon'
  | 'setSleepTimer'
  | 'confirmActiveWatching'
  | 'skipIntro'
  | 'markIntroStart'
  | 'markIntroEnd'
  | 'clearIntroMarks'
  | 'skipRecap'
  | 'playMedia'
  | 'playDiscoveredMovie'
  | 'nextEpisode'
  | 'prevEpisode'
  | 'jumpToEpisode'
  | 'randomEpisode'
  | 'trackpadMove'
  | 'trackpadClick'
  | 'trackpadScroll'
  | 'setStandby'
  | 'wakeScreen'
  | 'cancelCountdown'
  | 'playSpotifyTrack'
  | 'playYouTubeVideo'
  | 'switchTab'
  | 'nextTrack'
  | 'prevTrack'
  | 'toggleFullscreen'
  | 'toggleHubFullscreen'
  | 'changeServer'
  | 'selectServer'
  | 'addCustomStream'
  | 'switchHub'
  | 'playYouTube'
  | 'controlSpotify'
  | 'toggleSubtitles'
  | 'navigateUp'
  | 'navigateDown'
  | 'navigateLeft'
  | 'navigateRight'
  | 'select'
  | 'enter'
  | 'back';

export interface RemoteCommand {
  action: RemoteCommandAction;
  payload?: any;
}

export interface ElectronAPI {
  isElectron: boolean;
  getLocalIp: () => Promise<string>;
  sendNativeKey: (keyCode: string) => Promise<boolean>;
  sendKeyToWebview?: (payload: { key?: string; keyCode?: string }) => Promise<boolean>;
  sendNativeClick: (coords: { x: number; y: number }) => Promise<boolean>;
  simulatePlayClick: (coords?: { x: number; y: number }) => Promise<boolean>;
  sendNativeTrackpadEvent?: (payload: { type: 'move' | 'click' | 'scroll'; dx?: number; dy?: number; button?: 'left' | 'right' }) => Promise<boolean>;
  onVirtualCursorPosition?: (callback: (pos: { x: number; y: number; visible: boolean }) => void) => () => void;
  executeJs: (code: string) => Promise<any>;
  openExternal: (url: string) => Promise<boolean>;
  focusWindow: () => Promise<boolean>;
  setStreamHeaders?: (payload: { url: string; referrer?: string | null; userAgent?: string | null }) => Promise<boolean>;
  setMasterVolume?: (payload: { volume?: number; isMuted?: boolean }) => Promise<boolean>;
  getRealMediaState?: () => Promise<{ found: boolean; currentTime: number; duration: number; isPlaying: boolean; isLive: boolean; title?: string; detectedTracks?: { url: string; audio: string[]; subs: string[] } | null } | null>;
  controlActiveMedia?: (payload: { action: string; value?: any }) => Promise<{ ok: boolean; subtitlesEnabled?: boolean; currentTime?: number; isPlaying?: boolean; hasMedia?: boolean; acted?: boolean; unavailable?: boolean; reason?: string }>;
  autoCommitEmbedPlay?: () => Promise<{ ok?: boolean; acted?: boolean; unavailable?: boolean; reason?: string }>;
  getEmbedStatus?: () => Promise<{ ok: boolean; title?: string; cloudflare?: boolean; contentUnavailable?: boolean; src?: string; currentTime?: number | null; duration?: number | null } | null>;
  onEmbedFailed?: (callback: (payload: { code: number; desc: string; url: string }) => void) => () => void;
  probeStreams?: (urls: string[]) => Promise<Record<string, boolean>>;
  checkEmbedProviders?: () => Promise<Array<{ name: string; ok: boolean; ms: number; status: number }>>;
  toggleFullscreen?: (force?: boolean) => Promise<boolean>;
  searchMediaTracks?: (query: string) => Promise<Array<{ videoId: string; title: string; channel: string; duration: string; thumbnail: string }>>;
  getSavedAccounts?: () => Promise<any>;
  saveAccounts?: (accounts: any) => Promise<boolean>;
  getDetectedTracks?: () => Promise<{ url: string; audio: string[]; subs: string[] } | null>;
  clearPartitionSession?: (partition: string) => Promise<boolean>;
  setDiagnosticMode?: (enabled: boolean) => Promise<boolean>;
  getDiagnosticMode?: () => Promise<boolean>;
  onDiagnosticModeChanged?: (callback: (enabled: boolean) => void) => () => void;
  setNoCorsFix?: (enabled: boolean) => Promise<boolean>;
  getNoCorsFix?: () => Promise<boolean>;
  onNoCorsFixChanged?: (callback: (enabled: boolean) => void) => () => void;
  onTracksDetected?: (callback: (tracks: { url: string; audio: string[]; subs: string[] }) => void) => () => void;
  onAuthUpdated?: (callback: (payload: { provider: string }) => void) => () => void;
  getLoadRecording?: () => Promise<{ ok?: boolean; enabled: boolean } | boolean>;
  setLoadRecording?: (enabled: boolean) => Promise<{ ok?: boolean; enabled: boolean } | boolean>;
  startLoadTrace?: (payload: { title?: string; firstServerName?: string; firstServerUrl?: string }) => Promise<{ ok: boolean; id?: string }>;
  recordLoadTraceEvent?: (payload: Record<string, any>) => Promise<{ ok: boolean }>;
  endLoadTrace?: () => Promise<{ ok: boolean }>;
  getLoadTraces?: () => Promise<{ recording?: boolean; traces: any[] }>;
  clearLoadTraces?: () => Promise<{ ok: boolean }>;
  setPlayerServers?: (servers: Array<{ name: string; url: string; type?: string; language?: string }>) => Promise<{ ok: boolean; count: number }>;
  getPlayerServers?: () => Promise<{ ok: boolean; servers: Array<{ name: string; url: string; type?: string; language?: string }> }>;
  measureServers?: (payload?: { servers?: Array<{ name: string; url: string; type?: string; language?: string }> }) => Promise<{
    ok: boolean;
    error?: string;
    serialized?: boolean;
    timeoutMs?: number;
    results: Array<{
      index: number;
      name: string;
      language?: string;
      url: string;
      host: string;
      dnsMs: number;
      connectMs: number;
      tlsMs: number;
      ttfbMs: number;
      totalMs: number;
      statusCode: number;
      ok: boolean;
      error: string | null;
      timedOut?: boolean;
    }>;
  }>;
  startGhostExtraction?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  stopGhostExtraction?: () => Promise<{ ok: boolean }>;
  onGhostStreamFound?: (callback: (payload: { url: string; originalUrl?: string }) => void) => () => void;
  onGhostStreamTimeout?: (callback: (payload: { originalUrl?: string }) => void) => () => void;
  onGhostCaptchaDetected?: (callback: (payload: { url: string; title?: string }) => void) => () => void;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any;
    }
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


