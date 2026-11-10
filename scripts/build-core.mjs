import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

await build({
  stdin: {
    contents: [
      `export { createApp } from './src/server/core/http.js';`,
      `export { attachWebSocket } from './src/server/core/ws.js';`,
      `export { getLocalIpAddress } from './src/server/core/net.js';`,
    ].join('\n'),
    resolveDir: rootDir,
    sourcefile: 'core-entry.ts',
    loader: 'ts',
  },
  outfile: path.join(rootDir, 'electron', 'core.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  external: ['express', 'ws', 'electron', ...nodeExternals],
});

console.log('✓ electron/core.cjs compilado exitosamente');
