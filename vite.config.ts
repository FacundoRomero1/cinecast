import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function getBuildId(): string {
  const iso = new Date().toISOString();
  let gitHash = 'nogit';
  try {
    gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (_) {}
  return `${iso}_${gitHash}`;
}

const buildId = getBuildId();

function buildIdPlugin(): Plugin {
  const writeBuildId = () => {
    try {
      const baseDir = import.meta.dirname || process.cwd();
      const distDir = path.resolve(baseDir, 'dist');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      fs.writeFileSync(path.join(distDir, 'build-id.txt'), buildId, 'utf8');
    } catch (_) {}
  };

  writeBuildId();

  return {
    name: 'build-id-plugin',
    buildStart() {
      writeBuildId();
    },
    writeBundle() {
      writeBuildId();
    },
    closeBundle() {
      writeBuildId();
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [react(), tailwindcss(), buildIdPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
