import dns from 'node:dns';

const domains = [
  'api4all.net',
  'vidsrc.cc',
  'player.autoembed.cc',
  'multiembed.mov',
  'tukiplay.com',
  'player.videasy.net',
  'vidlink.pro',
  'image.tmdb.org',
  'api.themoviedb.org',
];

const resolver1111 = new dns.promises.Resolver();
resolver1111.setServers(['1.1.1.1']);

const resolver8888 = new dns.promises.Resolver();
resolver8888.setServers(['8.8.8.8']);

async function checkLookup(domain) {
  try {
    const res = await dns.promises.lookup(domain);
    return `OK (${res.address})`;
  } catch (err) {
    return `FALLA (${err.code || err.message})`;
  }
}

async function checkResolver(resolver, domain) {
  try {
    const ips = await resolver.resolve4(domain);
    return `OK (${ips[0] || ''})`;
  } catch (err) {
    return `FALLA (${err.code || err.message})`;
  }
}

console.log(
  `${'dominio'.padEnd(22)} | ${'sistema'.padEnd(26)} | ${'1.1.1.1'.padEnd(26)} | ${'8.8.8.8'.padEnd(26)}`
);
console.log('-'.repeat(109));

for (const d of domains) {
  const [sys, cf, gg] = await Promise.all([
    checkLookup(d),
    checkResolver(resolver1111, d),
    checkResolver(resolver8888, d),
  ]);
  console.log(`${d.padEnd(22)} | ${sys.padEnd(26)} | ${cf.padEnd(26)} | ${gg.padEnd(26)}`);
}
