async function run() {
  const res = await fetch('https://fuegocine.com/search_elastic?s=Avatar', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  console.log(html);
}
run();
