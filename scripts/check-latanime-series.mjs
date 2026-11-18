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
  { tmdbId: 65930, title: 'My Hero Academia', slug: 'boku-no-hero-academia-latino' },
  { tmdbId: 120089, title: 'Spy x Family', slug: 'spy-x-family-latino' },
  { tmdbId: 113988, title: 'Tokyo Revengers', slug: 'tokyo-revengers-latino' },
  { tmdbId: 13916, title: 'Death Note', slug: 'death-note-latino' },
  { tmdbId: 30984, title: 'Bleach', slug: 'bleach-latino' },
  { tmdbId: 60572, title: 'Pokémon', slug: 'pokemon-latino' },
  { tmdbId: 46298, title: 'Hunter x Hunter', slug: 'hunter-x-hunter-latino' }
];

async function check() {
  const verified = [];
  for (const s of series) {
    const url = `https://latanime.org/ver/${s.slug}-episodio-1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
      console.log(s.title, `(${s.slug}):`, res.status);
      if (res.status === 200) {
        verified.push(s);
      }
    } catch (e) {
      console.log(s.title, 'ERR:', e.message);
    }
  }
  console.log(`Total verified series: ${verified.length}/15`);
}
check();
