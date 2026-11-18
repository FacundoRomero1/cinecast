async function inspectPage(name, url) {
  console.log(`\n================== ${name} ==================`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://latanime.org/'
      }
    });
    const html = await res.text();
    console.log(`Status: ${res.status}, Length: ${html.length}`);

    // Check for m3u8 direct links
    const m3u8Matches = [...html.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)].map(m => m[1]);
    console.log('Direct m3u8 matches:', m3u8Matches);

    // Check for packed scripts: eval(function(p,a,c,k,e,d)
    const packed = [...html.matchAll(/eval\(function\(p,a,c,k,e,[rd]\)[\s\S]*?\)\)/gi)].map(m => m[0]);
    console.log(`Packed scripts count: ${packed.length}`);
    for (let i = 0; i < packed.length; i++) {
      console.log(`Packed script #${i+1} preview:`, packed[i].slice(0, 150));
      // Unpack p,a,c,k,e,d
      try {
        const unpacker = new Function('return ' + packed[i].replace(/^eval\(/, '('));
        const unpacked = unpacker();
        console.log(`Unpacked #${i+1} length:`, unpacked.length);
        const subM3u8 = [...unpacked.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)].map(m => m[1]);
        console.log(`Unpacked #${i+1} m3u8s:`, subM3u8);
        const fileMatches = [...unpacked.matchAll(/file:\s*["']([^"']+)["']/gi)].map(m => m[1]);
        console.log(`Unpacked #${i+1} file:`, fileMatches);
        const sourcesMatches = [...unpacked.matchAll(/sources:\s*(\[[^\]]+\])/gi)].map(m => m[1]);
        console.log(`Unpacked #${i+1} sources:`, sourcesMatches);
      } catch (err) {
        console.log(`Error unpacking #${i+1}:`, err.message);
      }
    }

    // Check for scripts or json with sources
    const sources = [...html.matchAll(/sources\s*:\s*(\[[^\]]+\])/gi)].map(m => m[1]);
    console.log('Sources found:', sources);
    const files = [...html.matchAll(/file\s*:\s*["']([^"']+)["']/gi)].map(m => m[1]);
    console.log('Files found:', files);

  } catch (e) {
    console.log(`ERR: ${e.message}`);
  }
}

async function main() {
  await inspectPage('Filemoon', 'https://filemoon.sx/e/ltvgkty43b0e');
  await inspectPage('AbyssPlayer', 'https://player.abyssplayer.com/KxBGoCWcV');
  await inspectPage('Unlimplay', 'https://unlimplay.com/f/embed/movie/140');
}

main();
