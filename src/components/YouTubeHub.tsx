import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Tv,
  LogOut,
  ExternalLink,
  Youtube,
  Cast,
  Globe,
  Radio,
  Search,
} from 'lucide-react';
import { YouTubeVideo } from '../data/youtubeCatalog';
import { RemoteCommand } from '../types';

interface YouTubeHubProps {
  currentVideo?: YouTubeVideo | null;
  isPlaying?: boolean;
  volume?: number;
  isMuted?: boolean;
  remoteCommandTrigger?: { cmd: RemoteCommand; timestamp: number } | null;
  onSelectVideo?: (video: YouTubeVideo) => void;
  onTogglePlay?: () => void;
  onNextVideo?: () => void;
  onPrevVideo?: () => void;
  onSeekRelative?: (seconds: number) => void;
  onCastVideoToScreen?: (video: YouTubeVideo) => void;
  connectedScreenName?: string;
  isScreenMode?: boolean;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LEANBACK_TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1';

export const YouTubeHub: React.FC<YouTubeHubProps> = ({
  connectedScreenName = 'PC Dormitorio',
}) => {
  // Modo TV toggle: normal youtube.com vs youtube.com/tv con UA Leanback
  const [isTvMode, setIsTvMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cinecast_yt_tv_mode') === 'true';
    } catch {
      return false;
    }
  });

  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const webviewRef = useRef<any>(null);

  const targetUrl = isTvMode ? 'https://www.youtube.com/tv' : 'https://www.youtube.com';
  const targetUA = isTvMode ? LEANBACK_TV_UA : DESKTOP_UA;

  const toggleTvMode = () => {
    setIsTvMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cinecast_yt_tv_mode', String(next));
      } catch (_) {}
      setStatusMsg(next ? '📺 Modo TV (Leanback) activado' : '💻 Modo Normal de Escritorio activado');
      setTimeout(() => setStatusMsg(null), 3500);
      setReloadKey((k) => k + 1);
      return next;
    });
  };

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
    const confirm = window.confirm('¿Deseas cerrar sesión en YouTube y limpiar cookies de esta cuenta?');
    if (!confirm) return;

    if (window.electronAPI?.clearPartitionSession) {
      await window.electronAPI.clearPartitionSession('persist:youtube');
    }
    setStatusMsg('✨ Sesión cerrada y partición limpiada');
    setTimeout(() => setStatusMsg(null), 3000);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="pt-20 px-4 sm:px-12 max-w-7xl mx-auto pb-16">
      {/* Toast de estado */}
      {statusMsg && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-2xl bg-zinc-900 border border-red-500/80 text-white text-xs font-bold shadow-2xl flex items-center gap-2 animate-bounce">
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Barra de Navegación Mínima de YouTube (TAREA 7) */}
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
            <RefreshCw size={16} className={isLoading ? 'animate-spin text-red-500' : ''} />
          </button>

          <div className="h-6 w-[1px] bg-zinc-800 mx-1 hidden sm:block" />

          {/* Indicador de Sesión Persistente */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-zinc-300 font-semibold hidden md:inline">Sesión Persistente:</span>
            <span className="text-emerald-400 font-bold">Iniciá sesión una sola vez</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle Modo TV (TAREA 7: normal vs Leanback para vincular por código) */}
          <button
            onClick={toggleTvMode}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
              isTvMode
                ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/40'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
            }`}
            title="Alternar entre YouTube Normal y YouTube TV (para vincular con código de TV desde el móvil)"
          >
            <Tv size={14} />
            <span>{isTvMode ? '📺 Modo TV Activo (Código)' : 'Modo TV'}</span>
          </button>

          {/* Cerrar Sesión (limpia partición) */}
          <button
            onClick={handleClearSession}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-red-950/80 border border-zinc-800 hover:border-red-600/60 text-zinc-300 hover:text-red-400 text-xs font-bold transition flex items-center gap-1.5"
            title="Cerrar sesión y limpiar cookies de YouTube"
          >
            <LogOut size={13} />
            <span>Cerrar sesión</span>
          </button>

          {/* Abrir en Navegador Externo */}
          <button
            onClick={() => window.electronAPI?.openExternal?.(targetUrl)}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-bold transition flex items-center gap-1.5"
            title="Abrir en navegador predeterminado de Windows"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">Navegador</span>
          </button>
        </div>
      </div>

      {/* Contenedor del Webview Persistente */}
      <div className="w-full h-[78vh] rounded-3xl overflow-hidden bg-black border border-zinc-800 shadow-2xl relative">
        {window.electronAPI?.isElectron ? (
          <webview
            key={`yt_wv_${reloadKey}_${isTvMode ? 'tv' : 'desktop'}`}
            ref={webviewRef}
            src={targetUrl}
            partition="persist:youtube"
            useragent={targetUA}
            className="w-full h-full bg-black border-0"
            {...({ allowpopups: 'true' } as any)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
            <Youtube size={64} className="text-red-600 mb-4 animate-pulse" />
            <h3 className="text-xl font-bold text-white mb-2">YouTube Oficial</h3>
            <p className="text-zinc-400 text-sm max-w-md mb-6">
              Para reproducir y sincronizar YouTube directamente en la pantalla de tu PC, abre la aplicación de escritorio CineCast TV.
            </p>
            <a
              href="https://www.youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-xl flex items-center gap-2"
            >
              <ExternalLink size={16} />
              <span>Abrir YouTube Web</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
