import fs from 'node:fs';
import path from 'node:path';

export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  languages: string[];
  urlMovie: string;
  urlTv: string;
  urlTvEpisode?: string;
  requiresReferer: boolean;
  tlsLax?: boolean;
  pendingMs?: number;
  softDeadlineMs?: number;
  hardTimeoutMs?: number;
  slowThresholdMs?: number;
  maxConcurrent: number;
  swrTtlMs: number;
  negativeTtlMs: number;
  breakerErrorPct: number;
  breakerWindow: number;
  breakerOpenMs: number;
  notes?: string;
}

let cachedProviders: ProviderConfig[] | null = null;
let cachedFromPath: string | null = null;

function resolveProvidersFilePath(baseDir?: string): string {
  const candidates = [
    baseDir ? path.join(baseDir, 'src', 'data', 'providers.json') : '',
    path.join(process.cwd(), 'src', 'data', 'providers.json'),
    path.resolve(process.cwd(), 'cinecast', 'src', 'data', 'providers.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || path.join(process.cwd(), 'src', 'data', 'providers.json');
}

export function loadProvidersConfig(baseDir?: string): ProviderConfig[] {
  const filePath = resolveProvidersFilePath(baseDir);
  if (cachedProviders && cachedFromPath === filePath) {
    return cachedProviders;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ProviderConfig[];
  cachedProviders = parsed;
  cachedFromPath = filePath;
  return cachedProviders;
}

export function reloadProvidersConfig(baseDir?: string): ProviderConfig[] {
  cachedProviders = null;
  cachedFromPath = null;
  return loadProvidersConfig(baseDir);
}

export function getProviderConfig(providerId: string, baseDir?: string): ProviderConfig | undefined {
  const list = loadProvidersConfig(baseDir);
  return list.find((p) => p.id === providerId);
}

export function getProviderHost(provider: ProviderConfig): string {
  const sampleUrl = provider.urlMovie || provider.urlTv || '';
  try {
    return new URL(sampleUrl).hostname.toLowerCase();
  } catch {
    return provider.id.toLowerCase();
  }
}

