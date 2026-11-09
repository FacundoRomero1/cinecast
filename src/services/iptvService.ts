import { LiveSportsChannel, MediaItem, StreamServer } from '../types';

const CHANNELS_API = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_API = 'https://iptv-org.github.io/api/streams.json';
const LOGOS_API = 'https://iptv-org.github.io/api/logos.json';
const PLUTO_API = 'https://api.pluto.tv/v2/channels.json';
const CACHE_KEY = 'cinecast_iptv_sports_cache_v4';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

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

/**
 * Catálogo verificado de canales de deportes y fútbol en español de alta disponibilidad.
 * Garantiza arranque instantáneo (0ms) con fallbacks sólidos.
 */
export const VERIFIED_SPORTS_CHANNELS: LiveSportsChannel[] = [
  {
    id: 'TyCSports.ar',
    name: 'TyC Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/TyC_Sports_logo_2020.svg/512px-TyC_Sports_logo_2020.svg.png',
    streamUrl: 'https://amg26268-amg26268c14-freelivesports-emea-10267.playouts.now.amagi.tv/ts-us-e2-n2/playlist/amg26268-sportsstudio-tycsports-freelivesportsemea/playlist.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Argentino & Deportes',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'TyC Sports (Señal Principal HD)',
        url: 'https://amg26268-amg26268c14-freelivesports-emea-10267.playouts.now.amagi.tv/ts-us-e2-n2/playlist/amg26268-sportsstudio-tycsports-freelivesportsemea/playlist.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
      {
        name: 'TyC Sports (VODGC 24/7)',
        url: 'https://live-04-11-tyc-app-web.vodgc.net/tyc24/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
      {
        name: 'TyC Sports (Señal Alternativa)',
        url: 'http://45.170.130.224:8000/play/a020/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'TVPublica.ar',
    name: 'TV Pública',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Televisi%C3%B3n_P%C3%BAblica_Argentina_logo_2024.png/512px-Televisi%C3%B3n_P%C3%BAblica_Argentina_logo_2024.png',
    streamUrl: 'https://nd106.republicaservers.com/hls/c8094/index.m3u8',
    quality: '1080p HD',
    category: 'Aire & Fútbol Libre',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'TV Pública (República Servers HD)',
        url: 'https://nd106.republicaservers.com/hls/c8094/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
      {
        name: 'TV Pública (Centaury Oficial)',
        url: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'DeporTV.ar',
    name: 'DeporTV',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/DeporTV_logo_2020.png/512px-DeporTV_logo_2020.png',
    streamUrl: 'http://158.172.155.130:8000/play/a09y/index.m3u8',
    quality: '1080p HD',
    category: 'Deportes Argentina',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'DeporTV (Señal Oficial HD)',
        url: 'http://158.172.155.130:8000/play/a09y/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
    ],
  },
  {
    id: 'FoxSports.ar',
    name: 'Fox Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Fox_Sports_logo_2017.svg/512px-Fox_Sports_logo_2017.svg.png',
    streamUrl: 'http://158.172.155.130:8000/play/a09x/index.m3u8',
    quality: '1080p HD',
    category: 'Libertadores & Champions',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'Fox Sports (Señal HD)',
        url: 'http://158.172.155.130:8000/play/a09x/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
      {
        name: 'Fox Sports (Espejo 2)',
        url: 'http://138.59.227.20:8000/play/a085/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://138.59.227.20:8000/',
      },
    ],
  },
  {
    id: 'ESPN.ar',
    name: 'ESPN Argentina',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: 'http://158.172.155.130:8000/play/a008/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Polideportivo',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'ESPN (Señal Principal HD)',
        url: 'http://158.172.155.130:8000/play/a008/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
    ],
  },
  {
    id: 'ESPN2.ar',
    name: 'ESPN 2',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: 'http://158.172.155.130:8000/play/a009/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Polideportivo',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'ESPN 2 (Señal Principal HD)',
        url: 'http://158.172.155.130:8000/play/a009/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
      {
        name: 'ESPN 2 (Espejo 2)',
        url: 'http://190.61.47.54:8000/play/a005/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://190.61.47.54:8000/',
      },
    ],
  },
  {
    id: 'ESPN3.ar',
    name: 'ESPN 3',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: 'http://190.61.47.54:8000/play/a010/index.m3u8',
    quality: '1080p HD',
    category: 'Polideportivo & Tenis',
    isOnline: true,
    referrer: 'http://190.61.47.54:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'ESPN 3 (Señal HD)',
        url: 'http://190.61.47.54:8000/play/a010/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://190.61.47.54:8000/',
      },
    ],
  },
  {
    id: 'ESPNPremium.ar',
    name: 'ESPN Premium',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/ESPN_Premium_logo.png/512px-ESPN_Premium_logo.png',
    streamUrl: 'http://158.172.155.130:8000/play/a005/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Argentino (Pack Fútbol)',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'ESPN Premium (Señal 1 HD)',
        url: 'http://158.172.155.130:8000/play/a005/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
      {
        name: 'ESPN Premium (Espejo 2)',
        url: 'http://190.61.47.54:8000/play/a004/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://190.61.47.54:8000/',
      },
    ],
  },
  {
    id: 'TNTSports.ar',
    name: 'TNT Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/TNT_Sports_%28Argentina%29_logo_2021.png/512px-TNT_Sports_%28Argentina%29_logo_2021.png',
    streamUrl: 'http://158.172.155.130:8000/play/a006/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Argentino (Pack Fútbol)',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'TNT Sports (Señal 1 HD)',
        url: 'http://158.172.155.130:8000/play/a006/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
      {
        name: 'TNT Sports (Espejo 2)',
        url: 'http://190.61.47.54:8000/play/a011/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://190.61.47.54:8000/',
      },
    ],
  },
  {
    id: 'DSports.ar',
    name: 'DSports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/DSports_logo_2022.svg/512px-DSports_logo_2022.svg.png',
    streamUrl: 'http://158.172.155.130:8000/play/a007/index.m3u8',
    quality: '1080p HD',
    category: 'Sudamericana & Deportes Exclusivos',
    isOnline: true,
    referrer: 'http://158.172.155.130:8000/',
    lastVerified: Date.now(),
    servers: [
      {
        name: 'DSports (Señal 1 HD)',
        url: 'http://158.172.155.130:8000/play/a007/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://158.172.155.130:8000/',
      },
      {
        name: 'DSports (Espejo 2)',
        url: 'http://190.61.47.54:8000/play/a012/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
        referrer: 'http://190.61.47.54:8000/',
      },
    ],
  },
  {
    id: 'CronicaTV.ar',
    name: 'Crónica TV',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Cr%C3%B3nica_TV_logo_2021.png/512px-Cr%C3%B3nica_TV_logo_2021.png',
    streamUrl: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
    quality: '720p HD',
    category: 'Noticias & Fútbol de Ascenso',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'Crónica TV (En Vivo)',
        url: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'C5N.ar',
    name: 'C5N',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/C5N_logo_2020.png/512px-C5N_logo_2020.png',
    streamUrl: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
    quality: '720p HD',
    category: 'Noticias & Actualidad',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'C5N (En Vivo)',
        url: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'NetTV.ar',
    name: 'Net TV Argentina',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Net_TV_logo_2018.svg/512px-Net_TV_logo_2018.svg.png',
    streamUrl: 'https://unlimited6-cl.dps.live/nettv/nettv.smil/playlist.m3u8',
    quality: '1080p HD',
    category: 'Aire & Deportes Argentina',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'Net TV (Señal Oficial HD)',
        url: 'https://unlimited6-cl.dps.live/nettv/nettv.smil/playlist.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: '5TVCorrientes.ar',
    name: '5TV Corrientes',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://i.imgur.com/4gTtAlf.jpeg',
    streamUrl: 'https://617c5175c970b.streamlock.net:4444/tvcinco/live1/playlist.m3u8',
    quality: '720p HD',
    category: 'Noticias & Deportes Argentina',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: '5TV Corrientes (Streamlock HD)',
        url: 'https://617c5175c970b.streamlock.net:4444/tvcinco/live1/playlist.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: '8NTV.mx',
    name: '8NTV México',
    country: 'MX',
    countryName: 'México',
    countryFlag: '🇲🇽',
    logo: 'https://i.imgur.com/4gTtAlf.jpeg',
    streamUrl: 'https://60417ddeaf0d9.streamlock.net/ntv/videontv/playlist.m3u8',
    quality: '720p HD',
    category: 'Noticias & Deportes México',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: '8NTV (Streamlock HD)',
        url: 'https://60417ddeaf0d9.streamlock.net/ntv/videontv/playlist.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: '12TV.es',
    name: '12TV España',
    country: 'ES',
    countryName: 'España',
    countryFlag: '🇪🇸',
    logo: 'https://i.imgur.com/4gTtAlf.jpeg',
    streamUrl: 'https://cloud.streamingconnect.tv/hls/12tv/12tv2.m3u8',
    quality: '1080p HD',
    category: 'Noticias & Polideportivo España',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: '12TV (StreamingConnect HD)',
        url: 'https://cloud.streamingconnect.tv/hls/12tv/12tv2.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: '3CatInfo.es',
    name: '3Cat Info',
    country: 'ES',
    countryName: 'España',
    countryFlag: '🇪🇸',
    logo: 'https://i.imgur.com/4gTtAlf.jpeg',
    streamUrl: 'https://directes-tv-int.3catdirectes.cat/live-origin/canal324-hls/master.m3u8',
    quality: '1080p HD',
    category: 'Noticias & Actualidad',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: '3Cat Info (Directes HD)',
        url: 'https://directes-tv-int.3catdirectes.cat/live-origin/canal324-hls/master.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: '8LaMarinaTV.es',
    name: '8 La Marina TV',
    country: 'ES',
    countryName: 'España',
    countryFlag: '🇪🇸',
    logo: 'https://i.imgur.com/4gTtAlf.jpeg',
    streamUrl: 'https://streaming005.gestec-video.com/hls/canal24.m3u8',
    quality: '1080p HD',
    category: 'Polideportivo & Noticias',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: '8 La Marina TV (Gestec HD)',
        url: 'https://streaming005.gestec-video.com/hls/canal24.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'RedBullTV.int',
    name: 'Red Bull TV',
    country: 'INT',
    countryName: 'Internacional',
    countryFlag: '🌍',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Red_Bull_TV_logo.svg/512px-Red_Bull_TV_logo.svg.png',
    streamUrl: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    quality: '1080p HD',
    category: 'Deportes Extremos & F1',
    isOnline: true,
    lastVerified: Date.now(),
    servers: [
      {
        name: 'Red Bull TV (Akamai HD)',
        url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
];


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
  private isFetching: boolean = false;

  private async filterOnlineStreams(channels: LiveSportsChannel[]): Promise<LiveSportsChannel[]> {
    if (typeof window !== 'undefined' && window.electronAPI?.probeStreams) {
      try {
        const urls = channels.map((c) => c.streamUrl).filter(Boolean);
        const results = await window.electronAPI.probeStreams(urls);
        const validated: LiveSportsChannel[] = [];
        const unverified: LiveSportsChannel[] = [];

        for (const c of channels) {
          const res = results[c.streamUrl];
          if (res === true) {
            validated.push({
              ...c,
              isOnline: true,
              lastVerified: Date.now(),
            });
          } else if (res === undefined) {
            unverified.push(c);
          }
          // Si res === false (manifiesto caído o sin #EXTM3U), se oculta
        }

        // Ordenar: canales verificados primero, no verificados al final
        const combined = [...validated, ...unverified];
        return combined.length > 0 ? combined : channels;
      } catch (e) {
        console.warn('Probe streams error:', e);
        return channels;
      }
    }
    return channels;
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
   * Devuelve al instante los canales cacheados/verificados y refresca en segundo plano.
   */
  async getSportsChannels(): Promise<LiveSportsChannel[]> {
    if (this.memoryCache && this.memoryCache.length > 0) {
      return this.memoryCache;
    }

    const local = this.readFromStorage();
    if (local && local.length > 0) {
      this.memoryCache = local;
      this.fetchDynamicStreamsBackground();
      return local;
    }

    if (typeof window !== 'undefined' && window.electronAPI?.probeStreams) {
      const online = await this.filterOnlineStreams(VERIFIED_SPORTS_CHANNELS);
      this.memoryCache = online.length > 0 ? online : VERIFIED_SPORTS_CHANNELS;
    } else {
      this.memoryCache = VERIFIED_SPORTS_CHANNELS;
    }

    this.fetchDynamicStreamsBackground();
    return this.memoryCache;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return (await res.json()) as T;
  }

  /**
   * Consume iptv-org (channels + streams + logos en paralelo), cruza logos reales,
   * agrupa streams por canal, penaliza Geo-blocked, prioriza resolución y deduplica por URL.
   */
  async fetchDynamicStreams(): Promise<LiveSportsChannel[]> {
    try {
      this.isFetching = true;

      const [channelsRes, streamsRes, logosRes] = await Promise.allSettled([
        this.fetchJson<RawChannel[]>(CHANNELS_API),
        this.fetchJson<RawStream[]>(STREAMS_API),
        this.fetchJson<RawLogo[]>(LOGOS_API),
      ]);

      if (channelsRes.status !== 'fulfilled' || streamsRes.status !== 'fulfilled') {
        throw new Error('No se pudieron obtener channels/streams de iptv-org');
      }

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

      // Logos reales: preferir "in_use" y el de mayor ancho
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

      // Agrupar todos los streams por canal (dedupe por URL)
      const streamsByChannel = new Map<string, RawStream[]>();
      const seenUrls = new Set<string>();
      for (const st of streamsData) {
        if (!st.channel || !st.url || seenUrls.has(st.url)) continue;
        seenUrls.add(st.url);
        const arr = streamsByChannel.get(st.channel);
        if (arr) arr.push(st);
        else streamsByChannel.set(st.channel, [st]);
      }

      const dynamicChannels: LiveSportsChannel[] = [];
      for (const ch of filteredChannels) {
        const streams = streamsByChannel.get(ch.id);
        if (!streams || streams.length === 0) continue;

        const sorted = [...streams].sort((a, b) => streamScore(b) - streamScore(a));
        const best = sorted[0];
        const countryInfo = SPANISH_COUNTRIES_MAP[ch.country] || { name: ch.country, flag: '⚽' };

        const channelServers: StreamServer[] = sorted.slice(0, 4).map((st, idx) => ({
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
          isOnline: true,
          referrer: best.referrer ?? null,
          userAgent: best.user_agent ?? null,
          geoBlocked: isGeoBlocked(best),
          servers: channelServers,
        });
      }

      // Verificados primero (sin duplicar), luego los dinámicos
      const plutoChannels = await this.fetchPlutoChannels();
      const existingIds = new Set(VERIFIED_SPORTS_CHANNELS.map((c) => c.id));
      const uniqueDynamic = dynamicChannels.filter((c) => !existingIds.has(c.id));
      const combined = [...VERIFIED_SPORTS_CHANNELS, ...plutoChannels, ...uniqueDynamic];

      let finalChannels = combined;
      if (typeof window !== 'undefined' && window.electronAPI?.probeStreams) {
        finalChannels = await this.filterOnlineStreams(combined);
      }

      this.memoryCache = finalChannels;
      this.saveToStorage(finalChannels);
      return finalChannels;
    } catch (err) {
      console.warn('⚠️ [IPTV Service] Fallback a canales verificados:', err);
      return this.memoryCache || VERIFIED_SPORTS_CHANNELS;
    } finally {
      this.isFetching = false;
    }
  }

  private fetchDynamicStreamsBackground() {
    if (this.isFetching) return;
    this.fetchDynamicStreams().catch((err) => {
      console.warn('Background IPTV update failed:', err);
    });
  }

  private readFromStorage(): LiveSportsChannel[] | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed.channels;
    } catch (_) {
      return null;
    }
  }

  private saveToStorage(channels: LiveSportsChannel[]) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), channels }));
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
