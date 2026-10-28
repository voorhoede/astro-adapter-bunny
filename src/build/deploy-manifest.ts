/**
 * The build manifest: what the build produced, in the shape the bunny CLI
 * reads.
 *
 * The CLI must not know Astro. It reads this file instead, so a new adapter
 * needs no new CLI. `docs/writing-an-adapter.md` holds the contract, and the
 * CLI validates against it.
 *
 * The file is a build output. Keep it out of version control.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Where the CLI looks. A fixed path, because it has to find this before it knows anything else. */
export const MANIFEST_PATH = '.bunny/build.json';

/** The version of the shape below. The CLI refuses a version it does not know. */
export const MANIFEST_VERSION = 1;

export interface BuildManifestFile {
	manifestVersion: number;
	adapter: { package: string; version?: string };
	framework: { name: string; version?: string };
	/** `ssr` needs a script. `static` is files only. */
	kind: 'ssr' | 'static';
	script?: {
		/** The one file to deploy, relative to the project root. */
		entry: string;
		type: 'standalone' | 'middleware';
		bytes: number;
	};
	assets: {
		/** The folder to upload, relative to the project root. */
		dir: string;
	};
	requires?: {
		/** The lowest CLI version that understands this build. */
		cliVersion?: string;
		/** Pull zone settings the site needs. The CLI applies them, and reports what it changed. */
		pullZone?: { disableCookies?: boolean; enableSmartCache?: boolean };
		/** The script writes to the storage zone, so it needs a write password. */
		storage?: { write?: boolean; reason?: string };
		/** Variables the script reads. The CLI sets what it can, and names the rest. */
		env?: {
			name: string;
			reason?: string;
			secret?: boolean;
			optional?: boolean;
		}[];
	};
	dev?: { command?: string; preview?: string };
}

/** Write the manifest, creating `.bunny/` when it is not there yet. */
export async function writeBuildManifest(
	rootDir: string,
	manifest: BuildManifestFile,
): Promise<string> {
	const file = path.join(rootDir, MANIFEST_PATH);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
	return MANIFEST_PATH;
}
