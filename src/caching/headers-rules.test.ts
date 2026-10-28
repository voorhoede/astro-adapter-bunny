import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headersFor, type HeaderRule } from './headers-rules.ts';

const rules: HeaderRule[] = [
  {
    path: '/*',
    set: [
      ['X-Content-Type-Options', 'nosniff'],
      ['X-Robots-Tag', 'noindex'],
    ],
    detach: [],
  },
  {
    path: '/blog/*',
    set: [
      ['X-Robots-Tag', 'nosnippet'],
      ['X-Section', ':splat'],
    ],
    detach: [],
  },
  { path: '/embed/*', set: [], detach: ['X-Content-Type-Options'] },
  { path: '/movies/:title', set: [['X-Movie', 'watching :title']], detach: [] },
  { path: '/robots.txt', set: [['X-Exact', 'yes']], detach: [] },
];

test('a splat block applies to every path under it', () => {
  assert.deepEqual(headersFor(rules, '/about/index.html'), [
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Robots-Tag', 'noindex'],
  ]);
});

test('matching blocks merge, and a header set twice is comma-joined', () => {
  assert.deepEqual(headersFor(rules, '/blog/2026/post'), [
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Robots-Tag', 'noindex, nosnippet'],
    ['X-Section', '2026/post'],
  ]);
});

test('a detached header is removed from what earlier blocks set', () => {
  assert.deepEqual(headersFor(rules, '/embed/player'), [['X-Robots-Tag', 'noindex']]);
});

test('a placeholder matches one segment and fills the value', () => {
  assert.deepEqual(headersFor(rules, '/movies/alien').at(-1), ['X-Movie', 'watching alien']);
  assert.equal(
    headersFor(rules, '/movies/alien/cast').some(([name]) => name === 'X-Movie'),
    false,
  );
});

test('an exact path matches only itself', () => {
  assert.deepEqual(headersFor(rules, '/robots.txt').at(-1), ['X-Exact', 'yes']);
  assert.equal(
    headersFor(rules, '/robots.txt.bak').some(([name]) => name === 'X-Exact'),
    false,
  );
});
