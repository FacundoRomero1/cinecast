import React, { useState, useEffect, useMemo } from 'react';
import { Play, Cast, Radio, Search, RefreshCw, Tv, Activity, Sparkles, X, Globe } from 'lucide-react';
import { LiveSportsChannel, MediaItem } from '../types';
import { iptvService } from '../services/iptvService';
import { deviceSync } from '../services/deviceSync';

interface SportsLiveGridProps {
  onPlayChannel: (mediaItem: MediaItem) => void;
  onCastChannel: (mediaItem: MediaItem) => void;
  connectedScreenName?: string;
}

export const SportsLiveGrid: React.FC<SportsLiveGridProps> = ({
  onPlayChannel,
  onCastChannel,
  connectedScreenName = 'TV Sala',
}) => {
  const [channels, setChannels] = useState<LiveSportsChannel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCountry, setSelectedCountry] = useState<string>('AR');
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    iptvService.getSportsChannels().then((data) => {
      if (mounted) {
        setChannels(data);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await iptvService.fetchDynamicStreams();
      setChannels(updated);
    } catch (_) {
    } finally {
      setRefreshing(false);
    }
  };

  const countriesList = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ch of channels) {
      const c = ch.country || 'OT';
      counts[c] = (counts[c] || 0) + 1;
    }
    const top = Object.keys(counts).filter((c) => counts[c] >= 1 && c !== 'AR');
    return ['AR', 'all', ...top];
  }, [channels]);

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return channels.filter((ch) => {
      if (selectedCountry !== 'all' && ch.country !== selectedCountry) {
        return false;
      }
      if (q) {
        const nameMatch = ch.name.toLowerCase().includes(q);
        const countryMatch = (ch.countryName || '').toLowerCase().includes(q);
        const catMatch = (ch.category || '').toLowerCase().includes(q);
        if (!nameMatch && !countryMatch && !catMatch) return false;
      }
      return true;
    });
  }, [channels, searchQuery, selectedCountry]);

  const handleImageError = (id: string) => {
    setImgErrors((prev) => ({ ...prev, [id]: true }));
  };

  const getCountryLabel = (code: string) => {
    switch (code) {
      case 'AR':
        return '🇦🇷 Argentina (TV & Deportes)';
      case 'all':
        return '🌍 Todos los Canales';
      case 'MX':
        return '🇲🇽 México';
      case 'ES':
        return '🇪🇸 España';
      case 'CL':
        return '🇨🇱 Chile';
      case 'CO':
        return '🇨🇴 Colombia';
      case 'VE':
        return '🇻🇪 Venezuela';
      case 'CR':
        return '🇨🇷 Costa Rica';
      case 'UY':
        return '🇺🇾 Uruguay';
      case 'PE':
        return '🇵🇪 Perú';
      default:
        return code;
    }
  };

  const isRemote = deviceSync.getDeviceType() === 'remote';

  return (
    <div className="w-full space-y-6 pt-2 pb-16">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-red-950/80 via-zinc-900/90 to-zinc-950 p-6 sm:p-8 border border-red-900/40 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-red-600/20 text-red-400 border border-red-500/30 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                IPTV En Directo
              </span>
              <span className="text-xs text-zinc-400 font-medium">
                Señales oficiales sin cortes
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>⚽ Deportes y Fútbol en Vivo</span>
            </h2>
            <p className="text-sm text-zinc-300 mt-1 max-w-2xl">
              Canales deportivos en español transmitiendo en vivo: LaLiga, Liga MX, Torneo Argentino, Copa Libertadores, Fórmula 1 y polideportivo.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2.5 rounded-2xl bg-zinc-800/90 hover:bg-zinc-700 text-white border border-zinc-700 text-xs font-bold transition flex items-center gap-2 disabled:opacity-50 shadow-lg"
              title="Actualizar lista de streams desde iptv-org"
            >
              <RefreshCw className={`w-4 h-4 text-red-400 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Sincronizando...' : 'Actualizar Señales'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar canal, fútbol, país (ej: Claro, ESPN, Azteca)..."
            className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 text-white text-xs sm:text-sm placeholder-zinc-500 focus:outline-none focus:border-red-500 transition shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Total Badge */}
        <div className="text-xs font-semibold text-zinc-400 self-center">
          Mostrando <span className="text-white font-bold">{filteredChannels.length}</span> canales activos
        </div>
      </div>

      {/* Country Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
        {countriesList.map((code) => {
          const isActive = selectedCountry === code;
          return (
            <button
              key={code}
              onClick={() => setSelectedCountry(code)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${
                isActive
                  ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/30 scale-102'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {getCountryLabel(code)}
            </button>
          );
        })}
      </div>

      {/* Grid de Canales */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-red-600 border-t-transparent animate-spin" />
          <p className="text-xs text-zinc-400">Cargando canales deportivos desde IPTV-org API...</p>
        </div>
      ) : filteredChannels.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/40 rounded-3xl border border-zinc-800/80 p-8 max-w-md mx-auto">
          <Radio className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No se encontraron canales</h3>
          <p className="text-xs text-zinc-400 mb-4">
            No hay señales activas que coincidan con &quot;{searchQuery}&quot;.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCountry('all');
            }}
            className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-500 transition"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {filteredChannels.map((channel) => {
            const hasError = imgErrors[channel.id];
            const mediaItem = iptvService.channelToMediaItem(channel);
            const handleChannelAction = () => {
              if (isRemote) {
                onCastChannel(mediaItem);
              } else {
                onPlayChannel(mediaItem);
              }
            };

            return (
              <div
                key={channel.id}
                onClick={handleChannelAction}
                className="group relative bg-zinc-900/70 hover:bg-zinc-800/90 rounded-2xl border border-zinc-800/90 hover:border-red-500/60 p-4 transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl hover:shadow-red-950/30 flex flex-col justify-between overflow-hidden cursor-pointer"
              >
                {/* Live Badge Superior */}
                <div className="flex items-center justify-between mb-3">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-[10px] font-extrabold text-red-400 tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    VIVO
                  </span>
                  <span className="text-xs" title={channel.countryName}>
                    {channel.countryFlag}
                  </span>
                </div>

                {/* Logo del Canal */}
                <div className="h-20 sm:h-24 flex items-center justify-center p-2 mb-3 bg-black/40 rounded-xl border border-zinc-800/50">
                  {!hasError && channel.logo ? (
                    <img
                      src={channel.logo}
                      alt={channel.name}
                      onError={() => handleImageError(channel.id)}
                      className="max-h-full max-w-full object-contain filter drop-shadow group-hover:scale-105 transition"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-1">
                      <Tv className="w-8 h-8 text-red-500 mb-1" />
                      <span className="text-[10px] font-bold text-zinc-300 line-clamp-1">
                        {channel.name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info del Canal */}
                <div className="space-y-1 mb-3">
                  <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-red-400 transition truncate" title={channel.name}>
                    {channel.name}
                  </h4>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="truncate">{channel.countryName || channel.country}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/60 shrink-0">
                      {channel.quality || 'HD'}
                    </span>
                  </div>
                </div>

                {/* Botones de Acción */}
                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-zinc-800/80" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={handleChannelAction}
                    className="py-2 px-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center gap-1 transition shadow-md shadow-red-900/30"
                    title={isRemote ? `Transmitir directo a ${connectedScreenName}` : "Ver ahora en esta pantalla"}
                  >
                    {isRemote ? <Cast className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isRemote ? 'Transmitir' : 'Ver'}</span>
                  </button>

                  <button
                    onClick={() => onCastChannel(mediaItem)}
                    className="py-2 px-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1 transition border border-zinc-700/60"
                    title={`Transmitir a ${connectedScreenName}`}
                  >
                    <Cast className="w-3.5 h-3.5 text-red-400" />
                    <span className="hidden xs:inline">TV</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
