const series = [
  { tmdbId: 46260, title: 'Naruto', slug: 'naruto-latino' },
  { tmdbId: 31910, title: 'Naruto Shippuden', slug: 'naruto-shippuden-latino' },
  { tmdbId: 37854, title: 'One Piece', slug: 'one-piece-latino' },
  { tmdbId: 73223, title: 'Black Clover', slug: 'black-clover-latino' },
  { tmdbId: 62715, title: 'Dragon Ball Super', slug: 'dragon-ball-super-latino' },
  { tmdbId: 95479, title: 'Jujutsu Kaisen', slug: 'jujutsu-kaisen-latino' },
  { tmdbId: 85937, title: 'Demon Slayer: Kimetsu no Yaiba', slug: 'kimetsu-no-yaiba-latino' },
  { tmdbId: 1429, title: 'Attack on Titan', slug: 'shingeki-no-kyojin-latino' },
  { tmdbId: 114410, title: 'Chainsaw Man', slug: 'chainsaw-man-latino' },
  { tmdbId: 120089, title: 'Spy x Family', slug: 'spy-x-family-latino' },
  { tmdbId: 113988, title: 'Tokyo Revengers', slug: 'tokyo-revengers-latino' },
  { tmdbId: 13916, title: 'Death Note', slug: 'death-note-latino' },
  { tmdbId: 60572, title: 'Pokémon', slug: 'pokemon-latino' },
  { tmdbId: 46261, title: 'Fairy Tail', slug: 'fairy-tail-latino' },
  { tmdbId: 30984, title: 'Bleach: Sennen Kessen-hen', slug: 'bleach-sennen-kessen-hen-s3-latino' }
];

async function testAll() {
  for (const s of series) {
    const url = `https://latanime.org/ver/${s.slug}-episodio-1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const dataPlayers = [...html.matchAll(/data-player="([^"]+)"/gi)].map(m => Buffer.from(m[1], 'base64').toString('utf-8'));
    const hasFilemoon = dataPlayers.some(u => u.includes('filemoon'));
    console.log(`${s.title}: Status=${res.status}, Players=${dataPlayers.length}, Filemoon=${hasFilemoon ? 'YES' : 'NO'}, First=${dataPlayers[0]}`);
  }
}
testAll();
