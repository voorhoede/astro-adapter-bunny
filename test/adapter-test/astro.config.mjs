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
        'astro:build:done': async ({ dir }) => {
          await writeFile(new URL('late-root.txt', dir), 'written after the build');
          await writeFile(new URL('docs/late.txt', dir), 'written after the build');
        },
      },
    },
  ],
  redirects: {
    '/old': '/about',
    '/old-blog/[slug]': '/blog/[slug]',
    '/old-products/[id]': '/products/[id]',
  },
  env: {
    schema: {
      SECRET_MESSAGE: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
