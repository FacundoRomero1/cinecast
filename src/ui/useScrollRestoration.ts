import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getTabScroll, saveTabScroll } from './navigationMemory';

const inMemoryScroll = new Map<string, number>();

/**
 * Hook para restaurar la posición de scroll al volver a una pantalla por ruta y filtros.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;

  useEffect(() => {
    // Si tenemos una posición previa guardada para esta ruta + query o por pestaña, la restauramos
    const savedInMemory = inMemoryScroll.get(key);
    const savedInStorage = getTabScroll(location.pathname);
    const saved = typeof savedInMemory === 'number' && savedInMemory > 0 ? savedInMemory : savedInStorage;

    if (typeof saved === 'number' && saved > 0) {
      window.scrollTo({ top: saved, behavior: 'instant' });
    }

    const onScroll = () => {
      const y = window.scrollY;
      inMemoryScroll.set(key, y);
      saveTabScroll(location.pathname, y);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      const y = window.scrollY;
      inMemoryScroll.set(key, y);
      saveTabScroll(location.pathname, y);
      window.removeEventListener('scroll', onScroll);
    };
  }, [key, location.pathname]);
}
