async function run() {
  const res = await fetch('https://cuevana3.ch', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  console.log('Cuevana3.ch Length:', html.length);
  const links = [...html.matchAll(/href="([^"]*(?:pelicula|serie)[^"]*)"/gi)].map(m => m[1]);
  console.log('Cuevana3.ch sample links:', links.slice(0, 5));
  if (links.length > 0) {
    const subRes = await fetch(links[0], { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const subHtml = await subRes.text();
    console.log('Detail status:', subRes.status, 'CF:', subRes.headers.get('cf-mitigated') || 'none');
    const iframes = [...subHtml.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
    console.log('Iframes:', iframes.slice(0, 5));
    const players = [...subHtml.matchAll(/data-(?:video|player|src)="([^"]+)"/gi)].map(m => m[1]);
    console.log('Data players:', players.slice(0, 5));
  }
}
run();
