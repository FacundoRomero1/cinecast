import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';

const requireModule =
  typeof require === 'function'
    ? require
    : createRequire(path.join(process.cwd(), 'package.json'));

const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const UI_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const SERVERS_CACHE_TTL_MS = 4 * 60 * 1000; // 4 min
const SNAPSHOT_TTL_MS = 4 * 60 * 60 * 1000; // 4 h
const SNAPSHOT_MAX_ENTRIES = 40;
const HARVEST_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_MINT_ATTEMPTS = 3;

const UI_DISK_CACHE_PATH = path.join(os.tmpdir(), 'cinecast-mm-ui-cache-v1.json');

export type MovieMasterMediaType = 'movie' | 'tv';
export type NormalizedMmLang = 'latino' | 'castellano' | 'subtitulado';

export interface RawMovieMasterServer {
  name?: string;
  lang?: string;
  site?: string | number;
  detras?: boolean;
  mode?: string;
  type?: string;
  video?: string;
}

export interface NormalizedMovieMasterServer {
  id: string;
  name: string;
  lang: NormalizedMmLang;
  rawLang: string;
  type: 'hls';
  mode: 'direct';
  site: string;
  video: string;
}

export interface SnapshotEntry {
  key: string;
  text: string;
  lang: NormalizedMmLang;
  serverName: string;
  durationSec: number;
  segs: number;
  at: number;
  tmdb: number;
  type: MovieMasterMediaType;
  season: number;
  episode: number;
}

interface UiCacheEntry {
  ui: string;
  at: number;
}

interface ServersCacheEntry {
  servers: NormalizedMovieMasterServer[];
  at: number;
}

const uiCache = new Map<number, UiCacheEntry>();
const uiHarvestMutex = new Map<number, Promise<string | null>>();
const serversCache = new Map<string, ServersCacheEntry>();
const snapshotCache = new Map<string, SnapshotEntry>();

function loadUiDiskCache(): void {
  try {
    if (!fs.existsSync(UI_DISK_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(UI_DISK_CACHE_PATH, 'utf8'));
    const now = Date.now();
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        const tmdb = Number(k);
        const entry = v as UiCacheEntry;
        if (
          Number.isFinite(tmdb) &&
          tmdb > 0 &&
          entry &&
          typeof entry.ui === 'string' &&
          typeof entry.at === 'number' &&
          now - entry.at < UI_TTL_MS
        ) {
          uiCache.set(tmdb, entry);
        }
      }
    }
  } catch (_) {}
}

function saveUiDiskCache(): void {
  try {
    const obj: Record<string, UiCacheEntry> = {};
    const now = Date.now();
    for (const [k, v] of uiCache.entries()) {
      if (now - v.at < UI_TTL_MS) {
        obj[String(k)] = v;
      }
    }
    fs.writeFileSync(UI_DISK_CACHE_PATH, JSON.stringify(obj), 'utf8');
  } catch (_) {}
}

loadUiDiskCache();

export function normalizeMmType(rawType?: string): MovieMasterMediaType {
  const t = String(rawType || 'movie').trim().toLowerCase();
  if (t === 'tv' || t === 'series' || t === 'anime') return 'tv';
  return 'movie';
}

export function mapMmLang(rawLang?: string): NormalizedMmLang {
  const up = String(rawLang || '').trim().toUpperCase();
  if (up === 'LAT' || up === 'LATINO' || up === 'ES-419') return 'latino';
  if (up === 'ESP' || up === 'CASTELLANO' || up === 'ES' || up === 'ES-ES') return 'castellano';
  if (up === 'SUB' || up === 'SUBTITULADO' || up === 'EN' || up === 'ENG') return 'subtitulado';
  return 'latino';
}

export function getMmLangRank(lang: NormalizedMmLang): number {
  if (lang === 'latino') return 1;
  if (lang === 'castellano') return 2;
  return 3;
}

function buildEmbedUrl(tmdb: number, type: MovieMasterMediaType, season = 1, episode = 1): string {
  if (type === 'movie') {
    return `https://api.moviemaster.lat/e/movie/${tmdb}?lang=LAT&autoplay=1`;
  }
  return `https://api.moviemaster.lat/e/tv/${tmdb}/${season}/${episode}?lang=LAT&autoplay=1`;
}

async function harvestUiViaElectron(embedUrl: string, tmdb: number): Promise<string | null> {
  const electron = requireModule('electron');
  const { BrowserWindow, session } = electron;
  const partition = `mm-harvest-${tmdb}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ses = session.fromPartition(partition, { cache: false });
  let win: any = null;

  try {
    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (val: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };

      const timer = setTimeout(() => {
        finish(null);
      }, HARVEST_TIMEOUT_MS);

      ses.webRequest.onBeforeRequest(
        { urls: ['*://*/*'] },
        (details: { url?: string; resourceType?: string }, cb: (resp: { cancel: boolean }) => void) => {
          const rt = details.resourceType || '';
          const u = details.url || '';
          if (
            rt === 'image' ||
            rt === 'font' ||
            rt === 'stylesheet' ||
            rt === 'media' ||
            u.includes('quickcore.fun') ||
            u.includes('googletagmanager') ||
            u.includes('google-analytics')
          ) {
            cb({ cancel: true });
            return;
          }
          cb({ cancel: false });
        }
      );

      ses.webRequest.onCompleted(
        { urls: ['*://api.moviemaster.lat/servers*'] },
        (details: { url?: string }) => {
          try {
            if (!details?.url) return;
            const u = new URL(details.url);
            const ui = u.searchParams.get('ui');
            if (ui && ui.trim()) {
              finish(ui.trim());
            }
          } catch (_) {}
        }
      );

      win = new BrowserWindow({
        show: false,
        width: 800,
        height: 450,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          autoplayPolicy: 'no-user-gesture-required',
          backgroundThrottling: false,
        },
      });

      win.webContents.setUserAgent(REAL_UA);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      win
        .loadURL('about:blank')
        .then(async () => {
          if (settled || !win || win.isDestroyed()) return;
          const safeUrl = JSON.stringify(embedUrl);
          await win.webContents.executeJavaScript(
            `(() => {
              const f = document.createElement('iframe');
              f.src = ${safeUrl};
              f.width = '800';
              f.height = '450';
              document.body.appendChild(f);
            })()`,
            false
          );
        })
        .catch(() => {
          finish(null);
        });
    });
  } finally {
    try {
      ses.webRequest.onBeforeRequest(null);
      ses.webRequest.onCompleted(null);
    } catch (_) {}
    try {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    } catch (_) {}
  }
}

let sharedPlaywrightBrowserPromise: Promise<any> | null = null;

async function getSharedPlaywrightBrowser(): Promise<any> {
  if (!sharedPlaywrightBrowserPromise) {
    sharedPlaywrightBrowserPromise = (async () => {
      const { chromium } = requireModule('playwright');
      try {
        return await chromium.launch({ headless: true, channel: 'chrome' });
      } catch {
        try {
          return await chromium.launch({ headless: true, channel: 'msedge' });
        } catch {
          return await chromium.launch({ headless: true });
        }
      }
    })();
  }
  return sharedPlaywrightBrowserPromise;
}

async function harvestUiViaPlaywright(embedUrl: string): Promise<string | null> {
  let ctx: any = null;
  try {
    const browser = await getSharedPlaywrightBrowser();
    ctx = await browser.newContext({ userAgent: REAL_UA });
    const page = await ctx.newPage();

    await page.route('**/*', (route: any) => {
      const req = route.request();
      const rt = req.resourceType();
      const u = req.url();
      if (
        rt === 'image' ||
        rt === 'font' ||
        rt === 'stylesheet' ||
        rt === 'media' ||
        u.includes('quickcore.fun') ||
        u.includes('googletagmanager') ||
        u.includes('google-analytics')
      ) {
        return route.abort();
      }
      return route.continue();
    });

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (val: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };

      const timer = setTimeout(() => {
        finish(null);
      }, HARVEST_TIMEOUT_MS);

      const checkUrl = (rawUrl: string) => {
        if (!rawUrl || !rawUrl.includes('api.moviemaster.lat/servers')) return;
        try {
          const u = new URL(rawUrl);
          const ui = u.searchParams.get('ui');
          if (ui && ui.trim()) {
            finish(ui.trim());
          }
        } catch (_) {}
      };

      page.on('request', (req: any) => checkUrl(req.url()));
      page.on('response', (res: any) => checkUrl(res.url()));

      page
        .setContent(`<iframe src="${embedUrl}" width="800" height="450"></iframe>`)
        .catch(() => finish(null));
    });
  } catch (err: any) {
    console.warn(`[MM] Error cosechando ui via Playwright:`, err?.message || err);
    return null;
  } finally {
    try {
      if (ctx) await ctx.close();
    } catch (_) {}
  }
}

export interface HarvestUiOptions {
  type?: MovieMasterMediaType;
  season?: number;
  episode?: number;
  forceRefresh?: boolean;
}

/**
 * harvestUi(tmdb): ventana oculta, webRequest.onCompleted sobre /servers?, extrae ui.
 * Caché Map<tmdb, {ui, at}> TTL 6 h, mutex por tmdb, ventana destruida siempre.
 */
export async function harvestUi(tmdb: number, opts: HarvestUiOptions = {}): Promise<string | null> {
  const cleanTmdb = Math.floor(Number(tmdb));
  if (!Number.isFinite(cleanTmdb) || cleanTmdb <= 0) return null;

  if (!opts.forceRefresh) {
    const cached = uiCache.get(cleanTmdb);
    if (cached && Date.now() - cached.at < UI_TTL_MS) {
      return cached.ui;
    }
  } else {
    uiCache.delete(cleanTmdb);
    saveUiDiskCache();
  }

  const existing = uiHarvestMutex.get(cleanTmdb);
  if (existing) {
    return existing;
  }

  const type = opts.type || 'tv';
  const season = opts.season || 1;
  const episode = opts.episode || 1;

  const task = (async () => {
    const isElectron = Boolean(process.versions && process.versions.electron);
    const primaryUrl = buildEmbedUrl(cleanTmdb, type, season, episode);

    let ui = isElectron
      ? await harvestUiViaElectron(primaryUrl, cleanTmdb)
      : await harvestUiViaPlaywright(primaryUrl);

    if (!ui && !opts.type) {
      const altType: MovieMasterMediaType = type === 'tv' ? 'movie' : 'tv';
      const altUrl = buildEmbedUrl(cleanTmdb, altType, season, episode);
      ui = isElectron
        ? await harvestUiViaElectron(altUrl, cleanTmdb)
        : await harvestUiViaPlaywright(altUrl);
    }

    if (ui) {
      uiCache.set(cleanTmdb, { ui, at: Date.now() });
      saveUiDiskCache();
    }
    return ui;
  })();

  uiHarvestMutex.set(cleanTmdb, task);
  try {
    return await task;
  } finally {
    uiHarvestMutex.delete(cleanTmdb);
  }
}

async function fetchServersWithUi(
  tmdb: number,
  type: MovieMasterMediaType,
  s: number,
  e: number,
  ui: string
): Promise<{ status: number; body: any }> {
  const qs =
    type === 'movie'
      ? `tmdb=${tmdb}&type=movie&ui=${encodeURIComponent(ui)}`
      : `tmdb=${tmdb}&type=tv&season=${s}&episode=${e}&ui=${encodeURIComponent(ui)}`;
  const url = `https://api.moviemaster.lat/servers?${qs}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': REAL_UA,
      Accept: '*/*',
      Referer: 'https://api.moviemaster.lat/',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

/**
 * getServers(tmdb, type, s, e): caché de lista 4 min, clave tmdb|type|s|e.
 * servers.length === 0 -> indisponible.
 * En 403 con body.error === 'pass_scope' o 'no permitido' -> invalidar y re-cosechar una sola vez.
 */
export async function getServers(
  tmdb: number,
  rawType: string = 'tv',
  season: number = 1,
  episode: number = 1,
  opts: { forceRefresh?: boolean } = {}
): Promise<NormalizedMovieMasterServer[]> {
  const cleanTmdb = Math.floor(Number(tmdb));
  if (!Number.isFinite(cleanTmdb) || cleanTmdb <= 0) return [];

  const type = normalizeMmType(rawType);
  const s = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(season) || 1));
  const e = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(episode) || 1));
  const cacheKey = `${cleanTmdb}|${type}|${s}|${e}`;

  if (!opts.forceRefresh) {
    const cached = serversCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SERVERS_CACHE_TTL_MS) {
      return cached.servers;
    }
  } else {
    serversCache.delete(cacheKey);
  }

  let ui = await harvestUi(cleanTmdb, {
    type,
    season: s || 1,
    episode: e || 1,
    forceRefresh: false,
  });
  if (!ui) return [];

  let resp = await fetchServersWithUi(cleanTmdb, type, s || 1, e || 1, ui);

  if (
    resp.status === 403 &&
    (resp.body?.error === 'pass_scope' ||
      resp.body?.error === 'no permitido' ||
      typeof resp.body?.error === 'string')
  ) {
    uiCache.delete(cleanTmdb);
    saveUiDiskCache();
    ui = await harvestUi(cleanTmdb, {
      type,
      season: s || 1,
      episode: e || 1,
      forceRefresh: true,
    });
    if (!ui) return [];
    resp = await fetchServersWithUi(cleanTmdb, type, s || 1, e || 1, ui);
  }

  if (resp.status !== 200 || !Array.isArray(resp.body?.servers) || resp.body.servers.length === 0) {
    serversCache.set(cacheKey, { servers: [], at: Date.now() });
    return [];
  }

  const rawServers: RawMovieMasterServer[] = resp.body.servers;
  const normalized: NormalizedMovieMasterServer[] = [];

  for (let i = 0; i < rawServers.length; i++) {
    const r = rawServers[i];
    if (!r || typeof r.video !== 'string' || !r.video.trim()) continue;
    const lang = mapMmLang(r.lang);
    const name = String(r.name || `Servidor ${i + 1}`).trim();
    const site = String(r.site ?? i + 1);
    normalized.push({
      id: `mm-${cleanTmdb}-${type}-${s}-${e}-${i + 1}-${site}`,
      name,
      lang,
      rawLang: String(r.lang || 'LAT').toUpperCase(),
      type: 'hls',
      mode: 'direct',
      site,
      video: r.video.trim(),
    });
  }

  // Ordenar por cadena de idioma LAT -> ESP -> SUB preservando el orden relativo de cada idioma
  normalized.sort((a, b) => getMmLangRank(a.lang) - getMmLangRank(b.lang));

  serversCache.set(cacheKey, { servers: normalized, at: Date.now() });
  return normalized;
}

export function buildSnapshotKey(
  tmdb: number,
  type: MovieMasterMediaType,
  s: number,
  e: number,
  srvName: string
): string {
  return crypto
    .createHash('sha1')
    .update(`${tmdb}|${type}|${s}|${e}|${srvName}`)
    .digest('hex');
}

function putSnapshotLru(entry: SnapshotEntry): void {
  if (snapshotCache.has(entry.key)) {
    snapshotCache.delete(entry.key);
  }
  snapshotCache.set(entry.key, entry);
  while (snapshotCache.size > SNAPSHOT_MAX_ENTRIES) {
    const oldestKey = snapshotCache.keys().next().value;
    if (!oldestKey) break;
    snapshotCache.delete(oldestKey);
  }
}

export function getSnapshotByKey(key: string): SnapshotEntry | null {
  if (!key || !/^[a-f0-9]{40}$/i.test(key)) return null;
  const cleanKey = key.toLowerCase();
  const entry = snapshotCache.get(cleanKey);
  if (!entry) return null;
  if (Date.now() - entry.at > SNAPSHOT_TTL_MS) {
    snapshotCache.delete(cleanKey);
    return null;
  }
  snapshotCache.delete(cleanKey);
  snapshotCache.set(cleanKey, entry);
  return entry;
}

export function expireSnapshotByKey(key: string): boolean {
  if (!key) return false;
  const cleanKey = key.replace(/\.m3u8$/i, '').toLowerCase();
  return snapshotCache.delete(cleanKey);
}

function findCachedSnapshotForTitle(
  tmdb: number,
  type: MovieMasterMediaType,
  s: number,
  e: number,
  preferredServerName?: string,
  preferredLang?: NormalizedMmLang
): SnapshotEntry | null {
  const now = Date.now();
  for (const [k, entry] of snapshotCache.entries()) {
    if (now - entry.at > SNAPSHOT_TTL_MS) {
      snapshotCache.delete(k);
      continue;
    }
    if (entry.tmdb === tmdb && entry.type === type && entry.season === s && entry.episode === e) {
      if (preferredServerName && entry.serverName.toLowerCase() !== preferredServerName.toLowerCase()) {
        continue;
      }
      if (preferredLang && entry.lang !== preferredLang) {
        continue;
      }
      snapshotCache.delete(k);
      snapshotCache.set(k, entry);
      return entry;
    }
  }
  return null;
}

async function fetchValidM3u8(
  url: string,
  userAgent?: string,
  acceptLanguage?: string
): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false; reason: string }> {
  try {
    const cleanUa = userAgent ? userAgent.replace('HeadlessChrome/', 'Chrome/') : REAL_UA;
    const headers: Record<string, string> = {
      'User-Agent': cleanUa,
      Accept: '*/*',
      Referer: 'https://api.moviemaster.lat/',
    };
    if (acceptLanguage) {
      headers['Accept-Language'] = acceptLanguage;
    }
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    const trimmed = text.trimStart();

    if (res.status !== 200) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    if (trimmed.startsWith('<')) {
      return { ok: false, reason: 'HTML payload (<)' };
    }
    if (!ct.includes('mpegurl') && !ct.includes('m3u')) {
      return { ok: false, reason: `Invalid content-type (${ct})` };
    }
    if (!trimmed.startsWith('#EXTM3U')) {
      return { ok: false, reason: 'Missing #EXTM3U header' };
    }
    return { ok: true, text, finalUrl: res.url || url };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'fetch error' };
  }
}

function extractFirstVariantUrl(masterText: string, masterFinalUrl: string): string | null {
  const lines = masterText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith('#')) {
          try {
            return new URL(lines[j], masterFinalUrl).toString();
          } catch {
            return lines[j];
          }
        }
      }
    }
  }
  return null;
}

function normalizeAndMeasureVariantM3u8(
  rawText: string,
  variantFinalUrl: string
): { text: string; durationSec: number; segs: number } {
  const rawLines = rawText.split(/\r?\n/);
  const outLines: string[] = [];
  let hasMediaSequence = false;
  let hasEndlist = false;
  let totalDur = 0;
  let segs = 0;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      outLines.push('#EXT-X-MEDIA-SEQUENCE:0');
      hasMediaSequence = true;
      continue;
    }

    if (line === '#EXT-X-ENDLIST') {
      hasEndlist = true;
      outLines.push('#EXT-X-ENDLIST');
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const durVal = parseFloat(line.slice(8).split(',')[0]);
      if (Number.isFinite(durVal) && durVal > 0) {
        totalDur += durVal;
      }
      outLines.push(line);
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-MAP:')) {
      const rewritten = line.replace(/URI="([^"]+)"/i, (_m, uri) => {
        try {
          return `URI="${new URL(uri, variantFinalUrl).toString()}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      outLines.push(rewritten);
      continue;
    }

    if (!line.startsWith('#')) {
      segs += 1;
      try {
        outLines.push(new URL(line, variantFinalUrl).toString());
      } catch {
        outLines.push(line);
      }
      continue;
    }

    outLines.push(line);
  }

  if (!hasMediaSequence) {
    const insertIdx = outLines[0]?.startsWith('#EXTM3U') ? 1 : 0;
    outLines.splice(insertIdx, 0, '#EXT-X-MEDIA-SEQUENCE:0');
  }

  if (!hasEndlist) {
    outLines.push('#EXT-X-ENDLIST');
  }

  return {
    text: outLines.join('\n') + '\n',
    durationSec: Math.round(totalDur),
    segs,
  };
}

export interface MintSnapshotOptions {
  serverName?: string;
  lang?: NormalizedMmLang;
  forceRefresh?: boolean;
  simulateFirstServer502?: boolean;
  userAgent?: string;
  acceptLanguage?: string;
}

/**
 * mintSnapshot(tmdb, type, s, e): cadena de idioma LAT -> ESP -> SUB.
 * Por cada servidor: GET video, exigir 200, content-type con mpegurl y body que empiece con #EXTM3U
 * (si empieza con <, es el 502 del servidor 3 y se descarta).
 * Seguir el primer #EXT-X-STREAM-INF a la variante, exigir lo mismo.
 * Máximo 3 intentos por título.
 * Devuelve { key, text, lang, serverName, durationSec, segs } con durationSec = suma de los #EXTINF.
 */
export async function mintSnapshot(
  tmdb: number,
  rawType: string = 'tv',
  season: number = 1,
  episode: number = 1,
  opts: MintSnapshotOptions = {}
): Promise<SnapshotEntry | null> {
  const cleanTmdb = Math.floor(Number(tmdb));
  if (!Number.isFinite(cleanTmdb) || cleanTmdb <= 0) return null;

  const type = normalizeMmType(rawType);
  const s = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(season) || 1));
  const e = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(episode) || 1));

  if (!opts.forceRefresh && !opts.simulateFirstServer502) {
    const existing = findCachedSnapshotForTitle(cleanTmdb, type, s, e, opts.serverName, opts.lang);
    if (existing) {
      console.log(
        `[MM] lang=${existing.lang} srv=${existing.serverName} segs=${existing.segs} dur=${existing.durationSec}`
      );
      return existing;
    }
  }

  let servers = await getServers(cleanTmdb, type, s || 1, e || 1, {
    forceRefresh: opts.forceRefresh,
  });
  if (servers.length === 0) {
    return null;
  }

  const candidates = [...servers].sort((a, b) => {
    if (opts.serverName) {
      const aMatch = a.name.toLowerCase() === opts.serverName.toLowerCase() ? 0 : 1;
      const bMatch = b.name.toLowerCase() === opts.serverName.toLowerCase() ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    if (opts.lang) {
      const aLangMatch = a.lang === opts.lang ? 0 : 1;
      const bLangMatch = b.lang === opts.lang ? 0 : 1;
      if (aLangMatch !== bLangMatch) return aLangMatch - bLangMatch;
    }
    return getMmLangRank(a.lang) - getMmLangRank(b.lang);
  });

  const maxAttempts = Math.min(MAX_MINT_ATTEMPTS, candidates.length);
  let refreshedListOn410 = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const srv = candidates[attempt];

    if (opts.simulateFirstServer502 && attempt === 0) {
      console.warn(
        `[MM] Intento ${attempt + 1}/${maxAttempts} descartado en "${srv.name}" (${srv.lang}): HTTP 502 HTML payload (<) [simulated]`
      );
      continue;
    }

    let masterRes = await fetchValidM3u8(srv.video, opts.userAgent, opts.acceptLanguage);

    if (!masterRes.ok && masterRes.reason.includes('410') && !refreshedListOn410) {
      refreshedListOn410 = true;
      servers = await getServers(cleanTmdb, type, s || 1, e || 1, { forceRefresh: true });
      const refreshedMatch =
        servers.find((x) => x.name === srv.name && x.lang === srv.lang) || servers[attempt];
      if (refreshedMatch) {
        masterRes = await fetchValidM3u8(refreshedMatch.video, opts.userAgent, opts.acceptLanguage);
      }
    }

    if (!masterRes.ok) {
      console.warn(
        `[MM] Intento ${attempt + 1}/${maxAttempts} descartado en master "${srv.name}" (${srv.lang}): ${masterRes.reason}`
      );
      continue;
    }

    const variantUrl = extractFirstVariantUrl(masterRes.text, masterRes.finalUrl);
    let variantText = masterRes.text;
    let variantFinalUrl = masterRes.finalUrl;

    if (variantUrl) {
      const varRes = await fetchValidM3u8(variantUrl, opts.userAgent, opts.acceptLanguage);
      if (!varRes.ok) {
        console.warn(
          `[MM] Intento ${attempt + 1}/${maxAttempts} descartado en variante "${srv.name}" (${srv.lang}): ${varRes.reason}`
        );
        continue;
      }
      variantText = varRes.text;
      variantFinalUrl = varRes.finalUrl;
    }

    const normalized = normalizeAndMeasureVariantM3u8(variantText, variantFinalUrl);
    if (normalized.segs === 0 || normalized.durationSec <= 0) {
      console.warn(
        `[MM] Intento ${attempt + 1}/${maxAttempts} descartado en "${srv.name}" (${srv.lang}): 0 segmentos`
      );
      continue;
    }

    const key = buildSnapshotKey(cleanTmdb, type, s, e, srv.name);
    const entry: SnapshotEntry = {
      key,
      text: normalized.text,
      lang: srv.lang,
      serverName: srv.name,
      durationSec: normalized.durationSec,
      segs: normalized.segs,
      at: Date.now(),
      tmdb: cleanTmdb,
      type,
      season: s,
      episode: e,
    };

    putSnapshotLru(entry);
    console.log(
      `[MM] lang=${entry.lang} srv=${entry.serverName} segs=${entry.segs} dur=${entry.durationSec}`
    );
    return entry;
  }

  return null;
}

export function createMovieMasterRouter(): Router {
  const router = Router();

  // GET /api/mm/servers?tmdb=1396&type=tv&season=1&episode=1
  router.get('/mm/servers', async (req: Request, res: Response) => {
    try {
      const tmdb = Number(req.query.tmdb || req.query.tmdbId);
      if (!Number.isFinite(tmdb) || tmdb <= 0) {
        res.status(400).json({ error: 'tmdb válido es obligatorio' });
        return;
      }
      const rawType = String(req.query.type || 'tv');
      const season = Number(req.query.season || req.query.s || 1);
      const episode = Number(req.query.episode || req.query.e || 1);
      const forceRefresh = req.query.refresh === '1' || req.query.forceRefresh === '1';

      const servers = await getServers(tmdb, rawType, season, episode, { forceRefresh });
      res.json({
        tmdb: Math.floor(tmdb),
        type: normalizeMmType(rawType),
        season: normalizeMmType(rawType) === 'movie' ? 0 : Math.max(1, Math.floor(season || 1)),
        episode: normalizeMmType(rawType) === 'movie' ? 0 : Math.max(1, Math.floor(episode || 1)),
        servers: servers.map((s) => ({
          id: s.id,
          name: s.name,
          lang: s.lang,
          type: 'hls' as const,
          mode: 'direct' as const,
          site: s.site,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error en /api/mm/servers' });
    }
  });

  // POST /api/mm/play -> { manifestUrl, lang, serverName, durationSec, segs, servers }
  router.post('/mm/play', async (req: Request, res: Response) => {
    try {
      const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
      const tmdb = Number(b.tmdb ?? b.tmdbId ?? req.query.tmdb ?? req.query.tmdbId);
      if (!Number.isFinite(tmdb) || tmdb <= 0) {
        res.status(400).json({ error: 'tmdb válido es obligatorio' });
        return;
      }
      const rawType = String(b.type ?? req.query.type ?? 'tv');
      const season = Number(b.season ?? b.s ?? req.query.season ?? req.query.s ?? 1);
      const episode = Number(b.episode ?? b.e ?? req.query.episode ?? req.query.e ?? 1);
      const serverName =
        typeof b.serverName === 'string' && b.serverName.trim() ? b.serverName.trim() : undefined;
      const lang =
        typeof b.lang === 'string' && b.lang.trim() ? mapMmLang(b.lang.trim()) : undefined;
      const forceRefresh = Boolean(b.forceRefresh || b.remint);
      const simulateFirstServer502 = Boolean(b.simulateFirstServer502);

      const reqUserAgent =
        typeof req.headers['user-agent'] === 'string' && req.headers['user-agent'].trim()
          ? req.headers['user-agent'].trim()
          : undefined;
      const reqAcceptLanguage =
        typeof req.headers['accept-language'] === 'string' && req.headers['accept-language'].trim()
          ? req.headers['accept-language'].trim()
          : undefined;

      const snap = await mintSnapshot(tmdb, rawType, season, episode, {
        serverName,
        lang,
        forceRefresh,
        simulateFirstServer502,
        userAgent: reqUserAgent,
        acceptLanguage: reqAcceptLanguage,
      });

      if (!snap) {
        res.status(404).json({ error: 'indisponible' });
        return;
      }

      const cachedList = await getServers(tmdb, rawType, season, episode);

      res.json({
        manifestUrl: `/api/mm/manifest/${snap.key}`,
        lang: snap.lang,
        serverName: snap.serverName,
        durationSec: snap.durationSec,
        segs: snap.segs,
        servers: cachedList.map((s) => ({
          id: s.id,
          name: s.name,
          lang: s.lang,
          type: 'hls' as const,
          mode: 'direct' as const,
          site: s.site,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error en /api/mm/play' });
    }
  });

  // GET /api/mm/manifest/:key
  router.get('/mm/manifest/:key', (req: Request, res: Response) => {
    const rawKey = String(req.params.key || '').replace(/\.m3u8$/i, '').trim();
    const snap = getSnapshotByKey(rawKey);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (!snap) {
      res.status(410).json({ error: 'snapshot inexistente o caducado' });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.status(200).send(snap.text);
  });

  // Endpoint auxiliar para pruebas de expiración de snapshot (G8-4)
  router.post('/mm/expire/:key', (req: Request, res: Response) => {
    const rawKey = String(req.params.key || '').replace(/\.m3u8$/i, '').trim();
    const removed = expireSnapshotByKey(rawKey);
    res.json({ ok: true, removed });
  });

  return router;
}
