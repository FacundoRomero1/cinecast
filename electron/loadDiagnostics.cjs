const dns = require('dns');
const netNode = require('net');
const tls = require('tls');

const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const FRAME_POLL_INTERVAL_MS = 250;
const FRAME_POLL_MAX_MS = 30000;

/**
 * Aggrega fallos de red o certificados en place por (host + code + count).
 */
function upsertGroupedNetworkFailure(list, host, code, extra = {}) {
  const h = String(host || 'unknown').toLowerCase();
  const c = String(code || 'ERR_UNKNOWN');
  const existing = list.find((item) => item && item.host === h && item.code === c);
  if (existing) {
    existing.count = (Number(existing.count) || 1) + 1;
    if (extra.status !== undefined) existing.status = extra.status;
    if (extra.error !== undefined) existing.error = extra.error;
  } else {
    list.push({ host: h, code: c, count: 1, ...extra });
  }
}

/**
 * Mide DNS, TCP connect, TLS y TTFB vía Electron net.request con timeout global estricto.
 */
function measureServerWithNetRequest(rawUrl, netModule, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      resolve({
        url: rawUrl,
        host: 'invalid',
        dnsMs: 0,
        connectMs: 0,
        tcpMs: 0,
        tlsMs: 0,
        ttfbMs: 0,
        totalMs: 0,
        statusCode: 0,
        ok: false,
        timedOut: false,
        error: err.message,
      });
      return;
    }

    const host = parsed.hostname;
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const isHttps = parsed.protocol === 'https:';
    let dnsMs = 0;
    let tcpMs = 0;
    let tlsMs = 0;
    let settled = false;
    let activeSock = null;
    let activeTlsSock = null;
    let activeReq = null;

    const cleanupSockets = () => {
      try { if (activeTlsSock) activeTlsSock.destroy(); } catch (_) {}
      try { if (activeSock) activeSock.destroy(); } catch (_) {}
      try { if (activeReq) activeReq.abort(); } catch (_) {}
      activeTlsSock = null;
      activeSock = null;
      activeReq = null;
    };

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      cleanupSockets();
      const totalMs = result.totalMs !== undefined ? result.totalMs : Math.max(0, Date.now() - startedAt);
      const connectVal = result.connectMs !== undefined ? result.connectMs : tcpMs;
      resolve({
        ...result,
        connectMs: connectVal,
        tcpMs: connectVal,
        totalMs,
        ok: result.ok !== undefined ? result.ok : (!result.error && result.statusCode > 0 && result.statusCode < 400),
      });
    };

    const deadlineTimer = setTimeout(() => {
      done({
        url: rawUrl,
        host,
        dnsMs,
        connectMs: tcpMs,
        tlsMs,
        ttfbMs: Math.max(0, Date.now() - startedAt),
        totalMs: Date.now() - startedAt,
        statusCode: 0,
        ok: false,
        timedOut: true,
        error: `timeout_${timeoutMs}ms`,
      });
    }, timeoutMs);

    const finishWithNetRequest = () => {
      if (settled) return;
      const reqStart = Date.now();
      if (reqStart >= deadline) {
        done({
          url: rawUrl,
          host,
          dnsMs,
          connectMs: tcpMs,
          tlsMs,
          ttfbMs: reqStart - startedAt,
          statusCode: 0,
          ok: false,
          timedOut: true,
          error: `timeout_${timeoutMs}ms`,
        });
        return;
      }

      try {
        const req = netModule.request({ method: 'GET', url: rawUrl, redirect: 'manual' });
        activeReq = req;
        req.on('response', (res) => {
          const ttfbMs = Date.now() - reqStart;
          const statusCode = res.statusCode || 0;
          res.once('data', () => {});
          try { req.abort(); } catch (_) {}
          done({
            url: rawUrl,
            host,
            dnsMs,
            connectMs: tcpMs,
            tlsMs,
            ttfbMs,
            statusCode,
            ok: statusCode > 0 && statusCode < 400,
            timedOut: false,
            error: statusCode >= 400 ? `HTTP_${statusCode}` : null,
          });
        });
        req.on('error', (err) => {
          done({
            url: rawUrl,
            host,
            dnsMs,
            connectMs: tcpMs,
            tlsMs,
            ttfbMs: Date.now() - reqStart,
            statusCode: 0,
            ok: false,
            timedOut: false,
            error: err?.message || String(err),
          });
        });
        req.end();
      } catch (err) {
        done({
          url: rawUrl,
          host,
          dnsMs,
          connectMs: tcpMs,
          tlsMs,
          ttfbMs: Date.now() - startedAt,
          statusCode: 0,
          ok: false,
          timedOut: false,
          error: err?.message || String(err),
        });
      }
    };

    const tDns0 = Date.now();
    dns.lookup(host, (dnsErr, address) => {
      if (settled) return;
      dnsMs = Date.now() - tDns0;
      if (dnsErr || !address) {
        finishWithNetRequest();
        return;
      }
      const remainingSock = Math.max(200, Math.min(2500, deadline - Date.now()));
      const tTcp0 = Date.now();
      const sock = netNode.connect({ host: address, port, timeout: remainingSock }, () => {
        if (settled) return;
        tcpMs = Date.now() - tTcp0;
        if (!isHttps) {
          try { sock.destroy(); } catch (_) {}
          activeSock = null;
          finishWithNetRequest();
          return;
        }
        const tTls0 = Date.now();
        const remainingTls = Math.max(200, Math.min(2500, deadline - Date.now()));
        const tlsSock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false, timeout: remainingTls }, () => {
          if (settled) return;
          tlsMs = Date.now() - tTls0;
          try { tlsSock.destroy(); } catch (_) {}
          activeTlsSock = null;
          activeSock = null;
          finishWithNetRequest();
        });
        activeTlsSock = tlsSock;
        const onTlsEnd = () => {
          tlsMs = Date.now() - tTls0;
          try { tlsSock.destroy(); } catch (_) {}
          activeTlsSock = null;
          activeSock = null;
          finishWithNetRequest();
        };
        tlsSock.on('error', onTlsEnd);
        tlsSock.on('timeout', onTlsEnd);
      });
      activeSock = sock;
      const onSockEnd = () => {
        tcpMs = Date.now() - tTcp0;
        try { sock.destroy(); } catch (_) {}
        activeSock = null;
        finishWithNetRequest();
      };
      sock.on('error', onSockEnd);
      sock.on('timeout', onSockEnd);
    });
  });
}

/**
 * Controlador unificado para "Grabar carga" y "Medir servidores".
 */
function createLoadDiagnosticsManager({ app, session, webContents, net, getMainWindow, traceMaxMs = FRAME_POLL_MAX_MS }) {
  let isLoadRecordingEnabled = false;
  const loadTraces = [];
  let currentLoadTrace = null;
  let currentLoadTraceMeta = null;
  let loadTracePollTimer = null;
  let loadTracePollBusy = false;
  let currentPlayerServers = [];
  let lastGuestWebview = null;
  const hookedSessions = new WeakSet();

  const stopFramePoller = () => {
    if (loadTracePollTimer) {
      clearInterval(loadTracePollTimer);
      loadTracePollTimer = null;
    }
    loadTracePollBusy = false;
  };

  const anchorTraceToWebview = (trace, meta, wcId, createdAt) => {
    if (!trace || !meta) return;
    const noLoadYet =
      trace.timestamps.didStartLoadingMs === null &&
      trace.timestamps.domReadyMs === null &&
      trace.timestamps.firstVideoMs === null;
    if (meta.webviewAnchored && !noLoadYet) return;
    const anchorMs = typeof createdAt === 'number' && createdAt > 0 ? createdAt : Date.now();
    trace.t0 = anchorMs;
    meta.webviewAnchored = true;
    if (wcId) meta.targetWebContentsIds.add(wcId);
    trace.timestamps.webviewCreatedMs = 0;
    trace.timestamps.didStartLoadingMs = null;
    trace.timestamps.domReadyMs = null;
    trace.timestamps.didFinishLoadMs = null;
    trace.timestamps.firstVideoMs = null;
    trace.timestamps.readyState3Ms = null;
    trace.timestamps.firstFrameMs = null;
    trace.videoStatus = 'sondeando';
    meta.pollDeadlineMs = anchorMs + traceMaxMs;
  };

  const collectCandidateFrames = (meta) => {
    const videoSes = session.fromPartition('persist:videosession', { cache: true });
    const frames = [];
    const seen = new Set();
    const mainWin = typeof getMainWindow === 'function' ? getMainWindow() : null;
    const mainFrame = mainWin && !mainWin.isDestroyed() ? mainWin.webContents.mainFrame : null;

    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      const isTarget =
        (meta && meta.targetWebContentsIds.has(wc.id)) ||
        wc.getType() === 'webview' ||
        wc.session === videoSes;
      if (!isTarget) continue;
      try {
        if (wc.mainFrame && Array.isArray(wc.mainFrame.framesInSubtree)) {
          for (const f of wc.mainFrame.framesInSubtree) {
            if (f === mainFrame || seen.has(f)) continue;
            seen.add(f);
            frames.push(f);
          }
        }
      } catch (_) {}
    }

    if (frames.length === 0 && mainFrame && Array.isArray(mainFrame.framesInSubtree)) {
      for (const f of mainFrame.framesInSubtree) {
        if (f !== mainFrame && !seen.has(f)) {
          seen.add(f);
          frames.push(f);
        }
      }
    }
    return frames;
  };

  const probeFramesOnce = async (trace, meta) => {
    if (!trace || currentLoadTrace !== trace || loadTracePollBusy) return;
    loadTracePollBusy = true;
    try {
      const frames = collectCandidateFrames(meta);
      const probeScript = `(() => {
        const tid = ${JSON.stringify(trace.id)};
        const v = document.querySelector('video');
        if (!v) return { access: true, hasVideo: false };
        if (!window.__cineRvfcMap) window.__cineRvfcMap = {};
        if (!window.__cineRvfcMap[tid] && typeof v.requestVideoFrameCallback === 'function') {
          const entry = { frameAt: null };
          window.__cineRvfcMap[tid] = entry;
          try {
            v.requestVideoFrameCallback(() => {
              entry.frameAt = Date.now();
            });
          } catch (_) {}
        }
        const entry = window.__cineRvfcMap[tid];
        const decoded = typeof v.webkitDecodedFrameCount === 'number' ? v.webkitDecodedFrameCount : 0;
        const firstFrameRendered = Boolean(
          (entry && entry.frameAt) ||
          (typeof window.__firstFrameMs === 'number' && window.__firstFrameMs > 0) ||
          decoded > 0 ||
          (!v.paused && v.readyState >= 3 && v.currentTime > 0)
        );
        return {
          access: true,
          hasVideo: true,
          readyState: Number(v.readyState || 0),
          firstFrameRendered,
          frameAt: entry && entry.frameAt ? entry.frameAt : null,
        };
      })()`;

      let anyInaccessible = false;
      for (const frame of frames) {
        if (currentLoadTrace !== trace) break;
        try {
          const probe = await Promise.race([
            frame.executeJavaScript(probeScript, false),
            new Promise((_, rej) => setTimeout(() => rej(new Error('frame-eval-timeout')), 350)),
          ]);
          if (probe && probe.hasVideo) {
            const nowMs = Date.now();
            if (trace.timestamps.firstVideoMs === null) {
              trace.timestamps.firstVideoMs = Math.max(0, nowMs - trace.t0);
            }
            if (probe.readyState >= 3 && trace.timestamps.readyState3Ms === null) {
              trace.timestamps.readyState3Ms = Math.max(0, nowMs - trace.t0);
            }
            if (probe.firstFrameRendered && trace.timestamps.firstFrameMs === null) {
              const frameTs = typeof probe.frameAt === 'number' && probe.frameAt >= trace.t0 ? probe.frameAt : nowMs;
              trace.timestamps.firstFrameMs = Math.max(0, frameTs - trace.t0);
            }
            trace.videoStatus = 'accesible';
          }
        } catch (_) {
          anyInaccessible = true;
        }
      }
      if (anyInaccessible && meta) meta.hadInaccessibleFrames = true;

      const allCaptured =
        trace.timestamps.firstVideoMs !== null &&
        trace.timestamps.readyState3Ms !== null &&
        trace.timestamps.firstFrameMs !== null;
      if (allCaptured) {
        trace.videoStatus = 'accesible';
        stopFramePoller();
        return;
      }

      const deadline = meta?.pollDeadlineMs || (trace.t0 + traceMaxMs);
      if (Date.now() >= deadline) {
        if (trace.timestamps.firstVideoMs === null || trace.timestamps.firstFrameMs === null) {
          trace.videoStatus = 'no accesible';
        }
        stopFramePoller();
      }
    } finally {
      loadTracePollBusy = false;
    }
  };

  const startFramePoller = (trace, meta) => {
    stopFramePoller();
    if (!trace || !meta) return;
    meta.pollDeadlineMs = trace.t0 + traceMaxMs;
    probeFramesOnce(trace, meta).catch(() => {});
    loadTracePollTimer = setInterval(() => {
      if (currentLoadTrace !== trace) {
        stopFramePoller();
        return;
      }
      probeFramesOnce(trace, meta).catch(() => {});
    }, FRAME_POLL_INTERVAL_MS);
  };

  const hookVideoSessionNetwork = (videoSes) => {
    if (!videoSes || hookedSessions.has(videoSes)) return;
    hookedSessions.add(videoSes);

    videoSes.webRequest.onCompleted((details) => {
      if (!currentLoadTrace) return;
      const u = details.url || '';
      if (u.startsWith('cine://')) return;
      currentLoadTrace.network.totalRequests++;
      if (details.statusCode >= 400) {
        let host = 'unknown';
        try { host = new URL(u).hostname; } catch (_) {}
        upsertGroupedNetworkFailure(
          currentLoadTrace.network.failedRequests,
          host,
          `HTTP_${details.statusCode}`,
          { status: details.statusCode }
        );
      }
    });

    videoSes.webRequest.onErrorOccurred((details) => {
      if (!currentLoadTrace) return;
      const u = details.url || '';
      if (u.startsWith('cine://') || details.error === 'net::ERR_ABORTED') return;
      currentLoadTrace.network.totalRequests++;
      let host = 'unknown';
      try { host = new URL(u).hostname; } catch (_) {}
      upsertGroupedNetworkFailure(
        currentLoadTrace.network.failedRequests,
        host,
        details.error || 'ERR_UNKNOWN',
        { status: 0 }
      );
    });
  };

  const hookGuestWebContents = (contents) => {
    if (!contents || contents.isDestroyed()) return false;
    const videoSes = session.fromPartition('persist:videosession', { cache: true });
    const isVideoSession = contents.session === videoSes;
    const isGuestWebview = isVideoSession || contents.getType() === 'webview';
    if (!isGuestWebview) return false;

    if (!contents.__loadTraceHooked) {
      contents.__loadTraceHooked = true;
      const createdAt = contents.__cineCreatedAt || Date.now();
      contents.__cineCreatedAt = createdAt;
      lastGuestWebview = {
        id: contents.id,
        createdAt,
        didStartLoadingAt: null,
        domReadyAt: null,
        didFinishLoadAt: null,
        claimedByTraceId: null,
      };
      if (currentLoadTrace && currentLoadTraceMeta) {
        const noLoadYet =
          currentLoadTrace.timestamps.didStartLoadingMs === null &&
          currentLoadTrace.timestamps.domReadyMs === null &&
          currentLoadTrace.timestamps.firstVideoMs === null;
        if (!currentLoadTraceMeta.webviewAnchored || noLoadYet) {
          anchorTraceToWebview(currentLoadTrace, currentLoadTraceMeta, contents.id, createdAt);
          lastGuestWebview.claimedByTraceId = currentLoadTrace.id;
        } else {
          currentLoadTraceMeta.targetWebContentsIds.add(contents.id);
        }
      }

      contents.on('did-start-loading', () => {
        const now = Date.now();
        if (lastGuestWebview && lastGuestWebview.id === contents.id && !lastGuestWebview.didStartLoadingAt) {
          lastGuestWebview.didStartLoadingAt = now;
        }
        if (
          currentLoadTrace &&
          currentLoadTrace.timestamps.didStartLoadingMs === null &&
          (!currentLoadTraceMeta?.targetWebContentsIds.size || currentLoadTraceMeta.targetWebContentsIds.has(contents.id))
        ) {
          currentLoadTrace.timestamps.didStartLoadingMs = Math.max(0, now - currentLoadTrace.t0);
        }
      });
      contents.on('dom-ready', () => {
        const now = Date.now();
        if (lastGuestWebview && lastGuestWebview.id === contents.id && !lastGuestWebview.domReadyAt) {
          lastGuestWebview.domReadyAt = now;
        }
        if (
          currentLoadTrace &&
          currentLoadTrace.timestamps.domReadyMs === null &&
          (!currentLoadTraceMeta?.targetWebContentsIds.size || currentLoadTraceMeta.targetWebContentsIds.has(contents.id))
        ) {
          currentLoadTrace.timestamps.domReadyMs = Math.max(0, now - currentLoadTrace.t0);
        }
        if (currentLoadTrace && currentLoadTraceMeta) {
          probeFramesOnce(currentLoadTrace, currentLoadTraceMeta).catch(() => {});
        }
      });
      contents.on('did-finish-load', () => {
        const now = Date.now();
        if (lastGuestWebview && lastGuestWebview.id === contents.id && !lastGuestWebview.didFinishLoadAt) {
          lastGuestWebview.didFinishLoadAt = now;
        }
        if (
          currentLoadTrace &&
          currentLoadTrace.timestamps.didFinishLoadMs === null &&
          (!currentLoadTraceMeta?.targetWebContentsIds.size || currentLoadTraceMeta.targetWebContentsIds.has(contents.id))
        ) {
          currentLoadTrace.timestamps.didFinishLoadMs = Math.max(0, now - currentLoadTrace.t0);
        }
        if (currentLoadTrace && currentLoadTraceMeta) {
          probeFramesOnce(currentLoadTrace, currentLoadTraceMeta).catch(() => {});
        }
      });
    }
    return isVideoSession;
  };

  const recordAdBlockedRequest = () => {
    if (currentLoadTrace) currentLoadTrace.network.adBlockedRequests++;
  };

  const recordCertError = (host, error) => {
    if (!currentLoadTrace) return;
    upsertGroupedNetworkFailure(
      currentLoadTrace.network.certErrors,
      host,
      String(error || 'ERR_CERT'),
      { error: String(error || 'ERR_CERT') }
    );
  };

  const startLoadTrace = async (payload = {}) => {
    stopFramePoller();
    const t0 = Date.now();
    const firstUrl = payload.firstServerUrl || '';
    let firstHost = '';
    try {
      if (firstUrl) firstHost = new URL(firstUrl).hostname;
    } catch (_) {}

    const trace = {
      id: 'load_' + t0 + '_' + Math.random().toString(36).slice(2, 6),
      title: payload.title || 'Reproducción',
      startedAtIso: new Date(t0).toISOString(),
      t0,
      videoStatus: 'sondeando',
      serversTried: firstUrl
        ? [{ name: payload.firstServerName || 'Servidor 1', host: firstHost || firstUrl, url: firstUrl, elapsedSec: 0 }]
        : [],
      timestamps: {
        webviewCreatedMs: 0,
        didStartLoadingMs: null,
        domReadyMs: null,
        didFinishLoadMs: null,
        firstVideoMs: null,
        readyState3Ms: null,
        firstFrameMs: null,
      },
      network: {
        totalRequests: 0,
        failedRequests: [],
        adBlockedRequests: 0,
        certErrors: [],
      },
      rotations: [],
      cpuAt5s: null,
      firstServerNetProbe: null,
    };

    const meta = {
      webviewAnchored: false,
      targetWebContentsIds: new Set(),
      hadInaccessibleFrames: false,
      pollDeadlineMs: t0 + traceMaxMs,
    };

    if (
      lastGuestWebview &&
      !lastGuestWebview.claimedByTraceId &&
      t0 - lastGuestWebview.createdAt >= 0 &&
      t0 - lastGuestWebview.createdAt <= 1200
    ) {
      anchorTraceToWebview(trace, meta, lastGuestWebview.id, lastGuestWebview.createdAt);
      lastGuestWebview.claimedByTraceId = trace.id;
      if (lastGuestWebview.didStartLoadingAt) {
        trace.timestamps.didStartLoadingMs = Math.max(0, lastGuestWebview.didStartLoadingAt - trace.t0);
      }
      if (lastGuestWebview.domReadyAt) {
        trace.timestamps.domReadyMs = Math.max(0, lastGuestWebview.domReadyAt - trace.t0);
      }
      if (lastGuestWebview.didFinishLoadAt) {
        trace.timestamps.didFinishLoadMs = Math.max(0, lastGuestWebview.didFinishLoadAt - trace.t0);
      }
    }

    currentLoadTrace = trace;
    currentLoadTraceMeta = meta;
    loadTraces.unshift(trace);
    if (loadTraces.length > 20) loadTraces.length = 20;

    startFramePoller(trace, meta);

    if (firstUrl && (firstUrl.startsWith('http://') || firstUrl.startsWith('https://'))) {
      measureServerWithNetRequest(firstUrl, net, DEFAULT_PROBE_TIMEOUT_MS)
        .then((res) => { trace.firstServerNetProbe = res; })
        .catch(() => {});
    }

    setTimeout(() => {
      try {
        const metrics = app.getAppMetrics();
        const cpu = { Browser: 0, Tab: 0, GPU: 0 };
        for (const m of metrics) {
          if (m.type === 'Browser' || m.type === 'Tab' || m.type === 'GPU') {
            cpu[m.type] = Number((cpu[m.type] + (m.cpu?.percentCPUUsage || 0)).toFixed(2));
          }
        }
        trace.cpuAt5s = cpu;
      } catch (_) {}
    }, 5000);

    return { ok: true, id: trace.id };
  };

  const recordLoadTraceEvent = (payload = {}) => {
    if (!currentLoadTrace) return { ok: false };
    const elapsedMs = Math.max(0, Date.now() - currentLoadTrace.t0);
    const elapsedSec = Number((elapsedMs / 1000).toFixed(2));

    if (payload.kind === 'server_tried') {
      let host = payload.host || '';
      if (!host && payload.url) {
        try { host = new URL(payload.url).hostname; } catch (_) { host = payload.url; }
      }
      currentLoadTrace.serversTried.push({
        name: payload.name || '',
        host,
        url: payload.url || '',
        elapsedSec,
      });
    } else if (payload.kind === 'rotation') {
      currentLoadTrace.rotations.push({
        method: payload.method || 'rotateToNextServer',
        reason: payload.reason || '',
        elapsedSec: typeof payload.elapsedSec === 'number' ? payload.elapsedSec : elapsedSec,
      });
    } else if (payload.kind === 'timestamp' && payload.field) {
      if (currentLoadTrace.timestamps[payload.field] === null || currentLoadTrace.timestamps[payload.field] === undefined) {
        const safeMs =
          typeof payload.ms === 'number' && payload.ms >= 0 && payload.ms < 120000 && payload.base === 'webview'
            ? payload.ms
            : elapsedMs;
        currentLoadTrace.timestamps[payload.field] = safeMs;
      }
    }
    return { ok: true };
  };

  const endLoadTrace = () => {
    if (currentLoadTrace && currentLoadTraceMeta?.hadInaccessibleFrames && currentLoadTrace.timestamps.firstVideoMs === null) {
      currentLoadTrace.videoStatus = 'no accesible';
    }
    stopFramePoller();
    currentLoadTrace = null;
    currentLoadTraceMeta = null;
    return { ok: true };
  };

  const getLoadTraces = async () => {
    if (currentLoadTrace && currentLoadTraceMeta) {
      await probeFramesOnce(currentLoadTrace, currentLoadTraceMeta).catch(() => {});
    }
    return {
      ok: true,
      recording: isLoadRecordingEnabled,
      traces: loadTraces,
    };
  };

  const clearLoadTraces = () => {
    stopFramePoller();
    loadTraces.length = 0;
    currentLoadTrace = null;
    currentLoadTraceMeta = null;
    return { ok: true };
  };

  const setPlayerServers = (servers) => {
    if (!Array.isArray(servers)) return { ok: false, count: currentPlayerServers.length };
    currentPlayerServers = servers
      .filter((s) => s && typeof s.url === 'string' && s.url.length > 0)
      .map((s) => ({
        name: String(s.name || ''),
        url: String(s.url),
        type: s.type ? String(s.type) : 'iframe',
        language: s.language ? String(s.language) : '',
      }));
    return { ok: true, count: currentPlayerServers.length };
  };

  const getPlayerServers = () => ({ ok: true, servers: currentPlayerServers });

  const measureServers = async (payload = {}) => {
    const sourceList =
      Array.isArray(payload?.servers) && payload.servers.length > 0
        ? payload.servers
        : currentPlayerServers;
    if (!Array.isArray(sourceList) || sourceList.length === 0) {
      return {
        ok: false,
        error: 'No hay servidores cargados en el reproductor actual. Abrí un título primero.',
        serialized: true,
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
        results: [],
      };
    }
    const results = [];
    for (let i = 0; i < sourceList.length; i++) {
      const srv = sourceList[i];
      const metric = await measureServerWithNetRequest(srv.url, net, DEFAULT_PROBE_TIMEOUT_MS);
      results.push({
        index: i,
        name: String(srv.name || `Servidor ${i + 1}`),
        language: String(srv.language || ''),
        ...metric,
      });
    }
    return {
      ok: true,
      serialized: true,
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      results,
    };
  };

  const registerIpcHandlers = (ipcMain) => {
    const handlers = {
      'get-load-recording': () => ({ ok: true, enabled: isLoadRecordingEnabled }),
      'set-load-recording': (_e, enabled) => {
        isLoadRecordingEnabled = Boolean(enabled);
        return { ok: true, enabled: isLoadRecordingEnabled };
      },
      'start-load-trace': (_e, payload) => startLoadTrace(payload),
      'record-load-trace-event': (_e, payload) => recordLoadTraceEvent(payload),
      'end-load-trace': () => endLoadTrace(),
      'get-load-traces': () => getLoadTraces(),
      'clear-load-traces': () => clearLoadTraces(),
      'set-player-servers': (_e, servers) => setPlayerServers(servers),
      'get-player-servers': () => getPlayerServers(),
      'measure-servers': (_e, payload) => measureServers(payload),
    };
    for (const [channel, fn] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, fn);
    }
  };

  return {
    getCurrentLoadTrace: () => currentLoadTrace,
    hookVideoSessionNetwork,
    hookGuestWebContents,
    recordAdBlockedRequest,
    recordCertError,
    startLoadTrace,
    recordLoadTraceEvent,
    endLoadTrace,
    getLoadTraces,
    clearLoadTraces,
    setPlayerServers,
    getPlayerServers,
    measureServers,
    registerIpcHandlers,
    stopFramePoller,
  };
}

module.exports = {
  upsertGroupedNetworkFailure,
  measureServerWithNetRequest,
  createLoadDiagnosticsManager,
};
