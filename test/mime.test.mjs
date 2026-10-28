import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { contentType, isHtml } from '../dist/runtime/mime.js';

describe('contentType', () => {
	it('gives text types a charset', () => {
		assert.equal(contentType('about/index.html'), 'text/html; charset=utf-8');
		assert.equal(contentType('_astro/app.css'), 'text/css; charset=utf-8');
		assert.equal(contentType('_astro/app.js'), 'text/javascript; charset=utf-8');
	});

	it('knows the image and font types a build produces', () => {
		assert.equal(contentType('logo.svg'), 'image/svg+xml');
		assert.equal(contentType('hero.avif'), 'image/avif');
		assert.equal(contentType('body.woff2'), 'font/woff2');
	});

	it('ignores the case of the extension', () => {
		assert.equal(contentType('PHOTO.PNG'), 'image/png');
	});

	it('falls back to a binary stream', () => {
		assert.equal(contentType('data.unknown'), 'application/octet-stream');
		assert.equal(contentType('LICENSE'), 'application/octet-stream');
	});
});

describe('isHtml', () => {
	it('is true only for HTML', () => {
		assert.equal(isHtml('text/html; charset=utf-8'), true);
		assert.equal(isHtml('text/css; charset=utf-8'), false);
		assert.equal(isHtml('image/png'), false);
	});
});
