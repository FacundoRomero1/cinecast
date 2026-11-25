import fs from 'node:fs';
import path from 'node:path';
import { getServers as getAnimeAV1Servers } from './animeav1.js';
import { getServers as getAnimeFLVServers } from './animeflv.js';
import { getServers as getJKAnimeServers } from './jkanime.js';
import { getServers as getAnimeLatinoServers } from './animelatinohd.js';
import { getServers as getLatanimeServers } from './latanime.js';
import type { AnimeServer, QualityScoreRecord } from './types.js';
import { validateStreamDuration } from './validator.js';

const qualityScores = new Map<string, QualityScoreRecord>();

const SCORES_FILE = path.join(process.cwd(), 'data', 'anime-quality-scores.json');

// Cargar scores persistidos al iniciar
try {
  if (fs.existsSync(SCORES_FILE)) {
    const raw = fs.readFileSync(SCORES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      qualityScores.set(k, v as QualityScoreRecord);
    }
  }
} catch (_) {}

function saveScoresDebounced(): void {
  try {
    const obj: Record<string, QualityScoreRecord> = {};
    for (const [k, v] of qualityScores.entries()) {
      obj[k] = v;
    }
    const dir = path.dirname(SCORES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCORES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (_) {}
}

export function getQualityScore(providerId: string, tmdbId: number | string, episode: number): number {
  const key = `${providerId}:${tmdbId}:${episode}`;
  const rec = qualityScores.get(key);
  if (!rec) return 1.0;
  return rec.score;
}

export function reportAnimeFailure(providerId: string, tmdbId: number | string, episode: number): number {
  const key = `${providerId}:${tmdbId}:${episode}`;
  const rec = qualityScores.get(key) || { score: 1.0, failures: 0, successes: 0, lastUpdated: Date.now() };
  rec.failures += 1;
  // Si una fuente falla 3 veces seguidas, se corta y excluye (score = 0)
  if (rec.failures >= 3) {
    rec.score = 0;
  } else {
    // Bajar el score del proveedor para ese título/episodio (-0.2 por fallo). Si llega a 0, se excluye.
    rec.score = Math.max(0, Math.round((rec.score - 0.2) * 100) / 100);
  }
  rec.lastUpdated = Date.now();
  qualityScores.set(key, rec);
  saveScoresDebounced();
  console.log(`[AnimeOrchestrator] Score bajó para ${key}: nuevo score = ${rec.score} (fallos: ${rec.failures})`);
  return rec.score;
}

export function reportAnimeSuccess(providerId: string, tmdbId: number | string, episode: number): number {
  const key = `${providerId}:${tmdbId}:${episode}`;
  const rec = qualityScores.get(key) || { score: 1.0, failures: 0, successes: 0, lastUpdated: Date.now() };
  rec.successes += 1;
  // Si un proveedor tiene éxito (el video se reproduce), subir el score (+0.1 hasta un máximo de 1.0).
  rec.score = Math.min(1.0, Math.round((rec.score + 0.1) * 100) / 100);
  rec.lastUpdated = Date.now();
  qualityScores.set(key, rec);
  saveScoresDebounced();
  console.log(`[AnimeOrchestrator] Score subió para ${key}: nuevo score = ${rec.score} (éxitos: ${rec.successes})`);
  return rec.score;
}

export function getAllAnimeQualityScores(): Record<string, QualityScoreRecord> {
  const obj: Record<string, QualityScoreRecord> = {};
  for (const [k, v] of qualityScores.entries()) {
    obj[k] = v;
  }
  return obj;
}

export async function resolveAnimeServers(
  tmdbId: number | string,
  title: string,
  episode: number,
  expectedRuntimeMinutes: number = 24
): Promise<AnimeServer[]> {
  console.log(`[AnimeOrchestrator] Consultando fuentes de anime para "${title}" (tmdbId=${tmdbId}, ep=${episode}, runtime=${expectedRuntimeMinutes}m)...`);

  // Consultar en paralelo a JKAnime, AnimeAV1, AnimeFLV (deadline duro 3.5 s), AnimeLatinoHD y Latanime
  const animeFlvWithDeadline = Promise.race<AnimeServer[]>([
    getAnimeFLVServers(title, episode),
    new Promise<AnimeServer[]>((resolve) => setTimeout(() => resolve([]), 3500)),
  ]);
  const [jkSettled, av1Settled, flvSettled, latinoSettled, latanimeSettled] = await Promise.allSettled([
    getJKAnimeServers(title, episode),
    getAnimeAV1Servers(title, episode),
    animeFlvWithDeadline,
    getAnimeLatinoServers(title, episode, tmdbId),
    getLatanimeServers(title, episode, tmdbId),
  ]);

  const rawServers: AnimeServer[] = [];

  if (av1Settled.status === 'fulfilled' && Array.isArray(av1Settled.value)) {
    rawServers.push(...av1Settled.value);
  }
  if (jkSettled.status === 'fulfilled' && Array.isArray(jkSettled.value)) {
    rawServers.push(...jkSettled.value);
  }
  if (flvSettled.status === 'fulfilled' && Array.isArray(flvSettled.value)) {
    rawServers.push(...flvSettled.value);
  }
  if (latinoSettled.status === 'fulfilled' && Array.isArray(latinoSettled.value)) {
    rawServers.push(...latinoSettled.value);
  }
  if (latanimeSettled.status === 'fulfilled' && Array.isArray(latanimeSettled.value)) {
    rawServers.push(...latanimeSettled.value);
  }

  // Recopilar todos los servidores encontrados y aplicar QualityScore
  const scoredServers: AnimeServer[] = [];
  const seenUrls = new Set<string>();

  for (const srv of rawServers) {
    if (!srv.url || seenUrls.has(srv.url)) continue;
    seenUrls.add(srv.url);

    const score = getQualityScore(srv.provider, tmdbId, episode);
    const key = `${srv.provider}:${tmdbId}:${episode}`;
    const rec = qualityScores.get(key);

    // Si una fuente falla 3 veces seguidas o su score llega a 0, se excluye
    if (score <= 0 || (rec && rec.failures >= 3)) {
      console.log(`[AnimeOrchestrator] Servidor excluido por fallos/score: ${srv.provider} (${srv.name})`);
      continue;
    }

    scoredServers.push({
      ...srv,
      id: `${srv.provider}_${srv.name}_${srv.url}`.replace(/\s+/g, '_'),
      qualityScore: score,
    });
  }

  // TAREA B: Filtrado de integridad de contenido en servidores HLS
  const validatedServers: AnimeServer[] = [];
  for (const srv of scoredServers) {
    if (srv.type === 'hls' && srv.url) {
      console.log(`[AnimeOrchestrator] Validando duración de stream HLS de ${srv.provider} (${srv.name})...`);
      const isValid = await validateStreamDuration(srv.url, expectedRuntimeMinutes);
      if (!isValid) {
        console.warn(`[AnimeOrchestrator] Servidor ${srv.provider} (${srv.name}) descartado por duración inválida o falso positivo.`);
        reportAnimeFailure(srv.provider, tmdbId, episode);
        continue;
      }
    }
    validatedServers.push(srv);
  }

  // Ordenarlos por tipo y score: type === 'hls' tiene prioridad 0, type === 'iframe' tiene prioridad 1
  validatedServers.sort((a, b) => {
    const priorityA = a.type === 'hls' ? 0 : 1;
    const priorityB = b.type === 'hls' ? 0 : 1;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    const scoreDiff = (b.qualityScore ?? 1.0) - (a.qualityScore ?? 1.0);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return 0;
  });

  // B11.10: Intercalar proveedores (round-robin) para garantizar redundancia multi-extractor
  // en vez de que un solo extractor cope todos los slots antes del slice.
  const byProvider = new Map<string, AnimeServer[]>();
  for (const srv of validatedServers) {
    const list = byProvider.get(srv.provider) || [];
    list.push(srv);
    byProvider.set(srv.provider, list);
  }
  const interleaved: AnimeServer[] = [];
  const queues = Array.from(byProvider.values());
  const MAX_SERVERS = 6;
  let added = true;
  while (added && interleaved.length < MAX_SERVERS) {
    added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        interleaved.push(next);
        added = true;
        if (interleaved.length >= MAX_SERVERS) break;
      }
    }
  }
  const topServers = interleaved;

  console.log(
    `[AnimeOrchestrator] Total servidores válidos para "${title}" (ep=${episode}): ${topServers.length} (de ${scoredServers.length} encontrados, extractores=[${Array.from(byProvider.keys()).join(',')}])`
  );
  return topServers;
}
