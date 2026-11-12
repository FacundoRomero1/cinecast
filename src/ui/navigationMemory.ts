export interface TabMemoryItem {
  fullPath: string;
  search: string;
  scrollY: number;
  timestamp: number;
  state?: Record<string, any>;
}

const STORAGE_KEY = 'cinecast_nav_tab_memory_v1';
const MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutos

function readAll(): Record<string, TabMemoryItem> {
  if (typeof window === 'undefined') return {};
  try {
    const raw =
      window.sessionStorage?.getItem(STORAGE_KEY) ||
      window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {}
  return {};
}

function writeAll(data: Record<string, TabMemoryItem>): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(data);
    window.sessionStorage?.setItem(STORAGE_KEY, serialized);
    window.localStorage?.setItem(STORAGE_KEY, serialized);
  } catch {}
}

export function saveTabMemory(tabKey: string, partial: Partial<TabMemoryItem>): void {
  const all = readAll();
  const prev = all[tabKey] || {
    fullPath: `/${tabKey === 'home' ? '' : tabKey}`,
    search: '',
    scrollY: 0,
    timestamp: Date.now(),
  };
  all[tabKey] = {
    ...prev,
    ...partial,
    timestamp: Date.now(),
  };
  writeAll(all);
}

export function getTabMemory(tabKey: string): TabMemoryItem | null {
  const all = readAll();
  const entry = all[tabKey];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MEMORY_TTL_MS) {
    delete all[tabKey];
    writeAll(all);
    return null;
  }
  return entry;
}

export function getRememberedTabUrl(basePath: string): string | null {
  const key = basePath === '/' ? 'home' : basePath.replace(/^\//, '').split('/')[0];
  if (!key) return null;
  const mem = getTabMemory(key);
  if (!mem) return null;
  if (mem.fullPath && mem.fullPath.startsWith(basePath)) {
    return mem.fullPath;
  }
  if (mem.search) {
    return `${basePath}${mem.search.startsWith('?') ? '' : '?'}${mem.search}`;
  }
  return null;
}

export function saveTabScroll(basePath: string, scrollY: number): void {
  const key = basePath === '/' ? 'home' : basePath.replace(/^\//, '').split('/')[0];
  if (!key) return;
  saveTabMemory(key, { scrollY: Math.round(scrollY) });
}

export function getTabScroll(basePath: string): number {
  const key = basePath === '/' ? 'home' : basePath.replace(/^\//, '').split('/')[0];
  if (!key) return 0;
  const mem = getTabMemory(key);
  return mem ? mem.scrollY || 0 : 0;
}

