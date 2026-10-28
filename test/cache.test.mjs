import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import bunnyCacheProvider from '../dist/cache.js';

const request = (path = '/products/socks') => new Request(`https://example.test${path}`);

describe('setHeaders', () => {
	const provider = bunnyCacheProvider();

	it('gives the CDN a lifetime and the browser none', () => {
		const headers = provider.setHeaders({ maxAge: 60, swr: 600 }, request());
		const value = headers.get('cache-control');
		assert.match(value, /s-maxage=60/);
		assert.match(value, /stale-while-revalidate=600/);
		assert.match(value, /max-age=0/);
		assert.match(value, /must-revalidate/);
	});

	it('lets the browser cache when that is asked for', () => {
		const headers = bunnyCacheProvider({ browserMaxAge: 30 }).setHeaders({ maxAge: 60 }, request());
		assert.match(headers.get('cache-control'), /max-age=30/);
		assert.doesNotMatch(headers.get('cache-control'), /must-revalidate/);
	});

	it('always tags the path, so invalidate({ path }) can work', () => {
		const headers = provider.setHeaders({}, request('/a/b'));
		assert.equal(headers.get('cdn-tag'), 'astro-path:/a/b');
	});

	it("adds the route's own tags first", () => {
		const headers = provider.setHeaders({ tags: ['products', 'socks'] }, request());
		assert.equal(headers.get('cdn-tag'), 'products,socks,astro-path:/products/socks');
	});

	it('stops before bunny.net would truncate the header', () => {
		// A truncated tag never matches a purge, which fails silently.
		const tags = Array.from({ length: 200 }, (_, index) => `tag-${index}-${'x'.repeat(20)}`);
		const value = provider.setHeaders({ tags }, request()).get('cdn-tag');
		assert.ok(new TextEncoder().encode(value).length <= 1024, `${value.length} bytes`);
		assert.ok(
			value.split(',').every((tag) => tags.includes(tag)),
			'a tag was cut in half',
		);
	});

	it('passes the conditional headers through', () => {
		const lastModified = new Date('2026-01-02T03:04:05Z');
		const headers = provider.setHeaders({ etag: '"abc"', lastModified }, request());
		assert.equal(headers.get('etag'), '"abc"');
		assert.equal(headers.get('last-modified'), lastModified.toUTCString());
	});
});

describe('invalidate', () => {
	it('does nothing when there is nothing to purge', async () => {
		await bunnyCacheProvider().invalidate({});
	});

	it('explains what is missing rather than failing quietly', async () => {
		delete process.env.BUNNY_API_KEY;
		delete process.env.BUNNY_PULLZONE_ID;
		await assert.rejects(
			() => bunnyCacheProvider().invalidate({ tags: ['products'] }),
			/BUNNY_API_KEY and BUNNY_PULLZONE_ID/,
		);
	});

	it('purges each tag, and the path as a tag', async () => {
		process.env.BUNNY_API_KEY = 'key';
		process.env.BUNNY_PULLZONE_ID = '42';
		const calls = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(init.body), key: init.headers.AccessKey });
			return new Response(null, { status: 204 });
		};

		try {
			await bunnyCacheProvider().invalidate({ tags: 'products', path: '/a' });
		} finally {
			globalThis.fetch = realFetch;
			delete process.env.BUNNY_API_KEY;
			delete process.env.BUNNY_PULLZONE_ID;
		}

		assert.equal(calls.length, 2);
		assert.equal(calls[0].url, 'https://api.bunny.net/pullzone/42/purgeCache');
		assert.equal(calls[0].key, 'key');
		assert.deepEqual(calls.map((call) => call.body.CacheTag).sort(), ['astro-path:/a', 'products']);
	});
});
