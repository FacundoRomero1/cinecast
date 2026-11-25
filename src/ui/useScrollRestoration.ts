import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getTabScroll, saveTabScroll } from './navigationMemory';

const inMemoryScroll = new Map<string, number>();
const explicitSnapshotAt = new Map<string, number>();

/**
 * Guarda explícitamente la posición de scroll actual para una ruta antes de navegar o abrir el reproductor.
 */
export function saveScrollSnapshot(key: string, pathname: string, y: number) {
  const cleanY = Math.max(0, Math.round(y));
  inMemoryScroll.set(key, cleanY);
  explicitSnapshotAt.set(key, Date.now());
  saveTabScroll(pathname, cleanY);
}

/**
 * Hook para restaurar la posición de scroll al volver a una pantalla por ruta y filtros.
 * Espera a que el contenido asíncrono o virtualizado alcance la altura guardada
 * sin pisar la posición guardada con `0` durante la transición/desmontaje de ruta.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const savedInMemory = inMemoryScroll.get(key);
    const savedInStorage = getTabScroll(location.pathname);
    const saved =
      typeof savedInMemory === 'number'
        ? savedInMemory
        : typeof savedInStorage === 'number'
        ? savedInStorage
        : 0;

    let restored = saved <= 0;
    let userInteracted = false;
    let rafId: number | null = null;
    let resizeObs: ResizeObserver | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const deadlineAt = Date.now() + 2000;

    const tryRestore = () => {
      if (restored || userInteracted || saved <= 0) return;
      const maxReachable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (maxReachable >= saved - 8) {
        window.scrollTo({ top: saved, behavior: 'instant' });
        if (Math.abs(window.scrollY - saved) <= 8) {
          restored = true;
          return;
        }
      }
      if (Date.now() < deadlineAt) {
        rafId = window.requestAnimationFrame(tryRestore);
      } else {
        if (maxReachable > 0) {
          window.scrollTo({ top: Math.min(saved, maxReachable), behavior: 'instant' });
        }
        restored = true;
      }
    };

    if (saved > 0) {
      window.scrollTo({ top: saved, behavior: 'instant' });
      const maxReachableNow = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (maxReachableNow >= saved - 8 && Math.abs(window.scrollY - saved) <= 8) {
        restored = true;
      } else {
        rafId = window.requestAnimationFrame(tryRestore);
        if (typeof ResizeObserver !== 'undefined' && document.body) {
          resizeObs = new ResizeObserver(() => {
            tryRestore();
          });
          resizeObs.observe(document.body);
        }
        // Segundo intento por si el browser popstate reseteó el scroll justo después del primer paint
        fallbackTimer = setTimeout(() => {
          tryRestore();
        }, 60);
      }
    }

    const markUserInteracted = () => {
      userInteracted = true;
      restored = true;
    };

    const onScroll = () => {
      if (!restored && !userInteracted && saved > 0) {
        return;
      }
      const snapTs = explicitSnapshotAt.get(key) || 0;
      if (Date.now() - snapTs < 600 && window.scrollY === 0) {
        return;
      }
      const maxReachable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (window.scrollY === 0 && maxReachable <= 20) {
        // Ignorar clamp accidental cuando el contenedor ya se achicó al cambiar de vista
        return;
      }
      const y = Math.round(window.scrollY);
      inMemoryScroll.set(key, y);
      saveTabScroll(location.pathname, y);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', markUserInteracted, { passive: true });
    window.addEventListener('touchmove', markUserInteracted, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      resizeObs?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', markUserInteracted);
      window.removeEventListener('touchmove', markUserInteracted);
      // No escribir `0` en cleanup: durante React commit el DOM de la ruta saliente ya pudo achicarse
      if (window.scrollY > 0) {
        const y = Math.round(window.scrollY);
        inMemoryScroll.set(key, y);
        saveTabScroll(location.pathname, y);
      }
    };
  }, [key, location.pathname]);
}
