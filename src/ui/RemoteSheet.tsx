import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, Gamepad2 } from 'lucide-react';
import { RemotePanel } from './RemotePanel';
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

  // Gestión de historial para botón Atrás del navegador/celular y bloqueo de scroll
  useEffect(() => {
    if (!isOpen) return;

    // Bloquear scroll de fondo mientras el panel esté abierto en móvil
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Agregar marcador en history solo si no lo tiene ya
    if (!window.history.state?.ccRemoteSheet) {
      window.history.pushState({ ccRemoteSheet: true }, '');
    }

    const onPopState = () => {
      isClosingViaPopRef.current = true;
      onClose();
    };

    window.addEventListener('popstate', onPopState);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('popstate', onPopState);
    };
  }, [isOpen, onClose]);

  const handleClose = () => {
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

          <div className="flex items-center justify-between">
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

            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar panel de control"
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cuerpo del panel: Reutiliza RemotePanel completo con scroll independiente */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <RemotePanel
            playbackState={playbackState}
            currentMedia={currentMedia}
            currentEpisode={currentEpisode}
            connectedScreenName={connectedScreenName}
            onSendCommand={onSendCommand}
            onOpenCastModal={onOpenCastModal}
            onOpenAudioModal={onOpenAudioModal}
            onOpenGuestModal={onOpenGuestModal}
            onNavigateToCatalog={() => {
              handleClose();
              if (onNavigateToCatalog) onNavigateToCatalog();
            }}
          />
        </div>
      </aside>
    </>
  );
};

