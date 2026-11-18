async function test() {
  const queries = ['Spider', 'Avatar', 'Odisea', 'Batman', 'Dragon Ball'];
  for (const q of queries) {
    try {
      const res = await fetch(`https://fuegocine.com/search_elastic?s=${encodeURIComponent(q)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      console.log(`Query "${q}" -> Status: ${res.status}`);
      const text = await res.text();
      console.log(`Length: ${text.length}`);
      console.log(`Preview:`, text.slice(0, 500));
      console.log('-----------------------------------');
    } catch (e) {
      console.log(e.message);
    }
  }
}
test();
