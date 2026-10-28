import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import bunnySessionDriver from '../dist/session.js';

const realFetch = globalThis.fetch;

/** A stand-in zone that records what the driver asked it to do. */
function fakeZone(objects = {}) {
	const calls = [];
	globalThis.fetch = async (url, init = {}) => {
		const path = new URL(String(url)).pathname;
		calls.push({ method: init.method ?? 'GET', path, body: init.body, headers: init.headers });

		if ((init.method ?? 'GET') === 'GET') {
			return path in objects
				? new Response(objects[path], { status: 200 })
				: new Response(null, { status: 404 });
		}
		if (init.method === 'PUT') {
			objects[path] = String(init.body);
			return new Response(null, { status: 201 });
		}
		return new Response(null, { status: 200 });
	};
	return { calls, objects };
}

beforeEach(() => {
	process.env.BUNNY_SESSION_ZONE = 'sessions';
	process.env.BUNNY_SESSION_KEY = 'write-password';
	delete process.env.BUNNY_SESSION_HOST;
	delete process.env.BUNNY_STORAGE_ZONE;
	delete process.env.BUNNY_STORAGE_KEY;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.BUNNY_SESSION_ZONE;
	delete process.env.BUNNY_SESSION_KEY;
});

describe('the session driver', () => {
	it('writes and reads back the same value', async () => {
		const zone = fakeZone();
		const driver = bunnySessionDriver();

		await driver.setItem('abc123', '{"name":"Bunny"}');
		assert.equal(await driver.getItem('abc123'), '{"name":"Bunny"}');
		assert.equal(zone.objects['/sessions/_sessions/abc123.json'], '{"name":"Bunny"}');
	});

	it('returns null for a session that was never written', async () => {
		fakeZone();
		assert.equal(await bunnySessionDriver().getItem('missing'), null);
	});

	it('removes a session', async () => {
		const zone = fakeZone({ '/sessions/_sessions/abc.json': '{}' });
		await bunnySessionDriver().removeItem('abc');
		assert.equal(zone.calls.at(-1).method, 'DELETE');
	});

	it('keeps a hostile session id inside the prefix', async () => {
		const zone = fakeZone();
		await bunnySessionDriver().setItem('../../secrets', '{}');
		assert.equal(zone.calls[0].path, '/sessions/_sessions/______secrets.json');
	});

	it('takes the folder from the config', async () => {
		const zone = fakeZone();
		await bunnySessionDriver({ prefix: 'state' }).setItem('abc', '{}');
		assert.equal(zone.calls[0].path, '/sessions/state/abc.json');
	});

	it('falls back to the asset zone when no session zone is set', async () => {
		delete process.env.BUNNY_SESSION_ZONE;
		process.env.BUNNY_STORAGE_ZONE = 'assets';
		const zone = fakeZone();
		await bunnySessionDriver().setItem('abc', '{}');
		assert.equal(zone.calls[0].path, '/assets/_sessions/abc.json');
	});

	it('says which variables are missing rather than failing quietly', async () => {
		delete process.env.BUNNY_SESSION_ZONE;
		fakeZone();
		await assert.rejects(
			() => bunnySessionDriver().setItem('abc', '{}'),
			/BUNNY_SESSION_ZONE and BUNNY_SESSION_KEY/,
		);
	});

	it('blames the read-only password when a write is refused', async () => {
		globalThis.fetch = async () => new Response(null, { status: 401 });
		await assert.rejects(
			() => bunnySessionDriver().setItem('abc', '{}'),
			/password that can write/,
		);
	});
});
