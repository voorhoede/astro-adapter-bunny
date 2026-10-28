/**
 * An Astro session driver backed by Bunny Storage.
 *
 * Astro asks a driver for three operations, and Bunny Storage answers all three
 * over plain HTTP. So a session is one object in a zone, and it is readable from
 * every edge node.
 *
 * ## Give it a zone it may write to
 *
 * The zone that holds your build should stay read-only for the script. Sessions
 * need a write password, so use a second zone:
 *
 * ```bash
 * bunny api POST /storagezone --body '{"Name":"my-site-sessions","Region":"DE"}'
 * bunny scripts env set BUNNY_SESSION_ZONE my-site-sessions
 * bunny scripts env set BUNNY_SESSION_KEY <write password> --secret
 * ```
 *
 * Without those two, the driver falls back to the asset zone, which normally
 * cannot write, and it says so plainly on the first session write.
 *
 * Bunny Storage does not expire an object, so `session.ttl` controls the cookie
 * and not the object. Delete stale objects yourself if the zone grows.
 */
import { createStorage } from './runtime/storage.js';

export interface BunnySessionConfig {
	/** Zone that holds the sessions. Defaults to `BUNNY_SESSION_ZONE`. */
	zone?: string;
	/** That zone's endpoint. Defaults to `BUNNY_SESSION_HOST`. */
	host?: string;
	/** Folder inside the zone. @default "_sessions" */
	prefix?: string;
}

/** Astro's driver contract. Astro wraps this in unstorage. */
interface SessionDriver {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

declare const Deno: { env: { get(key: string): string | undefined } } | undefined;
declare const process: { env: Record<string, string | undefined> } | undefined;

function env(key: string): string | undefined {
	if (typeof Deno !== 'undefined') return Deno.env.get(key);
	if (typeof process !== 'undefined') return process.env[key];
	return undefined;
}

/**
 * Keep a session id to characters that are safe in a storage path.
 *
 * A dot is dropped too. The id becomes one path segment either way, so a dot
 * could not traverse, but leaving no dots at all needs no second thought.
 */
function objectFor(prefix: string, key: string): string {
	const safe = key.replace(/[^A-Za-z0-9_-]/g, '_');
	return `${prefix}/${safe}.json`;
}

export default function bunnySessionDriver(config: BunnySessionConfig = {}): SessionDriver {
	const zone = config.zone || env('BUNNY_SESSION_ZONE') || env('BUNNY_STORAGE_ZONE') || '';
	const host =
		config.host || env('BUNNY_SESSION_HOST') || env('BUNNY_STORAGE_HOST') || 'storage.bunnycdn.com';
	const key = env('BUNNY_SESSION_KEY') || env('BUNNY_STORAGE_KEY') || '';
	const prefix = (config.prefix ?? '_sessions').replace(/^\/+|\/+$/g, '');

	const storage = createStorage({ zone, host, key });

	function requireZone(): void {
		if (!storage.enabled) {
			throw new Error(
				'Sessions need a storage zone. Set BUNNY_SESSION_ZONE and BUNNY_SESSION_KEY on the script.',
			);
		}
	}

	return {
		async getItem(sessionKey) {
			if (!storage.enabled) return null;
			const response = await storage.get(objectFor(prefix, sessionKey));
			return response ? await response.text() : null;
		},

		async setItem(sessionKey, value) {
			requireZone();
			try {
				await storage.put(objectFor(prefix, sessionKey), value, 'application/json');
			} catch (cause) {
				// The usual cause is the read-only password. Say so, because the raw
				// 401 from Storage explains nothing.
				throw new Error(
					'Could not write the session. BUNNY_SESSION_KEY must be a password that can write.',
					{ cause },
				);
			}
		},

		async removeItem(sessionKey) {
			if (!storage.enabled) return;
			await storage.delete(objectFor(prefix, sessionKey));
		},
	};
}
