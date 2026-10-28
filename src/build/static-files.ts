/**
 * `_redirects` and `_headers`, for a build that deploys no script.
 *
 * A fully prerendered site goes up as plain files, and the `bunny sites` router
 * serves them. The router is framework-neutral: it reads these two file names,
 * which are the names a static host reads, and it reads nothing shaped like
 * Astro. So the two things a static Astro build cannot express on its own -- a
 * redirect with a real status, and a response header -- are written here.
 *
 * Only the subset every host agrees on is written: one rule per line, a path, a
 * target, and a status. `!` after the status forces the rule over a file at the
 * same path, which is what a redirect needs: Astro also writes a meta-refresh
 * page there, and that page would answer 200 and send the visitor on with a
 * `<meta>` tag instead of a `Location` header.
 */
import { writeFile } from 'node:fs/promises';
import type { HeaderPayload, RouteToHeaders } from 'astro';
import { stripBase } from '../runtime/paths.js';

/** Both hosts read these names, and so does the `bunny sites` router. */
export const REDIRECTS_FILE = '_redirects';
export const HEADERS_FILE = '_headers';

/**
 * A header the file must not carry.
 *
 * `content-type` comes from the object's extension, with a charset the router
 * knows and Astro's plain `text/html` would lose. `content-length` and the
 * encodings describe the body the origin sends, and this file is applied to a
 * body the router never re-encodes.
 */
const NOT_OURS = new Set([
	'content-type',
	'content-length',
	'content-encoding',
	'transfer-encoding',
]);

/**
 * The status Astro would answer a redirect with.
 *
 * Astro picks 301 for `GET` and 308 for anything else when the route configures
 * no status. A file holds one number, and a visitor arrives with `GET`, so the
 * configured status wins and 301 is the fallback.
 */
function redirectStatus(route: HeaderPayload['route']): number {
	const { redirect, redirectRoute } = route;
	if (redirectRoute && typeof redirect === 'object' && redirect?.status) {
		return redirect.status;
	}
	return 301;
}

export interface StaticFileOptions {
	/** `config.build.assets`, the directory holding hashed files. */
	assetsDir: string;
	/** What those files may be cached for. */
	assetCacheControl: string;
}

/**
 * The two files' contents, or `null` for a file with nothing to say.
 *
 * Pure, so the unit test covers it without a build.
 */
export function staticFiles(
	routeToHeaders: RouteToHeaders | null,
	base: string,
	options: StaticFileOptions,
): { redirects: string | null; headers: string | null } {
	const redirectLines: string[] = [];
	const headerBlocks: string[] = [];

	for (const [pathname, payload] of routeToHeaders ?? []) {
		// Astro's pathname carries `base`, and a deploy is served from its root.
		const local = stripBase(pathname, base) ?? pathname;

		if (payload.route.type === 'redirect') {
			const to = payload.headers.get('location');
			if (!to) continue;
			// `!` forces the rule over the meta-refresh page Astro wrote here.
			redirectLines.push(`${local} ${to} ${redirectStatus(payload.route)}!`);
			continue;
		}

		const entries = [...payload.headers.entries()].filter(
			([name]) => !NOT_OURS.has(name.toLowerCase()),
		);
		if (entries.length === 0) continue;
		headerBlocks.push([local, ...entries.map(([name, value]) => `  ${name}: ${value}`)].join('\n'));
	}

	// The hashed asset directory. Nothing else in a build can be cached forever,
	// and the router will not guess which directory that is.
	const assets = options.assetsDir.replace(/^\/+|\/+$/g, '');
	if (assets !== '') {
		headerBlocks.unshift(`/${assets}/*\n  Cache-Control: ${options.assetCacheControl}`);
	}

	const note = '# Written by the Bunny Astro adapter. Edit the Astro config, not this file.';
	return {
		redirects: redirectLines.length > 0 ? `${note}\n${redirectLines.join('\n')}\n` : null,
		headers: headerBlocks.length > 0 ? `${note}\n${headerBlocks.join('\n')}\n` : null,
	};
}

/**
 * Write both files into the client build, and report what was written.
 *
 * The files go beside the pages, because the deploy uploads that directory and
 * the router reads them from the deploy it is serving.
 */
export async function writeStaticFiles(
	clientDir: URL,
	routeToHeaders: RouteToHeaders | null,
	base: string,
	options: StaticFileOptions,
): Promise<string[]> {
	const contents = staticFiles(routeToHeaders, base, options);
	const written: string[] = [];
	for (const [name, body] of [
		[REDIRECTS_FILE, contents.redirects],
		[HEADERS_FILE, contents.headers],
	] as const) {
		if (body === null) continue;
		await writeFile(new URL(name, clientDir), body);
		written.push(name);
	}
	return written;
}
