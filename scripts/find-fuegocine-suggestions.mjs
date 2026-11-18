async function run() {
  const res = await fetch('https://fuegocine.com');
  const html = await res.text();
  const allOccurrences = [...html.matchAll(/showSuggestions/g)];
  console.log('Occurrences count:', allOccurrences.length);
  for (const m of allOccurrences) {
    const idx = m.index;
    console.log(html.slice(Math.max(0, idx - 50), Math.min(html.length, idx + 400)));
    console.log('---');
  }
}
run();
