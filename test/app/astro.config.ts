import { defineConfig, envField } from 'astro/config';
import bunny from '../../src/build/integration.ts';

const script = process.env.TEST_SCRIPT === 'standalone' ? 'standalone' : 'middleware';

export default defineConfig({
  adapter: bunny({ script }),
  redirects: { '/old': '/about' },
  routeRules: { '/cached': { maxAge: 300, swr: 60 } },
  env: {
    schema: {
      CMS_TOKEN: envField.string({ context: 'server', access: 'secret' }),
      SITE_NAME: envField.string({ context: 'client', access: 'public', default: 'test' }),
    },
  },
});
