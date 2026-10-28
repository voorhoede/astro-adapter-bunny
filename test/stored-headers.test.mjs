/**
 * The headers a stored object is served with: the cache policy for its kind of
 * file, the headers every file carries, and the ones Astro asked for on a page.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { storedHeaders } from '../dist/runtime/stored-headers.js';

const OPTIONS = {
	assetsDir: '_astro',
	assetCacheControl: 'public, max-age=31536000, immutable',
	pageCacheControl: 'public, max-age=0, must-revalidate',
	headers: { 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload' },
};
const BUILD = { assets: null, redirects: null, headers: { 'cms/editor-guide/index.html': [['content-security-policy', "frame-ancestors 'self' https://*.datocms.com"]] } };

const serve = (object, upstreamHeaders = {}, options = OPTIONS, build = BUILD) =>
	storedHeaders(object, new Response('', { headers: upstreamHeaders }), options, build);

describe('storedHeaders', () => {
	it('caches only the hashed assets for good', () => {
		assert.equal(serve('_astro/Default.C5ZiIY0p.css').get('cache-control'), OPTIONS.assetCacheControl);
		assert.equal(serve('_astro/archivo.woff2').get('cache-control'), OPTIONS.assetCacheControl);
	});

	it('gives every other file the page policy, since its name does not change with its content', () => {
		for (const object of ['en/index.html', 'robots.txt', 'sitemap-index.xml', 'service-worker.js', 'editor-guide/body-blocks.png']) {
			assert.equal(serve(object).get('cache-control'), OPTIONS.pageCacheControl, object);
		}
	});

	it('follows the configured assets directory', () => {
		const options = { ...OPTIONS, assetsDir: 'static' };
		assert.equal(serve('static/app.js', {}, options).get('cache-control'), OPTIONS.assetCacheControl);
		assert.equal(serve('_astro/app.js', {}, options).get('cache-control'), OPTIONS.pageCacheControl);
	});

	it('adds the headers every file carries', () => {
		assert.equal(serve('_astro/Default.css').get('strict-transport-security'), OPTIONS.headers['strict-transport-security']);
		assert.equal(serve('robots.txt').get('strict-transport-security'), OPTIONS.headers['strict-transport-security']);
	});

	it('lets a header Astro set on a page win over the one every file carries', () => {
		const options = { ...OPTIONS, headers: { ...OPTIONS.headers, 'content-security-policy': "frame-ancestors 'self'" } };
		assert.equal(serve('en/index.html', {}, options).get('content-security-policy'), "frame-ancestors 'self'");
		assert.equal(serve('cms/editor-guide/index.html', {}, options).get('content-security-policy'), "frame-ancestors 'self' https://*.datocms.com");
	});

	it('works without the headers option', () => {
		const { headers: _omitted, ...options } = OPTIONS;
		assert.equal(serve('robots.txt', {}, options).get('strict-transport-security'), null);
	});

	it('names the type, allows ranges, and passes the validators through', () => {
		const headers = serve('_astro/Default.css', { etag: '"abc"', 'last-modified': 'Tue, 14 Oct 2026 10:00:00 GMT', 'content-length': '6' });
		assert.equal(headers.get('content-type'), 'text/css; charset=utf-8');
		assert.equal(headers.get('accept-ranges'), 'bytes');
		assert.equal(headers.get('etag'), '"abc"');
		assert.equal(headers.get('last-modified'), 'Tue, 14 Oct 2026 10:00:00 GMT');
		assert.equal(headers.get('content-length'), '6');
	});

	it('drops the length of a body that arrives compressed', () => {
		assert.equal(serve('robots.txt', { 'content-length': '6', 'content-encoding': 'br' }).get('content-length'), null);
	});
});
