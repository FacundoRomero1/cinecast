async function dump(name, url, referer) {
  console.log(`\n================== ${name} ==================`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': referer || 'https://latanime.org/'
    }
  });
  const html = await res.text();
  console.log('HTML preview:');
  console.log(html.slice(0, 1500));
}

async function main() {
  await dump('Filemoon', 'https://filemoon.sx/e/ltvgkty43b0e', 'https://latanime.org/');
  await dump('AbyssPlayer', 'https://player.abyssplayer.com/KxBGoCWcV', 'https://fuegocine.com/');
}
main();
