import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { assetPrefix, deployInfo } from '../dist/runtime/deploy.js';
import { createStorage } from '../dist/runtime/storage.js';

afterEach(() => {
	delete globalThis.__BUNNY_DEPLOY__;
	delete process.env.BUNNY_ASSET_PREFIX;
});

describe('assetPrefix', () => {
	it('is empty when nothing sets it', () => {
		assert.equal(assetPrefix(), '');
		assert.deepEqual(deployInfo(), {});
	});

	it('reads what the CLI injected', () => {
		globalThis.__BUNNY_DEPLOY__ = { id: 'a1b2c3d4', assetPrefix: 'deploys/a1b2c3d4' };
		assert.equal(assetPrefix(), 'deploys/a1b2c3d4');
		assert.equal(deployInfo().id, 'a1b2c3d4');
	});

	it('strips the slashes around it, so joining never doubles one', () => {
		globalThis.__BUNNY_DEPLOY__ = { assetPrefix: '/deploys/a1b2c3d4/' };
		assert.equal(assetPrefix(), 'deploys/a1b2c3d4');
	});

	// The escape hatch for a deploy that does not go through the CLI.
	it('falls back to the environment', () => {
		process.env.BUNNY_ASSET_PREFIX = 'deploys/beef';
		assert.equal(assetPrefix(), 'deploys/beef');
	});

	it('prefers the injected value over the environment', () => {
		globalThis.__BUNNY_DEPLOY__ = { assetPrefix: 'deploys/injected' };
		process.env.BUNNY_ASSET_PREFIX = 'deploys/environment';
		assert.equal(assetPrefix(), 'deploys/injected');
	});

	it('ignores anything that is not an object', () => {
		globalThis.__BUNNY_DEPLOY__ = 'nonsense';
		assert.equal(assetPrefix(), '');
	});
});

describe('createStorage with a prefix', () => {
	/** Record the URL each call asks for, and answer 404. */
	function recordingFetch() {
		const asked = [];
		globalThis.fetch = async (url) => {
			asked.push(String(url));
			return new Response(null, { status: 404 });
		};
		return asked;
	}

	const original = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = original;
	});

	it('reads every object under the prefix', async () => {
		const asked = recordingFetch();
		const storage = createStorage({
			zone: 'my-site',
			host: 'storage.bunnycdn.com',
			key: 'secret',
			prefix: 'deploys/a1b2c3d4',
		});
		await storage.get('_astro/app.css');
		assert.deepEqual(asked, [
			'https://storage.bunnycdn.com/my-site/deploys/a1b2c3d4/_astro/app.css',
		]);
	});

	it('reads the zone root when there is no prefix', async () => {
		const asked = recordingFetch();
		const storage = createStorage({ zone: 'my-site', host: 'storage.bunnycdn.com', key: 'k' });
		await storage.get('index.html');
		assert.deepEqual(asked, ['https://storage.bunnycdn.com/my-site/index.html']);
	});

	// A prefix must not become an escape hatch out of the deploy's own folder.
	it('encodes an object path that would climb out of the prefix', async () => {
		const asked = recordingFetch();
		const storage = createStorage({
			zone: 'my-site',
			host: 'storage.bunnycdn.com',
			key: 'k',
			prefix: 'deploys/a1b2c3d4',
		});
		await storage.get('../../_bunny/site.json');
		assert.deepEqual(asked, [
			'https://storage.bunnycdn.com/my-site/deploys/a1b2c3d4/..%2F..%2F_bunny%2Fsite.json'.replace(
				/%2F/g,
				'/',
			),
		]);
	});
});
