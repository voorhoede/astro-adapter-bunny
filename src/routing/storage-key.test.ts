import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageKey } from './storage-key.ts';

const cases: Array<[string, 'directory' | 'file', string]> = [
  ['/', 'directory', 'index.html'],
  ['/about', 'directory', 'about/index.html'],
  ['/about/', 'directory', 'about/index.html'],
  ['/about', 'file', 'about.html'],
  ['/about/', 'file', 'about.html'],
  ['/', 'file', 'index.html'],
  ['/robots.txt', 'directory', 'robots.txt'],
  ['/_astro/app.Ab12.js', 'file', '_astro/app.Ab12.js'],
  ['/blog/2026/post', 'directory', 'blog/2026/post/index.html'],
  ['/caf%C3%A9', 'directory', 'café/index.html'],
];

for (const [pathname, format, key] of cases) {
  test(`${pathname} with format ${format} reads ${key}`, () => {
    assert.equal(storageKey(pathname, format), key);
  });
}

const unsafe: Array<[string, string]> = [
  ['/a/../../etc/passwd', 'a/etc/passwd/index.html'],
  ['/a/./b.txt', 'a/b.txt'],
  ['/a/%2e%2e/b.txt', 'a/b.txt'],
  ['/a/%252e%252e/b.txt', 'a/%2e%2e/b.txt'],
  ['/a\\..\\b.txt', 'a/b.txt'],
  ['/a//b.txt', 'a/b.txt'],
  ['/%E0%A4%A.txt', '%E0%A4%A.txt'],
];

for (const [pathname, key] of unsafe) {
  test(`${pathname} never leaves the deploy folder and reads ${key}`, () => {
    assert.equal(storageKey(pathname, 'directory'), key);
  });
}

test('with build.format preserve, a page follows its source name', () => {
  assert.equal(storageKey('/blog/a', 'preserve', { index: false }), 'blog/a.html');
  assert.equal(storageKey('/docs/x', 'preserve', { index: true }), 'docs/x/index.html');
  assert.equal(storageKey('/', 'preserve', { index: true }), 'index.html');
});

test('with build.format preserve and no page known, the directory mapping is used', () => {
  assert.equal(storageKey('/guide', 'preserve'), 'guide/index.html');
});

test('a known page with a dot in its name is not read as a literal file', () => {
  assert.equal(storageKey('/hello.world', 'directory', { index: false }), 'hello.world/index.html');
  assert.equal(storageKey('/hello.world', 'file', { index: false }), 'hello.world.html');
});
