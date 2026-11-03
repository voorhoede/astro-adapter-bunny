import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { readStored } from './storage.ts';

beforeEach(() => {
  process.env.BUNNY_STORAGE_ZONE = 'site-zone';
  process.env.BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
  process.env.BUNNY_STORAGE_KEY = 'storage-password';
});

afterEach(() => {
  delete process.env.BUNNY_STORAGE_ZONE;
  delete process.env.BUNNY_STORAGE_HOST;
  delete process.env.BUNNY_STORAGE_KEY;
  mock.restoreAll();
});

function storageApi(status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response('page', { status }));
}

test('a file is read from the deploy folder through the Storage API with the zone password', async () => {
  const api = storageApi();
  const response = await readStored('404.html', 'deploys/abc');
  assert.equal(await response?.text(), 'page');
  const [url, init] = api.mock.calls[0]?.arguments ?? [];
  assert.equal(String(url), 'https://storage.bunnycdn.com/site-zone/deploys/abc/404.html');
  assert.equal(new Headers(init?.headers).get('accesskey'), 'storage-password');
});

test('a file storage does not have reads as undefined', async () => {
  storageApi(404);
  assert.equal(await readStored('500.html', 'deploys/abc'), undefined);
});

test('a key never leaves the deploy folder', async () => {
  const api = storageApi();
  await readStored('../../other-site/secret.html', 'deploys/abc');
  assert.equal(
    String(api.mock.calls[0]?.arguments[0]),
    'https://storage.bunnycdn.com/site-zone/deploys/abc/other-site/secret.html',
  );
});

test('other storage errors fail, naming the status', async () => {
  storageApi(401);
  await assert.rejects(readStored('404.html', 'deploys/abc'), /401/);
});

test('missing storage variables fail, naming them', async () => {
  delete process.env.BUNNY_STORAGE_KEY;
  storageApi();
  await assert.rejects(readStored('404.html', 'deploys/abc'), /BUNNY_STORAGE_KEY/);
});

test('a type the Storage API does not know comes from the file extension', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}', { headers: { 'content-type': 'application/octet-stream' } }),
  );
  const response = await readStored('site.webmanifest', 'deploys/abc');
  assert.equal(response?.headers.get('content-type'), 'application/manifest+json');
});

test('a type the Storage API sends is kept', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response('a{}', { headers: { 'content-type': 'text/css' } }),
  );
  const response = await readStored('_astro/app.css', 'deploys/abc');
  assert.equal(response?.headers.get('content-type'), 'text/css');
});
