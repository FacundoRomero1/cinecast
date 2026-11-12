/**
 * src/ui/Switch.tsx
 * Componente único de interruptor para Cinecast.
 * - role="switch", aria-checked
 * - Cambio optimista instantáneo con mutación directa y reconciliación a 3s
 * - Transición de 150 ms con transform y background-color
 * - Pista de 52x30 px (rounded-full, relative, overflow hidden)
 * - Bolita de 24 px con 3 px de margen y translateX(22px) al activarse
 * - Activado: color de acento rojo (bg-red-600), Desactivado: gris (bg-zinc-700)
 * - Foco visible con focus-visible
 * - Área táctil de al menos 44 px
 * - Prop disabled
 */
import React, { useState, useEffect, useRef } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  timeoutMs?: number;
  onTimeout?: () => void;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  id,
  className = '',
  timeoutMs = 3000,
  onTimeout,
}) => {
  const [optimisticState, setOptimisticState] = useState<boolean | null>(null);
  const [showTimeoutNotice, setShowTimeoutNotice] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTriggerRef = useRef<number>(0);

  const trackRef = useRef<HTMLSpanElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);

  const effectiveChecked = optimisticState !== null ? optimisticState : Boolean(checked);

  // Sincronizar estilos visuales directamente con el estado efectivo
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.style.backgroundColor = effectiveChecked ? '#dc2626' : '#3f3f46';
    }
    if (thumbRef.current) {
      thumbRef.current.style.transform = effectiveChecked ? 'translateX(22px)' : 'translateX(0px)';
    }
  }, [effectiveChecked]);

  // Reconciliación con la pantalla: si llega confirmación de la PC, despejar optimismo
  useEffect(() => {
    if (optimisticState !== null && Boolean(checked) === optimisticState) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setOptimisticState(null);
    }
  }, [checked, optimisticState]);

  // Limpieza de timers al desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const triggerToggle = () => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastTriggerRef.current < 200) return;
    lastTriggerRef.current = now;

    const next = !effectiveChecked;

    // Mutación DOM inmediata para latencia cero (<1ms) al hacer touch o click
    if (trackRef.current) {
      trackRef.current.style.backgroundColor = next ? '#dc2626' : '#3f3f46';
    }
    if (thumbRef.current) {
      thumbRef.current.style.transform = next ? 'translateX(22px)' : 'translateX(0px)';
    }

    // 1. Cambio optimista instantáneo en React
    setOptimisticState(next);
    setShowTimeoutNotice(false);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);

    // 2. Disparar comando a la PC
    onChange(next);

    // 3. Temporizador de 3s para reconciliación
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Revertir estado si la PC no respondió
      if (trackRef.current) {
        trackRef.current.style.backgroundColor = checked ? '#dc2626' : '#3f3f46';
      }
      if (thumbRef.current) {
        thumbRef.current.style.transform = checked ? 'translateX(22px)' : 'translateX(0px)';
      }
      setOptimisticState(null);
      setShowTimeoutNotice(true);
      onTimeout?.();

      noticeTimerRef.current = setTimeout(() => {
        setShowTimeoutNotice(false);
      }, 3000);
    }, timeoutMs);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    triggerToggle();
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    triggerToggle();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      triggerToggle();
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={effectiveChecked}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`group min-h-[44px] min-w-[52px] inline-flex items-center justify-center p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-full select-none ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
        } ${className}`}
      >
        <span
          ref={trackRef}
          data-testid="switch-track"
          style={{
            transition: 'background-color 150ms ease-in-out',
            backgroundColor: effectiveChecked ? '#dc2626' : '#3f3f46',
          }}
          className="w-[52px] h-[30px] rounded-full relative overflow-hidden block shrink-0"
        >
          <span
            ref={thumbRef}
            data-testid="switch-thumb"
            style={{
              transition: 'transform 150ms ease-in-out',
              transform: effectiveChecked ? 'translateX(22px)' : 'translateX(0px)',
            }}
            className="absolute top-[3px] left-[3px] w-[24px] h-[24px] rounded-full bg-white shadow-md block"
          />
        </span>
      </button>

      {showTimeoutNotice && (
        <span
          data-testid="switch-timeout-notice"
          className="absolute -top-7 right-0 z-30 whitespace-nowrap px-2 py-0.5 rounded bg-zinc-900 border border-amber-500/50 text-[10px] font-semibold text-amber-300 shadow-lg pointer-events-none"
        >
          La pantalla no respondió
        </span>
      )}
    </div>
  );
};
