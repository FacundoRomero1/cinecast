async function run() {
  const res = await fetch('https://pelisplus.lat', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  console.log('PelisPlus.lat Length:', html.length);
  console.log('Content:', html.slice(0, 500));
}
run();
