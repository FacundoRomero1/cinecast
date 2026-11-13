/**
 * src/app/embedAudio.ts
 * Cadena Web Audio para marcos embebidos y reproductores de Cinecast.
 * - Soporta volumen 0-200% (con limitador/compresor suave sobre 100% para evitar clipping)
 * - Presets: 'dialogos' (realce 1-3kHz, atenuación graves), 'nocturno' (alta compresión), 'estandar' (plano)
 * - Ecualizador de 3 bandas: graves (lowshelf 250Hz), medios (peaking 2kHz), agudos (highshelf 4kHz)
 * - Detección inteligente de CORS / Silencio a los 1.5s: si no hay señal o CORS bloquea el AudioContext,
 *   pasa automáticamente a modo transparente (bypass directo) sin romper el audio.
 */

export interface EmbedAudioConfig {
  volume: number; // 0 a 200 (%)
  preset: 'dialogos' | 'nocturno' | 'estandar';
  bassDb: number; // -12 a +12 dB
  midDb: number; // -12 a +12 dB
  trebleDb: number; // -12 a +12 dB
  compressorEnabled: boolean;
}

export const DEFAULT_EMBED_AUDIO_CONFIG: EmbedAudioConfig = {
  volume: 100,
  preset: 'estandar',
  bassDb: 0,
  midDb: 0,
  trebleDb: 0,
  compressorEnabled: false,
};

export class EmbedAudioChain {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private midFilter: BiquadFilterNode | null = null;
  private trebleFilter: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private isBypassed: boolean = false;
  private isMeasuring: boolean = false;
  private config: EmbedAudioConfig = { ...DEFAULT_EMBED_AUDIO_CONFIG };

  public attach(mediaEl: HTMLMediaElement, isSimulatedCors = false): boolean {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      this.isBypassed = true;
      return false;
    }

    // Si simula CORS o el elemento no permite Web Audio
    if (isSimulatedCors) {
      this.startCorsMeasurement(mediaEl, true);
      return false;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Intentar crear MediaElementSource
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(mediaEl);
      } catch (err: any) {
        console.warn('[embedAudio] CORS detectado en createMediaElementSource -> Bypass directo');
        this.isBypassed = true;
        return false;
      }

      // 1. Filtro Graves (Lowshelf 250 Hz)
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 250;

      // 2. Filtro Medios / Voces (Peaking 2000 Hz)
      this.midFilter = this.audioCtx.createBiquadFilter();
      this.midFilter.type = 'peaking';
      this.midFilter.frequency.value = 2000;
      this.midFilter.Q.value = 1.0;

      // 3. Filtro Agudos (Highshelf 4000 Hz)
      this.trebleFilter = this.audioCtx.createBiquadFilter();
      this.trebleFilter.type = 'highshelf';
      this.trebleFilter.frequency.value = 4000;

      // 4. Compresor de dinámica
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -24;
      this.compressorNode.knee.value = 30;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;

      // 5. Ganancia Maestra
      this.gainNode = this.audioCtx.createGain();

      // 6. Analizador de señal para detección de silencio
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;

      // Conexión de la cadena
      this.sourceNode.connect(this.bassFilter);
      this.bassFilter.connect(this.midFilter);
      this.midFilter.connect(this.trebleFilter);
      this.trebleFilter.connect(this.compressorNode);
      this.compressorNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);

      this.applyConfig(this.config);

      // Iniciar período de medición de 1.5 s para verificar señal viva o silencio/CORS
      this.startCorsMeasurement(mediaEl, false);
      return true;
    } catch (e: any) {
      console.warn('[embedAudio] Error al inicializar Web Audio -> Modo bypass', e.message);
      this.isBypassed = true;
      return false;
    }
  }

  private startCorsMeasurement(mediaEl: HTMLMediaElement, forceCors: boolean): void {
    this.isMeasuring = true;
    setTimeout(() => {
      this.isMeasuring = false;
      if (forceCors) {
        this.bypass();
        return;
      }

      if (this.analyserNode && this.audioCtx && this.audioCtx.state === 'running') {
        const buffer = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        // Si el video está reproduciendo y tras 1.5s sum === 0 -> CORS o silencio absoluto
        if (!mediaEl.paused && sum === 0) {
          console.log('[embedAudio] Señal nula tras 1.5 s de medición -> Activando bypass');
          this.bypass();
        } else {
          console.log('[embedAudio] Señal de audio confirmada activa (sum=' + sum + ')');
        }
      }
    }, 1500);
  }

  public bypass(): void {
    this.isBypassed = true;
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (_) {}
      this.audioCtx = null;
    }
    console.log('[embedAudio] Cadena Web Audio en modo transparente (bypass directo)');
  }

  public applyConfig(newConfig: Partial<EmbedAudioConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // 1. Presets predefinidos
    if (newConfig.preset === 'dialogos') {
      this.config.bassDb = -6;
      this.config.midDb = 6;
      this.config.trebleDb = 2;
      this.config.compressorEnabled = true;
    } else if (newConfig.preset === 'nocturno') {
      this.config.bassDb = -4;
      this.config.midDb = 3;
      this.config.trebleDb = 0;
      this.config.compressorEnabled = true;
    } else if (newConfig.preset === 'estandar') {
      this.config.bassDb = 0;
      this.config.midDb = 0;
      this.config.trebleDb = 0;
      this.config.compressorEnabled = false;
    }

    if (this.isBypassed || !this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    // 2. Ecualización (dB)
    if (this.bassFilter) {
      this.bassFilter.gain.value = Math.max(-12, Math.min(12, this.config.bassDb));
    }
    if (this.midFilter) {
      this.midFilter.gain.value = Math.max(-12, Math.min(12, this.config.midDb));
    }
    if (this.trebleFilter) {
      this.trebleFilter.gain.value = Math.max(-12, Math.min(12, this.config.trebleDb));
    }

    // 3. Compresor de dinámica
    if (this.compressorNode) {
      if (this.config.preset === 'nocturno') {
        this.compressorNode.threshold.value = -32;
        this.compressorNode.ratio.value = 12;
      } else if (this.config.compressorEnabled) {
        this.compressorNode.threshold.value = -24;
        this.compressorNode.ratio.value = 4;
      } else {
        // Bypass suave de compresor: umbral a 0 dB, ratio 1
        this.compressorNode.threshold.value = 0;
        this.compressorNode.ratio.value = 1;
      }
    }

    // 4. Volumen general 0 - 200 %
    if (this.gainNode) {
      const volPct = Math.max(0, Math.min(200, this.config.volume));
      // Más allá del 100% (hasta 200%), amplificación con ganancia de hasta 2.0x
      const linearGain = volPct / 100;
      this.gainNode.gain.setValueAtTime(linearGain, this.audioCtx.currentTime);
    }
  }

  public getConfig(): EmbedAudioConfig {
    return { ...this.config };
  }

  public isBypassActive(): boolean {
    return this.isBypassed;
  }
}

export const globalEmbedAudio = new EmbedAudioChain();
if (typeof window !== 'undefined') {
  (window as any).cinecastEmbedAudio = globalEmbedAudio;
}
