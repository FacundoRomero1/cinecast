#!/usr/bin/env node
/**
 * scripts/precheck-mm.mjs
 * Pre-chequeos D, E, A, B, C sobre MovieMaster HLS directo antes de codear B8.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

async function harvestServersUrl(browser, embedUrl) {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  let serversUrl = null;
  page.on('request', (req) => {
    if (!serversUrl && req.url().includes('api.moviemaster.lat/servers')) {
      serversUrl = req.url();
    }
  });
  await page.setContent(`<iframe src="${embedUrl}" width="900" height="500"></iframe>`);
  for (let i = 0; i < 25 && !serversUrl; i++) await page.waitForTimeout(300);
  await ctx.close();
  return serversUrl;
}

function analyzePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hostPathCounts = {};
  const discontinuities = [];
  const segments = [];
  let pendingDur = null;
  let totalDur = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuities.push({ lineIdx: i, segIdx: segments.length, tag: l });
    } else if (l.startsWith('#EXTINF:')) {
      pendingDur = parseFloat(l.slice(8).split(',')[0]) || 0;
    } else if (!l.startsWith('#')) {
      let full = l;
      try { full = new URL(l, baseUrl).toString(); } catch {}
      let host = 'unknown';
      let pathPrefix = '/';
      try {
        const u = new URL(full);
        host = u.hostname;
        const parts = u.pathname.split('/').filter(Boolean);
        pathPrefix = '/' + parts.slice(0, 2).join('/');
      } catch {}
      const key = `${host} ${pathPrefix}`;
      hostPathCounts[key] = (hostPathCounts[key] || 0) + 1;
      const dur = pendingDur ?? 0;
      totalDur += dur;
      segments.push({ idx: segments.length, dur, host, pathPrefix, url: full });
      pendingDur = null;
    }
  }
  return {
    totalSegments: segments.length,
    totalDurSec: Math.round(totalDur),
    hostPathCounts,
    discontinuities,
    first5: segments.slice(0, 5),
    mid5: segments.slice(Math.max(0, Math.floor(segments.length / 2) - 2), Math.floor(segments.length / 2) + 3),
    last3: segments.slice(-3),
    segments,
  };
}

async function main() {
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

  try {
    // ── PRE-CHEQUEO D: Cosecha del ui y reusabilidad desde Node ──
    console.log('=== PRE-CHEQUEO D: Cosecha del ui ===');
    const sUrl1 = await harvestServersUrl(browser, 'https://api.moviemaster.lat/e/tv/1396/1/1?lang=LAT&autoplay=1');
    const uObj = new URL(sUrl1);
    const uiToken = uObj.searchParams.get('ui') || '';
    console.log('URL cosechada:', sUrl1);
    console.log('ui length:', uiToken.length);

    const rSame = await fetch(sUrl1, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const jSame = await rSame.json();
    console.log('Node fetch MISMO título (1396/1/1):', { status: rSame.status, servers: jSame.servers?.length, pendiente: jSame.pendiente });

    // Probar si el mismo ui sirve para OTRO episodio (1396/1/2) y OTRO título (1399/1/1)
    const uOtherEp = `https://api.moviemaster.lat/servers?tmdb=1396&type=tv&season=1&episode=2&ui=${encodeURIComponent(uiToken)}`;
    const rOtherEp = await fetch(uOtherEp, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const tOtherEp = await rOtherEp.text();
    console.log('Node fetch OTRO episodio con MISMO ui (1396/1/2):', { status: rOtherEp.status, bodyHead: tOtherEp.slice(0, 140) });

    const uOtherShow = `https://api.moviemaster.lat/servers?tmdb=1399&type=tv&season=1&episode=1&ui=${encodeURIComponent(uiToken)}`;
    const rOtherShow = await fetch(uOtherShow, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const tOtherShow = await rOtherShow.text();
    console.log('Node fetch OTRA serie con MISMO ui (1399/1/1):', { status: rOtherShow.status, bodyHead: tOtherShow.slice(0, 140) });

    // ── PRE-CHEQUEO E: Patrón de segmentos en variante HLS ──
    console.log('\n=== PRE-CHEQUEO E: Patrón de segmentos (Breaking Bad 1396/1/1 LAT) ===');
    const latSrv = jSame.servers.find((s) => s.lang === 'LAT') || jSame.servers[0];
    const rMaster = await fetch(latSrv.video, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const masterTxt = await rMaster.text();
    const masterLines = masterTxt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const variantRel = masterLines.find((l) => !l.startsWith('#'));
    const variantUrl = new URL(variantRel, rMaster.url).toString();
    const rVar = await fetch(variantUrl, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const varTxt = await rVar.text();
    const analysis1 = analyzePlaylist(varTxt, rVar.url);
    console.log('Variant URL:', variantUrl.slice(0, 120) + '...');
    console.log('Variant headers:', {
      status: rVar.status,
      contentType: rVar.headers.get('content-type'),
      cacheControl: rVar.headers.get('cache-control'),
      acao: rVar.headers.get('access-control-allow-origin'),
    });
    console.log('Resumen 1396/1/1:', {
      totalSegments: analysis1.totalSegments,
      totalDurSec: analysis1.totalDurSec,
      hostPathCounts: analysis1.hostPathCounts,
      discontinuitiesCount: analysis1.discontinuities.length,
      discontinuities: analysis1.discontinuities.slice(0, 10),
    });
    console.log('Primeros 5 segmentos:', analysis1.first5.map((s) => `#${s.idx} ${s.dur}s ${s.host}${s.pathPrefix}`));
    console.log('5 segmentos del medio:', analysis1.mid5.map((s) => `#${s.idx} ${s.dur}s ${s.host}${s.pathPrefix}`));
    console.log('Últimos 3 segmentos:', analysis1.last3.map((s) => `#${s.idx} ${s.dur}s ${s.host}${s.pathPrefix}`));

    // Revisar un segundo servidor LAT (Servidor 2 o 4) para ver si usa distinto host
    const latSrv2 = jSame.servers.filter((s) => s.lang === 'LAT')[1];
    if (latSrv2) {
      const rM2 = await fetch(latSrv2.video, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      const m2Txt = await rM2.text();
      const v2Rel = m2Txt.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (v2Rel && m2Txt.includes('#EXTM3U')) {
        const v2Url = new URL(v2Rel, rM2.url).toString();
        const rV2 = await fetch(v2Url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
        const v2Txt = await rV2.text();
        const a2 = analyzePlaylist(v2Txt, rV2.url);
        console.log('\nSegundo servidor LAT (' + latSrv2.name + '):', {
          totalSegments: a2.totalSegments,
          totalDurSec: a2.totalDurSec,
          hostPathCounts: a2.hostPathCounts,
          discontinuitiesCount: a2.discontinuities.length,
        });
      }
    }

    // ── PRE-CHEQUEO A: CORS en segmentos ──
    console.log('\n=== PRE-CHEQUEO A: CORS en segmentos ===');
    for (const seg of [analysis1.segments[0], analysis1.segments[Math.floor(analysis1.segments.length / 2)]].filter(Boolean)) {
      const rSegPlain = await fetch(seg.url, { method: 'HEAD', headers: { 'User-Agent': UA } });
      const rSegCors = await fetch(seg.url, { method: 'HEAD', headers: { 'User-Agent': UA, Origin: 'http://localhost:3000' } });
      console.log(`Segmento #${seg.idx} (${seg.host}):`, {
        plainStatus: rSegPlain.status,
        plainACAO: rSegPlain.headers.get('access-control-allow-origin'),
        corsStatus: rSegCors.status,
        corsACAO: rSegCors.headers.get('access-control-allow-origin'),
        corsVary: rSegCors.headers.get('vary'),
        contentType: rSegCors.headers.get('content-type'),
      });
    }

    // ── PRE-CHEQUEO B: Estado inicial de TTL de variante ──
    console.log('\n=== PRE-CHEQUEO B: Variante URL (t=0) ===');
    console.log({
      variantUrlPrefix: variantUrl.slice(0, 90),
      status: rVar.status,
      cacheControl: rVar.headers.get('cache-control'),
      expires: rVar.headers.get('expires'),
    });

    // ── PRE-CHEQUEO C: pendiente: true ──
    console.log('\n=== PRE-CHEQUEO C: Buscando respuesta con pendiente: true ===');
    const candidatesC = [
      { label: 'Simpsons T37E4', url: 'https://api.moviemaster.lat/e/tv/456/37/4?lang=LAT&autoplay=1' },
      { label: 'Estreno reciente/futuro movie 1241982', url: 'https://api.moviemaster.lat/e/movie/1241982?lang=LAT&autoplay=1' },
      { label: 'Estreno/pendiente movie 986056', url: 'https://api.moviemaster.lat/e/movie/986056?lang=LAT&autoplay=1' },
      { label: 'Futuro movie 1087192', url: 'https://api.moviemaster.lat/e/movie/1087192?lang=LAT&autoplay=1' },
    ];
    for (const c of candidatesC) {
      const cUrl = await harvestServersUrl(browser, c.url);
      if (!cUrl) continue;
      const rc = await fetch(cUrl, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      const jc = await rc.json().catch(() => null);
      console.log(c.label, { status: rc.status, pendiente: jc?.pendiente, serversCount: jc?.servers?.length, rawKeys: jc ? Object.keys(jc) : null, raw: jc?.servers?.length === 0 ? jc : undefined });
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
