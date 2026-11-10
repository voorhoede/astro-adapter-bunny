// @ts-check
import { defineConfig, envField } from 'astro/config';
import bunny from 'astro-adapter-bunny';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: bunny(),
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
