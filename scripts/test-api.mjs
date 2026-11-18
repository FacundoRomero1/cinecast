const paths = [
  '/',
  '/api',
  '/anime',
  '/latinos',
  '/api/anime',
  '/api/latinos',
  '/api/v1',
  '/v1',
  '/search',
  '/api/search',
];

async function check() {
  for (const p of paths) {
    try {
      const res = await fetch('https://api.animelatinohd.com' + p, {
        signal: AbortSignal.timeout(3000)
      });
      console.log(p, res.status, res.headers.get('content-type'));
    } catch (e) {
      console.log(p, 'ERR:', e.message);
    }
  }
}
check();
