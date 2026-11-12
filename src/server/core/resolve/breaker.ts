import { getProviderConfig, type ProviderConfig } from './config.js';

export type BreakerStatus = 'closed' | 'open' | 'half-open';
export type BreakerOutcome = 'ok' | 'slow' | 'hard_error';

export interface BreakerThresholds {
  errorPct: number;
  windowSize: number;
  openMs: number;
  softDeadlineMs: number;
  slowThresholdMs: number;
}

export interface BreakerStateSnapshot {
  providerId: string;
  state: BreakerStatus;
  windowSize: number;
  errorPctThreshold: number;
  openMs: number;
  softDeadlineMs: number;
  slowThresholdMs: number;
  sampleCount: number;
  failureCount: number;
  slowCount: number;
  errorPct: number;
  slowPct: number;
  openedAt: number | null;
  openUntil: number | null;
  remainingOpenMs: number;
}

interface InternalBreakerState {
  state: BreakerStatus;
  outcomes: BreakerOutcome[];
  openedAt: number | null;
  openUntil: number | null;
  halfOpenInFlight: boolean;
}

const DEFAULT_THRESHOLDS: BreakerThresholds = {
  errorPct: 60,
  windowSize: 20,
  openMs: 60_000,
  softDeadlineMs: 4000,
  slowThresholdMs: 15_000,
};

const breakerStates = new Map<string, InternalBreakerState>();

function resolveThresholds(providerId: string, config?: ProviderConfig): BreakerThresholds {
  const cfg = config ?? getProviderConfig(providerId);
  return {
    errorPct:
      typeof cfg?.breakerErrorPct === 'number' && Number.isFinite(cfg.breakerErrorPct)
        ? cfg.breakerErrorPct
        : DEFAULT_THRESHOLDS.errorPct,
    windowSize:
      typeof cfg?.breakerWindow === 'number' && Number.isFinite(cfg.breakerWindow) && cfg.breakerWindow >= 1
        ? Math.floor(cfg.breakerWindow)
        : DEFAULT_THRESHOLDS.windowSize,
    openMs:
      typeof cfg?.breakerOpenMs === 'number' && Number.isFinite(cfg.breakerOpenMs) && cfg.breakerOpenMs >= 100
        ? cfg.breakerOpenMs
        : DEFAULT_THRESHOLDS.openMs,
    softDeadlineMs:
      typeof cfg?.softDeadlineMs === 'number' && Number.isFinite(cfg.softDeadlineMs) && cfg.softDeadlineMs > 0
        ? cfg.softDeadlineMs
        : DEFAULT_THRESHOLDS.softDeadlineMs,
    slowThresholdMs:
      typeof cfg?.slowThresholdMs === 'number' && Number.isFinite(cfg.slowThresholdMs) && cfg.slowThresholdMs > 0
        ? cfg.slowThresholdMs
        : DEFAULT_THRESHOLDS.slowThresholdMs,
  };
}

function getOrCreateState(providerId: string): InternalBreakerState {
  let entry = breakerStates.get(providerId);
  if (!entry) {
    entry = {
      state: 'closed',
      outcomes: [],
      openedAt: null,
      openUntil: null,
      halfOpenInFlight: false,
    };
    breakerStates.set(providerId, entry);
  }
  return entry;
}

function computeStats(outcomes: BreakerOutcome[]): {
  sampleCount: number;
  failureCount: number;
  slowCount: number;
  errorPct: number;
  slowPct: number;
} {
  const sampleCount = outcomes.length;
  let hardErrorCount = 0;
  let slowCount = 0;
  for (const outcome of outcomes) {
    if (outcome === 'hard_error') hardErrorCount += 1;
    else if (outcome === 'slow') slowCount += 1;
  }
  const failureCount = hardErrorCount + slowCount;
  const errorPct = sampleCount > 0 ? Number(((failureCount / sampleCount) * 100).toFixed(1)) : 0;
  const slowPct = sampleCount > 0 ? Number(((slowCount / sampleCount) * 100).toFixed(1)) : 0;
  return { sampleCount, failureCount, slowCount, errorPct, slowPct };
}

export function canExecuteWithBreaker(
  providerId: string,
  config?: ProviderConfig,
  now = Date.now()
): boolean {
  resolveThresholds(providerId, config);
  const entry = getOrCreateState(providerId);

  if (entry.state === 'closed') {
    return true;
  }

  if (entry.state === 'open') {
    if (entry.openUntil !== null && now >= entry.openUntil) {
      entry.state = 'half-open';
      entry.halfOpenInFlight = true;
      return true;
    }
    return false;
  }

  if (!entry.halfOpenInFlight) {
    entry.halfOpenInFlight = true;
    return true;
  }
  return false;
}

function recordOutcome(
  providerId: string,
  outcome: BreakerOutcome,
  config?: ProviderConfig,
  now = Date.now()
): BreakerStateSnapshot {
  const thresholds = resolveThresholds(providerId, config);
  const entry = getOrCreateState(providerId);

  if (entry.state === 'half-open') {
    if (outcome === 'ok') {
      entry.state = 'closed';
      entry.outcomes = ['ok'];
      entry.openedAt = null;
      entry.openUntil = null;
      entry.halfOpenInFlight = false;
    } else {
      entry.state = 'open';
      entry.openedAt = now;
      entry.openUntil = now + thresholds.openMs;
      entry.halfOpenInFlight = false;
    }
    return getBreakerState(providerId, config, now);
  }

  entry.outcomes.push(outcome);
  if (entry.outcomes.length > thresholds.windowSize) {
    entry.outcomes.shift();
  }

  const stats = computeStats(entry.outcomes);
  if (stats.sampleCount >= thresholds.windowSize && stats.errorPct >= thresholds.errorPct) {
    entry.state = 'open';
    entry.openedAt = now;
    entry.openUntil = now + thresholds.openMs;
    entry.halfOpenInFlight = false;
  }

  return getBreakerState(providerId, config, now);
}

/**
 * Registra una respuesta HTTP válida. Si waitedMs > slowThresholdMs (15000ms por defecto),
 * se contabiliza como muestra lenta ('slow', cuenta dentro de errorPct igual que errores duros).
 */
export function recordBreakerSuccess(
  providerId: string,
  config?: ProviderConfig,
  waitedMs?: number,
  now = Date.now()
): BreakerStateSnapshot {
  const thresholds = resolveThresholds(providerId, config);
  const isSlow = typeof waitedMs === 'number' && waitedMs > thresholds.slowThresholdMs;
  return recordOutcome(providerId, isSlow ? 'slow' : 'ok', config, now);
}

export function recordBreakerFailure(
  providerId: string,
  config?: ProviderConfig,
  now = Date.now()
): BreakerStateSnapshot {
  return recordOutcome(providerId, 'hard_error', config, now);
}

export function getBreakerState(
  providerId: string,
  config?: ProviderConfig,
  now = Date.now()
): BreakerStateSnapshot {
  const thresholds = resolveThresholds(providerId, config);
  const entry = getOrCreateState(providerId);

  if (entry.state === 'open' && entry.openUntil !== null && now >= entry.openUntil) {
    entry.state = 'half-open';
    entry.halfOpenInFlight = false;
  }

  const stats = computeStats(entry.outcomes);
  const remainingOpenMs =
    entry.state === 'open' && entry.openUntil !== null ? Math.max(0, entry.openUntil - now) : 0;

  return {
    providerId,
    state: entry.state,
    windowSize: thresholds.windowSize,
    errorPctThreshold: thresholds.errorPct,
    openMs: thresholds.openMs,
    softDeadlineMs: thresholds.softDeadlineMs,
    slowThresholdMs: thresholds.slowThresholdMs,
    sampleCount: stats.sampleCount,
    failureCount: stats.failureCount,
    slowCount: stats.slowCount,
    errorPct: stats.errorPct,
    slowPct: stats.slowPct,
    openedAt: entry.openedAt,
    openUntil: entry.openUntil,
    remainingOpenMs,
  };
}

export function getAllBreakerStates(providerIds: string[]): Record<string, BreakerStateSnapshot> {
  const out: Record<string, BreakerStateSnapshot> = {};
  for (const id of providerIds) {
    out[id] = getBreakerState(id);
  }
  return out;
}

export function resetBreaker(providerId?: string): void {
  if (providerId) {
    breakerStates.delete(providerId);
  } else {
    breakerStates.clear();
  }
}
