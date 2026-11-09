class DiagnosticService {
  private isDiagnosticMode: boolean = false;
  private isNoCorsFix: boolean = false;
  private listeners: Set<(enabled: boolean) => void> = new Set();
  private noCorsListeners: Set<(enabled: boolean) => void> = new Set();

  constructor() {
    this.init();
  }

  private async init() {
    if (typeof window === 'undefined') return;

    // 1. Consultar Electron IPC si existe
    if (window.electronAPI?.getDiagnosticMode) {
      try {
        this.isDiagnosticMode = await window.electronAPI.getDiagnosticMode();
        this.notify();
      } catch (_) {}

      try {
        if (window.electronAPI.getNoCorsFix) {
          this.isNoCorsFix = await window.electronAPI.getNoCorsFix();
          this.notifyNoCors();
        }
      } catch (_) {}

      window.electronAPI.onDiagnosticModeChanged?.((enabled) => {
        this.isDiagnosticMode = enabled;
        this.notify();
      });

      window.electronAPI.onNoCorsFixChanged?.((enabled) => {
        this.isNoCorsFix = enabled;
        this.notifyNoCors();
      });
      return;
    }

    // 2. Fallback a REST API / localStorage
    try {
      const saved = localStorage.getItem('cinecast_diagnostic_mode');
      if (saved !== null) {
        this.isDiagnosticMode = saved === 'true';
      }
      const savedCors = localStorage.getItem('cinecast_no_cors_fix');
      if (savedCors !== null) {
        this.isNoCorsFix = savedCors === 'true';
      }
      const res = await fetch('/api/diagnostic-mode');
      if (res.ok) {
        const data = await res.json();
        if (typeof data.diagnosticMode === 'boolean') {
          this.isDiagnosticMode = data.diagnosticMode;
          this.notify();
        }
        if (typeof data.noCorsFix === 'boolean') {
          this.isNoCorsFix = data.noCorsFix;
          this.notifyNoCors();
        }
      }
    } catch (_) {}
  }

  public isEnabled(): boolean {
    return this.isDiagnosticMode;
  }

  public isNoCorsFixEnabled(): boolean {
    return this.isNoCorsFix;
  }

  public async setEnabled(enabled: boolean): Promise<boolean> {
    this.isDiagnosticMode = enabled;
    try {
      localStorage.setItem('cinecast_diagnostic_mode', String(enabled));
    } catch (_) {}

    // 1. Electron IPC
    if (window.electronAPI?.setDiagnosticMode) {
      try {
        this.isDiagnosticMode = await window.electronAPI.setDiagnosticMode(enabled);
      } catch (_) {}
    } else {
      // 2. Fetch API
      try {
        await fetch('/api/diagnostic-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, noCorsFix: this.isNoCorsFix }),
        });
      } catch (_) {}
    }

    this.notify();
    return this.isDiagnosticMode;
  }

  public async setNoCorsFix(enabled: boolean): Promise<boolean> {
    this.isNoCorsFix = enabled;
    try {
      localStorage.setItem('cinecast_no_cors_fix', String(enabled));
    } catch (_) {}

    if (window.electronAPI?.setNoCorsFix) {
      try {
        this.isNoCorsFix = await window.electronAPI.setNoCorsFix(enabled);
      } catch (_) {}
    } else {
      try {
        await fetch('/api/diagnostic-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: this.isDiagnosticMode, noCorsFix: enabled }),
        });
      } catch (_) {}
    }

    this.notifyNoCors();
    return this.isNoCorsFix;
  }

  public async toggle(): Promise<boolean> {
    return this.setEnabled(!this.isDiagnosticMode);
  }

  public async toggleNoCorsFix(): Promise<boolean> {
    return this.setNoCorsFix(!this.isNoCorsFix);
  }

  public onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isDiagnosticMode);
    return () => this.listeners.delete(listener);
  }

  public onNoCorsChange(listener: (enabled: boolean) => void): () => void {
    this.noCorsListeners.add(listener);
    listener(this.isNoCorsFix);
    return () => this.noCorsListeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try { fn(this.isDiagnosticMode); } catch (_) {}
    });
  }

  private notifyNoCors() {
    this.noCorsListeners.forEach((fn) => {
      try { fn(this.isNoCorsFix); } catch (_) {}
    });
  }
}

export const diagnosticService = new DiagnosticService();

