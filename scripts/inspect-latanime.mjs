async function run() {
  const url = 'https://latanime.org/ver/one-piece-latino-episodio-1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  console.log('Latanime Status:', res.status, 'CF:', res.headers.get('cf-mitigated') || 'none');
  const html = await res.text();
  console.log('Latanime Length:', html.length);
  const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Latanime Iframes:', iframes);
  const servers = [...html.matchAll(/data-player="([^"]+)"/gi)].map(m => m[1]);
  console.log('Data players:', servers);
  const opt = [...html.matchAll(/(?:var|let|const)\s+video\s*=\s*(\[[^\]]+\]);/gi)].map(m => m[1]);
  console.log('Video scripts:', opt);
  const allEmbeds = [...html.matchAll(/https?:\/\/(?:ok\.ru|filemoon|streamwish|uqload|mp4upload|vidhide|dood)[^\s"']+/gi)].map(m => m[0]);
  console.log('Known embed hosts:', allEmbeds.slice(0, 5));
}
run();
