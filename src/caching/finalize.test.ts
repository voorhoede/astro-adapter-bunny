import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalize, type Context } from './finalize.ts';

const STATIC = 'public, max-age=0, must-revalidate';
const PRIVATE = 'private, no-store';
const IMMUTABLE = 'public, max-age=31536000, immutable';

function context(overrides: Partial<Context> = {}): Context {
  return {
    pathname: '/about',
    assetsDir: '_astro',
    staticCacheControl: STATIC,
    headersFor: () => [],
    route: '/about',
    log: () => {},
    ...overrides,
  };
}

function response(headers: Record<string, string> = {}, status = 200) {
  return new Response('body', { status, headers });
}

function cacheControl(result: Response) {
  return result.headers.get('cache-control');
}

test('a rendered response without Cache-Control is private', () => {
  assert.equal(cacheControl(finalize(response(), 'rendered', context())), PRIVATE);
});

test('a rendered response keeps the Cache-Control it set', () => {
  assert.equal(
    cacheControl(
      finalize(response({ 'cache-control': 'public, s-maxage=60' }), 'rendered', context()),
    ),
    'public, s-maxage=60',
  );
});

test('a rendered response that sets a cookie is forced private, and the route is logged without values', () => {
  const lines: string[] = [];
  const result = finalize(
    response({ 'cache-control': 'public, max-age=60', 'set-cookie': 'session=secret' }),
    'rendered',
    context({ route: '/account/[id]', pathname: '/account/42', log: (line) => lines.push(line) }),
  );
  assert.equal(cacheControl(result), PRIVATE);
  assert.equal(result.headers.get('set-cookie'), 'session=secret');
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /\/account\/\[id\]/);
  assert.doesNotMatch(lines[0]!, /42|secret/);
});

test('a rendered response with Vary other than accept-encoding is forced private', () => {
  const result = finalize(
    response({ 'cache-control': 'public, max-age=60', vary: 'cookie' }),
    'rendered',
    context(),
  );
  assert.equal(cacheControl(result), PRIVATE);
});

test('a rendered response with Vary accept-encoding keeps its Cache-Control', () => {
  const result = finalize(
    response({ 'cache-control': 'public, max-age=60', vary: 'Accept-Encoding' }),
    'rendered',
    context(),
  );
  assert.equal(cacheControl(result), 'public, max-age=60');
});

test('a rendered 500 is never cacheable', () => {
  assert.equal(
    cacheControl(
      finalize(response({ 'cache-control': 'public, max-age=60' }, 500), 'rendered', context()),
    ),
    PRIVATE,
  );
});

test('_headers never touches a rendered response', () => {
  const result = finalize(
    response(),
    'rendered',
    context({ headersFor: () => [['x-frame-options', 'DENY']] }),
  );
  assert.equal(result.headers.get('x-frame-options'), null);
});

test('a stored file under the assets directory is immutable', () => {
  const result = finalize(response(), 'stored', context({ pathname: '/_astro/app.Ab12.js' }));
  assert.equal(cacheControl(result), IMMUTABLE);
});

test('another stored file gets staticCacheControl', () => {
  assert.equal(
    cacheControl(finalize(response(), 'stored', context({ pathname: '/robots.txt' }))),
    STATIC,
  );
});

test('a stored 404 page served for not found gets staticCacheControl', () => {
  assert.equal(cacheControl(finalize(response({}, 404), 'stored', context())), STATIC);
});

test('a stored 500 page is never cacheable', () => {
  assert.equal(cacheControl(finalize(response({}, 500), 'stored', context())), PRIVATE);
});

test('_headers fills missing headers on a stored file', () => {
  const result = finalize(
    response(),
    'stored',
    context({ headersFor: () => [['strict-transport-security', 'max-age=31536000']] }),
  );
  assert.equal(result.headers.get('strict-transport-security'), 'max-age=31536000');
});

test('_headers never overwrites a header the stored file already has', () => {
  const result = finalize(
    response({ 'content-security-policy': "default-src 'self'" }),
    'stored',
    context({ headersFor: () => [['content-security-policy', '*']] }),
  );
  assert.equal(result.headers.get('content-security-policy'), "default-src 'self'");
});

test('_headers cannot set Cache-Control', () => {
  const result = finalize(
    response(),
    'stored',
    context({ headersFor: () => [['cache-control', 'public, max-age=999']] }),
  );
  assert.equal(cacheControl(result), STATIC);
});

test('a redirect the adapter makes gets staticCacheControl', () => {
  const redirect = new Response(null, { status: 301, headers: { location: '/about/' } });
  assert.equal(cacheControl(finalize(redirect, 'adapter', context())), STATIC);
});

test('a 500 the adapter makes is never cacheable', () => {
  assert.equal(cacheControl(finalize(response({}, 500), 'adapter', context())), PRIVATE);
});

test('a response with immutable headers is copied instead of failing', () => {
  const result = finalize(Response.redirect('https://example.com/', 302), 'rendered', context());
  assert.equal(result.status, 302);
  assert.equal(cacheControl(result), PRIVATE);
});
