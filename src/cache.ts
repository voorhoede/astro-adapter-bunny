/**
 * An Astro cache provider backed by the bunny.net CDN.
 *
 * Astro's `routeRules` say how long a route may be cached, and under which
 * tags. This provider turns that into headers the pull zone understands, and
 * purges by tag when the site asks it to.
 *
 * ```js
 * // astro.config.mjs
 * export default defineConfig({
 *   adapter: bunny(),
 *   routeRules: {
 *     "/products/[...slug]": { maxAge: 3600, tags: ["products"] },
 *   },
 * });
 * ```
 *
 * ```ts
 * // Purge every product page after an import finishes.
 * await Astro.locals.cache?.invalidate({ tags: ["products"] });
 * ```
 *
 * Purging needs an API key, because it is an account operation and not an edge
 * one:
 *
 * ```bash
 * bunny scripts env set BUNNY_PULLZONE_ID <id>
 * bunny scripts env set BUNNY_API_KEY <key> --secret
 * ```
 *
 * @see https://bunny.net/docs/cdn/purge-cache
 */
import {
	collectInvalidationTags,
	normalizeTags,
	pathTag,
	setConditionalHeaders,
} from 'astro/cache/provider-utils';
import type { CacheOptions, CacheProvider, InvalidateOptions } from 'astro';

/** bunny.net truncates a `CDN-Tag` value past this many bytes. */
const MAX_TAG_BYTES = 1024;

const API = 'https://api.bunny.net';

export interface BunnyCacheConfig {
	/**
	 * How long a browser may keep the page, in seconds. The CDN lifetime comes
	 * from `routeRules`, and this one does not.
	 *
	 * Zero is the useful default: the edge caches the page and can be purged,
	 * while the browser always asks again, so a purge is visible at once.
	 * @default 0
	 */
	browserMaxAge?: number;
}

declare const Deno: { env: { get(key: string): string | undefined } } | undefined;
declare const process: { env: Record<string, string | undefined> } | undefined;

function env(key: string): string | undefined {
	if (typeof Deno !== 'undefined') return Deno.env.get(key);
	if (typeof process !== 'undefined') return process.env[key];
	return undefined;
}

/**
 * Join the tags, and stop before bunny.net truncates the header. A truncated
 * tag would never match a purge, which fails silently and is worse than a tag
 * that was left out.
 */
const encoder = new TextEncoder();

function tagHeader(tags: string[]): string | undefined {
	let value = '';
	for (const tag of tags) {
		const next = value ? `${value},${tag}` : tag;
		if (encoder.encode(next).length > MAX_TAG_BYTES) break;
		value = next;
	}
	return value || undefined;
}

export default function bunnyCacheProvider(config: BunnyCacheConfig = {}): CacheProvider {
	const browserMaxAge = config.browserMaxAge ?? 0;

	async function purgeTag(tag: string): Promise<void> {
		const key = env('BUNNY_API_KEY');
		const pullZone = env('BUNNY_PULLZONE_ID');
		if (!key || !pullZone) {
			throw new Error(
				'Cannot purge the cache. Set BUNNY_API_KEY and BUNNY_PULLZONE_ID on the script.',
			);
		}

		const response = await fetch(`${API}/pullzone/${pullZone}/purgeCache`, {
			method: 'POST',
			headers: { AccessKey: key, 'Content-Type': 'application/json' },
			body: JSON.stringify({ CacheTag: tag }),
		});
		await response.body?.cancel();
		if (!response.ok) {
			throw new Error(`Purge of "${tag}" failed: ${response.status} ${response.statusText}`);
		}
	}

	return {
		name: 'bunny',

		setHeaders(options: CacheOptions, request: Request): Headers {
			const headers = new Headers();

			// `s-maxage` is for the CDN and `max-age` is for the browser. Splitting
			// them is what makes a purge take effect straight away.
			const directives = ['public', `max-age=${browserMaxAge}`];
			if (browserMaxAge === 0) directives.push('must-revalidate');
			if (options.maxAge !== undefined) directives.push(`s-maxage=${options.maxAge}`);
			if (options.swr !== undefined) directives.push(`stale-while-revalidate=${options.swr}`);
			headers.set('Cache-Control', directives.join(', '));

			// The path tag is what lets `invalidate({ path })` work, because
			// bunny.net purges a tag without needing the site's own URL.
			const tags = [...normalizeTags(options.tags), pathTag(new URL(request.url).pathname)];
			const tagValue = tagHeader(tags);
			if (tagValue) headers.set('CDN-Tag', tagValue);

			setConditionalHeaders(headers, options);
			return headers;
		},

		async invalidate(options: InvalidateOptions): Promise<void> {
			const tags = collectInvalidationTags(options);
			if (tags.length === 0) return;
			// One call per tag. bunny.net purges by a single tag at a time.
			await Promise.all(tags.map(purgeTag));
		},
	};
}
