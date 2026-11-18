async function test() {
  const queries = ['naruto', 'one piece', 'bleach', 'dragon ball'];
  for (const q of queries) {
    for (const p of [`/buscar?q=${q}`, `/animes?buscar=${q}`, `/search?q=${q}`, `/animes?q=${q}`]) {
      try {
        const res = await fetch(`https://latanime.org${p}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000)
        });
        console.log(`latanime path ${p} -> Status ${res.status}`);
        if (res.status === 200) {
          const html = await res.text();
          const links = [...html.matchAll(/href="([^"]*anime\/[^"]*)"/gi)].map(m => m[1]);
          console.log(`  Links on ${p}:`, links.slice(0, 3));
          break;
        }
      } catch (e) {
        console.log(`latanime path ${p} -> ERR ${e.message}`);
      }
    }
  }
}
test();
