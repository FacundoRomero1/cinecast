/**
 * src/ui/scrollLock.ts
 * Bloqueo de scroll compartido con contador.
 * Guarda y restaura exactamente los estilos previos de html y body (solo overflow, sin tocar position ni top).
 * Restauración garantizada en cleanup, pagehide y visibilitychange.
 */

let lockCount = 0;
let savedHtmlOverflow = '';
let savedBodyOverflow = '';

export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  if (lockCount === 0) {
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  lockCount++;

  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    unlockScroll();
  };
}

export function unlockScroll(): void {
  if (typeof document === 'undefined') return;
  if (lockCount > 0) {
    lockCount--;
  }
  if (lockCount === 0) {
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.body.style.overflow = savedBodyOverflow;
  }
}

export function forceResetScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (lockCount > 0) {
    lockCount = 0;
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.body.style.overflow = savedBodyOverflow;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', forceResetScrollLock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      forceResetScrollLock();
    }
  });
}

