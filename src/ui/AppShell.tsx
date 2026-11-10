import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  Compass,
  Search,
  Bookmark,
  Trophy,
  Tv,
  Music,
  Youtube,
  Settings,
  Gamepad2,
  Film,
} from 'lucide-react';

export interface AppShellProps {
  children: React.ReactNode;
  bottomSlot?: React.ReactNode;
  extraBottomPadding?: boolean | undefined;
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
}) => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
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

      {/* Contenido principal */}
      <main
        className={`flex-1 md:pl-60 min-w-0 ${
          extraBottomPadding ? 'pb-40 md:pb-24' : 'pb-20 md:pb-10'
        }`}
      >
        {children}
      </main>

      {/* Slot fijo sobre la barra de pestañas móvil (ej: RemoteControlDrawer en rol remote) */}
      {bottomSlot && (
        <div className="fixed inset-x-0 bottom-[60px] md:bottom-0 md:left-60 z-50 [&>div]:!static">
          {bottomSlot}
        </div>
      )}

      {/* Barra de pestañas inferior en móvil (< 768px) */}
      <nav
        aria-label="Navegación móvil"
        className="fixed bottom-0 inset-x-0 h-[60px] md:hidden bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800/80 z-40 flex items-center justify-around px-1 py-1"
      >
        {MOBILE_TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `min-h-[44px] min-w-[44px] flex-1 py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                  isActive ? 'text-red-500' : 'text-zinc-400 hover:text-zinc-200'
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
