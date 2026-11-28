import { isAndroidTvDevice } from '../services/apiOrigin';

/**
 * Navegación D-Pad completa para Android TV / Google TV / TV Boxes / control por teclado.
 * - Se activa automáticamente en TV y también en el primer toque de flechas en cualquier dispositivo.
 * - Inyecta un recuadro de foco rojo de alto contraste para ver siempre qué está seleccionado.
 * - Ignora botones ocultos (opacity: 0) dentro de tarjetas.
 * - Permite saltar entre el menú lateral (<aside>) y el contenido (<main>), y scrollea automáticamente.
 */
let initialized = false;

function injectTvFocusStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cinecast-tv-dpad-styles')) return;
  const style = document.createElement('style');
  style.id = 'cinecast-tv-dpad-styles';
  style.textContent = `
    .cinecast-tv-mode :focus {
      outline: 3px solid #ef4444 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.45) !important;
      position: relative;
      z-index: 30;
    }
    .cinecast-tv-mode article[role="button"]:focus {
      transform: scale(1.04) !important;
      border-color: #ef4444 !important;
    }
  `;
  document.head.appendChild(style);
}

export function initTvDpadNavigation(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  injectTvFocusStyles();

  if (isAndroidTvDevice()) {
    document.documentElement.classList.add('cinecast-tv-mode');
  }

  const isVisibleFocusable = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') {
      return false;
    }
    if (parseFloat(style.opacity || '1') < 0.15) return false;
    // Ignorar botones dentro de overlays hover con opacity-0 (ej. botones internos de TitleCard)
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      const ps = window.getComputedStyle(parent);
      if (parseFloat(ps.opacity || '1') < 0.15 || ps.display === 'none' || ps.visibility === 'hidden') {
        return false;
      }
      parent = parent.parentElement;
      depth++;
    }
    return true;
  };

  const getFocusables = (root: ParentNode = document): HTMLElement[] => {
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [role="button"][tabindex="0"], [tabindex="0"]'
      )
    );
    return nodes.filter(isVisibleFocusable);
  };

  const focusEl = (el: HTMLElement) => {
    el.focus({ preventScroll: true });
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      el.scrollIntoView();
    }
  };

  const moveFocus = (dir: 'up' | 'down' | 'left' | 'right') => {
    document.documentElement.classList.add('cinecast-tv-mode');
    const focusables = getFocusables();
    if (focusables.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    if (!active || !focusables.includes(active)) {
      const mainEl = document.querySelector('main');
      const mainFocusables = mainEl ? getFocusables(mainEl) : [];
      const first = mainFocusables[0] || focusables[0];
      if (first) focusEl(first);
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

      if (dir === 'right' && dx <= 10) continue;
      if (dir === 'left' && dx >= -10) continue;
      if (dir === 'down' && dy <= 10) continue;
      if (dir === 'up' && dy >= -10) continue;

      const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.4;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    // Salto explícito entre barra lateral (<aside>) y contenido principal (<main>)
    if (!best && dir === 'left') {
      const aside = document.querySelector('aside');
      if (aside && !aside.contains(active)) {
        const asideItems = getFocusables(aside);
        if (asideItems.length > 0) {
          // Elegir el item del sidebar más cercano verticalmente
          best = asideItems.reduce((closest, item) => {
            const ir = item.getBoundingClientRect();
            const cr = closest.getBoundingClientRect();
            return Math.abs(ir.top - r.top) < Math.abs(cr.top - r.top) ? item : closest;
          }, asideItems[0]);
        }
      }
    } else if (!best && dir === 'right') {
      const aside = document.querySelector('aside');
      const mainEl = document.querySelector('main');
      if (aside && aside.contains(active) && mainEl) {
        const mainItems = getFocusables(mainEl);
        if (mainItems.length > 0) {
          best = mainItems[0];
        }
      }
    }

    if (best) {
      focusEl(best);
    } else if (dir === 'down') {
      // Scrollear hacia abajo para destrabar grillas largas (Explorar catálogo / Virtuoso)
      window.scrollBy({ top: 380, behavior: 'smooth' });
    } else if (dir === 'up') {
      window.scrollBy({ top: -380, behavior: 'smooth' });
    }
  };

  window.addEventListener(
    'keydown',
    (e) => {
      // No interceptar cuando el reproductor de video está abierto en pantalla completa
      if (document.querySelector('[data-testid="video-player"]')) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          target?.blur();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveFocus('down');
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveFocus('up');
          }
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
      } else if ((e.key === 'Enter' || e.key === 'NumpadEnter' || (e as any).keyCode === 23) && target) {
        // Asegurar que Enter/OK en el control de la TV active enlaces del sidebar y botones
        if (tag === 'A' || tag === 'BUTTON' || target.getAttribute('role') === 'button') {
          e.preventDefault();
          target.click();
        }
      }
    },
    true
  );
}
