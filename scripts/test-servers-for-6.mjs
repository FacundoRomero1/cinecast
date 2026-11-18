import { generateServersForMedia } from '../src/services/embedService.js';

const titles = [
  // 3 de fuegocine
  { tmdbId: 1368337, type: 'movie', name: 'La Odisea' },
  { tmdbId: 1377237, type: 'movie', name: 'Entrega al límite' },
  { tmdbId: 1423191, type: 'movie', name: 'Resident Evil: Noche cero' },
  // 3 de latanime
  { tmdbId: 37854, type: 'anime', name: 'One Piece' },
  { tmdbId: 46260, type: 'anime', name: 'Naruto' },
  { tmdbId: 73223, type: 'anime', name: 'Black Clover' },
];

async function run() {
  for (const t of titles) {
    console.log(`\n=== Título: ${t.name} (tmdbId=${t.tmdbId}, type=${t.type}) ===`);
    const servers = generateServersForMedia({
      tmdbId: t.tmdbId,
      type: t.type,
      season: 1,
      episode: 1,
    });
    console.log(`Total servers: ${servers.length}`);
    servers.forEach((s, idx) => {
      console.log(`  [#${idx + 1}] name="${s.name}", type="${s.type}", url="${s.url}"`);
    });
  }
}

run().catch(console.error);
