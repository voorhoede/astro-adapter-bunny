import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRedirectsFile } from './redirects-file.ts';

test('lines become rules, and a missing status stays missing so the runtime uses 302', () => {
  const text = [
    '# moved pages',
    '/old /new 301',
    '/temp /new',
    '',
    '/blog/* /posts/:splat 308',
    '/away https://example.com/target 302',
    '/app/* /app/index.html 200',
  ].join('\n');
  assert.deepEqual(parseRedirectsFile(text), [
    { from: '/old', to: '/new', status: 301 },
    { from: '/temp', to: '/new' },
    { from: '/blog/*', to: '/posts/:splat', status: 308 },
    { from: '/away', to: 'https://example.com/target', status: 302 },
    { from: '/app/*', to: '/app/index.html', status: 200 },
  ]);
});

test('a status Cloudflare does not support fails with its line number', () => {
  assert.throws(() => parseRedirectsFile('/a /b 301\n/c /d 404'), /_redirects:2/);
});

test('a line without a destination fails with its line number', () => {
  assert.throws(() => parseRedirectsFile('/a'), /_redirects:1/);
});

test('a query condition in the source fails, since Cloudflare does not support it', () => {
  assert.throws(() => parseRedirectsFile('/search?q=:q /find 301'), /_redirects:1/);
});

test('a source with more than one splat fails with its line number', () => {
  assert.throws(() => parseRedirectsFile('/a/*/b/* /c 301'), /_redirects:1/);
});

test('a 200 rule pointing to another site fails, since proxying external domains is not supported', () => {
  assert.throws(
    () => parseRedirectsFile('/api/* https://api.example.com/:splat 200'),
    /_redirects:1/,
  );
});
