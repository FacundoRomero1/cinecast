import fs from 'node:fs';
const cat = JSON.parse(fs.readFileSync('cinecast/public/data/catalog.json', 'utf-8'));

const targets = [1368337, 1377237, 1423191, 37854, 46260, 73223];
for (const tid of targets) {
  const it = cat.find(c => c.tmdbId === tid || c.id === 'tmdb-movie-' + tid || c.id === 'tmdb-anime-' + tid || c.id === 'tmdb-series-' + tid);
  if (it) {
    console.log(`Found ${tid}: id=${it.id}, title=${it.title}, type=${it.type}, category=${it.category}`);
  } else {
    console.log(`Not found in catalog: ${tid}`);
  }
}
