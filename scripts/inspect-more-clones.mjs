const candidates = [
  'https://pelisplus.lat',
  'https://cuevana3.ch',
  'https://cuevana.biz',
  'https://pelisplushd.nz',
  'https://pelisplus.to',
  'https://miradetodo.net',
];

async function test() {
  for (const c of candidates) {
    try {
      const res = await fetch(c, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      console.log(c, res.status, res.headers.get('cf-mitigated') || 'none');
    } catch (e) {
      console.log(c, 'ERR:', e.message);
    }
  }
}
test();
