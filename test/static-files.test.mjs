/**
 * `_redirects` and `_headers`: what a static build writes for the router.
 *
 * The router is framework-neutral, so these two files are the whole contract
 * between an Astro build and the way its redirects and headers are served.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { staticFiles } from '../dist/build/static-files.js';

const OPTIONS = {
	assetsDir: '_astro',
	assetCacheControl: 'public, max-age=31536000, immutable',
};

/** A `routeToHeaders` entry for a page. */
function page(pathname, headers) {
	return [pathname, { headers: new Headers(headers), route: { type: 'page' } }];
}

/** A `routeToHeaders` entry for a redirect Astro prerendered. */
function redirect(pathname, to, status) {
	return [
		pathname,
		{
			headers: new Headers({ location: to }),
			route: {
				type: 'redirect',
				redirectRoute: { route: to },
				redirect: status === undefined ? to : { status, destination: to },
			},
		},
	];
}

describe('staticFiles', () => {
	it('writes the hashed asset directory even with no routes at all', () => {
		const { redirects, headers } = staticFiles(null, '', OPTIONS);
		assert.equal(redirects, null);
		assert.match(headers, /^\/_astro\/\*$/m);
		assert.match(headers, /^ {2}Cache-Control: public, max-age=31536000, immutable$/m);
	});

	it('names the directory the project configured', () => {
		const { headers } = staticFiles(null, '', { ...OPTIONS, assetsDir: 'chunks' });
		assert.match(headers, /^\/chunks\/\*$/m);
	});

	// `!` forces the rule over a file at the same path. Astro also writes a
	// meta-refresh page there, and that page answers 200.
	it('forces every redirect, so it beats the page Astro wrote', () => {
		const { redirects } = staticFiles(new Map([redirect('/old', '/about')]), '', OPTIONS);
		assert.match(redirects, /^\/old \/about 301!$/m);
	});

	it('keeps the status the route configured', () => {
		const { redirects } = staticFiles(new Map([redirect('/gone', '/about', 302)]), '', OPTIONS);
		assert.match(redirects, /^\/gone \/about 302!$/m);
	});

	// Astro answers 301 for GET and 308 for anything else when the route names no
	// status. A file holds one number, and a visitor arrives with GET.
	it('writes 301 when the route named no status', () => {
		const { redirects } = staticFiles(new Map([redirect('/old', '/about')]), '', OPTIONS);
		assert.match(redirects, /301!/);
	});

	it('skips a redirect with no destination', () => {
		const entry = ['/broken', { headers: new Headers(), route: { type: 'redirect' } }];
		const { redirects } = staticFiles(new Map([entry]), '', OPTIONS);
		assert.equal(redirects, null);
	});

	it("writes a page's headers under its path", () => {
		const { headers } = staticFiles(
			new Map([page('/about', { 'content-security-policy': "script-src 'self'" })]),
			'',
			OPTIONS,
		);
		assert.match(headers, /^\/about\n {2}content-security-policy: script-src 'self'$/m);
	});

	// The router works the content type out from the object's extension, and its
	// answer carries a charset that Astro's plain `text/html` would lose. The
	// lengths and encodings describe a body the router never re-encodes.
	it('leaves out the headers that describe the body', () => {
		const { headers } = staticFiles(
			new Map([
				page('/about', {
					'content-type': 'text/html',
					'content-length': '12',
					'content-encoding': 'gzip',
				}),
			]),
			'',
			OPTIONS,
		);
		assert.doesNotMatch(headers, /content-type|content-length|content-encoding/i);
		// Only the asset rule is left, so the page contributes no empty block.
		assert.doesNotMatch(headers, /^\/about$/m);
	});

	// Astro's pathname carries `base`, and a deploy is served from its own root.
	it('removes base from every path', () => {
		const { redirects, headers } = staticFiles(
			new Map([
				redirect('/docs/old', '/docs/about'),
				page('/docs/about', { 'x-frame-options': 'DENY' }),
			]),
			'/docs',
			OPTIONS,
		);
		assert.match(redirects, /^\/old /m);
		assert.match(headers, /^\/about$/m);
	});
});
