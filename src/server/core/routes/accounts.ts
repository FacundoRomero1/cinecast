import { Router } from 'express';
import fs from 'fs';

export interface AccountEntry {
  provider: string;
  profile?: { name?: string; id?: string; email?: string };
  playlistUrl?: string;
  tokens?: Record<string, unknown> | null;
  connected?: boolean;
  updatedAt?: number;
}

export interface AccountsDiskData {
  accounts: AccountEntry[];
  playlists: unknown[];
  favorites: unknown[];
  spotifyClientId?: string;
  [key: string]: unknown;
}

export interface AccountsOptions {
  accountsFilePath: string;
}

export function loadAccountsFromFile(accountsFilePath: string): AccountsDiskData {
  try {
    if (fs.existsSync(accountsFilePath)) {
      const content = fs.readFileSync(accountsFilePath, 'utf-8');
      return JSON.parse(content) as AccountsDiskData;
    }
  } catch (err) {
    console.warn('[Accounts] Error al leer cinecast-accounts.json:', err);
  }
  return { accounts: [], playlists: [], favorites: [] };
}

export function saveAccountsToFile(
  accountsFilePath: string,
  data: Partial<AccountsDiskData> | undefined
): boolean {
  try {
    const current = loadAccountsFromFile(accountsFilePath);
    const updated: AccountsDiskData = { ...current, ...(data || {}) };
    fs.writeFileSync(accountsFilePath, JSON.stringify(updated, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn('[Accounts] Error al guardar cinecast-accounts.json:', err);
    return false;
  }
}

export function createAccountsRouter(options: AccountsOptions): Router {
  const router = Router();
  const { accountsFilePath } = options;

  router.get('/accounts', (_req, res) => {
    res.json(loadAccountsFromFile(accountsFilePath));
  });

  router.post('/accounts', (req, res) => {
    const body = req.body as Partial<AccountsDiskData> | undefined;
    const ok = saveAccountsToFile(accountsFilePath, body);
    res.json({ ok });
  });

  return router;
}

