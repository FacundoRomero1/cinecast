async function run() {
  const url = 'https://fuegocine.com/shows/avatar-la-leyenda-de-aang/01x01-aang/74';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  console.log('Ep status:', res.status, 'Len:', html.length);
  const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Iframes:', iframes);
  const langMatch = html.match(/lang_id=[^"]*"[^>]*>([^<]+)</i);
  console.log('Lang in show ep:', langMatch ? langMatch[1] : 'none');
}
run();
