/**
 * src/app/timeTracker.ts
 * Registrador de escrituras de tiempo sobre HTMLMediaElement (currentTime).
 * Cuando CINECAST_DEBUG_SYNC=1, envía cada asignación a /api/client-log con el caller stack trace.
 */

export function initTimeTracker(): void {
  if (typeof window === 'undefined') return;

  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  if (desc && desc.set) {
    const originalSet = desc.set;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      get: function () {
        return desc.get?.call(this);
      },
      set: function (newVal: number) {
        const stack = new Error().stack || '';
        const lines = stack.split('\n');
        const caller = lines[2]?.trim() || lines[1]?.trim() || 'unknown';

        const isDebug =
          Boolean((window as any).CINECAST_DEBUG_SYNC) ||
          Boolean((window as any).__CINECAST_DEBUG_SYNC) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('CINECAST_DEBUG_SYNC') === '1');

        if (isDebug) {
          fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              level: 'info',
              event: 'currentTime_write',
              targetTime: newVal,
              caller,
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        }
        return originalSet.call(this, newVal);
      },
      configurable: true,
      enumerable: true,
    });
  }
}
