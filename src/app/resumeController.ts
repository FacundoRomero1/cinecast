/**
 * src/app/resumeController.ts
 * Único responsable de reanudar la reproducción en reproductores de terceros (modo embebido).
 *
 * Principios:
 * 1. 1 solo salto por defecto; posición aceptada si está dentro de [target-15s, target+20s] y avanzando.
 * 2. NUNCA reintentar si el tiempo real ya es >= target-15s.
 * 3. Si tras 4 s el tiempo real no llegó, permitir como máximo 1 reintento único.
 * 4. Si el usuario toca la barra o pausa mientras espera, cancelar el salto.
 * 5. Si initialTime < 30 s o > 95% de duración, no saltar (arrancar en 0).
 * 6. Esperar antes de saltar a que buffered >= target+10s o pasen 6 s.
 * 7. El celular muestra 'Reanudando en m:ss…' hasta que esté aceptado o falle (timeout 25 s).
 * 8. Instrumentación bajo CINECAST_DEBUG_PERF=1 o 'Grabar carga'.
 */

export type ResumeStatus = 'idle' | 'esperando' | 'reanudando' | 'ok' | 'fallo';

export interface ResumeState {
  status: ResumeStatus;
  objetivo: number;
}

export interface ResumePerfLog {
  attempt: number;
  targetSeconds: number;
  realBefore: number | null;
  realAt500ms: number | null;
  realAt2s: number | null;
  readyStateAt2s: number | null;
  isAdvancing: boolean;
  droppedFrames: number | null;
  retryReason?: string;
}

function isDebugPerf(): boolean {
  if (typeof process !== 'undefined' && process.env?.CINECAST_DEBUG_PERF === '1') return true;
  if (typeof window !== 'undefined') {
    if ((window as any).__cinecastDebugPerf || (window as any).CINECAST_DEBUG_PERF === '1') return true;
    try {
      if (localStorage.getItem('cinecast-debug-perf') === '1') return true;
    } catch (_) {}
  }
  return false;
}

function logPerf(entry: ResumePerfLog) {
  if (isDebugPerf()) {
    console.log('[ResumeController:Perf]', JSON.stringify(entry));
  }
  if (typeof window !== 'undefined') {
    if (!Array.isArray((window as any).__cinecastPerfLogs)) {
      (window as any).__cinecastPerfLogs = [];
    }
    (window as any).__cinecastPerfLogs.push(entry);
  }
}

async function getRealMediaStateSafe(): Promise<any> {
  try {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getRealMediaState) {
      return await (window as any).electronAPI.getRealMediaState({ force: true });
    }
  } catch (_) {}
  return null;
}

export class ResumeController {
  private static activeCount = 0;
  private activeTimer: any = null;
  private isDestroyed: boolean = false;
  private isActiveCounted: boolean = false;
  private isPollingInFlight: boolean = false;
  private state: ResumeState = { status: 'idle', objetivo: 0 };
  private onUpdateCallback: ((state: ResumeState) => void) | null = null;

  public static isAnyActive(): boolean {
    return ResumeController.activeCount > 0;
  }

  private setActiveFlag(active: boolean) {
    if (active && !this.isActiveCounted) {
      this.isActiveCounted = true;
      ResumeController.activeCount += 1;
    } else if (!active && this.isActiveCounted) {
      this.isActiveCounted = false;
      ResumeController.activeCount = Math.max(0, ResumeController.activeCount - 1);
    }
    if (typeof window !== 'undefined') {
      const isAct = ResumeController.activeCount > 0;
      (window as any).__cinecastResumeActive = isAct;
      (window as any).electronAPI?.setResumeActive?.(isAct);
    }
  }

  public getState(): ResumeState {
    return { ...this.state };
  }

  public cancel(): void {
    if (this.state.status === 'esperando' || this.state.status === 'reanudando') {
      console.log('[ResumeController] Salto cancelado por acción del usuario');
      this.stop();
      this.updateState('idle', 0);
    }
  }

  public start(
    initialTime: number,
    onUpdate: (state: ResumeState) => void,
    mediaDuration?: number
  ): () => void {
    this.stop();
    this.isDestroyed = false;
    this.onUpdateCallback = onUpdate;

    if (!initialTime || initialTime <= 0) {
      this.updateState('idle', 0);
      return () => this.stop();
    }

    // Regla: si initialTime < 30 s, no saltar (arrancar en 0)
    if (initialTime < 30) {
      console.log(`[ResumeController] initialTime=${initialTime}s < 30s, no saltar (arrancar en 0)`);
      this.updateState('idle', 0);
      return () => this.stop();
    }

    // Regla: si > 95% de duración, no saltar
    if (mediaDuration && mediaDuration > 0 && initialTime > 0.95 * mediaDuration) {
      console.log(`[ResumeController] initialTime=${initialTime}s > 95% de duración (${mediaDuration}s), no saltar`);
      this.updateState('idle', 0);
      return () => this.stop();
    }

    const targetSeconds = initialTime;
    this.setActiveFlag(true);
    this.updateState('esperando', targetSeconds);

    const startTime = Date.now();
    const maxTimeoutMs = 25000;

    const checkReadyInterval = setInterval(async () => {
      if (this.isDestroyed) {
        clearInterval(checkReadyInterval);
        return;
      }
      if (this.isPollingInFlight) return;
      this.isPollingInFlight = true;

      const elapsed = Date.now() - startTime;
      if (elapsed > maxTimeoutMs) {
        this.isPollingInFlight = false;
        clearInterval(checkReadyInterval);
        console.warn(`[ResumeController] Timeout de 25s esperando metadatos listos para ${targetSeconds}s`);
        this.updateState('fallo', targetSeconds);
        return;
      }

      const realState = await getRealMediaStateSafe();
      const hasVideo = Boolean(realState && realState.found);
      const isReady = hasVideo && (
        (typeof realState.readyState === 'number' && realState.readyState >= 2) ||
        (typeof realState.duration === 'number' && realState.duration > 60)
      );

      if (isReady) {
        clearInterval(checkReadyInterval);
        this.activeTimer = null;
        this.isPollingInFlight = false;
        if (this.isDestroyed) return;

        const effectiveDuration = mediaDuration || (typeof realState?.duration === 'number' ? realState.duration : 0);
        if (effectiveDuration > 0 && targetSeconds > 0.95 * effectiveDuration) {
          console.log(`[ResumeController] targetSeconds=${targetSeconds}s > 95% de duración (${effectiveDuration}s), no saltar`);
          this.updateState('idle', 0);
          return;
        }

        // Esperar a que buffered >= target + 10s o pasen hasta 6 s
        const bufferWaitStart = Date.now();
        while (!this.isDestroyed && (Date.now() - bufferWaitStart) < 6000) {
          const bufState = await getRealMediaStateSafe();
          const bufEnd = typeof bufState?.buffered === 'number'
            ? bufState.buffered
            : (typeof bufState?.bufferedEnd === 'number' ? bufState.bufferedEnd : 0);
          if (bufEnd >= targetSeconds + 10) {
            console.log(`[ResumeController] Búfer suficiente alcanzado: ${bufEnd.toFixed(1)}s >= ${targetSeconds + 10}s`);
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        if (this.isDestroyed) return;
        await this.executeSeekAndVerify(targetSeconds);
        return;
      }
      this.isPollingInFlight = false;
    }, 500);

    this.activeTimer = checkReadyInterval;
    return () => this.stop();
  }

  private async executeSeekAndVerify(targetSeconds: number) {
    this.updateState('reanudando', targetSeconds);

    const maxAttempts = 2; // Intento 1 + máx 1 reintento si tras 4s real < target - 15s

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.isDestroyed) return;

      console.log(`[ResumeController] Intento #${attempt} de salto a ${targetSeconds}s...`);

      const beforeState = await getRealMediaStateSafe();
      const realBefore = typeof beforeState?.currentTime === 'number' ? beforeState.currentTime : null;

      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.controlActiveMedia) {
          await (window as any).electronAPI.controlActiveMedia({
            action: 'seek',
            value: targetSeconds,
          });
        }
      } catch (err) {
        console.warn(`[ResumeController] Error en controlActiveMedia seek:`, err);
      }

      // Muestreo a los 500 ms
      await new Promise((r) => setTimeout(r, 500));
      if (this.isDestroyed) return;
      const state500 = await getRealMediaStateSafe();
      const realAt500ms = typeof state500?.currentTime === 'number' ? state500.currentTime : null;

      // Esperar 1.5 s más (total 2 s desde el salto)
      await new Promise((r) => setTimeout(r, 1500));
      if (this.isDestroyed) return;
      const state2s = await getRealMediaStateSafe();
      const realAt2s = typeof state2s?.currentTime === 'number' ? state2s.currentTime : null;
      const readyStateAt2s = typeof state2s?.readyState === 'number' ? state2s.readyState : null;
      const isAdvancingAt2s = Boolean(
        realAt2s !== null &&
        realAt500ms !== null &&
        realAt2s > (realAt500ms + 0.05)
      );
      const droppedFrames = typeof state2s?.droppedFrames === 'number' ? state2s.droppedFrames : null;

      console.log(`[ResumeController] Intento #${attempt} @2s: realTime=${realAt2s}s (objetivo=${targetSeconds}s, advancing=${isAdvancingAt2s})`);

      // Verificación rápida a los 2 s: si está en rango [target - 15, target + 20] y avanzando
      if (realAt2s !== null) {
        if (realAt2s >= (targetSeconds - 15) && realAt2s <= (targetSeconds + 20) && isAdvancingAt2s) {
          console.log(`[ResumeController] Salto verificado a los 2s en ${realAt2s.toFixed(1)}s`);
          logPerf({
            attempt,
            targetSeconds,
            realBefore,
            realAt500ms,
            realAt2s,
            readyStateAt2s,
            isAdvancing: true,
            droppedFrames,
          });
          this.updateState('ok', targetSeconds);
          return;
        }
      }

      // Esperar 2 s más (total 4 s desde el salto) para tolerar lag o buffer inicial
      await new Promise((r) => setTimeout(r, 2000));
      if (this.isDestroyed) return;
      const state4s = await getRealMediaStateSafe();
      const realAt4s = typeof state4s?.currentTime === 'number' ? state4s.currentTime : null;
      const isAdvancingAt4s = Boolean(
        realAt4s !== null &&
        realAt2s !== null &&
        realAt4s > (realAt2s + 0.05)
      );

      console.log(`[ResumeController] Intento #${attempt} @4s: realTime=${realAt4s}s (objetivo=${targetSeconds}s, advancing=${isAdvancingAt4s})`);

      // REGLA FUNDAMENTAL: NUNCA reintentar si el tiempo real ya es >= target - 15s
      if (realAt4s !== null && realAt4s >= (targetSeconds - 15)) {
        console.log(`[ResumeController] Salto verificado tras 4s en ${realAt4s.toFixed(1)}s (>= target - 15s, no reintentar)`);
        logPerf({
          attempt,
          targetSeconds,
          realBefore,
          realAt500ms,
          realAt2s,
          readyStateAt2s,
          isAdvancing: isAdvancingAt4s,
          droppedFrames,
        });
        this.updateState('ok', targetSeconds);
        return;
      }

      // Si tras 4 s no llegó (real < target - 15s):
      if (attempt < maxAttempts) {
        logPerf({
          attempt,
          targetSeconds,
          realBefore,
          realAt500ms,
          realAt2s,
          readyStateAt2s,
          isAdvancing: false,
          droppedFrames,
          retryReason: `realAt4s (${realAt4s}s) < target - 15s (${targetSeconds - 15}s)`,
        });
        console.warn(`[ResumeController] Intento #${attempt} insuficiente (${realAt4s}s). Reintentando una única vez...`);
        // Se ejecuta la siguiente iteración del bucle (attempt = 2)
      } else {
        // Falló intento 2 tras 4s
        logPerf({
          attempt,
          targetSeconds,
          realBefore,
          realAt500ms,
          realAt2s,
          readyStateAt2s,
          isAdvancing: false,
          droppedFrames,
          retryReason: `fallo definitivo tras 2 intentos (realAt4s=${realAt4s}s)`,
        });
        console.warn(`[ResumeController] Falló verificación tras ${maxAttempts} intentos. Reproductor incompatible con seek.`);
        this.updateState('fallo', targetSeconds);
        return;
      }
    }
  }

  private updateState(status: ResumeStatus, objetivo: number) {
    this.state = { status, objetivo };
    if (status === 'ok' || status === 'fallo' || status === 'idle') {
      if (this.activeTimer) {
        clearInterval(this.activeTimer);
        this.activeTimer = null;
      }
      this.setActiveFlag(false);
    }
    if (this.onUpdateCallback && !this.isDestroyed) {
      this.onUpdateCallback(this.state);
    }
    if (status === 'ok' || status === 'fallo') {
      this.isDestroyed = true;
    }
  }

  public stop() {
    this.isDestroyed = true;
    this.setActiveFlag(false);
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.onUpdateCallback = null;
  }
}
