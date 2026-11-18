import { parseHlsAudioLangs, getAudioLangPriority, sortServersBySpeedAndPenalties } from '../src/server/core/resolve/index.js';

console.log('--- TEST PARSE HLS AUDIO LANGS ---');

const caseLatino = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Español (Latino)",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="es",URI="audio-es.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8`;

const caseCastellano = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Castellano",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="es-ES",URI="audio-es-es.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8`;

const caseEnglish = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="audio-en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8`;

const caseMulti = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Español Latino",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="spa",URI="audio-es.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="en",URI="audio-en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8`;

const caseNone = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000
video.m3u8`;

console.log('Case Latino:', parseHlsAudioLangs(caseLatino), '-> priority:', getAudioLangPriority(parseHlsAudioLangs(caseLatino)));
console.log('Case Castellano:', parseHlsAudioLangs(caseCastellano), '-> priority:', getAudioLangPriority(parseHlsAudioLangs(caseCastellano)));
console.log('Case English:', parseHlsAudioLangs(caseEnglish), '-> priority:', getAudioLangPriority(parseHlsAudioLangs(caseEnglish)));
console.log('Case Multi (Latino+EN):', parseHlsAudioLangs(caseMulti), '-> priority:', getAudioLangPriority(parseHlsAudioLangs(caseMulti)));
console.log('Case None (Desconocido):', parseHlsAudioLangs(caseNone), '-> priority:', getAudioLangPriority(parseHlsAudioLangs(caseNone)));

console.log('\n--- TEST RANKING ---');
const servers = [
  { id: 1, name: 'S1-EN', playable: 'hls', validated: true, speedMs: 50, audioLangs: ['en'] },
  { id: 2, name: 'S2-Desconocido', playable: 'hls', validated: true, speedMs: 80, audioLangs: ['desconocido'] },
  { id: 3, name: 'S3-Latino-Lento', playable: 'hls', validated: true, speedMs: 600, audioLangs: ['latino'] },
  { id: 4, name: 'S4-Latino-Rapido', playable: 'hls', validated: true, speedMs: 200, audioLangs: ['latino'] },
  { id: 5, name: 'S5-Castellano', playable: 'hls', validated: true, speedMs: 150, audioLangs: ['es'] },
  { id: 6, name: 'S6-Iframe', playable: 'iframe', popular: 10, picks: 5 },
];

const sorted = sortServersBySpeedAndPenalties(servers, 'vidlink.pro', 'movie:550');
console.log('Orden resultante:');
sorted.forEach((s, idx) => {
  console.log(`  ${idx + 1}. ${s.name} (playable=${s.playable}, audioLangs=${JSON.stringify(s.audioLangs)}, speedMs=${s.speedMs})`);
});
