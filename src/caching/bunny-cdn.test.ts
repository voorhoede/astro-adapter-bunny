import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import bunnyCdn from './bunny-cdn.ts';

const SITE = 'https://www.example.com';
const provider = bunnyCdn({ site: SITE });

beforeEach(() => {
  process.env.BUNNY_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.BUNNY_API_KEY;
  mock.restoreAll();
});

function purgeApi(status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
}

const request = new Request(`${SITE}/blog`);

test('maxAge becomes s-maxage, so the CDN caches the page and browsers do not keep it', () => {
  const headers = provider.setHeaders?.({ maxAge: 300 }, request);
  assert.equal(headers?.get('cache-control'), 'public, s-maxage=300');
});

test('swr becomes stale-while-revalidate', () => {
  const headers = provider.setHeaders?.({ maxAge: 300, swr: 60 }, request);
  assert.equal(headers?.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=60');
});

test('without maxAge the provider sets no Cache-Control', () => {
  const headers = provider.setHeaders?.({ tags: ['post'] }, request);
  assert.equal(headers?.has('cache-control'), false);
});

test('lastModified and etag become their headers', () => {
  const lastModified = new Date('2026-11-03T12:00:00Z');
  const headers = provider.setHeaders?.({ maxAge: 60, lastModified, etag: '"v1"' }, request);
  assert.equal(headers?.get('last-modified'), lastModified.toUTCString());
  assert.equal(headers?.get('etag'), '"v1"');
});

test('invalidate by path purges that URL on the site through the bunny.net API', async () => {
  const api = purgeApi();
  await provider.invalidate({ path: '/blog/first post' });
  assert.equal(api.mock.callCount(), 1);
  const [url, init] = api.mock.calls[0]?.arguments ?? [];
  assert.equal(
    String(url),
    `https://api.bunny.net/purge?url=${encodeURIComponent(`${SITE}/blog/first%20post`)}`,
  );
  assert.equal(init?.method, 'POST');
  assert.equal(new Headers(init?.headers).get('accesskey'), 'test-key');
});

test('invalidate by tag fails, since bunny.net tag purges did not take effect on script responses', async () => {
  const api = purgeApi();
  await assert.rejects(provider.invalidate({ tags: ['post'] }), /tag/i);
  assert.equal(api.mock.callCount(), 0);
});

test('invalidate without BUNNY_API_KEY fails, naming the variable', async () => {
  delete process.env.BUNNY_API_KEY;
  const api = purgeApi();
  await assert.rejects(provider.invalidate({ path: '/blog' }), /BUNNY_API_KEY/);
  assert.equal(api.mock.callCount(), 0);
});

test('invalidate without a site in the Astro config fails, naming the option', async () => {
  purgeApi();
  await assert.rejects(bunnyCdn({}).invalidate({ path: '/blog' }), /site/);
});

test('a purge the API refuses fails with its status', async () => {
  purgeApi(401);
  await assert.rejects(provider.invalidate({ path: '/blog' }), /401/);
});
