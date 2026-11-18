import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '..', '.cinecast-data');

async function probeUrl(url, timeoutMs = 4000) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { ok: false, status: 0, contentType: '', isExtM3u: false, error: 'invalid_url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    const status = res.status;

    if (!res.ok) {
      return { ok: false, status, contentType, isExtM3u: false, error: `HTTP_${status}` };
    }

    // Leer primeros 512 bytes para chequear #EXTM3U
    const reader = res.body?.getReader();
    let text = '';
    if (reader) {
      const { value } = await reader.read();
      if (value) {
        text = new TextDecoder('utf-8').decode(value);
      }
      try { reader.cancel(); } catch (_) {}
    } else {
      text = await res.text();
    }

    const isExtM3u = text.includes('#EXTM3U') || text.includes('#EXT-X-STREAM-INF') || text.includes('#EXTINF');
    const isMpegUrl = contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl');

    return {
      ok: isExtM3u || isMpegUrl,
      status,
      contentType,
      isExtM3u,
      snippet: text.slice(0, 80).replace(/\r?\n/g, ' '),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      contentType: '',
      isExtM3u: false,
      error: err.name === 'AbortError' ? 'TIMEOUT' : (err.message || String(err)),
    };
  }
}

async function run() {
  const { getOrFetchSportsChannels } = await import('../src/server/core/sports.js').catch(async () => {
    return await import('../src/server/core/sports.ts');
  });

  console.log('[probe] Obteniendo canales de /api/sports/channels...');
  const data = await getOrFetchSportsChannels(cacheDir, false, false);
  const channels = data.channels || [];
  console.log(`[probe] Total de canales obtenidos: ${channels.length}`);

  const results = [];
  const CONCURRENCY = 25;

  for (let i = 0; i < channels.length; i += CONCURRENCY) {
    const chunk = channels.slice(i, i + CONCURRENCY);
    const chunkRes = await Promise.all(
      chunk.map(async (ch) => {
        const probe = await probeUrl(ch.streamUrl, 3500);
        return {
          id: ch.id,
          name: ch.name,
          country: ch.country,
          streamUrl: ch.streamUrl,
          ...probe,
        };
      })
    );
    results.push(...chunkRes);
    const aliveCount = results.filter((r) => r.ok).length;
    process.stdout.write(`\r[probe] Probados: ${results.length}/${channels.length} (Vivos: ${aliveCount})`);
  }
  console.log('\n[probe] Sondeo completado.');

  const alive = results.filter((r) => r.ok);
  const dead = results.filter((r) => !r.ok);

  console.log(`\nRESUMEN:`);
  console.log(`  • Vivos: ${alive.length}`);
  console.log(`  • Muertos: ${dead.length}`);

  // Guardar resultados en scratch/sports-probe-results.json
  const outPath = path.resolve(__dirname, '..', 'scratch', 'sports-probe-results.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ alive, dead, total: results.length }, null, 2), 'utf8');
  console.log(`[probe] Resultados guardados en ${outPath}`);

  // Mostrar muestra de vivos
  console.log('\nMUESTRA DE CANALES VIVOS (primeros 15):');
  alive.slice(0, 15).forEach((c, idx) => {
    console.log(`#${idx + 1} [${c.country}] ${c.name} | Status: ${c.status} | CT: ${c.contentType} | EXTM3U: ${c.isExtM3u} | URL: ${c.streamUrl}`);
  });

  // Mostrar muestra de muertos
  console.log('\nMUESTRA DE CANALES MUERTOS (primeros 15):');
  dead.slice(0, 15).forEach((c, idx) => {
    console.log(`✗ [${c.country}] ${c.name} | Status: ${c.status} | Error: ${c.error} | URL: ${c.streamUrl}`);
  });
}

run().catch(console.error);
