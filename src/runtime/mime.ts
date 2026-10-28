/**
 * Content types for the files an Astro build produces.
 *
 * Bunny Storage answers with `application/octet-stream` for everything, so the
 * script has to set the type itself. A browser refuses to run a stylesheet or a
 * module script that arrives with the wrong type.
 */
const CONTENT_TYPES: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json; charset=utf-8',
	map: 'application/json; charset=utf-8',
	xml: 'application/xml; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	svg: 'image/svg+xml',
	ico: 'image/x-icon',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	apng: 'image/apng',
	bmp: 'image/bmp',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	eot: 'application/vnd.ms-fontobject',
	mp4: 'video/mp4',
	webm: 'video/webm',
	ogg: 'audio/ogg',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	wasm: 'application/wasm',
	pdf: 'application/pdf',
	zip: 'application/zip',
	webmanifest: 'application/manifest+json',
};

/** The content type for an object path. Falls back to a binary stream. */
export function contentType(objectPath: string): string {
	const ext = objectPath.split('.').pop()?.toLowerCase() ?? '';
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** True when the type is HTML, which gets the shorter page cache lifetime. */
export function isHtml(type: string): boolean {
	return type.startsWith('text/html');
}
