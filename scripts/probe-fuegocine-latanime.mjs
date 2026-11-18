import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFuegoCineHtml } from '../src/server/core/extractors/fuegocine.ts';
import { parseLatanimeEpisodeHtml } from '../src/server/core/anime/latanime.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function probeFuegoCine() {
  const fuegoSlugsPath = path.resolve(__dirname, '../src/data/fuegocineSlugs.json');
  const items = JSON.parse(fs.readFileSync(fuegoSlugsPath, 'utf-8')).slice(0, 15);

  console.log(`\n======================================================`);
  console.log(` PROBE 1: FUEGOCINE (15 TÍTULOS PELÍCULAS/SERIES)`);
  console.log(`======================================================\n`);

  const results = [];
  let latinoCount = 0;
  let activeCount = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const isMovie = it.mediaType === 'movie';
    const watchUrl = isMovie
      ? `https://fuegocine.com/movies/watch/${it.fuegoSlug}/${it.fuegoId}`
      : `https://fuegocine.com/shows/watch/${it.fuegoSlug}/${it.fuegoId}/1/1`;

    const t0 = Date.now();
    let status = 0;
    let cfMitigated = 'none';
    let servers = [];
    let detectedLang = 'desconocido';

    try {
      const res = await fetch(watchUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
      cfMitigated = res.headers.get('cf-mitigated') || 'none';
      if (res.ok) {
        activeCount++;
        const html = await res.text();
        servers = parseFuegoCineHtml(html);
        if (servers.length > 0) {
          detectedLang = servers[0].audioLangs[0] || 'desconocido';
        }
      }
    } catch (e) {
      status = 'ERR';
    }
    const elapsed = Date.now() - t0;

    const isLatino = detectedLang === 'latino';
    if (isLatino) latinoCount++;

    const firstServer = servers[0] ? `${servers[0].name} (${servers[0].url.slice(0, 36)}...)` : 'Ninguno';

    results.push({
      index: i + 1,
      tmdbId: it.tmdbId,
      title: it.title,
      type: it.mediaType,
      status,
      cf: cfMitigated,
      elapsedMs: elapsed,
      detectedLang,
      isLatino: isLatino ? 'Sí' : 'No',
      firstServer,
    });
  }

  console.log('| # | TMDB ID | Título | Tipo | Status | CF | Latencia | Idioma Detect. | Latino Decl. | Primer Servidor Extraído |');
  console.log('|---|---------|--------|------|--------|----|----------|----------------|--------------|--------------------------|');
  for (const r of results) {
    console.log(`| ${r.index} | ${r.tmdbId} | ${r.title} | ${r.type} | ${r.status} | ${r.cf} | ${r.elapsedMs}ms | ${r.detectedLang} | ${r.isLatino} | ${r.firstServer} |`);
  }

  console.log('\n--- RESUMEN FUEGOCINE ---');
  console.log(`Total probados: ${items.length}`);
  console.log(`Cobertura exitosa (Status 200): ${activeCount}/${items.length} (${((activeCount/items.length)*100).toFixed(0)}%)`);
  console.log(`Títulos con Audio Latino Declarado: ${latinoCount}/${items.length} (${((latinoCount/items.length)*100).toFixed(0)}%)`);
  console.log(`Criterio de habilitación (>12/15): ${latinoCount > 12 ? 'CUMPLE (HABILITABLE)' : 'NO CUMPLE'}`);

  return { activeCount, latinoCount, total: items.length, results };
}

async function probeLatanime() {
  const latanimeSlugsPath = path.resolve(__dirname, '../src/data/latanimeSlugs.json');
  const items = JSON.parse(fs.readFileSync(latanimeSlugsPath, 'utf-8')).slice(0, 15);

  console.log(`\n======================================================`);
  console.log(` PROBE 2: LATANIME (15 TÍTULOS ANIME SERIES)`);
  console.log(`======================================================\n`);

  const results = [];
  let latinoCount = 0;
  let activeCount = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const epUrl = `https://latanime.org/ver/${it.slug}-episodio-1`;

    const t0 = Date.now();
    let status = 0;
    let cfMitigated = 'none';
    let servers = [];
    let detectedLang = 'desconocido';

    try {
      const res = await fetch(epUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
      cfMitigated = res.headers.get('cf-mitigated') || 'none';
      if (res.ok) {
        activeCount++;
        const html = await res.text();
        servers = parseLatanimeEpisodeHtml(html, it.slug);
        if (servers.length > 0) {
          detectedLang = servers[0].audioLangs[0] || 'desconocido';
        }
      }
    } catch (e) {
      status = 'ERR';
    }
    const elapsed = Date.now() - t0;

    const isLatino = detectedLang === 'latino';
    if (isLatino) latinoCount++;

    const firstServer = servers[0] ? `${servers[0].name} (${servers[0].url.slice(0, 36)}...)` : 'Ninguno';

    results.push({
      index: i + 1,
      tmdbId: it.tmdbId,
      title: it.title,
      slug: it.slug,
      status,
      cf: cfMitigated,
      elapsedMs: elapsed,
      detectedLang,
      isLatino: isLatino ? 'Sí' : 'No',
      firstServer,
    });
  }

  console.log('| # | TMDB ID | Título | Slug | Status | CF | Latencia | Idioma Detect. | Latino Decl. | Primer Servidor Extraído |');
  console.log('|---|---------|--------|------|--------|----|----------|----------------|--------------|--------------------------|');
  for (const r of results) {
    console.log(`| ${r.index} | ${r.tmdbId} | ${r.title} | ${r.slug} | ${r.status} | ${r.cf} | ${r.elapsedMs}ms | ${r.detectedLang} | ${r.isLatino} | ${r.firstServer} |`);
  }

  console.log('\n--- RESUMEN LATANIME ---');
  console.log(`Total probados: ${items.length}`);
  console.log(`Cobertura exitosa (Status 200): ${activeCount}/${items.length} (${((activeCount/items.length)*100).toFixed(0)}%)`);
  console.log(`Títulos con Audio Latino Declarado: ${latinoCount}/${items.length} (${((latinoCount/items.length)*100).toFixed(0)}%)`);
  console.log(`Criterio de habilitación (>12/15): ${latinoCount > 12 ? 'CUMPLE (HABILITABLE)' : 'NO CUMPLE'}`);

  return { activeCount, latinoCount, total: items.length, results };
}

async function main() {
  await probeFuegoCine();
  await probeLatanime();
}

main();
