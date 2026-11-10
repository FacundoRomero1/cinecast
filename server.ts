import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './src/server/core/http.js';
import { attachWebSocket } from './src/server/core/ws.js';
import { getLocalIpAddress } from './src/server/core/net.js';

export { getLocalIpAddress };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

let devDiagnosticMode = false;
let devNoCorsFix = false;

const app = createApp({
  baseDir: __dirname,
  port: PORT,
  diagnostics: {
    getMode: () => devDiagnosticMode,
    setMode: (val: boolean) => {
      devDiagnosticMode = val;
    },
    getNoCorsFix: () => devNoCorsFix,
    setNoCorsFix: (val: boolean) => {
      devNoCorsFix = val;
    },
    onChange: () => {},
  },
});

const server = http.createServer(app);
attachWebSocket(server);

// Serve frontend with Vite in dev, or static in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(Number(PORT), '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log(`====================================================`);
    console.log(`🎬 CineCast Server Activo en Red Local (LAN):`);
    console.log(`   ➜ Local:    http://localhost:${PORT}`);
    console.log(`   ➜ Red WiFi: http://${localIp}:${PORT}`);
    console.log(`====================================================`);
  });
}

startServer();
