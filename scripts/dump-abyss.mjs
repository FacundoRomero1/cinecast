async function dumpAbyss() {
  const res = await fetch('https://player.abyssplayer.com/KxBGoCWcV', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://fuegocine.com/'
    }
  });
  const html = await res.text();
  console.log('Full Abyss HTML:');
  console.log(html);
}
dumpAbyss();
