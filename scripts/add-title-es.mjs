import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const catalogPath = path.join(rootDir, 'public', 'data', 'catalog.json');
const distCatalogPath = path.join(rootDir, 'dist', 'data', 'catalog.json');

console.log('Cargando catálogo desde:', catalogPath);
const raw = fs.readFileSync(catalogPath, 'utf8');
const catalog = JSON.parse(raw);

let countWithTitleEs = 0;
for (const item of catalog) {
  item.titleEs = (item.titleEs || item.title || item.originalTitle || '').trim();
  if (item.titleEs) {
    countWithTitleEs++;
  }
}

console.log(`Catálogo procesado: ${catalog.length} títulos totales.`);
console.log(`Títulos con titleEs: ${countWithTitleEs}`);

// Guardado atómico
const tmpPath = `${catalogPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(catalog, null, 2), 'utf8');
fs.renameSync(tmpPath, catalogPath);
console.log('✓ Guardado exitoso en public/data/catalog.json');

if (fs.existsSync(path.dirname(distCatalogPath))) {
  const tmpDistPath = `${distCatalogPath}.tmp`;
  fs.writeFileSync(tmpDistPath, JSON.stringify(catalog, null, 2), 'utf8');
  fs.renameSync(tmpDistPath, distCatalogPath);
  console.log('✓ Guardado exitoso en dist/data/catalog.json');
}
