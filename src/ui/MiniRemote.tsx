import React, { useState, useEffect } from 'react';
import { Play, Pause, ChevronRight, Tv, Radio } from 'lucide-react';
import type { MediaItem, PlaybackState } from '../types';
import { deviceSync } from '../services/deviceSync';

export interface MiniRemoteProps {
  connectedScreenName?: string;
  playbackState?: PlaybackState | null;
  currentMedia?: MediaItem | null;
  onSendCommand: (cmd: any) => void;
  onNavigateToControl: () => void;
  onNavigateToSettings: () => void;
}

export const MiniRemote: React.FC<MiniRemoteProps> = ({
  connectedScreenName,
  playbackState,
  currentMedia,
  onSendCommand,
  onNavigateToControl,
  onNavigateToSettings,
}) => {
  const isConnected = Boolean(
    connectedScreenName &&
    connectedScreenName.trim() !== '' &&
    connectedScreenName !== 'Sin pantalla' &&
    connectedScreenName !== 'Ninguna'
  );

  const [connState, setConnState] = useState<'connected' | 'reconnecting' | 'disconnected'>(
    isConnected ? 'connected' : 'disconnected'
  );

  useEffect(() => {
    const unsub = deviceSync.onConnectionStatus((info) => {
      setConnState(info.state);
    });
    return () => unsub();
  }, []);

  const isPlaying = Boolean(playbackState?.isPlaying);
  const title =
    currentMedia?.title ||
    (playbackState as any)?.title ||
    (isConnected ? `Conectado a ${connectedScreenName}` : 'Sin pantalla · Elegir');

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSendCommand({ action: isPlaying ? 'pause' : 'play' });
  };

  if (!isConnected) {
    return (
      <aside
        aria-label="Mini control remoto sin pantalla"
        onClick={onNavigateToSettings}
        style={{
          bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-offset, 0px))',
        }}
        className="fixed inset-x-0 md:hidden h-[56px] bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800/80 px-4 flex items-center justify-between z-cc-minicontrol cursor-pointer transition select-none hover:bg-zinc-800/80"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 shrink-0" />
          <Tv className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-300 truncate">
            Sin pantalla · Elegir
          </span>
        </div>
        <button
          type="button"
          aria-label="Elegir pantalla en ajustes"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToSettings();
          }}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white transition"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Mini control remoto móvil"
      onClick={onNavigateToControl}
      style={{
        bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-offset, 0px))',
      }}
      className="fixed inset-x-0 md:hidden h-[56px] bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800/80 px-3 flex items-center justify-between z-cc-minicontrol cursor-pointer transition select-none hover:bg-zinc-850"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            !isConnected || connState === 'disconnected'
              ? 'bg-rose-500'
              : connState === 'reconnecting'
              ? 'bg-amber-500 animate-pulse'
              : 'bg-emerald-500 animate-pulse'
          }`}
        />
        <Radio className="w-4 h-4 text-red-500 shrink-0" />
        <p className="text-xs font-semibold text-zinc-100 truncate">
          {title}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          aria-label={isPlaying ? 'Pausar reproducción' : 'Reanudar reproducción'}
          onClick={handleTogglePlay}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-red-600 text-white transition active:scale-95"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-white" />
          ) : (
            <Play className="w-4 h-4 fill-white translate-x-0.5" />
          )}
        </button>

        <button
          type="button"
          aria-label="Abrir control remoto completo"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToControl();
          }}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white transition active:scale-95"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
};
