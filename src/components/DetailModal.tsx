import React, { useState, useEffect } from 'react';
import { MediaItem, Episode } from '../types';
import {
  Play,
  Tv,
  Plus,
  Check,
  X,
  ThumbsUp,
  Clock,
  Film,
  Sparkles,
  Dices,
  Flame,
  User,
  Youtube,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';
import { createStyledPosterFallback } from '../utils/imageUtils';
import { generateServersForMedia } from '../services/embedService';
import { deviceSync } from '../services/deviceSync';

interface CastMember {
  name: string;
  character: string;
  photo: string | null;
}

interface CollectionPart {
  id: string;
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number;
  voteAverage: number;
}

interface DetailModalProps {
  media: MediaItem | null;
  onClose: () => void;
  onPlayLocal: (media: MediaItem, episode?: Episode) => void;
  onCastToScreen: (media: MediaItem, episode?: Episode) => void;
  connectedScreenName?: string;
  isMyList: boolean;
  onToggleMyList: (mediaId: string) => void;
  allCatalog?: MediaItem[];
  onSelectSimilar?: (item: MediaItem) => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  media,
  onClose,
  onPlayLocal,
  onCastToScreen,
  connectedScreenName = 'PC Dormitorio',
  isMyList,
  onToggleMyList,
  onSelectSimilar,
}) => {
  if (!media) return null;

  const isMovie = (media as any).mediaType === 'movie' || media.type === 'movie' || media.category === 'movie';
  const isSeries = !isMovie && (media.type === 'series' || media.category === 'series' || media.category === 'anime' || (media as any).mediaType === 'tv');

  const [detailedData, setDetailedData] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(true);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>(media.episodes || []);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);
  const [liked, setLiked] = useState<boolean>(false);
  const [showTrailer, setShowTrailer] = useState<boolean>(false);
  const [randomToast, setRandomToast] = useState<string | null>(null);

  // TAREA 5: Modo Maratón persistente
  const [marathonMode, setMarathonMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_marathon_mode') === 'true';
    } catch {
      return false;
    }
  });

  const toggleMarathonMode = () => {
    setMarathonMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinecast_marathon_mode', String(next));
      } catch (_) {}
      return next;
    });
  };

  // Cargar detalles completos desde /api/media/:type/:id
  useEffect(() => {
    let cancelled = false;
    const fetchDetails = async () => {
      setLoadingDetails(true);
      try {
        const type = isSeries ? 'tv' : 'movie';
        const id = media.tmdbId || media.id;
        const res = await fetch(`/api/media/${type}/${id}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setDetailedData(data);
          if (data.seasons && data.seasons.length > 0) {
            setSelectedSeason(data.seasons[0].seasonNumber || 1);
          }
        }
      } catch (err) {
        console.warn('Error cargando detalles del título:', err);
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [media.id, media.tmdbId, isSeries]);

  // Cargar episodios por temporada si es serie
  useEffect(() => {
    if (!isSeries) return;
    let cancelled = false;

    const fetchEpisodes = async () => {
      const tmdbId = media.tmdbId || (detailedData && detailedData.tmdbId);
      if (!tmdbId) return;

      setLoadingEpisodes(true);
      try {
        const res = await fetch(`/api/tv/${tmdbId}/season/${selectedSeason}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (Array.isArray(data.episodes) && data.episodes.length > 0) {
            const mapped: Episode[] = data.episodes.map((ep: any) => ({
              id: `ep-${tmdbId}-s${selectedSeason}-e${ep.episode_number}`,
              title: ep.name || `Episodio ${ep.episode_number}`,
              overview: ep.overview || `Temporada ${selectedSeason}, Episodio ${ep.episode_number}`,
              duration: ep.runtime ? `${ep.runtime} min` : '24m',
              thumbnailUrl: ep.still_path
                ? `https://image.tmdb.org/t/p/w300${ep.still_path}`
                : media.backdropUrl || media.posterUrl,
              seasonNumber: selectedSeason,
              episodeNumber: ep.episode_number,
            }));
            setSeasonEpisodes(mapped);
            return;
          }
        }
      } catch (err) {
        console.warn('Error cargando episodios de temporada:', err);
      } finally {
        if (!cancelled) setLoadingEpisodes(false);
      }

      // Fallback a los episodios base de media si falla la API
      if (media.episodes && media.episodes.length > 0) {
        setSeasonEpisodes(media.episodes);
      }
    };

    fetchEpisodes();
    return () => {
      cancelled = true;
    };
  }, [selectedSeason, media.tmdbId, media.id, isSeries, detailedData]);

  // TAREA 5: Capítulo Random
  const handleRandomEpisode = async () => {
    const seasonsList = detailedData?.seasons || [];
    let targetSeason = 1;
    let targetEpisodeNum = 1;

    if (seasonsList.length > 0) {
      const randomSeasonObj = seasonsList[Math.floor(Math.random() * seasonsList.length)];
      targetSeason = randomSeasonObj.seasonNumber || 1;
      const count = randomSeasonObj.episodeCount || 12;
      targetEpisodeNum = Math.floor(Math.random() * count) + 1;
    } else if (seasonEpisodes.length > 0) {
      targetSeason = selectedSeason;
      targetEpisodeNum = Math.floor(Math.random() * seasonEpisodes.length) + 1;
    } else {
      targetSeason = 1;
      targetEpisodeNum = Math.floor(Math.random() * 12) + 1;
    }

    const toastMsg = `🎲 Empezando en T${targetSeason}:E${targetEpisodeNum} (aleatorio)`;
    setRandomToast(toastMsg);

    const randomEp: Episode = {
      id: `ep-${media.id}-s${targetSeason}-e${targetEpisodeNum}`,
      title: `Episodio ${targetEpisodeNum}`,
      overview: `Temporada ${targetSeason}, Episodio ${targetEpisodeNum}`,
      duration: '24m',
      thumbnailUrl: media.backdropUrl || media.posterUrl || '',
      videoUrl: '',
      seasonNumber: targetSeason,
      episodeNumber: targetEpisodeNum,
    };

    const enrichedMedia: MediaItem = {
      ...media,
      servers: media.servers && media.servers.length > 0
        ? media.servers
        : generateServersForMedia({
            tmdbId: media.tmdbId,
            type: 'series',
            season: targetSeason,
            episode: targetEpisodeNum,
          }),
    };

    const isRemoteDevice = deviceSync.getDeviceType() === 'remote';

    if (isRemoteDevice) {
      deviceSync.sendCommand({
        action: 'randomEpisode',
        payload: {
          mediaItem: enrichedMedia,
          season: targetSeason,
          episode: targetEpisodeNum,
          episodeItem: randomEp,
        },
      });
      setTimeout(() => {
        onClose();
      }, 700);
      return;
    }

    setTimeout(() => {
      onPlayLocal(enrichedMedia, randomEp);
      onClose();
    }, 900);
  };

  const effectiveTitle = detailedData?.title || media.title;
  const effectiveOriginalTitle = detailedData?.originalTitle || media.originalTitle;
  const effectiveOverview = detailedData?.overview || media.overview;
  const effectiveDirector = detailedData?.director || media.creatorOrDirector;
  const effectiveCast: CastMember[] = detailedData?.cast || (media.cast || []).map((name) => ({ name, character: '', photo: null }));
  const effectiveTrailerKey = detailedData?.trailerKey || null;
  const effectiveCollection = detailedData?.collection || null;
  const effectiveRecommendations = detailedData?.recommendations || [];
  const effectiveRuntime = detailedData?.runtime || (media as any).duration || 120;
  const effectiveYear = detailedData?.year || media.year;
  const effectiveRating = detailedData?.voteAverage || media.ratingBadge || 8.0;
  const effectiveGenres = detailedData?.genres || media.genres || [];

  const handleStartPlay = (ep?: Episode) => {
    const targetEpisode = ep || (isSeries ? seasonEpisodes[0] || null : undefined);
    const enrichedMedia: MediaItem = {
      ...media,
      title: effectiveTitle,
      overview: effectiveOverview,
      servers: media.servers && media.servers.length > 0
        ? media.servers
        : generateServersForMedia({
            tmdbId: media.tmdbId,
            type: isSeries ? 'series' : 'movie',
            season: targetEpisode?.seasonNumber || 1,
            episode: targetEpisode?.episodeNumber || 1,
          }),
    };
    onPlayLocal(enrichedMedia, targetEpisode || undefined);
    onClose();
  };

  const handleStartCast = (ep?: Episode) => {
    const targetEpisode = ep || (isSeries ? seasonEpisodes[0] || null : undefined);
    const enrichedMedia: MediaItem = {
      ...media,
      title: effectiveTitle,
      overview: effectiveOverview,
      servers: media.servers && media.servers.length > 0
        ? media.servers
        : generateServersForMedia({
            tmdbId: media.tmdbId,
            type: isSeries ? 'series' : 'movie',
            season: targetEpisode?.seasonNumber || 1,
            episode: targetEpisode?.episodeNumber || 1,
          }),
    };
    onCastToScreen(enrichedMedia, targetEpisode || undefined);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      {randomToast && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl bg-red-600 text-white font-black text-sm shadow-2xl border border-red-400 animate-bounce">
          {randomToast}
        </div>
      )}

      <div
        className="relative bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl text-white my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-zinc-950/75 hover:bg-zinc-800 text-white transition backdrop-blur-md border border-zinc-700/60"
          title="Cerrar ficha"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="overflow-y-auto max-h-[92vh]">
          {/* Header Billboard / Trailer */}
          <div className="relative h-72 sm:h-96 w-full bg-black">
            {showTrailer && effectiveTrailerKey ? (
              <div className="w-full h-full relative">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${effectiveTrailerKey}?autoplay=1&rel=0&modestbranding=1`}
                  title={`Tráiler de ${effectiveTitle}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
                <button
                  onClick={() => setShowTrailer(false)}
                  className="absolute bottom-4 right-4 z-20 px-3 py-1.5 rounded-xl bg-black/80 hover:bg-black text-white text-xs font-bold border border-zinc-700 flex items-center gap-1.5"
                >
                  <X size={14} />
                  <span>Cerrar Tráiler</span>
                </button>
              </div>
            ) : (
              <>
                <img
                  src={media.backdropUrl || media.posterUrl}
                  alt={effectiveTitle}
                  onError={(e) => {
                    e.currentTarget.src = createStyledPosterFallback(effectiveTitle, media.category);
                  }}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-transparent to-transparent hidden sm:block" />

                {/* Bottom Header Overlay Info */}
                <div className="absolute bottom-6 left-6 right-6">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {media.isOriginal && (
                      <span className="text-red-500 font-extrabold tracking-wider text-xs uppercase flex items-center gap-1 font-mono">
                        <Film className="w-3.5 h-3.5" />
                        CINECAST VIP
                      </span>
                    )}
                    {effectiveOriginalTitle && effectiveOriginalTitle !== effectiveTitle && (
                      <span className="text-xs text-zinc-400 font-medium italic">
                        ({effectiveOriginalTitle})
                      </span>
                    )}
                  </div>

                  <h1 className="text-2xl sm:text-4xl font-extrabold text-white drop-shadow-md mb-3">
                    {effectiveTitle}
                  </h1>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Botón Grande Reproducir */}
                    <button
                      onClick={() => handleStartPlay()}
                      className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black text-sm transition flex items-center gap-2 shadow-xl shadow-red-900/40 transform hover:scale-102"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Reproducir</span>
                    </button>

                    <button
                      onClick={() => handleStartCast()}
                      className="px-5 py-3 bg-zinc-800/90 hover:bg-zinc-700 text-white rounded-2xl font-bold text-xs sm:text-sm transition flex items-center gap-2 border border-zinc-700 shadow-lg"
                    >
                      <Tv className="w-4 h-4 text-emerald-400" />
                      <span>Ver en {connectedScreenName}</span>
                    </button>

                    {/* TAREA 5: Botón Capítulo Random para Series */}
                    {isSeries && (
                      <button
                        onClick={handleRandomEpisode}
                        className="px-4 py-3 bg-amber-600/90 hover:bg-amber-500 text-white rounded-2xl font-bold text-xs sm:text-sm transition flex items-center gap-1.5 shadow-lg border border-amber-400/50"
                        title="Elegir un capítulo al azar de toda la serie"
                      >
                        <Dices className="w-4 h-4" />
                        <span>🎲 Capítulo random</span>
                      </button>
                    )}

                    {/* Botón Ver Tráiler si existe */}
                    {effectiveTrailerKey && (
                      <button
                        onClick={() => setShowTrailer(true)}
                        className="px-4 py-3 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 rounded-2xl font-bold text-xs sm:text-sm transition flex items-center gap-1.5 border border-zinc-700"
                      >
                        <Youtube className="w-4 h-4 text-red-500" />
                        <span>Ver Tráiler</span>
                      </button>
                    )}

                    <button
                      onClick={() => onToggleMyList(media.id)}
                      className={`p-3 rounded-2xl border transition ${
                        isMyList
                          ? 'bg-zinc-800 text-red-500 border-red-500/50'
                          : 'bg-zinc-900/80 hover:bg-zinc-800 text-white border-zinc-700'
                      }`}
                      title={isMyList ? 'En tu lista' : 'Agregar a mi lista'}
                    >
                      {isMyList ? <Check className="w-5 h-5 text-red-500" /> : <Plus className="w-5 h-5" />}
                    </button>

                    <button
                      onClick={() => setLiked(!liked)}
                      className={`p-3 rounded-2xl border transition ${
                        liked
                          ? 'bg-zinc-800 text-red-500 border-red-500/50'
                          : 'bg-zinc-900/80 hover:bg-zinc-800 text-white border-zinc-700'
                      }`}
                      title="Me gusta"
                    >
                      <ThumbsUp className={`w-5 h-5 ${liked ? 'fill-current text-red-500' : ''}`} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Body Content */}
          <div className="p-6 space-y-6">
            {/* Meta Row: Score, Year, Duration, Genres, Marathon Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-emerald-400 font-bold text-sm flex items-center gap-1">
                  ⭐ {effectiveRating}
                </span>
                <span className="text-zinc-400 font-semibold">{effectiveYear}</span>
                {effectiveRuntime && (
                  <span className="text-zinc-400 flex items-center gap-1 font-mono">
                    <Clock size={13} />
                    {typeof effectiveRuntime === 'number' ? `${effectiveRuntime} min` : effectiveRuntime}
                  </span>
                )}
                <div className="flex items-center gap-1 flex-wrap">
                  {effectiveGenres.map((g: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-medium text-[11px] border border-zinc-700"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>

              {/* TAREA 5: Modo Maratón Toggle */}
              {isSeries && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleMarathonMode}
                    className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
                      marathonMode
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-lg shadow-emerald-950/30'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                    title="Modo Maratón: Salta automáticamente de capítulo sin cuenta atrás y pasa de temporada"
                  >
                    <span>🏃</span>
                    <span>Modo Maratón</span>
                    {marathonMode && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  </button>
                </div>
              )}
            </div>

            {/* Sinopsis y Ficha Técnica */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Sinopsis</h3>
                <p className="text-zinc-300 text-sm sm:text-base leading-relaxed">
                  {effectiveOverview || 'Sinopsis no disponible en español.'}
                </p>
              </div>

              <div className="space-y-3 text-xs border-t md:border-t-0 md:border-l border-zinc-800 pt-4 md:pt-0 md:pl-6 text-zinc-400">
                {effectiveDirector && (
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Dirección / Creador:</span>
                    <p className="text-zinc-200 font-medium">{effectiveDirector}</p>
                  </div>
                )}
                <div>
                  <span className="text-zinc-500 block mb-0.5">Calidad de Video:</span>
                  <p className="text-zinc-200 font-mono">4K Ultra HD • HDR10</p>
                </div>
                <div>
                  <span className="text-zinc-500 block mb-0.5">Audio & Subtítulos:</span>
                  <p className="text-zinc-200">Español Latino • Castellano • Original (Sub ES)</p>
                </div>
              </div>
            </div>

            {/* Reparto Principal con Fotos */}
            {effectiveCast && effectiveCast.length > 0 && (
              <div className="pt-4 border-t border-zinc-800 space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <User size={15} />
                  <span>Reparto Principal ({effectiveCast.length})</span>
                </h3>
                <div className="flex gap-3 overflow-x-auto pb-3 pt-1 no-scrollbar">
                  {effectiveCast.map((actor, idx) => (
                    <div
                      key={idx}
                      className="w-24 sm:w-28 shrink-0 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-2 text-center flex flex-col items-center justify-between shadow"
                    >
                      <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-full overflow-hidden bg-zinc-800 mb-2 border border-zinc-700/60 shrink-0">
                        {actor.photo ? (
                          <img
                            src={actor.photo}
                            alt={actor.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <User size={24} />
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-zinc-100 line-clamp-1">{actor.name}</p>
                      {actor.character && (
                        <p className="text-[10px] text-zinc-500 line-clamp-1 italic">{actor.character}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SECCIÓN: Saga / Precuelas y Secuelas (si belongs_to_collection) */}
            {effectiveCollection && effectiveCollection.parts && effectiveCollection.parts.length > 0 && (
              <div className="pt-4 border-t border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                    <Layers size={16} />
                    <span>Saga: {effectiveCollection.name}</span>
                  </h3>
                  <span className="text-xs text-zinc-500">{effectiveCollection.parts.length} entregas</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-3 pt-1 no-scrollbar">
                  {effectiveCollection.parts.map((part: CollectionPart) => {
                    const isCurrent = Number(part.tmdbId) === Number(media.tmdbId);
                    return (
                      <div
                        key={part.id}
                        onClick={() => {
                          if (!isCurrent && onSelectSimilar) {
                            onSelectSimilar({
                              id: part.id,
                              tmdbId: part.tmdbId,
                              title: part.title,
                              posterUrl: part.posterUrl || '',
                              backdropUrl: part.backdropUrl || part.posterUrl || '',
                              videoUrl: '',
                              year: part.year,
                              type: 'movie',
                              category: 'movie',
                              genres: media.genres,
                              overview: '',
                              cast: [],
                              creatorOrDirector: '',
                              isOriginal: false,
                              matchScore: 95,
                              ratingBadge: 'HD',
                              qualityBadge: '1080p',
                            });
                          }
                        }}
                        className={`w-32 sm:w-36 shrink-0 rounded-2xl overflow-hidden bg-zinc-950 border transition transform ${
                          isCurrent
                            ? 'border-red-500 shadow-lg shadow-red-900/30 ring-2 ring-red-500/50'
                            : 'border-zinc-800 hover:border-zinc-600 hover:scale-102 cursor-pointer'
                        }`}
                      >
                        <div className="aspect-[2/3] relative bg-zinc-800">
                          {part.posterUrl ? (
                            <img src={part.posterUrl} alt={part.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs p-2 text-center text-zinc-400">
                              {part.title}
                            </div>
                          )}
                          {isCurrent && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-black uppercase">
                              Viendo
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-semibold text-white truncate">{part.title}</p>
                          <p className="text-[10px] text-zinc-400">{part.year}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECCIÓN: Selector de Temporadas y Lista de Episodios (si es Serie / Anime) */}
            {isSeries && (
              <div className="pt-4 border-t border-zinc-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-white">Episodios</h3>
                    {detailedData?.seasons && detailedData.seasons.length > 1 && (
                      <select
                        value={selectedSeason}
                        onChange={(e) => setSelectedSeason(Number(e.target.value))}
                        className="px-3 py-1.5 bg-zinc-800 text-white text-xs font-bold rounded-xl border border-zinc-700 focus:outline-none focus:border-red-500"
                      >
                        {detailedData.seasons.map((s: any) => (
                          <option key={s.seasonNumber} value={s.seasonNumber}>
                            {s.name} ({s.episodeCount} eps)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="text-xs text-zinc-400 font-medium">
                    {loadingEpisodes
                      ? 'Cargando lista de capítulos...'
                      : `${seasonEpisodes.length} capítulos disponibles`}
                  </div>
                </div>

                {loadingEpisodes ? (
                  <div className="flex items-center justify-center py-10 gap-3 text-zinc-400 text-xs">
                    <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    <span>Cargando episodios de la temporada {selectedSeason}...</span>
                  </div>
                ) : seasonEpisodes.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-zinc-950/70 border border-zinc-800 text-center space-y-2">
                    <div className="text-3xl">⚠️</div>
                    <p className="text-sm font-bold text-zinc-200">Sin episodios disponibles</p>
                    <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                      Esta serie no cuenta con capítulos registrados en el servidor para la temporada seleccionada.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {seasonEpisodes.map((ep) => (
                      <div
                        key={ep.id}
                        className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 hover:bg-zinc-800/60 hover:border-zinc-700 transition flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group"
                      >
                        <div className="flex gap-4 items-start sm:items-center min-w-0">
                          {/* Thumbnail */}
                          <div
                            onClick={() => handleStartPlay(ep)}
                            className="relative w-28 h-18 sm:w-36 sm:h-20 rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-zinc-800 cursor-pointer"
                          >
                            <img
                              src={ep.thumbnailUrl}
                              alt={ep.title}
                              onError={(e) => {
                                e.currentTarget.src = createStyledPosterFallback(`${effectiveTitle} - ${ep.title}`, media.category);
                              }}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            />
                            <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="p-2 rounded-full bg-black/60 text-white backdrop-blur-sm group-hover:bg-red-600 transition">
                                <Play className="w-3.5 h-3.5 fill-current" />
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-zinc-100 truncate">
                                {ep.episodeNumber ? `E${ep.episodeNumber}: ` : ''}
                                {ep.title}
                              </h4>
                              {ep.duration && (
                                <span className="text-[11px] text-zinc-400 shrink-0 font-mono">
                                  {ep.duration}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                              {ep.overview}
                            </p>
                          </div>
                        </div>

                        {/* Botones de acción del episodio */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleStartPlay(ep)}
                            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl transition"
                          >
                            Ver aquí
                          </button>
                          <button
                            onClick={() => handleStartCast(ep)}
                            className="px-3.5 py-1.5 bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold rounded-xl transition flex items-center gap-1 shadow"
                          >
                            <Tv className="w-3.5 h-3.5" />
                            <span>PC</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN: Recomendaciones Inteligentes (TAREA 4) */}
            {effectiveRecommendations && effectiveRecommendations.length > 0 && (
              <div className="pt-4 border-t border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Sparkles size={16} />
                    <span>Recomendados para ti</span>
                  </h3>
                  <span className="text-xs text-zinc-500">{effectiveRecommendations.length} títulos</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-3 pt-1 no-scrollbar">
                  {effectiveRecommendations.map((rec: any) => (
                    <div
                      key={rec.id}
                      onClick={() => {
                        if (onSelectSimilar) {
                          onSelectSimilar({
                            id: rec.id,
                            tmdbId: rec.tmdbId,
                            title: rec.title,
                            posterUrl: rec.posterUrl || '',
                            backdropUrl: rec.backdropUrl || rec.posterUrl || '',
                            videoUrl: '',
                            year: rec.year || 2024,
                            type: rec.category === 'series' ? 'series' : 'movie',
                            category: rec.category || 'movie',
                            genres: media.genres,
                            overview: '',
                            cast: [],
                            creatorOrDirector: '',
                            isOriginal: false,
                            matchScore: 92,
                            ratingBadge: 'HD',
                            qualityBadge: '1080p',
                          });
                        }
                      }}
                      className="w-32 sm:w-36 shrink-0 rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 hover:border-amber-500/70 hover:scale-102 cursor-pointer transition shadow"
                    >
                      <div className="aspect-[2/3] relative bg-zinc-800">
                        {rec.posterUrl ? (
                          <img src={rec.posterUrl} alt={rec.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs p-2 text-center text-zinc-400">
                            {rec.title}
                          </div>
                        )}
                        {rec.voteAverage && (
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-amber-300 text-[10px] font-bold">
                            ⭐ {rec.voteAverage}
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-semibold text-white truncate">{rec.title}</p>
                        <p className="text-[10px] text-zinc-400">{rec.year}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
