import {
  VERIFIED_SPORTS_CHANNELS,
  rankSportsChannels,
  assessMirrorTrust,
  isTrustworthyIptvCandidate,
} from '../data/verifiedSportsChannels';
import { LiveSportsChannel, MediaItem, StreamServer } from '../types';

export { VERIFIED_SPORTS_CHANNELS };

const CHANNELS_API = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_API = 'https://iptv-org.github.io/api/streams.json';
const LOGOS_API = 'https://iptv-org.github.io/api/logos.json';
const PLUTO_API = 'https://api.pluto.tv/v2/channels.json';
const CACHE_KEY = 'cinecast_iptv_sports_cache_v8';
const LEGACY_CACHE_KEYS = ['cinecast_iptv_sports_cache_v4', 'cinecast_iptv_sports_cache_v5', 'cinecast_iptv_sports_cache_v6', 'cinecast_iptv_sports_cache_v7'];
const CACHE_TTL_MS = 7 * 60 * 1000; // 7 minutos

const CURATED_MIRROR_URLS = new Set<string>(
  VERIFIED_SPORTS_CHANNELS.flatMap((c) => [
    ...(c.streamUrl ? [c.streamUrl] : []),
    ...(Array.isArray(c.servers) ? c.servers.map((s) => s.url) : []),
  ]).filter(Boolean)
);

export const SPANISH_COUNTRIES_MAP: Record<string, { name: string; flag: string }> = {
  AR: { name: 'Argentina', flag: '🇦🇷' },
  MX: { name: 'México', flag: '🇲🇽' },
  ES: { name: 'España', flag: '🇪🇸' },
  CO: { name: 'Colombia', flag: '🇨🇴' },
  CL: { name: 'Chile', flag: '🇨🇱' },
  PE: { name: 'Perú', flag: '🇵🇪' },
  UY: { name: 'Uruguay', flag: '🇺🇾' },
  VE: { name: 'Venezuela', flag: '🇻🇪' },
  EC: { name: 'Ecuador', flag: '🇪🇨' },
  CR: { name: 'Costa Rica', flag: '🇨🇷' },
  PA: { name: 'Panamá', flag: '🇵🇦' },
  BO: { name: 'Bolivia', flag: '🇧🇴' },
  PY: { name: 'Paraguay', flag: '🇵🇾' },
  GT: { name: 'Guatemala', flag: '🇬🇹' },
  BR: { name: 'Brasil', flag: '🇧🇷' },
  US: { name: 'Estados Unidos', flag: '🇺🇸' },
  GB: { name: 'Reino Unido', flag: '🇬🇧' },
  IT: { name: 'Italia', flag: '🇮🇹' },
  FR: { name: 'Francia', flag: '🇫🇷' },
  DE: { name: 'Alemania', flag: '🇩🇪' },
  INT: { name: 'Internacional', flag: '🌍' },
};

interface RawChannel {
  id: string;
  name: string;
  country: string;
  categories?: string[];
  closed?: string | null;
}

interface RawStream {
  channel?: string | null;
  feed?: string | null;
  title?: string;
  url: string;
  quality?: string | null;
  labels?: string[];
  user_agent?: string | null;
  referrer?: string | null;
}

interface RawLogo {
  channel?: string | null;
  in_use?: boolean;
  width?: number;
  url: string;
}

const SPORTS_KEYWORDS = [
  'deportes', 'sports', 'futbol', 'fútbol', 'soccer', 'gol', 'sport',
  'racing', 'liga', 'champions', 'tenis', 'motor', 'pelota', 'baseball', 'box',
];

/** Puntaje por resolución: 1080p > 720p > 480p ... (sin dato = 0) */
const qualityScore = (q?: string | null): number => {
  const n = parseInt(q ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

const isGeoBlocked = (s: RawStream): boolean =>
  (s.labels || []).some((l) => l.toLowerCase().includes('geo'));

/** Puntaje total: resolución, penalizando fuertemente los Geo-blocked */
const streamScore = (s: RawStream): number => qualityScore(s.quality) - (isGeoBlocked(s) ? 10000 : 0);

class IPTVService {
  private memoryCache: LiveSportsChannel[] | null = null;
  private lastCacheTimestamp = 0;
  private isFetching: boolean = false;
  private lastFetchFailed: boolean = false;

  hasLastFetchError(): boolean {
    return this.lastFetchFailed;
  }

  private async filterOnlineStreams(channels: LiveSportsChannel[]): Promise<LiveSportsChannel[]> {
    if (typeof window === 'undefined' || !window.electronAPI?.probeStreams) {
      return [];
    }
    try {
      const trustedByChannel = new Map<
        string,
        Array<{ srv: StreamServer; score: number; reason: string }>
      >();
      const allUrlsSet = new Set<string>();

      for (const ch of channels) {
        const candidateServers: StreamServer[] = [];
        const seen = new Set<string>();
        for (const s of ch.servers || []) {
          if (!s?.url || seen.has(s.url)) continue;
          seen.add(s.url);
          candidateServers.push(s);
        }
        if (ch.streamUrl && !seen.has(ch.streamUrl)) {
          candidateServers.unshift({
            name: `${ch.name} (${ch.quality || 'HD'})`,
            url: ch.streamUrl,
            type: 'hls',
            language: 'En Vivo',
            referrer: ch.referrer ?? null,
            userAgent: ch.userAgent ?? null,
          });
        }

        const trusted: Array<{ srv: StreamServer; score: number; reason: string }> = [];
        const rejected: string[] = [];
        for (const srv of candidateServers) {
          const trust = assessMirrorTrust(ch, srv);
          if (trust.trusted) {
            trusted.push({ srv, score: trust.score, reason: trust.reason });
            allUrlsSet.add(srv.url);
          } else {
            rejected.push(`${srv.name}: ${trust.reason}`);
          }
        }
        trusted.sort((a, b) => b.score - a.score);
        if (trusted.length > 0) {
          trustedByChannel.set(ch.id, trusted);
        } else if (rejected.length > 0) {
          console.log(`[Sports Validator] Canal "${ch.name}" (${ch.id}): OFFLINE -> descartados=[${rejected.join('; ')}]`);
        }
      }

      const allUrls = Array.from(allUrlsSet);
      if (allUrls.length === 0) return [];

      const mergedResults: Record<string, boolean> = {};
      for (let i = 0; i < allUrls.length; i += 60) {
        const chunk = allUrls.slice(i, i + 60);
        const partial = await window.electronAPI.probeStreams(chunk);
        if (partial && typeof partial === 'object') {
          Object.assign(mergedResults, partial);
        }
      }

      const validated: LiveSportsChannel[] = [];
      for (const c of channels) {
        const trustedEntries = trustedByChannel.get(c.id);
        if (!trustedEntries || trustedEntries.length === 0) continue;

        const aliveEntries = trustedEntries.filter((entry) => mergedResults[entry.srv.url] === true);
        if (aliveEntries.length > 0) {
          const primaryEntry = aliveEntries[0]!;
          console.log(
            `[Sports Validator] Canal "${c.name}" (${c.id}): ELEGIDO "${primaryEntry.srv.name}" -> ${primaryEntry.srv.url} (score=${primaryEntry.score}, motivo=${primaryEntry.reason})`
          );
          validated.push({
            ...c,
            streamUrl: primaryEntry.srv.url,
            referrer: primaryEntry.srv.referrer ?? c.referrer ?? null,
            userAgent: primaryEntry.srv.userAgent ?? c.userAgent ?? null,
            servers: aliveEntries.map((e) => e.srv),
            isOnline: true,
            lastVerified: Date.now(),
          });
        }
      }

      return rankSportsChannels(validated);
    } catch (e) {
      console.warn('Probe streams error:', e);
      return [];
    }
  }

  /**
   * Pluto TV (API pública): canales 24/7 gratuitos de deportes. La grilla depende de la región
   * de tu IP (desde Latam aparecen los canales en español). Los streams son HLS "stitched";
   * se generan con deviceId/sid aleatorios, que es lo que el servidor de Pluto necesita.
   * Nota: Pluto es gratuito con publicidad (insertada en el propio stream, no bloqueable).
   */
  async fetchPlutoChannels(): Promise<LiveSportsChannel[]> {
    try {
      const data = await this.fetchJson<any[]>(PLUTO_API);
      const kw = /deporte|sport|f[uú]tbol|fifa|red ?bull|bein|madrid|claro|tyc|golazo|champions|soccer|liga|nba|nfl|ufc|mma|motor|racing/i;
      const newId = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
              const r = (Math.random() * 16) | 0;
              return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            });
      const deviceId = newId();

      const out: LiveSportsChannel[] = [];
      for (const c of data) {
        const isSports = c.category === 'Sports';
        const isSpanishSports = c.category === 'En Español' && kw.test(c.name || '');
        if (!isSports && !isSpanishSports) continue;
        const raw: string | undefined = c.stitched?.urls?.[0]?.url;
        if (!raw) continue;

        let url: string;
        try {
          const u = new URL(raw);
          u.searchParams.set('deviceId', deviceId);
          u.searchParams.set('sid', newId());
          u.searchParams.set('deviceType', 'web');
          u.searchParams.set('deviceMake', 'chrome');
          u.searchParams.set('deviceModel', 'web');
          u.searchParams.set('appName', 'web');
          url = u.toString();
        } catch (_) {
          continue;
        }

        const latino = c.category === 'En Español';
        out.push({
          id: `pluto_${c.slug || c._id}`,
          name: c.name,
          country: latino ? 'INT' : 'US',
          countryName: latino ? 'Pluto TV Latino' : 'Pluto TV',
          countryFlag: latino ? '🌎' : '📺',
          logo: c.colorLogoPNG?.path || c.logo?.path || '',
          streamUrl: url,
          quality: '720p HD',
          category: 'Deportes 24/7 (Pluto TV)',
          isOnline: true,
          servers: [{ name: `${c.name} (Pluto TV)`, url, type: 'hls', language: latino ? 'Español' : 'En Vivo' }],
        });
      }
      return out;
    } catch (e) {
      console.warn('Pluto TV no disponible:', e);
      return [];
    }
  }

  /**
   * Obtiene canales validados (caché de TTL corta 7 min o backend /api/sports/channels).
   */
  async getSportsChannels(): Promise<LiveSportsChannel[]> {
    const now = Date.now();
    if (
      this.memoryCache &&
      this.memoryCache.length > 0 &&
      now - this.lastCacheTimestamp < CACHE_TTL_MS
    ) {
      return this.memoryCache;
    }

    const local = this.readFromStorage();
    if (local && local.length > 0) {
      this.memoryCache = rankSportsChannels(local);
      this.lastCacheTimestamp = now;
      return this.memoryCache;
    }

    return await this.fetchDynamicStreams(false);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return (await res.json()) as T;
  }

  /**
   * Consume /api/sports/channels (validación real + espejos en backend con TTL 7 min).
   * Sin fallback silencioso a canales sin verificar.
   */
  async fetchDynamicStreams(forceRefresh = false): Promise<LiveSportsChannel[]> {
    try {
      this.isFetching = true;
      this.lastFetchFailed = false;

      // 1. Consultar endpoint validado del servidor backend /api/sports/channels
      try {
        const apiBase = typeof window !== 'undefined' ? (window.location?.origin || '') : '';
        const query = forceRefresh ? '?refresh=true' : '';
        const res = await fetch(`${apiBase}/api/sports/channels${query}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.validated === true && Array.isArray(data?.channels)) {
            const resolveApiUrl = (u?: string | null): string => {
              const s = String(u || '').trim();
              if (s.startsWith('/') && apiBase) return `${apiBase}${s}`;
              return s;
            };
            const mapped: LiveSportsChannel[] = data.channels.map((ch: any) => {
              const resolvedStreamUrl = resolveApiUrl(ch.streamUrl);
              return {
                id: ch.id,
                name: ch.name,
                country: ch.country,
                countryName: ch.countryName,
                countryFlag: ch.countryFlag,
                logo: ch.logo || '',
                streamUrl: resolvedStreamUrl,
                quality: ch.quality || '1080p HD',
                category: ch.category || 'Fútbol & Deportes',
                isOnline: Boolean(ch.isOnline ?? true),
                lastVerified: typeof ch.lastVerified === 'number' ? ch.lastVerified : Date.now(),
                referrer: ch.referrer ?? null,
                userAgent: ch.userAgent ?? null,
                servers:
                  Array.isArray(ch.servers) && ch.servers.length > 0
                    ? ch.servers.map((s: any) => ({ ...s, url: resolveApiUrl(s.url) }))
                    : [
                        {
                          name: `${ch.name} (${ch.quality || 'HD'})`,
                          url: resolvedStreamUrl,
                          type: 'hls',
                          language: 'En Vivo',
                          referrer: ch.referrer ?? null,
                          userAgent: ch.userAgent ?? null,
                        },
                      ],
              };
            });

            const verifiedMapped = mapped.filter((ch) => {
              if (CURATED_MIRROR_URLS.has(ch.streamUrl)) return true;
              if (/\/api\/sports\/streamtp\/[a-z0-9_-]+(?:\.m3u8)?$/i.test(ch.streamUrl)) return true;
              const trust = assessMirrorTrust(ch, { name: ch.name, url: ch.streamUrl });
              if (!trust.trusted) {
                console.log(`[Sports] descartado por assessMirrorTrust: ${ch.id} "${ch.name}" url=${String(ch.streamUrl).slice(0, 90)}`);
              }
              return trust.trusted;
            });
            console.log(`[Sports] sobreviven ${verifiedMapped.length} de ${mapped.length} canales del servidor`);
            if (verifiedMapped.length === 0) {
              return this.curatedFallback('el servidor no devolvió canales confiables');
            }
            const ranked = rankSportsChannels(verifiedMapped);
            this.memoryCache = ranked;
            this.lastCacheTimestamp = Date.now();
            this.saveToStorage(ranked);
            return ranked;
          }
        }
      } catch (e) {
        console.warn('Endpoint /api/sports/channels no respondió, probando verificación de respaldo:', e);
      }

      // 2. Respaldo con probe real en Electron. En web (sin probeStreams) se muestran los curados
      //    marcados como "sin verificar": nunca isOnline:true sin verificar, pero tampoco grilla vacía.
      if (typeof window === 'undefined' || !window.electronAPI?.probeStreams) {
        return this.curatedFallback('sin probeStreams (web) y el endpoint no respondió');
      }

      const [channelsRes, streamsRes, logosRes] = await Promise.allSettled([
        this.fetchJson<RawChannel[]>(CHANNELS_API),
        this.fetchJson<RawStream[]>(STREAMS_API),
        this.fetchJson<RawLogo[]>(LOGOS_API),
      ]);

      const dynamicChannels: LiveSportsChannel[] = [];
      if (channelsRes.status === 'fulfilled' && streamsRes.status === 'fulfilled') {
        const channelsData = channelsRes.value;
        const streamsData = streamsRes.value;
        const logosData = logosRes.status === 'fulfilled' ? logosRes.value : [];

        const esCountries = new Set(Object.keys(SPANISH_COUNTRIES_MAP));
        const filteredChannels = channelsData.filter((c) => {
          if (c.closed) return false;
          if (!esCountries.has(c.country)) return false;
          const isArgentina = c.country === 'AR';
          const hasCategory = Array.isArray(c.categories) && c.categories.includes('sports');
          const nameLower = (c.name || '').toLowerCase();
          const isSports = hasCategory || SPORTS_KEYWORDS.some((k) => nameLower.includes(k));
          return isArgentina || isSports;
        });

        const logoMap = new Map<string, RawLogo>();
        for (const l of logosData) {
          if (!l.channel || !l.url) continue;
          const prev = logoMap.get(l.channel);
          if (
            !prev ||
            (l.in_use && !prev.in_use) ||
            (Boolean(l.in_use) === Boolean(prev.in_use) && (l.width || 0) > (prev.width || 0))
          ) {
            logoMap.set(l.channel, l);
          }
        }

        const streamsByChannel = new Map<string, RawStream[]>();
        const seenUrls = new Set<string>();
        for (const st of streamsData) {
          if (!st.channel || !st.url || seenUrls.has(st.url)) continue;
          seenUrls.add(st.url);
          const arr = streamsByChannel.get(st.channel);
          if (arr) arr.push(st);
          else streamsByChannel.set(st.channel, [st]);
        }

        for (const ch of filteredChannels) {
          const streams = streamsByChannel.get(ch.id);
          if (!streams || streams.length === 0) continue;

          const trustedStreams = streams
            .map((st) => ({
              st,
              trust: assessMirrorTrust(ch, { name: ch.name, url: st.url }),
            }))
            .filter((entry) => entry.trust.trusted)
            .sort((a, b) => b.trust.score - a.trust.score || streamScore(b.st) - streamScore(a.st));

          if (trustedStreams.length === 0) continue;

          const best = trustedStreams[0]!.st;
          const checkCand = isTrustworthyIptvCandidate({
            id: ch.id,
            name: ch.name,
            streamUrl: best.url,
            country: ch.country,
            groupTitle: (ch.categories || []).join(';'),
          });
          if (!checkCand.ok) continue;

          const countryInfo = SPANISH_COUNTRIES_MAP[ch.country] || { name: ch.country, flag: '⚽' };

          const channelServers: StreamServer[] = trustedStreams.slice(0, 4).map(({ st }, idx) => ({
            name: idx === 0 ? `${ch.name} (Principal ${st.quality || 'HD'})` : `${ch.name} (Opción ${idx + 1} ${st.quality || 'SD'})`,
            url: st.url,
            type: 'hls' as const,
            language: 'En Vivo',
            referrer: st.referrer ?? null,
            userAgent: st.user_agent ?? null,
          }));

          dynamicChannels.push({
            id: ch.id,
            name: ch.name,
            country: ch.country,
            countryName: countryInfo.name,
            countryFlag: countryInfo.flag,
            logo: logoMap.get(ch.id)?.url || '',
            streamUrl: best.url,
            quality: best.quality ? `${best.quality}` : 'En Vivo',
            category: 'Fútbol & Deportes',
            isOnline: false,
            referrer: best.referrer ?? null,
            userAgent: best.user_agent ?? null,
            geoBlocked: isGeoBlocked(best),
            servers: channelServers,
          });
        }
      }

      const plutoChannels = await this.fetchPlutoChannels().catch(() => []);
      const existingIds = new Set(VERIFIED_SPORTS_CHANNELS.map((c) => c.id));
      const uniqueDynamic = dynamicChannels.filter((c) => !existingIds.has(c.id));
      const combined = [
        ...VERIFIED_SPORTS_CHANNELS.filter((c) => Boolean(c.streamUrl) || (c.servers && c.servers.length > 0)),
        ...plutoChannels,
        ...uniqueDynamic,
      ];

      const finalChannels = await this.filterOnlineStreams(combined);
      this.memoryCache = finalChannels;
      this.lastCacheTimestamp = Date.now();
      this.saveToStorage(finalChannels);
      return finalChannels;
    } catch (err) {
      console.warn('⚠️ [IPTV Service] Error obteniendo canales deportivos:', err);
      return this.curatedFallback('excepción al obtener canales');
    } finally {
      this.isFetching = false;
    }
  }

  /** Lista curada marcada como no verificada. No se persiste en storage para no fijar datos sin validar. */
  private curatedFallback(reason: string): LiveSportsChannel[] {
    const curated: LiveSportsChannel[] = VERIFIED_SPORTS_CHANNELS
      .filter((c) => Boolean(c.streamUrl) || (c.servers && c.servers.length > 0))
      .map((c) => ({ ...c, isOnline: false, unverified: true }));
    console.log(`[Sports] fallback a curados (${reason}): ${curated.length} canales sin verificar`);
    this.lastFetchFailed = true;
    this.memoryCache = curated;
    this.lastCacheTimestamp = Date.now();
    return curated;
  }

  private readFromStorage(): LiveSportsChannel[] | null {
    if (typeof window === 'undefined') return null;
    try {
      for (const oldKey of LEGACY_CACHE_KEYS) {
        window.localStorage.removeItem(oldKey);
      }
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.timestamp !== 'number' || !Array.isArray(parsed.channels)) {
        return null;
      }
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed.channels.filter((ch: LiveSportsChannel) =>
        CURATED_MIRROR_URLS.has(ch.streamUrl) || assessMirrorTrust(ch, { name: ch.name, url: ch.streamUrl }).trusted
      );
    } catch (_) {
      return null;
    }
  }

  private saveToStorage(channels: LiveSportsChannel[]) {
    if (typeof window === 'undefined') return;
    try {
      if (channels.length === 0) {
        window.localStorage.removeItem(CACHE_KEY);
        return;
      }
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), channels }));
    } catch (_) {}
  }

  /**
   * Convierte un canal en un MediaItem compatible con VideoPlayer, control remoto y WebSockets.
   */
  channelToMediaItem(channel: LiveSportsChannel): MediaItem {
    return {
      id: `iptv_${channel.id}`,
      title: `${channel.countryFlag || '⚽'} ${channel.name}`,
      originalTitle: channel.name,
      type: 'movie',
      overview: `Señal en directo de ${channel.name} (${channel.countryName || channel.country}). Transmisión en vivo vía IPTV HLS.`,
      year: new Date().getFullYear(),
      ratingBadge: 'EN VIVO',
      matchScore: 99,
      qualityBadge: channel.quality || 'HD 1080p',
      genres: ['Deportes', 'Fútbol', 'En Vivo', channel.countryName || 'Latam'],
      cast: ['CineCast Sports', 'IPTV Direct'],
      creatorOrDirector: 'Transmisión Oficial',
      posterUrl: channel.logo || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800',
      backdropUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1600&auto=format&fit=crop',
      videoUrl: channel.streamUrl,
      category: 'live_tv',
      streamType: 'hls',
      streamReferrer: channel.referrer ?? null,
      streamUserAgent: channel.userAgent ?? null,
      servers: channel.servers && channel.servers.length > 0 ? channel.servers : [
        {
          name: `${channel.name} (Señal Oficial HLS)`,
          url: channel.streamUrl,
          type: 'hls',
          language: 'En Vivo',
          referrer: channel.referrer ?? null,
          userAgent: channel.userAgent ?? null,
        },
      ],
    };
  }
}

export const iptvService = new IPTVService();

export const IPTV_STREAM_ERROR_MESSAGE =
  'Este canal de IPTV gratuito no está disponible en este momento. Los canales de fútbol premium (ESPN, Fox) suelen tener enlaces caídos. Probá con TyC Sports o TV Pública.';

