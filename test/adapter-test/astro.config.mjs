// @ts-check
import { defineConfig, envField } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import bunny from 'astro-adapter-bunny';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: bunny(),
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'nl'],
    routing: { prefixDefaultLocale: false },
    fallback: { nl: 'en' },
  },
  integrations: [
    {
      name: 'late-files',
      hooks: {
        'astro:config:setup': ({ injectRoute }) => {
          injectRoute({ pattern: '/injected', entrypoint: './src/injected.ts' });
        },
        'astro:build:done': async ({ dir }) => {
          await writeFile(new URL('late-root.txt', dir), 'written after the build');
          await writeFile(new URL('docs/late.txt', dir), 'written after the build');
        },
      },
    },
  ],
  image: { remotePatterns: [{ protocol: 'https', hostname: 'docs.astro.build' }] },
  redirects: {
    '/old': '/about',
    '/old-blog/[slug]': '/blog/[slug]',
    '/old-products/[id]': '/products/[id]',
  },
  env: {
    schema: {
      PUBLIC_SERVER_VALUE: envField.string({ context: 'server', access: 'public', default: 'server-default' }),
      PUBLIC_CLIENT_VALUE: envField.string({ context: 'client', access: 'public', default: 'client-default' }),
      SECRET_MESSAGE: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
