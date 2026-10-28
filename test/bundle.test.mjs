import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SIZE_LIMIT, largestContributors, sizeLimitFailure } from '../dist/build/bundle.js';

/**
 * A script above 10 MB is a wall a real project hits, and "10 MB" alone tells
 * nobody what to do about it. This is how the message names the packages that
 * filled the file.
 */
describe('largestContributors', () => {
	it('adds up every file of a package, and sorts by size', () => {
		const result = largestContributors(
			{
				'node_modules/shiki/dist/a.js': { bytesInOutput: 300 },
				'node_modules/shiki/dist/b.js': { bytesInOutput: 500 },
				'node_modules/tiny/index.js': { bytesInOutput: 10 },
			},
			5,
		);
		assert.deepEqual(result, [
			{ name: 'shiki', bytes: 800 },
			{ name: 'tiny', bytes: 10 },
		]);
	});

	it('keeps a scope with its package name', () => {
		const result = largestContributors(
			{ 'node_modules/@astrojs/mdx/dist/index.js': { bytesInOutput: 42 } },
			5,
		);
		assert.deepEqual(result, [{ name: '@astrojs/mdx', bytes: 42 }]);
	});

	it('reads through a nested node_modules to the package that is really there', () => {
		const result = largestContributors(
			{ 'node_modules/a/node_modules/b/index.js': { bytesInOutput: 7 } },
			5,
		);
		assert.deepEqual(result, [{ name: 'b', bytes: 7 }]);
	});

	it("names the project's own folder rather than a package", () => {
		const result = largestContributors({ 'src/pages/index.astro': { bytesInOutput: 9 } }, 5);
		assert.deepEqual(result, [{ name: 'this project (src)', bytes: 9 }]);
	});

	it('returns only as many as it was asked for', () => {
		const inputs = {};
		for (let i = 0; i < 10; i++) inputs[`node_modules/p${i}/index.js`] = { bytesInOutput: i };
		assert.equal(largestContributors(inputs, 3).length, 3);
		assert.equal(largestContributors(inputs, 3)[0].name, 'p9');
	});
});

/**
 * The build throws this when the script cannot be deployed. Reaching the
 * condition needs a bundle above 10 MB, and no fixture carries one, so the
 * message and the hint are what a test can hold to.
 */
describe('sizeLimitFailure', () => {
	const largest = [
		{ name: 'shiki', bytes: 4 * 1024 * 1024 },
		{ name: 'this project (src)', bytes: 2048 },
	];

	it('says the size, the limit, and what filled the file', () => {
		const { message } = sizeLimitFailure('dist/index.js', SIZE_LIMIT + 1, largest);
		assert.match(message, /^dist\/index\.js is 10\.00 MB, and Edge Scripting takes 10\.00 MB\./);
		assert.match(message, /The largest parts of it are:/);
		assert.match(message, /4\.00 MB {2}shiki/);
		assert.match(message, /2 kB {2}this project \(src\)/);
	});

	it('keeps the advice out of the message, so Astro prints it as a hint', () => {
		const { message, hint } = sizeLimitFailure('dist/index.js', SIZE_LIMIT + 1, largest);
		assert.doesNotMatch(message, /prerender/i);
		assert.match(hint, /prerender/i);
	});

	it('says nothing about parts when esbuild reported none', () => {
		const { message } = sizeLimitFailure('dist/index.js', SIZE_LIMIT + 1, []);
		assert.doesNotMatch(message, /largest parts/);
		assert.match(message, /Edge Scripting takes 10\.00 MB\.$/);
	});
});
