import { Router, type Request, type Response } from 'express';
import { getSavedTmdbKey } from '../tmdb.js';

export interface ClientLogEntry {
  id?: string;
  timestamp?: string | number;
  receivedAt: string;
  ip: string;
  type?: string;
  level?: string;
  message?: string;
  env?: Record<string, any>;
  event?: Record<string, any>;
  data?: any;
}

const MAX_ENTRIES = 300;
const MAX_BODY_BYTES = 20 * 1024; // 20 KB
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 60;

// Estado en memoria
const memoryLogs: ClientLogEntry[] = [];
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function maskSecretString(str: string): string {
  if (typeof str !== 'string') return str;
  let result = str;
  const savedTmdb = getSavedTmdbKey();
  if (savedTmdb && savedTmdb.length >= 4 && result.includes(savedTmdb)) {
    result = result.split(savedTmdb).join('[REDACTED_TMDB_KEY]');
  }
  if (process.env.TMDB_API_KEY && process.env.TMDB_API_KEY.length >= 4 && result.includes(process.env.TMDB_API_KEY)) {
    result = result.split(process.env.TMDB_API_KEY).join('[REDACTED_TMDB_KEY]');
  }
  // Match potential client IDs (hex strings of 32 chars)
  result = result.replace(/\b([a-f0-9]{4})[a-f0-9]{24}([a-f0-9]{4})\b/gi, '$1...$2');
  // Match tokens like BQ... or generic long tokens (20+ chars)
  result = result.replace(/([a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]{20,}([a-zA-Z0-9_-]{4})/g, (_match, prefix, suffix) => {
    return `${prefix}...${suffix}`;
  });
  return result;
}

export function sanitizeLogValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return maskSecretString(val);
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeLogValue);
  }
  if (typeof val === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('authorization') ||
        lower.includes('clientid') ||
        lower.includes('client_id') ||
        lower.includes('tmdbkey') ||
        lower.includes('tmdb_key') ||
        lower.includes('apikey') ||
        lower.includes('api_key')
      ) {
        if (typeof v === 'string') {
          cleaned[k] = v.length > 8 ? `${v.slice(0, 4)}...${v.slice(-4)}` : '****';
        } else {
          cleaned[k] = '[REDACTED]';
        }
      } else {
        cleaned[k] = sanitizeLogValue(v);
      }
    }
    return cleaned;
  }
  return val;
}

export function isPrivateIp(rawIp: string): boolean {
  if (!rawIp) return false;
  const ip = rawIp.replace(/^::ffff:/, '').trim();

  // Loopback
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }
  // 10.0.0.0/8
  if (/^10\./.test(ip)) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  // 192.168.0.0/16
  if (/^192\.168\./.test(ip)) return true;
  // 169.254.0.0/16 (link-local)
  if (/^169\.254\./.test(ip)) return true;
  // IPv6 ULA / link-local (fc00::/7, fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;

  return false;
}

export function isLoopbackIp(rawIp: string): boolean {
  if (!rawIp) return false;
  const ip = rawIp.replace(/^::ffff:/, '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function getClientIp(req: Request): string {
  const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
  const remote = req.socket?.remoteAddress || '';
  const chosen = forwarded || remote || '127.0.0.1';
  return chosen.replace(/^::ffff:/, '');
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  entry.count++;
  return true;
}

export function createClientLogRouter(): Router {
  const router = Router();

  // Middleware para comprobar si el servicio está apagado vía env
  router.use((_req, res, next) => {
    if (process.env.CINECAST_CLIENT_LOG === '0') {
      res.status(404).json({ error: 'Client log service disabled by CINECAST_CLIENT_LOG=0' });
      return;
    }
    next();
  });

  // POST /client-log (solo IPs privadas, máx 20 KB, 60 req/min/IP)
  router.post('/client-log', (req: Request, res: Response): void => {
    const ip = getClientIp(req);

    if (!isPrivateIp(ip)) {
      res.status(403).json({ error: 'Forbidden: only private IPs allowed' });
      return;
    }

    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: 'Too many requests, rate limit exceeded' });
      return;
    }

    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Payload too large, maximum 20 KB' });
      return;
    }

    const body = req.body;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
    if (Buffer.byteLength(bodyStr, 'utf8') > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Payload too large, maximum 20 KB' });
      return;
    }

    const now = new Date().toISOString();
    const itemsToAdd: ClientLogEntry[] = [];

    if (Array.isArray(body)) {
      for (const item of body) {
        itemsToAdd.push({
          receivedAt: now,
          ip,
          ...(typeof item === 'object' && item !== null ? item : { data: item }),
        });
      }
    } else if (body && typeof body === 'object') {
      if (Array.isArray((body as any).entries)) {
        for (const item of (body as any).entries) {
          itemsToAdd.push({
            receivedAt: now,
            ip,
            ...(typeof item === 'object' && item !== null ? item : { data: item }),
          });
        }
      } else {
        itemsToAdd.push({
          receivedAt: now,
          ip,
          ...body,
        });
      }
    } else {
      itemsToAdd.push({
        receivedAt: now,
        ip,
        data: body,
      });
    }

    const sanitized = itemsToAdd.map((entry) => sanitizeLogValue(entry));
    memoryLogs.push(...sanitized);
    if (memoryLogs.length > MAX_ENTRIES) {
      memoryLogs.splice(0, memoryLogs.length - MAX_ENTRIES);
    }

    res.status(200).json({ ok: true, stored: memoryLogs.length, added: itemsToAdd.length });
  });

  // GET /client-log (solo 127.0.0.1 o ::1; ?html=1 tabla, ?clear=1 vacía)
  router.get('/client-log', (req: Request, res: Response): void => {
    const ip = getClientIp(req);

    if (!isLoopbackIp(ip)) {
      res.status(403).json({ error: 'Forbidden: GET allowed only from 127.0.0.1 or ::1' });
      return;
    }

    if (req.query.clear === '1') {
      memoryLogs.length = 0;
      res.status(200).json({ ok: true, cleared: true, total: 0 });
      return;
    }

    if (req.query.html === '1') {
      const rows = memoryLogs
        .slice()
        .reverse()
        .map((entry, idx) => {
          const type = entry.type || entry.level || 'info';
          const info = JSON.stringify(entry);
          return `<tr>
            <td>${idx + 1}</td>
            <td>${entry.receivedAt}</td>
            <td><code>${entry.ip}</code></td>
            <td><span class="badge ${type}">${type}</span></td>
            <td><pre>${escapeHtml(info)}</pre></td>
          </tr>`;
        })
        .join('\n');

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>CineCast - Client Logs (${memoryLogs.length})</title>
  <style>
    body { font-family: monospace; background: #09090b; color: #f4f4f5; margin: 20px; }
    h1 { color: #ef4444; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
    th, td { border: 1px solid #27272a; padding: 6px 10px; text-align: left; }
    th { background: #18181b; color: #a1a1aa; }
    tr:nth-child(even) { background: #111113; }
    .badge { padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; }
    .badge.error { background: #7f1d1d; color: #fecaca; }
    .badge.warn, .badge.warning { background: #78350f; color: #fef3c7; }
    .badge.env { background: #1e3a8a; color: #bfdbfe; }
    .badge.touch { background: #064e3b; color: #a7f3d0; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>CineCast - Registros de Cliente (${memoryLogs.length} en memoria)</h1>
  <p><a href="/api/client-log?clear=1" style="color: #ef4444;">Vaciar registros (?clear=1)</a> | <a href="/api/client-log" style="color: #38bdf8;">JSON crudo</a></p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Hora Recibido</th>
        <th>IP</th>
        <th>Tipo</th>
        <th>Contenido / Detalle</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5" style="text-align:center;">Sin registros</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
      return;
    }

    res.status(200).json({ ok: true, total: memoryLogs.length, entries: memoryLogs });
  });

  return router;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
