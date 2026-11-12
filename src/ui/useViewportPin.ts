/**
 * src/ui/useViewportPin.ts
 * Hook que ancla elementos móviles usando visualViewport (variables CSS --vv-h y --vv-top).
 * Respaldo bottom: 0 si no hay visualViewport.
 * Recalcula en visualViewport resize/scroll, window resize/scroll, pageshow,
 * orientationchange, visibilitychange y dos veces tardías (300 ms y 1500 ms) tras cargar.
 */
import { useEffect } from 'react';

export function useViewportPin(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => {
      const vv = window.visualViewport;
      const root = document.documentElement;
      if (vv) {
        root.style.setProperty('--vv-h', `${vv.height}px`);
        root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        const bottomOffset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
        root.style.setProperty('--vv-bottom-offset', `${bottomOffset}px`);
      } else {
        root.style.setProperty('--vv-h', `${window.innerHeight}px`);
        root.style.setProperty('--vv-top', '0px');
        root.style.setProperty('--vv-bottom-offset', '0px');
      }
    };

    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('pageshow', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('visibilitychange', update);

    const t1 = setTimeout(update, 300);
    const t2 = setTimeout(update, 1500);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('pageshow', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('visibilitychange', update);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
}

