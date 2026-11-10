import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

/**
 * Hook para restaurar la posición de scroll al volver a una pantalla por ruta y filtros.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;

  useEffect(() => {
    // Si tenemos una posición previa guardada para esta ruta + query, la restauramos
    const saved = scrollPositions.get(key);
    if (typeof saved === 'number' && saved > 0) {
      window.scrollTo({ top: saved, behavior: 'instant' });
    }

    const onScroll = () => {
      scrollPositions.set(key, window.scrollY);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollPositions.set(key, window.scrollY);
      window.removeEventListener('scroll', onScroll);
    };
  }, [key]);
}

