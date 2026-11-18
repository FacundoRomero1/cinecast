import * as cheerio from 'cheerio';

const targets = [
  { name: 'FuegoCine', base: 'https://fuegocine.com' },
  { name: 'Latanime', base: 'https://latanime.org' },
  { name: 'PelisPlus', base: 'https://pelisplus.lat' },
];

async function checkDetails() {
  for (const t of targets) {
    try {
      const res = await fetch(t.base, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000)
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      
      let sampleLink = '';
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (
          !sampleLink &&
          (href.includes('/pelicula/') || href.includes('/serie/') || href.includes('/ver/') || href.includes('/anime/'))
        ) {
          sampleLink = href.startsWith('http') ? href : (t.base + href);
        }
      });

      console.log(`=== ${t.name} ===`);
      console.log(`Base: ${t.base}`);
      console.log(`Sample content link: ${sampleLink}`);

      if (sampleLink) {
        const subRes = await fetch(sampleLink, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(6000)
        });
        const subHtml = await subRes.text();
        const sub$ = cheerio.load(subHtml);
        const iframes = [];
        sub$('iframe').each((_, el) => {
          iframes.push(sub$(el).attr('src') || sub$(el).attr('data-src'));
        });
        const scripts = subHtml.includes('player') || subHtml.includes('video') || subHtml.includes('sources');
        console.log(`  Sub Status: ${subRes.status}`);
        console.log(`  CF-Mitigated: ${subRes.headers.get('cf-mitigated') || 'none'}`);
        console.log(`  Iframes found:`, iframes.slice(0, 3));
        console.log(`  Player scripts detected:`, scripts);
      }
    } catch (e) {
      console.log(`Error on ${t.name}:`, e.message);
    }
  }
}

checkDetails();
