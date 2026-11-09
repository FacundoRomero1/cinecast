import React, { useState } from 'react';
import { X, Plus, Sparkles, Film, Tv, Radio, Search, Check, Play, Globe } from 'lucide-react';
import { Movie, StreamServer } from '../types';
import { extractStreamUrl, generateServersForMedia } from '../services/embedService';
import { tmdbService } from '../services/tmdbService';
import { mediaCatalog } from '../data/mediaCatalog';
import { deviceSync } from '../services/deviceSync';

interface CustomStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMediaAdded?: (newMovie: Movie, playImmediately?: boolean) => void;
}

export const CustomStreamModal: React.FC<CustomStreamModalProps> = ({
  isOpen,
  onClose,
  onMediaAdded,
}) => {
  const [rawInputUrl, setRawInputUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'movie' | 'series' | 'anime' | 'live_tv'>('movie');
  const [serverName, setServerName] = useState('Servidor 1 (Byseraguci / Embed)');
  const [serverLanguage, setServerLanguage] = useState('Latino');
  const [posterUrl, setPosterUrl] = useState('');
  const [backdropUrl, setBackdropUrl] = useState('');
  const [overview, setOverview] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [genres, setGenres] = useState<string[]>(['Estreno']);

  // Búsqueda en TMDB
  const [isSearchingTmdb, setIsSearchingTmdb] = useState(false);
  const [tmdbSearchResults, setTmdbSearchResults] = useState<any[]>([]);
  const [selectedTmdbId, setSelectedTmdbId] = useState<number>(0);

  if (!isOpen) return null;

  const handleUrlChange = (val: string) => {
    setRawInputUrl(val);
    const parsed = extractStreamUrl(val);

    // Detección automática sugerida para nombre de servidor
    if (parsed.url.includes('byseraguci')) {
      setServerName('Byseraguci VIP');
      setServerLanguage('Latino');
    } else if (parsed.url.includes('tudeporte') || parsed.url.includes('embedsports')) {
      setServerName('TuDeporte HD Live');
      setCategory('live_tv');
      setServerLanguage('En Vivo');
    } else if (parsed.url.includes('vidsrc')) {
      setServerName('VidSrc Stream');
      setServerLanguage('Multi-Sub');
    }
  };

  const handleSearchTmdb = async () => {
    if (!title.trim()) return;
    setIsSearchingTmdb(true);
    try {
      const data = await tmdbService.searchMovies(title);
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        setTmdbSearchResults(data.results.slice(0, 5));
      } else {
        setTmdbSearchResults([]);
      }
    } catch {
      setTmdbSearchResults([]);
    } finally {
      setIsSearchingTmdb(false);
    }
  };

  const handleSelectTmdbHit = (hit: any) => {
    setSelectedTmdbId(hit.id);
    setTitle(hit.title || hit.name || title);
    setOverview(hit.overview || '');
    if (hit.release_date) {
      setYear(parseInt(hit.release_date.slice(0, 4), 10) || new Date().getFullYear());
    }
    if (hit.poster_path) {
      setPosterUrl(tmdbService.getImageUrl(hit.poster_path, 'w500'));
    }
    if (hit.backdrop_path) {
      setBackdropUrl(tmdbService.getImageUrl(hit.backdrop_path, 'original'));
    }
    if (hit.genre_ids) {
      setGenres(tmdbService.mapGenreIds(hit.genre_ids));
    }
    setTmdbSearchResults([]);
  };

  const handleSave = (playImmediately = false) => {
    if (!rawInputUrl.trim() || !title.trim()) {
      alert('Por favor introduce un título y la URL o código iframe del video.');
      return;
    }

    const { url: cleanUrl, type: streamType } = extractStreamUrl(rawInputUrl);

    // Servidor principal creado por el usuario
    const mainServer: StreamServer = {
      name: serverName.trim() || 'Servidor 1',
      url: cleanUrl,
      type: streamType,
      language: serverLanguage,
    };

    // Servidores de respaldo automáticos si tenemos tmdbId
    const fallbackServers =
      selectedTmdbId > 0 && category !== 'live_tv'
        ? generateServersForMedia({
            tmdbId: selectedTmdbId,
            type: category === 'series' || category === 'anime' ? 'series' : 'movie',
          })
        : [];

    const allServers = [mainServer, ...fallbackServers.filter((s) => s.url !== cleanUrl)];

    const defaultBackdrop =
      backdropUrl ||
      posterUrl ||
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1400&auto=format&fit=crop';
    const defaultPoster =
      posterUrl ||
      'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=600&auto=format&fit=crop';

    const newMovie: Movie = {
      id: `custom-${Date.now()}`,
      tmdbId: selectedTmdbId,
      title: title.trim(),
      overview: overview.trim() || `Contenido agregado por el usuario en modo ${category}.`,
      posterPath: defaultPoster,
      posterUrl: defaultPoster,
      backdropPath: defaultBackdrop,
      releaseDate: `${year}-01-01`,
      year,
      genres: genres.length ? genres : [category === 'live_tv' ? 'Deportes' : 'Estreno'],
      genre: genres.length ? genres : [category === 'live_tv' ? 'Deportes' : 'Estreno'],
      runtime: category === 'live_tv' ? 180 : 120,
      voteAverage: 8.5,
      rating: 8.5,
      streamUrl: cleanUrl,
      streamType,
      quality: '1080p',
      source: 'custom_embed',
      category,
      addedAt: new Date().toISOString(),
      servers: allServers,
    };

    // Agregar al catálogo en memoria
    mediaCatalog.movies.unshift(newMovie);
    mediaCatalog.lastUpdated = new Date().toISOString();

    // Guardar en localStorage
    try {
      localStorage.setItem('cinecast_catalog_v7', JSON.stringify(mediaCatalog));
    } catch (_) {}

    // Sincronizar con dispositivos remotos (PC <-> Celular)
    try {
      deviceSync.sendCommand({
        action: 'addCustomStream',
        payload: newMovie,
      });
    } catch (_) {}

    if (onMediaAdded) {
      onMediaAdded(newMovie, playImmediately);
    }

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Fijo */}
        <div className="shrink-0 px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500 shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Agregar Enlace / Embed Propio</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                  VIP
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Pega URLs de servidores (Byseraguci, TuDeporte, VidSrc, iframes o MP4)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulario */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Input URL o Iframe */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              URL del Servidor o Código &lt;iframe&gt;
            </label>
            <textarea
              rows={2}
              value={rawInputUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="Ej: https://byseraguci.com/e/d3017p92266z  o  <iframe src='https://embedsports.me/...' allowfullscreen></iframe>"
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 font-mono"
            />
          </div>

          {/* Categoría */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              Categoría
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'movie', label: '🎬 Película', icon: Film },
                { id: 'series', label: '📺 Serie', icon: Tv },
                { id: 'anime', label: '⚡ Anime', icon: Sparkles },
                { id: 'live_tv', label: '⚽ Deporte / TV', icon: Radio },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id as any)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                    category === cat.id
                      ? 'bg-red-600 text-white border-red-500 shadow-md'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  <cat.icon className="w-3.5 h-3.5" />
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Título + Botón de TMDB */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Título del Contenido
              </label>
              <button
                type="button"
                onClick={handleSearchTmdb}
                disabled={!title.trim() || isSearchingTmdb}
                className="text-[11px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1 disabled:opacity-40"
              >
                <Search className="w-3 h-3" />
                <span>{isSearchingTmdb ? 'Buscando...' : 'Autocompletar con TMDB'}</span>
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Deadpool & Wolverine, TyC Sports en Vivo, Solo Leveling..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>

            {/* Resultados de búsqueda TMDB si hay */}
            {tmdbSearchResults.length > 0 && (
              <div className="mt-2 p-2 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider px-2">
                  Resultados encontrados en TMDB:
                </span>
                {tmdbSearchResults.map((hit) => (
                  <div
                    key={hit.id}
                    onClick={() => handleSelectTmdbHit(hit)}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800 cursor-pointer transition text-xs"
                  >
                    {hit.poster_path ? (
                      <img
                        src={tmdbService.getImageUrl(hit.poster_path, 'w200')}
                        alt=""
                        className="w-7 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-7 h-10 bg-zinc-800 rounded flex items-center justify-center text-zinc-500">
                        <Film className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white truncate">{hit.title || hit.name}</p>
                      <p className="text-[10px] text-zinc-400 truncate">
                        {hit.release_date ? hit.release_date.slice(0, 4) : ''} • Coincidencia TMDB
                      </p>
                    </div>
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nombre de Servidor e Idioma */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                Nombre del Servidor
              </label>
              <input
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Ej: Byseraguci VIP, Servidor 1"
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                Idioma / Audio
              </label>
              <select
                value={serverLanguage}
                onChange={(e) => setServerLanguage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-red-500"
              >
                <option value="Latino">Español Latino</option>
                <option value="Subtitulado">Subtitulado (Vose)</option>
                <option value="Castellano">Castellano</option>
                <option value="En Vivo">En Vivo (Señal Directa)</option>
                <option value="Original">Audio Original</option>
              </select>
            </div>
          </div>

          {/* Carátula / Póster (Opcional) */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              URL del Póster / Carátula (Opcional)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={posterUrl}
                onChange={(e) => setPosterUrl(e.target.value)}
                placeholder="https://... o autocompletada por TMDB"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-red-500"
              />
              {posterUrl && (
                <img
                  src={posterUrl}
                  alt="Vista previa"
                  className="w-10 h-14 object-cover rounded-lg border border-zinc-700 shrink-0"
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer / Botones */}
        <div className="p-5 border-t border-zinc-800 bg-zinc-950/90 flex flex-col sm:flex-row gap-2.5 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 border border-zinc-700"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Guardar en Catálogo</span>
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg shadow-red-900/30"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Guardar & Reproducir Ahora</span>
          </button>
        </div>
      </div>
    </div>
  );
};
