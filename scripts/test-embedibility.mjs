const sampleUrls = {
  unlimplay: 'https://unlimplay.com/f/embed/movie/140',
  abyssplayer: 'https://player.abyssplayer.com/KxBGoCWcV',
  filemoon: 'https://filemoon.sx/e/ltvgkty43b0e',
  uqload: 'https://uqload.cx/embed-ye8kvr9dkrwk.html',
  verystream: 'https://verystream.com/e/baNeNnn9a1w',
  fembed: 'https://www.fembed.com/v/lnjjnfngpn14wre',
};

async function checkHeaders(name, url) {
  console.log(`=== Testing ${name}: ${url} ===`);
  const result = { name, url, head: {}, get: {} };

  // 1. HEAD
  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://fuegocine.com/'
      },
      signal: AbortSignal.timeout(5000)
    });
    result.head = {
      status: headRes.status,
      xfo: headRes.headers.get('x-frame-options') || 'none',
      csp: headRes.headers.get('content-security-policy') || 'none',
    };
  } catch (e) {
    result.head = { error: e.message };
  }

  // 2. GET
  try {
    const getRes = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://latanime.org/'
      },
      signal: AbortSignal.timeout(6000)
    });
    const csp = getRes.headers.get('content-security-policy') || 'none';
    let frameAncestors = 'none';
    if (csp !== 'none') {
      const match = csp.match(/frame-ancestors\s+([^;]+)/i);
      if (match) frameAncestors = match[1];
    }
    const html = await getRes.text();
    result.get = {
      status: getRes.status,
      xfo: getRes.headers.get('x-frame-options') || 'none',
      csp,
      frameAncestors,
      bodyLen: html.length,
      hasVideoOrPlayer: /player|m3u8|mp4|video|sources|setup/i.test(html),
    };
  } catch (e) {
    result.get = { error: e.message };
  }

  return result;
}

async function run() {
  const summary = [];
  for (const [name, url] of Object.entries(sampleUrls)) {
    const r = await checkHeaders(name, url);
    summary.push(r);
  }
  console.log('\n--- MATRIZ COMPLETA DE RESULTADOS ---');
  console.log(JSON.stringify(summary, null, 2));
}

run();
