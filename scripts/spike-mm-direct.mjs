#!/usr/bin/env node
/**
 * scripts/spike-mm-direct.mjs
 * Spike acotado: verificar si la URL `video` de api-encrypted.moviemaster.lat
 * devuelta por /servers es HLS (#EXTM3U) consumible directamente desde Node/hls.js.
 *
 * Pasos:
 *   0. Cosechar un `ui` fresco desde el iframe de Breaking Bad S01E01 (1396/1/1)
 *   1. GET /servers con el `ui` capturado desde Node fetch plano (confirmar 200 y guardar JSON)
 *   2. GET `video` del primer servidor LAT con Accept: *\/* y mismo UA
 *   3. Repetir sin &noiframe=1
 *   4. Repetir con Referer: https://api.moviemaster.lat/ y Origin: https://api.moviemaster.lat
 *   5. Si hay #EXTM3U, bajar variante, primeros segmentos y verificar #EXT-X-KEY (AES-128 / URI clave)
 *   6. (Si --ttl está activo) Medir TTL re-pidiendo el mismo `video` a los 5 y 15 minutos
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const EMBED_URL = 'https://api.moviemaster.lat/e/tv/1396/1/1?lang=LAT&autoplay=1';
const RUN_TTL = process.argv.includes('--ttl');

async function harvestServersUrl() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
  }
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  let serversUrl = null;
  page.on('request', (req) => {
    if (!serversUrl && req.url().includes('api.moviemaster.lat/servers')) {
      serversUrl = req.url();
    }
  });
  await page.setContent(`<iframe src="${EMBED_URL}" width="900" height="500"></iframe>`);
  for (let i = 0; i < 25 && !serversUrl; i++) {
    await page.waitForTimeout(300);
  }
  await browser.close();
  return serversUrl;
}

async function fetchSummary(url, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { headers, redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  return {
    url,
    finalUrl: res.url,
    status: res.status,
    ms: Date.now() - t0,
    contentType: res.headers.get('content-type') || '',
    contentLength: res.headers.get('content-length') || String(buf.length),
    byteLength: buf.length,
    acao: res.headers.get('access-control-allow-origin') || '',
    first200: text.slice(0, 200),
    isExtM3u: text.trimStart().startsWith('#EXTM3U'),
    text,
    buf,
  };
}

function resolveRel(baseUrl, rel) {
  try {
    return new URL(rel, baseUrl).toString();
  } catch {
    return rel;
  }
}

async function main() {
  console.log('=== SPIKE MOVIEMASTER DIRECT HLS (scripts/spike-mm-direct.mjs) ===\n');

  const serversUrl = await harvestServersUrl();
  if (!serversUrl) {
    console.error('[PASO 0] No se pudo capturar URL /servers con ui.');
    process.exit(1);
  }
  console.log(`[PASO 0] URL /servers cosechada: ${serversUrl}\n`);

  // PASO 1: GET /servers desde Node fetch plano
  const step1 = await fetchSummary(serversUrl, { 'User-Agent': UA, Accept: '*/*' });
  console.log('--- PASO 1: GET /servers (Node fetch plano) ---');
  console.log({
    status: step1.status,
    contentType: step1.contentType,
    contentLength: step1.contentLength,
    ms: step1.ms,
  });
  if (step1.status !== 200) {
    console.error('Paso 1 falló:', step1.first200);
    process.exit(1);
  }
  const json = JSON.parse(step1.text);
  const outJsonPath = path.join(process.cwd(), 'scratch', 'mm-servers-1396-1-1.json');
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`JSON guardado en: ${outJsonPath} (servidores=${json.servers?.length || 0})`);

  const latSrv = (json.servers || []).find((s) => String(s.lang || '').toUpperCase() === 'LAT') || json.servers?.[0];
  if (!latSrv?.video) {
    console.error('No hay servidor LAT con campo video en /servers.');
    process.exit(1);
  }
  console.log(`Primer servidor LAT: name="${latSrv.name}" lang="${latSrv.lang}" mode="${latSrv.mode}" type="${latSrv.type}"`);
  console.log(`video URL: ${latSrv.video}\n`);

  // PASO 2: GET video con Accept: */* y mismo UA
  const step2 = await fetchSummary(latSrv.video, { 'User-Agent': UA, Accept: '*/*' });
  console.log('--- PASO 2: GET video (con &noiframe=1, sin Referer/Origin) ---');
  console.log({
    status: step2.status,
    contentType: step2.contentType,
    contentLength: step2.contentLength,
    acao: step2.acao,
    isExtM3u: step2.isExtM3u,
    first200: step2.first200,
  });

  // PASO 3: Repetir sin &noiframe=1
  const urlNoParam = latSrv.video.replace(/&?noiframe=1/g, '');
  const step3 = await fetchSummary(urlNoParam, { 'User-Agent': UA, Accept: '*/*' });
  console.log('\n--- PASO 3: GET video (sin &noiframe=1) ---');
  console.log({
    status: step3.status,
    contentType: step3.contentType,
    contentLength: step3.contentLength,
    acao: step3.acao,
    isExtM3u: step3.isExtM3u,
    first200: step3.first200,
  });

  // PASO 4: Repetir con Referer y Origin de https://api.moviemaster.lat
  const mmHeaders = {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: 'https://api.moviemaster.lat/',
    Origin: 'https://api.moviemaster.lat',
  };
  const step4 = await fetchSummary(latSrv.video, mmHeaders);
  console.log('\n--- PASO 4: GET video (con Referer + Origin https://api.moviemaster.lat) ---');
  console.log({
    status: step4.status,
    contentType: step4.contentType,
    contentLength: step4.contentLength,
    acao: step4.acao,
    isExtM3u: step4.isExtM3u,
    first200: step4.first200,
  });

  // Elegir el mejor candidato #EXTM3U (o JSON que contenga m3u8)
  const best = [step2, step4, step3].find((s) => s.isExtM3u) || step4;
  const useHeaders = best === step4 ? mmHeaders : { 'User-Agent': UA, Accept: '*/*' };

  // PASO 5: Si hay #EXTM3U, bajar variante, primeros segmentos y verificar #EXT-X-KEY
  console.log('\n--- PASO 5: Inspección #EXTM3U / variante / segmentos / #EXT-X-KEY ---');
  if (best.isExtM3u) {
    const lines = best.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
    let mediaPlaylist = best;
    if (isMaster) {
      const variantRel = lines.find((l) => !l.startsWith('#'));
      const variantUrl = resolveRel(best.finalUrl, variantRel);
      console.log(`Master detectado. Bajando variante: ${variantUrl}`);
      mediaPlaylist = await fetchSummary(variantUrl, useHeaders);
      console.log({
        variantStatus: mediaPlaylist.status,
        variantContentType: mediaPlaylist.contentType,
        variantBytes: mediaPlaylist.byteLength,
        variantFirst200: mediaPlaylist.first200,
      });
    } else {
      console.log('Playlist directa (media playlist, no master).');
    }

    const mLines = mediaPlaylist.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const keyLine = mLines.find((l) => l.startsWith('#EXT-X-KEY'));
    console.log('EXT-X-KEY:', keyLine || 'NINGUNA (sin cifrado)');
    if (keyLine) {
      const uriMatch = keyLine.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const keyUrl = resolveRel(mediaPlaylist.finalUrl, uriMatch[1]);
        const keyNoRef = await fetchSummary(keyUrl, { 'User-Agent': UA, Accept: '*/*' });
        const keyWithRef = await fetchSummary(keyUrl, mmHeaders);
        console.log('Key URI sin Referer:', { status: keyNoRef.status, contentType: keyNoRef.contentType, bytes: keyNoRef.byteLength });
        console.log('Key URI con Referer:', { status: keyWithRef.status, contentType: keyWithRef.contentType, bytes: keyWithRef.byteLength });
      }
    }

    const segRels = mLines.filter((l) => !l.startsWith('#')).slice(0, 2);
    for (let i = 0; i < segRels.length; i++) {
      const segUrl = resolveRel(mediaPlaylist.finalUrl, segRels[i]);
      const segPlain = await fetchSummary(segUrl, { 'User-Agent': UA, Accept: '*/*' });
      const segRef = segPlain.status === 200 ? null : await fetchSummary(segUrl, mmHeaders);
      console.log(`Segmento #${i + 1}:`, {
        url: segUrl.slice(0, 120),
        plainStatus: segPlain.status,
        plainContentType: segPlain.contentType,
        plainBytes: segPlain.byteLength,
        ...(segRef ? { withRefStatus: segRef.status, withRefBytes: segRef.byteLength } : {}),
      });
    }
  } else {
    console.log('NO devolvió #EXTM3U. Diagnóstico de body:', {
      status: best.status,
      contentType: best.contentType,
      bytes: best.byteLength,
      first200: best.first200,
    });
  }

  // PASO 6: Medir TTL a los 5 y 15 minutos si --ttl
  if (RUN_TTL) {
    const checkTtl = async (label, delayMs) => {
      console.log(`\n[PASO 6] Esperando ${label} para medir TTL...`);
      await new Promise((r) => setTimeout(r, delayMs));
      const rVid = await fetchSummary(latSrv.video, useHeaders);
      const rSrv = await fetchSummary(serversUrl, { 'User-Agent': UA, Accept: '*/*' });
      console.log(`[PASO 6 - ${label}]`, {
        videoStatus: rVid.status,
        videoContentType: rVid.contentType,
        videoIsExtM3u: rVid.isExtM3u,
        serversUiStatus: rSrv.status,
      });
    };
    await checkTtl('5 min', 5 * 60 * 1000);
    await checkTtl('15 min (10 min adicionales)', 10 * 60 * 1000);
  } else {
    console.log('\n[PASO 6] Omitido en corrida rápida (usar --ttl para medir 5 min y 15 min).');
  }
}

main().catch((err) => {
  console.error('[spike-mm-direct] Error fatal:', err);
  process.exit(1);
});
