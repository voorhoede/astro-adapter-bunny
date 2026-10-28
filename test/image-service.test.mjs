import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import service from '../dist/image-service.js';

/** The shape Astro hands an image service. */
const config = (serviceConfig = {}) => ({ service: { entrypoint: '', config: serviceConfig } });

/** A local image, as Astro represents one after the build. */
const imported = {
	src: '/_astro/photo.abc123.png',
	width: 1600,
	height: 900,
	format: 'png',
};

/** Parse the query of a URL the service returned. */
const query = (url) => Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''));

describe('getURL', () => {
	it('adds the width to an imported image', () => {
		const url = service.getURL({ src: imported, width: 720 }, config());
		assert.equal(url.split('?')[0], '/_astro/photo.abc123.png');
		assert.deepEqual(query(url), { width: '720' });
	});

	it('passes a quality preset through as a number', () => {
		assert.equal(query(service.getURL({ src: imported, quality: 'high' }, config())).quality, '80');
		assert.equal(query(service.getURL({ src: imported, quality: 55 }, config())).quality, '55');
	});

	it('takes the default quality from the service config', () => {
		const url = service.getURL({ src: imported, width: 100 }, config({ quality: 82 }));
		assert.equal(query(url).quality, '82');
	});

	it('only asks for formats Optimizer can make', () => {
		assert.equal(query(service.getURL({ src: imported, format: 'webp' }, config())).format, 'webp');
		// Astro calls it jpg, Optimizer calls it jpeg.
		assert.equal(query(service.getURL({ src: imported, format: 'jpg' }, config())).format, 'jpeg');
		// Optimizer cannot produce these, so no parameter is sent.
		assert.equal(
			query(service.getURL({ src: imported, format: 'gif' }, config())).format,
			undefined,
		);
		assert.equal(
			query(service.getURL({ src: imported, format: 'svg' }, config())).format,
			undefined,
		);
	});

	it('crops when fit is cover, because width alone would leave a gap', () => {
		const url = service.getURL(
			{ src: imported, width: 400, height: 400, fit: 'cover', position: 'north' },
			config(),
		);
		assert.deepEqual(query(url), { crop: '400,400', crop_gravity: 'north' });
	});

	it('ignores a crop position Optimizer does not know', () => {
		const url = service.getURL(
			{ src: imported, width: 10, height: 10, fit: 'cover', position: 'top left' },
			config(),
		);
		assert.equal(query(url).crop_gravity, undefined);
	});

	it('keeps both sides when fit is not cover', () => {
		const url = service.getURL({ src: imported, width: 400, height: 400 }, config());
		assert.deepEqual(query(url), { width: '400', height: '400' });
	});

	it('leaves a remote image alone, because Optimizer never sees it', () => {
		const remote = 'https://images.example.com/a.png';
		assert.equal(service.getURL({ src: remote, width: 400 }, config()), remote);
		assert.equal(
			service.getURL({ src: '//cdn.example.com/a.png' }, config()),
			'//cdn.example.com/a.png',
		);
	});

	it('returns the plain source when nothing needs changing', () => {
		assert.equal(service.getURL({ src: imported }, config()), '/_astro/photo.abc123.png');
	});

	it('appends to a source that already has a query', () => {
		const url = service.getURL({ src: '/public/a.png?v=2', width: 100 }, config());
		assert.equal(url, '/public/a.png?v=2&width=100');
	});
});

describe('validateOptions', () => {
	it('clamps a width above the maximum', () => {
		const options = service.validateOptions({ src: imported, width: 99_999 }, config());
		assert.equal(options.width, 3840);
	});

	it('honours a configured maximum', () => {
		const options = service.validateOptions(
			{ src: imported, width: 5000 },
			config({ maxWidth: 1000 }),
		);
		assert.equal(options.width, 1000);
	});

	it('drops srcset widths above the maximum', () => {
		const options = service.validateOptions(
			{ src: imported, widths: [400, 800, 9000] },
			config({ maxWidth: 1000 }),
		);
		assert.deepEqual(options.widths, [400, 800]);
	});

	it('holds the height to the same maximum', () => {
		const options = service.validateOptions(
			{ src: imported, height: 9000 },
			config({ maxWidth: 1000 }),
		);
		assert.equal(options.height, 1000);
	});

	it('holds a cover crop box to the maximum on both sides', () => {
		// `fit: "cover"` asks Optimizer for width x height pixels. A clamped width
		// beside a free height still asks for a wall-sized image.
		const limited = config({ maxWidth: 1000 });
		const options = service.validateOptions(
			{ src: imported, width: 5000, height: 9000, fit: 'cover' },
			limited,
		);
		assert.deepEqual(query(service.getURL(options, limited)), { crop: '1000,1000' });
	});

	it('keeps a quality inside the 1 to 100 scale Optimizer reads', () => {
		const cases = [
			[500, '100'],
			[-20, '1'],
			['500', '100'],
			['-20', '1'],
		];
		for (const [quality, expected] of cases) {
			const options = service.validateOptions({ src: imported, width: 100, quality }, config());
			assert.equal(
				query(service.getURL(options, config())).quality,
				expected,
				`quality ${JSON.stringify(quality)}`,
			);
		}
	});

	it('keeps a configured default quality inside the scale too', () => {
		const loud = config({ quality: 900 });
		const options = service.validateOptions({ src: imported, width: 100 }, loud);
		assert.equal(query(service.getURL(options, loud)).quality, '100');
	});
});

describe('getSrcSet', () => {
	it('builds one entry per width, in order', () => {
		const values = service.getSrcSet({ src: imported, widths: [1080, 360, 720] }, config());
		assert.deepEqual(
			values.map((value) => value.descriptor),
			['360w', '720w', '1080w'],
		);
		assert.equal(values[0].transform.width, 360);
	});

	it('falls back to the widths in the service config', () => {
		const values = service.getSrcSet({ src: imported }, config({ widths: [200, 400] }));
		assert.deepEqual(
			values.map((value) => value.descriptor),
			['200w', '400w'],
		);
	});

	it('never asks for more pixels than the file has', () => {
		const values = service.getSrcSet({ src: imported, widths: [800, 3200] }, config());
		assert.deepEqual(
			values.map((value) => value.transform.width),
			[800],
		);
	});

	it('keeps the aspect ratio the page asked for', () => {
		const values = service.getSrcSet(
			{ src: imported, width: 800, height: 400, widths: [400] },
			config(),
		);
		assert.equal(values[0].transform.height, 200);
	});

	it('uses densities when they are given', () => {
		const values = service.getSrcSet({ src: imported, width: 300, densities: [1, 2] }, config());
		assert.deepEqual(
			values.map((value) => [value.transform.width, value.descriptor]),
			[
				[300, '1x'],
				[600, '2x'],
			],
		);
	});

	it('returns nothing when no widths are configured', () => {
		assert.deepEqual(service.getSrcSet({ src: imported }, config()), []);
	});
});

describe('getHTMLAttributes', () => {
	it('works the dimensions out from the file', () => {
		const attributes = service.getHTMLAttributes({ src: imported, width: 800 }, config());
		assert.equal(attributes.width, 800);
		assert.equal(attributes.height, 450);
	});

	it('defaults to lazy loading', () => {
		const attributes = service.getHTMLAttributes({ src: imported }, config());
		assert.equal(attributes.loading, 'lazy');
		assert.equal(attributes.decoding, 'async');
	});

	it('keeps what the page set', () => {
		const attributes = service.getHTMLAttributes(
			{ src: imported, alt: 'A photo', loading: 'eager', class: 'hero' },
			config(),
		);
		assert.equal(attributes.alt, 'A photo');
		assert.equal(attributes.loading, 'eager');
		assert.equal(attributes.class, 'hero');
	});

	it('does not leak the service parameters into the tag', () => {
		const attributes = service.getHTMLAttributes(
			{ src: imported, quality: 80, format: 'webp', fit: 'cover', widths: [100] },
			config(),
		);
		for (const key of ['src', 'quality', 'format', 'fit', 'widths']) {
			assert.equal(key in attributes, false, `${key} reached the tag`);
		}
	});
});
