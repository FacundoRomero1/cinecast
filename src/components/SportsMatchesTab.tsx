import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Clock, Tv, RefreshCw, Trophy, Play, Video, Film, Radio, Sparkles } from 'lucide-react';
import { MediaItem } from '../types';

export interface TudeporteChannel {
  name: string;
  link: string;
  server: string;
  quality?: string;
}

export interface TudeporteLiveMatch {
  id: string;
  title: string;
  competition: string;
  category: string;
  time: string;
  timeLocal: string;
  status: 'en_vivo' | 'pronto' | 'finalizado' | string;
  channels: TudeporteChannel[];
}

export interface TudeporteReplay {
  id: string;
  title: string;
  img: string;
  league: string;
  date: string;
  parts: Array<{
    name: string;
    link: string;
  }>;
}

interface SportsMatchesTabProps {
  onPlayChannel: (mediaItem: MediaItem) => void;
  onCastChannel?: (mediaItem: MediaItem) => void;
}

export type SportFilter = 'all' | 'futbol' | 'nba' | 'nfl' | 'tenis' | 'otros';

export const MAIN_SPORTS: Array<{ id: SportFilter; label: string }> = [
  { id: 'all', label: '🏆 Todos los Deportes' },
  { id: 'futbol', label: '⚽ Fútbol' },
  { id: 'nba', label: '🏀 NBA & Básquetbol' },
  { id: 'nfl', label: '🏈 NFL (Fútbol Americano)' },
  { id: 'tenis', label: '🎾 Tenis (ATP / WTA)' },
  { id: 'otros', label: '🥊 Otros Deportes (F1, UFC, Box)' },
];

export function getSportType(category: string, title: string): SportFilter {
  const text = `${category} ${title}`.toLowerCase();

  // 1. NBA / Básquetbol
  if (
    text.includes('nba') ||
    text.includes('basquet') ||
    text.includes('basketball') ||
    text.includes('básquet') ||
    text.includes('euroleague') ||
    text.includes('acb') ||
    text.includes('fiba')
  ) {
    return 'nba';
  }

  // 2. NFL / Fútbol Americano
  if (
    text.includes('nfl') ||
    text.includes('american football') ||
    text.includes('fútbol americano') ||
    text.includes('futbol americano') ||
    text.includes('super bowl') ||
    text.includes('ncaa')
  ) {
    return 'nfl';
  }

  // 3. Tenis
  if (
    text.includes('tenis') ||
    text.includes('tennis') ||
    text.includes('atp') ||
    text.includes('wta') ||
    text.includes('roland garros') ||
    text.includes('wimbledon') ||
    text.includes('us open') ||
    text.includes('australian open') ||
    text.includes('davis cup')
  ) {
    return 'tenis';
  }

  // 4. Otros Deportes explícitos: F1, Combate, Béisbol, Rugby, Golf, Hockey, etc.
  if (
    text.includes('f1') ||
    text.includes('formula 1') ||
    text.includes('fórmula 1') ||
    text.includes('motogp') ||
    text.includes('moto gp') ||
    text.includes('nascar') ||
    text.includes('indycar') ||
    text.includes('rally') ||
    text.includes('ufc') ||
    text.includes('boxeo') ||
    text.includes('boxing') ||
    text.includes('wwe') ||
    text.includes('mma') ||
    text.includes('wrestling') ||
    text.includes('baseball') ||
    text.includes('béisbol') ||
    text.includes('mlb') ||
    text.includes('rugby') ||
    text.includes('golf') ||
    text.includes('hockey') ||
    text.includes('ciclismo') ||
    text.includes('cycling') ||
    text.includes('padel') ||
    text.includes('pádel')
  ) {
    return 'otros';
  }

  // 5. Fútbol (Soccer estricto): Ligas y competiciones de fútbol
  const isSoccer =
    text.includes('fútbol') ||
    text.includes('futbol') ||
    text.includes('soccer') ||
    text.includes('liga') ||
    text.includes('premier') ||
    text.includes('serie a') ||
    text.includes('bundesliga') ||
    text.includes('laliga') ||
    text.includes('la liga') ||
    text.includes('champions') ||
    text.includes('libertadores') ||
    text.includes('sudamericana') ||
    text.includes('europa league') ||
    text.includes('copa') ||
    text.includes('concacaf') ||
    text.includes('conmebol') ||
    text.includes('uefa') ||
    text.includes('fifa') ||
    text.includes('mls') ||
    text.includes('brasileirao') ||
    text.includes('eredivisie') ||
    text.includes('ligue 1') ||
    text.includes('friendly') ||
    text.includes('amistoso');

  if (isSoccer) {
    return 'futbol';
  }

  // Cualquier otro contenido deportivo no reconocido va a 'otros' para evitar contaminar 'futbol'
  return 'otros';
}

const CATEGORY_ICONS: Record<string, string> = {
  'liga profesional': '🇦🇷',
  'argentina': '🇦🇷',
  'copa de la liga': '🏆',
  'copa libertadores': '⭐',
  'copa sudamericana': '🔴',
  'champions': '⭐',
  'uefa': '🇪🇺',
  'europa league': '🟠',
  'laliga': '🇪🇸',
  'premier': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'serie a': '🇮🇹',
  'nba': '🏀',
  'nfl': '🏈',
  'tennis': '🎾',
  'atp': '🎾',
  'concacaf': '🌎',
  'fútbol': '⚽',
  'futbol': '⚽',
};

export const SportsMatchesTab: React.FC<SportsMatchesTabProps> = ({ onPlayChannel }) => {
  const [viewMode, setViewMode] = useState<'live' | 'replays'>('live');
  const [liveMatches, setLiveMatches] = useState<TudeporteLiveMatch[]>([]);
  const [replays, setReplays] = useState<TudeporteReplay[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedSport, setSelectedSport] = useState<SportFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchLiveMatches = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch('/api/sports/live' + (isManual ? '?refresh=true' : ''));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.matches)) {
          setLiveMatches(data.matches);
          setLastUpdated(
            new Date().toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );
        }
      }
    } catch (err) {
      console.warn('[SportsMatchesTab] Error al cargar agenda de partidos:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  const fetchReplays = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch('/api/sports/replays' + (isManual ? '?refresh=true' : ''));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.replays)) {
          setReplays(data.replays);
        }
      }
    } catch (err) {
      console.warn('[SportsMatchesTab] Error al cargar repeticiones:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  // Carga inicial y refresco según pestaña activa
  useEffect(() => {
    setLoading(true);
    if (viewMode === 'live') {
      fetchLiveMatches();
      const timer = setInterval(() => fetchLiveMatches(), 60000);
      return () => clearInterval(timer);
    } else {
      fetchReplays();
    }
  }, [viewMode, fetchLiveMatches, fetchReplays]);

  // Lista dinámica de categorías / ligas extraídas de los datos según deporte seleccionado
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    if (viewMode === 'live') {
      liveMatches.forEach((m) => {
        if (selectedSport !== 'all' && getSportType(m.category, m.title) !== selectedSport) {
          return;
        }
        if (m.category) set.add(m.category);
      });
    } else {
      replays.forEach((r) => {
        if (selectedSport !== 'all' && getSportType(r.league, r.title) !== selectedSport) {
          return;
        }
        if (r.league) set.add(r.league);
      });
    }
    const arr = Array.from(set).sort();
    return [
      { id: 'all', label: '🏆 Todas las Ligas' },
      ...arr.map((c) => {
        const lower = c.toLowerCase();
        let icon = '⚽';
        for (const [key, ic] of Object.entries(CATEGORY_ICONS)) {
          if (lower.includes(key)) {
            icon = ic;
            break;
          }
        }
        return { id: c, label: `${icon} ${c}` };
      }),
    ];
  }, [viewMode, liveMatches, replays, selectedSport]);

  // Filtro de partidos en vivo
  const filteredLiveMatches = useMemo(() => {
    return liveMatches.filter((m) => {
      if (selectedSport !== 'all') {
        const sport = getSportType(m.category, m.title);
        if (sport !== selectedSport) return false;
      }
      const matchCat = selectedCategory === 'all' || m.category === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [liveMatches, selectedSport, selectedCategory, searchQuery]);

  // Filtro de repeticiones
  const filteredReplays = useMemo(() => {
    return replays.filter((r) => {
      if (selectedSport !== 'all') {
        const sport = getSportType(r.league, r.title);
        if (sport !== selectedSport) return false;
      }
      const matchCat = selectedCategory === 'all' || r.league === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.league.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [replays, selectedSport, selectedCategory, searchQuery]);

  // Reproducción segura de señal en vivo (URL limpia extraída por el backend o HLS nativo)
  const handlePlayLiveChannel = (match: TudeporteLiveMatch, channel: TudeporteChannel) => {
    const isHls = channel.link.includes('.m3u8');
    const streamType: 'hls' | 'iframe' = isHls ? 'hls' : 'iframe';
    const item: MediaItem = {
      id: `live_${match.id}_${encodeURIComponent(channel.name)}`,
      title: `${match.title} (${channel.name})`,
      originalTitle: match.title,
      type: 'movie',
      overview: `${match.competition || match.category} - Transmisión en vivo por ${channel.name} (${channel.server}). ${
        isHls
          ? 'Reproducción nativa HLS Full HD sin publicidad ni popups.'
          : 'Señal limpia directa sin publicidad ni popups.'
      }`,
      year: new Date().getFullYear(),
      ratingBadge: 'EN VIVO',
      matchScore: 99,
      qualityBadge: channel.quality || (isHls ? 'Full HD (HLS Directo)' : 'HD 720p'),
      genres: ['Deportes', 'En Vivo', match.category || 'Latam'],
      cast: ['CineCast Deportes', 'Señal en Directo'],
      creatorOrDirector: match.competition || match.category || 'Transmisión Oficial',
      posterUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800',
      backdropUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1600&auto=format&fit=crop',
      videoUrl: channel.link,
      category: 'live_tv',
      streamType,
      servers: [
        {
          name: `${channel.name} ${isHls ? '(HLS Directo)' : '(Directo)'}`,
          url: channel.link,
          type: streamType,
          language: 'En Vivo',
        },
        ...match.channels
          .filter((c) => c.link !== channel.link)
          .map((c) => {
            const chIsHls = c.link.includes('.m3u8');
            const chType: 'hls' | 'iframe' = chIsHls ? 'hls' : 'iframe';
            return {
              name: `${c.name} ${chIsHls ? '(HLS Directo)' : `(${c.server})`}`,
              url: c.link,
              type: chType,
              language: 'Alternativa',
            };
          }),
      ],
    };
    onPlayChannel(item);
  };

  // Reproducción segura de repetición (Dailymotion / señal limpia)
  const handlePlayReplayPart = (replay: TudeporteReplay, part: { name: string; link: string }) => {
    const item: MediaItem = {
      id: `replay_${replay.id}_${encodeURIComponent(part.name)}`,
      title: `${replay.title} (${part.name})`,
      originalTitle: replay.title,
      type: 'movie',
      overview: `${replay.league} (${replay.date}) - Repetición oficial completa: ${part.name}.`,
      year: parseInt(replay.date.slice(0, 4), 10) || new Date().getFullYear(),
      ratingBadge: 'REPETICIÓN',
      matchScore: 99,
      qualityBadge: 'HD',
      genres: ['Deportes', 'Repetición', replay.league],
      cast: ['CineCast Repeticiones', 'Resumen y Partido Completo'],
      creatorOrDirector: replay.league || 'Transmisión Oficial',
      posterUrl: replay.img,
      backdropUrl: replay.img,
      videoUrl: part.link,
      category: 'live_tv',
      streamType: 'iframe',
      servers: replay.parts.map((p) => ({
        name: `${p.name} (HD)`,
        url: p.link,
        type: 'iframe',
        language: 'Español',
      })),
    };
    onPlayChannel(item);
  };

  return (
    <div className="pt-24 px-4 sm:px-10 max-w-7xl mx-auto pb-16">
      {/* Encabezado Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Deportes & Fútbol en Vivo
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400">
            Agenda oficial de transmisiones en directo, enlaces limpios sin publicidad y repeticiones completas.
            {lastUpdated && viewMode === 'live' && (
              <span className="text-zinc-500 ml-2">Actualizado: {lastUpdated} (cada 60s)</span>
            )}
          </p>
        </div>

        {/* Selector de Modo: En Vivo vs Repeticiones */}
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900 p-1 rounded-2xl border border-zinc-800 flex items-center shadow-lg">
            <button
              onClick={() => {
                setViewMode('live');
                setSelectedCategory('all');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                viewMode === 'live'
                  ? 'bg-red-600 text-white shadow-md shadow-red-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${viewMode === 'live' ? 'animate-pulse' : ''}`} />
              <span>Agenda en Vivo ({liveMatches.length})</span>
            </button>
            <button
              onClick={() => {
                setViewMode('replays');
                setSelectedCategory('all');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                viewMode === 'replays'
                  ? 'bg-red-600 text-white shadow-md shadow-red-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Repeticiones ({replays.length})</span>
            </button>
          </div>

          <button
            onClick={() => (viewMode === 'live' ? fetchLiveMatches(true) : fetchReplays(true))}
            disabled={refreshing}
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition shadow-lg shrink-0"
            title="Refrescar agenda"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-red-500' : 'text-zinc-400'}`} />
          </button>
        </div>
      </div>

      {/* Botones estrictos de Categorías Principales de Deportes */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
        {MAIN_SPORTS.map((sport) => {
          const isSelected = selectedSport === sport.id;
          return (
            <button
              key={sport.id}
              onClick={() => {
                setSelectedSport(sport.id);
                setSelectedCategory('all');
              }}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition border shadow-md flex items-center gap-2 ${
                isSelected
                  ? 'bg-red-600 text-white border-red-500 shadow-red-950/60 scale-[1.02]'
                  : 'bg-zinc-900/90 text-zinc-400 border-zinc-800/80 hover:text-white hover:border-zinc-700'
              }`}
            >
              <span>{sport.label}</span>
            </button>
          );
        })}
      </div>

      {/* Buscador & Categorías */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              viewMode === 'live'
                ? 'Buscar partido, equipo o liga (ej. River, Real Madrid, NBA)...'
                : 'Buscar repetición de partido...'
            }
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 transition shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white bg-zinc-800 rounded-xl transition"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Píldoras de Categorías */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {categoriesList.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition border shadow-sm ${
                selectedCategory === cat.id
                  ? 'bg-red-600 text-white border-red-500 shadow-red-900/40'
                  : 'bg-zinc-900/90 text-zinc-400 border-zinc-800/80 hover:text-white hover:border-zinc-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido: Agenda en Vivo */}
      {viewMode === 'live' && (
        <>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800/60 animate-pulse h-44" />
              ))}
            </div>
          ) : filteredLiveMatches.length === 0 ? (
            <div className="p-12 text-center bg-zinc-900/50 border border-zinc-800/60 rounded-3xl">
              <Trophy className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1">No se encontraron eventos en vivo</h3>
              <p className="text-xs text-zinc-400">
                Prueba cambiando de liga o eliminando el texto de búsqueda.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLiveMatches.map((m) => {
                const isLive = m.status === 'en_vivo';
                const isFinished = m.status === 'finalizado';

                return (
                  <div
                    key={m.id}
                    className={`p-5 rounded-2xl border transition flex flex-col justify-between shadow-xl relative overflow-hidden backdrop-blur-md ${
                      isLive
                        ? 'bg-gradient-to-b from-red-950/40 to-zinc-900/90 border-red-500/50 shadow-red-950/30'
                        : 'bg-zinc-900/90 border-zinc-800/80 hover:border-zinc-700/80'
                    }`}
                  >
                    <div>
                      {/* Cabecera de la Tarjeta */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider truncate">
                          {m.category || m.competition}
                        </span>
                        {isLive ? (
                          <span className="px-2 py-0.5 rounded-full bg-red-600/90 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            EN VIVO
                          </span>
                        ) : isFinished ? (
                          <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-[10px] font-bold">
                            Finalizado
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 text-zinc-300 text-xs font-semibold bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/60">
                            <Clock className="w-3 h-3 text-red-500" />
                            <span>{m.timeLocal || m.time} hs</span>
                          </div>
                        )}
                      </div>

                      {/* Título del Partido */}
                      <h3 className="text-base font-bold text-white mb-3 line-clamp-2">
                        {m.title}
                      </h3>
                    </div>

                    {/* Footer: Canales de Transmisión Limpios */}
                    <div className="mt-4 pt-3 border-t border-zinc-800/80">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Tv className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          {m.channels.map((ch, idx) => {
                            const isHls = ch.link.includes('.m3u8');
                            return (
                              <button
                                key={`${ch.link}_${idx}`}
                                onClick={() => handlePlayLiveChannel(m, ch)}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 ${
                                  isHls
                                    ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-600/60 shadow-emerald-950/40'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700/70'
                                }`}
                                title={
                                  isHls
                                    ? `Reproducir señal Full HD (HLS Directo) de ${ch.name}`
                                    : `Reproducir señal limpia de ${ch.name} (${ch.server})`
                                }
                              >
                                {isHls && <Sparkles className="w-2.5 h-2.5 text-emerald-400" />}
                                <span>{ch.name}</span>
                                <Play className="w-2.5 h-2.5 fill-current text-red-500" />
                              </button>
                            );
                          })}
                        </div>

                        {isLive && m.channels.length > 0 && (
                          <button
                            onClick={() => handlePlayLiveChannel(m, m.channels[0])}
                            className={`px-3 py-1 rounded-xl text-white text-xs font-bold transition flex items-center gap-1 shadow-md ${
                              m.channels[0].link.includes('.m3u8')
                                ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950'
                                : 'bg-red-600 hover:bg-red-500 shadow-red-950'
                            }`}
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>
                              {m.channels[0].link.includes('.m3u8')
                                ? 'Ver HLS Directo'
                                : 'Ver Señal #1'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Contenido: Repeticiones */}
      {viewMode === 'replays' && (
        <>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800/60 animate-pulse h-64" />
              ))}
            </div>
          ) : filteredReplays.length === 0 ? (
            <div className="p-12 text-center bg-zinc-900/50 border border-zinc-800/60 rounded-3xl">
              <Film className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1">No hay repeticiones disponibles</h3>
              <p className="text-xs text-zinc-400">Intenta buscando otro término o seleccionando otra liga.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredReplays.map((r) => (
                <div
                  key={r.id}
                  className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-700 transition shadow-xl flex flex-col justify-between group"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-black">
                    <img
                      src={r.img}
                      alt={r.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      loading="lazy"
                    />
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-white text-[10px] font-black border border-white/10 uppercase">
                      {r.league}
                    </div>
                    {r.date && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-zinc-300 text-[10px] font-bold border border-white/10">
                        {r.date}
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <h3 className="text-sm font-bold text-white mb-3 line-clamp-2">
                      {r.title}
                    </h3>

                    {/* Botones de Tiempo / Partes */}
                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                      {r.parts.map((part) => (
                        <button
                          key={part.name}
                          onClick={() => handlePlayReplayPart(r, part)}
                          className="flex-1 py-1.5 px-3 rounded-xl bg-zinc-800 hover:bg-red-600 text-zinc-200 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>{part.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
