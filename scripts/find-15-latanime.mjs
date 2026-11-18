import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync('cinecast/public/data/catalog.json', 'utf-8'));
const animes = catalog.filter(c => c.type === 'anime' || (c.genres && c.genres.includes('Animación') && c.origin_country && c.origin_country.includes('JP')) || (c.category === 'anime'));

async function searchLatanime(title) {
  try {
    const clean = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
    const res = await fetch(`https://latanime.org/buscar?q=${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    // <a href="https://latanime.org/anime/{slug}"> ... <img src="{poster}" ... <h3>{title}</h3> ... <span>Latino</span>
    const matches = [...html.matchAll(/<a\s+href="https:\/\/latanime\.org\/anime\/([^"]+)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span[^>]*class="opacity-75"[^>]*>([^<]+)<\/span>/gi)];
    for (const m of matches) {
      results.push({
        slug: m[1],
        poster: m[2],
        title: m[3].replace(/<[^>]+>/g, '').trim(),
        language: m[4].trim()
      });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function find15Latanime() {
  console.log('Searching 15 matches on Latanime...');
  const matched = [];

  for (const item of animes) {
    if (matched.length >= 15) break;
    const title = item.title;
    const tmdbId = item.tmdbId || parseInt((item.id || '').replace(/\D/g, ''));
    const posterPath = item.posterPath || item.poster_path || '';

    const results = await searchLatanime(title);
    if (results.length > 0) {
      // Find one with Latino if possible
      const latinoMatch = results.find(r => r.language.toLowerCase().includes('latino') || r.slug.includes('latino')) || results[0];
      if (latinoMatch) {
        matched.push({
          tmdbId,
          title: item.title,
          originalTitle: item.originalTitle,
          year: item.year,
          latanimeSlug: latinoMatch.slug,
          latanimeTitle: latinoMatch.title,
          latanimeLanguage: latinoMatch.language,
          tmdbPoster: posterPath,
          latanimePoster: latinoMatch.poster,
          matchMethod: 'title_search_poster'
        });
        console.log(`Matched [${matched.length}/15]: ${item.title} -> /anime/${latinoMatch.slug} [${latinoMatch.language}]`);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('Total matched for Latanime:', matched.length);
  fs.writeFileSync('cinecast/src/data/latanimeSlugs.json', JSON.stringify(matched, null, 2));
}

find15Latanime();
