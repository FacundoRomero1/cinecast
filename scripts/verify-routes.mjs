import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const expressPkg = require('express/package.json');
const { createApp } = require('../electron/core.cjs');

const tmpDir = os.tmpdir();
const memAuth = {};

const app = createApp({
  baseDir: tmpDir,
  userDataPath: path.join(tmpDir, 'cinecast-verify-userdata'),
  posterCacheDir: path.join(tmpDir, 'cinecast-verify-posters'),
  mediaCacheDir: path.join(tmpDir, 'cinecast-verify-media'),
  accountsFilePath: path.join(tmpDir, 'cinecast-verify-accounts.json'),
  diagnostics: {
    getMode: () => false,
    setMode: () => {},
    getNoCorsFix: () => false,
    setNoCorsFix: () => {},
    onChange: () => {},
  },
  auth: {
    userDataPath: path.join(tmpDir, 'cinecast-verify-userdata'),
    saveSecureAuth: async (provider, data) => {
      memAuth[provider] = data;
    },
    loadSecureAuth: async (provider) => memAuth[provider] || null,
  },
});

const routerObj = app._router || app.router;
const routerPropUsed = app._router ? 'app._router.stack' : (app.router ? 'app.router.stack' : 'none');

console.log(`Express version: ${expressPkg.version} (${routerPropUsed})`);

function extractMountPrefix(regexp) {
  if (!regexp) return '';
  if (regexp.fast_slash) return '';
  const src = regexp.source;
  // Express 4 layer regexp for '/api' looks like: ^\/api\/?(?=\/|$)
  const m = src.match(/^\^\\\/([a-zA-Z0-9_-]+)\\\/\?\(\?=\\\/\|\$\)/);
  if (m) return '/' + m[1];
  return '';
}

const routes = [];

function walkStack(stack, prefix = '') {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = prefix + (layer.route.path === '/' ? '' : layer.route.path) || '/';
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const method of methods) {
        routes.push(`${method.toUpperCase()} ${routePath}`);
      }
    } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      const subPrefix = extractMountPrefix(layer.regexp);
      walkStack(layer.handle.stack, prefix + subPrefix);
    }
  }
}

walkStack(routerObj.stack, '');
routes.sort();
for (const r of routes) {
  console.log(r);
}

