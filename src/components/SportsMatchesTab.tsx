import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Clock, Tv, RefreshCw, Trophy, Radio, ExternalLink, Play } from 'lucide-react';
import { MediaItem } from '../types';
import { iptvService } from '../services/iptvService';

export interface SportsMatch {
  id: string;
  name: string;
  date: string;
  timestamp: number;
  league: string;
  leagueSlug: string;
  isLive: boolean;
  isFinished: boolean;
  status: string;
  clock: string;
  channels: string[];
  homeTeam: {
    id?: string;
    name: string;
    shortName: string;
    logo: string | null;
    score: string | number;
  };
  awayTeam: {
    id?: string;
    name: string;
    shortName: string;
    logo: string | null;
    score: string | number;
  };
}

interface SportsMatchesTabProps {
  onPlayChannel: (mediaItem: MediaItem) => void;
  onCastChannel?: (mediaItem: MediaItem) => void;
}

export const SportsMatchesTab: React.FC<SportsMatchesTabProps> = ({
  onPlayChannel,
}) => {
  const [matches, setMatches] = useState<SportsMatch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeLeague, setActiveLeague] = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchMatches = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch('/api/sports/matches');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.matches)) {
          setMatches(data.matches);
          setLastUpdated(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
      }
    } catch (err) {
      console.warn('[SportsMatchesTab] Error al cargar partidos:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  // Carga inicial y refresco automático cada 60 segundos
  useEffect(() => {
    fetchMatches();
    const timer = setInterval(() => {
      fetchMatches();
    }, 60000);
    return () => clearInterval(timer);
  }, [fetchMatches]);

  const leagueOptions = [
    { slug: 'all', label: '🏆 Todas las Ligas' },
    { slug: 'arg.1', label: '🇦🇷 Liga Profesional' },
    { slug: 'arg.copa', label: '🏆 Copa Argentina' },
    { slug: 'conmebol.libertadores', label: '⭐ Copa Libertadores' },
    { slug: 'conmebol.sudamericana', label: '🔴 Copa Sudamericana' },
  ];

  const filteredMatches = useMemo(() => {
    if (activeLeague === 'all') return matches;
    return matches.filter((m) => m.leagueSlug === activeLeague);
  }, [matches, activeLeague]);

  const handleOpenChannel = async (channelName: string) => {
    try {
      const allChannels = await iptvService.getSportsChannels();
      const norm = channelName.toLowerCase();
      const found = allChannels.find((ch) =>
        ch.name.toLowerCase().includes(norm) ||
        norm.includes(ch.name.toLowerCase()) ||
        (ch.category && ch.category.toLowerCase().includes(norm))
      ) || allChannels.find((ch) => ch.country === 'AR');

      if (found) {
        const item = iptvService.channelToMediaItem(found);
        onPlayChannel(item);
      }
    } catch (_) {}
  };

  const formatMatchTime = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      return d.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      }) + ' hs';
    } catch {
      return '';
    }
  };

  const formatMatchDate = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      const today = new Date();
      const isToday =
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

      if (isToday) return 'Hoy';

      return d.toLocaleDateString('es-AR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'America/Argentina/Buenos_Aires',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="pt-24 px-4 sm:px-10 max-w-7xl mx-auto pb-16">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Partidos & Fútbol Argentino
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400">
            Agenda oficial de partidos en vivo y próximos 7 días con canales de transmisión directa.
            {lastUpdated && <span className="text-zinc-500 ml-2">Actualizado: {lastUpdated} (cada 60s)</span>}
          </p>
        </div>

        <button
          onClick={() => fetchMatches(true)}
          disabled={refreshing}
          className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-bold transition flex items-center gap-2 shrink-0 self-start sm:self-auto shadow-lg"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-red-500' : 'text-zinc-400'}`} />
          <span>{refreshing ? 'Actualizando...' : 'Refrescar'}</span>
        </button>
      </div>

      {/* Selector de Ligas */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 scrollbar-none">
        {leagueOptions.map((opt) => (
          <button
            key={opt.slug}
            onClick={() => setActiveLeague(opt.slug)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition border shadow-sm ${
              activeLeague === opt.slug
                ? 'bg-red-600 text-white border-red-500 shadow-red-900/40'
                : 'bg-zinc-900/90 text-zinc-400 border-zinc-800/80 hover:text-white hover:border-zinc-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Grilla de Partidos */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800/60 animate-pulse h-48" />
          ))}
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className="p-12 text-center bg-zinc-900/50 border border-zinc-800/60 rounded-3xl">
          <Trophy className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No hay partidos programados en esta liga</h3>
          <p className="text-xs text-zinc-400">Selecciona otra competencia para ver los próximos encuentros de la semana.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMatches.map((m) => {
            const isLive = m.isLive;
            const matchDate = formatMatchDate(m.date);
            const matchTime = formatMatchTime(m.date);

            return (
              <div
                key={m.id}
                className={`p-5 rounded-2xl border transition flex flex-col justify-between shadow-xl relative overflow-hidden backdrop-blur-md ${
                  isLive
                    ? 'bg-gradient-to-b from-red-950/30 to-zinc-900/90 border-red-500/50 shadow-red-950/30'
                    : 'bg-zinc-900/90 border-zinc-800/80 hover:border-zinc-700/80'
                }`}
              >
                {/* Header de la tarjeta */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider truncate">
                      {m.league}
                    </span>
                    {isLive ? (
                      <span className="px-2 py-0.5 rounded-full bg-red-600/90 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        EN VIVO {m.clock && `(${m.clock})`}
                      </span>
                    ) : m.isFinished ? (
                      <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-[10px] font-bold">
                        Finalizado
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 text-zinc-300 text-xs font-semibold bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/60">
                        <Calendar className="w-3 h-3 text-red-500" />
                        <span>{matchDate}</span>
                        <span>•</span>
                        <Clock className="w-3 h-3 text-red-500" />
                        <span>{matchTime}</span>
                      </div>
                    )}
                  </div>

                  {/* Equipos y Marcador */}
                  <div className="space-y-3 my-2">
                    {/* Local */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {m.homeTeam.logo ? (
                          <img
                            src={m.homeTeam.logo}
                            alt={m.homeTeam.name}
                            className="w-7 h-7 object-contain shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                            {m.homeTeam.shortName.slice(0, 3)}
                          </div>
                        )}
                        <span className="text-sm font-bold text-white truncate">{m.homeTeam.name}</span>
                      </div>
                      <span className="text-lg font-black text-white shrink-0 font-mono">
                        {m.homeTeam.score}
                      </span>
                    </div>

                    {/* Visitante */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {m.awayTeam.logo ? (
                          <img
                            src={m.awayTeam.logo}
                            alt={m.awayTeam.name}
                            className="w-7 h-7 object-contain shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                            {m.awayTeam.shortName.slice(0, 3)}
                          </div>
                        )}
                        <span className="text-sm font-bold text-white truncate">{m.awayTeam.name}</span>
                      </div>
                      <span className="text-lg font-black text-white shrink-0 font-mono">
                        {m.awayTeam.score}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer: Canales de transmisión */}
                <div className="mt-4 pt-3 border-t border-zinc-800/80">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Tv className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      {m.channels.map((ch) => (
                        <button
                          key={ch}
                          onClick={() => handleOpenChannel(ch)}
                          className="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-[11px] font-bold text-zinc-300 hover:text-white transition flex items-center gap-1"
                          title={`Ver señal en vivo de ${ch}`}
                        >
                          <span>{ch}</span>
                          <Play className="w-2.5 h-2.5 fill-current text-red-500" />
                        </button>
                      ))}
                    </div>

                    {isLive && (
                      <button
                        onClick={() => handleOpenChannel(m.channels[0] || 'TyC Sports')}
                        className="px-3 py-1 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition flex items-center gap-1 shadow-md shadow-red-950"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Ver Vivo</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
