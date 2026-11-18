import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  const { getOrFetchSportsChannels } = await import('../src/server/core/sports.js').catch(async () => {
    return await import('../src/server/core/sports.ts');
  });

  const cacheDir = path.resolve(__dirname, '..', '.cinecast-data');
  const res = await getOrFetchSportsChannels(cacheDir, false, false);
  console.log('Channels count:', res.channels.length);
  res.channels.slice(0, 10).forEach(c => {
    console.log(`[${c.country}] ${c.name} -> ${c.streamUrl}`);
  });
}

test().catch(console.error);
