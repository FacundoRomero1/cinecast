/**
 * Módulo de penalizaciones adaptativas para servidores de streaming.
 * Permite registrar penalizaciones temporales en memoria (TTL 1h) para un serverId en un título
 * cuando una reproducción falla o supera el tope duro de 12s.
 */

export interface ServerPenaltyRecord {
  key: string;
  providerId: string;
  titleId: string;
  serverId: string;
  penaltyMs: number;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

const PENALTY_TTL_MS = 60 * 60 * 1000; // 1 hora
const DEFAULT_PENALTY_MS = 15_000; // 15 segundos adicionales por fallo

const penaltiesMap = new Map<string, ServerPenaltyRecord>();

function makePenaltyKey(providerId: string, titleId: string | number, serverId: string | number): string {
  const normProv = String(providerId || 'tukiplay').trim().toLowerCase();
  const normTitle = String(titleId).trim().toLowerCase();
  const normServer = String(serverId).trim().toLowerCase();
  return `${normProv}:${normTitle}:${normServer}`;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, record] of penaltiesMap.entries()) {
    if (now >= record.expiresAt) {
      penaltiesMap.delete(key);
    }
  }
}

/**
 * Registra o incrementa la penalización para un servidor en un título determinado.
 */
export function recordServerPenalty(
  providerId: string,
  titleId: string | number,
  serverId: string | number,
  penaltyMs = DEFAULT_PENALTY_MS,
  reason = 'desconocido'
): number {
  pruneExpired();
  const key = makePenaltyKey(providerId, titleId, serverId);
  const now = Date.now();
  const existing = penaltiesMap.get(key);

  const currentPenalty = existing && now < existing.expiresAt ? existing.penaltyMs : 0;
  const newPenalty = currentPenalty + penaltyMs;

  penaltiesMap.set(key, {
    key,
    providerId: String(providerId).trim().toLowerCase(),
    titleId: String(titleId).trim().toLowerCase(),
    serverId: String(serverId).trim(),
    penaltyMs: newPenalty,
    reason,
    createdAt: existing ? existing.createdAt : now,
    expiresAt: now + PENALTY_TTL_MS,
  });

  return newPenalty;
}

/**
 * Obtiene la penalización activa (en ms) para un servidor en un título.
 */
export function getServerPenalty(
  providerId: string,
  titleId: string | number,
  serverId: string | number
): number {
  pruneExpired();
  const key = makePenaltyKey(providerId, titleId, serverId);
  const existing = penaltiesMap.get(key);
  if (existing && Date.now() < existing.expiresAt) {
    return existing.penaltyMs;
  }
  return 0;
}

/**
 * Devuelve el total de penalizaciones registradas activas.
 */
export function getPenaltiesCount(): number {
  pruneExpired();
  return penaltiesMap.size;
}

/**
 * Devuelve todas las penalizaciones activas.
 */
export function getAllPenalties(): ServerPenaltyRecord[] {
  pruneExpired();
  return Array.from(penaltiesMap.values());
}

/**
 * Limpia todas las penalizaciones (útil para tests).
 */
export function clearPenalties(): void {
  penaltiesMap.clear();
}
