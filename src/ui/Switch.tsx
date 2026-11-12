/**
 * src/ui/Switch.tsx
 * Componente único de interruptor para Cinecast.
 * - role="switch", aria-checked
 * - Pista de 52x30 px (rounded-full, relative, overflow hidden)
 * - Bolita de 24 px con 3 px de margen y translateX(22px) al activarse
 * - Activado: color de acento rojo (bg-red-600), Desactivado: gris (bg-zinc-700)
 * - Foco visible con focus-visible
 * - Área táctil de al menos 44 px
 * - Prop disabled
 */
import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  id,
  className = '',
}) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`group min-h-[44px] min-w-[52px] inline-flex items-center justify-center p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-full transition select-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span
        data-testid="switch-track"
        className={`w-[52px] h-[30px] rounded-full relative overflow-hidden transition-colors duration-200 block shrink-0 ${
          checked ? 'bg-red-600' : 'bg-zinc-700'
        }`}
      >
        <span
          data-testid="switch-thumb"
          className={`absolute top-[3px] left-[3px] w-[24px] h-[24px] rounded-full bg-white shadow-md block transform transition-transform duration-200 ease-in-out ${
            checked ? 'translate-x-[22px]' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
};
