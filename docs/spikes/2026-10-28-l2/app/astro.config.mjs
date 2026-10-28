import { defineConfig, envField } from 'astro/config';
import { fileURLToPath } from 'node:url';

const spike = {
  name: 'spike-adapter',
  hooks: {
    'astro:config:done': ({ setAdapter }) => {
      setAdapter({
        name: 'spike-adapter',
        serverEntrypoint: fileURLToPath(new URL('./server.mjs', import.meta.url)),
        entrypointResolution: 'auto',
        adapterFeatures: { buildOutput: 'server' },
        supportedAstroFeatures: { serverOutput: 'stable', staticOutput: 'stable', hybridOutput: 'stable', envGetSecret: 'stable', sharpImageService: 'limited' },
      });
    },
  },
};

export default defineConfig({
  output: 'server',
  adapter: spike,
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
  vite: { ssr: { noExternal: true } },
  env: { schema: { SPIKE_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }) } },
});
