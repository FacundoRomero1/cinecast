const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10000;

const TARGETS = [
  { label: 'película', isTV: false, id: 693134, s: 1, e: 1 },
  { label: 'serie', isTV: true, id: 1396, s: 1, e: 1 },
  { label: 'anime', isTV: true, id: 270603, s: 1, e: 1 },
];

const SERVERS = [
  {
    name: 'Vidsrc CC (Latino / ES)',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://vidsrc.cc/embed/tv/${id}/${s}-${e}?lang=es`
        : `https://vidsrc.cc/embed/movie/${id}?lang=es`,
  },
  {
    name: 'Api4all (Multi / ES)',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://api4all.net/embed/tv/${id}/${s}/${e}?lang=es`
        : `https://api4all.net/embed/movie/${id}?lang=es`,
  },
  {
    name: 'TukiPlay (HD)',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://tukiplay.com/embed/tv/${id}/${s}/${e}`
        : `https://tukiplay.com/embed/movie/${id}`,
  },
  {
    name: 'VidEasy (Multi)',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://player.videasy.net/tv/${id}/${s}/${e}`
        : `https://player.videasy.net/movie/${id}`,
  },
  {
    name: 'VidLink Pro',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV ? `https://vidlink.pro/tv/${id}/${s}/${e}` : `https://vidlink.pro/movie/${id}`,
  },
  {
    name: 'VidSrc ME',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
        : `https://vidsrc.me/embed/movie?tmdb=${id}`,
  },
  {
    name: '2Embed',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`
        : `https://www.2embed.cc/embed/${id}`,
  },
  {
    name: 'SmashyStream',
    buildUrl: ({ isTV, id, s, e }) =>
      isTV
        ? `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}`
        : `https://embed.smashystream.com/playere.php?tmdb=${id}`,
  },
];

const PHRASES = [
  'not found',
  'no encontrado',
  'domain',
  'for sale',
  'parked',
  'unavailable',
  'not available',
];

async function probeOne(server, target) {
  const url = server.buildUrl(target);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 45) : '(sin <title>)';
    const lower = text.toLowerCase();
    const matched = PHRASES.filter((p) => lower.includes(p));
    return {
      server: server.name,
      type: target.label,
      status: String(res.status),
      bytes: String(bytes),
      title,
      phrases: matched.length > 0 ? matched.join(', ') : 'ninguna',
    };
  } catch (err) {
    const code = err?.cause?.code || err?.name || err?.message || String(err);
    return {
      server: server.name,
      type: target.label,
      status: `ERR (${code})`,
      bytes: '0',
      title: '-',
      phrases: '-',
    };
  }
}

console.log(
  `${'servidor'.padEnd(25)} | ${'tipo'.padEnd(10)} | ${'status'.padEnd(20)} | ${'bytes'.padStart(8)} | ${'<title>'.padEnd(45)} | frases detectadas`
);
console.log('-'.repeat(145));

for (const srv of SERVERS) {
  for (const tgt of TARGETS) {
    const r = await probeOne(srv, tgt);
    console.log(
      `${r.server.padEnd(25)} | ${r.type.padEnd(10)} | ${r.status.padEnd(20)} | ${r.bytes.padStart(8)} | ${r.title.padEnd(45)} | ${r.phrases}`
    );
  }
}

