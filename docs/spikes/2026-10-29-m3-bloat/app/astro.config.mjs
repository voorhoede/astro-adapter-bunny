import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import bunny from '../../../../src/build/integration.ts';

export default defineConfig({
  output: 'server',
  adapter: bunny({ script: 'standalone' }),
  integrations: [mdx()],
});
