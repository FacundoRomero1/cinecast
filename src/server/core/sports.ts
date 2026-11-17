import fs from 'fs';
import path from 'path';

export const SPORTS_M3U_URL = 'https://iptv-org.github.io/iptv/categories/sports.m3u';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

export interface ParsedSportsChannel {
  id: string;
  name: string;
  logo: string;
  streamUrl: string;
  country: string;
  countryName: string;
  countryFlag: string;
  quality: string;
  category: string;
  groupTitle?: string;
}

export interface SportsChannelsPayload {
  updatedAt: string;
  source: string;
  total: number;
  channels: ParsedSportsChannel[];
}

const COUNTRY_MAP: Record<string, { name: string; flag: string }> = {
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
  BR: { name: 'Brasil', flag: '🇧🇷' },
  US: { name: 'Estados Unidos', flag: '🇺🇸' },
  GB: { name: 'Reino Unido', flag: '🇬🇧' },
  IT: { name: 'Italia', flag: '🇮🇹' },
  FR: { name: 'Francia', flag: '🇫🇷' },
  DE: { name: 'Alemania', flag: '🇩🇪' },
  INT: { name: 'Internacional', flag: '🌍' },
};

export function parseSportsM3u(m3uContent: string): ParsedSportsChannel[] {
  const lines = m3uContent.split(/\r?\n/);
  const channels: ParsedSportsChannel[] = [];

  let currentMeta: {
    id: string;
    name: string;
    logo: string;
    groupTitle: string;
    quality: string;
    country: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const idMatch = line.match(/tvg-id="([^"]*)"/i);
      const nameMatch = line.match(/tvg-name="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);

      const commaIdx = line.lastIndexOf(',');
      let rawName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      if (!rawName && nameMatch?.[1]) rawName = nameMatch[1];

      // Extraer calidad si viene en el nombre (ej. "5Plus (1080p)")
      let quality = 'HD';
      const qMatch = rawName.match(/\((\d+p)\)/i);
      if (qMatch?.[1]) {
        quality = qMatch[1];
        rawName = rawName.replace(/\(\d+p\)/i, '').trim();
      }

      // Extraer país del tvg-id (ej. "TyCSports.ar@SD" -> "AR")
      let country = 'INT';
      const tvgId = idMatch?.[1] || '';
      const dotCountryMatch = tvgId.match(/\.([a-z]{2})(?:@|$)/i);
      if (dotCountryMatch?.[1]) {
        country = dotCountryMatch[1].toUpperCase();
      }

      currentMeta = {
        id: tvgId || `ch-${channels.length + 1}`,
        name: rawName || 'Canal Deportivo',
        logo: logoMatch?.[1] || '',
        groupTitle: groupMatch?.[1] || 'Sports',
        quality,
        country,
      };
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (currentMeta) {
        const countryInfo = COUNTRY_MAP[currentMeta.country] || {
          name: currentMeta.country,
          flag: '📺',
        };

        channels.push({
          id: currentMeta.id,
          name: currentMeta.name,
          logo: currentMeta.logo,
          streamUrl: line,
          country: currentMeta.country,
          countryName: countryInfo.name,
          countryFlag: countryInfo.flag,
          quality: currentMeta.quality,
          category: 'Fútbol & Deportes en Vivo',
          groupTitle: currentMeta.groupTitle,
        });
        currentMeta = null;
      }
    }
  }

  return channels;
}

let inMemoryChannelsCache: SportsChannelsPayload | null = null;
let lastCacheTime = 0;

let inMemoryValidatedCache: SportsChannelsPayload | null = null;
let lastValidatedTime = 0;
const VALIDATED_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

export async function validateHlsStream(url: string, timeoutMs = 3000): Promise<boolean> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return false;
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (
      ct.includes('mpegurl') ||
      ct.includes('application/x-mpegurl') ||
      ct.includes('application/vnd.apple.mpegurl') ||
      ct.includes('audio/x-mpegurl') ||
      ct.includes('video/mp2t') ||
      ct.includes('application/octet-stream')
    ) {
      return true;
    }
    const sample = await res.text();
    return sample.includes('#EXTM3U');
  } catch {
    return false;
  }
}

export async function getValidatedSportsChannels(
  basePayload: SportsChannelsPayload,
  cacheDir?: string,
  maxToValidate = 60
): Promise<SportsChannelsPayload> {
  const now = Date.now();
  if (inMemoryValidatedCache && now - lastValidatedTime < VALIDATED_CACHE_TTL_MS) {
    return inMemoryValidatedCache;
  }

  const diskCacheFile = cacheDir ? path.join(cacheDir, 'iptv_sports_validated.json') : null;
  if (diskCacheFile && fs.existsSync(diskCacheFile)) {
    try {
      const stats = fs.statSync(diskCacheFile);
      if (now - stats.mtimeMs < VALIDATED_CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as SportsChannelsPayload;
        if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
          inMemoryValidatedCache = parsed;
          lastValidatedTime = stats.mtimeMs;
          return parsed;
        }
      }
    } catch (_) {}
  }

  const candidates = basePayload.channels.slice(0, maxToValidate);
  const validatedChannels: ParsedSportsChannel[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (ch) => {
        const ok = await validateHlsStream(ch.streamUrl, 3000);
        return ok ? ch : null;
      })
    );
    for (const ch of results) {
      if (ch) validatedChannels.push(ch);
    }
  }

  const payload: SportsChannelsPayload = {
    updatedAt: new Date().toISOString(),
    source: 'iptv-org (sports.m3u - validated)',
    total: validatedChannels.length,
    channels: validatedChannels,
  };

  inMemoryValidatedCache = payload;
  lastValidatedTime = now;

  if (diskCacheFile) {
    try {
      fs.mkdirSync(path.dirname(diskCacheFile), { recursive: true });
      fs.writeFileSync(diskCacheFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {}
  }

  return payload;
}

export async function getOrFetchSportsChannels(
  cacheDir?: string,
  forceRefresh = false,
  validate = false
): Promise<SportsChannelsPayload> {
  const now = Date.now();

  if (!forceRefresh && inMemoryChannelsCache && now - lastCacheTime < CACHE_TTL_MS) {
    if (validate) {
      return await getValidatedSportsChannels(inMemoryChannelsCache, cacheDir);
    }
    return inMemoryChannelsCache;
  }

  const diskCacheFile = cacheDir ? path.join(cacheDir, 'iptv_sports_channels.json') : null;

  // Revisar si existe caché en disco válido
  if (!forceRefresh && diskCacheFile && fs.existsSync(diskCacheFile)) {
    try {
      const stats = fs.statSync(diskCacheFile);
      if (now - stats.mtimeMs < CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as SportsChannelsPayload;
        if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
          inMemoryChannelsCache = parsed;
          lastCacheTime = stats.mtimeMs;
          if (validate) {
            return await getValidatedSportsChannels(parsed, cacheDir);
          }
          return parsed;
        }
      }
    } catch (_) {}
  }

  // Descargar M3U oficial de iptv-org
  try {
    const res = await fetch(SPORTS_M3U_URL, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al descargar ${SPORTS_M3U_URL}`);
    }

    const text = await res.text();
    const channels = parseSportsM3u(text);

    // Priorizar canales hispanos/latinoamericanos al frente (AR, MX, ES, CO, CL, UY, PE, US, INT)
    const priorityCountries = ['AR', 'MX', 'ES', 'CO', 'CL', 'UY', 'PE', 'VE', 'CR', 'EC'];
    channels.sort((a, b) => {
      const idxA = priorityCountries.indexOf(a.country);
      const idxB = priorityCountries.indexOf(b.country);
      if (idxA !== -1 && idxB === -1) return -1;
      if (idxA === -1 && idxB !== -1) return 1;
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.name.localeCompare(b.name);
    });

    const payload: SportsChannelsPayload = {
      updatedAt: new Date().toISOString(),
      source: 'iptv-org (sports.m3u)',
      total: channels.length,
      channels,
    };

    inMemoryChannelsCache = payload;
    lastCacheTime = now;

    if (diskCacheFile) {
      try {
        fs.mkdirSync(path.dirname(diskCacheFile), { recursive: true });
        fs.writeFileSync(diskCacheFile, JSON.stringify(payload, null, 2), 'utf8');
      } catch (_) {}
    }

    if (validate) {
      return await getValidatedSportsChannels(payload, cacheDir);
    }
    return payload;
  } catch (err) {
    if (inMemoryChannelsCache) {
      if (validate) {
        return await getValidatedSportsChannels(inMemoryChannelsCache, cacheDir);
      }
      return inMemoryChannelsCache;
    }
    if (diskCacheFile && fs.existsSync(diskCacheFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as SportsChannelsPayload;
        if (parsed?.channels) {
          if (validate) {
            return await getValidatedSportsChannels(parsed, cacheDir);
          }
          return parsed;
        }
      } catch (_) {}
    }
    throw err;
  }
}

// =========================================================================
// TUDEPORTE.LAT INTEGRATION (AGENDA EN VIVO Y REPETICIONES)
// =========================================================================

export const TUDEPORTE_AGENDA_URL = 'https://tudeporte.lat/proxy-agenda.php';
export const TUDEPORTE_REPLAYS_URL = 'https://tudeporte.lat/repeticiones/recientes.json';

const AGENDA_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos
const REPLAYS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

export interface TudeporteChannel {
  name: string;
  link: string;
  server: string;
  quality?: string;
}

export interface TudeporteLiveMatch {
  id: string;
  title: string;
  competition: string;
  category: string;
  time: string;
  timeLocal: string;
  status: 'en_vivo' | 'pronto' | 'finalizado' | string;
  channels: TudeporteChannel[];
}

export interface TudeporteReplayPart {
  name: string;
  link: string;
}

export interface TudeporteReplay {
  id: string;
  title: string;
  img: string;
  league: string;
  date: string;
  parts: TudeporteReplayPart[];
}

/**
 * Limpia el parámetro link de tudeporte.lat extrayendo únicamente
 * la URL real del reproductor (después de ?iframe=) y decodificándola.
 */
export function extractCleanIframeUrl(rawLink: string): string {
  if (!rawLink || typeof rawLink !== 'string') return '';
  const trimmed = rawLink.trim();
  const iframeIdx = trimmed.indexOf('iframe=');
  if (iframeIdx !== -1) {
    let afterIframe = trimmed.slice(iframeIdx + 7);
    const ampIdx = afterIframe.indexOf('&');
    if (ampIdx !== -1 && !afterIframe.slice(0, ampIdx).includes('?')) {
      afterIframe = afterIframe.slice(0, ampIdx);
    }
    try {
      afterIframe = decodeURIComponent(afterIframe);
    } catch (_) {}
    return afterIframe.trim();
  }
  return trimmed;
}

/**
 * Normaliza los parámetros del stream a nombres legibles de canales deportivos (ej. disney1 -> Disney+)
 */
export function normalizeTudeporteChannelName(cleanUrl: string): { name: string; server: string } {
  try {
    const u = new URL(cleanUrl);
    const param = (u.searchParams.get('stream') || u.searchParams.get('channel') || '').toLowerCase();
    const serverName = u.hostname.replace(/^www\./, '').split('.')[0] || 'stream';

    let name = '';
    if (/^disney\d*$/i.test(param)) name = 'Disney+';
    else if (param === 'espnpremium') name = 'ESPN Premium';
    else if (param === 'espn2ar' || param === 'espnar') name = 'ESPN AR';
    else if (param === 'espn2' || param === 'espn2mx') name = 'ESPN 2';
    else if (param === 'espn3' || param === 'espn3mx') name = 'ESPN 3';
    else if (param === 'espn4') name = 'ESPN 4';
    else if (param === 'espn7') name = 'ESPN 7';
    else if (param === 'espn') name = 'ESPN';
    else if (/^foxsports?premium$/i.test(param)) name = 'Fox Sports Premium';
    else if (/^foxsports?2$/i.test(param)) name = 'Fox Sports 2';
    else if (/^foxsports?3$/i.test(param)) name = 'Fox Sports 3';
    else if (/^foxsports?$/i.test(param) || param === 'foxsportsar') name = 'Fox Sports';
    else if (/^tycsports?$/i.test(param)) name = 'TyC Sports';
    else if (/^tntsports?$/i.test(param)) name = 'TNT Sports';
    else if (/^vix\d*$/i.test(param)) name = 'ViX Premium';
    else if (/^fanatiz\d*$/i.test(param)) name = 'Fanatiz';
    else if (/^dsports\d*$/i.test(param) || /^directv\d*$/i.test(param)) name = 'DSPORTS';
    else if (/^golperu$/i.test(param)) name = 'GOLPERU';
    else if (/^winsports?\+?$/i.test(param)) name = 'Win Sports+';
    else if (param) name = param.toUpperCase();
    else name = serverName.toUpperCase();

    return { name, server: serverName };
  } catch (_) {
    return { name: 'Señal en Vivo', server: 'stream' };
  }
}

/**
 * Convierte el horario original de Colombia (UTC-5) al huso horario local del usuario (UTC-3 en Argentina)
 */
export function convertColombiaTimeToLocal(colombiaTime: string): string {
  try {
    const match = String(colombiaTime || '').match(/(\d{1,2}):(\d{2})/);
    if (!match || !match[1] || !match[2]) return colombiaTime;
    const hCol = parseInt(match[1], 10);
    const mCol = parseInt(match[2], 10);

    const now = new Date();
    const localOffsetMinutes = -now.getTimezoneOffset();
    const colombiaOffsetMinutes = -300; // UTC-5 = -300 min
    const diffMinutes = localOffsetMinutes - colombiaOffsetMinutes;

    let totalMinutes = hCol * 60 + mCol + diffMinutes;
    if (totalMinutes < 0) totalMinutes += 24 * 60;
    else if (totalMinutes >= 24 * 60) totalMinutes %= (24 * 60);

    const hFinal = Math.floor(totalMinutes / 60);
    const mFinal = totalMinutes % 60;
    return `${String(hFinal).padStart(2, '0')}:${String(mFinal).padStart(2, '0')}`;
  } catch (_) {
    return colombiaTime;
  }
}

/**
 * Extrae la URL directa del stream .m3u8 de StreamXHD resolviendo
 * la ofuscación matemática en tiempo de ejecución.
 */
export async function extractStreamXhdM3u8(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://tudeporte.lat/',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[extractStreamXhdM3u8] HLS Extraction failed: HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    console.log('BODY RECIBIDO:', html);

    const arrayMatch = html.match(
      /var playbackURL="",([a-zA-Z0-9_]+)=\[\],[_a-zA-Z0-9="]+;\s*\1=\[([\s\S]*?)\];\s*\1\.sort/
    );
    if (!arrayMatch) {
      console.error('[extractStreamXhdM3u8] HLS Extraction failed: No arrayMatch found');
      return null;
    }

    const arrayContent = arrayMatch[2];
    const fns = [...html.matchAll(/function\s+([a-zA-Z0-9_]+)\(\)\{return\s+(\d+);\}/g)];
    if (fns.length < 2) {
      console.error('[extractStreamXhdM3u8] HLS Extraction failed: Found less than 2 math functions');
      return null;
    }

    const fnVal0 = fns[0]?.[2];
    const fnVal1 = fns[1]?.[2];
    if (!fnVal0 || !fnVal1) {
      console.error('[extractStreamXhdM3u8] HLS Extraction failed: Math function return values missing');
      return null;
    }

    const k = parseInt(fnVal0, 10) + parseInt(fnVal1, 10);
    const arr = JSON.parse('[' + arrayContent + ']');
    arr.sort((a: [number, string], b: [number, string]) => a[0] - b[0]);

    let playbackURL = '';
    arr.forEach((e: [number, string]) => {
      const v = e[1];
      const rawStr =
        typeof Buffer !== 'undefined'
          ? Buffer.from(v, 'base64').toString('utf-8')
          : atob(v);
      playbackURL += String.fromCharCode(
        parseInt(rawStr.replace(/\D/g, ''), 10) - k
      );
    });

    if (playbackURL.startsWith('http') && playbackURL.includes('.m3u8')) {
      return playbackURL.trim();
    }
    console.error('[extractStreamXhdM3u8] HLS Extraction failed: Output is not a valid m3u8 URL:', playbackURL);
    return null;
  } catch (err) {
    console.error('[extractStreamXhdM3u8] HLS Extraction failed:', err);
    return null;
  }
}

let inMemoryTudeporteAgendaCache: TudeporteLiveMatch[] | null = null;
let lastTudeporteAgendaTime = 0;

/**
 * Obtiene la agenda en vivo de tudeporte.lat, limpia los enlaces y agrupa canales por evento
 */
export async function fetchTudeporteAgenda(cacheDir?: string, forceRefresh = false): Promise<TudeporteLiveMatch[]> {
  const now = Date.now();
  if (!forceRefresh && inMemoryTudeporteAgendaCache && now - lastTudeporteAgendaTime < AGENDA_CACHE_TTL_MS) {
    return inMemoryTudeporteAgendaCache;
  }

  const diskCacheFile = cacheDir ? path.join(cacheDir, 'tudeporte_agenda.json') : null;
  if (!forceRefresh && diskCacheFile && fs.existsSync(diskCacheFile)) {
    try {
      const stats = fs.statSync(diskCacheFile);
      if (now - stats.mtimeMs < AGENDA_CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as TudeporteLiveMatch[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          inMemoryTudeporteAgendaCache = parsed;
          lastTudeporteAgendaTime = stats.mtimeMs;
          return parsed;
        }
      }
    } catch (_) {}
  }

  try {
    const res = await fetch(TUDEPORTE_AGENDA_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://tudeporte.lat/',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al obtener agenda de tudeporte`);
    }

    const rawData = await res.json();
    const rawEvents: any[] = Array.isArray(rawData) ? rawData : [];

    // Agrupar eventos por título y hora
    const gruposMap = new Map<string, TudeporteLiveMatch>();

    for (const evt of rawEvents) {
      if (!evt || !evt.title) continue;

      const title = String(evt.title).trim();
      const rawLink = String(evt.link || '');
      const cleanLink = extractCleanIframeUrl(rawLink);
      if (!cleanLink) continue;

      const rawTime = String(evt.time || '00:00').trim();
      const timeLocal = convertColombiaTimeToLocal(rawTime);
      const category = String(evt.category || 'Fútbol & Deportes').trim();
      const status = String(evt.status || 'pronto').trim();

      const { name: chBaseName, server } = normalizeTudeporteChannelName(cleanLink);

      // Clave única de agrupación (título normalizado + hora)
      const groupKey = `${title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${rawTime}`;

      if (!gruposMap.has(groupKey)) {
        gruposMap.set(groupKey, {
          id: `tud_${groupKey}`,
          title,
          competition: category,
          category,
          time: rawTime,
          timeLocal,
          status,
          channels: [],
        });
      }

      const match = gruposMap.get(groupKey)!;
      const count = match.channels.filter((c) => c.name.startsWith(chBaseName)).length;
      const chName = count > 0 ? `${chBaseName} | OPC ${count + 1}` : chBaseName;

      match.channels.push({
        name: chName,
        link: cleanLink,
        server,
        quality: 'HD 720p',
      });
    }

    const matches = Array.from(gruposMap.values());

    // Resolver concurrentemente streams de streamxhd para obtener enlace directo HLS (.m3u8)
    const streamxhdChannels: TudeporteChannel[] = [];
    for (const match of matches) {
      for (const ch of match.channels) {
        if (
          ch.server.toLowerCase().includes('streamxhd') ||
          ch.link.toLowerCase().includes('streamxhd.click')
        ) {
          streamxhdChannels.push(ch);
        }
      }
    }

    if (streamxhdChannels.length > 0) {
      const uniqueUrls = Array.from(new Set(streamxhdChannels.map((c) => c.link)));
      const resolvedMap = new Map<string, string | null>();

      await Promise.all(
        uniqueUrls.map(async (u) => {
          const directM3u8 = await extractStreamXhdM3u8(u, 4000);
          resolvedMap.set(u, directM3u8);
        })
      );

      for (const ch of streamxhdChannels) {
        const directM3u8 = resolvedMap.get(ch.link);
        if (directM3u8) {
          ch.link = directM3u8;
          ch.quality = 'Full HD (HLS Directo)';
        } else {
          ch.link = '';
        }
      }
    }

    inMemoryTudeporteAgendaCache = matches;
    lastTudeporteAgendaTime = now;

    if (diskCacheFile) {
      try {
        fs.mkdirSync(path.dirname(diskCacheFile), { recursive: true });
        fs.writeFileSync(diskCacheFile, JSON.stringify(matches, null, 2), 'utf8');
      } catch (_) {}
    }

    return matches;
  } catch (err) {
    if (inMemoryTudeporteAgendaCache) return inMemoryTudeporteAgendaCache;
    if (diskCacheFile && fs.existsSync(diskCacheFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as TudeporteLiveMatch[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    throw err;
  }
}

let inMemoryTudeporteReplaysCache: TudeporteReplay[] | null = null;
let lastTudeporteReplaysTime = 0;

/**
 * Obtiene repeticiones de partidos recientes de tudeporte.lat (Dailymotion / servidores externos)
 */
export async function fetchTudeporteReplays(cacheDir?: string, forceRefresh = false): Promise<TudeporteReplay[]> {
  const now = Date.now();
  if (!forceRefresh && inMemoryTudeporteReplaysCache && now - lastTudeporteReplaysTime < REPLAYS_CACHE_TTL_MS) {
    return inMemoryTudeporteReplaysCache;
  }

  const diskCacheFile = cacheDir ? path.join(cacheDir, 'tudeporte_replays.json') : null;
  if (!forceRefresh && diskCacheFile && fs.existsSync(diskCacheFile)) {
    try {
      const stats = fs.statSync(diskCacheFile);
      if (now - stats.mtimeMs < REPLAYS_CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as TudeporteReplay[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          inMemoryTudeporteReplaysCache = parsed;
          lastTudeporteReplaysTime = stats.mtimeMs;
          return parsed;
        }
      }
    } catch (_) {}
  }

  try {
    const res = await fetch(TUDEPORTE_REPLAYS_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://tudeporte.lat/repeticiones/',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al obtener repeticiones de tudeporte`);
    }

    const rawData = await res.json();
    const rawReplays: any[] = Array.isArray(rawData) ? rawData : [];

    const replays: TudeporteReplay[] = [];

    for (const item of rawReplays) {
      if (!item || !item.title) continue;

      const rawUrl = String(item.url || '');
      const parts: TudeporteReplayPart[] = [];

      try {
        // url viene estilo "/eventos.html?get=https%3A%2F%2Fgeo.dailymotion...&get2=https%3A%2F%2F..."
        const dummyBase = 'https://tudeporte.lat' + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
        const u = new URL(dummyBase);
        const get1 = u.searchParams.get('get');
        const get2 = u.searchParams.get('get2');

        if (get1) {
          parts.push({
            name: '1er Tiempo',
            link: decodeURIComponent(get1),
          });
        }
        if (get2) {
          parts.push({
            name: '2do Tiempo',
            link: decodeURIComponent(get2),
          });
        }
      } catch (_) {}

      // Si no se pudo parsear get/get2, usar la url directa
      if (parts.length === 0 && rawUrl) {
        parts.push({
          name: 'Ver Partido',
          link: rawUrl.startsWith('http') ? rawUrl : `https://tudeporte.lat${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`,
        });
      }

      replays.push({
        id: String(item.id || `rep_${replays.length + 1}`),
        title: String(item.title).trim(),
        img: String(item.img || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800'),
        league: String(item.league || 'Fútbol'),
        date: String(item.fecha || ''),
        parts,
      });
    }

    inMemoryTudeporteReplaysCache = replays;
    lastTudeporteReplaysTime = now;

    if (diskCacheFile) {
      try {
        fs.mkdirSync(path.dirname(diskCacheFile), { recursive: true });
        fs.writeFileSync(diskCacheFile, JSON.stringify(replays, null, 2), 'utf8');
      } catch (_) {}
    }

    return replays;
  } catch (err) {
    if (inMemoryTudeporteReplaysCache) return inMemoryTudeporteReplaysCache;
    if (diskCacheFile && fs.existsSync(diskCacheFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(diskCacheFile, 'utf8')) as TudeporteReplay[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    throw err;
  }
}

