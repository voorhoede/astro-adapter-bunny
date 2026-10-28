/**
 * An Astro image service backed by [Bunny
 * Optimizer](https://bunny.net/docs/optimizer).
 *
 * Optimizer resizes and re-encodes an image at the edge, from query parameters
 * on the image's own URL. So the service adds parameters and changes nothing
 * else: no build step, no `sharp`, and no second origin.
 *
 * Turn Optimizer on for the pull zone before you use this. Without it the
 * parameters are ignored, and the visitor gets the original image.
 *
 * This module is bundled into the Edge Script, so it stays free of imports.
 */
import type { ExternalImageService, ImageMetadata, ImageTransform } from 'astro';
import type { BunnyImageServiceConfig } from './types.js';

/** Optimizer output formats. Astro also knows `svg` and `gif`, which it cannot make. */
const FORMATS = new Set(['webp', 'jpeg', 'png', 'avif']);

/** Astro's named quality steps, as Optimizer's 1 to 100 scale. */
const QUALITY_PRESETS: Record<string, number> = { low: 25, mid: 50, high: 80, max: 100 };

/** Astro's `position` values that Optimizer accepts as `crop_gravity`. */
const GRAVITY = new Set([
	'center',
	'north',
	'south',
	'east',
	'west',
	'northeast',
	'northwest',
	'southeast',
	'southwest',
]);

const DEFAULT_MAX_WIDTH = 3840;

function isImported(src: ImageMetadata | string): src is ImageMetadata {
	return typeof src === 'object' && src !== null && 'src' in src;
}

/** True for an image on another host. Optimizer only handles your own zone. */
function isRemote(src: string): boolean {
	return /^(https?:)?\/\//i.test(src) || src.startsWith('data:');
}

/** Optimizer reads 1 to 100, so anything outside that is brought back in. */
function clampQuality(value: number): number {
	return Math.min(100, Math.max(1, Math.round(value)));
}

function toQuality(quality: ImageTransform['quality'], fallback?: number): number | undefined {
	if (typeof quality === 'number') return clampQuality(quality);
	if (typeof quality === 'string') {
		const preset = QUALITY_PRESETS[quality];
		if (preset) return preset;
		const parsed = Number.parseInt(quality, 10);
		if (Number.isFinite(parsed)) return clampQuality(parsed);
	}
	return fallback === undefined ? undefined : clampQuality(fallback);
}

/**
 * The size the image ends up at, which the `<img>` tag needs to avoid layout
 * shift. Mirrors what Astro's own services work out.
 */
function targetDimensions(options: ImageTransform): { width?: number; height?: number } {
	const { width, height, src } = options;
	if (width && height) return { width, height };

	if (isImported(src) && src.width && src.height) {
		const ratio = src.width / src.height;
		if (width) return { width, height: Math.round(width / ratio) };
		if (height) return { width: Math.round(height * ratio), height };
		return { width: src.width, height: src.height };
	}
	return { width, height };
}

function makeService(): ExternalImageService<BunnyImageServiceConfig> {
	return {
		validateOptions(options, imageConfig) {
			const max = imageConfig.service.config?.maxWidth ?? DEFAULT_MAX_WIDTH;
			// A size comes from the page, but it can also come from a crafted URL.
			// Clamp both axes, so nobody can ask the Optimizer to render a wall-sized
			// image. Height matters as much as width: `fit: "cover"` builds its crop
			// box from the two together, so a clamped width with a free height still
			// asks for the same number of pixels.
			if (options.width && options.width > max) options.width = max;
			if (options.height && options.height > max) options.height = max;
			if (options.widths) options.widths = options.widths.filter((width) => width <= max);
			return options;
		},

		getURL(options, imageConfig) {
			const source = isImported(options.src) ? options.src.src : options.src;
			// Another host's image is not on this pull zone, so Optimizer never sees
			// it. Hand back the original URL rather than a broken one.
			if (isRemote(source)) return source;

			const config = imageConfig.service.config ?? {};
			const params = new URLSearchParams();

			const cover = options.fit === 'cover' && options.width && options.height;
			if (cover) {
				// `crop` fills the box exactly. `width` alone would keep the ratio and
				// leave one side short, which is not what `fit: "cover"` promises.
				params.set('crop', `${options.width},${options.height}`);
				if (options.position && GRAVITY.has(options.position)) {
					params.set('crop_gravity', options.position);
				}
			} else {
				if (options.width) params.set('width', String(options.width));
				if (options.height) params.set('height', String(options.height));
			}

			const quality = toQuality(options.quality, config.quality);
			if (quality !== undefined) params.set('quality', String(quality));

			const format = options.format === 'jpg' ? 'jpeg' : options.format;
			if (format && FORMATS.has(format)) params.set('format', format);

			const query = params.toString();
			if (!query) return source;
			return `${source}${source.includes('?') ? '&' : '?'}${query}`;
		},

		getSrcSet(options, imageConfig) {
			const config = imageConfig.service.config ?? {};
			const { width, height } = targetDimensions(options);
			const natural = isImported(options.src) ? options.src.width : Number.POSITIVE_INFINITY;
			const ratio = width && height ? width / height : undefined;

			/** Build one entry, keeping the aspect ratio the page asked for. */
			const entry = (candidate: number, descriptor: string) => ({
				transform: {
					...options,
					width: candidate,
					height: ratio ? Math.round(candidate / ratio) : undefined,
					widths: undefined,
					densities: undefined,
				},
				descriptor,
			});

			if (options.densities?.length && width) {
				return options.densities
					.map((density) => (typeof density === 'number' ? density : Number.parseFloat(density)))
					.filter((density) => Number.isFinite(density) && density > 0)
					.sort((a, b) => a - b)
					.map((density) => entry(Math.round(width * density), `${density}x`));
			}

			// Fall back to the widths the project configured, so `<Image>` produces a
			// srcset without every page repeating the list.
			const widths = options.widths?.length ? options.widths : (config.widths ?? []);
			return [...new Set(widths)]
				.filter((candidate) => candidate > 0 && candidate <= natural)
				.sort((a, b) => a - b)
				.map((candidate) => entry(candidate, `${candidate}w`));
		},

		getHTMLAttributes(options) {
			const {
				src: _src,
				width: _width,
				height: _height,
				format: _format,
				quality: _quality,
				fit: _fit,
				position: _position,
				background: _background,
				widths: _widths,
				densities: _densities,
				...attributes
			} = options;

			const { width, height } = targetDimensions(options);
			return {
				...attributes,
				width,
				height,
				loading: attributes.loading ?? 'lazy',
				decoding: attributes.decoding ?? 'async',
			};
		},
	};
}

export default makeService();
