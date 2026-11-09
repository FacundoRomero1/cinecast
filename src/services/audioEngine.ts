import { AudioSettings } from '../types';

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private bassNode: BiquadFilterNode | null = null;
  private midNode: BiquadFilterNode | null = null;
  private trebleNode: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private gainNode: GainNode | null = null;
  private currentElement: HTMLMediaElement | null = null;
  private isAttached: boolean = false;
  private lastSettings: AudioSettings | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass && !this.audioCtx) {
            this.audioCtx = new AudioContextClass();
          }
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().then(() => {
              if (this.currentElement && !this.isAttached) {
                this.attachWebAudioGraph(this.currentElement);
                if (this.lastSettings) {
                  this.applySettings(this.lastSettings);
                }
              }
            }).catch(() => {});
          }
        } catch (_) {}
      };
      window.addEventListener('click', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
    }
  }

  /**
   * Desconecta y limpia el grafo previo. Debe llamarse antes de init() cuando el <video>
   * se vuelve a montar (p. ej. al cambiar key cors/nocors), porque un nodo
   * MediaElementSource queda ligado al elemento anterior y dejaría el audio en silencio.
   */
  public reset() {
    const nodes: (AudioNode | null)[] = [
      this.sourceNode,
      this.bassNode,
      this.midNode,
      this.trebleNode,
      this.compressorNode,
      this.gainNode,
    ];
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch (_) {}
    }
    this.sourceNode = null;
    this.bassNode = null;
    this.midNode = null;
    this.trebleNode = null;
    this.compressorNode = null;
    this.gainNode = null;
    this.isAttached = false;
    this.currentElement = null;
  }

  public init(mediaElement: HTMLMediaElement) {
    if (this.currentElement && this.currentElement !== mediaElement) {
      this.reset();
    }
    this.currentElement = mediaElement;
    this.audioCtx?.resume().catch(() => {});

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      this.audioCtx.resume().catch(() => {});

      const isStandard = !this.lastSettings || (
        this.lastSettings.preset === 'standard' &&
        !this.lastSettings.compressorEnabled &&
        !this.lastSettings.dialogueBoost &&
        this.lastSettings.bassGain === 0
      );

      // Si es estándar, no conectamos createMediaElementSource para permitir que canales IPTV arranquen directo
      if (!isStandard && this.audioCtx.state === 'running') {
        this.attachWebAudioGraph(mediaElement);
      }
    } catch (e) {
      console.warn('Web Audio init note:', e);
    }
  }

  private attachWebAudioGraph(mediaElement: HTMLMediaElement) {
    if (!this.audioCtx || this.isAttached) return;
    // Sin crossOrigin, un MediaElementSource de origen remoto emite silencio: no enganchar el grafo.
    if (mediaElement.crossOrigin === null) return;
    try {
      this.sourceNode = this.audioCtx.createMediaElementSource(mediaElement);

      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.setValueAtTime(120, this.audioCtx.currentTime);
      this.bassNode.gain.setValueAtTime(0, this.audioCtx.currentTime);

      this.midNode = this.audioCtx.createBiquadFilter();
      this.midNode.type = 'peaking';
      this.midNode.frequency.setValueAtTime(1800, this.audioCtx.currentTime);
      this.midNode.Q.setValueAtTime(1.4, this.audioCtx.currentTime);
      this.midNode.gain.setValueAtTime(0, this.audioCtx.currentTime);

      this.trebleNode = this.audioCtx.createBiquadFilter();
      this.trebleNode.type = 'highshelf';
      this.trebleNode.frequency.setValueAtTime(5000, this.audioCtx.currentTime);
      this.trebleNode.gain.setValueAtTime(0, this.audioCtx.currentTime);

      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.setValueAtTime(-24, this.audioCtx.currentTime);
      this.compressorNode.knee.setValueAtTime(30, this.audioCtx.currentTime);
      this.compressorNode.ratio.setValueAtTime(12, this.audioCtx.currentTime);
      this.compressorNode.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.compressorNode.release.setValueAtTime(0.25, this.audioCtx.currentTime);

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      this.sourceNode.connect(this.bassNode);
      this.bassNode.connect(this.midNode);
      this.midNode.connect(this.trebleNode);
      this.trebleNode.connect(this.compressorNode);
      this.compressorNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.isAttached = true;
    } catch (_) {
      // Element may already be attached
    }
  }

  public applySettings(settings: AudioSettings) {
    this.lastSettings = settings;
    this.audioCtx?.resume().catch(() => {});

    const isStandard = settings.preset === 'standard' &&
      !settings.compressorEnabled &&
      !settings.dialogueBoost &&
      settings.bassGain === 0;

    if (!isStandard && this.audioCtx && this.audioCtx.state === 'running' && this.currentElement && !this.isAttached) {
      this.attachWebAudioGraph(this.currentElement);
    }

    const graphActive = Boolean(this.audioCtx && this.audioCtx.state === 'running' && this.isAttached);
    const level = settings.isMuted ? 0 : Math.min(1, Math.max(0, settings.volume / 100));

    // Una sola vía de volumen/mute:
    //  - Con grafo Web Audio: el elemento queda al 100% sin mute y el GainNode decide.
    //  - Sin grafo: el propio elemento HTML decide.
    if (this.currentElement) {
      if (graphActive) {
        this.currentElement.muted = false;
        this.currentElement.volume = 1;
      } else {
        this.currentElement.muted = settings.isMuted;
        this.currentElement.volume = level;
      }
    }

    if (!graphActive || !this.audioCtx) return;

    const now = this.audioCtx.currentTime;

    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(level, now, 0.05);
    }

    let bass = settings.bassGain;
    let mid = settings.midGain;
    let treble = settings.trebleGain;
    let compressionRatio = settings.compressorEnabled ? 12 : 1;

    switch (settings.preset) {
      case 'vocal_boost':
        bass = -2;
        mid = 7;
        treble = 3;
        compressionRatio = 4;
        break;
      case 'night_mode':
        bass = -4;
        mid = 5;
        treble = -1;
        compressionRatio = 16;
        break;
      case 'bass_boost':
        bass = 9;
        mid = 0;
        treble = 2;
        compressionRatio = 2;
        break;
      case 'cinematic_surround':
        bass = 6;
        mid = 2;
        treble = 5;
        compressionRatio = 3;
        break;
      case 'standard':
      default:
        break;
    }

    if (this.bassNode) {
      this.bassNode.gain.setTargetAtTime(bass, now, 0.05);
    }
    if (this.midNode) {
      this.midNode.gain.setTargetAtTime(mid, now, 0.05);
    }
    if (this.trebleNode) {
      this.trebleNode.gain.setTargetAtTime(treble, now, 0.05);
    }
    if (this.compressorNode) {
      this.compressorNode.ratio.setTargetAtTime(compressionRatio, now, 0.05);
    }
  }

  public getContextState(): string {
    return this.audioCtx?.state || 'uninitialized';
  }
}

export const globalAudioEngine = new AudioEngine();
