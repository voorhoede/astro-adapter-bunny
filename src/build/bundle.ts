/**
 * The esbuild step that turns Astro's server output into the single file Edge
 * Scripting accepts.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type { BuildOptions } from 'esbuild';
import type { BuildManifest } from '../runtime/types.js';
import type { BunnyAdapterOptions } from '../types.js';

/**
 * Deno provides these under their `node:` names only, so a bare import from a
 * dependency is rewritten during the server build.
 */
export const NODE_BUILTINS = [
	'assert',
	'assert/strict',
	'async_hooks',
	'buffer',
	'console',
	'constants',
	'crypto',
	'diagnostics_channel',
	'dns',
	'events',
	'fs',
	'fs/promises',
	'http',
	'http2',
	'https',
	'module',
	'net',
	'os',
	'path',
	'path/posix',
	'path/win32',
	'perf_hooks',
	'process',
	'punycode',
	'querystring',
	'readline',
	'stream',
	'stream/promises',
	'stream/web',
	'string_decoder',
	'sys',
	'timers',
	'timers/promises',
	'tls',
	'tty',
	'url',
	'util',
	'util/types',
	'worker_threads',
	'zlib',
];

/** Edge Scripting refuses a script above this size. */
export const SIZE_LIMIT = 10 * 1024 * 1024;

/**
 * Above this, a published script often misses its 500 ms startup budget, and the
 * edge answers 400 with an empty body. Every byte of a script is parsed and
 * evaluated before it answers anything, so the size that fits depends on what
 * the code does as it loads.
 *
 * Measured in August 2026, on a standalone script in DE, in the units this
 * adapter prints: the same code at 7.44 MB (7,798,944 bytes) served every
 * request, and at 7.83 MB (8,209,699 bytes) answered 400 to all of them. Around
 * 7.5 MB the first request failed and later ones worked. The documented limit is
 * 10 MB, and nothing about the real one is reported anywhere, so the adapter
 * says it.
 */
export const START_RISK_SIZE = 7.5 * 1024 * 1024;

export interface BundleParams {
	/** Astro's server entry, for example `dist/server/entry.mjs`. */
	entryPoint: string;
	/** The project root. Relative paths resolve against it. */
	rootDir: string;
	/** Where the single file goes. */
	outPath: string;
	/** Inlined so the script knows what the build produced. */
	manifest: BuildManifest;
	options: BunnyAdapterOptions;
}

export interface BundleResult {
	bytes: number;
	/**
	 * What fills the bundle, largest first, one entry per package. A script above
	 * the limit needs this: "10 MB" is a fact, and "shiki is 4 MB of it" is a
	 * thing you can act on.
	 */
	largest: BundleContributor[];
}

export interface BundleContributor {
	/** A package name, or a path inside the project. */
	name: string;
	bytes: number;
}

/** The package a bundled input belongs to, or its path inside the project. */
function contributorName(input: string): string {
	const parts = input.split('node_modules/');
	if (parts.length === 1)
		return input.startsWith('../') ? input : `this project (${input.split('/')[0]})`;
	const inside = (parts[parts.length - 1] ?? '').split('/');
	return inside[0]?.startsWith('@') ? inside.slice(0, 2).join('/') : (inside[0] ?? input);
}

/** Group the bundle's inputs by package, biggest first. */
export function largestContributors(
	inputs: Record<string, { bytesInOutput: number }>,
	limit: number,
): BundleContributor[] {
	const totals = new Map<string, number>();
	for (const [input, { bytesInOutput }] of Object.entries(inputs)) {
		const name = contributorName(input);
		totals.set(name, (totals.get(name) ?? 0) + bytesInOutput);
	}
	return [...totals]
		.map(([name, bytes]) => ({ name, bytes }))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, limit);
}

/** Bundle the server for the Edge Scripting runtime, which is Deno. */
export async function bundleServer(params: BundleParams): Promise<BundleResult> {
	const { entryPoint, rootDir, outPath, manifest, options } = params;

	// Let esbuild find this package's own dependencies when the project's
	// node_modules does not hoist them. Resolving them to a file path here would
	// pick the Node build of the SDK and drag in node-only servers, so the
	// specifier must stay bare and keep the runtime condition.
	const packageModules = fileURLToPath(new URL('../../node_modules', import.meta.url));

	let buildOptions: BuildOptions = {
		entryPoints: [entryPoint],
		absWorkingDir: rootDir,
		nodePaths: [packageModules],
		outfile: outPath,
		bundle: true,
		format: 'esm',
		target: 'esnext',
		// The runtime provides only what the `node:` prefix names.
		platform: 'neutral',
		mainFields: ['module', 'main'],
		// The `deno` condition is what picks the SDK's edge build. Without it the
		// bundle drags in a Node HTTP server that cannot run on the edge.
		conditions: ['deno', 'worker', 'import', 'module', 'default'],
		external: ['node:*', ...(options.external ?? [])],
		define: {
			// The client build is on disk by now, so the script can be told what it
			// holds. `typeof` in the runtime keeps this optional.
			__BUNNY_BUILD_MANIFEST__: JSON.stringify(manifest),
		},
		sourcemap: options.sourcemap === true ? 'linked' : (options.sourcemap ?? false),
		legalComments: 'none',
		metafile: true,
		logLevel: 'silent',
	};

	if (options.esbuild) {
		buildOptions = options.esbuild(buildOptions) ?? buildOptions;
	}

	const result = await esbuild.build(buildOptions);
	const output = Object.values(result.metafile?.outputs ?? {})[0];
	return {
		bytes: output?.bytes ?? 0,
		largest: largestContributors(output?.inputs ?? {}, 5),
	};
}

/** A short, readable size, for the build log. */
export function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	return `${(bytes / 1024).toFixed(0)} kB`;
}

/** The path to show a user, relative to where they ran the build. */
export function relativeTo(rootDir: string, target: string): string {
	return path.relative(rootDir, target).split(path.sep).join('/');
}

/** The two halves of the message for a script Edge Scripting will not take. */
export interface SizeLimitFailure {
	/** What happened, and what filled the file. */
	message: string;
	/** What to do about it. Astro prints it under the message. */
	hint: string;
}

/**
 * The failure for a bundle above `SIZE_LIMIT`.
 *
 * It is a pure function on purpose. Reaching the condition needs a bundle above
 * 10 MB, and no fixture should carry one, so the message is the part a test can
 * reach.
 */
export function sizeLimitFailure(
	relative: string,
	bytes: number,
	largest: BundleContributor[],
): SizeLimitFailure {
	const rows = largest.map((entry) => `  ${formatSize(entry.bytes).padStart(8)}  ${entry.name}`);
	const filled = rows.length === 0 ? '' : `\n\nThe largest parts of it are:\n${rows.join('\n')}`;
	return {
		message:
			`${relative} is ${formatSize(bytes)}, and Edge Scripting takes ` +
			`${formatSize(SIZE_LIMIT)}.${filled}`,
		hint:
			'Prerender the routes that do not need a server with `export const prerender = true`. ' +
			'A package that only runs at build time does not belong in the server, and nor does a heavy ' +
			'dependency of a page.',
	};
}
