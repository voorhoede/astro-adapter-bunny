import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeadersFile } from './headers-file.ts';

test('blocks become rules, with header lines, detached names, comments and blank lines', () => {
  const text = [
    '# baseline',
    '/*',
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Robots-Tag: noindex',
    '',
    '/embed/*',
    '  ! X-Frame-Options',
    "  Content-Security-Policy: frame-ancestors 'self' https://partner.example",
  ].join('\n');
  assert.deepEqual(parseHeadersFile(text), [
    {
      path: '/*',
      set: [
        ['Strict-Transport-Security', 'max-age=31536000'],
        ['X-Robots-Tag', 'noindex'],
      ],
      detach: [],
    },
    {
      path: '/embed/*',
      set: [['Content-Security-Policy', "frame-ancestors 'self' https://partner.example"]],
      detach: ['X-Frame-Options'],
    },
  ]);
});

test('a value keeps every colon after the first', () => {
  assert.deepEqual(parseHeadersFile('/a\n  Link: <https://example.com/x>; rel=preload')[0]!.set, [
    ['Link', '<https://example.com/x>; rel=preload'],
  ]);
});

test('an empty file has no rules', () => {
  assert.deepEqual(parseHeadersFile(''), []);
});

test('a header line before any path fails with its line number', () => {
  assert.throws(() => parseHeadersFile('# top\n  X-A: b'), /_headers:2/);
});

test('a header line without a colon fails with its line number', () => {
  assert.throws(() => parseHeadersFile('/a\n  X-A b'), /_headers:2/);
});

test('a path with more than one splat fails with its line number', () => {
  assert.throws(() => parseHeadersFile('/a/*/b/*\n  X-A: b'), /_headers:1/);
});
