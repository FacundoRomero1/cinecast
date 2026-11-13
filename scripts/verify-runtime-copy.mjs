import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let appPath = path.join(rootDir, 'src', 'App.tsx');
if (!fs.existsSync(appPath)) {
  appPath = path.join(rootDir, 'legacy', 'src', 'App.tsx');
}
const runtimePath = path.join(rootDir, 'src', 'app', 'AppRuntime.tsx');

const appLines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);
const runtimeText = fs.readFileSync(runtimePath, 'utf8');

function sliceLines(lines, start1Based, end1Based) {
  return lines.slice(start1Based - 1, end1Based).join('\n');
}

// 1. Extraer case '...' de handleRemoteCommandReceived en App.tsx (L385-838) y en AppRuntime.tsx
const appCmdBlock = sliceLines(appLines, 385, 838);

const caseRegex = /\bcase\s+'([^']+)'\s*:/g;

const appCases = Array.from(appCmdBlock.matchAll(caseRegex), (m) => m[1]);
const runtimeCases = Array.from(runtimeText.matchAll(caseRegex), (m) => m[1]);

const appCaseSet = new Set(appCases);
const runtimeCaseSet = new Set(runtimeCases);

const missingCases = [...appCaseSet].filter((c) => !runtimeCaseSet.has(c));
const extraCases = [...runtimeCaseSet].filter((c) => !appCaseSet.has(c));

// 2. Bloques copiados de App.tsx según la especificación de la Parte 1:
// L32-46, L48-64, L65-73, L143-150, L152-154, L157-172, L174-202,
// L205-210, L212-234, L236-301, L303-332, L335-341, L343-369, L371-382,
// L385-838, L840-1064, L1098-1110, L1749-1763
const copiedRanges = [
  [32, 46],
  [48, 64],
  [65, 73],
  [143, 150],
  [152, 154],
  [157, 172],
  [174, 202],
  [205, 210],
  [212, 234],
  [236, 301],
  [303, 332],
  [335, 341],
  [343, 369],
  [371, 382],
  [385, 838],
  [840, 1064],
  [1098, 1110],
  [1749, 1763],
];

const appCopiedText = copiedRanges.map(([s, e]) => sliceLines(appLines, s, e)).join('\n');

const deviceSyncRegex = /\bdeviceSync\.([a-zA-Z0-9_]+)\b/g;
const electronApiRegex = /(?:\bwindow\.electronAPI|\(window as any\)\.electronAPI)\??\.([a-zA-Z0-9_]+)\b/g;

const appDeviceSync = new Set(Array.from(appCopiedText.matchAll(deviceSyncRegex), (m) => `deviceSync.${m[1]}`));
const runtimeDeviceSync = new Set(Array.from(runtimeText.matchAll(deviceSyncRegex), (m) => `deviceSync.${m[1]}`));

const missingDeviceSync = [...appDeviceSync].filter((m) => !runtimeDeviceSync.has(m));
const extraDeviceSync = [...runtimeDeviceSync].filter((m) => !appDeviceSync.has(m));

const appElectronApi = new Set(Array.from(appCopiedText.matchAll(electronApiRegex), (m) => `window.electronAPI.${m[1]}`));
const runtimeElectronApi = new Set(Array.from(runtimeText.matchAll(electronApiRegex), (m) => `window.electronAPI.${m[1]}`));

const missingElectronApi = [...appElectronApi].filter((m) => !runtimeElectronApi.has(m));
const extraElectronApi = [...runtimeElectronApi].filter((m) => !appElectronApi.has(m));

console.log('=== 1. cases de handleRemoteCommandReceived ===');
console.log(`App.tsx (L385-838) (${appCaseSet.size}):`, [...appCaseSet].join(', '));
console.log(`AppRuntime.tsx (${runtimeCaseSet.size}):`, [...runtimeCaseSet].join(', '));
console.log(`Faltantes (${missingCases.length}):`, missingCases.length ? missingCases.join(', ') : '(ninguno)');
console.log(`Sobrantes (${extraCases.length}):`, extraCases.length ? extraCases.join(', ') : '(ninguno)');

console.log('\n=== 2. Llamadas deviceSync.* (bloques copiados) ===');
console.log(`App.tsx (${appDeviceSync.size}):`, [...appDeviceSync].sort().join(', '));
console.log(`AppRuntime.tsx (${runtimeDeviceSync.size}):`, [...runtimeDeviceSync].sort().join(', '));
console.log(`Faltantes (${missingDeviceSync.length}):`, missingDeviceSync.length ? missingDeviceSync.join(', ') : '(ninguno)');
console.log(`Sobrantes (${extraDeviceSync.length}):`, extraDeviceSync.length ? extraDeviceSync.join(', ') : '(ninguno)');

console.log('\n=== 3. Llamadas window.electronAPI.* (bloques copiados) ===');
console.log(`App.tsx (${appElectronApi.size}):`, [...appElectronApi].sort().join(', '));
console.log(`AppRuntime.tsx (${runtimeElectronApi.size}):`, [...runtimeElectronApi].sort().join(', '));
console.log(`Faltantes (${missingElectronApi.length}):`, missingElectronApi.length ? missingElectronApi.join(', ') : '(ninguno)');
console.log(`Sobrantes (${extraElectronApi.length}):`, extraElectronApi.length ? extraElectronApi.join(', ') : '(ninguno)');

const totalMissing = missingCases.length + missingDeviceSync.length + missingElectronApi.length;
if (totalMissing > 0) {
  console.error(`\nFALLO: ${totalMissing} elementos faltantes.`);
  process.exit(1);
}

console.log('\nOK: 0 faltantes en cases, deviceSync.* y window.electronAPI.*');
