async function run() {
  for (const slug of ['avatar-la-leyenda-de-aang/33', 'visionquest/24', '12-12-12/35']) {
    const url = `https://fuegocine.com/shows/details/${slug}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    console.log(`Show: ${slug} -> Status: ${res.status}`);
    const links = [...html.matchAll(/href="([^"]*(?:watch|episode|season|player)[^"]*)"/gi)].map(m => m[1]);
    console.log(`  Watch/Ep links:`, links.slice(0, 5));
    // also look for onclick or data attributes
    const onclicks = [...html.matchAll(/(?:onclick|data-url)="([^"]+)"/gi)].map(m => m[1]);
    console.log(`  Onclicks:`, onclicks.slice(0, 5));
  }
}
run();
