async function run() {
  const url = 'https://fuegocine.com/movies/watch/la-odisea/227';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  console.log('Watch Status:', res.status, 'CF:', res.headers.get('cf-mitigated') || 'none');
  const html = await res.text();
  console.log('Watch HTML Length:', html.length);
  const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Watch Iframes:', iframes);
  const sources = [...html.matchAll(/<source[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Watch Sources:', sources);
  const scriptMatches = [...html.matchAll(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi)].map(m => m[1]);
  console.log('Direct media links in scripts:', scriptMatches);
  const playerInits = [...html.matchAll(/(?:file|sources|player|videoUrl|streamUrl)\s*:\s*["']([^"']+)["']/gi)].map(m => m[0]);
  console.log('Player inits:', playerInits.slice(0, 10));
}
run();
