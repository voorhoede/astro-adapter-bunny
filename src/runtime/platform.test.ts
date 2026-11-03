import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { deploy, siteData, visitorUrl } from './platform.ts';

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__BUNNY_DEPLOY__');
  Reflect.deleteProperty(globalThis, '__BUNNY_SITE__');
});

test('the visitor URL is rebuilt from cdn-host over https, keeping the path and query', () => {
  const request = new Request('http://storage.bunnycdn.com:9000/blog?page=2', {
    headers: { host: 'www.example.com', 'cdn-host': 'www.example.com' },
  });
  assert.equal(visitorUrl(request).href, 'https://www.example.com/blog?page=2');
});

test('without cdn-host the host header is used, never x-forwarded-host', () => {
  const request = new Request('http://storage.bunnycdn.com:9000/', {
    headers: { host: 'www.example.com', 'x-forwarded-host': 'evil.example' },
  });
  assert.equal(visitorUrl(request).host, 'www.example.com');
});

test('the deploy global is read when asked for, not when the module loads', () => {
  Object.assign(globalThis, { __BUNNY_DEPLOY__: { id: 'abc', assetPrefix: 'deploys/abc' } });
  assert.deepEqual(deploy(), { assetPrefix: 'deploys/abc' });
});

test('a missing deploy global, or one without an assetPrefix, fails with a clear message', () => {
  assert.throws(() => deploy(), /__BUNNY_DEPLOY__/);
  Object.assign(globalThis, { __BUNNY_DEPLOY__: { id: 'abc' } });
  assert.throws(() => deploy(), /assetPrefix/);
});

test('the site data comes from the global the build writes into the script', () => {
  Object.assign(globalThis, { __BUNNY_SITE__: { base: '/' } });
  assert.deepEqual(siteData(), { base: '/' });
});
