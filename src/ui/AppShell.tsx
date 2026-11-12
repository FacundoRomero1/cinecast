import {
  Bookmark,
  Compass,
  Film,
  Gamepad2,
  Home,
  Music,
  Search,
  Settings,
  Trophy,
  Tv,
  Youtube,
} from 'lucide-react';
import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { useScrollRestoration } from './useScrollRestoration';
import { getRememberedTabUrl, saveTabScroll } from './navigationMemory';
import { useViewportPin } from './useViewportPin';
import { LayoutDebug } from './LayoutDebug';

export interface AppShellProps {
  children: React.ReactNode;
  bottomSlot?: React.ReactNode;
  extraBottomPadding?: boolean | undefined;
  hasMiniRemote?: boolean | undefined;
  onOpenControl?: (() => void) | undefined;
  isControlOpen?: boolean | undefined;
}

interface NavItemConfig {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const DESKTOP_MAIN_ITEMS: NavItemConfig[] = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/buscar', label: 'Buscar', icon: Search },
  { to: '/lista', label: 'Mi lista', icon: Bookmark },
  { to: '/deportes', label: 'Deportes', icon: Trophy },
  { to: '/canales', label: 'Canales', icon: Tv },
  { to: '/musica', label: 'Música', icon: Music },
  { to: '/youtube', label: 'YouTube', icon: Youtube },
];

const MOBILE_TAB_ITEMS: NavItemConfig[] = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/buscar', label: 'Buscar', icon: Search },
  { to: '/lista', label: 'Mi lista', icon: Bookmark },
  { to: '/control', label: 'Control', icon: Gamepad2 },
];

export const AppShell: React.FC<AppShellProps> = ({
  children,
  bottomSlot,
  extraBottomPadding = false,
  hasMiniRemote = false,
  onOpenControl,
  isControlOpen = false,
}) => {
  useScrollRestoration();
  useViewportPin();
  const location = useLocation();
  const navigate = useNavigate();

  const handleTabClick = (item: NavItemConfig, e: React.MouseEvent) => {
    const curPath = location.pathname;
    const targetPath = item.to;

    // Si toca el control en móvil y hay handler de panel superpuesto, abrir panel sin navegar
    if (targetPath === '/control' && onOpenControl) {
      e.preventDefault();
      onOpenControl();
      return;
    }

    // Tocar la pestaña activa lleva arriba con scroll suave
    if (curPath === targetPath) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Guardar scroll actual antes de cambiar de pestaña
    saveTabScroll(curPath, window.scrollY);

    // Si la pestaña destino tiene memoria de ruta/parámetros guardada (< 30 min), navegar a ella
    const remembered = getRememberedTabUrl(targetPath);
    if (remembered && remembered !== targetPath) {
      e.preventDefault();
      navigate(remembered);
    }
  };

  return (
    <div className="min-h-[100dvh] md:min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      <LayoutDebug />
      {/* Menú lateral fijo en escritorio (>= 768px) */}
      <aside
        aria-label="Navegación principal"
        className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 bg-zinc-950 border-r border-zinc-900 z-40 select-none"
      >
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-zinc-900">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shadow">
            <Film className="w-4 h-4 text-white" />
          </div>
          <span className="font-display text-2xl tracking-wider text-white">CINECAST</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {DESKTOP_MAIN_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={(e) => handleTabClick(item, e)}
                className={({ isActive }) =>
                  `min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    isActive
                      ? 'bg-red-600 text-white shadow-lg shadow-red-950/40'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                  }`
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {onOpenControl && (
            <button
              type="button"
              onClick={onOpenControl}
              className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                isControlOpen
                  ? 'bg-zinc-800 text-white border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
              }`}
            >
              <Gamepad2 className="w-5 h-5 shrink-0 text-red-500" />
              <span>Control Remoto</span>
            </button>
          )}
        </nav>

        <div className="p-3 border-t border-zinc-900">
          <NavLink
            to="/ajustes"
            className={({ isActive }) =>
              `min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                isActive
                  ? 'bg-red-600 text-white shadow-lg shadow-red-950/40'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
              }`
            }
          >
            <Settings className="w-5 h-5 shrink-0" />
            <span>Ajustes</span>
          </NavLink>
        </div>
      </aside>

      {/* Contenido principal con padding inferior adaptado y padding derecho si la columna de control está abierta */}
      <main
        className={`flex-1 md:pl-60 min-w-0 transition-[padding] duration-200 ${
          isControlOpen ? 'md:pr-96' : ''
        } ${
          hasMiniRemote
            ? 'pb-[calc(124px+env(safe-area-inset-bottom,0px)+var(--vv-bottom-offset,0px))] md:pb-24'
            : extraBottomPadding || bottomSlot
            ? 'pb-[calc(76px+env(safe-area-inset-bottom,0px)+var(--vv-bottom-offset,0px))] md:pb-24'
            : 'pb-[calc(68px+env(safe-area-inset-bottom,0px)+var(--vv-bottom-offset,0px))] md:pb-10'
        }`}
      >
        {children}
      </main>

      {/* Slot fijo sobre la barra de pestañas móvil */}
      {bottomSlot && (
        <div className="z-cc-minicontrol [&>div]:!static">
          {bottomSlot}
        </div>
      )}

      {/* Barra de pestañas inferior en móvil (< 768px): siempre visible, safe-area aware */}
      <nav
        aria-label="Navegación móvil"
        style={{
          bottom: 'var(--vv-bottom-offset, 0px)',
        }}
        className="fixed inset-x-0 h-[calc(60px+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] md:hidden bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800/80 z-cc-tabbar flex items-center justify-around px-1 py-1 select-none"
      >
        {MOBILE_TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={(e) => handleTabClick(item, e)}
              className={({ isActive }) =>
                `min-h-[44px] min-w-[44px] flex-1 py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 touch-manipulation ${
                  item.to === '/control'
                    ? isControlOpen
                      ? 'text-red-500'
                      : 'text-zinc-400 hover:text-zinc-200'
                    : isActive
                    ? 'text-red-500'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
