import { generateServersForMedia, getAudioLangPriority, formatAudioLangWithSource } from '../src/services/embedService.js';
import providersData from '../src/data/providers.json' with { type: 'json' };

// Probar con "La Odisea" (TMDB 1368337)
const tmdbId = 1368337;
const servers = generateServersForMedia({
  tmdbId,
  type: 'movie',
  title: 'La Odisea',
});

console.log('='.repeat(92));
console.log(`ORDEN RESULTANTE PARA TMDB ${tmdbId} (La Odisea):`);
console.log('='.repeat(92));
console.log(
  'Posición'.padEnd(10) + '| ' +
  'Servidor'.padEnd(28) + '| ' +
  'Tipo'.padEnd(10) + '| ' +
  'Idioma con Fuente'.padEnd(25) + '| ' +
  'Prioridad'
);
console.log('-'.repeat(92));

servers.forEach((s, idx) => {
  const prov = providersData.find(p => p.name === s.name || p.id === s.providerId);
  const rank = getAudioLangPriority(s.audioLangs, prov?.languages, prov?.langHintUnreliable);
  console.log(
    `#${idx + 1}`.padEnd(10) + '| ' +
    s.name.padEnd(28) + '| ' +
    s.type.padEnd(10) + '| ' +
    (s.language || 'N/A').padEnd(25) + '| ' +
    `Grupo ${rank}`
  );
});

console.log('='.repeat(92));

// Verificación específica de FuegoCine vs VidSrc
const fuegoIdx = servers.findIndex(s => s.name.toLowerCase().includes('fuegocine'));
const vidsrcIdx = servers.findIndex(s => s.name.toLowerCase().includes('vidsrc'));

console.log(`\nComparación directa en TMDB ${tmdbId}:`);
console.log(`  • FuegoCine index: ${fuegoIdx} (Servidor: "${servers[fuegoIdx]?.name}", Idioma: "${servers[fuegoIdx]?.language}")`);
console.log(`  • VidSrc SH index: ${vidsrcIdx} (Servidor: "${servers[vidsrcIdx]?.name}", Idioma: "${servers[vidsrcIdx]?.language}")`);
if (fuegoIdx !== -1 && vidsrcIdx !== -1) {
  console.log(`  • Resultado: FuegoCine está ${fuegoIdx < vidsrcIdx ? 'ANTES' : 'DESPUÉS'} que VidSrc (${fuegoIdx < vidsrcIdx ? 'CORRECTO ✓' : 'INCORRECTO ✗'})`);
}
