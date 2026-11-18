async function run() {
  const url = 'https://fuegocine.com/shows/avatar-la-leyenda-de-aang/seasons/temporada-1-libro-agua/72';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const allLinks = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis)].map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }));
  console.log(allLinks.filter(l => !l.href.includes('css') && !l.href.includes('png')));
}
run();
