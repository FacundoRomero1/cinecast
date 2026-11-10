import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '3000';
const outputFile = process.argv[3] || 'scratch/snap.json';
const baseUrl = `http://127.0.0.1:${port}`;

const TIMESTAMP_FIELDS = new Set([
  'timestamp',
  'updatedAt',
  'lastSeen',
  'savedAt',
  'createdAt',
]);

function normalizeAndSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAndSort(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (TIMESTAMP_FIELDS.has(key)) {
        continue;
      }
      sorted[key] = normalizeAndSort(value[key]);
    }
    return sorted;
  }
  return value;
}

const ROUTES = [
  {
    name: 'GET /api/health',
    method: 'GET',
    path: '/api/health',
  },
  {
    name: 'GET /api/local-ip',
    method: 'GET',
    path: '/api/local-ip',
  },
  {
    name: 'GET /api/diagnostic-mode',
    method: 'GET',
    path: '/api/diagnostic-mode',
  },
  {
    name: 'GET /api/catalog?limit=5',
    method: 'GET',
    path: '/api/catalog?limit=5',
  },
  {
    name: 'GET /api/catalog?category=anime&limit=3',
    method: 'GET',
    path: '/api/catalog?category=anime&limit=3',
  },
  {
    name: 'GET /api/sports/matches',
    method: 'GET',
    path: '/api/sports/matches',
  },
  {
    name: 'POST /api/sync/join (deviceId=test1&deviceName=snap&deviceType=remote)',
    method: 'POST',
    path: '/api/sync/join',
    body: {
      deviceId: 'test1',
      deviceName: 'snap',
      deviceType: 'remote',
    },
  },
  {
    name: 'GET /api/rooms/cine-home-1/devices',
    method: 'GET',
    path: '/api/rooms/cine-home-1/devices',
  },
  {
    name: 'GET /api/archive/search?q=test',
    method: 'GET',
    path: '/api/archive/search?q=test',
  },
];

async function runSnapshot() {
  const results = {};

  for (const route of ROUTES) {
    const url = `${baseUrl}${route.path}`;
    try {
      const options = {
        method: route.method,
        headers: {},
        signal: AbortSignal.timeout(15000),
      };
      if (route.body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(route.body);
      }

      const res = await fetch(url, options);
      const status = res.status;
      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();

      let parsedBody = rawText;
      if (contentType.includes('application/json')) {
        try {
          parsedBody = normalizeAndSort(JSON.parse(rawText));
        } catch (_) {
          parsedBody = rawText;
        }
      } else {
        // Si devuelve HTML (por ej. fallback SPA de Vite cuando una ruta no existe), resumir o guardar texto
        parsedBody = rawText.length > 300 ? `${rawText.slice(0, 300)}... [truncated ${rawText.length} chars]` : rawText;
      }

      results[route.name] = {
        status,
        contentType,
        body: parsedBody,
      };
      console.log(`${route.name} -> status: ${status} (${contentType})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results[route.name] = {
        status: 'NETWORK_ERROR',
        contentType: '',
        body: { error: errMsg },
      };
      console.log(`${route.name} -> status: NETWORK_ERROR (${errMsg})`);
    }
  }

  const outPath = path.resolve(process.cwd(), outputFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Snapshot guardado en: ${outPath}`);
}

runSnapshot();
