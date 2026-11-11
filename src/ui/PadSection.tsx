import React, { useState, useRef } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MousePointer,
  RotateCcw,
  Tv,
} from 'lucide-react';
import type { RemoteCommand } from '../types';

export interface PadSectionProps {
  onSendCommand: (command: RemoteCommand) => void;
}

export const PadSection: React.FC<PadSectionProps> = ({ onSendCommand }) => {
  const [sensitivity, setSensitivity] = useState<'baja' | 'normal' | 'alta'>('normal');
  const [subMode, setSubMode] = useState<'touchpad' | 'cruceta' | 'ambos'>('ambos');

  const mult = sensitivity === 'baja' ? 0.6 : sensitivity === 'alta' ? 1.6 : 1.0;

  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const hasMovedRef = useRef<boolean>(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      lastPosRef.current = { x: t.clientX, y: t.clientY };
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      hasMovedRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && lastPosRef.current) {
      const t = e.touches[0];
      const rawDx = t.clientX - lastPosRef.current.x;
      const rawDy = t.clientY - lastPosRef.current.y;
      if (Math.abs(rawDx) > 0.5 || Math.abs(rawDy) > 0.5) {
        hasMovedRef.current = true;
        const dx = rawDx * mult;
        const dy = rawDy * mult;
        onSendCommand({
          action: 'trackpadMove',
          payload: { type: 'move', dx, dy },
        });
        lastPosRef.current = { x: t.clientX, y: t.clientY };
      }
    } else if (e.touches.length === 2 && lastPosRef.current) {
      const rawDy = e.touches[0].clientY - lastPosRef.current.y;
      if (Math.abs(rawDy) > 2) {
        onSendCommand({
          action: 'trackpadScroll',
          payload: { type: 'scroll', dy: -rawDy * mult },
        });
        lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }
  };

  const handleTouchEnd = () => {
    if (!hasMovedRef.current && touchStartRef.current) {
      const elapsed = Date.now() - touchStartRef.current.time;
      if (elapsed < 300) {
        onSendCommand({
          action: 'trackpadClick',
          payload: { type: 'click', button: 'left' },
        });
      }
    }
    lastPosRef.current = null;
    touchStartRef.current = null;
    hasMovedRef.current = false;
  };

  // Mouse fallbacks para pruebas desde devtools / navegador
  const handleMouseDown = (e: React.MouseEvent) => {
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    touchStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    hasMovedRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (e.buttons === 1 && lastPosRef.current) {
      const rawDx = e.clientX - lastPosRef.current.x;
      const rawDy = e.clientY - lastPosRef.current.y;
      if (Math.abs(rawDx) > 0.5 || Math.abs(rawDy) > 0.5) {
        hasMovedRef.current = true;
        onSendCommand({
          action: 'trackpadMove',
          payload: { type: 'move', dx: rawDx * mult, dy: rawDy * mult },
        });
        lastPosRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  };

  const handleMouseUp = () => {
    if (!hasMovedRef.current && touchStartRef.current) {
      const elapsed = Date.now() - touchStartRef.current.time;
      if (elapsed < 300) {
        onSendCommand({
          action: 'trackpadClick',
          payload: { type: 'click', button: 'left' },
        });
      }
    }
    lastPosRef.current = null;
    touchStartRef.current = null;
  };

  return (
    <div className="space-y-4 text-zinc-100 select-none">
      {/* Controles de modo y sensibilidad */}
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-950 border border-zinc-800">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setSubMode('ambos')}
            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-bold transition ${
              subMode === 'ambos' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Todo
          </button>
          <button
            type="button"
            onClick={() => setSubMode('touchpad')}
            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
              subMode === 'touchpad' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>Mouse</span>
          </button>
          <button
            type="button"
            onClick={() => setSubMode('cruceta')}
            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
              subMode === 'cruceta' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Cruceta</span>
          </button>
        </div>

        {/* Sensibilidad */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase font-bold text-zinc-500 mr-1">Sens:</span>
          {(['baja', 'normal', 'alta'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setSensitivity(lvl)}
              className={`min-h-[32px] px-2 py-0.5 rounded text-[11px] font-bold capitalize transition ${
                sensitivity === lvl ? 'bg-zinc-700 text-white shadow' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Área táctil (Touchpad Mouse) */}
      {(subMode === 'touchpad' || subMode === 'ambos') && (
        <div className="space-y-1.5">
          <div
            id="remote-touchpad-area"
            aria-label="Área táctil de mouse"
            style={{ touchAction: 'none' }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="w-full h-[260px] min-h-[260px] rounded-2xl bg-gradient-to-b from-zinc-900/95 via-zinc-950 to-zinc-950 border border-zinc-800 shadow-inner flex flex-col justify-between p-4 cursor-crosshair relative overflow-hidden active:border-zinc-700"
          >
            {/* Subtle grid background */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />

            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500 pointer-events-none">
              <span className="flex items-center gap-1">
                <MousePointer className="w-3.5 h-3.5 text-red-500" />
                Trackpad Mouse
              </span>
              <span>2 dedos: scroll</span>
            </div>

            <div className="flex flex-col items-center justify-center pointer-events-none text-zinc-600">
              <div className="w-12 h-12 rounded-full border border-dashed border-zinc-800 flex items-center justify-center text-zinc-500 mb-1">
                <MousePointer className="w-5 h-5 text-zinc-500" />
              </div>
              <span className="text-xs font-bold text-zinc-400">Arrastrar para mover cursor</span>
              <span className="text-[11px] text-zinc-500">Toque rápido para hacer clic</span>
            </div>

            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 pointer-events-none">
              <span>Sensibilidad: {sensitivity}</span>
              <span>1 toque: clic izquierdo</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Cruceta D-Pad */}
      {(subMode === 'cruceta' || subMode === 'ambos') && (
        <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 shadow flex flex-col items-center space-y-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Cruceta de navegación TV
          </span>

          {/* D-Pad Circular */}
          <div className="relative w-64 h-64 bg-zinc-900/90 rounded-full border border-zinc-800 shadow-2xl flex items-center justify-center">
            {/* Arriba */}
            <button
              type="button"
              aria-label="Arriba"
              onClick={() => onSendCommand({ action: 'navigateUp' })}
              className="absolute top-2 left-1/2 -translate-x-1/2 min-w-[56px] min-h-[56px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold flex items-center justify-center border border-zinc-700 shadow"
            >
              <ChevronUp className="w-7 h-7 text-zinc-100" />
            </button>

            {/* Izquierda */}
            <button
              type="button"
              aria-label="Izquierda"
              onClick={() => onSendCommand({ action: 'navigateLeft' })}
              className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[56px] min-h-[56px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold flex items-center justify-center border border-zinc-700 shadow"
            >
              <ChevronLeft className="w-7 h-7 text-zinc-100" />
            </button>

            {/* Centro OK / Enter */}
            <button
              type="button"
              aria-label="OK"
              onClick={() => onSendCommand({ action: 'select' })}
              className="min-w-[56px] min-h-[56px] w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 text-white font-extrabold text-sm flex items-center justify-center shadow-lg shadow-red-950 border border-red-500"
            >
              OK
            </button>

            {/* Derecha */}
            <button
              type="button"
              aria-label="Derecha"
              onClick={() => onSendCommand({ action: 'navigateRight' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[56px] min-h-[56px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold flex items-center justify-center border border-zinc-700 shadow"
            >
              <ChevronRight className="w-7 h-7 text-zinc-100" />
            </button>

            {/* Abajo */}
            <button
              type="button"
              aria-label="Abajo"
              onClick={() => onSendCommand({ action: 'navigateDown' })}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 min-w-[56px] min-h-[56px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-extrabold flex items-center justify-center border border-zinc-700 shadow"
            >
              <ChevronDown className="w-7 h-7 text-zinc-100" />
            </button>
          </div>

          {/* Botón Atrás (56px) */}
          <div className="w-full max-w-xs pt-1">
            <button
              type="button"
              aria-label="Atrás"
              onClick={() => onSendCommand({ action: 'back' })}
              className="w-full min-h-[56px] px-4 py-3 rounded-2xl bg-zinc-850 hover:bg-zinc-800 active:scale-95 text-zinc-200 font-extrabold text-xs border border-zinc-700 flex items-center justify-center gap-2 shadow"
            >
              <RotateCcw className="w-4 h-4 text-zinc-400" />
              <span>Volver / Atrás</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

