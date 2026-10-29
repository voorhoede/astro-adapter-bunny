import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, type Decision, type RouteMatch, type Site } from './decide.ts';

const site: Site = {
  base: '',
  trailingSlash: 'ignore',
  format: 'directory',
  assetsDir: '_astro',
  notFoundPrerendered: true,
  redirects: [],
};

const notFound: Decision = {
  type: 'file',
  key: '404.html',
  status: 404,
  otherwise: { type: 'render' },
};

type OnDemand = Pick<RouteMatch, 'type' | 'dynamic'> & Partial<RouteMatch>;

function routes(table: Record<string, OnDemand>) {
  return (pathname: string): RouteMatch | undefined => {
    const route = table[pathname];
    return route && { prerendered: false, index: false, ...route };
  };
}

function prerendered(index: boolean, type: RouteMatch['type'] = 'page'): RouteMatch {
  return { type, dynamic: false, prerendered: true, index };
}

const none = routes({});

function get(pathname: string, search = '') {
  return { method: 'GET', pathname, search };
}

test('a stored page is read from storage, and not found when it is missing', () => {
  assert.deepEqual(decide(get('/about'), site, none), {
    type: 'file',
    key: 'about/index.html',
    otherwise: notFound,
  });
});

test('a file under the assets directory is read, and never rendered', () => {
  assert.deepEqual(
    decide(
      get('/_astro/app.js'),
      site,
      routes({ '/_astro/app.js': { type: 'page', dynamic: true } }),
    ),
    {
      type: 'file',
      key: '_astro/app.js',
      otherwise: notFound,
    },
  );
});

for (const pathname of [
  '/_bunny/server/a.js',
  '/_Bunny/server/a.js',
  '/_BUNNY/server/a.js',
  '/_bunny//server/a.js',
  '//_bunny/server/a.js',
  '/_bunny%2fserver/a.js',
  '/_headers',
  '/_Headers',
  '/_redirects',
  '/_REDIRECTS',
]) {
  test(`reserved path ${pathname} is not found`, () => {
    assert.deepEqual(decide(get(pathname), site, none), notFound);
  });
}

test('a POST renders, so a body never goes to storage', () => {
  assert.deepEqual(decide({ method: 'POST', pathname: '/about', search: '' }, site, none), {
    type: 'render',
  });
});

test('an on-demand route with a fixed pathname renders without a storage read', () => {
  assert.deepEqual(
    decide(get('/api/time'), site, routes({ '/api/time': { type: 'endpoint', dynamic: false } })),
    {
      type: 'render',
    },
  );
});

test('a redirect route renders, so Astro answers with its status', () => {
  assert.deepEqual(
    decide(get('/old'), site, routes({ '/old': { type: 'redirect', dynamic: false } })),
    {
      type: 'render',
    },
  );
});

test('a file wins over a catch-all on-demand route, which renders only when storage has nothing', () => {
  const locale = routes({
    '/sitemap-index.xml': { type: 'page', dynamic: true },
    '/en': { type: 'page', dynamic: true },
  });
  assert.deepEqual(decide(get('/sitemap-index.xml'), site, locale), {
    type: 'file',
    key: 'sitemap-index.xml',
    otherwise: { type: 'render' },
  });
  assert.deepEqual(decide(get('/en'), site, locale), {
    type: 'file',
    key: 'en/index.html',
    otherwise: { type: 'render' },
  });
});

test('a path outside base is not found', () => {
  assert.deepEqual(decide(get('/other/page'), { ...site, base: '/docs' }, none), notFound);
});

test('base is stripped before the storage key is made', () => {
  assert.deepEqual(decide(get('/docs/guide'), { ...site, base: '/docs' }, none), {
    type: 'file',
    key: 'guide/index.html',
    otherwise: notFound,
  });
});

test('without a prerendered 404 page, not found renders', () => {
  assert.deepEqual(decide(get('/missing'), { ...site, notFoundPrerendered: false }, none), {
    type: 'file',
    key: 'missing/index.html',
    otherwise: { type: 'render' },
  });
});

test('trailingSlash always redirects a page path without a slash, keeping the query', () => {
  assert.deepEqual(decide(get('/about', '?ref=x'), { ...site, trailingSlash: 'always' }, none), {
    type: 'redirect',
    status: 301,
    location: '/about/?ref=x',
  });
});

test('trailingSlash always leaves a file with an extension alone', () => {
  assert.equal(decide(get('/robots.txt'), { ...site, trailingSlash: 'always' }, none).type, 'file');
});

test('trailingSlash never redirects a page path with a slash', () => {
  assert.deepEqual(decide(get('/about/'), { ...site, trailingSlash: 'never' }, none), {
    type: 'redirect',
    status: 301,
    location: '/about',
  });
});

test('trailingSlash never leaves the root alone', () => {
  assert.equal(decide(get('/'), { ...site, trailingSlash: 'never' }, none).type, 'file');
});

test('trailingSlash always redirects the bare base to base with a slash', () => {
  assert.deepEqual(
    decide(get('/docs'), { ...site, base: '/docs', trailingSlash: 'always' }, none),
    {
      type: 'redirect',
      status: 301,
      location: '/docs/',
    },
  );
});

test('build.format file maps a page to name.html', () => {
  assert.deepEqual(decide(get('/about'), { ...site, format: 'file' }, none), {
    type: 'file',
    key: 'about.html',
    otherwise: notFound,
  });
});

const withRules: Site = {
  ...site,
  redirects: [
    { from: '/old', to: '/new', status: 301 },
    { from: '/temp', to: '/new' },
    { from: '/blog/*', to: '/posts/:splat', status: 301 },
    { from: '/docs/:slug', to: '/handbook/:slug', status: 308 },
    { from: '/campaign', to: '/landing?src=mail', status: 302 },
    { from: '/away', to: 'https://example.com/target', status: 301 },
    { from: '/app/*', to: '/app/index.html', status: 200 },
  ],
};

test('a _redirects rule redirects with its status and keeps the visitor query', () => {
  assert.deepEqual(decide(get('/old', '?utm_source=x'), withRules, none), {
    type: 'redirect',
    status: 301,
    location: '/new?utm_source=x',
  });
});

test('a _redirects rule without a status uses 302, as on Cloudflare', () => {
  assert.deepEqual(decide(get('/temp'), withRules, none), {
    type: 'redirect',
    status: 302,
    location: '/new',
  });
});

test('a splat carries into the destination', () => {
  assert.deepEqual(decide(get('/blog/2026/hello'), withRules, none), {
    type: 'redirect',
    status: 301,
    location: '/posts/2026/hello',
  });
});

test('a placeholder matches one segment and carries into the destination', () => {
  assert.deepEqual(decide(get('/docs/intro'), withRules, none), {
    type: 'redirect',
    status: 308,
    location: '/handbook/intro',
  });
  assert.equal(decide(get('/docs/intro/more'), withRules, none).type, 'file');
});

test('a destination with its own query keeps that query instead of the visitor query', () => {
  assert.deepEqual(decide(get('/campaign', '?utm_source=x'), withRules, none), {
    type: 'redirect',
    status: 302,
    location: '/landing?src=mail',
  });
});

test('an external destination is kept as is', () => {
  assert.deepEqual(decide(get('/away'), withRules, none), {
    type: 'redirect',
    status: 301,
    location: 'https://example.com/target',
  });
});

test('a 200 rule serves the target file under the visitor URL', () => {
  assert.deepEqual(decide(get('/app/settings'), withRules, none), {
    type: 'file',
    key: 'app/index.html',
    otherwise: notFound,
  });
});

test('a _redirects rule never applies to a path an on-demand route claims', () => {
  assert.deepEqual(
    decide(get('/old'), withRules, routes({ '/old': { type: 'page', dynamic: false } })),
    {
      type: 'render',
    },
  );
});

test('the first matching _redirects rule wins', () => {
  const first: Site = {
    ...site,
    redirects: [
      { from: '/x', to: '/first', status: 301 },
      { from: '/x', to: '/second', status: 301 },
    ],
  };
  assert.deepEqual(decide(get('/x'), first, none), {
    type: 'redirect',
    status: 301,
    location: '/first',
  });
});

const preserve: Site = { ...site, format: 'preserve' };

test('with build.format preserve, a prerendered page not named index reads name.html', () => {
  assert.deepEqual(decide(get('/blog/a'), preserve, routes({ '/blog/a': prerendered(false) })), {
    type: 'file',
    key: 'blog/a.html',
    otherwise: notFound,
  });
});

test('with build.format preserve, a prerendered index page reads name/index.html', () => {
  assert.deepEqual(decide(get('/docs/x'), preserve, routes({ '/docs/x': prerendered(true) })), {
    type: 'file',
    key: 'docs/x/index.html',
    otherwise: notFound,
  });
});

test('with build.format preserve, the root reads index.html', () => {
  assert.deepEqual(decide(get('/'), preserve, routes({ '/': prerendered(true) })), {
    type: 'file',
    key: 'index.html',
    otherwise: notFound,
  });
});

test('with build.format preserve, prerendered pages with params follow their source name', () => {
  const table = routes({
    '/posts/hello': { ...prerendered(false), dynamic: true },
    '/tags/astro': { ...prerendered(true), dynamic: true },
  });
  assert.equal(
    (decide(get('/posts/hello'), preserve, table) as { key: string }).key,
    'posts/hello.html',
  );
  assert.equal(
    (decide(get('/tags/astro'), preserve, table) as { key: string }).key,
    'tags/astro/index.html',
  );
});

test('with build.format preserve, a path no route claims uses the directory mapping', () => {
  assert.deepEqual(decide(get('/guide'), preserve, none), {
    type: 'file',
    key: 'guide/index.html',
    otherwise: notFound,
  });
});

test('a prerendered page never renders, even when storage has nothing', () => {
  assert.deepEqual(decide(get('/about'), site, routes({ '/about': prerendered(false) })), {
    type: 'file',
    key: 'about/index.html',
    otherwise: notFound,
  });
});

test('trailingSlash always still redirects a prerendered page path without a slash', () => {
  assert.deepEqual(
    decide(
      get('/about'),
      { ...preserve, trailingSlash: 'always' },
      routes({ '/about': prerendered(false) }),
    ),
    { type: 'redirect', status: 301, location: '/about/' },
  );
});

test('a prerendered page with a dot in its name is still a page', () => {
  const table = routes({ '/hello.world': prerendered(false) });
  assert.equal(
    (decide(get('/hello.world'), site, table) as { key: string }).key,
    'hello.world/index.html',
  );
  assert.equal(
    (decide(get('/hello.world'), { ...site, format: 'file' }, table) as { key: string }).key,
    'hello.world.html',
  );
});

test('a prerendered endpoint keeps its literal name', () => {
  assert.equal(
    (
      decide(
        get('/robots.txt'),
        site,
        routes({ '/robots.txt': prerendered(false, 'endpoint') }),
      ) as { key: string }
    ).key,
    'robots.txt',
  );
});

test('a fallback route behaves like a page', () => {
  assert.deepEqual(
    decide(get('/fr/about'), site, routes({ '/fr/about': { type: 'fallback', dynamic: false } })),
    {
      type: 'render',
    },
  );
  assert.deepEqual(
    decide(get('/fr/blog/a'), site, routes({ '/fr/blog/a': { type: 'fallback', dynamic: true } })),
    {
      type: 'file',
      key: 'fr/blog/a/index.html',
      otherwise: { type: 'render' },
    },
  );
});
