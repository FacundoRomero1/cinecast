/**
 * src/app/resumeController.ts
 * Único responsable de reanudar la reproducción en reproductores de terceros (modo embebido).
 *
 * Flujo:
 * 1. Cuando se inicia un embebido con initialTime > 0:
 *    - status: 'esperando', objetivo: initialTime.
 *    - Consulta el video real cada 500 ms hasta ver uno con readyState >= 2 y duración > 60 s (máximo 25 s).
 * 2. Al estar listo:
 *    - status: 'reanudando'.
 *    - Salta a initialTime mediante controlActiveMedia('seek', initialTime).
 *    - Espera 1.5 s y verifica que el tiempo real esté dentro de 3 s del objetivo.
 *    - Reintenta hasta 3 veces (1.5 s entre intentos).
 * 3. Si se verifica:
 *    - status: 'ok'.
 * 4. Si falla o vence timeout:
 *    - status: 'fallo'.
 */

export type ResumeStatus = 'idle' | 'esperando' | 'reanudando' | 'ok' | 'fallo';

export interface ResumeState {
  status: ResumeStatus;
  objetivo: number;
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

  public start(
    initialTime: number,
    onUpdate: (state: ResumeState) => void
  ): () => void {
    this.stop();
    this.isDestroyed = false;
    this.onUpdateCallback = onUpdate;

    if (!initialTime || initialTime <= 0) {
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

      // Consultar estado real del reproductor
      let realState: any = null;
      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.getRealMediaState) {
          realState = await (window as any).electronAPI.getRealMediaState({ force: true });
        }
      } catch (_) {}

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

        // Iniciar secuencia de salto y verificación
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

    const maxAttempts = 3;
    const waitBetweenAttemptsMs = 1500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.isDestroyed) return;

      console.log(`[ResumeController] Intento #${attempt} de salto a ${targetSeconds}s...`);
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

      // Esperar 1.5 s para que el reproductor aplique el salto y empiece a correr
      await new Promise((r) => setTimeout(r, waitBetweenAttemptsMs));
      if (this.isDestroyed) return;

      // Verificar tiempo real
      let verifyState: any = null;
      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.getRealMediaState) {
          verifyState = await (window as any).electronAPI.getRealMediaState({ force: true });
        }
      } catch (_) {}

      const realTime = typeof verifyState?.currentTime === 'number' ? verifyState.currentTime : null;
      console.log(`[ResumeController] Intento #${attempt}: realTime=${realTime}s (objetivo=${targetSeconds}s)`);

      if (realTime !== null) {
        // Tolerancia: dentro de 3 s del objetivo (o avanzando tras el objetivo)
        const diff = Math.abs(realTime - targetSeconds);
        const progressingPast = realTime >= (targetSeconds - 3) && realTime <= (targetSeconds + 15);

        if (diff <= 3 || progressingPast) {
          console.log(`[ResumeController] Salto verificado exitosamente a ${realTime.toFixed(1)}s`);
          this.updateState('ok', targetSeconds);
          return;
        }
      }
    }

    console.warn(`[ResumeController] Falló verificación tras ${maxAttempts} intentos. Reproductor incompatible con seek.`);
    this.updateState('fallo', targetSeconds);
  }

  private updateState(status: ResumeStatus, objetivo: number) {
    this.state = { status, objetivo };
    // PARTE 3 (Paso 9d): Dejar de consultar apenas llega a 'ok' o 'fallo'
    if (status === 'ok' || status === 'fallo') {
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

