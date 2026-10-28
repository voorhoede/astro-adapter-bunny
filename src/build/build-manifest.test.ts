import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManifest } from './build-manifest.ts';

const versions = { adapter: '0.1.0', astro: '7.4.2' };

test('a script build names the script, the assets, the pull zone settings and the variables', () => {
  assert.deepEqual(
    buildManifest({
      kind: 'ssr',
      scriptType: 'middleware',
      scriptBytes: 1234,
      assetsDir: '_astro',
      env: [{ name: 'BUNNY_STORAGE_KEY', secret: true }],
      versions,
    }),
    {
      manifestVersion: 1,
      adapter: { package: 'astro-adapter-bunny', version: '0.1.0' },
      framework: { name: 'astro', version: '7.4.2' },
      kind: 'ssr',
      script: { entry: 'dist/index.js', type: 'middleware', bytes: 1234 },
      assets: { dir: 'dist/client', immutable: ['_astro/'], reserved: ['_bunny/'] },
      requires: {
        pullZone: { disableCookies: false, enableSmartCache: false, enableCacheSlice: false },
        env: [{ name: 'BUNNY_STORAGE_KEY', secret: true }],
      },
    },
  );
});

test('a static build has no script and requires nothing', () => {
  assert.deepEqual(buildManifest({ kind: 'static', assetsDir: '_astro', env: [], versions }), {
    manifestVersion: 1,
    adapter: { package: 'astro-adapter-bunny', version: '0.1.0' },
    framework: { name: 'astro', version: '7.4.2' },
    kind: 'static',
    assets: { dir: 'dist/client', immutable: ['_astro/'] },
  });
});
