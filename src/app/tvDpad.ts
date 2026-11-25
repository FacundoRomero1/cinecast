import { isAndroidTvDevice } from '../services/apiOrigin';

/**
 * Soporte de navegación D-Pad para Android TV / Google TV (flechas, Enter/OK y Atrás).
 * Se activa automáticamente en dispositivos Android TV (o con ?tv=1 / flavor tv).
 */
let initialized = false;

export function initTvDpadNavigation(): void {
  if (typeof window === 'undefined' || initialized) return;
  if (!isAndroidTvDevice()) return;
  initialized = true;

  document.documentElement.classList.add('cinecast-tv-mode');

  const getFocusables = (): HTMLElement[] => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    return nodes.filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
    });
  };

  const moveFocus = (dir: 'up' | 'down' | 'left' | 'right') => {
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !focusables.includes(active)) {
      focusables[0]?.focus();
      focusables[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      return;
    }

    const r = active.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const el of focusables) {
      if (el === active) continue;
      const er = el.getBoundingClientRect();
      const ex = er.left + er.width / 2;
      const ey = er.top + er.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      if (dir === 'right' && dx <= 8) continue;
      if (dir === 'left' && dx >= -8) continue;
      if (dir === 'down' && dy <= 8) continue;
      if (dir === 'up' && dy >= -8) continue;

      const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  };

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        (e.target as HTMLElement).blur();
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveFocus('right');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocus('left');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus('up');
    }
  });
}
