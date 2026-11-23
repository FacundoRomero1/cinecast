#!/usr/bin/env node
/**
 * scripts/precheck-mm-b8.mjs
 * Pre-chequeos B-bis, F, G y H para B8:
 *  - F & B-bis (inmediato sobre URLs de hace 53h + cosecha fresca):
 *    ¿Qué devuelve el `video` caducado (410) vs su variante `.m3u8` guardada vs sus segmentos en tiktokcdn?
 *  - G: Servidores 1, 2 y 3 (y todos los de 1396/1/1): status, content-type, primeros bytes, CDN y si comparten o cambian hash por idioma (LAT / ESP / SUB).
 *  - H: Distribución de idiomas (LAT / ESP / SUB) sobre 10 títulos al azar con stock en MovieMaster.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

async function fetchInfo(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    cacheControl: res.headers.get('cache-control') || '',
    acao: res.headers.get('access-control-allow-origin') || '',
    bytes: buf.length,
    isExtM3u: text.trimStart().startsWith('#EXTM3U'),
    first180: text.slice(0, 180),
    text,
    finalUrl: res.url,
  };
}

async function harvestServersJson(ctx, embedUrl) {
  const page = await ctx.newPage();
  let serversUrl = null;
  page.on('request', (req) => {
    if (!serversUrl && req.url().includes('api.moviemaster.lat/servers')) {
      serversUrl = req.url();
    }
  });
  await page.setContent(`<iframe src="${embedUrl}" width="800" height="450"></iframe>`);
  for (let i = 0; i < 22 && !serversUrl; i++) await page.waitForTimeout(300);
  await page.close();
  if (!serversUrl) return null;
  const r = await fetch(serversUrl, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (r.status !== 200) return null;
  return await r.json().catch(() => null);
}

async function main() {
  // 1. Prueba inmediata sobre el `video` y la `variante` capturados en el spike anterior (ya vencidos >15 min / 53h)
  console.log('=== PRE-CHEQUEO F & B-bis (sobre video + variante ya vencidos >60 min) ===');
  const expiredVideoUrl =
    'https://api-encrypted.moviemaster.lat/video?tmdb=1396&type=tv&season=1&episode=1&embed=64D-eNrPfOV8WH3ctTqZjTMLN4-3kFy-iR3DLuoIwuA2eYIwnfSk7Wd81FPgSJCT_XMaujMM_lUTTaLI58-bJXEbBXdT4Y-KidQme39xtP3ZwZ-6Jcmdi8rDUDeRqJnlgqdOcY6TB7lNBhXZjmsy-Ti0_ssiYUkq_OYQTSv9u2FjsdQs4VSgVepjIsdxi4LlrkArJy3fbAW5RMtlW0zO9MgNyNETeNkaLTfGQuox3f3ls9IZQMLD2-cnrEzKm3UdVjE&noiframe=1';
  const expiredVariantUrl =
    'https://api-encrypted.moviemaster.lat/s/ipQ_l_ylEQP-2qJKHh0K06LP5aO8DgJDSGlzi6TwHntpJqgbnEVjaK2aO5YhNwVCUBFKPO-U8DqH0h1-x97OpUDianl_VzuF4OJPqkgYPic5O5Ealzo_j3y4erbpdjbfogCqwm95fdEbPSgtZFxOrS1MPfTP-Rcq0g35rD84PdNDxkoQQPxlhdCHcGCkAzKGendRmvBmclWjKNHj38xuHUar6TNfB8VNHT6L82_5wy5AFfbz6jqHUjC0kBUfMjjT7-iznBrd_Qd1Zq3nHwpUBrh2xT8GpfBnxEaNCivn6hUoPDpqAfAW473V4thPQQdfEH1KYxz2ATSGGrbzGEH4kv3xn4T8l_R8cFjpeUfdRn9XIOFfD9Pm63Luq9r_GUznoMHN-g.m3u8';
  const oldSegmentUrl =
    'https://p19-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/202602085d0d12419bc41df4416b9c68~tplv-d5opwmad15-ttam-origin.image';

  const rExpVid = await fetchInfo(expiredVideoUrl);
  const rExpVar = await fetchInfo(expiredVariantUrl);
  const rOldSeg = await fetch(oldSegmentUrl, { method: 'HEAD', headers: { 'User-Agent': UA } });

  console.log('Video vencido (>60 min):', {
    status: rExpVid.status,
    contentType: rExpVid.contentType,
    bytes: rExpVid.bytes,
    first180: rExpVid.first180,
  });
  console.log('Variante guardada (>60 min, después de 410 en video):', {
    status: rExpVar.status,
    contentType: rExpVar.contentType,
    cacheControl: rExpVar.cacheControl,
    acao: rExpVar.acao,
    bytes: rExpVar.bytes,
    isExtM3u: rExpVar.isExtM3u,
    first180: rExpVar.first180,
  });
  console.log('Segmento tiktokcdn de esa variante (>60 min):', {
    status: rOldSeg.status,
    contentType: rOldSeg.headers.get('content-type'),
    acao: rOldSeg.headers.get('access-control-allow-origin'),
    contentLength: rOldSeg.headers.get('content-length'),
  });

  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
  const ctx = await browser.newContext({ userAgent: UA });

  try {
    // 2. PRE-CHEQUEO G: Servidores 1, 2 y 3 (y resumen de los 12/13 servidores de 1396/1/1)
    console.log('\n=== PRE-CHEQUEO G: Servidores 1, 2 y 3 (Breaking Bad 1396/1/1) ===');
    const j1396 = await harvestServersJson(ctx, 'https://api.moviemaster.lat/e/tv/1396/1/1?lang=LAT&autoplay=1');
    const srvs = j1396?.servers || [];
    console.log(`Total servidores en 1396/1/1: ${srvs.length}`);
    for (let i = 0; i < Math.min(4, srvs.length); i++) {
      const s = srvs[i];
      const mInfo = await fetchInfo(s.video);
      let varSampleSeg = '';
      let varStatus = null;
      let varContentType = '';
      if (mInfo.isExtM3u) {
        const rel = mInfo.text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
        if (rel) {
          const vUrl = new URL(rel, mInfo.finalUrl).toString();
          const vInfo = await fetchInfo(vUrl);
          varStatus = vInfo.status;
          varContentType = vInfo.contentType;
          varSampleSeg = vInfo.text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
        }
      }
      console.log(`Servidor #${i + 1} (${s.name}, lang=${s.lang}, site=${s.site}, detras=${Boolean(s.detras)}):`, {
        masterStatus: mInfo.status,
        masterContentType: mInfo.contentType,
        masterACAO: mInfo.acao,
        masterIsExtM3u: mInfo.isExtM3u,
        masterFirst160: mInfo.first180.slice(0, 160),
        variantStatus: varStatus,
        variantContentType: varContentType,
        firstSegmentUrlFull: varSampleSeg,
      });
      if (i === 0 && varSampleSeg) {
        try {
          const segU = new URL(varSampleSeg);
          const xExp = Number(segU.searchParams.get('x-expires') || 0);
          const nowSec = Math.floor(Date.now() / 1000);
          const rSegGet = await fetch(varSampleSeg, { headers: { 'User-Agent': UA, Range: 'bytes=0-255' } });
          console.log('Inspección completa Segmento #0 (Servidor #1):', {
            queryKeys: Array.from(segU.searchParams.keys()),
            xExpiresUnix: xExp,
            nowUnix: nowSec,
            segmentTtlHours: xExp ? Number(((xExp - nowSec) / 3600).toFixed(2)) : null,
            getStatus: rSegGet.status,
            getContentType: rSegGet.headers.get('content-type'),
            getACAO: rSegGet.headers.get('access-control-allow-origin'),
          });
        } catch (_) {}
      }
    }

    // 3. PRE-CHEQUEO H: Distribución de idiomas (LAT / ESP / SUB) sobre 10 títulos al azar con stock
    console.log('\n=== PRE-CHEQUEO H: Distribución de idiomas sobre 10 títulos al azar ===');
    const cat = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'catalog.json'), 'utf8'));
    const items = (Array.isArray(cat) ? cat : (cat.items || [])).filter(
      (x) => Number(x.tmdbId || String(x.id).replace(/\D/g, '')) > 0
    );
    let seed = 20261123;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const shuffled = [...items].sort(() => rand() - 0.5);

    const distRows = [];
    for (const it of shuffled) {
      if (distRows.length >= 10) break;
      const tmdb = Number(it.tmdbId || String(it.id).replace(/\D/g, ''));
      const isTv = it.type === 'series' || it.category === 'series' || it.category === 'anime';
      const eUrl = isTv
        ? `https://api.moviemaster.lat/e/tv/${tmdb}/1/1?lang=LAT&autoplay=1`
        : `https://api.moviemaster.lat/e/movie/${tmdb}?lang=LAT&autoplay=1`;
      const j = await harvestServersJson(ctx, eUrl);
      if (!j || !Array.isArray(j.servers) || j.servers.length === 0) continue;
      const counts = { LAT: 0, ESP: 0, SUB: 0, OTHER: 0 };
      for (const s of j.servers) {
        const l = String(s.lang || '').toUpperCase();
        if (counts[l] !== undefined) counts[l]++;
        else counts.OTHER++;
      }
      distRows.push({
        title: (it.titleEs || it.title || '').slice(0, 32),
        type: isTv ? 'tv' : 'movie',
        tmdb,
        totalServers: j.servers.length,
        ...counts,
      });
    }
    const withLat = distRows.filter((r) => r.LAT > 0).length;
    const onlyEspOrSub = distRows.filter((r) => r.LAT === 0 && (r.ESP > 0 || r.SUB > 0)).length;
    const withEsp = distRows.filter((r) => r.ESP > 0).length;
    const withSub = distRows.filter((r) => r.SUB > 0).length;
    console.log('Resumen 10 títulos con stock:', {
      testedWithStock: distRows.length,
      withLAT: withLat,
      onlyESP_or_SUB: onlyEspOrSub,
      withESP: withEsp,
      withSUB: withSub,
      rows: distRows,
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
