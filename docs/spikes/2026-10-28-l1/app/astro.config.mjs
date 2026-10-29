import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const log = (...args) => console.log('[spike]', ...args);
const spike = {
  name: 'spike-adapter',
  hooks: {
    'astro:config:setup': () => log('hook config:setup'),
    'astro:routes:resolved': ({ routes }) => {
      log('hook routes:resolved', JSON.stringify(routes.map((r) => ({ p: r.pattern, pre: r.isPrerendered, origin: r.origin, type: r.type }))));
    },
    'astro:config:done': ({ setAdapter, buildOutput }) => {
      log('hook config:done buildOutput before setAdapter =', buildOutput);
      setAdapter({
        name: 'spike-adapter',
        serverEntrypoint: fileURLToPath(new URL('./server.mjs', import.meta.url)),
        entrypointResolution: 'auto',
        adapterFeatures: { buildOutput, staticHeaders: process.env.STATIC_HEADERS === "1" },
        supportedAstroFeatures: { serverOutput: 'stable', staticOutput: 'stable', hybridOutput: 'stable', sharpImageService: 'limited' },
      });
    },
    'astro:build:generated': ({ routeToHeaders }) => { for (const [route, entry] of routeToHeaders) log('headers', route.route ?? route.pathname ?? Object.keys(route).join('|'), JSON.stringify(Object.fromEntries(entry.headers))); },
    'astro:build:done': () => log('hook build:done'),
  },
};

export default defineConfig({ image: { service: { build: { entrypoint: 'astro/assets/services/sharp' }, runtime: { entrypoint: 'astro/assets/services/noop' } } }, build: { redirects: false }, redirects: { "/old": "/about", "/blog/[slug]": "/posts/[slug]", "/away": "https://example.com/target", "/temp": { status: 302, destination: "/about" } }, adapter: spike, vite: { ssr: { noExternal: true } } });
