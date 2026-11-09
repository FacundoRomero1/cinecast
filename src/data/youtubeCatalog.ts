export interface YouTubeVideo {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  thumbnailUrl: string;
  category: string;
}

export const YOUTUBE_VIDEOS: YouTubeVideo[] = [
  {
    id: 'yt-1',
    videoId: 'jfKfPfyJRdk',
    title: 'Lofi Girl - Radio de Beats Relajantes para Dormir & Trabajar',
    channel: 'Lofi Girl',
    duration: 'EN VIVO',
    views: '45K en vivo',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=800&auto=format&fit=crop',
    category: 'Música en Vivo',
  },
  {
    id: 'yt-2',
    videoId: 'UDVtMYqUAyw',
    title: 'Hans Zimmer - Interstellar Main Theme Live en Viena (4K)',
    channel: 'World of Soundtrack',
    duration: '9:12',
    views: '18M vistas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop',
    category: 'Bandas Sonoras',
  },
  {
    id: 'yt-3',
    videoId: 'k4V3Mo61fJM',
    title: 'Coldplay - Fix You (Live in São Paulo Estádio)',
    channel: 'Coldplay Oficial',
    duration: '5:45',
    views: '34M vistas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=800&auto=format&fit=crop',
    category: 'Recitales',
  },
  {
    id: 'yt-4',
    videoId: 'm_F5vDk9_aQ',
    title: 'Night City Tokyo 4K HDR Binaural Night Walk & Rain Sound',
    channel: 'Nomadic Ambience',
    duration: '1:45:00',
    views: '6.2M vistas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=800&auto=format&fit=crop',
    category: 'Ambiente & Paisajes',
  },
  {
    id: 'yt-5',
    videoId: '1I_7v_8H0dE',
    title: 'Top 10 Momentos Más Rápidos de la Fórmula 1 - Sonido Puro V10',
    channel: 'Motorsport Highlights',
    duration: '12:20',
    views: '4.8M vistas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?q=80&w=800&auto=format&fit=crop',
    category: 'Deportes & Velocidad',
  },
];
