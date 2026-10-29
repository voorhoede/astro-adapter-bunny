import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroConfig, AstroIntegration } from 'astro';
import { adapterConfig, configOverrides, type ImageServiceMode } from './adapter-config.ts';
import { buildManifest } from './build-manifest.ts';
import { bundle, checkScriptSize } from './bundle.ts';
import { parseHeadersFile } from './headers-file.ts';
import { parseRedirectsFile } from './redirects-file.ts';
import { requiredEnv } from './required-env.ts';

export type Options = {
  script?: 'middleware' | 'standalone';
  imageService?: ImageServiceMode;
};

const EDGE_RULE_LIMIT = 50;
const require = createRequire(import.meta.url);

export default function bunny({
  script = 'middleware',
  imageService = 'compile',
}: Options = {}): AstroIntegration {
  let config: AstroConfig;

  return {
    name: 'astro-adapter-bunny',
    hooks: {
      'astro:config:setup': ({ config: userConfig, command, updateConfig }) => {
        updateConfig(configOverrides(userConfig, command, imageService));
      },
      'astro:config:done': ({ config: resolved, setAdapter, buildOutput, logger }) => {
        config = resolved;
        setAdapter(
          adapterConfig(
            buildOutput,
            fileURLToPath(new URL('../scripts/server.ts', import.meta.url)),
          ),
        );
        logger.info(`Building a ${script} script.`);
      },
      'astro:build:done': async ({ logger }) => {
        const root = fileURLToPath(config.root);
        const client = fileURLToPath(config.build.client);
        const server = fileURLToPath(config.build.server);
        const serverEntry = config.build.serverEntry;
        const headers = parseHeadersFile(await readOptional(join(client, '_headers')));
        const redirects = parseRedirectsFile(await readOptional(join(client, '_redirects')));
        const versions = {
          adapter: require('../../package.json').version as string,
          astro: require('astro/package.json').version as string,
        };
        const common = {
          assetsDir: config.build.assets,
          versions,
          env: requiredEnv(config.env?.schema),
        };

        if (!existsSync(join(server, serverEntry))) {
          const astroRedirects = redirectLines(config.redirects);
          if (astroRedirects.length > 0)
            await appendFile(join(client, '_redirects'), `${astroRedirects.join('\n')}\n`);
          const rules = headers.length + redirects.length + astroRedirects.length;
          if (rules > EDGE_RULE_LIMIT) {
            logger.warn(
              `_headers and _redirects hold ${rules} rules, and a bunny.net pull zone takes ${EDGE_RULE_LIMIT} edge rules.`,
            );
          }
          await writeManifest(root, buildManifest({ kind: 'static', ...common }));
          return;
        }

        const output = await bundle({ dir: server, entry: serverEntry, logger });
        const scriptBytes = Buffer.byteLength(output.code);
        if (checkScriptSize(scriptBytes) === 'warn') {
          logger.warn(
            `The script is ${(scriptBytes / 1024 / 1024).toFixed(1)} MB; above 1 MB, cold starts slow down.`,
          );
        }
        const outDir = fileURLToPath(config.outDir);
        await writeFile(join(outDir, 'index.js'), output.code);
        await writeFile(join(outDir, 'index.js.map'), output.map);
        await writeManifest(
          root,
          buildManifest({
            kind: 'ssr',
            scriptType: script,
            scriptBytes,
            ...common,
          }),
        );
      },
    },
  };
}

async function readOptional(file: string): Promise<string> {
  return existsSync(file) ? readFile(file, 'utf8') : '';
}

async function writeManifest(root: string, manifest: object) {
  await mkdir(join(root, '.bunny'), { recursive: true });
  await writeFile(join(root, '.bunny/build.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function redirectLines(redirects: AstroConfig['redirects']): string[] {
  return Object.entries(redirects).map(([from, target]) => {
    const { destination, status } =
      typeof target === 'string' ? { destination: target, status: 301 } : target;
    return `${toPattern(from)} ${toPattern(destination)} ${status ?? 301}`;
  });
}

function toPattern(route: string): string {
  return route.replace(/\[\.\.\.\w+\]/g, '*').replace(/\[(\w+)\]/g, ':$1');
}
