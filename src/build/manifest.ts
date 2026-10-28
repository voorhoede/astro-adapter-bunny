/**
 * What the build knows and the script cannot work out for itself.
 *
 * The script has no disk, so without this it has to ask Storage whether a file
 * exists. Inlining the list turns a guess into a lookup.
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { HeaderPayload, RouteToHeaders } from 'astro';
import { objectCandidates, stripBase } from '../runtime/paths.js';
import type { BuildManifest, RedirectEntry } from '../runtime/types.js';

/** Every file under `dir`, as POSIX paths relative to it. */
export async function listFiles(dir: string, base = dir): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		// A site with no client output at all is unusual, but not an error.
		return [];
	}

	const nested = await Promise.all(
		entries.map(async (entry) => {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) return listFiles(full, base);
			return [path.relative(base, full).split(path.sep).join('/')];
		}),
	);
	return nested.flat();
}

/**
 * The status Astro would answer a redirect with, or `null` when it works that
 * out from the request method.
 *
 * Mirrors Astro's own `computeRedirectStatus`: a configured status wins, and
 * otherwise the method decides.
 */
function redirectStatus(route: HeaderPayload['route']): number | null {
	const { redirect, redirectRoute } = route;
	if (redirectRoute && typeof redirect === 'object' && redirect) return redirect.status;
	return null;
}

/**
 * Turn Astro's route-to-headers map into two object-path maps: the extra
 * headers for a stored page, and the prerendered redirects.
 *
 * Astro keys the map by route pathname, and the script sees object paths. The
 * build format decides which of the two candidates a page was written as, so
 * both are registered and the one that exists wins.
 *
 * A redirect route is pulled out of the header map. Its `Location` header is
 * the whole point of it, and a page carrying `Location` with status 200 sends
 * the visitor nowhere.
 */
export function mapsByObject(
	routeToHeaders: RouteToHeaders,
	base = '',
): {
	headers: Record<string, [string, string][]>;
	redirects: Record<string, RedirectEntry>;
} {
	const headers: Record<string, [string, string][]> = {};
	const redirects: Record<string, RedirectEntry> = {};

	for (const [pathname, payload] of routeToHeaders) {
		// Astro's pathname carries `base`, and the object on disk does not.
		const local = stripBase(pathname, base) ?? pathname;

		if (payload.route.type === 'redirect') {
			const to = payload.headers.get('location');
			if (!to) continue;
			const entry: RedirectEntry = { to, status: redirectStatus(payload.route) };
			for (const object of objectCandidates(local)) redirects[object] = entry;
			continue;
		}

		const entries = [...payload.headers.entries()].filter(
			// The script works the content type out from the object's extension, and
			// its answer carries a charset. Astro's plain `text/html` would lose it.
			([name]) => name.toLowerCase() !== 'content-type',
		) as [string, string][];
		if (entries.length === 0) continue;
		for (const object of objectCandidates(local)) {
			headers[object] = entries;
		}
	}
	return { headers, redirects };
}

/**
 * Build the manifest that gets inlined into the bundle.
 *
 * A very large site gets `assets: null`, and the script goes back to probing
 * Storage. Ten thousand paths cost roughly 300 kB of the 10 MB budget, so the
 * limit protects the script rather than the build.
 */
export async function buildManifest(
	clientDir: URL,
	routeToHeaders: RouteToHeaders | null,
	limit: number,
	base = '',
): Promise<BuildManifest> {
	const files = await listFiles(fileURLToPath(clientDir));
	const maps = routeToHeaders ? mapsByObject(routeToHeaders, base) : null;

	/** Drop an empty map, so it costs no bytes in the bundle. */
	const orNull = <T extends object>(value: T | undefined): T | null =>
		value && Object.keys(value).length > 0 ? value : null;

	return {
		assets: files.length > limit ? null : files.sort(),
		headers: orNull(maps?.headers),
		redirects: orNull(maps?.redirects),
	};
}
