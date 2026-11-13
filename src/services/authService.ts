export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface UserPlaylistItem {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  uri?: string;
  trackCount?: number;
  author?: string;
  embedUrl: string;
}

export interface AuthState {
  spotify: {
    isConnected: boolean;
    token: string | null;
    profile: UserProfile | null;
  };
  google: {
    isConnected: boolean;
    token: string | null;
    profile: UserProfile | null;
  };
}

const SPOTIFY_TOKEN_KEY = 'cinecast_spotify_token';
const SPOTIFY_USER_KEY = 'cinecast_spotify_user';
const SPOTIFY_CLIENT_ID_KEY = 'cinecast_spotify_client_id';

const GOOGLE_TOKEN_KEY = 'cinecast_google_token';
const GOOGLE_USER_KEY = 'cinecast_google_user';
const GOOGLE_CLIENT_ID_KEY = 'cinecast_google_client_id';

class AuthService {
  private listeners: (() => void)[] = [];
  private cachedSpotifyClientId: string = '';

  constructor() {
    this.syncSpotifyClientIdFromAccounts();
  }

  async syncSpotifyClientIdFromAccounts(): Promise<string> {
    try {
      if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.spotifyClientId === 'string' && data.spotifyClientId.trim()) {
            this.cachedSpotifyClientId = data.spotifyClientId.trim();
            if (!localStorage.getItem(SPOTIFY_CLIENT_ID_KEY)) {
              localStorage.setItem(SPOTIFY_CLIENT_ID_KEY, this.cachedSpotifyClientId);
            }
            this.notify();
            return this.cachedSpotifyClientId;
          }
        }
      }
    } catch (_) {}
    return this.getSpotifyClientId();
  }

  // Obtener Client IDs (desde .env, localStorage o /api/accounts)
  getSpotifyClientId(): string {
    const fromEnv = (import.meta as any).env?.VITE_SPOTIFY_CLIENT_ID;
    if (fromEnv && fromEnv !== 'your_spotify_client_id_here') return fromEnv;
    const fromStorage = typeof localStorage !== 'undefined' ? localStorage.getItem(SPOTIFY_CLIENT_ID_KEY) : '';
    return fromStorage || this.cachedSpotifyClientId || '';
  }

  getMaskedSpotifyClientId(): string {
    const raw = this.getSpotifyClientId();
    if (!raw) return '';
    if (raw.length <= 8) return '****';
    return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
  }

  setSpotifyClientId(clientId: string) {
    const trimmed = clientId.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SPOTIFY_CLIENT_ID_KEY, trimmed);
    }
    this.cachedSpotifyClientId = trimmed;
    try {
      if (typeof fetch === 'function') {
        fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spotifyClientId: trimmed }),
        }).catch(() => {});
      }
    } catch (_) {}
    this.notify();
  }

  getGoogleClientId(): string {
    const fromEnv = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
    if (fromEnv && fromEnv !== 'your_google_client_id_here') return fromEnv;
    return localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || '';
  }

  setGoogleClientId(clientId: string) {
    localStorage.setItem(GOOGLE_CLIENT_ID_KEY, clientId.trim());
    this.notify();
  }

  // Estado general de autenticación
  getAuthState(): AuthState {
    const spotifyToken = localStorage.getItem(SPOTIFY_TOKEN_KEY);
    const spotifyUser = localStorage.getItem(SPOTIFY_USER_KEY);
    const googleToken = localStorage.getItem(GOOGLE_TOKEN_KEY);
    const googleUser = localStorage.getItem(GOOGLE_USER_KEY);

    return {
      spotify: {
        isConnected: Boolean(spotifyToken),
        token: spotifyToken,
        profile: spotifyUser ? JSON.parse(spotifyUser) : null,
      },
      google: {
        isConnected: Boolean(googleToken),
        token: googleToken,
        profile: googleUser ? JSON.parse(googleUser) : null,
      },
    };
  }

  // Escuchar cambios de autenticación
  subscribe(callback: () => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // ==========================================
  // SPOTIFY OAUTH 2.0 PKCE FLOW & AUTO-REFRESH
  // ==========================================
  async getSpotifyAccessToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/spotify/token');
      if (res.ok) {
        const data = await res.json();
        if (data.connected && data.token) {
          localStorage.setItem(SPOTIFY_TOKEN_KEY, data.token);
          if (data.profile) localStorage.setItem(SPOTIFY_USER_KEY, JSON.stringify(data.profile));
          return data.token;
        }
      }
    } catch (_) {}
    return localStorage.getItem(SPOTIFY_TOKEN_KEY);
  }

  async checkSpotifyStatus(): Promise<{ connected: boolean; profile: UserProfile | null }> {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        const sp = data?.spotify;
        if (sp?.connected) {
          if (sp.profile) {
            localStorage.setItem(SPOTIFY_USER_KEY, JSON.stringify(sp.profile));
          }
          this.notify();
          return { connected: true, profile: sp.profile || null };
        }
      }
    } catch (_) {}
    const localTok = typeof localStorage !== 'undefined' ? localStorage.getItem(SPOTIFY_TOKEN_KEY) : null;
    const localUser = typeof localStorage !== 'undefined' ? localStorage.getItem(SPOTIFY_USER_KEY) : null;
    return {
      connected: Boolean(localTok),
      profile: localUser ? JSON.parse(localUser) : null,
    };
  }

  loginWithSpotify() {
    const clientId = this.getSpotifyClientId();
    const serverAuthUrl = `/auth/start/spotify${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`;
    const fullUrl =
      typeof window !== 'undefined' && serverAuthUrl.startsWith('/')
        ? `${window.location.origin}${serverAuthUrl}`
        : serverAuthUrl;

    if (typeof (window as any).electronAPI?.openExternal === 'function') {
      (window as any).electronAPI.openExternal(fullUrl);
    } else if (typeof window !== 'undefined') {
      window.open(fullUrl, '_blank');
    }
  }

  async logoutSpotify() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SPOTIFY_TOKEN_KEY);
      localStorage.removeItem(SPOTIFY_USER_KEY);
    }
    try {
      if (typeof fetch === 'function') {
        await fetch('/api/auth/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'spotify' }),
        });
      }
    } catch (_) {}
    this.notify();
  }

  async fetchSpotifyPlaylists(): Promise<UserPlaylistItem[]> {
    const token = await this.getSpotifyAccessToken();
    if (!token) return [];

    try {
      const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          this.logoutSpotify();
        }
        return [];
      }

      const data = await res.json();
      return (data.items || []).map((pl: any) => ({
        id: pl.id,
        title: pl.name,
        description: pl.description || 'Playlist de Spotify',
        thumbnailUrl: pl.images?.[0]?.url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop',
        uri: pl.uri,
        trackCount: pl.tracks?.total || 0,
        author: pl.owner?.display_name || 'Spotify User',
        embedUrl: `https://open.spotify.com/embed/playlist/${pl.id}?utm_source=generator&theme=0`,
      }));
    } catch {
      return [];
    }
  }

  // ==========================================
  // GOOGLE / YOUTUBE OAUTH 2.0 FLOW
  // ==========================================
  loginWithGoogle() {
    const clientId = this.getGoogleClientId();
    if (!clientId) {
      throw new Error('MISSING_CLIENT_ID');
    }

    const redirectUri = window.location.origin + window.location.pathname;
    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' ');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&response_type=token&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scopes)}&state=google_auth&prompt=consent`;

    window.location.href = authUrl;
  }

  logoutGoogle() {
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_USER_KEY);
    this.notify();
  }

  async fetchYouTubePlaylists(): Promise<UserPlaylistItem[]> {
    const token = localStorage.getItem(GOOGLE_TOKEN_KEY);
    if (!token) return [];

    try {
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=20',
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        if (res.status === 401) {
          this.logoutGoogle();
        }
        return [];
      }

      const data = await res.json();
      return (data.items || []).map((item: any) => ({
        id: item.id,
        title: item.snippet?.title || 'Mi Playlist de YouTube',
        description: item.snippet?.description || 'Playlist de YouTube',
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=600&auto=format&fit=crop',
        trackCount: item.contentDetails?.itemCount || 0,
        author: item.snippet?.channelTitle || 'Mi Canal',
        embedUrl: `https://www.youtube.com/embed/videoseries?list=${item.id}&autoplay=1`,
      }));
    } catch {
      return [];
    }
  }

  // ==========================================
  // URL PARSING ON APP INIT (HANDLE CALLBACK)
  // ==========================================
  async handleRedirectCallback(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // Spotify & Google return access_token in hash fragment: #access_token=...&state=...
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) return false;

    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const state = params.get('state');

    if (!accessToken) return false;

    let handled = false;

    if (state === 'spotify_auth') {
      localStorage.setItem(SPOTIFY_TOKEN_KEY, accessToken);
      try {
        const userRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const u = await userRes.json();
          const profile: UserProfile = {
            id: u.id,
            name: u.display_name || u.id,
            email: u.email,
            avatarUrl: u.images?.[0]?.url,
          };
          localStorage.setItem(SPOTIFY_USER_KEY, JSON.stringify(profile));
        }
      } catch (_) {}
      handled = true;
    } else if (state === 'google_auth') {
      localStorage.setItem(GOOGLE_TOKEN_KEY, accessToken);
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const u = await userRes.json();
          const profile: UserProfile = {
            id: u.sub,
            name: u.name || 'Usuario Google',
            email: u.email,
            avatarUrl: u.picture,
          };
          localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(profile));
        }
      } catch (_) {}
      handled = true;
    }

    if (handled) {
      // Limpiar hash de la URL sin recargar
      window.history.replaceState({}, document.title, window.location.pathname);
      this.notify();
      return true;
    }

    return false;
  }
}

export const authService = new AuthService();
