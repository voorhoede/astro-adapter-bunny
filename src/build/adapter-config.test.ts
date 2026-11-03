import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adapterConfig, configOverrides } from './adapter-config.ts';

test('a server build keeps its output and gets static headers', () => {
  const config = adapterConfig('server', '/adapter/server.ts');
  assert.equal(config.name, 'astro-adapter-bunny');
  assert.equal(config.serverEntrypoint, '/adapter/server.ts');
  assert.equal(config.entrypointResolution, 'auto');
  assert.deepEqual(config.adapterFeatures, {
    buildOutput: 'server',
    staticHeaders: true,
    preserveBuildClientDir: true,
    preserveBuildServerDir: true,
  });
});

test('a static build stays static and keeps its CSP in the HTML', () => {
  const { adapterFeatures } = adapterConfig('static', '/adapter/server.ts');
  assert.equal(adapterFeatures.buildOutput, 'static');
  assert.equal(adapterFeatures.staticHeaders, false);
});

test('Sharp is declared limited, since it runs at build only', () => {
  assert.deepEqual(adapterConfig('server', '/adapter/server.ts').supportedAstroFeatures, {
    staticOutput: 'stable',
    hybridOutput: 'stable',
    serverOutput: 'stable',
    envGetSecret: 'stable',
    sharpImageService: 'limited',
    i18nDomains: 'unsupported',
  });
});

test('redirects are answered at runtime, and every dependency is bundled', () => {
  const overrides = configOverrides({
    image: { service: { entrypoint: 'astro/assets/services/sharp' } },
  });
  assert.deepEqual(overrides.build, { redirects: false });
  assert.equal(overrides.vite?.ssr?.noExternal, true);
});

test('a build resolves packages for Deno first, the runtime bunny.net runs, and keeps the server defaults', () => {
  assert.deepEqual(configOverrides({}, 'build').vite?.ssr?.resolve?.conditions, [
    'deno',
    'module',
    'node',
    'development|production',
  ]);
});

test('astro dev keeps its own dependency handling, since bundling everything breaks the dev server', () => {
  const overrides = configOverrides({}, 'dev');
  assert.equal(overrides.vite, undefined);
  assert.equal(configOverrides({}, 'build').vite?.ssr?.noExternal, true);
});

test('the default Sharp service runs at build, and the no-op service at runtime', () => {
  const overrides = configOverrides({
    image: { service: { entrypoint: 'astro/assets/services/sharp' } },
  });
  assert.deepEqual(overrides.image, {
    service: {
      build: { entrypoint: 'astro/assets/services/sharp' },
      runtime: { entrypoint: 'astro/assets/services/noop' },
    },
  });
});

test('imageService passthrough leaves every image untransformed, at build and at runtime', () => {
  assert.deepEqual(configOverrides({}, 'build', 'passthrough').image, {
    service: { entrypoint: 'astro/assets/services/noop' },
  });
});

test('imageService custom leaves the project image config as it is', () => {
  assert.equal(configOverrides({}, 'build', 'custom').image, undefined);
});

test('a project that chose another image service keeps it', () => {
  const service = { entrypoint: 'my-image-cdn' };
  assert.equal(configOverrides({ image: { service } }).image, undefined);
});

test('a project that already split its image service keeps the split', () => {
  const service = {
    build: { entrypoint: 'astro/assets/services/sharp' },
    runtime: { entrypoint: 'my-cdn' },
  };
  assert.equal(configOverrides({ image: { service } }).image, undefined);
});

test('a project without a cache provider gets the bunny.net CDN provider, with its site', () => {
  const cache = configOverrides({ site: 'https://www.example.com' }).cache;
  assert.equal(cache?.provider?.name, 'bunny.net CDN');
  assert.match(String(cache?.provider?.entrypoint), /bunny-cdn\.ts$/);
  assert.deepEqual(cache?.provider?.config, { site: 'https://www.example.com' });
});

test('a project with its own cache provider keeps it', () => {
  const overrides = configOverrides({
    cache: { provider: { entrypoint: 'astro/cache/memory' } },
  });
  assert.equal(overrides.cache, undefined);
});
