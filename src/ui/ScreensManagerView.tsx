import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tv,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Search,
  Check,
  X,
  ArrowLeft,
  Wifi,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { deviceSync } from '../services/deviceSync';

export interface SavedScreen {
  id: string;
  name: string;
  address: string; // "IP:puerto", ej: "192.168.18.39:3000"
  lastSeen?: number; // timestamp ms
}

export interface ScreensStorage {
  screens: SavedScreen[];
  lastUsedId?: string;
}

const STORAGE_KEY = 'cinecast_screens_v1';

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return 'Nunca visto';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return 'ahora mismo';
  if (diffSec < 60) return `hace ${diffSec} s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays} d`;
}

export const ScreensManagerView: React.FC = () => {
  const navigate = useNavigate();

  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string>('');
  const [screenStatuses, setScreenStatuses] = useState<Record<string, 'online' | 'offline' | 'checking'>>({});

  // Formulario agregar / editar
  const [isAdding, setIsAdding] = useState(false);
  const [editingScreen, setEditingScreen] = useState<SavedScreen | null>(null);
  const [formName, setFormName] = useState('');
  const [formIp, setFormIp] = useState('');
  const [formPort, setFormPort] = useState('3000');
  const [formError, setFormError] = useState('');

  // Confirmación de borrado
  const [screenToDelete, setScreenToDelete] = useState<SavedScreen | null>(null);

  // Escaneo de red
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [discoveredIps, setDiscoveredIps] = useState<string[]>([]);

  // Notificación local
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // 1. Cargar estado inicial y auto-agregar PC principal si es la primera vez
  const loadStoredScreens = useCallback(() => {
    let stored: ScreensStorage = { screens: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (_) {}

    const list = Array.isArray(stored.screens) ? stored.screens : [];
    const currentHost = typeof window !== 'undefined' && window.location.host ? window.location.host : '';

    // Si no hay pantallas o la PC actual no está registrada, agregar la PC automáticamente
    if (currentHost && !list.some((s) => s.address === currentHost)) {
      const defaultPc: SavedScreen = {
        id: 'screen-' + Date.now(),
        name: 'PC Principal',
        address: currentHost,
        lastSeen: Date.now(),
      };
      const updated = [defaultPc, ...list];
      const newStorage: ScreensStorage = {
        screens: updated,
        lastUsedId: stored.lastUsedId || defaultPc.id,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newStorage));
      } catch (_) {}
      setScreens(updated);
      setActiveScreenId(newStorage.lastUsedId || defaultPc.id);
      return updated;
    }

    setScreens(list);
    setActiveScreenId(stored.lastUsedId || (list[0] ? list[0].id : ''));
    return list;
  }, []);

  const saveScreensToStorage = useCallback((newList: SavedScreen[], newActiveId?: string) => {
    const active = newActiveId !== undefined ? newActiveId : activeScreenId;
    const payload: ScreensStorage = {
      screens: newList,
      lastUsedId: active,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
    setScreens(newList);
    if (newActiveId !== undefined) setActiveScreenId(newActiveId);
  }, [activeScreenId]);

  // 2. Ping de salud (/api/health con 1.5s timeout)
  const pingScreen = useCallback(async (screen: SavedScreen) => {
    setScreenStatuses((prev) => ({ ...prev, [screen.id]: 'checking' }));
    try {
      // Si la dirección es la misma que la del cliente o no tiene protocolo, usar http://
      const targetUrl = screen.address.startsWith('http')
        ? `${screen.address}/api/health`
        : `http://${screen.address}/api/health`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        setScreenStatuses((prev) => ({ ...prev, [screen.id]: 'online' }));
        // Actualizar lastSeen
        setScreens((prev) => {
          const updated = prev.map((s) => (s.id === screen.id ? { ...s, lastSeen: Date.now() } : s));
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : {};
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, screens: updated }));
          } catch (_) {}
          return updated;
        });
        return true;
      } else {
        setScreenStatuses((prev) => ({ ...prev, [screen.id]: 'offline' }));
        return false;
      }
    } catch (_) {
      setScreenStatuses((prev) => ({ ...prev, [screen.id]: 'offline' }));
      return false;
    }
  }, []);

  const pingAllScreens = useCallback((list: SavedScreen[]) => {
    list.forEach((s) => pingScreen(s));
  }, [pingScreen]);

  useEffect(() => {
    const list = loadStoredScreens();
    pingAllScreens(list);
  }, [loadStoredScreens, pingAllScreens]);

  // 3. Conectar a una pantalla
  const handleConnect = (screen: SavedScreen) => {
    saveScreensToStorage(screens, screen.id);
    const currentHost = typeof window !== 'undefined' ? window.location.host : '';

    // Si es la misma dirección que sirve la app, solo activar
    if (screen.address === currentHost || !currentHost) {
      setFeedbackMsg(`Conectado a ${screen.name}`);
      setTimeout(() => setFeedbackMsg(''), 3000);
      return;
    }

    // Si es otra dirección IP/puerto:
    // Guardar en cinecast_last_server_host para que getApiBase lo use si recarga
    try {
      localStorage.setItem('cinecast_last_server_host', screen.address);
    } catch (_) {}

    // Redirigir a la pantalla remota (la forma más robusta sin problemas de CORS ni estado stale)
    const targetUrl = screen.address.startsWith('http')
      ? `${screen.address}/?role=remote#/control`
      : `http://${screen.address}/?role=remote#/control`;

    setFeedbackMsg(`Reconectando a ${screen.name}...`);
    setTimeout(() => {
      window.location.href = targetUrl;
    }, 600);
  };

  // 4. Agregar pantalla
  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedName = formName.trim();
    const trimmedIp = formIp.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const trimmedPort = formPort.trim() || '3000';

    if (!trimmedName) {
      setFormError('El nombre no puede estar vacío.');
      return;
    }
    if (!trimmedIp) {
      setFormError('La dirección IP no puede estar vacía.');
      return;
    }
    const portNum = Number(trimmedPort);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setFormError('El puerto debe ser un número válido entre 1 y 65535.');
      return;
    }

    const fullAddress = `${trimmedIp}:${portNum}`;

    if (editingScreen) {
      // Modificar existente
      const updated = screens.map((s) =>
        s.id === editingScreen.id
          ? { ...s, name: trimmedName, address: fullAddress }
          : s
      );
      saveScreensToStorage(updated);
      const mod = updated.find((s) => s.id === editingScreen.id);
      if (mod) pingScreen(mod);
      setEditingScreen(null);
    } else {
      // Crear nueva
      const newScreen: SavedScreen = {
        id: 'screen-' + Date.now(),
        name: trimmedName,
        address: fullAddress,
        lastSeen: undefined,
      };
      const updated = [...screens, newScreen];
      saveScreensToStorage(updated, newScreen.id);
      pingScreen(newScreen);
    }

    setFormName('');
    setFormIp('');
    setFormPort('3000');
    setIsAdding(false);
  };

  const handleStartEdit = (screen: SavedScreen) => {
    setEditingScreen(screen);
    setFormName(screen.name);
    const parts = screen.address.split(':');
    setFormIp(parts[0] || '');
    setFormPort(parts[1] || '3000');
    setFormError('');
    setIsAdding(true);
  };

  // 5. Borrar pantalla
  const handleConfirmDelete = () => {
    if (!screenToDelete) return;
    const updated = screens.filter((s) => s.id !== screenToDelete.id);
    const nextActive = activeScreenId === screenToDelete.id ? (updated[0] ? updated[0].id : '') : activeScreenId;
    saveScreensToStorage(updated, nextActive);
    setScreenToDelete(null);
  };

  // 6. Escaneo /24 en la red
  const handleScanNetwork = async () => {
    setIsScanning(true);
    setDiscoveredIps([]);
    setScanProgress('Iniciando escaneo...');

    // Obtener subred base desde window.location.hostname
    let baseSubnet = '192.168.1.';
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (host && host.includes('.')) {
      const segs = host.split('.');
      if (segs.length === 4) {
        baseSubnet = `${segs[0]}.${segs[1]}.${segs[2]}.`;
      }
    }

    const found: string[] = [];
    const ipsToTest: string[] = [];
    for (let i = 1; i <= 254; i++) {
      ipsToTest.push(`${baseSubnet}${i}`);
    }

    // 20 a la vez con timeout de 1s
    const CHUNK_SIZE = 20;
    for (let idx = 0; idx < ipsToTest.length; idx += CHUNK_SIZE) {
      const chunk = ipsToTest.slice(idx, idx + CHUNK_SIZE);
      setScanProgress(`Buscando en ${chunk[0]}..${chunk[chunk.length - 1]}:3000...`);

      const promises = chunk.map(async (ip) => {
        try {
          const ctrl = new AbortController();
          const tId = setTimeout(() => ctrl.abort(), 1000);
          const r = await fetch(`http://${ip}:3000/api/health`, { signal: ctrl.signal });
          clearTimeout(tId);
          if (r.ok) return `${ip}:3000`;
        } catch (_) {}
        return null;
      });

      const results = await Promise.all(promises);
      for (const res of results) {
        if (res && !found.includes(res)) {
          found.push(res);
          setDiscoveredIps((prev) => [...prev, res]);
        }
      }
    }

    setIsScanning(false);
    setScanProgress(found.length > 0 ? `Se encontraron ${found.length} pantallas.` : 'No se encontraron más pantallas en la red.');
  };

  return (
    <div className="p-3 sm:p-6 pb-40 max-w-2xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/control')}
            aria-label="Volver al control remoto"
            className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 flex items-center justify-center transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2">
              <Tv className="w-6 h-6 text-emerald-400" />
              <span>Mis Pantallas</span>
            </h1>
            <p className="text-xs text-zinc-400">
              Administrá tus pantallas de TV y dispositivos receptores
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingScreen(null);
            setFormName('');
            setFormIp('');
            setFormPort('3000');
            setFormError('');
            setIsAdding(!isAdding);
          }}
          aria-label="Agregar pantalla"
          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-2 shadow-lg transition"
        >
          {isAdding ? <X className="w-4 h-4 pointer-events-none" /> : <Plus className="w-4 h-4 pointer-events-none" />}
          <span className="pointer-events-none">{isAdding ? 'Cancelar' : 'Agregar'}</span>
        </button>
      </div>

      {/* Feedback toast */}
      {feedbackMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Formulario Agregar / Editar */}
      {isAdding && (
        <form
          onSubmit={handleSaveForm}
          className="p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-emerald-400" />
              <span>{editingScreen ? 'Editar pantalla' : 'Nueva pantalla'}</span>
            </h2>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="min-h-[44px] min-w-[44px] p-2 text-zinc-400 hover:text-white flex items-center justify-center"
              aria-label="Cerrar formulario"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {formError && (
            <p className="text-xs text-red-400 bg-red-950/60 p-2.5 rounded-lg border border-red-800">
              {formError}
            </p>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="screen-name-input" className="block text-xs font-bold text-zinc-300 mb-1">
                Nombre de la pantalla
              </label>
              <input
                id="screen-name-input"
                name="screen-name"
                type="text"
                placeholder="Ej: Sala, Living, TV Dormitorio"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                aria-label="Nombre de la pantalla"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="screen-ip-input" className="block text-xs font-bold text-zinc-300 mb-1">
                  Dirección IP o Host
                </label>
                <input
                  id="screen-ip-input"
                  name="screen-ip"
                  type="text"
                  placeholder="Ej: 192.168.1.50"
                  value={formIp}
                  onChange={(e) => setFormIp(e.target.value)}
                  aria-label="Dirección IP"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="screen-port-input" className="block text-xs font-bold text-zinc-300 mb-1">
                  Puerto
                </label>
                <input
                  id="screen-port-input"
                  name="screen-port"
                  type="text"
                  placeholder="3000"
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                  aria-label="Puerto"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              onClick={handleSaveForm}
              aria-label="Guardar pantalla"
              className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition"
            >
              <Check className="w-4 h-4 pointer-events-none" />
              <span className="pointer-events-none">{editingScreen ? 'Guardar cambios' : 'Guardar pantalla'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Lista de pantallas guardadas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Pantallas guardadas ({screens.length})
          </h2>
          <button
            type="button"
            onClick={() => pingAllScreens(screens)}
            aria-label="Actualizar estado"
            className="min-h-[44px] px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
        </div>

        {screens.length === 0 ? (
          <div className="p-8 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 text-center space-y-3">
            <Tv className="w-10 h-10 text-zinc-600 mx-auto" />
            <p className="text-sm font-bold text-zinc-300">No hay pantallas guardadas</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              Tocá el botón "Agregar" para registrar la IP de tu TV o usá "Buscar en la red".
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {screens.map((screen) => {
              const status = screenStatuses[screen.id] || 'checking';
              const isOnline = status === 'online';
              const isChecking = status === 'checking';
              const isActive = screen.id === activeScreenId;

              return (
                <div
                  key={screen.id}
                  data-screen-id={screen.id}
                  data-screen-name={screen.name}
                  className={`p-3.5 sm:p-4 rounded-2xl bg-zinc-900 border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isActive ? 'border-emerald-500/60 bg-zinc-900/90 shadow-md' : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Punto de estado */}
                    <div className="relative shrink-0 flex items-center justify-center">
                      <span
                        data-status={status}
                        className={`w-3.5 h-3.5 rounded-full block transition-colors ${
                          isOnline
                            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                            : isChecking
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                        }`}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-white truncate">
                          {screen.name}
                        </span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold border border-emerald-500/30">
                            Activa
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                        <span className="font-mono text-[11px] text-zinc-300">{screen.address}</span>
                        <span>•</span>
                        <span className="text-[11px] text-zinc-500">
                          {isOnline ? 'Conectado' : formatTimeAgo(screen.lastSeen)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Acciones de la pantalla */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleConnect(screen)}
                      aria-label={`Conectar a ${screen.name}`}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                      }`}
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      <span>{isActive ? 'Reconectar' : 'Conectar'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartEdit(screen)}
                      aria-label={`Renombrar o editar ${screen.name}`}
                      className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition border border-zinc-700/60"
                    >
                      <Edit2 className="w-4 h-4 pointer-events-none" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setScreenToDelete(screen)}
                      aria-label={`Borrar pantalla ${screen.name}`}
                      className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-zinc-800/80 hover:bg-red-950/80 text-zinc-400 hover:text-red-400 flex items-center justify-center transition border border-zinc-700/60"
                    >
                      <Trash2 className="w-4 h-4 pointer-events-none" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sección Buscar en la red /24 */}
      <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Search className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Buscar en la red local (/24)
            </h2>
          </div>
          <button
            type="button"
            onClick={handleScanNetwork}
            disabled={isScanning}
            aria-label="Escanear red local"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 transition"
          >
            {isScanning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <Search className="w-3.5 h-3.5 text-zinc-300" />
            )}
            <span>{isScanning ? 'Escaneando...' : 'Escanear red'}</span>
          </button>
        </div>

        {scanProgress && (
          <p className="text-xs text-zinc-400 italic px-1">{scanProgress}</p>
        )}

        {discoveredIps.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-bold text-zinc-300">Pantallas detectadas:</p>
            {discoveredIps.map((ip) => {
              const alreadySaved = screens.some((s) => s.address === ip);
              return (
                <div
                  key={ip}
                  className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3"
                >
                  <span className="font-mono text-xs text-emerald-400">{ip}</span>
                  {alreadySaved ? (
                    <span className="text-xs text-zinc-500 font-bold">Ya agregada</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const newScreen: SavedScreen = {
                          id: 'screen-' + Date.now(),
                          name: `TV ${ip.split(':')[0]}`,
                          address: ip,
                          lastSeen: Date.now(),
                        };
                        const updated = [...screens, newScreen];
                        saveScreensToStorage(updated, newScreen.id);
                        pingScreen(newScreen);
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Agregar</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal confirmación de borrado */}
      {screenToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2.5 rounded-xl bg-red-500/20 border border-red-500/30">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">¿Eliminar pantalla?</h3>
                <p className="text-xs text-zinc-400">Esta acción no se puede deshacer.</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300">
              ¿Estás seguro de que deseas eliminar la pantalla{' '}
              <strong className="text-white font-bold">{screenToDelete.name}</strong> ({screenToDelete.address})?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScreenToDelete(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                aria-label="Confirmar eliminación"
                onClick={handleConfirmDelete}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs transition shadow-lg"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

