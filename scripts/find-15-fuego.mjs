import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync('cinecast/public/data/catalog.json', 'utf-8'));

async function searchFuego(query) {
  try {
    const res = await fetch(`https://fuegocine.com/search_elastic?s=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    // Match movies: <a href="https://fuegocine.com/movies/details/{slug}/{id}"> ... <img src="{poster}"
    const movieMatches = [...html.matchAll(/<a\s+href="https:\/\/fuegocine\.com\/movies\/details\/([^"\/]+)\/(\d+)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"/gi)];
    for (const m of movieMatches) {
      results.push({ type: 'movie', slug: m[1], id: m[2], poster: m[3], title: m[4] });
    }
    const showMatches = [...html.matchAll(/<a\s+href="https:\/\/fuegocine\.com\/shows\/details\/([^"\/]+)\/(\d+)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"/gi)];
    for (const m of showMatches) {
      results.push({ type: 'show', slug: m[1], id: m[2], poster: m[3], title: m[4] });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function find15Fuego() {
  console.log('Searching 15 matches on FuegoCine...');
  const popular = catalog.slice(0, 300);
  const matched = [];

  for (const item of popular) {
    if (matched.length >= 15) break;
    const title = item.title;
    const tmdbId = item.tmdbId || parseInt((item.id || '').replace(/\D/g, ''));
    const posterPath = item.posterPath || item.poster_path || '';
    const posterBasename = posterPath ? posterPath.split('/').pop().replace(/\.[a-z]+$/, '') : '';

    const results = await searchFuego(title);
    if (results.length > 0) {
      // Find match by poster or title
      const found = results.find(r => {
        if (posterBasename && r.poster.includes(posterBasename)) return true;
        const normR = r.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const normT = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return normR === normT || normR.includes(normT) || normT.includes(normR);
      }) || results[0];

      if (found) {
        matched.push({
          tmdbId,
          title: item.title,
          originalTitle: item.originalTitle,
          year: item.year,
          mediaType: found.type === 'movie' ? 'movie' : 'series',
          fuegoSlug: found.slug,
          fuegoId: found.id,
          fuegoTitle: found.title,
          tmdbPoster: posterPath,
          fuegoPoster: found.poster,
          matchMethod: posterBasename && found.poster.includes(posterBasename) ? 'title_poster' : 'title_search'
        });
        console.log(`Matched [${matched.length}/15]: ${item.title} -> /${found.type}s/details/${found.slug}/${found.id}`);
      }
    }
    // tiny delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('Total matched:', matched.length);
  fs.writeFileSync('cinecast/src/data/fuegocineSlugs.json', JSON.stringify(matched, null, 2));
}

find15Fuego();
