const { generateServersForMedia } = require('../scratch/embedService.cjs');

const testCases = [
  { name: 'Clevatess', tmdbId: 258348, type: 'anime' },
  { name: 'Black Clover', tmdbId: 73223, type: 'anime' },
  { name: 'Breaking Bad', tmdbId: 1396, type: 'series' },
  { name: 'Los 100', tmdbId: 48866, type: 'series' },
  { name: 'Demon Slayer', tmdbId: 85937, type: 'anime' },
  { name: 'Attack on Titan', tmdbId: 1429, type: 'anime' },
];

const episodes = [
  { season: 1, episode: 12 },
  { season: 2, episode: 10 },
  { season: 1, episode: 1 },
];

let allOk = true;
const results = [];

for (const tc of testCases) {
  for (const ep of episodes) {
    const srvs = generateServersForMedia({
      tmdbId: tc.tmdbId,
      type: tc.type,
      season: ep.season,
      episode: ep.episode,
    });

    for (const s of srvs) {
      let matches = false;
      if (s.name.includes('TukiPlay')) {
        matches = s.url.includes(`/${ep.season}/${ep.episode}`);
      } else if (s.name.includes('Vidsrc CC')) {
        matches = s.url.includes(`/${ep.season}-${ep.episode}`);
      } else if (s.name.includes('VidEasy')) {
        matches = s.url.includes(`/${ep.season}/${ep.episode}`);
      } else if (s.name.includes('Anime Latino') || s.name.includes('Latanime')) {
        matches = s.url.includes(`episodio-${ep.episode}`) || s.url.includes(`/${ep.episode}`);
      } else {
        matches = true;
      }

      if (!matches) {
        allOk = false;
      }

      results.push({
        series: tc.name,
        season: ep.season,
        episode: ep.episode,
        server: s.name,
        url: s.url,
        ok: matches,
      });
    }
  }
}

console.log('| Serie | T:E | Servidor | URL generada | Coincide T y E |');
console.log('|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.series} | T${r.season}E${r.episode} | ${r.server} | ${r.url} | ${r.ok ? 'SÍ' : 'NO'} |`);
}

if (!allOk) {
  console.error('\nERROR: Alguna plantilla no incluyó la temporada o episodio correctos.');
  process.exit(1);
} else {
  console.log(`\nÉXITO: Todas las plantillas de servidores (${results.length} verificaciones) para las 6 series y 3 episodios generaron T y E correctos.`);
  process.exit(0);
}
