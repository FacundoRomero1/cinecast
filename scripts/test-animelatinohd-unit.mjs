import assert from 'node:assert';
import { parseEpisodeHtml, getSlugForAnime, loadSlugs } from '../src/server/core/anime/animelatinohd.ts';

console.log('Testing animelatinohd unit tests (filemoon primary + castellano es)...');

// 1. Slugs
const slugs = loadSlugs();
console.log(`Loaded ${slugs.length} slugs from JSON`);
assert(slugs.length >= 15, 'Debe haber al menos 15 slugs cargados');

const narutoSlug = getSlugForAnime('Naruto', 46260);
assert.strictEqual(narutoSlug, 'naruto', 'Slug de Naruto debe ser "naruto"');

const dbzSlug = getSlugForAnime('Dragon Ball Z', 12971);
assert.strictEqual(dbzSlug, 'dragon-ball-z', 'Slug de DBZ debe ser "dragon-ball-z"');

// 2. Parser HTML - Latino con Delta y Epsilon
const sampleHtmlLatino = `
<!DOCTYPE html>
<html>
<body>
  <div class="info">
    <span>Idioma: Latino</span>
    <span>Servidor: Delta</span>
  </div>
  <div class="players">
    <button data-code="byse_delta_123" class="btn">Delta | Byse</button>
    <button data-code="byse_epsilon_456" class="btn">Epsilon | Byse</button>
  </div>
</body>
</html>
`;

const resLatino = parseEpisodeHtml(sampleHtmlLatino);
console.log('Latino result:', resLatino);
assert(resLatino.length >= 2, 'Debe haber al menos 2 servidores (Delta y Epsilon)');
const deltaSrv = resLatino.find(s => s.name === 'AnimeLatinoHD (Delta)');
assert(deltaSrv, 'Debe existir AnimeLatinoHD (Delta)');
assert.strictEqual(deltaSrv.url, 'https://filemoon.sx/e/byse_delta_123');
assert.strictEqual(deltaSrv.language, 'latino');
assert.deepStrictEqual(deltaSrv.audioLangs, ['latino']);

const epsilonSrv = resLatino.find(s => s.name === 'AnimeLatinoHD (Epsilon)');
assert(epsilonSrv, 'Debe existir AnimeLatinoHD (Epsilon)');
assert.strictEqual(epsilonSrv.url, 'https://filemoon.sx/e/byse_epsilon_456');
assert.strictEqual(epsilonSrv.language, 'latino');
assert.deepStrictEqual(epsilonSrv.audioLangs, ['latino']);

// 3. Parser HTML - Castellano
const sampleHtmlEs = `
<div class="lang">Idioma: Castellano</div>
<div class="player"><a data-code="code_cast_1">Delta | Byse</a></div>
`;
const resEs = parseEpisodeHtml(sampleHtmlEs);
console.log('Castellano result:', resEs);
const castSrv = resEs.find(s => s.name === 'AnimeLatinoHD (Delta)');
assert(castSrv, 'Debe existir AnimeLatinoHD (Delta)');
assert.strictEqual(castSrv.language, 'es', 'Castellano debe mapearse a es (no sub)');
assert.deepStrictEqual(castSrv.audioLangs, ['es']);

// 4. Parser HTML - Subtitulado
const sampleHtmlSub = `
<div class="lang">Idioma: Subtitulado</div>
<div class="player"><a data-code="code_sub_2">Epsilon | Byse</a></div>
`;
const resSub = parseEpisodeHtml(sampleHtmlSub);
console.log('Subtitulado result:', resSub);
const subSrv = resSub.find(s => s.name === 'AnimeLatinoHD (Epsilon)');
assert(subSrv, 'Debe existir AnimeLatinoHD (Epsilon)');
assert.strictEqual(subSrv.language, 'sub');
assert.deepStrictEqual(subSrv.audioLangs, ['sub']);

console.log('All animelatinohd unit tests passed successfully!');
