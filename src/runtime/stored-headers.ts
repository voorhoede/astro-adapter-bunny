/**
 * The headers a stored object is served with.
 *
 * Bunny Storage sends no `Cache-Control` and holds no headers of its own, so
 * the script decides both: which files may be cached for good, and which
 * headers every response carries.
 */
import { contentType } from './mime.js';
import type { BuildManifest, RuntimeOptions } from './types.js';

/** Only a file in Astro's assets directory has a hash in its name; every other file changes under the same name. */
function isHashedAsset(object: string, assetsDir: string): boolean {
	return object.startsWith(`${assetsDir}/`);
}

export function storedHeaders(
	object: string,
	upstream: Response,
	options: Pick<RuntimeOptions, 'assetsDir' | 'assetCacheControl' | 'pageCacheControl' | 'headers'>,
	build: Pick<BuildManifest, 'headers'>,
): Headers {
	const headers = new Headers({
		'content-type': contentType(object),
		'cache-control': isHashedAsset(object, options.assetsDir) ? options.assetCacheControl : options.pageCacheControl,
		// Say the object can be fetched in pieces. A pull zone will not slice an
		// object, and will not answer a range from its cache, unless the origin
		// says it may.
		'accept-ranges': 'bytes',
	});

	// Let the pull zone and the browser revalidate instead of re-downloading,
	// and let them ask for one piece at a time.
	for (const name of ['etag', 'last-modified', 'content-range']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}

	// Only when the body arrives as it is stored. A decompressed body is a
	// different length from the one the header names.
	if (!upstream.headers.get('content-encoding')) {
		const length = upstream.headers.get('content-length');
		if (length) headers.set('content-length', length);
	}

	// Headers every file carries, such as HSTS.
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		headers.set(name, value);
	}

	// Headers Astro asked for on this prerendered page, such as a CSP.
	for (const [name, value] of build.headers?.[object] ?? []) {
		headers.set(name, value);
	}

	return headers;
}
