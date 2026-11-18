async function dumpUnlim() {
  const res = await fetch('https://unlimplay.com/f/embed/movie/140', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://fuegocine.com/'
    }
  });
  const html = await res.text();
  console.log('Unlimplay status:', res.status, 'len:', html.length);
  const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Unlimplay nested iframes:', iframes);
  const m3u8 = [...html.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)].map(m => m[1]);
  console.log('Unlimplay m3u8:', m3u8);
  const players = [...html.matchAll(/player|embed|sources|file/gi)].length;
  console.log('Player keywords:', players);
}
dumpUnlim();
