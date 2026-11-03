import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMiddleware, type Route, type SiteData } from './middleware.ts';

const STORAGE = 'http://storage.bunnycdn.com:9000';
const HOST = 'www.example.com';

const site: SiteData = {
  base: '',
  trailingSlash: 'ignore',
  format: 'directory',
  assetsDir: '_astro',
  notFoundPrerendered: true,
  redirects: [{ from: '/old', to: '/new', status: 301 }],
  headers: [{ path: '/*', set: [['x-frame-options', 'DENY']], detach: [] }],
  staticCacheControl: 'public, max-age=0, must-revalidate',
};

const routes: Record<string, Route> = {
  '/blog': { route: '/blog', type: 'page', params: [], prerender: false, isIndex: false },
  '/en': { route: '/[locale]', type: 'page', params: ['locale'], prerender: false, isIndex: true },
  '/about': { route: '/about', type: 'page', params: [], prerender: true, isIndex: false },
};

type Rendered = { url: string; method: string; body: string; clientAddress?: string };

function setup({ deploy = true, renderThrows = false } = {}) {
  const rendered: Rendered[] = [];
  const fetched: string[] = [];
  const logged: string[] = [];
  let errorPageFetch: ((url: string) => Promise<Response>) | undefined;
  const middleware = createMiddleware({
    app: {
      match: (request) => routes[new URL(request.url).pathname],
      render: async (request, options) => {
        if (renderThrows) throw new Error('render failed');
        errorPageFetch = options.prerenderedErrorPageFetch;
        rendered.push({
          url: request.url,
          method: request.method,
          body: await request.text(),
          ...(options.clientAddress ? { clientAddress: options.clientAddress } : {}),
        });
        return new Response('rendered', { headers: { 'set-cookie': 'a=1' } });
      },
    },
    site: () => site,
    deploy: () => {
      if (!deploy) throw new Error('missing');
      return { assetPrefix: 'deploys/abc' };
    },
    fetchPage: async (url) => {
      fetched.push(url.href);
      return url.pathname === '/404.html'
        ? new Response('not found page')
        : new Response(null, { status: 404 });
    },
    log: (line) => logged.push(line),
  });
  return { middleware, rendered, fetched, logged, errorPage: () => errorPageFetch };
}

function originRequest(path: string, init: RequestInit = {}) {
  return new Request(`${STORAGE}${path}`, {
    ...init,
    headers: {
      host: HOST,
      'cdn-host': HOST,
      'x-forwarded-proto': 'https',
      'x-real-ip': '203.0.113.7',
      ...init.headers,
    },
  });
}

async function hand(middleware: ReturnType<typeof setup>['middleware'], path: string) {
  const result = await middleware.onOriginRequest({ request: originRequest(path) });
  assert.ok(result instanceof Request, `expected a rewrite for ${path}`);
  return result;
}

test('a stored file is read from the deploy folder, and the visitor path travels to the response hook', async () => {
  const { middleware } = setup();
  const rewritten = await hand(middleware, '/robots.txt?v=2');
  const url = new URL(rewritten.url);
  assert.equal(url.origin, STORAGE);
  assert.equal(url.pathname, '/deploys/abc/robots.txt');
  assert.equal(url.searchParams.get('__bunny_path'), '/robots.txt?v=2');
});

test('the response hook applies _headers and the static Cache-Control to a stored file', async () => {
  const { middleware } = setup();
  const request = await hand(middleware, '/robots.txt');
  const response = await middleware.onOriginResponse({ request, response: new Response('txt') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('cache-control'), site.staticCacheControl);
});

test('a file under build.assets is immutable', async () => {
  const { middleware } = setup();
  const request = await hand(middleware, '/_astro/app.Ab12.js');
  const response = await middleware.onOriginResponse({ request, response: new Response('js') });
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('a prerendered page is read by its source name', async () => {
  const { middleware } = setup();
  const request = await hand(middleware, '/about');
  assert.equal(new URL(request.url).pathname, '/deploys/abc/about/index.html');
});

test('an on-demand page renders at the visitor URL with the client address, and leaves private', async () => {
  const { middleware, rendered } = setup();
  const response = await middleware.onOriginRequest({ request: originRequest('/blog?page=2') });
  assert.ok(response instanceof Response);
  assert.deepEqual(rendered, [
    {
      url: `https://${HOST}/blog?page=2`,
      method: 'GET',
      body: '',
      clientAddress: '203.0.113.7',
    },
  ]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('a POST renders with its body', async () => {
  const { middleware, rendered } = setup();
  await middleware.onOriginRequest({
    request: originRequest('/blog', { method: 'POST', body: 'name=a' }),
  });
  assert.equal(rendered[0]?.method, 'POST');
  assert.equal(rendered[0]?.body, 'name=a');
});

test('a storage 404 under a catch-all route renders the page', async () => {
  const { middleware, rendered } = setup();
  const request = await hand(middleware, '/en');
  const response = await middleware.onOriginResponse({
    request,
    response: new Response('', { status: 404 }),
  });
  assert.equal(await response.text(), 'rendered');
  assert.equal(rendered[0]?.url, `https://${HOST}/en`);
});

test('a path nothing claims answers the prerendered 404 page through the CDN, with status 404', async () => {
  const { middleware, fetched } = setup();
  const request = await hand(middleware, '/nope');
  const response = await middleware.onOriginResponse({
    request,
    response: new Response('', { status: 404 }),
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'not found page');
  assert.deepEqual(fetched, [`https://${HOST}/404.html`]);
});

test('a missing 404 page answers a plain 404 instead of fetching itself again', async () => {
  const { middleware, fetched } = setup();
  const request = await hand(middleware, '/404.html');
  const response = await middleware.onOriginResponse({
    request,
    response: new Response('', { status: 404 }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(fetched, []);
});

for (const path of ['/_headers', '/_redirects', '/_bunny/x']) {
  test(`${path} answers 404 with the prerendered 404 page`, async () => {
    const { middleware } = setup();
    const request = await hand(middleware, path);
    assert.equal(new URL(request.url).pathname, '/deploys/abc/404.html');
    const response = await middleware.onOriginResponse({ request, response: new Response('page') });
    assert.equal(response.status, 404);
  });
}

test('a _redirects rule answers a redirect, keeping the query', async () => {
  const { middleware } = setup();
  const response = await middleware.onOriginRequest({ request: originRequest('/old?a=1') });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/new?a=1');
  assert.equal(response.headers.get('cache-control'), site.staticCacheControl);
});

test('without the deploy global a request answers 500, private, without reading anything', async () => {
  const { middleware, fetched, logged } = setup({ deploy: false });
  const response = await middleware.onOriginRequest({ request: originRequest('/robots.txt') });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(fetched, []);
  assert.equal(logged.length, 1);
});

test('a throw while rendering answers 500, private, and logs it', async () => {
  const { middleware, logged } = setup({ renderThrows: true });
  const response = await middleware.onOriginRequest({ request: originRequest('/blog') });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(logged.join('\n'), /render failed/);
});

test("Astro's error page fetch reads the prerendered page through the CDN", async () => {
  const { middleware, errorPage, fetched } = setup();
  await middleware.onOriginRequest({ request: originRequest('/blog') });
  const response = await errorPage()?.(`https://${HOST}/404.html`);
  assert.equal(response?.status, 200);
  assert.deepEqual(fetched, [`https://${HOST}/404.html`]);
});
