async function run() {
  const detailUrl = 'https://fuegocine.com/movies/details/avatar/80';
  const res = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const idx = html.indexOf('Latino">Latino');
  console.log('Surrounding HTML:');
  console.log(html.slice(idx - 200, idx + 200));
}
run();
