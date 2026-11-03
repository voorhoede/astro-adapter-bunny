import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { runScript, type RequestSpec, type ScriptResponse } from '../../harness/run-script.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const script = join(root, 'dist/index.js');
const client = join(root, 'dist/client');

async function answer(request: string | RequestSpec, options = {}): Promise<ScriptResponse> {
  const run = await runScript(script, [request], { client, ...options });
  assert.equal(run.error, undefined);
  const [response] = run.responses;
  assert.ok(response);
  return response;
}

for (const type of ['middleware', 'standalone'] as const) {
  describe(`the routing fixture as a ${type} script`, () => {
    before(async () => {
      process.env.TEST_SCRIPT = type;
      await build({ root, logLevel: 'error' });
    });

    test('a file an integration writes after the adapter wins over the [locale] route', async () => {
      const response = await answer('/sitemap-index.xml');
      assert.equal(response.status, 200);
      assert.match(response.body, /<sitemapindex>/);
    });

    test('the [locale] route renders when storage has no file, and leaves private', async () => {
      const response = await answer('/en');
      assert.equal(response.status, 200);
      assert.match(response.body, /locale en/);
      assert.equal(response.headers['cache-control'], 'private, no-store');
    });

    test('a prerendered page comes from storage with _headers and the static Cache-Control', async () => {
      const response = await answer('/about');
      assert.equal(response.status, 200);
      assert.match(response.body, /about/);
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.equal(response.headers['cache-control'], 'public, max-age=0, must-revalidate');
    });

    test('a file under build.assets is immutable', async () => {
      const [asset] = await readdir(join(client, '_astro'));
      assert.ok(asset);
      const response = await answer(`/_astro/${asset}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    test('a _redirects rule redirects a path no on-demand route claims', async () => {
      const response = await answer('/old/page');
      assert.equal(response.status, 301);
      assert.equal(response.headers.location, '/about');
    });

    test('a POST from the site itself passes Astro origin check and keeps its body', async () => {
      const response = await answer({
        path: '/api/echo',
        method: 'POST',
        headers: { origin: 'https://example.com', 'content-type': 'text/plain' },
        body: 'hello',
      });
      assert.equal(response.status, 200);
      assert.equal(response.body, 'hello');
    });

    test('a page setting two cookies keeps both, and is never cached', async () => {
      const response = await answer('/cookies');
      assert.equal(response.setCookies.length, 2);
      assert.equal(response.headers['cache-control'], 'private, no-store');
    });

    test('a path nothing claims answers the prerendered 404 page with status 404', async () => {
      const response = await answer('/a/b/c');
      assert.equal(response.status, 404);
      assert.match(response.body, /not found page/);
    });

    for (const path of [
      '/_headers',
      '/_redirects',
      '/_bunny/x',
      '/deploys/test/about/index.html',
    ]) {
      test(`${path} answers 404, never the stored file`, async () => {
        const response = await answer(path);
        assert.equal(response.status, 404);
        assert.doesNotMatch(response.body, /^\/\*|\/old|<p>about/);
      });
    }

    test('a request tries one stored file, and a miss with nothing to render adds only the 404 page', async () => {
      const paths = ['/about', '/sitemap-index.xml', '/en', '/a/b/c'];
      const run = await runScript(script, paths, { client });
      assert.deepEqual(
        run.responses.map((response) => response.reads),
        [1, 1, 1, 2],
      );
    });

    if (type === 'standalone') {
      test('a type the Storage API does not know is taken from the file extension', async () => {
        const response = await answer('/site.webmanifest');
        assert.equal(response.status, 200);
        assert.equal(response.headers['content-type'], 'application/manifest+json');
      });
    }

    test('without the deploy global a request answers 500, private, and reads nothing', async () => {
      const response = await answer('/about', { deploy: false });
      assert.equal(response.status, 500);
      assert.equal(response.headers['cache-control'], 'private, no-store');
      assert.equal(response.reads, 0);
    });
  });
}
