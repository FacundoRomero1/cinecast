import animeLatinoMap from '../data/animeLatinoMap.json';
import providersData from '../data/providers.json';
import fuegocineSlugsData from '../data/fuegocineSlugs.json';
import latanimeSlugsData from '../data/latanimeSlugs.json';
import { StreamServer } from '../types';

export interface ProviderConfig {
  id: string;
  name: string;
  type?: 'hls' | 'iframe';
  enabled: boolean;
  priority: number;
  languages: string[];
  langHintUnreliable?: boolean;
  urlMovie: string;
  urlTv: string;
  urlTvEpisode?: string;
  requiresReferer?: boolean;
  tlsLax?: boolean;
  notes?: string;
}

export function buildProviderUrl(
  provider: ProviderConfig,
  opts: { tmdbId?: number; type?: string; season?: number; episode?: number }
): string | null {
  if (!provider || provider.enabled !== true) return null;
  const { tmdbId, type = 'movie', season = 1, episode = 1 } = opts;
  if (!tmdbId || tmdbId <= 0) return null;

  let template: string | undefined;
  if (type === 'movie') {
    template = provider.urlMovie;
  } else if (type === 'series' || type === 'anime') {
    if (season !== undefined && episode !== undefined && provider.urlTvEpisode) {
      template = provider.urlTvEpisode;
    } else {
      template = provider.urlTv;
    }
  }

  if (!template || typeof template !== 'string') return null;

  let url = template
    .replace(/\{tmdbId\}/g, String(tmdbId))
    .replace(/\{season\}/g, String(season))
    .replace(/\{episode\}/g, String(episode));

  if (provider.id === 'fuegocine') {
    const hit = (fuegocineSlugsData as any[]).find((s) => s.tmdbId === tmdbId);
    if (hit) {
      url = url.replace(/\{slug\}/g, hit.fuegoSlug).replace(/\{id\}/g, String(hit.fuegoId));
    }
  } else if (provider.id === 'latanime') {
    const hit = (latanimeSlugsData as any[]).find((s) => s.tmdbId === tmdbId);
    if (hit) {
      url = url.replace(/\{slug\}/g, hit.slug);
    }
  }

  if (url.includes('{') || url.includes('}')) {
    return null;
  }

  return url.trim();
}

export function getAudioLangPriority(
  audioLangs?: string[] | null,
  providerLanguages?: string[] | null,
  langHintUnreliable?: boolean
): number {
  // 1. Usa primero audioLangs medido
  if (Array.isArray(audioLangs) && audioLangs.length > 0) {
    const measuredWithoutUnknown = audioLangs
      .map((l) => l.toLowerCase().trim())
      .filter((l) => l && l !== 'desconocido');

    if (measuredWithoutUnknown.length > 0) {
      if (measuredWithoutUnknown.some((l) => l === 'latino' || l === 'spa' || l === 'es-419' || l === 'lat')) {
        return 1;
      }
      if (measuredWithoutUnknown.some((l) => l === 'es' || l === 'castellano' || l === 'es-es' || l === 'esp')) {
        return 2;
      }
      if (measuredWithoutUnknown.some((l) => l === 'multi')) {
        return 3;
      }
      if (measuredWithoutUnknown.some((l) => l === 'en' || l === 'eng' || l === 'original' || l === 'sub')) {
        return 4;
      }
    }
  }

  // Requisito 4: Si langHintUnreliable está activo, la pista no se usa: va al grupo 3
  if (langHintUnreliable === true) {
    return 3;
  }

  // 2. Si está vacío o es 'desconocido', cae al campo languages del proveedor (latino→1, es→2, multi→3, en→4)
  if (Array.isArray(providerLanguages) && providerLanguages.length > 0) {
    const prov = providerLanguages.map((l) => l.toLowerCase().trim());
    if (prov.some((l) => l === 'latino' || l === 'es-419' || l === 'lat')) {
      return 1;
    }
    if (prov.some((l) => l === 'es' || l === 'castellano' || l === 'es-es' || l === 'esp')) {
      return 2;
    }
    if (prov.some((l) => l === 'multi')) {
      return 3;
    }
    if (prov.some((l) => l === 'en' || l === 'eng' || l === 'original' || l === 'sub')) {
      return 4;
    }
  }

  // 3. Solo si tampoco hay pista, grupo 3
  return 3;
}

export function formatAudioLangWithSource(
  audioLangs?: string[] | null,
  providerLanguages?: string[] | null,
  langHintUnreliable?: boolean
): string {
  // 1. Medido
  if (Array.isArray(audioLangs) && audioLangs.length > 0) {
    const measuredWithoutUnknown = audioLangs
      .map((l) => l.toLowerCase().trim())
      .filter((l) => l && l !== 'desconocido');

    if (measuredWithoutUnknown.length > 0) {
      if (measuredWithoutUnknown.some((l) => l === 'latino' || l === 'spa' || l === 'es-419' || l === 'lat')) {
        return 'Latino (medido)';
      }
      if (measuredWithoutUnknown.some((l) => l === 'es' || l === 'castellano' || l === 'es-es' || l === 'esp')) {
        return 'Castellano (medido)';
      }
      if (measuredWithoutUnknown.some((l) => l === 'sub' || l === 'subtitulado')) {
        return 'Subtitulado (medido)';
      }
      if (measuredWithoutUnknown.some((l) => l === 'en' || l === 'eng' || l === 'original')) {
        return 'Inglés (medido)';
      }
      return `${measuredWithoutUnknown[0]} (medido)`;
    }
  }

  // Requisito 4: Si langHintUnreliable está activo, la pista no se usa para etiqueta: muestra "Multi"
  if (langHintUnreliable === true) {
    return 'Multi';
  }

  // 2. Por pista (campo languages del proveedor)
  if (Array.isArray(providerLanguages) && providerLanguages.length > 0) {
    const prov = providerLanguages.map((l) => l.toLowerCase().trim());
    if (prov.some((l) => l === 'latino' || l === 'es-419')) {
      return 'Latino (declarado)';
    }
    if (prov.some((l) => l === 'es' || l === 'castellano' || l === 'es-es')) {
      return 'Castellano (declarado)';
    }
    if (prov.some((l) => l === 'multi')) {
      return 'Multi';
    }
    if (prov.some((l) => l === 'en' || l === 'eng' || l === 'original')) {
      return 'Inglés (declarado)';
    }
  }

  // 3. Sin nada
  return 'Multi';
}

export function formatAudioLangLabel(audioLangs?: string[] | null, providerLanguages?: string[] | null, langHintUnreliable?: boolean): string {
  return formatAudioLangWithSource(audioLangs, providerLanguages, langHintUnreliable);
}

export function rankProvidersByLanguage(providers: ProviderConfig[], _type?: string): ProviderConfig[] {
  const active = providers.filter((p) => p && p.enabled === true);

  return [...active].sort((a, b) => {
    // 1. Prioridad por idioma (latino→1, es→2, multi→3, en→4, sin pista→3)
    const rankA = a.id === 'moviemaster' ? 1 : getAudioLangPriority(undefined, a.languages, a.langHintUnreliable);
    const rankB = b.id === 'moviemaster' ? 1 : getAudioLangPriority(undefined, b.languages, b.langHintUnreliable);
    if (rankA !== rankB) return rankA - rankB;

    // 2. Desempate por prioridad declarada en providers.json
    return (b.priority || 0) - (a.priority || 0);
  });
}

/**
 * Filtro estricto peliculas/series: true solo si el servidor tiene audio Latino (es-419) o Castellano (es/es-ES).
 * Servidores EN / multi / subtitulados / sin pista confiable devuelven false (no se borran los providers, solo no se listan).
 */
export function explainSpanishAudio(s: StreamServer): { ok: boolean; reason: string } {
  if (!s) return { ok: false, reason: 'servidor nulo' };
  const mm = String((s as any).mmLang || '').toLowerCase().trim();
  if (mm) {
    const ok = ['latino', 'lat', 'es-419', 'castellano', 'esp', 'es', 'es-es'].includes(mm);
    return { ok, reason: `mmLang=${mm}` };
  }
  const audio = Array.isArray(s.audioLangs) ? s.audioLangs.map((x) => String(x).toLowerCase().trim()) : [];
  if (audio.some((l) => ['latino', 'lat', 'es-419', 'es-mx', 'es', 'es-es', 'castellano', 'esp', 'spa'].includes(l))) {
    return { ok: true, reason: `audioLangs=${audio.join(',')}` };
  }
  if (audio.some((l) => ['sub', 'subtitulado', 'en', 'eng', 'multi', 'original'].includes(l))) {
    return { ok: false, reason: `audioLangs=${audio.join(',')} (sin latino/es)` };
  }
  const text = `${s.name || ''} ${s.language || ''}`.toLowerCase();
  if (/subtitulad|\bsub\b/.test(text)) return { ok: false, reason: `etiqueta subtitulado: "${text.trim()}"` };
  if (/latino|castellano|espa(ñ|n)ol|spanish|es-419|es-mx|es-es|\blat\b|\besp\b|\bes\b/.test(text)) {
    return { ok: true, reason: `etiqueta es/latino: "${text.trim()}"` };
  }
  if (/multi|ingl|english|original|\ben\b/.test(text)) {
    return { ok: false, reason: `etiqueta multi/EN: "${text.trim()}"` };
  }
  const prov = (providersData as ProviderConfig[]).find(
    (p) => p.id === (s as any).providerId || p.name === s.name
  );
  if (prov) {
    const rank = getAudioLangPriority(undefined, prov.languages, prov.langHintUnreliable);
    return { ok: rank === 1 || rank === 2, reason: `provider ${prov.id} languages=${(prov.languages || []).join(',')} unreliable=${Boolean(prov.langHintUnreliable)} rank=${rank}` };
  }
  // Sin proveedor conocido ni etiqueta de idioma (URL puesta a mano): no se filtra.
  return { ok: true, reason: 'sin pista de idioma ni provider (manual)' };
}

export function isSpanishAudioServer(s: StreamServer): boolean {
  return explainSpanishAudio(s).ok;
}

const loggedFilterSignatures = new Set<string>();

/** Deja solo Latino/Castellano. Log temporal [ServersFilter] con cantidades y motivo de cada descarte. */
export function filterSpanishOnlyServers(servers: StreamServer[], label: string = ''): StreamServer[] {
  const input = servers || [];
  const kept: StreamServer[] = [];
  const dropped: string[] = [];
  for (const s of input) {
    const ex = explainSpanishAudio(s);
    if (ex.ok) kept.push(s);
    else dropped.push(`  - "${s?.name}" [${s?.language || ''}] ${ex.reason}`);
  }
  const sig = `${label}|${input.map((s) => s?.name).join(',')}|${kept.length}`;
  if (!loggedFilterSignatures.has(sig)) {
    loggedFilterSignatures.add(sig);
    console.log(
      `[ServersFilter] ${label} entran=${input.length} quedan=${kept.length} descartados=${dropped.length}` +
        (dropped.length ? '\n' + dropped.join('\n') : '')
    );
  }
  return kept;
}

export interface GenerateServersOptions {
  tmdbId?: number;
  imdbId?: string;
  title?: string;
  type?: 'movie' | 'series' | 'anime' | 'live_tv';
  season?: number;
  episode?: number;
  directMp4Url?: string;
  customServers?: StreamServer[];
  /** El embed de MovieMaster solo se lista si ya se verifico que existe audio Latino/Castellano para el titulo. */
  includeMmEmbed?: boolean;
  /** No generar el placeholder HLS de MovieMaster (cuando ya se sabe que no hay audio Latino/ES). */
  skipMmHls?: boolean;
}

const HEALTH_KEY = 'cinecast_provider_health_v1';
const HEALTH_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas
const PRIMARY_PROVIDER = 'VidLink Pro';

interface ProviderHealthEntry {
  ok: boolean;
  ms: number;
}

function readProviderHealth(): Record<string, ProviderHealthEntry> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(HEALTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > HEALTH_TTL_MS) return null;
    return parsed.providers || null;
  } catch (_) {
    return null;
  }
}

/**
 * Pregunta a Electron qué proveedores embed responden hoy (y en cuántos ms) y lo guarda en caché.
 * Se llama al iniciar la app; en navegador/celular no hace nada.
 */
export async function refreshProviderHealth(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.checkEmbedProviders) return;
    const results = await window.electronAPI.checkEmbedProviders();
    if (!Array.isArray(results) || results.length === 0) return;
    const providers: Record<string, ProviderHealthEntry> = {};
    for (const r of results) providers[r.name] = { ok: r.ok, ms: r.ms };
    window.localStorage.setItem(HEALTH_KEY, JSON.stringify({ timestamp: Date.now(), providers }));
  } catch (e) {
    console.warn('No se pudo verificar proveedores embed:', e);
  }
}

function getServerB8Bucket(s: StreamServer, prov?: ProviderConfig): number {
  const isHls = s.type === 'hls' || (s as any).playable === 'hls' || prov?.type === 'hls';
  const mmLang = String((s as any).mmLang || '').toLowerCase().trim();
  const langLabel = String(s.language || '').toLowerCase().trim();
  const audioList = Array.isArray(s.audioLangs) ? s.audioLangs.map((x) => x.toLowerCase().trim()) : [];

  const isLat =
    mmLang === 'latino' ||
    mmLang === 'lat' ||
    audioList.some((l) => l === 'latino' || l === 'lat' || l === 'es-419' || l === 'spa') ||
    langLabel.includes('latino');
  const isEsp =
    mmLang === 'castellano' ||
    mmLang === 'esp' ||
    audioList.some((l) => l === 'es' || l === 'castellano' || l === 'es-es' || l === 'esp') ||
    langLabel.includes('castellano');
  const isSub =
    mmLang === 'subtitulado' ||
    mmLang === 'sub' ||
    audioList.some((l) => l === 'sub' || l === 'subtitulado') ||
    langLabel.includes('subtitulado');

  if (isHls) {
    if (isLat) return 1;
    if (isEsp) return 2;
    if (isSub) return 3;
    return 4; // cualquier HLS de otro proveedor
  }

  // Embeds van después de cualquier HLS (5..8 según prioridad de idioma)
  const embedLangRank = getAudioLangPriority(s.audioLangs, prov?.languages, prov?.langHintUnreliable);
  return 4 + embedLangRank;
}

/**
 * B8 Ranking: LAT (HLS) -> ESP (HLS) -> SUB (HLS) -> cualquier HLS de otro proveedor -> embeds.
 */
export function applyProviderRanking(servers: StreamServer[], _type?: string): StreamServer[] {
  const health = readProviderHealth();

  return [...servers].sort((a, b) => {
    const provA = (providersData as ProviderConfig[]).find((p) => p.name === a.name || p.id === (a as any).providerId);
    const provB = (providersData as ProviderConfig[]).find((p) => p.name === b.name || p.id === (b as any).providerId);

    const bucketA = getServerB8Bucket(a, provA);
    const bucketB = getServerB8Bucket(b, provB);
    if (bucketA !== bucketB) return bucketA - bucketB;

    // Salud / speedMs si hay disponible en caché de salud
    if (health) {
      const hA = health[a.name];
      const hB = health[b.name];
      const scoreA = hA ? (hA.ok ? 1 + Math.min(hA.ms, 60000) / 100000 : 10) : 5;
      const scoreB = hB ? (hB.ok ? 1 + Math.min(hB.ms, 60000) / 100000 : 10) : 5;
      if (scoreA !== scoreB) return scoreA - scoreB;
    }

    // Prioridad declarada del proveedor
    const prioA = provA?.priority ?? 0;
    const prioB = provB?.priority ?? 0;
    return prioB - prioA;
  });
}

/**
 * Genera servidores de streaming de alta disponibilidad estilo Fuegocine y TuDeporte.
 * Diferencia correctamente entre Películas (/movie/) y Series/Anime (/tv/).
 * Servidores verificados y funcionales en 2024-2025.
 */
export function generateServersForMedia(options: GenerateServersOptions): StreamServer[] {
  const { tmdbId, type = 'movie', season = 1, episode = 1, directMp4Url, customServers } = options;

  // Hook para pruebas: con CINECAST_TEST=1 se puede reemplazar por window.__CINECAST_TEST_SERVERS
  const isTest =
    (typeof window !== 'undefined' && Boolean((window as any).__CINECAST_TEST)) ||
    (typeof process !== 'undefined' && process.env?.CINECAST_TEST === '1');
  if (
    isTest &&
    typeof window !== 'undefined' &&
    Array.isArray((window as any).__CINECAST_TEST_SERVERS)
  ) {
    const templates = (window as any).__CINECAST_TEST_SERVERS as Array<{
      name: string;
      urlTemplate: string;
      language?: string;
    }>;
    return templates.map((t) => ({
      name: t.name,
      url: t.urlTemplate
        .replace('{id}', String(tmdbId || ''))
        .replace('{season}', String(season || 1))
        .replace('{episode}', String(episode || 1)),
      type: (t as any).type || 'iframe',
      language: t.language || 'Prueba',
    }));
  }

  const servers: StreamServer[] = [];

  // 1. Servidores personalizados (máxima prioridad)
  if (customServers && customServers.length > 0) {
    servers.push(...customServers);
  }

  // 2. URL directa MP4/HLS (Archive.org, CDN, IPTV m3u8)
  const isDirectHls = Boolean(directMp4Url && directMp4Url.includes('.m3u8'));
  if (
    directMp4Url &&
    (directMp4Url.includes('.mp4') ||
      directMp4Url.includes('.m3u8') ||
      directMp4Url.includes('archive.org/download') ||
      directMp4Url.includes('commondatastorage') ||
      directMp4Url.includes('zencdn.net'))
  ) {
    servers.push({
      name: isDirectHls ? 'Señal en Vivo (HLS / IPTV)' : 'Reproducción Directa MP4 (HD)',
      url: directMp4Url,
      type: isDirectHls ? 'hls' : 'mp4',
      language: isDirectHls ? 'En Vivo' : 'Audio Original',
    });
  }

  // 3. Generar servidores Embed automáticos a partir de TMDB ID (Espejos múltiples de alta disponibilidad)
  if (tmdbId && tmdbId > 0) {
    const isTV = type === 'series' || type === 'anime';

    // Doblaje Latino para Animes (Jimov API)
    if (type === 'anime') {
      const animeTitle = options.title || '';
      const jimovServer: StreamServer = {
        id: 'jimov-latino',
        name: 'Latino (Jimov)',
        url: `/api/anime/jimov?title=${encodeURIComponent(animeTitle)}&episode=${episode || 1}`,
        type: 'iframe',
        playable: 'iframe',
        language: '🇲🇽 Latino (Jimov)',
        validated: true,
      };
      // Primera opción para animes con doblaje latino
      servers.unshift(jimovServer);
    }

    // Direct HLS se resuelve en segundo plano vía /api/stream/direct y se inserta con su URL .m3u8 real validada
    void isTV;

    // Verificación de mapa de anime con doblaje latino verificado
    let animeLatinoServer: StreamServer | null = null;
    const animeEntry = type === 'anime' ? (animeLatinoMap as Record<string, any>)[String(tmdbId)] : null;
    if (animeEntry?.hasLatino && animeEntry?.verifiedServer) {
      let epUrl = animeEntry.verifiedServer.url;
      if (animeEntry.verifiedServer.episodePattern && episode) {
        epUrl = animeEntry.verifiedServer.episodePattern.replace('{episode}', String(episode));
      }
      animeLatinoServer = {
        name: animeEntry.verifiedServer.name || 'Anime Latino (verificado)',
        url: epUrl,
        type: 'iframe',
        language: '🇲🇽 Latino verificado',
      };
    }

    // Generación dinámica desde providers.json clasificado por preferencia de idioma (getAudioLangPriority: Latino→1, ES→2, Multi→3, EN→4)
    const rankedProviders = rankProvidersByLanguage(providersData as ProviderConfig[], type);
    for (const p of rankedProviders) {
      if (p.id === 'moviemaster' || p.type === 'hls') {
        if (!options.skipMmHls) servers.push({
          id: `mm-direct-${tmdbId}-${season || 1}-${episode || 1}`,
          name: p.name,
          providerId: p.id,
          url: '',
          type: 'hls',
          playable: 'hls',
          language: 'Latino',
          audioLangs: ['latino'],
        } as StreamServer);
        // Fallback real Latino: embed de MovieMaster (lang=LAT). No depende del acuñado HLS.
        const mmEmbedUrl = buildProviderUrl(p, { tmdbId, type, season, episode });
        if (mmEmbedUrl && options.includeMmEmbed) {
          servers.push({
            id: `mm-embed-${tmdbId}-${season || 1}-${episode || 1}`,
            name: 'MovieMaster Embed (Latino)',
            providerId: 'moviemaster-embed',
            url: mmEmbedUrl,
            type: 'iframe',
            playable: 'iframe',
            language: 'Latino',
            audioLangs: ['latino'],
          } as StreamServer);
        }
        continue;
      }

      const url = buildProviderUrl(p, { tmdbId, type, season, episode });
      if (!url) continue;

      const langLabel = formatAudioLangWithSource(undefined, p.languages, p.langHintUnreliable);

      let referrer: string | undefined = undefined;
      if (p.requiresReferer) {
        try {
          referrer = `${new URL(url).origin}/`;
        } catch (_) { }
      }

      servers.push({
        name: p.name,
        providerId: p.id,
        url,
        type: 'iframe',
        language: langLabel,
        referrer,
      });
    }

    // Si tiene servidor Latino verificado, insertarlo justo después de Direct HLS
    if (animeLatinoServer) {
      servers.splice(1, 0, animeLatinoServer);
    }

    // TAREA C: Si type === 'anime', eliminar por completo FrameX (Direct HLS), VidLink Pro, VidSrc, VidFast y agregadores genéricos
    const cleanServers = servers.filter((s) => {
      const lower = (s.name || '').toLowerCase();
      const idLower = String((s as any).id || '').toLowerCase();
      const urlLower = (s.url || '').toLowerCase();

      if (type === 'anime') {
        const isGenericAggregator =
          lower.includes('direct hls') ||
          lower.includes('framex') ||
          lower.includes('vidlink') ||
          lower.includes('vidsrc') ||
          lower.includes('vidfast') ||
          lower.includes('autoembed') ||
          lower.includes('2embed') ||
          lower.includes('multiembed') ||
          idLower.includes('direct-hls') ||
          idLower.includes('vidlink') ||
          idLower.includes('vidsrc') ||
          urlLower.includes('vidlink.pro') ||
          urlLower.includes('vidsrc.me') ||
          urlLower.includes('framextv') ||
          urlLower.includes('cloudwindow-route');
        if (isGenericAggregator) return false;
      }

      return !lower.includes('tukiplay') && !lower.includes('videoapp') && !lower.includes('vimeo') && !lower.includes('streamhg');
    });
    servers.length = 0;
    // Peliculas/series: solo Latino o Castellano (los providers EN/multi siguen en providers.json, pero no se listan).
    // Los servidores manuales (customServers / directMp4Url) no tienen providerId y no se tocan.
    const keepAll = type !== 'movie' && type !== 'series';
    if (keepAll) {
      servers.push(...cleanServers);
    } else {
      const manual = cleanServers.filter((s) => !(s as any).providerId);
      const generatedOnes = cleanServers.filter((s) => (s as any).providerId);
      const keptOnes = filterSpanishOnlyServers(generatedOnes, `generateServersForMedia type=${type} tmdb=${tmdbId}`);
      console.log(`[ServersFilter] generateServersForMedia type=${type} tmdb=${tmdbId} generados=${cleanServers.length} tras_filtro=${manual.length + keptOnes.length}`);
      servers.push(...manual, ...keptOnes);
    }
  }

  // 4. Señal directa embed (live TV, byseraguci, etc.) — se agrega al final, sin desordenar servidores principales
  if (directMp4Url && !servers.some((s) => s.url === directMp4Url)) {
    servers.push({
      name: 'Señal Principal / En Vivo',
      url: directMp4Url,
      type: 'iframe',
      language: 'En Vivo',
    });
  }

  // 5. Fallback absoluto (solo si no se pidió omitir explícitamente porque no hay audio en español)
  if (servers.length === 0 && !options.skipMmHls) {
    servers.push({
      name: 'Servidor Alternativo (HD)',
      url: 'https://vjs.zencdn.net/v/oceans.mp4',
      type: 'mp4',
      language: 'Audio Original',
    });
  }

  // 6. Orden por salud diaria (TukiPlay primero, vivos más rápidos después, caídos al final)
  const ranked = applyProviderRanking(servers, type);
  const ordered = [...ranked];

  // 7. Si el usuario tiene un servidor ganador/preferido en localStorage, ubicarlo al frente
  try {
    if (typeof window !== 'undefined' && window.localStorage && tmdbId) {
      const favKey = `cinecast_fav_server:${type}:${tmdbId}`;
      let raw = window.localStorage.getItem(favKey);
      if (!raw && (type === 'anime' || (type as string) === 'tv')) {
        raw = window.localStorage.getItem(`cinecast_fav_server:series:${tmdbId}`);
      }
      if (raw) {
        let preferredName = '';
        let preferredId: string | number | undefined = undefined;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.name) preferredName = parsed.name;
            if (parsed.id !== undefined) preferredId = parsed.id;
          }
        } catch (_) { }
        if (!preferredName && typeof raw === 'string') {
          preferredName = raw;
        }
        if (preferredName || preferredId !== undefined) {
          const prefIdx = ordered.findIndex((s) => {
            if (preferredId !== undefined && (s as any).id !== undefined) {
              return String((s as any).id) === String(preferredId);
            }
            if (preferredName && s.name) {
              return s.name.toLowerCase() === preferredName.toLowerCase();
            }
            return false;
          });
          if (prefIdx > 0) {
            const [fav] = ordered.splice(prefIdx, 1);
            const isFavHls = fav.type === 'hls' || (fav as any).playable === 'hls';
            const hasHls = ordered.some((s) => s.type === 'hls' || (s as any).playable === 'hls');

            // Requisito 5: usá el favorito solo para reordenar dentro del mismo tipo (hls con hls, iframe con iframe).
            // Si hay HLS disponible y el favorito es iframe, gana el HLS.
            if (!isFavHls && hasHls) {
              const lastHlsIdx = ordered.reduce((acc, s, idx) => (s.type === 'hls' || (s as any).playable === 'hls' ? idx : acc), -1);
              ordered.splice(lastHlsIdx + 1, 0, fav);
            } else {
              ordered.unshift(fav);
            }
          }
        }
      }
    }
  } catch (_) { }

  // 8. Sanitización estricta: ninguna URL con doble punto ni dominios muertos
  const DEAD_DOMAINS = ['vidsrc.pro', 'autoembed.cc', 'smashystream.com', 'embed.su'];
  const sanitized = ordered.filter((s) => {
    if (!s || typeof s.url !== 'string') return false;
    if ((s as any).providerId === 'moviemaster' && s.type === 'hls') return true;
    const u = s.url.trim();
    if (!u || u.includes('..')) return false;
    if (DEAD_DOMAINS.some((d) => u.toLowerCase().includes(d))) return false;
    return true;
  });

  return sanitized.length > 0 ? sanitized : ordered;
}

/**
 * Genera servidores para un episodio específico de serie/anime,
 * actualizando las URLs con la temporada y episodio correctos.
 */
export function generateServersForEpisode(
  tmdbId: number,
  type: 'series' | 'anime',
  season: number,
  episode: number
): StreamServer[] {
  return generateServersForMedia({ tmdbId, type, season, episode });
}

/**
 * Parsea un enlace o código HTML de iframe pegado por el usuario.
 * Extrae la URL limpia del atributo src="..." si viene en formato HTML.
 */
export function extractStreamUrl(input: string): { url: string; type: 'mp4' | 'iframe' | 'hls' } {
  let cleaned = input.trim();

  // Si pegó un <iframe>...</iframe> o similar
  const srcMatch = cleaned.match(/src=["']([^"']+)["']/i);
  if (srcMatch && srcMatch[1]) {
    cleaned = srcMatch[1];
  }

  // Limpiar posibles comillas sueltas
  cleaned = cleaned.replace(/^["']|["']$/g, '');

  const lower = cleaned.toLowerCase();
  const isMp4 =
    lower.includes('.mp4') ||
    lower.includes('archive.org/download') ||
    lower.includes('commondatastorage') ||
    lower.includes('zencdn.net');
  const isHls = lower.includes('.m3u8');
  return { url: cleaned, type: isHls ? 'hls' : isMp4 ? 'mp4' : 'iframe' };
}

/**
 * Extrae la dirección real (host y ruta, sin parámetros de consulta sensibles)
 * y la temporada y episodio que se desprenden de la ruta si los incluye.
 */
export function extractCleanRouteAndEp(rawUrl?: string): {
  hostAndPath: string;
  season?: number;
  episode?: number;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { hostAndPath: '' };
  }
  let host = '';
  let pathname = '';
  try {
    const u = new URL(rawUrl);
    host = u.host;
    pathname = u.pathname;
  } catch (_) {
    const parts = rawUrl.split('?')[0].replace(/^https?:\/\//, '');
    const slashIdx = parts.indexOf('/');
    if (slashIdx >= 0) {
      host = parts.slice(0, slashIdx);
      pathname = parts.slice(slashIdx);
    } else {
      host = parts;
      pathname = '';
    }
  }

  const hostAndPath = `${host}${pathname}`;
  let season: number | undefined;
  let episode: number | undefined;

  // 1. /tv/:id/:season/:episode (e.g. /tv/258348/1/12 o /__test/provider/tv/258348/1/12)
  const mTvSlash = pathname.match(/\/tv\/[^\/]+\/(\d+)\/(\d+)/i);
  if (mTvSlash) {
    season = parseInt(mTvSlash[1], 10);
    episode = parseInt(mTvSlash[2], 10);
  } else {
    // 2. /tv/:id/:season-:episode (e.g. /embed/tv/258348/1-12)
    const mTvDash = pathname.match(/\/tv\/[^\/]+\/(\d+)-(\d+)/i);
    if (mTvDash) {
      season = parseInt(mTvDash[1], 10);
      episode = parseInt(mTvDash[2], 10);
    } else {
      // 3. /season/:s/episode/:e o /s/:s/e/:e
      const mSeasonEp = pathname.match(/(?:season|s)[\/-]?(\d+)[\/-]?(?:episode|ep|e)[\/-]?(\d+)/i);
      if (mSeasonEp) {
        season = parseInt(mSeasonEp[1], 10);
        episode = parseInt(mSeasonEp[2], 10);
      } else {
        // 4. /episodio-(\d+) o /episode-(\d+)
        const mEpOnly = pathname.match(/(?:episodio|episode|ep)[-_]?(\d+)/i);
        if (mEpOnly) {
          season = 1;
          episode = parseInt(mEpOnly[1], 10);
        } else {
          // 5. 1x12
          const mCross = pathname.match(/(?:^|\/)(\d+)[xX](\d+)(?:$|\/)/);
          if (mCross) {
            season = parseInt(mCross[1], 10);
            episode = parseInt(mCross[2], 10);
          }
        }
      }
    }
  }

  return { hostAndPath, season, episode };
}
