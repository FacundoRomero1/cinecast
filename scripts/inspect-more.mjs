async function test() {
  const list = ['https://cuevana.pro', 'https://cuevana3.me', 'https://latanime.org', 'https://animeflv.net'];
  for (const u of list) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      const text = await res.text();
      console.log(u, res.status, res.headers.get('cf-mitigated') || 'none', 'Len:', text.length);
    } catch (e) {
      console.log(u, 'ERR:', e.message);
    }
  }
}
test();
