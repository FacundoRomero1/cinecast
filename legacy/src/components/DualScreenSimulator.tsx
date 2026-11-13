import React from 'react';
import { PlaybackState, MediaItem, Episode, AudioSettings, PlaybackSettings, RemoteCommand } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { AmbientScreen } from './AmbientScreen';
import { RemoteControlSheet } from './RemoteControlSheet';
import { Smartphone, Monitor, X, Sparkles, Volume2, Sliders } from 'lucide-react';

interface DualScreenSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  playbackState: PlaybackState;
  currentMedia: MediaItem | null;
  currentEpisode: Episode | null;
  catalog: MediaItem[];
  onSendCommand: (cmd: RemoteCommand) => void;
  onUpdateAudio: (audio: Partial<AudioSettings>) => void;
  onUpdatePlayback: (playback: Partial<PlaybackSettings>) => void;
  onOpenAudioModal: () => void;
  onOpenCastModal: () => void;
  onPlayMedia: (media: MediaItem, episode?: Episode) => void;
  onNextEpisode: () => void;
}

export const DualScreenSimulator: React.FC<DualScreenSimulatorProps> = ({
  isOpen,
  onClose,
  playbackState,
  currentMedia,
  currentEpisode,
  catalog,
  onSendCommand,
  onUpdateAudio,
  onUpdatePlayback,
  onOpenAudioModal,
  onOpenCastModal,
  onPlayMedia,
  onNextEpisode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col overflow-hidden animate-fadeIn">
      {/* Top Banner explaining the dual view */}
      <div className="px-6 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600/30 text-red-400 border border-red-500/40 text-xs font-bold uppercase font-mono">
            <Sparkles className="w-3.5 h-3.5" />
            Simulador Dual en Tiempo Real
          </div>
          <span className="text-xs text-zinc-300 hidden sm:inline">
            Izquierda: Tu Celular desde la cama • Derecha: Tu PC / Smart TV en el dormitorio
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition flex items-center gap-1 text-xs font-semibold"
        >
          <X className="w-4 h-4" />
          Salir de Modo Dual
        </button>
      </div>

      {/* Split Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden bg-black">
        {/* Left Column: Mobile Phone Frame (Cols 4) */}
        <div className="lg:col-span-4 flex flex-col items-center justify-center h-full">
          <div className="w-full max-w-sm h-full max-h-[85vh] rounded-[2.5rem] p-3 bg-zinc-900 border-4 border-zinc-700 shadow-2xl flex flex-col relative overflow-hidden">
            {/* Phone Notch */}
            <div className="w-24 h-4 bg-zinc-800 rounded-full mx-auto mb-2 shrink-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-black/60 mr-2" />
              <div className="w-6 h-1 bg-black/40 rounded-full" />
            </div>

            {/* Phone Screen Container */}
            <div className="flex-1 bg-zinc-950 rounded-[2rem] overflow-hidden flex flex-col relative border border-zinc-800">
              <div className="p-3 border-b border-zinc-800/80 bg-zinc-900/70 flex items-center justify-between">
                <span className="text-xs font-bold text-red-500 font-display">CINECAST MÓVIL</span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Conectado a PC
                </span>
              </div>

              {/* Quick Catalog Picker on Phone */}
              <div className="p-3 overflow-y-auto space-y-3 flex-1">
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-bold">
                  Elegí qué transmitir a la PC:
                </p>
                <div className="space-y-2">
                  {catalog.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      onClick={() => onPlayMedia(item, item.episodes?.[0])}
                      className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 cursor-pointer flex items-center gap-2.5 transition"
                    >
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        className="w-10 h-14 rounded-lg object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">{item.title}</div>
                        <div className="text-[10px] text-zinc-400 truncate">{item.genres[0]} • {item.ratingBadge}</div>
                        <span className="text-[9px] text-red-400 font-semibold">Tocar para reproducir en PC</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Handheld Remote Inside Phone View */}
              <div className="relative border-t border-zinc-800 bg-zinc-900/95">
                <RemoteControlSheet
                  playbackState={playbackState}
                  currentMedia={currentMedia}
                  currentEpisode={currentEpisode}
                  connectedScreenName="PC Dormitorio"
                  onSendCommand={onSendCommand}
                  onOpenAudioModal={onOpenAudioModal}
                  onOpenCastModal={onOpenCastModal}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Big PC / Smart TV Screen (Cols 8) */}
        <div className="lg:col-span-8 flex flex-col justify-center h-full">
          <div className="w-full h-full max-h-[85vh] rounded-3xl overflow-hidden border-4 border-zinc-800 shadow-2xl relative bg-zinc-950 flex flex-col">
            {/* TV Monitor Bar */}
            <div className="px-4 py-2 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-red-500" />
                <span className="font-semibold text-zinc-200">Pantalla Principal (PC Dormitorio / TV)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-zinc-400">
                  Vol: {playbackState.audioSettings.isMuted ? 'MUTE' : `${playbackState.audioSettings.volume}%`}
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 uppercase">
                  {playbackState.audioSettings.preset}
                </span>
              </div>
            </div>

            {/* Screen Content: Either VideoPlayer or AmbientScreen */}
            <div className="flex-1 relative overflow-hidden">
              {playbackState.isStandby || !currentMedia ? (
                <AmbientScreen
                  deviceName="PC Dormitorio"
                  roomId="cine-home-1"
                  recentMedia={catalog}
                  onWakeScreen={() => onSendCommand({ action: 'wakeScreen' })}
                  onPlayDirectly={(m) => onPlayMedia(m, m.episodes?.[0])}
                />
              ) : (
                <VideoPlayer
                  key={`${currentMedia.id}_s${currentEpisode?.seasonNumber || 1}_e${currentEpisode?.episodeNumber || 1}`}
                  media={currentMedia}
                  episode={currentEpisode}
                  audioSettings={playbackState.audioSettings}
                  playbackSettings={playbackState.playbackSettings}
                  onUpdateAudio={onUpdateAudio}
                  onClose={() => onSendCommand({ action: 'setStandby', payload: true })}
                  onNextEpisode={onNextEpisode}
                  hasNextEpisode={Boolean(
                    currentMedia.episodes &&
                      currentEpisode &&
                      currentEpisode.episodeNumber < currentMedia.episodes.length
                  )}
                  onOpenAudioSettings={onOpenAudioModal}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
