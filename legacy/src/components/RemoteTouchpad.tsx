import React, { useState, useRef } from 'react';
import { Volume2, VolumeX, RotateCcw, RotateCw, Play, Pause, Hand } from 'lucide-react';

interface RemoteTouchpadProps {
  onTogglePlay: () => void;
  onSeekRelative: (deltaSeconds: number) => void;
  onVolumeDelta: (deltaVolume: number) => void;
  isPlaying?: boolean;
}

export const RemoteTouchpad: React.FC<RemoteTouchpadProps> = ({
  onTogglePlay,
  onSeekRelative,
  onVolumeDelta,
  isPlaying = true,
}) => {
  const [activeGesture, setActiveGesture] = useState<{
    text: string;
    icon: 'volUp' | 'volDown' | 'seekFwd' | 'seekBack' | 'play' | 'pause';
  } | null>(null);

  const startPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const hasTriggeredSwipeRef = useRef<boolean>(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showGestureFeedback = (
    text: string,
    icon: 'volUp' | 'volDown' | 'seekFwd' | 'seekBack' | 'play' | 'pause'
  ) => {
    setActiveGesture({ text, icon });
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(40);
      } catch (_) {}
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActiveGesture(null);
    }, 1000);
  };

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startPosRef.current = { x: clientX, y: clientY, time: Date.now() };
    hasTriggeredSwipeRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!startPosRef.current || hasTriggeredSwipeRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - startPosRef.current.x;
    const deltaY = clientY - startPosRef.current.y;
    const threshold = 32;

    if (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold) {
      hasTriggeredSwipeRef.current = true;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal Swipe
        if (deltaX > 0) {
          onSeekRelative(10);
          showGestureFeedback('Avanzar +10s', 'seekFwd');
        } else {
          onSeekRelative(-10);
          showGestureFeedback('Retroceder -10s', 'seekBack');
        }
      } else {
        // Vertical Swipe
        if (deltaY < 0) {
          onVolumeDelta(10);
          showGestureFeedback('Volumen +10%', 'volUp');
        } else {
          onVolumeDelta(-10);
          showGestureFeedback('Volumen -10%', 'volDown');
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!startPosRef.current) return;

    const now = Date.now();
    const duration = now - startPosRef.current.time;

    // Si no hubo swipe, comprobar doble toque
    if (!hasTriggeredSwipeRef.current && duration < 350) {
      const timeSinceLastTap = now - lastTapTimeRef.current;
      if (timeSinceLastTap < 300) {
        // Doble toque detectado
        onTogglePlay();
        showGestureFeedback(isPlaying ? 'Pausa' : 'Reproducir', isPlaying ? 'pause' : 'play');
        lastTapTimeRef.current = 0;
      } else {
        lastTapTimeRef.current = now;
      }
    }

    startPosRef.current = null;
    hasTriggeredSwipeRef.current = false;
  };

  return (
    <div className="relative select-none">
      {/* Trackpad Container */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseMove={handleTouchMove}
        onMouseUp={handleTouchEnd}
        className="w-full h-36 sm:h-40 rounded-2xl bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 border border-zinc-700/60 shadow-inner cursor-grab active:cursor-grabbing relative overflow-hidden flex flex-col justify-between p-3"
      >
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        {/* Top: Volume Up label */}
        <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-zinc-400 pointer-events-none">
          <Volume2 size={13} className="text-zinc-500" />
          <span>↑ Deslizar: Subir Volumen</span>
        </div>

        {/* Middle: Horizontal Seek labels + Active Feedback Overlay */}
        <div className="flex items-center justify-between pointer-events-none px-1">
          <div className="flex items-center gap-1 text-[11px] font-bold text-zinc-400">
            <RotateCcw size={13} className="text-zinc-500" />
            <span>← -10s</span>
          </div>

          {/* Central Active Gesture Bubble */}
          <div className="flex flex-col items-center justify-center">
            {activeGesture ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-600/90 text-white font-bold text-xs shadow-lg shadow-red-950/80 animate-scaleIn">
                {activeGesture.icon === 'volUp' && <Volume2 size={16} />}
                {activeGesture.icon === 'volDown' && <VolumeX size={16} />}
                {activeGesture.icon === 'seekFwd' && <RotateCw size={16} />}
                {activeGesture.icon === 'seekBack' && <RotateCcw size={16} />}
                {activeGesture.icon === 'play' && <Play size={16} fill="white" />}
                {activeGesture.icon === 'pause' && <Pause size={16} fill="white" />}
                <span>{activeGesture.text}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-zinc-500">
                <div className="w-10 h-10 rounded-full border border-dashed border-zinc-700 flex items-center justify-center text-zinc-400">
                  <Hand size={18} />
                </div>
                <span className="text-[10px] font-medium text-zinc-400">Doble toque: Play/Pausa</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-[11px] font-bold text-zinc-400">
            <span>+10s →</span>
            <RotateCw size={13} className="text-zinc-500" />
          </div>
        </div>

        {/* Bottom: Volume Down label */}
        <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-zinc-400 pointer-events-none">
          <VolumeX size={13} className="text-zinc-500" />
          <span>↓ Deslizar: Bajar Volumen</span>
        </div>
      </div>
    </div>
  );
};
