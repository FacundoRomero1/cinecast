import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getOrFetchSportsChannels,
  fetchTudeporteAgenda,
  fetchTudeporteReplays,
  extractStreamTpM3u8,
} from '../sports.js';

export interface SportsOptions {
  baseDir?: string | undefined;
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: {
    id?: string;
    displayName?: string;
    name?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
  };
}

interface EspnEvent {
  id?: string;
  name?: string;
  date?: string;
  competitions?: Array<{
    competitors?: EspnCompetitor[];
  }>;
  status?: {
    displayClock?: string;
    type?: {
      state?: string;
      description?: string;
      detail?: string;
    };
  };
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

interface CompetitionChannelEntry {
  primaryChannels?: string[];
}

export interface SportMatchItem {
  id: string;
  name: string;
  date: string;
  timestamp: number;
  league: string;
  leagueSlug: string;
  isLive: boolean;
  isFinished: boolean;
  status: string;
  clock: string;
  channels: string[];
  homeTeam: {
    id: string | undefined;
    name: string;
    shortName: string;
    logo: string | null;
    score: string;
  };
  awayTeam: {
    id: string | undefined;
    name: string;
    shortName: string;
    logo: string | null;
    score: string;
  };
}

export interface SportsMatchesPayload {
  updatedAt: string;
  total: number;
  matches: SportMatchItem[];
}

export function createSportsRouter(options: SportsOptions = {}): Router {
  const router = Router();
  const baseDir = options.baseDir || process.cwd();

  let sportsMatchesCache: SportsMatchesPayload | null = null;
  let sportsMatchesCacheTime = 0;

  // GET /api/sports/streamtp/:slug (.m3u8): resuelve dinámicamente el token HLS en vivo y redirige (302)
  router.get('/sports/streamtp/:slug', async (req, res) => {
    try {
      const rawSlug = String(req.params.slug || '').replace(/\.m3u8$/i, '').trim();
      if (!rawSlug || !/^[a-z0-9_-]{1,40}$/i.test(rawSlug)) {
        res.status(400).json({ error: 'Slug de canal inválido' });
        return;
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const m3u8Url = await extractStreamTpM3u8(rawSlug, 5000, forceRefresh);
      if (!m3u8Url) {
        res.status(404).json({ error: 'Señal no disponible en este momento' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, m3u8Url);
    } catch (err: any) {
      console.warn('[Sports Router] Error resolviendo streamtp:', err?.message || err);
      res.status(502).json({ error: 'Error al resolver señal en vivo' });
    }
  });

  // GET /api/sports/channels: Valida señales en backend (con mirrors) y cachea 7 minutos
  router.get('/sports/channels', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
      const shouldValidate = req.query.validate !== 'false';
      const cacheDir = path.join(baseDir, '.cinecast-data');
      const data = await getOrFetchSportsChannels(cacheDir, forceRefresh, shouldValidate);
      res.setHeader(
        'Cache-Control',
        forceRefresh ? 'no-store' : shouldValidate ? 'public, max-age=420' : 'public, max-age=3600'
      );
      res.json(data);
    } catch (err: any) {
      console.warn('[Sports Router] Error obteniendo canales M3U:', err?.message || err);
      res.status(500).json({
        error: 'No se pudieron obtener canales de deportes en este momento',
        channels: [],
      });
    }
  });

  // GET /api/sports/live: Agenda en vivo de tudeporte.lat limpia con caché de 3 min
  router.get('/sports/live', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
      const cacheDir = path.join(baseDir, '.cinecast-data');
      const matches = await fetchTudeporteAgenda(cacheDir, forceRefresh);
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.json({
        updatedAt: new Date().toISOString(),
        total: matches.length,
        matches,
      });
    } catch (err: any) {
      console.warn('[Sports Router] Error obteniendo agenda de tudeporte:', err?.message || err);
      res.status(500).json({
        error: 'No se pudo obtener la agenda deportiva en este momento',
        matches: [],
      });
    }
  });

  // GET /api/sports/replays: Lista de repeticiones de partidos recientes de tudeporte.lat
  router.get('/sports/replays', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
      const cacheDir = path.join(baseDir, '.cinecast-data');
      const replays = await fetchTudeporteReplays(cacheDir, forceRefresh);
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.json({
        updatedAt: new Date().toISOString(),
        total: replays.length,
        replays,
      });
    } catch (err: any) {
      console.warn('[Sports Router] Error obteniendo repeticiones de tudeporte:', err?.message || err);
      res.status(500).json({
        error: 'No se pudieron obtener repeticiones en este momento',
        replays: [],
      });
    }
  });

  router.get('/sports/matches', async (_req, res) => {
    const now = Date.now();
    if (sportsMatchesCache && now - sportsMatchesCacheTime < 45000) {
      res.json(sportsMatchesCache);
      return;
    }

    const leagues = [
      { slug: 'arg.1', name: 'Liga Profesional Argentina', country: 'AR' },
      { slug: 'arg.copa', name: 'Copa Argentina', country: 'AR' },
      { slug: 'conmebol.libertadores', name: 'Copa Libertadores', country: 'CONMEBOL' },
      { slug: 'conmebol.sudamericana', name: 'Copa Sudamericana', country: 'CONMEBOL' },
      { slug: 'uefa.champions', name: 'UEFA Champions League', country: 'INT' },
      { slug: 'uefa.europa', name: 'UEFA Europa League', country: 'INT' },
      { slug: 'eng.1', name: 'Premier League', country: 'GB' },
      { slug: 'esp.1', name: 'LaLiga EA Sports', country: 'ES' },
      { slug: 'ita.1', name: 'Serie A', country: 'IT' },
    ];

    let compChannels: Record<string, CompetitionChannelEntry> = {};
    try {
      const fp = path.join(baseDir, 'data', 'competition-channels.json');
      if (fs.existsSync(fp)) {
        compChannels = JSON.parse(fs.readFileSync(fp, 'utf8')) as Record<
          string,
          CompetitionChannelEntry
        >;
      }
    } catch (_) {}

    try {
      const allMatches: SportMatchItem[] = [];
      const seenEventIds = new Set<string>();

      await Promise.allSettled(
        leagues.map(async (l) => {
          try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${l.slug}/scoreboard`;
            const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) return;
            const data = (await r.json()) as EspnScoreboardResponse;
            const events = Array.isArray(data.events) ? data.events : [];

            for (const ev of events) {
              if (!ev.id || seenEventIds.has(ev.id)) continue;
              seenEventIds.add(ev.id);
              const comp = ev.competitions?.[0];
              const home = comp?.competitors?.find((c) => c.homeAway === 'home');
              const away = comp?.competitors?.find((c) => c.homeAway === 'away');
              const statusState = ev.status?.type?.state;
              const statusDesc =
                ev.status?.type?.description || ev.status?.type?.detail || 'Programado';
              const clock = ev.status?.displayClock || '';

              const primaryCh = compChannels[l.slug]?.primaryChannels || [
                'ESPN',
                'Fox Sports',
                'TyC Sports',
              ];

              const evDate = ev.date || new Date().toISOString();

              allMatches.push({
                id: ev.id,
                name: ev.name || '',
                date: evDate,
                timestamp: new Date(evDate).getTime(),
                league: l.name,
                leagueSlug: l.slug,
                isLive: statusState === 'in',
                isFinished: statusState === 'post',
                status: statusDesc,
                clock,
                channels: primaryCh,
                homeTeam: {
                  id: home?.team?.id,
                  name: home?.team?.displayName || home?.team?.name || 'Local',
                  shortName: home?.team?.shortDisplayName || home?.team?.abbreviation || 'LOC',
                  logo: home?.team?.logo || null,
                  score: home?.score ?? '-',
                },
                awayTeam: {
                  id: away?.team?.id,
                  name: away?.team?.displayName || away?.team?.name || 'Visitante',
                  shortName: away?.team?.shortDisplayName || away?.team?.abbreviation || 'VIS',
                  logo: away?.team?.logo || null,
                  score: away?.score ?? '-',
                },
              });
            }
          } catch (_) {}
        })
      );

      allMatches.sort((a, b) => {
        if (a.isLive && !b.isLive) return -1;
        if (!a.isLive && b.isLive) return 1;
        return a.timestamp - b.timestamp;
      });

      const result: SportsMatchesPayload = {
        updatedAt: new Date().toISOString(),
        total: allMatches.length,
        matches: allMatches,
      };

      sportsMatchesCache = result;
      sportsMatchesCacheTime = now;

      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err), matches: [] });
    }
  });

  return router;
}

