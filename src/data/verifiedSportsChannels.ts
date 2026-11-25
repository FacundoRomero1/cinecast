import type { LiveSportsChannel } from '../types';

/**
 * Catálogo curado de canales deportivos y señales de referencia en español.
 * Se valida en tiempo real contra sus URLs principales y espejos confiables en `servers[]`.
 * Los canales sin señal confiable verificada no exponen streams opacos/genéricos y quedan offline.
 */
export const VERIFIED_SPORTS_CHANNELS: LiveSportsChannel[] = [
  {
    id: 'TyCSports.ar',
    name: 'TyC Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/TyC_Sports_logo_2020.svg/512px-TyC_Sports_logo_2020.svg.png',
    streamUrl: 'https://live-04-11-tyc-app-web.vodgc.net/tyc24/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Argentino & Deportes',
    isOnline: false,
    servers: [
      {
        name: 'TyC Sports (VODGC 24/7)',
        url: 'https://live-04-11-tyc-app-web.vodgc.net/tyc24/index.m3u8',
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
    streamUrl: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
    quality: '1080p HD',
    category: 'Aire & Fútbol Libre',
    isOnline: false,
    servers: [
      {
        name: 'TV Pública (Medios Públicos Oficial)',
        url: 'https://ca.centaurychile.com:2443/hls/mediospublicos.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
      {
        name: 'TV Pública (República Servers HD)',
        url: 'https://nd106.republicaservers.com/hls/c8094/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
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
    streamUrl: '',
    quality: '1080p HD',
    category: 'Fútbol Argentino (Pack Fútbol)',
    isOnline: false,
    servers: [],
  },
  {
    id: 'DSports2.ar',
    name: 'DSports 2',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/DIRECTV_Sports_2_Latin_America_%282018%29.svg/512px-DIRECTV_Sports_2_Latin_America_%282018%29.svg.png',
    streamUrl: 'http://45.134.141.161:2200/ARG/DTV_SP2/tracks-v1a1/mono.m3u8',
    quality: '1080p HD',
    category: 'Sudamericana & Deportes Exclusivos',
    isOnline: false,
    servers: [
      {
        name: 'DSports 2 Argentina (Directo HD)',
        url: 'http://45.134.141.161:2200/ARG/DTV_SP2/tracks-v1a1/mono.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'CanalShowsport.ar',
    name: 'Canal Showsport',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://i.imgur.com/0L9tW3Z.png',
    streamUrl: 'https://livestream.lumpentv.com.ar/hls/lumpen.m3u8',
    quality: '720p HD',
    category: 'Fútbol & Deportes Argentina',
    isOnline: false,
    servers: [
      {
        name: 'Canal Showsport Córdoba (Oficial HLS)',
        url: 'https://livestream.lumpentv.com.ar/hls/lumpen.m3u8',
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
    streamUrl: '',
    quality: '1080p HD',
    category: 'Deportes Argentina',
    isOnline: false,
    servers: [],
  },
  {
    id: 'FoxSports.ar',
    name: 'Fox Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Fox_Sports_logo_2017.svg/512px-Fox_Sports_logo_2017.svg.png',
    streamUrl: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/1552.m3u8',
    quality: '1080p HD',
    category: 'Libertadores & Champions',
    isOnline: false,
    servers: [
      {
        name: 'Fox Sports Argentina HD',
        url: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/1552.m3u8',
        type: 'hls',
        language: 'En Vivo',
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
    streamUrl: '',
    quality: '1080p HD',
    category: 'Fútbol & Polideportivo',
    isOnline: false,
    servers: [],
  },
  {
    id: 'ESPN2.ar',
    name: 'ESPN 2',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: '',
    quality: '1080p HD',
    category: 'Fútbol & Polideportivo',
    isOnline: false,
    servers: [],
  },
  {
    id: 'ESPN3.ar',
    name: 'ESPN 3',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: '',
    quality: '1080p HD',
    category: 'Polideportivo & Tenis',
    isOnline: false,
    servers: [],
  },
  {
    id: 'TNTSports.ar',
    name: 'TNT Sports',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/TNT_Sports_%28Argentina%29_logo_2021.png/512px-TNT_Sports_%28Argentina%29_logo_2021.png',
    streamUrl: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/86.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Argentino (Pack Fútbol)',
    isOnline: false,
    servers: [
      {
        name: 'TNT Sports Argentina HD',
        url: 'http://45.184.109.10/live/69393EAE6ADBC65A68F942022362A202/86.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'TNTSports.cl',
    name: 'TNT Sports Chile',
    country: 'CL',
    countryName: 'Chile',
    countryFlag: '🇨🇱',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/TNT_Sports_%28Argentina%29_logo_2021.png/512px-TNT_Sports_%28Argentina%29_logo_2021.png',
    streamUrl: 'http://205.235.6.29:8000/play/a0xa/index.m3u8',
    quality: 'HD',
    category: 'Fútbol Chileno & Deportes',
    isOnline: false,
    servers: [
      {
        name: 'TNT Sports Chile',
        url: 'http://205.235.6.29:8000/play/a0xa/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'ESPNColombia.co',
    name: 'ESPN Latinoamérica (CO)',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: 'http://181.78.211.244:8005/play/a08q/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Champions League',
    isOnline: false,
    servers: [
      {
        name: 'ESPN LatAm Colombia HD',
        url: 'http://181.78.211.244:8005/play/a08q/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'ESPN2Colombia.co',
    name: 'ESPN 2 Latinoamérica (CO)',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/512px-ESPN_wordmark.svg.png',
    streamUrl: 'http://38.211.118.56:50002/play/a0fa/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Champions League',
    isOnline: false,
    servers: [
      {
        name: 'ESPN 2 LatAm Colombia HD',
        url: 'http://38.211.118.56:50002/play/a0fa/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'WinPlusFutbol.co',
    name: 'Win+ Fútbol',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Win_Sports_logo.svg/512px-Win_Sports_logo.svg.png',
    streamUrl: 'http://181.78.12.119:16123/play/ch19/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Colombiano & Deportes',
    isOnline: false,
    servers: [
      {
        name: 'Win+ Fútbol HD',
        url: 'http://181.78.12.119:16123/play/ch19/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'WinSports.co',
    name: 'Win Sports',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Win_Sports_logo.svg/512px-Win_Sports_logo.svg.png',
    streamUrl: 'http://138.121.15.230:9002/WIN-SPORT/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Colombiano & Deportes',
    isOnline: false,
    servers: [
      {
        name: 'Win Sports HD',
        url: 'http://138.121.15.230:9002/WIN-SPORT/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'ClaroSports.mx',
    name: 'Claro Sports',
    country: 'MX',
    countryName: 'México',
    countryFlag: '🇲🇽',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Claro_Sports_logo.svg/512px-Claro_Sports_logo.svg.png',
    streamUrl: 'http://45.171.64.30:6060/play/a00w/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Polideportivo LatAm',
    isOnline: false,
    servers: [
      {
        name: 'Claro Sports México HD',
        url: 'http://45.171.64.30:6060/play/a00w/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'SkySports1.mx',
    name: 'Sky Sports 1 (MX)',
    country: 'MX',
    countryName: 'México',
    countryFlag: '🇲🇽',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Sky_Sports_logo_2020.svg/512px-Sky_Sports_logo_2020.svg.png',
    streamUrl: 'http://45.228.234.9:8000/play/a06b/index.m3u8',
    quality: '1080p HD',
    category: 'LaLiga & Fútbol Internacional',
    isOnline: false,
    servers: [
      {
        name: 'Sky Sports 1 México HD',
        url: 'http://45.228.234.9:8000/play/a06b/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'FUTV.cr',
    name: 'FUTV Costa Rica',
    country: 'CR',
    countryName: 'Costa Rica',
    countryFlag: '🇨🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/FUTV_logo.png/512px-FUTV_logo.png',
    streamUrl: 'http://45.228.234.9:8000/play/a06o/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Centroamérica',
    isOnline: false,
    servers: [
      {
        name: 'FUTV HD',
        url: 'http://45.228.234.9:8000/play/a06o/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'L1Max.pe',
    name: 'L1 Max Perú',
    country: 'PE',
    countryName: 'Perú',
    countryFlag: '🇵🇪',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Liga_1_Max_logo.png/512px-Liga_1_Max_logo.png',
    streamUrl: 'http://190.93.224.42/LIGA-1-MAX/index.m3u8',
    quality: '1080p HD',
    category: 'Fútbol Peruano',
    isOnline: false,
    servers: [
      {
        name: 'L1 Max HD',
        url: 'http://190.93.224.42/LIGA-1-MAX/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'beINSPORTSXTRAenEspanol.us',
    name: 'beIN SPORTS XTRA Español',
    country: 'US',
    countryName: 'Estados Unidos (Español)',
    countryFlag: '🇺🇸',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/BeIN_Sports_logo.svg/512px-BeIN_Sports_logo.svg.png',
    streamUrl: 'https://dc1644a9jazgj.cloudfront.net/beIN_Sports_Xtra_Espanol.m3u8',
    quality: '1080p HD',
    category: 'Fútbol & Deportes en Español',
    isOnline: false,
    servers: [
      {
        name: 'beIN SPORTS XTRA Español HD',
        url: 'https://dc1644a9jazgj.cloudfront.net/beIN_Sports_Xtra_Espanol.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'Eurosport1.es',
    name: 'Eurosport 1 España',
    country: 'ES',
    countryName: 'España',
    countryFlag: '🇪🇸',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Eurosport_1_Logo_2015.svg/512px-Eurosport_1_Logo_2015.svg.png',
    streamUrl: 'http://45.134.141.161:2200/ARG/Eurosport_1_HD/index.m3u8',
    quality: 'HD',
    category: 'Polideportivo & Tenis España',
    isOnline: false,
    servers: [
      {
        name: 'Eurosport 1 España HD',
        url: 'http://45.134.141.161:2200/ARG/Eurosport_1_HD/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
      },
    ],
  },
  {
    id: 'Eurosport2.es',
    name: 'Eurosport 2 España',
    country: 'ES',
    countryName: 'España',
    countryFlag: '🇪🇸',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Eurosport_2_Logo_2015.svg/512px-Eurosport_2_Logo_2015.svg.png',
    streamUrl: 'http://45.134.141.161:2200/ARG/Eurosport_2_HD/index.m3u8',
    quality: '1080p HD',
    category: 'Polideportivo & Tenis España',
    isOnline: false,
    servers: [
      {
        name: 'Eurosport 2 España HD',
        url: 'http://45.134.141.161:2200/ARG/Eurosport_2_HD/index.m3u8',
        type: 'hls',
        language: 'En Vivo',
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
    streamUrl: '',
    quality: '1080p HD',
    category: 'Sudamericana & Deportes Exclusivos',
    isOnline: false,
    servers: [],
  },
  {
    id: 'FoxDeportes.us',
    name: 'Fox Deportes',
    country: 'US',
    countryName: 'Estados Unidos (Español)',
    countryFlag: '🇺🇸',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/FOX_Deportes_logo.png/512px-FOX_Deportes_logo.png',
    streamUrl: 'https://live-manifest.production-public.tubi.io/live/d906efca-1302-4e29-b0d9-9a1d7a305d69/playlist.m3u8',
    quality: '720p HD',
    category: 'Fútbol & Deportes en Español',
    isOnline: false,
    servers: [
      {
        name: 'Fox Deportes (Tubi Oficial HD)',
        url: 'https://live-manifest.production-public.tubi.io/live/d906efca-1302-4e29-b0d9-9a1d7a305d69/playlist.m3u8',
        type: 'hls',
        language: 'En Vivo',
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
    streamUrl: '',
    quality: '720p HD',
    category: 'Noticias & Fútbol de Ascenso',
    isOnline: false,
    servers: [],
  },
  {
    id: 'C5N.ar',
    name: 'C5N',
    country: 'AR',
    countryName: 'Argentina',
    countryFlag: '🇦🇷',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/C5N_logo_2020.png/512px-C5N_logo_2020.png',
    streamUrl: '',
    quality: '720p HD',
    category: 'Noticias & Actualidad',
    isOnline: false,
    servers: [],
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
    isOnline: false,
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
    isOnline: false,
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
    isOnline: false,
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
    isOnline: false,
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
    isOnline: false,
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
    isOnline: false,
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
    isOnline: false,
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

const AR_PRIMARY_FOOTBALL_IDS = new Set([
  'TyCSports.ar',
  'ESPNPremium.ar',
  'TNTSports.ar',
  'ESPN.ar',
  'ESPN2.ar',
  'ESPN3.ar',
  'FoxSports.ar',
  'DSports.ar',
  'DSports2.ar',
  'CanalShowsport.ar',
  'DeporTV.ar',
  'TVPublica.ar',
]);

const AR_NEWS_GENERAL_IDS = new Set([
  'CronicaTV.ar',
  'C5N.ar',
  'NetTV.ar',
  '5TVCorrientes.ar',
]);

const PRIORITY_COUNTRIES = ['AR', 'MX', 'ES', 'CO', 'CL', 'UY', 'PE', 'VE', 'CR', 'EC', 'INT'];

const FOOTBALL_SPORTS_RE = /f[uú]tbol|tyc|espn|tnt\s*sports|fox\s*(sports|deportes)|dsports|deportv|directv|pack\s*f[uú]tbol|libertadores|champions|liga|sport|gol|showsport/i;

const GARBAGE_OR_UNRELATED_RE = /\b(telenovela|novelas?|tnt\s*novelas|tnt\s*series|tnt\s*latin|cristian[ao]?|iglesia|religi[oó]n|enlace|bethel|ewtn|tbn|telepac[ií]fico|telemundo|tl\s*novelas|disney|cartoon|nick|mtv|cinecanal|cinemax|hbo)\b/i;

const OPAQUE_IP_OR_XTREAM_SLOT_RE =
  /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\/(?:play\/[a-z0-9]+|live\/[0-9a-f]{12,}\/\d+|stream\/\d+)/i;

const ANY_OPAQUE_XTREAM_PLAY_RE = /\/play\/a[0-9a-z]{2,5}(?:\/|$|\.)/i;

const TRUSTED_NAMED_DOMAINS = [
  'amagi.tv',
  'vodgc.net',
  'republicaservers.com',
  'centaurychile.com',
  'lumpentv.com.ar',
  'dps.live',
  'streamlock.net',
  'streamingconnect.tv',
  '3catdirectes.cat',
  'gestec-video.com',
  'akamaized.net',
  'tubi.io',
  'pluto.tv',
];

const CURATED_ID_SET = new Set(VERIFIED_SPORTS_CHANNELS.map((c) => c.id));

function normalizeChannelText(input?: string | null): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getExpectedUrlPatternsForChannel(ch: { id: string; name: string }): RegExp[] {
  const norm = `${normalizeChannelText(ch.id)} ${normalizeChannelText(ch.name)}`;
  if (/tyc/.test(norm)) return [/tyc/i];
  if (/tvpublica|tv\s*publica/.test(norm)) return [/tvp/i, /public/i, /mediospublicos/i, /c8094/i];
  if (/espn.*prem/.test(norm)) return [/espn[-_ ]?prem/i, /espn_premium/i];
  if (/espn[-_ ]?2/.test(norm)) return [/espn[-_ ]?2/i, /espn2/i];
  if (/espn[-_ ]?3/.test(norm)) return [/espn[-_ ]?3/i, /espn3/i];
  if (/espn/.test(norm)) return [/espn/i];
  if (/tnt.*sport/.test(norm)) return [/tnt[-_ ]?sport/i];
  if (/dsports?\s*2|dtv[-_ ]?sp2/.test(norm)) return [/dsport.?2/i, /dtv[-_ ]?sp2/i, /directv.?sp.?2/i];
  if (/dsport|dtv[-_ ]?sp/.test(norm)) return [/dsport/i, /dtv[-_ ]?sp/i, /directv.?sp/i];
  if (/fox.*(sport|deport)/.test(norm)) return [/fox.?sport/i, /foxdeport/i, /\/fox\//i, /tubi\.io/i];
  if (/deportv/.test(norm)) return [/deportv/i];
  if (/showsport/.test(norm)) return [/showsport/i, /lumpen/i];
  if (/nettv|net\s*tv/.test(norm)) return [/nettv/i];
  if (/5tv|tvcinco/.test(norm)) return [/tvcinco/i, /5tv/i];
  if (/8ntv/.test(norm)) return [/\/ntv\//i, /8ntv/i];
  if (/12tv/.test(norm)) return [/12tv/i];
  if (/3cat|canal324/.test(norm)) return [/3cat/i, /canal324/i];
  if (/marina/.test(norm)) return [/marina/i, /canal24/i];
  if (/red\s*bull|redbull/.test(norm)) return [/borb/i, /redbull/i];
  if (/cronica/.test(norm)) return [/cronica/i];
  if (/c5n/.test(norm)) return [/c5n/i];
  return [];
}

export interface MirrorTrustAssessment {
  trusted: boolean;
  score: number;
  reason: string;
}

/**
 * Evalúa si un mirror/URL es confiable para un canal dado (anti-basura).
 * Rechaza slots opacos numéricos/IP tipo Xtream (`/play/aXXX`), URLs compartidas de otro canal
 * y rutas cuyo path o metadata contradicen la identidad del canal esperado.
 */
export function assessMirrorTrust(
  channel: { id: string; name: string; country?: string; groupTitle?: string },
  server: { name?: string; url?: string }
): MirrorTrustAssessment {
  const url = String(server?.url || '').trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { trusted: false, score: -999, reason: 'URL inválida o vacía' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { trusted: false, score: -999, reason: 'URL malformada' };
  }

  const fullText = `${url} ${server?.name || ''}`;
  if (GARBAGE_OR_UNRELATED_RE.test(fullText)) {
    return { trusted: false, score: -500, reason: 'contiene keywords ajenas/no deportivas' };
  }

  // Guardia explícita contra URLs compartidas que causan canales cruzados (ej. mediospublicos en Crónica/C5N)
  const chanNorm = `${normalizeChannelText(channel.id)} ${normalizeChannelText(channel.name)}`;
  if (/mediospublicos/i.test(url) && !/tvpublica|publica/i.test(chanNorm)) {
    return { trusted: false, score: -500, reason: 'stream mediospublicos pertenece solo a TV Pública' };
  }
  if (/lumpen/i.test(url) && !/showsport/i.test(chanNorm)) {
    return { trusted: false, score: -500, reason: 'stream lumpen pertenece solo a Canal Showsport' };
  }

  // Rechazar slots opacos de Xtream / IP sin identificador real en el path
  if (OPAQUE_IP_OR_XTREAM_SLOT_RE.test(url) || ANY_OPAQUE_XTREAM_PLAY_RE.test(parsed.pathname)) {
    return { trusted: false, score: -300, reason: 'slot numérico opaco Xtream/IP sin identidad verificable' };
  }

  const hostAndPath = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  const expectedPatterns = getExpectedUrlPatternsForChannel(channel);
  const pathHasExpectedToken = expectedPatterns.some((re) => re.test(hostAndPath));
  const isRawIpHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname);
  const isTrustedCdn = TRUSTED_NAMED_DOMAINS.some((d) => parsed.hostname.toLowerCase().endsWith(d));

  // Verificar coherencia numérica en ESPN/DSports/FOX si el path menciona otro número de señal
  if (/espn/i.test(chanNorm) && /espn[-_ ]?([2-7])\b/i.test(hostAndPath)) {
    const pathNum = hostAndPath.match(/espn[-_ ]?([2-7])\b/i)?.[1];
    const chanNum = chanNorm.match(/espn\s*([2-7])\b/i)?.[1];
    if (pathNum && chanNum && pathNum !== chanNum) {
      return { trusted: false, score: -400, reason: `path corresponde a ESPN ${pathNum}, no a ${channel.name}` };
    }
    if (pathNum && !chanNum && !/prem/i.test(chanNorm)) {
      return { trusted: false, score: -400, reason: `path corresponde a ESPN ${pathNum}, no a ESPN principal` };
    }
  }

  // En IPs crudas, SOLO aceptar si el path expone explícitamente la identidad del canal (ej. /ARG/ESPN_Premium_Argentina_HD/)
  if (isRawIpHost) {
    if (pathHasExpectedToken) {
      return { trusted: true, score: 90, reason: 'path explícito coincidente con canal en host directo' };
    }
    return { trusted: false, score: -250, reason: 'host IP crudo sin token identificatorio del canal' };
  }

  let score = 0;
  const reasons: string[] = [];

  if (pathHasExpectedToken) {
    score += 100;
    reasons.push('path/host coincide con identidad del canal');
  }
  if (isTrustedCdn) {
    score += 60;
    reasons.push(`dominio CDN verificado (${parsed.hostname})`);
  }
  if (parsed.protocol === 'https:') {
    score += 10;
  }

  // Para señales deportivas críticas (TNT, ESPN, DSports, TyC, Fox, DeporTV), exigir señal identificable o dominio confiable
  if (!pathHasExpectedToken && !isTrustedCdn) {
    return {
      trusted: false,
      score: -100,
      reason: `host (${parsed.hostname}) y path sin relación verificable con "${channel.name}"`,
    };
  }

  return {
    trusted: true,
    score,
    reason: reasons.join(' + ') || 'mirror válido',
  };
}

/**
 * Filtro anti-basura para candidatos crudos provenientes de iptv-org.
 * Impide mezclar novelas, canales religiosos o señales no deportivas en la grilla deportiva.
 */
export function isTrustworthyIptvCandidate(ch: {
  id: string;
  name: string;
  streamUrl: string;
  country?: string;
  groupTitle?: string;
  category?: string;
}): { ok: boolean; reason: string } {
  const combinedText = `${ch.id || ''} ${ch.name || ''} ${ch.groupTitle || ''} ${ch.streamUrl || ''}`;
  if (GARBAGE_OR_UNRELATED_RE.test(combinedText)) {
    return { ok: false, reason: 'canal no deportivo / contenido ajeno' };
  }

  const isCurated = CURATED_ID_SET.has(ch.id);
  const groupNorm = normalizeChannelText(ch.groupTitle || '');
  const isSportsGroup = groupNorm.includes('sport') || groupNorm.includes('deport');
  const nameMatchesSports = FOOTBALL_SPORTS_RE.test(`${ch.name} ${ch.id}`);

  // Excluir TNT Entertainment/Novelas/Series aunque contenga "TNT"
  if (/^tnt/i.test(normalizeChannelText(ch.id)) || /\btnt\b/i.test(normalizeChannelText(ch.name))) {
    if (!/tnt\s*sport/i.test(`${ch.id} ${ch.name}`)) {
      return { ok: false, reason: 'señal TNT de cine/series, no TNT Sports' };
    }
  }

  if (!isCurated && !isSportsGroup && !nameMatchesSports) {
    return { ok: false, reason: 'no pertenece a categoría ni branding deportivo' };
  }

  const mirrorCheck = assessMirrorTrust(ch, { name: ch.name, url: ch.streamUrl });
  if (!mirrorCheck.trusted) {
    // Permitir relays IP directos provenientes del catálogo oficial de deportes de iptv-org
    // cuando pertenecen a países/señales hispanohablantes (ESPN LatAm, TNT Sports, Win+, Claro Sports, Sky Sports, FUTV, etc.)
    const countryUp = (ch.country || '').toUpperCase();
    const HISPANIC_SET = new Set(['AR', 'MX', 'ES', 'CO', 'CL', 'UY', 'PE', 'VE', 'EC', 'CR', 'PA', 'DO', 'PR', 'GT', 'HN', 'PY', 'BO', 'SV', 'NI']);
    const isHispanicSports =
      HISPANIC_SET.has(countryUp) ||
      /espa[nñ]ol|latino|latam|latin\s*america|colombia|mexico|m[eé]xico|argentina|chile|peru|per[uú]|spain|espn|fox\s*deportes|tudn|win\s*\+?|claro\s*sports|sky\s*sports|futv|l1\s*max|tyc|tnt\s*sports/i.test(
        `${ch.name} ${ch.id}`
      );
    const isKnownBroken = /45\.134\.141\.161:2200\/ARG\/ESPN_Premium/i.test(ch.streamUrl || '');
    if (!isKnownBroken && isHispanicSports && (isSportsGroup || nameMatchesSports) && /host IP crudo/i.test(mirrorCheck.reason)) {
      return { ok: true, reason: 'relay IP deportivo hispanohablante (iptv-org)' };
    }
    return { ok: false, reason: mirrorCheck.reason };
  }

  return { ok: true, reason: mirrorCheck.reason };
}

/**
 * Regla estricta para promover un stream de iptv-org como mirror de un canal curado.
 */
export function canPromoteCandidateToVerified(
  verifiedCh: { id: string; name: string; country?: string },
  candidate: { id: string; name: string; streamUrl: string; country?: string; groupTitle?: string }
): { ok: boolean; reason: string } {
  const candText = `${normalizeChannelText(candidate.id)} ${normalizeChannelText(candidate.name)}`;
  if (GARBAGE_OR_UNRELATED_RE.test(candText)) {
    return { ok: false, reason: 'candidato marcado como no deportivo / ajeno' };
  }

  // Guardia regional/idioma: canales AR no deben promover señales en inglés de EEUU/UK ni Brasil/Holanda
  const verifiedCountry = (verifiedCh.country || '').toUpperCase();
  const candCountry = (candidate.country || '').toUpperCase();
  const candUrlLower = (candidate.streamUrl || '').toLowerCase();
  const isForeignNonHispanohablante =
    /\.(br|nl|uk|fr|de|au|in)(?:@|$)/i.test(candidate.id || '') ||
    /\/usa-s\/|united states|\(brazil\)|\(netherlands\)|fox\s*sports\s*[12]\b/i.test(`${candText} ${candUrlLower}`);
  if (verifiedCountry === 'AR' && isForeignNonHispanohablante) {
    return {
      ok: false,
      reason: `señal extranjera no hispanohablante ("${candidate.name}", ${candCountry || candidate.id}) no aplicable a canal AR`,
    };
  }
  const hasExplicitLatamTag = /argentina|latam|latin\s*america|south|panregional|deportes|espa[nñ]ol/i.test(candText);
  if (verifiedCountry === 'AR' && candCountry === 'US' && !hasExplicitLatamTag) {
    return {
      ok: false,
      reason: `señal US sin variante Argentina/Latam ("${candidate.name}")`,
    };
  }
  // Evitar mapear señales AR a feeds de México/Centroamérica (ej. pontiscloud.com/live/gt/ESPN)
  if (
    verifiedCountry === 'AR' &&
    (candCountry === 'MX' ||
      candCountry === 'GT' ||
      /\/live\/(gt|mx)\//i.test(candUrlLower) ||
      /\bmexico\b|\bméxico\b/i.test(candText))
  ) {
    return {
      ok: false,
      reason: `feed de México/Centroamérica ("${candidate.name}") no aplicable a canal AR`,
    };
  }

  const baseId = verifiedCh.id.split('.')[0].toLowerCase();
  const candBaseId = (candidate.id || '').split('.')[0].split('@')[0].toLowerCase();

  let identityMatches = candBaseId === baseId;
  if (!identityMatches) {
    if (baseId === 'tycsports') identityMatches = /\btyc\b/.test(candText);
    else if (baseId === 'tntsports') identityMatches = /tnt\s*sports/.test(candText);
    else if (baseId === 'espnpremium') identityMatches = /espn.*premium/.test(candText);
    else if (baseId === 'espn2') identityMatches = /\bespn\s*2\b/.test(candText);
    else if (baseId === 'espn3') identityMatches = /\bespn\s*3\b/.test(candText);
    else if (baseId === 'espn') identityMatches = /\bespn\b/.test(candText) && !/\bespn\s*[2-8]|premium|deportes|u\b/.test(candText);
    else if (baseId === 'dsports2') identityMatches = /dsports\s*2|directv\s*sports\s*2/.test(candText);
    else if (baseId === 'dsports') identityMatches = /\bdsports\b|directv\s*sports/.test(candText) && !/\bdsports\s*2\b/.test(candText);
    else if (baseId === 'foxsports') identityMatches = /fox\s*sports/.test(candText) && !/news/.test(candText);
    else if (baseId === 'foxdeportes') identityMatches = /fox\s*deportes/.test(candText);
    else if (baseId === 'deportv') identityMatches = /\bdeportv\b/.test(candText);
    else if (baseId === 'canalshowsport') identityMatches = /showsport/.test(candText);
    else if (baseId === 'tvpublica') identityMatches = /tv\s*publica/.test(candText);
  }

  if (!identityMatches) {
    return {
      ok: false,
      reason: `nombre/id "${candidate.name}" (${candidate.id}) no coincide con "${verifiedCh.name}" (${verifiedCh.id})`,
    };
  }

  const mirrorCheck = assessMirrorTrust(verifiedCh, { name: candidate.name, url: candidate.streamUrl });
  if (!mirrorCheck.trusted) {
    return { ok: false, reason: `mirror rechazado: ${mirrorCheck.reason}` };
  }

  return { ok: true, reason: `coincidencia de canal + ${mirrorCheck.reason}` };
}

const SPORTS_PRIORITY_FALLBACK = 999;
void SPORTS_PRIORITY_FALLBACK;

function getChannelPriorityTier(ch: {
  id: string;
  name: string;
  country: string;
  category?: string;
}): number {
  const isAr = (ch.country || '').toUpperCase() === 'AR';
  if (isAr) {
    if (AR_PRIMARY_FOOTBALL_IDS.has(ch.id)) return 0;
    if (!AR_NEWS_GENERAL_IDS.has(ch.id) && FOOTBALL_SPORTS_RE.test(`${ch.name} ${ch.category || ''}`)) {
      return 1;
    }
    if (!AR_NEWS_GENERAL_IDS.has(ch.id)) return 2;
    return 3;
  }
  const countryIdx = PRIORITY_COUNTRIES.indexOf((ch.country || '').toUpperCase());
  const base = countryIdx === -1 ? 20 : 10 + countryIdx;
  const isSports = FOOTBALL_SPORTS_RE.test(`${ch.name} ${ch.category || ''}`);
  return isSports ? base : base + 0.5;
}

/**
 * Ordena canales priorizando señales AR de fútbol/deportes vivas al principio de la lista.
 */
export function rankSportsChannels<
  T extends { id: string; name: string; country: string; category?: string }
>(channels: T[]): T[] {
  return [...channels].sort((a, b) => {
    const tierA = getChannelPriorityTier(a);
    const tierB = getChannelPriorityTier(b);
    if (tierA !== tierB) return tierA - tierB;
    return a.name.localeCompare(b.name, 'es');
  });
}
