async function run() {
  const res = await fetch('https://latanime.org/buscar?q=naruto', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  console.log('HTML length:', html.length);
  const items = [...html.matchAll(/<div[^>]*class="[^"]*col-[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>/gis)].map(m => m[0]);
  console.log('Items found:', items.length);
  for (const it of items.slice(0, 3)) {
    console.log(it);
    console.log('---');
  }
}
run();
