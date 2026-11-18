async function run() {
  const res = await fetch('https://fuegocine.com');
  const html = await res.text();
  const forms = [...html.matchAll(/<form[^>]*>(.*?)<\/form>/gis)].map(m => m[0]);
  console.log('Forms found:', forms.length);
  for (const f of forms) {
    console.log(f);
  }
  const searchInputs = [...html.matchAll(/<input[^>]+(?:search|query|keyword|buscar)[^>]*>/gi)].map(m => m[0]);
  console.log('Search inputs:', searchInputs);
}
run();
