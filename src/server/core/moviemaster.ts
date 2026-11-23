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
const SERVERS_CACHE_TTL_MS = 4 * 60 * 1000; // 4 min (lista positiva)
const NEGATIVE_SERVERS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h (servers: [])
const DEADLINE_COOLDOWN_TTL_MS = 10 * 60 * 1000; // 10 min tras deadline vencido
const SNAPSHOT_TTL_MS = 4 * 60 * 60 * 1000; // 4 h
const SNAPSHOT_MAX_ENTRIES = 40;
const HARVEST_TIMEOUT_MS = 6_000; // Deadline duro cosecha: 6 s
const MINT_DEADLINE_MS = 3_000; // Deadline duro mint: 3 s
const SERVERS_FETCH_TIMEOUT_MS = 4_000;
const MAX_MINT_ATTEMPTS = 3;

const UI_DISK_CACHE_PATH = path.join(os.tmpdir(), 'cinecast-mm-ui-cache-v1.json');
const NEG_DISK_CACHE_PATH = path.join(os.tmpdir(), 'cinecast-mm-neg-cache-v1.json');

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
  uaHash: string;
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
  negative?: boolean;
}

const uiCache = new Map<number, UiCacheEntry>();
const uiHarvestMutex = new Map<number, Promise<string | null>>();
const serversCache = new Map<string, ServersCacheEntry>();
const negativeServersCache = new Map<string, number>(); // cacheKey -> timestamp (TTL 24h)
const deadlineCooldownCache = new Map<string, number>(); // cacheKey -> expiresAt (TTL 10m)
const snapshotCache = new Map<string, SnapshotEntry>();

function loadDiskCaches(): void {
  const now = Date.now();
  try {
    if (fs.existsSync(UI_DISK_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(UI_DISK_CACHE_PATH, 'utf8'));
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
    }
  } catch (_) {}

  try {
    if (fs.existsSync(NEG_DISK_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(NEG_DISK_CACHE_PATH, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          const at = Number(v);
          if (k && Number.isFinite(at) && now - at < NEGATIVE_SERVERS_TTL_MS) {
            negativeServersCache.set(k, at);
          }
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

function saveNegDiskCache(): void {
  try {
    const obj: Record<string, number> = {};
    const now = Date.now();
    for (const [k, at] of negativeServersCache.entries()) {
      if (now - at < NEGATIVE_SERVERS_TTL_MS) {
        obj[k] = at;
      }
    }
    fs.writeFileSync(NEG_DISK_CACHE_PATH, JSON.stringify(obj), 'utf8');
  } catch (_) {}
}

loadDiskCaches();

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

export function buildUaHash(userAgent?: string, acceptLanguage?: string): string {
  const cleanUa = (userAgent ? userAgent.replace('HeadlessChrome/', 'Chrome/') : REAL_UA).trim();
  const cleanLang = String(acceptLanguage || '').trim();
  return crypto
    .createHash('sha1')
    .update(`${cleanUa}|${cleanLang}`)
    .digest('hex');
}

export function buildSnapshotKey(
  tmdb: number,
  type: MovieMasterMediaType,
  s: number,
  e: number,
  srvName: string,
  uaHash: string
): string {
  return crypto
    .createHash('sha1')
    .update(`${tmdb}|${type}|${s}|${e}|${srvName}|${uaHash}`)
    .digest('hex');
}

function isUnderDeadlineCooldown(cacheKey: string): boolean {
  const expiresAt = deadlineCooldownCache.get(cacheKey);
  if (!expiresAt) return false;
  if (Date.now() >= expiresAt) {
    deadlineCooldownCache.delete(cacheKey);
    return false;
  }
  return true;
}

function markDeadlineCooldown(cacheKey: string): void {
  deadlineCooldownCache.set(cacheKey, Date.now() + DEADLINE_COOLDOWN_TTL_MS);
}

function isNegativelyCached(cacheKey: string): boolean {
  const at = negativeServersCache.get(cacheKey);
  if (!at) return false;
  if (Date.now() - at >= NEGATIVE_SERVERS_TTL_MS) {
    negativeServersCache.delete(cacheKey);
    return false;
  }
  return true;
}

function markNegativelyCached(cacheKey: string): void {
  negativeServersCache.set(cacheKey, Date.now());
  saveNegDiskCache();
}

let testHarvestBaseUrlOverride: string | null = null;

function buildEmbedUrl(tmdb: number, type: MovieMasterMediaType, season = 1, episode = 1): string {
  const base = (testHarvestBaseUrlOverride || process.env.CINECAST_MM_HARVEST_BASE_URL || 'https://api.moviemaster.lat').replace(/\/+$/, '');
  if (type === 'movie') {
    return `${base}/e/movie/${tmdb}?lang=LAT&autoplay=1`;
  }
  return `${base}/e/tv/${tmdb}/${season}/${episode}?lang=LAT&autoplay=1`;
}

async function harvestUiViaElectron(
  embedUrl: string,
  tmdb: number,
  deadlineMs: number = HARVEST_TIMEOUT_MS
): Promise<{ ui: string | null; timedOut: boolean }> {
  const electron = requireModule('electron');
  const { BrowserWindow, session } = electron;
  const partition = `mm-harvest-${tmdb}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ses = session.fromPartition(partition, { cache: false });
  let win: any = null;

  try {
    return await new Promise<{ ui: string | null; timedOut: boolean }>((resolve) => {
      let settled = false;
      const finish = (val: string | null, timedOut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ui: val, timedOut });
      };

      const timer = setTimeout(() => {
        finish(null, true);
      }, deadlineMs);

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
              finish(ui.trim(), false);
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
          finish(null, false);
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

async function harvestUiViaPlaywright(
  embedUrl: string,
  deadlineMs: number = HARVEST_TIMEOUT_MS
): Promise<{ ui: string | null; timedOut: boolean }> {
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

    return await new Promise<{ ui: string | null; timedOut: boolean }>((resolve) => {
      let settled = false;
      const finish = (val: string | null, timedOut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ui: val, timedOut });
      };

      const timer = setTimeout(() => {
        finish(null, true);
      }, deadlineMs);

      const checkUrl = (rawUrl: string) => {
        if (!rawUrl || !rawUrl.includes('api.moviemaster.lat/servers')) return;
        try {
          const u = new URL(rawUrl);
          const ui = u.searchParams.get('ui');
          if (ui && ui.trim()) {
            finish(ui.trim(), false);
          }
        } catch (_) {}
      };

      page.on('request', (req: any) => checkUrl(req.url()));
      page.on('response', (res: any) => checkUrl(res.url()));

      page
        .setContent(`<iframe src="${embedUrl}" width="800" height="450"></iframe>`)
        .catch(() => finish(null, false));
    });
  } catch (err: any) {
    console.warn(`[MM] Error cosechando ui via Playwright:`, err?.message || err);
    return { ui: null, timedOut: false };
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
  deadlineMs?: number;
}

/**
 * harvestUi(tmdb): ventana oculta, webRequest.onCompleted sobre /servers?, extrae ui.
 * Deadline duro 6 s. Log [MM] harvest ms=... ui=cache|harvest y [MM] abortado por deadline.
 */
export async function harvestUi(tmdb: number, opts: HarvestUiOptions = {}): Promise<string | null> {
  const cleanTmdb = Math.floor(Number(tmdb));
  if (!Number.isFinite(cleanTmdb) || cleanTmdb <= 0) return null;

  const t0 = Date.now();
  const type = opts.type || 'tv';
  const season = opts.season || 1;
  const episode = opts.episode || 1;
  const sKey = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(season) || 1));
  const eKey = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(episode) || 1));
  const titleCacheKey = `${cleanTmdb}|${type}|${sKey}|${eKey}`;

  if (isUnderDeadlineCooldown(titleCacheKey)) {
    return null;
  }

  if (!opts.forceRefresh) {
    const cached = uiCache.get(cleanTmdb);
    if (cached && Date.now() - cached.at < UI_TTL_MS) {
      console.log(`[MM] harvest ms=${Date.now() - t0} ui=cache`);
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

  const deadlineMs = opts.deadlineMs ?? HARVEST_TIMEOUT_MS;

  const task = (async () => {
    const isElectron = Boolean(process.versions && process.versions.electron);
    const primaryUrl = buildEmbedUrl(cleanTmdb, type, season, episode);

    const res = isElectron
      ? await harvestUiViaElectron(primaryUrl, cleanTmdb, deadlineMs)
      : await harvestUiViaPlaywright(primaryUrl, deadlineMs);

    const elapsed = Date.now() - t0;

    if (res.timedOut || !res.ui) {
      if (res.timedOut) {
        console.log('[MM] abortado por deadline');
        markDeadlineCooldown(titleCacheKey);
      }
      return null;
    }

    console.log(`[MM] harvest ms=${elapsed} ui=harvest`);
    uiCache.set(cleanTmdb, { ui: res.ui, at: Date.now() });
    saveUiDiskCache();
    return res.ui;
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
  ui: string,
  signal?: AbortSignal
): Promise<{ status: number; body: any }> {
  const qs =
    type === 'movie'
      ? `tmdb=${tmdb}&type=movie&ui=${encodeURIComponent(ui)}`
      : `tmdb=${tmdb}&type=tv&season=${s}&episode=${e}&ui=${encodeURIComponent(ui)}`;
  const url = `https://api.moviemaster.lat/servers?${qs}`;

  const timeoutSig = AbortSignal.timeout(SERVERS_FETCH_TIMEOUT_MS);
  const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': REAL_UA,
      Accept: '*/*',
      Referer: 'https://api.moviemaster.lat/',
    },
    signal: effectiveSignal,
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
 * servers.length === 0 -> indisponible, guardado en caché negativa 24 h por tmdb|type|s|e.
 * En 403 con body.error === 'pass_scope' o 'no permitido' -> invalidar y re-cosechar una sola vez.
 */
export async function getServers(
  tmdb: number,
  rawType: string = 'tv',
  season: number = 1,
  episode: number = 1,
  opts: { forceRefresh?: boolean; harvestDeadlineMs?: number } = {}
): Promise<NormalizedMovieMasterServer[]> {
  const cleanTmdb = Math.floor(Number(tmdb));
  if (!Number.isFinite(cleanTmdb) || cleanTmdb <= 0) return [];

  const type = normalizeMmType(rawType);
  const s = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(season) || 1));
  const e = type === 'movie' ? 0 : Math.max(1, Math.floor(Number(episode) || 1));
  const cacheKey = `${cleanTmdb}|${type}|${s}|${e}`;

  if (isUnderDeadlineCooldown(cacheKey)) {
    return [];
  }

  if (!opts.forceRefresh) {
    if (isNegativelyCached(cacheKey)) {
      return [];
    }
    const cached = serversCache.get(cacheKey);
    if (cached) {
      const ttl = cached.negative ? NEGATIVE_SERVERS_TTL_MS : SERVERS_CACHE_TTL_MS;
      if (Date.now() - cached.at < ttl) {
        return cached.servers;
      }
    }
  } else {
    serversCache.delete(cacheKey);
  }

  let ui = await harvestUi(cleanTmdb, {
    type,
    season: s || 1,
    episode: e || 1,
    forceRefresh: false,
    deadlineMs: opts.harvestDeadlineMs,
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
      deadlineMs: opts.harvestDeadlineMs,
    });
    if (!ui) return [];
    resp = await fetchServersWithUi(cleanTmdb, type, s || 1, e || 1, ui);
  }

  if (resp.status !== 200 || !Array.isArray(resp.body?.servers) || resp.body.servers.length === 0) {
    if (resp.status === 200 && Array.isArray(resp.body?.servers) && resp.body.servers.length === 0) {
      markNegativelyCached(cacheKey);
      serversCache.set(cacheKey, { servers: [], at: Date.now(), negative: true });
    }
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

  normalized.sort((a, b) => getMmLangRank(a.lang) - getMmLangRank(b.lang));

  if (normalized.length === 0) {
    markNegativelyCached(cacheKey);
    serversCache.set(cacheKey, { servers: [], at: Date.now(), negative: true });
    return [];
  }

  negativeServersCache.delete(cacheKey);
  serversCache.set(cacheKey, { servers: normalized, at: Date.now(), negative: false });
  return normalized;
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
  uaHash: string,
  preferredServerName?: string,
  preferredLang?: NormalizedMmLang
): SnapshotEntry | null {
  const now = Date.now();
  for (const [k, entry] of snapshotCache.entries()) {
    if (now - entry.at > SNAPSHOT_TTL_MS) {
      snapshotCache.delete(k);
      continue;
    }
    if (
      entry.tmdb === tmdb &&
      entry.type === type &&
      entry.season === s &&
      entry.episode === e &&
      entry.uaHash === uaHash
    ) {
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
  acceptLanguage?: string,
  signal?: AbortSignal
): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false; reason: string; aborted?: boolean }> {
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
      signal,
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
    const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError' || Boolean(signal?.aborted);
    return { ok: false, reason: err?.message || 'fetch error', aborted: isAbort };
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
  harvestDeadlineMs?: number;
  mintDeadlineMs?: number;
}

/**
 * mintSnapshot(tmdb, type, s, e): cadena de idioma LAT -> ESP -> SUB.
 * Deadline duro: cosecha 6 s, mint 3 s (AbortController). Al vencer: log [MM] abortado por deadline
 * y marca MovieMaster no disponible para ese título durante 10 min.
 * snapshotKey = sha1(tmdb|type|s|e|srv|uaHash) con uaHash = sha1(ua + '|' + acceptLanguage).
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
  const cacheKey = `${cleanTmdb}|${type}|${s}|${e}`;
  const uaHash = buildUaHash(opts.userAgent, opts.acceptLanguage);

  if (isUnderDeadlineCooldown(cacheKey)) {
    return null;
  }

  if (!opts.forceRefresh && !opts.simulateFirstServer502) {
    const existing = findCachedSnapshotForTitle(
      cleanTmdb,
      type,
      s,
      e,
      uaHash,
      opts.serverName,
      opts.lang
    );
    if (existing) {
      console.log(
        `[MM] lang=${existing.lang} srv=${existing.serverName} segs=${existing.segs} dur=${existing.durationSec}`
      );
      return existing;
    }
  }

  let servers = await getServers(cleanTmdb, type, s || 1, e || 1, {
    forceRefresh: opts.forceRefresh,
    harvestDeadlineMs: opts.harvestDeadlineMs,
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

  const mintDeadlineMs = opts.mintDeadlineMs ?? MINT_DEADLINE_MS;
  const mintAbortController = new AbortController();
  let mintDeadlineExpired = false;
  const mintTimer = setTimeout(() => {
    mintDeadlineExpired = true;
    mintAbortController.abort();
  }, mintDeadlineMs);

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (mintDeadlineExpired || mintAbortController.signal.aborted) {
        console.log('[MM] abortado por deadline');
        markDeadlineCooldown(cacheKey);
        return null;
      }

      const srv = candidates[attempt];

      if (opts.simulateFirstServer502 && attempt === 0) {
        console.warn(
          `[MM] Intento ${attempt + 1}/${maxAttempts} descartado en "${srv.name}" (${srv.lang}): HTTP 502 HTML payload (<) [simulated]`
        );
        continue;
      }

      let masterRes = await fetchValidM3u8(
        srv.video,
        opts.userAgent,
        opts.acceptLanguage,
        mintAbortController.signal
      );

      if (mintDeadlineExpired || (!masterRes.ok && masterRes.aborted)) {
        console.log('[MM] abortado por deadline');
        markDeadlineCooldown(cacheKey);
        return null;
      }

      if (!masterRes.ok && masterRes.reason.includes('410') && !refreshedListOn410) {
        refreshedListOn410 = true;
        servers = await getServers(cleanTmdb, type, s || 1, e || 1, {
          forceRefresh: true,
          harvestDeadlineMs: opts.harvestDeadlineMs,
        });
        const refreshedMatch =
          servers.find((x) => x.name === srv.name && x.lang === srv.lang) || servers[attempt];
        if (refreshedMatch) {
          masterRes = await fetchValidM3u8(
            refreshedMatch.video,
            opts.userAgent,
            opts.acceptLanguage,
            mintAbortController.signal
          );
        }
      }

      if (mintDeadlineExpired || (!masterRes.ok && masterRes.aborted)) {
        console.log('[MM] abortado por deadline');
        markDeadlineCooldown(cacheKey);
        return null;
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
        const varRes = await fetchValidM3u8(
          variantUrl,
          opts.userAgent,
          opts.acceptLanguage,
          mintAbortController.signal
        );
        if (mintDeadlineExpired || (!varRes.ok && varRes.aborted)) {
          console.log('[MM] abortado por deadline');
          markDeadlineCooldown(cacheKey);
          return null;
        }
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

      const key = buildSnapshotKey(cleanTmdb, type, s, e, srv.name, uaHash);
      const entry: SnapshotEntry = {
        key,
        uaHash,
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
  } finally {
    clearTimeout(mintTimer);
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

  // Endpoints auxiliares para pruebas de deadline de cosecha (6 s)
  router.get('/mm/test-hang/*', (_req: Request, res: Response) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(504).end();
    }, 30_000);
    res.on('close', () => clearTimeout(timer));
  });

  router.post('/mm/test-config', (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
    if ('harvestBaseUrl' in b) {
      testHarvestBaseUrlOverride =
        typeof b.harvestBaseUrl === 'string' && b.harvestBaseUrl.trim()
          ? b.harvestBaseUrl.trim()
          : null;
    }
    if (b.clearTmdb) {
      const t = Math.floor(Number(b.clearTmdb));
      uiCache.delete(t);
      for (const k of Array.from(serversCache.keys())) {
        if (k.startsWith(`${t}|`)) serversCache.delete(k);
      }
      for (const k of Array.from(deadlineCooldownCache.keys())) {
        if (k.startsWith(`${t}|`)) deadlineCooldownCache.delete(k);
      }
      for (const k of Array.from(snapshotCache.keys())) {
        const snap = snapshotCache.get(k);
        if (snap && snap.tmdb === t) snapshotCache.delete(k);
      }
    }
    res.json({ ok: true, harvestBaseUrl: testHarvestBaseUrlOverride });
  });

  return router;
}
