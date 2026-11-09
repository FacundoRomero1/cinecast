export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationSeconds: number;
  previewUrl: string;
  genres: string[];
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  tracks: SpotifyTrack[];
}

export const SPOTIFY_TRACKS: SpotifyTrack[] = [
  {
    id: 'sp-1',
    title: 'BZRP Music Sessions #53',
    artist: 'Bizarrap, Shakira',
    album: 'BZRP Music Sessions',
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=800&auto=format&fit=crop',
    durationSeconds: 218,
    previewUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race1.ogg',
    genres: ['Urbano', 'Pop Latino', 'Electro'],
  },
  {
    id: 'sp-2',
    title: 'LUNA',
    artist: 'Feid, ATL Jacob',
    album: 'FERXXOCALIPSIS',
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=800&auto=format&fit=crop',
    durationSeconds: 196,
    previewUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race2.ogg',
    genres: ['Reggaetón', 'Trap Latino'],
  },
  {
    id: 'sp-3',
    title: 'De Música Ligera',
    artist: 'Soda Stereo',
    album: 'Canción Animal',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=800&auto=format&fit=crop',
    durationSeconds: 212,
    previewUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race1.ogg',
    genres: ['Rock Argentino', 'Clásico'],
  },
  {
    id: 'sp-4',
    title: 'Midnight Lofi Chill',
    artist: 'Komorebi Sound',
    album: 'Tokyo Rain Sessions',
    coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=800&auto=format&fit=crop',
    durationSeconds: 180,
    previewUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race2.ogg',
    genres: ['Lofi', 'Chillhop', 'Instrumental'],
  },
  {
    id: 'sp-5',
    title: 'Starboy (Cinematic Mix)',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy Remastered',
    coverUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?q=80&w=800&auto=format&fit=crop',
    durationSeconds: 230,
    previewUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race1.ogg',
    genres: ['Synthwave', 'R&B'],
  },
];

export const SPOTIFY_PLAYLISTS: SpotifyPlaylist[] = [
  {
    id: 'pl-top-argentina',
    name: 'Top Éxitos Argentina & Urbana',
    description: 'Los temas más escuchados para relajarte o activar la noche.',
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=800&auto=format&fit=crop',
    tracks: [SPOTIFY_TRACKS[0], SPOTIFY_TRACKS[1], SPOTIFY_TRACKS[2]],
  },
  {
    id: 'pl-lofi-night',
    name: 'Lofi Dormitorio & Chill',
    description: 'Música suave y relajante para maratonear o dormir sin sobresaltos.',
    coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=800&auto=format&fit=crop',
    tracks: [SPOTIFY_TRACKS[3], SPOTIFY_TRACKS[4]],
  },
];
