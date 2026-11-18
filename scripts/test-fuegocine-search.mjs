async function test() {
  const queries = ['spider-man', 'odisea', 'avatar', 'dragon ball'];
  for (const q of queries) {
    // Try common search paths
    for (const path of [`/search?q=${q}`, `/search?s=${q}`, `/search?search_query=${q}`, `/movies?search=${q}`, `/search/${q}`]) {
      try {
        const res = await fetch(`https://fuegocine.com${path}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(4000)
        });
        console.log(`Path: ${path} -> Status: ${res.status}`);
        if (res.status === 200) {
          const html = await res.text();
          if (html.length > 5000 && !html.includes('404')) {
            console.log(`  Found content on ${path}! Length: ${html.length}`);
            const links = [...html.matchAll(/href="([^"]*(?:movies|shows)\/details\/[^"]*)"/gi)].map(m => m[1]);
            console.log(`  Detail links found:`, links.slice(0, 3));
            break;
          }
        }
      } catch (e) {
        console.log(`Path: ${path} -> ERR: ${e.message}`);
      }
    }
  }
}
test();
