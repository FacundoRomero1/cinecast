const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const os = require('os');
const { spawn, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH_DIR = path.join(ROOT, 'scratch');
const PIDS_FILE = path.join(SCRATCH_DIR, '.pids.json');
const TEST_DATA_ROOT = path.join(SCRATCH_DIR, 'test-data');

function ensureScratchDir() {
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }
}

function readPidsMap() {
  ensureScratchDir();
  if (!fs.existsSync(PIDS_FILE)) return {};
  try {
    const raw = fs.readFileSync(PIDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      const map = {};
      for (const item of parsed) {
        if (typeof item === 'number') map[String(item)] = { pid: item, ts: Date.now() };
        else if (item && item.pid) map[String(item.pid)] = item;
      }
      return map;
    }
  } catch (_) { }
  return {};
}

function writePidsMap(map) {
  ensureScratchDir();
  try {
    fs.writeFileSync(PIDS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (_) { }
}

function registerPid(pid, meta = {}) {
  const num = Number(pid);
  if (!num || Number.isNaN(num)) return;
  const map = readPidsMap();
  map[String(num)] = {
    pid: num,
    ts: Date.now(),
    ...meta,
  };
  writePidsMap(map);
}

function unregisterPid(pid) {
  const num = Number(pid);
  if (!num || Number.isNaN(num)) return;
  const map = readPidsMap();
  if (map[String(num)]) {
    delete map[String(num)];
    writePidsMap(map);
  }
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!num || Number.isNaN(num)) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function killPidTree(pid) {
  const num = Number(pid);
  if (!num || Number.isNaN(num)) return false;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${num} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(num, 'SIGKILL');
    }
    return true;
  } catch (_) {
    return false;
  } finally {
    unregisterPid(num);
  }
}

function getProcessParentMapWin32() {
  const parentMap = new Map();
  if (process.platform !== 'win32') return parentMap;
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }
    );
    const list = JSON.parse(out || '[]');
    const items = Array.isArray(list) ? list : [list];
    for (const it of items) {
      if (it && it.ProcessId) {
        parentMap.set(Number(it.ProcessId), {
          pid: Number(it.ProcessId),
          ppid: Number(it.ParentProcessId || 0),
          name: String(it.Name || ''),
          exe: String(it.ExecutablePath || ''),
        });
      }
    }
  } catch (_) { }
  return parentMap;
}

function isRegisteredOrDescendant(pid, registeredSet, parentMap) {
  let cur = Number(pid);
  const visited = new Set();
  while (cur && !visited.has(cur)) {
    if (registeredSet.has(cur) || cur === process.pid || cur === process.ppid) {
      return true;
    }
    visited.add(cur);
    const info = parentMap.get(cur);
    if (!info || !info.ppid || info.ppid === cur) break;
    cur = info.ppid;
  }
  return false;
}

function checkUserAppConflict() {
  const map = readPidsMap();
  const registeredSet = new Set(Object.keys(map).map((k) => Number(k)));
  const parentMap = getProcessParentMapWin32();

  // 1. Check port 3000 via netstat
  try {
    const netOut = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = netOut.split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes('LISTENING')) continue;
      if (!/:3000\s+/.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (pid > 0 && !isRegisteredOrDescendant(pid, registeredSet, parentMap)) {
        return {
          conflict: true,
          reason: `Proceso externo en puerto 3000 (PID ${pid}) no registrado en scratch/.pids.json`,
          pid,
        };
      }
    }
  } catch (_) { }

  // 2. Check electron.exe from project via tasklist / CIM
  try {
    const taskOut = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = taskOut.split(/\r?\n/);
    for (const line of lines) {
      if (!line.toLowerCase().includes('electron.exe')) continue;
      const cols = line.split('","').map((s) => s.replace(/^"|"$/g, ''));
      const pid = Number(cols[1]);
      if (!pid || Number.isNaN(pid)) continue;
      const procInfo = parentMap.get(pid);
      if (procInfo && procInfo.exe) {
        const normExe = procInfo.exe.toLowerCase();
        const normRoot = ROOT.toLowerCase();
        if (!normExe.startsWith(normRoot)) continue;
      }
      if (!isRegisteredOrDescendant(pid, registeredSet, parentMap)) {
        return {
          conflict: true,
          reason: `electron.exe del proyecto en ejecución (PID ${pid}) no registrado en scratch/.pids.json`,
          pid,
        };
      }
    }
  } catch (_) { }

  return { conflict: false };
}

function assertNoUserAppRunning() {
  const status = checkUserAppConflict();
  if (status.conflict) {
    console.error(`[REGLA-AISLAMIENTO] app del usuario en uso: ${status.reason}`);
    process.exit(90);
  }
}

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '0.0.0.0');
  });
}

async function pickFreePort(min = 39000, max = 39999) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const candidate = min + Math.floor(Math.random() * (max - min + 1));
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  for (let port = min; port <= max; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No hay puertos libres entre ${min} y ${max}`);
}

function waitHealth(port, timeoutMs = 25000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error(`/api/health devolvió ${res.statusCode}`));
        } else {
          setTimeout(check, 200);
        }
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout esperando /api/health en puerto ${port}`));
        } else {
          setTimeout(check, 200);
        }
      });
      req.setTimeout(1500, () => req.destroy());
    };
    check();
  });
}

function rewriteTestUrl(rawUrl, port, room, lanIp) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const isLocalHost =
      u.hostname === '127.0.0.1' ||
      u.hostname === 'localhost' ||
      (lanIp && u.hostname === lanIp);
    if (!isLocalHost) return rawUrl;
    if (!u.port || u.port === '3000') {
      u.port = String(port);
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const curRoom = u.searchParams.get('room');
      if (!curRoom || curRoom === 'cine-home-1') {
        u.searchParams.set('room', room);
      }
    }
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

function setupElectronHooks({ port, room, lanIp }) {
  if (!process.versions || !process.versions.electron) return;
  try {
    const electron = require('electron');
    if (electron.ipcMain) {
      try {
        electron.ipcMain.removeHandler('get-local-ip');
      } catch (_) { }
      electron.ipcMain.handle('get-local-ip', () => ({ ip: lanIp, port }));
    }
    if (electron.BrowserWindow && !electron.BrowserWindow.prototype.__testenvPatched) {
      const origLoadURL = electron.BrowserWindow.prototype.loadURL;
      electron.BrowserWindow.prototype.loadURL = function patchedLoadURL(url, opts) {
        const rewritten = rewriteTestUrl(url, port, room, lanIp);
        return origLoadURL.call(this, rewritten, opts);
      };
      electron.BrowserWindow.prototype.__testenvPatched = true;
    }
  } catch (_) { }
}

async function startTestEnv(options = {}) {
  if (!options.skipUserAppCheck && process.env.CINECAST_SKIP_USER_CHECK !== '1') {
    assertNoUserAppRunning();
  }

  registerPid(process.pid, {
    role: options.name || path.basename(process.argv[1] || 'test-process'),
    type: process.versions && process.versions.electron ? 'electron' : 'node-runner',
  });

  const id =
    options.id ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const port = options.port || (await pickFreePort(39000, 39999));
  const room = options.room || `test-${id}`;
  const dataDir = options.dataDir
    ? path.resolve(options.dataDir)
    : path.join(TEST_DATA_ROOT, id);

  fs.mkdirSync(dataDir, { recursive: true });

  // Seed initial watch_history.json explicitly or copy if present so tests never touch public/data/watch_history.json
  const dstHistory = path.join(dataDir, 'watch_history.json');
  if (Array.isArray(options.initialWatchHistory)) {
    fs.writeFileSync(dstHistory, JSON.stringify(options.initialWatchHistory, null, 2), 'utf8');
  } else if (options.seedHistory !== false) {
    const srcHistory = path.join(ROOT, 'public', 'data', 'watch_history.json');
    if (fs.existsSync(srcHistory) && !fs.existsSync(dstHistory)) {
      try {
        fs.copyFileSync(srcHistory, dstHistory);
      } catch (_) { }
    }
  }

  // Seed catalog.sqlite copy if present so SQLite WAL/SHM stay in dataDir
  const srcDb = path.join(ROOT, 'data', 'catalog.sqlite');
  const dstDb = path.join(dataDir, 'catalog.sqlite');
  if (fs.existsSync(srcDb) && !fs.existsSync(dstDb)) {
    try {
      fs.copyFileSync(srcDb, dstDb);
    } catch (_) { }
  }

  // Seed cinecast-config.json (TMDB key) and read-only cache copy into dataDir
  if (options.seedConfig !== false) {
    const srcConfig = path.join(ROOT, '.cinecast-data', 'cinecast-config.json');
    const dstConfig = path.join(dataDir, 'cinecast-config.json');
    if (fs.existsSync(srcConfig) && !fs.existsSync(dstConfig)) {
      try {
        fs.copyFileSync(srcConfig, dstConfig);
      } catch (_) { }
    }
    const srcCache = path.join(ROOT, '.cinecast-data', 'cache');
    const dstCache = path.join(dataDir, 'cache');
    if (fs.existsSync(srcCache) && !fs.existsSync(dstCache)) {
      try {
        fs.cpSync(srcCache, dstCache, { recursive: true });
      } catch (_) { }
    }
    const srcMediaCache = path.join(ROOT, 'public', 'data', 'media_cache');
    const srcFixtures = path.join(ROOT, 'scripts', 'fixtures');
    const dstMediaCache = path.join(dataDir, 'media_cache');
    if (!fs.existsSync(dstMediaCache)) {
      try {
        fs.mkdirSync(dstMediaCache, { recursive: true });
      } catch (_) { }
    }
    if (fs.existsSync(srcMediaCache)) {
      try {
        fs.cpSync(srcMediaCache, dstMediaCache, { recursive: true });
      } catch (_) { }
    }
    if (fs.existsSync(srcFixtures)) {
      try {
        fs.cpSync(srcFixtures, dstMediaCache, { recursive: true });
      } catch (_) { }
    }
  }

  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEnv = {
    ...process.env,
    PORT: String(port),
    CINECAST_PORT: String(port),
    CINECAST_DATA_DIR: dataDir,
    CINECAST_ROOM: room,
    CINECAST_TEST: '1',
    CINECAST_DISABLE_PREWARM: options.enablePrewarm ? '0' : '1',
    ...(options.env || {}),
  };
  delete serverEnv.ELECTRON_RUN_AS_NODE;
  if (options.unsetEnv && Array.isArray(options.unsetEnv)) {
    for (const k of options.unsetEnv) {
      delete serverEnv[k];
    }
  }

  const nodeBin = process.env.CINECAST_NODE_BIN || 'node';
  const extraNodeArgs = Array.isArray(options.nodeArgs) ? options.nodeArgs : [];
  const stdio = options.onStdoutLine ? ['ignore', 'pipe', 'pipe'] : options.stdio || 'ignore';

  const proc = spawn(nodeBin, [...extraNodeArgs, tsxCli, 'server.ts'], {
    cwd: ROOT,
    env: serverEnv,
    stdio,
    windowsHide: true,
  });

  if (options.onStdoutLine && proc.stdout) {
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const l of lines) {
        try {
          options.onStdoutLine(l);
        } catch (_) { }
      }
    });
  }

  registerPid(proc.pid, {
    role: 'testenv-server',
    port,
    room,
    dataDir,
    parentPid: process.pid,
  });

  try {
    await waitHealth(port, options.timeoutMs || 25000);
  } catch (err) {
    killPidTree(proc.pid);
    throw err;
  }

  const lanIp = getLanIp();
  const base = options.useLanIp ? `http://${lanIp}:${port}` : `http://127.0.0.1:${port}`;
  const lanBase = `http://${lanIp}:${port}`;

  setupElectronHooks({ port, room, lanIp });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    killPidTree(proc.pid);
    unregisterPid(process.pid);
    if (options.keepDataDir !== true) {
      for (let i = 0; i < 4; i++) {
        try {
          if (fs.existsSync(dataDir)) {
            fs.rmSync(dataDir, { recursive: true, force: true });
          }
          break;
        } catch (_) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    }
  };

  return {
    id,
    base,
    lanBase,
    port,
    room,
    dataDir,
    lanIp,
    pid: proc.pid,
    proc,
    stop,
  };
}

module.exports = {
  ROOT,
  PIDS_FILE,
  TEST_DATA_ROOT,
  readPidsMap,
  writePidsMap,
  registerPid,
  unregisterPid,
  isPidAlive,
  killPidTree,
  checkUserAppConflict,
  assertNoUserAppRunning,
  getLanIp,
  pickFreePort,
  waitHealth,
  rewriteTestUrl,
  startTestEnv,
  createTestEnv: startTestEnv,
  start: startTestEnv,
};
