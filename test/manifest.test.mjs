import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManifest, mapsByObject, listFiles } from '../dist/build/manifest.js';

/** Astro's `routeToHeaders`: a map from route pathname to its headers. */
function routeHeaders(entries) {
	return new Map(
		entries.map(([pathname, headers, route = {}]) => [
			pathname,
			{ headers: new Headers(headers), route: { type: 'page', ...route } },
		]),
	);
}

/** One prerendered redirect, as Astro hands it over. */
function redirectRoute(pathname, to, redirect = to) {
	return [
		pathname,
		{ location: to },
		{ type: 'redirect', redirect, redirectRoute: { pathname: to } },
	];
}

async function fixture(files) {
	const dir = await mkdtemp(path.join(tmpdir(), 'bunny-manifest-'));
	for (const [name, body] of Object.entries(files)) {
		const target = path.join(dir, name);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, body);
	}
	return dir;
}

describe('listFiles', () => {
	it('lists every file as a POSIX path', async () => {
		const dir = await fixture({
			'index.html': 'a',
			'_astro/app.css': 'b',
			'blog/post/index.html': 'c',
		});
		assert.deepEqual((await listFiles(dir)).sort(), [
			'_astro/app.css',
			'blog/post/index.html',
			'index.html',
		]);
	});

	it('returns nothing for a folder that is not there', async () => {
		assert.deepEqual(await listFiles('/tmp/definitely-not-a-build-output'), []);
	});
});

describe('mapsByObject', () => {
	it('registers both build formats, because either could be on disk', () => {
		const { headers } = mapsByObject(
			routeHeaders([['/about', { 'content-security-policy': "default-src 'self'" }]]),
		);
		assert.deepEqual(Object.keys(headers).sort(), ['about.html', 'about/index.html']);
		assert.deepEqual(headers['about.html'], [['content-security-policy', "default-src 'self'"]]);
	});

	it('drops the content type, which the script works out itself', () => {
		// Astro's plain `text/html` would lose the charset the script adds.
		const { headers } = mapsByObject(routeHeaders([['/about', { 'content-type': 'text/html' }]]));
		assert.deepEqual(headers, {});
	});

	it('skips a route with no headers', () => {
		assert.deepEqual(mapsByObject(routeHeaders([['/about', {}]])).headers, {});
	});

	it('removes the base prefix, which the build never writes to disk', () => {
		const { headers } = mapsByObject(
			routeHeaders([['/docs/about', { 'x-robots-tag': 'noindex' }]]),
			'/docs',
		);
		assert.deepEqual(Object.keys(headers).sort(), ['about.html', 'about/index.html']);
	});

	it('keeps a pathname that does not start with the base', () => {
		const { headers } = mapsByObject(
			routeHeaders([['/about', { 'x-robots-tag': 'noindex' }]]),
			'/docs',
		);
		assert.deepEqual(Object.keys(headers).sort(), ['about.html', 'about/index.html']);
	});

	it('pulls a redirect out of the headers, so it is not served as a page', () => {
		const { headers, redirects } = mapsByObject(routeHeaders([redirectRoute('/old', '/new')]));
		assert.deepEqual(headers, {});
		assert.deepEqual(redirects['old/index.html'], { to: '/new', status: null });
		assert.deepEqual(redirects['old.html'], { to: '/new', status: null });
	});

	it('keeps the status the route configured', () => {
		const { redirects } = mapsByObject(
			routeHeaders([redirectRoute('/gone', '/new', { status: 302, destination: '/new' })]),
		);
		assert.equal(redirects['gone/index.html'].status, 302);
	});

	it('uses the destination Astro resolved, so parameters are already filled in', () => {
		const { redirects } = mapsByObject(routeHeaders([redirectRoute('/legacy/a', '/new/a')]));
		assert.equal(redirects['legacy/a/index.html'].to, '/new/a');
	});

	it('ignores a redirect route with no destination', () => {
		const { redirects } = mapsByObject(
			routeHeaders([['/old', {}, { type: 'redirect', redirect: '/new' }]]),
		);
		assert.deepEqual(redirects, {});
	});
});

describe('buildManifest', () => {
	it('inlines the file list and the headers', async () => {
		const dir = await fixture({ 'index.html': 'a', '404.html': 'b' });
		const manifest = await buildManifest(
			pathToFileURL(dir + '/'),
			routeHeaders([['/404', { 'x-robots-tag': 'noindex' }]]),
			100,
		);
		assert.deepEqual(manifest.assets, ['404.html', 'index.html']);
		assert.deepEqual(manifest.headers['404.html'], [['x-robots-tag', 'noindex']]);
	});

	it('gives up above the limit, so the bundle stays small', async () => {
		const dir = await fixture({ 'a.html': 'a', 'b.html': 'b', 'c.html': 'c' });
		const manifest = await buildManifest(pathToFileURL(dir + '/'), null, 2);
		assert.equal(manifest.assets, null);
	});

	it('holds no headers and no redirects when there are none', async () => {
		const dir = await fixture({ 'index.html': 'a' });
		const manifest = await buildManifest(pathToFileURL(dir + '/'), null, 100);
		assert.equal(manifest.headers, null);
		assert.equal(manifest.redirects, null);
	});

	it('inlines the redirects', async () => {
		const dir = await fixture({ 'old/index.html': 'a' });
		const manifest = await buildManifest(
			pathToFileURL(dir + '/'),
			routeHeaders([redirectRoute('/old', '/new')]),
			100,
		);
		assert.equal(manifest.headers, null);
		assert.equal(manifest.redirects['old/index.html'].to, '/new');
	});
});
