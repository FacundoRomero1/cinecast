import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'path';
import { WebSocket } from 'ws';
import { getLocalIpAddress } from '../net.js';
import { globalDevices } from '../rooms.js';
import { loadAccountsFromFile, saveAccountsToFile, type AccountEntry } from './accounts.js';

export interface PkceEntry {
  verifier: string;
  challenge: string;
  clientId: string;
  redirectUri: string;
  provider: string;
  createdAt: number;
}

export interface StoredAuthTokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expiresAt?: number;
  clientId?: string;
  code?: string;
  [key: string]: unknown;
}

export interface StoredAuthProfile {
  name?: string;
  id?: string;
  email?: string;
}

export interface StoredAuthData {
  provider: string;
  profile?: StoredAuthProfile | undefined;
  playlistUrl?: string | undefined;
  tokens?: StoredAuthTokens | null | undefined;
  connected?: boolean | undefined;
  updatedAt?: number | undefined;
  savedAt?: number | undefined;
}

export interface AuthRouterOptions {
  userDataPath: string;
  accountsFilePath?: string | undefined;
  saveSecureAuth: (provider: string, data: StoredAuthData) => Promise<void>;
  loadSecureAuth: (provider: string) => Promise<StoredAuthData | null>;
  onAuthUpdated?: ((payload: { provider: string; profile: StoredAuthProfile }) => void) | undefined;
}

const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutos
export const pkceStates = new Map<string, PkceEntry>();

function prunePkceStates(): void {
  const now = Date.now();
  pkceStates.forEach((entry, key) => {
    if (now - entry.createdAt > PKCE_TTL_MS) {
      pkceStates.delete(key);
    }
  });
}

function getPkceState(state: string): PkceEntry | undefined {
  prunePkceStates();
  return pkceStates.get(state);
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

interface SpotifyMeResponse {
  display_name?: string;
  id?: string;
  email?: string;
}

interface SpotifyTokenRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { userDataPath, saveSecureAuth, loadSecureAuth, onAuthUpdated } = options;
  const accountsFilePath =
    options.accountsFilePath || path.join(userDataPath, 'cinecast-accounts.json');

  // GET /auth/start/spotify: Flujo PKCE S256 oficial (Client ID dinámico, sin client secret)
  router.get('/auth/start/spotify', async (req, res) => {
    const localIp = getLocalIpAddress() || '127.0.0.1';
    const port = process.env.PORT || 3000;
    const rawRedirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
    const redirectUri = rawRedirectUri || `http://${localIp}:${port}/auth/callback`;

    const queryClientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
    let clientId =
      queryClientId ||
      process.env.SPOTIFY_CLIENT_ID ||
      process.env.VITE_SPOTIFY_CLIENT_ID ||
      '';

    if (queryClientId) {
      clientId = queryClientId.trim();
      process.env.VITE_SPOTIFY_CLIENT_ID = clientId;
      saveAccountsToFile(accountsFilePath, { spotifyClientId: clientId });
    } else if (!clientId) {
      const acc = loadAccountsFromFile(accountsFilePath);
      if (acc && typeof acc.spotifyClientId === 'string') {
        clientId = acc.spotifyClientId;
      }
    }

    if (!clientId || clientId === 'your_spotify_client_id_here') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configurar Spotify OAuth - CineCast</title>
  <style>
    body { background: #09090b; color: #fff; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 36px 28px; max-width: 460px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0,0,0,0.8); }
    .icon { font-size: 44px; margin-bottom: 12px; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; color: #10b981; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.6; margin-bottom: 22px; }
    .steps { text-align: left; background: #09090b; border: 1px solid #27272a; border-radius: 18px; padding: 18px; margin-bottom: 22px; font-size: 13px; color: #d4d4d8; line-height: 1.6; }
    .steps ol { padding-left: 20px; margin: 0; }
    .steps li { margin-bottom: 10px; }
    .steps li:last-child { margin-bottom: 0; }
    .steps code { background: #27272a; padding: 3px 7px; border-radius: 6px; color: #10b981; font-family: monospace; font-size: 12px; word-break: break-all; display: inline-block; margin-top: 4px; }
    input { width: 100%; box-sizing: border-box; padding: 14px 16px; background: #09090b; border: 1px solid #3f3f46; border-radius: 14px; color: #fff; font-size: 14px; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #10b981; }
    button { width: 100%; padding: 15px; border-radius: 14px; background: #10b981; color: #000; font-weight: 800; font-size: 14px; border: none; cursor: pointer; transition: transform 0.1s, background 0.2s; box-shadow: 0 10px 25px rgba(16,185,129,0.3); }
    button:hover { background: #059669; }
    button:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎵</div>
    <h1>Conectar Spotify OAuth (PKCE)</h1>
    <p>Para escuchar tus playlists y favoritos en tu PC, ingresa tu Client ID público de Spotify Developer:</p>
    <div class="steps">
      <ol>
        <li>Entra a <strong>developer.spotify.com</strong> y crea tu app.</li>
        <li>En <strong>Redirect URIs</strong> agrega:<br><code>http://${localIp}:${port}/auth/callback</code></li>
        <li>Pega tu <strong>Client ID</strong> aquí (no requiere Client Secret):</li>
      </ol>
    </div>
    <form method="GET" action="/auth/start/spotify">
      <input type="text" name="client_id" placeholder="Pega tu Client ID aquí..." required />
      <button type="submit">⚡ Guardar y Conectar Spotify</button>
    </form>
  </div>
</body>
</html>`);
      return;
    }

    prunePkceStates();
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    pkceStates.set(state, {
      verifier,
      challenge,
      clientId,
      redirectUri,
      provider: 'spotify',
      createdAt: Date.now(),
    });

    const scopes = [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-modify-playback-state',
      'user-read-playback-state',
      'streaming',
    ].join(' ');

    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&code_challenge_method=S256&code_challenge=${challenge}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&show_dialog=true`;

    res.redirect(authUrl);
  });

  // Rutas de Vinculación Smart-Bridge por QR en LAN (para YouTube o conexión rápida)
  router.get('/auth/start/:provider', async (req, res) => {
    const provider = (req.params.provider || 'spotify').toLowerCase();
    if (provider === 'spotify' && !req.query.bridge) {
      res.redirect('/auth/start/spotify');
      return;
    }

    const isSpotify = provider === 'spotify';
    const brandColor = isSpotify ? '#10b981' : '#ef4444';
    const brandName = isSpotify ? 'Spotify' : 'YouTube';
    const brandIcon = isSpotify ? '🎵' : '▶️';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Vincular ${brandName} - CineCast</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 28px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }
    .icon { width: 64px; height: 64px; border-radius: 20px; background: ${brandColor}20; color: ${brandColor}; border: 1px solid ${brandColor}50; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 16px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 22px; }
    .input-group { text-align: left; margin-bottom: 16px; }
    label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; display: block; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; background: #09090b; border: 1px solid #3f3f46; border-radius: 14px; color: #fff; font-size: 14px; outline: none; }
    input:focus { border-color: ${brandColor}; }
    .btn { width: 100%; padding: 14px; border-radius: 14px; font-size: 14px; font-weight: 700; cursor: pointer; border: none; transition: 0.2s; margin-bottom: 10px; }
    .btn-primary { background: ${brandColor}; color: #fff; box-shadow: 0 10px 20px ${brandColor}30; }
    .btn-secondary { background: #27272a; color: #e4e4e7; }
    .success { display: none; margin-top: 10px; }
    .checkmark { font-size: 48px; color: #10b981; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card" id="form-card">
    <div class="icon">${brandIcon}</div>
    <h1>Conectar ${brandName}</h1>
    <p>Vinculá tu cuenta o playlist para reproducir sin límites en la pantalla de tu PC.</p>
    <div class="input-group">
      <label>Usuario o Perfil</label>
      <input type="text" id="username" placeholder="Tu usuario o nombre..." value="Mi Celular" />
    </div>
    <div class="input-group">
      <label>Enlace de Playlist o Canal (Opcional)</label>
      <input type="text" id="playlist" placeholder="https://${isSpotify ? 'open.spotify.com/playlist/...' : 'youtube.com/playlist?list=...'}" />
    </div>
    <button class="btn btn-primary" onclick="submitAuth()">⚡ Conectar con tu PC</button>
    <button class="btn btn-secondary" onclick="quickGuest()">👤 Conexión Rápida Invitado</button>
  </div>

  <div class="card success" id="success-card">
    <div class="checkmark">✓</div>
    <h1 style="color: #10b981;">¡Conectado con Éxito!</h1>
    <p style="margin-top: 8px;">Tu cuenta y playlists ya están sincronizadas en tu PC. Ya podés cerrar esta ventana o abrir el control remoto.</p>
    <a href="/?role=remote&hub=${provider}" class="btn btn-primary" style="text-decoration:none; display:block; margin-top: 16px;">📱 Ir al Control Remoto</a>
  </div>

  <script>
    async function submitAuth() {
      const username = document.getElementById('username').value.trim() || 'Usuario CineCast';
      const playlist = document.getElementById('playlist').value.trim();
      await fetch('/auth/qr-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: '${provider}',
          profile: { name: username },
          playlistUrl: playlist,
          connectedAt: Date.now(),
        })
      });
      document.getElementById('form-card').style.display = 'none';
      document.getElementById('success-card').style.display = 'block';
    }

    function quickGuest() {
      document.getElementById('username').value = 'Invitado VIP';
      submitAuth();
    }
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  router.post('/auth/qr-complete', async (req, res) => {
    const body = (req.body || {}) as {
      provider?: string;
      profile?: StoredAuthProfile;
      playlistUrl?: string;
      tokens?: StoredAuthTokens | null;
    };
    const provider = body.provider || 'spotify';
    const profile: StoredAuthProfile = body.profile || { name: 'Usuario Vinculado' };
    const payload: StoredAuthData = {
      provider,
      profile,
      playlistUrl: body.playlistUrl || '',
      tokens: body.tokens || null,
      connected: true,
      updatedAt: Date.now(),
    };

    await saveSecureAuth(provider, payload);
    const current = loadAccountsFromFile(accountsFilePath);
    const accounts: AccountEntry[] = Array.isArray(current.accounts)
      ? current.accounts.filter((a) => a.provider !== provider)
      : [];
    accounts.push({
      provider,
      profile,
      playlistUrl: payload.playlistUrl || '',
      tokens: payload.tokens || null,
      connected: true,
      updatedAt: payload.updatedAt || Date.now(),
    });
    saveAccountsToFile(accountsFilePath, { accounts });

    const alertPayload = JSON.stringify({
      type: 'auth:updated',
      provider,
      profile,
    });
    globalDevices.forEach((client) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(alertPayload);
        } catch (_) {}
      }
    });

    if (onAuthUpdated) {
      onAuthUpdated({ provider, profile });
    }

    res.json({ ok: true, provider });
  });

  // GET /auth/callback: Intercambio PKCE por tokens y almacenamiento cifrado
  router.get('/auth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    const pkce = state ? getPkceState(state) : undefined;
    const rawProvider = typeof req.query.provider === 'string' ? req.query.provider : 'spotify';
    const provider = pkce?.provider || rawProvider;

    if (error || !code) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res
        .status(400)
        .send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body style="background:#09090b;color:#ef4444;font-family:sans-serif;text-align:center;padding:50px;"><h1>❌ Error en la autorización</h1><p style="color:#a1a1aa">${error || 'No se recibió código de autorización.'}</p></body></html>`
        );
      return;
    }

    let tokens: StoredAuthTokens | null = null;
    let profile: StoredAuthProfile = { name: 'Usuario Spotify' };

    if (pkce && pkce.verifier) {
      try {
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: String(code),
            redirect_uri: pkce.redirectUri,
            client_id: pkce.clientId,
            code_verifier: pkce.verifier,
          }).toString(),
          signal: AbortSignal.timeout(10000),
        });

        if (tokenRes.ok) {
          tokens = (await tokenRes.json()) as StoredAuthTokens;
        } else {
          const errText = await tokenRes.text();
          console.warn('[Spotify PKCE] Token exchange error:', errText);
        }
      } catch (e) {
        console.warn('[Spotify PKCE] Token fetch failed:', e);
      }
    }

    if (tokens && tokens.access_token) {
      tokens.clientId = pkce?.clientId || process.env.VITE_SPOTIFY_CLIENT_ID || '';
      tokens.expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
      try {
        const profileRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(6000),
        });
        if (profileRes.ok) {
          const p = (await profileRes.json()) as SpotifyMeResponse;
          profile = {
            name: p.display_name || p.id || 'Usuario Spotify',
            id: p.id || '',
            email: p.email || '',
          };
        }
      } catch (_) {}
    }

    const tokenPayload: StoredAuthData = {
      provider,
      tokens: tokens || { code },
      profile,
      connected: true,
      updatedAt: Date.now(),
    };

    await saveSecureAuth(provider, tokenPayload);

    const current = loadAccountsFromFile(accountsFilePath);
    const accounts: AccountEntry[] = Array.isArray(current.accounts)
      ? current.accounts.filter((a) => a.provider !== provider)
      : [];
    accounts.push({
      provider,
      tokens: tokenPayload.tokens || null,
      profile,
      connected: true,
      updatedAt: tokenPayload.updatedAt || Date.now(),
    });
    saveAccountsToFile(accountsFilePath, { accounts });

    if (state) pkceStates.delete(state);

    const alertPayload = JSON.stringify({
      type: 'auth:updated',
      provider,
      profile,
    });
    globalDevices.forEach((client) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(alertPayload);
        } catch (_) {}
      }
    });

    if (onAuthUpdated) {
      onAuthUpdated({ provider, profile });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Spotify Conectado - CineCast</title>
  <style>
    body { background: #09090b; color: #10b981; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 24px; padding: 40px 32px; max-width: 440px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.8); }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { color: #a1a1aa; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✔ ¡Spotify conectado con éxito en tu PC!</h1>
    <p>Ya puedes cerrar esta ventana.</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`);
  });

  // Refresco automático de Spotify antes de que expire (3600 segundos)
  router.get('/api/auth/spotify/token', async (_req, res) => {
    try {
      const auth = await loadSecureAuth('spotify');
      if (!auth || !auth.tokens || !auth.tokens.access_token) {
        res.json({ connected: false, token: null });
        return;
      }

      const now = Date.now();
      const expiresAt = auth.tokens.expiresAt || 0;
      const refreshToken = auth.tokens.refresh_token;
      const clientId =
        auth.tokens.clientId ||
        process.env.VITE_SPOTIFY_CLIENT_ID ||
        process.env.SPOTIFY_CLIENT_ID;

      if (now >= expiresAt - 300000 && refreshToken && clientId) {
        try {
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: clientId,
            }).toString(),
            signal: AbortSignal.timeout(10000),
          });

          if (tokenRes.ok) {
            const fresh = (await tokenRes.json()) as SpotifyTokenRefreshResponse;
            auth.tokens.access_token = fresh.access_token;
            if (fresh.refresh_token) auth.tokens.refresh_token = fresh.refresh_token;
            auth.tokens.expires_in = fresh.expires_in || 3600;
            auth.tokens.expiresAt = Date.now() + (fresh.expires_in || 3600) * 1000;
            auth.updatedAt = Date.now();
            await saveSecureAuth('spotify', auth);
            console.log('[Spotify OAuth] Token refrescado automáticamente con éxito.');
          } else {
            console.warn('[Spotify OAuth] Respuesta de refresco no exitosa:', await tokenRes.text());
          }
        } catch (refErr) {
          console.warn('[Spotify OAuth] Error al refrescar access_token:', refErr);
        }
      }

      res.json({
        connected: true,
        token: auth.tokens.access_token,
        profile: auth.profile,
        expiresAt: auth.tokens.expiresAt,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/auth/status', async (_req, res) => {
    const spotify = await loadSecureAuth('spotify');
    const youtube = await loadSecureAuth('youtube');
    res.json({
      spotify: { connected: Boolean(spotify?.connected), profile: spotify?.profile || null },
      youtube: { connected: Boolean(youtube?.connected), profile: youtube?.profile || null },
    });
  });

  return router;
}

