import React, { useState, useEffect } from 'react';
import { Cast, Search, Sliders, Tv, Smartphone, Layers, X, Users, Home, Music, Youtube, Film, Check, Wifi, Activity } from 'lucide-react';
import { DeviceType } from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import { deviceSync } from '../services/deviceSync';
import { diagnosticService } from '../services/diagnosticService';

interface NavbarProps {
  currentCategory: string;
  onSelectCategory: (cat: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenCastModal: () => void;
  onOpenAudioModal: () => void;
  onOpenGuestModal: () => void;
  connectedScreenName?: string;
  isCastConnected?: boolean;
  deviceRole: DeviceType;
  onChangeDeviceRole: (role: DeviceType) => void;
  onOpenDualSimulator: () => void;
  activeHub: 'cinecast' | 'spotify' | 'youtube';
  onSelectHub: (hub: 'cinecast' | 'spotify' | 'youtube') => void;
  isPermanentHomeLinked: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  onOpenCastModal,
  onOpenAudioModal,
  onOpenGuestModal,
  connectedScreenName = 'PC Dormitorio',
  isCastConnected = true,
  deviceRole,
  onChangeDeviceRole,
  onOpenDualSimulator,
  activeHub,
  onSelectHub,
  isPermanentHomeLinked,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [lanIp, setLanIp] = useState<string>(() => deviceSync.getLanIp());
  const [isDiagnosticMode, setIsDiagnosticMode] = useState<boolean>(() => diagnosticService.isEnabled());

  useEffect(() => {
    return diagnosticService.onChange((enabled) => {
      setIsDiagnosticMode(enabled);
    });
  }, []);

  useEffect(() => {
    deviceSync.fetchLocalIp().then(setLanIp);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { id: 'all', label: 'Inicio' },
    { id: 'movies', label: 'Películas' },
    { id: 'series', label: '📺 Series' },
    { id: 'anime', label: '🗡️ Anime' },
    { id: 'partidos', label: '⚽ Partidos' },
    { id: 'sports', label: '📺 Canales TV' },
    { id: 'my-list', label: 'Mi Lista' },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 w-full max-w-[100vw] overflow-hidden px-3 lg:px-5 h-16 flex items-center justify-between gap-2 ${
        isScrolled
          ? 'bg-zinc-950/95 backdrop-blur-md shadow-2xl border-b border-zinc-800/60'
          : 'bg-gradient-to-b from-black/90 via-black/50 to-transparent'
      }`}
    >
      {/* Left: Brand Logo & Media Hub Switcher */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
        <div
          onClick={() => {
            onSelectHub('cinecast');
            onSelectCategory('all');
          }}
          className="cursor-pointer flex items-center gap-1 group select-none shrink-0"
        >
          <span className="text-red-600 font-extrabold text-xl sm:text-2xl tracking-tighter font-display drop-shadow-md group-hover:scale-105 transition">
            CINECAST
          </span>
        </div>

        {/* Media Hub Buttons: CineCast, Spotify, YouTube (Compact + Responsive) */}
        <div className="flex items-center p-0.5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 backdrop-blur-md shrink-0">
          <button
            onClick={() => onSelectHub('cinecast')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition shrink-0 ${
              activeHub === 'cinecast'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
            title="Películas & Series"
          >
            <Film className="w-3.5 h-3.5 shrink-0" />
            <span className={activeHub === 'cinecast' ? 'inline' : 'hidden min-[1440px]:inline'}>
              Pelis & Series
            </span>
          </button>

          <button
            onClick={() => onSelectHub('spotify')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition shrink-0 ${
              activeHub === 'spotify'
                ? 'bg-emerald-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-emerald-400'
            }`}
            title="Spotify Music & Podcasts"
          >
            <Music className="w-3.5 h-3.5 shrink-0" />
            <span className={activeHub === 'spotify' ? 'inline' : 'hidden min-[1440px]:inline'}>
              Spotify
            </span>
          </button>

          <button
            onClick={() => onSelectHub('youtube')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition shrink-0 ${
              activeHub === 'youtube'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-red-400'
            }`}
            title="YouTube Premium Videos"
          >
            <Youtube className="w-3.5 h-3.5 shrink-0" />
            <span className={activeHub === 'youtube' ? 'inline' : 'hidden min-[1440px]:inline'}>
              YouTube
            </span>
          </button>
        </div>

        {/* Catalog Categories Navigation */}
        <div className="flex items-center gap-1 xl:gap-2 text-xs lg:text-[13px] font-medium pl-1 overflow-x-auto no-scrollbar max-w-[42vw] sm:max-w-none">
          {navLinks.map((link) => {
            const isActive =
              activeHub === 'cinecast' && currentCategory === link.id;

            return (
              <button
                key={link.id}
                onClick={() => {
                  onSelectHub('cinecast');
                  onSelectCategory(link.id);
                  if (link.id !== 'all') {
                    setTimeout(() => {
                      document.getElementById('archive-catalog')?.scrollIntoView({ behavior: 'smooth' });
                    }, 50);
                  }
                }}
                className={`transition px-2 py-1 rounded-lg whitespace-nowrap ${
                  isActive
                    ? 'text-white font-bold bg-red-600/20 text-red-400 border border-red-500/30'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-850'
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Actions, Unified Smart WiFi + QR Pill, Apps, Cast */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Search in CineCast */}
        {activeHub === 'cinecast' && (
          <div className="relative flex items-center">
            {isSearchOpen ? (
              <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-full px-2.5 py-1 animate-fadeIn">
                <Search className="w-3.5 h-3.5 text-zinc-400 mr-1.5 shrink-0" />
                <input
                  type="text"
                  placeholder="Títulos..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  autoFocus
                  className="bg-transparent text-xs text-white focus:outline-none w-20 sm:w-28"
                />
                <button
                  onClick={() => {
                    onSearchChange('');
                    setIsSearchOpen(false);
                  }}
                  className="text-zinc-400 hover:text-white ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-1.5 text-zinc-300 hover:text-white transition rounded-full hover:bg-zinc-800"
                title="Buscar contenido"
              >
                <Search className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* TAREA 2: Botón Modo Diagnóstico en Navbar */}
        <button
          onClick={() => diagnosticService.toggle()}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition shadow-sm shrink-0 border ${
            isDiagnosticMode
              ? 'bg-amber-500 text-black border-amber-300 animate-pulse font-black shadow-amber-500/20'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
          }`}
          title={
            isDiagnosticMode
              ? 'Modo Diagnóstico ACTIVADO (Adblock, escudos, spoof UA y reescritura de headers APAGADOS)'
              : 'Activar Modo Diagnóstico (apaga adblock, shields, spoof de UA y reescritura de headers para aislar problemas)'
          }
        >
          <Activity className={`w-3.5 h-3.5 ${isDiagnosticMode ? 'text-black' : 'text-amber-400'}`} />
          <span className="hidden lg:inline">{isDiagnosticMode ? 'Diag: ON' : 'Diag'}</span>
        </button>

        {/* Audio Equalizer Shortcut */}
        <button
          onClick={onOpenAudioModal}
          className="p-1.5 text-zinc-300 hover:text-white transition rounded-full hover:bg-zinc-800 shrink-0"
          title="Ecualizador de Audio"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Píldora Inteligente Unificada: 📡 <IP_REAL>:3000 • QR */}
        <button
          onClick={onOpenGuestModal}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold transition shadow-sm shrink-0 border ${
            lanIp && lanIp !== '127.0.0.1'
              ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/80 hover:border-emerald-400'
              : 'bg-zinc-900 border-rose-500/50 text-zinc-300 hover:bg-zinc-800'
          }`}
          title="Toca para abrir el Código QR y conectar el Control Remoto en tu Celular"
        >
          <span className="text-sm leading-none shrink-0">📡</span>
          <span className="truncate max-w-[130px] sm:max-w-none">
            {lanIp && lanIp !== '127.0.0.1' ? `${lanIp}:3000` : 'Sin WiFi'}
          </span>
          <span className="text-zinc-400 font-sans font-normal">•</span>
          <span className={`font-sans font-black uppercase text-[10px] tracking-wide ${lanIp && lanIp !== '127.0.0.1' ? 'text-emerald-200' : 'text-rose-400'}`}>
            QR
          </span>
        </button>

        {/* PWA Install Button (Compact Apps icon + text) */}
        <PWAInstallButton />

        {/* Cast / Network Status Button with Permanent Home Badge */}
        <button
          onClick={onOpenCastModal}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold transition backdrop-blur-md shrink-0 ${
            isCastConnected
              ? 'bg-red-950/60 border-red-600/60 text-red-200 hover:bg-red-900/60'
              : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
          }`}
          title="Dispositivos y Enlace de Hogar"
        >
          {isPermanentHomeLinked ? (
            <Home className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Cast className={`w-3.5 h-3.5 ${isCastConnected ? 'text-red-500 animate-pulse' : 'text-zinc-400'} shrink-0`} />
          )}
          <span className="hidden 2xl:inline truncate max-w-24">
            {connectedScreenName}
          </span>
        </button>
      </div>
    </nav>
  );
};
