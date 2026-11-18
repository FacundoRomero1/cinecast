import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync('cinecast/src/data/fuegocineSlugs.json', 'utf-8'));

async function testAll() {
  console.log(`Testing 15 titles on FuegoCine...`);
  for (const item of items) {
    const watchUrl = `https://fuegocine.com/${item.mediaType === 'movie' ? 'movies' : 'shows'}/watch/${item.fuegoSlug}/${item.fuegoId}`;
    try {
      const res = await fetch(watchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      const html = await res.text();
      const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
      const hasAbyss = iframes.some(u => u.includes('abyssplayer'));
      const hasUnlim = iframes.some(u => u.includes('unlimplay'));
      const hasVidero = iframes.some(u => u.includes('videro'));
      const langMatch = html.match(/lang_id=[^"]*"[^>]*>([^<]+)</i) || html.match(/title="Latino"/i);
      const isLatino = !!langMatch;
      console.log(`${item.title}: Status=${res.status}, Iframes=${iframes.length}, Abyss=${hasAbyss}, Unlim=${hasUnlim}, Videro=${hasVidero}, Latino=${isLatino}, First=${iframes[0] || 'none'}`);
    } catch (e) {
      console.log(`${item.title}: ERR ${e.message}`);
    }
  }
}
testAll();
