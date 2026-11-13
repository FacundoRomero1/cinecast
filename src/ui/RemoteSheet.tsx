import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Gamepad2, Volume2, VolumeX, MousePointer, Tv } from 'lucide-react';
import { RemotePanel } from './RemotePanel';
import { PadSection } from './PadSection';
import { lockScroll } from './scrollLock';
import type { Episode, MediaItem, PlaybackState, RemoteCommand } from '../types';

export interface RemoteSheetProps {
  isOpen: boolean;
  onClose: () => void;
  playbackState?: PlaybackState | null;
  currentMedia?: MediaItem | null;
  currentEpisode?: Episode | null;
  connectedScreenName?: string;
  onSendCommand: (command: RemoteCommand) => void;
  onOpenCastModal: () => void;
  onOpenAudioModal?: () => void;
  onOpenGuestModal?: () => void;
  onNavigateToCatalog?: () => void;
}

export type RemoteSheetView = 'panel' | 'pad' | 'cruceta';

export const RemoteSheet: React.FC<RemoteSheetProps> = ({
  isOpen,
  onClose,
  playbackState,
  currentMedia,
  currentEpisode,
  connectedScreenName,
  onSendCommand,
  onOpenCastModal,
  onOpenAudioModal,
  onOpenGuestModal,
  onNavigateToCatalog,
}) => {
  const isClosingViaPopRef = useRef<boolean>(false);
  const touchStartY = useRef<number>(0);
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [sheetView, setSheetView] = useState<RemoteSheetView>('panel');
  const sheetViewRef = useRef<RemoteSheetView>('panel');
  sheetViewRef.current = sheetView;

  // Gestión de historial para botón Atrás del navegador/celular y bloqueo de scroll
  useEffect(() => {
    if (!isOpen) {
      setSheetView('panel');
      return;
    }

    // Bloquear scroll de fondo mientras el panel esté abierto en móvil
    const unlock = lockScroll();

    // Agregar marcador en history solo si no lo tiene ya
    if (!window.history.state?.ccRemoteSheet) {
      window.history.pushState({ ccRemoteSheet: true }, '');
    }

    const onPopState = () => {
      if (sheetViewRef.current !== 'panel') {
        // La tecla/acción Atrás cierra primero el modo dedicado y vuelve al panel general
        setSheetView('panel');
        return;
      }
      isClosingViaPopRef.current = true;
      onClose();
    };

    window.addEventListener('popstate', onPopState);

    return () => {
      unlock();
      window.removeEventListener('popstate', onPopState);
    };
  }, [isOpen, onClose]);

  const handleOpenDedicatedMode = (mode: 'pad' | 'cruceta' = 'pad') => {
    try {
      window.history.pushState({ ccRemoteSheet: true, ccMode: mode }, '');
    } catch (_) {}
    setSheetView(mode);
  };

  const handleCloseDedicatedMode = () => {
    if (window.history.state?.ccMode) {
      window.history.back();
    } else {
      setSheetView('panel');
    }
  };

  const handleClose = () => {
    if (sheetViewRef.current !== 'panel') {
      handleCloseDedicatedMode();
      return;
    }
    if (window.history.state?.ccRemoteSheet && !isClosingViaPopRef.current) {
      window.history.back();
    }
    isClosingViaPopRef.current = false;
    onClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY || 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0]?.clientY || 0;
    const diff = currentY - touchStartY.current;
    if (diff > 0) {
      setDragOffset(diff);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffset > 80) {
      handleClose();
    }
    setDragOffset(0);
  };

  const currentVolume = Number.isFinite((playbackState as any)?.volume)
    ? Math.round(Number((playbackState as any)?.volume))
    : 100;
  const isMuted = Boolean((playbackState as any)?.isMuted || currentVolume === 0);

  if (!isOpen) return null;

  return (
    <>
      {/* Fondo oscurecido solo en móvil (< 768px) para no tapar en escritorio */}
      <div
        data-testid="remote-sheet-backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden transition-opacity"
      />

      {/* Contenedor: En móvil (< 768px) es panel inferior al 92% del alto;
          en escritorio (>= 768px) es columna lateral derecha fija plegable sin tapar el centro */}
      <aside
        aria-label="Control Remoto"
        data-testid="remote-sheet-container"
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
        className="fixed bottom-0 inset-x-0 h-[92dvh] max-h-[92dvh] rounded-t-3xl bg-zinc-950 border-t border-zinc-800 shadow-2xl z-50 flex flex-col md:inset-auto md:top-0 md:right-0 md:bottom-0 md:w-96 md:h-screen md:max-h-screen md:rounded-none md:border-t-0 md:border-l md:border-zinc-800 md:shadow-2xl md:z-40 transition-transform duration-200"
      >
        {/* Cabecera del panel con barra de arrastre y botón cerrar */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-2 pb-2 px-4 border-b border-zinc-800/80 shrink-0 select-none cursor-grab active:cursor-grabbing"
        >
          {/* Barra de arrastre móvil */}
          <div className="w-12 h-1.5 rounded-full bg-zinc-700 mx-auto mb-2 md:hidden" />

          <div className="flex items-center justify-between gap-2">
            {sheetView !== 'panel' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseDedicatedMode}
                  className="min-h-[44px] px-3 py-1.5 -ml-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold flex items-center gap-1.5 transition border border-zinc-800"
                >
                  <ChevronLeft className="w-4 h-4 text-red-500" />
                  <span>Volver</span>
                </button>

                {/* Conmutador entre Pad y Cruceta (>= 44px) */}
                <div className="flex items-center bg-zinc-900 rounded-xl p-1 border border-zinc-800 gap-1">
                  <button
                    type="button"
                    onClick={() => setSheetView('pad')}
                    className={`min-h-[44px] min-w-[44px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      sheetView === 'pad' ? 'bg-red-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                    <span>Pad</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheetView('cruceta')}
                    className={`min-h-[44px] min-w-[44px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      sheetView === 'cruceta' ? 'bg-red-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>Cruceta</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center">
                  <Gamepad2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-white block">Control Remoto</span>
                  <span className="text-[10px] text-zinc-400 block truncate max-w-[200px]">
                    {connectedScreenName || 'Sin pantalla'}
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar panel de control"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cuerpo del panel */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          {sheetView !== 'panel' ? (
            <div className="space-y-4 max-w-md mx-auto">
              {/* Control de volumen de TV */}
              <div className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Volumen de la TV
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                    onClick={() => onSendCommand({ action: 'toggleMute' })}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition shrink-0"
                  >
                    {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  <button
                    type="button"
                    aria-label="Bajar volumen 10%"
                    onClick={() =>
                      onSendCommand({
                        action: 'setVolume',
                        payload: Math.max(0, currentVolume - 10),
                      })
                    }
                    className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-extrabold text-zinc-200 transition shrink-0"
                  >
                    -10
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={isMuted ? 0 : currentVolume}
                    onChange={(e) =>
                      onSendCommand({ action: 'setVolume', payload: Number(e.target.value) })
                    }
                    aria-label="Control de volumen"
                    className="flex-1 accent-red-600 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                  />

                  <button
                    type="button"
                    aria-label="Subir volumen 10%"
                    onClick={() =>
                      onSendCommand({
                        action: 'setVolume',
                        payload: Math.min(100, currentVolume + 10),
                      })
                    }
                    className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-extrabold text-zinc-200 transition shrink-0"
                  >
                    +10
                  </button>

                  <span className="text-xs font-mono font-bold text-zinc-200 w-9 text-right shrink-0">
                    {isMuted ? '0%' : `${currentVolume}%`}
                  </span>
                </div>
              </div>

              {/* Área del Pad o Cruceta según modo */}
              <div className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800">
                <PadSection
                  onSendCommand={onSendCommand}
                  mode={sheetView === 'pad' ? 'touchpad' : 'cruceta'}
                  hideModeSelector={true}
                />
              </div>
            </div>
          ) : (
            <RemotePanel
              playbackState={playbackState}
              currentMedia={currentMedia}
              currentEpisode={currentEpisode}
              connectedScreenName={connectedScreenName}
              onSendCommand={onSendCommand}
              onOpenCastModal={onOpenCastModal}
              onOpenAudioModal={onOpenAudioModal}
              onOpenGuestModal={onOpenGuestModal}
              onOpenBigPad={handleOpenDedicatedMode}
              onNavigateToCatalog={() => {
                handleClose();
                if (onNavigateToCatalog) onNavigateToCatalog();
              }}
            />
          )}
        </div>
      </aside>
    </>
  );
};
