async function test() {
  const list = ['dragon-ball-z-latino', 'boruto-naruto-next-generations-latino', 'bleach-sennen-kessen-hen-s3-latino', 'fairy-tail-latino', 'dr-stone-latino'];
  for (const s of list) {
    const res = await fetch(`https://latanime.org/ver/${s}-episodio-1`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log(s, res.status);
  }
}
test();
