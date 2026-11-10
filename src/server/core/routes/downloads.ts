import { Router, type Request } from 'express';
import os from 'os';
import path from 'path';
import { getLocalIpAddress } from '../net.js';

export interface DownloadsOptions {
  port?: number | string | undefined;
  baseDir?: string | undefined;
  resolveOrigin?: ((req: Request) => string) | undefined;
}

export function createDownloadsRouter(options: DownloadsOptions = {}): Router {
  const router = Router();
  const PORT = options.port || process.env.PORT || 3000;
  const baseDir = options.baseDir || process.cwd();

  function defaultResolveAppOrigin(req: Request): string {
    const localIp = getLocalIpAddress();
    const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    if (
      queryOrigin &&
      queryOrigin.startsWith('http') &&
      !queryOrigin.includes('localhost') &&
      !queryOrigin.includes('127.0.0.1')
    ) {
      return queryOrigin.replace(/\/$/, '');
    }
    const rawForwarded = req.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(rawForwarded) ? rawForwarded[0] : rawForwarded;
    if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
      return `https://${forwardedHost}`;
    }
    if (
      req.headers.host &&
      !req.headers.host.includes('localhost') &&
      !req.headers.host.includes('127.0.0.1')
    ) {
      return `http://${req.headers.host}`;
    }
    return `http://${localIp || '192.168.1.100'}:${PORT}`;
  }

  const resolveAppOrigin = options.resolveOrigin || defaultResolveAppOrigin;

  router.get('/api/local-ip', (_req, res) => {
    const localIp = getLocalIpAddress();
    res.json({
      ip: localIp,
      port: PORT,
      url: localIp ? `http://${localIp}:${PORT}` : `http://localhost:${PORT}`,
      allIps: Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => i?.address),
    });
  });

  router.get('/api/download/pc-windows', (req, res) => {
    const origin = resolveAppOrigin(req);
    const targetUrl = `${origin}/?role=screen`;

    const batContent = [
      '@echo off',
      'title CineCast TV - Lanzador PC',
      'color 0C',
      `set "APP_URL=${targetUrl}"`,
      'start "" "%APP_URL%"',
      'exit',
    ].join('\r\n');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="Instalar-CineCast-PC.bat"');
    res.send(batContent);
  });

  router.get('/api/download/mobile-remote', (req, res) => {
    const origin = resolveAppOrigin(req);
    const remoteUrl = `${origin}/?role=remote`;

    const htmlApp = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#e50914" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <title>CineCast Control Remoto</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html { width: 100%; height: 100%; background: #09090b; color: #fff; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; }
    .card { max-width: 360px; width: 100%; background: #18181b; border: 1px solid #27272a; border-radius: 28px; padding: 32px 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .logo { width: 64px; height: 64px; border-radius: 20px; background: #e50914; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 900; margin: 0 auto 16px; box-shadow: 0 10px 25px rgba(229,9,20,0.4); }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: block; width: 100%; background: #e50914; color: #fff; text-decoration: none; padding: 16px; border-radius: 16px; font-size: 15px; font-weight: 800; box-shadow: 0 8px 20px rgba(229,9,20,0.35); }
  </style>
  <script>
    window.location.replace("${remoteUrl}");
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">▶</div>
    <h1>CineCast Control Remoto</h1>
    <p>Conectando con tu pantalla de PC...</p>
    <a class="btn" href="${remoteUrl}">📱 Entrar al Control Remoto</a>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="CineCast-Control-Celu.html"');
    res.send(htmlApp);
  });

  router.get('/manifest.webmanifest', (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.resolve(baseDir, 'public', 'manifest.webmanifest'));
  });

  router.get('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.resolve(baseDir, 'public', 'sw.js'));
  });

  return router;
}
