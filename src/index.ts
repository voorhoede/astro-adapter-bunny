import type { AstroConfig, AstroIntegration } from 'astro';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

export default function bunny(): AstroIntegration {
  let config: AstroConfig;

  return {
    name: 'astro-adapter-bunny',
    hooks: {
      'astro:config:setup': ({ config: userConfig, updateConfig }) => {
        config = userConfig;

        updateConfig({
          image: {
            service: {
              build: { entrypoint: 'astro/assets/services/sharp' },
              runtime: { entrypoint: 'astro/assets/services/noop' },
            },
          },
        });
      },
      'astro:config:done': ({ config: resolvedConfig, setAdapter }) => {
        config = resolvedConfig;

        setAdapter({
          name: 'astro-adapter-bunny',
          entrypointResolution: 'auto',
          serverEntrypoint: 'astro-adapter-bunny/script.ts',
          adapterFeatures: {},
          supportedAstroFeatures: {
            staticOutput: 'stable',
            hybridOutput: 'stable',
            serverOutput: 'stable',
            i18nDomains: 'unsupported',
            envGetSecret: 'stable',
            sharpImageService: 'limited',
          },
        });
      },
      'astro:build:setup': ({ vite }) => {
        vite.ssr ||= {};
        vite.ssr.noExternal = true;
        vite.ssr.resolve ||= {};
        vite.ssr.resolve.conditions = ['deno', 'module', 'node', 'development|production'];
      },
      'astro:build:done': async () => {
        const outFile = join(fileURLToPath(config.outDir), 'index.js');
        const server = fileURLToPath(config.build.server);
        const serverEntry = config.build.serverEntry;
        const build = await rolldown({
          input: join(server, serverEntry),
          platform: 'node',
        });
        const {
          output: [bundle],
        } = await build.generate({
          format: 'esm',
          codeSplitting: false,
        });
        await build.close();
        await writeFile(outFile, bundle.code);
      },
    },
  };
}
