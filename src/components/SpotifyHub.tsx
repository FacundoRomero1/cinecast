import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  LogOut,
  ExternalLink,
  Music,
  CheckCircle2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { SpotifyTrack } from '../data/spotifyCatalog';
import { hubFullscreen } from '../app/hubFullscreen';

interface SpotifyHubProps {
  currentTrack?: SpotifyTrack | null;
  isPlaying?: boolean;
  volume?: number;
  isMuted?: boolean;
  onSelectTrack?: (track: SpotifyTrack) => void;
  onTogglePlay?: () => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  onCastTrackToScreen?: (track: SpotifyTrack) => void;
  connectedScreenName?: string;
  isScreenMode?: boolean;
  isActive?: boolean;
}

export const SpotifyHub: React.FC<SpotifyHubProps> = ({
  connectedScreenName = 'PC Dormitorio',
  isActive = true,
}) => {
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showExitBtn, setShowExitBtn] = useState<boolean>(false);

  const webviewRef = useRef<any>(null);
  const isFullscreenRef = useRef<boolean>(false);
  const isActiveRef = useRef<boolean>(isActive);
  const hideExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const enterHubFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    setShowExitBtn(true);
    if (hideExitTimerRef.current) clearTimeout(hideExitTimerRef.current);
    hideExitTimerRef.current = setTimeout(() => setShowExitBtn(false), 2500);
    if (window.electronAPI?.toggleFullscreen) {
      try {
        await window.electronAPI.toggleFullscreen(true);
      } catch (_) {}
    }
  }, []);

  const exitHubFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    setShowExitBtn(false);
    if (hideExitTimerRef.current) {
      clearTimeout(hideExitTimerRef.current);
      hideExitTimerRef.current = null;
    }
    if (window.electronAPI?.toggleFullscreen) {
      try {
        await window.electronAPI.toggleFullscreen(false);
      } catch (_) {}
    }
  }, []);

  const toggleHubFullscreen = useCallback(() => {
    if (isFullscreenRef.current) {
      exitHubFullscreen();
    } else {
      enterHubFullscreen();
    }
  }, [enterHubFullscreen, exitHubFullscreen]);

  const handleMouseMoveInFullscreen = useCallback(() => {
    if (!isFullscreenRef.current) return;
    setShowExitBtn(true);
    if (hideExitTimerRef.current) clearTimeout(hideExitTimerRef.current);
    hideExitTimerRef.current = setTimeout(() => setShowExitBtn(false), 2500);
  }, []);

  useEffect(() => {
    if (!isActive && isFullscreenRef.current) {
      exitHubFullscreen();
    }
  }, [isActive, exitHubFullscreen]);

  useEffect(() => {
    return hubFullscreen.subscribe((action) => {
      if (!isActiveRef.current) return;
      if (action === 'enter') enterHubFullscreen();
      else if (action === 'exit') exitHubFullscreen();
      else toggleHubFullscreen();
    });
  }, [enterHubFullscreen, exitHubFullscreen, toggleHubFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (e.key === 'F11') {
        e.preventDefault();
        toggleHubFullscreen();
      } else if (e.key === 'Escape' && isFullscreenRef.current) {
        e.preventDefault();
        exitHubFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleHubFullscreen, exitHubFullscreen]);

  // Limpiar estado de pantalla completa al desmontar el componente
  useEffect(() => {
    return () => {
      if (hideExitTimerRef.current) {
        clearTimeout(hideExitTimerRef.current);
      }
      if (isFullscreenRef.current && window.electronAPI?.toggleFullscreen) {
        window.electronAPI.toggleFullscreen(false).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const handleStart = () => setIsLoading(true);
    const handleStop = () => {
      setIsLoading(false);
      try {
        if (wv.canGoBack) setCanGoBack(wv.canGoBack());
        if (wv.canGoForward) setCanGoForward(wv.canGoForward());
      } catch (_) {}
    };

    wv.addEventListener('did-start-loading', handleStart);
    wv.addEventListener('did-stop-loading', handleStop);

    return () => {
      try {
        wv.removeEventListener('did-start-loading', handleStart);
        wv.removeEventListener('did-stop-loading', handleStop);
      } catch (_) {}
    };
  }, [reloadKey]);

  const handleGoBack = () => {
    if (webviewRef.current?.goBack) webviewRef.current.goBack();
  };

  const handleGoForward = () => {
    if (webviewRef.current?.goForward) webviewRef.current.goForward();
  };

  const handleReload = () => {
    if (webviewRef.current?.reload) webviewRef.current.reload();
    else setReloadKey((k) => k + 1);
  };

  const handleClearSession = async () => {
    const confirm = window.confirm('¿Deseas cerrar sesión en Spotify y limpiar cookies de esta cuenta?');
    if (!confirm) return;

    if (window.electronAPI?.clearPartitionSession) {
      await window.electronAPI.clearPartitionSession('persist:spotify');
    }
    setStatusMsg('✨ Sesión de Spotify cerrada');
    setTimeout(() => setStatusMsg(null), 3000);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="pt-20 px-4 sm:px-12 max-w-7xl mx-auto pb-16">
      {/* Toast de estado */}
      {statusMsg && !isFullscreen && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-2xl bg-zinc-900 border border-emerald-500/80 text-white text-xs font-bold shadow-2xl flex items-center gap-2 animate-bounce">
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Barra de Navegación Mínima de Spotify (oculta en pantalla completa) */}
      {!isFullscreen && (
        <>
          <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-3 mb-4 flex flex-wrap items-center justify-between gap-3 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2">
              {/* Botón Atrás */}
              <button
                onClick={handleGoBack}
                disabled={!canGoBack}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40 transition"
                title="Atrás"
              >
                <ChevronLeft size={16} />
              </button>

              {/* Botón Adelante */}
              <button
                onClick={handleGoForward}
                disabled={!canGoForward}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40 transition"
                title="Adelante"
              >
                <ChevronRight size={16} />
              </button>

              {/* Botón Recargar */}
              <button
                onClick={handleReload}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition"
                title="Recargar página"
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin text-emerald-500' : ''} />
              </button>

              <div className="h-6 w-[1px] bg-zinc-800 mx-1 hidden sm:block" />

              {/* Indicador de Sesión Persistente */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-zinc-300 font-semibold hidden md:inline">Sesión Persistente:</span>
                <span className="text-emerald-400 font-bold">Login guardado en disco</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Botón Pantalla Completa (>= 44 px) */}
              <button
                type="button"
                onClick={toggleHubFullscreen}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 hover:text-white text-xs font-bold transition flex items-center gap-1.5"
                title="Pantalla completa (F11)"
              >
                <Maximize2 size={15} />
                <span>Pantalla completa</span>
              </button>

              {/* Cerrar Sesión */}
              <button
                onClick={handleClearSession}
                className="min-h-[44px] px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-red-950/80 border border-zinc-800 hover:border-red-600/60 text-zinc-300 hover:text-red-400 text-xs font-bold transition flex items-center gap-1.5"
                title="Cerrar sesión y limpiar cookies de Spotify"
              >
                <LogOut size={13} />
                <span>Cerrar sesión</span>
              </button>

              {/* Botón Abrir en Navegador con Explicación de Widevine */}
              <button
                onClick={() => window.electronAPI?.openExternal?.('https://open.spotify.com')}
                className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
                title="Abrir en navegador externo (Chrome/Edge con soporte Widevine CDM certificado)"
              >
                <ExternalLink size={13} />
                <span>Abrir en navegador</span>
              </button>
            </div>
          </div>

          {/* Widevine CDM Verificado: Banner Verde Activo */}
          <div className="mb-4 p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              <span className="leading-relaxed">
                <strong className="text-white">Widevine CDM Activo (CastLabs ECS v44.5.1):</strong> Reproducción de audio y podcasts protegidos habilitada nativamente en la aplicación. Tu sesión y cuenta quedan guardadas en disco.
              </span>
            </div>
          </div>
        </>
      )}

      {/* Contenedor del Webview Persistente */}
      <div
        onMouseMove={handleMouseMoveInFullscreen}
        className={
          isFullscreen
            ? 'fixed inset-0 z-[9999] w-screen h-screen bg-black overflow-hidden'
            : 'w-full h-[75vh] rounded-3xl overflow-hidden bg-black border border-zinc-800 shadow-2xl relative'
        }
      >
        {isFullscreen && (
          <button
            type="button"
            onClick={exitHubFullscreen}
            className={`fixed top-4 right-4 z-[10000] min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-zinc-900/75 hover:bg-zinc-900/95 border border-zinc-700/80 text-zinc-100 text-xs font-bold backdrop-blur-md shadow-xl flex items-center gap-1.5 transition-opacity duration-200 ${
              showExitBtn ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            title="Salir de pantalla completa (Esc / F11)"
          >
            <Minimize2 size={14} />
            <span>Salir</span>
          </button>
        )}

        {window.electronAPI?.isElectron ? (
          <webview
            key={`sp_wv_${reloadKey}`}
            ref={webviewRef}
            src="https://open.spotify.com"
            partition="persist:spotify"
            className="w-full h-full bg-black border-0"
            {...({ allowpopups: 'true' } as any)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
            <Music size={64} className="text-emerald-500 mb-4 animate-pulse" />
            <h3 className="text-xl font-bold text-white mb-2">Spotify Web Oficial</h3>
            <p className="text-zinc-400 text-sm max-w-md mb-6">
              Para reproducir y sincronizar música en la pantalla de tu PC, abre la aplicación de escritorio CineCast TV.
            </p>
            <a
              href="https://open.spotify.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl flex items-center gap-2"
            >
              <ExternalLink size={16} />
              <span>Abrir Spotify Web</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
