import { defineConfig } from 'astro/config';
import bunny from '../../../src/build/integration.ts';

export default defineConfig({
  adapter: bunny(),
  redirects: { '/old': '/about', '/temp': { status: 302, destination: '/about' } },
});
