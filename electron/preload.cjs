const { contextBridge, ipcRenderer } = require('electron');

let lastRealMediaFetchAt = 0;
let lastRealMediaCached = null;
let realMediaInFlight = null;
let fastMediaPollFlag = false;
let resumeActiveFlag = false;

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  sendNativeKey: (keyCode) => ipcRenderer.invoke('send-native-key', keyCode),
  sendKeyToWebview: (payload) => ipcRenderer.invoke('send-key-to-webview', payload),
  sendNativeClick: (coords) => ipcRenderer.invoke('send-native-click', coords),
  simulatePlayClick: (coords) => ipcRenderer.invoke('simulate-play-click', coords),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  setStreamHeaders: (payload) => ipcRenderer.invoke('set-stream-headers', payload),
  setMasterVolume: (payload) => ipcRenderer.invoke('set-master-volume', payload),
  setFastMediaPoll: (val) => {
    fastMediaPollFlag = Boolean(val);
  },
  setResumeActive: (val) => {
    resumeActiveFlag = Boolean(val);
  },
  getRealMediaState: (opts) => {
    const force = Boolean(opts && opts.force);
    const fast = force || fastMediaPollFlag || resumeActiveFlag;
    const minInterval = force ? 0 : fast ? 900 : 4800;
    const now = Date.now();
    if (!force && now - lastRealMediaFetchAt < minInterval) {
      return Promise.resolve(lastRealMediaCached);
    }
    if (realMediaInFlight) {
      return realMediaInFlight;
    }
    lastRealMediaFetchAt = now;
    realMediaInFlight = ipcRenderer
      .invoke('get-real-media-state')
      .then((res) => {
        lastRealMediaCached = res;
        realMediaInFlight = null;
        return res;
      })
      .catch(() => {
        realMediaInFlight = null;
        return lastRealMediaCached;
      });
    return realMediaInFlight;
  },
  controlActiveMedia: (payload) => ipcRenderer.invoke('control-active-media', payload),
  probeStreams: (urls) => ipcRenderer.invoke('probe-streams', urls),
  checkEmbedProviders: () => ipcRenderer.invoke('check-embed-providers'),
  getEmbedStatus: () => ipcRenderer.invoke('get-embed-status'),
  toggleFullscreen: (force) => ipcRenderer.invoke('toggle-fullscreen', force),
  searchMediaTracks: (query) => ipcRenderer.invoke('search-media-tracks', query),
  getSavedAccounts: () => ipcRenderer.invoke('get-saved-accounts'),
  saveAccounts: (accounts) => ipcRenderer.invoke('save-accounts', accounts),
  getDetectedTracks: () => ipcRenderer.invoke('get-detected-tracks'),
  onTracksDetected: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('tracks-detected', listener);
    return () => ipcRenderer.removeListener('tracks-detected', listener);
  },
  onAuthUpdated: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('auth:updated', listener);
    return () => ipcRenderer.removeListener('auth:updated', listener);
  },
  onEmbedFailed: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('embed-failed', listener);
    return () => ipcRenderer.removeListener('embed-failed', listener);
  },
  sendNativeTrackpadEvent: (payload) => ipcRenderer.invoke('send-native-trackpad-event', payload),
  onVirtualCursorPosition: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('virtual-cursor-position', listener);
    return () => ipcRenderer.removeListener('virtual-cursor-position', listener);
  },
  clearPartitionSession: (partition) => ipcRenderer.invoke('clear-partition-session', partition),
  setDiagnosticMode: (enabled) => ipcRenderer.invoke('set-diagnostic-mode', enabled),
  getDiagnosticMode: () => ipcRenderer.invoke('get-diagnostic-mode'),
  onDiagnosticModeChanged: (cb) => {
    const listener = (_e, val) => cb(val);
    ipcRenderer.on('diagnostic-mode-changed', listener);
    return () => ipcRenderer.removeListener('diagnostic-mode-changed', listener);
  },
  setNoCorsFix: (enabled) => ipcRenderer.invoke('set-no-cors-fix', enabled),
  getNoCorsFix: () => ipcRenderer.invoke('get-no-cors-fix'),
  onNoCorsFixChanged: (cb) => {
    const listener = (_e, val) => cb(val);
    ipcRenderer.on('no-cors-fix-changed', listener);
    return () => ipcRenderer.removeListener('no-cors-fix-changed', listener);
  },
  getPerfSnapshot: () => ipcRenderer.invoke('get-perf-snapshot'),
  setPerfConfig: (cfg) => ipcRenderer.invoke('set-perf-config', cfg),
  recordEmbedAudioCall: () => ipcRenderer.invoke('record-embed-audio-call'),
  isDebugPerf: () => process.env.CINECAST_DEBUG_PERF === '1',
});
