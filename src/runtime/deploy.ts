/**
 * Which deploy this script is.
 *
 * `bunny lab deploy astro` uploads each build to its own folder in the storage zone, and
 * writes the folder's name into the top of the bundle:
 *
 * ```js
 * globalThis.__BUNNY_DEPLOY__ = { id: "a1b2c3d4", assetPrefix: "deploys/a1b2c3d4" };
 * ```
 *
 * So the code and the files it was built against cannot drift apart. Publishing
 * an earlier release restores that release's prefix in the same operation, which
 * is what makes a rollback one step.
 *
 * A hand-rolled deploy sets nothing, and the prefix is empty. The script then
 * reads the zone root, which is where an upload without deploys puts the build.
 */

/** What the CLI injects. Every field is optional, because nothing may depend on it. */
export interface DeployInfo {
	/** The deploy's ID. */
	id?: string;
	/** Folder in the zone that holds this deploy's files, with no slashes around it. */
	assetPrefix?: string;
	/** The site's name. */
	site?: string;
	/** `production`, or the name of a preview environment. */
	environment?: string;
}

declare const Deno: { env: { get(key: string): string | undefined } } | undefined;
declare const process: { env: Record<string, string | undefined> } | undefined;

function env(key: string): string | undefined {
	if (typeof Deno !== 'undefined') return Deno.env.get(key);
	if (typeof process !== 'undefined') return process.env[key];
	return undefined;
}

/** The injected object, or an empty one. */
export function deployInfo(): DeployInfo {
	const injected = (globalThis as { __BUNNY_DEPLOY__?: DeployInfo }).__BUNNY_DEPLOY__;
	return injected && typeof injected === 'object' ? injected : {};
}

/**
 * The folder this deploy's files live in, as `""` or `deploys/a1b2c3d4`.
 *
 * The injected value wins, because it travels with the code. The environment
 * variable is the escape hatch for a deploy that does not go through the CLI.
 */
export function assetPrefix(): string {
	const raw = deployInfo().assetPrefix ?? env('BUNNY_ASSET_PREFIX') ?? '';
	return raw.replace(/^\/+|\/+$/g, '');
}
