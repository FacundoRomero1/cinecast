const domains = [
  'https://animelatinohd.com',
  'https://animelatinohd.org',
  'https://animelatinohd.net',
  'https://animelatinohd.to',
  'https://animelatinohd.tv',
  'https://animelatinohd.io',
  'https://animelatinohd.xyz',
  'https://animelatinohd.me',
  'https://animelatino.com',
  'https://animelatino.org',
  'https://animelatino.net',
  'https://api.animelatinohd.com',
];

async function check() {
  for (const d of domains) {
    try {
      const res = await fetch(d + '/latinos', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      console.log(d, res.status, res.headers.get('cf-mitigated') ? 'CF-CHALLENGE' : 'OK');
    } catch (e) {
      console.log(d, 'ERR:', e.message);
    }
  }
}
check();
