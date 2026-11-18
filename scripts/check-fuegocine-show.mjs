async function run() {
  const detailUrl = 'https://fuegocine.com/shows/details/dragon-ball-super-beerus/36';
  const watchUrl = 'https://fuegocine.com/shows/watch/dragon-ball-super-beerus/36/1/1';

  console.log('Fetching detail...');
  const dRes = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('Detail status:', dRes.status);
  const dHtml = await dRes.text();
  const epLinks = [...dHtml.matchAll(/href="([^"]*shows\/watch\/[^"]*)"/gi)].map(m => m[1]);
  console.log('Episode watch links in detail:', epLinks.slice(0, 5));

  console.log('Fetching watch ep 1...');
  const wRes = await fetch(watchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('Watch status:', wRes.status);
  const wHtml = await wRes.text();
  const iframes = [...wHtml.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Iframes in show watch:', iframes);
  const langMatch = wHtml.match(/lang_id=[^"]*"[^>]*>([^<]+)</i);
  console.log('Lang in show watch:', langMatch ? langMatch[1] : 'none');
}
run();
