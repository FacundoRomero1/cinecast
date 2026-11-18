async function run() {
  const url = 'https://latanime.org/ver/one-piece-latino-episodio-1';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const playerButtons = [...html.matchAll(/<[^>]+data-player="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gis)].map(m => ({
    tag: m[0],
    dataPlayer: m[1],
    decoded: Buffer.from(m[1], 'base64').toString('utf-8'),
    label: m[2].replace(/<[^>]+>/g, '').trim()
  }));
  console.log('Player buttons count:', playerButtons.length);
  for (const p of playerButtons) {
    console.log(p);
  }
}
run();
