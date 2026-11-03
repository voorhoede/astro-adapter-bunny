import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import bunny from '../../../src/build/integration.ts';

const script = process.env.TEST_SCRIPT === 'standalone' ? 'standalone' : 'middleware';

export default defineConfig({
  adapter: bunny({ script }),
  build: { inlineStylesheets: 'never' },
  integrations: [
    {
      name: 'late-file',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          await writeFile(new URL('sitemap-index.xml', dir), '<sitemapindex></sitemapindex>');
        },
      },
    },
  ],
});
