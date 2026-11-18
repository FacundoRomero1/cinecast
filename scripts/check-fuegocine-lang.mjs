async function run() {
  const detailUrl = 'https://fuegocine.com/movies/details/avatar/80';
  const watchUrl = 'https://fuegocine.com/movies/watch/avatar/80';
  
  const dRes = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const dHtml = await dRes.text();
  console.log('=== Detail Page ===');
  const langMatches = [...dHtml.matchAll(/(?:idioma|language|audio|español|latino|subtitulado|sub)[^\n\r<]*/gi)].map(m => m[0]);
  console.log('Lang matches in detail:', langMatches);

  const wRes = await fetch(watchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const wHtml = await wRes.text();
  console.log('=== Watch Page ===');
  const wLangMatches = [...wHtml.matchAll(/(?:idioma|language|audio|español|latino|subtitulado|sub)[^\n\r<]*/gi)].map(m => m[0]);
  console.log('Lang matches in watch:', wLangMatches);
  
  const iframes = [...wHtml.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  console.log('Iframes in watch:', iframes);
}
run();
