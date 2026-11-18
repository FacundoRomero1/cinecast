import fs from 'node:fs';

const titles = [
  { id: 550, type: 'movie', name: 'Fight Club' },
  { id: 969681, type: 'movie', name: 'Spider-Man: Un nuevo día' },
  { id: 1058424, type: 'movie', name: 'Hope: El primer impacto' },
  { id: 155, type: 'movie', name: 'The Dark Knight (El caballero de la noche)' },
  { id: 27205, type: 'movie', name: 'Inception (El origen)' },
  { id: 1399, type: 'series', s: 1, e: 1, name: 'Game of Thrones' },
  { id: 66732, type: 'series', s: 1, e: 1, name: 'Stranger Things' },
  { id: 60059, type: 'series', s: 1, e: 1, name: 'Better Call Saul' },
  { id: 354912, type: 'movie', name: 'Coco' },
  { id: 150540, type: 'movie', name: 'Inside Out (IntensaMente)' },
];

async function checkUrl(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    const ms = Date.now() - start;
    const text = await res.text();
    const ok = res.status === 200 && !text.includes('404 Not Found') && !text.includes('File not found');
    const hasAds = text.includes('createlouisville.org') || text.includes('popunder');
    return { status: res.status, ok, ms, hasAds };
  } catch (err) {
    return { status: 0, ok: false, ms: Date.now() - start, hasAds: false, error: err.message };
  }
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
  const catalogWithTitleEs = catalog.filter(x => x.titleEs).length;

  console.log(`Conteo de títulos en catálogo con titleEs: ${catalogWithTitleEs} / ${catalog.length}\n`);

  const rows = [];
  for (const t of titles) {
    const urlSh = t.type === 'movie' 
      ? `https://vidsrc.sh/embed/movie/${t.id}`
      : `https://vidsrc.sh/embed/tv/${t.id}/${t.s}/${t.e}`;

    const urlTo = t.type === 'movie'
      ? `https://vidsrc.to/embed/movie/${t.id}`
      : `https://vidsrc.to/embed/tv/${t.id}/${t.s}/${t.e}`;

    const [sh, to] = await Promise.all([checkUrl(urlSh), checkUrl(urlTo)]);

    // Find title in catalog if present
    const catItem = catalog.find(c => Number(c.tmdbId) === t.id);
    const titleEs = catItem?.titleEs || t.name;

    rows.push({
      id: t.id,
      title: titleEs,
      shStatus: sh.status,
      shOk: sh.ok,
      shMs: sh.ms,
      toStatus: to.status,
      toOk: to.ok,
      toMs: to.ms,
      toAds: to.hasAds,
      // Idioma medido: embed upstream sin pistas HLS declaradas en HTML inicial
      audioLang: 'desconocido (embed multi)',
    });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
