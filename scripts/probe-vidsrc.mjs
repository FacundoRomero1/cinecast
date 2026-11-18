import http from 'node:http';
import https from 'node:https';

const titles = [
  { id: 550, type: 'movie', name: 'Fight Club' },
  { id: 969681, type: 'movie', name: 'Spider-Man: Un nuevo día' },
  { id: 1058424, type: 'movie', name: 'Hope' },
  { id: 155, type: 'movie', name: 'The Dark Knight' },
  { id: 27205, type: 'movie', name: 'Inception' },
  { id: 1399, type: 'series', s: 1, e: 1, name: 'Game of Thrones' },
  { id: 66732, type: 'series', s: 1, e: 1, name: 'Stranger Things' },
  { id: 60059, type: 'series', s: 1, e: 1, name: 'Better Call Saul' },
  { id: 354912, type: 'movie', name: 'Coco' },
  { id: 150540, type: 'movie', name: 'Inside Out' },
];

async function checkUrl(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    const ms = Date.now() - start;
    const text = await res.text();
    
    // Check if it has actual video player sources / sub-iframes / data
    const hasIframe = text.includes('<iframe');
    const hasMaliciousAds = text.includes('createlouisville.org') || text.includes('popunder');
    const hasDirectPlayer = text.includes('player_iframe') || text.includes('vidsrc') || text.includes('sources');
    
    // Extract iframe src if present
    const iframeSrc = (text.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1] || null;

    let subFrameOk = null;
    if (iframeSrc) {
      try {
        const fullSubUrl = iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc.startsWith('/') ? new URL(url).origin + iframeSrc : iframeSrc;
        const subRes = await fetch(fullSubUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': url,
          },
          signal: AbortSignal.timeout(5000),
        });
        subFrameOk = subRes.status;
      } catch (e) {
        subFrameOk = 'err: ' + e.message;
      }
    }

    return {
      status: res.status,
      ms,
      size: text.length,
      hasIframe,
      iframeSrc,
      subFrameOk,
      hasMaliciousAds,
      hasDirectPlayer,
    };
  } catch (err) {
    return {
      status: 0,
      ms: Date.now() - start,
      size: 0,
      error: err.message,
    };
  }
}

async function main() {
  console.log('--- Comparación detallada: vidsrc.sh vs vidsrc.to en 10 títulos ---\n');

  let shSuccess = 0;
  let toSuccess = 0;

  for (const t of titles) {
    const urlSh = t.type === 'movie' 
      ? `https://vidsrc.sh/embed/movie/${t.id}`
      : `https://vidsrc.sh/embed/tv/${t.id}/${t.s}/${t.e}`;

    const urlTo = t.type === 'movie'
      ? `https://vidsrc.to/embed/movie/${t.id}`
      : `https://vidsrc.to/embed/tv/${t.id}/${t.s}/${t.e}`;

    const [sh, to] = await Promise.all([checkUrl(urlSh), checkUrl(urlTo)]);

    const shWorking = sh.status === 200 && (sh.subFrameOk === 200 || !sh.iframeSrc);
    const toWorking = to.status === 200 && (to.subFrameOk === 200 || !to.iframeSrc);

    if (shWorking) shSuccess++;
    if (toWorking) toSuccess++;

    console.log(`[${t.id}] ${t.name}`);
    console.log(`  SH: status=${sh.status} ms=${sh.ms} iframe=${sh.iframeSrc} subStatus=${sh.subFrameOk} ads=${sh.hasMaliciousAds}`);
    console.log(`  TO: status=${to.status} ms=${to.ms} iframe=${to.iframeSrc} subStatus=${to.subFrameOk} ads=${to.hasMaliciousAds}`);
  }

  console.log('\n======================================');
  console.log(`Total Funcionales:`);
  console.log(`vidsrc.sh: ${shSuccess}/10`);
  console.log(`vidsrc.to: ${toSuccess}/10`);
  console.log('======================================');
}

main().catch(console.error);
