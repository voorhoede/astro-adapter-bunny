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
