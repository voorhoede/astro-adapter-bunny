import { builtinModules } from 'node:module';
import { join } from 'node:path';
import type { AstroIntegrationLogger } from 'astro';
import { rolldown } from 'rolldown';

export type BuildLogger = Pick<AstroIntegrationLogger, 'warn' | 'info' | 'debug'>;

export type Script = { code: string; builtins: string[] };

const BUILTINS = new Set(builtinModules);
const UNSUPPORTED_BUILTINS = new Set([
  'child_process',
  'vm',
  'worker_threads',
  'constants',
  'path/win32',
]);

export async function bundle({
  dir,
  entry,
  logger,
}: {
  dir: string;
  entry: string;
  logger: BuildLogger;
}): Promise<Script> {
  const builtins = new Set<string>();
  const build = await rolldown({
    input: join(dir, entry),
    onLog: (level, log) => logger[level](log.message),
    plugins: [
      {
        name: 'bunny-builtins',
        resolveId(id, importer) {
          if (id.startsWith('.') || id.startsWith('/') || importer === undefined) return null;
          const name = id.replace(/^node:/, '');
          const [root = name] = name.split('/');
          if (!BUILTINS.has(name) && !BUILTINS.has(root)) {
            throw new Error(`${id}, imported by ${importer}, was not bundled by Astro.`);
          }
          if (UNSUPPORTED_BUILTINS.has(name) || UNSUPPORTED_BUILTINS.has(root)) {
            throw new Error(`${id}, imported by ${importer}, does not run on bunny.net.`);
          }
          builtins.add(`node:${name}`);
          return { id: `node:${name}`, external: true };
        },
      },
    ],
  });
  const { output } = await build.generate({ format: 'esm', codeSplitting: false });
  await build.close();
  const [script] = output;
  return { code: script.code, builtins: [...builtins].toSorted() };
}
