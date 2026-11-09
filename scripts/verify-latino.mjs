import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('====================================================');
  console.log('🔍 VERIFICADOR DE AUDIO EN ESPAÑOL (.m3u8 Playwright)');
  console.log('====================================================\n');

  let playwright;
  try {
    playwright = await import('playwright');
  } catch (err) {
    console.error('❌ Playwright no está instalado o falló al cargar:', err.message);
    process.exit(1);
  }

  const catalogPaths = [
    path.join(__dirname, '..', 'public', 'data', 'catalog.json'),
    path.join(__dirname, '..', 'dist', 'data', 'catalog.json'),
  ];

  let catalog = [];
  for (const cp of catalogPaths) {
    if (fs.existsSync(cp)) {
      try {
        catalog = JSON.parse(fs.readFileSync(cp, 'utf8'));
        break;
      } catch (_) {}
    }
  }

  if (!catalog.length) {
    console.error('❌ No se encontró catalog.json');
    process.exit(1);
  }

  // Tomar los 200 títulos más populares / mejor valorados
  const top200 = [...catalog]
    .filter((m) => m.tmdbId && m.tmdbId > 0)
    .sort((a, b) => (b.voteAverage || 0) * (b.year || 2020) - (a.voteAverage || 0) * (a.year || 2020))
    .slice(0, 200);

  console.log(`📊 Total títulos seleccionados para verificación: ${top200.length}\n`);

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const latinoMap = {};
  const providerStats = {
    'TukiPlay (HD)': { tested: 0, spanish: 0 },
    'VidLink Pro (Multi / Sub ES)': { tested: 0, spanish: 0 },
    'VidEasy (Multi)': { tested: 0, spanish: 0 },
    'AutoEmbed (HD)': { tested: 0, spanish: 0 },
  };

  const providers = [
    {
      name: 'TukiPlay (HD)',
      getUrl: (id, isTV) => (isTV ? `https://tukiplay.com/embed/tv/${id}/1/1` : `https://tukiplay.com/embed/movie/${id}`),
    },
    {
      name: 'VidLink Pro (Multi / Sub ES)',
      getUrl: (id, isTV) => (isTV ? `https://vidlink.pro/tv/${id}/1/1` : `https://vidlink.pro/movie/${id}`),
    },
    {
      name: 'VidEasy (Multi)',
      getUrl: (id, isTV) => (isTV ? `https://player.videasy.net/tv/${id}/1/1` : `https://player.videasy.net/movie/${id}`),
    },
    {
      name: 'AutoEmbed (HD)',
      getUrl: (id, isTV) => (isTV ? `https://player.autoembed.co/embed/tv/${id}/1/1` : `https://player.autoembed.co/embed/movie/${id}`),
    },
  ];

  // Verificamos por lotes de títulos (los primeros 25 en profundidad para el mapa inicial)
  const batch = top200.slice(0, 25);

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const isTV = item.category === 'series' || item.category === 'anime' || item.type === 'series';
    console.log(`[${i + 1}/${batch.length}] Analizando: "${item.title}" (TMDB: ${item.tmdbId})...`);

    let bestProviderForTitle = null;

    for (const prov of providers) {
      providerStats[prov.name].tested += 1;
      const targetUrl = prov.getUrl(item.tmdbId, isTV);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      let detectedSpanish = false;
      let manifestChecked = false;

      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('.m3u8') || url.includes('master') || url.includes('playlist')) {
          try {
            const body = await response.text();
            if (body && body.includes('#EXTM3U')) {
              manifestChecked = true;
              const lines = body.split('\n');
              for (const line of lines) {
                if (line.includes('#EXT-X-MEDIA:TYPE=AUDIO')) {
                  const upper = line.toUpperCase();
                  if (upper.includes('LANGUAGE="ES"') || upper.includes('NAME="SPANISH"') || upper.includes('NAME="ESPAÑOL"') || upper.includes('NAME="LATINO"')) {
                    detectedSpanish = true;
                    break;
                  }
                }
              }
            }
          } catch (_) {}
        }
      });

      try {
        await page.goto(targetUrl, { timeout: 12000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      } catch (_) {
        // Timeout de carga habitual en iframes de streaming
      }

      await context.close();

      if (detectedSpanish) {
        providerStats[prov.name].spanish += 1;
        bestProviderForTitle = prov.name;
        console.log(`   ✅ Audio en Español detectado en ${prov.name}`);
        break; // Encontramos proveedor apto, no hace falta seguir probando para este título
      } else if (manifestChecked) {
        console.log(`   ℹ️ ${prov.name}: Pista única o idioma indeterminado`);
      }
    }

    if (bestProviderForTitle) {
      latinoMap[String(item.tmdbId)] = {
        provider: bestProviderForTitle,
        verified: true,
        title: item.title,
        verifiedAt: new Date().toISOString(),
      };
    } else {
      // Si el título es de producción nativa en español (originalLanguage === 'es'), TukiPlay es el apto directo
      if (item.originalLanguage === 'es') {
        latinoMap[String(item.tmdbId)] = {
          provider: 'TukiPlay (HD)',
          verified: true,
          nativeSpanish: true,
          title: item.title,
          verifiedAt: new Date().toISOString(),
        };
      }
    }
  }

  await browser.close();

  // Asegurar carpetas de salida
  const outDir = path.join(__dirname, '..', 'data');
  const srcDir = path.join(__dirname, '..', 'src', 'data');
  const pubDir = path.join(__dirname, '..', 'public', 'data');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  try { fs.mkdirSync(srcDir, { recursive: true }); } catch (_) {}
  try { fs.mkdirSync(pubDir, { recursive: true }); } catch (_) {}

  const outPath1 = path.join(outDir, 'latino-map.json');
  const outPath2 = path.join(srcDir, 'latino-map.json');
  const outPath3 = path.join(pubDir, 'latino-map.json');

  const jsonContent = JSON.stringify(latinoMap, null, 2);
  fs.writeFileSync(outPath1, jsonContent, 'utf8');
  fs.writeFileSync(outPath2, jsonContent, 'utf8');
  fs.writeFileSync(outPath3, jsonContent, 'utf8');

  console.log('\n====================================================');
  console.log('📊 RESULTADOS Y RANKING DE PROVEEDORES (Audio ES):');
  console.log('====================================================');
  Object.entries(providerStats).forEach(([name, stats]) => {
    const pct = stats.tested > 0 ? Math.round((stats.spanish / stats.tested) * 100) : 0;
    console.log(`- ${name}: ${stats.spanish}/${stats.tested} aciertos (${pct}%)`);
  });
  console.log(`\n💾 Guardado en data/latino-map.json con ${Object.keys(latinoMap).length} títulos mapeados.`);
}

main().catch(console.error);
