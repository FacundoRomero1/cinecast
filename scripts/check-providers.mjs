#!/usr/bin/env node
/**
 * Verificador de proveedores embed de CineCast.
 * Uso:  npm run check:providers
 *
 * Hace una petición real a cada proveedor con una película de prueba (Fight Club, TMDB 550)
 * y reporta disponibilidad (HTTP < 400) y latencia en ms, ordenados del más rápido al más lento.
 * Luego imprime el orden recomendado (TukiPlay siempre primero).
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TEST_TMDB_ID = 550;
const TIMEOUT_MS = 8000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const PROVIDERS = [
  { id: 'tukiplay', name: 'TukiPlay (Latino HD)', url: `https://tukiplay.com/embed/movie/${TEST_TMDB_ID}` },
  { id: 'vidlink', name: 'VidLink Pro (Multi / Sub ES)', url: `https://vidlink.pro/movie/${TEST_TMDB_ID}` },
  { id: 'vidsrc.me', name: 'VidSrc ME', url: `https://vidsrc.me/embed/movie?tmdb=${TEST_TMDB_ID}` },
  { id: 'embed.su', name: 'Embed.su (Ultra HD)', url: `https://embed.su/embed/movie/${TEST_TMDB_ID}` },
  { id: 'videasy', name: 'VidEasy (Latino & Multi)', url: `https://player.videasy.net/movie/${TEST_TMDB_ID}` },
  { id: 'vidsrc.cc', name: 'VidSrc CC (Espejo HD)', url: `https://vidsrc.cc/v2/embed/movie/${TEST_TMDB_ID}` },
  { id: 'moviesapi', name: 'MoviesAPI (HD Estable)', url: `https://moviesapi.club/movie/${TEST_TMDB_ID}` },
  { id: 'smashy', name: 'SmashyStream (Alternativo)', url: `https://embed.smashystream.com/playere.php?tmdb=${TEST_TMDB_ID}` },
  { id: 'multiembed', name: 'MultiEmbed', url: `https://multiembed.mov/directstream.php?video_id=${TEST_TMDB_ID}&tmdb=1` },
  { id: '2embed', name: '2Embed', url: `https://www.2embed.cc/embed/${TEST_TMDB_ID}` },
];

async function ping(provider) {
  const started = Date.now();
  try {
    const res = await fetch(provider.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    return { ...provider, ok: res.status < 400, status: res.status, ms };
  } catch (err) {
    return { ...provider, ok: false, status: 0, ms: Date.now() - started, error: String(err?.cause?.code || err?.name || err) };
  }
}

async function main() {
  console.log(`\n🔎 Verificando ${PROVIDERS.length} proveedores (timeout ${TIMEOUT_MS / 1000}s)...\n`);
  const results = await Promise.all(PROVIDERS.map(ping));

  const sorted = [...results].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.ms - b.ms;
  });

  for (const r of sorted) {
    const icon = r.ok ? '✅' : '❌';
    const detail = r.ok ? `HTTP ${r.status}` : r.status ? `HTTP ${r.status}` : r.error || 'sin respuesta';
    console.log(`${icon} ${r.name.padEnd(32)} ${String(r.ms).padStart(5)} ms   ${detail}`);
  }

  const alive = sorted.filter((r) => r.ok);
  const tuki = results.find((r) => r.id === 'tukiplay');
  const order = [tuki, ...alive.filter((r) => r.id !== 'tukiplay')].filter(Boolean);
  console.log('\n📋 Orden recomendado hoy:');
  order.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}${r.ok ? '' : ' (caído)'}`));
  console.log(`\n${alive.length}/${results.length} proveedores respondieron.\n`);
}

main();
